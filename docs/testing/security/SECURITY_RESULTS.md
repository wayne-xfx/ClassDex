# ClassDex — Sprint 6.2 Security Test Results

**Standard:** OWASP Top 10:2021  
**Target DB Guard:** Verified on every run (`ep-orange-dream-b3a6qov0-pooler.c-4.ap-southeast-1.aws.neon.tech`, test branch only; `EMAIL_MODE=stub`; zero third-party network calls except `npm audit`/`npm update`/`npm install` registry metadata and Playwright E2E compatibility test widget loads).  
**Last Updated:** 2026-11-12 (Final — Post-`SCRUM-74`)

---

## 1. Per-Ticket Execution Summary

| Ticket | Area | Cases Written | Pass | Fail | Known Issue | Manual – Not Run | Not Run | Findings Logged |
|---|---|---:|---:|---:|---:|---:|---:|---|
| `SCRUM-70` | Authorization & Data Isolation (`AUTHZ`) | 22 | 22 | 0 | 0 | 0 | 0 | `SEC-01` – `SEC-09` (`7` Fixed, `2` Accepted risk) |
| `SCRUM-71` | Input Validation & Injection (`INJ`) | 16 | 16 | 0 | 0 | 0 | 0 | `SEC-10` – `SEC-16` (`7` Fixed) |
| `SCRUM-72` | Rate Limiting & Brute-Force (`RATE`) | 11 | 11 | 0 | 0 | 0 | 0 | `SEC-17` – `SEC-22` (`5` Fixed, `1` Deferred to 6.3) |
| `SCRUM-73` | Configuration & Dependencies (`CONF`) | 12 | 12 | 0 | 0 | 0 | 0 | `SEC-23` – `SEC-31` (`9` Fixed) |
| **Total** | **All Sprint 6.2 Tickets** | **61** | **61** | **0** | **0** | **0** | **0** | **31 (`28` Fixed, `2` Accepted risk, `1` Deferred to 6.3)** |

---

## 2. Findings Summary (Final Post-`SCRUM-74`)

### By Severity & Status

| Severity | Found | Fixed | Open | Needs decision | Deferred to 6.3 | Accepted risk |
|---|---:|---:|---:|---:|---:|---:|
| Critical | 0 | 0 | 0 | 0 | 0 | 0 |
| High | 4 | 4 | 0 | 0 | 0 | 0 |
| Medium | 12 | 10 | 0 | 0 | 0 | 2 |
| Low | 14 | 13 | 0 | 0 | 1 | 0 |
| Info | 1 | 1 | 0 | 0 | 0 | 0 |
| **Total** | **31** | **28** | **0** | **0** | **1** | **2** |

*Note on partial/infrastructure items:*
- **`SEC-06` (`Accepted risk`, `652c10a`):** Owner approved keeping reminder-banner-only UX (`EmailVerificationBanner.jsx`) without API gating.
- **`SEC-07` (`Accepted risk`, `652c10a`):** Owner approved keeping open `FACULTY`/`STUDENT` self-registration, mitigated by photo/tenant isolation (`SEC-03`) and code-check rate limiting (`SEC-20`).
- **`SEC-22` (`Deferred to 6.3`, `f1244a8`):** Bounded TTL/cap pruning (`pruneVerifyResendCooldowns`) fixed in-memory `verifyResendCooldownByUser` growth; external PG/Redis multi-instance rate-limiter & session store (`SEC-24`) deferred to Sprint 6.3 infrastructure.

### By OWASP Top 10:2021 Category

| OWASP Category | Found | Fixed | Deferred to 6.3 | Accepted risk | Open / Needs decision | Finding IDs |
|---|---:|---:|---:|---:|---:|---|
| `A01:2021 - Broken Access Control` | 7 | 7 | 0 | 0 | 0 | `SEC-01`, `SEC-02`, `SEC-03`, `SEC-04`, `SEC-05`, `SEC-08`, `SEC-09` |
| `A02:2021 - Cryptographic Failures` | 3 | 3 | 0 | 0 | 0 | `SEC-23`, `SEC-24`, `SEC-27` |
| `A03:2021 - Injection` | 6 | 6 | 0 | 0 | 0 | `SEC-10`, `SEC-11`, `SEC-12`, `SEC-13`, `SEC-14`, `SEC-15` |
| `A04:2021 - Insecure Design` | 2 | 1 | 0 | 1 | 0 | `SEC-07` (`Accepted risk`), `SEC-20` |
| `A05:2021 - Security Misconfiguration` | 6 | 5 | 1 | 0 | 0 | `SEC-16`, `SEC-21`, `SEC-22` (`Deferred to 6.3`), `SEC-25`, `SEC-26`, `SEC-30` |
| `A06:2021 - Vulnerable and Outdated Components` | 2 | 2 | 0 | 0 | 0 | `SEC-28`, `SEC-29` |
| `A07:2021 - Identification and Authentication Failures` | 4 | 3 | 0 | 1 | 0 | `SEC-06` (`Accepted risk`), `SEC-17`, `SEC-18`, `SEC-19` |
| `A09:2021 - Security Logging and Monitoring Failures` | 1 | 1 | 0 | 0 | 0 | `SEC-31` |

---

## 3. Ticket Execution History (`SCRUM-70` – `SCRUM-73`)

### SCRUM-70 — Test Authorization and Data Isolation (`2026-11-12`)
- **Initial Run (`dd8befb`):** `30` node:test subtests -> `19` passed, `0` unexpected fails, `11` `{ todo: 'SEC-xx' }` security checks reproducing `SEC-01`–`SEC-09`.
- **Key Highlights:** All `61` authenticated endpoints rejected unauthenticated calls (`401`), all `52` Faculty-only routes rejected `STUDENT` (`403`), and all `5` Student-only routes rejected `FACULTY` (`403`).

### SCRUM-71 — Test Input Validation and Injection (`2026-11-12`)
- **Initial Run (`dd8befb`):** `24` node:test subtests -> `16` passed, `0` unexpected fails, `8` `{ todo: 'SEC-xx' }` security checks reproducing `SEC-10`–`SEC-16`.
- **Key Highlights:** Zero unsafe raw SQL interpolation; Playwright XSS (`window.__xss === undefined`) and HTML email escaping passed.

### SCRUM-72 — Test Rate Limiting and Brute-Force Protection (`2026-11-12`)
- **Initial Run (`dd8befb`):** `14` node:test subtests -> `7` passed, `0` unexpected fails, `7` `{ todo: 'SEC-xx' }` security checks reproducing `SEC-17`–`SEC-22`.
- **Key Highlights:** Existing forgot/change-password limiters, 60s resend cooldown, fail-closed `recaptcha.js`, and bounded concurrency checks (`<=36` requests) passed.

### SCRUM-73 — Review Security Configuration and Dependencies (`2026-11-12`)
- **Initial Run (`dd8befb`):** `16` node:test subtests -> `7` passed, `0` unexpected fails, `9` `{ todo: 'SEC-xx' }` security checks reproducing `SEC-23`–`SEC-31`.
- **Key Highlights:** Zero secrets in git commit history; zero `.map` source maps or server keys in `classdex-frontend/dist/`; `NODE_ENV=production` disabled `/__e2e/*` (`404`).

---

## 4. `SCRUM-74` Remediation & Final Regression Verification (`2026-11-12`)

1. **Security Test Suite (`npm run test:security`):**
   - **Host:** `ep-orange-dream-b3a6qov0-pooler.c-4.ap-southeast-1.aws.neon.tech` (`EMAIL_MODE=stub`, `NODE_ENV=test`)
   - **Result:** **84 / 84 passed, 0 failed, 0 todo, 0 skipped** (`343.8s` total across all 6 security suites).
   - `RATE-02` timing oracle delta improved from `477.8 ms` to `5.5 ms` (`421.9 ms` vs `427.4 ms` across `n=20` interleaved samples).
2. **Functional API & Frontend Unit Suite (`npm run test:api` & frontend `node --test`):**
   - **Host:** `ep-orange-dream-b3a6qov0-pooler.c-4.ap-southeast-1.aws.neon.tech` (`EMAIL_MODE=stub`)
   - **Backend Run (`npm run test:api`):** `130 / 131` leaf tests passed (`1024.3s`); `EXP-06: High-volume export (60 students x 20 sessions)` timed out once (`pg-pool` `Query read timeout` at 30s). Isolated re-run of `classdex-backend/test/scrum66-student-export.test.js` passed **12 / 12** (`EXP-06` completed in `28.45s`).
   - **Frontend Unit Suites (`node --test`):** **26 / 26 passed, 0 failed** (`0.38s` across `photoUpload.test.mjs`, `studentListValidation.test.mjs`, and `src/utils/*.test.*`).
3. **Playwright Full E2E Regression (`npm run test:e2e`):**
   - **Host:** `ep-orange-dream-b3a6qov0-pooler.c-4.ap-southeast-1.aws.neon.tech` (`EMAIL_MODE=stub`)
   - **Full Run:** **41 passed, 1 known skip (`firefox-mobile` COMPAT-04), 3 transient timeouts** (`17.8m`):
     - `chromium-desktop` `password-email.spec.mjs:260` (`#recaptcha-anchor` CDN load >25s) — re-run alone: **Pass (`24.5s`)**.
     - `chromium-desktop` `recording.spec.mjs:510` (`REC-16c` `<main>` deck load >10s) — re-run alone: **Pass (`11.1s`)**.
     - `webkit-desktop` `compat.spec.mjs:307` (`/student/classes/:id` Neon query >20s) — re-run alone: **Pass (`22.4s`)**.
4. **Frontend Production Build (`npm --prefix classdex-frontend run build`):** Built cleanly in `966ms` (`vite v8.3.8`, zero `.map` files, zero secrets).
5. **Neon Test Database Hygiene:** Verified `0` remaining `qa_`-prefixed test users and `0` `qa_`-prefixed test classes on `ep-orange-dream-b3a6qov0-pooler.c-4.ap-southeast-1.aws.neon.tech`.

---

## 5. Sprint 6.2 Final Report

### What We Did Not Cover
- Live reverse-proxy TLS/HSTS termination, CDN/WAF edge throttling, and static frontend hosting CSP/HSTS headers on production hosting (**Sprint 6.3**).
- Distributed multi-instance Redis/PostgreSQL session & rate-limiter failover testing under horizontal scaling (**Sprint 6.3**).
- Automated fuzzing against external managed providers (Google reCAPTCHA puzzle resistance, Resend delivery API, Cloudinary CDN image processing pipeline).
- Native mobile OS storage / WebView security checks (coverage limited to desktop and responsive mobile/tablet Playwright browser engines).

### Production Deployment Checklist for Sprint 6.3
- **`NODE_ENV`:** Set `NODE_ENV=production` on the backend host (enforces fail-fast `assertProductionStartupConfig()`, disables `/__e2e/*`, sets `cookie.secure: true`, enables HSTS header).
- **`TRUST_PROXY`:** Set `TRUST_PROXY=1` (or exact proxy hop count) behind Render/Railway/edge reverse proxy so `req.ip` reflects real client IPs without trusting client-spoofed headers directly (`SEC-21`).
- **CORS & Origin URLs:** Set `FRONTEND_ORIGIN=https://<live-frontend-domain>` and `APP_BASE_URL=https://<live-frontend-domain>` (`SEC-25`, `INJ-14`).
- **HTTPS / HSTS / Static Frontend Headers:** Serve both frontend and backend strictly over TLS (`https://`); configure hosting platform edge headers (`Strict-Transport-Security`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `CSP`) for static frontend assets (`SEC-24`, `SEC-26`).
- **Secrets & Key Management:** Provision fresh production secrets (`>=32`-char `SESSION_SECRET`, live `DATABASE_URL`, live `RESEND_API_KEY`, verified `EMAIL_FROM`, live `RECAPTCHA_SECRET_KEY`, `VITE_RECAPTCHA_SITE_KEY`, `VITE_CLOUDINARY_CLOUD_NAME`, `VITE_CLOUDINARY_UPLOAD_PRESET`). Zero historical git secrets require emergency rotation (`CONF-05a`).
- **Session & Rate-Limiter Stores (`SEC-22`, `SEC-24`):** If deploying >1 backend instance or needing persistence across restarts, replace Express `MemoryStore` sessions (`connect-pg-simple` or Redis) and `express-rate-limit` `MemoryStore` / `verifyResendCooldownByUser` with shared Redis/Postgres backing stores.
- **Test Helpers Disabled:** Never run `tests/e2e/support/e2e-backend.cjs` in production; use `classdex-backend/index.js` directly (`CONF-07`).

### Remaining Dependency Advisories
- **Root Workspace (`npm audit`):** **0 vulnerabilities** (`0 critical, 0 high, 0 moderate, 0 low`).
- **Frontend (`classdex-frontend/`, `npm audit`):** **0 vulnerabilities** (`0 critical, 0 high, 0 moderate, 0 low`). `vite` updated to `8.3.8` (`SEC-29`).
- **Backend (`classdex-backend/`, `npm audit`):** **2 Moderate vulnerabilities** (`0 critical, 0 high, 0 low`): transitive `uuid <11.1.1` (`GHSA-w5hq-g745-h8pq` missing buffer bounds check in `uuid.v3`/`v5`/`v6`) pulled by `exceljs >=3.5.0`. Assessed **not reachable** (`exceljs` uses UUID v4 only; resolving via `npm audit fix --force` would downgrade `exceljs` to `3.4.0`), accepted as remaining transitive low-impact dev/export metadata (`CONF-09`).

### Git Branches & Confirmation
- **Feature Branches Merged into `sprint-6-2`:**
  - `feature/SCRUM-70-authz-isolation`
  - `feature/SCRUM-71-input-injection`
  - `feature/SCRUM-72-rate-limiting`
  - `feature/SCRUM-73-config-deps`
  - `feature/SCRUM-74-fix-findings` (31 remediation/decision commits `7243f1e`..`c94fecc` + Sprint 6.2 docs finalization)
- **Safety & Privacy Confirmation:** Nothing pushed to GitHub; `main` untouched; production Neon database never touched (every test suite verified `ep-orange-dream-b3a6qov0-pooler.c-4.ap-southeast-1.aws.neon.tech` only); zero real emails sent (`EMAIL_MODE=stub`); zero live calls to Google `siteverify`, Cloudinary, or Resend during security tests; zero secrets, tokens, hashes, or DB credentials present in any document, commit, or log output.
