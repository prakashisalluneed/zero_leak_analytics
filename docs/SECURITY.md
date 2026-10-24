# Security Model

Two things must be true for this product to be credible:

1. A tenant can never read another tenant's data, even by guessing ids.
2. Model-generated code can never touch the host — no filesystem, no network, no
   interpreter escape — because it runs on the same machine that holds every
   customer's data.

This document describes how both are enforced.

## 1. Tenant isolation

### Scope at the choke point

All dataset reads go through `Dataset.objects.owned_by(user)`. Sessions and messages are
reached only by joining through a dataset the caller owns, or by a direct `user_id`
filter. There is no code path that lists or fetches an unscoped record for an
authenticated request.

### 404, not 403

A record that exists but belongs to someone else returns **404**. A 403 would confirm
that the id exists, which is enough to enumerate the tenant population.

### Defense in depth in the worker

The Celery task receives `user_id` and re-filters the dataset by it:

```python
Dataset.objects.filter(pk=dataset_id, user_id=user_id).first()
```

A view bug therefore cannot escalate into a cross-tenant read; the worker would return
`not_found`.

### Task ownership

Task ids are globally addressable in a Celery result backend. Two independent checks
gate polling:

1. a cache entry mapping `task_id → user_id`, set at enqueue time (fast rejection);
2. the `user_id` embedded in the task's result metadata (survives cache expiry).

Either mismatch returns 404.

### Upload validation

- Extension allowlist: `.csv`, `.xlsx` only (case-insensitive).
- Size cap enforced before the file is written.
- Filename is reduced to its basename; the storage path is
  `datasets/<user_id>/<name>` so a user's files can never be written into another
  user's directory.
- The file is parsed before the dataset row is committed, so a malformed upload leaves
  no half-created record.

## 2. The analysis sandbox

### The problem with the original approach

The first implementation used a blocklist:

```python
DANGEROUS_PATTERNS = ['__import__', 'eval(', 'open(', 'subprocess', 'os.system', 'shutil']
```

This is not a security boundary. Three independent bypasses exist:

- **Attribute traversal.** `df` is a live pandas object. `df.__class__.__mro__[1].__subclasses__()`
  walks Python's object graph to reach `os._wrap_close`, and from there the shell.
- **String construction.** `getattr(o, '_' * 2 + 'class' + '_' * 2)` never contains the
  literal `__class__`.
- **Escaped literals.** `eval` is blocked, but `\x65val` is not.

A blocklist over source text can never enumerate every escape. The rewrite replaces it
with an **allowlist over the parsed syntax tree**.

### The AST policy

The snippet is parsed with `ast.parse` and every node is checked against an allowlist of
expression and statement types. Anything outside the allowlist is rejected before
execution. In particular:

| Rejected | Why |
| --- | --- |
| `Import`, `ImportFrom` | No module loading of any kind |
| Any attribute beginning and ending with `__` | Cuts the object-graph traversal |
| Any identifier that is a dunder (`__builtins__`, `__globals__`, …) | Same |
| `global`, `nonlocal`, `del` | No rebinding of outer scope |
| `ClassDef`, `FunctionDef`, `AsyncFunctionDef` | No defining new callables to hide logic |
| `With`, `Try`, `Raise`, `Assert` | No resource acquisition or control-flow obfuscation |
| `Lambda` with a dunder default | Covered by the identifier rule |
| Calls to `getattr`, `setattr`, `delattr`, `vars`, `globals`, `locals`, `compile`, `eval`, `exec`, `open`, `input`, `breakpoint`, `__import__` | Removes the reflection primitives that make the above bypasses possible |

The allowlist retains everything a dataframe analysis needs: arithmetic, comparisons,
boolean logic, subscripts and slices, comprehensions, f-strings, `if`/`for`, chained
method calls on `df`, and the curated builtin set.

### Execution environment

```python
exec(compiled, {"__builtins__": SAFE_BUILTINS}, {"df": df, "pd": pd})
```

`SAFE_BUILTINS` is an explicit dict of ~20 pure functions (`len`, `sum`, `min`, `max`,
`round`, `sorted`, …). It deliberately omits `open`, `eval`, `exec`, `compile`,
`__import__`, and `getattr`. Because `__builtins__` is replaced rather than augmented,
even a successful lookup finds nothing dangerous.

### Resource limits

| Limit | Value | Enforcement |
| --- | --- | --- |
| Wall clock per snippet | 20 s | `sys.settrace` line hook against a monotonic deadline |
| Rows loaded | 200,000 | Truncated at read time, with a flag returned to the UI |
| Columns | 500 | Rejected at upload |
| Prompt schema size | 8,000 chars | Column list truncated |
| Upload size | 25 MB | Checked before write |

The trace-based deadline is the only portable way to interrupt a runaway pure-Python
loop on Windows, where `SIGALRM` is unavailable. It fires on line events only, so
time spent inside pandas' C loops is not counted — which is the desired behaviour, since
those are the expensive-but-legitimate operations. The Celery task additionally carries
a hard `time_limit`, which kills the worker process in the last resort.

### Prompt isolation

The code-generation prompt contains **column names and dtypes only** — never values,
never a sample of rows. A malicious or compromised model therefore cannot exfiltrate
data through a prompt it did not receive. The formatting step does receive the computed
scalar, which is the user's own answer.

### What this sandbox is not

It is an application-level control, not an OS-level one. A determined attacker with the
ability to write arbitrary Python and enough time is best stopped by a container. The
production deployment runs the Celery worker in its own container with:

- no host filesystem mounts other than the media volume;
- `network_mode` restricted so it can reach Ollama but not the public internet;
- a non-root user;
- seccomp defaults from the container runtime.

The AST policy is the first gate; the container is the last.

## 3. Authentication and secrets

- JWT access tokens are short-lived (60 min) and refreshed transparently; refresh tokens
  rotate (7 days).
- Passwords are validated by Django's four default validators and hashed with PBKDF2.
- The Stripe webhook verifies an HMAC-SHA256 signature in constant time over the raw
  body and is idempotent on `event.id` for 24 hours.
- `DJANGO_SECRET_KEY` has no production default; the development fallback is documented
  as insecure and Compose requires an override.
- No secret is ever sent to the frontend. The SPA reads configuration from the API.

## 4. Logging

Structured log lines record the user id, dataset id, task id, stage, and elapsed time —
never question text beyond a truncated prefix, never generated code at INFO level, and
never row data. Security-relevant denials (`dataset.access_denied`,
`task.access_denied`, `ai_query.rate_limited`, `stripe.webhook.invalid_signature`) are
logged at WARNING with the source address.
