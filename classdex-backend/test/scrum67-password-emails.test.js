require("dotenv").config();
const test = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcryptjs");
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
  setResendClientForTests,
  getStubEmails,
  clearStubEmails,
} = require("../src/services/mailer");

const VALID_CAPTCHA = "qa-s67-valid-captcha";

function extractCookie(response) {
  const raw = response.headers.get("set-cookie") || "";
  const match = raw.match(/classdex\.sid=[^;]+/);
  return match ? match[0] : "";
}

function extractToken(mail, routePrefix) {
  const regex = new RegExp(`\\/${routePrefix}\\?token=([a-f0-9]{64})`, "i");
  const fromLink = String(mail?.link || "").match(regex);
  if (fromLink) return fromLink[1];
  const fromText = String(mail?.text || "").match(regex);
  return fromText ? fromText[1] : null;
}

test("SCRUM-67 Password Recovery & Email Flows API (PWD-01..PWD-10)", async (t) => {
  resetRateLimitersForTests();
  resetMailTransportForTests();
  clearStubEmails();
  setRecaptchaVerifierForTests(async (token) =>
    token === VALID_CAPTCHA
      ? { success: true }
      : { success: false, message: "Invalid captcha" },
  );

  const prevAppBaseUrl = process.env.APP_BASE_URL;
  process.env.APP_BASE_URL = "http://localhost:5174";

  const server = app.listen(0);
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;
  const runId = Date.now().toString(36) + Math.random().toString(36).slice(2, 5);

  const stuRegEmail = `qa_s67_reg_stu_${runId}@test.local`;
  const facOutageEmail = `qa_s67_outage_fac_${runId}@test.local`;
  const facJoinEmail = `qa_s67_join_fac_${runId}@test.local`;
  const stuPend1Email = `qa_s67_join_p1_${runId}@test.local`;
  const stuPend2Email = `qa_s67_join_p2_${runId}@test.local`;
  const missingEmail = `qa_s67_missing_${runId}@test.local`;

  const createdUserIds = [];
  const createdClassIds = [];
  const createdProfileIds = [];

  async function allocStudentId(base) {
    for (let i = 0; i < 60; i += 1) {
      const candidate = String(base + Math.floor(Math.random() * 9000)).padStart(7, "8");
      const [p, r] = await Promise.all([
        prisma.studentProfile.findUnique({ where: { studentId: candidate }, select: { id: true } }),
        prisma.classRoster.findFirst({ where: { studentId: candidate }, select: { id: true } }),
      ]);
      if (!p && !r) return candidate;
    }
    throw new Error("Unable to allocate unique qa_s67 studentId");
  }

  t.after(async () => {
    resetRecaptchaVerifierForTests();
    resetMailTransportForTests();
    resetRateLimitersForTests();
    clearStubEmails();
    if (prevAppBaseUrl === undefined) delete process.env.APP_BASE_URL;
    else process.env.APP_BASE_URL = prevAppBaseUrl;

    await new Promise((resolve) => server.close(resolve));
    if (createdClassIds.length) {
      await prisma.classEnrollment.deleteMany({ where: { classId: { in: createdClassIds } } });
      await prisma.classRoster.deleteMany({ where: { classId: { in: createdClassIds } } });
      await prisma.class.deleteMany({ where: { id: { in: createdClassIds } } });
    }
    if (createdProfileIds.length) {
      await prisma.studentProfile.deleteMany({ where: { id: { in: createdProfileIds } } });
    }
    if (createdUserIds.length) {
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
    await prisma.$disconnect();
  });

  let stuRegId;
  let stuRegCookie;
  let initialVerifyToken;
  let resentVerifyToken;
  let resetTargetToken;
  let activeStuRegPassword = "QaPassword123!";

  await t.test("PWD-01: registration captures 24h verify email in stub & tolerates mail failure", async () => {
    clearStubEmails();
    const res = await fetch(`${baseUrl}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "qa_S67 Verify Student",
        email: stuRegEmail,
        password: activeStuRegPassword,
        confirmPassword: activeStuRegPassword,
        role: "STUDENT",
        recaptchaToken: VALID_CAPTCHA,
      }),
    });
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.user.emailVerified, false);
    stuRegId = body.user.id;
    createdUserIds.push(stuRegId);
    stuRegCookie = extractCookie(res);
    assert.ok(stuRegCookie);

    const stubs = getStubEmails();
    assert.equal(stubs.length, 1);
    const mail = stubs[0];
    assert.equal(mail.to, stuRegEmail);
    assert.ok(mail.from);
    assert.match(mail.subject, /Verify your ClassDex email address/i);
    assert.match(mail.link, /^http:\/\/localhost:5174\/verify-email\?token=[a-f0-9]{64}$/);
    assert.ok(mail.html.includes(mail.link));
    assert.ok(mail.text.includes(mail.link));

    initialVerifyToken = extractToken(mail, "verify-email");
    assert.ok(initialVerifyToken);

    const dbToken = await prisma.emailVerificationToken.findUnique({
      where: { tokenHash: hashToken(initialVerifyToken) },
    });
    assert.ok(dbToken, "Verification token must be hashed via SHA-256 in DB");
    assert.notEqual(dbToken.tokenHash, initialVerifyToken);

    // Register faculty while mail transport throws -> 201 resilient
    setMailTransportForTests(async () => {
      throw new Error("Simulated SMTP/Resend outage during registration");
    });
    const outageRes = await fetch(`${baseUrl}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "qa_S67 Outage Faculty",
        email: facOutageEmail,
        password: activeStuRegPassword,
        confirmPassword: activeStuRegPassword,
        role: "FACULTY",
        recaptchaToken: VALID_CAPTCHA,
      }),
    });
    assert.equal(outageRes.status, 201);
    createdUserIds.push((await outageRes.json()).user.id);
    resetMailTransportForTests();
  });

  await t.test("PWD-02: resend verification enforces 60s cooldown & invalidates earlier token", async () => {
    const unauth = await fetch(`${baseUrl}/api/auth/resend-verification`, { method: "POST" });
    assert.equal(unauth.status, 401);

    clearStubEmails();
    const resend1 = await fetch(`${baseUrl}/api/auth/resend-verification`, {
      method: "POST",
      headers: { Cookie: stuRegCookie },
    });
    assert.equal(resend1.status, 200);
    const r1Body = await resend1.json();
    assert.equal(r1Body.retryAfter, 60);

    const stubs = getStubEmails();
    assert.equal(stubs.length, 1);
    resentVerifyToken = extractToken(stubs[0], "verify-email");
    assert.ok(resentVerifyToken && resentVerifyToken !== initialVerifyToken);

    // Immediate second resend returns 429 + Retry-After
    const resend2 = await fetch(`${baseUrl}/api/auth/resend-verification`, {
      method: "POST",
      headers: { Cookie: stuRegCookie },
    });
    assert.equal(resend2.status, 429);
    const retryHeader = Number(resend2.headers.get("retry-after"));
    const r2Body = await resend2.json();
    assert.ok(retryHeader >= 1 && retryHeader <= 60);
    assert.ok(r2Body.retryAfter >= 1 && r2Body.retryAfter <= 60);
  });

  await t.test("PWD-03: verification token boundaries (expired/used/superseded/tampered/unknown)", async () => {
    // Missing, unknown, tampered
    for (const [label, tok] of [
      ["missing", ""],
      ["unknown", "f".repeat(64)],
      ["tampered", `${resentVerifyToken.slice(0, -1)}${resentVerifyToken.endsWith("a") ? "b" : "a"}`],
    ]) {
      const res = await fetch(`${baseUrl}/api/auth/verify-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: tok }),
      });
      assert.equal(res.status, 400, `${label} token must fail 400`);
      assert.equal((await res.json()).reason, "invalid");
    }

    // Superseded initial token -> reason: used
    const supersededRes = await fetch(`${baseUrl}/api/auth/verify-email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: initialVerifyToken }),
    });
    assert.equal(supersededRes.status, 400);
    assert.equal((await supersededRes.json()).reason, "used");

    // Expired >24h token -> reason: expired
    const expiredPair = generateToken();
    await prisma.emailVerificationToken.create({
      data: {
        userId: stuRegId,
        tokenHash: expiredPair.hash,
        expiresAt: new Date(Date.now() - 25 * 3600_000),
      },
    });
    const expiredRes = await fetch(`${baseUrl}/api/auth/verify-email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: expiredPair.raw }),
    });
    assert.equal(expiredRes.status, 400);
    assert.equal((await expiredRes.json()).reason, "expired");

    // Extra sibling unused token
    const siblingPair = generateToken();
    await prisma.emailVerificationToken.create({
      data: {
        userId: stuRegId,
        tokenHash: siblingPair.hash,
        expiresAt: new Date(Date.now() + 3600_000),
      },
    });

    // Valid token verifies user & burns all siblings
    const okVerify = await fetch(`${baseUrl}/api/auth/verify-email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: resentVerifyToken }),
    });
    assert.equal(okVerify.status, 200);
    assert.equal((await okVerify.json()).verified, true);

    const meRes = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Cookie: stuRegCookie },
    });
    assert.equal((await meRes.json()).user.emailVerified, true);

    // Reusing valid or sibling -> used
    for (const tok of [resentVerifyToken, siblingPair.raw]) {
      const again = await fetch(`${baseUrl}/api/auth/verify-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: tok }),
      });
      assert.equal(again.status, 400);
      assert.equal((await again.json()).reason, "used");
    }

    // Already verified resend -> no extra email
    clearStubEmails();
    const alreadyRes = await fetch(`${baseUrl}/api/auth/resend-verification`, {
      method: "POST",
      headers: { Cookie: stuRegCookie },
    });
    assert.equal(alreadyRes.status, 200);
    assert.equal((await alreadyRes.json()).alreadyVerified, true);
    assert.equal(getStubEmails().length, 0);
  });

  await t.test("PWD-04: forgot-password anti-enumeration, reCAPTCHA, SHA-256 hash & stub email", async () => {
    resetRateLimitersForTests();
    clearStubEmails();

    // Invalid captcha rejected before lookup
    const badCap = await fetch(`${baseUrl}/api/auth/forgot-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Forwarded-For": "198.51.100.11" },
      body: JSON.stringify({ email: stuRegEmail, recaptchaToken: "wrong" }),
    });
    assert.equal(badCap.status, 400);
    assert.equal(getStubEmails().length, 0);
    assert.equal(await prisma.passwordResetToken.count({ where: { userId: stuRegId } }), 0);

    // Registered user (mixed case/spaces)
    const regForgot = await fetch(`${baseUrl}/api/auth/forgot-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Forwarded-For": "198.51.100.12" },
      body: JSON.stringify({ email: `  ${stuRegEmail.toUpperCase()}  `, recaptchaToken: VALID_CAPTCHA }),
    });
    assert.equal(regForgot.status, 200);
    const regBody = await regForgot.json();
    assert.equal(regBody.message, "If an account exists for that email, we've sent a reset link.");

    await new Promise((r) => setTimeout(r, 35));
    const stubsAfterReg = getStubEmails();
    assert.equal(stubsAfterReg.length, 1);
    assert.equal(stubsAfterReg[0].to, stuRegEmail);
    assert.match(stubsAfterReg[0].subject, /Reset your ClassDex password/i);
    assert.match(stubsAfterReg[0].link, /^http:\/\/localhost:5174\/reset-password\?token=[a-f0-9]{64}$/);
    resetTargetToken = extractToken(stubsAfterReg[0], "reset-password");
    assert.ok(resetTargetToken);

    const dbReset = await prisma.passwordResetToken.findUnique({
      where: { tokenHash: hashToken(resetTargetToken) },
    });
    assert.ok(dbReset && dbReset.usedAt === null);

    // Unregistered email returns IDENTICAL response & emits 0 emails
    clearStubEmails();
    const missForgot = await fetch(`${baseUrl}/api/auth/forgot-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Forwarded-For": "198.51.100.13" },
      body: JSON.stringify({ email: missingEmail, recaptchaToken: VALID_CAPTCHA }),
    });
    assert.equal(missForgot.status, 200);
    assert.deepEqual(await missForgot.json(), regBody);
    await new Promise((r) => setTimeout(r, 35));
    assert.equal(getStubEmails().length, 0);
  });

  await t.test("PWD-05: forgot-password rate limits per IP and per normalized email (5/15m)", async () => {
    resetRateLimitersForTests();
    clearStubEmails();

    // 5 by same IP -> ok, 6th -> 429
    for (let i = 1; i <= 5; i += 1) {
      const r = await fetch(`${baseUrl}/api/auth/forgot-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Forwarded-For": "203.0.113.20" },
        body: JSON.stringify({ email: `qa_s67_ip_${i}_${runId}@test.local`, recaptchaToken: VALID_CAPTCHA }),
      });
      assert.equal(r.status, 200);
    }
    const ipBlocked = await fetch(`${baseUrl}/api/auth/forgot-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Forwarded-For": "203.0.113.20" },
      body: JSON.stringify({ email: `qa_s67_ip_6_${runId}@test.local`, recaptchaToken: VALID_CAPTCHA }),
    });
    assert.equal(ipBlocked.status, 429);

    // 5 by normalized email variants across different IPs -> ok, 6th -> 429
    resetRateLimitersForTests();
    for (let i = 1; i <= 5; i += 1) {
      const r = await fetch(`${baseUrl}/api/auth/forgot-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Forwarded-For": `203.0.113.${40 + i}` },
        body: JSON.stringify({
          email: i % 2 === 0 ? `  ${missingEmail.toUpperCase()} ` : missingEmail,
          recaptchaToken: VALID_CAPTCHA,
        }),
      });
      assert.equal(r.status, 200);
    }
    const emailBlocked = await fetch(`${baseUrl}/api/auth/forgot-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Forwarded-For": "203.0.113.99" },
      body: JSON.stringify({ email: missingEmail, recaptchaToken: VALID_CAPTCHA }),
    });
    assert.equal(emailBlocked.status, 429);
    resetRateLimitersForTests();
  });

  await t.test("PWD-07 & PWD-06: reset boundaries, weak rejection, single-use & global session revocation", async () => {
    // Keep stuRegCookie active session A before resetting
    const meBefore = await fetch(`${baseUrl}/api/auth/me`, { headers: { Cookie: stuRegCookie } });
    assert.equal(meBefore.status, 200);

    // Invalid/unknown/tampered
    for (const badTok of [
      "",
      "not-a-valid-token",
      `${resetTargetToken.slice(0, -1)}${resetTargetToken.endsWith("a") ? "b" : "a"}`,
    ]) {
      const val = await fetch(`${baseUrl}/api/auth/reset-password/validate?token=${encodeURIComponent(badTok)}`);
      assert.deepEqual(await val.json(), { valid: false, reason: "invalid" });
    }

    // Expired >30m token
    const expiredResetPair = generateToken();
    await prisma.passwordResetToken.create({
      data: {
        userId: stuRegId,
        tokenHash: expiredResetPair.hash,
        expiresAt: new Date(Date.now() - 31 * 60_000),
      },
    });
    const expVal = await fetch(`${baseUrl}/api/auth/reset-password/validate?token=${expiredResetPair.raw}`);
    assert.deepEqual(await expVal.json(), { valid: false, reason: "expired" });
    const expPost = await fetch(`${baseUrl}/api/auth/reset-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: expiredResetPair.raw, password: "QaNewPassword123!" }),
    });
    assert.equal(expPost.status, 400);
    assert.equal((await expPost.json()).reason, "expired");

    // Weak & mismatched password with valid reset token fails 400 WITHOUT burning token
    const weakRes = await fetch(`${baseUrl}/api/auth/reset-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: resetTargetToken, password: "short", confirmPassword: "short" }),
    });
    assert.equal(weakRes.status, 400);

    const mismatchRes = await fetch(`${baseUrl}/api/auth/reset-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: resetTargetToken,
        password: "QaValidPassword1!",
        confirmPassword: "QaDifferentPassword2!",
      }),
    });
    assert.equal(mismatchRes.status, 400);

    // Token still valid before real reset
    const valOk = await fetch(`${baseUrl}/api/auth/reset-password/validate?token=${resetTargetToken}`);
    assert.deepEqual(await valOk.json(), { valid: true });

    // Create sibling unused token to confirm burn-all-unused behavior
    const siblingReset = generateToken();
    await prisma.passwordResetToken.create({
      data: {
        userId: stuRegId,
        tokenHash: siblingReset.hash,
        expiresAt: new Date(Date.now() + 30 * 60_000),
      },
    });

    // Successful reset
    clearStubEmails();
    const newPassword = "QaResetPassword456!";
    const okReset = await fetch(`${baseUrl}/api/auth/reset-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: resetTargetToken,
        password: newPassword,
        confirmPassword: newPassword,
      }),
    });
    assert.equal(okReset.status, 200);
    assert.equal(extractCookie(okReset), "", "Reset must not auto-login");

    await new Promise((r) => setTimeout(r, 35));
    const stubs = getStubEmails();
    assert.equal(stubs.length, 1);
    assert.equal(stubs[0].to, stuRegEmail);
    assert.match(stubs[0].subject, /Your ClassDex password was changed/i);
    assert.equal(stubs[0].link, "http://localhost:5174/login");

    // Prior Session A is now rejected with 401
    const meRevoked = await fetch(`${baseUrl}/api/auth/me`, { headers: { Cookie: stuRegCookie } });
    assert.equal(meRevoked.status, 401);

    // Spent token & sibling return reason: used
    for (const spent of [resetTargetToken, siblingReset.raw]) {
      const valSpent = await fetch(`${baseUrl}/api/auth/reset-password/validate?token=${spent}`);
      assert.deepEqual(await valSpent.json(), { valid: false, reason: "used" });
      const postSpent = await fetch(`${baseUrl}/api/auth/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: spent, password: "AnotherValidPassword1!" }),
      });
      assert.equal(postSpent.status, 400);
      assert.equal((await postSpent.json()).reason, "used");
    }

    // Old password rejected, new password works
    const oldLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: stuRegEmail, password: activeStuRegPassword }),
    });
    assert.equal(oldLogin.status, 401);

    const newLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: stuRegEmail, password: newPassword }),
    });
    assert.equal(newLogin.status, 200);
    activeStuRegPassword = newPassword;
  });

  await t.test("PWD-08: change-password validation, 5/15m wrong-current limit, Session A survival & Session B 401", async () => {
    resetRateLimitersForTests();
    const loginA = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: stuRegEmail, password: activeStuRegPassword }),
    });
    const cookieA = extractCookie(loginA);

    const loginB = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: stuRegEmail, password: activeStuRegPassword }),
    });
    const cookieB = extractCookie(loginB);
    assert.ok(cookieA && cookieB && cookieA !== cookieB);

    const finalPw = "QaFinalPassword789!";
    // Reuse blocked without counting as wrong current
    const sameRes = await fetch(`${baseUrl}/api/auth/change-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookieA },
      body: JSON.stringify({
        currentPassword: activeStuRegPassword,
        newPassword: activeStuRegPassword,
        confirmPassword: activeStuRegPassword,
      }),
    });
    assert.equal(sameRes.status, 400);
    assert.equal((await sameRes.json()).field, "newPassword");

    // 5 wrong attempts -> 400, 6th -> 429
    for (let i = 1; i <= 5; i += 1) {
      const r = await fetch(`${baseUrl}/api/auth/change-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookieA },
        body: JSON.stringify({
          currentPassword: `wrong-${i}`,
          newPassword: finalPw,
          confirmPassword: finalPw,
        }),
      });
      assert.equal(r.status, 400);
    }
    const locked = await fetch(`${baseUrl}/api/auth/change-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookieA },
      body: JSON.stringify({
        currentPassword: "wrong-6",
        newPassword: finalPw,
        confirmPassword: finalPw,
      }),
    });
    assert.equal(locked.status, 429);

    resetRateLimitersForTests();
    clearStubEmails();
    const okChange = await fetch(`${baseUrl}/api/auth/change-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookieA },
      body: JSON.stringify({
        currentPassword: activeStuRegPassword,
        newPassword: finalPw,
        confirmPassword: finalPw,
      }),
    });
    assert.equal(okChange.status, 200);
    const rotatedCookieA = extractCookie(okChange);
    assert.ok(rotatedCookieA && rotatedCookieA !== cookieA);

    await new Promise((r) => setTimeout(r, 35));
    const stubs = getStubEmails();
    assert.equal(stubs.length, 1);
    assert.equal(stubs[0].to, stuRegEmail);
    assert.match(stubs[0].subject, /Your ClassDex password was changed/i);
    assert.equal(stubs[0].link, "http://localhost:5174/login");

    // Device A stays signed in with rotated cookie; Device B gets 401
    const meA = await fetch(`${baseUrl}/api/auth/me`, { headers: { Cookie: rotatedCookieA } });
    assert.equal(meA.status, 200);
    const meB = await fetch(`${baseUrl}/api/auth/me`, { headers: { Cookie: cookieB } });
    assert.equal(meB.status, 401);
  });

  await t.test("PWD-09 & PWD-10: join pending/faculty alerts + approve/decline decision emails & Resend error resilience", async () => {
    const hash = await bcrypt.hash("QaPassword123!", 10);
    const [sid1, sid2] = await Promise.all([allocStudentId(8970000), allocStudentId(8980000)]);

    const facUser = await prisma.user.create({
      data: {
        name: "qa_S67 Join Faculty",
        email: facJoinEmail,
        password: hash,
        role: "FACULTY",
        emailVerified: true,
        emailVerifiedAt: new Date(),
        facultyProfile: {
          create: { name: "qa_S67 Join Faculty", department: "IT", email: facJoinEmail },
        },
      },
    });
    createdUserIds.push(facUser.id);

    const createStu = async (email, name, studentId) =>
      prisma.user.create({
        data: {
          name,
          email,
          password: hash,
          role: "STUDENT",
          emailVerified: true,
          emailVerifiedAt: new Date(),
          studentProfile: {
            create: {
              name,
              studentId,
              email,
              program: "BSIT",
              section: "3A",
              photo: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
            },
          },
        },
        include: { studentProfile: true },
      });

    const [stu1, stu2] = await Promise.all([
      createStu(stuPend1Email, "qa_S67 Pending One", sid1),
      createStu(stuPend2Email, "qa_S67 Pending Two", sid2),
    ]);
    createdUserIds.push(stu1.id, stu2.id);
    createdProfileIds.push(stu1.studentProfile.id, stu2.studentProfile.id);

    const cls = await prisma.class.create({
      data: {
        facultyId: facUser.id,
        sectionName: `qa_S67 Email 3A`,
        courseCode: "IT 128",
        courseTitle: "Software QA",
        classCode: `Q67${runId.slice(-5)}`.toUpperCase(),
      },
    });
    createdClassIds.push(cls.id);

    const loginJson = async (email) =>
      extractCookie(
        await fetch(`${baseUrl}/api/auth/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password: "QaPassword123!" }),
        }),
      );
    const [facCookie, s1Cookie, s2Cookie] = await Promise.all([
      loginJson(facJoinEmail),
      loginJson(stuPend1Email),
      loginJson(stuPend2Email),
    ]);

    // PWD-09: Student 1 joins -> PENDING (empty roster) -> captures 2 emails
    clearStubEmails();
    const join1 = await fetch(`${baseUrl}/api/classes/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: s1Cookie },
      body: JSON.stringify({ classCode: cls.classCode, recaptchaToken: VALID_CAPTCHA }),
    });
    assert.equal(join1.status, 201);
    const join1Body = await join1.json();
    assert.equal(join1Body.status, "PENDING");

    await new Promise((r) => setTimeout(r, 40));
    let stubs = getStubEmails();
    assert.equal(stubs.length, 2);
    const stuNotice = stubs.find((m) => m.to === stuPend1Email);
    const facNotice = stubs.find((m) => m.to === facJoinEmail);
    assert.ok(stuNotice && facNotice);
    assert.match(stuNotice.subject, /pending/i);
    assert.equal(stuNotice.link, "http://localhost:5174/student");
    assert.match(facNotice.subject, /requested to join/i);
    assert.equal(facNotice.link, `http://localhost:5174/faculty/classes/${encodeURIComponent(cls.id)}`);

    // Student 2 joins -> PENDING as well
    const join2 = await fetch(`${baseUrl}/api/classes/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: s2Cookie },
      body: JSON.stringify({ classCode: cls.classCode, recaptchaToken: VALID_CAPTCHA }),
    });
    assert.equal(join2.status, 201);
    const join2Body = await join2.json();

    // PWD-10: Approve Student 1 & Decline Student 2 -> captures decision emails
    clearStubEmails();
    const approveRes = await fetch(`${baseUrl}/api/classes/${cls.id}/pending/${join1Body.enrollment.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: facCookie },
      body: JSON.stringify({ status: "APPROVED" }),
    });
    assert.equal(approveRes.status, 200);

    const declineRes = await fetch(`${baseUrl}/api/classes/${cls.id}/pending/${join2Body.enrollment.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: facCookie },
      body: JSON.stringify({ status: "DECLINED" }),
    });
    assert.equal(declineRes.status, 200);

    await new Promise((r) => setTimeout(r, 40));
    stubs = getStubEmails();
    assert.equal(stubs.length, 2);
    const appMail = stubs.find((m) => m.to === stuPend1Email);
    const decMail = stubs.find((m) => m.to === stuPend2Email);
    assert.ok(appMail && /approved/i.test(appMail.subject) && appMail.link === "http://localhost:5174/student");
    assert.ok(decMail && /declined/i.test(decMail.subject) && decMail.link === "http://localhost:5174/student");

    // Simulated Resend 403 error on PATCH never fails HTTP 200
    const prevMode = process.env.EMAIL_MODE;
    const prevKey = process.env.RESEND_API_KEY;
    const prevFrom = process.env.EMAIL_FROM;
    try {
      process.env.EMAIL_MODE = "resend";
      process.env.RESEND_API_KEY = "re_dummy_s67";
      process.env.EMAIL_FROM = "ClassDex <no-reply@classdex.me>";
      setResendClientForTests({
        emails: {
          send: async () => ({
            data: null,
            error: { statusCode: 403, name: "validation_error", message: "Sandbox restriction" },
          }),
        },
      });
      await prisma.classEnrollment.update({
        where: { id: join2Body.enrollment.id },
        data: { status: "PENDING" },
      });
      const resilientRes = await fetch(`${baseUrl}/api/classes/${cls.id}/pending/${join2Body.enrollment.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Cookie: facCookie },
        body: JSON.stringify({ status: "APPROVED" }),
      });
      assert.equal(resilientRes.status, 200);
      await new Promise((r) => setTimeout(r, 30));
    } finally {
      resetMailTransportForTests();
      if (prevMode === undefined) delete process.env.EMAIL_MODE;
      else process.env.EMAIL_MODE = prevMode;
      if (prevKey === undefined) delete process.env.RESEND_API_KEY;
      else process.env.RESEND_API_KEY = prevKey;
      if (prevFrom === undefined) delete process.env.EMAIL_FROM;
      else process.env.EMAIL_FROM = prevFrom;
    }
  });
});
