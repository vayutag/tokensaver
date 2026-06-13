# Hosting TokenSaver on Hostinger

This guide walks through deploying **TokenSaver** on Hostinger. The app has two
parts that are deployed differently:

| Part | What it is | Where it runs on Hostinger |
| ---- | ---------- | -------------------------- |
| **Frontend** | Static Vite/React build (`frontend/dist`) | Shared **Web Hosting** (hPanel) **or** the VPS |
| **Backend** | Python FastAPI server (a long-running process) | **VPS Hosting** (required) |

> **Important — which plan you need.** Hostinger **shared Web Hosting cannot run
> a persistent Python/FastAPI server.** It serves static files and PHP only. So:
> - The **frontend** can live on shared Web Hosting *or* the VPS.
> - The **backend must run on a Hostinger VPS** (KVM 1 or higher). If you only
>   have shared hosting, you cannot run the conversion API — you'd need a VPS,
>   or host the backend elsewhere (Render, Railway, Fly.io, a cloud VM).
>
> The simplest, most reliable setup is **everything on one Hostinger VPS**
> (Option A below). Option B mixes shared hosting (frontend) + VPS (backend).

---

## Table of contents

1. [Prerequisites](#1-prerequisites)
2. [Option A — Full stack on one Hostinger VPS (recommended)](#2-option-a--full-stack-on-one-hostinger-vps-recommended)
3. [Option B — Frontend on shared Web Hosting + backend on VPS](#3-option-b--frontend-on-shared-web-hosting--backend-on-vps)
4. [Pointing your domain (hPanel DNS)](#4-pointing-your-domain-hpanel-dns)
5. [HTTPS / SSL](#5-https--ssl)
6. [Updating the site later](#6-updating-the-site-later)
7. [Troubleshooting](#7-troubleshooting)

---

## 1. Prerequisites

- A Hostinger account with either a **VPS plan** (KVM 1+ recommended; large file
  conversions need RAM) or a **Web Hosting plan** (frontend only).
- A domain you control (managed in hPanel, or pointed to Hostinger nameservers).
- The project source on your machine (this repo) with:
  - **Node.js 20+** and **npm** (to build the frontend)
  - The backend folder (`backend/`) with its `Dockerfile` and `requirements.txt`
- Basic SSH comfort for the VPS steps. Hostinger gives you SSH access and a
  browser terminal from hPanel → VPS → **SSH Access** / **Browser terminal**.

---

## 2. Option A — Full stack on one Hostinger VPS (recommended)

This runs the backend API and serves the frontend from a single VPS using
**Docker** (already configured in this repo) plus **Nginx** as a reverse proxy.

### 2.1 Create and access the VPS

1. In hPanel, buy/open a **VPS** plan. When prompted for an OS template, pick
   **Ubuntu 22.04** (optionally the "Ubuntu + Docker" template to skip install).
2. Note the VPS **IP address** and set the root password.
3. Connect via SSH from your machine:
   ```bash
   ssh root@YOUR_VPS_IP
   ```

### 2.2 Install Docker (skip if you chose the Docker template)

```bash
apt update && apt upgrade -y
curl -fsSL https://get.docker.com | sh
docker --version
```

### 2.3 Get the project onto the VPS

Either clone from your Git remote, or upload the folder with `scp`.

```bash
# On the VPS:
mkdir -p /opt/tokensaver && cd /opt/tokensaver
# then clone OR upload (see below)
git clone YOUR_REPO_URL .
```

If you are not using Git, from your **local machine** upload the project:

```bash
scp -r "C:\Users\Tanuj\Downloads\claude_tokn" root@YOUR_VPS_IP:/opt/tokensaver
```

### 2.4 Run the backend with Docker

The repo already includes `backend/Dockerfile` and `docker-compose.yml`.

```bash
cd /opt/tokensaver
docker compose up --build -d
docker compose ps          # backend should show (healthy) after ~20s
curl http://localhost:8000/api/health
```

Set the backend env when you run it. At minimum, lock CORS to your domain and
keep the 5GB cap (or change it). Create `/opt/tokensaver/.env` or edit the
`environment:` block in `docker-compose.yml`:

```env
CORS_ORIGINS=https://yourdomain.com
MAX_FILE_SIZE=5368709120
CONVERSION_TIMEOUT=30
REQUEST_TIMEOUT=120
LOG_FORMAT=json
LOG_LEVEL=INFO
```

> The backend listens on port **8000** inside the VPS. We will NOT expose 8000
> publicly — Nginx will proxy to it.

### 2.5 Build the frontend

Build on your **local machine** (Node 20+), pointing the app at your domain's
`/api` path (same-origin proxy pattern — simplest, no browser CORS):

`frontend/.env.production`
```env
VITE_API_BASE_URL=/
VITE_MAX_FILE_SIZE=5368709120
VITE_APP_NAME=TokenSaver
VITE_APP_ENV=production
```

```bash
cd frontend
npm ci
npm run build      # outputs to frontend/dist
```

Upload the built files to the VPS:

```bash
scp -r frontend/dist root@YOUR_VPS_IP:/opt/tokensaver/site
```

(You can also build on the VPS if Node is installed there.)

### 2.6 Install and configure Nginx

```bash
apt install -y nginx
```

Create `/etc/nginx/sites-available/tokensaver`:

```nginx
server {
    listen 80;
    server_name yourdomain.com www.yourdomain.com;

    # Allow large uploads (matches the 5GB app cap; raise/lower as needed).
    client_max_body_size 5G;

    # Serve the built frontend (SPA).
    root /opt/tokensaver/site;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    # Proxy API calls to the FastAPI backend container.
    location /api/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Large/slow conversions: give them time and don't buffer huge bodies.
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
        proxy_request_buffering off;
    }
}
```

Enable it and reload:

```bash
ln -s /etc/nginx/sites-available/tokensaver /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx
```

Now visiting `http://yourdomain.com` serves the frontend, and `/api/*` reaches
the backend. Continue to [DNS](#4-pointing-your-domain-hpanel-dns) and
[SSL](#5-https--ssl).

---

## 3. Option B — Frontend on shared Web Hosting + backend on VPS

Use this if you want to keep your existing Hostinger **Web Hosting** plan for the
site and run only the backend on a VPS.

### 3.1 Backend (VPS)

Follow **2.1–2.4** to run the backend on a VPS. Because the frontend will be on
a **different origin** (your shared-hosting domain) than the backend, you must:

1. Expose the backend over HTTPS on its own subdomain, e.g.
   `https://api.yourdomain.com` (set up Nginx + SSL on the VPS as in sections
   2.6 and 5, with `server_name api.yourdomain.com` and the `/api/` proxy).
2. Set the backend `CORS_ORIGINS` to your frontend origin:
   ```env
   CORS_ORIGINS=https://yourdomain.com
   ```

### 3.2 Frontend (shared Web Hosting via hPanel)

1. Build locally pointing at the backend subdomain (direct cross-origin):

   `frontend/.env.production`
   ```env
   VITE_API_BASE_URL=https://api.yourdomain.com
   VITE_MAX_FILE_SIZE=5368709120
   VITE_APP_NAME=TokenSaver
   VITE_APP_ENV=production
   ```
   ```bash
   cd frontend
   npm ci
   npm run build
   ```

2. In hPanel → **Files → File Manager**, open `public_html` for your domain.
3. Upload **the contents of `frontend/dist`** (not the `dist` folder itself) into
   `public_html`. The quickest way: zip the contents of `dist`, upload the zip,
   and use File Manager's **Extract**.
4. **SPA routing fix (important).** This is a single-page app, so deep links like
   `/convert` and `/docs` must fall back to `index.html`. Create a file named
   **`.htaccess`** in `public_html` with:
   ```apache
   <IfModule mod_rewrite.c>
     RewriteEngine On
     RewriteBase /
     RewriteRule ^index\.html$ - [L]
     RewriteCond %{REQUEST_FILENAME} !-f
     RewriteCond %{REQUEST_FILENAME} !-d
     RewriteRule . /index.html [L]
   </IfModule>
   ```
   Without this, refreshing on `/convert` returns a 404.

> Shared-hosting upload limits (PHP `upload_max_filesize`) do **not** affect
> TokenSaver uploads here, because files are sent from the browser straight to
> the backend API on the VPS — not through the shared host. The relevant limit
> is the VPS Nginx `client_max_body_size` (set to `5G` in section 2.6).

---

## 4. Pointing your domain (hPanel DNS)

In hPanel → **Domains → DNS / Nameservers**:

- **Option A (all on VPS):** add an **A record** for `@` (and `www`) pointing to
  your **VPS IP**.
- **Option B (split):**
  - Frontend on shared hosting: keep the domain's default A record to the shared
    server (Hostinger sets this automatically when the domain is on the plan).
  - Backend subdomain: add an **A record** for `api` → your **VPS IP**.

DNS changes can take from a few minutes up to a few hours to propagate.

---

## 5. HTTPS / SSL

Always serve over HTTPS.

- **Shared Web Hosting (Option B frontend):** hPanel → **Security → SSL**. Enable
  the free Let's Encrypt SSL for your domain; Hostinger auto-renews it.
- **VPS (backend, or Option A full stack):** use Certbot with Nginx:
  ```bash
  apt install -y certbot python3-certbot-nginx
  # Option A:
  certbot --nginx -d yourdomain.com -d www.yourdomain.com
  # Option B backend subdomain:
  certbot --nginx -d api.yourdomain.com
  ```
  Certbot edits the Nginx config to add HTTPS and sets up auto-renewal. After it
  finishes, confirm `https://yourdomain.com` loads with a valid certificate.

Once SSL is on, make sure the frontend talks to an `https://` API origin (or `/`
for the same-origin proxy) so the browser doesn't block mixed content.

---

## 6. Updating the site later

**Frontend changes:**
```bash
cd frontend
npm run build
# Option A: scp -r dist/* root@YOUR_VPS_IP:/opt/tokensaver/site/
# Option B: re-upload dist contents to public_html via File Manager
```

**Backend changes (VPS):**
```bash
cd /opt/tokensaver
git pull            # or re-upload
docker compose up --build -d
```

Service worker note: the frontend caches static assets. After deploying, a hard
refresh (Ctrl+F5) ensures you see the latest build immediately.

---

## 7. Troubleshooting

- **`/convert` or `/docs` shows 404 on refresh** — SPA fallback missing. On
  shared hosting add the `.htaccess` (section 3.2); on the VPS confirm the Nginx
  `try_files $uri $uri/ /index.html;` line.
- **Frontend loads but conversions fail / CORS error in console** — the backend
  origin is wrong or not allow-listed. Check `VITE_API_BASE_URL` in the build and
  `CORS_ORIGINS` on the backend. The same-origin proxy pattern (Option A,
  `VITE_API_BASE_URL=/`) avoids CORS entirely.
- **Large upload returns 413 (Request Entity Too Large)** — raise Nginx
  `client_max_body_size` on the VPS (section 2.6).
- **Large upload times out (502/504)** — increase Nginx `proxy_read_timeout` /
  `proxy_send_timeout`, and the backend `CONVERSION_TIMEOUT` / `REQUEST_TIMEOUT`.
  Very large files also need enough VPS RAM (the backend reads the upload into
  memory).
- **Backend container not healthy** — `docker compose logs -f backend` on the
  VPS to see the error; confirm port 8000 is free and the image built.
- **Can't run the backend at all** — you're likely on shared hosting only.
  Shared hosting cannot run FastAPI; you need a VPS (or an external host for the
  backend).

---

### Quick reference

| Setting | Value |
| ------- | ----- |
| Backend internal port | `8000` |
| Frontend build output | `frontend/dist` |
| Shared-hosting web root | `public_html` |
| Suggested VPS path | `/opt/tokensaver` |
| Health check | `GET /api/health` |
| Max upload (app + Nginx) | `5GB` / `client_max_body_size 5G` |
