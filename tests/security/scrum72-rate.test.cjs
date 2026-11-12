const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const {
  QA_PASSWORD,
  initSecurityBackend,
  apiRequest,
  loginAs,
  createSecurityFixtures,
} = require("./helpers/security-harness.cjs");

const sec = initSecurityBackend();
const repoRoot = path.resolve(__dirname, "../..");
const { prisma, mailer, backendIndex } = sec;

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

test("SCRUM-72: Rate Limiting, Enumeration Timing, reCAPTCHA Enforcement & Resource Limits", async (t) => {
  const srv = await sec.startServer();
  const fx = await createSecurityFixtures(prisma, "s72");
  const extraCleanupEmails = new Set();

  t.after(async () => {
    backendIndex.resetRateLimitersForTests();
    sec.resetCaptchaHandler();
    sec.resetExternalFetchGuard();
    if (extraCleanupEmails.size) {
      await prisma.user.deleteMany({
        where: { email: { in: [...extraCleanupEmails].filter((e) => e.startsWith("qa_")) } },
      });
    }
    await fx.cleanup();
    await srv.close();
    await prisma.$disconnect();
  });

  await t.test("RATE-01: POST /api/auth/login must rate-limit repeated wrong-password attempts across single & multiple accounts (429)", async () => {
    backendIndex.resetRateLimitersForTests();
    const statuses = [];
    for (let i = 0; i < 30; i += 1) {
      const r = await apiRequest(srv.baseUrl, "POST", "/api/auth/login", {
        body: { email: fx.stuA1.email, password: `WrongPass_${i}!` },
      });
      statuses.push(r.status);
    }
    for (let i = 0; i < 30; i += 1) {
      const r = await apiRequest(srv.baseUrl, "POST", "/api/auth/login", {
        body: { email: `qa_r01_unknown_${i}_${fx.runId}@test.local`, password: `WrongPass_${i}!` },
      });
      statuses.push(r.status);
    }

    assert.ok(
      statuses.includes(429),
      `Expected HTTP 429 rate-limit response during 60 bounded wrong-password login attempts, got statuses=[${[...new Set(statuses)].join(", ")}]`,
    );
  });

  await t.test("RATE-02: POST /api/auth/login status, message, and response timing must not reveal account existence", { todo: "SEC-18" }, async () => {
    backendIndex.resetRateLimitersForTests();
    // Register a real cost-12 user via API (test fixtures use cost 10 for seed speed)
    const cost12Email = `qa_r02_cost12_${fx.runId}@test.local`.toLowerCase();
    extraCleanupEmails.add(cost12Email);
    const reg = await apiRequest(srv.baseUrl, "POST", "/api/auth/register", {
      body: {
        name: "qa_Timing Target",
        email: cost12Email,
        password: QA_PASSWORD,
        confirmPassword: QA_PASSWORD,
        role: "STUDENT",
        recaptchaToken: "ok",
      },
    });
    assert.equal(reg.status, 201);

    try {
      // Warmup
      await apiRequest(srv.baseUrl, "POST", "/api/auth/login", {
        body: { email: cost12Email, password: "WrongPassword99!" },
      });
      await apiRequest(srv.baseUrl, "POST", "/api/auth/login", {
        body: { email: `qa_r02_miss_warm_${fx.runId}@test.local`, password: "WrongPassword99!" },
      });

      const existingMs = [];
      const unknownMs = [];
      const existingBodies = new Set();
      const unknownBodies = new Set();

      for (let i = 0; i < 20; i += 1) {
        const t0 = performance.now();
        const rExist = await apiRequest(srv.baseUrl, "POST", "/api/auth/login", {
          body: { email: cost12Email, password: `WrongPass_${i}!` },
        });
        existingMs.push(performance.now() - t0);
        assert.equal(rExist.status, 401);
        existingBodies.add(rExist.rawText);

        const t1 = performance.now();
        const rMiss = await apiRequest(srv.baseUrl, "POST", "/api/auth/login", {
          body: { email: `qa_r02_miss_${i}_${fx.runId}@test.local`, password: `WrongPass_${i}!` },
        });
        unknownMs.push(performance.now() - t1);
        assert.equal(rMiss.status, 401);
        unknownBodies.add(rMiss.rawText);
      }

      assert.deepEqual([...existingBodies], [...unknownBodies]);
      const medExist = median(existingMs);
      const medMiss = median(unknownMs);
      const deltaMs = Math.abs(medExist - medMiss);
      console.log(
        `[RATE-02 Timing] n=20 each | existing median=${medExist.toFixed(1)}ms | non-existing median=${medMiss.toFixed(1)}ms | delta=${deltaMs.toFixed(1)}ms`,
      );
      assert.ok(
        deltaMs < 40,
        `Timing oracle detected on /api/auth/login (existing median=${medExist.toFixed(1)}ms vs unknown median=${medMiss.toFixed(1)}ms, delta=${deltaMs.toFixed(1)}ms)`,
      );
    } finally {
      await prisma.user.deleteMany({ where: { email: cost12Email } });
      extraCleanupEmails.delete(cost12Email);
    }
  });

  await t.test("RATE-03a: POST /api/auth/resend-verification enforces per-user cooldown (429 + Retry-After)", async () => {
    backendIndex.resetRateLimitersForTests();
    mailer.clearStubEmails();
    const unvLogin = await loginAs(srv.baseUrl, fx.facUnverified.email);
    assert.equal(unvLogin.status, 200);

    const first = await apiRequest(srv.baseUrl, "POST", "/api/auth/resend-verification", {
      cookie: unvLogin.sidCookie,
      body: {},
    });
    assert.equal(first.status, 200);

    const second = await apiRequest(srv.baseUrl, "POST", "/api/auth/resend-verification", {
      cookie: unvLogin.sidCookie,
      body: {},
    });
    assert.equal(second.status, 429);
    assert.ok(Number(second.headers.get("retry-after")) >= 1);
    const mailsToUnv = mailer.getStubEmails().filter((m) => m.to === fx.facUnverified.email);
    assert.equal(mailsToUnv.length, 1);
  });

  await t.test("RATE-03b: registration & verify-email endpoints lack per-IP rate limiting (429)", { todo: "SEC-19" }, async () => {
    backendIndex.resetRateLimitersForTests();
    mailer.clearStubEmails();

    const verifyStatuses = [];
    for (let i = 0; i < 30; i += 1) {
      const r = await apiRequest(srv.baseUrl, "POST", "/api/auth/verify-email", {
        body: { token: `invalid_token_${i}_${"a".repeat(50)}` },
      });
      verifyStatuses.push(r.status);
    }

    const regStatuses = [];
    const createdEmails = [];
    try {
      for (let i = 0; i < 15; i += 1) {
        const email = `qa_r03_${i}_${fx.runId}@test.local`.toLowerCase();
        extraCleanupEmails.add(email);
        const r = await apiRequest(srv.baseUrl, "POST", "/api/auth/register", {
          body: {
            name: `qa_Burst_${i}`,
            email,
            password: QA_PASSWORD,
            confirmPassword: QA_PASSWORD,
            role: "STUDENT",
            recaptchaToken: "ok",
          },
        });
        regStatuses.push(r.status);
        if (r.status === 201) createdEmails.push(email);
      }
    } finally {
      if (createdEmails.length) {
        await prisma.user.deleteMany({ where: { email: { in: createdEmails } } });
        createdEmails.forEach((e) => extraCleanupEmails.delete(e));
      }
    }

    assert.ok(
      verifyStatuses.includes(429) && regStatuses.includes(429),
      `Expected HTTP 429 rate-limit on bursts: verify=[${[...new Set(verifyStatuses)]}], register=[${[...new Set(regStatuses)]}]`,
    );
  });

  await t.test("RATE-04a: forgot-password & change-password limiters return 429 at 6th attempt, cap emails at 5, and reset on success", async () => {
    backendIndex.resetRateLimitersForTests();
    mailer.clearStubEmails();

    // 1. IP limiter on forgot-password (different emails from same IP)
    for (let i = 0; i < 5; i += 1) {
      const r = await apiRequest(srv.baseUrl, "POST", "/api/auth/forgot-password", {
        body: { email: `qa_fp_ip_${i}_${fx.runId}@test.local`, recaptchaToken: "ok" },
      });
      assert.equal(r.status, 200);
    }
    const fpIp6 = await apiRequest(srv.baseUrl, "POST", "/api/auth/forgot-password", {
      body: { email: fx.stuA2.email, recaptchaToken: "ok" },
    });
    assert.equal(fpIp6.status, 429);
    assert.ok(fpIp6.headers.get("ratelimit") !== null || fpIp6.headers.get("retry-after") !== null);

    // 2. Email limiter on forgot-password (different X-Forwarded-For IPs targeting one existing account)
    backendIndex.resetRateLimitersForTests();
    mailer.clearStubEmails();
    for (let i = 0; i < 5; i += 1) {
      const r = await apiRequest(srv.baseUrl, "POST", "/api/auth/forgot-password", {
        headers: { "X-Forwarded-For": `198.51.100.${10 + i}` },
        body: { email: fx.stuA2.email, recaptchaToken: "ok" },
      });
      assert.equal(r.status, 200);
    }
    const fpEmail6 = await apiRequest(srv.baseUrl, "POST", "/api/auth/forgot-password", {
      headers: { "X-Forwarded-For": "198.51.100.99" },
      body: { email: fx.stuA2.email, recaptchaToken: "ok" },
    });
    assert.equal(fpEmail6.status, 429);
    const resetMails = mailer.getStubEmails().filter((m) => m.to === fx.stuA2.email);
    assert.equal(resetMails.length, 5);

    // 3. change-password wrong current limiter (429 at 6th) & reset on valid change
    backendIndex.resetRateLimitersForTests();
    const stuLogin = await loginAs(srv.baseUrl, fx.stuUnrelated.email);
    assert.equal(stuLogin.status, 200);

    for (let i = 0; i < 5; i += 1) {
      const badCp = await apiRequest(srv.baseUrl, "POST", "/api/auth/change-password", {
        cookie: stuLogin.sidCookie,
        body: {
          currentPassword: "WrongCurrentPassword!",
          newPassword: `${QA_PASSWORD}_New1`,
          confirmPassword: `${QA_PASSWORD}_New1`,
        },
      });
      assert.equal(badCp.status, 400);
    }
    const cp6 = await apiRequest(srv.baseUrl, "POST", "/api/auth/change-password", {
      cookie: stuLogin.sidCookie,
      body: {
        currentPassword: "WrongCurrentPassword!",
        newPassword: `${QA_PASSWORD}_New1`,
        confirmPassword: `${QA_PASSWORD}_New1`,
      },
    });
    assert.equal(cp6.status, 429);

    backendIndex.resetRateLimitersForTests();
    const validCp = await apiRequest(srv.baseUrl, "POST", "/api/auth/change-password", {
      cookie: stuLogin.sidCookie,
      body: {
        currentPassword: QA_PASSWORD,
        newPassword: `${QA_PASSWORD}_Temp`,
        confirmPassword: `${QA_PASSWORD}_Temp`,
      },
    });
    assert.equal(validCp.status, 200);
    const validCookie = validCp.sidCookie || stuLogin.sidCookie;
    // Restore original password
    const restoreCp = await apiRequest(srv.baseUrl, "POST", "/api/auth/change-password", {
      cookie: validCookie,
      body: {
        currentPassword: `${QA_PASSWORD}_Temp`,
        newPassword: QA_PASSWORD,
        confirmPassword: QA_PASSWORD,
      },
    });
    assert.equal(restoreCp.status, 200);
  });

  await t.test("RATE-04b: reset-password and reset-password/validate endpoints must enforce rate limiting (429)", { todo: "SEC-19" }, async () => {
    backendIndex.resetRateLimitersForTests();
    const statuses = [];
    for (let i = 0; i < 15; i += 1) {
      const v = await apiRequest(srv.baseUrl, "GET", `/api/auth/reset-password/validate?token=fake_val_${i}_${"b".repeat(48)}`);
      statuses.push(v.status);
    }
    for (let i = 0; i < 25; i += 1) {
      const r = await apiRequest(srv.baseUrl, "POST", "/api/auth/reset-password", {
        body: { token: `fake_reset_tok_${i}_${"b".repeat(48)}`, password: QA_PASSWORD, confirmPassword: QA_PASSWORD },
      });
      statuses.push(r.status);
    }
    assert.ok(
      statuses.includes(429),
      `Expected HTTP 429 on 40 reset-password / validate token attempts, got [${[...new Set(statuses)].join(", ")}]`,
    );
  });

  await t.test("RATE-05: POST /api/classes/join, GET /api/classes/check-code & studentId changes must rate-limit repeated guesses (429)", { todo: "SEC-20" }, async () => {
    backendIndex.resetRateLimitersForTests();
    const stuLogin = await loginAs(srv.baseUrl, fx.stuUnrelated.email);
    assert.equal(stuLogin.status, 200);
    const facLogin = await loginAs(srv.baseUrl, fx.facA.email);
    assert.equal(facLogin.status, 200);

    const joinStatuses = [];
    for (let i = 0; i < 40; i += 1) {
      const fakeCode = `BAD${i.toString(16).toUpperCase().padStart(3, "0")}`;
      const r = await apiRequest(srv.baseUrl, "POST", "/api/classes/join", {
        cookie: stuLogin.sidCookie,
        body: { classCode: fakeCode, recaptchaToken: "ok" },
      });
      joinStatuses.push(r.status);
    }

    const checkStatuses = [];
    for (let i = 0; i < 40; i += 1) {
      const fakeCode = `CHK${i.toString(16).toUpperCase().padStart(3, "0")}`;
      const r = await apiRequest(srv.baseUrl, "GET", `/api/classes/check-code?code=${fakeCode}`, {
        cookie: facLogin.sidCookie,
      });
      checkStatuses.push(r.status);
    }

    const badIdStatuses = [];
    for (let i = 0; i < 15; i += 1) {
      const r = await apiRequest(srv.baseUrl, "PUT", "/api/student/profile", {
        cookie: stuLogin.sidCookie,
        body: { name: fx.stuUnrelated.name, studentId: "123", email: fx.stuUnrelated.email },
      });
      badIdStatuses.push(r.status);
    }

    assert.ok(
      joinStatuses.includes(429) && checkStatuses.includes(429) && badIdStatuses.includes(429),
      `Expected HTTP 429 on join/check-code/studentId guesses: join=[${[...new Set(joinStatuses)]}], check-code=[${[...new Set(checkStatuses)]}], bad-id=[${[...new Set(badIdStatuses)]}]`,
    );
  });

  await t.test("RATE-06: server enforces reCAPTCHA on register, forgot-password, and join even when bypassing browser", async () => {
    backendIndex.resetRateLimitersForTests();
    mailer.clearStubEmails();
    const stuLogin = await loginAs(srv.baseUrl, fx.stuUnrelated.email);
    assert.equal(stuLogin.status, 200);

    const beforeUsers = await prisma.user.count();
    const badTokens = [undefined, "", "   ", "bad-captcha", null];

    for (const token of badTokens) {
      const reg = await apiRequest(srv.baseUrl, "POST", "/api/auth/register", {
        body: {
          name: "qa_NoCap",
          email: `qa_r06_nocap_${fx.runId}@test.local`,
          password: QA_PASSWORD,
          confirmPassword: QA_PASSWORD,
          role: "STUDENT",
          ...(token !== undefined ? { recaptchaToken: token } : {}),
        },
      });
      assert.equal(reg.status, 400);

      const fp = await apiRequest(srv.baseUrl, "POST", "/api/auth/forgot-password", {
        body: {
          email: fx.stuA1.email,
          ...(token !== undefined ? { recaptchaToken: token } : {}),
        },
      });
      assert.equal(fp.status, 400);

      const join = await apiRequest(srv.baseUrl, "POST", "/api/classes/join", {
        cookie: stuLogin.sidCookie,
        body: {
          classCode: fx.facAClass1.classCode,
          ...(token !== undefined ? { recaptchaToken: token } : {}),
        },
      });
      assert.equal(join.status, 400);
    }

    const afterUsers = await prisma.user.count();
    assert.equal(afterUsers, beforeUsers);
    assert.equal(mailer.getStubEmails().length, 0);

    // Note: Login intentionally works without reCAPTCHA; document whether captcha verifier rejects failure callback
    sec.setCaptchaHandler(async () => ({ success: false, message: "Captcha rejected." }));
    try {
      const blockedJoin = await apiRequest(srv.baseUrl, "POST", "/api/classes/join", {
        cookie: stuLogin.sidCookie,
        body: { classCode: fx.facAClass1.classCode, recaptchaToken: "forged-token" },
      });
      assert.equal(blockedJoin.status, 400);
    } finally {
      sec.resetCaptchaHandler();
    }
  });

  await t.test("RATE-07: recaptcha verification fails CLOSED on missing secret, Google HTTP 500, and network error/timeout", async () => {
    backendIndex.resetRateLimitersForTests();
    mailer.clearStubEmails();
    const recaptchaPath = require.resolve("../../classdex-backend/recaptcha.js");
    const cachedOrig = require.cache[recaptchaPath];
    delete require.cache[recaptchaPath];
    const freshRecaptcha = require(recaptchaPath);
    const prevSecret = process.env.RECAPTCHA_SECRET_KEY;

    try {
      // 1. Missing RECAPTCHA_SECRET_KEY -> fail closed
      delete process.env.RECAPTCHA_SECRET_KEY;
      const missingSecretRes = await freshRecaptcha.verifyRecaptchaToken("valid-looking-token", "127.0.0.1");
      assert.equal(missingSecretRes.success, false);

      // 2. Google 500 response via local fetch guard (zero outbound Google traffic)
      process.env.RECAPTCHA_SECRET_KEY = "qa-dummy-secret";
      sec.setExternalFetchGuard(async () => new Response("Internal Error", { status: 500 }));
      const http500Res = await freshRecaptcha.verifyRecaptchaToken("valid-looking-token", "127.0.0.1");
      assert.equal(http500Res.success, false);

      // 3. Network failure / timeout error -> fail closed
      sec.setExternalFetchGuard(async () => {
        throw new Error("ETIMEDOUT simulated network failure");
      });
      const netErrRes = await freshRecaptcha.verifyRecaptchaToken("valid-looking-token", "127.0.0.1");
      assert.equal(netErrRes.success, false);

      // 4. Route-level behavior when verifier fails closed or throws
      sec.setCaptchaHandler(freshRecaptcha.verifyRecaptchaToken);
      const stuLogin = await loginAs(srv.baseUrl, fx.stuUnrelated.email);
      const joinFailClosed = await apiRequest(srv.baseUrl, "POST", "/api/classes/join", {
        cookie: stuLogin.sidCookie,
        body: { classCode: fx.facAClass1.classCode, recaptchaToken: "token-during-outage" },
      });
      assert.equal(joinFailClosed.status, 400);

      sec.setCaptchaHandler(async () => {
        throw new Error("Unhandled verifier failure");
      });
      const fpThrow = await apiRequest(srv.baseUrl, "POST", "/api/auth/forgot-password", {
        body: { email: fx.stuA1.email, recaptchaToken: "token" },
      });
      assert.equal(fpThrow.status, 500);
      assert.equal(mailer.getStubEmails().length, 0);
    } finally {
      sec.resetCaptchaHandler();
      sec.resetExternalFetchGuard();
      if (prevSecret === undefined) delete process.env.RECAPTCHA_SECRET_KEY;
      else process.env.RECAPTCHA_SECRET_KEY = prevSecret;
      if (cachedOrig) require.cache[recaptchaPath] = cachedOrig;
      else delete require.cache[recaptchaPath];
    }
  });

  await t.test("RATE-08: direct connections without TRUST_PROXY configured must ignore spoofed X-Forwarded-For headers", { todo: "SEC-21" }, async () => {
    backendIndex.resetRateLimitersForTests();
    for (let i = 0; i < 5; i += 1) {
      const r = await apiRequest(srv.baseUrl, "POST", "/api/auth/forgot-password", {
        body: { email: `qa_xff_exhaust_${i}@test.local`, recaptchaToken: "ok" },
      });
      assert.equal(r.status, 200);
    }
    const blockedDirect = await apiRequest(srv.baseUrl, "POST", "/api/auth/forgot-password", {
      body: { email: `qa_xff_blocked@test.local`, recaptchaToken: "ok" },
    });
    assert.equal(blockedDirect.status, 429);

    // Spoofing X-Forwarded-For should still be 429 when not behind a verified proxy hop
    const spoofedXff = await apiRequest(srv.baseUrl, "POST", "/api/auth/forgot-password", {
      headers: { "X-Forwarded-For": "203.0.113.77" },
      body: { email: `qa_xff_bypass@test.local`, recaptchaToken: "ok" },
    });
    assert.equal(spoofedXff.status, 429, `Spoofed X-Forwarded-For bypassed forgotPasswordIpLimiter with status ${spoofedXff.status} (trust proxy=${backendIndex.app.get("trust proxy")})`);
  });

  await t.test("RATE-09: MemoryStore & Map rate-limiters lose state on restart and are unshared across instances (Sprint 6.3 review)", { todo: "SEC-22" }, async () => {
    backendIndex.resetRateLimitersForTests();
    // Simulate exhausting limit before process/instance restart
    for (let i = 0; i < 5; i += 1) {
      await apiRequest(srv.baseUrl, "POST", "/api/auth/forgot-password", {
        body: { email: fx.stuA1.email, recaptchaToken: "ok" },
      });
    }
    const blockedBefore = await apiRequest(srv.baseUrl, "POST", "/api/auth/forgot-password", {
      body: { email: fx.stuA1.email, recaptchaToken: "ok" },
    });
    assert.equal(blockedBefore.status, 429);

    // Simulate process restart / second instance clearing process-local MemoryStore
    backendIndex.resetRateLimitersForTests();
    const afterRestart = await apiRequest(srv.baseUrl, "POST", "/api/auth/forgot-password", {
      body: { email: fx.stuA1.email, recaptchaToken: "ok" },
    });
    assert.equal(afterRestart.status, 429, "In-memory MemoryStore wiped limit counter across restart/multi-instance state");
  });

  await t.test("RATE-10: bounded concurrent heavy requests (<=36 reqs) to /export/excel, /export/csv, /classes & /pending-counts remain stable", async () => {
    backendIndex.resetRateLimitersForTests();
    const facLogin = await loginAs(srv.baseUrl, fx.facA.email);
    assert.equal(facLogin.status, 200);

    const endpoints = [
      `/api/classes/${fx.facAClass1.id}/export/excel`,
      `/api/classes/${fx.facAClass1.id}/export/csv`,
      `/api/faculty/classes`,
      `/api/faculty/classes/pending-counts`,
    ];

    const calls = [];
    for (let i = 0; i < 36; i += 1) {
      calls.push(
        apiRequest(srv.baseUrl, "GET", endpoints[i % endpoints.length], {
          cookie: facLogin.sidCookie,
        }),
      );
    }
    const results = await Promise.all(calls);
    const non200 = results.filter((r) => r.status !== 200);
    assert.deepEqual(non200.map((r) => r.status), [], "Heavy concurrent batch caused non-200 failure");
  });

  await t.test("RATE-11: bounded oversized & malformed large JSON batch (12 concurrent ~8.1MB requests) recovers cleanly without crash", async () => {
    backendIndex.resetRateLimitersForTests();
    const facLogin = await loginAs(srv.baseUrl, fx.facA.email);
    assert.equal(facLogin.status, 200);

    const bigBody = JSON.stringify({ pad: "B".repeat(8 * 1024 * 1024 + 256) });
    const calls = Array.from({ length: 12 }, (_, idx) =>
      fetch(`${srv.baseUrl}/api/classes`, {
        method: "POST",
        headers: {
          Cookie: facLogin.sidCookie,
          "Content-Type": "application/json",
        },
        body: idx % 2 === 0 ? bigBody : "{bad-json-" + "X".repeat(64 * 1024),
      }).then((r) => r.status),
    );
    const statuses = await Promise.all(calls);
    for (const st of statuses) {
      assert.ok([400, 413].includes(st), `Unexpected status ${st} on oversized/malformed batch`);
    }

    const health = await apiRequest(srv.baseUrl, "GET", "/api/status");
    assert.equal(health.status, 200);
  });
});
