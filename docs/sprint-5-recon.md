# Sprint 5 (Part 1) — Phase 0 Recon Findings

## 1. Auth Mechanism
- **Type:** Server-side sessions via `express-session` (`^1.19.0`, default in-memory `MemoryStore`) — **not** JWT.
- **Storage:** Stored client-side only as an `httpOnly` cookie named `classdex.sid` (`sameSite: "lax"`, `secure: false`, 7-day `maxAge`). Nothing is stored in `localStorage`. All client requests in `classdex-frontend/src/api.js` pass `credentials: "include"`.
- **Middleware:** `requireAuth` and `requireRole(role)` in `classdex-backend/index.js`.
- **Session payload (`req.session`):** Currently stores `{ userId, role }`.
- **Client user loading:** `AuthProvider` (`classdex-frontend/src/context/AuthContext.jsx`) calls `GET /api/auth/me` on mount and provides `{ user, loading, register, login, logout, updateUser }` via `useAuth()`.
- **Session invalidation plan (SCRUM-53 & SCRUM-56):**
  - Record `req.session.issuedAt` (monotonic epoch ms) whenever a session is established (`POST /api/auth/register`, `POST /api/auth/login`, and `POST /api/auth/change-password`).
  - Update `requireAuth` to look up `{ id, role, passwordChangedAt }` for `req.session.userId`. If the user no longer exists, or `user.passwordChangedAt` is non-null and `(!req.session.issuedAt || req.session.issuedAt <= user.passwordChangedAt.getTime())`, destroy the session, clear `classdex.sid`, and respond `401`.
  - On `POST /api/auth/change-password`, regenerate the caller's session (`req.session.regenerate`) with `issuedAt > passwordChangedAt.getTime()` so the active device receives a fresh `classdex.sid` cookie and stays signed in while all other sessions are rejected with `401`.
  - Emit a `classdex:unauthorized` window event in `classdex-frontend/src/api.js` on non-login `401` responses so open SPA tabs immediately clear `user` state and redirect to `/login` via `ProtectedRoute`.

## 2. Registration & Password Rules
- **Password rules (client + server):**
  - Client (`classdex-frontend/src/pages/Register.jsx`) and server (`classdex-backend/index.js`) both enforce:
    1. Minimum length of **8 characters**: `password.length >= 8` (`"Password must be at least 8 characters."`).
    2. Confirmation match on forms with confirmation: `password === confirmPassword` (`"Passwords do not match."`).
  - No character-class rules exist in Registration; we will extract this exact rule set into a single shared validator module without inventing new rules.
- **bcrypt cost factor:** `12` (`bcryptjs` `^3.0.3`, `bcrypt.hash(password, 12)`).
- **User model:** Faculty and students share **one `User` table** (`model User` in `classdex-backend/prisma/schema.prisma`) distinguished by `role: Role` (`FACULTY` | `STUDENT`), with optional 1:1 `FacultyProfile` and `StudentProfile` tables.

## 3. reCAPTCHA
- **Client component:** `classdex-frontend/src/components/RecaptchaWidget.jsx`.
  - Loads `https://www.google.com/recaptcha/api.js?render=explicit&onload=__classDexRecaptchaReady` lazily and waits for `window.grecaptcha?.render`.
  - Rendered via `createPortal` inside a modal dialog (`captchaOpen` boolean state) **only after** client-side field validation passes on form submit (used on `Register.jsx`, `JoinClass.jsx`, and `StudentDashboard.jsx`).
- **Server verify helper:** `verifyRecaptchaToken(token, remoteIp)` in `classdex-backend/recaptcha.js` (called by `requireRecaptcha(req, res)` in `classdex-backend/index.js`).
- **Env vars:**
  - Client: `VITE_RECAPTCHA_SITE_KEY`
  - Server: `RECAPTCHA_SECRET_KEY`

## 4. Environment Variables (Client URL)
- `classdex-backend/.env.example` and `classdex-backend/email.js` already define:
  - `FRONTEND_URL` — primary base URL for links in emails.
  - `FRONTEND_ORIGIN` — CORS allowed origin and fallback for `FRONTEND_URL` (defaults to `http://localhost:5173`).
- We will resolve links using `process.env.FRONTEND_URL || process.env.CLIENT_URL || process.env.FRONTEND_ORIGIN || "http://localhost:5173"` so existing `.env` setups work out of the box and `CLIENT_URL` is also supported as an alias.

## 5. Account Settings & Profile Menu
- **Existing pages:** `/faculty/profile` (`FacultyProfile.jsx`) and `/student/profile` (`StudentProfile.jsx`) edit classroom/index-card profile data. Neither is an Account Settings page.
- **User/profile menu:** `classdex-frontend/src/components/AppShell.jsx` (`.user-menu` / `.user-menu-popover` in the top-right header bar, currently showing `Profile` and `Log out`).
- **Plan for SCRUM-56:** Add a minimal protected `/settings` (`AccountSettings.jsx`) page (Change Password section only) accessible to both `FACULTY` and `STUDENT`, linked from the existing `.user-menu-popover` in `AppShell.jsx`.

## 6. Rate Limiting & Proxy Configuration
- No rate-limiting middleware is currently installed or used (`express-rate-limit` will be added in SCRUM-54).
- `app.set("trust proxy", ...)` is not currently set in `classdex-backend/index.js`; we will configure `trust proxy` cleanly in SCRUM-54 (honoring `TRUST_PROXY` env var or `1` in production) so `req.ip` and `express-rate-limit` behave properly behind a reverse proxy.

## 7. Tests, Lint & Build Scripts
- **Backend (`classdex-backend/package.json`):**
  - `npm test` → `node --test` (Node built-in test runner + `node:assert/strict` in `classdex-backend/test/`).
  - `npm run db:setup` → `prisma generate && node scripts/apply-schema.js`.
- **Frontend (`classdex-frontend/package.json`):**
  - `npm run lint` → `oxlint` (`.oxlintrc.json`).
  - `npm run build` → `vite build`.

## 8. Directory Structure & Assumptions
- The repository splits code into `classdex-backend/` (CommonJS) and `classdex-frontend/` (ESM + Vite). Where the prompt refers to `server/src/services/...`, `prisma/schema.prisma`, and `scripts/apply-schema.js`, these map to `classdex-backend/src/services/mailer.js`, `classdex-backend/src/services/emailTemplates.js`, `classdex-backend/prisma/schema.prisma`, and `classdex-backend/scripts/apply-schema.js`.
- Rate limiting in SCRUM-54 and SCRUM-56 uses `express-rate-limit`'s default in-memory store (appropriate for single-process deployment; noted for future Redis store if horizontally scaled).
