require("dotenv").config();
const test = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcryptjs");
const { app, resetRateLimitersForTests } = require("../index");
const { prisma } = require("../db");
const {
  setMailTransportForTests,
  resetMailTransportForTests,
} = require("../src/services/mailer");

function extractSessionCookie(response) {
  const setCookie = response.headers.get("set-cookie") || "";
  const match = setCookie.match(/classdex\.sid=[^;]+/);
  return match ? match[0] : "";
}

test("SCRUM-56: change-password validates current/new passwords, rate-limits wrong current password (5/15m), keeps active device logged in via fresh session, and invalidates other sessions with 401", async (t) => {
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
  const userEmail = `sprint5.changepw.${runId}@test.local`;
  const oldPassword = "initialPassword123";
  const newPassword = "updatedPassword456";

  const user = await prisma.user.create({
    data: {
      name: "Change Password User",
      email: userEmail,
      password: await bcrypt.hash(oldPassword, 12),
      role: "STUDENT",
      emailVerified: true,
      emailVerifiedAt: new Date(),
    },
  });

  t.after(async () => {
    resetMailTransportForTests();
    resetRateLimitersForTests();
    await new Promise((resolve) => server.close(resolve));
    await prisma.user.deleteMany({ where: { id: user.id } });
    await prisma.$disconnect();
  });

  // 1. Unauthenticated request -> 401
  const unauthRes = await fetch(`${baseUrl}/api/auth/change-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      currentPassword: oldPassword,
      newPassword,
      confirmPassword: newPassword,
    }),
  });
  assert.equal(unauthRes.status, 401);

  // 2. Log in on two separate devices (Device A = current browser, Device B = second browser)
  const loginA = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: userEmail, password: oldPassword }),
  });
  assert.equal(loginA.status, 200);
  const deviceACookie = extractSessionCookie(loginA);
  assert.ok(deviceACookie);

  const loginB = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: userEmail, password: oldPassword }),
  });
  assert.equal(loginB.status, 200);
  const deviceBCookie = extractSessionCookie(loginB);
  assert.ok(deviceBCookie && deviceBCookie !== deviceACookie);

  // 3. Reject weak new password, mismatch, and new password equal to current (none of these count as wrong current password)
  const weakRes = await fetch(`${baseUrl}/api/auth/change-password`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: deviceACookie,
    },
    body: JSON.stringify({
      currentPassword: oldPassword,
      newPassword: "short",
      confirmPassword: "short",
    }),
  });
  assert.equal(weakRes.status, 400);
  assert.equal((await weakRes.json()).field, "newPassword");

  const mismatchRes = await fetch(`${baseUrl}/api/auth/change-password`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: deviceACookie,
    },
    body: JSON.stringify({
      currentPassword: oldPassword,
      newPassword,
      confirmPassword: "differentPassword789",
    }),
  });
  assert.equal(mismatchRes.status, 400);
  assert.equal((await mismatchRes.json()).field, "confirmPassword");

  const samePasswordRes = await fetch(`${baseUrl}/api/auth/change-password`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: deviceACookie,
    },
    body: JSON.stringify({
      currentPassword: oldPassword,
      newPassword: oldPassword,
      confirmPassword: oldPassword,
    }),
  });
  assert.equal(samePasswordRes.status, 400);
  const sameBody = await samePasswordRes.json();
  assert.equal(sameBody.field, "newPassword");
  assert.match(sameBody.message, /different/i);

  // 4. Wrong current password -> 400 x5, then 429 on 6th attempt
  for (let i = 1; i <= 5; i += 1) {
    const wrongRes = await fetch(`${baseUrl}/api/auth/change-password`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: deviceACookie,
      },
      body: JSON.stringify({
        currentPassword: `wrongPassword-${i}`,
        newPassword,
        confirmPassword: newPassword,
      }),
    });
    assert.equal(wrongRes.status, 400, `Attempt ${i} should return 400`);
    const wrongBody = await wrongRes.json();
    assert.equal(wrongBody.field, "currentPassword");
  }

  const rateLimitedRes = await fetch(`${baseUrl}/api/auth/change-password`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: deviceACookie,
    },
    body: JSON.stringify({
      currentPassword: "wrongPassword-6",
      newPassword,
      confirmPassword: newPassword,
    }),
  });
  assert.equal(rateLimitedRes.status, 429);

  // Clear limiter window to test the successful password change flow
  resetRateLimitersForTests();

  // 5. Successful password change on Device A
  const okChange = await fetch(`${baseUrl}/api/auth/change-password`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: deviceACookie,
    },
    body: JSON.stringify({
      currentPassword: oldPassword,
      newPassword,
      confirmPassword: newPassword,
    }),
  });
  assert.equal(okChange.status, 200);
  const freshDeviceACookie = extractSessionCookie(okChange);
  assert.ok(freshDeviceACookie, "Response must issue a fresh session cookie");
  assert.notEqual(freshDeviceACookie, deviceACookie);

  // Wait briefly for fire-and-forget confirmation email
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(sentEmails.length, 1);
  assert.match(sentEmails[0].subject, /password was changed/i);

  // Device A stays logged in with the fresh rotated cookie
  const meDeviceAFresh = await fetch(`${baseUrl}/api/auth/me`, {
    headers: { Cookie: freshDeviceACookie },
  });
  assert.equal(meDeviceAFresh.status, 200);

  // Device B (second browser session issued before passwordChangedAt) is rejected with 401
  const meDeviceB = await fetch(`${baseUrl}/api/auth/me`, {
    headers: { Cookie: deviceBCookie },
  });
  assert.equal(meDeviceB.status, 401);

  // Old password fails on login; new password succeeds
  const loginOld = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: userEmail, password: oldPassword }),
  });
  assert.equal(loginOld.status, 401);

  const loginNew = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: userEmail, password: newPassword }),
  });
  assert.equal(loginNew.status, 200);
});
