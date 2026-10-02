DO $block$
BEGIN
    CREATE TYPE "AttendanceStatus" AS ENUM ('PRESENT', 'LATE', 'ABSENT');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END
$block$;

DO $block$
BEGIN
    CREATE TYPE "RecitationMethod" AS ENUM ('RANDOM', 'WEIGHTED');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END
$block$;

ALTER TABLE "Class"
    ADD COLUMN IF NOT EXISTS "gracePeriodMinutes" INTEGER NOT NULL DEFAULT 15;

CREATE TABLE IF NOT EXISTS "ClassSession" (
    "id" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    CONSTRAINT "ClassSession_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AttendanceRecord" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "status" "AttendanceStatus" NOT NULL,
    "markedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AttendanceRecord_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "RecitationLog" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "method" "RecitationMethod" NOT NULL,
    "calledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "score" INTEGER,
    CONSTRAINT "RecitationLog_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "RecitationLog_score_check" CHECK ("score" IS NULL OR "score" BETWEEN 0 AND 5)
);

CREATE UNIQUE INDEX IF NOT EXISTS "ClassSession_classId_date_key"
    ON "ClassSession"("classId", "date");
CREATE UNIQUE INDEX IF NOT EXISTS "AttendanceRecord_sessionId_studentId_key"
    ON "AttendanceRecord"("sessionId", "studentId");
CREATE INDEX IF NOT EXISTS "AttendanceRecord_sessionId_status_idx"
    ON "AttendanceRecord"("sessionId", "status");
CREATE INDEX IF NOT EXISTS "RecitationLog_sessionId_calledAt_idx"
    ON "RecitationLog"("sessionId", "calledAt");
CREATE INDEX IF NOT EXISTS "RecitationLog_studentId_idx"
    ON "RecitationLog"("studentId");

DO $block$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'ClassSession_classId_fkey'
          AND conrelid = '"ClassSession"'::regclass
    ) THEN
        ALTER TABLE "ClassSession"
            ADD CONSTRAINT "ClassSession_classId_fkey"
            FOREIGN KEY ("classId") REFERENCES "Class"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'AttendanceRecord_sessionId_fkey'
          AND conrelid = '"AttendanceRecord"'::regclass
    ) THEN
        ALTER TABLE "AttendanceRecord"
            ADD CONSTRAINT "AttendanceRecord_sessionId_fkey"
            FOREIGN KEY ("sessionId") REFERENCES "ClassSession"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'AttendanceRecord_studentId_fkey'
          AND conrelid = '"AttendanceRecord"'::regclass
    ) THEN
        ALTER TABLE "AttendanceRecord"
            ADD CONSTRAINT "AttendanceRecord_studentId_fkey"
            FOREIGN KEY ("studentId") REFERENCES "StudentProfile"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'RecitationLog_sessionId_fkey'
          AND conrelid = '"RecitationLog"'::regclass
    ) THEN
        ALTER TABLE "RecitationLog"
            ADD CONSTRAINT "RecitationLog_sessionId_fkey"
            FOREIGN KEY ("sessionId") REFERENCES "ClassSession"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'RecitationLog_studentId_fkey'
          AND conrelid = '"RecitationLog"'::regclass
    ) THEN
        ALTER TABLE "RecitationLog"
            ADD CONSTRAINT "RecitationLog_studentId_fkey"
            FOREIGN KEY ("studentId") REFERENCES "StudentProfile"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END
$block$;
