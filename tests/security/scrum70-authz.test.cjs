const test = require("node:test");
const assert = require("node:assert/strict");
const {
  QA_PASSWORD,
  initSecurityBackend,
  createSecurityFixtures,
  apiRequest,
  loginAs,
  findKeysRecursive,
} = require("./helpers/security-harness.cjs");

const sec = initSecurityBackend();
const { prisma, mailer, backendIndex } = sec;

test("SCRUM-70: Authorization, Ownership, Role Boundaries & Token Security (AUTHZ-01..19, 21..22)", async (t) => {
  backendIndex.resetRateLimitersForTests();
  mailer.resetMailTransportForTests();
  mailer.clearStubEmails();
  sec.resetCaptchaHandler();

  const srv = await sec.startServer(0);
  const { baseUrl } = srv;
  const fx = await createSecurityFixtures(prisma, "s70");

  t.after(async () => {
    sec.resetCaptchaHandler();
    sec.resetExternalFetchGuard();
    mailer.resetMailTransportForTests();
    mailer.clearStubEmails();
    backendIndex.resetRateLimitersForTests();
    await srv.close();
    await fx.cleanup();
    await prisma.$disconnect();
  });

  const facALogin = await loginAs(baseUrl, fx.facA.email);
  assert.equal(facALogin.status, 200);
  const facACookie = facALogin.sidCookie;

  const facBLogin = await loginAs(baseUrl, fx.facB.email);
  assert.equal(facBLogin.status, 200);
  const facBCookie = facBLogin.sidCookie;

  const stuA1Login = await loginAs(baseUrl, fx.stuA1.email);
  assert.equal(stuA1Login.status, 200);
  const stuA1Cookie = stuA1Login.sidCookie;

  const stuA2Login = await loginAs(baseUrl, fx.stuA2.email);
  assert.equal(stuA2Login.status, 200);
  const stuA2Cookie = stuA2Login.sidCookie;

  const stuPendingALogin = await loginAs(baseUrl, fx.stuPendingA.email);
  assert.equal(stuPendingALogin.status, 200);
  const stuPendingACookie = stuPendingALogin.sidCookie;

  const stuDroppedALogin = await loginAs(baseUrl, fx.stuDroppedA.email);
  assert.equal(stuDroppedALogin.status, 200);
  const stuDroppedACookie = stuDroppedALogin.sidCookie;

  const stuDeclinedALogin = await loginAs(baseUrl, fx.stuDeclinedA.email);
  assert.equal(stuDeclinedALogin.status, 200);
  const stuDeclinedACookie = stuDeclinedALogin.sidCookie;

  const stuUnrelLogin = await loginAs(baseUrl, fx.stuUnrelated.email);
  assert.equal(stuUnrelLogin.status, 200);
  const stuUnrelCookie = stuUnrelLogin.sidCookie;

  const stuB1Login = await loginAs(baseUrl, fx.stuB1.email);
  assert.equal(stuB1Login.status, 200);
  const stuB1Cookie = stuB1Login.sidCookie;

  function buildAllProtectedRoutes(targetData, targetClass, targetArchivedClass, targetStuProfileId, opts = {}) {
    const cid = targetClass.id;
    const archId = targetArchivedClass.id;
    const sid = targetData.session.id;
    const aid = targetData.activity.id;
    const pid = targetData.midtermProject.id;
    const qid = targetData.quiz.id;
    const rid = targetData.activeRoster.id;
    const dropRid = targetData.droppedRoster.id;
    const pendEid = targetData.pendingEnroll.id;
    const rlogId = targetData.recitationLog.id;

    // Exact 61 authenticated routes from docs/testing/security/ROUTE_INVENTORY.md (#9 - #69)
    return [
      // Dual-role / shared (4)
      { num: 9, role: "BOTH", method: "POST", path: "/api/auth/resend-verification", body: {} },
      { num: 10, role: "BOTH", method: "POST", path: "/api/auth/change-password", body: { currentPassword: "wrong", newPassword: "NewPassword123!" } },
      { num: 11, role: "BOTH", method: "GET", path: "/api/auth/me" },
      { num: 41, role: "BOTH", method: "GET", path: `/api/students/${targetStuProfileId}/photo` },

      // Student-only (5)
      { num: 14, role: "STUDENT", method: "GET", path: "/api/student/profile" },
      { num: 15, role: "STUDENT", method: "PUT", path: "/api/student/profile", body: { name: "qa_Attempt" } },
      { num: 65, role: "STUDENT", method: "GET", path: "/api/student/classes" },
      { num: 68, role: "STUDENT", method: "GET", path: `/api/student/classes/${cid}/records` },
      { num: 69, role: "STUDENT", method: "POST", path: "/api/classes/join", body: { classCode: targetClass.classCode, recaptchaToken: opts.recaptchaToken || "ok" } },

      // Faculty-only (52)
      { num: 12, role: "FACULTY", method: "GET", path: "/api/faculty/profile", crossFaculty: false },
      { num: 13, role: "FACULTY", method: "PUT", path: "/api/faculty/profile", body: { name: "qa_Attacker Fac" }, crossFaculty: false },
      { num: 16, role: "FACULTY", method: "GET", path: "/api/faculty/classes", crossFaculty: false },
      { num: 17, role: "FACULTY", method: "GET", path: "/api/faculty/classes/pending-counts", crossFaculty: false },
      { num: 18, role: "FACULTY", method: "GET", path: `/api/classes/check-code?code=${encodeURIComponent(targetClass.classCode)}`, crossFaculty: false },
      { num: 19, role: "FACULTY", method: "POST", path: "/api/classes", body: {}, crossFaculty: false },

      { num: 20, role: "FACULTY", method: "GET", path: `/api/classes/${cid}/roster`, crossFaculty: true },
      { num: 21, role: "FACULTY", method: "POST", path: `/api/classes/${cid}/roster`, body: { entries: [{ studentName: "qa_Intruder", studentId: fx.spareStudentId }] }, crossFaculty: true },
      { num: 22, role: "FACULTY", method: "PATCH", path: `/api/classes/${cid}/roster/${rid}`, body: { studentName: "qa_Tampered" }, crossFaculty: true },
      { num: 23, role: "FACULTY", method: "GET", path: `/api/classes/${cid}/roster/${rid}/impact`, crossFaculty: true },
      { num: 24, role: "FACULTY", method: "DELETE", path: `/api/classes/${cid}/roster/${rid}`, crossFaculty: true },
      { num: 25, role: "FACULTY", method: "GET", path: `/api/classes/${cid}/drop-list`, crossFaculty: true },
      { num: 26, role: "FACULTY", method: "POST", path: `/api/classes/${cid}/drop-list/${dropRid}/restore`, body: {}, crossFaculty: true },
      { num: 27, role: "FACULTY", method: "GET", path: `/api/classes/${cid}/roster/template`, crossFaculty: true },
      { num: 28, role: "FACULTY", method: "POST", path: `/api/classes/${cid}/roster/import`, body: { fileName: "r.csv", fileBase64: Buffer.from("Student ID,Name\n8999991,qa_A\n").toString("base64") }, crossFaculty: true },
      { num: 29, role: "FACULTY", method: "GET", path: `/api/classes/${cid}/pending`, crossFaculty: true },
      { num: 30, role: "FACULTY", method: "POST", path: `/api/classes/${cid}/notifications/read`, body: {}, crossFaculty: true },
      { num: 31, role: "FACULTY", method: "POST", path: `/api/classes/${cid}/absence-warnings/${targetStuProfileId}/read`, body: {}, crossFaculty: true },
      { num: 32, role: "FACULTY", method: "POST", path: `/api/classes/${cid}/absence-warnings/${targetStuProfileId}/dismiss`, body: {}, crossFaculty: true },
      { num: 33, role: "FACULTY", method: "PATCH", path: `/api/classes/${cid}/pending/${pendEid}`, body: { status: "DECLINED" }, crossFaculty: true },
      { num: 34, role: "FACULTY", method: "GET", path: `/api/classes/${cid}/quizzes`, crossFaculty: true },
      { num: 35, role: "FACULTY", method: "POST", path: `/api/classes/${cid}/quizzes`, body: { title: "qa_EvilQuiz", totalItems: 10 }, crossFaculty: true },
      { num: 36, role: "FACULTY", method: "PATCH", path: `/api/quizzes/${qid}`, body: { title: "qa_EvilQuiz2" }, crossFaculty: true },
      { num: 37, role: "FACULTY", method: "DELETE", path: `/api/quizzes/${qid}`, crossFaculty: true },
      { num: 38, role: "FACULTY", method: "PUT", path: `/api/quizzes/${qid}/scores`, body: { scores: [{ studentId: targetStuProfileId, score: 5 }] }, crossFaculty: true },
      { num: 39, role: "FACULTY", method: "PUT", path: `/api/quizzes/${qid}/scores/${targetStuProfileId}`, body: { score: 5 }, crossFaculty: true },
      { num: 40, role: "FACULTY", method: "GET", path: `/api/classes/${cid}`, crossFaculty: true },
      { num: 42, role: "FACULTY", method: "GET", path: `/api/classes/${cid}/deck`, crossFaculty: true },
      { num: 43, role: "FACULTY", method: "GET", path: `/api/classes/${cid}/export-summary`, crossFaculty: true },
      { num: 44, role: "FACULTY", method: "GET", path: `/api/classes/${cid}/activities`, crossFaculty: true },
      { num: 45, role: "FACULTY", method: "GET", path: `/api/classes/${cid}/students/${targetStuProfileId}/records`, crossFaculty: true },
      { num: 46, role: "FACULTY", method: "POST", path: `/api/classes/${cid}/sessions/today`, body: {}, crossFaculty: true },
      { num: 47, role: "FACULTY", method: "POST", path: `/api/sessions/${sid}/start`, body: {}, crossFaculty: true },
      { num: 48, role: "FACULTY", method: "PATCH", path: `/api/classes/${cid}`, body: { sectionName: "qa_Hijacked" }, crossFaculty: true },
      { num: 49, role: "FACULTY", method: "POST", path: `/api/classes/${cid}/archive`, body: {}, crossFaculty: true },
      { num: 50, role: "FACULTY", method: "POST", path: `/api/classes/${archId}/restore`, body: {}, crossFaculty: true },
      { num: 51, role: "FACULTY", method: "GET", path: `/api/sessions/${sid}/activities`, crossFaculty: true },
      { num: 52, role: "FACULTY", method: "POST", path: `/api/sessions/${sid}/activities`, body: { title: "qa_EvilAct", maxScore: 50 }, crossFaculty: true },
      { num: 53, role: "FACULTY", method: "PATCH", path: `/api/activities/${aid}`, body: { title: "qa_EvilAct2" }, crossFaculty: true },
      { num: 54, role: "FACULTY", method: "DELETE", path: `/api/activities/${aid}`, crossFaculty: true },
      { num: 55, role: "FACULTY", method: "GET", path: `/api/activities/${aid}/scores`, crossFaculty: true },
      { num: 56, role: "FACULTY", method: "PUT", path: `/api/activities/${aid}/scores/${targetStuProfileId}`, body: { score: 10 }, crossFaculty: true },
      { num: 57, role: "FACULTY", method: "GET", path: `/api/classes/${cid}/projects`, crossFaculty: true },
      { num: 58, role: "FACULTY", method: "PATCH", path: `/api/projects/${pid}`, body: { maxScore: 50 }, crossFaculty: true },
      { num: 59, role: "FACULTY", method: "GET", path: `/api/projects/${pid}/scores`, crossFaculty: true },
      { num: 60, role: "FACULTY", method: "PUT", path: `/api/projects/${pid}/scores/${targetStuProfileId}`, body: { score: 10, sessionId: sid }, crossFaculty: true },
      { num: 61, role: "FACULTY", method: "PUT", path: `/api/sessions/${sid}/attendance`, body: { updates: [{ studentId: targetStuProfileId, status: "ABSENT" }] }, crossFaculty: true },
      { num: 62, role: "FACULTY", method: "PUT", path: `/api/sessions/${sid}/attendance/${targetStuProfileId}`, body: { status: "ABSENT" }, crossFaculty: true },
      { num: 63, role: "FACULTY", method: "POST", path: `/api/sessions/${sid}/recitation/shuffle`, body: { method: "RANDOM" }, crossFaculty: true },
      { num: 64, role: "FACULTY", method: "PATCH", path: `/api/recitation-logs/${rlogId}`, body: { score: 1 }, crossFaculty: true },
      { num: 66, role: "FACULTY", method: "GET", path: `/api/classes/${cid}/export/excel`, crossFaculty: true },
      { num: 67, role: "FACULTY", method: "GET", path: `/api/classes/${cid}/export/csv`, crossFaculty: true },
    ];
  }

  await t.test("AUTHZ-01: unauthenticated requests rejected (401) across all 61 protected endpoints", async () => {
    const routes = buildAllProtectedRoutes(fx.a1Data, fx.facAClass1, fx.facAClassArchived, fx.stuA1.studentProfile.id);
    assert.equal(routes.length, 61);
    for (const r of routes) {
      const res = await apiRequest(baseUrl, r.method, r.path, { body: r.body });
      assert.equal(res.status, 401, `#${r.num} ${r.method} ${r.path} returned ${res.status}: ${res.rawText}`);
      assert.ok(!res.json?.class && !res.json?.classes && !res.json?.user && !res.json?.roster, `Leaked body on ${r.path}`);
    }
  });

  await t.test("AUTHZ-02: student role rejected (403) across all 52 faculty-only endpoints", async () => {
    const routes = buildAllProtectedRoutes(fx.a1Data, fx.facAClass1, fx.facAClassArchived, fx.stuA1.studentProfile.id)
      .filter((r) => r.role === "FACULTY");
    assert.equal(routes.length, 52);
    for (const r of routes) {
      const res = await apiRequest(baseUrl, r.method, r.path, { cookie: stuA1Cookie, body: r.body });
      assert.equal(res.status, 403, `#${r.num} ${r.method} ${r.path} returned ${res.status}: ${res.rawText}`);
    }
  });

  await t.test("AUTHZ-03: faculty role rejected (403) across all 5 student-only endpoints", async () => {
    const routes = buildAllProtectedRoutes(fx.a1Data, fx.facAClass1, fx.facAClassArchived, fx.stuA1.studentProfile.id)
      .filter((r) => r.role === "STUDENT");
    assert.equal(routes.length, 5);
    for (const r of routes) {
      const res = await apiRequest(baseUrl, r.method, r.path, { cookie: facACookie, body: r.body });
      assert.equal(res.status, 403, `#${r.num} ${r.method} ${r.path} returned ${res.status}: ${res.rawText}`);
    }
  });

  await t.test("AUTHZ-04: cross-student isolation on unjoined class, other student profile, and query/body ID tampering", async () => {
    // Student A1 reading unjoined class B2
    const unjoined = await apiRequest(baseUrl, "GET", `/api/student/classes/${fx.facBClass2.id}/records`, {
      cookie: stuA1Cookie,
    });
    assert.equal(unjoined.status, 404);

    // Student B1 trying to read facAClass1
    const otherClass = await apiRequest(baseUrl, "GET", `/api/student/classes/${fx.facAClass1.id}/records`, {
      cookie: stuB1Cookie,
    });
    assert.equal(otherClass.status, 404);

    // Student A1 trying to read Student A2 photo
    const otherPhoto = await apiRequest(baseUrl, "GET", `/api/students/${fx.stuA2.studentProfile.id}/photo`, {
      cookie: stuA1Cookie,
    });
    assert.equal(otherPhoto.status, 403);

    // Student A2 passes stuA1 profileId in query string on student records - must still return ONLY stuA2
    const forgedQuery = await apiRequest(
      baseUrl,
      "GET",
      `/api/student/classes/${fx.facAClass1.id}/records?studentId=${fx.stuA1.studentProfile.id}&studentProfileId=${fx.stuA1.studentProfile.id}`,
      { cookie: stuA2Cookie },
    );
    assert.equal(forgedQuery.status, 200);
    assert.equal(forgedQuery.json.student.id, fx.stuA2.studentProfile.id);
    assert.deepEqual(forgedQuery.json.recitations, []);
    assert.deepEqual(forgedQuery.json.quizzes, []);
  });

  await t.test("AUTHZ-05a: DROPPED enrollment preserves read-only historical records intentionally", async () => {
    const res = await apiRequest(baseUrl, "GET", `/api/student/classes/${fx.facAClass1.id}/records`, {
      cookie: stuDroppedACookie,
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.class.enrollmentStatus, "DROPPED");
    assert.equal(res.json.student.id, fx.stuDroppedA.studentProfile.id);
  });

  await t.test("AUTHZ-05b: PENDING student must not access class internal details before approval", { todo: "SEC-04" }, async () => {
    const res = await apiRequest(baseUrl, "GET", `/api/student/classes/${fx.facAClass1.id}/records`, {
      cookie: stuPendingACookie,
    });
    assert.ok([403, 404].includes(res.status), `PENDING student received ${res.status} with classCode=${res.json?.class?.classCode}`);
  });

  await t.test("AUTHZ-05c: DECLINED student must not bypass instructor decline via POST /api/classes/join", { todo: "SEC-05" }, async () => {
    const res = await apiRequest(baseUrl, "POST", "/api/classes/join", {
      cookie: stuDeclinedACookie,
      body: { classCode: fx.facAClass1.classCode, recaptchaToken: "ok" },
    });
    assert.ok([403, 409].includes(res.status), `Expected 403/409 for DECLINED rejoin, got ${res.status}: ${res.rawText}`);
  });

  await t.test("AUTHZ-06: cross-faculty isolation across all Faculty GET routes against Faculty B real IDs", async () => {
    const facBRoutes = buildAllProtectedRoutes(fx.b1Data, fx.facBClass1, fx.facBClassArchived, fx.stuB1.studentProfile.id)
      .filter((r) => r.role === "FACULTY" && r.crossFaculty && r.method === "GET");
    for (const r of facBRoutes) {
      const res = await apiRequest(baseUrl, r.method, r.path, { cookie: facACookie });
      assert.ok([403, 404].includes(res.status), `#${r.num} ${r.method} ${r.path} returned ${res.status}: ${res.rawText}`);
    }

    // Also Faculty A cannot read Faculty B photo of stuB1 (who is not in any facA class/roster)
    const photoRes = await apiRequest(baseUrl, "GET", `/api/students/${fx.stuB1.studentProfile.id}/photo`, {
      cookie: facACookie,
    });
    assert.equal(photoRes.status, 403);
  });

  await t.test("AUTHZ-07: cross-faculty isolation across all Faculty mutating routes against Faculty B real IDs", async () => {
    const facBMutations = buildAllProtectedRoutes(fx.b1Data, fx.facBClass1, fx.facBClassArchived, fx.stuB1.studentProfile.id)
      .filter((r) => r.role === "FACULTY" && r.crossFaculty && r.method !== "GET");
    for (const r of facBMutations) {
      const res = await apiRequest(baseUrl, r.method, r.path, { cookie: facACookie, body: r.body });
      assert.ok([403, 404].includes(res.status), `#${r.num} ${r.method} ${r.path} returned ${res.status}: ${res.rawText}`);
    }

    // Verify Faculty B state remained completely intact
    const intactQuiz = await prisma.quizSession.findUnique({ where: { id: fx.b1Data.quiz.id } });
    const intactClass = await prisma.class.findUnique({ where: { id: fx.facBClass1.id } });
    const intactPend = await prisma.classEnrollment.findUnique({ where: { id: fx.b1Data.pendingEnroll.id } });
    const intactActScore = await prisma.activityScore.findUnique({
      where: { activityId_studentId: { activityId: fx.b1Data.activity.id, studentId: fx.stuB1.studentProfile.id } },
    });
    assert.ok(intactQuiz);
    assert.equal(intactClass.sectionName, fx.facBClass1.sectionName);
    assert.equal(intactPend.status, "PENDING");
    assert.equal(intactActScore.score, 45);
  });

  await t.test("AUTHZ-08a: cross-class nested ID mismatches reject cleanly on roster/pending/project/recitation", async () => {
    const m1 = await apiRequest(baseUrl, "PATCH", `/api/classes/${fx.facAClass1.id}/roster/${fx.b1Data.activeRoster.id}`, {
      cookie: facACookie,
      body: { studentName: "qa_Mismatch", studentId: fx.stuB1.studentProfile.studentId },
    });
    assert.equal(m1.status, 404);

    const m2 = await apiRequest(baseUrl, "DELETE", `/api/classes/${fx.facAClass1.id}/roster/${fx.b1Data.activeRoster.id}`, {
      cookie: facACookie,
    });
    assert.equal(m2.status, 404);

    const m3 = await apiRequest(baseUrl, "POST", `/api/classes/${fx.facAClass1.id}/drop-list/${fx.b1Data.droppedRoster.id}/restore`, {
      cookie: facACookie,
      body: {},
    });
    assert.equal(m3.status, 404);

    const m4 = await apiRequest(baseUrl, "PATCH", `/api/classes/${fx.facAClass1.id}/pending/${fx.b1Data.pendingEnroll.id}`, {
      cookie: facACookie,
      body: { status: "DECLINED" },
    });
    assert.equal(m4.status, 404);

    const m5 = await apiRequest(baseUrl, "PUT", `/api/projects/${fx.a1Data.midtermProject.id}/scores/${fx.stuA1.studentProfile.id}`, {
      cookie: facACookie,
      body: { score: 85, sessionId: fx.b1Data.session.id },
    });
    assert.equal(m5.status, 404);
  });

  await t.test("AUTHZ-08b: PUT /api/quizzes/:sessionId/scores must reject unenrolled studentId", async () => {
    const res = await apiRequest(baseUrl, "PUT", `/api/quizzes/${fx.a1Data.quiz.id}/scores`, {
      cookie: facACookie,
      body: { scores: [{ studentId: fx.stuUnrelated.studentProfile.id, score: 15 }] },
    });
    const leakedRow = await prisma.quizScore.findUnique({
      where: {
        sessionId_studentId: {
          sessionId: fx.a1Data.quiz.id,
          studentId: fx.stuUnrelated.studentProfile.id,
        },
      },
    });
    if (leakedRow) {
      await prisma.quizScore.delete({ where: { id: leakedRow.id } });
    }
    assert.ok([400, 404].includes(res.status) && !leakedRow, `Unenrolled student scored in bulk quiz: status=${res.status}`);
    for (const unapprovedId of [fx.stuPendingA.studentProfile.id, fx.stuDeclinedA.studentProfile.id, fx.stuDroppedA.studentProfile.id]) {
      const rUnapp = await apiRequest(baseUrl, "PUT", `/api/quizzes/${fx.a1Data.quiz.id}/scores`, {
        cookie: facACookie,
        body: { scores: [{ studentId: unapprovedId, score: 12 }] },
      });
      assert.ok([400, 404].includes(rUnapp.status), `Unapproved enrollment ${unapprovedId} scored in bulk quiz: ${rUnapp.status}`);
    }
  });

  await t.test("AUTHZ-08c1: activity single score endpoint must require APPROVED enrollment (reject PENDING)", async () => {
    const actRes = await apiRequest(baseUrl, "PUT", `/api/activities/${fx.a1Data.activity.id}/scores/${fx.stuPendingA.studentProfile.id}`, {
      cookie: facACookie,
      body: { score: 30 },
    });
    await prisma.activityScore.deleteMany({
      where: { activityId: fx.a1Data.activity.id, studentId: fx.stuPendingA.studentProfile.id },
    });
    assert.equal(actRes.status, 404, `Activity scored PENDING student with ${actRes.status}`);
    for (const unapprovedId of [fx.stuDeclinedA.studentProfile.id, fx.stuDroppedA.studentProfile.id]) {
      const rUnapp = await apiRequest(baseUrl, "PUT", `/api/activities/${fx.a1Data.activity.id}/scores/${unapprovedId}`, {
        cookie: facACookie,
        body: { score: 30 },
      });
      assert.equal(rUnapp.status, 404, `Activity scored unapproved student ${unapprovedId} with ${rUnapp.status}`);
    }
  });

  await t.test("AUTHZ-08c2: project single score endpoint must require APPROVED enrollment (reject PENDING)", async () => {
    const projRes = await apiRequest(baseUrl, "PUT", `/api/projects/${fx.a1Data.midtermProject.id}/scores/${fx.stuPendingA.studentProfile.id}`, {
      cookie: facACookie,
      body: { score: 75, sessionId: fx.a1Data.session.id },
    });
    await prisma.projectScore.deleteMany({
      where: { projectId: fx.a1Data.midtermProject.id, studentId: fx.stuPendingA.studentProfile.id },
    });
    assert.equal(projRes.status, 404, `Project scored PENDING student with ${projRes.status}`);
    for (const unapprovedId of [fx.stuDeclinedA.studentProfile.id, fx.stuDroppedA.studentProfile.id]) {
      const rUnapp = await apiRequest(baseUrl, "PUT", `/api/projects/${fx.a1Data.midtermProject.id}/scores/${unapprovedId}`, {
        cookie: facACookie,
        body: { score: 75, sessionId: fx.a1Data.session.id },
      });
      assert.equal(rUnapp.status, 404, `Project scored unapproved student ${unapprovedId} with ${rUnapp.status}`);
    }
  });

  await t.test("AUTHZ-09: GET /api/classes/check-code must scope excludeId to owned classes only", { todo: "SEC-08" }, async () => {
    const res = await apiRequest(
      baseUrl,
      "GET",
      `/api/classes/check-code?code=${encodeURIComponent(fx.facBClass1.classCode)}&excludeId=${encodeURIComponent(fx.facBClass1.id)}`,
      { cookie: facACookie },
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.available, false, "Foreign excludeId allowed faculty A to probe faculty B classCode ownership");
  });

  await t.test("AUTHZ-10a: GET /api/students/:profileId/photo must block DECLINED enrollments", async () => {
    await prisma.classEnrollment.updateMany({
      where: { classId: fx.facAClass1.id, studentProfileId: fx.stuDeclinedA.studentProfile.id },
      data: { status: "DECLINED" },
    });
    const declinedPhotoRes = await apiRequest(baseUrl, "GET", `/api/students/${fx.stuDeclinedA.studentProfile.id}/photo`, {
      cookie: facACookie,
    });
    assert.equal(declinedPhotoRes.status, 403, `Faculty fetched DECLINED student photo (${declinedPhotoRes.status})`);
    for (const allowedId of [fx.stuA1.studentProfile.id, fx.stuPendingA.studentProfile.id, fx.stuDroppedA.studentProfile.id]) {
      const okPhoto = await apiRequest(baseUrl, "GET", `/api/students/${allowedId}/photo`, { cookie: facACookie });
      assert.equal(okPhoto.status, 200, `Authorized photo for ${allowedId} returned ${okPhoto.status}`);
    }
  });

  await t.test("AUTHZ-10b: GET /api/students/:profileId/photo must block arbitrary roster studentId probes when student never joined", async () => {
    const rosterAdd = await apiRequest(baseUrl, "POST", `/api/classes/${fx.facAClass2.id}/roster`, {
      cookie: facACookie,
      body: {
        entries: [{ studentName: "qa_Target", studentId: fx.stuB1.studentProfile.studentId }],
      },
    });
    assert.equal(rosterAdd.status, 201);
    const probePhotoRes = await apiRequest(baseUrl, "GET", `/api/students/${fx.stuB1.studentProfile.id}/photo`, {
      cookie: facACookie,
    });
    assert.equal(probePhotoRes.status, 403, `Adding another student's 7-digit ID to own roster exposed their photo (${probePhotoRes.status})`);
  });

  await t.test("AUTHZ-11: mass assignment & post-registration role escalation prevented", async () => {
    const email = `qa_mass_${fx.runId}@test.local`;
    fx.trackEmail(email);
    const reg = await apiRequest(baseUrl, "POST", "/api/auth/register", {
      body: {
        name: "qa_MassAssign",
        email,
        password: QA_PASSWORD,
        confirmPassword: QA_PASSWORD,
        role: "STUDENT",
        emailVerified: true,
        emailVerifiedAt: "2020-01-01T00:00:00.000Z",
        recaptchaToken: "ok",
      },
    });
    assert.equal(reg.status, 201);
    assert.equal(reg.json.user.emailVerified, false);

    // Attempt upgrading own role via profile PUT or join
    const stuUpd = await apiRequest(baseUrl, "PUT", "/api/student/profile", {
      cookie: reg.sidCookie,
      body: {
        name: "qa_MassAssign",
        email,
        studentId: fx.spareStudentId,
        program: "BSIT",
        section: "3A",
        address: "qa_City",
        birthdate: "2004-01-01",
        photo: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
        role: "FACULTY",
        userId: fx.facA.id,
        emailVerified: true,
      },
    });
    assert.equal(stuUpd.status, 200, `Unexpected PUT /api/student/profile status: ${stuUpd.rawText}`);

    const meAfter = await apiRequest(baseUrl, "GET", "/api/auth/me", { cookie: reg.sidCookie });
    assert.equal(meAfter.json.user.role, "STUDENT");
    assert.equal(meAfter.json.user.emailVerified, false);

    // Faculty cannot spoof facultyId when creating a class
    const clsCreate = await apiRequest(baseUrl, "POST", "/api/classes", {
      cookie: facACookie,
      body: {
        sectionName: `qa_MassCls_${fx.runId}`,
        courseCode: "QA-MASS1",
        courseTitle: "qa_Mass",
        classCode: `QA-M${fx.runId.slice(-4).toUpperCase()}`,
        facultyId: fx.facB.id,
        archivedAt: "2020-01-01T00:00:00.000Z",
      },
    });
    assert.equal(clsCreate.status, 201);
    fx.trackClassCode(clsCreate.json.class.classCode);
    assert.equal(clsCreate.json.class.facultyId, fx.facA.id);
    assert.equal(clsCreate.json.class.archivedAt, null);

    // Student cannot pass status: "APPROVED" on join
    const joinRes = await apiRequest(baseUrl, "POST", "/api/classes/join", {
      cookie: reg.sidCookie,
      body: {
        classCode: fx.facAClass2.classCode,
        status: "APPROVED",
        autoApprovedAt: new Date().toISOString(),
        recaptchaToken: "ok",
      },
    });
    assert.equal(joinRes.status, 201);
    assert.equal(joinRes.json.status, "PENDING");
  });

  await t.test("AUTHZ-12: open self-selected FACULTY registration without domain/invite restriction requires design decision", { todo: "SEC-07" }, async () => {
    const email = `qa_openfac_${fx.runId}@arbitrary-student-domain.example`;
    fx.trackEmail(email);
    const res = await apiRequest(baseUrl, "POST", "/api/auth/register", {
      body: {
        name: "qa_SelfSelected Faculty",
        email,
        password: QA_PASSWORD,
        confirmPassword: QA_PASSWORD,
        role: "FACULTY",
        recaptchaToken: "ok",
      },
    });
    assert.equal(res.status, 403, `Any email self-registered directly as FACULTY (${res.status})`);
  });

  await t.test("AUTHZ-13: unverified account access boundary check on sensitive operations", { todo: "SEC-06" }, async () => {
    const facUnvLogin = await loginAs(baseUrl, fx.facUnverified.email);
    assert.equal(facUnvLogin.status, 200);
    assert.equal(facUnvLogin.json.user.emailVerified, false);

    // Attempt creating class while unverified
    const createCls = await apiRequest(baseUrl, "POST", "/api/classes", {
      cookie: facUnvLogin.sidCookie,
      body: {
        sectionName: `qa_UnvCls_${fx.runId}`,
        courseCode: "QA-UNV1",
        courseTitle: "qa_Unverified Class",
        classCode: `QA-U${fx.runId.slice(-4).toUpperCase()}`,
      },
    });
    if (createCls.json?.class?.classCode) fx.trackClassCode(createCls.json.class.classCode);
    assert.equal(createCls.status, 403, `Unverified faculty allowed to create class (${createCls.status})`);
  });

  await t.test("AUTHZ-14: tampered, unsigned, fabricated cookies & alg=none JWTs rejected (401)", async () => {
    const tamperedSig = facACookie.slice(0, -4) + "XXXX";
    const unsignedVal = facACookie.replace("classdex.sid=s%3A", "classdex.sid=");
    const algNoneJwt = "eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJ1c2VySWQiOiJmYWtlIiwicm9sZSI6IkZBQ1VMVFkifQ.";

    for (const badCookie of [
      tamperedSig,
      unsignedVal,
      "classdex.sid=s%3Aforged-session-id.invalidsignature",
      `classdex.sid=${algNoneJwt}`,
    ]) {
      const r = await apiRequest(baseUrl, "GET", "/api/auth/me", { cookie: badCookie });
      assert.equal(r.status, 401);
    }

    const rAuthzHeader = await apiRequest(baseUrl, "GET", "/api/auth/me", {
      headers: { Authorization: `Bearer ${algNoneJwt}` },
    });
    assert.equal(rAuthzHeader.status, 401);
  });

  await t.test("AUTHZ-15: session invalidation on logout, change-password, and reset-password across concurrent sessions", async () => {
    const tempEmail = `qa_sess_${fx.runId}@test.local`;
    fx.trackEmail(tempEmail);
    const pw1 = "QaSessionPw1!";
    const pw2 = "QaSessionPw2!";
    const pw3 = "QaSessionPw3!";
    await prisma.user.create({
      data: {
        name: "qa_Session Test",
        email: tempEmail,
        password: await sec.bcrypt.hash(pw1, 10),
        role: "STUDENT",
        emailVerified: true,
      },
    });

    // Session 1 & 2 before logout
    const s1 = await loginAs(baseUrl, tempEmail, pw1);
    const s2 = await loginAs(baseUrl, tempEmail, pw1);
    assert.equal(s1.status, 200);
    assert.equal(s2.status, 200);

    // Logout S1 -> S1 rejected immediately
    const lo = await apiRequest(baseUrl, "POST", "/api/auth/logout", { cookie: s1.sidCookie });
    assert.equal(lo.status, 200);
    assert.equal((await apiRequest(baseUrl, "GET", "/api/auth/me", { cookie: s1.sidCookie })).status, 401);

    // Change password via S2 -> regenerates S2 new cookie, old S2 cookie rejected; S3 concurrent session rejected too
    const s3 = await loginAs(baseUrl, tempEmail, pw1);
    assert.equal(s3.status, 200);
    await new Promise((r) => setTimeout(r, 15));

    const chg = await apiRequest(baseUrl, "POST", "/api/auth/change-password", {
      cookie: s2.sidCookie,
      body: { currentPassword: pw1, newPassword: pw2, confirmPassword: pw2 },
    });
    assert.equal(chg.status, 200);
    assert.ok(chg.sidCookie && chg.sidCookie !== s2.sidCookie, "Expected regenerated session cookie on change-password");
    assert.equal((await apiRequest(baseUrl, "GET", "/api/auth/me", { cookie: s2.sidCookie })).status, 401, "Old pre-change S2 cookie must fail");
    assert.equal((await apiRequest(baseUrl, "GET", "/api/auth/me", { cookie: s3.sidCookie })).status, 401, "Concurrent S3 cookie must fail after password change");
    assert.equal((await apiRequest(baseUrl, "GET", "/api/auth/me", { cookie: chg.sidCookie })).status, 200, "New regenerated S2 cookie works");

    // Reset password while sActive exists -> concurrent session must be invalidated
    const sActive = await loginAs(baseUrl, tempEmail, pw2);
    assert.equal(sActive.status, 200);
    await new Promise((r) => setTimeout(r, 15));

    mailer.clearStubEmails();
    const forgot = await apiRequest(baseUrl, "POST", "/api/auth/forgot-password", {
      body: { email: tempEmail, recaptchaToken: "ok" },
    });
    assert.equal(forgot.status, 200);
    const resetMail = mailer.getStubEmails().find((m) => m.to === tempEmail);
    assert.ok(resetMail?.link);
    const resetToken = new URL(resetMail.link).searchParams.get("token");

    const resetRes = await apiRequest(baseUrl, "POST", "/api/auth/reset-password", {
      body: { token: resetToken, password: pw3, confirmPassword: pw3 },
    });
    assert.equal(resetRes.status, 200);
    assert.equal((await apiRequest(baseUrl, "GET", "/api/auth/me", { cookie: sActive.sidCookie })).status, 401, "Session issued before password reset must be invalidated");
  });

  await t.test("AUTHZ-16: verification & reset token validation, single-use replay, superseded token & expiry", async () => {
    const tokUser = await prisma.user.findUnique({ where: { id: fx.facUnverified.id } });
    assert.ok(tokUser);

    mailer.clearStubEmails();
    const r1 = await apiRequest(baseUrl, "POST", "/api/auth/forgot-password", {
      body: { email: fx.facUnverified.email, recaptchaToken: "ok" },
    });
    assert.equal(r1.status, 200);
    const tok1 = new URL(mailer.getStubEmails().at(-1).link).searchParams.get("token");

    // Issue second token -> supersedes tok1
    const r2 = await apiRequest(baseUrl, "POST", "/api/auth/forgot-password", {
      body: { email: fx.facUnverified.email, recaptchaToken: "ok" },
    });
    assert.equal(r2.status, 200);
    const tok2 = new URL(mailer.getStubEmails().at(-1).link).searchParams.get("token");

    const v1 = await apiRequest(baseUrl, "GET", `/api/auth/reset-password/validate?token=${encodeURIComponent(tok1)}`);
    assert.equal(v1.json.valid, false);

    const vBad = await apiRequest(baseUrl, "GET", `/api/auth/reset-password/validate?token=${encodeURIComponent(tok2.slice(0, 12))}`);
    assert.equal(vBad.json.valid, false);

    const v2 = await apiRequest(baseUrl, "GET", `/api/auth/reset-password/validate?token=${encodeURIComponent(tok2)}`);
    assert.equal(v2.json.valid, true);

    // Consume tok2 once, then replay -> must fail
    const consume1 = await apiRequest(baseUrl, "POST", "/api/auth/reset-password", {
      body: { token: tok2, password: QA_PASSWORD, confirmPassword: QA_PASSWORD },
    });
    assert.equal(consume1.status, 200);

    const replay = await apiRequest(baseUrl, "POST", "/api/auth/reset-password", {
      body: { token: tok2, password: QA_PASSWORD, confirmPassword: QA_PASSWORD },
    });
    assert.equal(replay.status, 400);
    assert.equal(replay.json.reason, "used");

    // Expired verification token rejected
    const { generateToken } = require("../../classdex-backend/src/utils/tokens");
    const expPair = generateToken();
    await prisma.emailVerificationToken.create({
      data: {
        userId: fx.facUnverified.id,
        tokenHash: expPair.hash,
        expiresAt: new Date(Date.now() - 60_000),
      },
    });
    const expVerify = await apiRequest(baseUrl, "POST", "/api/auth/verify-email", {
      body: { token: expPair.raw },
    });
    assert.equal(expVerify.status, 400);
    assert.equal(expVerify.json.reason, "expired");
  });

  await t.test("AUTHZ-17: profile/me endpoints bind strictly to session user and ignore supplied foreign IDs", async () => {
    const me = await apiRequest(baseUrl, "GET", `/api/auth/me?userId=${fx.facB.id}`, { cookie: facACookie });
    assert.equal(me.status, 200);
    assert.equal(me.json.user.id, fx.facA.id);

    const fProf = await apiRequest(baseUrl, "GET", `/api/faculty/profile?userId=${fx.facB.id}`, { cookie: facACookie });
    assert.equal(fProf.status, 200);
    assert.equal(fProf.json.profile.userId, fx.facA.id);

    const sProf = await apiRequest(baseUrl, "GET", `/api/student/profile?userId=${fx.stuA2.id}`, { cookie: stuA1Cookie });
    assert.equal(sProf.status, 200);
    assert.equal(sProf.json.profile.userId, fx.stuA1.id);
  });

  await t.test("AUTHZ-18: database CUID randomness & auto-generated classCode 24-bit entropy measurement", async () => {
    assert.match(fx.facA.id, /^c[a-z0-9]{20,}$/i);
    assert.notEqual(fx.facA.id, fx.facB.id);

    // Create class without classCode to inspect server-generated join code
    const created = await apiRequest(baseUrl, "POST", "/api/classes", {
      cookie: facACookie,
      body: {
        sectionName: `qa_AutoCode_${fx.runId}`,
        courseCode: "QA-AUTO1",
        courseTitle: "qa_AutoCode",
      },
    });
    assert.equal(created.status, 201);
    const code = created.json.class.classCode;
    await prisma.class.delete({ where: { id: created.json.class.id } });
    // Documented entropy measurement: 6 hex chars = 16^6 = 16,777,216 (~24 bits)
    assert.match(code, /^[0-9A-F]{6}$/);
  });

  await t.test("AUTHZ-19a: response JSON scan contains zero password/tokenHash fields", async () => {
    const responsesToScan = [
      await apiRequest(baseUrl, "GET", "/api/auth/me", { cookie: facACookie }),
      await apiRequest(baseUrl, "GET", "/api/faculty/classes", { cookie: facACookie }),
      await apiRequest(baseUrl, "GET", `/api/classes/${fx.facAClass1.id}`, { cookie: facACookie }),
      await apiRequest(baseUrl, "GET", `/api/classes/${fx.facAClass1.id}/deck`, { cookie: facACookie }),
      await apiRequest(baseUrl, "GET", `/api/classes/${fx.facAClass1.id}/pending`, { cookie: facACookie }),
      await apiRequest(baseUrl, "GET", `/api/classes/${fx.facAClass1.id}/students/${fx.stuA1.studentProfile.id}/records`, { cookie: facACookie }),
      await apiRequest(baseUrl, "GET", "/api/student/classes", { cookie: stuA1Cookie }),
      await apiRequest(baseUrl, "GET", `/api/student/classes/${fx.facAClass1.id}/records`, { cookie: stuA1Cookie }),
    ];
    for (const res of responsesToScan) {
      assert.equal(res.status, 200);
      assert.deepEqual(findKeysRecursive(res.json), [], "Sensitive key leaked in JSON response");
    }

    const nonExistCls = await apiRequest(baseUrl, "GET", "/api/classes/clnonexistentid999", { cookie: facACookie });
    const foreignCls = await apiRequest(baseUrl, "GET", `/api/classes/${fx.facBClass1.id}`, { cookie: facACookie });
    assert.equal(nonExistCls.status, 404);
    assert.equal(foreignCls.status, 404);
  });

  await t.test("AUTHZ-19b: GET /api/students/:profileId/photo must not leak studentProfile existence via 403 vs 404", { todo: "SEC-09" }, async () => {
    const nonExistPhoto = await apiRequest(baseUrl, "GET", "/api/students/clnonexistentprofile99/photo", { cookie: facACookie });
    const foreignPhoto = await apiRequest(baseUrl, "GET", `/api/students/${fx.stuUnrelated.studentProfile.id}/photo`, { cookie: facACookie });
    assert.equal(nonExistPhoto.status, 404);
    assert.equal(foreignPhoto.status, 404, `Photo endpoint returned ${foreignPhoto.status} vs ${nonExistPhoto.status}, revealing profile existence`);
  });

  await t.test("AUTHZ-21: archived class mutation guard blocks canonicalized, trailing-slash, and encoded paths (409)", async () => {
    const encodedId = encodeURIComponent(fx.facAClassArchived.id);
    const archivedAttempts = [
      { method: "PATCH", path: `/api/classes/${fx.facAClassArchived.id}`, body: { sectionName: "qa_No" } },
      { method: "PATCH", path: `/api/classes/${fx.facAClassArchived.id}/`, body: { sectionName: "qa_No" } },
      { method: "POST", path: `/api/classes/${encodedId}/roster/`, body: { entries: [{ studentName: "qa_X", studentId: fx.spareStudentId }] } },
      { method: "POST", path: `/api/classes/${fx.facAClassArchived.id}/sessions/today/`, body: {} },
      { method: "PATCH", path: `/api/quizzes/${fx.aArchivedData.quiz.id}/`, body: { title: "qa_No" } },
      { method: "PATCH", path: `/api/activities/${fx.aArchivedData.activity.id}/`, body: { title: "qa_No" } },
      { method: "PATCH", path: `/api/projects/${fx.aArchivedData.midtermProject.id}/`, body: { maxScore: 50 } },
      { method: "PATCH", path: `/api/recitation-logs/${fx.aArchivedData.recitationLog.id}/`, body: { score: 1 } },
    ];
    for (const attempt of archivedAttempts) {
      const res = await apiRequest(baseUrl, attempt.method, attempt.path, {
        cookie: facACookie,
        body: attempt.body,
      });
      assert.equal(res.status, 409, `${attempt.method} ${attempt.path} returned ${res.status} instead of 409: ${res.rawText}`);
    }
  });

  await t.test("AUTHZ-22: non-string token type confusion on token endpoints returns 400 / valid=false cleanly", async () => {
    for (const badToken of [{ not: "" }, ["arr"], 12345, null, true]) {
      const rReset = await apiRequest(baseUrl, "POST", "/api/auth/reset-password", {
        body: { token: badToken, password: QA_PASSWORD, confirmPassword: QA_PASSWORD },
      });
      assert.equal(rReset.status, 400);
      assert.equal(rReset.json.valid, false);

      const rVerify = await apiRequest(baseUrl, "POST", "/api/auth/verify-email", {
        body: { token: badToken },
      });
      assert.equal(rVerify.status, 400);
      assert.equal(rVerify.json.valid, false);
    }

    const rValidateBracket = await apiRequest(baseUrl, "GET", "/api/auth/reset-password/validate?token[not]=");
    assert.equal(rValidateBracket.status, 200);
    assert.equal(rValidateBracket.json.valid, false);
  });
});
