DO $block$
BEGIN
    CREATE TYPE "ProjectType" AS ENUM ('MIDTERM', 'FINALS');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END
$block$;

CREATE TABLE IF NOT EXISTS "Activity" (
    "id" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "maxScore" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Activity_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Activity_maxScore_check" CHECK ("maxScore" IS NULL OR "maxScore" > 0)
);

CREATE TABLE IF NOT EXISTS "ActivityScore" (
    "id" TEXT NOT NULL,
    "activityId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "score" INTEGER,
    "isAbsent" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ActivityScore_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ActivityScore_score_check" CHECK ("score" IS NULL OR "score" >= 0)
);

CREATE TABLE IF NOT EXISTS "Project" (
    "id" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "type" "ProjectType" NOT NULL,
    "maxScore" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Project_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Project_maxScore_check" CHECK ("maxScore" IS NULL OR "maxScore" > 0)
);

CREATE TABLE IF NOT EXISTS "ProjectScore" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "sessionId" TEXT,
    "score" INTEGER,
    "isAbsent" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ProjectScore_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ProjectScore_score_check" CHECK ("score" IS NULL OR "score" >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS "ActivityScore_activityId_studentId_key"
    ON "ActivityScore"("activityId", "studentId");
CREATE INDEX IF NOT EXISTS "Activity_sessionId_idx" ON "Activity"("sessionId");
CREATE INDEX IF NOT EXISTS "ActivityScore_studentId_idx" ON "ActivityScore"("studentId");
CREATE UNIQUE INDEX IF NOT EXISTS "Project_classId_type_key"
    ON "Project"("classId", "type");
CREATE UNIQUE INDEX IF NOT EXISTS "ProjectScore_projectId_studentId_key"
    ON "ProjectScore"("projectId", "studentId");
CREATE INDEX IF NOT EXISTS "ProjectScore_sessionId_studentId_idx"
    ON "ProjectScore"("sessionId", "studentId");
CREATE INDEX IF NOT EXISTS "ProjectScore_studentId_idx" ON "ProjectScore"("studentId");

DO $block$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'Activity_classId_fkey'
          AND conrelid = '"Activity"'::regclass
    ) THEN
        ALTER TABLE "Activity"
            ADD CONSTRAINT "Activity_classId_fkey"
            FOREIGN KEY ("classId") REFERENCES "Class"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'Activity_sessionId_fkey'
          AND conrelid = '"Activity"'::regclass
    ) THEN
        ALTER TABLE "Activity"
            ADD CONSTRAINT "Activity_sessionId_fkey"
            FOREIGN KEY ("sessionId") REFERENCES "ClassSession"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'ActivityScore_activityId_fkey'
          AND conrelid = '"ActivityScore"'::regclass
    ) THEN
        ALTER TABLE "ActivityScore"
            ADD CONSTRAINT "ActivityScore_activityId_fkey"
            FOREIGN KEY ("activityId") REFERENCES "Activity"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'ActivityScore_studentId_fkey'
          AND conrelid = '"ActivityScore"'::regclass
    ) THEN
        ALTER TABLE "ActivityScore"
            ADD CONSTRAINT "ActivityScore_studentId_fkey"
            FOREIGN KEY ("studentId") REFERENCES "StudentProfile"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'Project_classId_fkey'
          AND conrelid = '"Project"'::regclass
    ) THEN
        ALTER TABLE "Project"
            ADD CONSTRAINT "Project_classId_fkey"
            FOREIGN KEY ("classId") REFERENCES "Class"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'ProjectScore_projectId_fkey'
          AND conrelid = '"ProjectScore"'::regclass
    ) THEN
        ALTER TABLE "ProjectScore"
            ADD CONSTRAINT "ProjectScore_projectId_fkey"
            FOREIGN KEY ("projectId") REFERENCES "Project"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'ProjectScore_studentId_fkey'
          AND conrelid = '"ProjectScore"'::regclass
    ) THEN
        ALTER TABLE "ProjectScore"
            ADD CONSTRAINT "ProjectScore_studentId_fkey"
            FOREIGN KEY ("studentId") REFERENCES "StudentProfile"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'ProjectScore_sessionId_fkey'
          AND conrelid = '"ProjectScore"'::regclass
    ) THEN
        ALTER TABLE "ProjectScore"
            ADD CONSTRAINT "ProjectScore_sessionId_fkey"
            FOREIGN KEY ("sessionId") REFERENCES "ClassSession"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END
$block$;
