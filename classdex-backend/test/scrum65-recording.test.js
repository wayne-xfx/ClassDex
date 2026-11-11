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
const {
  app,
  resetRateLimitersForTests,
} = require("../index");
const { prisma } = require("../db");
const { manilaDate } = require("../src/utils/dates");
const { applyGracePeriod } = require("../attendance");
const { selectRecitationCandidate } = require("../recitation");
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

test("SCRUM-65: Recording Modules API Suite (REC-01..07, REC-09..11, REC-13..15, REC-17)", async (t) => {
  resetRateLimitersForTests();
  clearStubEmails();
  setRecaptchaVerifierForTests(async () => ({ success: true }));

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

  const [idA, idB, idC, idD, idE] = await allocStudentIds(5, usedStudentIds);

  const facUser = await prisma.user.create({
    data: {
      name: "qa_S65 Faculty",
      email: `qa_s65_fac_${runId}@test.local`,
      password: passwordHash,
      role: "FACULTY",
      emailVerified: true,
      facultyProfile: {
        create: {
          name: "qa_S65 Faculty",
          department: "Computer Science",
          email: `qa_s65_fac_${runId}@test.local`,
        },
      },
    },
  });
  createdUserIds.push(facUser.id);

  async function makeStudent(suffix, name, studentId, extra = {}) {
    const email = `qa_s65_${suffix}_${runId}@test.local`;
    const u = await prisma.user.create({
      data: {
        name,
        email,
        password: passwordHash,
        role: "STUDENT",
        emailVerified: true,
        studentProfile: {
          create: {
            name,
            studentId,
            email,
            program: "BSIT",
            section: "3A",
            photo: SAMPLE_PHOTO,
            firstName: extra.firstName || name.split(" ")[0],
            middleName: extra.middleName || null,
            lastName: extra.lastName || name.split(" ").slice(-1)[0],
            sortKey: extra.sortKey || name.toUpperCase(),
          },
        },
      },
      include: { studentProfile: true },
    });
    createdUserIds.push(u.id);
    return u;
  }

  const [stuA, stuB, stuC, stuD, stuE] = await Promise.all([
    makeStudent("a", "qa_Alpha One", idA, { firstName: "qa_Alpha", lastName: "One" }),
    makeStudent("b", "qa_Bravo Two", idB, { firstName: "qa_Bravo", lastName: "Two" }),
    makeStudent("c", "qa_Charlie Three", idC, { firstName: "qa_Charlie", lastName: "Three" }),
    makeStudent("d", "qa_Delta Four", idD, { firstName: "qa_Delta", lastName: "Four" }),
    makeStudent("e", "qa_Echo Five", idE, { firstName: "qa_Echo", lastName: "Five" }),
  ]);

  const facCookie = await loginCookie(baseUrl, facUser.email, password);
  const stuACookie = await loginCookie(baseUrl, stuA.email, password);

  async function createClassWithStudents(suffix, studentsList, options = {}) {
    const code = `Q65${suffix}${runId.slice(-4)}`.toUpperCase().slice(0, 14);
    const res = await jsonReq(baseUrl, "POST", "/api/classes", {
      cookie: facCookie,
      body: {
        sectionName: `qa_Section ${suffix}`,
        courseCode: `IT-${suffix}`,
        courseTitle: `qa_Course ${suffix}`,
        classCode: code,
        scheduleDays: ["Mon", "Wed"],
        scheduleStartTime: "09:00",
        scheduleEndTime: "10:30",
        gracePeriodMinutes: options.gracePeriodMinutes ?? 15,
        recitationShuffleSeconds: options.recitationShuffleSeconds ?? 3,
      },
    });
    assert.equal(res.status, 201, `Create class failed: ${JSON.stringify(res.data)}`);
    const cls = res.data.class;
    createdClassIds.push(cls.id);

    for (const s of studentsList) {
      await prisma.classEnrollment.create({
        data: {
          classId: cls.id,
          studentProfileId: s.studentProfile.id,
          status: options.enrollmentStatus || "APPROVED",
        },
      });
    }
    return cls;
  }

  // Primary class used for attendance, activities, projects, quizzes, warnings
  const mainClass = await createClassWithStudents("MAIN", [stuA, stuB, stuC, stuD]);
  let mainSessionId;

  await t.test("REC-01: Today session creation & Manila timezone calendar boundary", async () => {
    // 2026-11-11 23:30 UTC === 2026-11-12 07:30 Asia/Manila
    const earlyMorningManila = manilaDate(new Date("2026-11-11T23:30:00.000Z"));
    assert.equal(earlyMorningManila.toISOString(), "2026-11-12T00:00:00.000Z");

    // 2026-11-11 15:59 UTC === 2026-11-11 23:59 Asia/Manila (still Nov 11)
    assert.equal(
      manilaDate(new Date("2026-11-11T15:59:59.000Z")).toISOString(),
      "2026-11-11T00:00:00.000Z",
    );
    // 2026-11-11 16:00 UTC === 2026-11-12 00:00 Asia/Manila (rolls over to Nov 12)
    assert.equal(
      manilaDate(new Date("2026-11-11T16:00:00.000Z")).toISOString(),
      "2026-11-12T00:00:00.000Z",
    );

    const concurrentDecks = await Promise.all([
      jsonReq(baseUrl, "GET", `/api/classes/${mainClass.id}/deck`, { cookie: facCookie }),
      jsonReq(baseUrl, "GET", `/api/classes/${mainClass.id}/deck`, { cookie: facCookie }),
      jsonReq(baseUrl, "GET", `/api/classes/${mainClass.id}/deck`, { cookie: facCookie }),
    ]);
    for (const deckRes of concurrentDecks) {
      assert.equal(deckRes.status, 200);
      assert.ok(deckRes.data.session?.id);
      assert.equal(deckRes.data.session.id, concurrentDecks[0].data.session.id);
      assert.equal(deckRes.data.session.startedAt, null);
    }

    const createRes = await jsonReq(baseUrl, "POST", `/api/classes/${mainClass.id}/sessions/today`, {
      cookie: facCookie,
    });
    assert.equal(createRes.status, 200);
    assert.ok(createRes.data.session?.id);
    assert.equal(createRes.data.session.date, manilaDate().toISOString());
    assert.equal(createRes.data.session.startedAt, null);
    mainSessionId = createRes.data.session.id;

    // Idempotent repeat without start keeps same session and startedAt = null
    const repeatRes = await jsonReq(baseUrl, "POST", `/api/classes/${mainClass.id}/sessions/today`, {
      cookie: facCookie,
    });
    assert.equal(repeatRes.status, 200);
    assert.equal(repeatRes.data.session.id, mainSessionId);
    assert.equal(repeatRes.data.session.startedAt, null);
  });

  await t.test("REC-02: Session clock starts on first mark & resets when unmarked", async () => {
    const emptyBulk = await jsonReq(baseUrl, "PUT", `/api/sessions/${mainSessionId}/attendance`, {
      cookie: facCookie,
      body: { updates: [] },
    });
    assert.equal(emptyBulk.status, 200);
    assert.equal(emptyBulk.data.sessionStartedAt, null);

    // Mark first student PRESENT -> starts session clock
    const firstMark = await jsonReq(
      baseUrl,
      "PUT",
      `/api/sessions/${mainSessionId}/attendance/${stuA.studentProfile.id}`,
      { cookie: facCookie, body: { status: "PRESENT" } },
    );
    assert.equal(firstMark.status, 200);
    assert.equal(firstMark.data.appliedStatus, "PRESENT");
    assert.ok(firstMark.data.sessionStartedAt, "startedAt should be set on first attendance mark");

    const dbStarted = await prisma.classSession.findUnique({ where: { id: mainSessionId } });
    assert.ok(dbStarted.startedAt instanceof Date);

    // Bulk unmark -> resets startedAt back to null
    const unmarkBulk = await jsonReq(baseUrl, "PUT", `/api/sessions/${mainSessionId}/attendance`, {
      cookie: facCookie,
      body: {
        updates: [{ studentId: stuA.studentProfile.id, status: "UNMARKED" }],
      },
    });
    assert.equal(unmarkBulk.status, 200);
    assert.equal(unmarkBulk.data.sessionStartedAt, null);

    const dbReset = await prisma.classSession.findUnique({ where: { id: mainSessionId } });
    assert.equal(dbReset.startedAt, null);
  });

  await t.test("REC-03: Grace period auto-Late cutoff & gracePeriodMinutes editing", async () => {
    // Pure boundary checks at exact deadline vs +1ms
    const baseStart = new Date("2026-11-11T09:00:00.000Z");
    assert.deepEqual(
      applyGracePeriod("PRESENT", baseStart, 15, baseStart.getTime() + 15 * 60_000),
      { appliedStatus: "PRESENT", lateOverride: false },
    );
    assert.deepEqual(
      applyGracePeriod("PRESENT", baseStart, 15, baseStart.getTime() + 15 * 60_000 + 1),
      { appliedStatus: "LATE", lateOverride: true },
    );

    // API E2E: set startedAt 10 minutes ago (within 15-min default grace)
    await prisma.classSession.update({
      where: { id: mainSessionId },
      data: { startedAt: new Date(Date.now() - 10 * 60_000) },
    });
    const markWithin = await jsonReq(
      baseUrl,
      "PUT",
      `/api/sessions/${mainSessionId}/attendance/${stuA.studentProfile.id}`,
      { cookie: facCookie, body: { status: "PRESENT" } },
    );
    assert.equal(markWithin.status, 200);
    assert.equal(markWithin.data.appliedStatus, "PRESENT");
    assert.equal(markWithin.data.lateOverride, false);

    // Backdate startedAt to 16 minutes ago (> 15-min grace) -> Student B becomes LATE
    await prisma.classSession.update({
      where: { id: mainSessionId },
      data: { startedAt: new Date(Date.now() - 16 * 60_000) },
    });
    const markAfter15 = await jsonReq(
      baseUrl,
      "PUT",
      `/api/sessions/${mainSessionId}/attendance/${stuB.studentProfile.id}`,
      { cookie: facCookie, body: { status: "PRESENT" } },
    );
    assert.equal(markAfter15.status, 200);
    assert.equal(markAfter15.data.appliedStatus, "LATE");
    assert.equal(markAfter15.data.lateOverride, true);

    // Expand grace period to 30m -> same 16m-old session now keeps Student C as PRESENT
    const editGrace = await jsonReq(baseUrl, "PATCH", `/api/classes/${mainClass.id}`, {
      cookie: facCookie,
      body: { gracePeriodMinutes: 30 },
    });
    assert.equal(editGrace.status, 200);
    assert.equal(editGrace.data.class.gracePeriodMinutes, 30);

    const markWithin30 = await jsonReq(
      baseUrl,
      "PUT",
      `/api/sessions/${mainSessionId}/attendance/${stuC.studentProfile.id}`,
      { cookie: facCookie, body: { status: "PRESENT" } },
    );
    assert.equal(markWithin30.status, 200);
    assert.equal(markWithin30.data.appliedStatus, "PRESENT");
    assert.equal(markWithin30.data.lateOverride, false);

    // Push startedAt to 31m ago -> now exceeds 30m grace -> Student D becomes LATE
    await prisma.classSession.update({
      where: { id: mainSessionId },
      data: { startedAt: new Date(Date.now() - 31 * 60_000) },
    });
    const markAfter30 = await jsonReq(
      baseUrl,
      "PUT",
      `/api/sessions/${mainSessionId}/attendance/${stuD.studentProfile.id}`,
      { cookie: facCookie, body: { status: "PRESENT" } },
    );
    assert.equal(markAfter30.status, 200);
    assert.equal(markAfter30.data.appliedStatus, "LATE");
    assert.equal(markAfter30.data.lateOverride, true);
  });

  await t.test("REC-04: Late & Absent remain editable after grace period", async () => {
    const toAbsent = await jsonReq(
      baseUrl,
      "PUT",
      `/api/sessions/${mainSessionId}/attendance/${stuB.studentProfile.id}`,
      { cookie: facCookie, body: { status: "ABSENT" } },
    );
    assert.equal(toAbsent.status, 200);
    assert.equal(toAbsent.data.appliedStatus, "ABSENT");

    const backToLate = await jsonReq(
      baseUrl,
      "PUT",
      `/api/sessions/${mainSessionId}/attendance/${stuB.studentProfile.id}`,
      { cookie: facCookie, body: { status: "LATE" } },
    );
    assert.equal(backToLate.status, 200);
    assert.equal(backToLate.data.appliedStatus, "LATE");

    // Pending student rejected cleanly (409)
    await prisma.classEnrollment.create({
      data: { classId: mainClass.id, studentProfileId: stuE.studentProfile.id, status: "PENDING" },
    });
    const pendingRes = await jsonReq(
      baseUrl,
      "PUT",
      `/api/sessions/${mainSessionId}/attendance/${stuE.studentProfile.id}`,
      { cookie: facCookie, body: { status: "ABSENT" } },
    );
    assert.equal(pendingRes.status, 409);
    await prisma.classEnrollment.deleteMany({
      where: { classId: mainClass.id, studentProfileId: stuE.studentProfile.id },
    });
  });

  await t.test("REC-05: Bulk attendance API validation & cumulative absentCount", async () => {
    const badArray = await jsonReq(baseUrl, "PUT", `/api/sessions/${mainSessionId}/attendance`, {
      cookie: facCookie,
      body: { updates: "invalid" },
    });
    assert.equal(badArray.status, 400);

    const badStatus = await jsonReq(baseUrl, "PUT", `/api/sessions/${mainSessionId}/attendance`, {
      cookie: facCookie,
      body: { updates: [{ studentId: stuA.studentProfile.id, status: "EXCUSED" }] },
    });
    assert.equal(badStatus.status, 400);

    // Seed 1 historical session where stuC was ABSENT
    const pastDate = new Date(Date.now() - 3 * 86_400_000);
    pastDate.setUTCHours(0, 0, 0, 0);
    await prisma.classSession.create({
      data: {
        classId: mainClass.id,
        date: pastDate,
        startedAt: pastDate,
        attendance: {
          create: [{ studentId: stuC.studentProfile.id, status: "ABSENT" }],
        },
      },
    });

    // Reset session start to 2m ago so bulk PRESENT stays PRESENT
    await prisma.classSession.update({
      where: { id: mainSessionId },
      data: { startedAt: new Date(Date.now() - 2 * 60_000) },
    });

    const bulkValid = await jsonReq(baseUrl, "PUT", `/api/sessions/${mainSessionId}/attendance`, {
      cookie: facCookie,
      body: {
        updates: [
          { studentId: stuA.studentProfile.id, status: "PRESENT" },
          { studentId: stuB.studentProfile.id, status: "LATE" },
          { studentId: stuC.studentProfile.id, status: "ABSENT" },
          { studentId: stuD.studentProfile.id, status: "UNMARKED" },
        ],
      },
    });
    assert.equal(bulkValid.status, 200);
    assert.equal(bulkValid.data.success, true);

    const deckRes = await jsonReq(baseUrl, "GET", `/api/classes/${mainClass.id}/deck`, {
      cookie: facCookie,
    });
    assert.equal(deckRes.status, 200);
    const byId = new Map(deckRes.data.students.map((s) => [s.id, s]));
    assert.equal(byId.get(stuA.studentProfile.id).attendanceStatus, "PRESENT");
    assert.equal(byId.get(stuA.studentProfile.id).absentCount, 0);
    assert.equal(byId.get(stuB.studentProfile.id).attendanceStatus, "LATE");
    assert.equal(byId.get(stuB.studentProfile.id).absentCount, 0);
    assert.equal(byId.get(stuC.studentProfile.id).attendanceStatus, "ABSENT");
    assert.equal(byId.get(stuC.studentProfile.id).absentCount, 2);
    assert.equal(byId.get(stuD.studentProfile.id).attendanceStatus, null);
  });

  await t.test("REC-06: Recitation shuffler pool filtering (Present & Late only; 0 eligible rejected)", async () => {
    // Pool right now: stuA=PRESENT, stuB=LATE, stuC=ABSENT, stuD=UNMARKED
    const drawn = new Set();
    for (let i = 0; i < 10; i += 1) {
      const shuf = await jsonReq(
        baseUrl,
        "POST",
        `/api/sessions/${mainSessionId}/recitation/shuffle`,
        { cookie: facCookie, body: { mode: "RANDOM" } },
      );
      assert.equal(shuf.status, 200);
      const pickedId = shuf.data.recitation.studentId;
      assert.ok(
        pickedId === stuA.studentProfile.id || pickedId === stuB.studentProfile.id,
        `Only PRESENT/LATE eligible; got ${pickedId}`,
      );
      assert.notEqual(pickedId, stuC.studentProfile.id);
      assert.notEqual(pickedId, stuD.studentProfile.id);
      drawn.add(pickedId);
    }

    // Skip exclusion: excluding stuA with only A & B eligible must select stuB
    const skipRes = await jsonReq(
      baseUrl,
      "POST",
      `/api/sessions/${mainSessionId}/recitation/shuffle`,
      {
        cookie: facCookie,
        body: { mode: "RANDOM", excludeStudentId: stuA.studentProfile.id },
      },
    );
    assert.equal(skipRes.status, 200);
    assert.equal(skipRes.data.recitation.studentId, stuB.studentProfile.id);

    // Invalid mode -> 400
    const badMode = await jsonReq(
      baseUrl,
      "POST",
      `/api/sessions/${mainSessionId}/recitation/shuffle`,
      { cookie: facCookie, body: { mode: "ALPHA" } },
    );
    assert.equal(badMode.status, 400);

    // Separate class with 0 eligible students (1 ABSENT, 1 UNMARKED) -> 409
    const emptyEligibleClass = await createClassWithStudents("EMPTYREC", [stuA, stuB]);
    const empSession = await jsonReq(
      baseUrl,
      "POST",
      `/api/classes/${emptyEligibleClass.id}/sessions/today`,
      { cookie: facCookie },
    );
    await jsonReq(baseUrl, "PUT", `/api/sessions/${empSession.data.session.id}/attendance`, {
      cookie: facCookie,
      body: { updates: [{ studentId: stuA.studentProfile.id, status: "ABSENT" }] },
    });
    const noEligible = await jsonReq(
      baseUrl,
      "POST",
      `/api/sessions/${empSession.data.session.id}/recitation/shuffle`,
      { cookie: facCookie, body: { mode: "RANDOM" } },
    );
    assert.equal(noEligible.status, 409);

    // Single eligible student with skip -> 409
    await jsonReq(baseUrl, "PUT", `/api/sessions/${empSession.data.session.id}/attendance`, {
      cookie: facCookie,
      body: { updates: [{ studentId: stuA.studentProfile.id, status: "PRESENT" }] },
    });
    const onlyOneSkip = await jsonReq(
      baseUrl,
      "POST",
      `/api/sessions/${empSession.data.session.id}/recitation/shuffle`,
      { cookie: facCookie, body: { mode: "RANDOM", excludeStudentId: stuA.studentProfile.id } },
    );
    assert.equal(onlyOneSkip.status, 409);
  });

  await t.test("REC-07: Recitation weighted selection favors under-called students & score bounds", async () => {
    // Pure deterministic weight verification
    const unitCandidates = [
      { studentId: "under", priorCalls: 0 },
      { studentId: "often", priorCalls: 9 },
    ];
    let underPicks = 0;
    for (let i = 0; i < 100; i += 1) {
      if (selectRecitationCandidate(unitCandidates, "WEIGHTED", () => (i + 0.5) / 100).studentId === "under") {
        underPicks += 1;
      }
    }
    assert.equal(underPicks, 91, "Expected 1/(1+0) vs 1/(1+9) -> ~90.9% picks for undercalled");

    // Live API WEIGHTED test on isolated class: stuA (0 calls) vs stuB (50 calls in past session)
    const wClass = await createClassWithStudents("WEIGHT", [stuA, stuB]);
    const prevDate = new Date(Date.now() - 5 * 86_400_000);
    prevDate.setUTCHours(0, 0, 0, 0);
    const histSession = await prisma.classSession.create({
      data: { classId: wClass.id, date: prevDate, startedAt: prevDate },
    });
    await prisma.recitationLog.createMany({
      data: Array.from({ length: 50 }, () => ({
        sessionId: histSession.id,
        studentId: stuB.studentProfile.id,
        method: "WEIGHTED",
      })),
    });

    const todaySess = (
      await jsonReq(baseUrl, "POST", `/api/classes/${wClass.id}/sessions/today`, {
        cookie: facCookie,
      })
    ).data.session;
    await jsonReq(baseUrl, "PUT", `/api/sessions/${todaySess.id}/attendance`, {
      cookie: facCookie,
      body: {
        updates: [
          { studentId: stuA.studentProfile.id, status: "PRESENT" },
          { studentId: stuB.studentProfile.id, status: "PRESENT" },
        ],
      },
    });

    let countA = 0;
    let countB = 0;
    let lastLogId = null;
    for (let i = 0; i < 14; i += 1) {
      const shuf = await jsonReq(baseUrl, "POST", `/api/sessions/${todaySess.id}/recitation/shuffle`, {
        cookie: facCookie,
        body: { mode: "WEIGHTED" },
      });
      assert.equal(shuf.status, 200);
      lastLogId = shuf.data.recitation.id;
      if (shuf.data.recitation.studentId === stuA.studentProfile.id) countA += 1;
      else if (shuf.data.recitation.studentId === stuB.studentProfile.id) countB += 1;
    }
    assert.ok(
      countA > countB && countA >= 8,
      `Expected under-called student A (${countA}) to dominate student B (${countB})`,
    );

    // Score update valid (0..5, null) and invalid (-1, 6, 3.5)
    for (const validScore of [5, 0, null]) {
      const patchOk = await jsonReq(baseUrl, "PATCH", `/api/recitation-logs/${lastLogId}`, {
        cookie: facCookie,
        body: { score: validScore },
      });
      assert.equal(patchOk.status, 200);
      assert.equal(patchOk.data.recitation.score, validScore);
      assert.ok("firstName" in patchOk.data.recitation.studentProfile);
      assert.ok("lastName" in patchOk.data.recitation.studentProfile);
    }
    for (const badScore of [-1, 6, 3.5]) {
      const patchBad = await jsonReq(baseUrl, "PATCH", `/api/recitation-logs/${lastLogId}`, {
        cookie: facCookie,
        body: { score: badScore },
      });
      assert.equal(patchBad.status, 400);
    }
  });

  await t.test("REC-09: Activities CRUD & whole-number score bounds", async () => {
    const badCreate = await jsonReq(baseUrl, "POST", `/api/sessions/${mainSessionId}/activities`, {
      cookie: facCookie,
      body: { title: "   ", maxScore: 10 },
    });
    assert.equal(badCreate.status, 400);

    const createAct = await jsonReq(baseUrl, "POST", `/api/sessions/${mainSessionId}/activities`, {
      cookie: facCookie,
      body: { title: "qa_Lab 1", maxScore: 20 },
    });
    assert.equal(createAct.status, 201);
    const actId = createAct.data.activity.id;

    // Score valid boundaries: 0, 18, 20, null
    for (const s of [0, 18, 20]) {
      const scRes = await jsonReq(
        baseUrl,
        "PUT",
        `/api/activities/${actId}/scores/${stuA.studentProfile.id}`,
        { cookie: facCookie, body: { score: s } },
      );
      assert.equal(scRes.status, 200);
      assert.equal(scRes.data.score.score, s);
    }

    // Reject invalid scores: -1, 21, 14.5, "ten"
    for (const bad of [-1, 21, 14.5, "ten"]) {
      const badRes = await jsonReq(
        baseUrl,
        "PUT",
        `/api/activities/${actId}/scores/${stuA.studentProfile.id}`,
        { cookie: facCookie, body: { score: bad } },
      );
      assert.equal(badRes.status, 400, `Expected 400 for activity score ${bad}`);
    }

    // Cannot lower maxScore below already recorded score (20)
    const shrinkRes = await jsonReq(baseUrl, "PATCH", `/api/activities/${actId}`, {
      cookie: facCookie,
      body: { maxScore: 15 },
    });
    assert.equal(shrinkRes.status, 400);

    // Edit title & higher maxScore
    const editRes = await jsonReq(baseUrl, "PATCH", `/api/activities/${actId}`, {
      cookie: facCookie,
      body: { title: "qa_Lab 1 Updated", maxScore: 25 },
    });
    assert.equal(editRes.status, 200);
    assert.equal(editRes.data.activity.title, "qa_Lab 1 Updated");
    assert.equal(editRes.data.activity.maxScore, 25);

    const historyRes = await jsonReq(baseUrl, "GET", `/api/classes/${mainClass.id}/activities`, {
      cookie: facCookie,
    });
    assert.equal(historyRes.status, 200);
    const found = historyRes.data.activities.find((a) => a.id === actId);
    assert.ok(found);
    assert.equal(found.scoredCount, 1);

    // Delete activity
    const delRes = await jsonReq(baseUrl, "DELETE", `/api/activities/${actId}`, { cookie: facCookie });
    assert.equal(delRes.status, 200);
    const afterDel = await jsonReq(baseUrl, "GET", `/api/classes/${mainClass.id}/activities`, {
      cookie: facCookie,
    });
    assert.equal(afterDel.data.activities.some((a) => a.id === actId), false);
  });

  await t.test("REC-10: Projects fixed MIDTERM/FINALS & score validation", async () => {
    const projList = await jsonReq(baseUrl, "GET", `/api/classes/${mainClass.id}/projects`, {
      cookie: facCookie,
    });
    assert.equal(projList.status, 200);
    assert.deepEqual(
      projList.data.projects.map((p) => p.type),
      ["MIDTERM", "FINALS"],
    );
    const midterm = projList.data.projects.find((p) => p.type === "MIDTERM");

    // Arbitrary project creation route does not exist
    const postProj = await jsonReq(baseUrl, "POST", `/api/classes/${mainClass.id}/projects`, {
      cookie: facCookie,
      body: { type: "PRELIM" },
    });
    assert.equal(postProj.status, 404);

    // Invalid maxScore rejected (0, -5, 10.5, extra key)
    for (const badBody of [{ maxScore: 0 }, { maxScore: -1 }, { maxScore: 10.5 }, { maxScore: 50, title: "X" }]) {
      const badPatch = await jsonReq(baseUrl, "PATCH", `/api/projects/${midterm.id}`, {
        cookie: facCookie,
        body: badBody,
      });
      assert.equal(badPatch.status, 400);
    }

    const patchOk = await jsonReq(baseUrl, "PATCH", `/api/projects/${midterm.id}`, {
      cookie: facCookie,
      body: { maxScore: 50 },
    });
    assert.equal(patchOk.status, 200);

    // Valid integer scores 0..50 + null
    for (const s of [0, 42, 50]) {
      const saveProj = await jsonReq(
        baseUrl,
        "PUT",
        `/api/projects/${midterm.id}/scores/${stuA.studentProfile.id}`,
        { cookie: facCookie, body: { score: s, sessionId: mainSessionId } },
      );
      assert.equal(saveProj.status, 200);
      assert.equal(saveProj.data.score.score, s);
    }

    // Invalid scores: -1, 51, 42.5
    for (const bad of [-1, 51, 42.5]) {
      const badProj = await jsonReq(
        baseUrl,
        "PUT",
        `/api/projects/${midterm.id}/scores/${stuA.studentProfile.id}`,
        { cookie: facCookie, body: { score: bad, sessionId: mainSessionId } },
      );
      assert.equal(badProj.status, 400);
    }

    // Lowering maxScore below existing 50 fails 400
    const shrinkProj = await jsonReq(baseUrl, "PATCH", `/api/projects/${midterm.id}`, {
      cookie: facCookie,
      body: { maxScore: 40 },
    });
    assert.equal(shrinkProj.status, 400);

    // Clear with null succeeds
    const clearProj = await jsonReq(
      baseUrl,
      "PUT",
      `/api/projects/${midterm.id}/scores/${stuA.studentProfile.id}`,
      { cookie: facCookie, body: { score: null, sessionId: mainSessionId } },
    );
    assert.equal(clearProj.status, 200);
    assert.equal(clearProj.data.score.score, null);
  });

  await t.test("REC-11: Quizzes CRUD & bulk score validation", async () => {
    const createRes = await jsonReq(baseUrl, "POST", `/api/classes/${mainClass.id}/quizzes`, {
      cookie: facCookie,
      body: { title: "qa_Quiz 1", totalItems: 20 },
    });
    assert.equal(createRes.status, 201);
    assert.deepEqual(createRes.data.session.scores, []);
    const quizId = createRes.data.session.id;

    // Invalid bulk scores: -1, 1.5, 21
    for (const badScore of [-1, 1.5, 21]) {
      const badBulk = await jsonReq(baseUrl, "PUT", `/api/quizzes/${quizId}/scores`, {
        cookie: facCookie,
        body: { scores: [{ studentId: stuA.studentProfile.id, score: badScore }] },
      });
      assert.equal(badBulk.status, 400);
    }

    const okBulk = await jsonReq(baseUrl, "PUT", `/api/quizzes/${quizId}/scores`, {
      cookie: facCookie,
      body: {
        scores: [
          { studentId: stuA.studentProfile.id, score: 18 },
          { studentId: stuB.studentProfile.id, score: 15 },
        ],
      },
    });
    assert.equal(okBulk.status, 200);
    assert.equal(okBulk.data.scores.length, 2);

    // Lowering totalItems below existing 18 -> 400 with conflicts
    const conflictPatch = await jsonReq(baseUrl, "PATCH", `/api/quizzes/${quizId}`, {
      cookie: facCookie,
      body: { title: "qa_Quiz 1", totalItems: 16 },
    });
    assert.equal(conflictPatch.status, 400);
    assert.equal(conflictPatch.data.conflicts.length, 1);

    const editOk = await jsonReq(baseUrl, "PATCH", `/api/quizzes/${quizId}`, {
      cookie: facCookie,
      body: { title: "qa_Quiz 1 Edited", totalItems: 25 },
    });
    assert.equal(editOk.status, 200);
    assert.equal(editOk.data.session.title, "qa_Quiz 1 Edited");

    const delOk = await jsonReq(baseUrl, "DELETE", `/api/quizzes/${quizId}`, { cookie: facCookie });
    assert.equal(delOk.status, 204);

    const listAfter = await jsonReq(baseUrl, "GET", `/api/classes/${mainClass.id}/quizzes`, {
      cookie: facCookie,
    });
    assert.equal(listAfter.data.sessions.some((s) => s.id === quizId), false);
  });

  // Shared IDs across REC-13 -> REC-14
  let lockedActId;
  let lockedMidtermId;
  let lockedQuizId;

  await t.test("REC-13: Absence auto-flagging across activities, projects, and quizzes", async () => {
    // Ensure stuC is ABSENT and stuA is PRESENT today
    await jsonReq(baseUrl, "PUT", `/api/sessions/${mainSessionId}/attendance`, {
      cookie: facCookie,
      body: {
        updates: [
          { studentId: stuA.studentProfile.id, status: "PRESENT" },
          { studentId: stuC.studentProfile.id, status: "ABSENT" },
        ],
      },
    });

    // Activity created while stuC is ABSENT -> auto-flagged isAbsent=true, score=null
    const actRes = await jsonReq(baseUrl, "POST", `/api/sessions/${mainSessionId}/activities`, {
      cookie: facCookie,
      body: { title: "qa_Absence Lock Act", maxScore: 20 },
    });
    assert.equal(actRes.status, 201);
    lockedActId = actRes.data.activity.id;

    const actScores = await jsonReq(baseUrl, "GET", `/api/activities/${lockedActId}/scores`, {
      cookie: facCookie,
    });
    const stuCAct = actScores.data.scores.find((s) => s.studentId === stuC.studentProfile.id);
    assert.equal(stuCAct.isAbsent, true);
    assert.equal(stuCAct.score, null);

    const tryActScore = await jsonReq(
      baseUrl,
      "PUT",
      `/api/activities/${lockedActId}/scores/${stuC.studentProfile.id}`,
      { cookie: facCookie, body: { score: 15 } },
    );
    assert.equal(tryActScore.status, 409);

    // Project: MIDTERM already synced absent by attendance update -> isAbsent=true, 409 on score
    const projects = (
      await jsonReq(baseUrl, "GET", `/api/classes/${mainClass.id}/projects`, { cookie: facCookie })
    ).data.projects;
    lockedMidtermId = projects.find((p) => p.type === "MIDTERM").id;
    const projScores = await jsonReq(baseUrl, "GET", `/api/projects/${lockedMidtermId}/scores`, {
      cookie: facCookie,
    });
    const stuCProj = projScores.data.scores.find((s) => s.studentId === stuC.studentProfile.id);
    assert.equal(stuCProj.isAbsent, true);
    assert.equal(stuCProj.score, null);

    const tryProjScore = await jsonReq(
      baseUrl,
      "PUT",
      `/api/projects/${lockedMidtermId}/scores/${stuC.studentProfile.id}`,
      { cookie: facCookie, body: { score: 40, sessionId: mainSessionId } },
    );
    assert.equal(tryProjScore.status, 409);

    // Quiz: bulk save forces absent stuC to { score: null, isAbsent: true }; direct PUT returns 409
    const qCreate = await jsonReq(baseUrl, "POST", `/api/classes/${mainClass.id}/quizzes`, {
      cookie: facCookie,
      body: { title: "qa_Absence Lock Quiz", totalItems: 20 },
    });
    lockedQuizId = qCreate.data.session.id;

    const trySingleQuiz = await jsonReq(
      baseUrl,
      "PUT",
      `/api/quizzes/${lockedQuizId}/scores/${stuC.studentProfile.id}`,
      { cookie: facCookie, body: { score: 15 } },
    );
    assert.equal(trySingleQuiz.status, 409);

    const bulkQuiz = await jsonReq(baseUrl, "PUT", `/api/quizzes/${lockedQuizId}/scores`, {
      cookie: facCookie,
      body: {
        scores: [
          { studentId: stuA.studentProfile.id, score: 19 },
          { studentId: stuC.studentProfile.id, score: 14 },
        ],
      },
    });
    assert.equal(bulkQuiz.status, 200);
    const qC = bulkQuiz.data.scores.find((s) => s.studentId === stuC.studentProfile.id);
    assert.equal(qC.isAbsent, true);
    assert.equal(qC.score, null);
  });

  await t.test("REC-14: Absence auto-flag reversibility on attendance correction", async () => {
    // Change stuC from ABSENT -> PRESENT today
    const fixAtt = await jsonReq(
      baseUrl,
      "PUT",
      `/api/sessions/${mainSessionId}/attendance/${stuC.studentProfile.id}`,
      { cookie: facCookie, body: { status: "PRESENT" } },
    );
    assert.equal(fixAtt.status, 200);

    // Activity now allows scoring stuC cleanly
    const actScoresAfter = await jsonReq(baseUrl, "GET", `/api/activities/${lockedActId}/scores`, {
      cookie: facCookie,
    });
    assert.equal(
      actScoresAfter.data.scores.find((s) => s.studentId === stuC.studentProfile.id).isAbsent,
      false,
    );
    const saveAct = await jsonReq(
      baseUrl,
      "PUT",
      `/api/activities/${lockedActId}/scores/${stuC.studentProfile.id}`,
      { cookie: facCookie, body: { score: 17 } },
    );
    assert.equal(saveAct.status, 200);
    assert.equal(saveAct.data.score.isAbsent, false);
    assert.equal(saveAct.data.score.score, 17);

    // Project now allows scoring stuC cleanly
    const projScoresAfter = await jsonReq(
      baseUrl,
      "GET",
      `/api/projects/${lockedMidtermId}/scores`,
      { cookie: facCookie },
    );
    assert.equal(
      projScoresAfter.data.scores.find((s) => s.studentId === stuC.studentProfile.id).isAbsent,
      false,
    );
    const saveProj = await jsonReq(
      baseUrl,
      "PUT",
      `/api/projects/${lockedMidtermId}/scores/${stuC.studentProfile.id}`,
      { cookie: facCookie, body: { score: 45, sessionId: mainSessionId } },
    );
    assert.equal(saveProj.status, 200);
    assert.equal(saveProj.data.score.isAbsent, false);
    assert.equal(saveProj.data.score.score, 45);

    // Quiz single PUT & GET now allow scoring stuC cleanly
    const saveQuiz = await jsonReq(
      baseUrl,
      "PUT",
      `/api/quizzes/${lockedQuizId}/scores/${stuC.studentProfile.id}`,
      { cookie: facCookie, body: { score: 16 } },
    );
    assert.equal(saveQuiz.status, 200);
    assert.equal(saveQuiz.data.score.isAbsent, false);
    assert.equal(saveQuiz.data.score.score, 16);

    const quizList = await jsonReq(baseUrl, "GET", `/api/classes/${mainClass.id}/quizzes`, {
      cookie: facCookie,
    });
    const unlockedQuiz = quizList.data.sessions.find((s) => s.id === lockedQuizId);
    const qCAfter = unlockedQuiz.scores.find((s) => s.studentId === stuC.studentProfile.id);
    assert.equal(qCAfter.isAbsent, false);
    assert.equal(qCAfter.score, 16);
  });

  await t.test("REC-15: 7-absence warning threshold notification & pending counts", async () => {
    // Isolated class with 6 absences initially -> no warning -> 7th absence -> warning triggers
    const warnClass = await createClassWithStudents("WARN7", [stuC]);
    for (let day = 1; day <= 6; day += 1) {
      const d = new Date(Date.now() - day * 86_400_000);
      d.setUTCHours(0, 0, 0, 0);
      await prisma.classSession.create({
        data: {
          classId: warnClass.id,
          date: d,
          startedAt: d,
          attendance: { create: [{ studentId: stuC.studentProfile.id, status: "ABSENT" }] },
        },
      });
    }

    const before7 = await jsonReq(baseUrl, "GET", `/api/classes/${warnClass.id}/pending`, {
      cookie: facCookie,
    });
    assert.equal(before7.status, 200);
    assert.equal(before7.data.absenceWarnings.length, 0);
    assert.equal(before7.data.threshold, 7);

    // Mark 7th absence on today's session via API
    const todayWarn = (
      await jsonReq(baseUrl, "POST", `/api/classes/${warnClass.id}/sessions/today`, {
        cookie: facCookie,
      })
    ).data.session;
    await jsonReq(
      baseUrl,
      "PUT",
      `/api/sessions/${todayWarn.id}/attendance/${stuC.studentProfile.id}`,
      { cookie: facCookie, body: { status: "ABSENT" } },
    );

    const at7 = await jsonReq(baseUrl, "GET", `/api/classes/${warnClass.id}/pending`, {
      cookie: facCookie,
    });
    assert.equal(at7.status, 200);
    assert.equal(at7.data.threshold, 7);
    assert.equal(at7.data.absenceWarnings.length, 1);
    assert.equal(at7.data.absenceWarnings[0].absentCount, 7);
    assert.equal(at7.data.absenceWarnings[0].isRead, false);
    assert.equal(at7.data.unreadNotificationCount, 1);

    const globalCounts = await jsonReq(baseUrl, "GET", "/api/faculty/classes/pending-counts", {
      cookie: facCookie,
    });
    assert.equal(globalCounts.status, 200);
    assert.equal(globalCounts.data.warningCounts[warnClass.id], 1);
    assert.ok(globalCounts.data.counts[warnClass.id] >= 1);
  });

  await t.test("REC-17: Dashboard live class ordering & lastSessionAt accuracy", async () => {
    const classActive = await createClassWithStudents("LIVEA", [stuA]);
    const classEmptyToday = await createClassWithStudents("IDLEB", [stuA]);

    // classActive gets a started session + attendance mark
    const sessA = (
      await jsonReq(baseUrl, "POST", `/api/classes/${classActive.id}/sessions/today`, {
        cookie: facCookie,
      })
    ).data.session;
    await jsonReq(
      baseUrl,
      "PUT",
      `/api/sessions/${sessA.id}/attendance/${stuA.studentProfile.id}`,
      { cookie: facCookie, body: { status: "PRESENT" } },
    );

    // classEmptyToday gets ONLY an unstarted today session (like visiting Deck tab)
    const emptyDeck = await jsonReq(baseUrl, "GET", `/api/classes/${classEmptyToday.id}/deck`, {
      cookie: facCookie,
    });
    assert.equal(emptyDeck.status, 200);
    assert.equal(emptyDeck.data.session.startedAt, null);

    const [facClassesRes, stuClassesRes] = await Promise.all([
      jsonReq(baseUrl, "GET", "/api/faculty/classes", { cookie: facCookie }),
      jsonReq(baseUrl, "GET", "/api/student/classes", { cookie: stuACookie }),
    ]);

    assert.equal(facClassesRes.status, 200);
    assert.equal(stuClassesRes.status, 200);

    const facActive = facClassesRes.data.classes.find((c) => c.id === classActive.id);
    const facIdle = facClassesRes.data.classes.find((c) => c.id === classEmptyToday.id);
    assert.ok(facActive.lastSessionAt, "Active class with attendance must have non-null lastSessionAt");
    assert.equal(facIdle.lastSessionAt, null, "Class with unstarted empty session must have lastSessionAt=null");

    const stuActive = stuClassesRes.data.classes.find((c) => c.id === classActive.id);
    const stuIdle = stuClassesRes.data.classes.find((c) => c.id === classEmptyToday.id);
    assert.ok(stuActive.lastSessionAt, "Student dashboard active class must have non-null lastSessionAt");
    assert.equal(stuIdle.lastSessionAt, null, "Student dashboard idle class must have lastSessionAt=null");
  });
});
