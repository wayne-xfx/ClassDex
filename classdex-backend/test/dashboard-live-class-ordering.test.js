require("dotenv").config();
const test = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcryptjs");
const { app, resetRateLimitersForTests } = require("../index");
const { prisma } = require("../db");

async function generateUnusedStudentId(usedIds) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const candidate = String(8100000 + Math.floor(Math.random() * 899999));
    if (usedIds.has(candidate)) continue;
    const [existingProfile, existingRoster] = await Promise.all([
      prisma.studentProfile.findUnique({ where: { studentId: candidate }, select: { id: true } }),
      prisma.classRoster.findFirst({ where: { studentId: candidate }, select: { id: true } }),
    ]);
    if (!existingProfile && !existingRoster) {
      usedIds.add(candidate);
      return candidate;
    }
  }
  throw new Error("Could not allocate an unused 7-digit studentId for test.");
}

async function loginAndGetCookie(baseUrl, email, password) {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  assert.equal(res.status, 200, `Login failed for ${email}`);
  const rawSetCookie = res.headers.get("set-cookie") || "";
  const sessionPair = rawSetCookie.split(";")[0];
  assert.ok(sessionPair.includes("="), "Expected session cookie on login");
  return sessionPair;
}

test("lastSessionAt on GET /api/faculty/classes and GET /api/student/classes ignores empty unstarted sessions and returns latest active session date", async (t) => {
  resetRateLimitersForTests();
  const createdClassIds = [];
  const createdUserIds = [];
  const usedStudentIds = new Set();
  const server = app.listen(0);

  t.after(async () => {
    resetRateLimitersForTests();
    await new Promise((resolve) => server.close(resolve));
    if (createdClassIds.length > 0) {
      await prisma.class.deleteMany({
        where: { id: { in: createdClassIds } },
      });
    }
    if (createdUserIds.length > 0) {
      await prisma.user.deleteMany({
        where: { id: { in: createdUserIds } },
      });
    }
    await prisma.$disconnect();
  });

  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;
  const runId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const passwordPlain = "Password123!";
  const hashedPassword = await bcrypt.hash(passwordPlain, 10);

  const facultyUser = await prisma.user.create({
    data: {
      name: "Faculty Ordering Test",
      email: `faculty.order.${runId}@test.local`,
      password: hashedPassword,
      role: "FACULTY",
      emailVerified: true,
    },
  });
  createdUserIds.push(facultyUser.id);

  const studentIdNumber = await generateUnusedStudentId(usedStudentIds);
  const studentEmail = `student.order.${runId}@test.local`;
  const studentUser = await prisma.user.create({
    data: {
      name: "Student Ordering Test",
      email: studentEmail,
      password: hashedPassword,
      role: "STUDENT",
      emailVerified: true,
      studentProfile: {
        create: {
          name: "Student Ordering Test",
          email: studentEmail,
          studentId: studentIdNumber,
          birthdate: new Date("2005-05-15T00:00:00.000Z"),
          program: "BSIT",
          section: "AI33",
          address: "Test Address",
          photo: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
        },
      },
    },
    include: { studentProfile: true },
  });
  createdUserIds.push(studentUser.id);
  const studentProfileId = studentUser.studentProfile.id;

  const codePrefix = runId.slice(-4).toUpperCase();
  const classNoSessions = await prisma.class.create({
    data: {
      sectionName: `No Sessions ${runId}`,
      classCode: `NS${codePrefix}1`,
      facultyId: facultyUser.id,
      schedule: "Mon 7:30 AM - 9:00 AM",
    },
  });
  createdClassIds.push(classNoSessions.id);

  const classEmptyUnstarted = await prisma.class.create({
    data: {
      sectionName: `Empty Unstarted ${runId}`,
      classCode: `EU${codePrefix}2`,
      facultyId: facultyUser.id,
      schedule: "Tue 7:30 AM - 9:00 AM",
    },
  });
  createdClassIds.push(classEmptyUnstarted.id);

  const classWithActiveSessions = await prisma.class.create({
    data: {
      sectionName: `Active Sessions ${runId}`,
      classCode: `AS${codePrefix}3`,
      facultyId: facultyUser.id,
      schedule: "Wed 8:00 AM - 10:00 AM",
    },
  });
  createdClassIds.push(classWithActiveSessions.id);

  const classArchivedWithAttendance = await prisma.class.create({
    data: {
      sectionName: `Archived Active ${runId}`,
      classCode: `AR${codePrefix}4`,
      facultyId: facultyUser.id,
      schedule: "Thu 1:00 PM - 2:30 PM",
      archivedAt: new Date("2026-10-25T00:00:00.000Z"),
    },
  });
  createdClassIds.push(classArchivedWithAttendance.id);

  const otherClass = await prisma.class.create({
    data: {
      sectionName: `Other Class ${runId}`,
      classCode: `OC${codePrefix}5`,
      facultyId: facultyUser.id,
    },
  });
  createdClassIds.push(otherClass.id);

  // Enroll student in the first 4 classes
  await prisma.classEnrollment.createMany({
    data: [
      { classId: classNoSessions.id, studentProfileId, status: "APPROVED" },
      { classId: classEmptyUnstarted.id, studentProfileId, status: "APPROVED" },
      { classId: classWithActiveSessions.id, studentProfileId, status: "APPROVED" },
      { classId: classArchivedWithAttendance.id, studentProfileId, status: "APPROVED" },
    ],
  });

  // 1. Bare auto-created session (startedAt: null, no records) -> must NOT count
  await prisma.classSession.create({
    data: {
      classId: classEmptyUnstarted.id,
      date: new Date("2026-10-29T00:00:00.000Z"),
      startedAt: null,
    },
  });

  // 2. Class with older started session (Oct 10), newer started session (Oct 20), and bare unstarted session (Oct 28)
  await prisma.classSession.createMany({
    data: [
      {
        classId: classWithActiveSessions.id,
        date: new Date("2026-10-10T00:00:00.000Z"),
        startedAt: new Date("2026-10-10T01:00:00.000Z"),
      },
      {
        classId: classWithActiveSessions.id,
        date: new Date("2026-10-20T00:00:00.000Z"),
        startedAt: new Date("2026-10-20T01:00:00.000Z"),
      },
      {
        classId: classWithActiveSessions.id,
        date: new Date("2026-10-28T00:00:00.000Z"),
        startedAt: null,
      },
    ],
  });

  // 3. Archived class with a session where startedAt is null, but an attendance record exists (Oct 15)
  const archivedSession = await prisma.classSession.create({
    data: {
      classId: classArchivedWithAttendance.id,
      date: new Date("2026-10-15T00:00:00.000Z"),
      startedAt: null,
    },
  });
  await prisma.attendanceRecord.create({
    data: {
      sessionId: archivedSession.id,
      studentId: studentProfileId,
      status: "PRESENT",
    },
  });

  // 4. Another class with a later session (Oct 30) to verify no cross-class leakage
  await prisma.classSession.create({
    data: {
      classId: otherClass.id,
      date: new Date("2026-10-30T00:00:00.000Z"),
      startedAt: new Date("2026-10-30T01:00:00.000Z"),
    },
  });

  const [facultyCookie, studentCookie] = await Promise.all([
    loginAndGetCookie(baseUrl, facultyUser.email, passwordPlain),
    loginAndGetCookie(baseUrl, studentUser.email, passwordPlain),
  ]);

  const facultyRes = await fetch(`${baseUrl}/api/faculty/classes`, {
    headers: { Cookie: facultyCookie },
  });
  assert.equal(facultyRes.status, 200);
  const facultyBody = await facultyRes.json();
  const facultyById = new Map(facultyBody.classes.map((c) => [c.id, c]));

  assert.equal(facultyById.get(classNoSessions.id)?.lastSessionAt, null);
  assert.equal(facultyById.get(classEmptyUnstarted.id)?.lastSessionAt, null);
  assert.equal(
    facultyById.get(classWithActiveSessions.id)?.lastSessionAt,
    "2026-10-20T00:00:00.000Z",
  );
  assert.equal(
    facultyById.get(classArchivedWithAttendance.id)?.lastSessionAt,
    "2026-10-15T00:00:00.000Z",
  );
  assert.equal(
    facultyById.get(otherClass.id)?.lastSessionAt,
    "2026-10-30T00:00:00.000Z",
  );

  const studentRes = await fetch(`${baseUrl}/api/student/classes`, {
    headers: { Cookie: studentCookie },
  });
  assert.equal(studentRes.status, 200);
  const studentBody = await studentRes.json();
  const studentById = new Map(studentBody.classes.map((c) => [c.id, c]));

  assert.equal(studentById.get(classNoSessions.id)?.lastSessionAt, null);
  assert.equal(studentById.get(classEmptyUnstarted.id)?.lastSessionAt, null);
  assert.equal(
    studentById.get(classWithActiveSessions.id)?.lastSessionAt,
    "2026-10-20T00:00:00.000Z",
  );
  assert.equal(
    studentById.get(classArchivedWithAttendance.id)?.lastSessionAt,
    "2026-10-15T00:00:00.000Z",
  );
  assert.ok(studentById.get(classWithActiveSessions.id)?.createdAt, "Expected createdAt on student class object");
});
