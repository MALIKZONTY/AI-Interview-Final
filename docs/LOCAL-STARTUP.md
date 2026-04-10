# Local startup — run in this order

Paths below assume the project root is `AI Final` (the monorepo folder).

---

## Prerequisites

1. **Node.js 20+** and **npm** (or **pnpm**).
2. **Python 3.12+** for the AI service.
3. **PostgreSQL** running locally (or use Docker Compose for the database only).
4. **Env files** configured:
   - `apps/api/.env` — `DATABASE_URL`, `JWT_SECRET`, `AI_SERVICE_URL=http://localhost:8000`, Cloudinary vars for uploads.
   - `apps/web/.env` — e.g. `VITE_API_URL=/api` when using Vite’s dev proxy.
   - `services/ai-service/.env` — `CORS_ORIGINS`, `WHISPER_MODEL_SIZE` / `WHISPER_DEVICE` for local **faster-whisper** (see **`docs/ML-MODELS-AND-DATA.md`**).

---

## One-time setup

### 1) Install Node dependencies (from repo root)

```bash
npm install
```

If you use pnpm:

```bash
pnpm install
```

### 2) Create database tables (from `apps/api`)

PostgreSQL must already be running and `DATABASE_URL` must match it.

```bash
cd apps/api
npx prisma db push
```

(Or from root with pnpm: `pnpm db:push`.)

### 3) AI service — Python venv and packages

```bash
cd services/ai-service
python -m venv .venv
```

**Windows (PowerShell):**

```powershell
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

**macOS / Linux:**

```bash
source .venv/bin/activate
pip install -r requirements.txt
```

---

## Every time you develop — run these in order

Use **separate terminals** for each long-running process.

### Step 1 — PostgreSQL

Start your local Postgres (or ensure the Docker `db` service is up if you use Compose).

---

### Step 2 — AI service (FastAPI)

**Important:** The virtualenv lives in **`services/ai-service/.venv`**, and Uvicorn **must** be started with **`services/ai-service`** as the working directory. If you run from the monorepo root, you get **`ModuleNotFoundError: No module named 'app'`**, and `.\.venv\Scripts\Activate.ps1` will **not** exist at the root.

**Option A — helper script (recommended)**

From the **repo root** (Windows):

```powershell
powershell -ExecutionPolicy Bypass -File .\services\ai-service\run-dev.ps1
```

From the **repo root** (macOS / Linux):

```bash
bash services/ai-service/run-dev.sh
```

**Option B — manual `cd` then Uvicorn**

```bash
cd services/ai-service
```

**Windows (PowerShell):**

```powershell
cd services\ai-service
.\.venv\Scripts\Activate.ps1
$v = (Resolve-Path .venv).Path
python -m uvicorn app.main:app --reload --reload-dir app --reload-exclude $v --host 0.0.0.0 --port 8000
```

(`--reload-exclude` must be the **absolute** path to `.venv`: Uvicorn compares exclude dirs to WatchFiles’ absolute paths; a bare `.venv` does not match on Windows. Prefer **`run-dev.ps1`**, which sets this for you.)

**macOS / Linux:**

```bash
cd services/ai-service
source .venv/bin/activate
python -m uvicorn app.main:app --reload --reload-dir app --reload-exclude "$(pwd)/.venv" --host 0.0.0.0 --port 8000
```

- URL: **http://localhost:8000**
- Health check: **http://localhost:8000/health**

---

### Step 3 — Backend (Fastify API)

```bash
cd apps/api
npm run dev
```

- URL: **http://localhost:4000** (default; see `PORT` in `apps/api/.env`)

---

### Step 4 — Frontend (Vite)

```bash
cd apps/web
npm run dev
```

- URL: **http://localhost:5173** (typical Vite default)

---

## Optional: start API + web together (pnpm + Turbo)

From repo root, if `pnpm` is on your PATH:

```bash
pnpm dev
```

This still requires **Postgres** and the **AI service** running separately.

---

## Optional: Prisma Studio (inspect database)

```bash
cd apps/api
npm run studio
```

---

## Full stack with Docker

From repo root (builds and starts **db**, **ai**, **api**, **web**):

```bash
docker compose up --build
```

- Web (nginx): **http://localhost:8080** (see `docker-compose.yml` for ports)
- Set Cloudinary and optional `OPENAI_API_KEY` in root `.env` for Compose variable substitution where applicable.

---

## Quick checklist

| Order | Service    | Command / note                                                                         |
| ----- | ---------- | -------------------------------------------------------------------------------------- |
| 1     | PostgreSQL | Start instance matching `DATABASE_URL`                                                 |
| 2     | AI         | `run-dev.ps1` / `run-dev.sh`, or `cd services/ai-service` then Uvicorn — port **8000** |
| 3     | API        | `npm run dev` in **apps/api** on port **4000**                                         |
| 4     | Web        | `npm run dev` in **apps/web** (usually **5173**)                                       |

---

## Troubleshooting

### `ModuleNotFoundError: No module named 'app'`

You started Uvicorn from the **monorepo root** (`AI Final`) instead of **`services/ai-service`**. Python needs to resolve the `app` package from `services/ai-service/app/`. Use **Option A** above or `cd services/ai-service` first.

### `.\.venv\Scripts\Activate.ps1` not found

The venv is **not** at the repo root. It should be at **`services\ai-service\.venv`**. Either run `run-dev.ps1` or:

```powershell
cd services\ai-service
.\.venv\Scripts\Activate.ps1
```

If `.venv` is missing there, run `python -m venv .venv` inside `services/ai-service`, then `pip install -r requirements.txt`.

### Uvicorn reload watching `.venv` / **torch** (reload loop)

Uvicorn’s WatchFiles supervisor **always adds `Path.cwd()`** when you use **`--reload-dir app`** (see `uvicorn/supervisors/watchfilesreload.py`), so **`.venv/Lib/site-packages/...`** is still observed. You must pass **`--reload-exclude`** with the **absolute** path to `.venv` (e.g. **`$(Resolve-Path .venv).Path`** in PowerShell or **`$(pwd)/.venv`** in bash). A relative **`.venv`** fails Uvicorn’s `exclude_dir in path.parents` check against absolute paths from WatchFiles, so excludes do nothing and the server keeps reloading. Use **`run-dev.ps1`** / **`run-dev.sh`** to avoid this.
