# ClassDex — Sprint 6.2 Security Test Plan

**Project:** ClassDex (Leyte Normal University Class & Student Record Management System)  
**Sprint:** 6.2 — Security Testing (`SCRUM-70` through `SCRUM-74`)  
**Git Branch:** `sprint-6-2` (branched from `main` @ `36856d9` after Sprint 6.1 merge)  
**Standard Referenced:** **OWASP Top 10:2021** (`A01:2021`–`A10:2021`, used consistently across all cases and findings)

---

## 1. Objectives & Scope

Verify the security posture of ClassDex locally across authorization & tenant isolation, input validation & injection defense, authentication & brute-force/rate-limiting protections, and configuration/dependency hygiene, then remediate prioritized findings cleanly in `SCRUM-74`.

| Ticket | Key | Area | Reference Source |
|---|---|---|---|
| 1 | `SCRUM-70` | Authorization & Data Isolation (`AUTHZ`) | All `72` routes in [`ROUTE_INVENTORY.md`](./ROUTE_INVENTORY.md) |
| 2 | `SCRUM-71` | Input Validation & Injection (`INJ`) | Express handlers, raw SQL, export builders, email templates, React UI |
| 3 | `SCRUM-72` | Rate Limiting & Brute-Force Protection (`RATE`) | Auth, email, join, reCAPTCHA, `trust proxy`, bounded resource limits |
| 4 | `SCRUM-73` | Security Configuration & Dependencies (`CONF`) | Session/cookie flags, headers, CORS, secret scan, `NODE_ENV=production`, `npm audit` |
| 5 | `SCRUM-74` | Fix Security Findings | Prioritized remediation on `Open` findings from [`SECURITY_FINDINGS.md`](./SECURITY_FINDINGS.md) |

### 1.1 In-Scope
- Local Node/Express backend (`classdex-backend/`) and React/Vite frontend (`classdex-frontend/`) executing against `localhost`.
- API-level security tests under `tests/security/` executed via `npm run test:security` (`node --test --test-concurrency=1`).
- Targeted Playwright browser security tests (stored XSS execution checks, CORS preflight, browser cookie/response header checks, UI route guards).
- Static code/configuration audits, git commit history secret scanning (`git log -p -S`), production bundle inspection, and `npm audit --json` / `npm outdated`.
- Safe isolated test fixes in `SCRUM-74` after Checkpoint 2 approval.

### 1.2 Out-of-Scope
- Scanning, probing, or attacking third-party hosts (Neon, Resend, Cloudinary, Google reCAPTCHA, or any external domain). Only `npm audit`/`npm install` to npm registry and normal backend Prisma traffic to the Neon **test** branch are allowed.
- Denial-of-service floods or load stress testing beyond bounded localhost checks (`<= 50` concurrent requests; at most a few hundred sequential requests).
- Social engineering, phishing, or physical device tampering.
- Cloud/hosting infrastructure deployment (HTTPS termination, DNS/SSL, production reverse-proxy configuration, hosting environment secret rotation — deferred to **Sprint 6.3**).

### 1.3 What We Did Not Cover
- Live reverse-proxy, TLS/HSTS termination, WAF/CDN rate-limiting, and multi-replica behavior on hosted deployment targets (**Sprint 6.3**).
- Automated dynamic fuzzing against third-party managed services (Google reCAPTCHA puzzle solving resistance, Resend SMTP/API, Cloudinary CDN transformation pipeline).
- Distributed multi-node Redis/Postgres session & rate-limiter failover testing under horizontal scaling.
- Native mobile OS storage/WebView hardening (desktop & emulated mobile Playwright contexts only).
- Rewriting historical git commits if any historical secret is discovered (flagged Critical for credential rotation in Sprint 6.3; history rewrite requires explicit approval).

---

## 2. Severity Rubric (Applied Consistently)

| Severity | Meaning & Examples |
|---|---|
| **Critical** | Unauthenticated access to other users' data, account takeover, auth bypass, secret exposed to the browser or committed to git |
| **High** | Authenticated user reads/changes another user's or class's data, privilege escalation, stored XSS that executes |
| **Medium** | Missing rate limit on auth/email flows, user enumeration, sessions not invalidated, formula injection in exports |
| **Low** | Missing hardening headers, verbose errors without sensitive data, minor info leaks |
| **Info** | Observations and hardening suggestions with no direct exploit |

---

## 3. Environment & Safety Guardrails

| Control | Implementation |
|---|---|
| **Neon Test Database Only** | Uses `classdex-backend/.env.test` (`ep-orange-dream-b3a6qov0-pooler.c-4.ap-southeast-1.aws.neon.tech`). Enforced in code via [`tests/scripts/load-test-env.cjs`](../../../tests/scripts/load-test-env.cjs), [`tests/security/setup.cjs`](../../../tests/security/setup.cjs), and [`tests/scripts/start-test-backend.cjs`](../../../tests/scripts/start-test-backend.cjs): parses `DATABASE_URL`, prints host only, and throws if host contains `ep-polished-night-b3hs4no6` or matches `.env`'s host — including when testing `NODE_ENV=production`. |
| **No Destructive DB Ops** | Prohibited: `migrate reset`, `db push --force-reset`, unfiltered `deleteMany({})`. All security test data uses `qa_` prefix and deletes only `qa_` test records. |
| **Zero Real Emails** | `EMAIL_MODE=stub` always; `RESEND_API_KEY` and `EMAIL_FROM` are cleared in test env setup so `dotenv.config()` cannot load live `.env` credentials. Assertions read from `getStubEmails()`. |
| **Zero Live Google `siteverify` Calls** | API tests mock `recaptcha.verifyRecaptchaToken` via Node's `node:test` `mock.method(...)` before `require("../index")` and forbid unintended external `fetch` calls. Playwright security tests avoid captcha widgets or stub `google.com/recaptcha` & `gstatic.com/recaptcha` locally via `page.route` + test backend mock — zero traffic to Google. |
| **Zero Real Cloudinary Uploads** | Photo upload client helpers are mocked (`uploadPhoto` options / `page.route`), and server upload/profile checks submit inline data URLs or synthetic URL strings directly without touching Cloudinary servers. |
| **Zero Secret Disclosure** | Passwords, raw tokens, bcrypt hashes, API keys, and DB connection strings never appear in docs, snapshots, commit messages, or console output. Secret scans print only `{ commit, file, varName }`. |

---

## 4. Defect & Finding Recording Rules (`SCRUM-70` – `SCRUM-73`)

- No application code changes occur in `SCRUM-70` through `SCRUM-73`.
- Any test exposing an actual vulnerability asserts the **secure expected behavior** and marks the test with Node runner's `{ todo: 'SEC-xx' }` option so the suite reports the exposed issue cleanly without breaking test execution prior to `SCRUM-74`.
- All findings are documented in `docs/testing/security/SECURITY_FINDINGS.md` with statuses restricted strictly to: `Open`, `Fixed`, `Retested`, `Needs decision`, `Deferred to 6.3`, `Accepted risk`.
- Case statuses in `docs/testing/security/SECURITY_TEST_CASES.csv` are restricted strictly to: `Pass`, `Fail`, `Known Issue`, `Manual – Not Run`, `Not Run`.
- Test/environment/setup failures follow the max-2-fix-attempts rule (marking broken non-app issues as `Known Issue`).

---

## 5. Checkpoints & Execution Workflow

1. **Checkpoint 1 (Current Gate):** Route inventory, security test plan, security test cases (`Not Run`), DB guard proof, and branch setup committed locally on `sprint-6-2`. Stop and await user `"go"`.
2. **Execution (`SCRUM-70` → `SCRUM-73`):** Dedicated `feature/SCRUM-<n>-<summary>` branch per ticket from current `sprint-6-2`, merged back into `sprint-6-2` cleanly upon completion. Stop immediately if any **Critical** finding is uncovered.
3. **Checkpoint 2 (Pre-Fix Gate):** Stop after `SCRUM-73` with complete `SECURITY_FINDINGS.md`, severity counts, proposed fix order, and all `Needs decision` items. Await user `"go"` and decisions.
4. **Remediation (`SCRUM-74`):** One fix commit per finding (`fix(security): SEC-xx <short title>`), remove `{ todo: 'SEC-xx' }`, update `SECURITY_FINDINGS.md`, `SECURITY_TEST_CASES.csv`, and `SECURITY_RESULTS.md`.
5. **Final Verification:** Run `npm run test:security`, `npm run test:api`, and `npm run test:e2e` once at the end. Keep all work local until explicitly asked to push/merge to `main`.
