# ClassDex — Sprint 6.2 Security Test Results

**Standard:** OWASP Top 10:2021  
**Target DB Guard:** Verified on every run (`ep-orange-dream-b3a6qov0-pooler.c-4.ap-southeast-1.aws.neon.tech`, test branch only; `EMAIL_MODE=stub`; zero third-party network calls except `npm audit`/`npm outdated` registry metadata).  
**Last Updated:** 2026-11-12 (Checkpoint 2 — Pre-`SCRUM-74`)

---

## 1. Per-Ticket Execution Summary

| Ticket | Area | Cases Written | Pass | Fail | Known Issue | Manual – Not Run | Not Run | Findings Logged |
|---|---|---|---|---|---|---|---|---|
| `SCRUM-70` | Authorization & Data Isolation (`AUTHZ`) | 22 | 15 | 7 | 0 | 0 | 0 | `SEC-01` – `SEC-09` (`9` findings) |
| `SCRUM-71` | Input Validation & Injection (`INJ`) | 16 | 9 | 7 | 0 | 0 | 0 | `SEC-10` – `SEC-16` (`7` findings) |
| `SCRUM-72` | Rate Limiting & Brute-Force (`RATE`) | 11 | 4 | 7 | 0 | 0 | 0 | `SEC-17` – `SEC-22` (`6` findings) |
| `SCRUM-73` | Configuration & Dependencies (`CONF`) | 12 | 3 | 9 | 0 | 0 | 0 | `SEC-23` – `SEC-31` (`9` findings) |
| **Total** | **All Sprint 6.2 Tickets** | **61** | **31** | **30** | **0** | **0** | **0** | **31** |

---

## 2. Findings Summary (Current)

### By Severity & Status

| Severity | Found | Fixed | Open | Needs decision | Deferred to 6.3 | Accepted risk |
|---|---|---|---|---|---|---|
| Critical | 0 | 0 | 0 | 0 | 0 | 0 |
| High | 4 | 0 | 4 | 0 | 0 | 0 |
| Medium | 12 | 0 | 10 | 2 | 0 | 0 |
| Low | 14 | 0 | 14 | 0 | 0 | 0 |
| Info | 1 | 0 | 1 | 0 | 0 | 0 |
| **Total** | **31** | **0** | **29** | **2** | **0** | **0** |

### By OWASP Top 10:2021 Category

| OWASP Category | Count | Finding IDs |
|---|---|---|
| `A01:2021 - Broken Access Control` | 7 | `SEC-01`, `SEC-02`, `SEC-03`, `SEC-04`, `SEC-05`, `SEC-08`, `SEC-09` |
| `A02:2021 - Cryptographic Failures` | 3 | `SEC-23`, `SEC-24`, `SEC-27` |
| `A03:2021 - Injection` | 6 | `SEC-10`, `SEC-11`, `SEC-12`, `SEC-13`, `SEC-14`, `SEC-15` |
| `A04:2021 - Insecure Design` | 2 | `SEC-07` (`Needs decision`), `SEC-20` |
| `A05:2021 - Security Misconfiguration` | 6 | `SEC-16`, `SEC-21`, `SEC-22`, `SEC-25`, `SEC-26`, `SEC-30` |
| `A06:2021 - Vulnerable and Outdated Components` | 2 | `SEC-28`, `SEC-29` |
| `A07:2021 - Identification and Authentication Failures` | 4 | `SEC-06` (`Needs decision`), `SEC-17`, `SEC-18`, `SEC-19` |
| `A09:2021 - Security Logging and Monitoring Failures` | 1 | `SEC-31` |

---

## 3. Ticket Run Notes

### SCRUM-70 — Test Authorization and Data Isolation (`2026-11-12`)
- **Command:** `npm run test:security tests/security/scrum70-authz.test.cjs tests/security/scrum70-frontend-routes.test.cjs`
- **Neon Test Host Printed:** `ep-orange-dream-b3a6qov0-pooler.c-4.ap-southeast-1.aws.neon.tech` (`EMAIL_MODE=stub`)
- **Subtest Execution:** `30` node:test subtests (`29` API + `1` Playwright E2E) -> `19` passed, `0` failed unexpectedly, `11` `{ todo: 'SEC-xx' }` security checks reproducing `SEC-01` through `SEC-09`.
- **Key Highlights:**
  - All `61` authenticated endpoints rejected unauthenticated calls (`401`), all `52` Faculty-only endpoints rejected `STUDENT` (`403`), and all `5` Student-only endpoints rejected `FACULTY` (`403`).
  - Cross-faculty GET and write routes (`AUTHZ-06`, `AUTHZ-07`), mass assignment/role immutability (`AUTHZ-11`), cookie integrity & no-JWT check (`AUTHZ-14`), concurrent session invalidation across logout/change-password/reset-password (`AUTHZ-15`), token lifecycle (`AUTHZ-16`), archived-class canonicalized path guard (`AUTHZ-21`), and Playwright route guards (`AUTHZ-20`) all passed.
  - `AUTHZ-18` verified non-sequential CUID IDs and measured `classCode` as 6 uppercase hex characters (`16^6 = 16,777,216` ~ `24` bits).
  - Zero Critical issues found; `9` findings logged (`3` High, `4` Medium, `2` Low).

### SCRUM-71 — Test Input Validation and Injection (`2026-11-12`)
- **Command:** `npm run test:security tests/security/scrum71-input.test.cjs tests/security/scrum71-browser-xss.test.cjs`
- **Neon Test Host Printed:** `ep-orange-dream-b3a6qov0-pooler.c-4.ap-southeast-1.aws.neon.tech` (`EMAIL_MODE=stub`)
- **Subtest Execution:** `24` node:test subtests (`22` API/audit + `2` Playwright E2E) -> `16` passed, `0` failed unexpectedly, `8` `{ todo: 'SEC-xx' }` security checks reproducing `SEC-10` through `SEC-16`.
- **Key Highlights:**
  - Static SQL scan confirmed zero `$queryRawUnsafe`, `$executeRawUnsafe`, `Prisma.raw(...)`, or string-built `pg` SQL calls; only parameterized `prisma.$queryRaw` tagged templates exist (`index.js:1745` and `index.js:5022`).
  - Playwright E2E XSS verification (`INJ-06`, `INJ-07`), DOM sink scan, and HTML email escaping (`INJ-08`) all passed cleanly (`window.__xss === undefined`).
  - `INJ-05` (7-digit `studentId`), `INJ-14` (`getClientUrl()` ignoring `Host`/`X-Forwarded-Host`), `INJ-15` (`Content-Disposition`), and `INJ-16` passed.
  - Zero Critical issues found; `7` findings logged (`2` Medium, `5` Low).

### SCRUM-72 — Test Rate Limiting and Brute-Force Protection (`2026-11-12`)
- **Command:** `npm run test:security tests/security/scrum72-rate.test.cjs`
- **Neon Test Host Printed:** `ep-orange-dream-b3a6qov0-pooler.c-4.ap-southeast-1.aws.neon.tech` (`EMAIL_MODE=stub`)
- **Subtest Execution:** `14` node:test tests (`13` subtests) -> `7` passed, `0` failed unexpectedly, `7` `{ todo: 'SEC-xx' }` security checks reproducing `SEC-17` through `SEC-22`.
- **Key Highlights:**
  - `forgotPasswordIpLimiter`, `forgotPasswordEmailLimiter`, `changePasswordWrongCurrentLimiter`, and `resend-verification` 60s cooldown enforced cleanly; `RATE-06`/`RATE-07` confirmed reCAPTCHA fails **CLOSED** before DB writes; bounded localhost concurrency tests (`36` export/deck + `12` ~8.1MB JSON) passed.
  - Zero Critical issues found; `6` findings logged (`4` Medium, `2` Low).

### SCRUM-73 — Review Security Configuration and Dependencies (`2026-11-12`)
- **Command:** `npm run test:security tests/security/scrum73-config.test.cjs` (plus `npm run build` in `classdex-frontend/`, `npm audit --json`, `npm outdated --json`, and full git history `git log -p -S` secret scan)
- **Neon Test Host Printed:** `ep-orange-dream-b3a6qov0-pooler.c-4.ap-southeast-1.aws.neon.tech` (`EMAIL_MODE=stub`; also verified explicitly on child `NODE_ENV=production` process spawns in `CONF-07` and `CONF-08`, with `0` stray `qa_` users/classes afterward)
- **Subtest Execution:** `16` node:test subtests -> `7` passed, `0` failed unexpectedly, `9` `{ todo: 'SEC-xx' }` security checks reproducing `SEC-23` through `SEC-31`.
- **Key Highlights:**
  - Git history scan (`git log -p -S`) found **zero real secrets** across all commits (no live Resend, Neon Postgres, Cloudinary, or session secrets committed; historical `499b6103` in `.env.example` is a placeholder string and Google test keys are public reCAPTCHA test keys). `classdex-backend/.env` and `.env.test` are properly untracked.
  - Built `classdex-frontend/dist/` contains zero `.map` source maps and zero server-side secret names/values.
  - Real `classdex-backend/index.js` under `NODE_ENV=production` disabled `/__e2e/*` (`404`), hid stack traces on malformed JSON, and rejected cross-origin requests from `https://evil.example` in API and Playwright.
  - Backend `npm audit`: `8` advisories (`xlsx@0.18.5` direct prod `fixAvailable=false`, patchable `body-parser`/`qs`, dev Prisma CLI); Frontend `npm audit`: `2` dev/build-only (`vite@8.3.0->8.3.8`, `source-map-js`); Root audit: `0`.
  - Zero Critical issues found; `9` findings logged (`1` High [`SEC-25`], `2` Medium [`SEC-24`, `SEC-28`], `5` Low [`SEC-23`, `SEC-26`, `SEC-29`, `SEC-30`, `SEC-31`], `1` Info [`SEC-27`]).
