# ClassDex — Sprint 6.1 Test Results

**Branch:** `sprint-6-1`  
**Database Isolation:** Neon `"test"` branch (`ep-orange-dream-b3a6qov0-pooler.c-4.ap-southeast-1.aws.neon.tech` / `neondb`)  
**Email Mode:** `EMAIL_MODE=stub`

---

## Summary by Ticket

| Ticket | Scope | Written | Passed | Failed | `MANUAL – NOT RUN` | Not Run | Status |
|---|---|---:|---:|---:|---:|---:|---|
| `SCRUM-62` | Test Plan & Test Cases (`TEST_PLAN.md`, `TEST_CASES.csv`) | 89 (plan) | — | — | — | — | Complete |
| `SCRUM-63` | Authentication & Role-Based Access (`AUTH-01`..`AUTH-16`) | 16 | 16 | 0 | 0 | 0 | Complete (`DEF-02` logged) |
| `SCRUM-64` | Class Management & Join Workflow (`CLS-01`..`CLS-21`) | 21 | 21 | 0 | 0 | 0 | Complete (`DEF-01` observed) |
| `SCRUM-65` | Recording Modules (`REC-01`..`REC-17`) | 17 | 15 | 2 | 0 | 0 | Complete (`DEF-03..06` logged) |
| `SCRUM-66` | Student Dashboard & Data Export (`STU-01`..`07`, `EXP-01`..`07`) | 14 | 0 | 0 | 0 | 14 | Pending |
| `SCRUM-67` | Password Recovery & Email Flows (`PWD-01`..`11`) | 11 | 0 | 0 | 1 | 10 | Pending |
| `SCRUM-68` | Cross-Browser & Device Compatibility (`COMPAT-01`..`10`) | 10 | 0 | 0 | 3 | 7 | Pending |
| **Total** | | **89** | **52** | **2** | **4** | **31** | |

---

## Execution Logs

### Baseline Existing Suites (Pre-Sprint 6.1 Verification)
- **Backend (`classdex-backend/test/*.test.js` via `node --test --test-concurrency=1` against Neon `test` branch):** `72/73` passed (`1` failed: `test/student-profile.test.js` hit Prisma `P2028` 5000ms transaction timeout over remote Neon -> logged as `DEF-01` under `SCRUM-64`/`CLS-12`).
- **Frontend (`classdex-frontend/test/*.test.mjs` + `src/utils/*.test.js` via `node --test`):** `25/25` passed (`12` in `test/`, `13` in `src/utils/`).

### SCRUM-63 — Test Authentication and Role-Based Access (`2026-11-11`)
- **API Suite (`classdex-backend/test/scrum63-auth-rbac.test.js`):** `13/13` subtests passed covering `AUTH-01..07`, `AUTH-10..12`, `AUTH-15..16`.
- **E2E Suite (`tests/e2e/auth-rbac.spec.mjs` via Playwright Chromium Desktop):** `4/4` passed covering `AUTH-08`, `AUTH-09`, `AUTH-13`, `AUTH-14`.
- **QA Seed Script (`classdex-backend/scripts/seed-test-data.js`):** Verified `--clean`, initial seed, and idempotent re-seed (`2` faculty, `7` students, `4` classes) against `ep-orange-dream-b3a6qov0-pooler.c-4.ap-southeast-1.aws.neon.tech`.
- **Defect Discovered:** `DEF-02` — Logout in `AppShell.jsx` intermittently lands on `/login` instead of `/` due to `<ProtectedRoute>` redirect race (logged in `docs/testing/DEFECTS.md` for `SCRUM-69`).

### SCRUM-64 — Test Class Management and Join Workflow (`2026-11-11`)
- **API Suite (`classdex-backend/test/scrum64-class-join.test.js`):** `10/10` subtests passed (`task-885`) covering `CLS-01`, `CLS-02`, `CLS-04..06`, `CLS-10..13`, `CLS-15..16`, `CLS-18..21`.
- **E2E Suite (`tests/e2e/class-join.spec.mjs` via Playwright Chromium Desktop):** `5/5` passed (`task-1002`) covering `CLS-03` (class creation + live code check), `CLS-07` & `CLS-08` (inline validation + multi-format paste two-way duplicates), `CLS-09` (`Saved` vs `Edited · Ready to save` + Undo), `CLS-14` (empty-roster invite warning + `/join/:code` test reCAPTCHA flow), and `CLS-17` (notifications bell badge count + Approve/Decline).
- **Notes:** Previously observed `DEF-01` (`PUT /api/student/profile` intermittent 5000ms Prisma `P2028` transaction timeout from baseline `student-profile.test.js`) remains `Open` in `docs/testing/DEFECTS.md` for `SCRUM-69`.

### SCRUM-65 — Test Recording Modules (`2026-11-11`)
- **API Suite (`classdex-backend/test/scrum65-recording.test.js`):** `14/14` subtests passed (`task-1496`) covering `REC-01..07`, `REC-09..11`, `REC-13..15`, `REC-17`.
- **E2E Suite (`tests/e2e/recording.spec.mjs` via Playwright Chromium Desktop):** `3/7` passed (`task-1427`: `REC-08`, `REC-12c`, `REC-16c`), `4/7` failed cleanly on four functional defects (`REC-12a` -> `DEF-05` Critical, `REC-12b` -> `DEF-04` Major, `REC-16a` -> `DEF-06` Major, `REC-16b` -> `DEF-03` Major).
- **Defects Discovered:**
  - `DEF-03` (Major): `POST /api/classes/:id/notifications/read` checks `warning.absenceCount` (`undefined`) instead of `warning.absentCount`, leaving 7-absence warnings unread.
  - `DEF-04` (Major): `QuizModule.jsx` checks stale `student.attendanceStatus` instead of live `student.status` override for mid-session Absent locking/unlocking.
  - `DEF-05` (Critical): Saving a newly created quiz crashes `QuizModule` into `<ErrorBoundary>` (`Cannot read properties of undefined (reading 'map')` because `POST /api/classes/:id/quizzes` returns `session` without `scores`).
  - `DEF-06` (Major): After navigating via `"Review in Student List"`, `FacultyClass.jsx` snaps `activeModule` back to `"student-list"` when switching tabs due to stale `searchParams` effect interactions.
