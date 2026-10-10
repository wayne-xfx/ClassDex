require("dotenv").config();
const express = require("express");
const cors = require("cors");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const { randomBytes } = require("node:crypto");
const { prisma } = require("./db");
const { applyGracePeriod } = require("./attendance");
const { eligibleCandidates, selectRecitationCandidate } = require("./recitation");
const { verifyRecaptchaToken } = require("./recaptcha");
const { buildExcelWorkbook, buildCsvExport } = require("./export");
const {
  buildVerificationEmail,
  buildJoinEmail,
  buildFacultyJoinEmail,
  buildDecisionEmail,
  queueEmail,
} = require("./email");
const {
  isValidScore,
  syncAttendanceScoreAbsence,
  createAbsentActivityScores,
  createAbsentProjectScores,
} = require("./gradebook");

const SCORE_STUDENT_SELECT = {
  id: true,
  name: true,
  photo: true,
  studentId: true,
  program: true,
  section: true,
};

const app = express();
const PORT = process.env.PORT || 5000;
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || "http://localhost:5173";
const ROLES = new Set(["FACULTY", "STUDENT"]);
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

app.use(
  cors({
    origin: FRONTEND_ORIGIN,
    credentials: true,
  }),
);
app.use(express.json({ limit: "8mb" }));
app.use(
  session({
    name: "classdex.sid",
    secret: process.env.SESSION_SECRET || "classdex-dev-session-secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: false,
      maxAge: 7 * 24 * 60 * 60 * 1000,
    },
  }),
);

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    createdAt: user.createdAt,
  };
}

function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ message: "Please log in to continue." });
  }
  return next();
}

function requireRole(role) {
  return (req, res, next) => {
    if (req.session.role !== role) {
      return res.status(403).json({ message: "You do not have permission to do that." });
    }
    return next();
  };
}

function optionalText(value) {
  const text = String(value || "").trim();
  return text || null;
}

function isValidPhoto(photo) {
  return (
    typeof photo === "string" &&
    photo.length <= 7_000_000 &&
    (/^https:\/\/\S+$/i.test(photo) ||
      /^data:image\/(?:jpeg|png|webp);base64,[a-z0-9+/]+=*$/i.test(photo))
  );
}

function normalizeClassCode(value) {
  return String(value || "").trim().toUpperCase();
}

async function requireRecaptcha(req, res) {
  const verified = await verifyRecaptchaToken(req.body?.recaptchaToken, req.ip);
  if (!verified) {
    res.status(400).json({ message: "Please complete the security check and try again." });
    return false;
  }
  return true;
}

const STUDENT_ID_PATTERN = /^\d{7}$/;

function validateRosterEntry(entry) {
  const studentName = String(entry?.studentName ?? entry?.name ?? "").trim();
  const studentId = String(entry?.studentId ?? "").trim();
  const errors = [];
  if (!studentName) errors.push("Missing name");
  if (!STUDENT_ID_PATTERN.test(studentId)) errors.push("Student ID must be exactly 7 digits");
  return { studentName, studentId, errors };
}

function parseRosterText(text) {
  return String(text || "").split(/\r?\n/).map((line, index) => {
    const trimmed = line.trim();
    if (!trimmed) return null;
    const columns = trimmed.includes(",") ? trimmed.split(",") : trimmed.split(/\t|\s+-\s+/);
    const entry = validateRosterEntry({ name: columns[0], studentId: columns[1] });
    return { ...entry, line: index + 1 };
  }).filter(Boolean);
}

async function findOwnedClass(classId, facultyId) {
  return prisma.class.findFirst({ where: { id: classId, facultyId }, select: { id: true } });
}

function manilaDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const dateParts = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return new Date(`${dateParts.year}-${dateParts.month}-${dateParts.day}T00:00:00.000Z`);
}

async function findOwnedSession(sessionId, facultyId) {
  return prisma.classSession.findFirst({
    where: { id: sessionId, class: { is: { facultyId } } },
    include: { class: true },
  });
}

function formatPercentSummary(numerator, denominator) {
  if (!denominator) return "—";
  return `${Math.round((numerator / denominator) * 100)}%`;
}

function formatAverageSummary(totalScore, count, suffix = "") {
  if (!count) return "—";
  return `${(totalScore / count).toFixed(1)}${suffix}`;
}

function summarizeWeightedScores(rows, totalKey) {
  let scored = 0;
  let possible = 0;
  for (const row of rows) {
    if (row.score === null || row.score === undefined) continue;
    const total = Number(row[totalKey]);
    const score = Number(row.score);
    if (!Number.isFinite(score) || score < 0) continue;
    scored += score;
    if (Number.isFinite(total) && total > 0) {
      possible += total;
    } else {
      possible += 100;
    }
  }
  return possible ? `${Math.round((scored / possible) * 100)}%` : "—";
}

function summarizeStudentClass(summaryRows) {
  const attendanceRows = summaryRows.attendance || [];
  const attendedCount = attendanceRows.filter((row) => ["PRESENT", "LATE"].includes(row.status)).length;
  const recitationRows = summaryRows.recitations || [];
  const quizRows = summaryRows.quizzes || [];
  const activityRows = summaryRows.activities || [];
  const recitationScoreTotal = recitationRows.reduce((sum, row) => sum + (row.score ?? 0), 0);
  const recitationCount = recitationRows.filter((row) => row.score !== null && row.score !== undefined).length;

  return {
    attendance: formatPercentSummary(attendedCount, attendanceRows.length),
    recitation: formatAverageSummary(recitationScoreTotal, recitationCount, " / 5"),
    activities: summarizeWeightedScores(activityRows, "maxScore"),
    quiz: summarizeWeightedScores(quizRows, "totalItems"),
  };
}

function isDatabaseUnavailable(error) {
  if (["P1001", "P2024"].includes(error?.code)) return true;
  const message = `${error?.message || ""} ${error?.cause?.message || ""}`;
  return /connection.*(?:timeout|terminated|refused|unavailable)|(?:timeout|refused).*connection/i.test(
    message,
  );
}

app.get("/api/status", (_req, res) => {
  res.json({ message: "ClassDex Backend is running successfully!" });
});

app.post("/api/auth/register", async (req, res) => {
  try {
    if (!(await requireRecaptcha(req, res))) {
      return;
    }
    const name = String(req.body?.name || "").trim();
    const email = String(req.body?.email || "").trim().toLowerCase();
    const password = String(req.body?.password || "");
    const confirmPassword = String(req.body?.confirmPassword || "");
    const role = String(req.body?.role || "").toUpperCase();

    if (!name) {
      return res.status(400).json({ message: "Full name is required." });
    }
    if (!EMAIL_PATTERN.test(email)) {
      return res.status(400).json({ message: "Enter a valid email address." });
    }
    if (password.length < 8) {
      return res
        .status(400)
        .json({ message: "Password must be at least 8 characters." });
    }
    if (password !== confirmPassword) {
      return res.status(400).json({ message: "Passwords do not match." });
    }
    if (!ROLES.has(role)) {
      return res
        .status(400)
        .json({ message: "Choose a role: Faculty or Student." });
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return res
        .status(409)
        .json({ message: "An account with this email already exists." });
    }

    const hashedPassword = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({
      data: {
        name,
        email,
        password: hashedPassword,
        role,
      },
    });

    req.session.userId = user.id;
    req.session.role = user.role;
    queueEmail(buildVerificationEmail(user), "registration verification");
    return res.status(201).json({ user: publicUser(user) });
  } catch (error) {
    console.error("Register failed:", error);
    return res.status(500).json({ message: "Unable to create account." });
  }
});

app.post("/api/auth/login", async (req, res) => {
  const timeout = setTimeout(() => {
    if (!res.headersSent) {
      res.status(503).json({
        message: "Sign-in is taking too long. Check the database connection and try again.",
      });
    }
  }, 20_000);

  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const password = String(req.body?.password || "");

    if (!EMAIL_PATTERN.test(email) || !password) {
      clearTimeout(timeout);
      return res
        .status(400)
        .json({ message: "Email and password are required." });
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      clearTimeout(timeout);
      return res.status(401).json({ message: "Invalid email or password." });
    }

    const matches = await bcrypt.compare(password, user.password);
    if (!matches) {
      clearTimeout(timeout);
      return res.status(401).json({ message: "Invalid email or password." });
    }

    req.session.userId = user.id;
    req.session.role = user.role;
    clearTimeout(timeout);
    return res.json({ user: publicUser(user) });
  } catch (error) {
    clearTimeout(timeout);
    console.error("Login failed:", error);
    if (res.headersSent) {
      return;
    }
    if (isDatabaseUnavailable(error)) {
      return res.status(503).json({
        message: "The database is unavailable. Check your PostgreSQL connection and try again.",
      });
    }
    return res.status(500).json({ message: "Unable to log in." });
  }
});

app.post("/api/auth/logout", (req, res) => {
  req.session.destroy((error) => {
    if (error) {
      console.error("Logout failed:", error);
      return res.status(500).json({ message: "Unable to log out." });
    }
    res.clearCookie("classdex.sid");
    return res.json({ message: "Logged out." });
  });
});

app.get("/api/auth/me", requireAuth, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.session.userId },
    });
    if (!user) {
      req.session.destroy(() => {});
      return res.status(401).json({ message: "Session expired." });
    }
    return res.json({ user: publicUser(user) });
  } catch (error) {
    console.error("Session lookup failed:", error);
    return res.status(500).json({ message: "Unable to load session." });
  }
});

app.get(
  "/api/faculty/profile",
  requireAuth,
  requireRole("FACULTY"),
  async (req, res) => {
    try {
      const profile = await prisma.facultyProfile.findUnique({
        where: { userId: req.session.userId },
      });
      return res.json({ profile });
    } catch (error) {
      console.error("Faculty profile lookup failed:", error);
      return res.status(500).json({ message: "Unable to load faculty profile." });
    }
  },
);

app.put(
  "/api/faculty/profile",
  requireAuth,
  requireRole("FACULTY"),
  async (req, res) => {
    try {
      const profile = await prisma.facultyProfile.upsert({
        where: { userId: req.session.userId },
        create: {
          userId: req.session.userId,
          name: optionalText(req.body?.name),
          department: optionalText(req.body?.department),
          photo: optionalText(req.body?.photo),
          email: optionalText(req.body?.email),
          contact: optionalText(req.body?.contact),
        },
        update: {
          name: optionalText(req.body?.name),
          department: optionalText(req.body?.department),
          photo: optionalText(req.body?.photo),
          email: optionalText(req.body?.email),
          contact: optionalText(req.body?.contact),
        },
      });
      return res.json({ profile });
    } catch (error) {
      console.error("Faculty profile save failed:", error);
      return res.status(500).json({ message: "Unable to save faculty profile." });
    }
  },
);

app.get(
  "/api/student/profile",
  requireAuth,
  requireRole("STUDENT"),
  async (req, res) => {
    try {
      const profile = await prisma.studentProfile.findUnique({
        where: { userId: req.session.userId },
      });
      return res.json({ profile });
    } catch (error) {
      console.error("Student profile lookup failed:", error);
      return res.status(500).json({ message: "Unable to load student profile." });
    }
  },
);

app.put(
  "/api/student/profile",
  requireAuth,
  requireRole("STUDENT"),
  async (req, res) => {
    const name = String(req.body?.name || "").trim();
    const studentId = String(req.body?.studentId || "").trim();
    const email = String(req.body?.email || "").trim().toLowerCase();
    const photo = req.body?.photo;
    const birthdateValue = String(req.body?.birthdate || "").trim();

    if (!name) {
      return res.status(400).json({ message: "Full name is required." });
    }
    if (!/^\d{7}$/.test(studentId)) {
      return res
        .status(400)
        .json({ message: "Student ID must be exactly 7 digits." });
    }
    if (!isValidPhoto(photo)) {
      return res.status(400).json({
        message: "Upload a JPG, PNG, or WebP photo up to 5 MB.",
      });
    }
    if (!EMAIL_PATTERN.test(email)) {
      return res.status(400).json({ message: "Enter a valid email address." });
    }

    let birthdate = null;
    if (birthdateValue) {
      birthdate = new Date(`${birthdateValue}T00:00:00.000Z`);
      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(birthdateValue) ||
        Number.isNaN(birthdate.getTime()) ||
        birthdate.toISOString().slice(0, 10) !== birthdateValue
      ) {
        return res.status(400).json({ message: "Enter a valid birthdate." });
      }
    }

    try {
      const profile = await prisma.studentProfile.upsert({
        where: { userId: req.session.userId },
        create: {
          userId: req.session.userId,
          name,
          address: optionalText(req.body?.address),
          program: optionalText(req.body?.program),
          section: optionalText(req.body?.section),
          studentId,
          photo,
          email,
          birthdate,
        },
        update: {
          name,
          address: optionalText(req.body?.address),
          program: optionalText(req.body?.program),
          section: optionalText(req.body?.section),
          studentId,
          photo,
          email,
          birthdate,
        },
      });
      return res.json({ profile });
    } catch (error) {
      if (error.code === "P2002") {
        return res
          .status(409)
          .json({ message: "That student ID is already linked to another profile." });
      }
      console.error("Student profile save failed:", error);
      return res.status(500).json({ message: "Unable to save student profile." });
    }
  },
);

app.get(
  "/api/faculty/classes",
  requireAuth,
  requireRole("FACULTY"),
  async (req, res) => {
    try {
      const classes = await prisma.class.findMany({
        where: { facultyId: req.session.userId },
        include: { _count: { select: { enrollments: true } } },
        orderBy: { createdAt: "desc" },
      });
      return res.json({ classes });
    } catch (error) {
      console.error("Faculty classes lookup failed:", error);
      return res.status(500).json({ message: "Unable to load your classes." });
    }
  },
);

app.get("/api/faculty/classes/pending-counts", requireAuth, requireRole("FACULTY"), async (req, res) => {
  try {
    const classes = await prisma.class.findMany({ where: { facultyId: req.session.userId }, select: { id: true, _count: { select: { enrollments: { where: { status: "PENDING" } } } } } });
    return res.json({ counts: Object.fromEntries(classes.map((item) => [item.id, item._count.enrollments])) });
  } catch (error) { return res.status(500).json({ message: "Unable to load pending request counts." }); }
});

app.get(
  "/api/classes/check-code",
  requireAuth,
  requireRole("FACULTY"),
  async (req, res) => {
    const classCode = normalizeClassCode(req.query.code);
    if (!/^[A-Z0-9-]{3,20}$/.test(classCode)) {
      return res.json({ available: false });
    }
    try {
      const existing = await prisma.class.findUnique({ where: { classCode } });
      return res.json({ available: !existing });
    } catch (error) {
      console.error("Class code check failed:", error);
      return res.status(500).json({ message: "Unable to check that class code." });
    }
  },
);

app.post(
  "/api/classes",
  requireAuth,
  requireRole("FACULTY"),
  async (req, res) => {
    const sectionName = String(req.body?.sectionName || "").trim();
    let classCode = normalizeClassCode(req.body?.classCode);
    if (!sectionName) {
      return res.status(400).json({ message: "Section name is required." });
    }
    if (classCode && !/^[A-Z0-9-]{3,20}$/.test(classCode)) {
      return res.status(400).json({
        message: "Use 3–20 letters, numbers, or hyphens for the class code.",
      });
    }

    try {
      if (!classCode) {
        for (let attempt = 0; attempt < 5; attempt += 1) {
          const candidate = randomBytes(4).toString("hex").slice(0, 6).toUpperCase();
          const exists = await prisma.class.findUnique({
            where: { classCode: candidate },
          });
          if (!exists) {
            classCode = candidate;
            break;
          }
        }
        if (!classCode) {
          return res.status(503).json({
            message: "Unable to generate a class code right now. Please try again.",
          });
        }
      }

      const createdClass = await prisma.class.create({
        data: {
          sectionName,
          classCode,
          description: optionalText(req.body?.description),
          schedule: optionalText(req.body?.schedule),
          facultyId: req.session.userId,
        },
        include: { _count: { select: { enrollments: true } } },
      });
      return res.status(201).json({ class: createdClass });
    } catch (error) {
      if (error.code === "P2002") {
        return res.status(409).json({
          message: "That class code is already in use. Choose another one.",
        });
      }
      console.error("Class creation failed:", error);
      return res.status(500).json({ message: "Unable to create class." });
    }
  },
);

app.get(
  "/api/classes/:id/roster",
  requireAuth,
  requireRole("FACULTY"),
  async (req, res) => {
    try {
      if (!(await findOwnedClass(req.params.id, req.session.userId))) return res.status(404).json({ message: "Class not found." });
      const roster = await prisma.classRoster.findMany({ where: { classId: req.params.id }, orderBy: [{ studentName: "asc" }, { studentId: "asc" }] });
      return res.json({ roster });
    } catch (error) {
      console.error("Roster lookup failed:", error);
      return res.status(500).json({ message: "Unable to load the student list." });
    }
  },
);

app.post(
  "/api/classes/:id/roster",
  requireAuth,
  requireRole("FACULTY"),
  async (req, res) => {
    try {
      if (!(await findOwnedClass(req.params.id, req.session.userId))) return res.status(404).json({ message: "Class not found." });
      const incoming = Array.isArray(req.body?.entries) ? req.body.entries.map(validateRosterEntry) : parseRosterText(req.body?.text);
      const seen = new Set();
      const invalid = incoming.map((entry, index) => {
        const errors = [...entry.errors];
        if (seen.has(entry.studentId)) errors.push("Duplicate student ID in upload");
        if (entry.studentId) seen.add(entry.studentId);
        return { ...entry, row: index + 1, errors };
      }).filter((entry) => entry.errors.length);
      if (!incoming.length) return res.status(400).json({ message: "Add at least one student list row." });
      if (invalid.length) return res.status(400).json({ message: "Fix the invalid student list rows before saving.", invalidRows: invalid });
      const roster = await prisma.$transaction(incoming.map((entry) => prisma.classRoster.upsert({
        where: { classId_studentId: { classId: req.params.id, studentId: entry.studentId } },
        create: { classId: req.params.id, studentName: entry.studentName, studentId: entry.studentId },
        update: { studentName: entry.studentName },
      })));
      return res.status(201).json({ roster });
    } catch (error) {
      console.error("Roster save failed:", error);
      return res.status(error.code === "P2002" ? 409 : 500).json({ message: error.code === "P2002" ? "That student ID is already in this student list." : "Unable to save the student list." });
    }
  },
);

app.patch(
  "/api/classes/:id/roster/:entryId",
  requireAuth,
  requireRole("FACULTY"),
  async (req, res) => {
    const entry = validateRosterEntry(req.body);
    if (entry.errors.length) return res.status(400).json({ message: entry.errors.join("; ") });
    try {
      if (!(await findOwnedClass(req.params.id, req.session.userId))) return res.status(404).json({ message: "Class not found." });
      const updated = await prisma.classRoster.updateMany({ where: { id: req.params.entryId, classId: req.params.id }, data: { studentName: entry.studentName, studentId: entry.studentId } });
      if (!updated.count) return res.status(404).json({ message: "Student list entry not found." });
      return res.json({ entry: await prisma.classRoster.findUnique({ where: { id: req.params.entryId } }) });
    } catch (error) {
      return res.status(error.code === "P2002" ? 409 : 500).json({ message: error.code === "P2002" ? "That student ID is already in this student list." : "Unable to update the student list entry." });
    }
  },
);

app.delete(
  "/api/classes/:id/roster/:entryId",
  requireAuth,
  requireRole("FACULTY"),
  async (req, res) => {
    try {
      if (!(await findOwnedClass(req.params.id, req.session.userId))) return res.status(404).json({ message: "Class not found." });
      const deleted = await prisma.classRoster.deleteMany({ where: { id: req.params.entryId, classId: req.params.id } });
      if (!deleted.count) return res.status(404).json({ message: "Student list entry not found." });
      return res.status(204).end();
    } catch (error) {
      return res.status(500).json({ message: "Unable to remove the student list entry." });
    }
  },
);

app.get("/api/classes/:id/pending", requireAuth, requireRole("FACULTY"), async (req, res) => {
  try {
    if (!(await findOwnedClass(req.params.id, req.session.userId))) return res.status(404).json({ message: "Class not found." });
    const pending = await prisma.classEnrollment.findMany({ where: { classId: req.params.id, status: "PENDING" }, include: { studentProfile: { select: { id: true, name: true, studentId: true, program: true, section: true, photo: true } } }, orderBy: { joinedAt: "asc" } });
    return res.json({ pending });
  } catch (error) { return res.status(500).json({ message: "Unable to load pending requests." }); }
});

app.patch("/api/classes/:id/pending/:enrollmentId", requireAuth, requireRole("FACULTY"), async (req, res) => {
  const status = String(req.body?.status || "").toUpperCase();
  if (!["APPROVED", "DECLINED"].includes(status)) return res.status(400).json({ message: "Status must be APPROVED or DECLINED." });
  try {
    const classRecord = await prisma.class.findFirst({
      where: { id: req.params.id, facultyId: req.session.userId },
      select: {
        id: true,
        sectionName: true,
        classCode: true,
        faculty: { select: { name: true, email: true } },
      },
    });
    if (!classRecord) return res.status(404).json({ message: "Class not found." });
    const updated = await prisma.classEnrollment.updateMany({ where: { id: req.params.enrollmentId, classId: req.params.id, status: "PENDING" }, data: { status } });
    if (!updated.count) return res.status(404).json({ message: "Pending request not found." });
    const enrollment = await prisma.classEnrollment.findUnique({
      where: { id: req.params.enrollmentId },
      include: { studentProfile: true, class: true },
    });
    if (enrollment?.studentProfile?.email) {
      queueEmail(
        buildDecisionEmail({
          studentName: enrollment.studentProfile.name,
          studentEmail: enrollment.studentProfile.email,
          classSectionName: classRecord.sectionName,
          decision: status,
          facultyName: classRecord.faculty?.name,
        }),
        `join ${status.toLowerCase()}`,
      );
    }
    return res.json({ enrollment });
  } catch (error) { return res.status(500).json({ message: "Unable to update pending request." }); }
});

app.get("/api/classes/:id/quizzes", requireAuth, requireRole("FACULTY"), async (req, res) => {
  try {
    if (!(await findOwnedClass(req.params.id, req.session.userId))) return res.status(404).json({ message: "Class not found." });
    const sessions = await prisma.quizSession.findMany({ where: { classId: req.params.id }, include: { scores: true }, orderBy: { date: "desc" } });
    const enriched = await Promise.all(sessions.map(async (session) => {
      const attendanceSession = await prisma.classSession.findUnique({ where: { classId_date: { classId: req.params.id, date: new Date(new Date(session.date).toISOString().slice(0, 10)) } }, select: { attendance: { select: { studentId: true, status: true } } } });
      const absentIds = new Set((attendanceSession?.attendance || []).filter((record) => record.status === "ABSENT").map((record) => record.studentId));
      return { ...session, scores: session.scores.map((score) => ({ ...score, isAbsent: score.isAbsent || absentIds.has(score.studentId), score: absentIds.has(score.studentId) ? null : score.score })) };
    }));
    return res.json({ sessions: enriched });
  } catch (error) { return res.status(500).json({ message: "Unable to load quiz sessions." }); }
});

app.post("/api/classes/:id/quizzes", requireAuth, requireRole("FACULTY"), async (req, res) => {
  const title = String(req.body?.title || "").trim();
  const totalItems = Number(req.body?.totalItems);
  if (!title || !Number.isInteger(totalItems) || totalItems < 1) return res.status(400).json({ message: "Quiz title and a positive whole-number total are required." });
  try {
    if (!(await findOwnedClass(req.params.id, req.session.userId))) return res.status(404).json({ message: "Class not found." });
    const session = await prisma.quizSession.create({ data: { classId: req.params.id, title, totalItems } });
    return res.status(201).json({ session });
  } catch (error) { return res.status(500).json({ message: "Unable to create quiz session." }); }
});

app.patch("/api/quizzes/:sessionId", requireAuth, requireRole("FACULTY"), async (req, res) => {
  const title = String(req.body?.title || "").trim();
  const totalItems = Number(req.body?.totalItems);
  if (!title || !Number.isInteger(totalItems) || totalItems < 1) return res.status(400).json({ message: "Quiz title and a positive whole-number total are required." });
  try {
    const session = await prisma.quizSession.findFirst({ where: { id: req.params.sessionId, class: { is: { facultyId: req.session.userId } } }, include: { scores: { where: { score: { not: null } }, select: { studentId: true, score: true, studentProfile: { select: { name: true } } } } } });
    if (!session) return res.status(404).json({ message: "Quiz session not found." });
    const conflicts = session.scores.filter((item) => item.score > totalItems);
    if (conflicts.length) return res.status(400).json({ message: "The new total is below existing scores.", conflicts: conflicts.map((item) => ({ studentId: item.studentId, name: item.studentProfile.name, score: item.score })) });
    const updated = await prisma.quizSession.update({ where: { id: session.id }, data: { title, totalItems }, include: { scores: true } });
    return res.json({ session: updated });
  } catch (error) { return res.status(500).json({ message: "Unable to update quiz session." }); }
});

app.delete("/api/quizzes/:sessionId", requireAuth, requireRole("FACULTY"), async (req, res) => {
  try {
    const session = await prisma.quizSession.findFirst({ where: { id: req.params.sessionId, class: { is: { facultyId: req.session.userId } } }, select: { id: true } });
    if (!session) return res.status(404).json({ message: "Quiz session not found." });
    await prisma.quizSession.delete({ where: { id: session.id } });
    return res.status(204).end();
  } catch (error) { return res.status(500).json({ message: "Unable to delete quiz session." }); }
});

app.put("/api/quizzes/:sessionId/scores/:studentId", requireAuth, requireRole("FACULTY"), async (req, res) => {
  const score = Number(req.body?.score);
  if (!Number.isInteger(score) || score < 0) return res.status(400).json({ message: "Score must be a non-negative whole number." });
  try {
    const session = await prisma.quizSession.findFirst({ where: { id: req.params.sessionId, class: { is: { facultyId: req.session.userId } } } });
    if (!session) return res.status(404).json({ message: "Quiz session not found." });
    if (score > session.totalItems) return res.status(400).json({ message: `Score cannot be higher than ${session.totalItems}.` });
    const enrollment = await prisma.classEnrollment.findFirst({ where: { classId: session.classId, studentProfileId: req.params.studentId, status: "APPROVED" } });
    if (!enrollment) return res.status(404).json({ message: "Student is not approved for this class." });
    const attendanceSession = await prisma.classSession.findUnique({ where: { classId_date: { classId: session.classId, date: new Date(new Date(session.date).toISOString().slice(0, 10)) } }, select: { attendance: { where: { studentId: req.params.studentId }, select: { status: true } } } });
    if (attendanceSession?.attendance[0]?.status === "ABSENT") {
      await prisma.quizScore.upsert({ where: { sessionId_studentId: { sessionId: session.id, studentId: req.params.studentId } }, create: { sessionId: session.id, studentId: req.params.studentId, score: null, isAbsent: true }, update: { score: null, isAbsent: true } });
      return res.status(409).json({ message: "This student is absent and cannot be scored." });
    }
    const saved = await prisma.quizScore.upsert({ where: { sessionId_studentId: { sessionId: session.id, studentId: req.params.studentId } }, create: { sessionId: session.id, studentId: req.params.studentId, score }, update: { score, isAbsent: false } });
    return res.json({ score: saved });
  } catch (error) { return res.status(500).json({ message: "Unable to save quiz score." }); }
});

app.get(
  "/api/classes/:id",
  requireAuth,
  requireRole("FACULTY"),
  async (req, res) => {
    try {
      const classRecord = await prisma.class.findFirst({
        where: { id: req.params.id, facultyId: req.session.userId },
        include: {
          enrollments: {
            include: { studentProfile: true },
            orderBy: { joinedAt: "desc" },
          },
        },
      });
      if (!classRecord) {
        return res.status(404).json({ message: "Class not found." });
      }
      return res.json({ class: classRecord });
    } catch (error) {
      console.error("Class lookup failed:", error);
      return res.status(500).json({ message: "Unable to load this class." });
    }
  },
);

app.get(
  "/api/classes/:id/deck",
  requireAuth,
  requireRole("FACULTY"),
  async (req, res) => {
    try {
      const classRecord = await prisma.class.findFirst({
        where: { id: req.params.id, facultyId: req.session.userId },
        include: {
          enrollments: {
            where: { status: "APPROVED" },
            include: {
              studentProfile: {
                select: {
                  id: true,
                  name: true,
                  address: true,
                  email: true,
                  photo: true,
                  studentId: true,
                  program: true,
                  section: true,
                },
              },
            },
            orderBy: { joinedAt: "asc" },
          },
        },
      });
      if (!classRecord) {
        return res.status(404).json({ message: "Class not found." });
      }

      const session = await prisma.classSession.findUnique({
        where: {
          classId_date: {
            classId: classRecord.id,
            date: manilaDate(),
          },
        },
        include: {
          attendance: {
            select: { studentId: true, status: true, markedAt: true },
            orderBy: { markedAt: "asc" },
          },
          recitations: {
            include: {
              studentProfile: {
                select: {
                  id: true,
                  name: true,
                  photo: true,
                  studentId: true,
                  program: true,
                  section: true,
                },
              },
            },
            orderBy: { calledAt: "desc" },
          },
        },
      });
      const { enrollments, ...classData } = classRecord;
      const attendanceByStudent = new Map(
        (session?.attendance || []).map((record) => [
          record.studentId,
          record.status,
        ]),
      );
      return res.json({
        class: classData,
        students: enrollments.map(({ studentProfile }) => ({
          ...studentProfile,
          studentProfileId: studentProfile.id,
          attendanceStatus: attendanceByStudent.get(studentProfile.id) || null,
        })),
        session: session
          ? {
              id: session.id,
              classId: session.classId,
              date: session.date,
              startedAt: session.startedAt,
              endedAt: session.endedAt,
            }
          : null,
        recitationHistory: session?.recitations || [],
      });
    } catch (error) {
      console.error("Class deck lookup failed:", error);
      return res.status(500).json({ message: "Unable to load this class deck." });
    }
  },
);

app.get(
  "/api/classes/:id/students/:studentId/records",
  requireAuth,
  requireRole("FACULTY"),
  async (req, res) => {
    try {
      const classRecord = await prisma.class.findFirst({
        where: { id: req.params.id, facultyId: req.session.userId },
        select: { id: true },
      });
      if (!classRecord) {
        return res.status(404).json({ message: "Class not found." });
      }

      const enrollment = await prisma.classEnrollment.findFirst({
        where: {
          classId: classRecord.id,
          studentProfileId: req.params.studentId,
          status: "APPROVED",
        },
        select: {
          studentProfile: {
            select: {
              id: true,
              name: true,
              photo: true,
              studentId: true,
              program: true,
              section: true,
            },
          },
        },
      });
      if (!enrollment) {
        return res.status(404).json({ message: "Student not found in this class." });
      }

      const [attendanceRecords, recitationRecords] = await Promise.all([
        prisma.attendanceRecord.findMany({
          where: {
            studentId: enrollment.studentProfile.id,
            session: { is: { classId: classRecord.id } },
          },
          select: {
            id: true,
            status: true,
            markedAt: true,
            session: { select: { id: true, date: true } },
          },
          orderBy: { markedAt: "desc" },
        }),
        prisma.recitationLog.findMany({
          where: {
            studentId: enrollment.studentProfile.id,
            session: { is: { classId: classRecord.id } },
          },
          select: {
            id: true,
            method: true,
            calledAt: true,
            score: true,
            session: { select: { id: true, date: true } },
          },
          orderBy: { calledAt: "desc" },
        }),
      ]);

      return res.json({
        student: enrollment.studentProfile,
        attendance: attendanceRecords,
        recitations: recitationRecords,
      });
    } catch (error) {
      console.error("Student class records lookup failed:", error);
      return res.status(500).json({ message: "Unable to load this student's records." });
    }
  },
);

app.post(
  "/api/classes/:id/sessions/today",
  requireAuth,
  requireRole("FACULTY"),
  async (req, res) => {
    try {
      const classRecord = await prisma.class.findFirst({
        where: { id: req.params.id, facultyId: req.session.userId },
        select: { id: true },
      });
      if (!classRecord) {
        return res.status(404).json({ message: "Class not found." });
      }

      const today = manilaDate();
      const session = await prisma.classSession.upsert({
        where: {
          classId_date: {
            classId: classRecord.id,
            date: today,
          },
        },
        create: {
          classId: classRecord.id,
          date: today,
        },
        update: {},
      });
      return res.json({ session });
    } catch (error) {
      console.error("Today's class session lookup or creation failed:", error);
      return res.status(500).json({ message: "Unable to open today's class session." });
    }
  },
);

app.patch(
  "/api/classes/:id",
  requireAuth,
  requireRole("FACULTY"),
  async (req, res) => {
    const gracePeriodMinutes = req.body?.gracePeriodMinutes;
    if (
      !Number.isInteger(gracePeriodMinutes) ||
      gracePeriodMinutes < 0 ||
      gracePeriodMinutes > 1440
    ) {
      return res.status(400).json({
        message: "Grace period must be a whole number from 0 to 1440 minutes.",
      });
    }

    try {
      const classRecord = await prisma.class.findFirst({
        where: { id: req.params.id, facultyId: req.session.userId },
        select: { id: true },
      });
      if (!classRecord) {
        return res.status(404).json({ message: "Class not found." });
      }
      const updatedClass = await prisma.class.update({
        where: { id: classRecord.id },
        data: { gracePeriodMinutes },
      });
      return res.json({ class: updatedClass });
    } catch (error) {
      console.error("Class grace period update failed:", error);
      return res.status(500).json({ message: "Unable to update this class." });
    }
  },
);

app.get(
  "/api/sessions/:id/activities",
  requireAuth,
  requireRole("FACULTY"),
  async (req, res) => {
    try {
      const sessionRecord = await findOwnedSession(req.params.id, req.session.userId);
      if (!sessionRecord) {
        return res.status(404).json({ message: "Class session not found." });
      }
      const activities = await prisma.activity.findMany({
        where: { sessionId: sessionRecord.id },
        include: {
          scores: {
            include: { studentProfile: { select: SCORE_STUDENT_SELECT } },
          },
        },
        orderBy: { createdAt: "asc" },
      });
      return res.json({ activities });
    } catch (error) {
      console.error("Session activities lookup failed:", error);
      return res.status(500).json({ message: "Unable to load activities." });
    }
  },
);

app.post(
  "/api/sessions/:id/activities",
  requireAuth,
  requireRole("FACULTY"),
  async (req, res) => {
    const title = String(req.body?.title || "").trim();
    const maxScore = req.body?.maxScore === undefined ? null : req.body.maxScore;
    if (!title) {
      return res.status(400).json({ message: "Activity title is required." });
    }
    if (maxScore !== null && (!Number.isInteger(maxScore) || maxScore < 1)) {
      return res.status(400).json({ message: "Maximum score must be null or a positive whole number." });
    }

    try {
      const sessionRecord = await findOwnedSession(req.params.id, req.session.userId);
      if (!sessionRecord) {
        return res.status(404).json({ message: "Class session not found." });
      }
      const activity = await prisma.$transaction(async (transaction) => {
        const createdActivity = await transaction.activity.create({
          data: {
            classId: sessionRecord.classId,
            sessionId: sessionRecord.id,
            title,
            maxScore,
          },
        });
        await createAbsentActivityScores(
          transaction,
          createdActivity.id,
          sessionRecord.id,
        );
        return transaction.activity.findUnique({
          where: { id: createdActivity.id },
          include: {
            scores: {
              include: { studentProfile: { select: SCORE_STUDENT_SELECT } },
            },
          },
        });
      });
      return res.status(201).json({ activity });
    } catch (error) {
      console.error("Activity creation failed:", error);
      return res.status(500).json({ message: "Unable to create this activity." });
    }
  },
);

app.patch(
  "/api/activities/:id",
  requireAuth,
  requireRole("FACULTY"),
  async (req, res) => {
    const body = req.body || {};
    const fields = Object.keys(body);
    if (!fields.length || fields.some((field) => !["title", "maxScore"].includes(field))) {
      return res.status(400).json({ message: "Provide a title and/or maxScore to update." });
    }
    const data = {};
    if (Object.prototype.hasOwnProperty.call(body, "title")) {
      if (typeof body.title !== "string" || !body.title.trim() || body.title.trim().length > 120) {
        return res.status(400).json({ message: "Activity title must be 1 to 120 characters." });
      }
      data.title = body.title.trim();
    }
    if (Object.prototype.hasOwnProperty.call(body, "maxScore")) {
      if (body.maxScore !== null && (!Number.isInteger(body.maxScore) || body.maxScore < 1)) {
        return res.status(400).json({ message: "Maximum score must be null or a positive whole number." });
      }
      data.maxScore = body.maxScore;
    }

    try {
      const activity = await prisma.activity.findFirst({
        where: {
          id: req.params.id,
          class: { is: { facultyId: req.session.userId } },
        },
        select: { id: true },
      });
      if (!activity) {
        return res.status(404).json({ message: "Activity not found." });
      }
      if (data.maxScore !== undefined && data.maxScore !== null) {
        const outOfRange = await prisma.activityScore.findFirst({
          where: { activityId: activity.id, score: { gt: data.maxScore } },
          select: { id: true },
        });
        if (outOfRange) {
          return res.status(400).json({ message: "Maximum score cannot be lower than a score already recorded." });
        }
      }
      const updatedActivity = await prisma.activity.update({
        where: { id: activity.id },
        data,
        include: {
          scores: { include: { studentProfile: { select: SCORE_STUDENT_SELECT } } },
        },
      });
      return res.json({ activity: updatedActivity });
    } catch (error) {
      console.error("Activity update failed:", error);
      return res.status(500).json({ message: "Unable to update this activity." });
    }
  },
);

app.delete(
  "/api/activities/:id",
  requireAuth,
  requireRole("FACULTY"),
  async (req, res) => {
    try {
      const activity = await prisma.activity.findFirst({
        where: {
          id: req.params.id,
          class: { is: { facultyId: req.session.userId } },
        },
        select: { id: true },
      });
      if (!activity) {
        return res.status(404).json({ message: "Activity not found." });
      }
      await prisma.activity.delete({ where: { id: activity.id } });
      return res.json({ message: "Activity deleted." });
    } catch (error) {
      console.error("Activity deletion failed:", error);
      return res.status(500).json({ message: "Unable to delete this activity." });
    }
  },
);

app.get(
  "/api/activities/:id/scores",
  requireAuth,
  requireRole("FACULTY"),
  async (req, res) => {
    try {
      const activity = await prisma.activity.findFirst({
        where: {
          id: req.params.id,
          class: { is: { facultyId: req.session.userId } },
        },
        select: { id: true, classId: true },
      });
      if (!activity) {
        return res.status(404).json({ message: "Activity not found." });
      }
      const enrollments = await prisma.classEnrollment.findMany({
        where: { classId: activity.classId, status: "APPROVED" },
        select: {
          studentProfile: {
            select: {
              ...SCORE_STUDENT_SELECT,
              activityScores: {
                where: { activityId: activity.id },
                select: { id: true, activityId: true, studentId: true, score: true, isAbsent: true },
              },
            },
          },
        },
      });
      const scores = enrollments.map(({ studentProfile }) => {
        const { activityScores, ...profile } = studentProfile;
        return activityScores[0] || {
          id: null,
          activityId: activity.id,
          studentId: profile.id,
          score: null,
          isAbsent: false,
          studentProfile: profile,
        };
      });
      return res.json({ scores });
    } catch (error) {
      console.error("Activity scores lookup failed:", error);
      return res.status(500).json({ message: "Unable to load activity scores." });
    }
  },
);

app.put(
  "/api/activities/:id/scores/:studentId",
  requireAuth,
  requireRole("FACULTY"),
  async (req, res) => {
    const score = req.body?.score;
    if (!Object.prototype.hasOwnProperty.call(req.body || {}, "score")) {
      return res.status(400).json({ message: "A whole-number score, or null, is required." });
    }
    try {
      const activity = await prisma.activity.findFirst({
        where: {
          id: req.params.id,
          class: { is: { facultyId: req.session.userId } },
        },
        select: { id: true, maxScore: true, sessionId: true, classId: true },
      });
      if (!activity) {
        return res.status(404).json({ message: "Activity not found." });
      }
      if (!isValidScore(score, activity.maxScore)) {
        return res.status(400).json({
          message: activity.maxScore == null
            ? "Score must be a whole number from 0 or greater, or null."
            : `Score must be a whole number from 0 to ${activity.maxScore}, or null.`,
        });
      }
      const enrollment = await prisma.classEnrollment.findFirst({
        where: {
          classId: activity.classId,
          studentProfileId: req.params.studentId,
        },
        select: { studentProfileId: true },
      });
      if (!enrollment) {
        return res.status(404).json({ message: "Student not found in this class." });
      }
      const attendance = await prisma.attendanceRecord.findUnique({
        where: {
          sessionId_studentId: {
            sessionId: activity.sessionId,
            studentId: enrollment.studentProfileId,
          },
        },
        select: { status: true },
      });
      if (attendance?.status === "ABSENT") {
        return res.status(409).json({ message: "This student is marked absent. Update attendance to change scoring access." });
      }
      const activityScore = await prisma.activityScore.upsert({
        where: {
          activityId_studentId: {
            activityId: activity.id,
            studentId: enrollment.studentProfileId,
          },
        },
        create: {
          activityId: activity.id,
          studentId: enrollment.studentProfileId,
          score,
          isAbsent: false,
        },
        update: { score, isAbsent: false },
        include: { studentProfile: { select: SCORE_STUDENT_SELECT } },
      });
      return res.json({ score: activityScore });
    } catch (error) {
      console.error("Activity score update failed:", error);
      return res.status(500).json({ message: "Unable to update the activity score." });
    }
  },
);

app.get(
  "/api/classes/:id/projects",
  requireAuth,
  requireRole("FACULTY"),
  async (req, res) => {
    try {
      const classRecord = await prisma.class.findFirst({
        where: { id: req.params.id, facultyId: req.session.userId },
        select: { id: true },
      });
      if (!classRecord) {
        return res.status(404).json({ message: "Class not found." });
      }
      const projects = await prisma.$transaction(async (transaction) => {
        const existingTypes = new Set(
          (await transaction.project.findMany({
            where: { classId: classRecord.id },
            select: { type: true },
          })).map(({ type }) => type),
        );
        const todaySession = await transaction.classSession.findUnique({
          where: {
            classId_date: {
              classId: classRecord.id,
              date: manilaDate(),
            },
          },
          select: { id: true },
        });
        for (const type of ["MIDTERM", "FINALS"]) {
          await transaction.project.upsert({
            where: { classId_type: { classId: classRecord.id, type } },
            create: { classId: classRecord.id, type },
            update: {},
          });
        }
        for (const type of ["MIDTERM", "FINALS"]) {
          if (!existingTypes.has(type) && todaySession) {
            const project = await transaction.project.findUnique({
              where: { classId_type: { classId: classRecord.id, type } },
              select: { id: true },
            });
            await createAbsentProjectScores(
              transaction,
              project.id,
              todaySession.id,
            );
          }
        }
        return transaction.project.findMany({
          where: { classId: classRecord.id },
          include: {
            scores: {
              include: {
                studentProfile: { select: SCORE_STUDENT_SELECT },
                session: { select: { id: true, date: true } },
              },
            },
          },
          orderBy: { type: "asc" },
        });
      });
      return res.json({ projects });
    } catch (error) {
      console.error("Class projects lookup failed:", error);
      return res.status(500).json({ message: "Unable to load this class's projects." });
    }
  },
);

app.patch(
  "/api/projects/:id",
  requireAuth,
  requireRole("FACULTY"),
  async (req, res) => {
    const maxScore = req.body?.maxScore;
    if (
      Object.keys(req.body || {}).some((key) => key !== "maxScore") ||
      !Number.isInteger(maxScore) ||
      maxScore < 1
    ) {
      return res.status(400).json({
        message: "Provide only a positive whole-number maxScore.",
      });
    }
    try {
      const project = await prisma.project.findFirst({
        where: {
          id: req.params.id,
          class: { is: { facultyId: req.session.userId } },
        },
        select: { id: true, classId: true },
      });
      if (!project) {
        return res.status(404).json({ message: "Project not found." });
      }
      const outOfRange = await prisma.projectScore.findFirst({
        where: { projectId: project.id, score: { gt: maxScore } },
        select: { id: true },
      });
      if (outOfRange) {
        return res.status(400).json({ message: "Maximum score cannot be lower than a score already recorded." });
      }
      const updatedProject = await prisma.project.update({
        where: { id: project.id },
        data: { maxScore },
      });
      return res.json({ project: updatedProject });
    } catch (error) {
      console.error("Project update failed:", error);
      return res.status(500).json({ message: "Unable to update this project." });
    }
  },
);

app.get(
  "/api/projects/:id/scores",
  requireAuth,
  requireRole("FACULTY"),
  async (req, res) => {
    try {
      const project = await prisma.project.findFirst({
        where: {
          id: req.params.id,
          class: { is: { facultyId: req.session.userId } },
        },
        select: { id: true, classId: true },
      });
      if (!project) {
        return res.status(404).json({ message: "Project not found." });
      }
      const enrollments = await prisma.classEnrollment.findMany({
        where: { classId: project.classId, status: "APPROVED" },
        select: {
          studentProfile: {
            select: {
              ...SCORE_STUDENT_SELECT,
              projectScores: {
                where: { projectId: project.id },
                select: {
                  id: true,
                  projectId: true,
                  studentId: true,
                  sessionId: true,
                  score: true,
                  isAbsent: true,
                  session: { select: { id: true, date: true } },
                },
              },
            },
          },
        },
      });
      const scores = enrollments.map(({ studentProfile }) => {
        const { projectScores, ...profile } = studentProfile;
        return projectScores[0] || {
          id: null,
          projectId: project.id,
          studentId: profile.id,
          sessionId: null,
          score: null,
          isAbsent: false,
          session: null,
          studentProfile: profile,
        };
      });
      return res.json({ scores });
    } catch (error) {
      console.error("Project scores lookup failed:", error);
      return res.status(500).json({ message: "Unable to load project scores." });
    }
  },
);

app.put(
  "/api/projects/:id/scores/:studentId",
  requireAuth,
  requireRole("FACULTY"),
  async (req, res) => {
    const score = req.body?.score;
    const sessionId = req.body?.sessionId === undefined ? null : req.body.sessionId;
    if (!Object.prototype.hasOwnProperty.call(req.body || {}, "score")) {
      return res.status(400).json({ message: "A whole-number score, or null, is required." });
    }
    if (sessionId !== null && (typeof sessionId !== "string" || !sessionId.trim())) {
      return res.status(400).json({ message: "Session ID must be a valid ID or null." });
    }
    try {
      const project = await prisma.project.findFirst({
        where: {
          id: req.params.id,
          class: { is: { facultyId: req.session.userId } },
        },
        select: { id: true, classId: true, maxScore: true },
      });
      if (!project) {
        return res.status(404).json({ message: "Project not found." });
      }
      if (!isValidScore(score, project.maxScore)) {
        return res.status(400).json({
          message: project.maxScore == null
            ? "Score must be a whole number from 0 or greater, or null."
            : `Score must be a whole number from 0 to ${project.maxScore}, or null.`,
        });
      }
      const enrollment = await prisma.classEnrollment.findFirst({
        where: {
          classId: project.classId,
          studentProfileId: req.params.studentId,
        },
        select: { studentProfileId: true },
      });
      if (!enrollment) {
        return res.status(404).json({ message: "Student not found in this class." });
      }
      if (sessionId) {
        const sessionRecord = await prisma.classSession.findFirst({
          where: { id: sessionId, classId: project.classId },
          select: { id: true },
        });
        if (!sessionRecord) {
          return res.status(404).json({ message: "Class session not found." });
        }
      }
      const attendanceSessionId = sessionId || (await prisma.classSession.findUnique({
        where: {
          classId_date: {
            classId: project.classId,
            date: manilaDate(),
          },
        },
        select: { id: true },
      }))?.id;
      if (attendanceSessionId) {
        const attendance = await prisma.attendanceRecord.findUnique({
          where: {
            sessionId_studentId: {
              sessionId: attendanceSessionId,
              studentId: enrollment.studentProfileId,
            },
          },
          select: { status: true },
        });
        if (attendance?.status === "ABSENT") {
          return res.status(409).json({ message: "This student is marked absent. Update attendance to change scoring access." });
        }
      }
      const projectScore = await prisma.$transaction(async (transaction) => {
        const existingScore = await transaction.projectScore.findUnique({
          where: {
            projectId_studentId: {
              projectId: project.id,
              studentId: enrollment.studentProfileId,
            },
          },
          select: { id: true },
        });
        const data = { score, isAbsent: false, sessionId };
        if (existingScore) {
          return transaction.projectScore.update({
            where: { id: existingScore.id },
            data,
            include: {
              studentProfile: { select: SCORE_STUDENT_SELECT },
              session: { select: { id: true, date: true } },
            },
          });
        }
        return transaction.projectScore.create({
          data: {
            ...data,
            projectId: project.id,
            studentId: enrollment.studentProfileId,
            sessionId,
          },
          include: {
            studentProfile: { select: SCORE_STUDENT_SELECT },
            session: { select: { id: true, date: true } },
          },
        });
      });
      return res.json({ score: projectScore });
    } catch (error) {
      console.error("Project score update failed:", error);
      return res.status(500).json({ message: "Unable to update the project score." });
    }
  },
);

app.put(
  "/api/sessions/:id/attendance/:studentId",
  requireAuth,
  requireRole("FACULTY"),
  async (req, res) => {
    const requestedStatus = req.body?.status;
    if (
      requestedStatus !== null &&
      requestedStatus !== "UNMARKED" &&
      !["PRESENT", "LATE", "ABSENT"].includes(requestedStatus)
    ) {
      return res.status(400).json({
        message: "Attendance status must be PRESENT, LATE, ABSENT, or UNMARKED.",
      });
    }
    if (!Object.prototype.hasOwnProperty.call(req.body || {}, "status")) {
      return res.status(400).json({ message: "Attendance status is required." });
    }

    try {
      const sessionRecord = await findOwnedSession(req.params.id, req.session.userId);
      if (!sessionRecord) {
        return res.status(404).json({ message: "Class session not found." });
      }
      const enrollment = await prisma.classEnrollment.findFirst({
        where: {
          classId: sessionRecord.classId,
          studentProfileId: req.params.studentId,
        },
        select: { studentProfileId: true },
      });
      if (!enrollment) {
        return res.status(404).json({ message: "Student not found in this class." });
      }

      const result = await prisma.$transaction(async (transaction) => {
        if (requestedStatus === null || requestedStatus === "UNMARKED") {
          await transaction.attendanceRecord.deleteMany({
            where: {
              sessionId: sessionRecord.id,
              studentId: enrollment.studentProfileId,
            },
          });
          await syncAttendanceScoreAbsence(
            transaction,
            sessionRecord.id,
            enrollment.studentProfileId,
            false,
          );
          return {
            attendance: null,
            appliedStatus: "UNMARKED",
            lateOverride: false,
          };
        }

        const { appliedStatus, lateOverride } = applyGracePeriod(
          requestedStatus,
          sessionRecord.startedAt,
          sessionRecord.class.gracePeriodMinutes,
        );
        const attendance = await transaction.attendanceRecord.upsert({
          where: {
            sessionId_studentId: {
              sessionId: sessionRecord.id,
              studentId: enrollment.studentProfileId,
            },
          },
          create: {
            sessionId: sessionRecord.id,
            studentId: enrollment.studentProfileId,
            status: appliedStatus,
          },
          update: { status: appliedStatus, markedAt: new Date() },
        });
        await syncAttendanceScoreAbsence(
          transaction,
          sessionRecord.id,
          enrollment.studentProfileId,
          appliedStatus === "ABSENT",
        );
        return { attendance, appliedStatus, lateOverride };
      });
      return res.json(result);
    } catch (error) {
      console.error("Session attendance update failed:", error);
      return res.status(500).json({ message: "Unable to update attendance." });
    }
  },
);

app.post(
  "/api/sessions/:id/recitation/shuffle",
  requireAuth,
  requireRole("FACULTY"),
  async (req, res) => {
    const mode = req.body?.mode;
    if (!["RANDOM", "WEIGHTED"].includes(mode)) {
      return res.status(400).json({ message: "Mode must be RANDOM or WEIGHTED." });
    }
    const excludeStudentId = req.body?.excludeStudentId;
    if (
      excludeStudentId !== undefined &&
      (typeof excludeStudentId !== "string" || !excludeStudentId.trim())
    ) {
      return res.status(400).json({ message: "The student to skip must be a valid student ID." });
    }

    try {
      const sessionRecord = await findOwnedSession(req.params.id, req.session.userId);
      if (!sessionRecord) {
        return res.status(404).json({ message: "Class session not found." });
      }
      const attendance = await prisma.attendanceRecord.findMany({
        where: {
          sessionId: sessionRecord.id,
          status: { in: ["PRESENT", "LATE"] },
        },
        select: {
          studentId: true,
          status: true,
          studentProfile: {
            select: {
              id: true,
              name: true,
              photo: true,
              studentId: true,
              program: true,
              section: true,
            },
          },
        },
      });
      let eligible = eligibleCandidates(attendance);
      if (!eligible.length) {
        return res.status(409).json({ message: "No Present or Late students are eligible for recitation." });
      }
      if (excludeStudentId) {
        eligible = eligible.filter(({ studentId }) => studentId !== excludeStudentId);
        if (!eligible.length) {
          return res.status(409).json({ message: "No other eligible student is available to skip to." });
        }
      }

      if (mode === "WEIGHTED") {
        const priorCalls = await prisma.recitationLog.groupBy({
          by: ["studentId"],
          where: {
            studentId: { in: eligible.map(({ studentId }) => studentId) },
            session: { is: { classId: sessionRecord.classId } },
          },
          _count: { _all: true },
        });
        const callsByStudent = new Map(
          priorCalls.map(({ studentId, _count }) => [studentId, _count._all]),
        );
        for (const candidate of eligible) {
          candidate.priorCalls = callsByStudent.get(candidate.studentId) || 0;
        }
      }

      const selected = selectRecitationCandidate(eligible, mode);
      const log = await prisma.recitationLog.create({
        data: {
          sessionId: sessionRecord.id,
          studentId: selected.studentId,
          method: mode,
        },
        include: {
          studentProfile: {
            select: {
              id: true,
              name: true,
              photo: true,
              studentId: true,
              program: true,
              section: true,
            },
          },
        },
      });
      return res.json({ recitation: log });
    } catch (error) {
      console.error("Recitation shuffle failed:", error);
      return res.status(500).json({ message: "Unable to select a student for recitation." });
    }
  },
);

app.patch(
  "/api/recitation-logs/:id",
  requireAuth,
  requireRole("FACULTY"),
  async (req, res) => {
    const score = req.body?.score;
    if (!Object.prototype.hasOwnProperty.call(req.body || {}, "score")) {
      return res.status(400).json({ message: "A score from 0 to 5, or null, is required." });
    }
    if (score !== null && (!Number.isInteger(score) || score < 0 || score > 5)) {
      return res.status(400).json({ message: "Score must be a whole number from 0 to 5, or null." });
    }

    try {
      const log = await prisma.recitationLog.findFirst({
        where: {
          id: req.params.id,
          session: { is: { class: { is: { facultyId: req.session.userId } } } },
        },
        select: { id: true },
      });
      if (!log) {
        return res.status(404).json({ message: "Recitation record not found." });
      }
      const updatedLog = await prisma.recitationLog.update({
        where: { id: log.id },
        data: { score },
        include: {
          studentProfile: {
            select: {
              id: true,
              name: true,
              photo: true,
              studentId: true,
              program: true,
              section: true,
            },
          },
        },
      });
      return res.json({ recitation: updatedLog });
    } catch (error) {
      console.error("Recitation score update failed:", error);
      return res.status(500).json({ message: "Unable to update the recitation score." });
    }
  },
);

app.get(
  "/api/student/classes",
  requireAuth,
  requireRole("STUDENT"),
  async (req, res) => {
    try {
      const profile = await prisma.studentProfile.findUnique({
        where: { userId: req.session.userId },
        include: {
          enrollments: {
            include: {
              class: {
                include: { faculty: { select: { name: true } } },
              },
            },
            orderBy: { joinedAt: "desc" },
          },
        },
      });
      if (!profile) {
        return res.status(409).json({ message: "Create your student profile before joining a class." });
      }
      const enrolledClasses = profile.enrollments.map((item) => ({
        ...item.class,
        enrollmentStatus: item.status,
        joinedAt: item.joinedAt,
      }));
      const summaries = await Promise.all(
        enrolledClasses.map(async (classItem) => {
          const [attendance, recitations, activities, quizzes] = await Promise.all([
            prisma.attendanceRecord.findMany({
              where: {
                studentId: profile.id,
                session: { is: { classId: classItem.id } },
              },
              select: { status: true },
            }),
            prisma.recitationLog.findMany({
              where: {
                studentId: profile.id,
                session: { is: { classId: classItem.id } },
              },
              select: { score: true },
            }),
            prisma.activityScore.findMany({
              where: {
                studentId: profile.id,
                activity: { is: { classId: classItem.id } },
              },
              select: { score: true, activity: { select: { maxScore: true } } },
            }),
            prisma.quizScore.findMany({
              where: {
                studentId: profile.id,
                session: { is: { classId: classItem.id } },
              },
              select: { score: true, session: { select: { totalItems: true } } },
            }),
          ]);
          return {
            ...classItem,
            recordSummary: summarizeStudentClass({
              attendance,
              recitations,
              activities: activities.map((item) => ({ score: item.score, maxScore: item.activity.maxScore })),
              quizzes: quizzes.map((item) => ({ score: item.score, totalItems: item.session.totalItems })),
            }),
          };
        }),
      );
      return res.json({ classes: summaries });
    } catch (error) {
      console.error("Student classes lookup failed:", error);
      return res.status(500).json({ message: "Unable to load your classes." });
    }
  },
);

app.get(
  "/api/student/classes/:classId/records",
  requireAuth,
  requireRole("STUDENT"),
  async (req, res) => {
    try {
      const profile = await prisma.studentProfile.findUnique({
        where: { userId: req.session.userId },
        select: { id: true, name: true, studentId: true, email: true, photo: true, program: true, section: true },
      });
      if (!profile) {
        return res.status(409).json({ message: "Create your student profile before joining a class." });
      }

      const classRecord = await prisma.class.findFirst({
        where: {
          id: req.params.classId,
          enrollments: {
            some: {
              studentProfileId: profile.id,
              status: { in: ["APPROVED", "PENDING"] },
            },
          },
        },
        include: { faculty: { select: { name: true } } },
      });
      if (!classRecord) {
        return res.status(404).json({ message: "Class not found." });
      }

      const [attendance, recitations, activities, quizzes] = await Promise.all([
        prisma.attendanceRecord.findMany({
          where: {
            studentId: profile.id,
            session: { is: { classId: classRecord.id } },
          },
          select: {
            id: true,
            status: true,
            markedAt: true,
            session: { select: { id: true, date: true } },
          },
          orderBy: { markedAt: "desc" },
        }),
        prisma.recitationLog.findMany({
          where: {
            studentId: profile.id,
            session: { is: { classId: classRecord.id } },
          },
          select: {
            id: true,
            method: true,
            calledAt: true,
            score: true,
            session: { select: { id: true, date: true } },
          },
          orderBy: { calledAt: "desc" },
        }),
        prisma.activityScore.findMany({
          where: {
            studentId: profile.id,
            activity: { is: { classId: classRecord.id } },
          },
          select: {
            id: true,
            score: true,
            isAbsent: true,
            createdAt: true,
            activity: { select: { id: true, title: true, maxScore: true } },
            session: { select: { id: true, date: true } },
          },
          orderBy: { updatedAt: "desc" },
        }),
        prisma.quizScore.findMany({
          where: {
            studentId: profile.id,
            session: { is: { classId: classRecord.id } },
          },
          select: {
            id: true,
            score: true,
            isAbsent: true,
            createdAt: true,
            session: { select: { id: true, date: true, title: true, totalItems: true } },
          },
          orderBy: { updatedAt: "desc" },
        }),
      ]);

      return res.json({
        student: profile,
        class: {
          ...classRecord,
          recordSummary: summarizeStudentClass({
            attendance,
            recitations,
            activities: activities.map((item) => ({ score: item.score, maxScore: item.activity.maxScore })),
            quizzes: quizzes.map((item) => ({ score: item.score, totalItems: item.session.totalItems })),
          }),
        },
        attendance,
        recitations,
        activities,
        quizzes,
      });
    } catch (error) {
      console.error("Student class records lookup failed:", error);
      return res.status(500).json({ message: "Unable to load this class record." });
    }
  },
);

app.get(
  "/api/classes/:id/export/excel",
  requireAuth,
  requireRole("FACULTY"),
  async (req, res) => {
    try {
      const classRecord = await prisma.class.findFirst({
        where: { id: req.params.id, facultyId: req.session.userId },
        include: {
          faculty: { select: { name: true } },
          enrollments: {
            include: {
              studentProfile: {
                select: {
                  name: true,
                  studentId: true,
                  email: true,
                  program: true,
                  section: true,
                },
              },
            },
            orderBy: { joinedAt: "asc" },
          },
          sessions: {
            include: {
              attendance: {
                include: {
                  studentProfile: {
                    select: { name: true, studentId: true },
                  },
                },
                orderBy: { markedAt: "asc" },
              },
              recitations: {
                include: {
                  studentProfile: {
                    select: { name: true, studentId: true },
                  },
                },
                orderBy: { calledAt: "asc" },
              },
            },
            orderBy: { date: "asc" },
          },
          activities: {
            include: {
              session: { select: { date: true } },
              scores: {
                include: {
                  studentProfile: {
                    select: { name: true, studentId: true },
                  },
                },
                orderBy: { updatedAt: "asc" },
              },
            },
            orderBy: { createdAt: "asc" },
          },
          projects: {
            include: {
              scores: {
                include: {
                  studentProfile: {
                    select: { name: true, studentId: true },
                  },
                },
                orderBy: { updatedAt: "asc" },
              },
            },
            orderBy: { createdAt: "asc" },
          },
          quizSessions: {
            include: {
              scores: {
                include: {
                  studentProfile: {
                    select: { name: true, studentId: true },
                  },
                },
                orderBy: { updatedAt: "asc" },
              },
            },
            orderBy: { date: "asc" },
          },
        },
      });

      if (!classRecord) {
        return res.status(404).json({ message: "Class not found." });
      }

      const workbookBuffer = buildExcelWorkbook(classRecord, req.query.types);
      const dateStr = new Date().toISOString().slice(0, 10);
      const safeCode = (classRecord.classCode || "").replace(/[^\w.-]+/g, "_").replace(/^_+|_+$/g, "") || "class";
      const safeSection = (classRecord.sectionName || "").replace(/[^\w.-]+/g, "_").replace(/^_+|_+$/g, "") || "section";
      const xlsxFilename = `${safeCode}_${safeSection}_${dateStr}.xlsx`;
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="${xlsxFilename}"`);
      return res.send(workbookBuffer);
    } catch (error) {
      console.error("Excel export failed:", error);
      return res.status(500).json({ message: "Unable to export this class as Excel." });
    }
  },
);

app.get(
  "/api/classes/:id/export/csv",
  requireAuth,
  requireRole("FACULTY"),
  async (req, res) => {
    try {
      const classRecord = await prisma.class.findFirst({
        where: { id: req.params.id, facultyId: req.session.userId },
        include: {
          faculty: { select: { name: true } },
          enrollments: {
            include: {
              studentProfile: {
                select: {
                  name: true,
                  studentId: true,
                  email: true,
                  program: true,
                  section: true,
                },
              },
            },
            orderBy: { joinedAt: "asc" },
          },
          sessions: {
            include: {
              attendance: {
                include: {
                  studentProfile: {
                    select: { name: true, studentId: true },
                  },
                },
                orderBy: { markedAt: "asc" },
              },
              recitations: {
                include: {
                  studentProfile: {
                    select: { name: true, studentId: true },
                  },
                },
                orderBy: { calledAt: "asc" },
              },
            },
            orderBy: { date: "asc" },
          },
          activities: {
            include: {
              session: { select: { date: true } },
              scores: {
                include: {
                  studentProfile: {
                    select: { name: true, studentId: true },
                  },
                },
                orderBy: { updatedAt: "asc" },
              },
            },
            orderBy: { createdAt: "asc" },
          },
          projects: {
            include: {
              scores: {
                include: {
                  studentProfile: {
                    select: { name: true, studentId: true },
                  },
                },
                orderBy: { updatedAt: "asc" },
              },
            },
            orderBy: { createdAt: "asc" },
          },
          quizSessions: {
            include: {
              scores: {
                include: {
                  studentProfile: {
                    select: { name: true, studentId: true },
                  },
                },
                orderBy: { updatedAt: "asc" },
              },
            },
            orderBy: { date: "asc" },
          },
        },
      });

      if (!classRecord) {
        return res.status(404).json({ message: "Class not found." });
      }

      const csv = buildCsvExport(classRecord, req.query.types);
      const dateStr = new Date().toISOString().slice(0, 10);
      const safeCode = (classRecord.classCode || "").replace(/[^\w.-]+/g, "_").replace(/^_+|_+$/g, "") || "class";
      const safeSection = (classRecord.sectionName || "").replace(/[^\w.-]+/g, "_").replace(/^_+|_+$/g, "") || "section";
      const csvFilename = `${safeCode}_${safeSection}_${dateStr}.csv`;
      const bom = Buffer.from("\uFEFF", "utf8");
      const csvBuffer = Buffer.concat([bom, Buffer.from(csv, "utf8")]);
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${csvFilename}"`);
      return res.send(csvBuffer);
    } catch (error) {
      console.error("CSV export failed:", error);
      return res.status(500).json({ message: "Unable to export this class as CSV." });
    }
  },
);

app.post(
  "/api/classes/join",
  requireAuth,
  requireRole("STUDENT"),
  async (req, res) => {
    if (!(await requireRecaptcha(req, res))) {
      return;
    }
    const classCode = normalizeClassCode(req.body?.classCode);
    if (!classCode) {
      return res.status(400).json({ message: "Enter a class code or open an invite link." });
    }

    try {
      const [profile, classRecord] = await Promise.all([
        prisma.studentProfile.findUnique({
          where: { userId: req.session.userId },
        }),
        prisma.class.findUnique({
          where: { classCode },
          include: { faculty: { select: { name: true, email: true } } },
        }),
      ]);
      if (!classRecord) {
        return res.status(404).json({ message: "No class matches that invite code." });
      }
      if (!profile) {
        return res.status(409).json({
          message: "Create your student profile before joining a class.",
        });
      }

      const existingEnrollment = await prisma.classEnrollment.findUnique({
        where: {
          studentProfileId_classId: {
            studentProfileId: profile.id,
            classId: classRecord.id,
          },
        },
      });
      if (existingEnrollment) {
        if (existingEnrollment.status === "DECLINED") {
          const resubmitted = await prisma.classEnrollment.update({ where: { id: existingEnrollment.id }, data: { status: "PENDING", joinedAt: new Date() }, include: { class: true } });
          return res.status(201).json({ enrollment: resubmitted, status: "PENDING", message: "Your request was resubmitted for instructor approval." });
        }
        return res.status(409).json({ message: existingEnrollment.status === "PENDING" ? "Waiting for instructor approval." : "You have already joined this class.", enrollment: existingEnrollment, status: existingEnrollment.status });
      }

      const rosterMatch = await prisma.classRoster.findUnique({ where: { classId_studentId: { classId: classRecord.id, studentId: profile.studentId } } });

      const enrollment = await prisma.classEnrollment.create({
        data: {
          studentProfileId: profile.id,
          classId: classRecord.id,
          status: rosterMatch ? "APPROVED" : "PENDING",
        },
        include: { class: true },
      });
      queueEmail(
        buildJoinEmail({
          studentName: profile.name,
          studentEmail: profile.email,
          classSectionName: classRecord.sectionName,
          classCode: classRecord.classCode,
          status: enrollment.status,
          facultyName: classRecord.faculty?.name,
        }),
        "join confirmation",
      );
      if (classRecord.faculty?.email) {
        queueEmail(
          buildFacultyJoinEmail({
            facultyEmail: classRecord.faculty.email,
            facultyName: classRecord.faculty.name,
            studentName: profile.name,
            classSectionName: classRecord.sectionName,
            classCode: classRecord.classCode,
            status: enrollment.status,
          }),
          "faculty join notice",
        );
      }
      return res.status(201).json({ enrollment, status: enrollment.status, message: rosterMatch ? "You joined the class." : "Waiting for instructor approval." });
    } catch (error) {
      if (error.code === "P2002") {
        return res.status(409).json({ message: "You have already joined this class." });
      }
      console.error("Class join failed:", error);
      return res.status(500).json({ message: "Unable to join that class." });
    }
  },
);

app.listen(PORT, () => {
  console.log(`ClassDex API running on http://localhost:${PORT}`);
});
