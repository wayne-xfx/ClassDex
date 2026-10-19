# ClassDex

ClassDex is an interactive web-based digital index card and classroom record-keeping application for faculty at Leyte Normal University, developed for IT 122/122L (System Analysis and Design). The system streamlines classroom management by providing faculty with role-based class decks, flexible attendance and recitation tracking, activity and quiz scoring, and matrix export capabilities, while allowing students to maintain a reusable index card profile and track their academic records across enrolled classes.

**Project Team:**
- John Paul O. Talbo (Leader)
- Paul Kristoffer Bautista
- John Wayne M. Abejar

---

## Features

- **Role-Based Accounts & Dashboards**: Dedicated interfaces for Faculty and Students with secure session-based authentication and role enforcement.
- **Class Management**: Create classes with unique alphanumeric class codes, sharable invite links, and downloadable QR codes with enlarged display modal.
- **Student List Management**: Build and maintain official class Student Lists by manual input, bulk copy-paste, or CSV/Excel file upload.
- **Smart Enrollment & Approval**: Roster-based auto-admission when student ID numbers match the Student List; automatic fallback to a Pending queue with Faculty Approve/Decline controls for unmatched students.
- **Classroom Modules**:
  - **Class Deck**: Searchable student card interface organized like physical index cards, supporting grid and list layouts.
  - **Take Attendance**: Daily Manila-calendar-day attendance sessions (Present, Late, Absent) with configurable class grace periods for Late status and continuous editability.
  - **Recitation**: Card shuffler supporting random or weighted selection (favoring students with fewer calls) that draws exclusively from Present and Late students, with real-time scoring and called-today history.
  - **Activities**: Per-session classroom activity score entry with automated absence synchronization.
  - **Projects**: Fixed Midterm and Finals project score tracking.
  - **Quiz**: Quiz sessions tracking total items, scores, and absence handling.
- **Absence Auto-Flagging**: Synchronizes student attendance with academic modules so absent students are automatically flagged across activities and quizzes.
- **Student Dashboard (View-Only)**: Students can view their enrolled classes, attendance tallies, recitation points, activity scores, project submissions, and quiz analytics.
- **Matrix Data Export**: Comprehensive reporting for Attendance, Recitation, Activities, Projects, and Quiz exported as student-by-session matrices in both Excel (`.xlsx`) and CSV (`.csv`) formats.
- **Security & Validation**: Client-validated reCAPTCHA v2 checkbox modal before class join and account registration requests, with server-side token verification before roster lookup.
- **Email Notifications**: Asynchronous transactional email notifications via Resend for registration verification and class enrollment updates.
- **Dark Mode**: System-aware theme support with persistent manual light/dark toggle.

---

## Tech Stack & Versions

- **Backend (`classdex-backend`)**:
  - Node.js (CommonJS, v20+ recommended)
  - Express `^5.2.1`
  - Prisma ORM `^7.10.0`
  - PostgreSQL client `@prisma/adapter-pg` `^7.10.0` & `pg` `^8.23.0`
  - bcryptjs `^3.0.3` (password hashing)
  - express-session `^1.19.0` (cookie-based session management)
  - Resend `^6.32.1` (email delivery)
  - SheetJS / xlsx `^0.18.5` (Excel workbook generation)
  - dotenv `^18.0.2` & cors `^2.8.6`
- **Frontend (`classdex-frontend`)**:
  - React `^19.2.8` & React DOM `^19.2.8`
  - React Router `^7.18.4`
  - Vite `^8.3.0`
  - Tailwind CSS `^4.3.3` with `@tailwindcss/vite` `^4.3.3`
  - qrcode `^1.5.4` (dynamic client-side QR generation)
  - oxlint `^1.81.0` (code linting)
- **Database**:
  - PostgreSQL (tested with Neon serverless PostgreSQL and local PostgreSQL)
- **Version Control**:
  - Git

---

## Project Structure

```
ClassDex/
├── classdex-backend/
│   ├── index.js                # Express application and API routes
│   ├── db.js                   # PrismaClient initialization
│   ├── email.js                # Transactional email building and queueing
│   ├── export.js               # Excel (.xlsx) and CSV matrix generation
│   ├── recaptcha.js            # Server-side reCAPTCHA verification
│   ├── prisma/
│   │   ├── schema.prisma       # Prisma schema definition
│   │   └── migrations/         # Additive SQL migrations
│   ├── prisma.config.ts        # Prisma 7 configuration file
│   ├── scripts/
│   │   └── apply-schema.js     # Idempotent migration runner
│   ├── test/
│   │   └── access-control.test.js # Backend unit tests (node --test)
│   ├── .env.example
│   └── package.json
├── classdex-frontend/
│   ├── src/
│   │   ├── components/         # Shared UI, icons, and classroom modules
│   │   ├── context/            # Authentication context
│   │   ├── pages/              # Faculty and Student pages
│   │   ├── api.js              # Fetch client wrapper
│   │   └── index.css           # Design tokens, themes, and layouts
│   ├── vite.config.js
│   ├── .env.example
│   └── package.json
└── README.md
```

---

## Prerequisites

- **Node.js**: Node.js v20.x, v22.x, or v24.x
- **Git**: Installed and available in PATH
- **PostgreSQL**: A cloud PostgreSQL instance (such as Neon) or local PostgreSQL database

---

## Run Locally (Step-by-Step)

### 1. Clone the Repository

```bash
git clone https://github.com/wayne-xfx/ClassDex.git
cd ClassDex
```

### 2. Install Dependencies

Install required dependencies for both backend and frontend applications:

```bash
# In classdex-backend:
cd classdex-backend
npm ci

# In classdex-frontend:
cd ../classdex-frontend
npm ci
```

*(Note: `npm install` may also be used).*

### 3. Configure Environment Variables

Create `.env` files in both `classdex-backend/` and `classdex-frontend/` based on their respective `.env.example` templates.

#### Backend Configuration (`classdex-backend/.env`)

| Variable | Description | Example / Default |
| :--- | :--- | :--- |
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://USER:PASSWORD@HOST/neondb?sslmode=require` |
| `PORT` | Port for the backend Express API | `5000` |
| `SESSION_SECRET` | Secret key for signing session cookies | `replace-with-a-long-random-string` |
| `FRONTEND_ORIGIN` | Allowed CORS origin for the frontend | `http://localhost:5173` |
| `FRONTEND_URL` | Base URL used in verification links | `http://localhost:5173` |
| `RECAPTCHA_SECRET_KEY`| Google reCAPTCHA v2 secret key | *(Optional in development)* |
| `RESEND_API_KEY` | Resend API key for email delivery | *(Optional; skips email if omitted)* |
| `EMAIL_FROM` | Sender email address for notifications | `ClassDex <no-reply@classdex.local>` |

#### Frontend Configuration (`classdex-frontend/.env`)

| Variable | Description | Example / Default |
| :--- | :--- | :--- |
| `VITE_RECAPTCHA_SITE_KEY` | Google reCAPTCHA v2 site key (Checkbox) | *(Optional in development)* |
| `VITE_CLOUDINARY_CLOUD_NAME` | Cloudinary cloud name for profile photos | *(Optional; stores image inline if omitted)* |
| `VITE_CLOUDINARY_UPLOAD_PRESET`| Cloudinary unsigned upload preset | *(Optional)* |

### 4. Database Setup

From `classdex-backend/`, run the project's setup script to generate the Prisma Client and apply all additive schema migrations:

```bash
# In classdex-backend/
npm run db:setup
```

#### What `npm run db:setup` Does
1. Runs `prisma generate` to compile the Prisma Client code to `node_modules/@prisma/client`.
2. Executes `node scripts/apply-schema.js`, which:
   - Connects to your PostgreSQL database using direct TLS (`sslnegotiation=direct`, required by Neon endpoints).
   - Creates the tracking table `_ClassDexMigration` if it does not already exist.
   - Applies each SQL migration in `prisma/migrations/` in chronological order within a transaction.
   - Verifies all required tables and columns (including `Class.gracePeriodMinutes`) are in place.

> [!NOTE]
> **Idempotent / Safe to Run Multiple Times:**
> `npm run db:setup` checks `_ClassDexMigration` before applying each migration. Already applied migrations are safely skipped.

#### Standalone Prisma Client Generation
If you only need to regenerate the Prisma Client without touching the database schema:
```bash
# In classdex-backend/
npx prisma generate
```

> [!NOTE]
> **Note on `npx prisma migrate status`:**
> `npx prisma migrate status` checks exclusively for Prisma's internal `_prisma_migrations` table. Because ClassDex applies migrations using its direct-connection runner `scripts/apply-schema.js` (tracking them in `_ClassDexMigration`), `_prisma_migrations` is not populated. It is therefore **expected and normal** for `npx prisma migrate status` to report pending migrations on an initialized database; the database tables and constraints are already fully in place and match `prisma/schema.prisma`.
>
> *(Do not run `npx prisma migrate deploy` or `npx prisma migrate resolve`, as Prisma Migrate CLI is not verified for this project).*

---

## 5. Start the Application

#### Start Backend API
From `classdex-backend/`:
```bash
npm run dev
# Or: npm start
```
The API starts on `http://localhost:5000`.

#### Start Frontend Client
From `classdex-frontend/`:
```bash
npm run dev
```
The client starts on `http://localhost:5173`. Open `http://localhost:5173` in your browser.

---

## Configuring Optional Third-Party Services

### Google reCAPTCHA v2
1. Visit the [Google reCAPTCHA Admin Console](https://www.google.com/recaptcha/admin).
2. Register a new site with type: **reCAPTCHA v2 ("I'm not a robot" Checkbox)**.
3. Add `localhost` and `127.0.0.1` to the list of allowed domains.
4. Add the generated Site Key to `classdex-frontend/.env` as `VITE_RECAPTCHA_SITE_KEY`.
5. Add the generated Secret Key to `classdex-backend/.env` as `RECAPTCHA_SECRET_KEY`.

### Email Notifications (Resend)
- Register at [Resend](https://resend.com) to obtain an API key.
- Set `RESEND_API_KEY` in `classdex-backend/.env`.
- If omitted, registration and join flows proceed normally, logging `Email skipped: RESEND_API_KEY is not configured` to the backend console.

### Profile Photos (Cloudinary)
- Register at [Cloudinary](https://cloudinary.com) and create an **unsigned upload preset**.
- Set `VITE_CLOUDINARY_CLOUD_NAME` and `VITE_CLOUDINARY_UPLOAD_PRESET` in `classdex-frontend/.env`.
- If omitted or the Cloudinary upload fails (for example, if the preset is not enabled for unsigned uploads), selected student/faculty photos are stored directly as inline data within the profile record in the database.

---

## Scripts & Testing

### Backend (`classdex-backend`)
- `npm test`: Runs backend access control and business rule tests (`node --test`).
- `npm run dev`: Starts backend development server (`node index.js`).
- `npm run start`: Starts backend production server (`node index.js`).
- `npm run db:setup`: Generates Prisma client and applies schema migrations (`prisma generate && node scripts/apply-schema.js`).

### Frontend (`classdex-frontend`)
- `npm run dev`: Starts Vite local development server (`vite`).
- `npm run build`: Bundles production assets into `dist/` (`vite build`).
- `npm run lint`: Runs `oxlint` static code analysis (`oxlint`).
- `npm run preview`: Previews built production bundle locally (`vite preview`).

---

## Troubleshooting

- **Database Connection / Schema Setup Failed**:
  - *Symptom*: `Database schema setup failed: connect ETIMEDOUT` or `DATABASE_URL is not set`.
  - *Solution*: Verify `DATABASE_URL` is set in `classdex-backend/.env`. For Neon connections, ensure the endpoint URL includes `?sslmode=require`. The script automatically configures direct TLS negotiation (`sslnegotiation=direct`).
- **reCAPTCHA Error / Rejected Token**:
  - *Symptom*: Captcha fails or reports `invalid-input-secret` / `invalid-input-response`.
  - *Solution*: Verify `localhost` is listed in your Google reCAPTCHA Admin Console domains, and ensure the Site Key is in `classdex-frontend/.env` while the Secret Key is in `classdex-backend/.env`.
- **CORS / Session Cookie Not Saved**:
  - *Symptom*: Frontend shows unauthorized errors immediately after logging in.
  - *Solution*: Ensure `FRONTEND_ORIGIN` in `classdex-backend/.env` exactly matches the browser address (e.g. `http://localhost:5173`).
- **Email Skipped Warning**:
  - *Symptom*: Backend logs `Email skipped: RESEND_API_KEY is not configured`.
  - *Explanation*: Normal developmental behavior when running without a Resend API key. The account is created and usable immediately.
- **Windows Line Endings (`CRLF`)**:
  - Ensure Git checkout preserves line endings using `git config core.autocrlf true` on Windows systems.

---

## System Limitations

1. **Internet Connectivity Required**: Google reCAPTCHA, Google Fonts, and optional CDN/email services require active internet connectivity.
2. **No Automated Grade Computation**: The application records attendance, recitation, activities, projects, and quizzes, and exports student matrices for faculty analysis; it does not automatically calculate final semester grades.
3. **Student View-Only Access**: Students can view their attendance logs and academic records, but cannot edit marks or scores.
4. **No University Portal Integration**: ClassDex operates as an independent classroom record-keeping tool and does not synchronize with Leyte Normal University's central enrollment portal.
