CREATE TABLE "ClassRoster" (
    "id" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "studentName" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ClassRoster_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ClassRoster_classId_studentId_key" ON "ClassRoster"("classId", "studentId");
CREATE INDEX "ClassRoster_classId_idx" ON "ClassRoster"("classId");
ALTER TABLE "ClassRoster" ADD CONSTRAINT "ClassRoster_classId_fkey" FOREIGN KEY ("classId") REFERENCES "Class"("id") ON DELETE CASCADE ON UPDATE CASCADE;
