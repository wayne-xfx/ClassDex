const test = require("node:test");
const assert = require("node:assert/strict");
const {
  QA_PASSWORD,
  initSecurityBackend,
  createSecurityFixtures,
} = require("./helpers/security-harness.cjs");
const { startBrowserStack } = require("./helpers/browser-harness.cjs");

const sec = initSecurityBackend();
const { prisma } = sec;

test("SCRUM-70 AUTHZ-20: Frontend direct URL access redirects unauthorized guests and opposite-role users without leaking data", async (t) => {
  const stack = await startBrowserStack();
  const fx = await createSecurityFixtures(prisma, "s70ui");

  t.after(async () => {
    await stack.close();
    await fx.cleanup();
    await prisma.$disconnect();
  });

  // 1. Unauthenticated guest direct navigation
  {
    const ctx = await stack.newGuardedContext();
    const page = await ctx.newPage();
    const unauthorizedResponses = [];
    page.on("response", (res) => {
      if (res.url().includes("/api/") && !res.url().includes("/api/auth/me") && res.status() === 200) {
        unauthorizedResponses.push(`${res.status()} ${res.url()}`);
      }
    });

    for (const route of [
      "/faculty",
      "/faculty/profile",
      "/faculty/classes/new",
      `/faculty/classes/${fx.facAClass1.id}`,
      "/student",
      "/student/profile",
      `/student/classes/${fx.facAClass1.id}`,
      "/join",
      `/join/${fx.facAClass1.classCode}`,
      "/settings",
    ]) {
      await page.goto(`${stack.frontendUrl}${route}`, { waitUntil: "networkidle" });
      assert.equal(new URL(page.url()).pathname, "/login", `Guest on ${route} ended at ${page.url()}`);
    }
    assert.deepEqual(unauthorizedResponses, []);
    await ctx.close();
  }

  // Helper to log in via real browser login form
  async function loginViaUi(page, email) {
    await page.goto(`${stack.frontendUrl}/login`, { waitUntil: "networkidle" });
    await page.getByLabel("Email", { exact: false }).fill(email);
    await page.locator("#login-password").fill(QA_PASSWORD);
    const loginResp = page.waitForResponse((r) => r.url().includes("/api/auth/login"));
    await page.getByRole("button", { name: /sign in|log in/i }).click();
    const res = await loginResp;
    assert.equal(res.status(), 200);
    await page.waitForURL((u) => !u.pathname.endsWith("/login"));
  }

  // 2. Logged-in STUDENT navigating directly to Faculty routes -> redirected to /student
  {
    const ctx = await stack.newGuardedContext();
    const page = await ctx.newPage();
    await loginViaUi(page, fx.stuA1.email);

    for (const facRoute of [
      "/faculty",
      "/faculty/profile",
      "/faculty/classes/new",
      `/faculty/classes/${fx.facAClass1.id}`,
    ]) {
      await page.goto(`${stack.frontendUrl}${facRoute}`, { waitUntil: "networkidle" });
      assert.equal(new URL(page.url()).pathname, "/student", `Student on ${facRoute} landed on ${page.url()}`);
      const bodyText = await page.locator("body").innerText();
      assert.ok(!bodyText.includes(fx.facAClass2.sectionName), `Unjoined faculty class rendered on ${facRoute}`);
      assert.ok(!/Faculty workspace/i.test(bodyText), `Faculty workspace UI rendered on ${facRoute}`);
    }
    await ctx.close();
  }

  // 3. Logged-in FACULTY navigating directly to Student routes -> redirected to /faculty
  {
    const ctx = await stack.newGuardedContext();
    const page = await ctx.newPage();
    await loginViaUi(page, fx.facA.email);

    for (const stuRoute of [
      "/student",
      "/student/profile",
      `/student/classes/${fx.facAClass1.id}`,
      "/join",
      `/join/${fx.facBClass1.classCode}`,
    ]) {
      await page.goto(`${stack.frontendUrl}${stuRoute}`, { waitUntil: "networkidle" });
      assert.equal(new URL(page.url()).pathname, "/faculty", `Faculty on ${stuRoute} landed on ${page.url()}`);
    }
    await ctx.close();
  }
});
