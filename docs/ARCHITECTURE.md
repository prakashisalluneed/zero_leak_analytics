# Zero Leak Analytics — Architecture

## Product thesis

Zero Leak Analytics is an AI data-analysis workspace for teams whose data cannot leave
their own infrastructure. A user uploads a CSV or Excel file, asks a question in plain
English, and receives a written answer plus an auto-generated chart. Every model call
goes to a **local** LLM server (Ollama / vLLM exposed through an OpenAI-compatible
interface). No prompt, no schema, and no row of customer data ever transits a third
party.

That constraint is the product. It drives every decision below.

## Runtime topology

```
┌──────────────────────────────────────────────────────────────────────┐
│  Browser                                                             │
│  React 19 SPA (Vite build, served by Django/WhiteNoise or nginx)     │
└───────────────┬──────────────────────────────────────────────────────┘
                │  HTTPS · JSON + JWT bearer
┌───────────────▼──────────────────────────────────────────────────────┐
│  Django 5.2 + DRF  (core/)                                           │
│  · auth, ownership scoping, tier/rate gating, upload validation      │
│  · REST API under /api/                                              │
└──────┬─────────────────────────┬──────────────────────┬──────────────┘
       │                         │                      │
┌──────▼──────┐        ┌─────────▼────────┐   ┌─────────▼───────────┐
│ PostgreSQL  │        │ Redis            │   │ Local media volume  │
│ records +   │        │ Celery broker,   │   │ uploaded datasets   │
│ ownership   │        │ cache, counters  │   │ (never leaves host) │
└─────────────┘        └─────────┬────────┘   └─────────────────────┘
                                 │
                       ┌─────────▼────────┐      ┌───────────────────┐
                       │ Celery worker    │─────▶│ Ollama / vLLM     │
                       │ analysis tasks   │      │ 127.0.0.1:11434   │
                       └──────────────────┘      └───────────────────┘
```

Local development can run the whole thing with `runserver` alone: Celery falls back to
`TASK_ALWAYS_EAGER` with an in-memory broker, and SQLite replaces Postgres.

## Request lifecycle for one question

1. **Enqueue.** `POST /api/sessions/<id>/chat/`. The view scopes the session lookup to
   `request.user`, checks the per-tier rate limit, records a `ChatMessage(role=user)`,
   and dispatches a Celery task.
2. **Load.** The worker re-fetches the dataset *scoped to the requesting user id* — a
   second authorization check that does not trust the view.
3. **Profile.** The dataframe is read and its schema (column names + dtypes only) is
   rendered into the prompt. **No values are sent to the model in the code-generation
   step.**
4. **Codegen.** The LLM returns a Python snippet that computes `result` from `df`.
5. **Validate.** The snippet is parsed into an AST and checked against the sandbox
   policy (see `docs/SECURITY.md`). Anything that could reach the interpreter, the
   filesystem, or a dunder chain is rejected before execution.
6. **Execute.** The snippet runs against the dataframe with a restricted builtin
   namespace and row/column caps.
7. **Format.** A second, streaming LLM call turns the computed value into one or two
   sentences of prose. Charts bypass this step.
8. **Publish.** Progress (`stage`, accumulated tokens, chart payload) is written to the
   Celery result backend. The client polls `/api/tasks/<id>/` and renders tokens as
   they accumulate.
9. **Persist.** On completion the assistant message, chart, and elapsed time are written
   to `ChatMessage` so the conversation survives a reload.

## Application layout

```
core/                Django project: settings, URLs, WSGI/ASGI, Celery app
analytics/           The product domain
  models.py          Dataset, ChatSession, ChatMessage, UserTier, UsageEvent
  sandbox.py         AST validation + restricted execution of LLM code
  analysis.py        Pure pipeline helpers (prompting, dataframe IO, chart payloads)
  tasks.py           Celery task wiring progress reporting
  views.py           Datasets, chat enqueue, task polling
  sessions.py        Conversation CRUD + message history
  accounts.py        Registration, profile, password change
  billing.py         Stripe webhook + checkout
  tiers.py           Plan definitions and rate limits
frontend/            Django app that serves the compiled SPA shell
frontend-react/      React + Vite + Tailwind source
docs/                Architecture, database, security
```

## Boundaries

- **Views never execute analysis.** They validate, authorize, enqueue, and return.
  Long-running work belongs to Celery so a slow model cannot hold a worker.
- **The worker never trusts the view.** Every task re-derives ownership from the
  `user_id` argument.
- **Analysis helpers are pure.** `analysis.py` has no Django imports beyond settings, so
  the pipeline is testable without a database.
- **The frontend holds no business rules.** Tier limits, file validation, and
  authorization are server-side; the UI reflects them.

## Failure modes and behaviour

| Failure | Behaviour |
| --- | --- |
| Ollama unreachable | Task raises; poll returns `FAILURE` with a generic message, full trace to logs |
| Generated code fails | `AnalysisError(code=execution_error)`; user sees the exception line, not a traceback |
| Generated code violates policy | `AnalysisError(code=unsafe_code)`; rejected before execution |
| Upload too large / wrong type | `400` with an actionable message; nothing written to disk |
| Rate limit exceeded | `429` with `Retry-After` and the plan's allowance |
| Token expired | Client refreshes once transparently; on failure emits `zla:unauthorized` and returns to sign-in |
| Task belongs to another user | `404` — indistinguishable from missing |
