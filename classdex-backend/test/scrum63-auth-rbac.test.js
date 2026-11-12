const fs = require("node:fs");
const path = require("node:path");
const dotenv = require("dotenv");

(function ensureSafeTestEnv() {
  const backendDir = path.resolve(__dirname, "..");
  const testEnvPath = path.join(backendDir, ".env.test");
  const prodEnvPath = path.join(backendDir, ".env");
  if (fs.existsSync(testEnvPath)) {
    const testEnv = dotenv.parse(fs.readFileSync(testEnvPath, "utf8"));
    const testHost = new URL(testEnv.DATABASE_URL).hostname;
    if (fs.existsSync(prodEnvPath)) {
      const prodEnv = dotenv.parse(fs.readFileSync(prodEnvPath, "utf8"));
      if (prodEnv.DATABASE_URL && new URL(prodEnv.DATABASE_URL).hostname === testHost) {
        throw new Error(`Refusing to run against production host ${testHost}`);
      }
    }
    for (const [k, v] of Object.entries(testEnv)) {
      process.env[k] = v;
    }
  }
  process.env.EMAIL_MODE = "stub";
  process.env.NODE_ENV = "test";
})();

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
  resetMailTransportForTests,
  getStubEmails,
  clearStubEmails,
} = require("../src/services/mailer");

const SAMPLE_PHOTO =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

function extractSessionCookie(res) {
  const raw = res.headers.get("set-cookie") || "";
  const match = raw.match(/classdex\.sid=[^;]+/);
  return match ? match[0] : "";
}

function hasKeyRecursive(value, targetKey) {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some((item) => hasKeyRecursive(item, targetKey));
  for (const [k, v] of Object.entries(value)) {
    if (k === targetKey) return true;
    if (hasKeyRecursive(v, targetKey)) return true;
  }
  return false;
}

async function loginCookie(baseUrl, email, password) {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  return { res, cookie: extractSessionCookie(res) };
}

test("SCRUM-63 AUTH-01..07, AUTH-10..12, AUTH-15..16: Auth, Verification, Password Security, RBAC, Ownership & Photo Access", async (t) => {
  resetRateLimitersForTests();
  resetMailTransportForTests();
  clearStubEmails();

  let allowCaptcha = true;
  setRecaptchaVerifierForTests(async (token) => {
    if (!allowCaptcha || !token || token === "bad-captcha") {
      return { success: false, message: "Captcha verification failed." };
    }
    return { success: true };
  });

  const server = app.listen(0);
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;
  const runId = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

  const createdUserEmails = [];
  const createdClassCodes = [];

  t.after(async () => {
    resetRecaptchaVerifierForTests();
    resetMailTransportForTests();
    clearStubEmails();
    resetRateLimitersForTests();
    await new Promise((resolve) => server.close(resolve));
    if (createdClassCodes.length) {
      await prisma.class.deleteMany({ where: { classCode: { in: createdClassCodes } } });
    }
    if (createdUserEmails.length) {
      await prisma.user.deleteMany({ where: { email: { in: createdUserEmails } } });
    }
    await prisma.$disconnect();
  });

  const facAEmail = `qa_auth_faca_${runId}@test.local`;
  const facBEmail = `qa_auth_facb_${runId}@test.local`;
  const stu1Email = `qa_auth_stu1_${runId}@test.local`;
  const stu2Email = `qa_auth_stu2_${runId}@test.local`;
  const password = "QaPassword123!";
  createdUserEmails.push(facAEmail, facBEmail, stu1Email, stu2Email);

  // AUTH-05: Missing or failing reCAPTCHA rejects registration BEFORE user creation
  await t.test("AUTH-05: registration requires valid reCAPTCHA before creating user", async () => {
    const resEmpty = await fetch(`${baseUrl}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "qa_No Captcha",
        email: facAEmail,
        password,
        confirmPassword: password,
        role: "FACULTY",
        recaptchaToken: "",
      }),
    });
    assert.equal(resEmpty.status, 400);

    allowCaptcha = false;
    const resFail = await fetch(`${baseUrl}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "qa_Fail Captcha",
        email: facAEmail,
        password,
        confirmPassword: password,
        role: "FACULTY",
        recaptchaToken: "bad-captcha",
      }),
    });
    assert.equal(resFail.status, 400);
    allowCaptcha = true;

    const dbUser = await prisma.user.findUnique({ where: { email: facAEmail } });
    assert.equal(dbUser, null);
  });

  // AUTH-04: Input validation (invalid emails, blank name, short password, mismatched confirm, bad role)
  await t.test("AUTH-04: registration input validation rejects malformed emails, short/mismatched passwords, invalid role", async () => {
    const cases = [
      { name: "   ", email: facAEmail, password, confirmPassword: password, role: "FACULTY" },
      { name: "qa_Bad", email: "not-an-email", password, confirmPassword: password, role: "FACULTY" },
      { name: "qa_Bad", email: "missing-domain@", password, confirmPassword: password, role: "FACULTY" },
      { name: "qa_Bad", email: facAEmail, password: "short7", confirmPassword: "short7", role: "FACULTY" },
      { name: "qa_Bad", email: facAEmail, password, confirmPassword: "DifferentPassword!", role: "FACULTY" },
      { name: "qa_Bad", email: facAEmail, password, confirmPassword: password, role: "ADMIN" },
    ];
    for (const payload of cases) {
      const res = await fetch(`${baseUrl}/api/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, recaptchaToken: "ok" }),
      });
      assert.equal(res.status, 400, `Expected 400 for payload ${JSON.stringify(payload)}`);
    }
    assert.equal(await prisma.user.findUnique({ where: { email: facAEmail } }), null);
  });

  let facACookie = "";
  let stu1Cookie = "";
  let stu1RawVerifyToken = "";

  // AUTH-01: Valid faculty registration
  await t.test("AUTH-01: valid faculty registration returns 201, unverified status, bcrypt DB hash, no password field", async () => {
    clearStubEmails();
    const res = await fetch(`${baseUrl}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "qa_Prof Alpha",
        email: facAEmail,
        password,
        confirmPassword: password,
        role: "FACULTY",
        recaptchaToken: "ok",
      }),
    });
    assert.equal(res.status, 201);
    const setCookie = res.headers.get("set-cookie") || "";
    assert.match(setCookie, /classdex\.sid=.*HttpOnly/i);
    facACookie = extractSessionCookie(res);

    const body = await res.json();
    assert.equal(body.user.role, "FACULTY");
    assert.equal(body.user.emailVerified, false);
    assert.equal(hasKeyRecursive(body, "password"), false);

    const dbUser = await prisma.user.findUnique({
      where: { email: facAEmail },
      include: { emailVerificationTokens: true },
    });
    assert.ok(dbUser);
    assert.match(dbUser.password, /^\$2[aby]\$/);
    assert.equal(await bcrypt.compare(password, dbUser.password), true);
    assert.equal(dbUser.emailVerificationTokens.length, 1);
    const ttlDiff = dbUser.emailVerificationTokens[0].expiresAt.getTime() - dbUser.emailVerificationTokens[0].createdAt.getTime();
    assert.ok(Math.abs(ttlDiff - 24 * 60 * 60 * 1000) < 5000);
  });

  // AUTH-02: Valid student registration + stub verification email
  await t.test("AUTH-02: valid student registration creates STUDENT user and captures verification link in stub mailer", async () => {
    clearStubEmails();
    const res = await fetch(`${baseUrl}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "qa_Student One",
        email: stu1Email,
        password,
        confirmPassword: password,
        role: "STUDENT",
        recaptchaToken: "ok",
      }),
    });
    assert.equal(res.status, 201);
    stu1Cookie = extractSessionCookie(res);
    const body = await res.json();
    assert.equal(body.user.role, "STUDENT");
    assert.equal(hasKeyRecursive(body, "password"), false);

    const emails = getStubEmails();
    assert.equal(emails.length, 1);
    assert.equal(emails[0].to, stu1Email);
    const tokenMatch = emails[0].link?.match(/\/verify-email\?token=([0-9a-f]+)/i);
    assert.ok(tokenMatch, `Expected verify link in stub email, got ${emails[0].link}`);
    stu1RawVerifyToken = tokenMatch[1];
  });

  // AUTH-03: Duplicate email (case/whitespace normalized) returns 409 without overwriting account
  await t.test("AUTH-03: duplicate registration (uppercase + whitespace) returns 409 without modifying existing account", async () => {
    const beforeUser = await prisma.user.findUnique({ where: { email: facAEmail } });
    const res = await fetch(`${baseUrl}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "qa_Hijacker",
        email: `  ${facAEmail.toUpperCase()}  `,
        password: "OtherPassword999!",
        confirmPassword: "OtherPassword999!",
        role: "STUDENT",
        recaptchaToken: "ok",
      }),
    });
    assert.equal(res.status, 409);
    const afterUser = await prisma.user.findUnique({ where: { email: facAEmail } });
    assert.equal(afterUser.password, beforeUser.password);
    assert.equal(afterUser.role, "FACULTY");
    assert.equal(afterUser.name, beforeUser.name);
  });

  // AUTH-06: Verification token marks emailVerified=true and burns token
  await t.test("AUTH-06: verify-email marks user verified and burns single-use token", async () => {
    const verifyRes = await fetch(`${baseUrl}/api/auth/verify-email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: stu1RawVerifyToken }),
    });
    assert.equal(verifyRes.status, 200);
    const verifyBody = await verifyRes.json();
    assert.equal(verifyBody.verified, true);

    const meRes = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Cookie: stu1Cookie },
    });
    assert.equal((await meRes.json()).user.emailVerified, true);

    const reuseRes = await fetch(`${baseUrl}/api/auth/verify-email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: stu1RawVerifyToken }),
    });
    assert.equal(reuseRes.status, 400);
    assert.equal((await reuseRes.json()).reason, "used");
  });

  // AUTH-07: Login valid vs wrong password vs unknown email (anti-enumeration)
  await t.test("AUTH-07: login returns HttpOnly session cookie on valid credentials and generic 401 on wrong/unknown", async () => {
    const okLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: ` ${facAEmail.toUpperCase()} `, password }),
    });
    assert.equal(okLogin.status, 200);
    assert.match(okLogin.headers.get("set-cookie") || "", /classdex\.sid=.*HttpOnly/i);
    assert.equal(hasKeyRecursive(await okLogin.json(), "password"), false);

    const wrongPass = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: facAEmail, password: "WrongPassword!" }),
    });
    const unknownEmail = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: `qa_nonexistent_${runId}@test.local`, password }),
    });
    assert.equal(wrongPass.status, 401);
    assert.equal(unknownEmail.status, 401);
    const wrongJson = await wrongPass.json();
    const unknownJson = await unknownEmail.json();
    assert.equal(wrongJson.message, unknownJson.message);
  });

  // Provision Faculty B, Student 2, Profiles, Class C1 (Faculty A) & Class C2 (Faculty B)
  const facBHash = await bcrypt.hash(password, 10);
  const facBUser = await prisma.user.create({
    data: {
      name: "qa_Prof Beta",
      email: facBEmail,
      password: facBHash,
      role: "FACULTY",
      emailVerified: true,
    },
  });
  const stu2User = await prisma.user.create({
    data: {
      name: "qa_Student Two",
      email: stu2Email,
      password: facBHash,
      role: "STUDENT",
      emailVerified: true,
    },
  });

  const { cookie: facBCookie } = await loginCookie(baseUrl, facBEmail, password);
  const { cookie: stu2Cookie } = await loginCookie(baseUrl, stu2Email, password);

  // Create Student 1 profile + Student 2 profile
  const s1IdNum = String(8200000 + Math.floor(Math.random() * 40000));
  const s2IdNum = String(8300000 + Math.floor(Math.random() * 40000));
  const putStu1 = await fetch(`${baseUrl}/api/student/profile`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Cookie: stu1Cookie },
    body: JSON.stringify({
      name: "qa_Student One",
      studentId: s1IdNum,
      email: stu1Email,
      program: "BSIT",
      section: "3A",
      photo: SAMPLE_PHOTO,
    }),
  });
  assert.equal(putStu1.status, 200);
  const stu1ProfileId = (await putStu1.json()).profile.id;

  const putStu2 = await fetch(`${baseUrl}/api/student/profile`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Cookie: stu2Cookie },
    body: JSON.stringify({
      name: "qa_Student Two",
      studentId: s2IdNum,
      email: stu2Email,
      program: "BSCS",
      section: "2A",
      photo: SAMPLE_PHOTO,
    }),
  });
  assert.equal(putStu2.status, 200);

  // Faculty A & B profiles + Classes C1 & C2
  await fetch(`${baseUrl}/api/faculty/profile`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Cookie: facACookie },
    body: JSON.stringify({ name: "qa_Prof Alpha", department: "IT", email: facAEmail }),
  });

  const c1Code = `QA-A${Date.now().toString(36).slice(-5).toUpperCase()}`;
  const c2Code = `QA-B${Date.now().toString(36).slice(-5).toUpperCase()}`;
  createdClassCodes.push(c1Code, c2Code);

  const c1Res = await fetch(`${baseUrl}/api/classes`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: facACookie },
    body: JSON.stringify({
      sectionName: "qa_Section Alpha",
      courseCode: "QA101",
      courseTitle: "QA Auth Class",
      classCode: c1Code,
      scheduleDays: ["Mon", "Wed"],
      scheduleStartTime: "08:00",
      scheduleEndTime: "09:30",
    }),
  });
  assert.equal(c1Res.status, 201);
  const classA = (await c1Res.json()).class;

  const c2Res = await fetch(`${baseUrl}/api/classes`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: facBCookie },
    body: JSON.stringify({
      sectionName: "qa_Section Beta",
      courseCode: "QA202",
      courseTitle: "QA Isolation Class",
      classCode: c2Code,
      scheduleDays: ["Tue", "Thu"],
      scheduleStartTime: "10:00",
      scheduleEndTime: "11:30",
    }),
  });
  assert.equal(c2Res.status, 201);
  const classB = (await c2Res.json()).class;

  // Enroll Student 1 into Faculty A's Class A
  const rosterSaveRes = await fetch(`${baseUrl}/api/classes/${classA.id}/roster`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: facACookie },
    body: JSON.stringify({
      entries: [{ name: "qa_Student One", studentId: s1IdNum }],
    }),
  });
  assert.equal(rosterSaveRes.status, 201);

  const joinRes = await fetch(`${baseUrl}/api/classes/join`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: stu1Cookie },
    body: JSON.stringify({ classCode: c1Code, recaptchaToken: "ok" }),
  });
  assert.equal(joinRes.status, 201);

  // Create session, activity, quiz on Class B (Faculty B) to test cross-faculty isolation
  const sesBRes = await fetch(`${baseUrl}/api/classes/${classB.id}/sessions/today`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: facBCookie },
    body: JSON.stringify({ start: true }),
  });
  assert.equal(sesBRes.status, 200);
  const sessionB = (await sesBRes.json()).session;

  const actBRes = await fetch(`${baseUrl}/api/sessions/${sessionB.id}/activities`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: facBCookie },
    body: JSON.stringify({ title: "qa_FacB Activity", maxScore: 50 }),
  });
  assert.equal(actBRes.status, 201);
  const activityB = (await actBRes.json()).activity;

  const quizBRes = await fetch(`${baseUrl}/api/classes/${classB.id}/quizzes`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: facBCookie },
    body: JSON.stringify({ title: "qa_FacB Quiz", totalItems: 20 }),
  });
  assert.equal(quizBRes.status, 201);
  const quizBBody = await quizBRes.json();
  const quizB = quizBBody.session || quizBBody.quiz;

  // AUTH-10: Check JSON payloads omit password everywhere
  await t.test("AUTH-10: no API JSON response includes password or bcrypt hash", async () => {
    const facEndpoints = [
      "/api/auth/me",
      "/api/faculty/profile",
      "/api/faculty/classes",
      `/api/classes/${classA.id}`,
      `/api/classes/${classA.id}/deck`,
      `/api/classes/${classA.id}/roster`,
    ];
    for (const url of facEndpoints) {
      const res = await fetch(`${baseUrl}${url}`, { headers: { Cookie: facACookie } });
      assert.equal(res.status, 200, `Expected 200 on ${url}`);
      const json = await res.json();
      assert.equal(hasKeyRecursive(json, "password"), false, `Leaked password key at ${url}`);
      assert.equal(/\$2[aby]\$/.test(JSON.stringify(json)), false, `Leaked bcrypt hash at ${url}`);
    }
    const stuEndpoints = [
      "/api/auth/me",
      "/api/student/profile",
      "/api/student/classes",
      `/api/student/classes/${classA.id}/records`,
    ];
    for (const url of stuEndpoints) {
      const res = await fetch(`${baseUrl}${url}`, { headers: { Cookie: stu1Cookie } });
      assert.equal(res.status, 200, `Expected 200 on ${url}`);
      const json = await res.json();
      assert.equal(hasKeyRecursive(json, "password"), false, `Leaked password key at ${url}`);
      assert.equal(/\$2[aby]\$/.test(JSON.stringify(json)), false, `Leaked bcrypt hash at ${url}`);
    }
  });

  // AUTH-11: Student blocked from Faculty endpoints (403)
  await t.test("AUTH-11: STUDENT role receives 403 on all faculty endpoints", async () => {
    const requests = [
      ["POST", "/api/classes", { sectionName: "qa_Hack", classCode: "QA-HACK1" }],
      ["GET", "/api/faculty/classes"],
      ["GET", "/api/faculty/classes/pending-counts"],
      ["GET", "/api/faculty/profile"],
      ["PUT", "/api/faculty/profile", { name: "Hack" }],
      ["GET", `/api/classes/${classA.id}`],
      ["PATCH", `/api/classes/${classA.id}`, { sectionName: "Hack" }],
      ["POST", `/api/classes/${classA.id}/archive`],
      ["POST", `/api/classes/${classA.id}/roster`, { entries: [] }],
      ["POST", `/api/classes/${classA.id}/sessions/today`, { start: true }],
      ["PUT", `/api/sessions/${sessionB.id}/attendance`, { entries: [] }],
      ["POST", `/api/sessions/${sessionB.id}/activities`, { title: "Hack", maxScore: 10 }],
      ["POST", `/api/classes/${classA.id}/quizzes`, { title: "Hack", totalItems: 10 }],
      ["GET", `/api/classes/${classA.id}/export/excel`],
      ["GET", `/api/classes/${classA.id}/export/csv`],
      ["GET", `/api/classes/${classA.id}/students/${stu1ProfileId}/records`],
    ];
    for (const [method, endpoint, payload] of requests) {
      const res = await fetch(`${baseUrl}${endpoint}`, {
        method,
        headers: {
          Cookie: stu1Cookie,
          ...(payload ? { "Content-Type": "application/json" } : {}),
        },
        ...(payload ? { body: JSON.stringify(payload) } : {}),
      });
      assert.equal(res.status, 403, `Expected 403 for STUDENT calling ${method} ${endpoint}, got ${res.status}`);
    }
  });

  // AUTH-12: Faculty blocked from Student endpoints (403)
  await t.test("AUTH-12: FACULTY role receives 403 on all student-only endpoints", async () => {
    const requests = [
      ["GET", "/api/student/profile"],
      ["PUT", "/api/student/profile", { name: "X", studentId: "8999999", email: facAEmail, photo: SAMPLE_PHOTO }],
      ["GET", "/api/student/classes"],
      ["GET", `/api/student/classes/${classA.id}/records`],
      ["POST", "/api/classes/join", { classCode: c1Code, recaptchaToken: "ok" }],
    ];
    for (const [method, endpoint, payload] of requests) {
      const res = await fetch(`${baseUrl}${endpoint}`, {
        method,
        headers: {
          Cookie: facACookie,
          ...(payload ? { "Content-Type": "application/json" } : {}),
        },
        ...(payload ? { body: JSON.stringify(payload) } : {}),
      });
      assert.equal(res.status, 403, `Expected 403 for FACULTY calling ${method} ${endpoint}, got ${res.status}`);
    }
  });

  // AUTH-15: Cross-faculty isolation + unauthenticated 401
  await t.test("AUTH-15: Faculty A cannot access or mutate Faculty B's classes/sessions/activities/quizzes/exports, and unauthenticated returns 401", async () => {
    // Unauthenticated API checks
    for (const url of ["/api/auth/me", "/api/faculty/classes", "/api/student/classes"]) {
      const res = await fetch(`${baseUrl}${url}`);
      assert.equal(res.status, 401, `Expected 401 unauthenticated at ${url}`);
    }

    const crossRequests = [
      ["GET", `/api/classes/${classB.id}`],
      ["PATCH", `/api/classes/${classB.id}`, { sectionName: "Tamper" }],
      ["POST", `/api/classes/${classB.id}/archive`],
      ["POST", `/api/classes/${classB.id}/restore`],
      ["GET", `/api/classes/${classB.id}/deck`],
      ["GET", `/api/classes/${classB.id}/roster`],
      ["POST", `/api/classes/${classB.id}/roster`, { entries: [{ name: "Intruder", studentId: "8888888" }] }],
      ["GET", `/api/classes/${classB.id}/pending`],
      ["GET", `/api/classes/${classB.id}/export-summary`],
      ["GET", `/api/classes/${classB.id}/export/excel`],
      ["GET", `/api/classes/${classB.id}/export/csv`],
      ["POST", `/api/classes/${classB.id}/sessions/today`, { start: true }],
      ["PUT", `/api/sessions/${sessionB.id}/attendance`, { updates: [] }],
      ["POST", `/api/sessions/${sessionB.id}/recitation/shuffle`, { method: "RANDOM" }],
      ["PATCH", `/api/activities/${activityB.id}`, { title: "Tamper", maxScore: 50 }],
      ["DELETE", `/api/activities/${activityB.id}`],
      ...(quizB?.id ? [["PATCH", `/api/quizzes/${quizB.id}`, { title: "Tamper", totalItems: 10 }]] : []),
      ...(quizB?.id ? [["DELETE", `/api/quizzes/${quizB.id}`]] : []),
      ["GET", `/api/classes/${classB.id}/students/${stu1ProfileId}/records`],
    ];
    for (const [method, endpoint, payload] of crossRequests) {
      const res = await fetch(`${baseUrl}${endpoint}`, {
        method,
        headers: {
          Cookie: facACookie,
          ...(payload ? { "Content-Type": "application/json" } : {}),
        },
        ...(payload ? { body: JSON.stringify(payload) } : {}),
      });
      assert.ok(
        [403, 404].includes(res.status),
        `Expected 403/404 for cross-faculty ${method} ${endpoint}, got ${res.status}`,
      );
    }
  });

  // AUTH-16: Student photo access control & ETag caching
  await t.test("AUTH-16: /api/students/:profileId/photo enforces 401/403 isolation and returns ETag + 304", async () => {
    const unauth = await fetch(`${baseUrl}/api/students/${stu1ProfileId}/photo`);
    assert.equal(unauth.status, 401);

    const otherStu = await fetch(`${baseUrl}/api/students/${stu1ProfileId}/photo`, {
      headers: { Cookie: stu2Cookie },
    });
    assert.equal(otherStu.status, 404);

    const otherFac = await fetch(`${baseUrl}/api/students/${stu1ProfileId}/photo`, {
      headers: { Cookie: facBCookie },
    });
    assert.equal(otherFac.status, 404);

    const selfRes = await fetch(`${baseUrl}/api/students/${stu1ProfileId}/photo`, {
      headers: { Cookie: stu1Cookie },
    });
    assert.equal(selfRes.status, 200);
    assert.match(selfRes.headers.get("content-type") || "", /^image\/png/i);
    const etag = selfRes.headers.get("etag");
    assert.ok(etag, "Expected ETag header on photo response");

    const notModifiedSelf = await fetch(`${baseUrl}/api/students/${stu1ProfileId}/photo`, {
      headers: { Cookie: stu1Cookie, "If-None-Match": etag },
    });
    assert.equal(notModifiedSelf.status, 304);

    const allowedFac = await fetch(`${baseUrl}/api/students/${stu1ProfileId}/photo`, {
      headers: { Cookie: facACookie },
    });
    assert.equal(allowedFac.status, 200);
    const facEtag = allowedFac.headers.get("etag");
    assert.equal(facEtag, etag);

    const notModifiedFac = await fetch(`${baseUrl}/api/students/${stu1ProfileId}/photo`, {
      headers: { Cookie: facACookie, "If-None-Match": facEtag },
    });
    assert.equal(notModifiedFac.status, 304);
  });

  // Keep unused reference clean
  assert.ok(facBUser.id && stu2User.id);
});
