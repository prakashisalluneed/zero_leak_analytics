"""Sandbox for executing model-generated Pandas code.

The model is asked to produce a short Python snippet that computes ``result`` from
``df``. That snippet is untrusted input: it is parsed, validated against a syntax
allowlist, and only then executed with a restricted builtin namespace.

A source-text blocklist cannot be made sound (see docs/SECURITY.md), so the policy is
expressed as an allowlist over AST node types. Anything not explicitly permitted is
rejected with :class:`SandboxViolation`.
"""
from __future__ import annotations

import ast
import time

# --- Policy -----------------------------------------------------------------

# Statement and expression nodes a data analysis snippet may contain.
ALLOWED_NODES = {
    ast.Module,
    ast.Expr,
    ast.Assign,
    ast.AugAssign,
    ast.AnnAssign,
    ast.Return,
    # Expressions
    ast.BinOp,
    ast.UnaryOp,
    ast.BoolOp,
    ast.Compare,
    ast.IfExp,
    ast.Call,
    ast.Attribute,
    # A lambda is just an expression: its body is walked and validated under the
    # same rules, so `df.assign(margin=lambda d: d.a / d.b)` is safe. FunctionDef
    # and ClassDef stay banned — those introduce statements and nesting.
    ast.Lambda,
    ast.arguments,
    ast.arg,
    ast.Subscript,
    ast.Slice,
    ast.Name,
    ast.Load,
    ast.Store,
    ast.Constant,
    ast.List,
    ast.Tuple,
    ast.Set,
    ast.Dict,
    ast.Starred,
    ast.keyword,
    # Comprehensions
    ast.ListComp,
    ast.DictComp,
    ast.SetComp,
    ast.GeneratorExp,
    ast.comprehension,
    # Statements
    ast.If,
    ast.For,
    ast.While,
    ast.Break,
    ast.Continue,
    ast.Pass,
    # Operators
    ast.Add,
    ast.Sub,
    ast.Mult,
    ast.Div,
    ast.FloorDiv,
    ast.Mod,
    ast.Pow,
    ast.USub,
    ast.UAdd,
    ast.Not,
    ast.And,
    ast.Or,
    ast.Invert,
    ast.BitAnd,
    ast.BitOr,
    ast.BitXor,
    ast.LShift,
    ast.RShift,
    ast.Eq,
    ast.NotEq,
    ast.Lt,
    ast.LtE,
    ast.Gt,
    ast.GtE,
    ast.Is,
    ast.IsNot,
    ast.In,
    ast.NotIn,
    # f-strings
    ast.JoinedStr,
    ast.FormattedValue,
}

# Call targets that must never appear, regardless of how they are reached. These are
# the reflection primitives that turn an attribute allowlist into a walkable object
# graph, plus the classic escape hatches.
FORBIDDEN_CALL_NAMES = {
    'eval',
    'exec',
    'compile',
    'open',
    'input',
    'breakpoint',
    'getattr',
    'setattr',
    'delattr',
    'hasattr',
    'vars',
    'globals',
    'locals',
    'dir',
    'repr',
    '__import__',
    'memoryview',
    'object',
    'type',
    'super',
    'exit',
    'quit',
    'help',
}

# Modules the guarded import may resolve. Pandas touches ``__import__`` lazily from
# inside property accessors (``Series.dtype`` reaches for ``pandas.core.dtypes`` on
# first use), so removing the builtin entirely breaks ordinary analysis. The guard
# keeps that working while refusing ``os``, ``sys``, ``subprocess`` and everything
# else. Generated code cannot reach this function directly: ``__import__`` is a
# dunder name and the AST policy rejects any reference to it.
IMPORT_ALLOWLIST_PREFIXES = ('pandas', 'numpy')


def _guarded_import(name, globals=None, locals=None, fromlist=(), level=0):
    root = name.split('.', 1)[0]
    if level == 0 and root in IMPORT_ALLOWLIST_PREFIXES:
        return __import__(name, globals, locals, fromlist, level)
    raise ImportError(f'Module {name!r} is not available during analysis.')


# Builtins available to the snippet. Deliberately excludes anything that can reach the
# filesystem, the interpreter, or reflection.
SAFE_BUILTINS = {
    '__import__': _guarded_import,
    'abs': abs,
    'all': all,
    'any': any,
    'bool': bool,
    'dict': dict,
    'enumerate': enumerate,
    'float': float,
    'int': int,
    'len': len,
    'list': list,
    'max': max,
    'min': min,
    'range': range,
    'reversed': reversed,
    'round': round,
    'set': set,
    'sorted': sorted,
    'str': str,
    'sum': sum,
    'tuple': tuple,
    'zip': zip,
    'True': True,
    'False': False,
    'None': None,
}

MAX_EXECUTION_SECONDS = 20.0


class SandboxViolation(Exception):
    """The snippet was rejected before execution."""

    def __init__(self, message: str, code: str = 'unsafe_code'):
        super().__init__(message)
        self.code = code


class ExecutionTimeout(Exception):
    """The snippet exceeded its wall-clock budget."""


def _is_dunder(name: str) -> bool:
    return len(name) > 4 and name.startswith('__') and name.endswith('__')


def validate_code(source: str) -> ast.Module:
    """Parse ``source`` and raise :class:`SandboxViolation` if it leaves the policy."""
    try:
        tree = ast.parse(source, mode='exec')
    except SyntaxError as exc:
        raise SandboxViolation(
            f'The generated code could not be parsed: {exc.msg}', code='syntax_error'
        ) from exc

    for node in ast.walk(tree):
        node_type = type(node)

        if node_type not in ALLOWED_NODES:
            raise SandboxViolation(
                f'This operation is not permitted in analysis code ({node_type.__name__}).'
            )

        # Attribute access: block dunder traversal such as obj.__class__.__mro__.
        if isinstance(node, ast.Attribute):
            if _is_dunder(node.attr):
                raise SandboxViolation(
                    'Introspection attributes are not permitted in analysis code.'
                )
            if _is_dunder(getattr(node.value, 'id', '')):
                raise SandboxViolation(
                    'Introspection attributes are not permitted in analysis code.'
                )

        # Bare identifiers: block dunders and the builtin namespace object.
        if isinstance(node, ast.Name):
            if _is_dunder(node.id) or node.id == '__builtins__':
                raise SandboxViolation(
                    'Introspection names are not permitted in analysis code.'
                )

        # Keyword argument names are identifiers too.
        if isinstance(node, ast.keyword):
            if node.arg and _is_dunder(node.arg):
                raise SandboxViolation(
                    'Introspection keyword arguments are not permitted in analysis code.'
                )
            # ``**mapping`` unpacking can inject arbitrary keyword names, including
            # dunders, after this check has run. Analysis snippets do not need it.
            if node.arg is None:
                raise SandboxViolation(
                    'Keyword unpacking (**kwargs) is not permitted in analysis code.'
                )

        # Calls: refuse the reflection primitives by name.
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name):
            if node.func.id in FORBIDDEN_CALL_NAMES:
                raise SandboxViolation(
                    f"Calling '{node.func.id}' is not permitted in analysis code."
                )

        # Constant strings: refuse dunder fragments used to build attribute names.
        if isinstance(node, ast.Constant) and isinstance(node.value, str):
            if '__' in node.value and _looks_like_traversal(node.value):
                raise SandboxViolation(
                    'Strings containing introspection markers are not permitted.'
                )

    return tree


def _looks_like_traversal(value: str) -> bool:
    """Catch ``'__class__'`` and ``'_'*2 + 'class'``-style names in literals."""
    compact = value.replace('_', '')
    markers = {'class', 'bases', 'mro', 'subclasses', 'globals', 'builtins', 'dict',
               'init', 'module', 'code', 'func', 'reduce', 'getattribute'}
    return compact.lower() in markers


def execute(source: str, df, extra_namespace: dict | None = None):
    """Validate then execute ``source`` against ``df``. Returns the ``result`` value."""
    tree = validate_code(source)

    try:
        compiled = compile(tree, '<analysis>', 'exec')
    except (SyntaxError, ValueError) as exc:
        raise SandboxViolation(f'The generated code could not be compiled: {exc}') from exc

    # `pd` is part of the analysis contract: the prompt tells the model it is
    # pre-loaded, so it must be present in the namespace under that exact name.
    import pandas as pd

    local_namespace = {'df': df, 'pd': pd}
    if extra_namespace:
        local_namespace.update(extra_namespace)

    # Comprehensions and generator expressions execute in their own scope, which
    # resolves free variables against the *globals* mapping, not the enclosing
    # locals. `df` and `pd` must therefore be present in both, or
    # `{c: df[c].dtype for c in df.columns}` raises NameError at runtime.
    global_namespace = {'__builtins__': SAFE_BUILTINS, **local_namespace}
    deadline = time.monotonic() + MAX_EXECUTION_SECONDS

    def trace_lines(frame, event, arg):
        if time.monotonic() > deadline:
            raise ExecutionTimeout('Analysis exceeded the time limit.')
        return trace_lines

    previous_trace = None
    try:
        import sys

        previous_trace = sys.gettrace()
        sys.settrace(trace_lines)
        exec(compiled, global_namespace, local_namespace)  # noqa: S102
    except ExecutionTimeout:
        raise
    finally:
        import sys

        sys.settrace(previous_trace)

    if 'result' not in local_namespace:
        raise SandboxViolation(
            'The analysis did not produce a result.', code='no_result'
        )
    return local_namespace['result']
