# Deploy TokenSaver on Render (free) — Step by step

This deploys **both** parts of TokenSaver on Render's free tier using the
included `render.yaml` Blueprint:

- **tokensaver-api** — the FastAPI backend (Docker)
- **tokensaver-web** — the React/Vite frontend (static site)

> **Free-tier reality check (read first):**
> - The **backend** free instance has **512 MB RAM** and **sleeps after ~15 min**
>   of inactivity (first request after idle takes ~30–60s to wake).
> - Because the backend loads each upload into memory, the **5 GB cap will crash
>   the free instance** on large files. For free hosting, set `MAX_FILE_SIZE` to
>   something small like `52428800` (50 MB). Use a paid instance or a VPS for big
>   files.
> - The **frontend** static site is free, fast (CDN), and never sleeps.

---

## Step 0 — What you need

- A **GitHub** (or GitLab) account.
- A free **Render** account → sign up at https://render.com (log in with GitHub
  to make connecting the repo easy).
- This project on your computer at `C:\Users\Tanuj\Downloads\claude_tokn`.
- **Git** installed (check with `git --version`).

---

## Step 1 — Put the project on GitHub

Render deploys from a Git repository, so the code must be on GitHub first.

1. Create a new **empty** repository on GitHub (e.g. `tokensaver`). Do **not**
   add a README/.gitignore there — the project already has files.
2. In a terminal, from the project root:

   ```powershell
   cd C:\Users\Tanuj\Downloads\claude_tokn
   git init
   git add .
   git commit -m "TokenSaver: initial commit"
   git branch -M main
   git remote add origin https://github.com/YOUR_USERNAME/tokensaver.git
   git push -u origin main
   ```

   Replace `YOUR_USERNAME` with your GitHub username. If prompted, sign in.

3. Refresh the repo page on GitHub — you should see the `frontend/`, `backend/`,
   and `render.yaml` files.

> Already using Git? Just commit and push; make sure `render.yaml` is in the
> repository root.

---

## Step 2 — Create the Blueprint on Render

1. Go to the Render dashboard → click **New +** (top right) → **Blueprint**.
2. **Connect your repository:** if this is your first time, click **Connect
   GitHub**, authorize Render, and select your `tokensaver` repo. Then click
   **Connect** next to it.
3. Render reads `render.yaml` and shows two services it will create:
   - `tokensaver-api` (web / Docker)
   - `tokensaver-web` (static site)
4. It will ask you to confirm/select the **free** plan and a **region** (pick one
   close to you, e.g. *Frankfurt* or *Oregon*). Use the **same region** for both.
5. The two env vars marked "set by you" (`CORS_ORIGINS` and `VITE_API_BASE_URL`)
   may show as blank — that's expected. **Leave them empty for now**; we fill
   them in Step 4 once we know the URLs. Click **Apply** / **Create Resources**.
6. Render starts building both services. The first backend build (Docker) takes a
   few minutes. You can watch the logs for each service.

---

## Step 3 — Find your two URLs

After the services are created, open each one from the dashboard and copy its
public URL (top of the service page):

- Backend → looks like `https://tokensaver-api.onrender.com`
- Frontend → looks like `https://tokensaver-web.onrender.com`

(Your exact names may have a random suffix — use whatever Render shows.)

---

## Step 4 — Connect the two services (the important part)

Right now the frontend doesn't know the backend's address, and the backend won't
accept requests from the frontend (CORS). Fix both:

### 4a. Tell the frontend where the API is

1. Open the **tokensaver-web** service → **Environment** (left menu).
2. Edit `VITE_API_BASE_URL` and set it to your **backend** URL (no trailing
   slash):
   ```
   https://tokensaver-api.onrender.com
   ```
3. Save. Because Vite bakes this value in at **build time**, you must rebuild:
   go to the top right → **Manual Deploy → Deploy latest commit** (or **Clear
   build cache & deploy**).

### 4b. Allow the frontend origin on the backend (CORS)

1. Open the **tokensaver-api** service → **Environment**.
2. Edit `CORS_ORIGINS` and set it to your **frontend** URL (no trailing slash):
   ```
   https://tokensaver-web.onrender.com
   ```
3. Save. The backend will restart automatically with the new setting.

### 4c. (Free tier) lower the upload cap so the backend doesn't crash

On the **tokensaver-api** → **Environment**, set:
```
MAX_FILE_SIZE = 52428800
```
(50 MB — safe for the 512 MB free instance). Save. Skip this if you upgraded to a
paid instance and want the full 5 GB.

---

## Step 5 — Test it

1. Open your **frontend** URL: `https://tokensaver-web.onrender.com`
2. The home page should load with the TokenSaver branding.
3. Go to **Converter**, drop a small file (e.g. a PDF or DOCX).
   - The **first** conversion after the backend has been idle takes ~30–60s
     (the free backend is waking up). Later ones are fast.
4. You should see the converted Markdown preview, the size-reduction banner, and
   be able to copy/download.

Quick backend check (optional): open
`https://tokensaver-api.onrender.com/api/health` — you should get a JSON
response with `"status": "healthy"`.

---

## Step 6 — (Optional) Use your own domain

You can point a custom domain at the **frontend** static site:

1. **tokensaver-web** → **Settings → Custom Domains → Add Custom Domain**, enter
   e.g. `tokensaver.yourdomain.com` (or your root domain).
2. Render shows a DNS record to add. In your domain provider (e.g. **Hostinger →
   hPanel → DNS**):
   - For a subdomain: add a **CNAME** record pointing to the value Render gives.
   - For a root/apex domain: follow Render's instructions (usually an `ALIAS`/`A`
     record).
3. Wait for DNS to propagate; Render issues a free SSL certificate automatically.
4. **Update CORS:** add the custom domain to the backend's `CORS_ORIGINS`
   (comma-separated), e.g.
   `https://tokensaver-web.onrender.com,https://tokensaver.yourdomain.com`, and
   if you want the app to call the API from the custom domain, that's already
   covered since `VITE_API_BASE_URL` points at the backend directly.

> You can also add a custom domain to the backend, but it's not required — the
> frontend talks to the `onrender.com` API URL just fine.

---

## Step 7 — Updating the site later

Every push to the `main` branch auto-deploys (both services have
`autoDeploy: true`):

```powershell
git add .
git commit -m "Describe your change"
git push
```

- Backend redeploys automatically.
- Frontend rebuilds automatically. If you changed `VITE_API_BASE_URL`, remember a
  static rebuild is needed (a push triggers it).

---

## Troubleshooting

- **Converter shows an error / "Unable to reach the server"** — the backend is
  asleep (wait ~60s and retry) or `VITE_API_BASE_URL` is wrong. Re-check Step 4a
  and that you redeployed the frontend after changing it.
- **CORS error in the browser console** — `CORS_ORIGINS` on the backend doesn't
  exactly match the frontend origin (scheme + host, no trailing slash). Fix in
  Step 4b.
- **Refreshing `/convert` or `/docs` shows "Not Found"** — the SPA rewrite isn't
  active. It's defined in `render.yaml` (`routes: rewrite /* → /index.html`); make
  sure you deployed via the Blueprint and didn't remove that block.
- **Backend deploy fails** — open tokensaver-api → **Logs**. Confirm the Docker
  build succeeded; the service must use **Root Directory `backend`** and the
  `backend/Dockerfile`.
- **Large file fails / backend restarts** — out of memory on the free instance.
  Lower `MAX_FILE_SIZE` (Step 4c) or upgrade the instance.
- **First request always slow** — expected on free tier (cold start). Upgrade to
  a paid instance to keep it always on.

---

## Quick reference

| Item | Value |
| ---- | ----- |
| Blueprint file | `render.yaml` (repo root) |
| Backend service | `tokensaver-api` (Docker, rootDir `backend`) |
| Frontend service | `tokensaver-web` (static, rootDir `frontend`, publish `dist`) |
| Set on frontend | `VITE_API_BASE_URL` = backend URL |
| Set on backend | `CORS_ORIGINS` = frontend URL |
| Free-tier upload cap | set `MAX_FILE_SIZE=52428800` (50 MB) |
| Health check | `GET /api/health` |
