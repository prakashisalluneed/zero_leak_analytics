# Where we left off

Written 2026-10-24. Pick up from here.

## Run it

```bash
cd "C:\Users\91969\Desktop\zero_leak_analytics"
.venv/Scripts/python.exe manage.py migrate
cd frontend-react && npm install && npm run build && cd ..
.venv/Scripts/python.exe manage.py collectstatic --noinput
.venv/Scripts/python.exe manage.py runserver 8000
```

Then open <http://127.0.0.1:8000>. Ollama must be running with `llama3.1` pulled
(`ollama serve`, `ollama pull llama3.1`).

Demo account: `ada` / `Analytical8Engine` — owns `catalog.csv` and one conversation.

> `runserver` is started with `--noreload` in session tests; pass no flag if you want
> auto-reload while editing.

## What is done and verified

- **Backend, 138 tests passing.** `manage.py test analytics`.
- **Auth**: register, sign-in, profile, password change, preferences, username
  availability check.
- **Datasets**: upload with profiling (rows, columns, dtypes, null counts), preview,
  rename, pin, delete (row + file).
- **Conversations**: create, list, rename, pin, delete; messages persisted with
  chart, method note, and the executed code.
- **Analysis pipeline**: schema-only prompt → sandboxed execution → formatting, with
  automatic repair on a runtime error and progress streaming over polling.
- **Sandbox** (`analytics/sandbox.py`): AST allowlist, replaces a keyword blocklist
  that had three working escapes. 33 tests.
- **Answer verification**: figures in the prose are checked against the computation;
  mismatched row/value pairings are detected; the prose is replaced with a truthful
  description when either check fails.
- **Frontend**: landing, sign-up, sign-in, overview dashboard, dataset page, chat
  workspace, settings. Lint clean, production build clean.

## Known issue, not yet fixed

**Bar charts render with near-zero-height bars.** Visible in the screenshot from the
last session: `Doohickey / Gadget / Widget` bars sit flat on the axis while the y-axis
reads 0–400. The line and area charts render correctly, and the *data* is right
(390/140/270), so this is a chart-configuration bug, most likely recharts 3.x bar
geometry interacting with the custom `tick` renderer or the axis `height={34}`.

Start by inspecting `.recharts-bar-rectangle path` `getBBox()` in the browser and
comparing the computed `xAxis` scale to the bar widths. Try removing `maxBarSize={56}`
first — a width constraint plus `radius` has been the cause of this in recharts 3.x.

## Next features, in the order I'd do them

1. Fix the bar chart.
2. Streaming responses over SSE instead of 650 ms polling — the polling works but
   feels slower than it is.
3. Export: download a chart as PNG and a result table as CSV.
4. Billing: wire `STRIPE_PRICE_ID` to a real checkout session; the webhook handler
   and tier switching already exist and are tested.
5. Transactional email (Resend) for password reset — the only SaaS element of the
   original seven that is still missing.

## Deferred by decision

Supabase and FastAPI are not used. The product's claim is that data never leaves the
host; a hosted database and object store would contradict it. Ownership scoping is
enforced in the application layer (`Dataset.objects.owned_by`) and covered by the
security tests. See `docs/DATABASE.md` for the reasoning, written out.
