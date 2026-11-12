const net = require("node:net");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { chromium } = require("@playwright/test");
const { initSecurityTestEnv } = require("../setup.cjs");

function findFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close((err) => (err ? reject(err) : resolve(port)));
    });
  });
}

async function waitForHttpOk(url, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  let lastErr;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok || res.status < 500) return;
      lastErr = new Error(`HTTP ${res.status}`);
    } catch (err) {
      lastErr = err;
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`Timed out waiting for ${url}: ${lastErr?.message || "unreachable"}`);
}

function isLocalhostUrl(urlStr) {
  try {
    const parsed = new URL(urlStr);
    if (parsed.protocol === "data:" || parsed.protocol === "blob:" || parsed.protocol === "about:") {
      return true;
    }
    return (
      parsed.hostname === "127.0.0.1" ||
      parsed.hostname === "localhost" ||
      parsed.hostname === "::1"
    );
  } catch {
    return false;
  }
}

async function startBrowserStack({ production = false } = {}) {
  const { repoRoot, testHost, env: safeEnv } = initSecurityTestEnv();
  const backendPort = await findFreePort();
  const frontendPort = await findFreePort();
  const frontendUrl = `http://localhost:${frontendPort}`;
  const backendUrl = `http://127.0.0.1:${backendPort}`;

  const backendArgs = [
    path.join(repoRoot, "tests", "scripts", "start-test-backend.cjs"),
    `--port=${backendPort}`,
    ...(production ? ["--production"] : []),
  ];

  const backendLogs = [];
  const backendChild = spawn(process.execPath, backendArgs, {
    cwd: repoRoot,
    env: {
      ...process.env,
      ...safeEnv,
      NODE_ENV: production ? "production" : "test",
      EMAIL_MODE: "stub",
      FRONTEND_ORIGIN: frontendUrl,
      APP_BASE_URL: frontendUrl,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  backendChild.stdout.on("data", (d) => backendLogs.push(d.toString()));
  backendChild.stderr.on("data", (d) => backendLogs.push(d.toString()));

  const viteBin = path.join(repoRoot, "classdex-frontend", "node_modules", "vite", "bin", "vite.js");
  const viteConfig = path.join(repoRoot, "tests", "e2e", "support", "vite.e2e.config.mjs");

  const frontendChild = spawn(
    process.execPath,
    [viteBin, "--config", viteConfig, "--port", String(frontendPort), "--strictPort"],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
        ...safeEnv,
        EMAIL_MODE: "stub",
        E2E_BACKEND_PORT: String(backendPort),
        VITE_RECAPTCHA_SITE_KEY: "qa-stub-site-key",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  let browser;
  try {
    await Promise.all([
      waitForHttpOk(`${backendUrl}/api/status`),
      waitForHttpOk(frontendUrl),
    ]);
    browser = await chromium.launch({ headless: true });
  } catch (err) {
    try { backendChild.kill(); } catch {}
    try { frontendChild.kill(); } catch {}
    if (browser) await browser.close().catch(() => {});
    throw err;
  }

  return {
    testHost,
    backendPort,
    frontendPort,
    backendUrl,
    frontendUrl,
    browser,
    getBackendLogs() {
      return backendLogs.join("");
    },
    async newGuardedContext(extraOptions = {}) {
      const context = await browser.newContext({
        baseURL: frontendUrl,
        ...extraOptions,
      });
      await context.route("**/*", async (route) => {
        const reqUrl = route.request().url();
        if (isLocalhostUrl(reqUrl)) {
          return route.continue();
        }
        if (/google\.com\/recaptcha\/api\.js/i.test(reqUrl)) {
          return route.fulfill({
            status: 200,
            contentType: "application/javascript",
            body: `
              window.grecaptcha = {
                render: function() { return 0; },
                reset: function() {},
                execute: function() {}
              };
              if (typeof window.__classDexRecaptchaReady === "function") {
                window.__classDexRecaptchaReady();
              }
            `,
          });
        }
        return route.abort();
      });
      return context;
    },
    async close() {
      await browser?.close().catch(() => {});
      try { frontendChild.kill(); } catch {}
      try { backendChild.kill(); } catch {}
      await new Promise((r) => setTimeout(r, 300));
    },
  };
}

module.exports = {
  startBrowserStack,
};
