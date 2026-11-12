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
