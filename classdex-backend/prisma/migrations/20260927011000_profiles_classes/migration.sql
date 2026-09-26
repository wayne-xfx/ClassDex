DO $block$
BEGIN
    CREATE TYPE "Role" AS ENUM ('FACULTY', 'STUDENT');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END
$block$;

CREATE TABLE IF NOT EXISTS "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "User_email_key" ON "User"("email");

CREATE TABLE IF NOT EXISTS "FacultyProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT,
    "department" TEXT,
    "photo" TEXT,
    "email" TEXT,
    "contact" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "FacultyProfile_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "StudentProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "program" TEXT,
    "section" TEXT,
    "studentId" TEXT NOT NULL,
    "photo" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "birthdate" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "StudentProfile_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "StudentProfile_studentId_check" CHECK ("studentId" ~ '^[0-9]{7}$')
);

CREATE TABLE IF NOT EXISTS "Class" (
    "id" TEXT NOT NULL,
    "sectionName" TEXT NOT NULL,
    "classCode" TEXT NOT NULL,
    "description" TEXT,
    "schedule" TEXT,
    "facultyId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Class_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ClassEnrollment" (
    "id" TEXT NOT NULL,
    "studentProfileId" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ClassEnrollment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "FacultyProfile_userId_key"
    ON "FacultyProfile"("userId");
CREATE UNIQUE INDEX IF NOT EXISTS "StudentProfile_userId_key"
    ON "StudentProfile"("userId");
CREATE UNIQUE INDEX IF NOT EXISTS "StudentProfile_studentId_key"
    ON "StudentProfile"("studentId");
CREATE UNIQUE INDEX IF NOT EXISTS "Class_classCode_key"
    ON "Class"("classCode");
CREATE UNIQUE INDEX IF NOT EXISTS "ClassEnrollment_studentProfileId_classId_key"
    ON "ClassEnrollment"("studentProfileId", "classId");

DO $block$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'FacultyProfile_userId_fkey'
          AND conrelid = '"FacultyProfile"'::regclass
    ) THEN
        ALTER TABLE "FacultyProfile"
            ADD CONSTRAINT "FacultyProfile_userId_fkey"
            FOREIGN KEY ("userId") REFERENCES "User"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'StudentProfile_userId_fkey'
          AND conrelid = '"StudentProfile"'::regclass
    ) THEN
        ALTER TABLE "StudentProfile"
            ADD CONSTRAINT "StudentProfile_userId_fkey"
            FOREIGN KEY ("userId") REFERENCES "User"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'Class_facultyId_fkey'
          AND conrelid = '"Class"'::regclass
    ) THEN
        ALTER TABLE "Class"
            ADD CONSTRAINT "Class_facultyId_fkey"
            FOREIGN KEY ("facultyId") REFERENCES "User"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'ClassEnrollment_studentProfileId_fkey'
          AND conrelid = '"ClassEnrollment"'::regclass
    ) THEN
        ALTER TABLE "ClassEnrollment"
            ADD CONSTRAINT "ClassEnrollment_studentProfileId_fkey"
            FOREIGN KEY ("studentProfileId") REFERENCES "StudentProfile"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'ClassEnrollment_classId_fkey'
          AND conrelid = '"ClassEnrollment"'::regclass
    ) THEN
        ALTER TABLE "ClassEnrollment"
            ADD CONSTRAINT "ClassEnrollment_classId_fkey"
            FOREIGN KEY ("classId") REFERENCES "Class"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END
$block$;
