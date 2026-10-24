Now I have a complete picture of the project. Here's a comprehensive README for your GitHub:

```markdown
# Zero Leak Analytics

**Zero Leak Analytics** is a private, local-first data analysis platform. Upload CSV/Excel datasets, ask questions in plain English, and get instant answers, charts, and tables — powered by a local LLM via Ollama. Nothing leaves your machine.

[![Django](https://img.shields.io/badge/Django-5.2-green)](https://www.djangoproject.com/)
[![React](https://img.shields.io/badge/React-19-blue)](https://react.dev/)
[![Vite](https://img.shields.io/badge/Vite-8-yellow)](https://vitejs.dev/)
[![Ollama](https://img.shields.io/badge/Ollama-llama3.1-purple)](https://ollama.com/)

---

## What it does

| Feature | Description |
|---------|-------------|
| **Dataset upload** | Upload `.csv` or `.xlsx` files (up to 25 MB). Files are profiled automatically (rows, columns, schema). |
| **Natural-language queries** | Ask questions like _"What were total sales by region?"_ and get computed answers. |
| **Charts** | Automatic chart generation (bar, line, pie, etc.) using Recharts. |
| **Code transparency** | Every answer includes the exact Python snippet that computed it — you can audit the work. |
| **Chat sessions** | Conversations are bound to datasets. Session titles are derived from your first question. |
| **Rate limits & tiers** | Free/Pro tiers with per-user AI query rate limiting. |
| **Usage audit** | Every upload, query, and analysis is logged for accountability. |
| **REST API** | Full Django REST API under `/api/` with JWT authentication. |
| **SPA frontend** | React + Vite + Tailwind CSS single-page app served by Django (WhiteNoise) or Nginx. |

---

## How it works

```
┌─────────────┐      ┌──────────────┐      ┌─────────────────┐
│  React SPA  │─────▶│  Django API  │─────▶│   Ollama LLM    │
│  (frontend) │      │  (backend)   │      │  (local model)  │
└─────────────┘      └──────────────┘      └─────────────────┘
        │                   │                   ▲
        │                   │                   │
        ▼                   ▼                   │
   User asks          Celery task          Sandbox executes
   question           (async analysis)     generated Python code
                                                    │
                                                    ▼
                                             pandas on uploaded
                                               dataset file
```

### The analysis pipeline

1. **Upload** — You upload a CSV or Excel file. Django validates it, loads it with pandas, and stores a column profile (row count, column count, schema, truncation flag).
2. **Question** — You type a question in the chat. Django creates a user message, enqueues a Celery task, and returns a `task_id`.
3. **Prompt** — The Celery task builds a prompt from the dataset profile + conversation history and sends it to the local Ollama model (`llama3.1` by default).
4. **Execute** — The model returns Python code. The code is cleaned (markdown fences stripped), then executed in a sandbox against your dataset using pandas.
5. **Format** — Results are shaped into an answer, chart payload, or table. The model verifies the prose against the computed numbers to prevent hallucinated figures.
6. **Respond** — The answer (plus code, chart, and method notes) is saved as an assistant message and streamed back to the frontend via task-status polling.

### Key design decisions

- **Local-first AI:** Uses Ollama running on your machine. No API keys, no data sent to third-party AI providers.
- **Sandboxed execution:** Model-generated Python runs in a restricted sandbox. Policy violations are refused outright, not "repaired."
- **Self-healing code:** If generated code crashes, the model is prompted once with the error to fix it.
- **User data isolation:** Every dataset, session, and message is scoped to its owner via `owned_by(user)` queryset filters.
- **Eager tasks locally:** `CELERY_TASK_ALWAYS_EAGER=1` by default so development works without Redis. Docker Compose uses real Redis + Celery workers.

---

## Tech stack

**Backend**
- Django 5.2
- Django REST Framework
- SimpleJWT (authentication)
- django-cors-headers, django-ratelimit
- Celery + Redis (async tasks)
- Pandas, OpenPyXL (data processing)
- LangChain-Ollama (local LLM)
- Gunicorn, WhiteNoise (production serving)
- PostgreSQL (production) / SQLite (local dev)

**Frontend**
- React 19
- Vite 8
- Tailwind CSS 4
- React Router DOM
- Recharts (charts)
- Lucide React (icons)

**Infrastructure**
- Docker + Docker Compose
- Nginx (frontend container)
- Postgres 16, Redis 7

---

## Project structure

```
zero_leak_analytics/
├── core/                 # Django project settings & URLs
├── analytics/            # Core Django app (models, views, tasks, analysis pipeline)
│   ├── models.py         # Dataset, ChatSession, ChatMessage, UserTier, UsageEvent
│   ├── views.py          # REST API views (datasets, chat, tasks, stats, health)
│   ├── tasks.py          # Celery analysis task (prompt → sandbox → format)
│   ├── analysis.py       # File validation, profiling, LLM prompts, result shaping
│   ├── sandbox.py        # Restricted Python execution sandbox
│   ├── urls.py           # API route definitions
│   ├── auth_views.py     # Registration, login, profile, preferences
│   ├── billing.py        # Stripe billing & webhooks
│   ├── sessions.py       # Session CRUD views
│   └── tiers.py          # Rate limits per user tier
├── frontend/             # Django app serving the React SPA
│   └── views.py          # SPA catch-all view
├── frontend-react/       # React + Vite frontend
│   ├── src/              # React components, pages, state
│   ├── dist/             # Production build output
│   ├── vite.config.js    # Vite config with API proxy to :8000
│   └── package.json
├── real_sales.csv        # Sample dataset
├── docker-compose.yml    # Full-stack orchestration (Postgres, Redis, backend, worker, frontend)
├── Dockerfile            # Backend container image
├── requirements.txt      # Python dependencies
├── manage.py             # Django CLI
└── db.sqlite3            # Local development database (SQLite)
```

---

## Quick start (local development)

### Prerequisites

- Python 3.11+
- Node.js 18+
- [Ollama](https://ollama.com/) installed and running with the `llama3.1` model:
  ```bash
  ollama pull llama3.1
  ```

### 1. Clone the repository

```bash
git clone https://github.com/YOUR_USERNAME/zero_leak_analytics.git
cd zero_leak_analytics
```

### 2. Backend

```bash
# Create virtual environment
python -m venv .venv
.\.venv\Scripts\activate        # Windows
# source .venv/bin/activate     # Mac/Linux

# Install dependencies
pip install -r requirements.txt

# Run migrations
python manage.py migrate

# Start the dev server (tasks run inline, no Redis needed locally)
python manage.py runserver
```

The API is now at `http://127.0.0.1:8000`.

### 3. Frontend

```bash
cd frontend-react
npm install
npm run dev      # Vite dev server at http://localhost:5173
```

Open **http://localhost:5173** in your browser. The frontend proxies `/api` and `/media` to the Django backend on `:8000`.

### 4. Create a superuser (optional)

```bash
python manage.py createsuperuser
```

Then visit `http://127.0.0.1:8000/admin/`.

---

## Run with Docker Compose

Full stack with Postgres, Redis, Celery workers, and Nginx-served frontend:

```bash
# Copy and edit environment variables
cp .env.example .env   # if present, or create your own .env

# Build and start
docker compose up --build

# Services:
# - Backend API:  http://localhost:8000
# - Frontend:     http://localhost:3000
# - Postgres:     localhost:5432
# - Redis:        localhost:6379
```

Ollama is reached via `host.docker.internal:11434` from inside containers.

---

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DJANGO_SECRET_KEY` | `django-insecure-...` | Django secret key (change in production!) |
| `DJANGO_DEBUG` | `1` | Enable debug mode |
| `DJANGO_ALLOWED_HOSTS` | `localhost,127.0.0.1` | Allowed host headers |
| `POSTGRES_DB` | — | PostgreSQL database name (if set, uses Postgres instead of SQLite) |
| `POSTGRES_USER` | `postgres` | Postgres user |
| `POSTGRES_PASSWORD` | `` | Postgres password |
| `POSTGRES_HOST` | `127.0.0.1` | Postgres host |
| `POSTGRES_PORT` | `5432` | Postgres port |
| `REDIS_CACHE_URL` | — | Redis cache URL (local memory cache if unset) |
| `CELERY_BROKER_URL` | `redis://127.0.0.1:6379/0` | Celery broker |
| `CELERY_RESULT_BACKEND` | `redis://127.0.0.1:6379/1` | Celery result backend |
| `CELERY_TASK_ALWAYS_EAGER` | `1` | Run tasks inline (dev) vs worker (prod) |
| `OLLAMA_BASE_URL` | `http://127.0.0.1:11434` | Ollama server URL |
| `OLLAMA_MODEL` | `llama3.1` | Ollama model to use |
| `STRIPE_SECRET_KEY` | `` | Stripe secret key (Pro tier billing) |
| `STRIPE_PRICE_ID` | `` | Stripe price ID for Pro subscription |
| `STRIPE_WEBHOOK_SECRET` | `whsec_mock_dev_secret` | Stripe webhook signing secret |

---

## API overview

All API endpoints require JWT authentication unless noted. Base path: `/api/`

### Authentication
- `POST /api/auth/register/` — Register a new user
- `POST /api/auth/login/` — Obtain JWT access/refresh tokens
- `POST /api/auth/refresh/` — Refresh access token
- `GET /api/auth/me/` — Current user profile
- `POST /api/auth/password/` — Change password

### Datasets
- `GET /api/datasets/` — List your datasets
- `POST /api/datasets/` — Upload a CSV/Excel file
- `GET /api/datasets/<id>/` — Dataset details
- `PATCH /api/datasets/<id>/` — Update name / star status
- `DELETE /api/datasets/<id>/` — Delete a dataset
- `GET /api/datasets/<id>/preview/` — Preview first N rows

### Conversations
- `GET /api/sessions/` — List your chat sessions
- `GET /api/sessions/<id>/` — Session details with messages
- `POST /api/sessions/<id>/chat/` — Ask a question (returns `task_id`)
- `GET /api/tasks/<task_id>/` — Poll analysis status & results

### Workspace
- `GET /api/stats/` — Workspace overview (counts, storage, recent sessions)

### System
- `GET /api/health/` — Health check (no auth required)

---

## Deployment

### Render.com (recommended for free hosting)

1. Push your code to GitHub.
2. Create a **Web Service** on Render connected to your repo.
3. **Build command:** `pip install -r requirements.txt && cd frontend-react && npm install && npm run build && cd ..`
4. **Start command:** `python manage.py migrate && python manage.py collectstatic --noinput && gunicorn core.wsgi:application`
5. Add environment variables (see table above), especially `DJANGO_SECRET_KEY`, `DJANGO_DEBUG=0`, `DJANGO_ALLOWED_HOSTS`.
6. Set `CELERY_TASK_ALWAYS_EAGER=1` on Render's free tier (no separate worker).
7. Deploy. Your app will be at `https://your-app.onrender.com`.

> ⚠️ Note: Ollama cannot run on Render's free tier. The AI chat feature requires a self-hosted Ollama instance reachable from your deployment, or you can replace the LLM provider.

### Docker (any cloud)

```bash
docker compose up -d
```

Works on any host with Docker and a reachable Ollama instance.

---

## Sample data

The repository includes `real_sales.csv` — a small sample sales dataset you can upload to test the platform immediately.

---

## Security

- All file uploads are validated (extension + size limit of 25 MB).
- Model-generated code runs in a restricted sandbox; dangerous operations are blocked.
- Every dataset/session/message is scoped to its owner.
- JWT authentication protects all API endpoints.
- Rate limiting is applied per user tier for AI queries.
- No user data or prompts are sent to external AI services (Ollama runs locally).

---

## Contributing

1. Fork the repository.
2. Create a feature branch: `git checkout -b feature/your-feature`
3. Commit your changes: `git commit -m "Add your feature"`
4. Push to the branch: `git push origin feature/your-feature`
5. Open a pull request.

---

## License

MIT License. See [LICENSE](LICENSE) for details.

---

## Support

If you run into issues, open a GitHub issue with:
- Your operating system
- Python and Node versions
- Whether you're using Docker or local dev
- The error message or logs

Made with Django + React + Ollama. Keep your data local. 🚀
```

---

### Important notes before you push to GitHub

1. **Remove `db.sqlite3`** from the repo (it's a binary database file). Add it to `.gitignore`.
2. **Add `.venv/` and `node_modules/`** to `.gitignore` if not already there.
3. **Generate a new `DJANGO_SECRET_KEY`** — don't commit the default insecure one.
4. **Replace `YOUR_USERNAME`** in the clone URL with your actual GitHub username.

Would you like me to also create a `.gitignore` file or a `.env.example` for the repo?
