function isValidScore(score, maxScore) {
  return score === null || (
    Number.isInteger(score)
    && score >= 0
    && (maxScore === null || score <= maxScore)
  );
}

async function syncAttendanceScoreAbsence(transaction, sessionId, studentId, absent) {
  const sessionRecord = await transaction.classSession.findUnique({
    where: { id: sessionId },
    select: { classId: true },
  });
  if (!sessionRecord) throw new Error("Class session not found while synchronizing absence scores.");
  const [activities, projects] = await Promise.all([
    transaction.activity.findMany({ where: { sessionId }, select: { id: true } }),
    transaction.project.findMany({
      where: { classId: sessionRecord.classId },
      select: { id: true },
    }),
  ]);
  const activityIds = activities.map(({ id }) => id);
  const projectIds = projects.map(({ id }) => id);

  if (absent && activityIds.length) {
    await transaction.activityScore.createMany({
      data: activityIds.map((activityId) => ({
        activityId,
        studentId,
        isAbsent: true,
        score: null,
      })),
      skipDuplicates: true,
    });
  }
  if (activityIds.length) {
    await transaction.activityScore.updateMany({
      where: { activityId: { in: activityIds }, studentId },
      data: absent ? { isAbsent: true, score: null } : { isAbsent: false },
    });
  }

  if (absent && projectIds.length) {
    await transaction.projectScore.createMany({
      data: projectIds.map((projectId) => ({
        projectId,
        studentId,
        sessionId,
        isAbsent: true,
        score: null,
      })),
      skipDuplicates: true,
    });
  }
  if (projectIds.length) {
    await transaction.projectScore.updateMany({
      where: {
        projectId: { in: projectIds },
        studentId,
        ...(absent ? { score: null } : { sessionId }),
      },
      data: { isAbsent: absent, ...(absent ? { sessionId } : {}) },
    });
  }
}

async function createAbsentActivityScores(transaction, activityId, sessionId) {
  const absentStudents = await transaction.attendanceRecord.findMany({
    where: { sessionId, status: "ABSENT" },
    select: { studentId: true },
  });
  if (absentStudents.length) {
    await transaction.activityScore.createMany({
      data: absentStudents.map(({ studentId }) => ({
        activityId,
        studentId,
        isAbsent: true,
      })),
      skipDuplicates: true,
    });
  }
}

async function createAbsentProjectScores(transaction, projectId, sessionId) {
  const absentRecords = await transaction.attendanceRecord.findMany({
    where: { sessionId, status: "ABSENT" },
    select: { studentId: true, sessionId: true },
  });
  if (absentRecords.length) {
    await transaction.projectScore.createMany({
      data: absentRecords.map(({ studentId, sessionId }) => ({
        projectId,
        studentId,
        sessionId,
        isAbsent: true,
      })),
      skipDuplicates: true,
    });
  }
}

module.exports = {
  isValidScore,
  syncAttendanceScoreAbsence,
  createAbsentActivityScores,
  createAbsentProjectScores,
};
