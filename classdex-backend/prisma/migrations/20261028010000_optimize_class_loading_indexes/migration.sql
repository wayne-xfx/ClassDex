CREATE INDEX IF NOT EXISTS "ClassRoster_studentId_idx"
  ON "ClassRoster"("studentId");

CREATE INDEX IF NOT EXISTS "ActivityScore_activityId_isAbsent_idx"
  ON "ActivityScore"("activityId", "isAbsent");
