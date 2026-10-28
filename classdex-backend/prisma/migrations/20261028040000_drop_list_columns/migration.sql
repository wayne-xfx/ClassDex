-- AlterTable ClassEnrollment
ALTER TABLE "ClassEnrollment" ADD COLUMN IF NOT EXISTS "droppedAt" TIMESTAMP(3);

-- AlterTable ClassRoster
ALTER TABLE "ClassRoster" ADD COLUMN IF NOT EXISTS "droppedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "ClassRoster_classId_droppedAt_idx" ON "ClassRoster"("classId", "droppedAt");
CREATE INDEX IF NOT EXISTS "ClassEnrollment_classId_status_droppedAt_idx" ON "ClassEnrollment"("classId", "status", "droppedAt");
