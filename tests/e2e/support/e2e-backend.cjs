const http = require("node:http");
const path = require("node:path");
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

const {
  app,
  resetRateLimitersForTests,
} = require("../../../classdex-backend/index.js");
const {
  getStubEmails,
  clearStubEmails,
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

server.listen(E2E_PORT, "127.0.0.1", () => {
  console.log(
    `[ClassDex E2E Backend] Listening on http://127.0.0.1:${E2E_PORT} (DB host: ${testHost}, EMAIL_MODE=${process.env.EMAIL_MODE})`,
  );
});
