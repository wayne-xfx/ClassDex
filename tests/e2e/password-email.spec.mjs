import { createRequire } from "node:module";
import { test, expect } from "@playwright/test";

const require = createRequire(import.meta.url);
const { loadBackendTestEnv } = require("../scripts/load-test-env.cjs");
loadBackendTestEnv();

const bcrypt = require("../../classdex-backend/node_modules/bcryptjs");
const { prisma } = require("../../classdex-backend/db");
const { generateToken } = require("../../classdex-backend/src/utils/tokens");

const BACKEND_E2E_URL = `http://127.0.0.1:${process.env.E2E_BACKEND_PORT || 5051}`;
const TEST_PASSWORD = "QaPassword123!";
const SAMPLE_PHOTO =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

async function loginAs(page, email, password, expectedUrlRegex) {
  await page.goto("/login");
  await page.locator("#login-email").fill(email);
  await page.locator("#login-password").fill(password);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(expectedUrlRegex);
}

async function solveTestRecaptcha(page) {
  const modal = page.getByRole("dialog", { name: "Security check" });
  await expect(modal).toBeVisible();
  const anchor = page.frameLocator('iframe[title="reCAPTCHA"]').locator("#recaptcha-anchor");
  await anchor.waitFor({ state: "visible", timeout: 15_000 });
  await anchor.click();
}

test.describe("SCRUM-67 Password Recovery & Email Flows E2E (PWD-01..PWD-10)", () => {
  const runId = Date.now().toString(36).slice(-5);
  const regStudentEmail = `qa_e2e_s67_reg_${runId}@test.local`;
  const resetFacEmail = `qa_e2e_s67_fac_${runId}@test.local`;
  const settingsStuEmail = `qa_e2e_s67_cfg_${runId}@test.local`;
  const joinFacEmail = `qa_e2e_s67_jfac_${runId}@test.local`;
  const joinStu1Email = `qa_e2e_s67_j1_${runId}@test.local`;
  const joinStu2Email = `qa_e2e_s67_j2_${runId}@test.local`;

  const createdEmails = [
    regStudentEmail,
    resetFacEmail,
    settingsStuEmail,
    joinFacEmail,
    joinStu1Email,
    joinStu2Email,
  ];
  const createdClassIds = [];

  let resetFacUser;
  let joinClass;

  async function allocStudentId(basePrefix) {
    for (let i = 0; i < 60; i += 1) {
      const candidate = String(basePrefix + Math.floor(Math.random() * 9000)).padStart(7, "8");
      const [p, r] = await Promise.all([
        prisma.studentProfile.findUnique({ where: { studentId: candidate }, select: { id: true } }),
        prisma.classRoster.findFirst({ where: { studentId: candidate }, select: { id: true } }),
      ]);
      if (!p && !r) return candidate;
    }
    throw new Error("Unable to allocate unique qa_s67 E2E studentId");
  }

  test.beforeAll(async () => {
    const hash = await bcrypt.hash(TEST_PASSWORD, 10);
    const [sidCfg, sidJ1, sidJ2] = await Promise.all([
      allocStudentId(8940000),
      allocStudentId(8950000),
      allocStudentId(8960000),
    ]);

    resetFacUser = await prisma.user.create({
      data: {
        name: "qa_E2E S67 Reset Faculty",
        email: resetFacEmail,
        password: hash,
        role: "FACULTY",
        emailVerified: true,
        emailVerifiedAt: new Date(),
        facultyProfile: {
          create: { name: "qa_E2E S67 Reset Faculty", department: "IT", email: resetFacEmail },
        },
      },
    });

    await prisma.user.create({
      data: {
        name: "qa_E2E S67 Settings Student",
        email: settingsStuEmail,
        password: hash,
        role: "STUDENT",
        emailVerified: true,
        emailVerifiedAt: new Date(),
        studentProfile: {
          create: {
            name: "qa_E2E S67 Settings Student",
            studentId: sidCfg,
            email: settingsStuEmail,
            program: "BSIT",
            section: "4A",
            photo: SAMPLE_PHOTO,
          },
        },
      },
    });

    const joinFac = await prisma.user.create({
      data: {
        name: "qa_E2E S67 Join Faculty",
        email: joinFacEmail,
        password: hash,
        role: "FACULTY",
        emailVerified: true,
        emailVerifiedAt: new Date(),
        facultyProfile: {
          create: { name: "qa_E2E S67 Join Faculty", department: "CS", email: joinFacEmail },
        },
      },
    });

    const createStu = async (email, name, studentId) =>
      prisma.user.create({
        data: {
          name,
          email,
          password: hash,
          role: "STUDENT",
          emailVerified: true,
          emailVerifiedAt: new Date(),
          studentProfile: {
            create: {
              name,
              studentId,
              email,
              program: "BSCS",
              section: "3B",
              photo: SAMPLE_PHOTO,
            },
          },
        },
        include: { studentProfile: true },
      });

    const [_stu1, stu2] = await Promise.all([
      createStu(joinStu1Email, "qa_E2E S67 Join One", sidJ1),
      createStu(joinStu2Email, "qa_E2E S67 Join Two", sidJ2),
    ]);

    joinClass = await prisma.class.create({
      data: {
        facultyId: joinFac.id,
        sectionName: "qa_E2E S67 Email 3B",
        courseCode: "IT 129",
        courseTitle: "Verification Flows",
        classCode: `E67${runId}`.slice(0, 10).toUpperCase(),
        enrollments: {
          create: [{ studentProfileId: stu2.studentProfile.id, status: "PENDING" }],
        },
      },
    });
    createdClassIds.push(joinClass.id);
  });

  test.afterAll(async () => {
    if (createdClassIds.length) {
      await prisma.class.deleteMany({ where: { id: { in: createdClassIds } } });
    }
    await prisma.user.deleteMany({ where: { email: { in: createdEmails } } });
    await prisma.$disconnect();
  });

  test("PWD-01..03 E2E: Register captures verify email, resend cooldown, expired/invalid/used & verify clears banner", async ({ page }) => {
    test.setTimeout(60_000);
    await page.request.delete(`${BACKEND_E2E_URL}/__e2e/emails`);

    await page.goto("/register");
    await page.getByText("Student", { exact: true }).click();
    await page.getByPlaceholder("e.g., Juan Dela Cruz").fill("qa_E2E S67 Reg Student");
    await page.getByLabel(/^Email$/i).fill(regStudentEmail);
    await page.locator('input[name="password"]').fill(TEST_PASSWORD);
    await page.locator('input[name="confirmPassword"]').fill(TEST_PASSWORD);
    await page.getByRole("button", { name: "Register" }).click();

    await solveTestRecaptcha(page);
    await expect(page).toHaveURL(/\/student$/);

    const banner = page.getByRole("region", { name: "Verify your email address" });
    await expect(banner).toBeVisible();
    await expect(banner).toContainText(regStudentEmail);

    const { emails: mailsAfterReg } = await (await page.request.get(`${BACKEND_E2E_URL}/__e2e/emails`)).json();
    expect(mailsAfterReg.some((m) => m.to === regStudentEmail && m.link.includes("/verify-email?token="))).toBe(true);

    // Boundary: missing token
    await page.goto("/verify-email");
    await expect(page.getByRole("heading", { name: "Invalid verification link" })).toBeVisible();

    // Boundary: tampered/unknown token + logged-in Resend button cooldown
    await page.request.delete(`${BACKEND_E2E_URL}/__e2e/emails`);
    await page.goto("/verify-email?token=deadbeef0123456789deadbeef0123456789");
    await expect(page.getByRole("heading", { name: "Invalid verification link" })).toBeVisible();

    const resendBtn = page.getByRole("button", { name: /Resend verification email/i });
    await expect(resendBtn).toBeVisible();
    await resendBtn.click();
    await expect(page.getByText(/Verification email sent\. Check your inbox\./i)).toBeVisible();
    await expect(page.getByRole("button", { name: /Resend in \d+s/i })).toBeDisabled();

    const { emails: mailsAfterResend } = await (await page.request.get(`${BACKEND_E2E_URL}/__e2e/emails`)).json();
    const freshMail = mailsAfterResend.find((m) => m.to === regStudentEmail && m.link.includes("/verify-email?token="));
    expect(freshMail).toBeTruthy();

    // Boundary: expired (>24h) token
    const regUser = await prisma.user.findUnique({ where: { email: regStudentEmail }, select: { id: true } });
    const expiredPair = generateToken();
    await prisma.emailVerificationToken.create({
      data: { userId: regUser.id, tokenHash: expiredPair.hash, expiresAt: new Date(Date.now() - 25 * 3600_000) },
    });
    await page.goto(`/verify-email?token=${expiredPair.raw}`);
    await expect(page.getByRole("heading", { name: "Verification link expired" })).toBeVisible();

    // Valid token -> Email verified -> banner cleared on /student -> reuse says already used
    const verifyPath = new URL(freshMail.link).pathname + new URL(freshMail.link).search;
    await page.goto(verifyPath);
    await expect(page.getByRole("heading", { name: "Email verified" })).toBeVisible();
    await page.getByRole("link", { name: /Continue to Dashboard/i }).click();
    await expect(page).toHaveURL(/\/student$/);
    await expect(page.getByRole("region", { name: "Verify your email address" })).toHaveCount(0);

    await page.goto(verifyPath);
    await expect(page.getByRole("heading", { name: "Verification link already used" })).toBeVisible();
  });

  test("PWD-04..07 E2E: Forgot password captcha + anti-enum UI, /reset-password bounds & prior-session revocation", async ({ browser }) => {
    test.setTimeout(60_000);
    const oldSessionCtx = await browser.newContext();
    const oldSessionPage = await oldSessionCtx.newPage();
    const ctx = await browser.newContext();
    const page = await ctx.newPage();

    try {
      await oldSessionPage.request.post(`${BACKEND_E2E_URL}/__e2e/reset-rate-limiters`);
      await oldSessionPage.request.delete(`${BACKEND_E2E_URL}/__e2e/emails`);

      // Sign in prior session on another device BEFORE reset
      await loginAs(oldSessionPage, resetFacEmail, TEST_PASSWORD, /\/faculty$/);

      // 1. Client email format validation + anti-enum on unregistered address
      await page.goto("/forgot-password");
      await page.locator("#forgot-email").fill("not-valid");
      await page.getByRole("button", { name: /Send reset link/i }).click();
      await expect(page.locator("#forgot-email-error")).toContainText("Enter a valid email address");

      await page.locator("#forgot-email").fill(`qa_s67_nobody_${runId}@test.local`);
      await page.getByRole("button", { name: /Send reset link/i }).click();
      await solveTestRecaptcha(page);
      await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
      await expect(page.getByText("If an account exists for that email, we've sent a reset link.")).toBeVisible();

      const { emails: noneMails } = await (await page.request.get(`${BACKEND_E2E_URL}/__e2e/emails`)).json();
      expect(noneMails.length).toBe(0);

      // 2. Registered user receives reset link email
      await page.getByRole("button", { name: /Try a different email address/i }).click();
      await page.locator("#forgot-email").fill(resetFacEmail);
      await page.getByRole("button", { name: /Send reset link/i }).click();
      await solveTestRecaptcha(page);
      await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();

      await expect
        .poll(async () => {
          const r = await (await page.request.get(`${BACKEND_E2E_URL}/__e2e/emails`)).json();
          return r.emails.find((m) => m.to === resetFacEmail && m.link.includes("/reset-password?token="))?.link || "";
        })
        .toContain("/reset-password?token=");

      const { emails } = await (await page.request.get(`${BACKEND_E2E_URL}/__e2e/emails`)).json();
      const resetMail = emails.find((m) => m.to === resetFacEmail);

      // 3. Boundary views on /reset-password: missing, invalid, expired
      await page.goto("/reset-password");
      await expect(page.getByRole("heading", { name: "Invalid reset link" })).toBeVisible();
      await page.goto("/reset-password?token=tampered123");
      await expect(page.getByRole("heading", { name: "Invalid reset link" })).toBeVisible();

      const expiredPair = generateToken();
      await prisma.passwordResetToken.create({
        data: { userId: resetFacUser.id, tokenHash: expiredPair.hash, expiresAt: new Date(Date.now() - 60_000) },
      });
      await page.goto(`/reset-password?token=${expiredPair.raw}`);
      await expect(page.getByRole("heading", { name: "Reset link expired" })).toBeVisible();

      // 4. Open valid reset link -> weak/mismatch disables submit -> valid resets pw & captures confirmation email
      const resetPath = new URL(resetMail.link).pathname + new URL(resetMail.link).search;
      await page.goto(resetPath);
      await expect(page.getByRole("heading", { name: "Choose a new password" })).toBeVisible();

      const submitBtn = page.getByRole("button", { name: "Reset password" });
      await page.locator("#reset-new-password").fill("short");
      await page.locator("#reset-confirm-password").fill("short");
      await expect(submitBtn).toBeDisabled();

      const newResetPw = "QaResetUiPassword1!";
      await page.locator("#reset-new-password").fill(newResetPw);
      await page.locator("#reset-confirm-password").fill("Mismatch1!");
      await expect(submitBtn).toBeDisabled();

      await page.locator("#reset-confirm-password").fill(newResetPw);
      await expect(submitBtn).toBeEnabled();
      await page.request.delete(`${BACKEND_E2E_URL}/__e2e/emails`);
      await submitBtn.click();

      await expect(page.getByRole("heading", { name: "Password updated" })).toBeVisible();

      await expect
        .poll(async () => {
          const r = await (await page.request.get(`${BACKEND_E2E_URL}/__e2e/emails`)).json();
          return r.emails.find((m) => m.to === resetFacEmail && /password was changed/i.test(m.subject))?.link || "";
        })
        .toContain("/login");

      // Old session revoked! Reload redirects to /login and /api/auth/me is 401
      expect((await oldSessionPage.request.get("/api/auth/me")).status()).toBe(401);
      await oldSessionPage.reload();
      await expect(oldSessionPage).toHaveURL(/\/login$/);

      // Link cannot be reused
      await page.goto(resetPath);
      await expect(page.getByRole("heading", { name: "Reset link already used" })).toBeVisible();

      // Old password fails; new password signs in
      await page.getByRole("link", { name: /Back to Login/i }).click();
      await page.locator("#login-email").fill(resetFacEmail);
      await page.locator("#login-password").fill(TEST_PASSWORD);
      await page.getByRole("button", { name: "Log in" }).click();
      await expect(page.getByRole("alert")).toContainText("Invalid email or password.");

      await page.locator("#login-password").fill(newResetPw);
      await page.getByRole("button", { name: "Log in" }).click();
      await expect(page).toHaveURL(/\/faculty$/);
    } finally {
      await oldSessionCtx.close();
      await ctx.close();
    }
  });

  test("PWD-08 E2E: AccountSettings Change password keeps Device A active & revokes Device B", async ({ browser }) => {
    test.setTimeout(60_000);
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();

    try {
      await pageA.request.post(`${BACKEND_E2E_URL}/__e2e/reset-rate-limiters`);
      await pageA.request.delete(`${BACKEND_E2E_URL}/__e2e/emails`);

      await loginAs(pageA, settingsStuEmail, TEST_PASSWORD, /\/student$/);
      await loginAs(pageB, settingsStuEmail, TEST_PASSWORD, /\/student$/);

      await pageA.goto("/settings");
      await expect(pageA.getByRole("heading", { name: "Change password" })).toBeVisible();

      const updateBtn = pageA.getByRole("button", { name: /Update password/i });

      // Wrong current password
      await pageA.locator("#settings-current-password").fill("WrongCurrent123!");
      await pageA.locator("#settings-new-password").fill("QaChangedUi123!");
      await pageA.locator("#settings-confirm-password").fill("QaChangedUi123!");
      await updateBtn.click();
      await expect(pageA.getByText("Current password is incorrect.")).toBeVisible();

      // Same as current password
      await pageA.locator("#settings-current-password").fill(TEST_PASSWORD);
      await pageA.locator("#settings-new-password").fill(TEST_PASSWORD);
      await pageA.locator("#settings-confirm-password").fill(TEST_PASSWORD);
      await updateBtn.click();
      await expect(pageA.getByText("New password must be different from your current password.")).toBeVisible();

      // Valid update
      const updatedPw = "QaChangedUi123!";
      await pageA.locator("#settings-current-password").fill(TEST_PASSWORD);
      await pageA.locator("#settings-new-password").fill(updatedPw);
      await pageA.locator("#settings-confirm-password").fill(updatedPw);
      await updateBtn.click();

      await expect(pageA.getByText(/Your password has been updated\./i)).toBeVisible();

      // Confirmation email captured
      await expect
        .poll(async () => {
          const r = await (await pageA.request.get(`${BACKEND_E2E_URL}/__e2e/emails`)).json();
          return r.emails.some((m) => m.to === settingsStuEmail && /password was changed/i.test(m.subject));
        })
        .toBe(true);

      // Device A stays authenticated after reload
      await pageA.reload();
      await expect(pageA).toHaveURL(/\/settings$/);
      expect((await pageA.request.get("/api/auth/me")).status()).toBe(200);

      // Device B is revoked with 401 & redirects to /login
      expect((await pageB.request.get("/api/auth/me")).status()).toBe(401);
      await pageB.reload();
      await expect(pageB).toHaveURL(/\/login$/);
    } finally {
      await ctxA.close();
      await ctxB.close();
    }
  });

  test("PWD-09..10 E2E: UI join pending alerts & Approve/Decline decision emails captured in stub mode", async ({ browser }) => {
    test.setTimeout(60_000);
    const stuCtx = await browser.newContext();
    const facCtx = await browser.newContext();
    const stuPage = await stuCtx.newPage();
    const facPage = await facCtx.newPage();

    try {
      await stuPage.request.delete(`${BACKEND_E2E_URL}/__e2e/emails`);

      // Student 1 joins class via /join/:code UI -> PENDING emails
      await loginAs(stuPage, joinStu1Email, TEST_PASSWORD, /\/student$/);
      await stuPage.goto(`/join/${joinClass.classCode}`);
      await stuPage.getByRole("button", { name: /Join class/i }).click();
      await solveTestRecaptcha(stuPage);
      await expect(stuPage).toHaveURL(/\/student$/);

      await expect
        .poll(async () => {
          const r = await (await stuPage.request.get(`${BACKEND_E2E_URL}/__e2e/emails`)).json();
          return (
            r.emails.some((m) => m.to === joinStu1Email && /pending/i.test(m.subject) && m.link.endsWith("/student")) &&
            r.emails.some((m) => m.to === joinFacEmail && /requested to join/i.test(m.subject) && m.link.includes(`/faculty/classes/${joinClass.id}`))
          );
        })
        .toBe(true);

      // Faculty approves Student 1 and declines Student 2 -> decision emails
      await facPage.request.delete(`${BACKEND_E2E_URL}/__e2e/emails`);
      await loginAs(facPage, joinFacEmail, TEST_PASSWORD, /\/faculty$/);
      await facPage.goto(`/faculty/classes/${joinClass.id}`);
      await facPage.locator("button.header-bell-trigger").click();
      const drawer = facPage.getByRole("dialog", { name: "Notifications" });
      await expect(drawer).toBeVisible();

      await drawer.locator("article.pending-row", { hasText: "Join One" }).getByRole("button", { name: "Approve" }).click();
      facPage.once("dialog", (d) => d.accept());
      await drawer.locator("article.pending-row", { hasText: "Join Two" }).getByRole("button", { name: "Decline" }).click();

      await expect
        .poll(async () => {
          const r = await (await facPage.request.get(`${BACKEND_E2E_URL}/__e2e/emails`)).json();
          return (
            r.emails.some((m) => m.to === joinStu1Email && /approved/i.test(m.subject) && m.link.endsWith("/student")) &&
            r.emails.some((m) => m.to === joinStu2Email && /declined/i.test(m.subject) && m.link.endsWith("/student"))
          );
        })
        .toBe(true);
    } finally {
      await stuCtx.close();
      await facCtx.close();
    }
  });
});
