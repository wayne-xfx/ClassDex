import { createRequire } from "node:module";
import { test, expect } from "@playwright/test";
import { installRecaptchaIpv4Relay } from "./support/recaptcha-env.mjs";

const require = createRequire(import.meta.url);
const { loadBackendTestEnv } = require("../scripts/load-test-env.cjs");
loadBackendTestEnv();

const bcrypt = require("../../classdex-backend/node_modules/bcryptjs");
const { prisma } = require("../../classdex-backend/db");

const TEST_PASSWORD = "QaPassword123!";
const SAMPLE_PHOTO =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

async function loginAs(page, email, expectedUrlRegex) {
  await page.goto("/login");
  await page.locator("#login-email").fill(email);
  await page.locator("#login-password").fill(TEST_PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(expectedUrlRegex, { timeout: 25_000 });
}

async function assertNoHorizontalOverflow(page, label) {
  const metrics = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(
    metrics.scrollWidth,
    `Horizontal overflow detected on ${label}: scrollWidth=${metrics.scrollWidth} > innerWidth=${metrics.innerWidth}`,
  ).toBeLessThanOrEqual(metrics.innerWidth);
}

async function setAndVerifyTheme(page, targetTheme) {
  await expect
    .poll(() => page.evaluate(() => document.documentElement.dataset.theme))
    .toMatch(/^(light|dark)$/);
  const current = await page.evaluate(() => document.documentElement.dataset.theme);
  if (current !== targetTheme) {
    await page.getByRole("button", { name: new RegExp(`Switch to ${targetTheme} mode`, "i") }).click();
    await expect
      .poll(() => page.evaluate(() => window.localStorage.getItem("classdex-theme")))
      .toBe(targetTheme);
  }
  await expect
    .poll(() => page.evaluate(() => document.documentElement.dataset.theme))
    .toBe(targetTheme);
}

function attachRuntimeErrorCollector(page) {
  const errors = [];
  page.on("pageerror", (err) => errors.push(`pageerror: ${err?.message || err}`));
  page.on("response", (res) => {
    const status = res.status();
    const url = res.url();
    const isExpectedAuthCheck = status === 401 && url.includes("/api/auth/me");
    const isInternalOrigin = url.startsWith("http://localhost") || url.startsWith("http://127.0.0.1");
    if (isInternalOrigin && status >= 400 && !isExpectedAuthCheck) {
      errors.push(`http ${status}: ${res.request().method()} ${url}`);
    }
  });
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      const text = msg.text();
      const locUrl = msg.location()?.url || "";
      const isThirdPartyCaptchaNoise =
        locUrl.includes("google.com") ||
        locUrl.includes("gstatic.com") ||
        /requestStorageAccess/i.test(text);
      if (
        !isThirdPartyCaptchaNoise &&
        !/favicon\.ico/i.test(text) &&
        !/status of 401/i.test(text)
      ) {
        errors.push(`console.error: ${text}`);
      }
    }
  });
  return errors;
}

test.describe("SCRUM-68 Cross-Browser & Responsive Compatibility (COMPAT-01..07)", () => {
  async function allocStudentId(basePrefix) {
    for (let i = 0; i < 60; i += 1) {
      const candidate = String(basePrefix + Math.floor(Math.random() * 9000)).padStart(7, "8");
      const [p, r] = await Promise.all([
        prisma.studentProfile.findUnique({ where: { studentId: candidate }, select: { id: true } }),
        prisma.classRoster.findFirst({ where: { studentId: candidate }, select: { id: true } }),
      ]);
      if (!p && !r) return candidate;
    }
    throw new Error("Unable to allocate unique qa_s68 studentId");
  }

  async function seedCompatFixtures(tag) {
    const uid = `${Date.now().toString(36).slice(-4)}${Math.random().toString(36).slice(2, 6)}`;
    const facEmail = `qa_s68_${tag}_fac_${uid}@test.local`;
    const stuEmail = `qa_s68_${tag}_stu_${uid}@test.local`;
    const hash = await bcrypt.hash(TEST_PASSWORD, 10);
    const sid = await allocStudentId(8920000);
    const uiClassCode = `C68U${uid}`.slice(0, 10).toUpperCase();

    const facUser = await prisma.user.create({
      data: {
        name: "qa_Compat Faculty",
        email: facEmail,
        password: hash,
        role: "FACULTY",
        emailVerified: true,
        emailVerifiedAt: new Date(),
        facultyProfile: {
          create: { name: "qa_Compat Faculty", department: "IT", email: facEmail },
        },
      },
    });

    const stuUser = await prisma.user.create({
      data: {
        name: "qa_Compat Student",
        email: stuEmail,
        password: hash,
        role: "STUDENT",
        emailVerified: true,
        emailVerifiedAt: new Date(),
        studentProfile: {
          create: {
            name: "qa_Compat Student",
            studentId: sid,
            email: stuEmail,
            program: "BSIT",
            section: "AI33",
            photo: SAMPLE_PHOTO,
          },
        },
      },
      include: { studentProfile: true },
    });

    const seededClass = await prisma.class.create({
      data: {
        facultyId: facUser.id,
        sectionName: "qa_Compat Class 3A",
        courseCode: "IT 130",
        courseTitle: "Compatibility Suite",
        classCode: `C68S${uid}`.slice(0, 10).toUpperCase(),
        recitationShuffleSeconds: 1,
        roster: {
          create: [
            {
              studentId: sid,
              studentName: "qa_Compat Student",
              firstName: "qa_Compat",
              lastName: "Student",
              sortKey: "student",
            },
          ],
        },
        enrollments: {
          create: [{ studentProfileId: stuUser.studentProfile.id, status: "APPROVED" }],
        },
      },
    });

    return { uid, facEmail, stuEmail, facUser, stuUser, seededClass, uiClassCode };
  }

  async function cleanupCompatFixtures(fixtures) {
    if (!fixtures) return;
    if (fixtures.facUser?.id) {
      await prisma.class.deleteMany({ where: { facultyId: fixtures.facUser.id } }).catch(() => {});
    }
    const emails = [fixtures.facEmail, fixtures.stuEmail].filter(Boolean);
    if (emails.length) {
      await prisma.user.deleteMany({ where: { email: { in: emails } } }).catch(() => {});
    }
  }

  test.beforeEach(async ({ page }) => {
    await installRecaptchaIpv4Relay(page);
  });

  test.afterAll(async () => {
    await prisma.$disconnect();
  });

  test("Faculty flow, themes, schedule inputs, shuffler, 3D card flip & export responsive check", async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    const fixtures = await seedCompatFixtures("fac");
    const { facEmail, seededClass, uiClassCode } = fixtures;
    const errors = attachRuntimeErrorCollector(page);
    const project = testInfo.project.name;

    try {
      // 1. Landing in Light & Dark themes + reload persistence
      await page.goto("/");
      await setAndVerifyTheme(page, "light");
      await assertNoHorizontalOverflow(page, `${project} landing (light)`);

      await setAndVerifyTheme(page, "dark");
      await page.reload();
      await expect
        .poll(() => page.evaluate(() => document.documentElement.dataset.theme))
        .toBe("dark");
      await assertNoHorizontalOverflow(page, `${project} landing (dark reload)`);

      // 2. Faculty Dashboard + Create Class (day pills & <select> dropdowns)
      await loginAs(page, facEmail, /\/faculty$/);
      await expect(page.getByText("qa_Compat Class 3A")).toBeVisible({ timeout: 20_000 });
      await assertNoHorizontalOverflow(page, `${project} faculty dashboard`);

      if (project === "edge-desktop") {
        await page.setViewportSize({ width: 375, height: 812 });
        await assertNoHorizontalOverflow(page, `${project} mobile-smoke faculty dashboard`);
        await page.setViewportSize({ width: 1280, height: 800 });
      }

      await page.goto("/faculty/classes/new");
      await expect(page.getByRole("textbox", { name: /^Course code/i })).toBeVisible({ timeout: 20_000 });
      await page.getByRole("textbox", { name: /^Course code/i }).fill("IT 130");
      await page.getByRole("textbox", { name: /^Course title/i }).fill("Compatibility Testing");
      await page.getByRole("textbox", { name: /^Section name/i }).fill("qa_Compat Created");
      await page.getByRole("textbox", { name: /^Class code/i }).fill(uiClassCode);
      await expect(page.getByText(/This code is available\./i)).toBeVisible();
      await page.getByRole("button", { name: "Monday", exact: true }).click();
      await page.getByRole("button", { name: "Wednesday", exact: true }).click();
      await page.getByLabel("Start time").selectOption("08:00");
      await page.getByLabel("End time").selectOption("09:30");
      await assertNoHorizontalOverflow(page, `${project} create class (dark)`);

      await page.getByRole("button", { name: /Create class/i }).click();
      await expect(page).toHaveURL(/\/faculty$/);
      await expect(page.getByText("Section: qa_Compat Created")).toBeVisible({ timeout: 20_000 });

      // 3. Seeded Class Modules across Dark + Light themes
      await page.goto(`/faculty/classes/${seededClass.id}`);
      await assertNoHorizontalOverflow(page, `${project} class deck (dark)`);

      await setAndVerifyTheme(page, "light");
      await assertNoHorizontalOverflow(page, `${project} class deck (light)`);

      // Student List inline add + save immediately upon opening tab (regression check for DEF-12)
      await page.locator("#module-tab-student-list").click();
      await expect(page.getByLabel("Student name")).toBeVisible();
      await assertNoHorizontalOverflow(page, `${project} student list tab`);
      await page.getByLabel("Student name").fill("qa_Compat Extra Row");
      await page.getByLabel("7-digit student ID").fill("8995511");
      await page.getByRole("button", { name: /Add student/i }).click();
      await expect(page.locator("table.student-list-table tbody tr")).toHaveCount(2);
      await page.getByRole("button", { name: /Save student list/i }).click();
      await expect(page.getByText(/Student list saved/i)).toBeVisible();

      // Attendance tab -> mark Present
      await page.locator("#module-tab-attendance").click();
      await expect(page.locator("article.attendance-student-card").first()).toBeVisible();
      const rowPresentBtn = page
        .locator("article.attendance-student-card")
        .first()
        .getByRole("button", { name: "Present", exact: true });
      const attPut = page.waitForResponse(
        (res) => res.url().includes("/attendance/") && res.request().method() === "PUT" && res.status() === 200,
      );
      await rowPresentBtn.click();
      await attPut;
      await assertNoHorizontalOverflow(page, `${project} attendance tab`);

      // Recitation Shuffle -> reveal & score
      await page.locator("#module-tab-recitation").click();
      await assertNoHorizontalOverflow(page, `${project} recitation tab`);
      await page.locator("button.recitation-shuffle-btn").click();
      await expect(page.locator("article.recitation-card")).toBeVisible({ timeout: 15_000 });
      const scorePatch = page.waitForResponse(
        (res) => res.url().includes("/api/recitation-logs/") && res.request().method() === "PATCH" && res.status() === 200,
      );
      await page.getByRole("button", { name: /^Score 5\b/i }).click();
      await scorePatch;

      // Class Deck -> 3D Student Detail Dialog & Flip
      await page.locator("#module-deck-link").click();
      await page.getByRole("button", { name: /Open .*'s index card/i }).first().click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      await assertNoHorizontalOverflow(page, `${project} 3d card modal`);
      await dialog.getByRole("button", { name: "Flip card" }).first().click();
      await expect(dialog.locator(".index-card")).toHaveClass(/is-flipped/);
      await dialog.getByRole("button", { name: "Close student profile" }).click();

      // Export tab responsive layout check
      await page.locator("#module-tab-export").click();
      await expect(page.getByRole("heading", { name: "Export class data" })).toBeVisible();
      await assertNoHorizontalOverflow(page, `${project} export tab`);

      expect(errors, `Unexpected runtime errors on ${project}`).toEqual([]);
    } finally {
      await cleanupCompatFixtures(fixtures);
    }
  });

  test("Student flow, themes, mobile/tablet nav, captcha timing & 3D card flip responsive check", async ({ page }, testInfo) => {
    test.setTimeout(150_000);
    const fixtures = await seedCompatFixtures("stu");
    const { uid, stuEmail, seededClass } = fixtures;
    const errors = attachRuntimeErrorCollector(page);
    const project = testInfo.project.name;

    try {
      // 1. Register reCAPTCHA timing: never pops on invalid fields; opens after valid required fields
      await page.goto("/register");
      await setAndVerifyTheme(page, "dark");
      await assertNoHorizontalOverflow(page, `${project} register (dark)`);

      // Native HTML5 required or whitespace name must NOT pop Security check
      await page.getByPlaceholder("e.g., Juan Dela Cruz").fill("   ");
      await page.getByLabel(/^Email$/i).fill(`qa_unused_${uid}@test.local`);
      await page.locator('input[name="password"]').fill(TEST_PASSWORD);
      await page.locator('input[name="confirmPassword"]').fill(TEST_PASSWORD);
      await page.getByRole("button", { name: "Register" }).click();
      await expect(page.getByText(/Choose an account type and enter your full name\./i)).toBeVisible();
      await expect(page.getByRole("dialog", { name: "Security check" })).toHaveCount(0);

      await page.getByPlaceholder("e.g., Juan Dela Cruz").fill("qa_Captcha Timing User");
      await page.getByRole("button", { name: "Register" }).click();

      const regCaptcha = page.getByRole("dialog", { name: "Security check" });
      await expect(regCaptcha).toBeVisible();
      await expect(
        regCaptcha.frameLocator('iframe[title="reCAPTCHA"]').locator("#recaptcha-anchor"),
      ).toBeVisible({ timeout: 25_000 });
      await assertNoHorizontalOverflow(page, `${project} register captcha modal`);
      await page.getByRole("button", { name: "Close security check" }).click();
      await expect(regCaptcha).toHaveCount(0);

      // 2. Login as Student -> Dashboard & Profile in Light + Dark
      await loginAs(page, stuEmail, /\/student$/);
      await expect(page.getByText("qa_Compat Class 3A")).toBeVisible({ timeout: 20_000 });
      await assertNoHorizontalOverflow(page, `${project} student dashboard (dark)`);

      await setAndVerifyTheme(page, "light");
      await page.reload();
      await expect
        .poll(() => page.evaluate(() => document.documentElement.dataset.theme))
        .toBe("light");

      // Mobile/tablet/desktop nav -> Dashboard & My index card
      const dashboardNavLink = page.locator('.main-nav a[href="/student"]');
      await expect(dashboardNavLink, `${project} Dashboard nav link keeps accessible name`).toHaveAccessibleName(/Dashboard/i);
      const profileNavLink = page.locator('.main-nav a[href="/student/profile"]');
      await expect(profileNavLink).toBeVisible();
      await expect(profileNavLink, `${project} nav link keeps accessible name even on mobile`).toHaveAccessibleName(
        /My index card/i,
      );
      await profileNavLink.click();
      await expect(page).toHaveURL(/\/student\/profile$/);
      await assertNoHorizontalOverflow(page, `${project} student profile (light)`);

      await page.getByLabel(/^Program$/i).fill("BSCS");
      await page.getByRole("button", { name: /Save index card/i }).click();
      await expect(page).toHaveURL(/\/student$/);
      await expect(page.getByText("qa_Compat Class 3A")).toBeVisible({ timeout: 20_000 });

      // 3. Join class captcha timing
      await page.goto("/join");
      await page.getByRole("button", { name: /Join class/i }).click();
      await expect(page.getByText("Enter a class invite code.")).toBeVisible();
      await expect(page.getByRole("dialog", { name: "Security check" })).toHaveCount(0);

      await page.getByLabel(/Class invite code/i).fill("BADCODE1");
      await page.getByRole("button", { name: /Join class/i }).click();
      const joinCaptcha = page.getByRole("dialog", { name: "Security check" });
      await expect(joinCaptcha).toBeVisible();
      await expect(
        joinCaptcha.frameLocator('iframe[title="reCAPTCHA"]').locator("#recaptcha-anchor"),
      ).toBeVisible({ timeout: 25_000 });
      await assertNoHorizontalOverflow(page, `${project} join captcha modal`);
      await page.getByRole("button", { name: "Close security check" }).click();

      // 4. Student inline class record & 3D flip
      await page.goto(`/student/classes/${seededClass.id}`);
      await expect(page.locator("#student-detail-title")).toContainText("Student, qa_Compat", { timeout: 20_000 });
      await assertNoHorizontalOverflow(page, `${project} student class record (light)`);
      await page.getByRole("button", { name: "Flip card" }).first().click();
      await expect(page.locator(".index-card")).toHaveClass(/is-flipped/);
      await assertNoHorizontalOverflow(page, `${project} student class record flipped`);

      if (project === "edge-desktop") {
        await page.setViewportSize({ width: 375, height: 812 });
        await assertNoHorizontalOverflow(page, `${project} mobile-smoke student record`);
        await page.setViewportSize({ width: 1280, height: 800 });
      }

      expect(errors, `Unexpected runtime errors on ${project}`).toEqual([]);
    } finally {
      await cleanupCompatFixtures(fixtures);
    }
  });
});
