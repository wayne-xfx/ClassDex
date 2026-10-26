require("dotenv").config();
const test = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcryptjs");
const { app, resetRateLimitersForTests } = require("../index");
const { prisma } = require("../db");
const { generateToken } = require("../src/utils/tokens");
const {
  setMailTransportForTests,
  resetMailTransportForTests,
} = require("../src/services/mailer");

function extractSessionCookie(response) {
  const setCookie = response.headers.get("set-cookie") || "";
  const match = setCookie.match(/classdex\.sid=[^;]+/);
  return match ? match[0] : "";
}

test("SCRUM-53: reset-password validates tokens, burns used/sibling tokens, rejects expired tokens, invalidates prior sessions with 401, and sends confirmation email", async (t) => {
  resetRateLimitersForTests();
  const sentEmails = [];
  setMailTransportForTests(async (msg) => {
    sentEmails.push(msg);
    return { ok: true, transport: "test" };
  });

  const server = app.listen(0);
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;
  const runId = Date.now().toString(36);
  const userEmail = `sprint5.reset.${runId}@test.local`;
  const oldPassword = "oldpassword123";
  const newPassword = "newpassword456";

  const user = await prisma.user.create({
    data: {
      name: "Reset User",
      email: userEmail,
      password: await bcrypt.hash(oldPassword, 12),
      role: "FACULTY",
    },
  });

  t.after(async () => {
    resetMailTransportForTests();
    await new Promise((resolve) => server.close(resolve));
    await prisma.user.deleteMany({ where: { id: user.id } });
    await prisma.$disconnect();
  });

  // 1. Log in on an existing session BEFORE password reset
  const loginBefore = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: userEmail, password: oldPassword }),
  });
  assert.equal(loginBefore.status, 200);
  const priorSessionCookie = extractSessionCookie(loginBefore);
  assert.ok(priorSessionCookie, "Login must set classdex.sid session cookie");

  const meBefore = await fetch(`${baseUrl}/api/auth/me`, {
    headers: { Cookie: priorSessionCookie },
  });
  assert.equal(meBefore.status, 200);

  // 2. Validate missing / unknown / expired tokens
  const missingCheck = await fetch(`${baseUrl}/api/auth/reset-password/validate`);
  assert.deepEqual(await missingCheck.json(), { valid: false, reason: "invalid" });

  const unknownCheck = await fetch(`${baseUrl}/api/auth/reset-password/validate?token=nonexistenttoken`);
  assert.deepEqual(await unknownCheck.json(), { valid: false, reason: "invalid" });

  const expiredPair = generateToken();
  await prisma.passwordResetToken.create({
    data: {
      userId: user.id,
      tokenHash: expiredPair.hash,
      expiresAt: new Date(Date.now() - 60_000),
    },
  });
  const expiredCheck = await fetch(`${baseUrl}/api/auth/reset-password/validate?token=${expiredPair.raw}`);
  assert.deepEqual(await expiredCheck.json(), { valid: false, reason: "expired" });

  const expiredPost = await fetch(`${baseUrl}/api/auth/reset-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: expiredPair.raw, password: newPassword }),
  });
  assert.equal(expiredPost.status, 400);
  assert.equal((await expiredPost.json()).reason, "expired");

  // 3. Create valid token + sibling unused token
  const validPair = generateToken();
  const siblingPair = generateToken();
  await prisma.passwordResetToken.createMany({
    data: [
      {
        userId: user.id,
        tokenHash: validPair.hash,
        expiresAt: new Date(Date.now() + 30 * 60_000),
      },
      {
        userId: user.id,
        tokenHash: siblingPair.hash,
        expiresAt: new Date(Date.now() + 30 * 60_000),
      },
    ],
  });

  const validCheck = await fetch(`${baseUrl}/api/auth/reset-password/validate?token=${validPair.raw}`);
  const validBody = await validCheck.json();
  assert.deepEqual(validBody, { valid: true });

  // 4. Reject weak password without burning token
  const weakRes = await fetch(`${baseUrl}/api/auth/reset-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: validPair.raw, password: "short" }),
  });
  assert.equal(weakRes.status, 400);
  assert.match((await weakRes.json()).message, /at least 8 characters/i);

  // 5. Reset password succeeds once, does NOT auto-login, burns token & sibling token, sends confirmation email
  const resetRes = await fetch(`${baseUrl}/api/auth/reset-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: validPair.raw, password: newPassword }),
  });
  assert.equal(resetRes.status, 200);
  assert.equal(extractSessionCookie(resetRes), "");

  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(sentEmails.length, 1);
  assert.match(sentEmails[0].subject, /password was changed/i);

  // 6. Second use of same token -> reason: "used"; sibling token -> reason: "used"
  const reuseValidate = await fetch(`${baseUrl}/api/auth/reset-password/validate?token=${validPair.raw}`);
  assert.deepEqual(await reuseValidate.json(), { valid: false, reason: "used" });

  const reusePost = await fetch(`${baseUrl}/api/auth/reset-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: validPair.raw, password: "anotherpassword123" }),
  });
  assert.equal(reusePost.status, 400);
  assert.equal((await reusePost.json()).reason, "used");

  const siblingValidate = await fetch(`${baseUrl}/api/auth/reset-password/validate?token=${siblingPair.raw}`);
  assert.deepEqual(await siblingValidate.json(), { valid: false, reason: "used" });

  // 7. Prior session is rejected with 401!
  const meAfterReset = await fetch(`${baseUrl}/api/auth/me`, {
    headers: { Cookie: priorSessionCookie },
  });
  assert.equal(meAfterReset.status, 401);

  // 8. Old password fails, new password succeeds and establishes a valid session
  const oldLogin = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: userEmail, password: oldPassword }),
  });
  assert.equal(oldLogin.status, 401);

  const newLogin = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: userEmail, password: newPassword }),
  });
  assert.equal(newLogin.status, 200);
  const freshCookie = extractSessionCookie(newLogin);
  const meFresh = await fetch(`${baseUrl}/api/auth/me`, {
    headers: { Cookie: freshCookie },
  });
  assert.equal(meFresh.status, 200);
});
