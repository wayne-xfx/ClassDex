# ClassDex

ClassDex is a classroom record-keeping app for Leyte Normal University. Faculty
can create classes and share invite links; students create one reusable index
card and join multiple classes.

## Run locally

1. Install dependencies in `classdex-backend/` and `classdex-frontend/` with
   `npm install`.
2. Configure `classdex-backend/.env` with `DATABASE_URL`, `PORT=5000`,
   `SESSION_SECRET`, and `FRONTEND_ORIGIN=http://localhost:5173`. The database
   URL must point to a PostgreSQL database.
3. From `classdex-backend/`, run `npm run db:setup` to generate the Prisma
   client and apply the idempotent schema migration using PostgreSQL direct TLS.
   Run `npm run dev` to start the API.
4. From `classdex-frontend/`, run `npm run dev` and open
   `http://localhost:5173`.

The backend `.env` file is ignored by Git. Never put database credentials in
frontend configuration. The setup script uses `sslnegotiation=direct`, which
is required by the configured Neon endpoint and avoids relying on Prisma
schema-engine connection support for direct TLS.

## Profile photo storage

To upload profile photos to Cloudinary, copy
`classdex-frontend/.env.example` to `classdex-frontend/.env` and set
`VITE_CLOUDINARY_CLOUD_NAME` and `VITE_CLOUDINARY_UPLOAD_PRESET` to an unsigned
image-upload preset. Without those values, local development stores the
selected image data with the profile record instead.

## Implemented workflows

- Email/password registration and login for faculty and students.
- Faculty profile editing, class creation, unique invite codes, class rosters,
  and shareable join links.
- Required student photo and reusable profile, with an exact seven-digit student
  ID validated in the browser and API.
- Student enrollment in multiple classes with duplicate-join protection.
- Light/dark appearance that follows the operating system until a user chooses
  a saved preference.
