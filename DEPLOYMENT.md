# Deployment Guide — MarkItDown Website

This guide explains how to deploy the MarkItDown Website, which is made up of two
independently deployable parts:

- **Frontend** — a Vite + React (TypeScript) single-page app in [`frontend/`](./frontend),
  deployed to a static host / CDN such as **Vercel** or **Netlify**.
- **Backend** — a FastAPI service in [`backend/`](./backend), deployed as a
  **Docker** container to any container host (Docker Compose, Google Cloud Run,
  AWS ECS/Fargate, Azure Container Apps, Fly.io, Render, etc.).

The frontend talks to the backend over HTTP. In production you either:

1. Point the frontend directly at the backend origin via `VITE_API_BASE_URL`, **or**
2. Proxy `/api/*` from the static host to the backend (the included `vercel.json`
   and `netlify.toml` are pre-wired for this).

> **Security note:** The backend currently has **no authentication** on its
> endpoints. It is protected by per-IP rate limiting and CORS origin allow-listing
> only. If you expose it on a public origin, place it behind HTTPS (TLS 1.3),
> restrict `CORS_ORIGINS` to your real frontend origin(s), and consider an API
> gateway, WAF, or auth layer in front of it.

---

## Table of Contents

1. [Architecture overview](#1-architecture-overview)
2. [Prerequisites](#2-prerequisites)
3. [Local development](#3-local-development)
4. [Backend deployment (Docker)](#4-backend-deployment-docker)
5. [Frontend deployment (Vercel / Netlify)](#5-frontend-deployment-vercel--netlify)
6. [Wiring the frontend to the backend](#6-wiring-the-frontend-to-the-backend)
7. [CORS configuration](#7-cors-configuration)
8. [Environment variable reference](#8-environment-variable-reference)
9. [Health checks and monitoring](#9-health-checks-and-monitoring)
10. [Deployment checklist](#10-deployment-checklist)

---

## 1. Architecture overview

```
                 HTTPS                         HTTPS / internal
  ┌──────────┐   (browser)   ┌─────────────┐   ┌────────────────────┐
  │  Users   │ ────────────► │  Frontend   │   │     Backend        │
  │ (browser)│               │ Vercel /    │   │  FastAPI (Docker)  │
  └──────────┘               │ Netlify CDN │   │  uvicorn :8000     │
                             │  (static)   │   │  GET /api/health   │
                             └──────┬──────┘   │  POST /api/convert │
                                    │          │  GET /api/download │
                       /api/* proxy │  or      └─────────┬──────────┘
                       direct call  ▼                    │
                             VITE_API_BASE_URL ──────────┘
                                                temp_storage volume
```

Key backend endpoints:

| Method | Path                       | Purpose                                        |
| ------ | -------------------------- | ---------------------------------------------- |
| `POST` | `/api/convert`             | Upload + convert files (multipart/form-data)   |
| `GET`  | `/api/download/{result_id}`| Download converted markdown                    |
| `GET`  | `/api/health`              | System status, version, supported formats      |

The backend listens on port **8000** and stores temporary uploads/results in
`TEMP_STORAGE_PATH` (a Docker volume in container deployments).

---

## 2. Prerequisites

**Common**

- Git
- A backend container host and a frontend static host (accounts on Vercel/Netlify,
  or your own infrastructure)

**Frontend build**

- Node.js **20.x** (matches `NODE_VERSION` in `netlify.toml`)
- npm (bundled with Node)

**Backend build / run**

- Docker **24+** with the Docker Compose plugin, **or** Python **3.11** for a
  non-containerized run
- (Optional) Azure AI credentials if you want cloud-enhanced conversion

---

## 3. Local development

### Backend (Python)

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env   # then edit .env as needed
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Verify it is up:

```powershell
curl http://localhost:8000/api/health
```

### Backend (Docker Compose)

From the **workspace root** (the root `docker-compose.yml` builds `./backend`):

```powershell
docker compose up --build
```

This builds `markitdown-backend:latest`, exposes the API on
`http://localhost:8000`, mounts a named `temp_storage` volume, and enables the
container health check.

### Frontend (Vite dev server)

```powershell
cd frontend
npm install
npm run dev
```

The dev server reads `frontend/.env.development`, which defaults
`VITE_API_BASE_URL` to `http://localhost:8000` — matching the local backend.
The backend's default `CORS_ORIGINS` already allows the Vite dev origins
(`http://localhost:3000` and `http://localhost:5173`).

---

## 4. Backend deployment (Docker)

The backend ships with a production-ready [`backend/Dockerfile`](./backend/Dockerfile):

- Based on `python:3.11-slim`
- Installs `curl` (for the health check) and `libmagic1` (magic-bytes MIME detection)
- Runs as a **non-root** user (`appuser`, uid 10001)
- Exposes port **8000**
- Declares a `HEALTHCHECK` that probes `GET /api/health`
- Starts with `uvicorn app.main:app --host 0.0.0.0 --port 8000`

### 4.1 Build and run with plain Docker

```powershell
cd backend
docker build -t markitdown-backend:latest .

docker run -d --name markitdown-backend `
  -p 8000:8000 `
  -e MAX_FILE_SIZE=52428800 `
  -e CONVERSION_TIMEOUT=30 `
  -e MAX_CONCURRENT_CONVERSIONS=5 `
  -e TEMP_STORAGE_PATH=/app/temp `
  -e RESULT_RETENTION_HOURS=1 `
  -e CORS_ORIGINS=https://your-frontend.example.com `
  -e RATE_LIMIT_PER_HOUR=100 `
  -e LOG_LEVEL=INFO `
  -e LOG_FORMAT=json `
  -v markitdown_temp:/app/temp `
  markitdown-backend:latest
```

> `TEMP_STORAGE_PATH` must point at the mounted volume target (`/app/temp`).
> Keeping uploads on a volume (not the container layer) avoids filling the
> writable layer and lets the cleanup process reclaim space.

### 4.2 Run with Docker Compose

The root [`docker-compose.yml`](./docker-compose.yml) is the recommended way to
run the backend with sensible defaults and a persistent volume:

```powershell
docker compose up --build -d
docker compose logs -f backend
docker compose ps          # STATUS shows (healthy) once the health check passes
```

Override environment values for your environment either by editing the
`environment:` block or by supplying a root `.env` file. Azure credentials are
read from the shell/`.env` (`AZURE_DI_*`, `AZURE_CU_*`) and default to empty
(cloud conversion disabled).

### 4.3 Deploy to a managed container host

The same image runs on any container platform. General steps:

1. **Build and push** to a registry:

   ```powershell
   docker build -t <registry>/markitdown-backend:<tag> ./backend
   docker push <registry>/markitdown-backend:<tag>
   ```

2. **Create the service** with:
   - Container port **8000**
   - Environment variables from the [reference table](#backend-environment-variables)
     (at minimum set `CORS_ORIGINS` to your frontend origin)
   - A **writable, persistent volume** mounted at `TEMP_STORAGE_PATH`
     (`/app/temp`). On ephemeral platforms (e.g. Cloud Run) the local filesystem
     is fine for short-lived results, but results do not survive instance
     recycling — that matches the 1-hour retention model.
   - A **health/readiness probe** hitting `GET /api/health` (see
     [section 9](#9-health-checks-and-monitoring)).

**Google Cloud Run example:**

```powershell
gcloud run deploy markitdown-backend `
  --image <registry>/markitdown-backend:<tag> `
  --port 8000 `
  --allow-unauthenticated `
  --set-env-vars "CORS_ORIGINS=https://your-frontend.example.com,LOG_FORMAT=json,RESULT_RETENTION_HOURS=1"
```

Cloud Run automatically probes the container port; for a dedicated check point
its startup/liveness probe at `/api/health`.

**AWS ECS / Fargate:** set the task definition `portMappings` to `8000`, define
the env vars in `containerDefinitions`, and configure the container health check
command to `CMD-SHELL, curl --fail --silent http://localhost:8000/api/health || exit 1`.

---

## 5. Frontend deployment (Vercel / Netlify)

The frontend is a static Vite build. Only variables prefixed with `VITE_` are
embedded into the client bundle, and **they are baked in at build time** — so
they must be set as build-time environment variables on the host.

Build output: `npm run build` → `dist/`.

### 5.1 Vercel

The repo includes [`frontend/vercel.json`](./frontend/vercel.json) configured for
the Vite framework with:

- `buildCommand: npm run build`, `outputDirectory: dist`
- SPA rewrite (all routes → `/index.html`)
- An `/api/:path*` rewrite that proxies to a backend origin
- Security headers (HSTS, CSP, X-Frame-Options, etc.)

Steps:

1. Import the project in Vercel and set the **Root Directory** to `frontend`.
2. Vercel auto-detects Vite; confirm build command `npm run build` and output `dist`.
3. Set build-time **Environment Variables** (Project → Settings → Environment Variables):
   - `VITE_API_BASE_URL` — your backend origin (e.g. `https://api.markitdown.example.com`)
   - `VITE_MAX_FILE_SIZE`, `VITE_APP_NAME`, `VITE_APP_ENV` as needed
4. **Important — update the proxy target:** in `vercel.json`, change the
   `/api/:path*` `destination` and the `connect-src` host in the CSP from
   `https://api.markitdown.example.com` to your real backend origin. The CSP
   `connect-src` must include whatever origin the browser actually calls.
5. Deploy.

> Choose **one** integration pattern: either proxy `/api/*` via `vercel.json`
> **and** set `VITE_API_BASE_URL=/` (same-origin), **or** call the backend
> directly via an absolute `VITE_API_BASE_URL` (and rely on CORS). See
> [section 6](#6-wiring-the-frontend-to-the-backend).

### 5.2 Netlify

The repo includes [`frontend/netlify.toml`](./frontend/netlify.toml) with:

- `command = "npm run build"`, `publish = "dist"`, `NODE_VERSION = "20"`
- An `/api/*` redirect (status 200, `force = true`) that proxies to the backend
- SPA fallback redirect to `/index.html`
- The same security headers as Vercel

Steps:

1. Create a new site from the repo and set the **Base directory** to `frontend`
   (so `netlify.toml` and `package.json` are found).
2. Build settings come from `netlify.toml` (command `npm run build`, publish `dist`).
3. Set build-time environment variables (Site settings → Environment variables):
   `VITE_API_BASE_URL`, `VITE_MAX_FILE_SIZE`, `VITE_APP_NAME`, `VITE_APP_ENV`.
4. **Update the proxy target** in `netlify.toml`: change the `[[redirects]]` `to`
   value and the CSP `connect-src` host to your real backend origin.
5. Deploy.

### 5.3 Build locally / other static hosts

```powershell
cd frontend
npm ci
npm run build         # reads .env.production by default
# upload the contents of dist/ to any static host or CDN
```

`frontend/.env.production` is used for production builds; update its
`VITE_API_BASE_URL` to your backend origin before building, or override it via
the host's build-time env vars.

---

## 6. Wiring the frontend to the backend

There are two supported patterns. Pick one and keep it consistent.

### Pattern A — Same-origin proxy (recommended)

The static host proxies `/api/*` to the backend, so the browser only ever makes
**same-origin** requests. This avoids CORS in the browser entirely.

- Keep the `vercel.json` rewrite / `netlify.toml` redirect, pointing `to` your
  backend origin.
- Set `VITE_API_BASE_URL=/` (or leave the app's API calls relative to `/api`).
- The CSP `connect-src 'self'` already permits same-origin calls; you can drop the
  explicit backend host from `connect-src` in this pattern.

### Pattern B — Direct cross-origin calls

The browser calls the backend origin directly.

- Set `VITE_API_BASE_URL=https://api.markitdown.example.com` (your backend origin).
- Add that origin to the CSP `connect-src` in `vercel.json` / `netlify.toml`.
- Add your **frontend** origin to the backend's `CORS_ORIGINS` (see below).

> Because `VITE_*` values are compiled into the bundle at build time, changing
> `VITE_API_BASE_URL` requires a **rebuild/redeploy** of the frontend — it cannot
> be changed at runtime.

---

## 7. CORS configuration

CORS is enforced by the **backend** via the `CORS_ORIGINS` environment variable
(comma-separated, exact-match origins). The backend splits this string and uses
it as the allow-list; defaults are the local dev origins
`http://localhost:3000,http://localhost:5173`.

Rules of thumb:

- **Pattern A (proxy):** the browser sees same-origin requests, so CORS is not
  triggered in the browser. Still set `CORS_ORIGINS` to your frontend origin as
  defense in depth.
- **Pattern B (direct):** you **must** add your deployed frontend origin, e.g.
  `CORS_ORIGINS=https://app.example.com`. Use the scheme + host + port exactly as
  the browser sends it; do not include a trailing slash or path.
- Provide multiple origins comma-separated:
  `CORS_ORIGINS=https://app.example.com,https://staging.example.com`.

Example (Docker):

```powershell
docker run -e CORS_ORIGINS=https://app.example.com markitdown-backend:latest
```

---

## 8. Environment variable reference

### Backend environment variables

Source of truth: [`backend/.env.example`](./backend/.env.example) and
[`backend/app/config.py`](./backend/app/config.py). Copy `.env.example` to `.env`
for local runs, or set these in your container host.

| Variable                     | Default                                          | Range / format        | Description |
| ---------------------------- | ------------------------------------------------ | --------------------- | ----------- |
| `MAX_FILE_SIZE`              | `52428800` (50 MB)                               | bytes                 | Maximum accepted upload size. |
| `CONVERSION_TIMEOUT`         | `30`                                             | `1`–`300` seconds     | Max time for a single conversion before it is aborted. |
| `MAX_CONCURRENT_CONVERSIONS` | `5`                                              | `1`–`20`              | Simultaneous conversions allowed. |
| `TEMP_STORAGE_PATH`          | `./temp` (local) / `/app/temp` (container)       | path                  | Where uploads and results are written. Mount a volume here in containers. |
| `RESULT_RETENTION_HOURS`     | `1`                                              | `1`–`24` hours        | How long converted results are kept before cleanup. |
| `CORS_ORIGINS`               | `http://localhost:3000,http://localhost:5173`    | comma-separated origins | Allowed frontend origins (see [CORS](#7-cors-configuration)). |
| `RATE_LIMIT_PER_HOUR`        | `100`                                            | `>= 1`                | Max requests per client IP per hour. |
| `AZURE_DI_ENDPOINT`          | _(empty)_                                        | URL                   | Azure Document Intelligence endpoint. Enables `azure_di` when set with its key. |
| `AZURE_DI_KEY`               | _(empty)_                                        | secret                | Azure Document Intelligence API key. |
| `AZURE_CU_ENDPOINT`          | _(empty)_                                        | URL                   | Azure Content Understanding endpoint. Enables `azure_cu` when set with its key. |
| `AZURE_CU_KEY`               | _(empty)_                                        | secret                | Azure Content Understanding API key. |
| `APP_NAME`                   | `MarkItDown Website API`                         | string                | App name reported by the health endpoint. |
| `APP_VERSION`                | `0.1.0`                                          | string                | Version reported by the health endpoint. |
| `DEBUG`                      | `false`                                          | `true`/`false`        | Verbose debug mode. Keep `false` in production. |
| `LOG_LEVEL`                  | `INFO`                                           | `DEBUG`/`INFO`/...    | Logging verbosity (read by `app/utils/logging_config.py`). |
| `LOG_FORMAT`                 | `text`                                           | `text`/`json`         | Log output format. Use `json` for structured log ingestion. |

> **Cloud services:** an Azure integration is enabled only when **both** the
> endpoint and key for that service are set. Leave them empty to run fully local.
> Treat the keys as secrets — inject them via your platform's secret manager,
> never commit them.

### Frontend environment variables

Source of truth: [`frontend/.env.example`](./frontend/.env.example). Only
`VITE_`-prefixed variables reach the client, and they are **baked in at build
time**.

| Variable             | Example                               | Description |
| -------------------- | ------------------------------------- | ----------- |
| `VITE_API_BASE_URL`  | `https://api.markitdown.example.com` or `/` | Base URL the app uses for API calls. Use `/` with the proxy pattern. |
| `VITE_MAX_FILE_SIZE` | `52428800`                            | Client-side upload size limit in bytes (should match backend `MAX_FILE_SIZE`). |
| `VITE_APP_NAME`      | `MarkItDown`                          | Display name. |
| `VITE_APP_ENV`       | `production`                          | Environment label (`development` / `production`). |
| `VITE_BASE_PATH`     | `/`                                   | Public base path. Use `/` for root deploys; `/subpath/` when hosted under a path. |

---

## 9. Health checks and monitoring

### The health endpoint

`GET /api/health` returns a JSON `HealthResponse`:

```json
{
  "status": "healthy",
  "version": "0.1.0",
  "supported_formats": ["PDF", "Word (DOC, DOCX)", "..."],
  "markitdown_available": true,
  "resources": {
    "disk_total_bytes": 0,
    "disk_free_bytes": 0,
    "disk_percent_used": 12.3,
    "memory_total_bytes": 0,
    "memory_available_bytes": 0,
    "memory_percent_used": 41.2
  },
  "metrics": {
    "total_conversions": 0,
    "successful_conversions": 0,
    "failed_conversions": 0,
    "average_processing_time_seconds": 0.0,
    "total_processing_time_seconds": 0.0
  }
}
```

`status` can be:

| Status        | Meaning | Suggested probe behavior |
| ------------- | ------- | ------------------------ |
| `healthy`     | Library available, resources under threshold | Pass |
| `degraded`    | Disk **or** memory usage ≥ 90% | Pass but alert |
| `unavailable` | MarkItDown library cannot be imported | Fail / restart |

The endpoint always responds `HTTP 200`; the operational state is in the `status`
field, so monitoring should parse the body rather than rely on status code alone.
Memory metrics are populated only when `psutil` is installed in the image
(optional dependency); disk metrics use the standard library and are always
attempted.

### Container health check

Both the [`Dockerfile`](./backend/Dockerfile) and [`docker-compose.yml`](./docker-compose.yml)
define a health check that probes the endpoint:

```
curl --fail --silent http://localhost:8000/api/health
interval: 30s   timeout: 5s   start-period: 20s   retries: 3
```

- `docker compose ps` shows `(healthy)` once it passes.
- The `start-period` (20s) gives the app time to boot before failures count.

### Probes on managed platforms

Point the platform's **liveness/readiness/startup** probe at
`GET /api/health` on port `8000`:

- **Kubernetes:** `httpGet: { path: /api/health, port: 8000 }` for liveness and
  readiness probes (add `initialDelaySeconds: ~20`).
- **Cloud Run:** configure a startup/liveness HTTP probe at `/api/health`.
- **ECS/Fargate:** container health check
  `CMD-SHELL, curl --fail --silent http://localhost:8000/api/health || exit 1`.

### Logging and monitoring

- Set `LOG_FORMAT=json` in production so logs can be ingested by a structured log
  aggregator (CloudWatch, Stackdriver, ELK, Loki, etc.).
- The health handler emits a structured `monitoring health_summary ...` log line
  on every request, including `status`, `markitdown_available`,
  `disk_percent_used`, `memory_percent_used`, and conversion counters — use this
  to build dashboards/alerts.
- Set `LOG_LEVEL=INFO` (or `DEBUG` only when troubleshooting).
- Recommended alerts:
  - `status != "healthy"` for N consecutive checks
  - rising `failed_conversions` relative to `total_conversions`
  - `disk_percent_used` / `memory_percent_used` approaching the 90% degraded threshold

### Frontend status indicator

The frontend polls `/api/health` and surfaces a status indicator, so a degraded or
unavailable backend is visible to users without extra tooling.

---

## 10. Deployment checklist

Backend:

- [ ] Image built and pushed to your registry
- [ ] Container port `8000` exposed; HTTPS/TLS terminated in front of it
- [ ] Persistent volume mounted at `TEMP_STORAGE_PATH` (`/app/temp`)
- [ ] `CORS_ORIGINS` set to the real frontend origin(s)
- [ ] `LOG_FORMAT=json`, `LOG_LEVEL=INFO`, `DEBUG=false`
- [ ] Azure keys injected via secrets (only if using cloud conversion)
- [ ] Health probe configured against `GET /api/health`

Frontend:

- [ ] `VITE_API_BASE_URL` set for the chosen integration pattern (proxy vs direct)
- [ ] `vercel.json` / `netlify.toml` proxy `to` target updated to the backend origin
- [ ] CSP `connect-src` includes the origin the browser actually calls
- [ ] Build succeeds (`npm run build`) and `dist/` is published
- [ ] End-to-end smoke test: upload → convert → preview → download
