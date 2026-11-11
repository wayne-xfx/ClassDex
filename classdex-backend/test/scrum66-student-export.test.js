const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
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
const XLSX = require("xlsx");
const {
  app,
  resetRateLimitersForTests,
} = require("../index");
const { prisma } = require("../db");
const { dateLabel } = require("../export");
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

function parseCsvRows(text) {
  const clean = text.replace(/^\uFEFF/, "");
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < clean.length; i += 1) {
    const ch = clean[i];
    if (inQuotes) {
      if (ch === '"' && clean[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\r" && clean[i + 1] === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i += 1;
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function splitCsvSections(text) {
  const clean = text.replace(/^\uFEFF/, "").replace(/\r\n$/, "");
  if (!clean.trim()) return new Map();
  const blocks = clean.split(/\r\n\r\n/);
  const map = new Map();
  for (const block of blocks) {
    const rows = parseCsvRows(block);
    if (rows.length) {
      const title = String(rows[0][0] || "");
      map.set(title, rows.slice(1));
    }
  }
  return map;
}

async function allocStudentIds(count, used) {
  const out = [];
  while (out.length < count) {
    const batch = Array.from({ length: Math.min(count * 3, 250) }, () =>
      String(Math.floor(7200000 + Math.random() * 1700000)),
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

test("SCRUM-66: Student Dashboard & Data Export API Suite (STU-01..03, EXP-01..06)", async (t) => {
  resetRateLimitersForTests();
  clearStubEmails();
  setRecaptchaVerifierForTests(async () => ({ success: true }));

  const server = app.listen(0);
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;
  const runId = Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  const password = "QaPassword123!";
  const passwordHash = await bcrypt.hash(password, 10);

  const createdClassIds = [];
  const createdUserIds = [];
  const usedStudentIds = new Set();

  t.after(async () => {
    resetRecaptchaVerifierForTests();
    resetMailTransportForTests();
    resetRateLimitersForTests();
    clearStubEmails();
    if (server.closeAllConnections) server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    if (createdClassIds.length) {
      await prisma.class.deleteMany({ where: { id: { in: createdClassIds } } });
    }
    if (createdUserIds.length) {
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
    await prisma.$disconnect();
  });

  async function createFaculty(name, emailPrefix) {
    const email = `qa_s66_${emailPrefix}_${runId}@test.local`;
    const user = await prisma.user.create({
      data: {
        name,
        email,
        password: passwordHash,
        role: "FACULTY",
        emailVerified: true,
        emailVerifiedAt: new Date(),
        facultyProfile: { create: { name, department: "Information Technology", email } },
      },
    });
    createdUserIds.push(user.id);
    return user;
  }

  async function createStudent(name, emailPrefix, studentIdNum) {
    const email = `qa_s66_${emailPrefix}_${runId}@test.local`;
    const parts = name.trim().split(/\s+/);
    const firstName = parts[0] || name;
    const lastName = parts[parts.length - 1] || name;
    const user = await prisma.user.create({
      data: {
        name,
        email,
        password: passwordHash,
        role: "STUDENT",
        emailVerified: true,
        emailVerifiedAt: new Date(),
        studentProfile: {
          create: {
            name,
            firstName,
            lastName,
            sortKey: `${lastName.toUpperCase()} ${firstName.toUpperCase()}`,
            studentId: studentIdNum,
            email,
            program: "BSIT",
            section: "3A",
            address: "Tacloban City",
            photo: SAMPLE_PHOTO,
          },
        },
      },
      include: { studentProfile: true },
    });
    createdUserIds.push(user.id);
    return user;
  }

  const [fac1, fac2] = await Promise.all([
    createFaculty("qa_S66 Faculty One", "fac1"),
    createFaculty("qa_S66 Faculty Two", "fac2"),
  ]);

  const [id1, id2, idDrop, idUnjoined, ...formulaIds] = await allocStudentIds(10, usedStudentIds);
  const [stu1, stu2, stuDropped] = await Promise.all([
    createStudent("qa_Alice Student", "stu1", id1),
    createStudent("qa_Bob Peer", "stu2", id2),
    createStudent("qa_Dropped Carl", "studrop", idDrop),
  ]);

  const [fac1Cookie, fac2Cookie, stu1Cookie] = await Promise.all([
    loginCookie(baseUrl, fac1.email, password),
    loginCookie(baseUrl, fac2.email, password),
    loginCookie(baseUrl, stu1.email, password),
  ]);

  // Shared rich class for STU-01..03 and EXP-01..03
  const richClass = await prisma.class.create({
    data: {
      facultyId: fac1.id,
      sectionName: "qa_S66 Rich 3A",
      courseCode: "IT 166",
      courseTitle: "qa_Systems Integration",
      classCode: `S66R${runId}`.toUpperCase().slice(0, 12),
      description: "Main export and student dashboard test class",
      schedule: "Mon & Wed · 1:00 PM – 2:30 PM",
      projects: {
        create: [
          { type: "MIDTERM", maxScore: 100 },
          { type: "FINALS", maxScore: 100 },
        ],
      },
    },
    include: { projects: true },
  });
  createdClassIds.push(richClass.id);

  // Also create pendingClass, droppedClass, declinedClass, unrelatedClass for STU-01..03
  const [pendingClass, droppedClass, declinedClass, unrelatedClass] = await Promise.all([
    prisma.class.create({
      data: {
        facultyId: fac1.id,
        sectionName: "qa_S66 Pending",
        courseCode: "IT 167",
        classCode: `S66P${runId}`.toUpperCase().slice(0, 12),
      },
    }),
    prisma.class.create({
      data: {
        facultyId: fac2.id,
        sectionName: "qa_S66 Dropped",
        courseCode: "IT 168",
        classCode: `S66D${runId}`.toUpperCase().slice(0, 12),
        projects: { create: [{ type: "MIDTERM", maxScore: 50 }] },
      },
      include: { projects: true },
    }),
    prisma.class.create({
      data: {
        facultyId: fac2.id,
        sectionName: "qa_S66 Declined",
        courseCode: "IT 169",
        classCode: `S66N${runId}`.toUpperCase().slice(0, 12),
      },
    }),
    prisma.class.create({
      data: {
        facultyId: fac2.id,
        sectionName: "qa_S66 Unrelated",
        courseCode: "IT 170",
        classCode: `S66U${runId}`.toUpperCase().slice(0, 12),
      },
    }),
  ]);
  createdClassIds.push(pendingClass.id, droppedClass.id, declinedClass.id, unrelatedClass.id);

  const dropTimestamp = new Date("2026-10-20T08:00:00.000Z");

  // Roster entries in richClass: stu1 (active), stu2 (active), stuDropped (droppedAt), plus 1 UNJOINED roster entry
  await prisma.classRoster.createMany({
    data: [
      { classId: richClass.id, studentId: stu1.studentProfile.studentId, studentName: stu1.name, firstName: "qa_Alice", lastName: "Student", sortKey: "STUDENT QA_ALICE" },
      { classId: richClass.id, studentId: stu2.studentProfile.studentId, studentName: stu2.name, firstName: "qa_Bob", lastName: "Peer", sortKey: "PEER QA_BOB" },
      { classId: richClass.id, studentId: stuDropped.studentProfile.studentId, studentName: stuDropped.name, firstName: "qa_Dropped", lastName: "Carl", sortKey: "CARL QA_DROPPED", droppedAt: dropTimestamp },
      { classId: richClass.id, studentId: idUnjoined, studentName: "qa_Prelisted Unjoined", firstName: "qa_Prelisted", lastName: "Unjoined", sortKey: "UNJOINED QA_PRELISTED" },
    ],
  });

  // Enrollments
  await prisma.classEnrollment.createMany({
    data: [
      { classId: richClass.id, studentProfileId: stu1.studentProfile.id, status: "APPROVED", joinedAt: new Date("2026-10-01T00:00:00Z") },
      { classId: richClass.id, studentProfileId: stu2.studentProfile.id, status: "APPROVED", joinedAt: new Date("2026-10-02T00:00:00Z") },
      { classId: richClass.id, studentProfileId: stuDropped.studentProfile.id, status: "DROPPED", droppedAt: dropTimestamp, joinedAt: new Date("2026-10-03T00:00:00Z") },
      { classId: pendingClass.id, studentProfileId: stu1.studentProfile.id, status: "PENDING" },
      { classId: droppedClass.id, studentProfileId: stu1.studentProfile.id, status: "DROPPED", droppedAt: dropTimestamp },
      { classId: declinedClass.id, studentProfileId: stu1.studentProfile.id, status: "DECLINED" },
    ],
  });

  // Populate richClass coursework across 2 dates
  const day1 = new Date("2026-10-10T00:00:00.000Z");
  const day2 = new Date("2026-10-12T00:00:00.000Z");
  const [sess1, sess2, dropSess] = await Promise.all([
    prisma.classSession.create({ data: { classId: richClass.id, date: day1, startedAt: day1 } }),
    prisma.classSession.create({ data: { classId: richClass.id, date: day2, startedAt: day2 } }),
    prisma.classSession.create({ data: { classId: droppedClass.id, date: day1, startedAt: day1 } }),
  ]);

  // Attendance in richClass:
  // stu1: PRESENT day1, ABSENT day2 (1/2 = 50%)
  // stu2: LATE day1, PRESENT day2
  // stuDropped: PRESENT day1
  await prisma.attendanceRecord.createMany({
    data: [
      { sessionId: sess1.id, studentId: stu1.studentProfile.id, status: "PRESENT" },
      { sessionId: sess2.id, studentId: stu1.studentProfile.id, status: "ABSENT" },
      { sessionId: sess1.id, studentId: stu2.studentProfile.id, status: "LATE" },
      { sessionId: sess2.id, studentId: stu2.studentProfile.id, status: "PRESENT" },
      { sessionId: sess1.id, studentId: stuDropped.studentProfile.id, status: "PRESENT" },
      { sessionId: dropSess.id, studentId: stu1.studentProfile.id, status: "PRESENT" },
    ],
  });

  // Recitation: stu1=4 (day1) & 5 (day2) -> avg 4.5 / 5; stu2=2 (day1) & null/ungraded (day2); stuDropped=3 (day1)
  await prisma.recitationLog.createMany({
    data: [
      { sessionId: sess1.id, studentId: stu1.studentProfile.id, method: "RANDOM", score: 4 },
      { sessionId: sess2.id, studentId: stu1.studentProfile.id, method: "WEIGHTED", score: 5 },
      { sessionId: sess1.id, studentId: stu2.studentProfile.id, method: "RANDOM", score: 2 },
      { sessionId: sess2.id, studentId: stu2.studentProfile.id, method: "WEIGHTED", score: null },
      { sessionId: sess1.id, studentId: stuDropped.studentProfile.id, method: "RANDOM", score: 3 },
      { sessionId: dropSess.id, studentId: stu1.studentProfile.id, method: "RANDOM", score: 5 },
    ],
  });

  // Activity: act1 (maxScore 50) -> stu1=40 (80%), stu2=50, stuDropped=35; act2 -> stu1 isAbsent=true (score: null) -> excluded from possible!
  const [act1, act2, dropAct] = await Promise.all([
    prisma.activity.create({ data: { classId: richClass.id, sessionId: sess1.id, title: "Lab 1", maxScore: 50 } }),
    prisma.activity.create({ data: { classId: richClass.id, sessionId: sess2.id, title: "Lab 2", maxScore: 50 } }),
    prisma.activity.create({ data: { classId: droppedClass.id, sessionId: dropSess.id, title: "Old Activity", maxScore: 20 } }),
  ]);
  await prisma.activityScore.createMany({
    data: [
      { activityId: act1.id, studentId: stu1.studentProfile.id, score: 40, isAbsent: false },
      { activityId: act2.id, studentId: stu1.studentProfile.id, score: null, isAbsent: true },
      { activityId: act1.id, studentId: stu2.studentProfile.id, score: 50, isAbsent: false },
      { activityId: act2.id, studentId: stu2.studentProfile.id, score: 45, isAbsent: false },
      { activityId: act1.id, studentId: stuDropped.studentProfile.id, score: 35, isAbsent: false },
      { activityId: dropAct.id, studentId: stu1.studentProfile.id, score: 18, isAbsent: false },
    ],
  });

  // Projects in richClass: Midterm & Finals
  const richMid = richClass.projects.find((p) => p.type === "MIDTERM");
  const richFin = richClass.projects.find((p) => p.type === "FINALS");
  await prisma.projectScore.createMany({
    data: [
      { projectId: richMid.id, studentId: stu1.studentProfile.id, sessionId: sess1.id, score: 88, isAbsent: false },
      { projectId: richFin.id, studentId: stu1.studentProfile.id, sessionId: sess2.id, score: 92, isAbsent: false },
      { projectId: richMid.id, studentId: stu2.studentProfile.id, sessionId: sess1.id, score: 75, isAbsent: false },
      { projectId: richMid.id, studentId: stuDropped.studentProfile.id, sessionId: sess1.id, score: 70, isAbsent: false },
      { projectId: droppedClass.projects[0].id, studentId: stu1.studentProfile.id, sessionId: dropSess.id, score: 44, isAbsent: false },
    ],
  });

  // Quizzes: quiz1 (totalItems=20) on day1 -> stu1=17 (85%), stu2=14, stuDropped=15; quiz2 (totalItems=10) on day2 -> stu1 isAbsent=true
  const [quiz1, quiz2, dropQuiz] = await Promise.all([
    prisma.quizSession.create({ data: { classId: richClass.id, title: "Quiz 1", totalItems: 20, date: day1 } }),
    prisma.quizSession.create({ data: { classId: richClass.id, title: "Quiz 2", totalItems: 10, date: day2 } }),
    prisma.quizSession.create({ data: { classId: droppedClass.id, title: "Old Quiz", totalItems: 10, date: day1 } }),
  ]);
  await prisma.quizScore.createMany({
    data: [
      { sessionId: quiz1.id, studentId: stu1.studentProfile.id, score: 17, isAbsent: false },
      { sessionId: quiz2.id, studentId: stu1.studentProfile.id, score: null, isAbsent: true },
      { sessionId: quiz1.id, studentId: stu2.studentProfile.id, score: 14, isAbsent: false },
      { sessionId: quiz2.id, studentId: stu2.studentProfile.id, score: 9, isAbsent: false },
      { sessionId: quiz1.id, studentId: stuDropped.studentProfile.id, score: 15, isAbsent: false },
      { sessionId: dropQuiz.id, studentId: stu1.studentProfile.id, score: 9, isAbsent: false },
    ],
  });

  await t.test("STU-01: Student dashboard classes list & summaries", async () => {
    const res = await jsonReq(baseUrl, "GET", "/api/student/classes", { cookie: stu1Cookie });
    assert.equal(res.status, 200);
    const list = res.data.classes;
    const ids = new Set(list.map((c) => c.id));

    assert.ok(ids.has(richClass.id), "APPROVED class must appear");
    assert.ok(ids.has(pendingClass.id), "PENDING class must appear");
    assert.ok(ids.has(droppedClass.id), "DROPPED class must appear");
    assert.ok(!ids.has(declinedClass.id), "DECLINED class must not appear on student dashboard");
    assert.ok(!ids.has(unrelatedClass.id), "Unenrolled class must not appear");

    const rEntry = list.find((c) => c.id === richClass.id);
    assert.equal(rEntry.enrollmentStatus, "APPROVED");
    assert.equal(rEntry.recordSummary.attendance, "50%");
    assert.equal(rEntry.recordSummary.recitation, "4.5 / 5");
    assert.equal(rEntry.recordSummary.activities, "80%");
    assert.equal(rEntry.recordSummary.quiz, "85%");

    const pEntry = list.find((c) => c.id === pendingClass.id);
    assert.equal(pEntry.enrollmentStatus, "PENDING");
    assert.deepEqual(pEntry.recordSummary, {
      attendance: "—",
      recitation: "—",
      activities: "—",
      quiz: "—",
    });

    const dEntry = list.find((c) => c.id === droppedClass.id);
    assert.equal(dEntry.enrollmentStatus, "DROPPED");
    assert.ok(dEntry.droppedAt);
    assert.equal(dEntry.recordSummary.attendance, "100%");
    assert.equal(dEntry.recordSummary.recitation, "5.0 / 5");
    assert.equal(dEntry.recordSummary.activities, "90%");
    assert.equal(dEntry.recordSummary.quiz, "90%");
  });

  await t.test("STU-02: Student class record view & strict data isolation", async () => {
    // Pass forged query params trying to impersonate stu2
    const res = await jsonReq(
      baseUrl,
      "GET",
      `/api/student/classes/${richClass.id}/records?studentId=${stu2.studentProfile.id}&studentProfileId=${stu2.studentProfile.id}`,
      { cookie: stu1Cookie },
    );
    assert.equal(res.status, 200);
    assert.equal(res.data.student.id, stu1.studentProfile.id);
    assert.equal(res.data.student.studentId, stu1.studentProfile.studentId);

    // Every attendance, recitation, activity, project, and quiz record must match only stu1's data
    assert.equal(res.data.attendance.length, 2);
    assert.equal(res.data.recitations.length, 2);
    assert.equal(res.data.activities.length, 2);
    assert.equal(res.data.projects.length, 2);
    assert.equal(res.data.quizzes.length, 2);

    const lab1Score = res.data.activities.find((a) => a.activity.title === "Lab 1");
    assert.equal(lab1Score.score, 40, "Must return stu1 score (40), not stu2 score (50)");

    // Non-enrolled or declined classes return 404
    const unauthClassRes = await jsonReq(
      baseUrl,
      "GET",
      `/api/student/classes/${unrelatedClass.id}/records`,
      { cookie: stu1Cookie },
    );
    assert.equal(unauthClassRes.status, 404);

    const declinedRes = await jsonReq(
      baseUrl,
      "GET",
      `/api/student/classes/${declinedClass.id}/records`,
      { cookie: stu1Cookie },
    );
    assert.equal(declinedRes.status, 404);
  });

  await t.test("STU-03: Dropped student historical record retention & read-only enforcement", async () => {
    const res = await jsonReq(
      baseUrl,
      "GET",
      `/api/student/classes/${droppedClass.id}/records`,
      { cookie: stu1Cookie },
    );
    assert.equal(res.status, 200);
    assert.equal(res.data.class.enrollmentStatus, "DROPPED");
    assert.ok(res.data.class.droppedAt);
    assert.equal(res.data.attendance.length, 1);
    assert.equal(res.data.recitations[0].score, 5);
    assert.equal(res.data.activities[0].score, 18);
    assert.equal(res.data.projects[0].score, 44);
    assert.equal(res.data.quizzes[0].score, 9);

    // Faculty cannot mark attendance on dropped student in that class (409)
    const facAttempt = await jsonReq(
      baseUrl,
      "PUT",
      `/api/sessions/${dropSess.id}/attendance/${stu1.studentProfile.id}`,
      { cookie: fac2Cookie, body: { status: "PRESENT" } },
    );
    assert.equal(facAttempt.status, 409);
  });

  await t.test("EXP-02a: Excel & CSV cell-by-cell DB parity across all modules", async () => {
    const [xlsxRes, csvRes] = await Promise.all([
      fetch(`${baseUrl}/api/classes/${richClass.id}/export/excel`, { headers: { Cookie: fac1Cookie } }),
      fetch(`${baseUrl}/api/classes/${richClass.id}/export/csv`, { headers: { Cookie: fac1Cookie } }),
    ]);
    assert.equal(xlsxRes.status, 200);
    assert.match(xlsxRes.headers.get("content-type") || "", /spreadsheetml\.sheet/);
    assert.equal(csvRes.status, 200);
    assert.match(csvRes.headers.get("content-type") || "", /text\/csv/);

    const xlsxBuf = Buffer.from(await xlsxRes.arrayBuffer());
    const wb = XLSX.read(xlsxBuf, { type: "buffer" });
    assert.deepEqual(wb.SheetNames, [
      "Class Information",
      "Student List",
      "Attendance",
      "Recitation",
      "Activities",
      "Projects",
      "Quiz",
    ]);

    const csvBuf = Buffer.from(await csvRes.arrayBuffer());
    assert.equal(csvBuf.subarray(0, 3).toString("hex"), "efbbbf", "CSV must start with UTF-8 BOM");
    const csvSections = splitCsvSections(csvBuf.toString("utf8"));

    // Verify Class Information parity
    const infoRows = XLSX.utils.sheet_to_json(wb.Sheets["Class Information"], { header: 1, defval: "" });
    const infoMap = new Map(infoRows.map((r) => [String(r[0]), String(r[1])]));
    assert.equal(infoMap.get("Class name"), "qa_S66 Rich 3A");
    assert.equal(infoMap.get("Student count"), "2");

    // Verify Student List sheet (only APPROVED: stu1 & stu2, not dropped/unjoined)
    const slRows = XLSX.utils.sheet_to_json(wb.Sheets["Student List"], { header: 1, defval: "" });
    assert.equal(slRows.length, 3); // header + 2 approved students
    const slIds = new Set(slRows.slice(1).map((r) => String(r[0])));
    assert.ok(slIds.has(stu1.studentProfile.studentId));
    assert.ok(slIds.has(stu2.studentProfile.studentId));
    assert.ok(!slIds.has(stuDropped.studentProfile.studentId));
    assert.ok(!slIds.has(idUnjoined));

    const rowById = (rows, targetId) => rows.find((r) => String(r[0]) === targetId);
    const d1Label = dateLabel(day1);
    const d2Label = dateLabel(day2);

    // Attendance sheet + CSV parity (incl. Dropped section!)
    const attXlsx = XLSX.utils.sheet_to_json(wb.Sheets.Attendance, { header: 1, defval: "" });
    const attCsv = csvSections.get("Attendance");
    assert.deepEqual(attXlsx[0], ["Student ID", "Student Name", d1Label, d2Label]);
    assert.deepEqual(attCsv[0], attXlsx[0]);
    assert.deepEqual(rowById(attXlsx, stu1.studentProfile.studentId), [
      stu1.studentProfile.studentId,
      stu1.name,
      "Present",
      "Absent",
    ]);
    assert.deepEqual(rowById(attXlsx, stu2.studentProfile.studentId), [
      stu2.studentProfile.studentId,
      stu2.name,
      "Late",
      "Present",
    ]);
    assert.ok(attXlsx.some((r) => r[0] === "Dropped"));
    assert.deepEqual(rowById(attXlsx, stuDropped.studentProfile.studentId), [
      stuDropped.studentProfile.studentId,
      stuDropped.name,
      "Present",
      "",
    ]);
    assert.deepEqual(rowById(attCsv, stu1.studentProfile.studentId), rowById(attXlsx, stu1.studentProfile.studentId));

    // Recitation parity (null -> "")
    const recXlsx = XLSX.utils.sheet_to_json(wb.Sheets.Recitation, { header: 1, defval: "" });
    const recCsv = csvSections.get("Recitation");
    assert.deepEqual(rowById(recXlsx, stu1.studentProfile.studentId), [stu1.studentProfile.studentId, stu1.name, 4, 5]);
    assert.deepEqual(rowById(recXlsx, stu2.studentProfile.studentId), [stu2.studentProfile.studentId, stu2.name, 2, ""]);
    assert.deepEqual(rowById(recCsv, stu1.studentProfile.studentId), [stu1.studentProfile.studentId, stu1.name, "4", "5"]);

    // Activities parity (Absent auto-flag renders "Absent")
    const actXlsx = XLSX.utils.sheet_to_json(wb.Sheets.Activities, { header: 1, defval: "" });
    assert.deepEqual(rowById(actXlsx, stu1.studentProfile.studentId), [stu1.studentProfile.studentId, stu1.name, 40, "Absent"]);
    assert.deepEqual(rowById(actXlsx, stu2.studentProfile.studentId), [stu2.studentProfile.studentId, stu2.name, 50, 45]);

    // Projects parity (Midterm Project, Finals Project)
    const projXlsx = XLSX.utils.sheet_to_json(wb.Sheets.Projects, { header: 1, defval: "" });
    assert.deepEqual(projXlsx[0], ["Student ID", "Student Name", "Midterm Project", "Finals Project"]);
    assert.deepEqual(rowById(projXlsx, stu1.studentProfile.studentId), [stu1.studentProfile.studentId, stu1.name, 88, 92]);
    assert.deepEqual(rowById(projXlsx, stu2.studentProfile.studentId), [stu2.studentProfile.studentId, stu2.name, 75, ""]);

    // Quizzes parity
    const quizXlsx = XLSX.utils.sheet_to_json(wb.Sheets.Quiz, { header: 1, defval: "" });
    assert.deepEqual(quizXlsx[0], [
      "Student ID",
      "Student Name",
      `Quiz 1 - ${d1Label} (/20)`,
      `Quiz 2 - ${d2Label} (/10)`,
    ]);
    assert.deepEqual(rowById(quizXlsx, stu1.studentProfile.studentId), [stu1.studentProfile.studentId, stu1.name, 17, "Absent"]);
    assert.deepEqual(rowById(quizXlsx, stu2.studentProfile.studentId), [stu2.studentProfile.studentId, stu2.name, 14, 9]);
  });

  await t.test("EXP-01a: Export summary counts parity with DB (approved students & cross-faculty 404)", async () => {
    const [sumRes, nonOwnerRes] = await Promise.all([
      jsonReq(baseUrl, "GET", `/api/classes/${richClass.id}/export-summary`, { cookie: fac1Cookie }),
      jsonReq(baseUrl, "GET", `/api/classes/${richClass.id}/export-summary`, { cookie: fac2Cookie }),
    ]);

    assert.equal(nonOwnerRes.status, 404);
    assert.equal(sumRes.status, 200);

    const s = sumRes.data;
    const approvedCountInDb = await prisma.classEnrollment.count({
      where: { classId: richClass.id, status: "APPROVED" },
    });

    assert.equal(s.sessions, 2);
    assert.equal(s.recitations, 5);
    assert.equal(s.activities, 2);
    assert.equal(s.projectScores, 4);
    assert.equal(s.quizzes, 2);
    assert.equal(
      s.students,
      approvedCountInDb,
      `export-summary.students (${s.students}) must match approved enrollment count in DB (${approvedCountInDb})`,
    );
  });

  await t.test("EXP-01b: Opening class deck without starting attendance must not inflate export session counts", async () => {
    const deckRes = await jsonReq(baseUrl, "GET", `/api/classes/${richClass.id}/deck`, { cookie: fac1Cookie });
    assert.equal(deckRes.status, 200);
    const sumRes = await jsonReq(baseUrl, "GET", `/api/classes/${richClass.id}/export-summary`, { cookie: fac1Cookie });
    assert.equal(sumRes.status, 200);

    assert.deepEqual(deckRes.data.exportCounts, {
      sessions: 2,
      recitations: 5,
      activities: 2,
      projectScores: 4,
      quizzes: 2,
    });
    assert.equal(sumRes.data.sessions, 2);
  });

  await t.test("EXP-02b: Empty unstarted today session created by deck must not appear in Excel/CSV headers", async () => {
    const [xlsxRes, csvRes] = await Promise.all([
      fetch(`${baseUrl}/api/classes/${richClass.id}/export/excel?types=attendance,recitation`, {
        headers: { Cookie: fac1Cookie },
      }),
      fetch(`${baseUrl}/api/classes/${richClass.id}/export/csv?types=attendance,recitation`, {
        headers: { Cookie: fac1Cookie },
      }),
    ]);
    assert.equal(xlsxRes.status, 200);
    assert.equal(csvRes.status, 200);

    const wb = XLSX.read(Buffer.from(await xlsxRes.arrayBuffer()), { type: "buffer" });
    const attXlsx = XLSX.utils.sheet_to_json(wb.Sheets.Attendance, { header: 1, defval: "" });
    const csvSections = splitCsvSections(Buffer.from(await csvRes.arrayBuffer()).toString("utf8"));
    const d1Label = dateLabel(day1);
    const d2Label = dateLabel(day2);
    assert.deepEqual(attXlsx[0], ["Student ID", "Student Name", d1Label, d2Label]);
    assert.deepEqual(csvSections.get("Attendance")[0], ["Student ID", "Student Name", d1Label, d2Label]);
  });

  await t.test("EXP-03: Selective export ?types= query filter", async () => {
    const [xlsxRes, csvRes] = await Promise.all([
      fetch(`${baseUrl}/api/classes/${richClass.id}/export/excel?types=attendance,quizzes`, {
        headers: { Cookie: fac1Cookie },
      }),
      fetch(`${baseUrl}/api/classes/${richClass.id}/export/csv?types=activities`, {
        headers: { Cookie: fac1Cookie },
      }),
    ]);
    assert.equal(xlsxRes.status, 200);
    assert.equal(csvRes.status, 200);

    const wb = XLSX.read(Buffer.from(await xlsxRes.arrayBuffer()), { type: "buffer" });
    assert.deepEqual(wb.SheetNames, ["Attendance", "Quiz"]);

    const csvSections = splitCsvSections(Buffer.from(await csvRes.arrayBuffer()).toString("utf8"));
    assert.deepEqual([...csvSections.keys()], ["Activities"]);
  });

  await t.test("EXP-04: Empty class export edge case", async () => {
    const emptyClass = await prisma.class.create({
      data: {
        facultyId: fac1.id,
        sectionName: "qa_S66 Empty",
        courseCode: "IT 199",
        classCode: `S66E${runId}`.toUpperCase().slice(0, 12),
      },
    });
    createdClassIds.push(emptyClass.id);

    const [xlsxRes, csvRes] = await Promise.all([
      fetch(`${baseUrl}/api/classes/${emptyClass.id}/export/excel`, { headers: { Cookie: fac1Cookie } }),
      fetch(`${baseUrl}/api/classes/${emptyClass.id}/export/csv`, { headers: { Cookie: fac1Cookie } }),
    ]);
    assert.equal(xlsxRes.status, 200);
    assert.equal(csvRes.status, 200);

    const wb = XLSX.read(Buffer.from(await xlsxRes.arrayBuffer()), { type: "buffer" });
    assert.equal(wb.SheetNames.length, 7);
    const info = new Map(XLSX.utils.sheet_to_json(wb.Sheets["Class Information"], { header: 1 }).map((r) => [String(r[0]), String(r[1])]));
    assert.equal(info.get("Student count"), "0");
    assert.equal(XLSX.utils.sheet_to_json(wb.Sheets["Student List"], { header: 1 }).length, 1);

    const csvBuf = Buffer.from(await csvRes.arrayBuffer());
    assert.equal(csvBuf.subarray(0, 3).toString("hex"), "efbbbf");
    const sections = splitCsvSections(csvBuf.toString("utf8"));
    assert.equal(sections.size, 7);
    assert.equal(sections.get("Student List").length, 1);
  });

  await t.test("EXP-05: Formula injection & special character sanitization", async () => {
    const injClass = await prisma.class.create({
      data: {
        facultyId: fac1.id,
        sectionName: "=HYPERLINK(\"http://evil\",\"qa_Inj\")",
        classCode: `S66I${runId}`.toUpperCase().slice(0, 12),
      },
    });
    createdClassIds.push(injClass.id);

    const trickyNames = [
      "=SUM(A1)",
      "+cmd|'/C calc'!A0",
      "-1+1",
      "@test",
      'Dela Cruz, María José "MJ"',
    ];
    const trickyStudents = await Promise.all(
      trickyNames.map((n, idx) => createStudent(n, `inj${idx}`, formulaIds[idx])),
    );
    await prisma.classEnrollment.createMany({
      data: trickyStudents.map((u) => ({
        classId: injClass.id,
        studentProfileId: u.studentProfile.id,
        status: "APPROVED",
      })),
    });

    const [xlsxRes, csvRes] = await Promise.all([
      fetch(`${baseUrl}/api/classes/${injClass.id}/export/excel`, { headers: { Cookie: fac1Cookie } }),
      fetch(`${baseUrl}/api/classes/${injClass.id}/export/csv`, { headers: { Cookie: fac1Cookie } }),
    ]);
    assert.equal(xlsxRes.status, 200);
    assert.equal(csvRes.status, 200);

    const wb = XLSX.read(Buffer.from(await xlsxRes.arrayBuffer()), { type: "buffer" });
    const slRows = XLSX.utils.sheet_to_json(wb.Sheets["Student List"], { header: 1, defval: "" });
    const slNames = slRows.slice(1).map((r) => String(r[1]));
    for (const prefix of ["'=SUM(A1)", "'+cmd|'/C calc'!A0", "'-1+1", "'@test"]) {
      assert.ok(slNames.includes(prefix), `Excel Student List must escape formula value as ${prefix}`);
    }
    assert.ok(slNames.includes('Dela Cruz, María José "MJ"'), "Excel must preserve commas, quotes, and Unicode accents");

    const infoMap = new Map(XLSX.utils.sheet_to_json(wb.Sheets["Class Information"], { header: 1 }).map((r) => [String(r[0]), String(r[1])]));
    assert.ok(infoMap.get("Class name").startsWith("'="), "Class Information sectionName formula must be prefixed with apostrophe");

    const csvText = Buffer.from(await csvRes.arrayBuffer()).toString("utf8");
    const csvSections = splitCsvSections(csvText);
    const csvSlRows = csvSections.get("Student List");
    assert.equal(csvSlRows.length, 6); // header + 5 students
    csvSlRows.forEach((row) => assert.equal(row.length, 6, "Commas/quotes inside names must not split CSV columns"));
    const csvNames = csvSlRows.slice(1).map((r) => r[1]);
    assert.ok(csvNames.includes("'=SUM(A1)"));
    assert.ok(csvNames.includes("'+cmd|'/C calc'!A0"));
    assert.ok(csvNames.includes("'-1+1"));
    assert.ok(csvNames.includes("'@test"));
    assert.ok(csvNames.includes('Dela Cruz, María José "MJ"'));
  });

  await t.test("EXP-06: High-volume export (60 students × 20 sessions)", async () => {
    const hvClass = await prisma.class.create({
      data: {
        facultyId: fac1.id,
        sectionName: "qa_S66 Big 60x20",
        classCode: `S66B${runId}`.toUpperCase().slice(0, 12),
      },
    });
    createdClassIds.push(hvClass.id);

    const hvIds = await allocStudentIds(60, usedStudentIds);
    const hvSpecs = hvIds.map((studentId, i) => {
      const userId = crypto.randomUUID();
      const profileId = crypto.randomUUID();
      createdUserIds.push(userId);
      const email = `qa_s66_hv_${i}_${runId}@test.local`;
      const num = String(i + 1).padStart(2, "0");
      return {
        userId,
        profileId,
        studentId,
        email,
        name: `qa_Student ${num}`,
        firstName: "qa_Student",
        lastName: `S${num}`,
        sortKey: `S${num} QA_STUDENT`,
      };
    });

    await prisma.user.createMany({
      data: hvSpecs.map((s) => ({
        id: s.userId,
        name: s.name,
        email: s.email,
        password: passwordHash,
        role: "STUDENT",
        emailVerified: true,
      })),
    });
    await prisma.studentProfile.createMany({
      data: hvSpecs.map((s) => ({
        id: s.profileId,
        userId: s.userId,
        name: s.name,
        firstName: s.firstName,
        lastName: s.lastName,
        sortKey: s.sortKey,
        studentId: s.studentId,
        email: s.email,
        photo: SAMPLE_PHOTO,
      })),
    });
    await prisma.classEnrollment.createMany({
      data: hvSpecs.map((s) => ({
        classId: hvClass.id,
        studentProfileId: s.profileId,
        status: "APPROVED",
      })),
    });

    const sessionsData = Array.from({ length: 20 }, (_, dayIdx) => {
      const d = new Date(Date.UTC(2026, 8, dayIdx + 1));
      return {
        id: crypto.randomUUID(),
        classId: hvClass.id,
        date: d,
        startedAt: d,
      };
    });
    await prisma.classSession.createMany({ data: sessionsData });

    const statuses = ["PRESENT", "LATE", "ABSENT"];
    const attendanceData = [];
    for (let sIdx = 0; sIdx < hvSpecs.length; sIdx += 1) {
      for (let dIdx = 0; dIdx < sessionsData.length; dIdx += 1) {
        attendanceData.push({
          sessionId: sessionsData[dIdx].id,
          studentId: hvSpecs[sIdx].profileId,
          status: statuses[(sIdx + dIdx) % 3],
        });
      }
    }
    await prisma.attendanceRecord.createMany({ data: attendanceData });

    const startMs = Date.now();
    const [xlsxRes, csvRes] = await Promise.all([
      fetch(`${baseUrl}/api/classes/${hvClass.id}/export/excel`, { headers: { Cookie: fac1Cookie } }),
      fetch(`${baseUrl}/api/classes/${hvClass.id}/export/csv`, { headers: { Cookie: fac1Cookie } }),
    ]);
    const elapsedMs = Date.now() - startMs;
    assert.equal(xlsxRes.status, 200);
    assert.equal(csvRes.status, 200);
    assert.ok(elapsedMs < 30_000, `High-volume export took too long: ${elapsedMs}ms`);

    const wb = XLSX.read(Buffer.from(await xlsxRes.arrayBuffer()), { type: "buffer" });
    const attSheet = XLSX.utils.sheet_to_json(wb.Sheets.Attendance, { header: 1, defval: "" });
    assert.equal(attSheet.length, 61, "Expected 1 header row + 60 student rows in Excel Attendance sheet");
    assert.equal(attSheet[0].length, 22, "Expected 2 identity cols + 20 session cols");

    const csvSections = splitCsvSections(Buffer.from(await csvRes.arrayBuffer()).toString("utf8"));
    const attCsv = csvSections.get("Attendance");
    assert.equal(attCsv.length, 61, "Expected 61 rows in CSV Attendance section");
    assert.equal(attCsv[0].length, 22, "Expected 22 cols in CSV Attendance section");
  });
});
