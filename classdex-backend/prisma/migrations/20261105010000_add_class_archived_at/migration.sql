-- AlterTable Class
ALTER TABLE "Class" ADD COLUMN IF NOT EXISTS "archivedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Class_facultyId_archivedAt_idx" ON "Class"("facultyId", "archivedAt");
