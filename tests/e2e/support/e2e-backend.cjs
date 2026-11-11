const dns = require("node:dns");
dns.setDefaultResultOrder("ipv4first");

const http = require("node:http");
const { loadBackendTestEnv } = require("../../scripts/load-test-env.cjs");

const { testHost } = loadBackendTestEnv();

const E2E_PORT = Number(process.env.E2E_BACKEND_PORT || 5051);
const E2E_FRONTEND_PORT = Number(process.env.E2E_FRONTEND_PORT || 5174);

process.env.PORT = String(E2E_PORT);
process.env.FRONTEND_ORIGIN = `http://localhost:${E2E_FRONTEND_PORT}`;
process.env.APP_BASE_URL = `http://localhost:${E2E_FRONTEND_PORT}`;
process.env.EMAIL_MODE = "stub";
process.env.NODE_ENV = "test";
process.env.RECAPTCHA_SECRET_KEY =
  process.env.E2E_RECAPTCHA_SECRET_KEY || "6LeIxAcTAAAAAGG-vFI1TnRWxMZNFuojJ4WifJWe";

const { prisma } = require("../../../classdex-backend/db");
const {
  app,
  resetRateLimitersForTests,
} = require("../../../classdex-backend/index.js");
const {
  getStubEmails,
  clearStubEmails,
  validateMailerConfig,
} = require("../../../classdex-backend/src/services/mailer");

const server = http.createServer((req, res) => {
  const reqUrl = new URL(req.url || "/", `http://127.0.0.1:${E2E_PORT}`);
  if (reqUrl.pathname === "/__e2e/emails" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ emails: getStubEmails() }));
    return;
  }
  if (reqUrl.pathname === "/__e2e/emails" && req.method === "DELETE") {
    clearStubEmails();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ cleared: true }));
    return;
  }
  if (reqUrl.pathname === "/__e2e/reset-rate-limiters" && req.method === "POST") {
    resetRateLimitersForTests();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ reset: true }));
    return;
  }
  return app(req, res);
});

async function warmDatabase() {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await prisma.$queryRawUnsafe("SELECT 1");
      return;
    } catch (error) {
      if (attempt === 3) {
        console.warn("[ClassDex E2E Backend] DB warmup warning:", error?.message || error);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
    }
  }
}

warmDatabase().finally(() => {
  server.listen(E2E_PORT, "127.0.0.1", () => {
    const mailerStatus = validateMailerConfig();
    console.log(
      `[ClassDex E2E Backend] Listening on http://127.0.0.1:${E2E_PORT} (DB host: ${testHost}, EMAIL_MODE=${mailerStatus.mode})`,
    );
  });
});
