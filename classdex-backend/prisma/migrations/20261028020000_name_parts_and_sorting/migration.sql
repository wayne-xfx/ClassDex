-- AlterTable StudentProfile
ALTER TABLE "StudentProfile" ADD COLUMN IF NOT EXISTS "firstName" TEXT;
ALTER TABLE "StudentProfile" ADD COLUMN IF NOT EXISTS "middleName" TEXT;
ALTER TABLE "StudentProfile" ADD COLUMN IF NOT EXISTS "lastName" TEXT;
ALTER TABLE "StudentProfile" ADD COLUMN IF NOT EXISTS "suffix" TEXT;
ALTER TABLE "StudentProfile" ADD COLUMN IF NOT EXISTS "sortKey" TEXT;

CREATE INDEX IF NOT EXISTS "StudentProfile_sortKey_idx" ON "StudentProfile"("sortKey");

-- AlterTable ClassRoster
ALTER TABLE "ClassRoster" ADD COLUMN IF NOT EXISTS "firstName" TEXT;
ALTER TABLE "ClassRoster" ADD COLUMN IF NOT EXISTS "middleName" TEXT;
ALTER TABLE "ClassRoster" ADD COLUMN IF NOT EXISTS "lastName" TEXT;
ALTER TABLE "ClassRoster" ADD COLUMN IF NOT EXISTS "suffix" TEXT;
ALTER TABLE "ClassRoster" ADD COLUMN IF NOT EXISTS "sortKey" TEXT;

CREATE INDEX IF NOT EXISTS "ClassRoster_sortKey_idx" ON "ClassRoster"("sortKey");
CREATE INDEX IF NOT EXISTS "ClassRoster_classId_sortKey_idx" ON "ClassRoster"("classId", "sortKey");
