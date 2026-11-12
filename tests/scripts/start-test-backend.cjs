const dns = require("node:dns");
dns.setDefaultResultOrder("ipv4first");

const { mock } = require("node:test");
const {
  ALLOWED_TEST_DB_HOST_MARKER,
  assertSafeTestDatabaseUrl,
  loadBackendTestEnv,
} = require("./load-test-env.cjs");

const args = process.argv.slice(2);
const prodModeFlag = args.includes("--production") || process.env.NODE_ENV === "production";
const checkOnlyFlag = args.includes("--check-only");
const portArg = args.find((a) => a.startsWith("--port="));

if (prodModeFlag) {
  process.env.NODE_ENV = "production";
}

const { testHost } = loadBackendTestEnv({ preserveNodeEnv: true });
if (prodModeFlag) {
  if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.trim().length < 32 || process.env.SESSION_SECRET.trim() === "classdex-dev-session-secret") {
    process.env.SESSION_SECRET = "classdex-test-harness-prod-secret-0123456789abcdef";
  }
  if (!process.env.FRONTEND_ORIGIN) {
    process.env.FRONTEND_ORIGIN = "http://localhost:5173";
  }
  if (!process.env.APP_BASE_URL) {
    process.env.APP_BASE_URL = process.env.FRONTEND_ORIGIN;
  }
  if (!process.env.RECAPTCHA_SECRET_KEY) {
    process.env.RECAPTCHA_SECRET_KEY = "qa-test-harness-recaptcha";
  }
}
const confirmedHost = assertSafeTestDatabaseUrl(process.env.DATABASE_URL, {
  label: "active process.env.DATABASE_URL",
});
if (!confirmedHost.toLowerCase().includes(ALLOWED_TEST_DB_HOST_MARKER)) {
  throw new Error(
    `Refusing to start test backend: host (${confirmedHost}) is not allowlisted (${ALLOWED_TEST_DB_HOST_MARKER}).`,
  );
}

const parsedPort = portArg ? Number(portArg.split("=")[1]) : Number(process.env.PORT || 5052);
const LISTEN_PORT = Number.isInteger(parsedPort) && parsedPort >= 0 ? parsedPort : 5052;
process.env.PORT = String(LISTEN_PORT);
process.env.EMAIL_MODE = "stub";

if (checkOnlyFlag) {
  console.log(
    `[ClassDex Test Backend Guard] Verified NODE_ENV=${process.env.NODE_ENV} | DB host: ${confirmedHost} | EMAIL_MODE=${process.env.EMAIL_MODE}`,
  );
  process.exit(0);
}

// Stub reCAPTCHA & forbid unintended third-party network calls before loading app
const recaptcha = require("../../classdex-backend/recaptcha");
mock.method(recaptcha, "verifyRecaptchaToken", async (token) => {
  if (!token || token === "bad-captcha") {
    return { success: false, message: "Captcha verification failed." };
  }
  return { success: true };
});

const { app } = require("../../classdex-backend/index");
const { prisma } = require("../../classdex-backend/db");
const { validateMailerConfig } = require("../../classdex-backend/src/services/mailer");

prisma
  .$queryRawUnsafe("SELECT 1")
  .catch((err) => {
    console.warn("[ClassDex Test Backend] DB warmup warning:", err?.message || err);
  })
  .finally(() => {
    const server = app.listen(LISTEN_PORT, "127.0.0.1", () => {
      const actualPort = server.address()?.port ?? LISTEN_PORT;
      const mailerMode = prodModeFlag ? (process.env.EMAIL_MODE || "stub") : validateMailerConfig().mode;
      console.log(
        `[ClassDex Test Backend] Listening on http://127.0.0.1:${actualPort} (NODE_ENV=${process.env.NODE_ENV}, DB host: ${testHost}, EMAIL_MODE=${mailerMode})`,
      );
    });
    process.on("SIGTERM", () => server.close(() => process.exit(0)));
    process.on("SIGINT", () => server.close(() => process.exit(0)));
  });
