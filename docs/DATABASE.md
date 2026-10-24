# Database & Security Model

Django owns the schema and the migrations. Supabase is **not** used: the product's
central guarantee is that customer data never leaves the host, and a hosted Postgres +
object store would contradict it. PostgreSQL runs locally (Compose) or as SQLite in
development; uploaded files live on a local media volume.

Authorization is enforced in the application layer rather than by database row-level
security policies, because Django connects as a single database role and has no
per-request `auth.uid()` to key policies on. The equivalent guarantee is provided by a
**mandatory ownership scope on every queryset**, documented and tested below.

## Entity relationships

```
auth_user (Django)
   │ 1
   │
   ├──< datasets            (owner)
   ├──< chat_sessions       (owner)
   ├──── user_tiers         (1:1, plan + Stripe ids)
   └──< usage_events        (audit trail)

datasets
   │ 1
   └──< chat_sessions       (a conversation is bound to one dataset)

chat_sessions
   │ 1
   └──< chat_messages       (ordered turns)
```

## Tables

### `auth_user`
Django's built-in user. `first_name`/`last_name` hold the display name; `email` is
unique and is the login identifier alongside `username`.

### `analytics_dataset`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | bigint PK | |
| `user_id` | bigint FK → `auth_user` | **NOT NULL**, `ON DELETE CASCADE`. The ownership key. |
| `name` | varchar(255) | Display name, defaults to the uploaded filename |
| `file` | varchar(100) | Path under `MEDIA_ROOT/datasets/<user_id>/` |
| `uploaded_at` | timestamptz | auto |
| `row_count` | int | Filled on upload |
| `column_count` | int | Filled on upload |
| `size_bytes` | bigint | Filled on upload |
| `column_schema` | jsonb | `[{name, dtype, nullable, null_count, unique_count, sample}]` |
| `is_starred` | bool | Sidebar pin |
| `last_analyzed_at` | timestamptz | nullable |

Indexes: `(user_id, -uploaded_at)`.

### `analytics_chatsession`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | bigint PK | |
| `user_id` | bigint FK → `auth_user` | NOT NULL, cascade |
| `dataset_id` | bigint FK → `analytics_dataset` | NOT NULL, cascade |
| `title` | varchar(200) | Derived from the first question |
| `is_pinned` | bool | |
| `created_at` / `updated_at` | timestamptz | |

Indexes: `(user_id, -updated_at)`, `(dataset_id)`.

### `analytics_chatmessage`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | bigint PK | |
| `session_id` | bigint FK → `analytics_chatsession` | NOT NULL, cascade |
| `role` | varchar(16) | `user` \| `assistant` |
| `content` | text | Answer prose (empty while running) |
| `chart` | jsonb | nullable; `{chart_type, chart_data}` |
| `error` | text | nullable; set when the run failed |
| `elapsed_ms` | int | nullable |
| `created_at` | timestamptz | |

Indexes: `(session_id, created_at)`. Messages are append-only.

### `analytics_usertier`

| Column | Type | Notes |
| --- | --- | --- |
| `user_id` | bigint PK/FK → `auth_user` | 1:1, cascade |
| `tier` | varchar(16) | `free` \| `pro`, default `free` |
| `stripe_customer_id` | varchar(255) | |
| `stripe_subscription_id` | varchar(255) | |
| `preferences` | jsonb | UI + analysis preferences |
| `updated_at` | timestamptz | |

### `analytics_usageevent`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | bigint PK | |
| `user_id` | bigint FK → `auth_user` | cascade |
| `kind` | varchar(40) | `dataset.upload`, `analysis.run`, `auth.login`, … |
| `metadata` | jsonb | Free-form, never contains row data |
| `created_at` | timestamptz | indexed |

## The ownership invariant

Every API path that reads a dataset must go through the scoped manager:

```python
Dataset.objects.owned_by(request.user).filter(pk=pk).first()
```

`owned_by()` is the single choke point. A row belonging to another user must be
indistinguishable from a row that does not exist: the API returns **404**, never 403,
so an attacker cannot probe for the existence of another tenant's ids.

The same rule applies one level down. A chat session is reachable only if
`session.user_id == request.user.id`, and a message only through a session the caller
owns. The Celery worker repeats the check using the `user_id` passed to the task, so a
compromised or buggy view cannot widen access.

### Storage isolation

Uploads are written under `datasets/<user_id>/<filename>`, and the stored path is
validated against the owning user before any file is opened. A file path is never
constructed from user input alone.

## Migrations

| Migration | Purpose |
| --- | --- |
| `0001_initial` | `Dataset` |
| `0002_dataset_user` | Adds the owner FK |
| `0003_usertier` | Plan records |
| `0004_backfill_dataset_owner` | Assigns legacy orphans to the first superuser |
| `0005_*` | Conversation tables, dataset profiling, usage events, preferences |

Legacy rows with `user_id IS NULL` are **unreachable through the API by design**. The
backfill migration assigns them to an administrator rather than leaving them exposed.

## Test coverage of the invariant

`analytics/tests_security.py` asserts, for both datasets and tasks:

- listing is scoped to the owner and hides orphan rows;
- enqueuing on another user's dataset returns 404;
- polling another user's task returns 404;
- the Stripe webhook rejects unsigned and mis-signed payloads and is idempotent.
