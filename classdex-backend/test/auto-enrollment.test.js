require("dotenv").config();
const test = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcryptjs");
const { app, resetRateLimitersForTests } = require("../index");
const { prisma } = require("../db");

test("§3a: Auto-enrollment on approval", async (t) => {
  resetRateLimitersForTests();
  const server = app.listen(0);
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;
  const runId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const hashedPassword = await bcrypt.hash("password123", 10);

  // Create Faculty User & Class
  const facultyUser = await prisma.user.create({
    data: {
      name: "Faculty Tester",
      email: `faculty.${runId}@test.local`,
      password: hashedPassword,
      role: "FACULTY",
      emailVerified: true,
    },
  });

  const testClass = await prisma.class.create({
    data: {
      sectionName: "Auto-Enroll Class",
      classCode: `AE-${runId}`.slice(0, 10).toUpperCase(),
      facultyId: facultyUser.id,
    },
  });

  // Create Student User & Profile
  const studentUser1 = await prisma.user.create({
    data: {
      name: "Jose P. Rizal",
      email: `student1.${runId}@test.local`,
      password: hashedPassword,
      role: "STUDENT",
      emailVerified: true,
    },
  });

  const studentProfile1 = await prisma.studentProfile.create({
    data: {
      userId: studentUser1.id,
      name: "Jose P. Rizal",
      studentId: "2400001",
      email: studentUser1.email,
      photo: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    },
  });

  // Create Student 2 (for decline test)
  const studentUser2 = await prisma.user.create({
    data: {
      name: "Andres Bonifacio",
      email: `student2.${runId}@test.local`,
      password: hashedPassword,
      role: "STUDENT",
      emailVerified: true,
    },
  });

  const studentProfile2 = await prisma.studentProfile.create({
    data: {
      userId: studentUser2.id,
      name: "Andres Bonifacio",
      studentId: "2400002",
      email: studentUser2.email,
      photo: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    },
  });

  // Cleanup in t.after
  t.after(async () => {
    resetRateLimitersForTests();
    await new Promise((resolve) => server.close(resolve));
    await prisma.classEnrollment.deleteMany({ where: { classId: testClass.id } });
    await prisma.classRoster.deleteMany({ where: { classId: testClass.id } });
    await prisma.class.deleteMany({ where: { id: testClass.id } });
    await prisma.studentProfile.deleteMany({ where: { id: { in: [studentProfile1.id, studentProfile2.id] } } });
    await prisma.user.deleteMany({ where: { id: { in: [facultyUser.id, studentUser1.id, studentUser2.id] } } });
  });

  // Faculty session cookie
  const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: facultyUser.email, password: "password123" }),
  });
  assert.equal(loginRes.status, 200);
  const facultyCookie = loginRes.headers.get("set-cookie")?.match(/classdex\.sid=[^;]+/)?.[0] || "";

  // 1. Create Pending Enrollment for Student 1
  const enrollment1 = await prisma.classEnrollment.create({
    data: {
      classId: testClass.id,
      studentProfileId: studentProfile1.id,
      status: "PENDING",
    },
  });

  // Approve Pending Request
  const approveRes1 = await fetch(`${baseUrl}/api/classes/${testClass.id}/pending/${enrollment1.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Cookie: facultyCookie },
    body: JSON.stringify({ status: "APPROVED" }),
  });
  assert.equal(approveRes1.status, 200);

  // Check: Exactly one roster row created with parsed name parts
  const rosterRows = await prisma.classRoster.findMany({ where: { classId: testClass.id } });
  assert.equal(rosterRows.length, 1);
  assert.equal(rosterRows[0].studentId, "2400001");
  assert.equal(rosterRows[0].studentName, "Jose P. Rizal");
  assert.equal(rosterRows[0].lastName, "Rizal");
  assert.equal(rosterRows[0].firstName, "Jose");
  assert.equal(rosterRows[0].sortKey, "rizal");
  assert.equal(rosterRows[0].droppedAt, null);

  // 2. Approving a student whose roster row is dropped restores it
  // Mark the roster row as dropped
  await prisma.classRoster.update({
    where: { id: rosterRows[0].id },
    data: { droppedAt: new Date() },
  });

  // Reset enrollment to pending to simulate re-request
  await prisma.classEnrollment.update({
    where: { id: enrollment1.id },
    data: { status: "PENDING", droppedAt: new Date() },
  });

  const restoreApproval = await fetch(`${baseUrl}/api/classes/${testClass.id}/pending/${enrollment1.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Cookie: facultyCookie },
    body: JSON.stringify({ status: "APPROVED" }),
  });
  assert.equal(restoreApproval.status, 200);

  const restoredRoster = await prisma.classRoster.findUnique({ where: { id: rosterRows[0].id } });
  assert.equal(restoredRoster.droppedAt, null, "droppedAt should be cleared on restore");

  // 3. Approving twice is idempotent
  // Calling update on already approved enrollment returns 404 (since where status: PENDING)
  const duplicateApproval = await fetch(`${baseUrl}/api/classes/${testClass.id}/pending/${enrollment1.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Cookie: facultyCookie },
    body: JSON.stringify({ status: "APPROVED" }),
  });
  assert.equal(duplicateApproval.status, 404);
  const rosterCountAfter = await prisma.classRoster.count({ where: { classId: testClass.id } });
  assert.equal(rosterCountAfter, 1, "Roster count remains exactly 1");

  // 4. Declining creates none
  const enrollment2 = await prisma.classEnrollment.create({
    data: {
      classId: testClass.id,
      studentProfileId: studentProfile2.id,
      status: "PENDING",
    },
  });

  const declineRes = await fetch(`${baseUrl}/api/classes/${testClass.id}/pending/${enrollment2.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Cookie: facultyCookie },
    body: JSON.stringify({ status: "DECLINED" }),
  });
  assert.equal(declineRes.status, 200);

  const student2Roster = await prisma.classRoster.findFirst({
    where: { classId: testClass.id, studentId: "2400002" },
  });
  assert.equal(student2Roster, null, "Declined student should not have a roster row created");
});
