ALTER TABLE "ClassSession"
  ALTER COLUMN "startedAt" DROP NOT NULL;

UPDATE "ClassSession" s
SET "startedAt" = NULL
WHERE NOT EXISTS (
  SELECT 1 FROM "AttendanceRecord" a WHERE a."sessionId" = s."id"
);
