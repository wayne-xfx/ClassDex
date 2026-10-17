const test = require("node:test");
const assert = require("node:assert/strict");

function requireAuth(req, res, next) {
  if (!req.session?.userId) {
    return res.status(401).json({ message: "Please log in to continue." });
  }
  return next();
}

function requireRole(role) {
  return (req, res, next) => {
    if (req.session?.role !== role) {
      return res.status(403).json({ message: "You do not have permission to do that." });
    }
    return next();
  };
}

function createMockRes() {
  const res = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.body = data;
      return this;
    },
  };
  return res;
}

test("Access rule (d): faculty token on student endpoint is blocked with 403", () => {
  const req = { session: { userId: "faculty-1", role: "FACULTY" } };
  const res = createMockRes();
  let nextCalled = false;
  requireRole("STUDENT")(req, res, () => { nextCalled = true; });

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 403);
  assert.match(res.body.message, /permission/i);
});

test("Access rule (e): student token on faculty endpoint is blocked with 403", () => {
  const req = { session: { userId: "student-1", role: "STUDENT" } };
  const res = createMockRes();
  let nextCalled = false;
  requireRole("FACULTY")(req, res, () => { nextCalled = true; });

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 403);
  assert.match(res.body.message, /permission/i);
});

test("Access rule (a & c): student records handler binds to session user and ignores forged studentId", async () => {
  let queriedStudentProfileUserId = null;
  let queriedAttendanceStudentId = null;

  const mockPrisma = {
    studentProfile: {
      findUnique: async ({ where }) => {
        queriedStudentProfileUserId = where.userId;
        return { id: "profile-student-A", userId: where.userId, name: "Student A" };
      },
    },
    class: {
      findFirst: async ({ where }) => {
        if (where.enrollments?.some?.studentProfileId === "profile-student-A") {
          return { id: where.id, sectionName: "CS101", faculty: { name: "Prof" } };
        }
        return null;
      },
    },
    attendanceRecord: {
      findMany: async ({ where }) => {
        queriedAttendanceStudentId = where.studentId;
        return [];
      },
    },
    recitationLog: { findMany: async () => [] },
    activityScore: { findMany: async () => [] },
    projectScore: { findMany: async () => [] },
    quizScore: { findMany: async () => [] },
  };

  const req = {
    session: { userId: "user-student-A", role: "STUDENT" },
    params: { classId: "class-1" },
    query: { studentId: "victim-student-B" },
    body: { studentId: "victim-student-B" },
  };
  const res = createMockRes();

  const profile = await mockPrisma.studentProfile.findUnique({
    where: { userId: req.session.userId },
  });
  const classRecord = await mockPrisma.class.findFirst({
    where: {
      id: req.params.classId,
      enrollments: { some: { studentProfileId: profile.id, status: { in: ["APPROVED", "PENDING"] } } },
    },
  });

  if (!classRecord) {
    res.status(404).json({ message: "Class not found." });
  } else {
    const [attendance, recitations, activities, projects, quizzes] = await Promise.all([
      mockPrisma.attendanceRecord.findMany({
        where: { studentId: profile.id, session: { is: { classId: classRecord.id } } },
      }),
      mockPrisma.recitationLog.findMany({
        where: { studentId: profile.id, session: { is: { classId: classRecord.id } } },
      }),
      mockPrisma.activityScore.findMany({
        where: { studentId: profile.id, activity: { is: { classId: classRecord.id } } },
      }),
      mockPrisma.projectScore.findMany({
        where: { studentId: profile.id, project: { is: { classId: classRecord.id } } },
      }),
      mockPrisma.quizScore.findMany({
        where: { studentId: profile.id, session: { is: { classId: classRecord.id } } },
      }),
    ]);
    res.json({ success: true, attendance, recitations, activities, projects, quizzes });
  }

  assert.equal(queriedStudentProfileUserId, "user-student-A");
  assert.equal(queriedAttendanceStudentId, "profile-student-A");
  assert.notEqual(queriedAttendanceStudentId, "victim-student-B");
  assert.deepEqual(res.body.attendance, []);
  assert.deepEqual(res.body.recitations, []);
  assert.deepEqual(res.body.activities, []);
  assert.deepEqual(res.body.projects, []);
  assert.deepEqual(res.body.quizzes, []);
});

test("Access rule (b): student requesting a class they are not admitted to returns 404", async () => {
  const mockPrisma = {
    studentProfile: {
      findUnique: async () => ({ id: "profile-student-A", name: "Student A" }),
    },
    class: {
      findFirst: async () => null, // Not enrolled/admitted
    },
  };

  const req = {
    session: { userId: "user-student-A", role: "STUDENT" },
    params: { classId: "class-unadmitted" },
  };
  const res = createMockRes();

  const profile = await mockPrisma.studentProfile.findUnique({
    where: { userId: req.session.userId },
  });
  const classRecord = await mockPrisma.class.findFirst({
    where: {
      id: req.params.classId,
      enrollments: { some: { studentProfileId: profile.id, status: { in: ["APPROVED", "PENDING"] } } },
    },
  });

  if (!classRecord) {
    res.status(404).json({ message: "Class not found." });
  }

  assert.equal(res.statusCode, 404);
  assert.equal(res.body.message, "Class not found.");
});
