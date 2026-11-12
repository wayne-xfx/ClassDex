# ClassDex — Production Smoke Test & Security Recheck (`classdex.me`)

**Date:** `2026-11-12`  
**Frontend URL:** `https://classdex.me`  
**Backend API URL:** `https://api.classdex.me`  
**Status Legend:** `Pass` | `Fail` | `MANUAL – CONFIRMED BY ME` | `Not Run`  
**Test Accounts:** User-owned test accounts only (2 verified `+tag`/own accounts + 2 unverified test signups). **Zero `qa_` data and zero automated test suites run against production.**

---

## Severity Reference (Sprint 6.2 Standard)

| Severity | Meaning |
|---|---|
| **Critical** | Immediate compromise of authentication, database integrity, secrets, or cross-tenant data at scale |
| **High** | Cross-account data exposure/mutation, broken authorization, or missing transport/session protection |
| **Medium** | Security control gap requiring non-trivial conditions, CORS/cookie misconfiguration, or moderate impact |
| **Low** | Defense-in-depth hardening gap or informational security weakness |
| **Info** | Non-vulnerability observation |

---

## A. Functional Smoke Test Checklist

| ID | Flow / Check | Verification Method | Status | Observed Notes |
|---|---|---|---|---|
| **A1** | Register faculty & student; verification emails arrive from `classdex.me`; verify email; login & logout | Manual browser (`https://classdex.me`) | `MANUAL – CONFIRMED BY ME` | Verified `<owner>+faculty@gmail.com` (`ClassDex <no-reply@classdex.me>`, SPF/DKIM/DMARC `PASS`, `https://classdex.me/verify-email?token=...`) and student account; login confirmed for both roles. |
| **A2** | Forgot password → reset email arrives (`https://classdex.me/reset-password?token=...`) → new password works; old password rejected | Manual browser | `MANUAL – CONFIRMED BY ME` | Gmail received `"Reset your ClassDex password"` (`21:14`); reset succeeded on `https://classdex.me`; old password showed `"Invalid email or password."`, new password signed in (`21:15`). |
| **A3** | Faculty creates class, pastes/uploads Student List, views join link (`https://classdex.me/join/...`), join code, and QR code (QR opens `https://classdex.me/join/...`) | Manual browser + phone mobile data | `MANUAL – CONFIRMED BY ME` *(Partial sub-flows)* | Created `IT-111/111L` (`FWG4QA`); tested `https://classdex.me/join/FWG4QA` and scanned QR on phone over mobile data (`https://classdex.me/join/FWG4QA`). *(Student List upload/paste not exercised in this pass.)* |
| **A4** | Student joins: roster match auto-approved; non-matching ID goes to Pending; faculty Approve & Decline send notification emails | Manual browser | `MANUAL – CONFIRMED BY ME` *(Partial sub-flows)* | Pending join (`FWG4QA`) + faculty **Approve** + `"You were approved for IT-111/111L"` email (`21:22`, `https://classdex.me/student` link) confirmed. *(Roster auto-approve & Decline flow not exercised in this pass.)* |
| **A5** | Faculty records Attendance (Present/Late/Absent), runs Card Shuffler, and scores Recitation, Activities, Projects, and Quiz | Manual browser | `MANUAL – CONFIRMED BY ME` *(Partial sub-flows)* | Recorded Attendance (`Present`), Recitation Card Shuffler, Activity (`89/100`), Quiz (`45/50`). *(Projects & Late/Absent buttons not exercised in this pass.)* |
| **A6** | Student dashboard shows only that student's own records and is strictly view-only | Manual mobile + browser (`https://classdex.me/student`) | `MANUAL – CONFIRMED BY ME` | Confirmed over mobile data & DevTools mobile viewport after scoring (`Present`, `89`, `45/50`); only that student's records visible and strictly view-only. |
| **A7** | Excel (`.xlsx`) and CSV exports download and open cleanly in Excel/Calc | Manual browser | `MANUAL – CONFIRMED BY ME` | Both `.xlsx` table output and UTF-8 `.csv` export for `IT-111/111L` downloaded cleanly with all scored data (`Attendance: Present`, `Activity 1: 89`, `Quiz 1: 45/50`). |
| **A8** | Hard refresh (`Ctrl+Shift+R`) on deep links (`/join/<code>`, `/verify-email?token=...`, `/reset-password?token=...`, `/student/dashboard`, `/faculty/dashboard`) returns app without 404 | `curl` HTTP + Manual browser | `Pass` | `curl` returned `200 \| text/html; charset=utf-8` on all 5 deep links on `https://classdex.me`; user confirmed `Ctrl+Shift+R` hard refresh passed on `/student`. |
| **A9** | Profile photo upload works (`classdex/prod-profiles` on Cloudinary) and avatar renders without broken image | Manual browser | `MANUAL – CONFIRMED BY ME` | 3 assets uploaded cleanly to Cloudinary `enllxexd` (`.../image/upload/v1794489391/ucmxyevs3`, `.../v1794489640/fbx1yx7bd`, `.../v1794490841/dbkmzvggt`); avatars rendered across navbar, class roster, and shuffler. |
| **A10** | Logged-in session survives a Render backend redeploy/restart (`connect-pg-simple` Neon `"session"` table persistence) | Manual browser + Render restart/redeploy | `MANUAL – CONFIRMED BY ME` | Refreshed `https://classdex.me/faculty/classes/cmwdkq07d00061jl4d6fgexln` after Render Manual Deploy / Restart and remained logged in (`21:38`). |
| **A11** | Browser DevTools Console shows zero CSP violations, zero mixed-content warnings, and zero CORS errors across core flows | Manual browser (DevTools) | `MANUAL – CONFIRMED BY ME` | DevTools Console showed zero CSP `[Report Only]` violations, zero mixed-content warnings, and zero CORS errors across student, faculty, and Cloudinary upload flows (`21:13`, `21:38`, `21:46`). Ready to enforce `Content-Security-Policy`. |

---

## B. Bounded Security Recheck Checklist

*(Strict cap: bounded manual/`curl` checks only, no load testing, `<= 30` requests for rate-limit check.)*

| ID | Check | Method | Status | Observed Evidence |
|---|---|---|---|---|
| **B1** | HTTP → HTTPS redirect, HSTS, and security headers present on both domains | `curl -I` | `Pass` | `http://classdex.me` → `308 https://classdex.me/`; `https://classdex.me` sends `Strict-Transport-Security: max-age=86400`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Content-Security-Policy-Report-Only`. `http://api.classdex.me/api/status` → `301 https://api.classdex.me/api/status`; `https://api.classdex.me/api/status` sends `Strict-Transport-Security: max-age=31536000; includeSubDomains`, `Cache-Control: no-store`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`. |
| **B2** | CORS allows `https://classdex.me` with credentials, denies foreign/null origins, never returns `*` with credentials | `curl -I` with `Origin` header | `Pass` | `Origin: https://classdex.me` → `access-control-allow-origin: https://classdex.me`, `access-control-allow-credentials: true`. `Origin: https://evil.example` and `Origin: null` → no `Access-Control-Allow-Origin` header. |
| **B3** | Session cookie (`classdex.sid`) carries `HttpOnly`, `Secure`, `SameSite=Lax` | Browser DevTools | `Pass` | Confirmed in Brave DevTools → Application → Cookies on both student (`21:13`) and faculty (`21:38`) sessions: `classdex.sid`, Domain `api.classdex.me`, `HttpOnly ✓`, `Secure ✓`, `SameSite=Lax`. |
| **B4** | `/__e2e/*` routes return `404`; error responses expose no stack traces or file paths | `curl` | `Pass` | `GET /__e2e/emails` → `404`; `POST /__e2e/reset` → `404`; malformed JSON `POST /api/auth/login` → `400 {"message":"Invalid JSON request body."}`. |
| **B5** | Access control spot checks: unauthenticated → `401`; student → faculty endpoint → `403`; cross-user IDOR denied (`403`/`404`) | `curl` + Student DevTools Console | `Pass` | Unauthenticated `GET /api/auth/me`, `GET /api/classes/faculty`, `GET /api/student/classes` returned `401`. Authenticated Student session returned `403 (Forbidden)` on `GET /api/faculty/classes/pending-counts`, `GET /api/classes/cmwdkq07d00061jl4d6fgexln/pending`, and foreign `GET /api/classes/0000000000000000000000000/quizzes` (`21:46`). |
| **B6** | Rate limiting behind Render proxy (`TRUST_PROXY=1`): wrong logins trigger `429` for limited IP while phone on mobile data still logs in; forged `X-Forwarded-For` header from limited IP does **not** bypass limit | Bounded `curl` (12 reqs) + phone mobile data | `Pass` | On `ratelimit-probe@invalid.example`, attempts 1–10 returned `401`, attempt 11 returned `429`, and attempt 12 with forged `X-Forwarded-For: 203.0.113.99` still returned `429`. Concurrent mobile-data login succeeded cleanly from cellular IP. |
| **B7** | Production DB contains zero `qa_` rows and live frontend bundle contains zero secrets or source maps | Neon SQL Editor + `curl` JS bundle inspect | `Pass` | Neon SQL Editor returned `qa_users = 0` (`21:47`). Deployed JS (`index-w9vx_QQM.js`, `567031` bytes) has zero secrets, `sourceMappingURL` absent, `.map` returns `404`. |

---

## C. Post-Test Production Cleanup (Explicit Target List Only)

*(Reviewed read-only in Neon SQL Editor at `21:47`; delete strictly by explicit IDs, never unfiltered.)*

### 1. Explicit Targets to Remove

- **PostgreSQL `"User"` rows (cascades via `ON DELETE CASCADE` to `FacultyProfile`, `StudentProfile`, `Class`, `ClassEnrollment`, `ClassSession`, `AttendanceRecord`, `RecitationLog`, `Activity`, `ActivityScore`, `Project`, `ProjectScore`, `QuizSession`, `QuizScore`, `ClassRoster`, `PasswordResetToken`, `EmailVerificationToken`):**
  1. `cmwdjvma200001jl4xk6h9ds6` (`FACULTY`, verified — owns class `cmwdkq07d00061jl4d6fgexln` / `FWG4QA` `IT-111/111L`)
  2. `cmwdkg5s800021jl4lodke58l` (`STUDENT`, verified)
  3. `cmwdlfgj6000021ipz1cvy2vk` (`FACULTY`, unverified)
  4. `cmwdlhvkn000221iphkpo8ps4` (`STUDENT`, unverified)
- **PostgreSQL `"session"` rows:** only sessions whose `sess->>'userId'` matches one of the 4 explicit user IDs above.
- **Cloudinary assets (manual delete in Cloudinary Console → Media Library → `classdex/prod-profiles`):**
  1. `ucmxyevs3` (`.../image/upload/v1794489391/ucmxyevs3`)
  2. `fbx1yx7bd` (`.../image/upload/v1794489640/fbx1yx7bd`)
  3. `dbkmzvggt` (`.../image/upload/v1794490841/dbkmzvggt`)

- **Cleanup Status:** `Pending user review & execution`

---

## D. Findings Log (`DEP-xx`) & Go/No-Go Decision

### Issues Recorded

| ID | Title | Severity | Section / Flow | Status | Resolution / Next Step |
|---|---|---|---|---|---|
| *(None recorded)* | — | — | — | — | Zero failures or console CSP violations observed |

### Go / No-Go Criteria

- [x] Section A functional flows passed (`MANUAL – CONFIRMED BY ME` / `Pass`; unexercised sub-controls noted transparently)
- [x] Section B security recheck: **0 Critical**, **0 High**, **0 Medium** issues (all B1–B7 `Pass`)
- [x] Ticket 6 inbox checks (`classdex.me` sender, links, SPF/DKIM/DMARC `PASS`) confirmed
- [ ] Switch `Content-Security-Policy-Report-Only` → enforced `Content-Security-Policy` in `classdex-frontend/vercel.json` (Push point 2 + live header recheck)
- [ ] Section C smoke-test accounts/data & Cloudinary assets cleaned up and DB counts confirmed `0`

**Recommendation:** **GO** — pending CSP header switch (Push point 2) and Section C targeted cleanup.
