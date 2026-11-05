require("dotenv").config();
const test = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcryptjs");
const { app, resetRateLimitersForTests } = require("../index");
const { prisma } = require("../db");

const TINY_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

async function generateUnusedStudentIds(count) {
  const chosen = [];
  while (chosen.length < count) {
    const candidates = Array.from({ length: count * 4 + 8 }, () =>
      String(Math.floor(8000000 + Math.random() * 1999999)),
    );
    const uniqueCandidates = [...new Set(candidates)].filter((id) => !chosen.includes(id));
    const [existingProfiles, existingRosters] = await Promise.all([
      prisma.studentProfile.findMany({
        where: { studentId: { in: uniqueCandidates } },
        select: { studentId: true },
      }),
      prisma.classRoster.findMany({
        where: { studentId: { in: uniqueCandidates } },
        select: { studentId: true },
      }),
    ]);
    const taken = new Set([
      ...existingProfiles.map((p) => p.studentId),
      ...existingRosters.map((r) => r.studentId),
    ]);
    for (const candidate of uniqueCandidates) {
      if (!taken.has(candidate)) {
        chosen.push(candidate);
        if (chosen.length === count) break;
      }
    }
  }
  return chosen;
}

async function loginAndGetCookie(baseUrl, email, password) {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  assert.equal(res.status, 200);
  const cookie = res.headers.get("set-cookie")?.match(/classdex\.sid=[^;]+/)?.[0] || "";
  assert.ok(cookie, "Expected session cookie on login");
  return cookie;
}

test("SCRUM-60: Enrollment status guards & dropped student read-only record access", async (t) => {
  resetRateLimitersForTests();
  const server = app.listen(0);
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  const createdRecitationIds = [];
  const createdAttendanceIds = [];
  const createdQuizScoreIds = [];
  const createdQuizSessionIds = [];
  const createdActivityIds = [];
  const createdProjectIds = [];
  const createdSessionIds = [];
  const createdEnrollmentIds = [];
  const createdRosterIds = [];
  const createdClassIds = [];
  const createdStudentProfileIds = [];
  const createdUserIds = [];

  t.after(async () => {
    resetRateLimitersForTests();
    await new Promise((resolve) => server.close(resolve));
    if (createdRecitationIds.length) {
      await prisma.recitationLog.deleteMany({ where: { id: { in: createdRecitationIds } } });
    }
    if (createdAttendanceIds.length) {
      await prisma.attendanceRecord.deleteMany({ where: { id: { in: createdAttendanceIds } } });
    }
    if (createdQuizScoreIds.length) {
      await prisma.quizScore.deleteMany({ where: { id: { in: createdQuizScoreIds } } });
    }
    if (createdQuizSessionIds.length) {
      await prisma.quizSession.deleteMany({ where: { id: { in: createdQuizSessionIds } } });
    }
    if (createdActivityIds.length) {
      await prisma.activity.deleteMany({ where: { id: { in: createdActivityIds } } });
    }
    if (createdProjectIds.length) {
      await prisma.project.deleteMany({ where: { id: { in: createdProjectIds } } });
    }
    if (createdSessionIds.length) {
      await prisma.classSession.deleteMany({ where: { id: { in: createdSessionIds } } });
    }
    if (createdEnrollmentIds.length) {
      await prisma.classEnrollment.deleteMany({ where: { id: { in: createdEnrollmentIds } } });
    }
    if (createdRosterIds.length) {
      await prisma.classRoster.deleteMany({ where: { id: { in: createdRosterIds } } });
    }
    if (createdClassIds.length) {
      await prisma.class.deleteMany({ where: { id: { in: createdClassIds } } });
    }
    if (createdStudentProfileIds.length) {
      await prisma.studentProfile.deleteMany({ where: { id: { in: createdStudentProfileIds } } });
    }
    if (createdUserIds.length) {
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
  });

  const runId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const password = "Password123!";
  const hashedPassword = await bcrypt.hash(password, 10);
  const [idApproved, idDropped, idRemovedZero, idPending, idDeclined, idOutsider] =
    await generateUnusedStudentIds(6);

  const faculty = await prisma.user.create({
    data: {
      name: "Faculty Remove Guard Tester",
      email: `faculty.scrum60.${runId}@test.local`,
      password: hashedPassword,
      role: "FACULTY",
      emailVerified: true,
    },
  });
  createdUserIds.push(faculty.id);

  const testClass = await prisma.class.create({
    data: {
      sectionName: "SCRUM-60 Section",
      classCode: `S60-${runId}`.slice(0, 14).toUpperCase(),
      facultyId: faculty.id,
    },
  });
  createdClassIds.push(testClass.id);

  async function createStudentFixture(prefix, studentName, studentId, enrollmentStatus, withRoster = true) {
    const user = await prisma.user.create({
      data: {
        name: studentName,
        email: `${prefix}.scrum60.${runId}@test.local`,
        password: hashedPassword,
        role: "STUDENT",
        emailVerified: true,
      },
    });
    createdUserIds.push(user.id);

    const profile = await prisma.studentProfile.create({
      data: {
        userId: user.id,
        name: studentName,
        studentId,
        email: user.email,
        photo: TINY_PNG,
      },
    });
    createdStudentProfileIds.push(profile.id);

    let roster = null;
    if (withRoster) {
      roster = await prisma.classRoster.create({
        data: {
          classId: testClass.id,
          studentId,
          studentName,
          sortKey: studentName.toLowerCase(),
        },
      });
      createdRosterIds.push(roster.id);
    }

    let enrollment = null;
    if (enrollmentStatus) {
      enrollment = await prisma.classEnrollment.create({
        data: {
          classId: testClass.id,
          studentProfileId: profile.id,
          status: enrollmentStatus,
        },
      });
      createdEnrollmentIds.push(enrollment.id);
    }

    return { user, profile, roster, enrollment };
  }

  const [approved, toDrop, toRemoveZero, pending, declined, outsider] = await Promise.all([
    createStudentFixture("approved", "Approved Student", idApproved, "APPROVED", true),
    createStudentFixture("dropped", "Dropped Student", idDropped, "APPROVED", true),
    createStudentFixture("removed0", "Zero Record Student", idRemovedZero, "APPROVED", true),
    createStudentFixture("pending", "Pending Student", idPending, "PENDING", false),
    createStudentFixture("declined", "Declined Student", idDeclined, "DECLINED", false),
    createStudentFixture("outsider", "Outsider Student", idOutsider, null, false),
  ]);

  const session = await prisma.classSession.create({
    data: {
      classId: testClass.id,
      date: new Date("2026-10-15T00:00:00.000Z"),
      startedAt: new Date("2026-10-15T01:00:00.000Z"),
    },
  });
  createdSessionIds.push(session.id);

  // Record coursework for `toDrop` before dropping, plus stale PRESENT records for `pending` and `declined`
  const [attToDrop, recToDrop, attPending, attDeclined] = await Promise.all([
    prisma.attendanceRecord.create({
      data: { sessionId: session.id, studentId: toDrop.profile.id, status: "PRESENT" },
    }),
    prisma.recitationLog.create({
      data: { sessionId: session.id, studentId: toDrop.profile.id, method: "RANDOM", score: 5 },
    }),
    prisma.attendanceRecord.create({
      data: { sessionId: session.id, studentId: pending.profile.id, status: "PRESENT" },
    }),
    prisma.attendanceRecord.create({
      data: { sessionId: session.id, studentId: declined.profile.id, status: "LATE" },
    }),
  ]);
  createdAttendanceIds.push(attToDrop.id, attPending.id, attDeclined.id);
  createdRecitationIds.push(recToDrop.id);

  const facultyCookie = await loginAndGetCookie(baseUrl, faculty.email, password);

  // Remove `toDrop` (has records -> moves to DROPPED) and `toRemoveZero` (0 records -> deleted)
  const dropRes = await fetch(`${baseUrl}/api/classes/${testClass.id}/roster/${toDrop.roster.id}`, {
    method: "DELETE",
    headers: { Cookie: facultyCookie },
  });
  assert.equal(dropRes.status, 200);
  const dropBody = await dropRes.json();
  assert.equal(dropBody.result, "dropped");
  assert.equal(dropBody.recordCount, 2);

  const removeZeroRes = await fetch(`${baseUrl}/api/classes/${testClass.id}/roster/${toRemoveZero.roster.id}`, {
    method: "DELETE",
    headers: { Cookie: facultyCookie },
  });
  assert.equal(removeZeroRes.status, 200);
  const removeZeroBody = await removeZeroRes.json();
  assert.equal(removeZeroBody.result, "removed");

  // 1. Attendance marking rejects DROPPED, PENDING, DECLINED (409) and non-enrolled (404)
  for (const [label, studentProfileId, expectedStatus] of [
    ["DROPPED", toDrop.profile.id, 409],
    ["PENDING", pending.profile.id, 409],
    ["DECLINED", declined.profile.id, 409],
    ["removed 0-record", toRemoveZero.profile.id, 404],
    ["outsider", outsider.profile.id, 404],
  ]) {
    const attRes = await fetch(
      `${baseUrl}/api/sessions/${session.id}/attendance/${studentProfileId}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json", Cookie: facultyCookie },
        body: JSON.stringify({ status: "PRESENT" }),
      },
    );
    assert.equal(attRes.status, expectedStatus, `Expected ${expectedStatus} when marking ${label}`);
    const attJson = await attRes.json();
    assert.ok(attJson.message, "Expected clear error message");
  }

  // 2. Recitation shuffle excludes DROPPED, PENDING, and DECLINED even though they have PRESENT/LATE records
  const shuffleNoneEligible = await fetch(
    `${baseUrl}/api/sessions/${session.id}/recitation/shuffle`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: facultyCookie },
      body: JSON.stringify({ mode: "RANDOM" }),
    },
  );
  assert.equal(
    shuffleNoneEligible.status,
    409,
    "Shuffle must return 409 when only DROPPED/PENDING/DECLINED students have PRESENT/LATE attendance",
  );

  // Mark APPROVED student PRESENT and verify shuffle ONLY picks the APPROVED student
  const markApprovedRes = await fetch(
    `${baseUrl}/api/sessions/${session.id}/attendance/${approved.profile.id}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: facultyCookie },
      body: JSON.stringify({ status: "LATE" }),
    },
  );
  assert.equal(markApprovedRes.status, 200);
  const markApprovedBody = await markApprovedRes.json();
  if (markApprovedBody.attendance?.id) {
    createdAttendanceIds.push(markApprovedBody.attendance.id);
  }

  for (let i = 0; i < 4; i += 1) {
    const shuffleRes = await fetch(`${baseUrl}/api/sessions/${session.id}/recitation/shuffle`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: facultyCookie },
      body: JSON.stringify({ mode: i % 2 === 0 ? "RANDOM" : "WEIGHTED" }),
    });
    assert.equal(shuffleRes.status, 200);
    const shuffleBody = await shuffleRes.json();
    createdRecitationIds.push(shuffleBody.recitation.id);
    assert.equal(shuffleBody.recitation.studentProfile.id, approved.profile.id);
  }

  // Verify faculty deck excludes DROPPED, PENDING, DECLINED, and 0-record removed students
  const deckRes = await fetch(`${baseUrl}/api/classes/${testClass.id}/deck`, {
    headers: { Cookie: facultyCookie },
  });
  assert.equal(deckRes.status, 200);
  const deckBody = await deckRes.json();
  if (deckBody.session?.id && !createdSessionIds.includes(deckBody.session.id)) {
    createdSessionIds.push(deckBody.session.id);
  }
  assert.deepEqual(
    deckBody.students.map((s) => s.id),
    [approved.profile.id],
    "Faculty deck should only include APPROVED students",
  );

  // 3. DROPPED student retains read-only access to /api/student/classes and /api/student/classes/:classId/records
  const droppedCookie = await loginAndGetCookie(baseUrl, toDrop.user.email, password);

  const droppedClassesRes = await fetch(`${baseUrl}/api/student/classes`, {
    headers: { Cookie: droppedCookie },
  });
  assert.equal(droppedClassesRes.status, 200);
  const droppedClassesBody = await droppedClassesRes.json();
  assert.equal(droppedClassesBody.classes.length, 1);
  assert.equal(droppedClassesBody.classes[0].id, testClass.id);
  assert.equal(droppedClassesBody.classes[0].enrollmentStatus, "DROPPED");
  assert.ok(droppedClassesBody.classes[0].droppedAt, "Expected droppedAt timestamp on dropped class");
  assert.equal(droppedClassesBody.classes[0].recordSummary.attendance, "100%");
  assert.equal(droppedClassesBody.classes[0].recordSummary.recitation, "5.0 / 5");

  const droppedRecordsRes = await fetch(
    `${baseUrl}/api/student/classes/${testClass.id}/records`,
    { headers: { Cookie: droppedCookie } },
  );
  assert.equal(droppedRecordsRes.status, 200);
  const droppedRecordsBody = await droppedRecordsRes.json();
  assert.equal(droppedRecordsBody.class.enrollmentStatus, "DROPPED");
  assert.ok(droppedRecordsBody.class.droppedAt, "Expected droppedAt timestamp in class record payload");
  assert.equal(droppedRecordsBody.attendance.length, 1);
  assert.equal(droppedRecordsBody.recitations.length, 1);

  // 4. DECLINED student and 0-record removed student do NOT have access
  for (const [label, studentUser] of [
    ["DECLINED", declined.user],
    ["0-record removed", toRemoveZero.user],
  ]) {
    const studentCookie = await loginAndGetCookie(baseUrl, studentUser.email, password);
    const listRes = await fetch(`${baseUrl}/api/student/classes`, {
      headers: { Cookie: studentCookie },
    });
    assert.equal(listRes.status, 200);
    const listBody = await listRes.json();
    assert.equal(
      listBody.classes.length,
      0,
      `${label} student must not see the class in /api/student/classes`,
    );

    const recRes = await fetch(`${baseUrl}/api/student/classes/${testClass.id}/records`, {
      headers: { Cookie: studentCookie },
    });
    assert.equal(
      recRes.status,
      404,
      `${label} student must receive 404 from /api/student/classes/:classId/records`,
    );
  }
});
