CREATE INDEX IF NOT EXISTS "Class_facultyId_createdAt_idx"
  ON "Class"("facultyId", "createdAt");

CREATE INDEX IF NOT EXISTS "ClassEnrollment_classId_status_studentProfileId_idx"
  ON "ClassEnrollment"("classId", "status", "studentProfileId");

CREATE INDEX IF NOT EXISTS "AttendanceRecord_studentId_idx"
  ON "AttendanceRecord"("studentId");
