# ClassDex — Environment Variable Inventory

This document lists **every environment variable** read by `classdex-backend` and `classdex-frontend`, using **names and placeholder examples only**. Never commit real secrets, passwords, API keys, or production connection strings to Git or documentation.

> **Important (`VITE_` Frontend Variables):** Variables prefixed with `VITE_` are compiled directly into the public browser JavaScript bundle by Vite **at build time**.
> - Never store secrets in any `VITE_` variable.
> - Changing any `VITE_` variable in Vercel has **no effect** until you trigger a fresh Vercel **Redeploy** (rebuild).

---

## 1. Environment Variables Table

| Variable | Service | Purpose | Secret? | Required in Prod? | Example Placeholder | Where Set |
|---|---|---|---|---|---|---|
| `NODE_ENV` | Backend (`classdex-backend`) | Enables production security checks, `cookie.secure: true`, HSTS headers, DB session auto-pruning, and blocks `/__e2e/*` and dev fallbacks | No | Yes (`production`) | `production` | Render → Environment |
| `PORT` | Backend (`classdex-backend`) | HTTP port bound on `0.0.0.0` (fallback `5000` locally) | No | Auto-provided by Render | `10000` | Render (automatic) |
| `TRUST_PROXY` | Backend (`classdex-backend`) | Express `trust proxy` hop count (`1` for Render reverse proxy) so `req.ip` rate limiters and `X-Forwarded-Proto: https` session cookies work without spoofing | No | Yes (`1`) | `1` | Render → Environment |
| `DATABASE_URL` | Backend (`classdex-backend`) | Neon PostgreSQL pooled connection string used by Prisma (`PrismaPg` + `pg.Pool`) and `connect-pg-simple` session store. *(One-time `scripts/apply-schema.js` runs with the direct non-pooled string.)* | **Yes** | Yes | `postgresql://USER:PASSWORD@ep-xxxxxxxx-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=verify-full` | Render → Environment (Secret) |
| `SESSION_SECRET` | Backend (`classdex-backend`) | Signs `classdex.sid` Express session cookies (`>= 32` characters, non-default, freshly generated) | **Yes** | Yes | `<generate-with-crypto.randomBytes(48).toString('hex')>` | Render → Environment (Secret) |
| `FRONTEND_ORIGIN` | Backend (`classdex-backend`) | Exact allowed browser origin(s) for CORS with `credentials: true` | No | Yes | `https://classdex.me` | Render → Environment |
| `APP_BASE_URL` | Backend (`classdex-backend`) | Canonical frontend base URL used in verification and password-reset email links | No | Yes | `https://classdex.me` | Render → Environment |
| `FRONTEND_URL` | Backend (`classdex-backend`) | Optional legacy fallback alias for `APP_BASE_URL` | No | No (covered by `APP_BASE_URL`) | `https://classdex.me` | Render (optional) |
| `CLIENT_URL` | Backend (`classdex-backend`) | Optional legacy fallback alias for `APP_BASE_URL` | No | No (covered by `APP_BASE_URL`) | `https://classdex.me` | Render (optional) |
| `EMAIL_MODE` | Backend (`classdex-backend`) | Selects mail transport (`resend` required in `NODE_ENV=production`; `log` and `stub` forbidden in prod) | No | Yes (`resend`) | `resend` | Render → Environment |
| `RESEND_API_KEY` | Backend (`classdex-backend`) | Resend API key for transactional email delivery | **Yes** | Yes | `re_xxxxxxxxxxxxxxxxxxxxxxxx` | Render → Environment (Secret) |
| `EMAIL_FROM` | Backend (`classdex-backend`) | Verified Resend sender identity on `classdex.me` (must not use `.local`) | No | Yes | `ClassDex <no-reply@classdex.me>` | Render → Environment |
| `RECAPTCHA_SECRET_KEY` | Backend (`classdex-backend`) | Google reCAPTCHA server-side verification key (production key only; Google's public test key is rejected at startup) | **Yes** | Yes | `6Lxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx` | Render → Environment (Secret) |
| `RESET_TOKEN_TTL_MINUTES` | Backend (`classdex-backend`) | Password reset token expiration window in minutes | No | No (defaults to `30`) | `30` | Render (optional) |
| `VERIFY_TOKEN_TTL_HOURS` | Backend (`classdex-backend`) | Email verification token expiration window in hours | No | No (defaults to `24`) | `24` | Render (optional) |
| `VERIFY_RESEND_COOLDOWN_SECONDS` | Backend (`classdex-backend`) | Cooldown seconds between verification email resend requests per user | No | No (defaults to `60`) | `60` | Render (optional) |
| `VITE_API_BASE_URL` | Frontend (`classdex-frontend`) | Production API origin without trailing `/api` (`api.js` and `Avatar.jsx`; unset falls back to `/api` for Vite dev proxy) | No | Yes | `https://api.classdex.me` | Vercel → Environment Variables (Production) |
| `VITE_RECAPTCHA_SITE_KEY` | Frontend (`classdex-frontend`) | Public Google reCAPTCHA v2 site key (production key only; Google's public test site key fails `vite build` in production mode) | No | Yes | `6Lxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx` | Vercel → Environment Variables (Production) |
| `VITE_CLOUDINARY_CLOUD_NAME` | Frontend (`classdex-frontend`) | Public Cloudinary cloud name for client-side unsigned profile photo uploads | No | Yes | `your-cloudinary-cloud-name` | Vercel → Environment Variables (Production) |
| `VITE_CLOUDINARY_UPLOAD_PRESET` | Frontend (`classdex-frontend`) | Public Cloudinary unsigned upload preset name (restricted to image formats, max 5 MB, dedicated folder) | No | Yes | `classdex_profile_photos` | Vercel → Environment Variables (Production) |

---

## 2. Notes on Architecture, Secrets, & Persistence

- **Single Backend Instance (`SEC-22`):** Render must run **exactly `1` instance** (`Express-rate-limit` counters and verification resend cooldowns remain in-memory).
- **Session Storage (`SEC-24`):** Express sessions (`classdex.sid`, `httpOnly: true`, `sameSite: "lax"`, `secure: true` in production) persist in the Neon PostgreSQL `"session"` table via `connect-pg-simple`, sharing the `pg.Pool` created in `classdex-backend/db.js`. The `"session"` table is created cleanly by migration `20261112010000_add_session_table` via `scripts/apply-schema.js`.
- **Fresh Production Secrets:** Every secret (`DATABASE_URL`, `SESSION_SECRET`, `RESEND_API_KEY`, `RECAPTCHA_SECRET_KEY`) must be newly generated or provisioned for production—never reuse development or test environment secrets.
