# ClassDex — Sprint 6.1 Manual Verification Checklist (`PWD-11`, `COMPAT-08..10`, `COMPAT-04 [firefox-mobile]`)

Four cases (`PWD-11`, `COMPAT-08..10`) retain status **`MANUAL – NOT RUN`** in `docs/testing/TEST_CASES.csv` because they require live Gmail inbox access, physical mobile devices, or native macOS Safari hardware. In addition, the `COMPAT-04` Student responsive flow (`[firefox-mobile]`) is tracked below as a quick manual check in Firefox Responsive Design Mode due to an intermittent Playwright emulation limitation (see `Known Issues` in `docs/testing/TEST_RESULTS.md`).

---

## Manual Checklist Overview

| Item / Test Case | Environment / Viewport | Scope | Status in `TEST_CASES.csv` |
|---|---|---|---|
| `PWD-11` | Real Gmail / Resend (`EMAIL_MODE=resend`) | Live inbox placement, SPF/DKIM, verification/reset/join links | `MANUAL – NOT RUN` |
| `COMPAT-08` | Physical Android phone (Chrome Mobile) | Touch layouts, `<select>` dropdowns, reCAPTCHA modal, shuffler, 3D card flip | `MANUAL – NOT RUN` |
| `COMPAT-09` | Physical iPhone (Mobile Safari) | Safe areas, iOS form zoom, photo upload, Web Audio shuffle, 3D card flip | `MANUAL – NOT RUN` |
| `COMPAT-10` | Native macOS Safari Desktop | Light/Dark themes, 3D flip & `F`/`Esc` keys, `.xlsx`/`.csv` downloads, logout | `MANUAL – NOT RUN` |
| `COMPAT-04` (`firefox-mobile` bypass) | Firefox Desktop Responsive Design Mode (~390px wide, e.g., `390×844` / `375×812`) | Student flow, mobile nav, Light/Dark theme persistence, 3D card flip, and reCAPTCHA Security check popup on `/register` and `/join` | `Known Issue (skipped)` (Student E2E on `firefox-mobile` skipped; Desktop & Tablet Firefox E2E passed) |

---


## Pre-Check Safety Note

- Automated suites run strictly with `EMAIL_MODE=stub` against the Neon **`test`** branch.
- Before executing **`PWD-11`** (Live Resend Inbox Check), verify your `classdex-backend/.env` points to your target test/dev database and contains a valid `RESEND_API_KEY` + verified sender domain (`EMAIL_FROM=ClassDex <no-reply@classdex.me>`), then use **only your own real email address** (never `@test.local` or `@example.com`) so domain reputation is protected.

---

## 1. `PWD-11` — Live Resend Inbox & Spam-Folder Verification

**Preconditions:**
- Valid `RESEND_API_KEY` and verified `EMAIL_FROM` (`classdex.me`) in `classdex-backend/.env` with `EMAIL_MODE=resend`.
- Backend running on `http://localhost:5000` and frontend on `http://localhost:5173`.

**Step-by-Step Instructions:**
1. **CLI Smoke Test:**
   ```powershell
   cd classdex-backend
   node scripts/send-test-email.js <your-real-email@gmail.com>
   ```
   - Confirm CLI outputs `[OK] Sent via Resend — message id: ...`.
   - Open your Gmail/mailbox inbox and verify the email lands in the **Primary Inbox** (not Spam/Promotions), displays the ClassDex branding, and passes **SPF/DKIM** (`Show original` -> `SPF: PASS`, `DKIM: PASS`).
2. **Registration & Verification Link:**
   - Open `http://localhost:5173/register` and register a fresh Student account with `<your-real-email@gmail.com>`.
   - Verify **Verify your ClassDex email address** arrives within 30 seconds; click the CTA button (`/verify-email?token=...`) and confirm **Email verified** appears and the dashboard unverified banner disappears.
3. **Password Reset & Change Password:**
   - Open `/forgot-password`, enter `<your-real-email@gmail.com>`, complete the reCAPTCHA widget, and submit.
   - Open **Reset your ClassDex password**, click the reset link (`/reset-password?token=...`), save a new password, and confirm **Your ClassDex password was changed** arrives cleanly.
4. **Join & Approval Decision Emails:**
   - Sign in as the Student, join a Faculty class (`PENDING`), and confirm both student pending and faculty join alert emails arrive with valid links.
   - As Faculty, click **Approve** and confirm the **You were approved** email arrives in the Student inbox.
5. **Cleanup:**
   - Delete or reset any manual smoke-test user rows created during verification if testing against a shared database.

---

## 2. `COMPAT-08` — Physical Android Phone (Chrome Mobile — Light & Dark Modes)

**Preconditions:**
- Backend & frontend running on your LAN (e.g., `vite --host` or LAN/tunnel HTTPS/HTTP URL reachable from phone).
- Seeded Faculty & Student test accounts or manual accounts.

**Checklist:**
- [ ] **Landing & Navigation:** Open Landing, `/login`, and `/register` in Chrome Mobile. Toggle Light and Dark themes (`moon`/`sun` icon in top header) and refresh the page — verify theme preference persists (`localStorage["classdex-theme"]`) and logos/text contrast stay legible.
- [ ] **Horizontal Overflow:** Scroll horizontally at every screen (`Landing`, `FacultyDashboard`, `ClassDeck`, `StudentList`, `Attendance`, `Recitation`, `Export`, `StudentDashboard`, `StudentProfile`, `StudentClassRecord`) and confirm zero unintended sideways page scrolling.
- [ ] **Modals & Form Controls:**
  - [ ] Verify native `<select>` dropdowns (schedule Start/End time, class edit, export radios/checkboxes) open smoothly without zooming or clipping text off-screen.
  - [ ] Verify `StudentDetailDialog` (3D index card modal) fits inside the viewport width, closes with `×`, and taps cleanly on touchscreens.
- [ ] **reCAPTCHA Modal (`Register`, `Forgot Password`, `Join Class`):**
  - [ ] Submit an incomplete form first and verify the security check dialog does **not** pop up prematurely.
  - [ ] Submit with required fields filled -> verify reCAPTCHA checkbox fits on mobile screen and completes cleanly.
- [ ] **Recitation Shuffle & 3D Flip:**
  - [ ] On **Recitation**, tap **Shuffle** -> verify animation runs without stutter and **Unmute/Sound** works on Android Chrome after user gesture.
  - [ ] On **Class Deck**, tap a student card -> tap **Flip card** -> confirm clean 3D rotation and readable front/back records.

---

## 3. `COMPAT-09` — Physical iPhone (Mobile Safari — Light & Dark Modes)

**Preconditions:**
- App reachable on physical iPhone running iOS Safari (prefer HTTPS tunnel or local dev server with `-host` so camera/gallery & cookies behave normally).
- iPhone ringer unmuted when testing Web Audio recitation feedback.

**Checklist:**
- [ ] **iOS Viewport & Safe Areas:** Open Landing, Dashboard, and Classroom tabs in both Light and Dark mode; confirm no `100vh` bottom clipping or horizontal viewport overflow when scrolling vertically.
- [ ] **iOS Form Zoom & Selects:** Tap inputs (`16px` font or larger prevents Safari auto-zoom) and `<select>` time pickers on `/faculty/classes/new` and verify layout stays stable.
- [ ] **Camera / Photo Library Upload (`/student/profile`):**
  - [ ] Tap **Upload a photo** / **Change photo**, select a photo from **Photo Library** (and optionally **Take Photo**), confirm preview renders cleanly and **Save index card** persists across page reload.
  - [ ] Attempt selecting an invalid file (e.g., `.txt` or `>5 MB`) and confirm inline red alert banner displays cleanly without crashing Safari.
- [ ] **Web Audio Shuffle Sound on iOS:**
  - [ ] Tap the unmute icon or **Shuffle** button in **Recitation** -> confirm tick and reveal chime play cleanly (Web Audio API `AudioContext` unlocked on direct tap).
- [ ] **3D Card Flip (`backface-visibility` in WebKit):**
  - [ ] Open a Student Detail Card (both Faculty modal and `/student/classes/:id`) and tap **Flip card** -> verify crisp front/back switching with zero mirrored text bleeding through during or after the 3D transition.
- [ ] **Modals & Back Navigation:**
  - [ ] Open Notifications drawer and Invite QR popover -> confirm smooth scrolling inside modals; log out and tap Safari Back button -> confirm redirect to `/login`.

---

## 4. `COMPAT-10` — Native macOS Safari Desktop

**Preconditions:**
- Apple Mac with Safari (macOS). App accessible via localhost or deployed/tunnel URL.

**Checklist:**
- [ ] **Layout, Fonts & Theme Toggle:** Open Landing, `/faculty`, and `/student` at desktop width (~1280×800) and narrower split-screen width in both Light and Dark themes. Toggle themes -> reload -> confirm persistence and clean dark/light logos.
- [ ] **3D Index Card Flip & Hover Focus:** Open Student Detail Card -> click **Flip card** and press `F` key -> verify `backface-visibility: hidden` and perspective render cleanly in desktop WebKit; press `Esc` to dismiss.
- [ ] **Downloads in macOS Safari (`Data export` & `Download template`):**
  - [ ] On **Student List**, click **Download template** -> confirm `<section>_<courseCode>_<classCode>_student_list_template.xlsx` downloads with valid extension and opens cleanly in Numbers / Excel.
  - [ ] On **Data export**, download both `.xlsx` (Excel) and `.csv` (CSV UTF-8 BOM) -> confirm files download without opening raw binary gibberish in a browser tab.
- [ ] **Session Cookies & Logout:** Log in, change password in `/settings` (or reset password), verify logout clears cookie cleanly, and Back button redirects `/faculty` or `/student` to `/login`.

---

## 5. `COMPAT-04` (`firefox-mobile` Known Issue Bypass) — Firefox Responsive Design Mode (~390px Wide)

**Context:** In automated Playwright Firefox Mobile emulation (`375×812`), the multi-step `Student flow, themes, mobile/tablet nav, captcha timing & 3D card flip responsive check` test failed intermittently due to external reCAPTCHA CDN iframe stalls (`Loading security check…` at `compat.spec.mjs:336`) and transient Neon `pg-pool` `Connection terminated unexpectedly` disconnects during StrictMode concurrent `/records` loads (`compat.spec.mjs:388`). Both Firefox Desktop (`1280×800`) and Firefox Tablet (`768×1024`) passed all Student & Faculty flows, and Firefox Mobile passed the full Faculty flow. Use this quick manual check in desktop Firefox:

**Preconditions:**
- Open Mozilla Firefox on desktop with `Ctrl+Shift+M` (**Responsive Design Mode**) set to **~390px wide** (`390×844` or `375×812`).
- App running locally (`http://localhost:5173`) against your configured backend (`EMAIL_MODE=stub` or `resend`).

**Checklist:**
- [ ] **reCAPTCHA Popup & Timing (`/register` & `/join`):**
  - [ ] On `/register` in Dark theme, submit whitespace name (`"   "`) -> verify inline validation displays and the **Security check** reCAPTCHA dialog does **not** pop up prematurely.
  - [ ] Fill valid required fields and click **Register** -> confirm the **Security check** popup fits inside the ~390px viewport with zero horizontal scroll (`scrollWidth <= innerWidth`), renders the reCAPTCHA checkbox cleanly, and closes with `×`.
  - [ ] Repeat on `/join`: blank invite code triggers inline validation without popup; non-empty invite code opens the **Security check** dialog cleanly inside ~390px width.
- [ ] **Light/Dark Themes & Mobile Navigation (`<= 680px`):**
  - [ ] Sign in as a Student -> verify `/student` cards stack cleanly without horizontal overflow in Dark mode, switch to **Light** mode (`Switch to light mode` header button), and reload to confirm `localStorage["classdex-theme"]` persistence.
  - [ ] Verify compact icon-only `.main-nav` links (`Dashboard`, `My index card`) remain reachable, legible, and labeled properly for assistive tech, then navigate to `/student/profile`.
- [ ] **Student Flow, Profile & 3D Index Card Flip (`/student/classes/:id`):**
  - [ ] Update **Program** / fields on `/student/profile`, click **Save index card**, and confirm redirect back to `/student`.
  - [ ] Open an approved class record (`/student/classes/:id`) in ~390px Responsive Design Mode -> verify `#student-detail-title` renders cleanly, click **Flip card** -> confirm 3D flip (`is-flipped`) shows back-side coursework cleanly with zero clipped text or horizontal scrollbar.
