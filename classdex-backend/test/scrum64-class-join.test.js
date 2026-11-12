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
const ExcelJS = require("exceljs");

function readExcelSheetRows(worksheet) {
  if (!worksheet) return [];
  const colCount = worksheet.columnCount || 0;
  const rows = [];
  for (let r = 1; r <= worksheet.rowCount; r += 1) {
    const row = worksheet.getRow(r);
    const width = Math.max(colCount, row.cellCount || 0);
    const vals = [];
    for (let c = 1; c <= width; c += 1) {
      const v = row.getCell(c).value;
      vals.push(v === null || v === undefined ? "" : v);
    }
    rows.push(vals);
  }
  return rows;
}
const {
  app,
  resetRateLimitersForTests,
  ARCHIVED_READ_ONLY_MESSAGE,
  ARCHIVED_JOIN_MESSAGE,
} = require("../index");
const { prisma } = require("../db");
const {
  setRecaptchaVerifierForTests,
  resetRecaptchaVerifierForTests,
} = require("../recaptcha");
const {
  clearStubEmails,
  resetMailTransportForTests,
} = require("../src/services/mailer");

const SAMPLE_PHOTO =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

function extractSessionCookie(res) {
  const raw = res.headers.get("set-cookie") || "";
  const match = raw.match(/classdex\.sid=[^;]+/);
  return match ? match[0] : "";
}

async function loginCookie(baseUrl, email, password) {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  assert.equal(res.status, 200, `Expected 200 login for ${email}, got ${res.status}`);
  const cookie = extractSessionCookie(res);
  assert.ok(cookie, "Expected classdex.sid cookie");
  return cookie;
}

async function jsonReq(baseUrl, method, route, { cookie = "", body } = {}) {
  const headers = {};
  if (cookie) headers.Cookie = cookie;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(`${baseUrl}${route}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data, headers: res.headers };
}

async function allocStudentIds(count, used) {
  const out = [];
  while (out.length < count) {
    const batch = Array.from({ length: count * 4 }, () =>
      String(Math.floor(7100000 + Math.random() * 1799999)),
    ).filter((id) => !used.has(id) && !out.includes(id));
    if (!batch.length) continue;
    const [existingProfiles, existingRosters] = await Promise.all([
      prisma.studentProfile.findMany({ where: { studentId: { in: batch } }, select: { studentId: true } }),
      prisma.classRoster.findMany({ where: { studentId: { in: batch } }, select: { studentId: true } }),
    ]);
    const taken = new Set([
      ...existingProfiles.map((p) => p.studentId),
      ...existingRosters.map((r) => r.studentId),
    ]);
    for (const id of batch) {
      if (!taken.has(id)) {
        used.add(id);
        out.push(id);
        if (out.length === count) break;
      }
    }
  }
  return out;
}

test("SCRUM-64: Class Management & Join Workflow API Suite (CLS-01..CLS-21)", async (t) => {
  resetRateLimitersForTests();
  clearStubEmails();
  setRecaptchaVerifierForTests(async (token) =>
    token === "valid-token"
      ? { success: true }
      : { success: false, message: "Captcha verification failed." },
  );

  const server = app.listen(0);
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;
  const runId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const password = "QaPassword123!";
  const passwordHash = await bcrypt.hash(password, 10);

  const createdClassIds = [];
  const createdUserIds = [];
  const usedStudentIds = new Set();

  t.after(async () => {
    resetRecaptchaVerifierForTests();
    resetMailTransportForTests();
    clearStubEmails();
    resetRateLimitersForTests();
    await new Promise((resolve) => server.close(resolve));
    if (createdClassIds.length) {
      await prisma.class.deleteMany({ where: { id: { in: createdClassIds } } });
    }
    if (createdUserIds.length) {
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
    await prisma.$disconnect();
  });

  const [
    facOwner,
    facOther,
    stuMatched,
    stuUnmatched,
    stuNoProfile,
    stuSingleSync,
    stuMultiSync,
  ] = await Promise.all([
    prisma.user.create({
      data: {
        name: "qa_S64 Faculty 1",
        email: `qa_s64_fac1_${runId}@test.local`,
        password: passwordHash,
        role: "FACULTY",
        emailVerified: true,
        facultyProfile: { create: { name: "qa_S64 Faculty 1", email: `qa_s64_fac1_${runId}@test.local` } },
      },
    }),
    prisma.user.create({
      data: {
        name: "qa_S64 Faculty 2",
        email: `qa_s64_fac2_${runId}@test.local`,
        password: passwordHash,
        role: "FACULTY",
        emailVerified: true,
        facultyProfile: { create: { name: "qa_S64 Faculty 2", email: `qa_s64_fac2_${runId}@test.local` } },
      },
    }),
    prisma.user.create({
      data: {
        name: "qa_S64 Student Matched",
        email: `qa_s64_stu_match_${runId}@test.local`,
        password: passwordHash,
        role: "STUDENT",
        emailVerified: true,
      },
    }),
    prisma.user.create({
      data: {
        name: "qa_S64 Student Unmatched",
        email: `qa_s64_stu_unmatch_${runId}@test.local`,
        password: passwordHash,
        role: "STUDENT",
        emailVerified: true,
      },
    }),
    prisma.user.create({
      data: {
        name: "qa_S64 Student No Profile",
        email: `qa_s64_stu_noprof_${runId}@test.local`,
        password: passwordHash,
        role: "STUDENT",
        emailVerified: true,
      },
    }),
    prisma.user.create({
      data: {
        name: "qa_S64 Single Sync Student",
        email: `qa_s64_stu_single_${runId}@test.local`,
        password: passwordHash,
        role: "STUDENT",
        emailVerified: true,
      },
    }),
    prisma.user.create({
      data: {
        name: "qa_S64 Multi Sync Student",
        email: `qa_s64_stu_multi_${runId}@test.local`,
        password: passwordHash,
        role: "STUDENT",
        emailVerified: true,
      },
    }),
  ]);
  createdUserIds.push(
    facOwner.id,
    facOther.id,
    stuMatched.id,
    stuUnmatched.id,
    stuNoProfile.id,
    stuSingleSync.id,
    stuMultiSync.id,
  );

  const [
    idMatched,
    idUnmatched,
    idSingleOld,
    idSingleNew,
    idMultiOld,
    idMultiNew,
  ] = await allocStudentIds(6, usedStudentIds);

  const [profMatched, profUnmatched, profSingle, profMulti] = await Promise.all([
    prisma.studentProfile.create({
      data: {
        userId: stuMatched.id,
        name: "qa_Alice Matched",
        studentId: idMatched,
        email: stuMatched.email,
        photo: SAMPLE_PHOTO,
        firstName: "qa_Alice",
        lastName: "Matched",
        sortKey: "matched qa_alice",
      },
    }),
    prisma.studentProfile.create({
      data: {
        userId: stuUnmatched.id,
        name: "qa_Ben Unmatched",
        studentId: idUnmatched,
        email: stuUnmatched.email,
        photo: SAMPLE_PHOTO,
        firstName: "qa_Ben",
        lastName: "Unmatched",
        sortKey: "unmatched qa_ben",
      },
    }),
    prisma.studentProfile.create({
      data: {
        userId: stuSingleSync.id,
        name: "qa_Carol Single",
        studentId: idSingleOld,
        email: stuSingleSync.email,
        photo: SAMPLE_PHOTO,
      },
    }),
    prisma.studentProfile.create({
      data: {
        userId: stuMultiSync.id,
        name: "qa_Dan Multi",
        studentId: idMultiOld,
        email: stuMultiSync.email,
        photo: SAMPLE_PHOTO,
      },
    }),
  ]);

  const [
    fac1Cookie,
    fac2Cookie,
    stuMatchCookie,
    stuUnmatchCookie,
    stuNoProfCookie,
    stuSingleCookie,
    stuMultiCookie,
  ] = await Promise.all([
    loginCookie(baseUrl, facOwner.email, password),
    loginCookie(baseUrl, facOther.email, password),
    loginCookie(baseUrl, stuMatched.email, password),
    loginCookie(baseUrl, stuUnmatched.email, password),
    loginCookie(baseUrl, stuNoProfile.email, password),
    loginCookie(baseUrl, stuSingleSync.email, password),
    loginCookie(baseUrl, stuMultiSync.email, password),
  ]);

  const codeC1 = `QA64A${runId.slice(-4)}`.toUpperCase();
  const codeC1Edited = `QA64E${runId.slice(-4)}`.toUpperCase();
  const codeC2 = `QA64B${runId.slice(-4)}`.toUpperCase();
  const codeC3 = `QA64C${runId.slice(-4)}`.toUpperCase();
  let classC1;
  let classC2;
  let classC3;

  await t.test("CLS-01: Create class with course fields & structured schedule (+ lazy MIDTERM/FINALS projects)", async () => {
    const res = await jsonReq(baseUrl, "POST", "/api/classes", {
      cookie: fac1Cookie,
      body: {
        courseCode: "it 121/121l",
        courseTitle: "information   management I",
        sectionName: "qa_BSIT 3A",
        classCode: codeC1,
        description: "Functional test class C1",
        scheduleDays: ["Wed", "Mon"],
        scheduleStartTime: "07:30",
        scheduleEndTime: "09:00",
      },
    });
    assert.equal(res.status, 201);
    classC1 = res.data.class;
    createdClassIds.push(classC1.id);
    assert.equal(classC1.courseCode, "IT 121/121L");
    assert.equal(classC1.courseTitle, "information management I");
    assert.equal(classC1.sectionName, "qa_BSIT 3A");
    assert.equal(classC1.classCode, codeC1);
    assert.deepEqual(classC1.scheduleDays, ["Mon", "Wed"]);
    assert.equal(classC1.scheduleStartTime, "07:30");
    assert.equal(classC1.scheduleEndTime, "09:00");
    assert.equal(classC1.schedule, "Mon, Wed · 7:30 AM – 9:00 AM");
    assert.equal(classC1.gracePeriodMinutes, 15);
    assert.equal(classC1.recitationShuffleSeconds, 3);

    // Projects are initialized lazily on GET /api/classes/:id/projects (MIDTERM + FINALS)
    const projRes = await jsonReq(baseUrl, "GET", `/api/classes/${classC1.id}/projects`, {
      cookie: fac1Cookie,
    });
    assert.equal(projRes.status, 200);
    assert.equal(projRes.data.projects.length, 2);
    assert.deepEqual(
      projRes.data.projects.map((p) => p.type).sort(),
      ["FINALS", "MIDTERM"],
    );
  });

  await t.test("CLS-02: Create & settings validation + duplicate classCode 409", async () => {
    const missingSection = await jsonReq(baseUrl, "POST", "/api/classes", {
      cookie: fac1Cookie,
      body: { courseCode: "IT 101", courseTitle: "Intro", sectionName: "   " },
    });
    assert.equal(missingSection.status, 400);
    assert.equal(missingSection.data.field, "sectionName");

    const missingCourse = await jsonReq(baseUrl, "POST", "/api/classes", {
      cookie: fac1Cookie,
      body: { courseCode: "", courseTitle: "Intro", sectionName: "qa_Sec" },
    });
    assert.equal(missingCourse.status, 400);
    assert.equal(missingCourse.data.field, "courseCode");

    const badTimeRange = await jsonReq(baseUrl, "POST", "/api/classes", {
      cookie: fac1Cookie,
      body: {
        courseCode: "IT 101",
        courseTitle: "Intro",
        sectionName: "qa_Sec",
        scheduleDays: ["Mon"],
        scheduleStartTime: "10:00",
        scheduleEndTime: "09:30",
      },
    });
    assert.equal(badTimeRange.status, 400);

    const dupCode = await jsonReq(baseUrl, "POST", "/api/classes", {
      cookie: fac1Cookie,
      body: {
        courseCode: "IT 101",
        courseTitle: "Intro",
        sectionName: "qa_Duplicate",
        classCode: codeC1,
      },
    });
    assert.equal(dupCode.status, 409);

    for (const gracePeriodMinutes of [-1, 1441, 1.5]) {
      const badGrace = await jsonReq(baseUrl, "PATCH", `/api/classes/${classC1.id}`, {
        cookie: fac1Cookie,
        body: { gracePeriodMinutes },
      });
      assert.equal(badGrace.status, 400, `Expected 400 for gracePeriodMinutes=${gracePeriodMinutes}`);
    }

    for (const recitationShuffleSeconds of [0, 8, 2.5]) {
      const badShuffle = await jsonReq(baseUrl, "PATCH", `/api/classes/${classC1.id}`, {
        cookie: fac1Cookie,
        body: { recitationShuffleSeconds },
      });
      assert.equal(badShuffle.status, 400, `Expected 400 for shuffle=${recitationShuffleSeconds}`);
    }
  });

  await t.test("CLS-04: Edit class & check-code excludeId", async () => {
    const c2Res = await jsonReq(baseUrl, "POST", "/api/classes", {
      cookie: facOther ? fac2Cookie : fac1Cookie,
      body: {
        courseCode: "CS 101",
        courseTitle: "Programming I",
        sectionName: "qa_BSCS 1A",
        classCode: codeC2,
      },
    });
    assert.equal(c2Res.status, 201);
    classC2 = c2Res.data.class;
    createdClassIds.push(classC2.id);

    const c3Res = await jsonReq(baseUrl, "POST", "/api/classes", {
      cookie: fac1Cookie,
      body: {
        courseCode: "CS 201",
        courseTitle: "Data Structures",
        sectionName: "qa_BSCS 2A",
        classCode: codeC3,
      },
    });
    assert.equal(c3Res.status, 201);
    classC3 = c3Res.data.class;
    createdClassIds.push(classC3.id);

    const selfNoExclude = await jsonReq(baseUrl, "GET", `/api/classes/check-code?code=${codeC1}`, {
      cookie: fac1Cookie,
    });
    assert.equal(selfNoExclude.status, 200);
    assert.equal(selfNoExclude.data.available, false);

    const selfExcluded = await jsonReq(
      baseUrl,
      "GET",
      `/api/classes/check-code?code=${codeC1}&excludeId=${classC1.id}`,
      { cookie: fac1Cookie },
    );
    assert.equal(selfExcluded.status, 200);
    assert.equal(selfExcluded.data.available, true);

    const otherTaken = await jsonReq(
      baseUrl,
      "GET",
      `/api/classes/check-code?code=${codeC2}&excludeId=${classC1.id}`,
      { cookie: fac1Cookie },
    );
    assert.equal(otherTaken.status, 200);
    assert.equal(otherTaken.data.available, false);

    const patchRes = await jsonReq(baseUrl, "PATCH", `/api/classes/${classC1.id}`, {
      cookie: fac1Cookie,
      body: {
        courseCode: "IT 122",
        courseTitle: "Information Management II",
        sectionName: "qa_BSIT 3A Edited",
        classCode: codeC1Edited,
        description: "Updated class C1 metadata",
        scheduleDays: ["Tue", "Thu"],
        scheduleStartTime: "13:00",
        scheduleEndTime: "14:30",
        gracePeriodMinutes: 25,
        recitationShuffleSeconds: 5,
      },
    });
    assert.equal(patchRes.status, 200);
    assert.equal(patchRes.data.class.courseCode, "IT 122");
    assert.equal(patchRes.data.class.courseTitle, "Information Management II");
    assert.equal(patchRes.data.class.sectionName, "qa_BSIT 3A Edited");
    assert.equal(patchRes.data.class.classCode, codeC1Edited);
    assert.deepEqual(patchRes.data.class.scheduleDays, ["Tue", "Thu"]);
    assert.equal(patchRes.data.class.gracePeriodMinutes, 25);
    assert.equal(patchRes.data.class.recitationShuffleSeconds, 5);
  });

  await t.test("CLS-06: Save Student List API, name parsing with suffixes/commas, & invalidRows validation", async () => {
    const validRes = await jsonReq(baseUrl, "POST", `/api/classes/${classC1.id}/roster`, {
      cookie: fac1Cookie,
      body: {
        entries: [
          { studentName: "Dela Cruz, Juan Jr.", studentId: "0123456" },
          { studentName: "Maria Clara P. Santos", studentId: idMatched },
          { studentName: "O'Connor, Liam III", studentId: "7990001" },
        ],
      },
    });
    assert.equal(validRes.status, 201);
    assert.equal(validRes.data.roster.length, 3);

    const dbRoster = await prisma.classRoster.findMany({
      where: { classId: classC1.id, droppedAt: null },
    });
    const juan = dbRoster.find((r) => r.studentId === "0123456");
    assert.ok(juan, "Expected Dela Cruz, Juan Jr. in roster");
    assert.equal(juan.firstName, "Juan");
    assert.equal(juan.lastName, "Dela Cruz");
    assert.equal(juan.suffix, "Jr.");
    assert.ok(juan.sortKey, "Expected non-empty sortKey");

    const invalidRes = await jsonReq(baseUrl, "POST", `/api/classes/${classC1.id}/roster`, {
      cookie: fac1Cookie,
      body: {
        entries: [
          { studentName: "   ", studentId: "7990002" },
          { studentName: "Bad ID", studentId: "12345" },
          { studentName: "Dup A", studentId: "7990003" },
          { studentName: "Dup B", studentId: "7990003" },
        ],
      },
    });
    assert.equal(invalidRes.status, 400);
    assert.ok(Array.isArray(invalidRes.data.invalidRows));
    assert.equal(invalidRes.data.invalidRows.length, 3);
  });

  await t.test("CLS-10 & CLS-11: Template download filename, leading-zero Excel round-trip, & import error handling", async () => {
    const tplRes = await fetch(`${baseUrl}/api/classes/${classC1.id}/roster/template`, {
      headers: { Cookie: fac1Cookie },
    });
    assert.equal(tplRes.status, 200);
    const disp = decodeURIComponent(tplRes.headers.get("content-disposition") || "");
    assert.ok(
      disp.includes(`qa_BSIT_3A_Edited_IT_122_${codeC1Edited}_student_list_template.xlsx`),
      `Unexpected Content-Disposition: ${disp}`,
    );

    const tplBuf = Buffer.from(await tplRes.arrayBuffer());
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(tplBuf);
    const rows = readExcelSheetRows(wb.worksheets[0]);
    const zeroRow = rows.find((r) => r[1] === "0123456");
    assert.ok(zeroRow, "Expected leading-zero studentId '0123456' in downloaded template");

    const roundTrip = await jsonReq(baseUrl, "POST", `/api/classes/${classC1.id}/roster/import`, {
      cookie: fac1Cookie,
      body: {
        fileName: "template.xlsx",
        fileBase64: tplBuf.toString("base64"),
      },
    });
    assert.equal(roundTrip.status, 200);
    assert.equal(roundTrip.data.rows.length, 3);
    assert.ok(roundTrip.data.rows.some((r) => r.studentId === "0123456"));
    assert.ok(roundTrip.data.warnings.length >= 1, "Expected duplicate warning against saved roster");

    // Numeric leading-zero coercion check (e.g. Excel strips leading zero -> 0234567 stored as 234567)
    const numWb = new ExcelJS.Workbook();
    const numWs = numWb.addWorksheet("Sheet1");
    numWs.addRow(["STUDENTS", ""]);
    numWs.addRow(["Name", "Student ID"]);
    numWs.addRow(["Santos, Ana", 234567]);
    const numBuf = Buffer.from(await numWb.xlsx.writeBuffer());
    const paddedRes = await jsonReq(baseUrl, "POST", `/api/classes/${classC1.id}/roster/import`, {
      cookie: fac1Cookie,
      body: { fileName: "numeric.xlsx", fileBase64: numBuf.toString("base64") },
    });
    assert.equal(paddedRes.status, 200);
    assert.equal(paddedRes.data.rows[0].studentId, "0234567");
    assert.equal(paddedRes.data.rows[0].errors.length, 0);

    // CLS-11: Bad headers -> 400
    const badHeaderWb = new ExcelJS.Workbook();
    const badHeaderWs = badHeaderWb.addWorksheet("Sheet1");
    badHeaderWs.addRow(["Foo", "Bar"]);
    badHeaderWs.addRow(["1", "2"]);
    const badHeaderBuf = Buffer.from(await badHeaderWb.xlsx.writeBuffer());
    const badHdrRes = await jsonReq(baseUrl, "POST", `/api/classes/${classC1.id}/roster/import`, {
      cookie: fac1Cookie,
      body: { fileName: "bad-headers.xlsx", fileBase64: badHeaderBuf.toString("base64") },
    });
    assert.equal(badHdrRes.status, 400);

    // CLS-11: Unsupported extension -> 400
    const badExtRes = await jsonReq(baseUrl, "POST", `/api/classes/${classC1.id}/roster/import`, {
      cookie: fac1Cookie,
      body: { fileName: "roster.txt", fileBase64: Buffer.from("a,b").toString("base64") },
    });
    assert.equal(badExtRes.status, 400);

    // CLS-11: >2 MB payload -> 400
    const bigBuf = Buffer.alloc(2 * 1024 * 1024 + 512, 65);
    const bigRes = await jsonReq(baseUrl, "POST", `/api/classes/${classC1.id}/roster/import`, {
      cookie: fac1Cookie,
      body: { fileName: "oversized.xlsx", fileBase64: bigBuf.toString("base64") },
    });
    assert.equal(bigRes.status, 400);
  });

  await t.test("CLS-13, CLS-15, CLS-16, CLS-18: Join guards, auto-approve vs pending, retroactive auto-approve, duplicate & multi-class join", async () => {
    // CLS-13: Missing StudentProfile -> 409
    const noProfRes = await jsonReq(baseUrl, "POST", "/api/classes/join", {
      cookie: stuNoProfCookie,
      body: { classCode: codeC1Edited, recaptchaToken: "valid-token" },
    });
    assert.equal(noProfRes.status, 409);
    assert.match(noProfRes.data.message, /Create your student profile/i);

    // CLS-13: Unknown code -> 404
    const unknownRes = await jsonReq(baseUrl, "POST", "/api/classes/join", {
      cookie: stuMatchCookie,
      body: { classCode: "DOESNOTEXIST9", recaptchaToken: "valid-token" },
    });
    assert.equal(unknownRes.status, 404);

    // CLS-13: Empty / failed recaptcha -> 400
    const badCaptcha = await jsonReq(baseUrl, "POST", "/api/classes/join", {
      cookie: stuMatchCookie,
      body: { classCode: codeC1Edited, recaptchaToken: "bad-token" },
    });
    assert.equal(badCaptcha.status, 400);

    // CLS-15: Matched student auto-approves immediately; unmatched becomes PENDING
    const matchJoin = await jsonReq(baseUrl, "POST", "/api/classes/join", {
      cookie: stuMatchCookie,
      body: { classCode: codeC1Edited, recaptchaToken: "valid-token" },
    });
    assert.equal(matchJoin.status, 201);
    assert.equal(matchJoin.data.status, "APPROVED");
    assert.ok(matchJoin.data.enrollment.autoApprovedAt);

    const unmatchJoin = await jsonReq(baseUrl, "POST", "/api/classes/join", {
      cookie: stuUnmatchCookie,
      body: { classCode: codeC1Edited, recaptchaToken: "valid-token" },
    });
    assert.equal(unmatchJoin.status, 201);
    assert.equal(unmatchJoin.data.status, "PENDING");
    assert.equal(unmatchJoin.data.enrollment.autoApprovedAt, null);

    // CLS-18: Re-join APPROVED -> 409 existing notice; Re-join PENDING -> 409 waiting notice
    const dupApproved = await jsonReq(baseUrl, "POST", "/api/classes/join", {
      cookie: stuMatchCookie,
      body: { classCode: codeC1Edited, recaptchaToken: "valid-token" },
    });
    assert.equal(dupApproved.status, 409);
    assert.equal(dupApproved.data.status, "APPROVED");
    assert.match(dupApproved.data.message, /already joined/i);

    const dupPending = await jsonReq(baseUrl, "POST", "/api/classes/join", {
      cookie: stuUnmatchCookie,
      body: { classCode: codeC1Edited, recaptchaToken: "valid-token" },
    });
    assert.equal(dupPending.status, 409);
    assert.equal(dupPending.data.status, "PENDING");
    assert.match(dupPending.data.message, /already waiting/i);

    // CLS-16: Save Student List adding unmatched student's ID triggers retroactive auto-approval + notification
    const retroRes = await jsonReq(baseUrl, "POST", `/api/classes/${classC1.id}/roster`, {
      cookie: fac1Cookie,
      body: {
        entries: [
          { studentName: "Dela Cruz, Juan Jr.", studentId: "0123456" },
          { studentName: "Maria Clara P. Santos", studentId: idMatched },
          { studentName: "qa_Ben Unmatched Official", studentId: idUnmatched },
        ],
      },
    });
    assert.equal(retroRes.status, 201);
    assert.equal(retroRes.data.autoApprovedCount, 1);

    const pendingState = await jsonReq(baseUrl, "GET", `/api/classes/${classC1.id}/pending`, {
      cookie: fac1Cookie,
    });
    assert.equal(pendingState.status, 200);
    assert.equal(pendingState.data.pending.length, 0);
    assert.ok(
      pendingState.data.autoApproved.some((e) => e.studentProfile.id === profUnmatched.id),
      "Expected retroactively auto-approved student in notifications",
    );
    assert.ok(pendingState.data.unreadNotificationCount >= 2);

    // CLS-18: Matched student joins C2 (empty roster -> PENDING) and C3 (second class -> PENDING) reusing single StudentProfile
    const joinC2 = await jsonReq(baseUrl, "POST", "/api/classes/join", {
      cookie: stuMatchCookie,
      body: { classCode: codeC2, recaptchaToken: "valid-token" },
    });
    assert.equal(joinC2.status, 201);
    assert.equal(joinC2.data.status, "PENDING");

    const joinC3 = await jsonReq(baseUrl, "POST", "/api/classes/join", {
      cookie: stuMatchCookie,
      body: { classCode: codeC3, recaptchaToken: "valid-token" },
    });
    assert.equal(joinC3.status, 201);

    const profileCount = await prisma.studentProfile.count({ where: { userId: stuMatched.id } });
    const enrollmentCount = await prisma.classEnrollment.count({ where: { studentProfileId: profMatched.id } });
    assert.equal(profileCount, 1);
    assert.equal(enrollmentCount, 3);
  });

  await t.test("CLS-19 & CLS-20: Impact check, 0-record delete vs >0-record Drop List, & Restore preserving coursework", async () => {
    // Give profMatched an attendance record + quiz score in classC1; keep profUnmatched with 0 records
    const sessionRes = await jsonReq(baseUrl, "POST", `/api/classes/${classC1.id}/sessions/today`, {
      cookie: fac1Cookie,
      body: { start: true },
    });
    assert.equal(sessionRes.status, 200);
    const sessionC1 = sessionRes.data.session;

    const attRes = await jsonReq(
      baseUrl,
      "PUT",
      `/api/sessions/${sessionC1.id}/attendance/${profMatched.id}`,
      {
        cookie: fac1Cookie,
        body: { status: "PRESENT" },
      },
    );
    assert.equal(attRes.status, 200);

    const quizRes = await jsonReq(baseUrl, "POST", `/api/classes/${classC1.id}/quizzes`, {
      cookie: fac1Cookie,
      body: { title: "CLS-19 Quiz", totalItems: 10 },
    });
    assert.equal(quizRes.status, 201);
    const quizC1 = quizRes.data.session;

    const qScoreRes = await jsonReq(baseUrl, "PUT", `/api/quizzes/${quizC1.id}/scores`, {
      cookie: fac1Cookie,
      body: { scores: [{ studentId: profMatched.id, score: 9 }] },
    });
    assert.equal(qScoreRes.status, 200);

    const rosterBefore = await jsonReq(baseUrl, "GET", `/api/classes/${classC1.id}/roster`, {
      cookie: fac1Cookie,
    });
    assert.equal(rosterBefore.status, 200);
    const entryZero = rosterBefore.data.roster.find((r) => r.studentId === idUnmatched);
    const entryWithRecords = rosterBefore.data.roster.find((r) => r.studentId === idMatched);
    assert.ok(entryZero && entryWithRecords);

    // Impact checks
    const imp0 = await jsonReq(baseUrl, "GET", `/api/classes/${classC1.id}/roster/${entryZero.id}/impact`, {
      cookie: fac1Cookie,
    });
    assert.equal(imp0.status, 200);
    assert.equal(imp0.data.recordCount, 0);

    const imp2 = await jsonReq(
      baseUrl,
      "GET",
      `/api/classes/${classC1.id}/roster/${entryWithRecords.id}/impact`,
      { cookie: fac1Cookie },
    );
    assert.equal(imp2.status, 200);
    assert.equal(imp2.data.recordCount, 2);

    // Delete 0-record student -> permanent removal
    const del0 = await jsonReq(baseUrl, "DELETE", `/api/classes/${classC1.id}/roster/${entryZero.id}`, {
      cookie: fac1Cookie,
    });
    assert.equal(del0.status, 200);
    assert.equal(del0.data.result, "removed");
    assert.equal(
      await prisma.classRoster.findUnique({ where: { id: entryZero.id } }),
      null,
    );

    // Delete >0-record student -> moved to Drop List
    const del2 = await jsonReq(baseUrl, "DELETE", `/api/classes/${classC1.id}/roster/${entryWithRecords.id}`, {
      cookie: fac1Cookie,
    });
    assert.equal(del2.status, 200);
    assert.equal(del2.data.result, "dropped");
    assert.equal(del2.data.recordCount, 2);

    const dropListRes = await jsonReq(baseUrl, "GET", `/api/classes/${classC1.id}/drop-list`, {
      cookie: fac1Cookie,
    });
    assert.equal(dropListRes.status, 200);
    assert.equal(dropListRes.data.dropList.length, 1);
    assert.equal(dropListRes.data.dropList[0].studentId, idMatched);
    assert.equal(dropListRes.data.dropList[0].recordCount, 2);

    // CLS-20: Restore dropped student
    const restoreStudentRes = await jsonReq(
      baseUrl,
      "POST",
      `/api/classes/${classC1.id}/drop-list/${entryWithRecords.id}/restore`,
      { cookie: fac1Cookie },
    );
    assert.equal(restoreStudentRes.status, 200);
    assert.equal(restoreStudentRes.data.success, true);

    const rosterAfterRestore = await jsonReq(baseUrl, "GET", `/api/classes/${classC1.id}/roster`, {
      cookie: fac1Cookie,
    });
    assert.ok(rosterAfterRestore.data.roster.some((r) => r.studentId === idMatched));
    const deckAfterRestore = await jsonReq(baseUrl, "GET", `/api/classes/${classC1.id}/deck`, {
      cookie: fac1Cookie,
    });
    assert.ok(deckAfterRestore.data.students.some((s) => s.id === profMatched.id && s.attendanceStatus === "PRESENT"));
    const recordsAfterRestore = await jsonReq(
      baseUrl,
      "GET",
      `/api/classes/${classC1.id}/students/${profMatched.id}/records`,
      { cookie: fac1Cookie },
    );
    assert.equal(recordsAfterRestore.status, 200);
    assert.equal(recordsAfterRestore.data.quizzes.find((q) => q.session.id === quizC1.id)?.score, 9);
  });

  await t.test("CLS-05 & CLS-21: Archive read-only guard across mutating routes, join block (409), & 100% restore preservation", async () => {
    const archiveRes = await jsonReq(baseUrl, "POST", `/api/classes/${classC1.id}/archive`, {
      cookie: fac1Cookie,
    });
    assert.equal(archiveRes.status, 200);
    assert.ok(archiveRes.data.class.archivedAt);

    // CLS-21: Join on archived class returns 409 ARCHIVED_JOIN_MESSAGE
    const joinArchived = await jsonReq(baseUrl, "POST", "/api/classes/join", {
      cookie: stuUnmatchCookie,
      body: { classCode: codeC1Edited, recaptchaToken: "valid-token" },
    });
    assert.equal(joinArchived.status, 409);
    assert.equal(joinArchived.data.message, ARCHIVED_JOIN_MESSAGE);

    // Mutating class endpoints blocked with 409 ARCHIVED_READ_ONLY_MESSAGE
    const blockedPatch = await jsonReq(baseUrl, "PATCH", `/api/classes/${classC1.id}`, {
      cookie: fac1Cookie,
      body: { sectionName: "Blocked Rename" },
    });
    assert.equal(blockedPatch.status, 409);
    assert.equal(blockedPatch.data.message, ARCHIVED_READ_ONLY_MESSAGE);

    const blockedRoster = await jsonReq(baseUrl, "POST", `/api/classes/${classC1.id}/roster`, {
      cookie: fac1Cookie,
      body: { entries: [{ studentName: "Blocked", studentId: "7891234" }] },
    });
    assert.equal(blockedRoster.status, 409);
    assert.equal(blockedRoster.data.message, ARCHIVED_READ_ONLY_MESSAGE);

    const blockedQuiz = await jsonReq(baseUrl, "POST", `/api/classes/${classC1.id}/quizzes`, {
      cookie: fac1Cookie,
      body: { title: "Blocked Quiz", totalItems: 10 },
    });
    assert.equal(blockedQuiz.status, 409);

    // Reads & exports remain 200 on archived class
    const readDeck = await jsonReq(baseUrl, "GET", `/api/classes/${classC1.id}/deck`, { cookie: fac1Cookie });
    assert.equal(readDeck.status, 200);
    const readExport = await fetch(`${baseUrl}/api/classes/${classC1.id}/export/csv?types=attendance,quizzes`, {
      headers: { Cookie: fac1Cookie },
    });
    assert.equal(readExport.status, 200);

    // Restore preserves 100% data
    const restoreClassRes = await jsonReq(baseUrl, "POST", `/api/classes/${classC1.id}/restore`, {
      cookie: fac1Cookie,
    });
    assert.equal(restoreClassRes.status, 200);
    assert.equal(restoreClassRes.data.class.archivedAt, null);
    const deckRestored = await jsonReq(baseUrl, "GET", `/api/classes/${classC1.id}/deck`, { cookie: fac1Cookie });
    assert.equal(deckRestored.status, 200);
    assert.equal(deckRestored.data.students.length, 1);
    assert.equal(deckRestored.data.exportCounts.quizzes, 1);
  });

  await t.test("CLS-12: Student Profile validation, 409 studentId conflict, single-class & multi-class ClassRoster sync", async () => {
    const badId = await jsonReq(baseUrl, "PUT", "/api/student/profile", {
      cookie: stuSingleCookie,
      body: {
        name: "qa_Carol Single",
        studentId: "12345",
        email: stuSingleSync.email,
        photo: SAMPLE_PHOTO,
      },
    });
    assert.equal(badId.status, 400);

    const badPhoto = await jsonReq(baseUrl, "PUT", "/api/student/profile", {
      cookie: stuSingleCookie,
      body: {
        name: "qa_Carol Single",
        studentId: idSingleOld,
        email: stuSingleSync.email,
        photo: "not-a-valid-photo",
      },
    });
    assert.equal(badPhoto.status, 400);

    const conflictId = await jsonReq(baseUrl, "PUT", "/api/student/profile", {
      cookie: stuSingleCookie,
      body: {
        name: "qa_Carol Single",
        studentId: idMatched,
        email: stuSingleSync.email,
        photo: SAMPLE_PHOTO,
      },
    });
    assert.equal(conflictId.status, 409);

    // Single-class in-place ClassRoster sync preserving faculty studentName
    const rosterC3Single = await prisma.classRoster.create({
      data: {
        classId: classC3.id,
        studentId: idSingleOld,
        studentName: "Single, Carol (Official)",
        sortKey: "single",
      },
    });
    await prisma.classEnrollment.create({
      data: { classId: classC3.id, studentProfileId: profSingle.id, status: "APPROVED" },
    });

    const singleUpdate = await jsonReq(baseUrl, "PUT", "/api/student/profile", {
      cookie: stuSingleCookie,
      body: {
        name: "qa_Carol Updated Name",
        studentId: idSingleNew,
        email: stuSingleSync.email,
        photo: SAMPLE_PHOTO,
      },
    });
    assert.equal(singleUpdate.status, 200);
    const updatedRosterC3 = await prisma.classRoster.findUnique({ where: { id: rosterC3Single.id } });
    assert.equal(updatedRosterC3.studentId, idSingleNew);
    assert.equal(updatedRosterC3.studentName, "Single, Carol (Official)");

    // Multi-class sync (3 classes, exercising DEF-01 sequential tx loop)
    await Promise.all([
      prisma.classRoster.create({
        data: { classId: classC1.id, studentId: idMultiOld, studentName: "Multi, Dan (C1)", sortKey: "multi" },
      }),
      prisma.classRoster.create({
        data: { classId: classC2.id, studentId: idMultiOld, studentName: "Multi, Dan (C2)", sortKey: "multi" },
      }),
      prisma.classRoster.create({
        data: { classId: classC3.id, studentId: idMultiOld, studentName: "Multi, Dan (C3)", sortKey: "multi" },
      }),
      prisma.classEnrollment.create({
        data: { classId: classC1.id, studentProfileId: profMulti.id, status: "APPROVED" },
      }),
      prisma.classEnrollment.create({
        data: { classId: classC2.id, studentProfileId: profMulti.id, status: "APPROVED" },
      }),
      prisma.classEnrollment.create({
        data: { classId: classC3.id, studentProfileId: profMulti.id, status: "APPROVED" },
      }),
    ]);

    const multiUpdate = await jsonReq(baseUrl, "PUT", "/api/student/profile", {
      cookie: stuMultiCookie,
      body: {
        name: "qa_Dan Multi",
        studentId: idMultiNew,
        email: stuMultiSync.email,
        photo: SAMPLE_PHOTO,
      },
    });
    assert.equal(
      multiUpdate.status,
      200,
      `Multi-class profile sync returned ${multiUpdate.status}: ${multiUpdate.data?.message || ""}`,
    );
  });
});
