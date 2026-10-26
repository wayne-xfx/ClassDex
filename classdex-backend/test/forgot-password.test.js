require("dotenv").config();
const test = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcryptjs");
const { app, resetRateLimitersForTests } = require("../index");
const { prisma } = require("../db");
const { hashToken } = require("../src/utils/tokens");
const {
  setMailTransportForTests,
  resetMailTransportForTests,
} = require("../src/services/mailer");
const {
  setRecaptchaVerifierForTests,
  resetRecaptchaVerifierForTests,
} = require("../recaptcha");

const VALID_CAPTCHA = "valid-test-recaptcha-token";

test("SCRUM-51 & SCRUM-54: forgot-password enforces reCAPTCHA first, avoids enumeration, hashes tokens, and rate-limits per IP and per normalized email", async (t) => {
  resetRateLimitersForTests();
  const sentEmails = [];
  setMailTransportForTests(async (msg) => {
    sentEmails.push(msg);
    return { ok: true, transport: "test" };
  });
  setRecaptchaVerifierForTests(async (token) =>
    token === VALID_CAPTCHA
      ? { success: true }
      : { success: false, message: "Invalid captcha" },
  );

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
    resetRecaptchaVerifierForTests();
    resetRateLimitersForTests();
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

  // 1. Failing or missing reCAPTCHA fails with friendly 400 BEFORE lookup, token creation, or email
  const badCaptchaRes = await fetch(`${baseUrl}/api/auth/forgot-password`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Forwarded-For": "198.51.100.1",
    },
    body: JSON.stringify({ email: facultyEmail, recaptchaToken: "bad-token" }),
  });
  const badCaptchaBody = await badCaptchaRes.json();
  assert.equal(badCaptchaRes.status, 400);
  assert.equal(badCaptchaBody.message, "We couldn't verify you're human. Please try again.");
  const tokensAfterBadCaptcha = await prisma.passwordResetToken.count({
    where: { userId: faculty.id },
  });
  assert.equal(tokensAfterBadCaptcha, 0);
  assert.equal(sentEmails.length, 0);

  resetRateLimitersForTests();

  // 2. Registered faculty request #1 (with mixed case + whitespace)
  const res1 = await fetch(`${baseUrl}/api/auth/forgot-password`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Forwarded-For": "198.51.100.2",
    },
    body: JSON.stringify({
      email: `  ${facultyEmail.toUpperCase()}  `,
      recaptchaToken: VALID_CAPTCHA,
    }),
  });
  const body1 = await res1.json();
  assert.equal(res1.status, 200);
  assert.equal(body1.message, "If an account exists for that email, we've sent a reset link.");

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

  // 3. Registered faculty request #2 -> invalidates token #1
  const res2 = await fetch(`${baseUrl}/api/auth/forgot-password`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Forwarded-For": "198.51.100.3",
    },
    body: JSON.stringify({ email: facultyEmail, recaptchaToken: VALID_CAPTCHA }),
  });
  const body2 = await res2.json();
  assert.equal(res2.status, 200);
  assert.deepEqual(body2, body1);

  const dbToken1After = await prisma.passwordResetToken.findUnique({
    where: { id: dbToken1.id },
  });
  assert.notEqual(dbToken1After.usedAt, null, "Earlier unused token must be invalidated");

  // 4. Registered student + unregistered email -> identical status & body
  const resStudent = await fetch(`${baseUrl}/api/auth/forgot-password`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Forwarded-For": "198.51.100.4",
    },
    body: JSON.stringify({ email: studentEmail, recaptchaToken: VALID_CAPTCHA }),
  });
  assert.equal(resStudent.status, 200);
  assert.deepEqual(await resStudent.json(), body1);

  await new Promise((resolve) => setTimeout(resolve, 30));
  const emailsBeforeMissing = sentEmails.length;
  const resMissing = await fetch(`${baseUrl}/api/auth/forgot-password`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Forwarded-For": "198.51.100.5",
    },
    body: JSON.stringify({ email: missingEmail, recaptchaToken: VALID_CAPTCHA }),
  });
  assert.equal(resMissing.status, 200);
  assert.deepEqual(await resMissing.json(), body1);
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(sentEmails.length, emailsBeforeMissing);

  // 5. Rate limit per IP: 5 requests / 15 min succeed, 6th returns 429
  resetRateLimitersForTests();
  const sharedIp = "203.0.113.50";
  for (let i = 1; i <= 5; i += 1) {
    const r = await fetch(`${baseUrl}/api/auth/forgot-password`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Forwarded-For": sharedIp,
      },
      body: JSON.stringify({
        email: `iplimit.${i}.${runId}@test.local`,
        recaptchaToken: VALID_CAPTCHA,
      }),
    });
    assert.equal(r.status, 200, `IP request #${i} should pass`);
  }
  const ip6 = await fetch(`${baseUrl}/api/auth/forgot-password`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Forwarded-For": sharedIp,
    },
    body: JSON.stringify({
      email: `iplimit.6.${runId}@test.local`,
      recaptchaToken: VALID_CAPTCHA,
    }),
  });
  assert.equal(ip6.status, 429);
  assert.equal((await ip6.json()).message, "Too many requests. Please try again later.");

  // 6. Rate limit per normalized email (unregistered AND registered) across distinct IPs: 6th returns 429
  for (const targetEmail of [missingEmail, facultyEmail]) {
    resetRateLimitersForTests();
    for (let i = 1; i <= 5; i += 1) {
      const r = await fetch(`${baseUrl}/api/auth/forgot-password`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Forwarded-For": `203.0.113.${100 + i}`,
        },
        body: JSON.stringify({
          email: i % 2 === 0 ? `  ${targetEmail.toUpperCase()} ` : targetEmail,
          recaptchaToken: VALID_CAPTCHA,
        }),
      });
      assert.equal(r.status, 200, `Email request #${i} for ${targetEmail} should pass`);
    }
    const email6 = await fetch(`${baseUrl}/api/auth/forgot-password`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Forwarded-For": "203.0.113.199",
      },
      body: JSON.stringify({
        email: targetEmail,
        recaptchaToken: VALID_CAPTCHA,
      }),
    });
    assert.equal(email6.status, 429);
    assert.equal((await email6.json()).message, "Too many requests. Please try again later.");
  }
});
