require("dotenv").config();
const test = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcryptjs");
const { app, resetRateLimitersForTests } = require("../index");
const { prisma } = require("../db");

test("§3b: Drop List & Removal Impact", async (t) => {
  resetRateLimitersForTests();
  const server = app.listen(0);
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;
  const runId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const hashedPassword = await bcrypt.hash("password123", 10);

  // Create Faculty User & Class
  const facultyUser = await prisma.user.create({
    data: {
      name: "Faculty Drop Tester",
      email: `faculty.drop.${runId}@test.local`,
      password: hashedPassword,
      role: "FACULTY",
      emailVerified: true,
    },
  });

  const testClass = await prisma.class.create({
    data: {
      sectionName: "Drop List Class",
      classCode: `DL-${runId}`.slice(0, 10).toUpperCase(),
      facultyId: facultyUser.id,
    },
  });

  // Student A: No records
  const userA = await prisma.user.create({
    data: {
      name: "Student No Records",
      email: `studentA.${runId}@test.local`,
      password: hashedPassword,
      role: "STUDENT",
      emailVerified: true,
    },
  });
  const profileA = await prisma.studentProfile.create({
    data: {
      userId: userA.id,
      name: "Student No Records",
      studentId: "2500001",
      email: userA.email,
      photo: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    },
  });
  const rosterA = await prisma.classRoster.create({
    data: {
      classId: testClass.id,
      studentId: "2500001",
      studentName: "Student No Records",
      sortKey: "records",
    },
  });
  const enrollmentA = await prisma.classEnrollment.create({
    data: {
      classId: testClass.id,
      studentProfileId: profileA.id,
      status: "APPROVED",
    },
  });

  // Student B: Has records (Attendance record)
  const userB = await prisma.user.create({
    data: {
      name: "Student With Records",
      email: `studentB.${runId}@test.local`,
      password: hashedPassword,
      role: "STUDENT",
      emailVerified: true,
    },
  });
  const profileB = await prisma.studentProfile.create({
    data: {
      userId: userB.id,
      name: "Student With Records",
      studentId: "2500002",
      email: userB.email,
      photo: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    },
  });
  const rosterB = await prisma.classRoster.create({
    data: {
      classId: testClass.id,
      studentId: "2500002",
      studentName: "Student With Records",
      sortKey: "records",
    },
  });
  const enrollmentB = await prisma.classEnrollment.create({
    data: {
      classId: testClass.id,
      studentProfileId: profileB.id,
      status: "APPROVED",
    },
  });

  // Create session and attendance record for Student B
  const session = await prisma.classSession.create({
    data: {
      classId: testClass.id,
      date: new Date("2026-10-28T00:00:00.000Z"),
      startedAt: new Date(),
    },
  });
  await prisma.attendanceRecord.create({
    data: {
      sessionId: session.id,
      studentId: profileB.id,
      status: "PRESENT",
    },
  });

  // Student C: Only has blank placeholder score (score: null, isAbsent: true)
  const userC = await prisma.user.create({
    data: {
      name: "Student Placeholder Only",
      email: `studentC.${runId}@test.local`,
      password: hashedPassword,
      role: "STUDENT",
      emailVerified: true,
    },
  });
  const profileC = await prisma.studentProfile.create({
    data: {
      userId: userC.id,
      name: "Student Placeholder Only",
      studentId: "2500003",
      email: userC.email,
      photo: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    },
  });
  const rosterC = await prisma.classRoster.create({
    data: {
      classId: testClass.id,
      studentId: "2500003",
      studentName: "Student Placeholder Only",
      sortKey: "only",
    },
  });
  const enrollmentC = await prisma.classEnrollment.create({
    data: {
      classId: testClass.id,
      studentProfileId: profileC.id,
      status: "APPROVED",
    },
  });
  const activity = await prisma.activity.create({
    data: {
      classId: testClass.id,
      sessionId: session.id,
      title: "Test Activity",
    },
  });
  await prisma.activityScore.create({
    data: {
      activityId: activity.id,
      studentId: profileC.id,
      score: null,
      isAbsent: true,
    },
  });

  t.after(async () => {
    resetRateLimitersForTests();
    await new Promise((resolve) => server.close(resolve));
    await prisma.activityScore.deleteMany({ where: { activityId: activity.id } });
    await prisma.activity.deleteMany({ where: { classId: testClass.id } });
    await prisma.attendanceRecord.deleteMany({ where: { sessionId: session.id } });
    await prisma.classSession.deleteMany({ where: { classId: testClass.id } });
    await prisma.classEnrollment.deleteMany({ where: { classId: testClass.id } });
    await prisma.classRoster.deleteMany({ where: { classId: testClass.id } });
    await prisma.class.deleteMany({ where: { id: testClass.id } });
    await prisma.studentProfile.deleteMany({ where: { id: { in: [profileA.id, profileB.id, profileC.id] } } });
    await prisma.user.deleteMany({ where: { id: { in: [facultyUser.id, userA.id, userB.id, userC.id] } } });
  });

  // Login Faculty
  const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: facultyUser.email, password: "password123" }),
  });
  assert.equal(loginRes.status, 200);
  const facultyCookie = loginRes.headers.get("set-cookie")?.match(/classdex\.sid=[^;]+/)?.[0] || "";

  // 1. Check removal impact
  const impactARes = await fetch(`${baseUrl}/api/classes/${testClass.id}/roster/${rosterA.id}/impact`, {
    headers: { Cookie: facultyCookie },
  });
  assert.equal(impactARes.status, 200);
  const impactA = await impactARes.json();
  assert.equal(impactA.recordCount, 0);

  const impactBRes = await fetch(`${baseUrl}/api/classes/${testClass.id}/roster/${rosterB.id}/impact`, {
    headers: { Cookie: facultyCookie },
  });
  assert.equal(impactBRes.status, 200);
  const impactB = await impactBRes.json();
  assert.equal(impactB.recordCount, 1);

  const impactCRes = await fetch(`${baseUrl}/api/classes/${testClass.id}/roster/${rosterC.id}/impact`, {
    headers: { Cookie: facultyCookie },
  });
  assert.equal(impactCRes.status, 200);
  const impactC = await impactCRes.json();
  assert.equal(impactC.recordCount, 0, "Null score placeholder must not count as coursework");

  // 2. Remove Student A (0 records): deletes roster row AND enrollment
  const deleteARes = await fetch(`${baseUrl}/api/classes/${testClass.id}/roster/${rosterA.id}`, {
    method: "DELETE",
    headers: { Cookie: facultyCookie },
  });
  assert.equal(deleteARes.status, 200);
  const deleteAJson = await deleteARes.json();
  assert.equal(deleteAJson.result, "removed");

  const checkRosterA = await prisma.classRoster.findUnique({ where: { id: rosterA.id } });
  const checkEnrollA = await prisma.classEnrollment.findUnique({ where: { id: enrollmentA.id } });
  assert.equal(checkRosterA, null);
  assert.equal(checkEnrollA, null);

  // 3. Remove Student C (placeholder score only): removed, not dropped
  const deleteCRes = await fetch(`${baseUrl}/api/classes/${testClass.id}/roster/${rosterC.id}`, {
    method: "DELETE",
    headers: { Cookie: facultyCookie },
  });
  assert.equal(deleteCRes.status, 200);
  const deleteCJson = await deleteCRes.json();
  assert.equal(deleteCJson.result, "removed");

  // 4. Remove Student B (1 record): droppedAt set, enrollment status DROPPED
  const deleteBRes = await fetch(`${baseUrl}/api/classes/${testClass.id}/roster/${rosterB.id}`, {
    method: "DELETE",
    headers: { Cookie: facultyCookie },
  });
  assert.equal(deleteBRes.status, 200);
  const deleteBJson = await deleteBRes.json();
  assert.equal(deleteBJson.result, "dropped");
  assert.equal(deleteBJson.recordCount, 1);

  const checkRosterB = await prisma.classRoster.findUnique({ where: { id: rosterB.id } });
  const checkEnrollB = await prisma.classEnrollment.findUnique({ where: { id: enrollmentB.id } });
  assert.ok(checkRosterB.droppedAt !== null);
  assert.equal(checkEnrollB.status, "DROPPED");
  assert.ok(checkEnrollB.droppedAt !== null);

  // 5. Drop list returns Student B
  const dropListRes = await fetch(`${baseUrl}/api/classes/${testClass.id}/drop-list`, {
    headers: { Cookie: facultyCookie },
  });
  assert.equal(dropListRes.status, 200);
  const { dropList } = await dropListRes.json();
  assert.equal(dropList.length, 1);
  assert.equal(dropList[0].studentId, "2500002");
  assert.equal(dropList[0].recordCount, 1);

  // 6. Restore Student B
  const restoreRes = await fetch(`${baseUrl}/api/classes/${testClass.id}/drop-list/${rosterB.id}/restore`, {
    method: "POST",
    headers: { Cookie: facultyCookie },
  });
  assert.equal(restoreRes.status, 200);

  const restoredRosterB = await prisma.classRoster.findUnique({ where: { id: rosterB.id } });
  const restoredEnrollB = await prisma.classEnrollment.findUnique({ where: { id: enrollmentB.id } });
  assert.equal(restoredRosterB.droppedAt, null);
  assert.equal(restoredEnrollB.status, "APPROVED");
  assert.equal(restoredEnrollB.droppedAt, null);
});
