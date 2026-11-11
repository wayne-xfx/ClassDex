require("dotenv").config();
const test = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcryptjs");
const { app, resetRateLimitersForTests } = require("../index");
const { prisma } = require("../db");
const {
  setRecaptchaVerifierForTests,
  resetRecaptchaVerifierForTests,
} = require("../recaptcha");
const {
  getClientUrl,
  getEmailFrom,
  resolveEmailMode,
  validateMailerConfig,
  sendMail,
  setMailTransportForTests,
  resetMailTransportForTests,
  setResendClientForTests,
  getStubEmails,
  clearStubEmails,
} = require("../src/services/mailer");

function extractSessionCookie(response) {
  const setCookie = response.headers.get("set-cookie") || "";
  const match = setCookie.match(/classdex\.sid=[^;]+/);
  return match ? match[0] : "";
}

test("Mailer unit: getClientUrl precedence, validateMailerConfig fail-fast in resend mode, log fallback without key, and Resend SDK status classification (200/403/422/429)", async () => {
  const savedEnv = {
    APP_BASE_URL: process.env.APP_BASE_URL,
    FRONTEND_URL: process.env.FRONTEND_URL,
    CLIENT_URL: process.env.CLIENT_URL,
    FRONTEND_ORIGIN: process.env.FRONTEND_ORIGIN,
    EMAIL_MODE: process.env.EMAIL_MODE,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    EMAIL_FROM: process.env.EMAIL_FROM,
  };

  try {
    resetMailTransportForTests();
    clearStubEmails();

    // 1. getClientUrl precedence: APP_BASE_URL || FRONTEND_URL || CLIENT_URL || FRONTEND_ORIGIN || default
    process.env.APP_BASE_URL = "https://classdex.me///";
    process.env.FRONTEND_URL = "https://frontend.example.com/";
    process.env.CLIENT_URL = "https://client.example.com/";
    process.env.FRONTEND_ORIGIN = "https://origin.example.com/";
    assert.equal(getClientUrl(), "https://classdex.me");

    delete process.env.APP_BASE_URL;
    assert.equal(getClientUrl(), "https://frontend.example.com");

    delete process.env.FRONTEND_URL;
    assert.equal(getClientUrl(), "https://client.example.com");

    delete process.env.CLIENT_URL;
    assert.equal(getClientUrl(), "https://origin.example.com");

    delete process.env.FRONTEND_ORIGIN;
    assert.equal(getClientUrl(), "http://localhost:5173");

    // 2. Test runner default mode is stub even if RESEND_API_KEY is present
    process.env.EMAIL_MODE = "";
    process.env.RESEND_API_KEY = "re_dummy_test_key";
    process.env.EMAIL_FROM = "ClassDex <no-reply@classdex.me>";
    assert.equal(resolveEmailMode(), "stub");

    // 3. Explicit EMAIL_MODE=resend validation fails fast when key or verified sender is missing
    process.env.EMAIL_MODE = "resend";
    delete process.env.RESEND_API_KEY;
    assert.throws(
      () => validateMailerConfig(),
      /EMAIL_MODE=resend requires RESEND_API_KEY/i,
    );

    process.env.RESEND_API_KEY = "re_dummy_test_key";
    process.env.EMAIL_FROM = "ClassDex <no-reply@classdex.local>";
    assert.throws(
      () => validateMailerConfig(),
      /EMAIL_MODE=resend requires a valid verified EMAIL_FROM/i,
    );

    process.env.EMAIL_FROM = "ClassDex <no-reply@classdex.me>";
    assert.deepEqual(validateMailerConfig(), {
      mode: "resend",
      from: "ClassDex <no-reply@classdex.me>",
    });

    // 4. Unset EMAIL_MODE outside test runner falls back to log mode when key is missing
    process.env.EMAIL_MODE = "";
    delete process.env.RESEND_API_KEY;
    delete process.env.EMAIL_FROM;
    assert.equal(getEmailFrom(), "ClassDex <no-reply@classdex.local>");
    assert.equal(resolveEmailMode({ ignoreTestRunner: true }), "log");

    // 5. Explicit log mode works with no RESEND_API_KEY set
    process.env.EMAIL_MODE = "log";
    const logRes = await sendMail({
      to: "logcheck@classdex.me",
      subject: "Log mode check",
      html: '<p><a href="https://classdex.me/login">Sign in</a></p>',
      text: "Sign in: https://classdex.me/login",
    });
    assert.equal(logRes.ok, true);
    assert.equal(logRes.transport, "log");
    assert.equal(logRes.link, "https://classdex.me/login");

    // 6. Resend transport handles { data, error } SDK contract (success, 403, 422, 429, missing id)
    process.env.EMAIL_MODE = "resend";
    process.env.RESEND_API_KEY = "re_dummy_test_key";
    process.env.EMAIL_FROM = "ClassDex <no-reply@classdex.me>";

    let nextSdkResponse = { data: { id: "re_msg_ok_001" }, error: null };
    setResendClientForTests({
      emails: {
        send: async () => nextSdkResponse,
      },
    });

    const okResend = await sendMail({
      to: "verified@classdex.me",
      subject: "Resend success check",
      html: "<p>Test</p>",
      text: "Test",
    });
    assert.deepEqual(okResend, {
      ok: true,
      transport: "resend",
      id: "re_msg_ok_001",
    });

    nextSdkResponse = {
      data: null,
      error: {
        statusCode: 403,
        name: "validation_error",
        message: "You can only send testing emails to your own email address.",
      },
    };
    const err403 = await sendMail({
      to: "other@classdex.me",
      subject: "Resend 403 check",
      html: "<p>Test</p>",
      text: "Test",
    });
    assert.equal(err403.ok, false);
    assert.equal(err403.transport, "resend");
    assert.equal(err403.statusCode, 403);

    nextSdkResponse = {
      data: null,
      error: {
        statusCode: 422,
        name: "unprocessable_entity",
        message: "Invalid `to` field.",
      },
    };
    const err422 = await sendMail({
      to: "bad@classdex.me",
      subject: "Resend 422 check",
      html: "<p>Test</p>",
      text: "Test",
    });
    assert.equal(err422.ok, false);
    assert.equal(err422.statusCode, 422);

    nextSdkResponse = {
      data: null,
      error: {
        statusCode: 429,
        name: "rate_limit_exceeded",
        message: "Too many requests.",
      },
    };
    const err429 = await sendMail({
      to: "rate@classdex.me",
      subject: "Resend 429 check",
      html: "<p>Test</p>",
      text: "Test",
    });
    assert.equal(err429.ok, false);
    assert.equal(err429.statusCode, 429);

    nextSdkResponse = { data: { id: "" }, error: null };
    const missingId = await sendMail({
      to: "noid@classdex.me",
      subject: "Resend missing id check",
      html: "<p>Test</p>",
      text: "Test",
    });
    assert.equal(missingId.ok, false);
    assert.equal(missingId.statusCode, 502);
  } finally {
    resetMailTransportForTests();
    clearStubEmails();
    for (const [key, val] of Object.entries(savedEnv)) {
      if (val === undefined) delete process.env[key];
      else process.env[key] = val;
    }
    if (process.execArgv.includes("--test") || process.env.NODE_ENV === "test") {
      process.env.EMAIL_MODE = "";
    }
  }
});

test("Integration: stub mode captures all 6 email types across all triggers with APP_BASE_URL links, and simulated 403/429/thrown errors never break HTTP endpoints", async (t) => {
  resetRateLimitersForTests();
  resetMailTransportForTests();
  clearStubEmails();
  setRecaptchaVerifierForTests(async () => ({ success: true }));

  const prevAppBaseUrl = process.env.APP_BASE_URL;
  process.env.APP_BASE_URL = "https://app.classdex.me";

  const server = app.listen(0);
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;
  const runId = Date.now().toString(36) + Math.random().toString(36).slice(2, 5);

  const facultyEmail = `resend.faculty.${runId}@test.local`;
  const student1Email = `resend.student1.${runId}@test.local`;
  const student2Email = `resend.student2.${runId}@test.local`;
  const createdUserIds = [];
  const createdClassIds = [];
  const createdProfileIds = [];

  // Allocate two unused 7-digit student IDs
  const allocatedStudentIds = [];
  for (let candidateNum = 8900001; allocatedStudentIds.length < 2 && candidateNum < 8999999; candidateNum += 1) {
    const candidate = String(candidateNum + Math.floor(Math.random() * 9000));
    if (allocatedStudentIds.includes(candidate)) continue;
    const [existingProf, existingRos] = await Promise.all([
      prisma.studentProfile.findUnique({ where: { studentId: candidate }, select: { id: true } }),
      prisma.classRoster.findFirst({ where: { studentId: candidate }, select: { id: true } }),
    ]);
    if (!existingProf && !existingRos) {
      allocatedStudentIds.push(candidate);
    }
  }
  const [student1IdNum, student2IdNum] = allocatedStudentIds;

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

  // 1. Register Faculty -> captures Account Verification email in stub mode with APP_BASE_URL
  const regFacRes = await fetch(`${baseUrl}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Prof. Resend",
      email: facultyEmail,
      password: "password123",
      confirmPassword: "password123",
      role: "FACULTY",
      recaptchaToken: "ok",
    }),
  });
  assert.equal(regFacRes.status, 201);
  const regFacBody = await regFacRes.json();
  createdUserIds.push(regFacBody.user.id);
  const facultyCookie = extractSessionCookie(regFacRes);

  let stubs = getStubEmails();
  assert.equal(stubs.length, 1);
  assert.equal(stubs[0].to, facultyEmail);
  assert.match(stubs[0].subject, /Verify your ClassDex email address/i);
  assert.match(stubs[0].link, /^https:\/\/app\.classdex\.me\/verify-email\?token=[a-f0-9]{64}$/);
  assert.match(stubs[0].html, /ClassDex/);

  // 2. Resend verification -> captures 2nd verification email
  const resendVerRes = await fetch(`${baseUrl}/api/auth/resend-verification`, {
    method: "POST",
    headers: { Cookie: facultyCookie },
  });
  assert.equal(resendVerRes.status, 200);
  stubs = getStubEmails();
  assert.equal(stubs.length, 2);
  assert.match(stubs[1].link, /^https:\/\/app\.classdex\.me\/verify-email\?token=[a-f0-9]{64}$/);

  // 3. Forgot password -> captures Reset Password email with APP_BASE_URL
  const forgotRes = await fetch(`${baseUrl}/api/auth/forgot-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Forwarded-For": "198.51.100.77" },
    body: JSON.stringify({ email: facultyEmail, recaptchaToken: "ok" }),
  });
  assert.equal(forgotRes.status, 200);
  await new Promise((resolve) => setTimeout(resolve, 30));
  stubs = getStubEmails();
  assert.equal(stubs.length, 3);
  assert.match(stubs[2].subject, /Reset your ClassDex password/i);
  assert.match(stubs[2].link, /^https:\/\/app\.classdex\.me\/reset-password\?token=[a-f0-9]{64}$/);
  const resetRawToken = stubs[2].link.split("token=")[1];

  // 4. Reset password -> captures Password Changed email with APP_BASE_URL/login
  const resetPwRes = await fetch(`${baseUrl}/api/auth/reset-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      token: resetRawToken,
      password: "newPassword123",
      confirmPassword: "newPassword123",
    }),
  });
  assert.equal(resetPwRes.status, 200);
  await new Promise((resolve) => setTimeout(resolve, 30));
  stubs = getStubEmails();
  assert.equal(stubs.length, 4);
  assert.match(stubs[3].subject, /Your ClassDex password was changed/i);
  assert.equal(stubs[3].link, "https://app.classdex.me/login");

  // Re-login faculty & test change-password -> captures Password Changed email
  const loginFacRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: facultyEmail, password: "newPassword123" }),
  });
  assert.equal(loginFacRes.status, 200);
  const freshFacCookie = extractSessionCookie(loginFacRes);

  const changePwRes = await fetch(`${baseUrl}/api/auth/change-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: freshFacCookie },
    body: JSON.stringify({
      currentPassword: "newPassword123",
      newPassword: "finalPassword123",
      confirmPassword: "finalPassword123",
    }),
  });
  assert.equal(changePwRes.status, 200);
  const activeFacCookie = extractSessionCookie(changePwRes);
  await new Promise((resolve) => setTimeout(resolve, 30));
  stubs = getStubEmails();
  assert.equal(stubs.length, 5);
  assert.match(stubs[4].subject, /Your ClassDex password was changed/i);
  assert.equal(stubs[4].link, "https://app.classdex.me/login");

  // Create class + Student 1 + Student 2 to test join (pending & enrolled), faculty join notice, approve, decline, and roster bulk auto-approve
  const testClass = await prisma.class.create({
    data: {
      courseCode: "IT 122",
      courseTitle: "System Analysis and Design",
      sectionName: "BSIT 3A",
      classCode: `RS-${runId.slice(-5).toUpperCase()}`,
      facultyId: regFacBody.user.id,
       roster: {
        create: [
          {
            studentId: student2IdNum,
            studentName: "Auto Enrolled Student",
            firstName: "Auto",
            middleName: "Enrolled",
            lastName: "Student",
            sortKey: "student",
          },
        ],
      },
    },
  });
  createdClassIds.push(testClass.id);

  const hashedPassword = await bcrypt.hash("password123", 10);
  const student1 = await prisma.user.create({
    data: {
      name: "Pending Student",
      email: student1Email,
      password: hashedPassword,
      role: "STUDENT",
      emailVerified: true,
      studentProfile: {
        create: {
          name: "Pending Student",
          studentId: student1IdNum,
          email: student1Email,
          photo: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
        },
      },
    },
    include: { studentProfile: true },
  });
  createdUserIds.push(student1.id);
  createdProfileIds.push(student1.studentProfile.id);

  const student2 = await prisma.user.create({
    data: {
      name: "Auto Enrolled Student",
      email: student2Email,
      password: hashedPassword,
      role: "STUDENT",
      emailVerified: true,
      studentProfile: {
        create: {
          name: "Auto Enrolled Student",
          studentId: student2IdNum,
          email: student2Email,
          photo: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
        },
      },
    },
    include: { studentProfile: true },
  });
  createdUserIds.push(student2.id);
  createdProfileIds.push(student2.studentProfile.id);

  const loginStu1 = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: student1Email, password: "password123" }),
  });
  const stu1Cookie = extractSessionCookie(loginStu1);

  const loginStu2 = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: student2Email, password: "password123" }),
  });
  const stu2Cookie = extractSessionCookie(loginStu2);

  // 5. Student 1 joins (PENDING) -> captures Student Join Pending email + Faculty Join Request email
  clearStubEmails();
  const joinPendingRes = await fetch(`${baseUrl}/api/classes/join`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: stu1Cookie },
    body: JSON.stringify({ classCode: testClass.classCode, recaptchaToken: "ok" }),
  });
  assert.equal(joinPendingRes.status, 201);
  const joinPendingBody = await joinPendingRes.json();
  assert.equal(joinPendingBody.status, "PENDING");
  await new Promise((resolve) => setTimeout(resolve, 40));

  stubs = getStubEmails();
  assert.equal(stubs.length, 2);
  const stuJoinPendingMail = stubs.find((m) => m.to === student1Email);
  const facJoinPendingMail = stubs.find((m) => m.to === facultyEmail);
  assert.ok(stuJoinPendingMail, "Expected student join pending email");
  assert.match(stuJoinPendingMail.subject, /request to join .* is pending/i);
  assert.equal(stuJoinPendingMail.link, "https://app.classdex.me/student");
  assert.ok(facJoinPendingMail, "Expected faculty join request email");
  assert.match(facJoinPendingMail.subject, /requested to join/i);
  assert.equal(
    facJoinPendingMail.link,
    `https://app.classdex.me/faculty/classes/${encodeURIComponent(testClass.id)}`,
  );

  // 6. Student 2 joins (matches roster -> immediate APPROVED) -> captures Student Joined email + Faculty Joined email
  clearStubEmails();
  const joinApprovedRes = await fetch(`${baseUrl}/api/classes/join`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: stu2Cookie },
    body: JSON.stringify({ classCode: testClass.classCode, recaptchaToken: "ok" }),
  });
  assert.equal(joinApprovedRes.status, 201);
  assert.equal((await joinApprovedRes.json()).status, "APPROVED");
  await new Promise((resolve) => setTimeout(resolve, 40));

  stubs = getStubEmails();
  assert.equal(stubs.length, 2);
  const stuJoinedMail = stubs.find((m) => m.to === student2Email);
  const facJoinedMail = stubs.find((m) => m.to === facultyEmail);
  assert.ok(stuJoinedMail);
  assert.match(stuJoinedMail.subject, /You joined/i);
  assert.equal(stuJoinedMail.link, "https://app.classdex.me/student");
  assert.ok(facJoinedMail);
  assert.match(facJoinedMail.subject, /joined/i);
  assert.equal(
    facJoinedMail.link,
    `https://app.classdex.me/faculty/classes/${encodeURIComponent(testClass.id)}`,
  );

  // 7. Faculty declines Student 1 -> captures Join Declined decision email
  clearStubEmails();
  const declineRes = await fetch(
    `${baseUrl}/api/classes/${testClass.id}/pending/${joinPendingBody.enrollment.id}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: activeFacCookie },
      body: JSON.stringify({ status: "DECLINED" }),
    },
  );
  assert.equal(declineRes.status, 200);
  await new Promise((resolve) => setTimeout(resolve, 40));

  stubs = getStubEmails();
  assert.equal(stubs.length, 1);
  assert.equal(stubs[0].to, student1Email);
  assert.match(stubs[0].subject, /declined/i);
  assert.equal(stubs[0].link, "https://app.classdex.me/student");

  // 8. Reset Student 1 to PENDING and Faculty approves -> captures Join Approved decision email
  await prisma.classEnrollment.update({
    where: { id: joinPendingBody.enrollment.id },
    data: { status: "PENDING" },
  });
  clearStubEmails();
  const approveRes = await fetch(
    `${baseUrl}/api/classes/${testClass.id}/pending/${joinPendingBody.enrollment.id}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: activeFacCookie },
      body: JSON.stringify({ status: "APPROVED" }),
    },
  );
  assert.equal(approveRes.status, 200);
  await new Promise((resolve) => setTimeout(resolve, 40));

  stubs = getStubEmails();
  assert.equal(stubs.length, 1);
  assert.equal(stubs[0].to, student1Email);
  assert.match(stubs[0].subject, /approved/i);
  assert.equal(stubs[0].link, "https://app.classdex.me/student");

  // 8b. Roster auto-approval on re-join (joinResult.kind === "autoApproved") & bulk roster save auto-approval
  await prisma.classEnrollment.update({
    where: { id: joinPendingBody.enrollment.id },
    data: { status: "PENDING" },
  });
  clearStubEmails();
  const autoApproveRejoinRes = await fetch(`${baseUrl}/api/classes/join`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: stu1Cookie },
    body: JSON.stringify({ classCode: testClass.classCode, recaptchaToken: "ok" }),
  });
  assert.equal(autoApproveRejoinRes.status, 201);
  const autoApproveRejoinBody = await autoApproveRejoinRes.json();
  assert.equal(autoApproveRejoinBody.kind, "autoApproved");
  await new Promise((resolve) => setTimeout(resolve, 40));

  stubs = getStubEmails();
  assert.equal(stubs.length, 1);
  assert.equal(stubs[0].to, student1Email);
  assert.match(stubs[0].subject, /approved/i);
  assert.equal(stubs[0].link, "https://app.classdex.me/student");

  // Reset Student 1 to PENDING and trigger bulk autoApproveRosterMatches via POST /api/classes/:id/roster
  await prisma.classEnrollment.update({
    where: { id: joinPendingBody.enrollment.id },
    data: { status: "PENDING" },
  });
  clearStubEmails();
  const rosterBulkRes = await fetch(`${baseUrl}/api/classes/${testClass.id}/roster`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: activeFacCookie },
    body: JSON.stringify({
      entries: [
        { studentName: "Pending Student", studentId: student1IdNum },
        { studentName: "Auto Enrolled Student", studentId: student2IdNum },
      ],
    }),
  });
  assert.equal(rosterBulkRes.status, 201);
  await new Promise((resolve) => setTimeout(resolve, 40));

  stubs = getStubEmails();
  assert.equal(stubs.length, 1);
  assert.equal(stubs[0].to, student1Email);
  assert.match(stubs[0].subject, /approved/i);
  assert.equal(stubs[0].link, "https://app.classdex.me/student");

  // 9. Simulated Resend provider failure (403/429/thrown) never fails forgot-password or class approval HTTP requests
  resetRateLimitersForTests();
  process.env.EMAIL_MODE = "resend";
  process.env.RESEND_API_KEY = "re_dummy_test_key";
  process.env.EMAIL_FROM = "ClassDex <no-reply@classdex.me>";
  setResendClientForTests({
    emails: {
      send: async () => ({
        data: null,
        error: { statusCode: 429, name: "rate_limit_exceeded", message: "Quota exceeded" },
      }),
    },
  });

  const forgotUnder429 = await fetch(`${baseUrl}/api/auth/forgot-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Forwarded-For": "198.51.100.88" },
    body: JSON.stringify({ email: facultyEmail, recaptchaToken: "ok" }),
  });
  assert.equal(forgotUnder429.status, 200);

  await prisma.classEnrollment.update({
    where: { id: joinPendingBody.enrollment.id },
    data: { status: "PENDING" },
  });
  const approveUnder429 = await fetch(
    `${baseUrl}/api/classes/${testClass.id}/pending/${joinPendingBody.enrollment.id}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: activeFacCookie },
      body: JSON.stringify({ status: "APPROVED" }),
    },
  );
  assert.equal(approveUnder429.status, 200);
  await new Promise((resolve) => setTimeout(resolve, 40));
});
