# ClassDex — Sprint 6.2 Security Findings

**Standard:** OWASP Top 10:2021  
**Allowed Statuses:** `Open`, `Fixed`, `Retested`, `Needs decision`, `Deferred to 6.3`, `Accepted risk`  
**Regression Test Convention:** Exposed findings are guarded by `{ todo: 'SEC-xx' }` assertions in `tests/security/` using `node --test`.

---

## Summary Index

| ID | Title | Severity | OWASP Category | Found In | Status | Fix Commit |
|---|---|---|---|---|---|---|
| SEC-01 | Bulk quiz score upload writes scores for un-enrolled / foreign students | High | A01:2021 - Broken Access Control | SCRUM-70 / AUTHZ-08 | Open | — |
| SEC-02 | Activity & project single-score endpoints allow scoring unapproved enrollments | High | A01:2021 - Broken Access Control | SCRUM-70 / AUTHZ-08 | Open | — |
| SEC-03 | Student photo endpoint exposes photos on DECLINED enrollments and via arbitrary roster probe | High | A01:2021 - Broken Access Control | SCRUM-70 / AUTHZ-10 | Open | — |
| SEC-04 | Pending student enrollment can read class metadata and query classwork endpoint before approval | Medium | A01:2021 - Broken Access Control | SCRUM-70 / AUTHZ-05 | Open | — |
| SEC-05 | Declined student can bypass instructor rejection by resubmitting via class join | Medium | A01:2021 - Broken Access Control | SCRUM-70 / AUTHZ-05 | Open | — |
| SEC-06 | Unverified email accounts retain full API access to faculty and student mutations | Medium | A07:2021 - Identification and Authentication Failures | SCRUM-70 / AUTHZ-13 | Needs decision | — |
| SEC-07 | Public registration permits unrestricted self-selection of FACULTY role | Medium | A04:2021 - Insecure Design | SCRUM-70 / AUTHZ-12 | Needs decision | — |
| SEC-08 | Class code availability check applies `excludeId` globally without ownership scoping | Low | A01:2021 - Broken Access Control | SCRUM-70 / AUTHZ-09 | Open | — |
| SEC-09 | Student photo endpoint distinguishes nonexistent vs unauthorized profile IDs (404 vs 403) | Low | A01:2021 - Broken Access Control | SCRUM-70 / AUTHZ-19 | Open | — |
| SEC-10 | Profile photo endpoints lack faculty validation, image magic-byte checks, and external URL allowlisting | Medium | A03:2021 - Injection | SCRUM-71 / INJ-10 | Open | — |
| SEC-11 | CSV & XLSX spreadsheet exports fail to neutralize leading tab, carriage return, and whitespace formulas | Medium | A03:2021 - Injection | SCRUM-71 / INJ-12 | Open | — |
| SEC-12 | Numeric quiz/activity boundaries allow INT4 overflow (HTTP 500) and non-number string/boolean coercion | Low | A03:2021 - Injection | SCRUM-71 / INJ-04 | Open | — |
| SEC-13 | Roster import crashes on non-string `fileBase64` (HTTP 500) and parses disguised HTML inside `.xlsx` | Low | A03:2021 - Injection | SCRUM-71 / INJ-09 | Open | — |
| SEC-14 | Null bytes (`\u0000`) trigger database HTTP 500 and text fields lack server-side length limits | Low | A03:2021 - Injection | SCRUM-71 / INJ-11 | Open | — |
| SEC-15 | Non-string JSON objects and arrays coerce to `"[object Object]"` in class and profile text fields | Low | A03:2021 - Injection | SCRUM-71 / INJ-03 | Open | — |
| SEC-16 | Missing Express error middleware leaks HTML stack traces on malformed JSON in non-production mode | Low | A05:2021 - Security Misconfiguration | SCRUM-71 / INJ-13 | Open | — |
| SEC-17 | `POST /api/auth/login` lacks per-IP and per-account brute-force rate limiting | Medium | A07:2021 - Identification and Authentication Failures | SCRUM-72 / RATE-01 | Open | — |
| SEC-18 | Login skips `bcrypt.compare` on unknown emails, creating a ~478 ms user-enumeration timing oracle | Medium | A07:2021 - Identification and Authentication Failures | SCRUM-72 / RATE-02 | Open | — |
| SEC-19 | `register`, `verify-email`, and `reset-password*` endpoints lack IP rate limiting | Medium | A07:2021 - Identification and Authentication Failures | SCRUM-72 / RATE-03, RATE-04 | Open | — |
| SEC-20 | `classes/join` and `classes/check-code` lack rate limiting on 24-bit invite code guesses | Medium | A04:2021 - Insecure Design | SCRUM-72 / RATE-05 | Open | — |
| SEC-21 | Default `trust proxy = 1` permits `X-Forwarded-For` rate-limit bypass on direct connections | Low | A05:2021 - Security Misconfiguration | SCRUM-72 / RATE-08 | Open | — |
| SEC-22 | In-memory `MemoryStore` limiters & un-pruned resend cooldown `Map` reset on restart and do not scale across instances | Low | A05:2021 - Security Misconfiguration | SCRUM-72 / RATE-09 | Open | — |

---

## Detailed Findings

### SEC-01 — Bulk quiz score upload writes scores for un-enrolled / foreign students
- **ID:** `SEC-01`
- **Title:** Bulk quiz score upload writes scores for un-enrolled / foreign students
- **Severity:** High
- **OWASP category:** `A01:2021 - Broken Access Control`
- **Found in:** `SCRUM-70` / `AUTHZ-08` ([`scrum70-authz.test.cjs`](../../../tests/security/scrum70-authz.test.cjs))
- **Affected route or file:** [`classdex-backend/index.js`](../../../classdex-backend/index.js#L2939-L3016) (`PUT /api/quizzes/:sessionId/scores`, specifically lines `L2963-L3010`)
- **Steps to reproduce:**
  1. Authenticate as Faculty A owning an active class and quiz session (`sessionId`).
  2. Obtain the `StudentProfile.id` of an un-enrolled student (`stuB1`) belonging to Faculty B's class or outside Faculty A's class.
  3. Send `PUT /api/quizzes/:sessionId/scores` with `{ scores: [{ studentId: "<stuB1.studentProfile.id>", score: 9 }] }`.
- **Expected vs Actual:**
  - *Expected:* Request rejects with HTTP `400` or `404` because `studentId` does not have an `APPROVED` `ClassEnrollment` in `session.classId` (matching single-score `PUT /api/quizzes/:sessionId/scores/:studentId` at `L3025`), and writes zero `QuizScore` rows.
  - *Actual:* Server returns HTTP `200` and upserts a `QuizScore` row (`score: 9`) linking Faculty A's quiz session to the un-enrolled student's `StudentProfile.id`.
- **Impact:** Any authenticated faculty member knowing or guessing another student's profile CUID can inject quiz score records linked to arbitrary students outside their class (and cause those records to surface if foreign-key associations are queried).
- **Status:** `Open`
- **Fix commit:** `—`

---

### SEC-02 — Activity & project single-score endpoints allow scoring unapproved enrollments
- **ID:** `SEC-02`
- **Title:** Activity & project single-score endpoints allow scoring unapproved enrollments
- **Severity:** High
- **OWASP category:** `A01:2021 - Broken Access Control`
- **Found in:** `SCRUM-70` / `AUTHZ-08` ([`scrum70-authz.test.cjs`](../../../tests/security/scrum70-authz.test.cjs))
- **Affected route or file:** [`classdex-backend/index.js`](../../../classdex-backend/index.js#L4152-L4161) (`PUT /api/activities/:id/scores/:studentId`) and [`classdex-backend/index.js`](../../../classdex-backend/index.js#L4434-L4443) (`PUT /api/projects/:id/scores/:studentId`)
- **Steps to reproduce:**
  1. Authenticate as Faculty A owning a class that has a student enrollment in `PENDING` (or `DECLINED` / `DROPPED`) status.
  2. Send `PUT /api/activities/:id/scores/:studentId` with `{ score: 10 }` for the `PENDING` student.
  3. Send `PUT /api/projects/:id/scores/:studentId` with `{ score: 45, sessionId: null }` for the `PENDING` student.
- **Expected vs Actual:**
  - *Expected:* Enrollment lookup requires `status: "APPROVED"` (consistent with `PUT /api/quizzes/:sessionId/scores/:studentId` at `L3025`); unapproved enrollments reject with HTTP `404` or `409`.
  - *Actual:* Both endpoints query `classEnrollment.findFirst({ where: { classId, studentProfileId } })` without filtering `status: "APPROVED"`, returning HTTP `200` and persisting `ActivityScore` / `ProjectScore` rows for `PENDING`, `DECLINED`, or `DROPPED` enrollments.
- **Impact:** Allows writing and persisting gradebook records for students who are not approved members of the class (including students whose request was declined or still unapproved), bypassing enrollment state boundaries.
- **Status:** `Open`
- **Fix commit:** `—`

---

### SEC-03 — Student photo endpoint exposes photos on DECLINED enrollments and via arbitrary roster probe
- **ID:** `SEC-03`
- **Title:** Student photo endpoint exposes photos on DECLINED enrollments and via arbitrary roster probe
- **Severity:** High
- **OWASP category:** `A01:2021 - Broken Access Control`
- **Found in:** `SCRUM-70` / `AUTHZ-10` ([`scrum70-authz.test.cjs`](../../../tests/security/scrum70-authz.test.cjs))
- **Affected route or file:** [`classdex-backend/index.js`](../../../classdex-backend/index.js#L3081-L3094) (`GET /api/students/:profileId/photo`)
- **Steps to reproduce:**
  1. **DECLINED enrollment vector:** Student A requests to join Faculty A's class and Faculty A clicks Decline (`status = "DECLINED"`). Faculty A still requests `GET /api/students/:profileId/photo` and receives HTTP `200` with image bytes.
  2. **Arbitrary roster ID probe vector:** Faculty A creates a class and calls `POST /api/classes/:id/roster` containing an arbitrary 7-digit `studentId` (e.g., Faculty B's student `stuB1`, who never joined or applied to Faculty A's class), then requests `GET /api/students/:stuB1ProfileId/photo`.
- **Expected vs Actual:**
  - *Expected:* Only the student themselves or an instructor of a class where the student holds an `APPROVED` (or permitted historical `DROPPED`) enrollment may retrieve the student's photo. Merely having a 7-digit `studentId` string typed into an unrelated class's `ClassRoster` table or holding a `DECLINED` enrollment must return HTTP `403` / `404`.
  - *Actual:* `GET /api/students/:profileId/photo` (`L3082-L3091`) checks `{ enrollments: { some: { studentProfileId } } }` without status filtering AND `{ roster: { some: { studentId } } }`, returning HTTP `200` with image bytes in both cases.
- **Impact:** Any authenticated faculty member can harvest any student's uploaded profile photo without consent or enrollment simply by inserting a guessed/known 7-digit student ID into a dummy class roster (and retains photo access after declining a student).
- **Status:** `Open`
- **Fix commit:** `—`

---

### SEC-04 — Pending student enrollment can read class metadata and query classwork endpoint before approval
- **ID:** `SEC-04`
- **Title:** Pending student enrollment can read class metadata and query classwork endpoint before approval
- **Severity:** Medium
- **OWASP category:** `A01:2021 - Broken Access Control`
- **Found in:** `SCRUM-70` / `AUTHZ-05` ([`scrum70-authz.test.cjs`](../../../tests/security/scrum70-authz.test.cjs))
- **Affected route or file:** [`classdex-backend/index.js`](../../../classdex-backend/index.js#L5330-L5439) (`GET /api/student/classes/:classId/records`, specifically `L5348` and `L5364-L5410`)
- **Steps to reproduce:**
  1. Authenticate as `stuPendingA`, who submitted `POST /api/classes/join` for Faculty A's class (`status: "PENDING"` — not yet approved).
  2. Call `GET /api/student/classes/:classId/records`.
- **Expected vs Actual:**
  - *Expected:* Pending students must not receive full class details or query classwork tables until instructor approval (either HTTP `403` or a minimal status-only payload without description, schedule, faculty details, or record arrays).
  - *Actual:* Server returns HTTP `200` with `classCode`, `description`, `schedule`, `faculty.name`, and executes queries across all five coursework tables (`attendance`, `recitations`, `activities`, `projects`, `quizzes`). *(Note: `StudentDashboard.jsx` and `StudentClassRecord.jsx` currently link `PENDING` cards to display a `"Waiting for instructor approval"` view using this endpoint; fix in `SCRUM-74` should coordinate frontend compatibility.)*
- **Impact:** A student holding an unapproved class code exposes internal class metadata (full description, schedule, instructor name) prior to instructor authorization.
- **Status:** `Open`
- **Fix commit:** `—`

---

### SEC-05 — Declined student can bypass instructor rejection by resubmitting via class join
- **ID:** `SEC-05`
- **Title:** Declined student can bypass instructor rejection by resubmitting via class join
- **Severity:** Medium
- **OWASP category:** `A01:2021 - Broken Access Control`
- **Found in:** `SCRUM-70` / `AUTHZ-05` ([`scrum70-authz.test.cjs`](../../../tests/security/scrum70-authz.test.cjs))
- **Affected route or file:** [`classdex-backend/index.js`](../../../classdex-backend/index.js#L5477-L5526) (`POST /api/classes/join`, specifically `L5500-L5505`)
- **Steps to reproduce:**
  1. Instructor declines a student's join request (`classEnrollment.status = "DECLINED"`).
  2. Authenticate as the declined student (`stuDeclinedA`) and call `POST /api/classes/join` with the same `classCode`.
- **Expected vs Actual:**
  - *Expected:* Instructor's explicit `DECLINED` decision (and/or `DROPPED` status unless instructor re-adds/approves) must be enforced, rejecting self-resubmission with HTTP `403` or `409`.
  - *Actual:* Server returns HTTP `201` (`kind: "resubmitted"`) and overwrites `ClassEnrollment.status` from `DECLINED` back to `PENDING` (or even `APPROVED` if the ID happens to sit on the roster), flooding the instructor's pending queue and negating the decline action.
- **Impact:** Rejected users can repeatedly re-enter a class's pending approval queue without instructor consent or approval reset.
- **Status:** `Open`
- **Fix commit:** `—`

---

### SEC-06 — Unverified email accounts retain full API access to faculty and student mutations
- **ID:** `SEC-06`
- **Title:** Unverified email accounts retain full API access to faculty and student mutations
- **Severity:** Medium
- **OWASP category:** `A07:2021 - Identification and Authentication Failures`
- **Found in:** `SCRUM-70` / `AUTHZ-13` ([`scrum70-authz.test.cjs`](../../../tests/security/scrum70-authz.test.cjs))
- **Affected route or file:** [`classdex-backend/index.js`](../../../classdex-backend/index.js#L257-L262) (`requireAuth`), [`L738-L756`](../../../classdex-backend/index.js#L738-L756) (`POST /api/auth/register`) — `emailVerified` is only checked in `/api/auth/resend-verification` (`L1188`), never gated on mutations.
- **Steps to reproduce:**
  1. Register a brand-new account (`emailVerified: false`) without opening the verification email link.
  2. Immediately call `POST /api/classes` (Faculty) or `PUT /api/student/profile` / `POST /api/classes/join` (Student).
- **Expected vs Actual:**
  - *Expected (strict):* Sensitive class creation, roster management, and enrollment mutations are gated until email ownership is verified (HTTP `403`), allowing only profile/status/resend flows while unverified.
  - *Actual:* Newly registered unverified accounts receive a full authenticated session immediately and can create classes, manage rosters, export data, and join classes (`201`/`200`). UI currently displays an informational `EmailVerificationBanner.jsx` (and Sprint 6.1 `AUTH-08` verifies banner UX).
- **Impact:** Allows unverified/disposable or typoed email addresses to create active classes or join requests before email ownership is confirmed. Requires product owner decision on whether banner-only UX is intended or API actions should be gated.
- **Status:** `Needs decision`
- **Fix commit:** `—`

---

### SEC-07 — Public registration permits unrestricted self-selection of FACULTY role
- **ID:** `SEC-07`
- **Title:** Public registration permits unrestricted self-selection of FACULTY role
- **Severity:** Medium
- **OWASP category:** `A04:2021 - Insecure Design`
- **Found in:** `SCRUM-70` / `AUTHZ-12` ([`scrum70-authz.test.cjs`](../../../tests/security/scrum70-authz.test.cjs))
- **Affected route or file:** [`classdex-backend/index.js`](../../../classdex-backend/index.js#L704-L746) (`POST /api/auth/register`, `L713`, `L725-L729`)
- **Steps to reproduce:**
  1. Send `POST /api/auth/register` with an arbitrary external email address (e.g., `qa_student@example.test`) and `{ role: "FACULTY" }`.
- **Expected vs Actual:**
  - *Expected (strict):* Faculty role assignment requires an institutional email domain check, faculty invite code, or administrator approval before granting Faculty privileges.
  - *Actual:* Any public registrant can pass `role: "FACULTY"` with any email domain and immediately receive a `FACULTY` account (`HTTP 201`) with permission to create classes and use faculty features (cannot access other faculty classes due to tenant isolation, `AUTHZ-06`/`07`, though combined with `SEC-03` creates cross-student photo probing risk).
- **Impact:** Unvetted users or students can self-provision `FACULTY` accounts without institutional verification or invite authorization. Marked `Needs decision` per Sprint 6.2 specification so the owner can confirm whether open faculty registration is accepted by design or requires domain/invite restrictions.
- **Status:** `Needs decision`
- **Fix commit:** `—`

---

### SEC-08 — Class code availability check applies `excludeId` globally without ownership scoping
- **ID:** `SEC-08`
- **Title:** Class code availability check applies `excludeId` globally without ownership scoping
- **Severity:** Low
- **OWASP category:** `A01:2021 - Broken Access Control`
- **Found in:** `SCRUM-70` / `AUTHZ-09` ([`scrum70-authz.test.cjs`](../../../tests/security/scrum70-authz.test.cjs))
- **Affected route or file:** [`classdex-backend/index.js`](../../../classdex-backend/index.js#L1805-L1828) (`GET /api/classes/check-code`, specifically `L1816-L1822`)
- **Steps to reproduce:**
  1. Authenticate as Faculty A (`facA`).
  2. Call `GET /api/classes/check-code?code=<facBClass1.classCode>&excludeId=<facBClass1.id>` (using Faculty B's class ID).
  3. Compare response `{ available: true }` vs `{ available: false }` when `excludeId` is omitted or mismatched.
- **Expected vs Actual:**
  - *Expected:* `excludeId` only excludes classes owned by `req.session.userId` (or non-owned `excludeId` is ignored/rejected), returning `{ available: false }` for Faculty B's class code regardless of `excludeId`.
  - *Actual:* `prisma.class.findFirst` applies `id: { not: excludeId }` without `facultyId: req.session.userId`, returning `{ available: true }` only when `code` and `excludeId` belong to the exact same foreign class.
- **Impact:** Minor IDOR / association oracle allowing one faculty member to test whether a known `classId` corresponds to a specific join `classCode`.
- **Status:** `Open`
- **Fix commit:** `—`

---

### SEC-09 — Student photo endpoint distinguishes nonexistent vs unauthorized profile IDs (404 vs 403)
- **ID:** `SEC-09`
- **Title:** Student photo endpoint distinguishes nonexistent vs unauthorized profile IDs (404 vs 403)
- **Severity:** Low
- **OWASP category:** `A01:2021 - Broken Access Control`
- **Found in:** `SCRUM-70` / `AUTHZ-19` ([`scrum70-authz.test.cjs`](../../../tests/security/scrum70-authz.test.cjs))
- **Affected route or file:** [`classdex-backend/index.js`](../../../classdex-backend/index.js#L3063-L3098) (`GET /api/students/:profileId/photo`, specifically `L3075-L3077` vs `L3092-L3097`)
- **Steps to reproduce:**
  1. Authenticate as Faculty A (or unrelated Student).
  2. Request `GET /api/students/clnonexistentprofile99/photo` -> HTTP `404`.
  3. Request `GET /api/students/<stuUnrelated.studentProfile.id>/photo` (valid existing profile with photo outside caller's classes) -> HTTP `403`.
- **Expected vs Actual:**
  - *Expected:* Return consistent HTTP `404` when caller is unauthorized or profile/photo does not exist (matching class endpoints in `AUTHZ-19a`), avoiding existence disclosure.
  - *Actual:* Profile photo lookup runs before authorization (`L3065-L3077`), returning `404` for nonexistent/photoless profiles and `403` for existing un-authorized student profiles with a photo.
- **Impact:** Existence oracle confirming whether a given `StudentProfile.id` exists and has an uploaded photo.
- **Status:** `Open`
- **Fix commit:** `—`

---

### SEC-10 — Profile photo endpoints lack faculty validation, image magic-byte checks, and external URL allowlisting
- **ID:** `SEC-10`
- **Title:** Profile photo endpoints lack faculty validation, image magic-byte checks, and external URL allowlisting
- **Severity:** Medium
- **OWASP category:** `A03:2021 - Injection`
- **Found in:** `SCRUM-71` / `INJ-10` ([`scrum71-input.test.cjs`](../../../tests/security/scrum71-input.test.cjs))
- **Affected route or file:** [`classdex-backend/index.js`](../../../classdex-backend/index.js#L1398-L1427) (`PUT /api/faculty/profile`), [`classdex-backend/index.js`](../../../classdex-backend/index.js#L278-L285) (`isValidPhoto`), [`classdex-backend/index.js`](../../../classdex-backend/index.js#L3100-L3103) (`GET /api/students/:profileId/photo`)
- **Steps to reproduce:**
  1. Authenticate as Faculty A and send `PUT /api/faculty/profile` with `photo: "javascript:alert(1)"`, `"data:image/svg+xml;base64,..."`, or `"http://evil.example/a.jpg"`.
  2. Authenticate as Student A1 and send `PUT /api/student/profile` with `photo: "data:image/jpeg;base64,<base64 of HTML script>"` or `photo: "https://evil.example/phish.html"`.
  3. Request `GET /api/students/:profileId/photo` as the student or enrolled faculty.
- **Expected vs Actual:**
  - *Expected:* Both profile endpoints validate `photo` strictly against real JPEG/PNG/WebP image magic bytes or allowlisted HTTPS CDN URLs (`res.cloudinary.com`), rejecting `javascript:`, `data:image/svg+xml`, spoofed MIME types, `http://`, and arbitrary third-party domains with HTTP `400`.
  - *Actual:* `PUT /api/faculty/profile` omits `isValidPhoto` entirely (`HTTP 200`); `isValidPhoto` on student profiles trusts the base64 MIME header without inspecting magic bytes and permits any `https://\S+` domain, causing `GET /api/students/:profileId/photo` (`L3102`) to respond with `302 Found` open redirect to arbitrary external hosts. (React's [`Avatar.jsx`](../../../classdex-frontend/src/components/Avatar.jsx#L24-L35) blocks `javascript:` rendering, limiting direct browser XSS in UI views, while leaving API open redirect, tracking-pixel leakage, and direct-endpoint spoofed-MIME serving open.)
- **Impact:** Allows storing untrusted URLs/SVGs in profile photos, serving spoofed HTML payloads under `image/jpeg`, and turning `GET /api/students/:profileId/photo` into an open redirect / tracking vector.
- **Status:** `Open`
- **Fix commit:** `—`

---

### SEC-11 — CSV & XLSX spreadsheet exports fail to neutralize leading tab, carriage return, and whitespace formulas
- **ID:** `SEC-11`
- **Title:** CSV & XLSX spreadsheet exports fail to neutralize leading tab, carriage return, and whitespace formulas
- **Severity:** Medium
- **OWASP category:** `A03:2021 - Injection`
- **Found in:** `SCRUM-71` / `INJ-12` ([`scrum71-input.test.cjs`](../../../tests/security/scrum71-input.test.cjs))
- **Affected route or file:** [`classdex-backend/export.js`](../../../classdex-backend/export.js#L126-L129) (`sanitizeExportValue`), used by `GET /api/classes/:id/export/csv`, `GET /api/classes/:id/export/excel`, and [`classdex-backend/index.js`](../../../classdex-backend/index.js#L2331-L2345) (`GET /api/classes/:id/roster/template`)
- **Steps to reproduce:**
  1. Enroll or create student/roster records whose names begin with `\t=1+1`, `\r=1+1`, or ` =1+1`.
  2. Export `GET /api/classes/:id/export/csv?types=students` and `GET /api/classes/:id/export/excel?types=students`.
- **Expected vs Actual:**
  - *Expected:* All formula-injection triggers (including leading `\t`, `\r`, `\n`, and leading whitespace followed by `=`, `+`, `-`, `@`) are neutralized with a leading apostrophe (or stripped control prefix) across both CSV and XLSX outputs.
  - *Actual:* `sanitizeExportValue` only matches `/^[=+\-@]/`, leaving `\t=1+1`, `\r=1+1`, and ` =1+1` unprefixed in exported CSV rows and XLSX `<v>` string cells (while `=`, `+`, `-`, `@` at column 0 are prefixed cleanly).
- **Impact:** Spreadsheet software (Excel / LibreOffice / Google Sheets) that trims leading tabs, carriage returns, or whitespace can still evaluate exported cells as active DDE/spreadsheet formulas when faculty open exported class files.
- **Status:** `Open`
- **Fix commit:** `—`

---

### SEC-12 — Numeric quiz/activity boundaries allow INT4 overflow (HTTP 500) and non-number string/boolean coercion
- **ID:** `SEC-12`
- **Title:** Numeric quiz/activity boundaries allow INT4 overflow (HTTP 500) and non-number string/boolean coercion
- **Severity:** Low
- **OWASP category:** `A03:2021 - Injection`
- **Found in:** `SCRUM-71` / `INJ-04` ([`scrum71-input.test.cjs`](../../../tests/security/scrum71-input.test.cjs))
- **Affected route or file:** [`classdex-backend/index.js`](../../../classdex-backend/index.js#L2907-L2920) (`POST /api/classes/:id/quizzes`, `PATCH /api/quizzes/:sessionId`), [`classdex-backend/index.js`](../../../classdex-backend/index.js#L2954-L3020) (`PUT /api/quizzes/:sessionId/scores*`), [`classdex-backend/gradebook.js`](../../../classdex-backend/gradebook.js)
- **Steps to reproduce:**
  1. Send `POST /api/classes/:id/quizzes` with `{ title: "qa_OverflowQuiz", totalItems: 99999999999 }`.
  2. Send `PUT /api/quizzes/:sessionId/scores/:studentId` with `{ score: "10" }`.
- **Expected vs Actual:**
  - *Expected:* Reject integers above PostgreSQL `INT4` / sensible domain caps and reject non-number types (`typeof score !== "number"`) cleanly with HTTP `400`.
  - *Actual:* `Number.isInteger(99999999999)` passes check (`>= 1`) and crashes inside `prisma.quizSession.create` with HTTP `500` (`INT4` overflow); `Number(req.body?.score)` silently coerces `"10"` (and `true` -> `1`) instead of returning HTTP `400`.
- **Impact:** Missing upper-bound and strict number-type checks trigger unnecessary server `500` errors and permit unintended JSON type coercion on scores.
- **Status:** `Open`
- **Fix commit:** `—`

---

### SEC-13 — Roster import crashes on non-string `fileBase64` (HTTP 500) and parses disguised HTML inside `.xlsx`
- **ID:** `SEC-13`
- **Title:** Roster import crashes on non-string `fileBase64` (HTTP 500) and parses disguised HTML inside `.xlsx`
- **Severity:** Low
- **OWASP category:** `A03:2021 - Injection`
- **Found in:** `SCRUM-71` / `INJ-09` ([`scrum71-input.test.cjs`](../../../tests/security/scrum71-input.test.cjs))
- **Affected route or file:** [`classdex-backend/index.js`](../../../classdex-backend/index.js#L2391-L2411) (`POST /api/classes/:id/roster/import`)
- **Steps to reproduce:**
  1. Send `POST /api/classes/:id/roster/import` with `{ fileName: "test.csv", fileBase64: { "$gt": "" } }`.
  2. Send `POST /api/classes/:id/roster/import` with `{ fileName: "roster.html.xlsx", fileBase64: "<base64 of HTML <table>>" }`.
- **Expected vs Actual:**
  - *Expected:* Reject non-string `fileBase64` with HTTP `400` and validate ZIP (`PK\x03\x04`) / OLE magic bytes for `.xlsx`/`.xls` files before invoking SheetJS `XLSX.read`.
  - *Actual:* Object `fileBase64` throws `TypeError [ERR_INVALID_ARG_TYPE]` at `Buffer.from(fileBase64, "base64")` (`L2401`) returning HTTP `500`, and disguised HTML inside `.xlsx` bypasses extension-only checks via SheetJS polyglot parsing (`HTTP 200`).
- **Impact:** Unhandled type error `500` on malformed JSON input and bypass of file-content expectations when non-OOXML documents are uploaded with an `.xlsx` extension.
- **Status:** `Open`
- **Fix commit:** `—`

---

### SEC-14 — Null bytes (`\u0000`) trigger database HTTP 500 and text fields lack server-side length limits
- **ID:** `SEC-14`
- **Title:** Null bytes (`\u0000`) trigger database HTTP 500 and text fields lack server-side length limits
- **Severity:** Low
- **OWASP category:** `A03:2021 - Injection`
- **Found in:** `SCRUM-71` / `INJ-11` ([`scrum71-input.test.cjs`](../../../tests/security/scrum71-input.test.cjs))
- **Affected route or file:** [`classdex-backend/index.js`](../../../classdex-backend/index.js#L1866-L1995) (`POST /api/classes`), [`classdex-backend/index.js`](../../../classdex-backend/index.js#L273-L276) (`optionalText`)
- **Steps to reproduce:**
  1. Send `POST /api/classes` with `{ sectionName: "qa_Null\u0000Byte", courseCode: "QA-NULL1", courseTitle: "qa_NullByte" }`.
  2. Send `POST /api/classes` with a `100,000`-character `sectionName`.
- **Expected vs Actual:**
  - *Expected:* Input middleware/validation rejects ASCII `\u0000` null bytes and oversized text fields (`> 200`–`2,000` chars per field) with HTTP `400` before reaching Prisma/PostgreSQL.
  - *Actual:* PostgreSQL rejects `\u0000` with `P2039 / 22021: invalid byte sequence for encoding "UTF8": 0x00` resulting in HTTP `500`, and `100KB` text strings are persisted into `Class` fields (`HTTP 201`).
- **Impact:** Unhandled `500` database exceptions on null-byte inputs and database/UI bloat from unbounded text fields up to the 8 MB JSON payload limit.
- **Status:** `Open`
- **Fix commit:** `—`

---

### SEC-15 — Non-string JSON objects and arrays coerce to `"[object Object]"` in class and profile text fields
- **ID:** `SEC-15`
- **Title:** Non-string JSON objects and arrays coerce to `"[object Object]"` in class and profile text fields
- **Severity:** Low
- **OWASP category:** `A03:2021 - Injection`
- **Found in:** `SCRUM-71` / `INJ-03` ([`scrum71-input.test.cjs`](../../../tests/security/scrum71-input.test.cjs))
- **Affected route or file:** [`classdex-backend/index.js`](../../../classdex-backend/index.js#L273-L276) (`optionalText`), [`L1408-L1420`](../../../classdex-backend/index.js#L1408-L1420) (`PUT /api/faculty/profile`), [`L1866-L1988`](../../../classdex-backend/index.js#L1866-L1988) (`POST /api/classes`)
- **Steps to reproduce:**
  1. Send `POST /api/classes` with `{ sectionName: { "$gt": "" }, courseCode: "QA-OBJ1", courseTitle: "qa_ValidCourseTitle" }`.
  2. Send `PUT /api/faculty/profile` with `{ name: { "$gt": "" }, department: ["qa_IT"] }`.
- **Expected vs Actual:**
  - *Expected:* Validate `typeof field === "string"` and reject objects/arrays on text fields with HTTP `400`.
  - *Actual:* `String(value || "").trim()` converts `{ "$gt": "" }` into the literal string `"[object Object]"` and persists it with HTTP `201`/`200` (Prisma ignores operator injection in scalar strings, so no query bypass occurs, but data integrity fails).
- **Impact:** Corrupted `"[object Object]"` records stored on type-confused requests instead of returning HTTP `400`.
- **Status:** `Open`
- **Fix commit:** `—`

---

### SEC-16 — Missing Express error middleware leaks HTML stack traces on malformed JSON in non-production mode
- **ID:** `SEC-16`
- **Title:** Missing Express error middleware leaks HTML stack traces on malformed JSON in non-production mode
- **Severity:** Low
- **OWASP category:** `A05:2021 - Security Misconfiguration`
- **Found in:** `SCRUM-71` / `INJ-13` ([`scrum71-input.test.cjs`](../../../tests/security/scrum71-input.test.cjs))
- **Affected route or file:** [`classdex-backend/index.js`](../../../classdex-backend/index.js#L176) (`app.use(express.json({ limit: "8mb" }))`), [`L5578-L5583`](../../../classdex-backend/index.js#L5578-L5583) (no 4-arg `(err, req, res, next)` middleware defined)
- **Steps to reproduce:**
  1. Send `POST /api/auth/login` with `Content-Type: application/json` and invalid raw body `{bad-json` under test/development `NODE_ENV`.
- **Expected vs Actual:**
  - *Expected:* Custom Express error middleware returns consistent JSON (`{ message: "Invalid JSON request body." }` for `entity.parse.failed`, `{ message: "Payload too large." }` for `413`, generic `500` JSON otherwise) with zero stack traces or server paths in any environment.
  - *Actual:* Under `NODE_ENV=production` (`INJ-13a`), Express's built-in finalhandler hides stack traces cleanly (returning `"Bad Request"` HTML), whereas under dev/test `NODE_ENV` (`INJ-13b`), Express returns an HTML page containing the full `SyntaxError` stack trace and local server filesystem paths.
- **Impact:** Exposes local server filesystem paths and library stack frames when running outside `NODE_ENV=production`, and returns HTML instead of JSON API error bodies on parser failures.
- **Status:** `Open`
- **Fix commit:** `—`

---

### SEC-17 — `POST /api/auth/login` lacks per-IP and per-account brute-force rate limiting
- **ID:** `SEC-17`
- **Title:** `POST /api/auth/login` lacks per-IP and per-account brute-force rate limiting
- **Severity:** Medium
- **OWASP category:** `A07:2021 - Identification and Authentication Failures`
- **Found in:** `SCRUM-72` / `RATE-01` ([`scrum72-rate.test.cjs`](../../../tests/security/scrum72-rate.test.cjs))
- **Affected route or file:** [`classdex-backend/index.js`](../../../classdex-backend/index.js#L763-L822) (`POST /api/auth/login`)
- **Steps to reproduce:**
  1. Send `30` consecutive wrong-password login requests against a single account (`fx.stuA1.email`).
  2. Send `30` additional login requests across `30` distinct email addresses from the same IP.
- **Expected vs Actual:**
  - *Expected:* Login enforces per-IP and IP+email composite rate limiting returning HTTP `429` (without letting a remote attacker permanently lock out a legitimate user from other IPs).
  - *Actual:* All `60` login requests returned HTTP `401` with zero `429` rate-limit enforcement.
- **Impact:** Enables automated credential stuffing and password brute-force attacks bounded only by database/bcrypt latency.
- **Status:** `Open`
- **Fix commit:** `—`

---

### SEC-18 — Login skips `bcrypt.compare` on unknown emails, creating a ~478 ms user-enumeration timing oracle
- **ID:** `SEC-18`
- **Title:** Login skips `bcrypt.compare` on unknown emails, creating a ~478 ms user-enumeration timing oracle
- **Severity:** Medium
- **OWASP category:** `A07:2021 - Identification and Authentication Failures`
- **Found in:** `SCRUM-72` / `RATE-02` ([`scrum72-rate.test.cjs`](../../../tests/security/scrum72-rate.test.cjs))
- **Affected route or file:** [`classdex-backend/index.js`](../../../classdex-backend/index.js#L790-L796) (`POST /api/auth/login`)
- **Steps to reproduce:**
  1. Send `20` interleaved wrong-password `POST /api/auth/login` requests to an existing cost-12 registered user vs `20` non-existing email addresses after DB warmup.
  2. Measure median round-trip latencies.
- **Expected vs Actual:**
  - *Expected:* Both paths return identical `401` responses AND execute a constant-work dummy `bcrypt.compare` (cost 12) on nonexistent users so median latency stays indistinguishable (<40 ms variance).
  - *Actual:* Although both return identical `401 { "message": "Invalid email or password." }`, unknown accounts return immediately after the Prisma query (median `88.9 ms`), while existing accounts execute cost-12 `bcrypt.compare` (median `566.7 ms`, **`477.8 ms` delta**).
- **Impact:** Allows attackers to reliably distinguish registered vs unregistered faculty and student email addresses via response timing.
- **Status:** `Open`
- **Fix commit:** `—`

---

### SEC-19 — `register`, `verify-email`, and `reset-password*` endpoints lack IP rate limiting
- **ID:** `SEC-19`
- **Title:** `register`, `verify-email`, and `reset-password*` endpoints lack IP rate limiting
- **Severity:** Medium
- **OWASP category:** `A07:2021 - Identification and Authentication Failures`
- **Found in:** `SCRUM-72` / `RATE-03`, `RATE-04` ([`scrum72-rate.test.cjs`](../../../tests/security/scrum72-rate.test.cjs))
- **Affected route or file:** [`classdex-backend/index.js`](../../../classdex-backend/index.js#L704-L761) (`/register`), [`L922-L1040`](../../../classdex-backend/index.js#L922-L1040) (`/reset-password/validate`, `/reset-password`), [`L1101-L1175`](../../../classdex-backend/index.js#L1101-L1175) (`/verify-email`)
- **Steps to reproduce:**
  1. Send `15` rapid `POST /api/auth/register` requests (valid reCAPTCHA), `30` `POST /api/auth/verify-email` guesses, and `40` `/reset-password/validate` + `/reset-password` requests from one IP.
- **Expected vs Actual:**
  - *Expected:* All authentication/token/registration routes enforce IP rate limits returning HTTP `429` at abuse thresholds (complementing `forgotPasswordIpLimiter` / `changePasswordWrongCurrentLimiter` / `resend-verification` 60s cooldown which already pass).
  - *Actual:* All requests processed (`201`/`400`/`200`) with zero HTTP `429` throttling on `/register`, `/verify-email`, `/reset-password`, and `/reset-password/validate`.
- **Impact:** Permits unthrottled account registration bursts (and automated email verification traffic per new account) plus unthrottled token-lookup pressure on password-reset and email-verification endpoints.
- **Status:** `Open`
- **Fix commit:** `—`

---

### SEC-20 — `classes/join` and `classes/check-code` lack rate limiting on 24-bit invite code guesses
- **ID:** `SEC-20`
- **Title:** `classes/join` and `classes/check-code` lack rate limiting on 24-bit invite code guesses
- **Severity:** Medium
- **OWASP category:** `A04:2021 - Insecure Design`
- **Found in:** `SCRUM-72` / `RATE-05` ([`scrum72-rate.test.cjs`](../../../tests/security/scrum72-rate.test.cjs))
- **Affected route or file:** [`classdex-backend/index.js`](../../../classdex-backend/index.js#L5446-L5576) (`POST /api/classes/join`), [`L1805-L1829`](../../../classdex-backend/index.js#L1805-L1829) (`GET /api/classes/check-code`), [`L1451`](../../../classdex-backend/index.js#L1451) (`PUT /api/student/profile`)
- **Steps to reproduce:**
  1. Send `40` wrong 6-hex `classCode` guesses to `POST /api/classes/join` as an authenticated student.
  2. Send `40` probes to `GET /api/classes/check-code?code=...` as an authenticated faculty account (note: `check-code` requires no reCAPTCHA).
- **Expected vs Actual:**
  - *Expected:* Join and code-check endpoints rate-limit repeated invalid `classCode` probes per user/IP (HTTP `429`) and avoid oracle enumeration across the 24-bit (`16^6`) code space.
  - *Actual:* All `40` join guesses (`404`) and `40` code checks (`200`) succeeded with zero HTTP `429` throttling. Combined with unrestricted self-registration of `FACULTY` accounts (`SEC-07`), `/check-code` enables un-captchad enumeration of active join codes.
- **Impact:** Increases feasibility of discovering active 6-character hex join codes or spamming repeated invalid join/profile submissions.
- **Status:** `Open`
- **Fix commit:** `—`

---

### SEC-21 — Default `trust proxy = 1` permits `X-Forwarded-For` rate-limit bypass on direct connections
- **ID:** `SEC-21`
- **Title:** Default `trust proxy = 1` permits `X-Forwarded-For` rate-limit bypass on direct connections
- **Severity:** Low
- **OWASP category:** `A05:2021 - Security Misconfiguration`
- **Found in:** `SCRUM-72` / `RATE-08` ([`scrum72-rate.test.cjs`](../../../tests/security/scrum72-rate.test.cjs))
- **Affected route or file:** [`classdex-backend/index.js`](../../../classdex-backend/index.js#L101-L105) (`app.set("trust proxy", ...)`)
- **Steps to reproduce:**
  1. Exhaust `forgotPasswordIpLimiter` (`5` requests -> `6th` returns HTTP `429`) against localhost without `TRUST_PROXY` set.
  2. Send a `7th` request with header `X-Forwarded-For: 203.0.113.77`.
- **Expected vs Actual:**
  - *Expected:* When `TRUST_PROXY` is unset (local/direct deployments), Express uses `trust proxy = false` / `0` so client-supplied `X-Forwarded-For` cannot spoof `req.ip`. In production behind a reverse proxy (Render/Railway/Vercel), `TRUST_PROXY` must be set explicitly to the exact trusted hop count.
  - *Actual:* `trustProxyHops` falls back to `1`, trusting arbitrary `X-Forwarded-For` headers on direct connections and resetting `forgotPasswordIpLimiter` to `200 OK`.
- **Impact:** Enables IP rate-limit bypass whenever the server is accessed directly without an edge proxy overwriting `X-Forwarded-For`, and requires explicit Sprint 6.3 proxy hop configuration (note also shared NAT/campus IPs when keying strictly by IP).
- **Status:** `Open`
- **Fix commit:** `—`

---

### SEC-22 — In-memory `MemoryStore` limiters & un-pruned resend cooldown `Map` reset on restart and do not scale across instances
- **ID:** `SEC-22`
- **Title:** In-memory `MemoryStore` limiters & un-pruned resend cooldown `Map` reset on restart and do not scale across instances
- **Severity:** Low
- **OWASP category:** `A05:2021 - Security Misconfiguration`
- **Found in:** `SCRUM-72` / `RATE-09` ([`scrum72-rate.test.cjs`](../../../tests/security/scrum72-rate.test.cjs))
- **Affected route or file:** [`classdex-backend/index.js`](../../../classdex-backend/index.js#L115-L168) (`forgotPasswordIpStore`, `forgotPasswordEmailStore`, `changePasswordWrongCurrentStore`, `verifyResendCooldownByUser`)
- **Steps to reproduce:**
  1. Exhaust `forgotPasswordIpLimiter` (`429`) and inspect in-memory limiter stores across app restart / fresh process instance.
  2. Inspect `verifyResendCooldownByUser` (`Map`) growth in `L118, L1210`: timestamps are inserted per user and never pruned after expiry.
- **Expected vs Actual:**
  - *Expected:* Document shared store (e.g., Redis) for multi-instance production scaling and prune expired `verifyResendCooldownByUser` entries cleanly in-memory.
  - *Actual:* All rate-limit counters and cooldowns live in process memory (cleared on restart/redeploy, isolated per worker/dyno) and `verifyResendCooldownByUser` never sweeps expired keys.
- **Impact:** Rate limits reset on container restart and divide across multiple replicas in production (partially deferred to Sprint 6.3 infrastructure; in-memory Map pruning can be fixed in `SCRUM-74`).
- **Status:** `Open`
- **Fix commit:** `—`
