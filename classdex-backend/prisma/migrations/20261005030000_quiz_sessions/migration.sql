CREATE TABLE "QuizSession" (
    "id" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "totalItems" INTEGER NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "QuizSession_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "QuizScore" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "score" INTEGER,
    "isAbsent" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "QuizScore_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "QuizScore_sessionId_studentId_key" ON "QuizScore"("sessionId", "studentId");
CREATE INDEX "QuizSession_classId_date_idx" ON "QuizSession"("classId", "date");
CREATE INDEX "QuizScore_studentId_idx" ON "QuizScore"("studentId");
ALTER TABLE "QuizSession" ADD CONSTRAINT "QuizSession_classId_fkey" FOREIGN KEY ("classId") REFERENCES "Class"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "QuizScore" ADD CONSTRAINT "QuizScore_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "QuizSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "QuizScore" ADD CONSTRAINT "QuizScore_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "StudentProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
