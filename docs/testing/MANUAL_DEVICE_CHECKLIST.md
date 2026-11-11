# ClassDex — Sprint 6.1 Manual Verification Checklist (`PWD-11`, `COMPAT-08..10`)

These 4 test cases cannot be reliably executed in headless CI on Windows without real physical mobile hardware, native macOS Safari, or live inbox access. Every item below retains status **`MANUAL – NOT RUN`** in `docs/testing/TEST_CASES.csv` until executed and signed off by you.

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
