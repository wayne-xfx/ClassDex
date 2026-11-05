require("dotenv").config();
const test = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcryptjs");
const { app, resetRateLimitersForTests } = require("../index");
const { prisma } = require("../db");

const SAMPLE_DATA_PHOTO =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const SAMPLE_CLOUDINARY_PHOTO =
  "https://res.cloudinary.com/demo/image/upload/v1700000000/sample_profile.jpg";

async function generateUnusedStudentIds(count) {
  const chosen = new Set();
  let attempts = 0;
  while (chosen.size < count) {
    attempts += 1;
    if (attempts > 200) {
      throw new Error("Unable to allocate unused 7-digit test student IDs.");
    }
    const candidate = String(Math.floor(8000000 + Math.random() * 1999999));
    if (chosen.has(candidate)) continue;
    const [existingProfile, existingRoster] = await Promise.all([
      prisma.studentProfile.findUnique({ where: { studentId: candidate }, select: { id: true } }),
      prisma.classRoster.findFirst({ where: { studentId: candidate }, select: { id: true } }),
    ]);
    if (!existingProfile && !existingRoster) {
      chosen.add(candidate);
    }
  }
  return [...chosen];
}

test("SCRUM-57: Student profile save, auth/validation, and ClassRoster ID sync without duplicates", async (t) => {
  resetRateLimitersForTests();
  const server = app.listen(0);
  const createdUserIds = [];
  const createdStudentProfileIds = [];
  const createdClassIds = [];
  const createdRosterIds = [];
  const createdEnrollmentIds = [];

  t.after(async () => {
    resetRateLimitersForTests();
    await new Promise((resolve) => server.close(resolve));

    if (createdClassIds.length) {
      const sessions = await prisma.classSession.findMany({
        where: { classId: { in: createdClassIds } },
        select: { id: true },
      });
      const sessionIds = sessions.map((s) => s.id);
      if (sessionIds.length) {
        const attendanceRows = await prisma.attendanceRecord.findMany({
          where: { sessionId: { in: sessionIds } },
          select: { id: true },
        });
        if (attendanceRows.length) {
          await prisma.attendanceRecord.deleteMany({
            where: { id: { in: attendanceRows.map((r) => r.id) } },
          });
        }
        await prisma.classSession.deleteMany({ where: { id: { in: sessionIds } } });
      }

      const enrollments = await prisma.classEnrollment.findMany({
        where: { classId: { in: createdClassIds } },
        select: { id: true },
      });
      const enrollmentIds = [...new Set([...createdEnrollmentIds, ...enrollments.map((e) => e.id)])];
      if (enrollmentIds.length) {
        await prisma.classEnrollment.deleteMany({ where: { id: { in: enrollmentIds } } });
      }

      const rosters = await prisma.classRoster.findMany({
        where: { classId: { in: createdClassIds } },
        select: { id: true },
      });
      const rosterIds = [...new Set([...createdRosterIds, ...rosters.map((r) => r.id)])];
      if (rosterIds.length) {
        await prisma.classRoster.deleteMany({ where: { id: { in: rosterIds } } });
      }

      await prisma.class.deleteMany({ where: { id: { in: createdClassIds } } });
    }

    if (createdUserIds.length || createdStudentProfileIds.length) {
      const profiles = createdUserIds.length
        ? await prisma.studentProfile.findMany({
            where: { userId: { in: createdUserIds } },
            select: { id: true },
          })
        : [];
      const profileIds = [...new Set([...createdStudentProfileIds, ...profiles.map((p) => p.id)])];
      if (profileIds.length) {
        await prisma.studentProfile.deleteMany({ where: { id: { in: profileIds } } });
      }
    }

    if (createdUserIds.length) {
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
  });

  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;
  const runId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const hashedPassword = await bcrypt.hash("Password123!", 10);

  const [id1Initial, id1Updated, id2Taken, id3Typo, id3Prelisted] =
    await generateUnusedStudentIds(5);

  const facultyUser = await prisma.user.create({
    data: {
      name: "Prof. Profile Tester",
      email: `prof.sp57.${runId}@test.local`,
      password: hashedPassword,
      role: "FACULTY",
      emailVerified: true,
    },
  });
  createdUserIds.push(facultyUser.id);

  const studentUser1 = await prisma.user.create({
    data: {
      name: "Maria Clara Cruz",
      email: `student1.sp57.${runId}@test.local`,
      password: hashedPassword,
      role: "STUDENT",
      emailVerified: true,
    },
  });
  createdUserIds.push(studentUser1.id);

  const studentUser2 = await prisma.user.create({
    data: {
      name: "Andres Bonifacio",
      email: `student2.sp57.${runId}@test.local`,
      password: hashedPassword,
      role: "STUDENT",
      emailVerified: true,
    },
  });
  createdUserIds.push(studentUser2.id);

  const studentUser3 = await prisma.user.create({
    data: {
      name: "Juan Santos",
      email: `student3.sp57.${runId}@test.local`,
      password: hashedPassword,
      role: "STUDENT",
      emailVerified: true,
    },
  });
  createdUserIds.push(studentUser3.id);

  async function loginCookie(email) {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: "Password123!" }),
    });
    assert.equal(res.status, 200);
    return res.headers.get("set-cookie")?.match(/classdex\.sid=[^;]+/)?.[0] || "";
  }

  const facultyCookie = await loginCookie(facultyUser.email);
  const student1Cookie = await loginCookie(studentUser1.email);
  const student2Cookie = await loginCookie(studentUser2.email);
  const student3Cookie = await loginCookie(studentUser3.email);

  // 1. Unauthenticated -> 401 & FACULTY -> 403
  const unauthGet = await fetch(`${baseUrl}/api/student/profile`);
  assert.equal(unauthGet.status, 401);

  const unauthPut = await fetch(`${baseUrl}/api/student/profile`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Anon",
      studentId: id1Initial,
      email: studentUser1.email,
      photo: SAMPLE_DATA_PHOTO,
    }),
  });
  assert.equal(unauthPut.status, 401);

  const facultyGet = await fetch(`${baseUrl}/api/student/profile`, {
    headers: { Cookie: facultyCookie },
  });
  assert.equal(facultyGet.status, 403);

  const facultyPut = await fetch(`${baseUrl}/api/student/profile`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Cookie: facultyCookie },
    body: JSON.stringify({
      name: "Prof",
      studentId: id1Initial,
      email: facultyUser.email,
      photo: SAMPLE_DATA_PHOTO,
    }),
  });
  assert.equal(facultyPut.status, 403);

  // 2. 7-digit Student ID validation & required photo validation
  for (const badId of ["", "123456", "12345678", "123456A", "23-0039"]) {
    const res = await fetch(`${baseUrl}/api/student/profile`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: student1Cookie },
      body: JSON.stringify({
        name: "Maria Clara Cruz",
        studentId: badId,
        email: studentUser1.email,
        photo: SAMPLE_DATA_PHOTO,
      }),
    });
    assert.equal(res.status, 400, `Expected 400 for invalid studentId "${badId}"`);
    const body = await res.json();
    assert.match(body.message, /7 digits/i);
  }

  for (const badPhoto of ["", null, "http://insecure.example/photo.jpg", "not-a-photo"]) {
    const res = await fetch(`${baseUrl}/api/student/profile`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: student1Cookie },
      body: JSON.stringify({
        name: "Maria Clara Cruz",
        studentId: id1Initial,
        email: studentUser1.email,
        photo: badPhoto,
      }),
    });
    assert.equal(res.status, 400, `Expected 400 for invalid photo "${badPhoto}"`);
    const body = await res.json();
    assert.match(body.message, /photo/i);
  }

  // 3. Owner-only scoping: Student 1 saves profile (even if body contains another userId)
  const save1Res = await fetch(`${baseUrl}/api/student/profile`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Cookie: student1Cookie },
    body: JSON.stringify({
      userId: studentUser2.id,
      name: "Maria Clara Cruz",
      studentId: id1Initial,
      email: studentUser1.email,
      program: "BSIT",
      section: "3A",
      photo: SAMPLE_CLOUDINARY_PHOTO,
    }),
  });
  assert.equal(save1Res.status, 200);
  const { profile: profile1 } = await save1Res.json();
  createdStudentProfileIds.push(profile1.id);
  assert.equal(profile1.userId, studentUser1.id);
  assert.equal(profile1.studentId, id1Initial);
  assert.equal(profile1.photo, SAMPLE_CLOUDINARY_PHOTO);

  // Student 2 still has no profile (owner-scoped)
  const get2EmptyRes = await fetch(`${baseUrl}/api/student/profile`, {
    headers: { Cookie: student2Cookie },
  });
  assert.equal(get2EmptyRes.status, 200);
  const get2EmptyBody = await get2EmptyRes.json();
  assert.equal(get2EmptyBody.profile, null);

  // 4. 409 conflict when studentId belongs to another StudentProfile
  const conflictCreateRes = await fetch(`${baseUrl}/api/student/profile`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Cookie: student2Cookie },
    body: JSON.stringify({
      name: "Andres Bonifacio",
      studentId: id1Initial,
      email: studentUser2.email,
      photo: SAMPLE_DATA_PHOTO,
    }),
  });
  assert.equal(conflictCreateRes.status, 409);
  const conflictCreateBody = await conflictCreateRes.json();
  assert.equal(conflictCreateBody.message, "That student ID is already linked to another profile.");

  // Student 2 saves with their own unused ID
  const save2Res = await fetch(`${baseUrl}/api/student/profile`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Cookie: student2Cookie },
    body: JSON.stringify({
      name: "Andres Bonifacio",
      studentId: id2Taken,
      email: studentUser2.email,
      photo: SAMPLE_DATA_PHOTO,
    }),
  });
  assert.equal(save2Res.status, 200);
  const { profile: profile2 } = await save2Res.json();
  createdStudentProfileIds.push(profile2.id);

  // 5. In-place ClassRoster studentId update without overwriting faculty studentName
  const classA = await prisma.class.create({
    data: {
      sectionName: "IT 122 Section A",
      classCode: `A57${runId}`.slice(0, 10).toUpperCase(),
      facultyId: facultyUser.id,
    },
  });
  createdClassIds.push(classA.id);

  const prelistedRosterA = await prisma.classRoster.create({
    data: {
      classId: classA.id,
      studentId: id1Initial,
      studentName: "Cruz, Maria Clara (Faculty Official)",
      firstName: "Maria Clara",
      lastName: "Cruz",
      sortKey: "cruz",
    },
  });
  createdRosterIds.push(prelistedRosterA.id);

  const enrollmentA = await prisma.classEnrollment.create({
    data: {
      classId: classA.id,
      studentProfileId: profile1.id,
      status: "APPROVED",
    },
  });
  createdEnrollmentIds.push(enrollmentA.id);

  // Attempting to change Student 1's ID to Student 2's ID returns 409 and keeps ClassRoster untouched
  const conflictUpdateRes = await fetch(`${baseUrl}/api/student/profile`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Cookie: student1Cookie },
    body: JSON.stringify({
      name: "Maria C. Cruz",
      studentId: id2Taken,
      email: studentUser1.email,
      photo: SAMPLE_CLOUDINARY_PHOTO,
    }),
  });
  assert.equal(conflictUpdateRes.status, 409);
  const rosterAAfterConflict = await prisma.classRoster.findMany({ where: { classId: classA.id } });
  assert.equal(rosterAAfterConflict.length, 1);
  assert.equal(rosterAAfterConflict[0].studentId, id1Initial);

  // Changing Student 1's ID to unused id1Updated updates ClassRoster in-place & preserves faculty studentName
  const update1Res = await fetch(`${baseUrl}/api/student/profile`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Cookie: student1Cookie },
    body: JSON.stringify({
      name: "Maria C. Cruz Updated",
      studentId: id1Updated,
      email: studentUser1.email,
      photo: SAMPLE_CLOUDINARY_PHOTO,
    }),
  });
  assert.equal(update1Res.status, 200);

  const rosterAAfterUpdate = await prisma.classRoster.findMany({ where: { classId: classA.id } });
  assert.equal(rosterAAfterUpdate.length, 1);
  assert.equal(rosterAAfterUpdate[0].id, prelistedRosterA.id);
  assert.equal(rosterAAfterUpdate[0].studentId, id1Updated);
  assert.equal(rosterAAfterUpdate[0].studentName, "Cruz, Maria Clara (Faculty Official)");

  // 6. Fixing a manually-approved typo ID to match a pre-listed ClassRoster row
  const classB = await prisma.class.create({
    data: {
      sectionName: "IT 122 Section B",
      classCode: `B57${runId}`.slice(0, 10).toUpperCase(),
      facultyId: facultyUser.id,
    },
  });
  createdClassIds.push(classB.id);

  const prelistedRosterB = await prisma.classRoster.create({
    data: {
      classId: classB.id,
      studentId: id3Prelisted,
      studentName: "Santos, Juan Miguel (Official List)",
      firstName: "Juan Miguel",
      lastName: "Santos",
      sortKey: "santos",
    },
  });
  createdRosterIds.push(prelistedRosterB.id);

  // Student 3 initially saves a typo studentId
  const save3TypoRes = await fetch(`${baseUrl}/api/student/profile`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Cookie: student3Cookie },
    body: JSON.stringify({
      name: "Juan Santos",
      studentId: id3Typo,
      email: studentUser3.email,
      photo: SAMPLE_DATA_PHOTO,
    }),
  });
  assert.equal(save3TypoRes.status, 200);
  const { profile: profile3 } = await save3TypoRes.json();
  createdStudentProfileIds.push(profile3.id);

  // Student 3 has PENDING enrollment in Class B and faculty manually approves
  const pendingEnrollmentB = await prisma.classEnrollment.create({
    data: {
      classId: classB.id,
      studentProfileId: profile3.id,
      status: "PENDING",
    },
  });
  createdEnrollmentIds.push(pendingEnrollmentB.id);

  const approveRes = await fetch(
    `${baseUrl}/api/classes/${classB.id}/pending/${pendingEnrollmentB.id}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: facultyCookie },
      body: JSON.stringify({ status: "APPROVED" }),
    },
  );
  assert.equal(approveRes.status, 200);

  // Before fix: Class B has 2 roster rows (pre-listed id3Prelisted + auto-created id3Typo)
  const rosterBBeforeFix = await prisma.classRoster.findMany({ where: { classId: classB.id } });
  assert.equal(rosterBBeforeFix.length, 2);

  // Student 3 fixes typo ID to match id3Prelisted
  const fix3Res = await fetch(`${baseUrl}/api/student/profile`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Cookie: student3Cookie },
    body: JSON.stringify({
      name: "Juan Santos",
      studentId: id3Prelisted,
      email: studentUser3.email,
      photo: SAMPLE_DATA_PHOTO,
    }),
  });
  assert.equal(fix3Res.status, 200);

  const rosterBAfterFix = await prisma.classRoster.findMany({ where: { classId: classB.id } });
  assert.equal(rosterBAfterFix.length, 1, "Orphaned typo roster row should be deleted");
  assert.equal(rosterBAfterFix[0].id, prelistedRosterB.id, "Pre-listed roster row should be kept");
  assert.equal(rosterBAfterFix[0].studentId, id3Prelisted);
  assert.equal(
    rosterBAfterFix[0].studentName,
    "Santos, Juan Miguel (Official List)",
    "Faculty-entered studentName must not be overwritten",
  );

  // Verify /roster and /deck leave zero duplicates and preserve faculty studentName
  const getRosterRes = await fetch(`${baseUrl}/api/classes/${classB.id}/roster`, {
    headers: { Cookie: facultyCookie },
  });
  assert.equal(getRosterRes.status, 200);
  const { roster: apiRoster } = await getRosterRes.json();
  assert.equal(apiRoster.length, 1);
  assert.equal(apiRoster[0].id, prelistedRosterB.id);
  assert.equal(apiRoster[0].studentId, id3Prelisted);
  assert.equal(apiRoster[0].studentName, "Santos, Juan Miguel (Official List)");

  const getDeckRes = await fetch(`${baseUrl}/api/classes/${classB.id}/deck`, {
    headers: { Cookie: facultyCookie },
  });
  assert.equal(getDeckRes.status, 200);
  const deckBody = await getDeckRes.json();
  assert.equal(deckBody.rosterCount, 1);
  assert.equal(deckBody.students.length, 1);
  assert.equal(deckBody.students[0].studentId, id3Prelisted);
  assert.equal(deckBody.students[0].name, "Juan Santos");

  const finalRosterB = await prisma.classRoster.findMany({ where: { classId: classB.id } });
  assert.equal(finalRosterB.length, 1);
  assert.equal(finalRosterB[0].studentName, "Santos, Juan Miguel (Official List)");
});
