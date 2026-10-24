"""Tests for the AST-based analysis sandbox.

These assert the escapes that defeated the previous source-text blocklist are now
rejected *before* execution, and that ordinary dataframe work still runs.
"""
import pandas as pd
from django.test import SimpleTestCase

from .sandbox import SandboxViolation, execute, validate_code


def frame():
    return pd.DataFrame({'region': ['North', 'South', 'North'], 'revenue': [120, 80, 60]})


class RejectionTests(SimpleTestCase):
    """Payloads that must never reach the interpreter."""

    def assert_rejected(self, code):
        with self.assertRaises(SandboxViolation):
            validate_code(code)

    # --- The three bypasses of the original blocklist ---------------------

    def test_blocks_object_graph_traversal(self):
        self.assert_rejected("result = df.__class__.__mro__[1].__subclasses__()")

    def test_blocks_class_dunder_alone(self):
        self.assert_rejected("result = df.__class__")

    def test_blocks_getattr_string_construction(self):
        self.assert_rejected("result = getattr(df, '_' * 2 + 'class' + '_' * 2)")

    def test_blocks_concatenated_dunder_literal(self):
        self.assert_rejected("result = df.__getattribute__('__class__')")

    def test_blocks_builtins_namespace(self):
        self.assert_rejected("result = __builtins__['__import__']('os')")

    # --- Interpreter and filesystem escape --------------------------------

    def test_blocks_import(self):
        self.assert_rejected('import os\nresult = os.listdir("/")')

    def test_blocks_from_import(self):
        self.assert_rejected('from os import system\nresult = system("dir")')

    def test_blocks_open(self):
        self.assert_rejected('result = open("/etc/passwd").read()')

    def test_blocks_eval(self):
        self.assert_rejected('result = eval("1+1")')

    def test_blocks_exec(self):
        self.assert_rejected('exec("x = 1")\nresult = 1')

    def test_blocks_compile(self):
        self.assert_rejected('result = compile("1+1", "<s>", "eval")')

    def test_blocks_lambda_default_with_dunder(self):
        # Lambdas are allowed, but their contents are still validated.
        self.assert_rejected('result = (lambda x=__builtins__: x)()')

    def test_blocks_lambda_body_traversal(self):
        self.assert_rejected('result = (lambda: df.__class__)()')

    def test_blocks_lambda_body_import(self):
        self.assert_rejected("result = (lambda: __import__('os').getcwd())()")

    def test_blocks_class_definition(self):
        self.assert_rejected('class X:\n    pass\nresult = 1')

    def test_blocks_function_definition(self):
        self.assert_rejected('def f():\n    return 1\nresult = f()')

    def test_blocks_dunder_keyword_argument(self):
        self.assert_rejected('result = sorted([1], key=len, __class__=1)')

    def test_blocks_keyword_unpacking(self):
        # **mapping can inject dunder keyword names after static checks run.
        self.assert_rejected('result = sorted([1], key=len, **{})')

    def test_blocks_deleted_builtins(self):
        self.assert_rejected('result = dir()')

    def test_blocks_vars(self):
        self.assert_rejected('result = vars()')

    def test_blocks_with_statement(self):
        self.assert_rejected('with open("x") as f:\n    result = 1')

    def test_blocks_dunder_string_fragment(self):
        self.assert_rejected("result = 'cl' + '__class' + '__'")


class ExecutionTests(SimpleTestCase):
    """Legitimate analysis must still work."""

    def test_plain_assignment(self):
        result = execute('result = len(df)', frame())
        self.assertEqual(result, 3)

    def test_pandas_aggregation(self):
        code = (
            "grouped = df.groupby('region')['revenue'].sum().reset_index()\n"
            'result = grouped'
        )
        result = execute(code, frame())
        self.assertIsInstance(result, pd.DataFrame)
        self.assertEqual(len(result), 2)

    def test_comprehension(self):
        result = execute('result = [c for c in df.columns]', frame())
        self.assertEqual(result, ['region', 'revenue'])

    def test_dict_comprehension(self):
        result = execute('result = {c: str(df[c].dtype) for c in df.columns}', frame())
        # pandas 3.x reports text columns as 'str' (formerly 'object').
        self.assertIn(result['region'], ('str', 'object'))
        self.assertEqual(result['revenue'], 'int64')

    def test_f_string(self):
        result = execute('result = f"{len(df)} rows"', frame())
        self.assertEqual(result, '3 rows')

    def test_conditional(self):
        result = execute("result = 'big' if len(df) > 2 else 'small'", frame())
        self.assertEqual(result, 'big')

    def test_loop(self):
        result = execute('total = 0\nfor n in df["revenue"]:\n    total = total + n\nresult = total', frame())
        self.assertEqual(result, 260)

    def test_lambda_in_assign_is_allowed(self):
        # pandas `.apply` and `.assign` commonly take a lambda; the model emits it.
        code = "df['double'] = df['revenue'].apply(lambda v: v * 2)\nresult = df['double'].sum()"
        self.assertEqual(execute(code, frame()), 520)

    def test_missing_result_raises(self):
        with self.assertRaises(SandboxViolation):
            execute('x = 1', frame())

    def test_syntax_error_is_rejected_cleanly(self):
        with self.assertRaises(SandboxViolation) as ctx:
            execute('result = (((', frame())
        self.assertEqual(ctx.exception.code, 'syntax_error')

    def test_execution_error_propagates(self):
        with self.assertRaises(Exception):
            execute('result = df["missing_column"].sum()', frame())
