# ClassDex

A web-based digital index card and classroom record-keeping system for instructors, featuring real-time attendance, activity and quiz scoring, weighted recitation card shuffling, spreadsheet export, and student record transparency.

Developed for the College of Computer Studies at Leyte Normal University (Tacloban City, Philippines) as a capstone web system for modern classroom record management.

## Live Deployments

| Service | Role | Live URL |
|---|---|---|
| **Web Application** | React SPA on Vercel | [https://classdex.me](https://classdex.me) |
| **API Service** | Node/Express backend on Render (Singapore) | [https://api.classdex.me](https://api.classdex.me) |
| **API Health Check** | System status endpoint | [https://api.classdex.me/api/status](https://api.classdex.me/api/status) |

> [!NOTE]
> The production API runs on Render's free tier, which spins down after 15 minutes of inactivity. The first request after an idle period may experience a 30–60 second cold-start delay while the backend wakes up.

---

## Feature Matrix

### Instructor (Faculty)

- **Account & Security:** Faculty registration with email verification via Resend, PostgreSQL-backed session authentication, and single-use password reset links.
- **Class Management:** Create classes with custom section names, course codes, course titles, structured meeting schedules (days/times), custom or auto-generated invite codes, and descriptions; archive and restore completed classes.
- **Student List Ingestion:** Add official roster entries manually, paste lists in bulk, download formatted `.xlsx` templates, or import `.xlsx` and `.csv` spreadsheets (up to 2 MB / 500 rows) with formula-injection neutralization and Philippine surname parsing (`shared/nameParser.js`).
- **Roster, Drop List & Join Flow:** Auto-generated 6-character join codes (or custom 3–20 character codes), direct shareable links (`/join/<code>`), and scannable/downloadable QR codes. Joins matching the 7-digit student ID on the Student List are auto-approved; non-roster joins enter **Pending Validation** with Approve/Decline actions and automated email notices. Removing previously scored students transitions them to a restorable **Drop List** without losing academic history.
- **Automated Absence Warnings:** Bell notification badge flagging students who reach or exceed 7 cumulative absences in a class.
- **Five Core Academic Modules:**
  1. *Attendance:* Manila-date daily attendance sessions marking **Present**, **Late** (with configurable grace period), or **Absent**.
  2. *Recitation:* Digital Card Shuffler filtering Present students, supporting pure random or participation-weighted picking, configurable 1–7 second shuffle durations, optional sound effects, and `prefers-reduced-motion` support.
  3. *Activities:* Per-session classroom activity creation, scoring, and editing with attendance-absence synchronization.
  4. *Projects:* Dedicated **Midterm** and **Finals** project score tracking.
  5. *Quizzes:* Quiz session management with configurable total items and draft-then-save score entry.
- **Digital Index Card:** Inspect individual student profiles, contact and emergency fields, profile photos, and class records on a flippable student index card.
- **Gradebook Matrix Exporting:** Download structured student-by-session matrices for Attendance, Recitation, Activities, Projects, Quizzes, and Dropped Students as Excel (`.xlsx`) workbooks or UTF-8 BOM `.csv` files.
- **UI/UX:** Responsive desktop/mobile layout with persistent light and dark themes.

### Student

- **Single Digital Index Card:** Reusable profile storing name, 7-digit student ID, program, section, contact details, birthdate, and Cloudinary-hosted profile photo.
- **One-Click Enrollment:** Join classes via invite code, direct invite link, or QR code scan.
- **View-Only Academic Dashboard:** Real-time, strictly isolated read-only view of personal attendance counts, recitation calls/scores, activity marks, project submissions, and quiz scores across enrolled classes.

---

## System Architecture

```mermaid
flowchart TD
  subgraph Clients
    Browser["Student & Faculty Browsers / Mobile"]
  end

  subgraph Cloud Infrastructure
    Vercel["Frontend Host (Vercel)<br/>React 19 + Vite SPA<br/>classdex.me"]
    Render["Backend Host (Render - Singapore)<br/>Express 5 REST API (Single Instance)<br/>api.classdex.me"]
    Neon[("Database (Neon Serverless PostgreSQL)<br/>Prisma Client + pg Pool")]
  end

  subgraph Third-Party Services
    Cloudinary["Cloudinary<br/>(Student Profile Photos)"]
    Resend["Resend<br/>(Transactional Emails)"]
    reCAPTCHA["Google reCAPTCHA v2<br/>(Abuse Prevention)"]
  end

  Browser -->|HTTPS| Vercel
  Browser -->|HTTPS API Requests / Cookies| Render
  Browser -->|Direct Image Upload| Cloudinary
  Vercel -->|Widget Challenge| reCAPTCHA
  Render -->|PostgreSQL Wire Protocol| Neon
  Render -->|REST API| Resend
  Render -->|Verify siteverify| reCAPTCHA
```

---

## Technology Stack

| Layer | Technology | Version / Tooling | Purpose |
|---|---|---|---|
| **Frontend** | React, Vite | React `19.2`, Vite `8.3`, React Router `7.18`, Tailwind CSS `4.3`, custom SVG sprite (`Icon.jsx`), `qrcode`, `oxlint` | Single Page Application, responsive UI, client-side routing, QR generation |
| **Backend** | Node.js, Express | Node.js (`>=20`, pinned `24.21.0`), Express `5.2`, Helmet `8.3`, `express-rate-limit` `8.7`, ExcelJS `4.4` | REST API, authorization & role enforcement, IP/email rate limiting, `.xlsx`/`.csv` exports |
| **Database** | PostgreSQL | Neon Serverless PostgreSQL, `@prisma/client` `7.10`, `@prisma/adapter-pg`, `pg` `8.23` | Relational persistence, pooled connections, transactional SQL migrations |
| **Authentication** | `express-session`, `connect-pg-simple` | PostgreSQL-backed session store, `bcryptjs` `3.0` | `HttpOnly`, `Secure`, `SameSite=Lax` session cookies; bcrypt password hashing |
| **External APIs** | Resend, Cloudinary, reCAPTCHA v2 | `resend` `6.32`, unsigned client image upload preset, Google reCAPTCHA Checkbox | Verified transactional mail, profile photo CDN, bot mitigation |
| **Testing** | Node Test Runner, Playwright | `node --test`, `@playwright/test` `1.65` | API contract & unit tests, browser E2E suites, automated security regression |

---

## Repository Structure

```text
ClassDex/
├── classdex-backend/                 # Express REST API & PostgreSQL layer
│   ├── prisma/
│   │   ├── migrations/               # 20 versioned, additive SQL migrations
│   │   └── schema.prisma             # Relational schema & Prisma models
│   ├── scripts/
│   │   ├── apply-schema.js           # Transactional SQL migration runner (_ClassDexMigration)
│   │   ├── backfill-name-parts.js    # Name decomposition backfill utility
│   │   ├── seed-test-data.js         # Isolated QA/demo dataset seeder (qa_ prefix)
│   │   └── send-test-email.js        # CLI smoke check for Resend delivery
│   ├── src/
│   │   ├── services/                 # Mailer transport (resend/log/stub) & HTML/text templates
│   │   └── utils/                    # Date, password policy, photo URL, & token utilities
│   ├── test/                         # Backend unit/integration tests (node --test)
│   ├── db.js                         # Shared pg.Pool, PrismaPg adapter, & read-only cold-start retry
│   ├── export.js                     # .xlsx and .csv gradebook matrix builders
│   ├── index.js                      # Express entrypoint, middleware, & API routes
│   ├── prisma.config.ts              # Prisma 7 CLI configuration
│   └── package.json
├── classdex-frontend/                # React + Vite frontend client
│   ├── public/                       # Static logos, favicon, and SVG icon sprite (icons.svg)
│   ├── src/
│   │   ├── components/               # Design system, AuthLayout, classroom modules, RecaptchaWidget
│   │   ├── context/                  # AuthContext & ThemeProvider
│   │   ├── pages/                    # Landing, Auth, Faculty, & Student pages
│   │   ├── utils/                    # Photo upload, schedule, display/ordering, & sound helpers
│   │   └── api.js                    # Credentials-included fetch client wrapper
│   ├── vercel.json                   # Vercel SPA rewrites & strict security headers
│   ├── vite.config.js                # Vite config & production build reCAPTCHA test-key guard
│   └── package.json
├── docs/
│   ├── deployment/                   # DEPLOYMENT_GUIDE, ENV_VARIABLES, DNS_RECORDS, RUNBOOK, SMOKE_TEST
│   └── testing/                      # Sprint 6.1 functional & Sprint 6.2 security test archives
├── shared/
│   └── nameParser.js                 # Shared Philippine surname/name parser & sort-key builder
├── tests/
│   ├── e2e/                          # Playwright cross-browser user journeys
│   ├── scripts/                      # Test harness runners & strict test-DB allowlist guard
│   └── security/                     # Automated OWASP Top 10 security test suites
├── playwright.config.mjs             # Playwright configuration
├── render.yaml                       # Render Web Service Blueprint (single instance, Singapore)
└── package.json                      # Workspace test & seed scripts
```

---

## Local Development Setup

### 1. Prerequisites

- **Node.js** `>= 20.x` (Node `24.21.0` LTS pinned in `classdex-backend/package.json`)
- **npm** `>= 10.x`
- **PostgreSQL** instance (local PostgreSQL or a serverless Neon database)
- **Git**

### 2. Clone & Install Dependencies

```bash
git clone <repository-url>
cd ClassDex
npm install
cd classdex-backend && npm install
cd ../classdex-frontend && npm install
cd ..
```

### 3. Environment Configuration

Copy the template environment files:

```bash
cp classdex-backend/.env.example classdex-backend/.env
cp classdex-frontend/.env.example classdex-frontend/.env
```

#### Backend Variables (`classdex-backend/.env`)

| Variable | Purpose | Required in Dev? | Default / Placeholder |
|---|---|---|---|
| `DATABASE_URL` | PostgreSQL connection string for Prisma & sessions | Yes | `postgresql://user:pass@localhost:5432/classdex` |
| `PORT` | HTTP port bound by Express | No | `5000` |
| `SESSION_SECRET` | Cookie signing secret (minimum 32 chars in production) | Yes *(prod)* / Recommended | `<random-hex-secret>` |
| `FRONTEND_ORIGIN` | Allowed browser origin for CORS with credentials | Yes *(prod)* / Recommended | `http://localhost:5173` |
| `APP_BASE_URL` | Canonical frontend URL used in email links | Yes *(prod)* / Recommended | `http://localhost:5173` |
| `EMAIL_MODE` | Mail transport: `log`, `stub`, or `resend` | No | `log` *(forces `stub` under tests)* |
| `RESEND_API_KEY` | Resend API secret key (required when `EMAIL_MODE=resend`) | Only if `resend` | `re_xxxxxxxx` |
| `EMAIL_FROM` | Verified sender address on custom domain | Only if `resend` | `ClassDex <no-reply@example.com>` |
| `RECAPTCHA_SECRET_KEY` | Google reCAPTCHA v2 server secret key | No | *(Optional; Google test secret works locally)* |
| `TRUST_PROXY` | Reverse proxy hop count (`1` behind Render) | Production only | `1` *(leave `0`/unset locally)* |
| `RESET_TOKEN_TTL_MINUTES` | Password reset token TTL in minutes | No | `30` |
| `VERIFY_TOKEN_TTL_HOURS` | Email verification token TTL in hours | No | `24` |
| `VERIFY_RESEND_COOLDOWN_SECONDS` | Per-user cooldown between verification resends | No | `60` |

#### Frontend Variables (`classdex-frontend/.env`)

| Variable | Purpose | Required in Dev? | Default / Placeholder |
|---|---|---|---|
| `VITE_API_BASE_URL` | Backend origin without trailing `/api` (empty uses Vite `/api` proxy) | Production only | *(Leave blank locally; `https://api.classdex.me` in prod)* |
| `VITE_RECAPTCHA_SITE_KEY` | Public Google reCAPTCHA v2 Checkbox site key | No | *(Google test site key works in dev; blocked in `vite build --mode production`)* |
| `VITE_CLOUDINARY_CLOUD_NAME` | Cloudinary cloud name for unsigned uploads | No | `your-cloud-name` |
| `VITE_CLOUDINARY_UPLOAD_PRESET` | Cloudinary unsigned upload preset name | No | `your-unsigned-preset` |

**Development Mode Notes:**
- **`EMAIL_MODE=log` / `stub`:** Leaving `EMAIL_MODE=log` prints verification and password-reset emails safely to the backend terminal (with `?token=` values redacted in logs unless explicitly tested via `stub`), avoiding network calls to Resend. `EMAIL_MODE=stub` captures emails in memory for automated test assertions.
- **reCAPTCHA Local vs. Production:** Google's public test reCAPTCHA keys (`6LeIxAcTAAAAAJcZVRqyHh71UMIEGNQ_MXjiZKhI`) work during local development (`vite dev`), whereas `classdex-frontend/vite.config.js` and `assertProductionStartupConfig()` in `classdex-backend/index.js` fail fast if test keys are ever used in production.
- **Cloudinary Fallback:** When `VITE_CLOUDINARY_CLOUD_NAME` and `VITE_CLOUDINARY_UPLOAD_PRESET` are unset in local dev, `uploadPhoto` in `classdex-frontend/src/utils/photoUpload.js` falls back to inline data URLs so registration and profile flows work offline from Cloudinary. Production builds require valid Cloudinary settings.

### 4. Database Initialization

ClassDex does **not** use `prisma migrate dev` or `prisma migrate deploy` in development or production. Instead, initialize the schema with the transactional migration script:

```bash
cd classdex-backend
npm run db:setup
```

This runs `prisma generate` followed by `node scripts/apply-schema.js`, which connects with direct TLS negotiation, creates `_ClassDexMigration` if missing, applies all 20 SQL files in `classdex-backend/prisma/migrations/` inside transactions, and verifies every required table (including the `session` table).

### 5. Run the Application

```bash
# Terminal 1 — Backend API (http://localhost:5000)
cd classdex-backend
npm run dev

# Terminal 2 — Frontend Client (http://localhost:5173)
cd classdex-frontend
npm run dev
```

### 6. Troubleshooting Checklist

- **Connection timeout / SSL warning:** Ensure `DATABASE_URL` includes `?sslmode=verify-full` (or `?sslmode=require` locally) and that your database is reachable. For one-time DDL setup on Neon, prefer the direct (non-pooled) endpoint string; use the pooled URL at runtime.
- **Immediate `401` after login:** Verify `FRONTEND_ORIGIN` in `classdex-backend/.env` matches your exact browser origin (`http://localhost:5173`) and that `VITE_API_BASE_URL` is left blank in local dev so Vite proxies `/api` cleanly.
- **Relation or `session` table does not exist:** Re-run `npm run db:setup` inside `classdex-backend/`.
- **Port 5000 already in use:** Stop conflicting local processes or change `PORT` in `classdex-backend/.env` (updating the proxy target in `classdex-frontend/vite.config.js` if changed).

---

## Automated Testing Suite

Workspace test scripts run against an isolated test configuration (`classdex-backend/.env.test`) managed by `tests/scripts/load-test-env.cjs`:

| Command | Scope | Runner |
|---|---|---|
| `npm run test:api` | Backend unit/contract tests (`classdex-backend/test/*.test.js`) and frontend unit tests | `node --test` |
| `npm run test:security` | Automated OWASP Top 10 authorization, injection, rate-limit, and config suites (`tests/security/*.test.cjs`) | `node --test` |
| `npm run test:e2e` | Cross-browser E2E user journeys (Chromium, Firefox, WebKit) | `@playwright/test` |

> [!CAUTION]
> **Never run test, seed, or cleanup scripts against the production database or live domain.** Automated suites create and delete fixture records (`qa_` accounts and synthetic classes). `tests/scripts/load-test-env.cjs` enforces a strict host allowlist guard (`assertSafeTestDatabaseUrl`) and aborts immediately if `DATABASE_URL` points to any non-allowlisted or production host.

---

## Production Architecture & Operational Docs

- **Frontend (Vercel):** Deployed from `classdex-frontend` with SPA rewrites and enforced security headers (`Content-Security-Policy`, `Strict-Transport-Security: max-age=86400`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`) configured in `classdex-frontend/vercel.json`.
- **Backend (Render):** Deployed from `classdex-backend` in Singapore as a single instance (`numInstances: 1`, `TRUST_PROXY=1`, `/api/status` health check) configured in `render.yaml`.
- **Database (Neon):** Serverless PostgreSQL in Singapore (`ap-southeast-1`) using pooled connections for app runtime (`pg.Pool` + read-only cold-start retry) and PostgreSQL-backed sessions (`connect-pg-simple`).
- **Domain & Email:** `classdex.me` and `api.classdex.me` share the registrable root domain via Namecheap DNS so `SameSite=Lax` cookies work cleanly across Vercel and Render; Resend SPF, DKIM, and DMARC records are verified for `no-reply@classdex.me`.

Detailed operational guides live under `docs/deployment/`:

- [DEPLOYMENT_GUIDE.md](docs/deployment/DEPLOYMENT_GUIDE.md) — Production topology, hosting configuration, Jira summary, and Sprint 6.3 deployment report.
- [RUNBOOK.md](docs/deployment/RUNBOOK.md) — Log inspection, manual redeploys, Render/Vercel rollbacks, Neon point-in-time recovery, secret rotation (`VITE_` rebuild note), and pre-presentation warm-up.
- [ENV_VARIABLES.md](docs/deployment/ENV_VARIABLES.md) — Complete backend and frontend environment variable inventory.
- [DNS_RECORDS.md](docs/deployment/DNS_RECORDS.md) — Final Namecheap web, API, and Resend DNS configuration.
- [PRODUCTION_SMOKE_TEST.md](docs/deployment/PRODUCTION_SMOKE_TEST.md) — Verified production functional smoke test and bounded security recheck results.

---

## Known Limitations

- **Internet Connectivity Required:** Cloud database persistence, Cloudinary uploads, reCAPTCHA challenges, and transactional email delivery require active internet connectivity.
- **Manual Attendance Entry:** Attendance is marked manually by instructors; no RFID, QR attendance punch-in, or biometric hardware integration exists.
- **No Direct SIS Integration:** ClassDex operates independently of any university Student Information System or registrar database, relying on spreadsheet (`.xlsx`/`.csv`) import and export.
- **Single-Instance Backend:** Rate-limiters (`express-rate-limit`) and verification resend cooldowns use in-memory state calibrated for one backend instance; scaling beyond one instance requires an external distributed store such as Redis.
- **Free-Tier Cold Starts:** Render's free tier spins down after 15 minutes without traffic (~30–60 second wake-up delay).

---

## License

Educational use only. All rights reserved by Leyte Normal University.
