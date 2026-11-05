const path = require("node:path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });
const test = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcryptjs");
const { app, resetRateLimitersForTests } = require("../index");
const { prisma } = require("../db");

test("§Fix2: Bulk Attendance API (PUT /api/sessions/:id/attendance)", async (t) => {
  resetRateLimitersForTests();
  const server = app.listen(0);
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;
  const runId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const hashedPassword = await bcrypt.hash("password123", 10);

  const samplePhoto =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

  // 1. Create Faculty User & Class
  const facultyUser = await prisma.user.create({
    data: {
      name: "Bulk Attendance Faculty",
      email: `faculty.bulk.${runId}@test.local`,
      password: hashedPassword,
      role: "FACULTY",
      emailVerified: true,
    },
  });

  const testClass = await prisma.class.create({
    data: {
      sectionName: "Bulk Attendance Section",
      classCode: `BLK-${runId}`.slice(0, 10).toUpperCase(),
      facultyId: facultyUser.id,
      gracePeriodMinutes: 15,
    },
  });

  // 2. Create Student 1 and Student 2
  const studentUser1 = await prisma.user.create({
    data: {
      name: "Bulk Student One",
      email: `student1.bulk.${runId}@test.local`,
      password: hashedPassword,
      role: "STUDENT",
      emailVerified: true,
    },
  });

  const studentProfile1 = await prisma.studentProfile.create({
    data: {
      userId: studentUser1.id,
      name: "Bulk Student One",
      studentId: String(Math.floor(1000000 + Math.random() * 8999999)),
      email: studentUser1.email,
      photo: samplePhoto,
    },
  });

  await prisma.classEnrollment.create({
    data: {
      classId: testClass.id,
      studentProfileId: studentProfile1.id,
      status: "APPROVED",
    },
  });

  const studentUser2 = await prisma.user.create({
    data: {
      name: "Bulk Student Two",
      email: `student2.bulk.${runId}@test.local`,
      password: hashedPassword,
      role: "STUDENT",
      emailVerified: true,
    },
  });

  const studentProfile2 = await prisma.studentProfile.create({
    data: {
      userId: studentUser2.id,
      name: "Bulk Student Two",
      studentId: String(Math.floor(1000000 + Math.random() * 8999999)),
      email: studentUser2.email,
      photo: samplePhoto,
    },
  });

  await prisma.classEnrollment.create({
    data: {
      classId: testClass.id,
      studentProfileId: studentProfile2.id,
      status: "APPROVED",
    },
  });

  // 3. Create Session
  const session = await prisma.classSession.create({
    data: {
      classId: testClass.id,
      date: new Date(),
    },
  });

  t.after(async () => {
    try {
      await prisma.attendanceRecord.deleteMany({ where: { sessionId: session.id } });
      await prisma.classSession.deleteMany({ where: { classId: testClass.id } });
      await prisma.classEnrollment.deleteMany({ where: { classId: testClass.id } });
      await prisma.class.delete({ where: { id: testClass.id } });
      await prisma.studentProfile.delete({ where: { id: studentProfile1.id } });
      await prisma.studentProfile.delete({ where: { id: studentProfile2.id } });
      await prisma.user.delete({ where: { id: studentUser1.id } });
      await prisma.user.delete({ where: { id: studentUser2.id } });
      await prisma.user.delete({ where: { id: facultyUser.id } });
    } catch (cleanupErr) {
      console.error("Cleanup error in bulk-attendance.test.js:", cleanupErr);
    }
    await new Promise((resolve) => server.close(resolve));
  });

  async function loginAs(email, password = "password123") {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const cookie = res.headers.get("set-cookie");
    return cookie ? cookie.split(";")[0] : "";
  }

  const facultyCookie = await loginAs(facultyUser.email);

  await t.test("PUT /api/sessions/:id/attendance validates payload", async () => {
    const res1 = await fetch(`${baseUrl}/api/sessions/${session.id}/attendance`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: facultyCookie },
      body: JSON.stringify({}),
    });
    assert.strictEqual(res1.status, 400);

    const res2 = await fetch(`${baseUrl}/api/sessions/${session.id}/attendance`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: facultyCookie },
      body: JSON.stringify({ updates: [{ studentId: studentProfile1.id, status: "INVALID" }] }),
    });
    assert.strictEqual(res2.status, 400);
  });

  await t.test("PUT /api/sessions/:id/attendance updates multiple students and starts session", async () => {
    const res = await fetch(`${baseUrl}/api/sessions/${session.id}/attendance`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: facultyCookie },
      body: JSON.stringify({
        updates: [
          { studentId: studentProfile1.id, status: "PRESENT" },
          { studentId: studentProfile2.id, status: "ABSENT" },
        ],
      }),
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.success, true);
    assert.ok(body.sessionStartedAt);
    assert.strictEqual(body.results.length, 2);

    const records = await prisma.attendanceRecord.findMany({
      where: { sessionId: session.id },
    });
    assert.strictEqual(records.length, 2);
  });

  await t.test("GET /api/classes/:id/deck returns cumulative absentCount", async () => {
    const res = await fetch(`${baseUrl}/api/classes/${testClass.id}/deck`, {
      headers: { Cookie: facultyCookie },
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    const st1 = body.students.find((s) => s.id === studentProfile1.id);
    const st2 = body.students.find((s) => s.id === studentProfile2.id);
    assert.strictEqual(st1.absentCount, 0);
    assert.strictEqual(st2.absentCount, 1);
  });

  await t.test("Unmarking all students reverts sessionStartedAt to null", async () => {
    const res = await fetch(`${baseUrl}/api/sessions/${session.id}/attendance`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: facultyCookie },
      body: JSON.stringify({
        updates: [
          { studentId: studentProfile1.id, status: "UNMARKED" },
          { studentId: studentProfile2.id, status: "UNMARKED" },
        ],
      }),
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.sessionStartedAt, null);

    const records = await prisma.attendanceRecord.findMany({
      where: { sessionId: session.id },
    });
    assert.strictEqual(records.length, 0);

    const updatedSession = await prisma.classSession.findUnique({
      where: { id: session.id },
    });
    assert.strictEqual(updatedSession.startedAt, null);
  });
});
