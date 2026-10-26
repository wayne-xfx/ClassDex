require("dotenv").config();
const test = require("node:test");
const assert = require("node:assert/strict");
const { app, resetRateLimitersForTests } = require("../index");
const { prisma } = require("../db");
const { generateToken, hashToken } = require("../src/utils/tokens");
const {
  setRecaptchaVerifierForTests,
  resetRecaptchaVerifierForTests,
} = require("../recaptcha");
const {
  setMailTransportForTests,
  resetMailTransportForTests,
} = require("../src/services/mailer");

function extractSessionCookie(response) {
  const setCookie = response.headers.get("set-cookie") || "";
  const match = setCookie.match(/classdex\.sid=[^;]+/);
  return match ? match[0] : "";
}

function extractVerifyTokenFromMail(msg) {
  const match = String(msg?.text || "").match(/\/verify-email\?token=([a-f0-9]+)/i);
  return match ? match[1] : null;
}

test("SCRUM-55: registration sends 24h verify token without failing on mail error, resend enforces 60s cooldown, and verify-email burns single-use + sibling tokens", async (t) => {
  resetRateLimitersForTests();
  setRecaptchaVerifierForTests(async () => ({ success: true }));

  const sentEmails = [];
  let shouldThrowMail = false;
  setMailTransportForTests(async (msg) => {
    if (shouldThrowMail) {
      throw new Error("Simulated mail provider outage");
    }
    sentEmails.push(msg);
    return { ok: true, transport: "test" };
  });

  const server = app.listen(0);
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;
  const runId = Date.now().toString(36);
  const studentEmail = `sprint5.verify.student.${runId}@test.local`;
  const facultyEmail = `sprint5.verify.faculty.${runId}@test.local`;
  const createdEmails = [studentEmail, facultyEmail];

  t.after(async () => {
    resetRecaptchaVerifierForTests();
    resetMailTransportForTests();
    resetRateLimitersForTests();
    await new Promise((resolve) => server.close(resolve));
    await prisma.user.deleteMany({ where: { email: { in: createdEmails } } });
    await prisma.$disconnect();
  });

  // 1. Register student -> creates 24h hashed verify token, sends email, emailVerified = false, does NOT lock out session
  const regStudentRes = await fetch(`${baseUrl}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Verify Student",
      email: studentEmail,
      password: "password123",
      confirmPassword: "password123",
      role: "STUDENT",
      recaptchaToken: "ok",
    }),
  });
  assert.equal(regStudentRes.status, 201);
  const regStudentBody = await regStudentRes.json();
  assert.equal(regStudentBody.user.emailVerified, false);

  const studentCookie = extractSessionCookie(regStudentRes);
  assert.ok(studentCookie, "Registration must set classdex.sid session cookie");

  const meUnverified = await fetch(`${baseUrl}/api/auth/me`, {
    headers: { Cookie: studentCookie },
  });
  assert.equal(meUnverified.status, 200);
  assert.equal((await meUnverified.json()).user.emailVerified, false);

  assert.equal(sentEmails.length, 1);
  const initialRawToken = extractVerifyTokenFromMail(sentEmails[0]);
  assert.ok(initialRawToken, "Verification email must contain /verify-email?token=<raw>");

  const storedInitialToken = await prisma.emailVerificationToken.findUnique({
    where: { tokenHash: hashToken(initialRawToken) },
  });
  assert.ok(storedInitialToken, "DB must store SHA-256 hash of verification token");
  assert.notEqual(storedInitialToken.tokenHash, initialRawToken);

  // 2. Register faculty while mail transport throws -> registration still succeeds (201)
  shouldThrowMail = true;
  const regFacultyRes = await fetch(`${baseUrl}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Verify Faculty",
      email: facultyEmail,
      password: "password123",
      confirmPassword: "password123",
      role: "FACULTY",
      recaptchaToken: "ok",
    }),
  });
  assert.equal(regFacultyRes.status, 201, "Mail error must not fail registration");
  shouldThrowMail = false;

  // 3. Resend verification requires auth, sends fresh link, invalidates prior token, and enforces 60s cooldown
  const unauthResend = await fetch(`${baseUrl}/api/auth/resend-verification`, {
    method: "POST",
  });
  assert.equal(unauthResend.status, 401);

  const resend1 = await fetch(`${baseUrl}/api/auth/resend-verification`, {
    method: "POST",
    headers: { Cookie: studentCookie },
  });
  assert.equal(resend1.status, 200);
  const resend1Body = await resend1.json();
  assert.equal(resend1Body.retryAfter, 60);
  assert.equal(sentEmails.length, 2);

  const resentRawToken = extractVerifyTokenFromMail(sentEmails[1]);
  assert.ok(resentRawToken && resentRawToken !== initialRawToken);

  const resend2 = await fetch(`${baseUrl}/api/auth/resend-verification`, {
    method: "POST",
    headers: { Cookie: studentCookie },
  });
  assert.equal(resend2.status, 429);
  const resend2Body = await resend2.json();
  assert.ok(resend2Body.retryAfter > 0 && resend2Body.retryAfter <= 60);
  assert.ok(resend2.headers.get("retry-after"));

  // 4. Verify invalid, expired, and invalidated-initial tokens
  const missingVerify = await fetch(`${baseUrl}/api/auth/verify-email`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: "" }),
  });
  assert.equal(missingVerify.status, 400);
  assert.equal((await missingVerify.json()).reason, "invalid");

  const initialTokenVerify = await fetch(`${baseUrl}/api/auth/verify-email`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: initialRawToken }),
  });
  assert.equal(initialTokenVerify.status, 400);
  assert.equal((await initialTokenVerify.json()).reason, "used");

  const expiredPair = generateToken();
  await prisma.emailVerificationToken.create({
    data: {
      userId: regStudentBody.user.id,
      tokenHash: expiredPair.hash,
      expiresAt: new Date(Date.now() - 60_000),
    },
  });
  const expiredVerify = await fetch(`${baseUrl}/api/auth/verify-email`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: expiredPair.raw }),
  });
  assert.equal(expiredVerify.status, 400);
  assert.equal((await expiredVerify.json()).reason, "expired");

  // Also add an extra sibling unused token to confirm verification burns all unused tokens for the user
  const siblingPair = generateToken();
  await prisma.emailVerificationToken.create({
    data: {
      userId: regStudentBody.user.id,
      tokenHash: siblingPair.hash,
      expiresAt: new Date(Date.now() + 3600_000),
    },
  });

  // 5. Verify with valid resent token -> marks emailVerified=true, burns sibling, second attempt -> "used"
  const okVerify = await fetch(`${baseUrl}/api/auth/verify-email`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: resentRawToken }),
  });
  assert.equal(okVerify.status, 200);
  assert.equal((await okVerify.json()).verified, true);

  const meVerified = await fetch(`${baseUrl}/api/auth/me`, {
    headers: { Cookie: studentCookie },
  });
  assert.equal(meVerified.status, 200);
  assert.equal((await meVerified.json()).user.emailVerified, true);

  const reuseVerify = await fetch(`${baseUrl}/api/auth/verify-email`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: resentRawToken }),
  });
  assert.equal(reuseVerify.status, 400);
  assert.equal((await reuseVerify.json()).reason, "used");

  const siblingVerify = await fetch(`${baseUrl}/api/auth/verify-email`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: siblingPair.raw }),
  });
  assert.equal(siblingVerify.status, 400);
  assert.equal((await siblingVerify.json()).reason, "used");

  // 6. Resend verification on already-verified account -> harmless 200 no-op
  const resendAlreadyVerified = await fetch(`${baseUrl}/api/auth/resend-verification`, {
    method: "POST",
    headers: { Cookie: studentCookie },
  });
  assert.equal(resendAlreadyVerified.status, 200);
  const alreadyBody = await resendAlreadyVerified.json();
  assert.equal(alreadyBody.alreadyVerified, true);
  assert.equal(sentEmails.length, 2, "Already-verified no-op must not send another email");
});
