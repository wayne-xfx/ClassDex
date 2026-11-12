const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  QA_PASSWORD,
  initSecurityBackend,
  apiRequest,
  loginAs,
  createSecurityFixtures,
} = require("./helpers/security-harness.cjs");
const { startBrowserStack } = require("./helpers/browser-harness.cjs");

const sec = initSecurityBackend();
const repoRoot = path.resolve(__dirname, "../..");
const { prisma } = sec;

test("SCRUM-71 INJ-06 & INJ-07: Playwright real-browser XSS execution check & frontend DOM sink audit", async (t) => {
  const stack = await startBrowserStack();
  const fx = await createSecurityFixtures(prisma, "s71ui");

  const facRes = await apiRequest(stack.backendUrl, "POST", "/api/auth/login", {
    body: { email: fx.facA.email, password: QA_PASSWORD },
  });
  assert.equal(facRes.status, 200);

  // Store XSS payloads across class fields, activity title, quiz title, and roster entry
  const payloads = [
    "<script>window.__xss=1</script>",
    "<img src=x onerror=\"window.__xss=2\">",
    "<svg onload=\"window.__xss=3\">",
  ];
  const combinedXss = payloads.join(" ");

  const xssClass = await apiRequest(stack.backendUrl, "POST", "/api/classes", {
    cookie: facRes.sidCookie,
    body: {
      sectionName: `qa_XSS ${combinedXss}`,
      courseCode: "QA-XSSUI",
      courseTitle: `qa_${payloads[0]}`,
      description: payloads[1],
      schedule: payloads[2],
    },
  });
  assert.equal(xssClass.status, 201);
  const classId = xssClass.json.class.id;

  const rosterAdd = await apiRequest(stack.backendUrl, "POST", `/api/classes/${classId}/roster`, {
    cookie: facRes.sidCookie,
    body: {
      entries: [
        { studentName: `qa_Roster ${payloads[1]}`, studentId: fx.stuA1.studentProfile.studentId },
      ],
    },
  });
  assert.equal(rosterAdd.status, 201);

  const joinRes = await apiRequest(
    stack.backendUrl,
    "POST",
    "/api/auth/login",
    { body: { email: fx.stuA1.email, password: QA_PASSWORD } },
  );
  await apiRequest(stack.backendUrl, "POST", "/api/classes/join", {
    cookie: joinRes.sidCookie,
    body: { classCode: xssClass.json.class.classCode, recaptchaToken: "ok" },
  });

  const sessRes = await apiRequest(stack.backendUrl, "POST", `/api/classes/${classId}/sessions/today`, {
    cookie: facRes.sidCookie,
    body: {},
  });
  assert.ok([200, 201].includes(sessRes.status));
  const sessionId = sessRes.json.session.id;

  await apiRequest(stack.backendUrl, "POST", `/api/sessions/${sessionId}/activities`, {
    cookie: facRes.sidCookie,
    body: { title: `qa_Act ${payloads[1]}`, maxScore: 10 },
  });
  await apiRequest(stack.backendUrl, "POST", `/api/classes/${classId}/quizzes`, {
    cookie: facRes.sidCookie,
    body: { title: `qa_Quiz ${payloads[2]}`, totalItems: 10 },
  });

  t.after(async () => {
    await stack.close();
    await prisma.class.deleteMany({ where: { id: classId } });
    await fx.cleanup();
    await prisma.$disconnect();
  });

  await t.test("INJ-06: stored XSS payloads render safely as text in Faculty & Student Playwright views with window.__xss === undefined", async () => {
    const ctx = await stack.newGuardedContext();
    const page = await ctx.newPage();
    const dialogs = [];
    page.on("dialog", async (dlg) => {
      dialogs.push(dlg.message());
      await dlg.dismiss();
    });

    // Faculty login & inspect dashboard + class modules
    await page.goto(`${stack.frontendUrl}/login`, { waitUntil: "networkidle" });
    await page.getByLabel("Email", { exact: false }).fill(fx.facA.email);
    await page.locator("#login-password").fill(QA_PASSWORD);
    const lResp = page.waitForResponse((r) => r.url().includes("/api/auth/login"));
    await page.getByRole("button", { name: /sign in|log in/i }).click();
    assert.equal((await lResp).status(), 200);
    await page.waitForURL((u) => u.pathname.startsWith("/faculty"));

    for (const urlPath of [
      "/faculty",
      `/faculty/classes/${classId}`,
      `/faculty/classes/${classId}?module=student-list`,
      `/faculty/classes/${classId}?module=activities`,
      `/faculty/classes/${classId}?module=quizzes`,
      `/faculty/classes/${classId}?notifications=1`,
    ]) {
      await page.goto(`${stack.frontendUrl}${urlPath}`, { waitUntil: "networkidle" });
      const xssVal = await page.evaluate(() => window.__xss);
      assert.equal(xssVal, undefined, `XSS executed on ${urlPath}`);
    }
    const facultyBody = await page.locator("body").innerText();
    assert.ok(facultyBody.includes("<script>window.__xss=1</script>") || facultyBody.includes("<img src=x"), "Expected stored literal text visible in Faculty view");

    // Verify Student view renders stored payloads safely too
    const stuCtx = await stack.newGuardedContext();
    const stuPage = await stuCtx.newPage();
    stuPage.on("dialog", async (dlg) => {
      dialogs.push(dlg.message());
      await dlg.dismiss();
    });
    await stuPage.goto(`${stack.frontendUrl}/login`, { waitUntil: "networkidle" });
    await stuPage.getByLabel("Email", { exact: false }).fill(fx.stuA1.email);
    await stuPage.locator("#login-password").fill(QA_PASSWORD);
    const slResp = stuPage.waitForResponse((r) => r.url().includes("/api/auth/login"));
    await stuPage.getByRole("button", { name: /sign in|log in/i }).click();
    assert.equal((await slResp).status(), 200);
    await stuPage.waitForURL((u) => u.pathname.startsWith("/student"));

    for (const sUrl of ["/student", `/student/classes/${classId}`]) {
      await stuPage.goto(`${stack.frontendUrl}${sUrl}`, { waitUntil: "networkidle" });
      assert.equal(await stuPage.evaluate(() => window.__xss), undefined, `XSS executed on ${sUrl}`);
    }

    assert.deepEqual(dialogs, []);
    await stuCtx.close();
    await ctx.close();
  });

  await t.test("INJ-07: frontend DOM sink scan & reflected query/route XSS check in Playwright", async () => {
    const srcRoot = path.join(repoRoot, "classdex-frontend", "src");
    const dangerousSinks = [];
    function scan(dir) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) scan(full);
        else if (/\.(js|jsx)$/.test(entry.name)) {
          const txt = fs.readFileSync(full, "utf8");
          if (/dangerouslySetInnerHTML|\.innerHTML\s*=|\.outerHTML\s*=|insertAdjacentHTML|document\.write\s*\(|javascript:/i.test(txt)) {
            dangerousSinks.push(path.relative(repoRoot, full));
          }
        }
      }
    }
    scan(srcRoot);
    assert.deepEqual(dangerousSinks, [], `Found dangerous DOM sinks: ${dangerousSinks.join(", ")}`);

    const ctx = await stack.newGuardedContext();
    const page = await ctx.newPage();
    for (const route of [
      "/reset-password?token=%3Cscript%3Ewindow.__xss=4%3C/script%3E",
      "/verify-email?token=%3Cimg%20src=x%20onerror=window.__xss=5%3E",
      "/login?error=%3Csvg%20onload=window.__xss=6%3E",
      "/join/%3Cimg%20src=x%20onerror=window.__xss=7%3E",
    ]) {
      await page.goto(`${stack.frontendUrl}${route}`, { waitUntil: "networkidle" });
      assert.equal(await page.evaluate(() => window.__xss), undefined, `Reflected XSS triggered on ${route}`);
    }
    await ctx.close();
  });
});
