require("dotenv").config();
const express = require("express");
const cors = require("cors");
const session = require("express-session");
const { rateLimit, MemoryStore } = require("express-rate-limit");
const bcrypt = require("bcryptjs");
const { randomBytes } = require("node:crypto");
const { prisma } = require("./db");
const { applyGracePeriod } = require("./attendance");
const { eligibleCandidates, selectRecitationCandidate } = require("./recitation");
const { verifyRecaptchaToken } = require("./recaptcha");
const { buildExcelWorkbook, buildCsvExport, sanitizeExportValue, buildStudentListRows, buildAttendanceRows, buildRecitationRows, buildActivityRows, buildProjectRows, buildQuizRows } = require("./export");
const {
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
const {
  validatePassword,
  validatePasswordWithConfirm,
} = require("./src/utils/passwordValidator");
const {
  generateToken,
  hashToken,
  getResetTokenExpiry,
  getResetTokenTtlMinutes,
  getVerifyTokenExpiry,
  getVerifyTokenTtlHours,
  normalizeEmail,
} = require("./src/utils/tokens");
const {
  getClientUrl,
  sendMail,
} = require("./src/services/mailer");
const {
  buildResetPasswordEmail,
  buildPasswordChangedEmail,
  buildVerifyEmail,
} = require("./src/services/emailTemplates");

const FORGOT_PASSWORD_GENERIC_MESSAGE =
  "If an account exists for that email, we've sent a reset link.";

const { studentPhotoUrl } = require("./src/utils/studentPhotoUrl");
const { manilaDate } = require("./src/utils/dates");
const path = require("node:path");
const { parseFullName, compareStudents } = require(path.resolve(__dirname, "../shared/nameParser"));

const SCORE_STUDENT_SELECT = {
  id: true,
  name: true,
  studentId: true,
  program: true,
  section: true,
  updatedAt: true,
  firstName: true,
  middleName: true,
  lastName: true,
  suffix: true,
  sortKey: true,
};

function attachPhotoUrl(item) {
  if (!item) return item;
  if (item.studentProfile) {
    const photoUrl = studentPhotoUrl(item.studentProfile);
    item.studentProfile = {
      ...item.studentProfile,
      photo: photoUrl,
      photoUrl,
    };
  }
  return item;
}

const app = express();
const trustProxyHops =
  process.env.TRUST_PROXY !== undefined && process.env.TRUST_PROXY !== ""
    ? Number(process.env.TRUST_PROXY)
    : 1;
app.set("trust proxy", Number.isNaN(trustProxyHops) ? process.env.TRUST_PROXY : trustProxyHops);

const PORT = process.env.PORT || 5000;
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || "http://localhost:5173";
const ROLES = new Set(["FACULTY", "STUDENT"]);
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const RATE_LIMIT_MESSAGE = "Too many requests. Please try again later.";
const FORGOT_CAPTCHA_ERROR_MESSAGE = "We couldn't verify you're human. Please try again.";

const forgotPasswordIpStore = new MemoryStore();
const forgotPasswordEmailStore = new MemoryStore();
const changePasswordWrongCurrentStore = new MemoryStore();
const verifyResendCooldownByUser = new Map();

function getVerifyResendCooldownSeconds() {
  const parsed = Number(process.env.VERIFY_RESEND_COOLDOWN_SECONDS);
  if (Number.isFinite(parsed) && parsed > 0) {
    return Math.round(parsed);
  }
  return 60;
}

const forgotPasswordIpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  store: forgotPasswordIpStore,
  handler: (_req, res) => res.status(429).json({ message: RATE_LIMIT_MESSAGE }),
});

const forgotPasswordEmailLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  store: forgotPasswordEmailStore,
  skip: (req) => !normalizeEmail(req.body?.email),
  keyGenerator: (req) => `forgot-email:${normalizeEmail(req.body?.email)}`,
  handler: (_req, res) => res.status(429).json({ message: RATE_LIMIT_MESSAGE }),
});

const changePasswordWrongCurrentLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  store: changePasswordWrongCurrentStore,
  keyGenerator: (req) => `change-pw-user:${req.session?.userId || "anonymous"}`,
  skipSuccessfulRequests: true,
  requestWasSuccessful: (_req, res) => !res.locals.wrongCurrentPassword,
  handler: (_req, res) =>
    res.status(429).json({
      message: "Too many incorrect password attempts. Please try again in 15 minutes.",
    }),
});

function resetRateLimitersForTests() {
  forgotPasswordIpStore.resetAll();
  forgotPasswordEmailStore.resetAll();
  changePasswordWrongCurrentStore.resetAll();
  verifyResendCooldownByUser.clear();
}

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

function isFacultyProfileComplete(profile, user) {
  if (!profile) return false;
  const name = String(profile.name || user?.name || "").trim();
  const department = String(profile.department || "").trim();
  return Boolean(name && department);
}

function publicUser(user) {
  const photo = user.facultyProfile?.photo || user.studentProfile?.photo || user.photo || null;
  const profileCompleted =
    user.role === "FACULTY"
      ? isFacultyProfileComplete(user.facultyProfile, user)
      : user.role === "STUDENT"
        ? Boolean(user.studentProfile?.studentId && user.studentProfile?.name && photo)
        : true;
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    emailVerified: Boolean(user.emailVerified),
    photo,
    profileCompleted,
    createdAt: user.createdAt,
  };
}

async function requireAuth(req, res, next) {
  if (!req.session?.userId) {
    return res.status(401).json({ message: "Please log in to continue." });
  }
  try {
    const authUser = await prisma.user.findUnique({
      where: { id: req.session.userId },
      select: { id: true, role: true, passwordChangedAt: true },
    });
    if (!authUser) {
      req.session.destroy(() => {});
      res.clearCookie("classdex.sid");
      return res.status(401).json({ message: "Session expired. Please log in again." });
    }
    if (authUser.passwordChangedAt) {
      const issuedAt = Number(req.session.issuedAt || 0);
      if (!issuedAt || issuedAt <= authUser.passwordChangedAt.getTime()) {
        req.session.destroy(() => {});
        res.clearCookie("classdex.sid");
        return res.status(401).json({ message: "Your password was changed. Please log in again." });
      }
    }
    req.session.role = authUser.role;
    return next();
  } catch (error) {
    console.error("Session verification failed:", error);
    return res.status(500).json({ message: "Unable to verify session." });
  }
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
  if (!verified.success) {
    res.status(400).json({ message: verified.message });
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

async function autoApproveRosterMatches(classId) {
  const roster = await prisma.classRoster.findMany({
    where: { classId },
    select: { studentId: true },
  });
  const rosterStudentIds = [...new Set(roster.map((entry) => String(entry.studentId || "").trim()).filter(Boolean))];
  if (!rosterStudentIds.length) return 0;

  const [classRecord, pending] = await Promise.all([
    prisma.class.findUnique({
      where: { id: classId },
      select: { sectionName: true, faculty: { select: { name: true } } },
    }),
    prisma.classEnrollment.findMany({
      where: {
        classId,
        status: "PENDING",
        studentProfile: { is: { studentId: { in: rosterStudentIds } } },
      },
      select: {
        id: true,
        studentProfile: { select: { name: true, email: true } },
      },
    }),
  ]);
  if (!classRecord || !pending.length) return 0;

  const autoApprovedAt = new Date();
  const results = await prisma.$transaction(pending.map((enrollment) =>
    prisma.classEnrollment.updateMany({
      where: { id: enrollment.id, classId, status: "PENDING" },
      data: {
        status: "APPROVED",
        autoApprovedAt,
        autoApprovalReadAt: null,
        warningReadAbsenceCount: 0,
      },
    }),
  ));
  let approvedCount = 0;
  results.forEach((result, index) => {
    if (!result.count) return;
    approvedCount += 1;
    const student = pending[index].studentProfile;
    if (student.email) {
      queueEmail(buildDecisionEmail({
        studentName: student.name,
        studentEmail: student.email,
        classSectionName: classRecord.sectionName,
        decision: "APPROVED",
        facultyName: classRecord.faculty?.name,
      }), "automatic join approval");
    }
  });
  return approvedCount;
}

// manilaDate imported from ./src/utils/dates

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
    const email = normalizeEmail(req.body?.email);
    const password = String(req.body?.password || "");
    const confirmPassword = String(req.body?.confirmPassword || "");
    const role = String(req.body?.role || "").toUpperCase();

    if (!name) {
      return res.status(400).json({ message: "Full name is required." });
    }
    if (!EMAIL_PATTERN.test(email)) {
      return res.status(400).json({ message: "Enter a valid email address." });
    }
    const passwordCheck = validatePasswordWithConfirm(password, confirmPassword);
    if (!passwordCheck.valid) {
      return res.status(400).json({ message: passwordCheck.message });
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
    req.session.issuedAt = Date.now();
    try {
      await createAndSendVerificationEmail(user);
    } catch (verifyError) {
      console.error("Registration verification email setup failed:", verifyError);
    }
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
    const email = normalizeEmail(req.body?.email);
    const password = String(req.body?.password || "");

    if (!EMAIL_PATTERN.test(email) || !password) {
      clearTimeout(timeout);
      return res
        .status(400)
        .json({ message: "Email and password are required." });
    }

    const user = await prisma.user.findUnique({
      where: { email },
      include: {
        facultyProfile: { select: { photo: true, name: true, department: true, email: true } },
        studentProfile: { select: { photo: true, name: true, studentId: true } },
      },
    });
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
    req.session.issuedAt = Math.max(Date.now(), (user.passwordChangedAt?.getTime() ?? 0) + 1);
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

app.post(
  "/api/auth/forgot-password",
  forgotPasswordIpLimiter,
  forgotPasswordEmailLimiter,
  async (req, res) => {
    try {
      const captchaResult = await verifyRecaptchaToken(req.body?.recaptchaToken, req.ip);
      if (!captchaResult.success) {
        return res.status(400).json({ message: FORGOT_CAPTCHA_ERROR_MESSAGE });
      }

      const email = normalizeEmail(req.body?.email);
      if (!EMAIL_PATTERN.test(email)) {
        return res.status(400).json({ message: "Enter a valid email address." });
      }

      const user = await prisma.user.findUnique({
        where: { email },
        select: { id: true, name: true, email: true },
      });

      if (user) {
        const now = new Date();
        const { raw, hash } = generateToken();
        const expiresAt = getResetTokenExpiry(now);
        const ttlMinutes = getResetTokenTtlMinutes();

        await prisma.$transaction([
          prisma.passwordResetToken.updateMany({
            where: { userId: user.id, usedAt: null },
            data: { usedAt: now },
          }),
          prisma.passwordResetToken.create({
            data: {
              userId: user.id,
              tokenHash: hash,
              expiresAt,
            },
          }),
        ]);

        const resetUrl = `${getClientUrl()}/reset-password?token=${encodeURIComponent(raw)}`;
        void sendMail(
          buildResetPasswordEmail({
            to: user.email,
            name: user.name,
            resetUrl,
            ttlMinutes,
          }),
        );
      }

      return res.status(200).json({ message: FORGOT_PASSWORD_GENERIC_MESSAGE });
    } catch (error) {
      console.error("Forgot password request failed:", error);
      return res.status(500).json({ message: "Unable to process password reset request." });
    }
  },
);

const RESET_TOKEN_REASON_MESSAGES = {
  expired: "This password reset link has expired. Please request a new one.",
  used: "This password reset link has already been used. Please request a new one.",
  invalid: "This password reset link is invalid. Please request a new one.",
};

async function inspectResetToken(rawToken, now = new Date()) {
  const cleaned = String(rawToken || "").trim();
  if (!cleaned) {
    return { valid: false, reason: "invalid" };
  }
  const tokenHash = hashToken(cleaned);
  const record = await prisma.passwordResetToken.findUnique({
    where: { tokenHash },
  });
  if (!record) {
    return { valid: false, reason: "invalid" };
  }
  if (record.usedAt !== null) {
    return { valid: false, reason: "used", record };
  }
  if (record.expiresAt.getTime() <= now.getTime()) {
    return { valid: false, reason: "expired", record };
  }
  return { valid: true, record };
}

app.get("/api/auth/reset-password/validate", async (req, res) => {
  try {
    const check = await inspectResetToken(req.query?.token);
    if (!check.valid) {
      return res.json({ valid: false, reason: check.reason });
    }
    return res.json({ valid: true });
  } catch (error) {
    console.error("Reset token validation failed:", error);
    return res.status(500).json({ message: "Unable to validate reset link." });
  }
});

app.post("/api/auth/reset-password", async (req, res) => {
  try {
    const rawToken = String(req.body?.token || "").trim();
    const password = String(req.body?.password || "");
    const hasConfirm = req.body?.confirmPassword !== undefined;

    const initialCheck = await inspectResetToken(rawToken);
    if (!initialCheck.valid) {
      return res.status(400).json({
        valid: false,
        reason: initialCheck.reason,
        message: RESET_TOKEN_REASON_MESSAGES[initialCheck.reason],
      });
    }

    const passwordCheck = hasConfirm
      ? validatePasswordWithConfirm(password, req.body?.confirmPassword)
      : validatePassword(password);
    if (!passwordCheck.valid) {
      return res.status(400).json({ message: passwordCheck.message });
    }

    const hashedPassword = await bcrypt.hash(password, 12);
    const now = new Date();

    const txResult = await prisma.$transaction(async (tx) => {
      const claimed = await tx.passwordResetToken.updateMany({
        where: {
          id: initialCheck.record.id,
          usedAt: null,
          expiresAt: { gt: now },
        },
        data: { usedAt: now },
      });

      if (claimed.count === 0) {
        const latest = await tx.passwordResetToken.findUnique({
          where: { id: initialCheck.record.id },
        });
        const reason = !latest ? "invalid" : latest.usedAt ? "used" : "expired";
        return { ok: false, reason };
      }

      const currentUser = await tx.user.findUnique({
        where: { id: initialCheck.record.userId },
        select: { id: true, name: true, email: true, passwordChangedAt: true },
      });
      if (!currentUser) {
        return { ok: false, reason: "invalid" };
      }

      const changedAtMs = Math.max(
        now.getTime(),
        (currentUser.passwordChangedAt?.getTime() ?? 0) + 1,
      );
      const passwordChangedAt = new Date(changedAtMs);

      const updatedUser = await tx.user.update({
        where: { id: currentUser.id },
        data: {
          password: hashedPassword,
          passwordChangedAt,
        },
        select: { id: true, name: true, email: true },
      });

      await tx.passwordResetToken.updateMany({
        where: {
          userId: currentUser.id,
          usedAt: null,
        },
        data: { usedAt: now },
      });

      return { ok: true, user: updatedUser };
    });

    if (!txResult.ok) {
      return res.status(400).json({
        valid: false,
        reason: txResult.reason,
        message: RESET_TOKEN_REASON_MESSAGES[txResult.reason],
      });
    }

    if (req.session?.userId === txResult.user.id) {
      await new Promise((resolve) => req.session.destroy(() => resolve()));
      res.clearCookie("classdex.sid");
    }

    void sendMail(
      buildPasswordChangedEmail({
        to: txResult.user.email,
        name: txResult.user.name,
        loginUrl: `${getClientUrl()}/login`,
      }),
    );

    return res.json({
      message: "Your password has been reset. Sign in with your new password.",
    });
  } catch (error) {
    console.error("Reset password failed:", error);
    return res.status(500).json({ message: "Unable to reset password." });
  }
});

const VERIFY_TOKEN_REASON_MESSAGES = {
  expired: "This verification link has expired. Request a new verification email to continue.",
  used: "This verification link has already been used.",
  invalid: "This verification link is invalid or incomplete.",
};

async function createAndSendVerificationEmail(user) {
  const now = new Date();
  const { raw, hash } = generateToken();
  const expiresAt = getVerifyTokenExpiry(now);
  const ttlHours = getVerifyTokenTtlHours();

  await prisma.$transaction([
    prisma.emailVerificationToken.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: now },
    }),
    prisma.emailVerificationToken.create({
      data: {
        userId: user.id,
        tokenHash: hash,
        expiresAt,
      },
    }),
  ]);

  const verifyUrl = `${getClientUrl()}/verify-email?token=${encodeURIComponent(raw)}`;
  await sendMail(
    buildVerifyEmail({
      to: user.email,
      name: user.name,
      verifyUrl,
      ttlHours,
    }),
  );
  return { raw, expiresAt };
}

async function inspectVerifyToken(rawToken, now = new Date()) {
  const cleaned = String(rawToken || "").trim();
  if (!cleaned) {
    return { valid: false, reason: "invalid" };
  }
  const tokenHash = hashToken(cleaned);
  const record = await prisma.emailVerificationToken.findUnique({
    where: { tokenHash },
  });
  if (!record) {
    return { valid: false, reason: "invalid" };
  }
  if (record.usedAt !== null) {
    return { valid: false, reason: "used", record };
  }
  if (record.expiresAt.getTime() <= now.getTime()) {
    return { valid: false, reason: "expired", record };
  }
  return { valid: true, record };
}

app.post("/api/auth/verify-email", async (req, res) => {
  try {
    const rawToken = String(req.body?.token || "").trim();
    const initialCheck = await inspectVerifyToken(rawToken);
    if (!initialCheck.valid) {
      return res.status(400).json({
        valid: false,
        reason: initialCheck.reason,
        message: VERIFY_TOKEN_REASON_MESSAGES[initialCheck.reason],
      });
    }

    const now = new Date();
    const txResult = await prisma.$transaction(async (tx) => {
      const claimed = await tx.emailVerificationToken.updateMany({
        where: {
          id: initialCheck.record.id,
          usedAt: null,
          expiresAt: { gt: now },
        },
        data: { usedAt: now },
      });

      if (claimed.count === 0) {
        const latest = await tx.emailVerificationToken.findUnique({
          where: { id: initialCheck.record.id },
        });
        const reason = !latest ? "invalid" : latest.usedAt ? "used" : "expired";
        return { ok: false, reason };
      }

      const existingUser = await tx.user.findUnique({
        where: { id: initialCheck.record.userId },
        select: { id: true, emailVerifiedAt: true },
      });
      if (!existingUser) {
        return { ok: false, reason: "invalid" };
      }

      await tx.user.update({
        where: { id: existingUser.id },
        data: {
          emailVerified: true,
          emailVerifiedAt: existingUser.emailVerifiedAt || now,
        },
      });

      await tx.emailVerificationToken.updateMany({
        where: {
          userId: existingUser.id,
          usedAt: null,
        },
        data: { usedAt: now },
      });

      return { ok: true };
    });

    if (!txResult.ok) {
      return res.status(400).json({
        valid: false,
        reason: txResult.reason,
        message: VERIFY_TOKEN_REASON_MESSAGES[txResult.reason],
      });
    }

    return res.json({
      verified: true,
      message: "Your email address has been verified.",
    });
  } catch (error) {
    console.error("Email verification failed:", error);
    return res.status(500).json({ message: "Unable to verify email address." });
  }
});

app.post("/api/auth/resend-verification", requireAuth, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.session.userId },
      select: { id: true, name: true, email: true, emailVerified: true },
    });

    if (!user) {
      return res.status(401).json({ message: "Session expired. Please log in again." });
    }

    if (user.emailVerified) {
      return res.json({
        alreadyVerified: true,
        message: "Your email address is already verified.",
      });
    }

    const cooldownSeconds = getVerifyResendCooldownSeconds();
    const cooldownMs = cooldownSeconds * 1000;
    const nowMs = Date.now();
    const lastSentMs = verifyResendCooldownByUser.get(user.id) || 0;
    const elapsedMs = nowMs - lastSentMs;

    if (lastSentMs > 0 && elapsedMs < cooldownMs) {
      const retryAfter = Math.max(1, Math.ceil((cooldownMs - elapsedMs) / 1000));
      res.setHeader("Retry-After", String(retryAfter));
      return res.status(429).json({
        message: `Please wait ${retryAfter}s before requesting another verification email.`,
        retryAfter,
      });
    }

    verifyResendCooldownByUser.set(user.id, nowMs);
    await createAndSendVerificationEmail(user);

    return res.json({
      message: "Verification email sent. Check your inbox.",
      retryAfter: cooldownSeconds,
    });
  } catch (error) {
    console.error("Resend verification email failed:", error);
    return res.status(500).json({ message: "Unable to resend verification email." });
  }
});

app.post(
  "/api/auth/change-password",
  requireAuth,
  changePasswordWrongCurrentLimiter,
  async (req, res) => {
    try {
      const currentPassword = String(req.body?.currentPassword || "");
      const newPassword = String(req.body?.newPassword || "");
      const hasConfirm = req.body?.confirmPassword !== undefined;

      if (!currentPassword) {
        return res.status(400).json({
          field: "currentPassword",
          message: "Enter your current password.",
        });
      }

      const user = await prisma.user.findUnique({
        where: { id: req.session.userId },
        include: {
          facultyProfile: { select: { photo: true, name: true, department: true, email: true } },
          studentProfile: { select: { photo: true, name: true, studentId: true } },
        },
      });

      if (!user) {
        return res.status(401).json({ message: "Session expired. Please log in again." });
      }

      const matchesCurrent = await bcrypt.compare(currentPassword, user.password);
      if (!matchesCurrent) {
        res.locals.wrongCurrentPassword = true;
        return res.status(400).json({
          field: "currentPassword",
          message: "Current password is incorrect.",
        });
      }

      const passwordCheck = hasConfirm
        ? validatePasswordWithConfirm(newPassword, req.body?.confirmPassword)
        : validatePassword(newPassword);
      if (!passwordCheck.valid) {
        const field =
          passwordCheck.message === "Passwords do not match."
            ? "confirmPassword"
            : "newPassword";
        return res.status(400).json({
          field,
          message: passwordCheck.message,
        });
      }

      const sameAsCurrent = await bcrypt.compare(newPassword, user.password);
      if (sameAsCurrent) {
        return res.status(400).json({
          field: "newPassword",
          message: "New password must be different from your current password.",
        });
      }

      const hashedPassword = await bcrypt.hash(newPassword, 12);
      const now = new Date();
      const changedAtMs = Math.max(
        now.getTime(),
        (user.passwordChangedAt?.getTime() ?? 0) + 1,
      );
      const passwordChangedAt = new Date(changedAtMs);

      const updatedUser = await prisma.$transaction(async (tx) => {
        const saved = await tx.user.update({
          where: { id: user.id },
          data: {
            password: hashedPassword,
            passwordChangedAt,
          },
          include: {
            facultyProfile: { select: { photo: true, name: true, department: true, email: true } },
            studentProfile: { select: { photo: true, name: true, studentId: true } },
          },
        });

        await tx.passwordResetToken.updateMany({
          where: { userId: user.id, usedAt: null },
          data: { usedAt: now },
        });

        return saved;
      });

      await changePasswordWrongCurrentStore.resetKey(`change-pw-user:${user.id}`);

      await new Promise((resolve, reject) => {
        req.session.regenerate((regenError) => {
          if (regenError) return reject(regenError);
          req.session.userId = updatedUser.id;
          req.session.role = updatedUser.role;
          req.session.issuedAt = Math.max(Date.now(), passwordChangedAt.getTime() + 1);
          req.session.save((saveError) => {
            if (saveError) return reject(saveError);
            resolve();
          });
        });
      });

      void sendMail(
        buildPasswordChangedEmail({
          to: updatedUser.email,
          name: updatedUser.name,
          loginUrl: `${getClientUrl()}/login`,
        }),
      );

      return res.json({
        message: "Your password has been updated.",
        user: publicUser(updatedUser),
      });
    } catch (error) {
      console.error("Change password failed:", error);
      return res.status(500).json({ message: "Unable to change password." });
    }
  },
);

app.get("/api/auth/me", requireAuth, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.session.userId },
      include: {
        facultyProfile: { select: { photo: true, name: true, department: true, email: true } },
        studentProfile: { select: { photo: true, name: true, studentId: true } },
      },
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
      const isSummary = String(req.query.summary || "") === "1";
      const profile = await prisma.facultyProfile.findUnique({
        where: { userId: req.session.userId },
        ...(isSummary
          ? {
              select: {
                id: true,
                userId: true,
                name: true,
                department: true,
                email: true,
                contact: true,
                updatedAt: true,
              },
            }
          : {}),
      });
      return res.json({
        profile: profile
          ? { ...profile, profileCompleted: isFacultyProfileComplete(profile) }
          : null,
      });
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
      const parsedName = parseFullName(name);
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
          firstName: parsedName.firstName,
          middleName: parsedName.middleName,
          lastName: parsedName.lastName,
          suffix: parsedName.suffix,
          // sortKey is a derived, denormalized column kept only for ordering/indexing
          sortKey: parsedName.sortKey,
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
          firstName: parsedName.firstName,
          middleName: parsedName.middleName,
          lastName: parsedName.lastName,
          suffix: parsedName.suffix,
          sortKey: parsedName.sortKey,
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
        select: {
          id: true,
          sectionName: true,
          classCode: true,
          description: true,
          schedule: true,
          scheduleDays: true,
          scheduleStartTime: true,
          scheduleEndTime: true,
          gracePeriodMinutes: true,
          facultyId: true,
          createdAt: true,
          _count: { select: { enrollments: true } },
        },
        orderBy: { createdAt: "desc" },
      });
      return res.json({ classes });
    } catch (error) {
      console.error("Faculty classes lookup failed:", error);
      return res.status(500).json({ message: "Unable to load your classes." });
    }
  },
);

const ABSENCE_WARNING_THRESHOLD = 7;

async function getActiveAbsenceWarningsForClass(classId, sectionName = "") {
  const [enrollments, absentCounts] = await Promise.all([
    prisma.classEnrollment.findMany({
      where: { classId, status: "APPROVED" },
      include: {
        studentProfile: {
          select: {
            id: true,
            name: true,
            studentId: true,
            program: true,
            section: true,
            updatedAt: true,
          },
        },
      },
      orderBy: { joinedAt: "asc" },
    }),
    prisma.attendanceRecord.groupBy({
      by: ["studentId"],
      where: {
        status: "ABSENT",
        session: { is: { classId } },
      },
      _count: { _all: true },
    }),
  ]);

  const countByStudent = new Map(
    absentCounts.map((row) => [row.studentId, row._count._all]),
  );
  const warnings = [];

  for (const enrollment of enrollments) {
    const student = enrollment.studentProfile;
    const absentCount = countByStudent.get(student.id) || 0;
    const dismissedCount = enrollment.dismissedAbsenceCount || 0;

    const readAbsenceCount = enrollment.warningReadAbsenceCount || 0;
    const enrollmentReadUpdates = {};
    if (absentCount < dismissedCount) {
      enrollmentReadUpdates.dismissedAbsenceCount = absentCount;
    }
    if (absentCount < readAbsenceCount) {
      enrollmentReadUpdates.warningReadAbsenceCount = absentCount;
    }
    if (Object.keys(enrollmentReadUpdates).length) {
      await prisma.classEnrollment.update({
        where: { id: enrollment.id },
        data: enrollmentReadUpdates,
      });
    }

    if (absentCount >= ABSENCE_WARNING_THRESHOLD && absentCount > dismissedCount) {
      warnings.push({
        id: `${classId}:${student.id}`,
        enrollmentId: enrollment.id,
        classId,
        className: sectionName,
        studentId: student.id,
        studentCode: student.studentId,
        studentName: student.name,
        program: student.program,
        section: student.section,
        photo: studentPhotoUrl(student),
        photoUrl: studentPhotoUrl(student),
        absentCount,
        isRead: absentCount <= readAbsenceCount,
        threshold: ABSENCE_WARNING_THRESHOLD,
        message: `${student.name} has ${absentCount} absences in ${sectionName || "this class"} and may be subject to dropping`,
      });
    }
  }

  return warnings;
}

app.get("/api/faculty/classes/pending-counts", requireAuth, requireRole("FACULTY"), async (req, res) => {
  try {
    const classes = await prisma.class.findMany({
      where: { facultyId: req.session.userId },
      select: {
        id: true,
        _count: { select: { enrollments: { where: { status: "PENDING" } } } },
      },
    });
    const counts = {};
    const pendingCounts = {};
    const warningCounts = {};
    const autoApprovedCounts = {};

    if (classes.length > 0) {
      const [warningRows, autoApprovedRows] = await Promise.all([
        prisma.$queryRaw`
        SELECT warning."classId", COUNT(*)::int AS "warningCount"
        FROM (
          SELECT session."classId", attendance."studentId"
          FROM "AttendanceRecord" AS attendance
          JOIN "ClassSession" AS session ON session."id" = attendance."sessionId"
          JOIN "Class" AS class_record ON class_record."id" = session."classId"
          JOIN "ClassEnrollment" AS enrollment
            ON enrollment."classId" = session."classId"
            AND enrollment."studentProfileId" = attendance."studentId"
          WHERE class_record."facultyId" = ${req.session.userId}
            AND attendance."status" = 'ABSENT'::"AttendanceStatus"
            AND enrollment."status" = 'APPROVED'::"EnrollmentStatus"
          GROUP BY session."classId", attendance."studentId", enrollment."dismissedAbsenceCount", enrollment."warningReadAbsenceCount"
          HAVING COUNT(*) >= ${ABSENCE_WARNING_THRESHOLD}
            AND COUNT(*) > enrollment."dismissedAbsenceCount"
            AND COUNT(*) > enrollment."warningReadAbsenceCount"
        ) AS warning
        GROUP BY warning."classId"
        `,
        prisma.classEnrollment.groupBy({
          by: ["classId"],
          where: {
            classId: { in: classes.map((item) => item.id) },
            autoApprovedAt: { not: null },
            autoApprovalReadAt: null,
          },
          _count: { _all: true },
        }),
      ]);
      const warningsByClass = new Map(
        warningRows.map((row) => [row.classId, Number(row.warningCount)]),
      );
      const autoApprovedByClass = new Map(
        autoApprovedRows.map((row) => [row.classId, row._count._all]),
      );
      for (const item of classes) {
        const pending = item._count.enrollments;
        const warnings = warningsByClass.get(item.id) || 0;
        const autoApproved = autoApprovedByClass.get(item.id) || 0;
        pendingCounts[item.id] = pending;
        warningCounts[item.id] = warnings;
        autoApprovedCounts[item.id] = autoApproved;
        counts[item.id] = pending + warnings + autoApproved;
      }
    }

    return res.json({
      counts,
      pendingCounts,
      warningCounts,
      autoApprovedCounts,
      threshold: ABSENCE_WARNING_THRESHOLD,
    });
  } catch (error) {
    return res.status(500).json({ message: "Unable to load notification counts." });
  }
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

const SCHEDULE_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function parseScheduleTimeMinutes(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  const match24 = /^([01]?\d|2[0-3]):(00|30)$/.exec(text);
  if (match24) {
    return Number(match24[1]) * 60 + Number(match24[2]);
  }
  const match12 = /^(1[0-2]|0?[1-9]):(00|30)\s*(AM|PM)$/i.exec(text);
  if (match12) {
    let hours = Number(match12[1]) % 12;
    if (match12[3].toUpperCase() === "PM") hours += 12;
    return hours * 60 + Number(match12[2]);
  }
  return undefined;
}

function formatMinutesTo24h(minutes) {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
}

function formatMinutesTo12h(minutes) {
  const hours24 = Math.floor(minutes / 60);
  const mins = minutes % 60;
  const period = hours24 >= 12 ? "PM" : "AM";
  const hours12 = hours24 % 12 || 12;
  return `${hours12}:${String(mins).padStart(2, "0")} ${period}`;
}

function formatStructuredSchedule(days, startMinutes, endMinutes) {
  return `${days.join(", ")} · ${formatMinutesTo12h(startMinutes)} – ${formatMinutesTo12h(endMinutes)}`;
}

function parseStructuredScheduleInput(body = {}) {
  const scheduleObject =
    body.schedule && typeof body.schedule === "object" && !Array.isArray(body.schedule)
      ? body.schedule
      : null;
  const rawDays = body.scheduleDays ?? body.days ?? scheduleObject?.days;
  const rawStart = body.scheduleStartTime ?? body.startTime ?? scheduleObject?.startTime;
  const rawEnd = body.scheduleEndTime ?? body.endTime ?? scheduleObject?.endTime;
  const hasStructuredInput =
    rawDays !== undefined || rawStart !== undefined || rawEnd !== undefined;

  if (!hasStructuredInput) {
    return {
      scheduleDays: [],
      scheduleStartTime: null,
      scheduleEndTime: null,
      schedule: typeof body.schedule === "string" ? optionalText(body.schedule) : null,
    };
  }

  const dayList = Array.isArray(rawDays)
    ? rawDays.map((day) => String(day || "").trim()).filter(Boolean)
    : [];
  const startText = String(rawStart || "").trim();
  const endText = String(rawEnd || "").trim();

  if (!dayList.length && !startText && !endText) {
    return {
      scheduleDays: [],
      scheduleStartTime: null,
      scheduleEndTime: null,
      schedule: typeof body.schedule === "string" ? optionalText(body.schedule) : null,
    };
  }

  if (!dayList.length) {
    return { error: "Select at least one day of the week for the schedule." };
  }
  if (dayList.some((day) => !SCHEDULE_DAYS.includes(day))) {
    return { error: "Schedule days must be valid days from Mon to Sun." };
  }
  const sortedDays = SCHEDULE_DAYS.filter((day) => dayList.includes(day));
  const startMinutes = parseScheduleTimeMinutes(startText);
  const endMinutes = parseScheduleTimeMinutes(endText);
  if (startMinutes == null || endMinutes == null) {
    return { error: "Select both a start time and an end time in 30-minute steps." };
  }
  if (endMinutes <= startMinutes) {
    return { error: "End time must be after start time." };
  }

  return {
    scheduleDays: sortedDays,
    scheduleStartTime: formatMinutesTo24h(startMinutes),
    scheduleEndTime: formatMinutesTo24h(endMinutes),
    schedule: formatStructuredSchedule(sortedDays, startMinutes, endMinutes),
  };
}

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

    const parsedSchedule = parseStructuredScheduleInput(req.body);
    if (parsedSchedule.error) {
      return res.status(400).json({ message: parsedSchedule.error });
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
          schedule: parsedSchedule.schedule,
          scheduleDays: parsedSchedule.scheduleDays,
          scheduleStartTime: parsedSchedule.scheduleStartTime,
          scheduleEndTime: parsedSchedule.scheduleEndTime,
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

async function enrichRosterWithPhotos(roster) {
  if (!roster.length) return roster;
  const studentIds = [...new Set(roster.map((entry) => entry.studentId).filter(Boolean))];
  const profiles = await prisma.studentProfile.findMany({
    where: { studentId: { in: studentIds } },
    select: { id: true, studentId: true, updatedAt: true },
  });
  const profileByStudentId = new Map(profiles.map((p) => [p.studentId, p]));
  return roster.map((entry) => {
    const profile = profileByStudentId.get(entry.studentId);
    const photoUrl = profile ? studentPhotoUrl(profile) : null;
    return {
      ...entry,
      photo: photoUrl,
      photoUrl,
    };
  });
}

app.get(
  "/api/classes/:id/roster",
  requireAuth,
  requireRole("FACULTY"),
  async (req, res) => {
    try {
      if (!(await findOwnedClass(req.params.id, req.session.userId))) return res.status(404).json({ message: "Class not found." });
      const roster = await prisma.classRoster.findMany({ where: { classId: req.params.id }, orderBy: [{ sortKey: "asc" }, { firstName: "asc" }, { middleName: "asc" }, { studentId: "asc" }] });
      return res.json({ roster: await enrichRosterWithPhotos(roster) });
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
      const roster = await prisma.$transaction(incoming.map((entry) => {
        const parsedName = parseFullName(entry.studentName);
        return prisma.classRoster.upsert({
          where: { classId_studentId: { classId: req.params.id, studentId: entry.studentId } },
          create: {
            classId: req.params.id,
            studentName: entry.studentName,
            studentId: entry.studentId,
            firstName: parsedName.firstName,
            middleName: parsedName.middleName,
            lastName: parsedName.lastName,
            suffix: parsedName.suffix,
            // sortKey is a derived, denormalized column kept only for ordering/indexing
            sortKey: parsedName.sortKey,
          },
          update: {
            studentName: entry.studentName,
            firstName: parsedName.firstName,
            middleName: parsedName.middleName,
            lastName: parsedName.lastName,
            suffix: parsedName.suffix,
            sortKey: parsedName.sortKey,
          },
        });
      }));
      const autoApprovedCount = await autoApproveRosterMatches(req.params.id);
      return res.status(201).json({ roster: await enrichRosterWithPhotos(roster), autoApprovedCount });
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
      const parsedEntryName = parseFullName(entry.studentName);
      const updated = await prisma.classRoster.updateMany({
        where: { id: req.params.entryId, classId: req.params.id },
        data: {
          studentName: entry.studentName,
          studentId: entry.studentId,
          firstName: parsedEntryName.firstName,
          middleName: parsedEntryName.middleName,
          lastName: parsedEntryName.lastName,
          suffix: parsedEntryName.suffix,
          sortKey: parsedEntryName.sortKey,
        },
      });
      if (!updated.count) return res.status(404).json({ message: "Student list entry not found." });
      const [savedEntry, autoApprovedCount] = await Promise.all([
        prisma.classRoster.findUnique({ where: { id: req.params.entryId } }),
        autoApproveRosterMatches(req.params.id),
      ]);
      return res.json({ entry: savedEntry, autoApprovedCount });
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
    const ownedClass = await prisma.class.findFirst({
      where: { id: req.params.id, facultyId: req.session.userId },
      select: { id: true, sectionName: true },
    });
    if (!ownedClass) return res.status(404).json({ message: "Class not found." });
    const [pending, autoApproved, absenceWarnings] = await Promise.all([
      prisma.classEnrollment.findMany({
        where: { classId: ownedClass.id, status: "PENDING" },
        include: {
          studentProfile: {
            select: {
              id: true,
              name: true,
              studentId: true,
              program: true,
              section: true,
              updatedAt: true,
            },
          },
        },
        orderBy: { joinedAt: "asc" },
      }),
      prisma.classEnrollment.findMany({
        where: { classId: ownedClass.id, autoApprovedAt: { not: null } },
        include: {
          studentProfile: {
            select: { id: true, name: true, studentId: true, program: true, section: true, updatedAt: true },
          },
        },
        orderBy: { autoApprovedAt: "desc" },
      }),
      getActiveAbsenceWarningsForClass(ownedClass.id, ownedClass.sectionName),
    ]);
    const formatEnrollment = (enrollment) => {
      const photoUrl = studentPhotoUrl(enrollment.studentProfile);
      return {
        ...enrollment,
        studentProfile: enrollment.studentProfile
          ? {
              ...enrollment.studentProfile,
              photo: photoUrl,
              photoUrl,
            }
          : null,
      };
    };
    const approvedNotifications = autoApproved.map((enrollment) => ({
      ...formatEnrollment(enrollment),
      isRead: Boolean(enrollment.autoApprovalReadAt),
    }));
    const formattedPending = pending.map(formatEnrollment);
    const unreadAutoApproved = approvedNotifications.filter((enrollment) => !enrollment.isRead).length;
    const unreadWarnings = absenceWarnings.filter((warning) => !warning.isRead).length;
    return res.json({
      pending: formattedPending,
      autoApproved: approvedNotifications,
      absenceWarnings,
      threshold: ABSENCE_WARNING_THRESHOLD,
      unreadNotificationCount: formattedPending.length + unreadAutoApproved + unreadWarnings,
      totalNotifications: formattedPending.length + unreadAutoApproved + unreadWarnings,
    });
  } catch (error) {
    return res.status(500).json({ message: "Unable to load pending requests." });
  }
});

app.post(
  "/api/classes/:id/notifications/read",
  requireAuth,
  requireRole("FACULTY"),
  async (req, res) => {
    try {
      const ownedClass = await prisma.class.findFirst({
        where: { id: req.params.id, facultyId: req.session.userId },
        select: { id: true, sectionName: true },
      });
      if (!ownedClass) return res.status(404).json({ message: "Class not found." });

      const unreadWarnings = (await getActiveAbsenceWarningsForClass(ownedClass.id, ownedClass.sectionName))
        .filter((warning) => !warning.isRead);
      const readResults = await prisma.$transaction([
        prisma.classEnrollment.updateMany({
          where: {
            classId: ownedClass.id,
            autoApprovedAt: { not: null },
            autoApprovalReadAt: null,
          },
          data: { autoApprovalReadAt: new Date() },
        }),
        ...unreadWarnings.map((warning) =>
          prisma.classEnrollment.update({
            where: { id: warning.enrollmentId },
            data: { warningReadAbsenceCount: warning.absenceCount },
          }),
        ),
      ]);
      const pendingCount = await prisma.classEnrollment.count({
        where: { classId: ownedClass.id, status: "PENDING" },
      });
      return res.json({
        markedRead: readResults[0].count + unreadWarnings.length,
        pendingCount,
      });
    } catch (error) {
      console.error("Mark notifications read failed:", error);
      return res.status(500).json({ message: "Unable to mark notifications as read." });
    }
  },
);

app.post(
  "/api/classes/:id/absence-warnings/:studentId/read",
  requireAuth,
  requireRole("FACULTY"),
  async (req, res) => {
    try {
      const enrollment = await prisma.classEnrollment.findFirst({
        where: {
          classId: req.params.id,
          status: "APPROVED",
          studentProfileId: req.params.studentId,
          class: { is: { facultyId: req.session.userId } },
        },
        select: { id: true, studentProfileId: true },
      });
      if (!enrollment) return res.status(404).json({ message: "Student not found in this class." });
      const absentCount = await prisma.attendanceRecord.count({
        where: {
          studentId: enrollment.studentProfileId,
          status: "ABSENT",
          session: { is: { classId: req.params.id } },
        },
      });
      await prisma.classEnrollment.update({
        where: { id: enrollment.id },
        data: { warningReadAbsenceCount: absentCount },
      });
      return res.json({ isRead: true, absentCount });
    } catch (error) {
      console.error("Mark absence warning read failed:", error);
      return res.status(500).json({ message: "Unable to mark the warning as read." });
    }
  },
);

app.post(
  "/api/classes/:id/absence-warnings/:studentId/dismiss",
  requireAuth,
  requireRole("FACULTY"),
  async (req, res) => {
    try {
      const ownedClass = await findOwnedClass(req.params.id, req.session.userId);
      if (!ownedClass) {
        return res.status(404).json({ message: "Class not found." });
      }
      const enrollment = await prisma.classEnrollment.findFirst({
        where: {
          classId: ownedClass.id,
          studentProfileId: req.params.studentId,
          status: "APPROVED",
        },
        select: { id: true, studentProfileId: true },
      });
      if (!enrollment) {
        return res.status(404).json({ message: "Student not found in this class." });
      }
      const absentCount = await prisma.attendanceRecord.count({
        where: {
          studentId: enrollment.studentProfileId,
          status: "ABSENT",
          session: { is: { classId: ownedClass.id } },
        },
      });
      await prisma.classEnrollment.update({
        where: { id: enrollment.id },
        data: { dismissedAbsenceCount: absentCount, warningReadAbsenceCount: absentCount },
      });
      return res.json({
        dismissed: true,
        studentId: enrollment.studentProfileId,
        absentCount,
      });
    } catch (error) {
      console.error("Dismiss absence warning failed:", error);
      return res.status(500).json({ message: "Unable to dismiss warning." });
    }
  },
);

app.patch("/api/classes/:id/pending/:enrollmentId", requireAuth, requireRole("FACULTY"), async (req, res) => {
  const status = String(req.body?.status || "").toUpperCase();
  if (!["APPROVED", "DECLINED"].includes(status)) return res.status(400).json({ message: "Status must be APPROVED or DECLINED." });
  try {
    const classRecord = await prisma.class.findFirst({
      where: { id: req.params.id, facultyId: req.session.userId },
      select: { id: true, sectionName: true, classCode: true, faculty: { select: { name: true, email: true } } },
    });
    if (!classRecord) return res.status(404).json({ message: "Class not found." });

    const pendingEnrollment = await prisma.classEnrollment.findFirst({
      where: { id: req.params.enrollmentId, classId: req.params.id, status: "PENDING" },
      include: { studentProfile: true },
    });
    if (!pendingEnrollment) return res.status(404).json({ message: "Pending request not found." });

    let warning = null;
    let enrollment = null;

    if (status === "APPROVED") {
      const studentProfile = pendingEnrollment.studentProfile;
      const validStudentId = studentProfile?.studentId && STUDENT_ID_PATTERN.test(studentProfile.studentId);
      if (!validStudentId) {
        warning = "missing_or_invalid_student_id";
      }

      enrollment = await prisma.$transaction(async (tx) => {
        const updated = await tx.classEnrollment.update({
          where: { id: pendingEnrollment.id },
          data: { status: "APPROVED", droppedAt: null, autoApprovedAt: null, autoApprovalReadAt: null },
          include: { studentProfile: true, class: true },
        });

        if (validStudentId) {
          const parsed = parseFullName(studentProfile.name);
          const existingRoster = await tx.classRoster.findUnique({
            where: {
              classId_studentId: {
                classId: req.params.id,
                studentId: studentProfile.studentId,
              },
            },
          });

          if (!existingRoster) {
            await tx.classRoster.create({
              data: {
                classId: req.params.id,
                studentId: studentProfile.studentId,
                studentName: studentProfile.name,
                firstName: parsed.firstName,
                middleName: parsed.middleName,
                lastName: parsed.lastName,
                suffix: parsed.suffix,
                sortKey: parsed.sortKey,
                droppedAt: null,
              },
            });
          } else if (existingRoster.droppedAt) {
            // Approving a student whose roster row is dropped restores it
            await tx.classRoster.update({
              where: { id: existingRoster.id },
              data: {
                droppedAt: null,
                studentName: existingRoster.studentName || studentProfile.name,
                firstName: existingRoster.firstName || parsed.firstName,
                middleName: existingRoster.middleName || parsed.middleName,
                lastName: existingRoster.lastName || parsed.lastName,
                suffix: existingRoster.suffix || parsed.suffix,
                sortKey: existingRoster.sortKey || parsed.sortKey,
              },
            });
          } else if (!existingRoster.studentName) {
            await tx.classRoster.update({
              where: { id: existingRoster.id },
              data: {
                studentName: studentProfile.name,
                firstName: parsed.firstName,
                middleName: parsed.middleName,
                lastName: parsed.lastName,
                suffix: parsed.suffix,
                sortKey: parsed.sortKey,
              },
            });
          }
        }
        return updated;
      });
    } else {
      enrollment = await prisma.classEnrollment.update({
        where: { id: pendingEnrollment.id },
        data: { status: "DECLINED", autoApprovedAt: null, autoApprovalReadAt: null },
        include: { studentProfile: true, class: true },
      });
    }

    if (enrollment?.studentProfile?.email) {
      queueEmail(buildDecisionEmail({
        studentName: enrollment.studentProfile.name,
        studentEmail: enrollment.studentProfile.email,
        classSectionName: classRecord.sectionName,
        decision: status,
        facultyName: classRecord.faculty?.name,
      }), `join ${status.toLowerCase()}`);
    }

    return res.json({ enrollment, warning });
  } catch (error) {
    console.error("Pending request update failed:", error);
    return res.status(500).json({ message: "Unable to update pending request." });
  }
});

app.get("/api/classes/:id/quizzes", requireAuth, requireRole("FACULTY"), async (req, res) => {
  try {
    if (!(await findOwnedClass(req.params.id, req.session.userId))) return res.status(404).json({ message: "Class not found." });
    const sessions = await prisma.quizSession.findMany({ where: { classId: req.params.id }, include: { scores: true }, orderBy: { date: "desc" } });
    if (!sessions.length) return res.json({ sessions: [] });

    const dateMap = new Map();
    for (const s of sessions) {
      const dStr = new Date(s.date).toISOString().slice(0, 10);
      if (!dateMap.has(dStr)) dateMap.set(dStr, new Date(dStr));
    }
    const distinctDates = [...dateMap.values()];

    const attendanceSessions = await prisma.classSession.findMany({
      where: {
        classId: req.params.id,
        date: { in: distinctDates },
      },
      select: {
        date: true,
        attendance: { select: { studentId: true, status: true } },
      },
    });

    const absentIdsByDate = new Map();
    for (const attSession of attendanceSessions) {
      const dStr = attSession.date.toISOString().slice(0, 10);
      const absentIds = new Set(
        attSession.attendance
          .filter((record) => record.status === "ABSENT")
          .map((record) => record.studentId),
      );
      absentIdsByDate.set(dStr, absentIds);
    }

    const enriched = sessions.map((session) => {
      const dStr = new Date(session.date).toISOString().slice(0, 10);
      const absentIds = absentIdsByDate.get(dStr) || new Set();
      return {
        ...session,
        scores: session.scores.map((score) => ({
          ...score,
          isAbsent: score.isAbsent || absentIds.has(score.studentId),
          score: absentIds.has(score.studentId) ? null : score.score,
        })),
      };
    });
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

app.put("/api/quizzes/:sessionId/scores", requireAuth, requireRole("FACULTY"), async (req, res) => {
  const rawItems = Array.isArray(req.body) ? req.body : req.body?.scores;
  if (!Array.isArray(rawItems)) {
    return res.status(400).json({ message: "Scores list must be an array of { studentId, score }." });
  }
  try {
    const session = await prisma.quizSession.findFirst({
      where: { id: req.params.sessionId, class: { is: { facultyId: req.session.userId } } },
    });
    if (!session) return res.status(404).json({ message: "Quiz session not found." });

    for (const item of rawItems) {
      if (!item || typeof item.studentId !== "string" || !item.studentId.trim()) {
        return res.status(400).json({ message: "Every item must have a valid studentId." });
      }
      const score = Number(item.score);
      if (!Number.isInteger(score) || score < 0) {
        return res.status(400).json({ message: "Score must be a non-negative whole number." });
      }
      if (score > session.totalItems) {
        return res.status(400).json({ message: `Score cannot be higher than ${session.totalItems}.` });
      }
    }

    const studentIds = rawItems.map((item) => item.studentId.trim());

    const attendanceSession = await prisma.classSession.findUnique({
      where: {
        classId_date: {
          classId: session.classId,
          date: new Date(new Date(session.date).toISOString().slice(0, 10)),
        },
      },
      select: {
        attendance: {
          where: { studentId: { in: studentIds } },
          select: { studentId: true, status: true },
        },
      },
    });

    const absentSet = new Set(
      (attendanceSession?.attendance || [])
        .filter((r) => r.status === "ABSENT")
        .map((r) => r.studentId),
    );

    const savedScores = await prisma.$transaction(
      rawItems.map((item) => {
        const studentId = item.studentId.trim();
        const isAbsent = absentSet.has(studentId);
        const score = isAbsent ? null : Number(item.score);
        return prisma.quizScore.upsert({
          where: {
            sessionId_studentId: {
              sessionId: session.id,
              studentId,
            },
          },
          create: {
            sessionId: session.id,
            studentId,
            score,
            isAbsent,
          },
          update: {
            score,
            isAbsent,
          },
        });
      }),
    );
    return res.json({ scores: savedScores });
  } catch (error) {
    console.error("Bulk quiz scores update failed:", error);
    return res.status(500).json({ message: "Unable to save quiz scores." });
  }
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

app.get("/api/students/:profileId/photo", requireAuth, async (req, res) => {
  try {
    const profile = await prisma.studentProfile.findUnique({
      where: { id: req.params.profileId },
      select: {
        id: true,
        userId: true,
        studentId: true,
        photo: true,
        updatedAt: true,
      },
    });
    if (!profile || !profile.photo) {
      return res.status(404).json({ message: "Photo not found." });
    }

    const isSelf = profile.userId === req.session.userId;
    if (!isSelf) {
      if (req.session.role === "FACULTY") {
        const allowed = await prisma.class.findFirst({
          where: {
            facultyId: req.session.userId,
            OR: [
              { enrollments: { some: { studentProfileId: profile.id } } },
              { roster: { some: { studentId: profile.studentId } } },
            ],
          },
          select: { id: true },
        });
        if (!allowed) {
          return res.status(403).json({ message: "You do not have permission to view this photo." });
        }
      } else {
        return res.status(403).json({ message: "You do not have permission to view this photo." });
      }
    }

    if (/^https?:\/\//i.test(profile.photo.trim())) {
      res.setHeader("Cache-Control", "private, max-age=86400");
      return res.redirect(302, profile.photo.trim());
    }

    const etag = `"${profile.updatedAt ? new Date(profile.updatedAt).getTime() : 'photo'}"`;
    res.setHeader("Cache-Control", "private, max-age=86400");
    res.setHeader("ETag", etag);

    if (req.headers["if-none-match"] === etag) {
      return res.status(304).end();
    }

    let mimeType = "image/jpeg";
    let base64Data = profile.photo;
    const matches = profile.photo.match(/^data:([^;]+);base64,(.+)$/);
    if (matches) {
      mimeType = matches[1];
      base64Data = matches[2];
    } else if (profile.photo.startsWith("data:")) {
      return res.status(400).json({ message: "Invalid photo format." });
    }

    const buffer = Buffer.from(base64Data, "base64");
    res.setHeader("Content-Type", mimeType);
    res.setHeader("Content-Length", buffer.length);
    return res.end(buffer);
  } catch (error) {
    console.error("Student photo fetch failed:", error);
    return res.status(500).json({ message: "Unable to retrieve student photo." });
  }
});

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
                  updatedAt: true,
                  studentId: true,
                  program: true,
                  section: true,
                  firstName: true,
                  middleName: true,
                  lastName: true,
                  suffix: true,
                  sortKey: true,
                },
              },
            },
            orderBy: [
              { studentProfile: { sortKey: "asc" } },
              { studentProfile: { firstName: "asc" } },
              { studentProfile: { middleName: "asc" } },
              { studentProfile: { studentId: "asc" } },
            ],
          },
        },
      });
      if (!classRecord) {
        return res.status(404).json({ message: "Class not found." });
      }

      let session = await prisma.classSession.findUnique({
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
                  updatedAt: true,
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

      if (!session) {
        session = await prisma.classSession.create({
          data: {
            classId: classRecord.id,
            date: manilaDate(),
            startedAt: null,
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
                    updatedAt: true,
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
      }

      const [rosterCount, pendingCount] = await Promise.all([
        prisma.classRoster.count({ where: { classId: classRecord.id } }),
        prisma.classEnrollment.count({ where: { classId: classRecord.id, status: "PENDING" } }),
      ]);

      const { enrollments, ...classData } = classRecord;
      const attendanceByStudent = new Map(
        (session?.attendance || []).map((record) => [
          record.studentId,
          record.status,
        ]),
      );
      return res.json({
        class: classData,
        rosterCount,
        pendingCount,
        students: enrollments.map(({ studentProfile }) => {
          const photoUrl = studentPhotoUrl(studentProfile);
          return {
            ...studentProfile,
            photo: photoUrl,
            photoUrl,
            studentProfileId: studentProfile.id,
            attendanceStatus: attendanceByStudent.get(studentProfile.id) || null,
          };
        }),
        session: session
          ? {
              id: session.id,
              classId: session.classId,
              date: session.date,
              startedAt: session.startedAt,
              endedAt: session.endedAt,
            }
          : null,
        recitationHistory: (session?.recitations || []).map((r) => {
          const photoUrl = studentPhotoUrl(r.studentProfile);
          return {
            ...r,
            studentProfile: r.studentProfile
              ? {
                  ...r.studentProfile,
                  photo: photoUrl,
                  photoUrl,
                }
              : null,
          };
        }),
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
              updatedAt: true,
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

      const recProfile = enrollment.studentProfile;
      const recPhotoUrl = studentPhotoUrl(recProfile);
      return res.json({
        student: { ...recProfile, photo: recPhotoUrl, photoUrl: recPhotoUrl },
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

      const startNow = req.body?.start === true;
      const today = manilaDate();
      let session = await prisma.classSession.upsert({
        where: {
          classId_date: {
            classId: classRecord.id,
            date: today,
          },
        },
        create: {
          classId: classRecord.id,
          date: today,
          startedAt: startNow ? new Date() : null,
        },
        update: {},
      });
      if (startNow && !session.startedAt) {
        session = await prisma.classSession.update({
          where: { id: session.id },
          data: { startedAt: new Date() },
        });
      }
      return res.json({ session });
    } catch (error) {
      console.error("Today's class session lookup or creation failed:", error);
      return res.status(500).json({ message: "Unable to open today's class session." });
    }
  },
);

app.post(
  "/api/sessions/:id/start",
  requireAuth,
  requireRole("FACULTY"),
  async (req, res) => {
    try {
      const sessionRecord = await findOwnedSession(req.params.id, req.session.userId);
      if (!sessionRecord) {
        return res.status(404).json({ message: "Class session not found." });
      }
      const session = sessionRecord.startedAt
        ? sessionRecord
        : await prisma.classSession.update({
            where: { id: sessionRecord.id },
            data: { startedAt: new Date() },
          });
      return res.json({
        session: {
          id: session.id,
          classId: session.classId,
          date: session.date,
          startedAt: session.startedAt,
          endedAt: session.endedAt,
        },
      });
    } catch (error) {
      console.error("Session start failed:", error);
      return res.status(500).json({ message: "Unable to start attendance session." });
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
        select: {
          id: true,
          classId: true,
          sessionId: true,
          title: true,
          maxScore: true,
          createdAt: true,
        },
        orderBy: { createdAt: "asc" },
      });

      if (!activities.length) {
        return res.json({ activities: [] });
      }

      const activityIds = activities.map((a) => a.id);
      const [scoredGroups, absentGroups] = await Promise.all([
        prisma.activityScore.groupBy({
          by: ["activityId"],
          where: {
            activityId: { in: activityIds },
            score: { not: null },
            isAbsent: false,
          },
          _count: { _all: true },
        }),
        prisma.activityScore.groupBy({
          by: ["activityId"],
          where: {
            activityId: { in: activityIds },
            isAbsent: true,
          },
          _count: { _all: true },
        }),
      ]);

      const scoredMap = new Map(scoredGroups.map((g) => [g.activityId, g._count._all]));
      const absentMap = new Map(absentGroups.map((g) => [g.activityId, g._count._all]));

      return res.json({
        activities: activities.map((a) => ({
          ...a,
          scoredCount: scoredMap.get(a.id) || 0,
          absentCount: absentMap.get(a.id) || 0,
          scores: [],
        })),
      });
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
        const photoUrl = studentPhotoUrl(profile);
        const profileWithPhoto = { ...profile, photo: photoUrl, photoUrl };
        if (activityScores[0]) {
          return { ...activityScores[0], studentProfile: profileWithPhoto };
        }
        return {
          id: null,
          activityId: activity.id,
          studentId: profile.id,
          score: null,
          isAbsent: false,
          studentProfile: profileWithPhoto,
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
      return res.json({ score: attachPhotoUrl(activityScore) });
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

      const existingCount = await prisma.project.count({
        where: { classId: classRecord.id },
      });

      if (existingCount < 2) {
        await prisma.$transaction(async (transaction) => {
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
        });
      }

      const projects = await prisma.project.findMany({
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

      const formattedProjects = projects.map((p) => ({
        ...p,
        scores: (p.scores || []).map((s) => {
          const photoUrl = studentPhotoUrl(s.studentProfile);
          return {
            ...s,
            studentProfile: s.studentProfile
              ? {
                  ...s.studentProfile,
                  photo: photoUrl,
                  photoUrl,
                }
              : null,
          };
        }),
      }));

      return res.json({ projects: formattedProjects });
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
        const photoUrl = studentPhotoUrl(profile);
        const profileWithPhoto = { ...profile, photo: photoUrl, photoUrl };
        if (projectScores[0]) {
          return { ...projectScores[0], studentProfile: profileWithPhoto };
        }
        return {
          id: null,
          projectId: project.id,
          studentId: profile.id,
          sessionId: null,
          score: null,
          isAbsent: false,
          session: null,
          studentProfile: profileWithPhoto,
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
      return res.json({ score: attachPhotoUrl(projectScore) });
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

        const now = new Date();
        let effectiveStartedAt = sessionRecord.startedAt;
        if (!effectiveStartedAt) {
          const updatedSession = await transaction.classSession.update({
            where: { id: sessionRecord.id },
            data: { startedAt: now },
            select: { startedAt: true },
          });
          effectiveStartedAt = updatedSession.startedAt || now;
        }

        const gracePeriodMinutes =
          Number.isInteger(sessionRecord.class?.gracePeriodMinutes) &&
          sessionRecord.class.gracePeriodMinutes >= 0
            ? sessionRecord.class.gracePeriodMinutes
            : 15;
        const { appliedStatus, lateOverride } = applyGracePeriod(
          requestedStatus,
          effectiveStartedAt,
          gracePeriodMinutes,
          now.getTime(),
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
            markedAt: now,
          },
          update: { status: appliedStatus, markedAt: now },
        });
        await syncAttendanceScoreAbsence(
          transaction,
          sessionRecord.id,
          enrollment.studentProfileId,
          appliedStatus === "ABSENT",
        );
        return {
          attendance,
          appliedStatus,
          lateOverride,
          sessionStartedAt: effectiveStartedAt,
        };
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
              updatedAt: true,
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
              updatedAt: true,
              studentId: true,
              program: true,
              section: true,
            },
          },
        },
      });
      return res.json({ recitation: attachPhotoUrl(log) });
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
              updatedAt: true,
              studentId: true,
              program: true,
              section: true,
            },
          },
        },
      });
      return res.json({ recitation: attachPhotoUrl(updatedLog) });
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
                include: {
                  faculty: {
                    select: {
                      name: true,
                      facultyProfile: { select: { name: true, photo: true } },
                    },
                  },
                },
              },
            },
            orderBy: { joinedAt: "desc" },
          },
        },
      });
      if (!profile) {
        return res.json({ classes: [] });
      }
      const enrolledClasses = profile.enrollments.map((item) => ({
        ...item.class,
        enrollmentStatus: item.status,
        joinedAt: item.joinedAt,
      }));
      const summaryRows = await prisma.$queryRaw`
        WITH attendance AS (
          SELECT session."classId",
            COUNT(*)::int AS "attendanceCount",
            COUNT(*) FILTER (WHERE record."status" IN ('PRESENT'::"AttendanceStatus", 'LATE'::"AttendanceStatus"))::int AS "attendedCount"
          FROM "AttendanceRecord" AS record
          JOIN "ClassSession" AS session ON session."id" = record."sessionId"
          WHERE record."studentId" = ${profile.id}
          GROUP BY session."classId"
        ), recitations AS (
          SELECT session."classId",
            COALESCE(SUM(log."score"), 0)::float8 AS "scoreTotal",
            COUNT(log."score")::int AS "scoreCount"
          FROM "RecitationLog" AS log
          JOIN "ClassSession" AS session ON session."id" = log."sessionId"
          WHERE log."studentId" = ${profile.id}
          GROUP BY session."classId"
        ), activities AS (
          SELECT activity."classId",
            COALESCE(SUM(score."score") FILTER (WHERE score."score" >= 0), 0)::float8 AS "scoreTotal",
            COALESCE(SUM(CASE WHEN score."score" >= 0 THEN CASE WHEN activity."maxScore" > 0 THEN activity."maxScore" ELSE 100 END END), 0)::float8 AS "possibleTotal"
          FROM "ActivityScore" AS score
          JOIN "Activity" AS activity ON activity."id" = score."activityId"
          WHERE score."studentId" = ${profile.id}
          GROUP BY activity."classId"
        ), quizzes AS (
          SELECT quiz."classId",
            COALESCE(SUM(score."score") FILTER (WHERE score."score" >= 0), 0)::float8 AS "scoreTotal",
            COALESCE(SUM(CASE WHEN score."score" >= 0 THEN CASE WHEN quiz."totalItems" > 0 THEN quiz."totalItems" ELSE 100 END END), 0)::float8 AS "possibleTotal"
          FROM "QuizScore" AS score
          JOIN "QuizSession" AS quiz ON quiz."id" = score."sessionId"
          WHERE score."studentId" = ${profile.id}
          GROUP BY quiz."classId"
        )
        SELECT COALESCE(attendance."classId", recitations."classId", activities."classId", quizzes."classId") AS "classId",
          attendance."attendanceCount", attendance."attendedCount",
          recitations."scoreTotal" AS "recitationScoreTotal", recitations."scoreCount" AS "recitationScoreCount",
          activities."scoreTotal" AS "activityScoreTotal", activities."possibleTotal" AS "activityPossibleTotal",
          quizzes."scoreTotal" AS "quizScoreTotal", quizzes."possibleTotal" AS "quizPossibleTotal"
        FROM attendance
        FULL OUTER JOIN recitations USING ("classId")
        FULL OUTER JOIN activities USING ("classId")
        FULL OUTER JOIN quizzes USING ("classId")
      `;
      const summaryByClass = new Map(summaryRows.map((row) => [row.classId, row]));
      const summaries = enrolledClasses.map((classItem) => {
        const row = summaryByClass.get(classItem.id) || {};
        const activityPossible = Number(row.activityPossibleTotal || 0);
        const quizPossible = Number(row.quizPossibleTotal || 0);
        return {
          ...classItem,
          recordSummary: {
            attendance: formatPercentSummary(Number(row.attendedCount || 0), Number(row.attendanceCount || 0)),
            recitation: formatAverageSummary(Number(row.recitationScoreTotal || 0), Number(row.recitationScoreCount || 0), " / 5"),
            activities: activityPossible ? `${Math.round((Number(row.activityScoreTotal || 0) / activityPossible) * 100)}%` : "—",
            quiz: quizPossible ? `${Math.round((Number(row.quizScoreTotal || 0) / quizPossible) * 100)}%` : "—",
          },
        };
      });
      return res.json({ classes: summaries });
    } catch (error) {
      console.error("Student classes lookup failed:", error);
      return res.status(500).json({ message: "Unable to load your classes." });
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
      const safeSectionName = classRecord.sectionName.replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "") || "class";
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="${safeSectionName}-export.xlsx"`);
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
        include: {
          faculty: { select: { name: true } },
          enrollments: {
            where: { studentProfileId: profile.id },
            select: { status: true, joinedAt: true },
          },
        },
      });
      if (!classRecord) {
        return res.status(404).json({ message: "Class not found." });
      }

      const [attendance, recitations, rawActivities, projects, quizzes] = await Promise.all([
        prisma.attendanceRecord.findMany({
          where: { studentId: profile.id, session: { is: { classId: classRecord.id } } },
          select: { id: true, status: true, markedAt: true, session: { select: { id: true, date: true } } },
          orderBy: { markedAt: "desc" },
        }),
        prisma.recitationLog.findMany({
          where: { studentId: profile.id, session: { is: { classId: classRecord.id } } },
          select: { id: true, method: true, calledAt: true, score: true, session: { select: { id: true, date: true } } },
          orderBy: { calledAt: "desc" },
        }),
        prisma.activityScore.findMany({
          where: { studentId: profile.id, activity: { is: { classId: classRecord.id } } },
          select: {
            id: true,
            score: true,
            isAbsent: true,
            createdAt: true,
            activity: {
              select: {
                id: true,
                title: true,
                maxScore: true,
                session: { select: { id: true, date: true } },
              },
            },
          },
          orderBy: { updatedAt: "desc" },
        }),
        prisma.projectScore.findMany({
          where: { studentId: profile.id, project: { is: { classId: classRecord.id } } },
          select: {
            id: true,
            score: true,
            isAbsent: true,
            createdAt: true,
            project: { select: { id: true, type: true, maxScore: true } },
            session: { select: { id: true, date: true } },
          },
          orderBy: { updatedAt: "desc" },
        }),
        prisma.quizScore.findMany({
          where: { studentId: profile.id, session: { is: { classId: classRecord.id } } },
          select: { id: true, score: true, isAbsent: true, createdAt: true, session: { select: { id: true, date: true, title: true, totalItems: true } } },
          orderBy: { updatedAt: "desc" },
        }),
      ]);

      const activities = rawActivities.map((item) => ({
        ...item,
        session: item.activity?.session || null,
      }));
      const { enrollments: studentEnrollments, ...classData } = classRecord;
      const studentEnrollment = studentEnrollments?.[0] || null;

      return res.json({
        student: profile,
        class: {
          ...classData,
          enrollmentStatus: studentEnrollment?.status || "APPROVED",
          joinedAt: studentEnrollment?.joinedAt || null,
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
        projects,
        quizzes,
      });
    } catch (error) {
      console.error("Student class records lookup failed:", error);
      return res.status(500).json({ message: "Unable to load this class record." });
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

    let profile;
    let classRecord;
    try {
      [profile, classRecord] = await Promise.all([
        prisma.studentProfile.findUnique({
          where: { userId: req.session.userId },
        }),
        prisma.class.findUnique({ where: { classCode }, include: { faculty: { select: { name: true, email: true } } } }),
      ]);
      if (!classRecord) {
        return res.status(404).json({ message: "No class matches that invite code." });
      }
      if (!profile) {
        return res.status(409).json({
          message: "Create your student profile before joining a class.",
        });
      }

      const joinResult = await prisma.$transaction(async (tx) => {
        const existingEnrollment = await tx.classEnrollment.findUnique({
          where: { studentProfileId_classId: { studentProfileId: profile.id, classId: classRecord.id } },
          include: { class: true },
        });
        if (existingEnrollment?.status === "APPROVED") {
          return { kind: "existing", enrollment: existingEnrollment, status: "APPROVED", message: "You have already joined this class." };
        }

        const studentId = String(profile.studentId ?? "").trim();
        const roster = await tx.classRoster.findMany({ where: { classId: classRecord.id }, select: { studentId: true } });
        const rosterStudentIds = new Set(roster.map((entry) => String(entry.studentId ?? "").trim()));
        const matchesRoster = rosterStudentIds.has(studentId);
        if (existingEnrollment?.status === "PENDING" && !matchesRoster) {
          return { kind: "existing", enrollment: existingEnrollment, status: "PENDING", message: "Your request is already waiting for instructor approval." };
        }
        const status = matchesRoster ? "APPROVED" : "PENDING";
        const autoApprovalData = {
          status,
          autoApprovedAt: matchesRoster ? new Date() : null,
          autoApprovalReadAt: null,
          ...(matchesRoster ? { warningReadAbsenceCount: 0 } : {}),
        };
        const enrollment = existingEnrollment
          ? await tx.classEnrollment.update({
              where: { id: existingEnrollment.id },
              data: { ...autoApprovalData, joinedAt: new Date() },
              include: { class: true },
            })
          : await tx.classEnrollment.create({
              data: {
                studentProfileId: profile.id,
                classId: classRecord.id,
                ...autoApprovalData,
              },
              include: { class: true },
            });
        return {
          kind: existingEnrollment ? matchesRoster ? "autoApproved" : "resubmitted" : "created",
          enrollment,
          status: enrollment.status,
          message: existingEnrollment
            ? matchesRoster
              ? "Your request was approved automatically because your student ID matches the class list."
              : "Your request was resubmitted for instructor approval."
            : matchesRoster
              ? "You joined the class."
              : "Waiting for instructor approval.",
        };
      });
      if (joinResult.kind === "created") {
        queueEmail(buildJoinEmail({
          studentName: profile.name,
          studentEmail: profile.email,
          classSectionName: classRecord.sectionName,
          classCode: classRecord.classCode,
          status: joinResult.enrollment.status,
          facultyName: classRecord.faculty?.name,
        }), "join confirmation");
        if (classRecord.faculty?.email) {
          queueEmail(buildFacultyJoinEmail({
            facultyEmail: classRecord.faculty.email,
            facultyName: classRecord.faculty.name,
            studentName: profile.name,
            classSectionName: classRecord.sectionName,
            classCode: classRecord.classCode,
            status: joinResult.enrollment.status,
          }), "faculty join notice");
        }
      } else if (joinResult.kind === "autoApproved" && profile.email) {
        queueEmail(buildDecisionEmail({
          studentName: profile.name,
          studentEmail: profile.email,
          classSectionName: classRecord.sectionName,
          decision: "APPROVED",
          facultyName: classRecord.faculty?.name,
        }), "automatic join approval");
      }
      const statusCode = joinResult.kind === "existing" ? 409 : 201;
      return res.status(statusCode).json(joinResult);
    } catch (error) {
      if (error.code === "P2002") {
        const existing = await prisma.classEnrollment.findUnique({
          where: { studentProfileId_classId: { studentProfileId: profile.id, classId: classRecord.id } },
          include: { class: true },
        }).catch(() => null);
        if (existing) {
          return res.status(409).json({
            message: existing.status === "PENDING" ? "Your request is already waiting for instructor approval." : "You have already joined this class.",
            enrollment: existing,
            status: existing.status,
          });
        }
      }
      console.error("Class join failed:", error);
      return res.status(500).json({ message: "Unable to join that class." });
    }
  },
);

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`ClassDex API running on http://localhost:${PORT}`);
  });
}

module.exports = { app, resetRateLimitersForTests };
