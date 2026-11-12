# ClassDex — Sprint 6.2 Security Test Results

**Standard:** OWASP Top 10:2021  
**Target DB Guard:** Verified on every run (`ep-orange-dream-b3a6qov0-pooler.c-4.ap-southeast-1.aws.neon.tech`, test branch only; `EMAIL_MODE=stub`; zero third-party network calls).  
**Last Updated:** 2026-11-12

---

## 1. Per-Ticket Execution Summary

| Ticket | Area | Cases Written | Pass | Fail | Known Issue | Manual – Not Run | Not Run | Findings Logged |
|---|---|---|---|---|---|---|---|---|
| `SCRUM-70` | Authorization & Data Isolation (`AUTHZ`) | 22 | 15 | 7 | 0 | 0 | 0 | `SEC-01` – `SEC-09` (`9` findings) |
| `SCRUM-71` | Input Validation & Injection (`INJ`) | 16 | 9 | 7 | 0 | 0 | 0 | `SEC-10` – `SEC-16` (`7` findings) |
| `SCRUM-72` | Rate Limiting & Brute-Force (`RATE`) | 11 | 4 | 7 | 0 | 0 | 0 | `SEC-17` – `SEC-22` (`6` findings) |
| `SCRUM-73` | Configuration & Dependencies (`CONF`) | 12 | 0 | 0 | 0 | 0 | 12 | Pending |
| **Total** | **All Sprint 6.2 Tickets** | **61** | **28** | **21** | **0** | **0** | **12** | **22** |

---

## 2. Findings Summary (Current)

### By Severity & Status

| Severity | Found | Fixed | Open | Needs decision | Deferred to 6.3 | Accepted risk |
|---|---|---|---|---|---|---|
| Critical | 0 | 0 | 0 | 0 | 0 | 0 |
| High | 3 | 0 | 3 | 0 | 0 | 0 |
| Medium | 10 | 0 | 8 | 2 | 0 | 0 |
| Low | 9 | 0 | 9 | 0 | 0 | 0 |
| Info | 0 | 0 | 0 | 0 | 0 | 0 |
| **Total** | **22** | **0** | **20** | **2** | **0** | **0** |

### By OWASP Top 10:2021 Category

| OWASP Category | Count | Finding IDs |
|---|---|---|
| `A01:2021 - Broken Access Control` | 7 | `SEC-01`, `SEC-02`, `SEC-03`, `SEC-04`, `SEC-05`, `SEC-08`, `SEC-09` |
| `A03:2021 - Injection` | 6 | `SEC-10`, `SEC-11`, `SEC-12`, `SEC-13`, `SEC-14`, `SEC-15` |
| `A04:2021 - Insecure Design` | 2 | `SEC-07` (`Needs decision`), `SEC-20` |
| `A05:2021 - Security Misconfiguration` | 3 | `SEC-16`, `SEC-21`, `SEC-22` |
| `A07:2021 - Identification and Authentication Failures` | 4 | `SEC-06` (`Needs decision`), `SEC-17`, `SEC-18`, `SEC-19` |

---

## 3. Ticket Run Notes

### SCRUM-70 — Test Authorization and Data Isolation (`2026-11-12`)
- **Command:** `npm run test:security tests/security/scrum70-authz.test.cjs tests/security/scrum70-frontend-routes.test.cjs`
- **Neon Test Host Printed:** `ep-orange-dream-b3a6qov0-pooler.c-4.ap-southeast-1.aws.neon.tech` (`EMAIL_MODE=stub`)
- **Subtest Execution:** `30` node:test subtests (`29` API + `1` Playwright E2E) -> `19` passed, `0` failed unexpectedly, `11` `{ todo: 'SEC-xx' }` security checks reproducing `SEC-01` through `SEC-09`.
- **Key Highlights:**
  - All `61` authenticated endpoints rejected unauthenticated calls (`401`), all `52` Faculty-only endpoints rejected `STUDENT` (`403`), and all `5` Student-only endpoints rejected `FACULTY` (`403`).
  - Cross-faculty GET and write routes (`AUTHZ-06`, `AUTHZ-07`), mass assignment/role immutability (`AUTHZ-11`), cookie integrity & no-JWT check (`AUTHZ-14`), concurrent session invalidation across logout/change-password/reset-password (`AUTHZ-15`), token lifecycle (`AUTHZ-16`), archived-class canonicalized path guard (`AUTHZ-21`), and Playwright route guards (`AUTHZ-20`) all passed.
  - `AUTHZ-18` verified non-sequential CUID IDs and measured `classCode` as 6 uppercase hex characters (`16^6 = 16,777,216` ~ `24` bits) — cross-referenced for brute-force exposure check in `SCRUM-72` (`RATE-05`).
  - Zero Critical issues found; `9` findings logged (`3` High, `4` Medium, `2` Low).

### SCRUM-71 — Test Input Validation and Injection (`2026-11-12`)
- **Command:** `npm run test:security tests/security/scrum71-input.test.cjs tests/security/scrum71-browser-xss.test.cjs`
- **Neon Test Host Printed:** `ep-orange-dream-b3a6qov0-pooler.c-4.ap-southeast-1.aws.neon.tech` (`EMAIL_MODE=stub`)
- **Subtest Execution:** `24` node:test subtests (`22` API/audit + `2` Playwright E2E) -> `16` passed, `0` failed unexpectedly, `8` `{ todo: 'SEC-xx' }` security checks reproducing `SEC-10` through `SEC-16`.
- **Key Highlights:**
  - Static SQL scan across `classdex-backend/` confirmed zero `$queryRawUnsafe`, `$executeRawUnsafe`, `Prisma.raw(...)`, or string-built `pg` SQL calls; only parameterized `prisma.$queryRaw` tagged templates exist (`index.js:1745` and `index.js:5022`).
  - Playwright E2E XSS verification (`INJ-06`, `INJ-07`) and DOM sink grep confirmed zero `dangerouslySetInnerHTML`/`innerHTML`/`javascript:` sinks and `window.__xss === undefined` across Faculty and Student pages; HTML email templates (`INJ-08`) entity-escape all interpolated user/class fields.
  - `INJ-05` (7-digit `studentId` regex), `INJ-14` (`getClientUrl()` ignoring spoofed `Host` / `X-Forwarded-Host` and open-redirect params), `INJ-15` (`Content-Disposition` filename sanitization & no CRLF injection), and `INJ-16` (`__proto__`/bulk shape safety) all passed.
  - Zero Critical issues found; `7` findings logged (`2` Medium [`SEC-10`, `SEC-11`], `5` Low [`SEC-12`..`SEC-16`]).

### SCRUM-72 — Test Rate Limiting and Brute-Force Protection (`2026-11-12`)
- **Command:** `npm run test:security tests/security/scrum72-rate.test.cjs`
- **Neon Test Host Printed:** `ep-orange-dream-b3a6qov0-pooler.c-4.ap-southeast-1.aws.neon.tech` (`EMAIL_MODE=stub`)
- **Subtest Execution:** `14` node:test tests (`13` subtests) -> `7` passed, `0` failed unexpectedly, `7` `{ todo: 'SEC-xx' }` security checks reproducing `SEC-17` through `SEC-22`.
- **Key Highlights:**
  - Existing limiters performed cleanly: `forgotPasswordIpLimiter` (`5/15m`), `forgotPasswordEmailLimiter` (`5/15m`, verified capping stub emails at `5`), `changePasswordWrongCurrentLimiter` (`5/15m` + reset on success), and `resend-verification` 60s cooldown (`429` + `Retry-After`).
  - `RATE-06` and `RATE-07` verified reCAPTCHA rejects missing/blank/bad tokens before DB writes and fails **CLOSED** when `RECAPTCHA_SECRET_KEY` is absent or Google `siteverify` returns `500` / times out.
  - Bounded localhost concurrency tests (`36` export/deck requests & `12` ~8.1MB malformed JSON bursts) completed with zero crashes or pool exhaustion.
  - Zero Critical issues found; `6` findings logged (`4` Medium [`SEC-17`..`SEC-20`], `2` Low [`SEC-21`, `SEC-22`]).
