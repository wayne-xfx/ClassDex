const path = require("node:path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });
const test = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcryptjs");
const { app, resetRateLimitersForTests } = require("../index");
const { prisma } = require("../db");

test("§Fix5: Class Activities History API (GET /api/classes/:id/activities)", async (t) => {
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
      name: "Activities Faculty",
      email: `faculty.act.${runId}@test.local`,
      password: hashedPassword,
      role: "FACULTY",
      emailVerified: true,
    },
  });

  const otherFaculty = await prisma.user.create({
    data: {
      name: "Other Activities Faculty",
      email: `faculty.otheract.${runId}@test.local`,
      password: hashedPassword,
      role: "FACULTY",
      emailVerified: true,
    },
  });

  const testClass = await prisma.class.create({
    data: {
      sectionName: "Activities Section",
      classCode: `ACT-${runId}`.slice(0, 10).toUpperCase(),
      facultyId: facultyUser.id,
      gracePeriodMinutes: 15,
    },
  });

  const studentUser = await prisma.user.create({
    data: {
      name: "Activities Student",
      email: `student.act.${runId}@test.local`,
      password: hashedPassword,
      role: "STUDENT",
      emailVerified: true,
    },
  });

  const studentProfile = await prisma.studentProfile.create({
    data: {
      userId: studentUser.id,
      name: "Activities Student",
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

  // Create a session and activity
  const session = await prisma.classSession.create({
    data: {
      classId: testClass.id,
      date: new Date(),
    },
  });

  const activity = await prisma.activity.create({
    data: {
      classId: testClass.id,
      sessionId: session.id,
      title: "Reading Check 1",
      maxScore: 20,
    },
  });

  await prisma.activityScore.create({
    data: {
      activityId: activity.id,
      studentId: studentProfile.id,
      score: 18,
      isAbsent: false,
    },
  });

  t.after(async () => {
    try {
      await prisma.activityScore.deleteMany({ where: { activityId: activity.id } });
      await prisma.activity.deleteMany({ where: { classId: testClass.id } });
      await prisma.classSession.deleteMany({ where: { classId: testClass.id } });
      await prisma.classEnrollment.deleteMany({ where: { classId: testClass.id } });
      await prisma.class.deleteMany({ where: { id: testClass.id } });
      await prisma.studentProfile.deleteMany({ where: { id: studentProfile.id } });
      await prisma.user.deleteMany({
        where: { id: { in: [facultyUser.id, otherFaculty.id, studentUser.id] } },
      });
    } catch (e) {
      console.error("Cleanup error in class-activities.test.js:", e);
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

  await t.test("GET /api/classes/:id/activities returns activities with scoredCount", async () => {
    const res = await fetch(`${baseUrl}/api/classes/${testClass.id}/activities`, {
      headers: { Cookie: facultyCookie },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body.activities), "activities should be an array");
    assert.equal(body.activities.length, 1);
    const act = body.activities[0];
    assert.equal(act.id, activity.id);
    assert.equal(act.title, "Reading Check 1");
    assert.equal(act.maxScore, 20);
    assert.equal(act.sessionId, session.id);
    assert.equal(act.scoredCount, 1);
    assert.ok(act.sessionDate);
  });

  await t.test("GET /api/classes/:id/activities blocks non-owner with 404", async () => {
    const res = await fetch(`${baseUrl}/api/classes/${testClass.id}/activities`, {
      headers: { Cookie: otherCookie },
    });
    assert.equal(res.status, 404);
  });
});
