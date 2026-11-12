const http = require("node:http");
const { mock } = require("node:test");
const bcrypt = require("../../../classdex-backend/node_modules/bcryptjs");
const { initSecurityTestEnv } = require("../setup.cjs");

const SAMPLE_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const SAMPLE_PHOTO = `data:image/png;base64,${SAMPLE_PNG_BASE64}`;
const QA_PASSWORD = "QaSecPassword123!";

let bootState = null;

function isLocalhostUrl(urlStr) {
  try {
    const parsed = new URL(urlStr);
    return (
      parsed.hostname === "127.0.0.1" ||
      parsed.hostname === "localhost" ||
      parsed.hostname === "::1"
    );
  } catch {
    return false;
  }
}

function initSecurityBackend() {
  if (bootState) return bootState;

  const { testHost } = initSecurityTestEnv();
  const originalFetch = global.fetch.bind(global);
  let customExternalFetchGuard = null;

  global.fetch = async function guardedFetch(input, init) {
    const urlStr = typeof input === "string" ? input : input?.url || String(input);
    if (!isLocalhostUrl(urlStr)) {
      if (customExternalFetchGuard) {
        return customExternalFetchGuard(urlStr, input, init, originalFetch);
      }
      throw new Error(
        `[Security Harness Guard] Blocked unintended outbound fetch to external URL: ${urlStr}`,
      );
    }
    return originalFetch(input, init);
  };

  let captchaHandler = async (token) => {
    if (!token || !String(token).trim() || token === "bad-captcha") {
      return { success: false, message: "Captcha verification failed." };
    }
    return { success: true };
  };

  const recaptcha = require("../../../classdex-backend/recaptcha");
  mock.method(recaptcha, "verifyRecaptchaToken", async (token, remoteIp) =>
    captchaHandler(token, remoteIp),
  );

  const backendIndex = require("../../../classdex-backend/index");
  const { prisma } = require("../../../classdex-backend/db");
  const mailer = require("../../../classdex-backend/src/services/mailer");

  bootState = {
    testHost,
    bcrypt,
    app: backendIndex.app,
    backendIndex,
    prisma,
    mailer,
    recaptcha,
    setCaptchaHandler(fn) {
      captchaHandler = fn;
    },
    resetCaptchaHandler() {
      captchaHandler = async (token) => {
        if (!token || !String(token).trim() || token === "bad-captcha") {
          return { success: false, message: "Captcha verification failed." };
        }
        return { success: true };
      };
    },
    setExternalFetchGuard(fn) {
      customExternalFetchGuard = fn;
    },
    resetExternalFetchGuard() {
      customExternalFetchGuard = null;
    },
    async startServer(port = 0) {
      const server = http.createServer(backendIndex.app);
      await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
      const addr = server.address();
      return {
        server,
        port: addr.port,
        baseUrl: `http://127.0.0.1:${addr.port}`,
        async close() {
          await new Promise((resolve) => server.close(resolve));
        },
      };
    },
  };

  return bootState;
}

function makeRunId(prefix = "sec") {
  return `qa_${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

async function allocUniqueStudentIds(prisma, count, usedSet = new Set()) {
  const result = [];
  while (result.length < count) {
    const candidates = Array.from({ length: count * 5 }, () =>
      String(Math.floor(8100000 + Math.random() * 1799999)),
    ).filter((id) => !usedSet.has(id) && !result.includes(id));

    if (!candidates.length) continue;
    const [profiles, rosters] = await Promise.all([
      prisma.studentProfile.findMany({
        where: { studentId: { in: candidates } },
        select: { studentId: true },
      }),
      prisma.classRoster.findMany({
        where: { studentId: { in: candidates } },
        select: { studentId: true },
      }),
    ]);
    const taken = new Set([
      ...profiles.map((p) => p.studentId),
      ...rosters.map((r) => r.studentId),
    ]);
    for (const id of candidates) {
      if (!taken.has(id)) {
        usedSet.add(id);
        result.push(id);
        if (result.length === count) break;
      }
    }
  }
  return result;
}

async function createSecurityFixtures(prisma, tag = "s70") {
  const runId = makeRunId(tag);
  const codeBase = runId.replace(/[^a-z0-9]/gi, "").slice(-6).toUpperCase();
  const passwordHash = await bcrypt.hash(QA_PASSWORD, 10);
  const createdUserEmails = [];
  const createdClassCodes = [];
  const studentIds = await allocUniqueStudentIds(prisma, 11);

  const mkFaculty = async (label, verified = true) => {
    const email = `${runId}_${label}@test.local`.toLowerCase();
    createdUserEmails.push(email);
    return prisma.user.create({
      data: {
        name: `qa_${label} ${runId}`,
        email,
        password: passwordHash,
        role: "FACULTY",
        emailVerified: verified,
        emailVerifiedAt: verified ? new Date() : null,
        facultyProfile: {
          create: {
            name: `qa_${label} ${runId}`,
            department: "qa_Information Technology",
            email,
            contact: "+63 917 000 0000",
            photo: SAMPLE_PHOTO,
          },
        },
      },
      include: { facultyProfile: true },
    });
  };

  const mkStudent = async (label, sid, verified = true, nameOverride = null) => {
    const email = `${runId}_${label}@test.local`.toLowerCase();
    const fullName = nameOverride || `qa_${label} Student`;
    createdUserEmails.push(email);
    return prisma.user.create({
      data: {
        name: fullName,
        email,
        password: passwordHash,
        role: "STUDENT",
        emailVerified: verified,
        emailVerifiedAt: verified ? new Date() : null,
        studentProfile: {
          create: {
            name: fullName,
            studentId: sid,
            email,
            program: "BSIT",
            section: "qa_3A",
            address: "qa_123 Test St, Tacloban City",
            birthdate: new Date("2004-06-15T00:00:00.000Z"),
            photo: SAMPLE_PHOTO,
            firstName: "qa",
            lastName: label,
            sortKey: `${label} qa`,
          },
        },
      },
      include: { studentProfile: true },
    });
  };

  const [
    facA,
    facB,
    facUnverified,
    stuA1,
    stuA2,
    stuPendingA,
    stuDroppedA,
    stuDeclinedA,
    stuUnrelated,
    stuUnverified,
    stuB1,
    stuPendingB,
    stuDroppedB,
  ] = await Promise.all([
    mkFaculty("facA", true),
    mkFaculty("facB", true),
    mkFaculty("facUnv", false),
    mkStudent("stuA1", studentIds[0], true),
    mkStudent("stuA2", studentIds[1], true),
    mkStudent("stuPendA", studentIds[2], true),
    mkStudent("stuDropA", studentIds[3], true),
    mkStudent("stuDeclA", studentIds[4], true),
    mkStudent("stuUnrel", studentIds[5], true),
    mkStudent("stuUnv", studentIds[6], false),
    mkStudent("stuB1", studentIds[7], true),
    mkStudent("stuPendB", studentIds[8], true),
    mkStudent("stuDropB", studentIds[9], true),
  ]);

  const mkClass = async (facultyId, suffix, archived = false) => {
    const classCode = `QA-${codeBase}-${suffix}`.slice(0, 18).toUpperCase();
    createdClassCodes.push(classCode);
    return prisma.class.create({
      data: {
        facultyId,
        sectionName: `qa_${suffix}_${runId}`,
        courseCode: `QA-${suffix.slice(0, 4).toUpperCase()}`,
        courseTitle: `qa_Course ${suffix}`,
        classCode,
        description: `qa_Description ${suffix}`,
        schedule: "Mon & Wed, 8:00 AM - 9:30 AM",
        scheduleDays: ["Mon", "Wed"],
        scheduleStartTime: "08:00",
        scheduleEndTime: "09:30",
        gracePeriodMinutes: 15,
        recitationShuffleSeconds: 2,
        archivedAt: archived ? new Date(Date.now() - 86400_000) : null,
        projects: {
          create: [
            { type: "MIDTERM", maxScore: 100 },
            { type: "FINALS", maxScore: 100 },
          ],
        },
      },
      include: { projects: true },
    });
  };

  const [
    facAClass1,
    facAClass2,
    facAClassArchived,
    facBClass1,
    facBClass2,
    facBClassArchived,
  ] = await Promise.all([
    mkClass(facA.id, "A1", false),
    mkClass(facA.id, "A2", false),
    mkClass(facA.id, "AA", true),
    mkClass(facB.id, "B1", false),
    mkClass(facB.id, "B2", false),
    mkClass(facB.id, "BA", true),
  ]);

  const pastDateA = new Date(Date.UTC(2026, 9, 10));
  const pastDateB = new Date(Date.UTC(2026, 9, 11));

  const setupRichClass = async (
    cls,
    { approvedStu, extraApprovedStu, pendingStu, droppedStu, declinedStu, pastDate },
  ) => {
    const now = new Date();
    const dropTs = new Date(now.getTime() - 2 * 86400_000);
    const activeRoster = await prisma.classRoster.create({
      data: {
        classId: cls.id,
        studentName: approvedStu.name,
        studentId: approvedStu.studentProfile.studentId,
        firstName: approvedStu.studentProfile.firstName,
        lastName: approvedStu.studentProfile.lastName,
        sortKey: approvedStu.studentProfile.sortKey,
      },
    });
    const extraRoster = extraApprovedStu
      ? await prisma.classRoster.create({
          data: {
            classId: cls.id,
            studentName: extraApprovedStu.name,
            studentId: extraApprovedStu.studentProfile.studentId,
            firstName: extraApprovedStu.studentProfile.firstName,
            lastName: extraApprovedStu.studentProfile.lastName,
            sortKey: extraApprovedStu.studentProfile.sortKey,
          },
        })
      : null;
    const droppedRoster = await prisma.classRoster.create({
      data: {
        classId: cls.id,
        studentName: droppedStu.name,
        studentId: droppedStu.studentProfile.studentId,
        firstName: droppedStu.studentProfile.firstName,
        lastName: droppedStu.studentProfile.lastName,
        sortKey: droppedStu.studentProfile.sortKey,
        droppedAt: dropTs,
      },
    });

    const approvedEnroll = await prisma.classEnrollment.create({
      data: {
        classId: cls.id,
        studentProfileId: approvedStu.studentProfile.id,
        status: "APPROVED",
        autoApprovedAt: now,
      },
    });
    if (extraApprovedStu) {
      await prisma.classEnrollment.create({
        data: {
          classId: cls.id,
          studentProfileId: extraApprovedStu.studentProfile.id,
          status: "APPROVED",
        },
      });
    }
    const pendingEnroll = await prisma.classEnrollment.create({
      data: {
        classId: cls.id,
        studentProfileId: pendingStu.studentProfile.id,
        status: "PENDING",
      },
    });
    const droppedEnroll = await prisma.classEnrollment.create({
      data: {
        classId: cls.id,
        studentProfileId: droppedStu.studentProfile.id,
        status: "DROPPED",
        droppedAt: dropTs,
      },
    });
    const declinedEnroll = declinedStu
      ? await prisma.classEnrollment.create({
          data: {
            classId: cls.id,
            studentProfileId: declinedStu.studentProfile.id,
            status: "DECLINED",
          },
        })
      : null;

    const session = await prisma.classSession.create({
      data: {
        classId: cls.id,
        date: pastDate,
        startedAt: new Date(pastDate.getTime() + 8 * 3600_000),
      },
    });

    await prisma.attendanceRecord.create({
      data: {
        sessionId: session.id,
        studentId: approvedStu.studentProfile.id,
        status: "PRESENT",
        markedAt: session.startedAt,
      },
    });
    if (extraApprovedStu) {
      await prisma.attendanceRecord.create({
        data: {
          sessionId: session.id,
          studentId: extraApprovedStu.studentProfile.id,
          status: "PRESENT",
          markedAt: session.startedAt,
        },
      });
    }

    const recitationLog = await prisma.recitationLog.create({
      data: {
        sessionId: session.id,
        studentId: approvedStu.studentProfile.id,
        method: "RANDOM",
        score: 5,
      },
    });

    const activity = await prisma.activity.create({
      data: {
        classId: cls.id,
        sessionId: session.id,
        title: `qa_Activity_${cls.sectionName}`,
        maxScore: 50,
        scores: {
          create: [
            { studentId: approvedStu.studentProfile.id, score: 45, isAbsent: false },
          ],
        },
      },
    });

    const midtermProject = cls.projects.find((p) => p.type === "MIDTERM");
    await prisma.projectScore.create({
      data: {
        projectId: midtermProject.id,
        studentId: approvedStu.studentProfile.id,
        sessionId: session.id,
        score: 90,
        isAbsent: false,
      },
    });

    const quiz = await prisma.quizSession.create({
      data: {
        classId: cls.id,
        title: `qa_Quiz_${cls.sectionName}`,
        totalItems: 20,
        date: pastDate,
        scores: {
          create: [
            { studentId: approvedStu.studentProfile.id, score: 18, isAbsent: false },
          ],
        },
      },
    });

    return {
      cls,
      activeRoster,
      extraRoster,
      droppedRoster,
      approvedEnroll,
      pendingEnroll,
      droppedEnroll,
      declinedEnroll,
      session,
      recitationLog,
      activity,
      midtermProject,
      quiz,
    };
  };

  const a1Data = await setupRichClass(facAClass1, {
    approvedStu: stuA1,
    extraApprovedStu: stuA2,
    pendingStu: stuPendingA,
    droppedStu: stuDroppedA,
    declinedStu: stuDeclinedA,
    pastDate: pastDateA,
  });

  const b1Data = await setupRichClass(facBClass1, {
    approvedStu: stuB1,
    extraApprovedStu: stuA1,
    pendingStu: stuPendingB,
    droppedStu: stuDroppedB,
    declinedStu: null,
    pastDate: pastDateB,
  });

  const aArchivedData = await setupRichClass(facAClassArchived, {
    approvedStu: stuA1,
    extraApprovedStu: null,
    pendingStu: stuPendingA,
    droppedStu: stuDroppedA,
    declinedStu: null,
    pastDate: pastDateA,
  });

  const cleanup = async () => {
    const classCodesToDelete = createdClassCodes.filter((c) => c.startsWith("QA-"));
    const emailsToDelete = createdUserEmails.filter((e) => e.startsWith("qa_"));
    if (classCodesToDelete.length) {
      await prisma.class.deleteMany({
        where: { classCode: { in: classCodesToDelete } },
      });
    }
    if (emailsToDelete.length) {
      await prisma.class.deleteMany({
        where: { faculty: { email: { in: emailsToDelete } } },
      });
      await prisma.user.deleteMany({
        where: { email: { in: emailsToDelete } },
      });
    }
  };

  return {
    runId,
    password: QA_PASSWORD,
    spareStudentId: studentIds[10],
    facA,
    facB,
    facUnverified,
    stuA1,
    stuA2,
    stuPendingA,
    stuDroppedA,
    stuDeclinedA,
    stuUnrelated,
    stuUnverified,
    stuB1,
    stuPendingB,
    stuDroppedB,
    facAClass1,
    facAClass2,
    facAClassArchived,
    facBClass1,
    facBClass2,
    facBClassArchived,
    a1Data,
    b1Data,
    aArchivedData,
    trackEmail(email) {
      if (String(email || "").startsWith("qa_")) {
        createdUserEmails.push(email);
      }
    },
    trackClassCode(code) {
      if (String(code || "").startsWith("QA-")) {
        createdClassCodes.push(code);
      }
    },
    cleanup,
  };
}

function extractSessionCookies(res) {
  if (typeof res.headers.getSetCookie === "function") {
    return res.headers.getSetCookie();
  }
  const single = res.headers.get("set-cookie");
  return single ? [single] : [];
}

function extractSidCookie(res) {
  const all = extractSessionCookies(res);
  for (const raw of all) {
    const m = raw.match(/classdex\.sid=[^;]+/);
    if (m) return m[0];
  }
  return "";
}

async function apiRequest(baseUrl, method, route, { cookie, body, headers = {}, redirect = "manual" } = {}) {
  const reqHeaders = { ...headers };
  if (cookie) reqHeaders.Cookie = cookie;
  let reqBody;
  if (body !== undefined) {
    if (typeof body === "string") {
      if (!reqHeaders["Content-Type"]) reqHeaders["Content-Type"] = "application/json";
      reqBody = body;
    } else {
      if (!reqHeaders["Content-Type"]) reqHeaders["Content-Type"] = "application/json";
      reqBody = JSON.stringify(body);
    }
  }
  const res = await fetch(`${baseUrl}${route}`, {
    method,
    headers: reqHeaders,
    body: reqBody,
    redirect,
  });
  const rawText = await res.text();
  let json = null;
  try {
    json = rawText ? JSON.parse(rawText) : null;
  } catch {
    json = null;
  }
  return {
    status: res.status,
    headers: res.headers,
    rawText,
    json,
    setCookies: extractSessionCookies(res),
    sidCookie: extractSidCookie(res),
  };
}

async function loginAs(baseUrl, email, password = QA_PASSWORD) {
  const res = await apiRequest(baseUrl, "POST", "/api/auth/login", {
    body: { email, password },
  });
  return res;
}

function findKeysRecursive(value, targetKeys = new Set(["password", "passwordHash", "tokenHash"]), path = "$") {
  const hits = [];
  if (!value || typeof value !== "object") return hits;
  if (Array.isArray(value)) {
    value.forEach((item, idx) => {
      hits.push(...findKeysRecursive(item, targetKeys, `${path}[${idx}]`));
    });
    return hits;
  }
  for (const [key, val] of Object.entries(value)) {
    const childPath = `${path}.${key}`;
    if (targetKeys.has(key)) {
      hits.push(childPath);
    }
    hits.push(...findKeysRecursive(val, targetKeys, childPath));
  }
  return hits;
}

module.exports = {
  SAMPLE_PHOTO,
  QA_PASSWORD,
  initSecurityBackend,
  createSecurityFixtures,
  apiRequest,
  loginAs,
  findKeysRecursive,
  makeRunId,
};
