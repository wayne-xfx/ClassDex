-- AlterTable Class
ALTER TABLE "Class" ADD COLUMN IF NOT EXISTS "recitationShuffleSeconds" INTEGER NOT NULL DEFAULT 3;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Class_recitationShuffleSeconds_check'
  ) THEN
    ALTER TABLE "Class" ADD CONSTRAINT "Class_recitationShuffleSeconds_check" CHECK ("recitationShuffleSeconds" BETWEEN 1 AND 7);
  END IF;
END $$;
