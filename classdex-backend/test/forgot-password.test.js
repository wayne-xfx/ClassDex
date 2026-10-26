require("dotenv").config();
const test = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcryptjs");
const { app } = require("../index");
const { prisma } = require("../db");
const { hashToken } = require("../src/utils/tokens");
const {
  setMailTransportForTests,
  resetMailTransportForTests,
} = require("../src/services/mailer");

test("SCRUM-51: forgot-password handles registered (faculty & student) and unregistered emails identically, hashes tokens, and invalidates earlier unused tokens", async (t) => {
  const sentEmails = [];
  setMailTransportForTests(async (msg) => {
    sentEmails.push(msg);
    return { ok: true, transport: "test" };
  });

  const server = app.listen(0);
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;
  const runId = Date.now().toString(36);
  const facultyEmail = `sprint5.faculty.${runId}@test.local`;
  const studentEmail = `sprint5.student.${runId}@test.local`;
  const missingEmail = `sprint5.missing.${runId}@test.local`;

  const createdUserIds = [];

  t.after(async () => {
    resetMailTransportForTests();
    await new Promise((resolve) => server.close(resolve));
    if (createdUserIds.length) {
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
    await prisma.$disconnect();
  });

  const passwordHash = await bcrypt.hash("testpass123", 12);
  const faculty = await prisma.user.create({
    data: { name: "Prof Test", email: facultyEmail, password: passwordHash, role: "FACULTY" },
  });
  const student = await prisma.user.create({
    data: { name: "Stu Test", email: studentEmail, password: passwordHash, role: "STUDENT" },
  });
  createdUserIds.push(faculty.id, student.id);

  // 1. Registered faculty request #1 (with mixed case + whitespace)
  const res1 = await fetch(`${baseUrl}/api/auth/forgot-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: `  ${facultyEmail.toUpperCase()}  ` }),
  });
  const body1 = await res1.json();
  assert.equal(res1.status, 200);
  assert.equal(body1.message, "If an account exists for that email, we've sent a reset link.");

  // Allow fire-and-forget sendMail microtask to settle
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(sentEmails.length, 1);
  const urlMatch1 = sentEmails[0].text.match(/\/reset-password\?token=([0-9a-f]{64})/);
  assert.ok(urlMatch1, "Reset email must include raw 64-hex token link");
  const rawToken1 = urlMatch1[1];

  const dbToken1 = await prisma.passwordResetToken.findUnique({
    where: { tokenHash: hashToken(rawToken1) },
  });
  assert.ok(dbToken1, "Token must be stored by SHA-256 hash");
  assert.equal(dbToken1.usedAt, null);

  // 2. Registered faculty request #2 -> invalidates token #1
  const res2 = await fetch(`${baseUrl}/api/auth/forgot-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: facultyEmail }),
  });
  const body2 = await res2.json();
  assert.equal(res2.status, 200);
  assert.deepEqual(body2, body1);

  const dbToken1After = await prisma.passwordResetToken.findUnique({
    where: { id: dbToken1.id },
  });
  assert.notEqual(dbToken1After.usedAt, null, "Earlier unused token must be invalidated");

  // 3. Registered student request -> works identically
  const resStudent = await fetch(`${baseUrl}/api/auth/forgot-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: studentEmail }),
  });
  const bodyStudent = await resStudent.json();
  assert.equal(resStudent.status, 200);
  assert.deepEqual(bodyStudent, body1);

  // 4. Unregistered email -> exact same status + body, no email sent
  await new Promise((resolve) => setTimeout(resolve, 30));
  const emailsBeforeMissing = sentEmails.length;
  const resMissing = await fetch(`${baseUrl}/api/auth/forgot-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: missingEmail }),
  });
  const bodyMissing = await resMissing.json();
  assert.equal(resMissing.status, 200);
  assert.deepEqual(bodyMissing, body1);
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(sentEmails.length, emailsBeforeMissing, "No email should be sent for unregistered address");
});
