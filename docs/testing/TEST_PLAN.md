# ClassDex — Sprint 6.1 Functional Test Plan

**Project:** ClassDex (Leyte Normal University Class & Student Record Management System)  
**Sprint:** 6.1 — Functional Testing (`SCRUM-62` through `SCRUM-69`)  
**Scope Baseline:** Sprints 1–5 + Resend Mailer Activation + Student List Validation & Template Naming (`main` @ `29d76be`)

---

## 1. Objectives & Scope

### 1.1 In-Scope
Verify functional correctness, role boundaries, validation rules, database persistence, file imports/exports, email generation, and cross-browser/responsive behavior across every existing Sprint 1–5 feature for both **Faculty** and **Student** roles:

1. **Authentication & RBAC (`AUTH` / `SCRUM-63`):** Registration, email verification, login, logout, session persistence/invalidation, bcrypt password storage, UI & API route guards, cross-faculty resource isolation, and student photo access control.
2. **Class Management & Join Workflow (`CLS` / `SCRUM-64`):** Class creation/editing/archival/restoration, `courseCode` & `courseTitle`, schedule selectors, Student List CRUD/paste/template/import/validation/Undo, Student Profile global card & `ClassRoster` ID sync, join via link/code/QR, auto-approval vs. pending queue, removal impact & Drop List preservation/restoration.
3. **Recording Modules (`REC` / `SCRUM-65`):** Attendance session clock (`startedAt`), Manila timezone date boundaries, configurable grace period (`PRESENT` → `LATE`), bulk attendance, Recitation weighted/random shuffler (`PRESENT` + `LATE`), shuffle duration, Activities history, Midterm/Finals Projects, Quiz total-items/scoring/history, absence auto-flagging & reversibility, and 7-absence bell warnings.
4. **Student Dashboard & Index Card (`STU` / `SCRUM-66`):** Student class list summaries, student class record view & isolation (including dropped students' historical records), Student Profile photo upload/validation, and Faculty flippable 3D index card records view.
5. **Data Export (`EXP` / `SCRUM-66`):** Export summary counts, Excel (`.xlsx`) & CSV (`.csv`) generation, selective dataset toggles, cell-by-cell DB accuracy, empty classes, CSV/Excel formula injection sanitization, and 60 × 20 high-volume exports.
6. **Password Recovery & Email Flows (`PWD` / `SCRUM-67`):** Verification, resend cooldown (60s), forgot-password (anti-enumeration + IP/email rate limiting), reset-password token expiry/single-use/sibling invalidation, change-password session rotation, join-pending & decision emails captured via `EMAIL_MODE=stub`.
7. **Cross-Browser & Viewport Compatibility (`COMPAT` / `SCRUM-68`):** Playwright automation across Chromium, Firefox, WebKit (and Edge channel if available locally) at Desktop (`1280×800`), Tablet (`768×1024`), and Mobile (`375×812`) in Light and Dark themes; manual device checklist for physical iOS/Android phones and native macOS Safari.
8. **Functional Defect Fixing (`SCRUM-69`):** Prioritized fixes (`Critical` → `Major` → `Minor`) with regression tests.

### 1.2 Out-of-Scope
- Production deployment, DNS/SSL hosting configuration, and CI/CD pipelines (**Sprint 6.2**).
- Penetration testing, DAST/fuzzing, and production infrastructure hardening (**Sprint 6.3**).
- Visual redesigns or layout alterations to the Class Deck 3D student index card grid (any defects found there are logged and reported for approval).
- Live third-party inbox/spam deliverability (confirmed manually outside automated suites).

---

## 2. Test Environment & Safety Controls

| Component | Configuration |
|---|---|
| **Frontend** | `classdex-frontend/` (React 19, Vite 8, Tailwind CSS v4) |
| **Backend** | `classdex-backend/` (Node.js, Express 5, Prisma 7, PostgreSQL driver `pg`) |
| **Test Database** | Dedicated Neon `"test"` branch configured in `classdex-backend/.env.test` (`ep-orange-dream-b3a6qov0-pooler.c-4.ap-southeast-1.aws.neon.tech` / `neondb`), initialized via `node scripts/apply-schema.js` |
| **Production Protection** | Production `.env` host (`ep-polished-night-b3hs4no6-pooler`) is never targeted by automated tests; destructive commands (`migrate reset`, `db push --force-reset`, unfiltered `deleteMany({})`) are prohibited |
| **Email Isolation** | `EMAIL_MODE=stub` enforced across API/unit tests and Playwright E2E; assertions inspect `getStubEmails()` / `clearStubEmails()` in `src/services/mailer.js` |
| **reCAPTCHA Handling** | Backend tests inject `setRecaptchaVerifierForTests` or test keys without weakening production verification logic |
| **Dataset Isolation** | `classdex-backend/scripts/seed-test-data.js` seeds `qa_`-prefixed accounts and classes idempotently with `--clean` cleanup; standalone tests clean up only explicit created IDs |

---

## 3. Roles Covered

- **Unauthenticated Visitor:** Public landing, login, register, forgot/reset password, email verification, and redirect guards on protected routes.
- **Faculty (`FACULTY`):** Profile setup, class creation/editing/archiving, Student List & Drop List management, Pending requests & absence warnings, Attendance, Recitation, Activities, Projects, Quizzes, Flippable student card, Data Export.
- **Student (`STUDENT`):** Profile setup (mandatory 7-digit ID + photo), joining classes (code/link/QR), read-only enrolled & dropped class dashboards/records.

---

## 4. Test Types & Tooling

- **API & Unit Integration (`test:api`):** Node built-in test runner (`node --test --test-concurrency=1`) preserving all **73 existing backend tests** (`classdex-backend/test/*.test.js`) and **12 frontend unit tests** (`classdex-frontend/test/*.test.mjs`), extended cleanly per ticket.
- **Browser End-to-End (`test:e2e`):** `@playwright/test` across Chromium, Firefox, WebKit (+ optional Edge channel) covering desktop, tablet, mobile viewports and Light/Dark modes.
- **Manual Verification (`Manual`):** Items marked `MANUAL – NOT RUN` (physical Android/iOS phones, native macOS Safari, live Gmail inbox/spam inspection via `scripts/send-test-email.js`).

---

## 5. Entry & Exit Criteria

### Entry Criteria
- `sprint-6-1` branched cleanly from `main`.
- Separate Neon `"test"` branch `.env.test` verified (`EMAIL_MODE=stub`) and schema confirmed via `scripts/apply-schema.js`.
- Seed script `scripts/seed-test-data.js` ready prior to E2E/workflow runs.

### Exit Criteria
- All scripted `AUTH`, `CLS`, `REC`, `STU`, `EXP`, `PWD`, and automated `COMPAT` test cases executed and recorded truthfully in `TEST_CASES.csv` and `TEST_RESULTS.md`.
- Every failed case logged in `DEFECTS.md` with severity, reproduction steps, and expected vs. actual behavior.
- All `Critical` and `Major` functional defects fixed on `feature/SCRUM-69-fix-functional-defects` (with regression tests passing), unless flagged `Needs Decision`.
- Inherently hardware/provider-dependent items documented cleanly in `MANUAL_DEVICE_CHECKLIST.md` as `MANUAL – NOT RUN`.
- All changes committed locally on `sprint-6-1` (zero unrequested pushes to GitHub).

---

## 6. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Accidental test writes to production Neon DB | Separate Neon `"test"` branch in `.env.test`; preflight host verification and `qa_` prefix scoping |
| Test emails hitting real Gmail/Resend quotas | Enforce `EMAIL_MODE=stub` globally in test runners; `mailer.js` test-runner guard prevents Resend calls |
| Session/rate-limiter cross-test interference | Sequential API test execution (`--test-concurrency=1`) with `resetRateLimitersForTests()` between suites |
| Flaky timing in grace-period & Playwright runs | Explicit clock/offset testing at API layer and deterministic locators/wait assertions in Playwright |
