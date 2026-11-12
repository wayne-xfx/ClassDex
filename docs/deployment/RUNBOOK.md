# ClassDex — Operations & Recovery Runbook

**Frontend:** `https://classdex.me` (Vercel, project `class-dex`)  
**Backend API:** `https://api.classdex.me` (Render, service `classdex-api`, Free plan, `1` instance, Singapore)  
**Database:** Neon PostgreSQL (`classdex-prod` / `ep-still-firefly-ao1zyh81`, `ap-southeast-1`)

---

## 1. Viewing Logs & Retention

- **Backend Logs (Render):**
  - Open **Render Dashboard** → `classdex-api` → **Logs** (left sidebar).
  - **Retention:** **7 days** on Render Free / Hobby workspace plans.
  - **What is logged:** Startup line (`0.0.0.0:PORT`, `NODE_ENV`, Neon DB hostname only), errors, and one redacted HTTP summary per request (`METHOD /sanitized-path -> STATUS (duration ms)` with query strings stripped and token path segments masked). Zero passwords, cookies, tokens, connection strings, or student PII.
- **Frontend Logs (Vercel):**
  - Open **Vercel Dashboard** → `class-dex` → **Deployments** (click any deployment for build logs) or **Logs** for edge requests.

---

## 2. Triggering & Rolling Back Deployments

### Standard Deploy (Push to `main`)
Both Vercel (`classdex-frontend`) and Render (`classdex-api`) auto-deploy on commit to `main` on GitHub (`wayne-xfx/ClassDex`).

### Manual Redeploy (No Code Change)
- **Render:** `classdex-api` → **Manual Deploy** → **Deploy latest commit** *(or **Clear build cache & deploy** if dependencies/Prisma client need a clean rebuild)*.
- **Vercel:** `class-dex` → **Deployments** → click **`⋯`** on the latest Production deployment → **Redeploy**.

### Roll Back to a Previous Deployment
- **Render:** `classdex-api` → **Events** (or **Deploys**) → locate the last healthy deploy → click **Rollback to this deploy** (note: `connect-pg-simple` keeps active user sessions intact across restarts/rollbacks as long as `SESSION_SECRET` is unchanged).
- **Vercel:** `class-dex` → **Deployments** → locate the last healthy Production deployment → click **`⋯`** → **Instant Rollback** (or **Promote to Production**).

---

## 3. Database Point-in-Time Restore (Neon)

- **Restore Window:** **24 hours** on the current Neon plan (confirmed `2026-11-12` in Neon project settings).
- **Steps to Restore:**
  1. Open **Neon Console** → project `classdex-prod` → **Backup & Restore** (or **Branches** → **Restore**).
  2. Select the target timestamp within the **24-hour** history window (prefer restoring to a verification branch first to inspect data before replacing primary `production`, or confirm downtime window before restoring primary).
  3. Update `DATABASE_URL` in Render **only** if a new branch/endpoint hostname is promoted; restart `classdex-api`.
- **Schema Migrations Rule:** Production runs against the **pooled** URL (`-pooler...sslmode=verify-full`), while any one-time `node scripts/apply-schema.js` migration run **must** use the **direct (non-pooled)** Neon URL transiently in a terminal without saving it to `.env` or history.

---

## 4. Rotating Secrets & Updating Environment Variables

### Backend Secrets (Render → `classdex-api` → Environment)
1. **Generate fresh random secret (for `SESSION_SECRET`):**
   ```powershell
   node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
   ```
   *(Rotating `SESSION_SECRET` intentionally invalidates existing `classdex.sid` cookies so users must re-login.)*
2. Rotate upstream keys (`RESEND_API_KEY`, `RECAPTCHA_SECRET_KEY`, Neon `DATABASE_URL` password) in the provider dashboard first, update the value in **Render → Environment**, and click **Save Changes** (Render automatically redeploys with the new env).
3. Verify `https://api.classdex.me/api/status` returns `200` and inspect startup logs.

### Frontend Variables (`VITE_*` on Vercel → `class-dex` → Settings → Environment Variables)
> **Critical:** Every `VITE_*` variable (`VITE_API_BASE_URL`, `VITE_RECAPTCHA_SITE_KEY`, `VITE_CLOUDINARY_CLOUD_NAME`, `VITE_CLOUDINARY_UPLOAD_PRESET`) is **baked into the browser JS bundle at build time**.
1. Edit the variable under **Production** scope in Vercel.
2. Go to **Deployments** → **`⋯`** → **Redeploy** so Vite recompiles `dist/`. Without a fresh rebuild, the live site continues using the old compiled values.

---

## 5. Pre-Presentation Warm-Up (Render Free Tier)

- **Sleep Behavior:** Render Free web services automatically **spin down after 15 minutes** without inbound traffic. The first request after sleep incurs a **~30–60 second cold-start delay** before Express binds and answers.
- **No Unapproved Uptime Monitors:** Do not add an external third-party uptime pinger unless explicitly approved.
- **Warm-Up Procedure (~1–2 minutes before a live demo or class):**
  ```powershell
  curl.exe -sS https://api.classdex.me/api/status
  ```
  Wait for `{"message":"ClassDex Backend is running successfully!"}` (`200 OK`) before opening `https://classdex.me` in front of an audience.

---

## 6. Security Header Maintenance (`Strict-Transport-Security`)

- Vercel currently sets `Strict-Transport-Security: max-age=86400` (1 day) without `includeSubDomains` or `preload`.
- Once all subdomains under `classdex.me` are confirmed stable over HTTPS with zero rollback risk (e.g., after the first week in production), `max-age` in [vercel.json](file:///C:/Users/Acer/Desktop/ClassDex/classdex-frontend/vercel.json) can safely be raised to `31536000` (1 year).

---

## 7. Smoke-Test Data Status

Smoke-test accounts and class `IT-111/111L` (`FWG4QA`) created during `2026-11-12` validation were intentionally retained by project owner decision. Whenever ready to wipe them cleanly, use the **explicit ID-filtered SQL** and Cloudinary asset list documented in [`PRODUCTION_SMOKE_TEST.md`](file:///C:/Users/Acer/Desktop/ClassDex/docs/deployment/PRODUCTION_SMOKE_TEST.md#c-post-test-production-cleanup-explicit-target-list-only).
