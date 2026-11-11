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

async function allocId(basePrefix) {
  for (let i = 0; i < 40; i += 1) {
    const candidate = String(basePrefix + Math.floor(Math.random() * 9000)).padStart(7, "8");
    const [p, r] = await Promise.all([
      prisma.studentProfile.findUnique({ where: { studentId: candidate }, select: { id: true } }),
      prisma.classRoster.findFirst({ where: { studentId: candidate }, select: { id: true } }),
    ]);
    if (!p && !r) return candidate;
  }
  throw new Error("Unable to allocate unique E2E studentId");
}

async function loginAs(page, email, expectedUrl = /\/(faculty|student)$/) {
  await page.goto("/login");
  await page.locator("#login-email").fill(email);
  await page.locator("#login-password").fill(TEST_PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(expectedUrl, { timeout: 25_000 });
}

test.describe("SCRUM-64 Class Management & Join Workflow E2E (CLS-03, CLS-07, CLS-08, CLS-09, CLS-14)", () => {
  const runId = Date.now().toString(36).slice(-5);
  const facEmail = `qa_e2e_s64_fac_${runId}@test.local`;
  const stuActiveEmail = `qa_e2e_s64_stu_join_${runId}@test.local`;

  const createdUserEmails = [facEmail, stuActiveEmail];
  const createdClassIds = [];

  let facultyUser;
  let classWithRoster;
  let classStatusCheck;
  let classEmptyRoster;

  let takenCode;
  let newCreateCode;

  test.beforeAll(async () => {
    const hash = await bcrypt.hash(TEST_PASSWORD, 10);
    const suffixNum = Math.floor(100 + Math.random() * 800);
    takenCode = `Q64T${runId}`.slice(0, 12).toUpperCase();
    newCreateCode = `Q64N${runId}`.slice(0, 12).toUpperCase();

    facultyUser = await prisma.user.create({
      data: {
        name: "qa_E2E S64 Faculty",
        email: facEmail,
        password: hash,
        role: "FACULTY",
        emailVerified: true,
        emailVerifiedAt: new Date(),
        facultyProfile: {
          create: {
            name: "qa_E2E S64 Faculty",
            department: "Information Technology",
            email: facEmail,
          },
        },
      },
    });

    const idJoiner = await allocId(8510000);
    const idActiveRow = await allocId(8550000);
    const idDroppedRow = await allocId(8560000);
    const idStatusRow = await allocId(8570000);

    const createStudent = async (email, name, studentId) =>
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
              program: "BSIT",
              section: "3A",
              photo: SAMPLE_PHOTO,
            },
          },
        },
        include: { studentProfile: true },
      });

    await createStudent(stuActiveEmail, `qa_JoinerAlpha`, idJoiner);

    classWithRoster = await prisma.class.create({
      data: {
        facultyId: facultyUser.id,
        courseCode: "QA-64R",
        courseTitle: "qa_Roster Validation",
        sectionName: "qa_BSIT 3A-Val",
        classCode: takenCode,
        roster: {
          create: [
            {
              studentName: "Cruz, Angela",
              studentId: idActiveRow,
              firstName: "Angela",
              lastName: "Cruz",
              sortKey: "cruz",
            },
            {
              studentName: "Reyes, Marco",
              studentId: idDroppedRow,
              firstName: "Marco",
              lastName: "Reyes",
              sortKey: "reyes",
              droppedAt: new Date("2026-10-01T08:00:00.000Z"),
            },
          ],
        },
      },
      include: { roster: true },
    });
    classWithRoster._activeId = idActiveRow;
    classWithRoster._droppedId = idDroppedRow;
    createdClassIds.push(classWithRoster.id);

    classStatusCheck = await prisma.class.create({
      data: {
        facultyId: facultyUser.id,
        courseCode: "QA-64S",
        courseTitle: "qa_Roster Status Undo",
        sectionName: "qa_BSIT 3B-Status",
        classCode: `Q64S${runId}`.slice(0, 12).toUpperCase(),
        roster: {
          create: [
            {
              studentName: "Santos, Ana",
              studentId: idStatusRow,
              firstName: "Ana",
              lastName: "Santos",
              sortKey: "santos",
            },
          ],
        },
      },
    });
    createdClassIds.push(classStatusCheck.id);

    classEmptyRoster = await prisma.class.create({
      data: {
        facultyId: facultyUser.id,
        courseCode: "QA-64E",
        courseTitle: "qa_Empty Invite Check",
        sectionName: "qa_BSCS 1A-Empty",
        classCode: `Q64E${runId}`.slice(0, 12).toUpperCase(),
      },
    });
    createdClassIds.push(classEmptyRoster.id);


  });

  test.afterAll(async () => {
    await prisma.class.deleteMany({
      where: {
        OR: [
          { id: { in: createdClassIds } },
          { classCode: newCreateCode },
          { faculty: { email: facEmail } },
        ],
      },
    });
    await prisma.user.deleteMany({ where: { email: { in: createdUserEmails } } });
    await prisma.$disconnect();
  });

  test("CLS-03: Create class form validation, live code availability check, & class creation", async ({ page }) => {
    await loginAs(page, facEmail, /\/faculty$/);

    await page.goto("/faculty/classes/new");

    // Empty submit triggers inline required field validation
    await page.getByRole("button", { name: /Create class/i }).click();
    await expect(page.getByText("Section name is required.")).toBeVisible();

    await page.getByRole("textbox", { name: /^Course code/i }).fill("IT 641");
    await page.getByRole("textbox", { name: /^Course title/i }).fill("qa_Quality Assurance UI");
    await page.getByRole("textbox", { name: /^Section name/i }).fill("qa_BSIT 4A");

    // Live check for an already taken class code
    const codeInput = page.getByRole("textbox", { name: /^Class code/i });
    await codeInput.fill(takenCode);
    await expect(page.getByText(/That code is taken\. Try another\./i)).toBeVisible();
    await expect(page.getByRole("button", { name: /Create class/i })).toBeDisabled();

    // Switch to unique code
    await codeInput.fill(newCreateCode);
    await expect(page.getByText(/This code is available\./i)).toBeVisible();
    await expect(page.getByRole("button", { name: /Create class/i })).toBeEnabled();

    // Schedule day pills + 30-min time dropdowns
    await page.getByRole("button", { name: "Monday" }).click();
    await page.getByRole("button", { name: "Wednesday" }).click();
    await page.getByLabel("Start time").selectOption("08:00");
    await page.getByLabel("End time").selectOption("09:30");
    await expect(page.getByText(/Mon, Wed · 8:00 AM – 9:30 AM/)).toBeVisible();

    await page.getByRole("button", { name: /Create class/i }).click();
    await expect(page).toHaveURL(/\/faculty$/);
    await expect(page.getByText(new RegExp(`Invite code: ${newCreateCode}`))).toBeVisible();

    // Open created class card and confirm /faculty/classes/:id loads
    const createdCard = page.locator("article.class-card", { hasText: newCreateCode });
    await expect(createdCard).toBeVisible();
    await createdCard.getByRole("link", { name: /Open class|Take attendance/i }).click();
    await expect(page).toHaveURL(/\/faculty\/classes\/.+/);
    await expect(page.getByRole("heading", { name: /qa_Quality Assurance UI/i })).toBeVisible();
  });

  test("CLS-07 & CLS-08: Student List Add Student inline validation & paste two-way duplicate check", async ({ page }) => {
    await loginAs(page, facEmail, /\/faculty$/);
    await page.goto(`/faculty/classes/${classWithRoster.id}`);
    await page.locator("#module-tab-student-list").click();

    // Wait for both active roster (1) and drop list (1) to finish loading
    await expect(page.getByRole("tab", { name: /Drop List \(1\)/i })).toBeVisible();
    await expect(page.locator("table.student-list-table tbody tr")).toHaveCount(1);

    const nameInput = page.getByLabel("Student name");
    const idInput = page.getByLabel("7-digit student ID");
    const addBtn = page.getByRole("button", { name: /Add student/i });

    // CLS-07 invalid cases
    await idInput.fill("8812345");
    await addBtn.click();
    await expect(page.locator(".student-list-entry-error")).toContainText("Missing name.");
    await expect(nameInput).toHaveClass(/input-invalid/);

    await nameInput.fill("A");
    await addBtn.click();
    await expect(page.locator(".student-list-entry-error")).toContainText("Enter a valid student name.");

    await nameInput.fill("123456");
    await addBtn.click();
    await expect(page.locator(".student-list-entry-error")).toContainText("Enter a valid student name.");

    await nameInput.fill("Valid Student");
    await idInput.fill("123456");
    await addBtn.click();
    await expect(page.locator(".student-list-entry-error")).toContainText("Student ID must be exactly 7 digits.");
    await expect(idInput).toHaveClass(/input-invalid/);

    await idInput.fill(classWithRoster._activeId);
    await addBtn.click();
    await expect(page.locator(".student-list-entry-error")).toContainText("already in this student list");

    await idInput.fill(classWithRoster._droppedId);
    await addBtn.click();
    await expect(page.locator(".student-list-entry-error")).toContainText("is in the Drop List");

    // Still only 1 row in table
    await expect(page.locator("table.student-list-table tbody tr")).toHaveCount(1);

    // CLS-08 paste rows including various formats & duplicate pair
    await page.getByLabel("Paste one student per line").fill([
      "Alex Santos, 2300039",
      "Dela Cruz, Juan, 2300040",
      "2300041, Maria Reyes",
      "Liza Soberano\t2300042",
      "Dup Alpha, 2300099",
      "Dup Beta, 2300099",
    ].join("\n"));
    await page.getByRole("button", { name: "Add pasted rows" }).click();

    const rows = page.locator("table.student-list-table tbody tr");
    await expect(rows).toHaveCount(7);

    // Check parsed valid rows
    const rowValues = await rows.evaluateAll((trs) =>
      trs.map((tr) => {
        const inputs = tr.querySelectorAll("input");
        return {
          name: inputs[0]?.value || "",
          id: inputs[1]?.value || "",
          idInvalid: inputs[1]?.classList.contains("input-invalid") || false,
          statusText: tr.querySelector("td:nth-child(3)")?.textContent?.trim() || "",
        };
      }),
    );

    expect(rowValues.find((r) => r.id === "2300039")?.name).toBe("Alex Santos");
    expect(rowValues.find((r) => r.id === "2300040")?.name).toBe("Dela Cruz, Juan");
    expect(rowValues.find((r) => r.id === "2300041")?.name).toBe("Maria Reyes");
    expect(rowValues.find((r) => r.id === "2300042")?.name).toBe("Liza Soberano");

    const dupRows = rowValues.filter((r) => r.id === "2300099");
    expect(dupRows).toHaveLength(2);
    for (const d of dupRows) {
      expect(d.idInvalid).toBe(true);
      expect(d.statusText).toMatch(/Duplicate student ID \(also row \d+\)/);
    }
    await expect(page.locator(".student-list-preview-heading button.button-primary")).toBeDisabled();

    // Discard unsaved edits when leaving cleanly
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Close" }).click();
  });

  test("CLS-09: Student List Saved vs Edited · Ready to save & Undo revert", async ({ page }) => {
    await loginAs(page, facEmail, /\/faculty$/);
    await page.goto(`/faculty/classes/${classStatusCheck.id}`);
    await page.locator("#module-tab-student-list").click();

    const firstRow = page.locator("table.student-list-table tbody tr").first();
    await expect(firstRow.locator("td:nth-child(3)")).toHaveText("Saved");
    const saveBtn = page.locator(".student-list-preview-heading button.button-primary");
    await expect(saveBtn).toHaveText("Saved");
    await expect(saveBtn).toBeDisabled();

    // Edit existing row -> Edited · Ready to save + Undo
    const rowNameInput = firstRow.locator("input").first();
    await rowNameInput.fill("Santos, Ana Edited");
    await expect(firstRow.locator("td:nth-child(3)")).toContainText("Edited · Ready to save");
    const undoBtn = firstRow.getByRole("button", { name: "Undo" });
    await expect(undoBtn).toBeVisible();
    await expect(saveBtn).toHaveText("Save student list");
    await expect(saveBtn).toBeEnabled();

    // Undo reverts to Saved
    await undoBtn.click();
    await expect(rowNameInput).toHaveValue("Santos, Ana");
    await expect(firstRow.locator("td:nth-child(3)")).toHaveText("Saved");
    await expect(saveBtn).toHaveText("Saved");
    await expect(saveBtn).toBeDisabled();

    // Add new row -> New · Ready to save -> Save persists
    await page.getByLabel("Student name").fill("qa_Fresh Unsaved");
    await page.getByLabel("7-digit student ID").fill("8899112");
    await page.getByRole("button", { name: /Add student/i }).click();
    const secondRow = page.locator("table.student-list-table tbody tr").nth(1);
    await expect(secondRow.locator("td:nth-child(3)")).toHaveText("New · Ready to save");
    await expect(saveBtn).toHaveText("Save student list");
    await expect(saveBtn).toBeEnabled();

    await saveBtn.click();
    await expect(page.getByText(/Student list saved/i)).toBeVisible();
    await expect(secondRow.locator("td:nth-child(3)")).toHaveText("Saved");
    await expect(saveBtn).toHaveText("Saved");
    await expect(saveBtn).toBeDisabled();
  });

  test("CLS-14: Empty-roster invite confirmation dialog & /join/:code invite link flow", async ({ browser }) => {
    test.setTimeout(120_000);
    // Part A: Faculty empty-roster invite confirmation
    const facContext = await browser.newContext({ permissions: ["clipboard-read", "clipboard-write"] });
    const facPage = await facContext.newPage();
    try {
      await loginAs(facPage, facEmail, /\/faculty$/);
      const emptyDeckLoaded = facPage.waitForResponse(
        (res) => res.url().includes(`/api/classes/${classEmptyRoster.id}/deck`) && res.request().method() === "GET" && res.status() === 200,
      );
      await facPage.goto(`/faculty/classes/${classEmptyRoster.id}`);
      await emptyDeckLoaded;
      await expect(facPage.getByRole("heading", { name: /Student deck/i })).toBeVisible();

      await facPage.getByRole("button", { name: "Invite", exact: true }).click();
      const copyBtn = facPage.locator("#class-shell-invite-popover").getByRole("button", { name: "Copy invite link" });

      // Dismiss confirmation -> no copy toast
      facPage.once("dialog", async (dialog) => {
        expect(dialog.message()).toContain("haven't added a student list yet");
        await dialog.dismiss();
      });
      await copyBtn.click();
      await expect(facPage.getByText("Invite link copied. Share it with your students.")).toHaveCount(0);

      // Accept confirmation -> copies link & shows toast
      facPage.once("dialog", async (dialog) => {
        expect(dialog.message()).toContain("haven't added a student list yet");
        await dialog.accept();
      });
      await copyBtn.click();
      await expect(facPage.getByText(/Invite link copied|Copy unavailable/i)).toBeVisible();
    } finally {
      await facContext.close();
    }

    // Part B: Student opens /join/:code invite link and submits join via Google test reCAPTCHA
    const stuContext = await browser.newContext();
    const stuPage = await stuContext.newPage();
    try {
      await installRecaptchaIpv4Relay(stuPage);
      await loginAs(stuPage, stuActiveEmail, /\/student$/);

      await stuPage.goto(`/join/${classEmptyRoster.classCode}`);
      const codeInput = stuPage.getByLabel(/Class invite code/i);
      await expect(codeInput).toHaveValue(classEmptyRoster.classCode);

      await stuPage.getByRole("button", { name: /Join class/i }).click();
      const captchaModal = stuPage.getByRole("dialog", { name: "Security check" });
      await expect(captchaModal).toBeVisible();

      const recaptchaFrame = stuPage.frameLocator('iframe[title="reCAPTCHA"]');
      await expect(recaptchaFrame.locator("#recaptcha-anchor")).toBeVisible({ timeout: 25_000 });
      await recaptchaFrame.locator("#recaptcha-anchor").click();

      await expect(stuPage).toHaveURL(/\/student$/, { timeout: 20_000 });
      await expect(stuPage.getByText(/Waiting for instructor approval/i)).toBeVisible();
    } finally {
      await stuContext.close();
    }
  });

});

test.describe("SCRUM-64 Pending Validation Drawer (CLS-17)", () => {
  test.afterAll(async () => {
    await prisma.$disconnect();
  });

  test("CLS-17: Pending validation drawer bell badge count & Approve/Decline actions", async ({ page }) => {
    test.setTimeout(90_000);
    const isoId = `${Date.now().toString(36).slice(-4)}${Math.random().toString(36).slice(2, 5)}`;
    const isoFacEmail = `qa_e2e_cls17_fac_${isoId}@test.local`;
    const isoP1Email = `qa_e2e_cls17_p1_${isoId}@test.local`;
    const isoP2Email = `qa_e2e_cls17_p2_${isoId}@test.local`;
    const isoA3Email = `qa_e2e_cls17_a3_${isoId}@test.local`;
    const isoEmails = [isoFacEmail, isoP1Email, isoP2Email, isoA3Email];
    let isoClassId = null;

    try {
      const hash = await bcrypt.hash(TEST_PASSWORD, 10);
      const idPend1 = await allocId(8520000);
      const idPend2 = await allocId(8530000);
      const idAuto3 = await allocId(8540000);

      const isoFac = await prisma.user.create({
        data: {
          name: "qa_E2E CLS17 Faculty",
          email: isoFacEmail,
          password: hash,
          role: "FACULTY",
          emailVerified: true,
          emailVerifiedAt: new Date(),
          facultyProfile: {
            create: { name: "qa_E2E CLS17 Faculty", department: "IT", email: isoFacEmail },
          },
        },
      });

      const mkStu = (email, name, studentId) =>
        prisma.user.create({
          data: {
            name,
            email,
            password: hash,
            role: "STUDENT",
            emailVerified: true,
            emailVerifiedAt: new Date(),
            studentProfile: {
              create: { name, studentId, email, program: "BSIT", section: "3C", photo: SAMPLE_PHOTO },
            },
          },
          include: { studentProfile: true },
        });

      const isoPend1 = await mkStu(isoP1Email, "qa_PendingApprove Alpha", idPend1);
      const isoPend2 = await mkStu(isoP2Email, "qa_PendingDecline Beta", idPend2);
      const isoAuto3 = await mkStu(isoA3Email, "qa_AutoApproved Gamma", idAuto3);

      const isoClass = await prisma.class.create({
        data: {
          facultyId: isoFac.id,
          courseCode: "QA-17P",
          courseTitle: "qa_Pending Notifications UI",
          sectionName: "qa_BSIT 3C-Pending",
          classCode: `Q17P${isoId}`.slice(0, 12).toUpperCase(),
          roster: {
            create: [
              {
                studentName: isoAuto3.studentProfile.name,
                studentId: isoAuto3.studentProfile.studentId,
                firstName: isoAuto3.studentProfile.name,
                sortKey: "auto",
              },
            ],
          },
          enrollments: {
            create: [
              { studentProfileId: isoPend1.studentProfile.id, status: "PENDING" },
              { studentProfileId: isoPend2.studentProfile.id, status: "PENDING" },
              {
                studentProfileId: isoAuto3.studentProfile.id,
                status: "APPROVED",
                autoApprovedAt: new Date(),
                autoApprovalReadAt: null,
              },
            ],
          },
        },
      });
      isoClassId = isoClass.id;

      await loginAs(page, isoFacEmail, /\/faculty$/);
      const deckLoaded = page.waitForResponse(
        (res) => res.url().includes(`/api/classes/${isoClassId}/deck`) && res.request().method() === "GET" && res.status() === 200,
      );
      const pendingLoaded = page.waitForResponse(
        (res) => res.url().includes(`/api/classes/${isoClassId}/pending`) && res.request().method() === "GET" && res.status() === 200,
      );
      await page.goto(`/faculty/classes/${isoClassId}`);
      await Promise.all([deckLoaded, pendingLoaded]);

      // Bell badge counts 2 pending + 1 unread auto-approved = 3
      const bellBtn = page.locator("button.header-bell-trigger");
      await expect(bellBtn.locator(".header-bell-badge")).toHaveText("3");
      await bellBtn.click();

      const drawer = page.getByRole("dialog", { name: "Notifications" });
      await expect(drawer).toBeVisible();

      const approveRow = drawer.locator("article.pending-row", { hasText: idPend1 });
      const declineRow = drawer.locator("article.pending-row", { hasText: idPend2 });
      await expect(approveRow).toBeVisible();
      await expect(declineRow).toBeVisible();

      const approvePatch = page.waitForResponse(
        (res) => res.url().includes(`/api/classes/${isoClassId}/pending/`) && res.request().method() === "PATCH" && res.status() === 200,
      );
      await approveRow.getByRole("button", { name: "Approve" }).click();
      await approvePatch;
      await expect(approveRow).toHaveCount(0);

      const declinePatch = page.waitForResponse(
        (res) => res.url().includes(`/api/classes/${isoClassId}/pending/`) && res.request().method() === "PATCH" && res.status() === 200,
      );
      page.once("dialog", (dialog) => dialog.accept());
      await declineRow.getByRole("button", { name: "Decline" }).click();
      await declinePatch;
      await expect(declineRow).toHaveCount(0);

      await drawer.getByRole("button", { name: "Close notifications" }).click();
      await expect(bellBtn.locator(".header-bell-badge")).toHaveText("1");

      // Approved student now on Class Deck; declined student absent
      const grid = page.locator(".student-grid");
      await expect(grid).toContainText(idPend1);
      await expect(grid).not.toContainText(idPend2);
    } finally {
      if (isoClassId) {
        await prisma.class.deleteMany({ where: { id: isoClassId } }).catch(() => {});
      }
      await prisma.user.deleteMany({ where: { email: { in: isoEmails } } }).catch(() => {});
    }
  });
});
