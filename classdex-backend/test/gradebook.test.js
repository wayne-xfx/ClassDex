const test = require("node:test");
const assert = require("node:assert/strict");
const {
  isValidScore,
  syncAttendanceScoreAbsence,
  createAbsentActivityScores,
  createAbsentProjectScores,
} = require("../gradebook");

test("scores are whole nonnegative numbers and honor an optional maximum", () => {
  assert.equal(isValidScore(0, 10), true);
  assert.equal(isValidScore(10, 10), true);
  assert.equal(isValidScore(200, null), true);
  assert.equal(isValidScore(null, 10), true);
  assert.equal(isValidScore(1.5, 10), false);
  assert.equal(isValidScore("1", 10), false);
  assert.equal(isValidScore(-1, 10), false);
  assert.equal(isValidScore(11, 10), false);
});

function absenceTransaction(calls) {
  return {
    classSession: {
      findUnique: async (args) => {
        calls.push(["session", args]);
        return { classId: "class-1" };
      },
    },
    activity: {
      findMany: async (args) => {
        calls.push(["activities", args]);
        return [{ id: "activity-1" }];
      },
    },
    project: {
      findMany: async (args) => {
        calls.push(["projects", args]);
        return [{ id: "project-1" }];
      },
    },
    activityScore: {
      createMany: async (args) => calls.push(["activity-create", args]),
      updateMany: async (args) => calls.push(["activity-update", args]),
    },
    projectScore: {
      createMany: async (args) => calls.push(["project-create", args]),
      updateMany: async (args) => calls.push(["project-update", args]),
    },
  };
}

test("marking absent creates missing rows, flags scores, and clears activity scores", async () => {
  const calls = [];
  await syncAttendanceScoreAbsence(absenceTransaction(calls), "session-1", "student-1", true);

  assert.deepEqual(calls.slice(0, 3), [
    ["session", { where: { id: "session-1" }, select: { classId: true } }],
    ["activities", { where: { sessionId: "session-1" }, select: { id: true } }],
    ["projects", { where: { classId: "class-1" }, select: { id: true } }],
  ]);
  assert.deepEqual(calls.slice(3), [
    ["activity-create", {
      data: [{
        activityId: "activity-1",
        studentId: "student-1",
        isAbsent: true,
        score: null,
      }],
      skipDuplicates: true,
    }],
    ["activity-update", {
      where: { activityId: { in: ["activity-1"] }, studentId: "student-1" },
      data: { isAbsent: true, score: null },
    }],
    ["project-create", {
      data: [{
        projectId: "project-1",
        studentId: "student-1",
        sessionId: "session-1",
        isAbsent: true,
        score: null,
      }],
      skipDuplicates: true,
    }],
    ["project-update", {
      where: { projectId: { in: ["project-1"] }, studentId: "student-1", score: null },
      data: { isAbsent: true, sessionId: "session-1" },
    }],
  ]);
});

test("leaving absent clears flags without erasing saved scores", async () => {
  const calls = [];
  await syncAttendanceScoreAbsence(absenceTransaction(calls), "session-2", "student-2", false);

  assert.deepEqual(calls.slice(3), [
    ["activity-update", {
      where: { activityId: { in: ["activity-1"] }, studentId: "student-2" },
      data: { isAbsent: false },
    }],
    ["project-update", {
      where: { projectId: { in: ["project-1"] }, studentId: "student-2", sessionId: "session-2" },
      data: { isAbsent: false },
    }],
  ]);
});

test("new activities and projects flag students absent in the session", async () => {
  const calls = [];
  const activityTransaction = {
    attendanceRecord: {
      findMany: async (args) => {
        calls.push(["activity-query", args]);
        return [{ studentId: "student-a" }];
      },
    },
    activityScore: { createMany: async (args) => calls.push(["activity-create", args]) },
  };
  const projectTransaction = {
    attendanceRecord: {
      findMany: async (args) => {
        calls.push(["project-query", args]);
        return [{ studentId: "student-b", sessionId: "session-3" }];
      },
    },
    projectScore: { createMany: async (args) => calls.push(["project-create", args]) },
  };

  await createAbsentActivityScores(activityTransaction, "activity-1", "session-3");
  await createAbsentProjectScores(projectTransaction, "project-1", "session-3");

  assert.deepEqual(calls, [
    ["activity-query", {
      where: { sessionId: "session-3", status: "ABSENT" },
      select: { studentId: true },
    }],
    ["activity-create", {
      data: [{ activityId: "activity-1", studentId: "student-a", isAbsent: true }],
      skipDuplicates: true,
    }],
    ["project-query", {
      where: { sessionId: "session-3", status: "ABSENT" },
      select: { studentId: true, sessionId: true },
    }],
    ["project-create", {
      data: [{
        projectId: "project-1",
        studentId: "student-b",
        sessionId: "session-3",
        isAbsent: true,
      }],
      skipDuplicates: true,
    }],
  ]);
});
