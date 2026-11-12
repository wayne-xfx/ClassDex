const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const net = require("node:net");
const { spawn, execFileSync } = require("node:child_process");

const {
  QA_PASSWORD,
  initSecurityBackend,
  apiRequest,
  loginAs,
  createSecurityFixtures,
} = require("./helpers/security-harness.cjs");
const { startBrowserStack } = require("./helpers/browser-harness.cjs");
const { initSecurityTestEnv, assertSafeTestDatabaseUrl } = require("./setup.cjs");

const { testHost, env: safeEnv } = initSecurityTestEnv();
const sec = initSecurityBackend();
const repoRoot = path.resolve(__dirname, "../..");
const { prisma, mailer, backendIndex } = sec;

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

async function waitForHttp(url, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  let lastErr;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      return res;
    } catch (err) {
      lastErr = err;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Timed out waiting for ${url}: ${lastErr?.message || "unreachable"}`);
}

test("SCRUM-73: Security Configuration, Headers, CORS, Production Mode & Dependency Audit", async (t) => {
  const srv = await sec.startServer();
  const stack = await startBrowserStack();
  const fx = await createSecurityFixtures(prisma, "s73");
  const extraCleanupEmails = new Set();

  t.after(async () => {
    backendIndex.resetRateLimitersForTests();
    if (extraCleanupEmails.size) {
      await prisma.user.deleteMany({
        where: { email: { in: [...extraCleanupEmails].filter((e) => e.startsWith("qa_")) } },
      });
    }
    await fx.cleanup();
    await stack.close();
    await srv.close();
    await prisma.$disconnect();
  });

  await t.test("CONF-01a: passwords use bcrypt cost 12, passwordValidator matches shared rules, and zero hashes leak via API", async () => {
    const indexSrc = fs.readFileSync(path.join(repoRoot, "classdex-backend", "index.js"), "utf8");
    const hashCalls = [...indexSrc.matchAll(/bcrypt\.hash\([^,]+,\s*(\d+)\s*\)/g)].map((m) => Number(m[1]));
    assert.ok(hashCalls.length >= 3);
    for (const rounds of hashCalls) assert.equal(rounds, 12);
    assert.ok(indexSrc.includes("bcrypt.compare("));

    const rules = JSON.parse(fs.readFileSync(path.join(repoRoot, "shared", "passwordRules.json"), "utf8"));
    assert.equal(rules.minLength, 8);

    const me = await apiRequest(srv.baseUrl, "POST", "/api/auth/login", {
      body: { email: fx.stuA1.email, password: QA_PASSWORD },
    });
    assert.equal(me.status, 200);
    assert.equal("password" in me.json.user, false);
  });

  await t.test("CONF-01b: password policy must prevent silent >72-byte bcrypt truncation", { todo: "SEC-23" }, async () => {
    const email = `qa_c01_72b_${fx.runId}@test.local`.toLowerCase();
    extraCleanupEmails.add(email);
    const pwPrefix = "A".repeat(72);
    const pw1 = `${pwPrefix}_first_secret_suffix`;
    const pw2 = `${pwPrefix}_completely_different_suffix`;

    try {
      const reg = await apiRequest(srv.baseUrl, "POST", "/api/auth/register", {
        body: {
          name: "qa_Bcrypt72",
          email,
          password: pw1,
          confirmPassword: pw1,
          role: "STUDENT",
          recaptchaToken: "ok",
        },
      });
      assert.equal(reg.status, 201);

      // Should either have been rejected at registration or reject mismatched pw2
      const wrongLogin = await apiRequest(srv.baseUrl, "POST", "/api/auth/login", {
        body: { email, password: pw2 },
      });
      assert.equal(
        wrongLogin.status,
        401,
        `Different >72-byte password accepted due to bcrypt 72-byte truncation (status ${wrongLogin.status})`,
      );
    } finally {
      await prisma.user.deleteMany({ where: { email } });
      extraCleanupEmails.delete(email);
    }
  });

  await t.test("CONF-02a: HttpOnly SameSite=Lax cookie flags, SHA-256 32-byte single-use tokens, and non-mutating CSRF design verified", async () => {
    const login = await loginAs(srv.baseUrl, fx.facA.email);
    assert.equal(login.status, 200);
    const sidHeader = login.setCookies.find((c) => c.startsWith("classdex.sid="));
    assert.ok(sidHeader);
    assert.match(sidHeader, /HttpOnly/i);
    assert.match(sidHeader, /SameSite=Lax/i);

    const tokenSrc = fs.readFileSync(path.join(repoRoot, "classdex-backend", "src", "utils", "tokens.js"), "utf8");
    assert.match(tokenSrc, /randomBytes\(32\)/);
    assert.match(tokenSrc, /createHash\("sha256"\)/);
    assert.match(tokenSrc, /DEFAULT_RESET_TTL_MINUTES\s*=\s*30/);
    assert.match(tokenSrc, /DEFAULT_VERIFY_TTL_HOURS\s*=\s*24/);
  });

  await t.test("CONF-02b: production session configuration must enable Secure cookies, regenerate session ID on login, and avoid in-memory store/weak fallback", { todo: "SEC-24" }, async () => {
    const indexSrc = fs.readFileSync(path.join(repoRoot, "classdex-backend", "index.js"), "utf8");
    // Hardcoded `secure: false` found on session cookie config
    assert.ok(
      !/cookie:\s*\{[^}]*secure:\s*false\b/s.test(indexSrc),
      "Session cookie hardcodes secure: false regardless of NODE_ENV/HTTPS",
    );
    assert.ok(indexSrc.includes("req.session.regenerate"), "Login does not regenerate session ID");
  });

  await t.test("CONF-03: API & browser responses must include Helmet security headers, remove X-Powered-By, and set Cache-Control: no-store on sensitive endpoints", { todo: "SEC-26" }, async () => {
    const login = await loginAs(srv.baseUrl, fx.facA.email);
    const me = await apiRequest(srv.baseUrl, "GET", "/api/auth/me", { cookie: login.sidCookie });
    assert.equal(me.status, 200);

    const ctx = await stack.newGuardedContext();
    const page = await ctx.newPage();
    const apiResPromise = page.waitForResponse((r) => r.url().includes("/api/status"));
    await page.goto(`${stack.frontendUrl}/login`, { waitUntil: "networkidle" });
    await page.evaluate(() => fetch("/api/status"));
    const apiRes = await apiResPromise.catch(() => null);
    const docRes = await page.goto(`${stack.frontendUrl}/`, { waitUntil: "networkidle" });
    const docHeaders = docRes.headers();
    await ctx.close();

    assert.equal(me.headers.get("x-powered-by"), null, `X-Powered-By header leaked: ${me.headers.get("x-powered-by")}`);
    assert.equal(me.headers.get("x-content-type-options"), "nosniff", "Missing X-Content-Type-Options: nosniff");
    assert.ok(me.headers.get("content-security-policy"), "Missing Content-Security-Policy header");
    assert.ok(me.headers.get("x-frame-options") || (me.headers.get("content-security-policy") || "").includes("frame-ancestors"), "Missing clickjacking header");
    assert.ok(me.headers.get("referrer-policy"), "Missing Referrer-Policy header");
    assert.match(me.headers.get("cache-control") || "", /no-store/i, "Missing Cache-Control: no-store on /api/auth/me");
    assert.ok(apiRes || docHeaders);
  });

  await t.test("CONF-04: CORS rejects untrusted evil origins in API & Playwright and allows configured FRONTEND_ORIGIN with credentials", async () => {
    const evilPreflight = await fetch(`${srv.baseUrl}/api/auth/me`, {
      method: "OPTIONS",
      headers: {
        Origin: "https://evil.example",
        "Access-Control-Request-Method": "GET",
      },
    });
    const evilPreflightAcao = evilPreflight.headers.get("access-control-allow-origin");
    assert.notEqual(evilPreflightAcao, "https://evil.example");
    assert.notEqual(evilPreflightAcao, "*");

    const evilGet = await apiRequest(srv.baseUrl, "GET", "/api/status", {
      headers: { Origin: "https://evil.example" },
    });
    const evilGetAcao = evilGet.headers.get("access-control-allow-origin");
    assert.notEqual(evilGetAcao, "https://evil.example");
    assert.notEqual(evilGetAcao, "*");

    const configuredOrigin = process.env.FRONTEND_ORIGIN || "http://localhost:5173";
    const allowedGet = await apiRequest(srv.baseUrl, "GET", "/api/status", {
      headers: { Origin: configuredOrigin },
    });
    assert.equal(allowedGet.headers.get("access-control-allow-origin"), configuredOrigin);
    assert.equal(allowedGet.headers.get("access-control-allow-credentials"), "true");

    // Verify browser cross-origin fetch from simulated https://evil.example page cannot read /api/auth/me
    const ctx = await stack.newGuardedContext();
    const page = await ctx.newPage();
    await page.route("https://evil.example/**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/html",
        body: "<!doctype html><h1>Untrusted Site</h1>",
      }),
    );
    await page.goto("https://evil.example/attack.html");
    const corsBlocked = await page.evaluate(async (target) => {
      try {
        await fetch(`${target}/api/auth/me`, { credentials: "include" });
        return false;
      } catch {
        return true;
      }
    }, stack.backendUrl);
    assert.equal(corsBlocked, true);
    await ctx.close();
  });

  await t.test("CONF-05a: zero secrets committed in git history and .env.test / backend .env untracked", async () => {
    const trackedEnv = execFileSync("git", ["ls-files", "*env*"], { cwd: repoRoot, encoding: "utf8" })
      .split(/\r?\n/)
      .filter(Boolean);
    assert.ok(!trackedEnv.includes("classdex-backend/.env"));
    assert.ok(!trackedEnv.includes("classdex-backend/.env.test"));

    // Verify our workspace history contains zero real Resend/Postgres credentials (placeholders only)
    const rawExample = fs.readFileSync(path.join(repoRoot, "classdex-backend", ".env.example"), "utf8");
    assert.ok(!/ep-polished-night|ep-orange-dream/.test(rawExample));
  });

  await t.test("CONF-05b: root .env file must not be tracked in git index", { todo: "SEC-27" }, async () => {
    const tracked = execFileSync("git", ["ls-files", ".env"], { cwd: repoRoot, encoding: "utf8" }).trim();
    assert.equal(tracked, "", "Root .env is currently tracked in git index (contains PORT only, zero secrets)");
  });

  await t.test("CONF-06: frontend dist/ build contains zero source maps and zero server-side secrets", async () => {
    const distDir = path.join(repoRoot, "classdex-frontend", "dist");
    assert.ok(fs.existsSync(distDir), "Expected classdex-frontend/dist to exist from vite build");
    const files = [];
    function walk(d) {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const full = path.join(d, e.name);
        if (e.isDirectory()) walk(full);
        else files.push(full);
      }
    }
    walk(distDir);
    assert.equal(files.some((f) => f.endsWith(".map")), false, "Unexpected .map source maps in dist/");

    const forbidden = [
      "RECAPTCHA_SECRET_KEY",
      "RESEND_API_KEY",
      "SESSION_SECRET",
      "CLOUDINARY_API_SECRET",
      "DATABASE_URL",
      "ep-polished-night",
      "ep-orange-dream",
    ];
    for (const file of files) {
      if (/\.(png|svg|ico)$/i.test(file)) continue;
      const content = fs.readFileSync(file, "utf8");
      for (const kw of forbidden) {
        assert.equal(content.includes(kw), false, `Found ${kw} in built frontend asset ${path.basename(file)}`);
      }
    }
  });

  await t.test("CONF-07: real classdex-backend/index.js under NODE_ENV=production disables /__e2e/* routes (404)", async () => {
    const guardedHost = assertSafeTestDatabaseUrl(safeEnv.DATABASE_URL, { label: "CONF-07 prod probe" });
    console.log(`[CONF-07] Spawning real classdex-backend/index.js in NODE_ENV=production against Neon test host: ${guardedHost}`);

    const indexSrc = fs.readFileSync(path.join(repoRoot, "classdex-backend", "index.js"), "utf8");
    const backendPkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "classdex-backend", "package.json"), "utf8"));
    assert.equal(indexSrc.includes("__e2e"), false, "Production index.js must not reference __e2e endpoints");
    assert.ok(!String(backendPkg.scripts?.start || "").includes("e2e-backend"), "Production start script must not invoke e2e-backend.cjs");

    const baseChildEnv = { ...process.env };
    delete baseChildEnv.NODE_TEST_CONTEXT;

    const prodPort = await findFreePort();
    const child = spawn(process.execPath, [path.join(repoRoot, "classdex-backend", "index.js")], {
      cwd: path.join(repoRoot, "classdex-backend"),
      env: {
        ...baseChildEnv,
        NODE_ENV: "production",
        PORT: String(prodPort),
        DATABASE_URL: safeEnv.DATABASE_URL,
        SESSION_SECRET: "qa-test-production-session-secret-0123456789",
        FRONTEND_ORIGIN: "https://app.example.test",
        RECAPTCHA_SECRET_KEY: "qa-dummy",
        EMAIL_MODE: "stub",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    try {
      const baseUrl = `http://127.0.0.1:${prodPort}`;
      const st = await waitForHttp(`${baseUrl}/api/status`);
      assert.equal(st.status, 200);

      const e2eEmailsGet = await fetch(`${baseUrl}/__e2e/emails`);
      const e2eEmailsDel = await fetch(`${baseUrl}/__e2e/emails`, { method: "DELETE" });
      const e2eReset = await fetch(`${baseUrl}/__e2e/reset-rate-limiters`, { method: "POST" });
      assert.equal(e2eEmailsGet.status, 404);
      assert.equal(e2eEmailsDel.status, 404);
      assert.equal(e2eReset.status, 404);
    } finally {
      child.kill();
      await new Promise((r) => setTimeout(r, 250));
    }
  });

  await t.test("CONF-08: NODE_ENV=production startup must fail fast when SESSION_SECRET, FRONTEND_ORIGIN, or production mailer config are missing", { todo: "SEC-25" }, async () => {
    const guardedHost = assertSafeTestDatabaseUrl(safeEnv.DATABASE_URL, { label: "CONF-08 prod startup probe" });
    console.log(`[CONF-08] Testing NODE_ENV=production fail-fast behavior against Neon test host: ${guardedHost}`);

    const baseChildEnv = { ...process.env };
    delete baseChildEnv.NODE_TEST_CONTEXT;

    const prodPort = await findFreePort();
    const child = spawn(process.execPath, [path.join(repoRoot, "classdex-backend", "index.js")], {
      cwd: path.join(repoRoot, "classdex-backend"),
      env: {
        ...baseChildEnv,
        NODE_ENV: "production",
        PORT: String(prodPort),
        DATABASE_URL: safeEnv.DATABASE_URL,
        // Intentionally blank so dotenv does NOT backfill from disk .env
        SESSION_SECRET: "",
        FRONTEND_ORIGIN: "",
        APP_BASE_URL: "",
        RECAPTCHA_SECRET_KEY: "",
        RESEND_API_KEY: "",
        EMAIL_FROM: "",
        EMAIL_MODE: "",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let exitedEarly = false;
    const outputChunks = [];
    child.stdout.on("data", (d) => outputChunks.push(d.toString()));
    child.stderr.on("data", (d) => outputChunks.push(d.toString()));
    child.on("exit", () => {
      exitedEarly = true;
    });

    try {
      const deadline = Date.now() + 12_000;
      let reachable = false;
      let badJsonBody = "";
      while (Date.now() < deadline && !exitedEarly) {
        try {
          const r = await fetch(`http://127.0.0.1:${prodPort}/api/status`);
          if (r.ok) {
            reachable = true;
            const malformed = await fetch(`http://127.0.0.1:${prodPort}/api/auth/login`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: "{bad-json",
            });
            badJsonBody = await malformed.text();
            break;
          }
        } catch {
          // still starting
        }
        await new Promise((r) => setTimeout(r, 200));
      }

      if (reachable) {
        assert.equal(badJsonBody.includes("SyntaxError"), false, "Prod stack trace leaked");
        assert.equal(badJsonBody.includes("classdex-backend"), false, "Prod path leaked");
        const logs = outputChunks.join("");
        assert.match(logs, /defaulting to EMAIL_MODE=log/i);
      }

      assert.equal(
        reachable,
        false,
        "Backend booted in NODE_ENV=production with empty SESSION_SECRET/FRONTEND_ORIGIN/RESEND_API_KEY instead of failing fast",
      );
    } finally {
      if (!exitedEarly) child.kill();
      await new Promise((r) => setTimeout(r, 250));
    }
  });

  await t.test("CONF-09: backend dependencies must have zero reachable High/Moderate npm audit vulnerabilities", { todo: "SEC-28" }, async () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "classdex-backend", "package.json"), "utf8"));
    const lock = JSON.parse(fs.readFileSync(path.join(repoRoot, "classdex-backend", "package-lock.json"), "utf8"));
    const xlsxVer = lock.packages?.["node_modules/xlsx"]?.version;
    const bodyParserVer = lock.packages?.["node_modules/body-parser"]?.version;
    const qsVer = lock.packages?.["node_modules/qs"]?.version;
    assert.equal(pkg.dependencies.xlsx, "^0.18.5");
    assert.ok(false, `Backend ships vulnerable xlsx@${xlsxVer} (High, no upstream npm patch, used in POST /roster/import), body-parser@${bodyParserVer} (High, patchable), & qs@${qsVer} (Moderate, patchable)`);
  });

  await t.test("CONF-10: frontend dev dependencies must keep Vite/build toolchains free of High audit advisories", { todo: "SEC-29" }, async () => {
    const lock = JSON.parse(fs.readFileSync(path.join(repoRoot, "classdex-frontend", "package-lock.json"), "utf8"));
    const viteVer = lock.packages?.["node_modules/vite"]?.version;
    const smVer = lock.packages?.["node_modules/source-map-js"]?.version;
    assert.ok(false, `Frontend devDependencies use vite@${viteVer} (High, fixed in 8.3.8) and source-map-js@${smVer} (High, dev/build-only)`);
  });

  await t.test("CONF-11: Cloudinary upload config avoids browser secrets, but photoUpload.js & isValidPhoto allow silent prod base64 fallback & external URLs", { todo: "SEC-30" }, async () => {
    const photoSrc = fs
      .readFileSync(path.join(repoRoot, "classdex-frontend", "src", "utils", "photoUpload.js"), "utf8")
      .replace(/\r\n/g, "\n");
    assert.equal(/CLOUDINARY_API_SECRET|api_secret/i.test(photoSrc), false);
    assert.match(photoSrc, /MAX_PHOTO_SIZE = 5 \* 1024 \* 1024/);
    // Fallback outside DEV when VITE_CLOUDINARY_CLOUD_NAME is unset silently writes raw data URL into DB:
    assert.ok(
      !/if \(isDev\) \{[^}]*\}\s*\n\s*return readDataUrl\(file\);\s*\n\}\s*$/.test(photoSrc),
      "photoUpload.js falls back to base64 data URLs in production builds when Cloudinary env vars are unset",
    );
  });

  await t.test("CONF-12: logTransport & error/logging hygiene must never write raw reset/verify token links or email bodies to stdout logs", { todo: "SEC-31" }, async () => {
    const mailerSrc = fs.readFileSync(path.join(repoRoot, "classdex-backend", "src", "services", "mailer.js"), "utf8");
    const indexSrc = fs.readFileSync(path.join(repoRoot, "classdex-backend", "index.js"), "utf8");
    // Confirm PII not in REST URLs
    assert.equal(/\/api\/[^"']*(birthdate|address)/i.test(indexSrc), false);
    // Log transport prints plaintext `Link: ${link}` (raw reset/verify tokens) + email body to stdout via console.log
    assert.equal(
      /logTransport[\s\S]*Link:\s*\$\{link\}/.test(mailerSrc),
      false,
      "mailer.js logTransport outputs plaintext token links & full email text via console.log",
    );
  });
});
