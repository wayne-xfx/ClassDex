const path = require("node:path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });
const test = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcryptjs");
const { app, resetRateLimitersForTests } = require("../index");
const { prisma } = require("../db");

test("§FlippableCard: Student Class Records API for Faculty", async (t) => {
  resetRateLimitersForTests();
  const server = app.listen(0);
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;
  const runId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const hashedPassword = await bcrypt.hash("password123", 10);

  // Helper to get an unused random 7-digit student ID
  async function generateUnusedStudentId() {
    for (let attempts = 0; attempts < 10; attempts++) {
      const candidate = String(Math.floor(1000000 + Math.random() * 9000000));
      const [inProfile, inRoster] = await Promise.all([
        prisma.studentProfile.findUnique({ where: { studentId: candidate } }),
        prisma.classRoster.findFirst({ where: { studentId: candidate } }),
      ]);
      if (!inProfile && !inRoster) return candidate;
    }
    throw new Error("Failed to generate unique studentId");
  }

  const studentIdNumber = await generateUnusedStudentId();

  const samplePhoto =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

  // 1. Create Faculty User
  const facultyUser = await prisma.user.create({
    data: {
      name: "Records Faculty",
      email: `faculty.rec.${runId}@test.local`,
      password: hashedPassword,
      role: "FACULTY",
      emailVerified: true,
    },
  });

  const otherFaculty = await prisma.user.create({
    data: {
      name: "Other Faculty",
      email: `other.fac.${runId}@test.local`,
      password: hashedPassword,
      role: "FACULTY",
      emailVerified: true,
    },
  });

  // 2. Create Two Classes for same faculty to verify scoping
  const class1 = await prisma.class.create({
    data: {
      sectionName: "Class One " + runId,
      classCode: `C1-${runId}`.slice(0, 10).toUpperCase(),
      facultyId: facultyUser.id,
      gracePeriodMinutes: 15,
    },
  });

  const class2 = await prisma.class.create({
    data: {
      sectionName: "Class Two " + runId,
      classCode: `C2-${runId}`.slice(0, 10).toUpperCase(),
      facultyId: facultyUser.id,
      gracePeriodMinutes: 15,
    },
  });

  // 3. Create Student User & Profile
  const studentUser = await prisma.user.create({
    data: {
      name: "Jane Student",
      email: `student.rec.${runId}@test.local`,
      password: hashedPassword,
      role: "STUDENT",
      emailVerified: true,
    },
  });

  const studentProfile = await prisma.studentProfile.create({
    data: {
      userId: studentUser.id,
      name: "Jane Student",
      studentId: studentIdNumber,
      email: studentUser.email,
      photo: samplePhoto,
      address: "123 Academic Way, Manila",
      program: "BSIT",
      section: "AI33",
    },
  });

  // 4. Enroll student in both classes
  const enrollment1 = await prisma.classEnrollment.create({
    data: {
      classId: class1.id,
      studentProfileId: studentProfile.id,
      status: "APPROVED",
    },
  });

  const enrollment2 = await prisma.classEnrollment.create({
    data: {
      classId: class2.id,
      studentProfileId: studentProfile.id,
      status: "APPROVED",
    },
  });

  // 5. Sessions
  const session1 = await prisma.classSession.create({
    data: {
      classId: class1.id,
      date: new Date("2026-11-01T00:00:00Z"),
    },
  });

  const session2 = await prisma.classSession.create({
    data: {
      classId: class2.id,
      date: new Date("2026-11-02T00:00:00Z"),
    },
  });

  // 6. Quizzes
  const quizSession1 = await prisma.quizSession.create({
    data: {
      classId: class1.id,
      title: "Quiz 1 - Networking",
      totalItems: 20,
      date: new Date("2026-11-01T00:00:00Z"),
    },
  });

  const quizScore1 = await prisma.quizScore.create({
    data: {
      sessionId: quizSession1.id,
      studentId: studentProfile.id,
      score: 18,
      isAbsent: false,
    },
  });

  const quizSession2 = await prisma.quizSession.create({
    data: {
      classId: class2.id,
      title: "Quiz in Class 2",
      totalItems: 30,
      date: new Date("2026-11-02T00:00:00Z"),
    },
  });

  const quizScore2 = await prisma.quizScore.create({
    data: {
      sessionId: quizSession2.id,
      studentId: studentProfile.id,
      score: 25,
      isAbsent: false,
    },
  });

  // 7. Activities
  const activity1 = await prisma.activity.create({
    data: {
      classId: class1.id,
      sessionId: session1.id,
      title: "Activity 1 - Wireframing",
      maxScore: 50,
    },
  });

  const activityScore1 = await prisma.activityScore.create({
    data: {
      activityId: activity1.id,
      studentId: studentProfile.id,
      score: 45,
      isAbsent: false,
    },
  });

  const activity2 = await prisma.activity.create({
    data: {
      classId: class2.id,
      sessionId: session2.id,
      title: "Activity in Class 2",
      maxScore: 100,
    },
  });

  const activityScore2 = await prisma.activityScore.create({
    data: {
      activityId: activity2.id,
      studentId: studentProfile.id,
      score: 80,
      isAbsent: false,
    },
  });

  // 8. Projects (MIDTERM and FINALS in Class 1; MIDTERM in Class 2)
  const project1Midterm = await prisma.project.create({
    data: {
      classId: class1.id,
      type: "MIDTERM",
      maxScore: 100,
    },
  });

  const projectScore1Midterm = await prisma.projectScore.create({
    data: {
      projectId: project1Midterm.id,
      studentId: studentProfile.id,
      score: 92,
      isAbsent: false,
      sessionId: session1.id,
    },
  });

  const project1Finals = await prisma.project.create({
    data: {
      classId: class1.id,
      type: "FINALS",
      maxScore: 100,
    },
  });

  const projectScore1Finals = await prisma.projectScore.create({
    data: {
      projectId: project1Finals.id,
      studentId: studentProfile.id,
      score: 95,
      isAbsent: false,
      sessionId: session1.id,
    },
  });

  const project2Midterm = await prisma.project.create({
    data: {
      classId: class2.id,
      type: "MIDTERM",
      maxScore: 100,
    },
  });

  const projectScore2Midterm = await prisma.projectScore.create({
    data: {
      projectId: project2Midterm.id,
      studentId: studentProfile.id,
      score: 75,
      isAbsent: false,
      sessionId: session2.id,
    },
  });

  // IMMEDIATELY register cleanup with t.after
  t.after(async () => {
    try {
      await prisma.quizScore.deleteMany({
        where: { id: { in: [quizScore1.id, quizScore2.id] } },
      });
      await prisma.quizSession.deleteMany({
        where: { id: { in: [quizSession1.id, quizSession2.id] } },
      });

      await prisma.activityScore.deleteMany({
        where: { id: { in: [activityScore1.id, activityScore2.id] } },
      });
      await prisma.activity.deleteMany({
        where: { id: { in: [activity1.id, activity2.id] } },
      });

      await prisma.projectScore.deleteMany({
        where: {
          id: {
            in: [
              projectScore1Midterm.id,
              projectScore1Finals.id,
              projectScore2Midterm.id,
            ],
          },
        },
      });
      await prisma.project.deleteMany({
        where: {
          id: { in: [project1Midterm.id, project1Finals.id, project2Midterm.id] },
        },
      });

      await prisma.classSession.deleteMany({
        where: { id: { in: [session1.id, session2.id] } },
      });

      await prisma.classEnrollment.deleteMany({
        where: { id: { in: [enrollment1.id, enrollment2.id] } },
      });

      await prisma.class.deleteMany({
        where: { id: { in: [class1.id, class2.id] } },
      });

      await prisma.studentProfile.deleteMany({
        where: { id: studentProfile.id },
      });

      await prisma.user.deleteMany({
        where: { id: { in: [facultyUser.id, otherFaculty.id, studentUser.id] } },
      });
    } catch (cleanupErr) {
      console.error("Cleanup error in student-class-records.test.js:", cleanupErr);
    }
    if (server.closeAllConnections) {
      server.closeAllConnections();
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

  await t.test("GET /api/classes/:id/students/:studentId/records returns quizzes, activities, projects scoped to this class", async () => {
    const res = await fetch(
      `${baseUrl}/api/classes/${class1.id}/students/${studentProfile.id}/records`,
      { headers: { Cookie: facultyCookie } },
    );
    assert.equal(res.status, 200);
    const body = await res.json();

    // Verify student info includes email and address
    assert.equal(body.student.email, studentUser.email);
    assert.equal(body.student.address, "123 Academic Way, Manila");

    // Verify arrays exist
    assert.ok(Array.isArray(body.quizzes), "quizzes array must be present");
    assert.ok(Array.isArray(body.activities), "activities array must be present");
    assert.ok(Array.isArray(body.projects), "projects array must be present");

    // Scoping checks: class1 has 1 quiz, 1 activity, 2 projects
    assert.equal(body.quizzes.length, 1, "only class1 quiz should appear");
    assert.equal(body.quizzes[0].id, quizScore1.id);
    assert.equal(body.quizzes[0].score, 18);
    assert.equal(body.quizzes[0].session.title, "Quiz 1 - Networking");

    assert.equal(body.activities.length, 1, "only class1 activity should appear");
    assert.equal(body.activities[0].id, activityScore1.id);
    assert.equal(body.activities[0].score, 45);
    assert.equal(body.activities[0].activity.title, "Activity 1 - Wireframing");
    assert.ok(body.activities[0].session, "activity session must be mapped");

    assert.equal(body.projects.length, 2, "only class1 projects should appear");
    // Projects sort check: MIDTERM before FINALS
    assert.equal(body.projects[0].project.type, "MIDTERM");
    assert.equal(body.projects[0].score, 92);
    assert.equal(body.projects[1].project.type, "FINALS");
    assert.equal(body.projects[1].score, 95);
  });

  await t.test("Another faculty receives 404 when requesting student records", async () => {
    const res = await fetch(
      `${baseUrl}/api/classes/${class1.id}/students/${studentProfile.id}/records`,
      { headers: { Cookie: otherCookie } },
    );
    assert.equal(res.status, 404);
  });

  await t.test("Archived class still returns student records (read-only)", async () => {
    await prisma.class.update({
      where: { id: class1.id },
      data: { archivedAt: new Date() },
    });

    const res = await fetch(
      `${baseUrl}/api/classes/${class1.id}/students/${studentProfile.id}/records`,
      { headers: { Cookie: facultyCookie } },
    );
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.student.id, studentProfile.id);
    assert.equal(body.quizzes.length, 1);
    assert.equal(body.activities.length, 1);
    assert.equal(body.projects.length, 2);
  });
});
