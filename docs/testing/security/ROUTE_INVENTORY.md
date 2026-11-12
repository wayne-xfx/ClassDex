# ClassDex — Express Route & Authorization Inventory

**Source Files Audited:**
- [`classdex-backend/index.js`](../../../classdex-backend/index.js) (`69` production Express routes + global middleware)
- [`tests/e2e/support/e2e-backend.cjs`](../../../tests/e2e/support/e2e-backend.cjs) (`3` E2E test-harness endpoints)

---

## Summary Counts

| Category | Count | Notes |
|---|---|---|
| **Total inventoried routes** | **72** | `69` routes in `classdex-backend/index.js` + `3` test-only routes in `e2e-backend.cjs` |
| **Public / Unauthenticated routes (`index.js`)** | **8** | Health status (`1`), register/login/forgot-password (`3` with no session/token ownership), session-destroy logout (`1`), and token-bound validate/reset/verify (`3`) |
| **Authenticated routes (`index.js`)** | **61** | Protected via `requireAuth` and/or `enforceActiveClassMutationGuard` (`index.js:257`, `354`) |
| **Authenticated app routes lacking ANY ownership check** | **1** | `GET /api/classes/check-code` (`index.js:1805-1828`) queries all classes globally; `excludeId` is not scoped to `req.session.userId` |
| **Authenticated app routes missing an inner/nested ownership check** | **1** | `PUT /api/quizzes/:sessionId/scores` (`index.js:2939-3016`) verifies `session` ownership (`L2946`) but **does not verify** `body[].studentId` is enrolled in `session.classId` before `quizScore.upsert` (`L2986-3010`) |
| **Authenticated app routes with weakened enrollment-status scope** | **4** | `GET /api/students/:profileId/photo` (`L3086`, includes `PENDING`/`DECLINED` enrollments), `GET /api/student/classes/:classId/records` (`L5348`, includes `PENDING`), `PUT /api/activities/:id/scores/:studentId` (`L4152`) & `PUT /api/projects/:id/scores/:studentId` (`L4434`) (do not require `status: "APPROVED"`) |
| **E2E harness routes (`e2e-backend.cjs`) with no auth/ownership** | **3** | `GET /__e2e/emails`, `DELETE /__e2e/emails`, `POST /__e2e/reset-rate-limiters` — mounted only in test harness `e2e-backend.cjs:33-49`, never mounted in `index.js` |

> **Routes lacking an ownership check:** **12** routes have no user/resource ownership check at all (`1` authenticated app route `GET /api/classes/check-code` + `8` public/auth/session/token routes in `index.js` + `3` test-only `/__e2e/*` routes in `e2e-backend.cjs`), **plus `1`** authenticated route missing an inner `studentId` class-enrollment ownership check (`PUT /api/quizzes/:sessionId/scores`) and **`4`** authenticated routes with weakened enrollment-status gating (`PENDING`/`DECLINED` edge cases).

---

## Global Middleware (Pre-Route Execution)

| Order | Middleware | Location | Security Effect |
|---|---|---|---|
| 1 | `app.set("trust proxy", ...)` | `classdex-backend/index.js:101-105` | Defaults to `1` hop when `TRUST_PROXY` is unset |
| 2 | `cors({ origin: FRONTEND_ORIGIN, credentials: true })` | `classdex-backend/index.js:170-175` | Allows credentials from `FRONTEND_ORIGIN` (fallback `http://localhost:5173`) |
| 3 | `express.json({ limit: "8mb" })` | `classdex-backend/index.js:176` | Parses JSON bodies up to 8 MB |
| 4 | `express-session` (`MemoryStore`, `cookie.secure: false`, `httpOnly: true`, `sameSite: "lax"`) | `classdex-backend/index.js:177-190` | In-memory session store; dev secret fallback `"classdex-dev-session-secret"` |
| 5 | `enforceActiveClassMutationGuard` | `classdex-backend/index.js:308-468` | Intercepts `POST`/`PUT`/`PATCH`/`DELETE` under `/api/classes/join`, `/api/classes/:id*` (except `archive`/`restore`), `/api/sessions/:id*`, `/api/quizzes/:id*`, `/api/activities/:id*`, `/api/projects/:id*`, `/api/recitation-logs/:id*` -> runs `verifyAuthenticatedSession` (`401`), checks `role` (`403`), checks resource ownership (`404`), blocks archived classes (`409`) |

---

## Complete Route Table

### 1. System & Authentication (`index.js:700-1361`)

| # | Method | Path | Auth Required | Allowed Role(s) | Ownership / Scope Check (`file:line`) | Accepted ID Params |
|---|---|---|---|---|---|---|
| 1 | `GET` | `/api/status` | No | Public | None — public health check (`index.js:700`) | None |
| 2 | `POST` | `/api/auth/register` | No | Public (reCAPTCHA gated) | None — creates new `User` (`index.js:704-761`); caller selects `role` (`FACULTY`/`STUDENT`) | `body.email`, `body.role` |
| 3 | `POST` | `/api/auth/login` | No | Public | Password comparison against email-matched `User` (`index.js:763-822`) | `body.email` |
| 4 | `POST` | `/api/auth/logout` | No | Public / Session caller | Destroys caller's own session cookie (`index.js:824-833`) | Session cookie (`classdex.sid`) |
| 5 | `POST` | `/api/auth/forgot-password` | No | Public (rate-limited + reCAPTCHA) | None — looks up `body.email` and emails hashed reset token silently (`index.js:835-893`) | `body.email` |
| 6 | `GET` | `/api/auth/reset-password/validate` | No | Public | Token-possessor check via SHA-256 `tokenHash` lookup (`index.js:901-933`) | `query.token` |
| 7 | `POST` | `/api/auth/reset-password` | No | Public | Token-possessor atomic claim on `PasswordResetToken` + updates token `userId` (`index.js:935-1040`) | `body.token` |
| 8 | `POST` | `/api/auth/verify-email` | No | Public | Token-possessor atomic claim on `EmailVerificationToken` + updates token `userId` (`index.js:1101-1175`) | `body.token` |
| 9 | `POST` | `/api/auth/resend-verification` | Yes | `FACULTY`, `STUDENT` | Self-scoped: `where: { id: req.session.userId }` (`index.js:1177-1221`) | None |
| 10 | `POST` | `/api/auth/change-password` | Yes | `FACULTY`, `STUDENT` | Self-scoped: `where: { id: req.session.userId }` + current password (`index.js:1223-1341`) | None |
| 11 | `GET` | `/api/auth/me` | Yes | `FACULTY`, `STUDENT` | Self-scoped: `where: { id: req.session.userId }` (`index.js:1343-1361`) | None |

### 2. Profiles & Photos (`index.js:1363-1589, 3063-3131`)

| # | Method | Path | Auth Required | Allowed Role(s) | Ownership / Scope Check (`file:line`) | Accepted ID Params |
|---|---|---|---|---|---|---|
| 12 | `GET` | `/api/faculty/profile` | Yes | `FACULTY` | Self-scoped: `where: { userId: req.session.userId }` (`index.js:1371`) | `query.summary` |
| 13 | `PUT` | `/api/faculty/profile` | Yes | `FACULTY` | Self-scoped: `where: { userId: req.session.userId }` (`index.js:1405, 1407`) | None |
| 14 | `GET` | `/api/student/profile` | Yes | `STUDENT` | Self-scoped: `where: { userId: req.session.userId }` (`index.js:1437`) | None |
| 15 | `PUT` | `/api/student/profile` | Yes | `STUDENT` | Self-scoped: `where: { userId: req.session.userId }` (`index.js:1508, 1513, 1515`) | `body.studentId` (7-digit) |
| 41 | `GET` | `/api/students/:profileId/photo` | Yes | `FACULTY`, `STUDENT` | Self (`profile.userId === req.session.userId`, `L3079`) OR `FACULTY` owning class with `{ enrollments: { some: { studentProfileId } } }` or `{ roster: { some: { studentId } } }` (`L3081-3098`) *(Weakness: allows faculty access for `PENDING`/`DECLINED` enrollments too)* | `params.profileId` |

### 3. Faculty Class Management, Roster, Pending & Notifications (`index.js:1591-2851, 3037-3061, 3133-3869`)

| # | Method | Path | Auth Required | Allowed Role(s) | Ownership / Scope Check (`file:line`) | Accepted ID Params |
|---|---|---|---|---|---|---|
| 16 | `GET` | `/api/faculty/classes` | Yes | `FACULTY` | Self-scoped: `where: { facultyId: req.session.userId }` (`index.js:1598`) | None |
| 17 | `GET` | `/api/faculty/classes/pending-counts` | Yes | `FACULTY` | Self-scoped: `facultyId: req.session.userId` (`L1732`) & parameterized `$queryRaw` `WHERE class_record."facultyId" = ${req.session.userId}` (`L1755`) | None |
| 18 | `GET` | `/api/classes/check-code` | Yes | `FACULTY` | **NONE** — global lookup `{ classCode, id: { not: excludeId } }` without `facultyId` check (`index.js:1816-1822`) | `query.code`, `query.excludeId` |
| 19 | `POST` | `/api/classes` | Yes | `FACULTY` | Sets `facultyId: req.session.userId` (`index.js:1986`) | `body.classCode` |
| 20 | `GET` | `/api/classes/:id/roster` | Yes | `FACULTY` | `findOwnedClass(req.params.id, req.session.userId)` (`index.js:2028`) | `params.id` |
| 21 | `POST` | `/api/classes/:id/roster` | Yes | `FACULTY` | Guard (`L396-403`) + `findOwnedClass(req.params.id, req.session.userId)` (`index.js:2048`) | `params.id`, `body.entries[].studentId` |
| 22 | `PATCH` | `/api/classes/:id/roster/:entryId` | Yes | `FACULTY` | Guard (`L396-403`) + `findOwnedClass` (`L2101`) + `{ id: req.params.entryId, classId: req.params.id }` (`L2104`) | `params.id`, `params.entryId`, `body.studentId` |
| 23 | `GET` | `/api/classes/:id/roster/:entryId/impact` | Yes | `FACULTY` | `findOwnedClass` (`L2133`) + `{ id: req.params.entryId, classId: req.params.id }` (`L2135`) | `params.id`, `params.entryId` |
| 24 | `DELETE` | `/api/classes/:id/roster/:entryId` | Yes | `FACULTY` | Guard (`L396-403`) + `findOwnedClass` (`L2162`) + `{ id: req.params.entryId, classId: req.params.id }` (`L2164`) | `params.id`, `params.entryId` |
| 25 | `GET` | `/api/classes/:id/drop-list` | Yes | `FACULTY` | `findOwnedClass(req.params.id, req.session.userId)` (`index.js:2216`) | `params.id` |
| 26 | `POST` | `/api/classes/:id/drop-list/:entryId/restore` | Yes | `FACULTY` | Guard (`L396-403`) + `findOwnedClass` (`L2272`) + `{ id: req.params.entryId, classId: req.params.id }` (`L2274`) | `params.id`, `params.entryId` |
| 27 | `GET` | `/api/classes/:id/roster/template` | Yes | `FACULTY` | `where: { id: req.params.id, facultyId: req.session.userId }` (`index.js:2311`) | `params.id` |
| 28 | `POST` | `/api/classes/:id/roster/import` | Yes | `FACULTY` | Guard (`L396-403`) + `findOwnedClass(req.params.id, req.session.userId)` (`index.js:2387`) | `params.id` |
| 29 | `GET` | `/api/classes/:id/pending` | Yes | `FACULTY` | `where: { id: req.params.id, facultyId: req.session.userId }` (`index.js:2547`) | `params.id` |
| 30 | `POST` | `/api/classes/:id/notifications/read` | Yes | `FACULTY` | Guard (`L396-403`) + `where: { id: req.params.id, facultyId: req.session.userId }` (`index.js:2624`) | `params.id` |
| 31 | `POST` | `/api/classes/:id/absence-warnings/:studentId/read` | Yes | `FACULTY` | Guard (`L396-403`) + `{ classId: :id, status: "APPROVED", studentProfileId: :studentId, class: { is: { facultyId } } }` (`L2667-2674`) | `params.id`, `params.studentId` |
| 32 | `POST` | `/api/classes/:id/absence-warnings/:studentId/dismiss` | Yes | `FACULTY` | Guard (`L396-403`) + `findOwnedClass` (`L2702`) + `classEnrollment.findFirst({ classId, studentProfileId, status: "APPROVED" })` (`L2706-2712`) | `params.id`, `params.studentId` |
| 33 | `PATCH` | `/api/classes/:id/pending/:enrollmentId` | Yes | `FACULTY` | Guard (`L396-403`) + `{ id: :id, facultyId }` (`L2745`) + `{ id: :enrollmentId, classId: :id, status: "PENDING" }` (`L2751`) | `params.id`, `params.enrollmentId` |
| 40 | `GET` | `/api/classes/:id` | Yes | `FACULTY` | `where: { id: req.params.id, facultyId: req.session.userId }` (`index.js:3044`) | `params.id` |
| 42 | `GET` | `/api/classes/:id/deck` | Yes | `FACULTY` | `where: { id: req.params.id, facultyId: req.session.userId }` (`index.js:3140`) | `params.id` |
| 43 | `GET` | `/api/classes/:id/export-summary` | Yes | `FACULTY` | `where: { id: req.params.id, facultyId: req.session.userId }` (`index.js:3349`) | `params.id` |
| 44 | `GET` | `/api/classes/:id/activities` | Yes | `FACULTY` | `where: { id: req.params.id, facultyId: req.session.userId }` (`index.js:3402`) | `params.id` |
| 45 | `GET` | `/api/classes/:id/students/:studentId/records` | Yes | `FACULTY` | `{ id: :id, facultyId }` (`L3449`) + `{ classId, studentProfileId: :studentId, status: "APPROVED" }` (`L3456-3461`) | `params.id`, `params.studentId` |
| 46 | `POST` | `/api/classes/:id/sessions/today` | Yes | `FACULTY` | Guard (`L396-403`) + `where: { id: req.params.id, facultyId: req.session.userId }` (`index.js:3622`) | `params.id` |
| 47 | `POST` | `/api/sessions/:id/start` | Yes | `FACULTY` | Guard (`L404-412`) + `findOwnedSession(req.params.id, req.session.userId)` (`index.js:3665`) | `params.id` |
| 48 | `PATCH` | `/api/classes/:id` | Yes | `FACULTY` | Guard (`L396-403`) + `where: { id: req.params.id, facultyId: req.session.userId }` (`index.js:3698`) | `params.id`, `body.classCode` |
| 49 | `POST` | `/api/classes/:id/archive` | Yes | `FACULTY` | `where: { id: req.params.id, facultyId: req.session.userId }` (`index.js:3826`) | `params.id` |
| 50 | `POST` | `/api/classes/:id/restore` | Yes | `FACULTY` | `where: { id: req.params.id, facultyId: req.session.userId }` (`index.js:3852`) | `params.id` |

### 4. Recording Modules & Exports (`index.js:2853-3035, 3871-4984, 5113-5325`)

| # | Method | Path | Auth Required | Allowed Role(s) | Ownership / Scope Check (`file:line`) | Accepted ID Params |
|---|---|---|---|---|---|---|
| 34 | `GET` | `/api/classes/:id/quizzes` | Yes | `FACULTY` | `findOwnedClass(req.params.id, req.session.userId)` (`index.js:2855`) | `params.id` |
| 35 | `POST` | `/api/classes/:id/quizzes` | Yes | `FACULTY` | Guard (`L396-403`) + `findOwnedClass(req.params.id, req.session.userId)` (`index.js:2910`) | `params.id` |
| 36 | `PATCH` | `/api/quizzes/:sessionId` | Yes | `FACULTY` | Guard (`L414-421`) + `quizSession.findFirst({ id, class: { is: { facultyId } } })` (`index.js:2921`) | `params.sessionId` |
| 37 | `DELETE` | `/api/quizzes/:sessionId` | Yes | `FACULTY` | Guard (`L414-421`) + `quizSession.findFirst({ id, class: { is: { facultyId } } })` (`index.js:2932`) | `params.sessionId` |
| 38 | `PUT` | `/api/quizzes/:sessionId/scores` | Yes | `FACULTY` | Guard (`L414-421`) + `quizSession` owned (`L2946`); **MISSING** enrollment/ownership check on `body[].studentId` (`L2963-3010`) | `params.sessionId`, `body[].studentId` |
| 39 | `PUT` | `/api/quizzes/:sessionId/scores/:studentId` | Yes | `FACULTY` | Guard (`L414-421`) + `quizSession` owned (`L3022`) + `classEnrollment` `APPROVED` check (`L3025`) | `params.sessionId`, `params.studentId` |
| 51 | `GET` | `/api/sessions/:id/activities` | Yes | `FACULTY` | `findOwnedSession(req.params.id, req.session.userId)` (`index.js:3877`) | `params.id` |
| 52 | `POST` | `/api/sessions/:id/activities` | Yes | `FACULTY` | Guard (`L404-412`) + `findOwnedSession(req.params.id, req.session.userId)` (`index.js:3952`) | `params.id` |
| 53 | `PATCH` | `/api/activities/:id` | Yes | `FACULTY` | Guard (`L422-430`) + `activity.findFirst({ id, class: { is: { facultyId } } })` (`index.js:4015`) | `params.id` |
| 54 | `DELETE` | `/api/activities/:id` | Yes | `FACULTY` | Guard (`L422-430`) + `activity.findFirst({ id, class: { is: { facultyId } } })` (`index.js:4055`) | `params.id` |
| 55 | `GET` | `/api/activities/:id/scores` | Yes | `FACULTY` | `activity.findFirst({ id, class: { is: { facultyId } } })` (`index.js:4080`) | `params.id` |
| 56 | `PUT` | `/api/activities/:id/scores/:studentId` | Yes | `FACULTY` | Guard (`L422-430`) + `activity` owned (`L4138`) + `classEnrollment.findFirst({ classId, studentProfileId })` (`L4152-4158`) *(Weakness: does not require `status: "APPROVED"`)* | `params.id`, `params.studentId` |
| 57 | `GET` | `/api/classes/:id/projects` | Yes | `FACULTY` | `where: { id: req.params.id, facultyId: req.session.userId }` (`index.js:4205`) | `params.id` |
| 58 | `PATCH` | `/api/projects/:id` | Yes | `FACULTY` | Guard (`L431-439`) + `project.findFirst({ id, class: { is: { facultyId } } })` (`index.js:4313`) | `params.id` |
| 59 | `GET` | `/api/projects/:id/scores` | Yes | `FACULTY` | `project.findFirst({ id, class: { is: { facultyId } } })` (`index.js:4348`) | `params.id` |
| 60 | `PUT` | `/api/projects/:id/scores/:studentId` | Yes | `FACULTY` | Guard (`L431-439`) + `project` owned (`L4420`) + `classEnrollment` check (`L4434`) + `sessionId` check (`L4445`) *(Weakness: does not require `status: "APPROVED"`)* | `params.id`, `params.studentId`, `body.sessionId` |
| 61 | `PUT` | `/api/sessions/:id/attendance` | Yes | `FACULTY` | Guard (`L404-412`) + `findOwnedSession` (`L4544`) + per-student `classEnrollment` `APPROVED` check (`L4551-4574`) | `params.id`, `body.updates[].studentId` |
| 62 | `PUT` | `/api/sessions/:id/attendance/:studentId` | Yes | `FACULTY` | Guard (`L404-412`) + `findOwnedSession` (`L4702`) + `classEnrollment` `APPROVED` check (`L4706-4725`) | `params.id`, `params.studentId` |
| 63 | `POST` | `/api/sessions/:id/recitation/shuffle` | Yes | `FACULTY` | Guard (`L404-412`) + `findOwnedSession` (`L4836`) + `APPROVED` enrollment filter (`L4846-4851`) | `params.id`, `body.excludeStudentId` |
| 64 | `PATCH` | `/api/recitation-logs/:id` | Yes | `FACULTY` | Guard (`L440-455`) + `recitationLog.findFirst({ id, session: { is: { class: { is: { facultyId } } } } })` (`L4951`) | `params.id` |
| 66 | `GET` | `/api/classes/:id/export/excel` | Yes | `FACULTY` | `where: { id: req.params.id, facultyId: req.session.userId }` (`index.js:5120`) | `params.id`, `query.types` |
| 67 | `GET` | `/api/classes/:id/export/csv` | Yes | `FACULTY` | `where: { id: req.params.id, facultyId: req.session.userId }` (`index.js:5224`) | `params.id`, `query.types` |

### 5. Student Routes (`index.js:4986-5111, 5328-5576`)

| # | Method | Path | Auth Required | Allowed Role(s) | Ownership / Scope Check (`file:line`) | Accepted ID Params |
|---|---|---|---|---|---|---|
| 65 | `GET` | `/api/student/classes` | Yes | `STUDENT` | Self-scoped: `userId: req.session.userId` (`L4993`) + enrollments `in ["APPROVED", "PENDING", "DROPPED"]` (`L4996`) + `$queryRaw` scoped to `${profile.id}` (`L5029-5053`) | None |
| 68 | `GET` | `/api/student/classes/:classId/records` | Yes | `STUDENT` | Self (`L5335`) + `enrollments: { some: { studentProfileId: profile.id, status: { in: ["APPROVED", "PENDING", "DROPPED"] } } }` (`L5345-5350`) *(Weakness: allows `PENDING` students to read class metadata)* | `params.classId` |
| 69 | `POST` | `/api/classes/join` | Yes | `STUDENT` (reCAPTCHA gated) | Guard (`L365-386`) + `studentProfile.findUnique({ userId: req.session.userId })` (`L5464`) + `classCode` lookup (`L5466`) *(Note: allows `DECLINED`/`DROPPED` enrollments to re-submit/re-open at `L5500-5505`)* | `body.classCode` |

### 6. Test-Only E2E Helper Endpoints (`tests/e2e/support/e2e-backend.cjs:31-51`)

| # | Method | Path | Auth Required | Allowed Role(s) | Ownership & Production Gate Check (`file:line`) | Accepted ID Params |
|---|---|---|---|---|---|---|
| 70 | `GET` | `/__e2e/emails` | No | Test harness only | **NONE** (`e2e-backend.cjs:33-37`). Unreachable when running `classdex-backend/index.js` directly (`index.js` never mounts `/__e2e/*`). Note: `e2e-backend.cjs` itself hardcodes `NODE_ENV="test"` (`L16`) with no `NODE_ENV === "production"` abort guard, and `mailer.js:346-350` exports stub helpers without runtime prod guard. | None |
| 71 | `DELETE` | `/__e2e/emails` | No | Test harness only | **NONE** (`e2e-backend.cjs:38-43`). Same gating as #70. | None |
| 72 | `POST` | `/__e2e/reset-rate-limiters` | No | Test harness only | **NONE** (`e2e-backend.cjs:44-49`). `resetRateLimitersForTests` exported on `index.js:163, 5587` (no Express route mounts it in `index.js`). | None |
