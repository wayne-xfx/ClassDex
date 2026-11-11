import path from "node:path";
import { createRequire } from "node:module";
import { test, expect } from "@playwright/test";

const require = createRequire(import.meta.url);
const { loadBackendTestEnv } = require("../scripts/load-test-env.cjs");
loadBackendTestEnv();

const bcrypt = require("../../classdex-backend/node_modules/bcryptjs");
const { prisma } = require("../../classdex-backend/db");

const BACKEND_E2E_URL = `http://127.0.0.1:${process.env.E2E_BACKEND_PORT || 5051}`;
const TEST_PASSWORD = "QaPassword123!";
const SAMPLE_PHOTO =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

test.describe("SCRUM-63 Auth & RBAC E2E (AUTH-08, AUTH-09, AUTH-13, AUTH-14)", () => {
  const runId = Date.now().toString(36);
  const unverifiedFacEmail = `qa_e2e_unver_fac_${runId}@test.local`;
  const unverifiedStuEmail = `qa_e2e_unver_stu_${runId}@test.local`;
  const verifiedFacEmail = `qa_e2e_ver_fac_${runId}@test.local`;
  const verifiedStuEmail = `qa_e2e_ver_stu_${runId}@test.local`;
  const createdEmails = [
    unverifiedFacEmail,
    unverifiedStuEmail,
    verifiedFacEmail,
    verifiedStuEmail,
  ];

  test.beforeAll(async () => {
    const hash = await bcrypt.hash(TEST_PASSWORD, 10);
    await prisma.user.create({
      data: {
        name: "qa_E2E Unverified Faculty",
        email: unverifiedFacEmail,
        password: hash,
        role: "FACULTY",
        emailVerified: false,
        facultyProfile: {
          create: {
            name: "qa_E2E Unverified Faculty",
            department: "Information Technology",
            email: unverifiedFacEmail,
          },
        },
      },
    });
    await prisma.user.create({
      data: {
        name: "qa_E2E Unverified Student",
        email: unverifiedStuEmail,
        password: hash,
        role: "STUDENT",
        emailVerified: false,
        studentProfile: {
          create: {
            name: "qa_E2E Unverified Student",
            studentId: String(8710000 + Math.floor(Math.random() * 9000)),
            email: unverifiedStuEmail,
            photo: SAMPLE_PHOTO,
          },
        },
      },
    });
    await prisma.user.create({
      data: {
        name: "qa_E2E Verified Faculty",
        email: verifiedFacEmail,
        password: hash,
        role: "FACULTY",
        emailVerified: true,
        emailVerifiedAt: new Date(),
        facultyProfile: {
          create: {
            name: "qa_E2E Verified Faculty",
            department: "Computer Science",
            email: verifiedFacEmail,
          },
        },
      },
    });
    await prisma.user.create({
      data: {
        name: "qa_E2E Verified Student",
        email: verifiedStuEmail,
        password: hash,
        role: "STUDENT",
        emailVerified: true,
        emailVerifiedAt: new Date(),
        studentProfile: {
          create: {
            name: "qa_E2E Verified Student",
            studentId: String(8720000 + Math.floor(Math.random() * 9000)),
            email: verifiedStuEmail,
            photo: SAMPLE_PHOTO,
          },
        },
      },
    });
  });

  test.afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { in: createdEmails } } });
    await prisma.$disconnect();
  });

  test("AUTH-13: unauthenticated visitors are redirected to /login for all protected routes", async ({ page }) => {
    const protectedRoutes = [
      "/faculty",
      "/faculty/profile",
      "/faculty/classes/new",
      "/student",
      "/student/profile",
      "/join",
      "/settings",
    ];
    for (const route of protectedRoutes) {
      await page.goto(route);
      await expect(page).toHaveURL(/\/login$/);
    }
  });

  test("AUTH-08: role-based post-login redirect and unverified email reminder banner for Faculty & Student", async ({ browser }) => {
    // 1. Unverified Faculty logs in -> /faculty + unverified banner visible
    const facContext = await browser.newContext();
    const facPage = await facContext.newPage();
    try {
      await facPage.goto("/login");
      await facPage.locator("#login-email").fill(unverifiedFacEmail);
      await facPage.locator("#login-password").fill(TEST_PASSWORD);
      await facPage.getByRole("button", { name: "Log in" }).click();

      await expect(facPage).toHaveURL(/\/faculty$/);
      const facBanner = facPage.getByRole("region", { name: "Verify your email address" });
      await expect(facBanner).toBeVisible();
      await expect(facBanner).toContainText(unverifiedFacEmail);

      await facPage.request.delete(`${BACKEND_E2E_URL}/__e2e/emails`);
      await facBanner.getByRole("button", { name: "Resend Verification Email" }).click();
      await expect(facBanner.getByText(/Verification email sent/i)).toBeVisible();

      const stubRes = await facPage.request.get(`${BACKEND_E2E_URL}/__e2e/emails`);
      const { emails } = await stubRes.json();
      expect(emails.length).toBe(1);
      expect(emails[0].link).toContain("/verify-email?token=");
    } finally {
      await facContext.close();
    }

    // 2. Unverified Student logs in -> /student + unverified banner visible
    const stuContext = await browser.newContext();
    const stuPage = await stuContext.newPage();
    try {
      await stuPage.goto("/login");
      await stuPage.locator("#login-email").fill(unverifiedStuEmail);
      await stuPage.locator("#login-password").fill(TEST_PASSWORD);
      await stuPage.getByRole("button", { name: "Log in" }).click();

      await expect(stuPage).toHaveURL(/\/student$/);
      const stuBanner = stuPage.getByRole("region", { name: "Verify your email address" });
      await expect(stuBanner).toBeVisible();
      await expect(stuBanner).toContainText(unverifiedStuEmail);
    } finally {
      await stuContext.close();
    }
  });

  test("AUTH-09: logout destroys session cookie so /api/auth/me returns 401 and Back navigation redirects to /login", async ({ page }) => {
    await page.goto("/");
    await page.goto("/login");
    await page.locator("#login-email").fill(verifiedFacEmail);
    await page.locator("#login-password").fill(TEST_PASSWORD);
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page).toHaveURL(/\/faculty$/);

    // Navigate to a second protected page so browser history retains /faculty before logout
    await page.goto("/faculty/profile");
    await expect(page).toHaveURL(/\/faculty\/profile$/);

    await page.locator("button.user-menu-trigger").click();
    await page.getByRole("menuitem", { name: /Log out/i }).click();
    await expect(page).toHaveURL(/\/(|login)$/);

    const meRes = await page.request.get("/api/auth/me");
    expect(meRes.status()).toBe(401);

    await page.goBack();
    await expect(page).toHaveURL(/\/login$/);

    await page.goto("/faculty");
    await expect(page).toHaveURL(/\/login$/);
  });

  test("AUTH-14: cross-role UI route guards keep Student out of /faculty* and Faculty out of /student* & /join", async ({ browser }) => {
    // 1. Login as verified Student -> block /faculty* and redirect /login, /register to /student
    const stuContext = await browser.newContext();
    const stuPage = await stuContext.newPage();
    try {
      await stuPage.goto("/login");
      await stuPage.locator("#login-email").fill(verifiedStuEmail);
      await stuPage.locator("#login-password").fill(TEST_PASSWORD);
      await stuPage.getByRole("button", { name: "Log in" }).click();
      await expect(stuPage).toHaveURL(/\/student$/);

      for (const forbidden of ["/faculty", "/faculty/profile", "/faculty/classes/new", "/login", "/register"]) {
        await stuPage.goto(forbidden);
        await expect(stuPage).toHaveURL(/\/student$/);
      }
    } finally {
      await stuContext.close();
    }

    // 2. Login as verified Faculty -> block /student*, /join and redirect /login, /register to /faculty
    const facContext = await browser.newContext();
    const facPage = await facContext.newPage();
    try {
      await facPage.goto("/login");
      await facPage.locator("#login-email").fill(verifiedFacEmail);
      await facPage.locator("#login-password").fill(TEST_PASSWORD);
      await facPage.getByRole("button", { name: "Log in" }).click();
      await expect(facPage).toHaveURL(/\/faculty$/);

      for (const forbidden of ["/student", "/student/profile", "/join", "/login", "/register"]) {
        await facPage.goto(forbidden);
        await expect(facPage).toHaveURL(/\/faculty$/);
      }
    } finally {
      await facContext.close();
    }
  });
});
