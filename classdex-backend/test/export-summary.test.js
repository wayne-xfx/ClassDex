const path = require("node:path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });
const test = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcryptjs");
const { app, resetRateLimitersForTests } = require("../index");
const { prisma } = require("../db");

test("§Fix4: Export Summary and exportCounts API", async (t) => {
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
      name: "Export Faculty",
      email: `faculty.export.${runId}@test.local`,
      password: hashedPassword,
      role: "FACULTY",
      emailVerified: true,
    },
  });

  const otherFaculty = await prisma.user.create({
    data: {
      name: "Other Faculty",
      email: `faculty.other.${runId}@test.local`,
      password: hashedPassword,
      role: "FACULTY",
      emailVerified: true,
    },
  });

  const testClass = await prisma.class.create({
    data: {
      sectionName: "Export Test Section",
      classCode: `EXP-${runId}`.slice(0, 10).toUpperCase(),
      facultyId: facultyUser.id,
      gracePeriodMinutes: 15,
    },
  });

  const studentUser = await prisma.user.create({
    data: {
      name: "Export Student One",
      email: `student.export.${runId}@test.local`,
      password: hashedPassword,
      role: "STUDENT",
      emailVerified: true,
    },
  });

  const studentProfile = await prisma.studentProfile.create({
    data: {
      userId: studentUser.id,
      name: "Export Student One",
      studentId: String(Math.floor(1000000 + Math.random() * 8999999)),
      email: studentUser.email,
      photo: samplePhoto,
    },
  });

  await prisma.classEnrollment.create({
    data: {
      classId: testClass.id,
      studentProfileId: studentProfile.id,
      status: "APPROVED",
    },
  });

  t.after(async () => {
    try {
      await prisma.classEnrollment.deleteMany({ where: { classId: testClass.id } });
      await prisma.classRoster.deleteMany({ where: { classId: testClass.id } });
      await prisma.classSession.deleteMany({ where: { classId: testClass.id } });
      await prisma.activity.deleteMany({ where: { classId: testClass.id } });
      await prisma.project.deleteMany({ where: { classId: testClass.id } });
      await prisma.quizSession.deleteMany({ where: { classId: testClass.id } });
      await prisma.class.deleteMany({ where: { id: testClass.id } });
      await prisma.studentProfile.deleteMany({ where: { id: studentProfile.id } });
      await prisma.user.deleteMany({
        where: { id: { in: [facultyUser.id, otherFaculty.id, studentUser.id] } },
      });
    } catch (e) {
      console.error("Cleanup error in export-summary.test.js:", e);
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
  const otherCookie = await loginAs(otherFaculty.email);

  await t.test("GET /api/classes/:id/deck returns exportCounts", async () => {
    const res = await fetch(`${baseUrl}/api/classes/${testClass.id}/deck`, {
      headers: { Cookie: facultyCookie },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.exportCounts, "exportCounts should be in deck response");
    assert.equal(typeof body.exportCounts.sessions, "number");
    assert.equal(typeof body.exportCounts.recitations, "number");
    assert.equal(typeof body.exportCounts.activities, "number");
    assert.equal(typeof body.exportCounts.projectScores, "number");
    assert.equal(typeof body.exportCounts.quizzes, "number");
  });

  await t.test("GET /api/classes/:id/export-summary returns real counts", async () => {
    const res = await fetch(`${baseUrl}/api/classes/${testClass.id}/export-summary`, {
      headers: { Cookie: facultyCookie },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(typeof body.students, "number");
    assert.equal(typeof body.pending, "number");
    assert.equal(typeof body.sessions, "number");
    assert.equal(typeof body.recitations, "number");
    assert.equal(typeof body.activities, "number");
    assert.equal(typeof body.projectScores, "number");
    assert.equal(typeof body.quizzes, "number");
  });

  await t.test("GET /api/classes/:id/export-summary blocks non-owner with 404", async () => {
    const res = await fetch(`${baseUrl}/api/classes/${testClass.id}/export-summary`, {
      headers: { Cookie: otherCookie },
    });
    assert.equal(res.status, 404);
  });
});
