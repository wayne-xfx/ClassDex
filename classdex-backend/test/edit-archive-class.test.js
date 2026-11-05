require("dotenv").config();
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcryptjs");
const {
  app,
  resetRateLimitersForTests,
  matchClassScopedMutationTarget,
  ARCHIVED_READ_ONLY_MESSAGE,
  ARCHIVED_JOIN_MESSAGE,
} = require("../index");
const {
  setRecaptchaVerifierForTests,
  resetRecaptchaVerifierForTests,
} = require("../recaptcha");
const { prisma } = require("../db");

const SAMPLE_PHOTO =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

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

test("SCRUM-58: Programmatic route-coverage audit for archived class mutation guard", () => {
  const indexSource = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");
  const routeRegex = /\bapp\.(post|put|patch|delete)\(\s*["'`]([^"'`]+)["'`]/g;
  const discoveredRoutes = [];
  let match = routeRegex.exec(indexSource);
  while (match) {
    discoveredRoutes.push({
      method: match[1].toUpperCase(),
      routePattern: match[2],
    });
    match = routeRegex.exec(indexSource);
  }

  assert.ok(discoveredRoutes.length >= 35, "Expected to discover backend mutation routes");

  const expectedExempt = new Set([
    "POST /api/auth/register",
    "POST /api/auth/verify-email",
    "POST /api/auth/resend-verification",
    "POST /api/auth/login",
    "POST /api/auth/logout",
    "POST /api/auth/change-password",
    "POST /api/auth/forgot-password",
    "POST /api/auth/reset-password",
    "PUT /api/faculty/profile",
    "PUT /api/student/profile",
    "POST /api/classes",
    "POST /api/classes/:id/archive",
    "POST /api/classes/:id/restore",
  ]);

  const uncovered = [];
  let coveredCount = 0;

  for (const { method, routePattern } of discoveredRoutes) {
    const key = `${method} ${routePattern}`;
    const samplePath = routePattern.replace(/:[A-Za-z0-9_]+/g, "sample-id");
    const target = matchClassScopedMutationTarget(method, samplePath);

    if (expectedExempt.has(key)) {
      assert.equal(
        target,
        null,
        `Exempt route ${key} should not be blocked by archived mutation guard`,
      );
    } else if (target) {
      coveredCount += 1;
    } else {
      uncovered.push(key);
    }
  }

  assert.deepEqual(
    uncovered,
    [],
    `Found class-scoped mutation routes not covered by enforceActiveClassMutationGuard: ${uncovered.join(", ")}`,
  );
  assert.ok(coveredCount >= 27, `Expected at least 27 covered routes, got ${coveredCount}`);
});

test("SCRUM-58: Edit class, check-code excludeId, archive read-only guard, and 100% restore preservation", async (t) => {
  resetRateLimitersForTests();
  const createdClassIds = [];
  const createdUserIds = [];
  const usedStudentIds = new Set();
  const server = app.listen(0);

  t.after(async () => {
    resetRecaptchaVerifierForTests();
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
  });

  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;
  const runId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const passwordPlain = "Password123!";
  const hashedPassword = await bcrypt.hash(passwordPlain, 10);

  const faculty1 = await prisma.user.create({
    data: {
      name: "Faculty Owner",
      email: `faculty1.s58.${runId}@test.local`,
      password: hashedPassword,
      role: "FACULTY",
      emailVerified: true,
    },
  });
  createdUserIds.push(faculty1.id);

  const faculty2 = await prisma.user.create({
    data: {
      name: "Other Faculty",
      email: `faculty2.s58.${runId}@test.local`,
      password: hashedPassword,
      role: "FACULTY",
      emailVerified: true,
    },
  });
  createdUserIds.push(faculty2.id);

  const student1Id = await generateUnusedStudentId(usedStudentIds);
  const studentDroppedId = await generateUnusedStudentId(usedStudentIds);
  const studentPendingId = await generateUnusedStudentId(usedStudentIds);
  const studentJoinerId = await generateUnusedStudentId(usedStudentIds);

  const createStudentWithProfile = async (prefix, name, studentId) => {
    const user = await prisma.user.create({
      data: {
        name,
        email: `${prefix}.s58.${runId}@test.local`,
        password: hashedPassword,
        role: "STUDENT",
        emailVerified: true,
      },
    });
    createdUserIds.push(user.id);
    const profile = await prisma.studentProfile.create({
      data: {
        userId: user.id,
        name,
        studentId,
        email: user.email,
        photo: SAMPLE_PHOTO,
      },
    });
    return { user, profile };
  };

  const student1 = await createStudentWithProfile("stud1", "Cruz, Angela", student1Id);
  const studentDropped = await createStudentWithProfile("studdrop", "Reyes, Marco", studentDroppedId);
  const studentPending = await createStudentWithProfile("studpend", "Santos, Lea", studentPendingId);
  const studentJoiner = await createStudentWithProfile("studjoin", "Torres, Paolo", studentJoinerId);

  const initialCodeA = `S58A${runId.slice(-6)}`.toUpperCase();
  const initialCodeB = `S58B${runId.slice(-6)}`.toUpperCase();
  const updatedCodeA = `S58U${runId.slice(-6)}`.toUpperCase();

  const classA = await prisma.class.create({
    data: {
      sectionName: "BSIT 3A - Software Engineering",
      classCode: initialCodeA,
      description: "Initial description",
      schedule: "Mon, Wed · 7:30 AM – 9:00 AM",
      scheduleDays: ["Mon", "Wed"],
      scheduleStartTime: "07:30",
      scheduleEndTime: "09:00",
      facultyId: faculty1.id,
    },
  });
  createdClassIds.push(classA.id);

  const classB = await prisma.class.create({
    data: {
      sectionName: "BSIT 3B - Database Systems",
      classCode: initialCodeB,
      facultyId: faculty2.id,
    },
  });
  createdClassIds.push(classB.id);

  const faculty1Cookie = await loginAndGetCookie(baseUrl, faculty1.email, passwordPlain);
  const faculty2Cookie = await loginAndGetCookie(baseUrl, faculty2.email, passwordPlain);
  const student1Cookie = await loginAndGetCookie(baseUrl, student1.user.email, passwordPlain);
  const studentJoinerCookie = await loginAndGetCookie(baseUrl, studentJoiner.user.email, passwordPlain);

  const requestJson = async (method, urlPath, { cookie = "", body } = {}) => {
    const headers = {};
    if (cookie) headers.Cookie = cookie;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const res = await fetch(`${baseUrl}${urlPath}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, data };
  };

  // 1. check-code with and without excludeId
  {
    const takenSelf = await requestJson("GET", `/api/classes/check-code?code=${initialCodeA}`, {
      cookie: faculty1Cookie,
    });
    assert.equal(takenSelf.status, 200);
    assert.equal(takenSelf.data.available, false);

    const excludedSelf = await requestJson(
      "GET",
      `/api/classes/check-code?code=${initialCodeA}&excludeId=${classA.id}`,
      { cookie: faculty1Cookie },
    );
    assert.equal(excludedSelf.status, 200);
    assert.equal(excludedSelf.data.available, true);

    const takenOther = await requestJson(
      "GET",
      `/api/classes/check-code?code=${initialCodeB}&excludeId=${classA.id}`,
      { cookie: faculty1Cookie },
    );
    assert.equal(takenOther.status, 200);
    assert.equal(takenOther.data.available, false);
  }

  // 2. PATCH /api/classes/:id access control, validation, duplicate 409, full edit, and partial edit
  {
    const unauthEdit = await requestJson("PATCH", `/api/classes/${classA.id}`, {
      body: { sectionName: "Unauthorized" },
    });
    assert.equal(unauthEdit.status, 401);

    const studentEdit = await requestJson("PATCH", `/api/classes/${classA.id}`, {
      cookie: student1Cookie,
      body: { sectionName: "Student Attempt" },
    });
    assert.equal(studentEdit.status, 403);

    const nonOwnerEdit = await requestJson("PATCH", `/api/classes/${classA.id}`, {
      cookie: faculty2Cookie,
      body: { sectionName: "Wrong Faculty" },
    });
    assert.equal(nonOwnerEdit.status, 404);

    const emptySection = await requestJson("PATCH", `/api/classes/${classA.id}`, {
      cookie: faculty1Cookie,
      body: { sectionName: "   " },
    });
    assert.equal(emptySection.status, 400);

    const badCode = await requestJson("PATCH", `/api/classes/${classA.id}`, {
      cookie: faculty1Cookie,
      body: { classCode: "A!" },
    });
    assert.equal(badCode.status, 400);

    const invalidSchedule = await requestJson("PATCH", `/api/classes/${classA.id}`, {
      cookie: faculty1Cookie,
      body: {
        scheduleDays: ["Tue"],
        scheduleStartTime: "10:30",
        scheduleEndTime: "09:00",
      },
    });
    assert.equal(invalidSchedule.status, 400);

    const duplicateCode = await requestJson("PATCH", `/api/classes/${classA.id}`, {
      cookie: faculty1Cookie,
      body: { classCode: initialCodeB },
    });
    assert.equal(duplicateCode.status, 409);
    assert.match(duplicateCode.data.message, /already in use/i);

    const validEdit = await requestJson("PATCH", `/api/classes/${classA.id}`, {
      cookie: faculty1Cookie,
      body: {
        sectionName: "BSIT 3A - Capstone 1",
        classCode: updatedCodeA,
        description: "Updated term project section",
        scheduleDays: ["Tue", "Thu"],
        scheduleStartTime: "13:00",
        scheduleEndTime: "14:30",
      },
    });
    assert.equal(validEdit.status, 200);
    assert.equal(validEdit.data.class.sectionName, "BSIT 3A - Capstone 1");
    assert.equal(validEdit.data.class.classCode, updatedCodeA);
    assert.equal(validEdit.data.class.description, "Updated term project section");
    assert.deepEqual(validEdit.data.class.scheduleDays, ["Tue", "Thu"]);
    assert.equal(validEdit.data.class.scheduleStartTime, "13:00");
    assert.equal(validEdit.data.class.scheduleEndTime, "14:30");
    assert.match(validEdit.data.class.schedule, /Tue.*Thu/i);

    const partialSettingsEdit = await requestJson("PATCH", `/api/classes/${classA.id}`, {
      cookie: faculty1Cookie,
      body: { gracePeriodMinutes: 20, recitationShuffleSeconds: 4 },
    });
    assert.equal(partialSettingsEdit.status, 200);
    assert.equal(partialSettingsEdit.data.class.gracePeriodMinutes, 20);
    assert.equal(partialSettingsEdit.data.class.recitationShuffleSeconds, 4);
    assert.equal(partialSettingsEdit.data.class.sectionName, "BSIT 3A - Capstone 1");
    assert.equal(partialSettingsEdit.data.class.classCode, updatedCodeA);
    assert.deepEqual(partialSettingsEdit.data.class.scheduleDays, ["Tue", "Thu"]);
  }

  // 3. Seed rich coursework & enrollment records on classA
  const rosterActive = await prisma.classRoster.create({
    data: {
      classId: classA.id,
      studentId: student1Id,
      studentName: "Cruz, Angela",
      sortKey: "cruz angela",
    },
  });
  const rosterDropped = await prisma.classRoster.create({
    data: {
      classId: classA.id,
      studentId: studentDroppedId,
      studentName: "Reyes, Marco",
      sortKey: "reyes marco",
      droppedAt: new Date("2026-10-15T08:00:00.000Z"),
    },
  });

  await prisma.classEnrollment.createMany({
    data: [
      { classId: classA.id, studentProfileId: student1.profile.id, status: "APPROVED" },
      {
        classId: classA.id,
        studentProfileId: studentDropped.profile.id,
        status: "DROPPED",
        droppedAt: new Date("2026-10-15T08:00:00.000Z"),
      },
      { classId: classA.id, studentProfileId: studentPending.profile.id, status: "PENDING" },
    ],
  });
  const pendingEnrollment = await prisma.classEnrollment.findFirst({
    where: { classId: classA.id, studentProfileId: studentPending.profile.id },
  });

  // Create a past session (NOT today, so we can also prove archived /deck creates zero today sessions)
  const pastSession = await prisma.classSession.create({
    data: {
      classId: classA.id,
      date: new Date("2026-10-20T00:00:00.000Z"),
      startedAt: new Date("2026-10-20T05:00:00.000Z"),
    },
  });

  await prisma.attendanceRecord.createMany({
    data: [
      { sessionId: pastSession.id, studentId: student1.profile.id, status: "PRESENT" },
      { sessionId: pastSession.id, studentId: studentDropped.profile.id, status: "LATE" },
    ],
  });

  const recitationLog = await prisma.recitationLog.create({
    data: {
      sessionId: pastSession.id,
      studentId: student1.profile.id,
      method: "RANDOM",
      score: 5,
    },
  });

  const activity = await prisma.activity.create({
    data: {
      classId: classA.id,
      sessionId: pastSession.id,
      title: "UML Sequence Diagram",
      maxScore: 20,
    },
  });
  await prisma.activityScore.create({
    data: {
      activityId: activity.id,
      studentId: student1.profile.id,
      score: 19,
    },
  });

  const midtermProject = await prisma.project.create({
    data: {
      classId: classA.id,
      type: "MIDTERM",
      maxScore: 50,
    },
  });
  await prisma.projectScore.create({
    data: {
      projectId: midtermProject.id,
      studentId: student1.profile.id,
      score: 48,
    },
  });

  const quizSession = await prisma.quizSession.create({
    data: {
      classId: classA.id,
      title: "Quiz 1 - Architecture",
      totalItems: 15,
    },
  });
  await prisma.quizScore.create({
    data: {
      sessionId: quizSession.id,
      studentId: student1.profile.id,
      score: 14,
      isAbsent: false,
    },
  });

  // Verify pending-counts includes classA BEFORE archiving
  const beforePendingCounts = await requestJson("GET", "/api/faculty/classes/pending-counts", {
    cookie: faculty1Cookie,
  });
  assert.equal(beforePendingCounts.status, 200);
  assert.ok((beforePendingCounts.data.counts[classA.id] || 0) >= 1);

  const countSnapshotBeforeArchive = {
    enrollments: await prisma.classEnrollment.count({ where: { classId: classA.id } }),
    roster: await prisma.classRoster.count({ where: { classId: classA.id } }),
    sessions: await prisma.classSession.count({ where: { classId: classA.id } }),
    attendance: await prisma.attendanceRecord.count({ where: { session: { classId: classA.id } } }),
    recitations: await prisma.recitationLog.count({ where: { session: { classId: classA.id } } }),
    activities: await prisma.activity.count({ where: { classId: classA.id } }),
    activityScores: await prisma.activityScore.count({ where: { activity: { classId: classA.id } } }),
    projects: await prisma.project.count({ where: { classId: classA.id } }),
    projectScores: await prisma.projectScore.count({ where: { project: { classId: classA.id } } }),
    quizzes: await prisma.quizSession.count({ where: { classId: classA.id } }),
    quizScores: await prisma.quizScore.count({ where: { session: { classId: classA.id } } }),
  };

  // 4. Archive endpoint access control + idempotency
  {
    assert.equal(
      (await requestJson("POST", `/api/classes/${classA.id}/archive`)).status,
      401,
    );
    assert.equal(
      (await requestJson("POST", `/api/classes/${classA.id}/archive`, { cookie: student1Cookie })).status,
      403,
    );
    assert.equal(
      (await requestJson("POST", `/api/classes/${classA.id}/archive`, { cookie: faculty2Cookie })).status,
      404,
    );

    const archiveRes = await requestJson("POST", `/api/classes/${classA.id}/archive`, {
      cookie: faculty1Cookie,
    });
    assert.equal(archiveRes.status, 200);
    assert.ok(archiveRes.data.class.archivedAt, "Expected archivedAt timestamp");

    const archiveAgainRes = await requestJson("POST", `/api/classes/${classA.id}/archive`, {
      cookie: faculty1Cookie,
    });
    assert.equal(archiveAgainRes.status, 200);
    assert.equal(archiveAgainRes.data.class.archivedAt, archiveRes.data.class.archivedAt);
  }

  // 5. Verify archivedAt in all 5 class endpoints, read-only /deck (no session creation), and bell/pending-counts exclusion
  {
    const facultyList = await requestJson("GET", "/api/faculty/classes", { cookie: faculty1Cookie });
    assert.equal(facultyList.status, 200);
    const listedA = facultyList.data.classes.find((c) => c.id === classA.id);
    assert.ok(listedA?.archivedAt);

    const classDetail = await requestJson("GET", `/api/classes/${classA.id}`, { cookie: faculty1Cookie });
    assert.equal(classDetail.status, 200);
    assert.ok(classDetail.data.class.archivedAt);

    const deckRes = await requestJson("GET", `/api/classes/${classA.id}/deck`, { cookie: faculty1Cookie });
    assert.equal(deckRes.status, 200);
    assert.ok(deckRes.data.class.archivedAt);
    assert.equal(deckRes.data.session, null, "Archived /deck must not auto-create today's ClassSession");
    assert.equal(
      await prisma.classSession.count({ where: { classId: classA.id } }),
      countSnapshotBeforeArchive.sessions,
      "Archived /deck must perform zero ClassSession writes",
    );

    const afterPendingCounts = await requestJson("GET", "/api/faculty/classes/pending-counts", {
      cookie: faculty1Cookie,
    });
    assert.equal(afterPendingCounts.status, 200);
    assert.equal(afterPendingCounts.data.counts[classA.id], undefined);

    const pendingBellRes = await requestJson("GET", `/api/classes/${classA.id}/pending`, {
      cookie: faculty1Cookie,
    });
    assert.equal(pendingBellRes.status, 200);
    assert.equal(pendingBellRes.data.unreadNotificationCount, 0);
    assert.equal(pendingBellRes.data.totalNotifications, 0);

    const studentClassesRes = await requestJson("GET", "/api/student/classes", { cookie: student1Cookie });
    assert.equal(studentClassesRes.status, 200);
    const studentClassA = studentClassesRes.data.classes.find((c) => c.id === classA.id);
    assert.ok(studentClassA?.archivedAt, "Student classes should include archivedAt");

    const studentRecordRes = await requestJson("GET", `/api/student/classes/${classA.id}/records`, {
      cookie: student1Cookie,
    });
    assert.equal(studentRecordRes.status, 200);
    assert.ok(studentRecordRes.data.class.archivedAt, "Student class record should include archivedAt");
    assert.equal(studentRecordRes.data.attendance.length, 1);
    assert.equal(studentRecordRes.data.recitations.length, 1);
    assert.equal(studentRecordRes.data.activities.length, 1);
    assert.equal(studentRecordRes.data.projects.length, 1);
    assert.equal(studentRecordRes.data.quizzes.length, 1);
  }

  // 6. Verify 401 / 403 / 404 precedence BEFORE 409 on archived resources
  {
    assert.equal(
      (await requestJson("PATCH", `/api/classes/${classA.id}`, { body: { sectionName: "NoAuth" } })).status,
      401,
    );
    assert.equal(
      (
        await requestJson("PATCH", `/api/classes/${classA.id}`, {
          cookie: student1Cookie,
          body: { sectionName: "WrongRole" },
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await requestJson("PATCH", `/api/classes/${classA.id}`, {
          cookie: faculty2Cookie,
          body: { sectionName: "Unowned" },
        })
      ).status,
      404,
    );
    assert.equal(
      (
        await requestJson("PUT", `/api/sessions/${pastSession.id}/attendance/${student1.profile.id}`, {
          cookie: faculty2Cookie,
          body: { status: "ABSENT" },
        })
      ).status,
      404,
    );
    assert.equal(
      (
        await requestJson("PATCH", `/api/quizzes/${quizSession.id}`, {
          cookie: faculty2Cookie,
          body: { title: "Unowned Quiz", totalItems: 10 },
        })
      ).status,
      404,
    );
    assert.equal(
      (
        await requestJson("PATCH", `/api/activities/${activity.id}`, {
          cookie: faculty2Cookie,
          body: { title: "Unowned Activity", maxScore: 10 },
        })
      ).status,
      404,
    );
    assert.equal(
      (
        await requestJson("PATCH", `/api/projects/${midtermProject.id}`, {
          cookie: faculty2Cookie,
          body: { maxScore: 100 },
        })
      ).status,
      404,
    );
    assert.equal(
      (
        await requestJson("PATCH", `/api/recitation-logs/${recitationLog.id}`, {
          cookie: faculty2Cookie,
          body: { score: 3 },
        })
      ).status,
      404,
    );
    assert.equal(
      (await requestJson("POST", "/api/classes/join", { body: { classCode: updatedCodeA } })).status,
      401,
    );
    assert.equal(
      (
        await requestJson("POST", "/api/classes/join", {
          cookie: faculty1Cookie,
          body: { classCode: updatedCodeA },
        })
      ).status,
      403,
    );
  }

  // 7. Verify 409 enforcement across ALL 7 class-scoped mutation prefixes when archived
  setRecaptchaVerifierForTests(async () => ({ success: true }));
  const facultyMutationsWhileArchived = [
    ["PATCH", `/api/classes/${classA.id}`, { sectionName: "Blocked Edit" }],
    ["POST", `/api/classes/${classA.id}/roster`, { entries: [{ studentName: "Cruz, Angela", studentId: student1Id }] }],
    ["PATCH", `/api/classes/${classA.id}/roster/${rosterActive.id}`, { studentName: "Blocked Roster" }],
    ["DELETE", `/api/classes/${classA.id}/roster/${rosterActive.id}`, undefined],
    ["POST", `/api/classes/${classA.id}/drop-list/${rosterDropped.id}/restore`, {}],
    ["POST", `/api/classes/${classA.id}/roster/import`, { fileName: "list.csv", fileBase64: "" }],
    ["POST", `/api/classes/${classA.id}/notifications/read`, {}],
    ["POST", `/api/classes/${classA.id}/absence-warnings/${student1.profile.id}/read`, {}],
    ["POST", `/api/classes/${classA.id}/absence-warnings/${student1.profile.id}/dismiss`, {}],
    ["PATCH", `/api/classes/${classA.id}/pending/${pendingEnrollment.id}`, { status: "APPROVED" }],
    ["POST", `/api/classes/${classA.id}/quizzes`, { title: "Blocked Quiz", totalItems: 10 }],
    ["POST", `/api/classes/${classA.id}/sessions/today`, {}],
    ["POST", `/api/sessions/${pastSession.id}/start`, {}],
    ["PUT", `/api/sessions/${pastSession.id}/attendance/${student1.profile.id}`, { status: "ABSENT" }],
    ["POST", `/api/sessions/${pastSession.id}/recitation/shuffle`, { mode: "RANDOM" }],
    ["POST", `/api/sessions/${pastSession.id}/activities`, { title: "Blocked Activity", maxScore: 10 }],
    ["PATCH", `/api/quizzes/${quizSession.id}`, { title: "Blocked Quiz Edit", totalItems: 15 }],
    ["DELETE", `/api/quizzes/${quizSession.id}`, undefined],
    ["PUT", `/api/quizzes/${quizSession.id}/scores`, { scores: [{ studentId: student1.profile.id, score: 10 }] }],
    ["PUT", `/api/quizzes/${quizSession.id}/scores/${student1.profile.id}`, { score: 10 }],
    ["PATCH", `/api/activities/${activity.id}`, { title: "Blocked Act Edit", maxScore: 20 }],
    ["DELETE", `/api/activities/${activity.id}`, undefined],
    ["PUT", `/api/activities/${activity.id}/scores/${student1.profile.id}`, { score: 15 }],
    ["PATCH", `/api/projects/${midtermProject.id}`, { maxScore: 60 }],
    ["PUT", `/api/projects/${midtermProject.id}/scores/${student1.profile.id}`, { score: 45 }],
    ["PATCH", `/api/recitation-logs/${recitationLog.id}`, { score: 4 }],
  ];

  for (const [method, urlPath, body] of facultyMutationsWhileArchived) {
    const blocked = await requestJson(method, urlPath, { cookie: faculty1Cookie, body });
    assert.equal(blocked.status, 409, `Expected 409 on ${method} ${urlPath}, got ${blocked.status}`);
    assert.equal(blocked.data.message, ARCHIVED_READ_ONLY_MESSAGE);
  }

  const blockedJoin = await requestJson("POST", "/api/classes/join", {
    cookie: studentJoinerCookie,
    body: { classCode: updatedCodeA, recaptchaToken: "test-token" },
  });
  assert.equal(blockedJoin.status, 409);
  assert.equal(blockedJoin.data.message, ARCHIVED_JOIN_MESSAGE);

  // 8. Verify faculty read-only views + Excel/CSV exports continue to work while archived
  {
    assert.equal(
      (await requestJson("GET", `/api/classes/${classA.id}/roster`, { cookie: faculty1Cookie })).status,
      200,
    );
    const dropRes = await requestJson("GET", `/api/classes/${classA.id}/drop-list`, {
      cookie: faculty1Cookie,
    });
    assert.equal(dropRes.status, 200);
    assert.equal(dropRes.data.dropList.length, 1);

    const quizzesRes = await requestJson("GET", `/api/classes/${classA.id}/quizzes`, {
      cookie: faculty1Cookie,
    });
    assert.equal(quizzesRes.status, 200);
    assert.equal(quizzesRes.data.sessions.length, 1);

    const projectsRes = await requestJson("GET", `/api/classes/${classA.id}/projects`, {
      cookie: faculty1Cookie,
    });
    assert.equal(projectsRes.status, 200);
    assert.ok(projectsRes.data.projects.some((p) => p.type === "MIDTERM"));
    assert.equal(
      await prisma.project.count({ where: { classId: classA.id } }),
      countSnapshotBeforeArchive.projects,
      "Archived /projects must not bootstrap missing project rows via DB writes",
    );

    assert.equal(
      (await requestJson("GET", `/api/activities/${activity.id}/scores`, { cookie: faculty1Cookie })).status,
      200,
    );
    assert.equal(
      (
        await requestJson("GET", `/api/classes/${classA.id}/students/${student1.profile.id}/records`, {
          cookie: faculty1Cookie,
        })
      ).status,
      200,
    );

    const excelRes = await fetch(`${baseUrl}/api/classes/${classA.id}/export/excel`, {
      headers: { Cookie: faculty1Cookie },
    });
    assert.equal(excelRes.status, 200);
    const excelBuffer = Buffer.from(await excelRes.arrayBuffer());
    assert.ok(excelBuffer.length > 100, "Expected non-empty Excel workbook while archived");

    const csvRes = await fetch(`${baseUrl}/api/classes/${classA.id}/export/csv`, {
      headers: { Cookie: faculty1Cookie },
    });
    assert.equal(csvRes.status, 200);
    const csvText = await csvRes.text();
    assert.match(csvText, new RegExp(student1Id));
  }

  // 9. Restore class & verify 100% record preservation + mutations enabled again
  {
    assert.equal(
      (await requestJson("POST", `/api/classes/${classA.id}/restore`, { cookie: faculty2Cookie })).status,
      404,
    );

    const restoreRes = await requestJson("POST", `/api/classes/${classA.id}/restore`, {
      cookie: faculty1Cookie,
    });
    assert.equal(restoreRes.status, 200);
    assert.equal(restoreRes.data.class.archivedAt, null);

    const countSnapshotAfterRestore = {
      enrollments: await prisma.classEnrollment.count({ where: { classId: classA.id } }),
      roster: await prisma.classRoster.count({ where: { classId: classA.id } }),
      sessions: await prisma.classSession.count({ where: { classId: classA.id } }),
      attendance: await prisma.attendanceRecord.count({ where: { session: { classId: classA.id } } }),
      recitations: await prisma.recitationLog.count({ where: { session: { classId: classA.id } } }),
      activities: await prisma.activity.count({ where: { classId: classA.id } }),
      activityScores: await prisma.activityScore.count({ where: { activity: { classId: classA.id } } }),
      projects: await prisma.project.count({ where: { classId: classA.id } }),
      projectScores: await prisma.projectScore.count({ where: { project: { classId: classA.id } } }),
      quizzes: await prisma.quizSession.count({ where: { classId: classA.id } }),
      quizScores: await prisma.quizScore.count({ where: { session: { classId: classA.id } } }),
    };
    assert.deepEqual(
      countSnapshotAfterRestore,
      countSnapshotBeforeArchive,
      "100% of class records must be preserved untouched across archive + restore",
    );

    const restoredPendingCounts = await requestJson("GET", "/api/faculty/classes/pending-counts", {
      cookie: faculty1Cookie,
    });
    assert.equal(restoredPendingCounts.status, 200);
    assert.ok((restoredPendingCounts.data.counts[classA.id] || 0) >= 1);

    const editAfterRestore = await requestJson("PATCH", `/api/classes/${classA.id}`, {
      cookie: faculty1Cookie,
      body: { description: "Restored and active again" },
    });
    assert.equal(editAfterRestore.status, 200);
    assert.equal(editAfterRestore.data.class.description, "Restored and active again");

    const joinAfterRestore = await requestJson("POST", "/api/classes/join", {
      cookie: studentJoinerCookie,
      body: { classCode: updatedCodeA, recaptchaToken: "test-token" },
    });
    assert.ok([200, 201].includes(joinAfterRestore.status), `Expected join to succeed after restore, got ${joinAfterRestore.status}`);
  }
});
