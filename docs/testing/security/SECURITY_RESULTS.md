# ClassDex — Sprint 6.2 Security Test Results

**Standard:** OWASP Top 10:2021  
**Target DB Guard:** Verified on every run (`ep-orange-dream-b3a6qov0-pooler.c-4.ap-southeast-1.aws.neon.tech`, test branch only; `EMAIL_MODE=stub`; zero third-party network calls).  
**Last Updated:** 2026-11-12

---

## 1. Per-Ticket Execution Summary

| Ticket | Area | Cases Written | Pass | Fail | Known Issue | Manual – Not Run | Not Run | Findings Logged |
|---|---|---|---|---|---|---|---|---|
| `SCRUM-70` | Authorization & Data Isolation (`AUTHZ`) | 22 | 15 | 7 | 0 | 0 | 0 | `SEC-01` – `SEC-09` (`9` findings) |
| `SCRUM-71` | Input Validation & Injection (`INJ`) | 16 | 0 | 0 | 0 | 0 | 16 | Pending |
| `SCRUM-72` | Rate Limiting & Brute-Force (`RATE`) | 11 | 0 | 0 | 0 | 0 | 11 | Pending |
| `SCRUM-73` | Configuration & Dependencies (`CONF`) | 12 | 0 | 0 | 0 | 0 | 12 | Pending |
| **Total** | **All Sprint 6.2 Tickets** | **61** | **15** | **7** | **0** | **0** | **39** | **9** |

---

## 2. Findings Summary (Current)

### By Severity & Status

| Severity | Found | Fixed | Open | Needs decision | Deferred to 6.3 | Accepted risk |
|---|---|---|---|---|---|---|
| Critical | 0 | 0 | 0 | 0 | 0 | 0 |
| High | 3 | 0 | 3 | 0 | 0 | 0 |
| Medium | 4 | 0 | 2 | 2 | 0 | 0 |
| Low | 2 | 0 | 2 | 0 | 0 | 0 |
| Info | 0 | 0 | 0 | 0 | 0 | 0 |
| **Total** | **9** | **0** | **7** | **2** | **0** | **0** |

### By OWASP Top 10:2021 Category

| OWASP Category | Count | Finding IDs |
|---|---|---|
| `A01:2021 - Broken Access Control` | 7 | `SEC-01`, `SEC-02`, `SEC-03`, `SEC-04`, `SEC-05`, `SEC-08`, `SEC-09` |
| `A04:2021 - Insecure Design` | 1 | `SEC-07` (`Needs decision`) |
| `A07:2021 - Identification and Authentication Failures` | 1 | `SEC-06` (`Needs decision`) |

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
