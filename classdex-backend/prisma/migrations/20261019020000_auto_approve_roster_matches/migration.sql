ALTER TABLE "ClassEnrollment"
  ADD COLUMN IF NOT EXISTS "autoApprovedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "autoApprovalReadAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "warningReadAbsenceCount" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS "ClassEnrollment_classId_autoApprovedAt_idx"
  ON "ClassEnrollment"("classId", "autoApprovedAt");
