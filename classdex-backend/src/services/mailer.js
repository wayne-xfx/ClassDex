require("dotenv").config();
const { Resend } = require("resend");

const DELIMITER = "=".repeat(72);
const SUB_DELIMITER = "-".repeat(72);

function isRunningUnderTestRunner() {
  return Boolean(
    process.env.NODE_ENV === "test" ||
      process.env.NODE_TEST_CONTEXT ||
      process.execArgv.some((arg) => arg === "--test" || arg.startsWith("--test-")) ||
      process.argv.some(
        (arg) =>
          arg === "--test" ||
          arg.startsWith("--test-") ||
          /[\\/]test[\\/][^\\/]+\.test\.js$/i.test(arg),
      ),
  );
}

const IS_TEST_RUNNER = isRunningUnderTestRunner();

// Protect test runs from accidentally inheriting EMAIL_MODE=resend from .env.
// Setting to "" instead of deleting prevents subsequent dotenv.config() calls
// in other test files from re-populating EMAIL_MODE="resend" from disk.
if (IS_TEST_RUNNER) {
  process.env.EMAIL_MODE = "";
}

let customTestTransport = null;
let customResendClient = null;
let cachedResendClient = null;
let cachedResendApiKey = null;
let hasLoggedFallbackWarning = false;
const stubEmails = [];

function getClientUrl() {
  const candidates = [
    process.env.APP_BASE_URL,
    process.env.FRONTEND_URL,
    process.env.CLIENT_URL,
    process.env.FRONTEND_ORIGIN,
  ];
  for (const candidate of candidates) {
    const cleaned = String(candidate || "").trim().replace(/\/+$/, "");
    if (cleaned) {
      return cleaned;
    }
  }
  if (process.env.NODE_ENV === "production" && !isRunningUnderTestRunner()) {
    throw new Error("[ClassDex Mailer] APP_BASE_URL or FRONTEND_ORIGIN is required in production.");
  }
  return "http://localhost:5173";
}

function getEmailFrom() {
  const configured = String(process.env.EMAIL_FROM || "").trim();
  return configured || "ClassDex <no-reply@classdex.local>";
}

function isValidResendEmailFrom(fromValue) {
  const trimmed = String(fromValue || "").trim();
  if (!trimmed) return false;
  if (/@classdex\.local\b|\.local\b/i.test(trimmed)) return false;
  return /[^\s<>]+@[^\s<>]+\.[^\s<>]+/.test(trimmed);
}

function hasValidResendCredentials() {
  const apiKey = String(process.env.RESEND_API_KEY || "").trim();
  const emailFrom = String(process.env.EMAIL_FROM || "").trim();
  return Boolean(apiKey && isValidResendEmailFrom(emailFrom));
}

function extractPrimaryLink(text, html) {
  const source = `${text || ""}\n${html || ""}`;
  const match = source.match(/https?:\/\/[^\s"'<>]+/i);
  return match ? match[0] : null;
}

function resolveEmailMode({ ignoreTestRunner = false } = {}) {
  const explicit = String(process.env.EMAIL_MODE || "").trim().toLowerCase();
  if (explicit === "stub" || explicit === "log" || explicit === "resend") {
    return explicit;
  }

  const inTest = !ignoreTestRunner && isRunningUnderTestRunner();
  if (inTest) {
    return "stub";
  }

  if (hasValidResendCredentials()) {
    return "resend";
  }

  if (!hasLoggedFallbackWarning) {
    hasLoggedFallbackWarning = true;
    console.warn(
      "[ClassDex Mailer] RESEND_API_KEY/EMAIL_FROM not fully configured; defaulting to EMAIL_MODE=log.",
    );
  }
  return "log";
}

function validateMailerConfig(options = {}) {
  const explicit = String(process.env.EMAIL_MODE || "").trim().toLowerCase();
  if (explicit && !["resend", "log", "stub"].includes(explicit)) {
    throw new Error(
      `[ClassDex Mailer] Invalid EMAIL_MODE="${explicit}". Expected "resend", "log", or "stub".`,
    );
  }

  const isProduction = process.env.NODE_ENV === "production" && !options.ignoreProductionGuard;
  if (isProduction && (explicit === "log" || explicit === "stub" || !explicit)) {
    if (explicit === "log" || explicit === "stub") {
      throw new Error(
        `[ClassDex Mailer] NODE_ENV=production forbids EMAIL_MODE="${explicit}". Configure EMAIL_MODE="resend" with RESEND_API_KEY and a verified EMAIL_FROM.`,
      );
    }
    if (!hasValidResendCredentials()) {
      throw new Error(
        "[ClassDex Mailer] NODE_ENV=production requires RESEND_API_KEY and a verified non-local EMAIL_FROM (cannot fall back to log mode).",
      );
    }
  }

  if (explicit === "resend" || isProduction) {
    const apiKey = String(process.env.RESEND_API_KEY || "").trim();
    const emailFrom = String(process.env.EMAIL_FROM || "").trim();
    if (!apiKey) {
      throw new Error(
        "[ClassDex Mailer] EMAIL_MODE=resend requires RESEND_API_KEY to be set in .env.",
      );
    }
    if (!isValidResendEmailFrom(emailFrom)) {
      throw new Error(
        "[ClassDex Mailer] EMAIL_MODE=resend requires a valid verified EMAIL_FROM address (e.g., \"ClassDex <no-reply@classdex.me>\", not @classdex.local).",
      );
    }
    return { mode: "resend", from: emailFrom };
  }

  const mode = resolveEmailMode(options);
  return { mode, from: getEmailFrom() };
}

function redactLinkToken(link) {
  if (!link) return null;
  return String(link).replace(/([?&](?:token|code)=)[^&\s]+/gi, "$1[REDACTED]");
}

async function logTransport({ to, subject, html, text }) {
  const link = extractPrimaryLink(text, html);
  const safeLink = redactLinkToken(link);
  const lines = [
    "",
    DELIMITER,
    "[ClassDex Dev Mailer]",
    `From:    ${getEmailFrom()}`,
    `To:      ${to}`,
    `Subject: ${subject}`,
    ...(safeLink ? [`Preview: ${safeLink}`] : []),
    DELIMITER,
    "",
  ];
  console.log(lines.join("\n"));
  return { ok: true, transport: "log", link };
}

async function stubTransport({ to, subject, html, text }) {
  const link = extractPrimaryLink(text, html);
  const entry = {
    to,
    from: getEmailFrom(),
    subject,
    html: html || "",
    text: text || "",
    link,
    sentAt: new Date().toISOString(),
  };
  stubEmails.push(entry);
  return { ok: true, transport: "stub", link, email: entry };
}

function getResendClient() {
  if (customResendClient) {
    return customResendClient;
  }
  const apiKey = String(process.env.RESEND_API_KEY || "").trim();
  if (!cachedResendClient || cachedResendApiKey !== apiKey) {
    cachedResendClient = new Resend(apiKey);
    cachedResendApiKey = apiKey;
  }
  return cachedResendClient;
}

function logResendError(to, statusCode, errorName, errorMessage) {
  const normalizedName = String(errorName || "").toLowerCase();
  if (
    statusCode === 403 ||
    normalizedName === "validation_error" ||
    normalizedName === "forbidden"
  ) {
    console.error(
      `[ClassDex Mailer] Resend 403 (${errorName || "forbidden"}): Sender domain is unverified in Resend or recipient "${to}" is restricted in sandbox mode. Details: ${errorMessage}`,
    );
    return;
  }
  if (
    statusCode === 422 ||
    normalizedName === "invalid_parameter" ||
    normalizedName === "unprocessable_entity"
  ) {
    console.error(
      `[ClassDex Mailer] Resend 422 (${errorName || "unprocessable_entity"}): Invalid email payload, recipient, or sender format for "${to}". Details: ${errorMessage}`,
    );
    return;
  }
  if (
    statusCode === 429 ||
    normalizedName === "rate_limit_exceeded" ||
    normalizedName === "daily_quota_exceeded"
  ) {
    console.warn(
      `[ClassDex Mailer] Resend 429 (${errorName || "rate_limit_exceeded"}): Resend free-tier rate or quota limit reached (~100/day, ~3,000/month) while sending to "${to}". Details: ${errorMessage}`,
    );
    return;
  }
  console.error(
    `[ClassDex Mailer] Resend error (${statusCode} ${errorName || "error"}) sending to "${to}": ${errorMessage}`,
  );
}

async function resendTransport({ to, subject, html, text }) {
  const apiKey = String(process.env.RESEND_API_KEY || "").trim();
  const from = String(process.env.EMAIL_FROM || "").trim();

  if (!apiKey || !isValidResendEmailFrom(from)) {
    const msg =
      "Resend transport requires RESEND_API_KEY and a verified non-local EMAIL_FROM address.";
    console.error(`[ClassDex Mailer] ${msg}`);
    return { ok: false, transport: "resend", statusCode: 400, error: msg };
  }

  // Reputation & test safety: never hit live Resend API for @test.local addresses
  if (!customResendClient && /@test\.local$/i.test(String(to || "").trim())) {
    const msg = `Refusing to send live Resend email to reserved test address "${to}".`;
    console.warn(`[ClassDex Mailer] ${msg}`);
    return { ok: false, transport: "resend", statusCode: 422, error: msg };
  }

  const client = getResendClient();
  const response = await client.emails.send({
    from,
    to,
    subject,
    html,
    text,
  });

  const data = response?.data ?? null;
  const error = response?.error ?? null;

  if (error) {
    const statusCode = Number(error.statusCode) || 500;
    const errorMessage = String(error.message || "Resend API error");
    logResendError(to, statusCode, error.name, errorMessage);
    return {
      ok: false,
      transport: "resend",
      statusCode,
      error: errorMessage,
    };
  }

  const messageId = typeof data?.id === "string" ? data.id.trim() : "";
  if (!messageId) {
    const msg = "Resend did not return a non-empty message id.";
    console.error(`[ClassDex Mailer] ${msg}`);
    return {
      ok: false,
      transport: "resend",
      statusCode: 502,
      error: msg,
    };
  }

  return { ok: true, transport: "resend", id: messageId };
}

function resolveTransport() {
  if (customTestTransport) {
    return customTestTransport;
  }

  const explicit = String(process.env.EMAIL_MODE || "").trim().toLowerCase();
  if (
    process.env.NODE_ENV === "production" &&
    ((!explicit && !hasValidResendCredentials()) || explicit === "log")
  ) {
    console.warn(
      "[ClassDex Mailer] Warning: NODE_ENV=production and no valid Resend transport is configured. Skipping email delivery.",
    );
    return async () => ({ ok: false, transport: "none" });
  }

  const mode = resolveEmailMode();
  if (mode === "stub") {
    return stubTransport;
  }
  if (mode === "resend") {
    return resendTransport;
  }
  return logTransport;
}

async function sendMail({ to, subject, html, text }) {
  try {
    if (!to || !subject) {
      throw new Error("sendMail requires 'to' and 'subject'.");
    }
    const transport = resolveTransport();
    return await transport({ to, subject, html, text });
  } catch (error) {
    console.error("[ClassDex Mailer] sendMail failed:", error?.message || error);
    return {
      ok: false,
      transport: String(process.env.EMAIL_MODE || "").trim().toLowerCase() || "unknown",
      statusCode: error?.statusCode || 500,
      error: error?.message || "Mail delivery failed",
    };
  }
}

function setMailTransportForTests(transportFn) {
  customTestTransport = transportFn;
}

function resetMailTransportForTests() {
  customTestTransport = null;
  customResendClient = null;
  hasLoggedFallbackWarning = false;
  if (IS_TEST_RUNNER) {
    process.env.EMAIL_MODE = "";
  }
}

function setResendClientForTests(client) {
  customResendClient = client;
}

function getStubEmails() {
  return [...stubEmails];
}

function clearStubEmails() {
  stubEmails.length = 0;
}

module.exports = {
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
};
