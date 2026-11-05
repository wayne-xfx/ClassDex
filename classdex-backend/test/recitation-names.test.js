const path = require("node:path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });
const test = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcryptjs");
const { app, resetRateLimitersForTests } = require("../index");
const { prisma } = require("../db");
const { manilaDate } = require("../src/utils/dates");

test("§Fix6: Recitation Student Profile Name Fields API", async (t) => {
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
      name: "Recitation Faculty",
      email: `faculty.recitation.${runId}@test.local`,
      password: hashedPassword,
      role: "FACULTY",
      emailVerified: true,
    },
  });

  const testClass = await prisma.class.create({
    data: {
      sectionName: "Recitation Test Section",
      classCode: `REC-${runId}`.slice(0, 10).toUpperCase(),
      facultyId: facultyUser.id,
      gracePeriodMinutes: 15,
    },
  });

  const studentUser = await prisma.user.create({
    data: {
      name: "Maria Santos Cruz",
      email: `student.recitation.${runId}@test.local`,
      password: hashedPassword,
      role: "STUDENT",
      emailVerified: true,
    },
  });

  const studentProfile = await prisma.studentProfile.create({
    data: {
      userId: studentUser.id,
      name: "Maria Santos Cruz",
      firstName: "Maria",
      middleName: "Santos",
      lastName: "Cruz",
      suffix: "Jr.",
      studentId: String(Math.floor(1000000 + Math.random() * 8999999)),
      email: studentUser.email,
      photo: samplePhoto,
      program: "BSIT",
      section: "AI33",
    },
  });

  await prisma.classEnrollment.create({
    data: {
      classId: testClass.id,
      studentProfileId: studentProfile.id,
      status: "APPROVED",
    },
  });

  const session = await prisma.classSession.create({
    data: {
      classId: testClass.id,
      date: manilaDate(),
    },
  });

  // Mark student Present so they are eligible
  await prisma.attendanceRecord.create({
    data: {
      sessionId: session.id,
      studentId: studentProfile.id,
      status: "PRESENT",
      markedAt: new Date(),
    },
  });

  // Create an initial recitation log
  const initialLog = await prisma.recitationLog.create({
    data: {
      sessionId: session.id,
      studentId: studentProfile.id,
      method: "RANDOM",
      score: 4,
    },
  });

  t.after(async () => {
    try {
      await prisma.recitationLog.deleteMany({ where: { sessionId: session.id } });
      await prisma.attendanceRecord.deleteMany({ where: { sessionId: session.id } });
      await prisma.classSession.deleteMany({ where: { classId: testClass.id } });
      await prisma.classEnrollment.deleteMany({ where: { classId: testClass.id } });
      await prisma.class.deleteMany({ where: { id: testClass.id } });
      await prisma.studentProfile.deleteMany({ where: { id: studentProfile.id } });
      await prisma.user.deleteMany({ where: { id: { in: [facultyUser.id, studentUser.id] } } });
    } catch (e) {
      console.error("Cleanup error in recitation-names.test.js:", e.message);
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
    assert.ok(cookie, "Login should return a cookie");
    return cookie.split(";")[0];
  }

  const facultyCookie = await loginAs(facultyUser.email);

  await t.test("GET /api/classes/:id/deck includes studentProfile name fields in recitationHistory", async () => {
    const res = await fetch(`${baseUrl}/api/classes/${testClass.id}/deck`, {
      headers: { Cookie: facultyCookie },
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(Array.isArray(data.recitationHistory), "recitationHistory should be an array");
    const found = data.recitationHistory.find((r) => r.id === initialLog.id);
    assert.ok(found, "Should contain the initial recitation log");
    assert.ok(found.studentProfile, "Should have studentProfile");
    assert.equal(found.studentProfile.firstName, "Maria");
    assert.equal(found.studentProfile.middleName, "Santos");
    assert.equal(found.studentProfile.lastName, "Cruz");
    assert.equal(found.studentProfile.suffix, "Jr.");
  });

  await t.test("POST /api/sessions/:id/recitation/shuffle returns studentProfile with name fields", async () => {
    const res = await fetch(`${baseUrl}/api/sessions/${session.id}/recitation/shuffle`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: facultyCookie,
      },
      body: JSON.stringify({ mode: "RANDOM" }),
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(data.recitation, "Should return recitation object");
    assert.ok(data.recitation.studentProfile, "Should have studentProfile");
    assert.equal(data.recitation.studentProfile.firstName, "Maria");
    assert.equal(data.recitation.studentProfile.middleName, "Santos");
    assert.equal(data.recitation.studentProfile.lastName, "Cruz");
    assert.equal(data.recitation.studentProfile.suffix, "Jr.");
  });
});
