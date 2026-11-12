import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { test, expect } from "@playwright/test";

const require = createRequire(import.meta.url);
const { loadBackendTestEnv } = require("../scripts/load-test-env.cjs");
loadBackendTestEnv();

const bcrypt = require("../../classdex-backend/node_modules/bcryptjs");
const XLSX = require("../../classdex-backend/node_modules/xlsx");
const { prisma } = require("../../classdex-backend/db");

const TEST_PASSWORD = "QaPassword123!";
const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const SAMPLE_PHOTO = `data:image/png;base64,${TINY_PNG_BASE64}`;
const ALT_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEklEQVR42mP8z8BQzwAEjFAMAA8AAwH6o+mCAAAAAElFTkSuQmCC";

test.describe("SCRUM-66 Student Dashboard & Export E2E (STU-04..07, EXP-07)", () => {
  const runId = Date.now().toString(36).slice(-5);
  const fac1Email = `qa_e2e_s66_fac1_${runId}@test.local`;
  const fac2Email = `qa_e2e_s66_fac2_${runId}@test.local`;
  const stu1Email = `qa_e2e_s66_stu1_${runId}@test.local`;
  const stu2Email = `qa_e2e_s66_stu2_${runId}@test.local`;
  const createdEmails = [fac1Email, fac2Email, stu1Email, stu2Email];
  const createdClassIds = [];

  let fac1;
  let fac2;
  let stu1;
  let stu2;
  let classA;
  let classB;
  let droppedClass;
  let archivedClass;
  let sessionA;

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

  async function loginAs(page, email, expectedUrlRe) {
    await page.goto("/login");
    await page.locator("#login-email").fill(email);
    await page.locator("#login-password").fill(TEST_PASSWORD);
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page).toHaveURL(expectedUrlRe, { timeout: 25_000 });
  }

  test.beforeAll(async ({}, testInfo) => {
    testInfo.setTimeout(90_000);
    const hash = await bcrypt.hash(TEST_PASSWORD, 10);

    [fac1, fac2] = await Promise.all([
      prisma.user.create({
        data: {
          name: "qa_E2E S66 Faculty One",
          email: fac1Email,
          password: hash,
          role: "FACULTY",
          emailVerified: true,
          emailVerifiedAt: new Date(),
          facultyProfile: {
            create: { name: "qa_E2E S66 Faculty One", department: "IT", email: fac1Email },
          },
        },
      }),
      prisma.user.create({
        data: {
          name: "qa_E2E S66 Faculty Two",
          email: fac2Email,
          password: hash,
          role: "FACULTY",
          emailVerified: true,
          emailVerifiedAt: new Date(),
          facultyProfile: {
            create: { name: "qa_E2E S66 Faculty Two", department: "CS", email: fac2Email },
          },
        },
      }),
    ]);

    const [id1, id2] = await Promise.all([allocId(8510000), allocId(8520000)]);
    const createStu = (email, firstName, lastName, studentId) =>
      prisma.user.create({
        data: {
          name: `${firstName} ${lastName}`,
          email,
          password: hash,
          role: "STUDENT",
          emailVerified: true,
          emailVerifiedAt: new Date(),
          studentProfile: {
            create: {
              name: `${firstName} ${lastName}`,
              firstName,
              lastName,
              sortKey: `${lastName.toUpperCase()} ${firstName.toUpperCase()}`,
              studentId,
              email,
              program: "BSIT",
              section: "3A",
              address: "Tacloban City",
              photo: SAMPLE_PHOTO,
            },
          },
        },
        include: { studentProfile: true },
      });

    [stu1, stu2] = await Promise.all([
      createStu(stu1Email, "qa_Clara", "Cards", id1),
      createStu(stu2Email, "qa_David", "Deck", id2),
    ]);

    [classA, classB, droppedClass, archivedClass] = await Promise.all([
      prisma.class.create({
        data: {
          facultyId: fac1.id,
          sectionName: "qa_S66 Primary 3A",
          courseCode: "IT 166",
          courseTitle: "qa_Student Export E2E A",
          classCode: `Q66A${runId}`.toUpperCase().slice(0, 12),
          schedule: "Mon · 8:00 AM – 9:30 AM",
          projects: { create: [{ type: "MIDTERM", maxScore: 100 }, { type: "FINALS", maxScore: 100 }] },
        },
        include: { projects: true },
      }),
      prisma.class.create({
        data: {
          facultyId: fac1.id,
          sectionName: "qa_S66 Second 3B",
          courseCode: "IT 167",
          courseTitle: "qa_Student Export E2E B",
          classCode: `Q66B${runId}`.toUpperCase().slice(0, 12),
          schedule: "Tue · 10:00 AM – 11:30 AM",
          projects: { create: [{ type: "MIDTERM", maxScore: 100 }, { type: "FINALS", maxScore: 100 }] },
        },
        include: { projects: true },
      }),
      prisma.class.create({
        data: {
          facultyId: fac2.id,
          sectionName: "qa_S66 Dropped 2A",
          courseCode: "IT 168",
          courseTitle: "qa_Dropped Read Only",
          classCode: `Q66D${runId}`.toUpperCase().slice(0, 12),
          projects: { create: [{ type: "MIDTERM", maxScore: 50 }] },
        },
        include: { projects: true },
      }),
      prisma.class.create({
        data: {
          facultyId: fac1.id,
          sectionName: "qa_S66 Archived 1A",
          courseCode: "IT 169",
          courseTitle: "qa_Archived Index Card",
          classCode: `Q66Z${runId}`.toUpperCase().slice(0, 12),
          archivedAt: new Date("2026-10-25T00:00:00Z"),
          projects: { create: [{ type: "MIDTERM", maxScore: 100 }] },
        },
        include: { projects: true },
      }),
    ]);
    createdClassIds.push(classA.id, classB.id, droppedClass.id, archivedClass.id);

    const dropAt = new Date("2026-10-21T08:00:00Z");
    await Promise.all([
      prisma.classEnrollment.createMany({
        data: [
          { classId: classA.id, studentProfileId: stu1.studentProfile.id, status: "APPROVED" },
          { classId: classA.id, studentProfileId: stu2.studentProfile.id, status: "APPROVED" },
          { classId: classB.id, studentProfileId: stu1.studentProfile.id, status: "APPROVED" },
          { classId: droppedClass.id, studentProfileId: stu1.studentProfile.id, status: "DROPPED", droppedAt: dropAt },
          { classId: archivedClass.id, studentProfileId: stu1.studentProfile.id, status: "APPROVED" },
        ],
      }),
      prisma.classRoster.createMany({
        data: [
          { classId: classA.id, studentId: stu1.studentProfile.studentId, studentName: stu1.name, firstName: "qa_Clara", lastName: "Cards", sortKey: "CARDS QA_CLARA" },
          { classId: classA.id, studentId: stu2.studentProfile.studentId, studentName: stu2.name, firstName: "qa_David", lastName: "Deck", sortKey: "DECK QA_DAVID" },
          { classId: classB.id, studentId: stu1.studentProfile.studentId, studentName: stu1.name, firstName: "qa_Clara", lastName: "Cards", sortKey: "CARDS QA_CLARA" },
          { classId: droppedClass.id, studentId: stu1.studentProfile.studentId, studentName: stu1.name, firstName: "qa_Clara", lastName: "Cards", sortKey: "CARDS QA_CLARA", droppedAt: dropAt },
          { classId: archivedClass.id, studentId: stu1.studentProfile.studentId, studentName: stu1.name, firstName: "qa_Clara", lastName: "Cards", sortKey: "CARDS QA_CLARA" },
        ],
      }),
    ]);

    const oct10 = new Date("2026-10-10T00:00:00.000Z");
    let dropSess;
    let archSess;
    [sessionA, dropSess, archSess] = await Promise.all([
      prisma.classSession.create({ data: { classId: classA.id, date: oct10, startedAt: oct10 } }),
      prisma.classSession.create({ data: { classId: droppedClass.id, date: oct10, startedAt: oct10 } }),
      prisma.classSession.create({ data: { classId: archivedClass.id, date: oct10, startedAt: oct10 } }),
    ]);

    await prisma.attendanceRecord.createMany({
      data: [
        { sessionId: sessionA.id, studentId: stu1.studentProfile.id, status: "PRESENT" },
        { sessionId: sessionA.id, studentId: stu2.studentProfile.id, status: "LATE" },
        { sessionId: dropSess.id, studentId: stu1.studentProfile.id, status: "PRESENT" },
        { sessionId: archSess.id, studentId: stu1.studentProfile.id, status: "ABSENT" },
      ],
    });

    await prisma.recitationLog.createMany({
      data: [
        { sessionId: sessionA.id, studentId: stu1.studentProfile.id, method: "RANDOM", score: 5 },
        { sessionId: dropSess.id, studentId: stu1.studentProfile.id, method: "WEIGHTED", score: 4 },
        { sessionId: archSess.id, studentId: stu1.studentProfile.id, method: "RANDOM", score: 3 },
      ],
    });

    const [actA, actDrop] = await Promise.all([
      prisma.activity.create({ data: { classId: classA.id, sessionId: sessionA.id, title: "Activity 1A", maxScore: 50 } }),
      prisma.activity.create({ data: { classId: droppedClass.id, sessionId: dropSess.id, title: "Archived Lab", maxScore: 25 } }),
    ]);
    await prisma.activityScore.createMany({
      data: [
        { activityId: actA.id, studentId: stu1.studentProfile.id, score: 47, isAbsent: false },
        { activityId: actDrop.id, studentId: stu1.studentProfile.id, score: 22, isAbsent: false },
      ],
    });

    const midA = classA.projects.find((p) => p.type === "MIDTERM");
    const midArch = archivedClass.projects.find((p) => p.type === "MIDTERM");
    await prisma.projectScore.createMany({
      data: [
        { projectId: midA.id, studentId: stu1.studentProfile.id, sessionId: sessionA.id, score: 91, isAbsent: false },
        { projectId: midArch.id, studentId: stu1.studentProfile.id, sessionId: archSess.id, score: 85, isAbsent: false },
      ],
    });

    const [qA, qArch] = await Promise.all([
      prisma.quizSession.create({ data: { classId: classA.id, title: "S66 Quiz One", totalItems: 20, date: oct10 } }),
      prisma.quizSession.create({ data: { classId: archivedClass.id, title: "Archived Quiz", totalItems: 10, date: oct10 } }),
    ]);
    await prisma.quizScore.createMany({
      data: [
        { sessionId: qA.id, studentId: stu1.studentProfile.id, score: 18, isAbsent: false },
        { sessionId: qArch.id, studentId: stu1.studentProfile.id, score: 8, isAbsent: false },
      ],
    });
  });

  test.afterAll(async () => {
    if (createdClassIds.length) {
      await prisma.class.deleteMany({ where: { id: { in: createdClassIds } } });
    }
    await prisma.user.deleteMany({ where: { email: { in: createdEmails } } });
    await prisma.$disconnect();
  });

  test("STU-04: Student UI read-only enforcement & faculty mutation RBAC 403", async ({ page }) => {
    await loginAs(page, stu1Email, /\/student$/);

    await expect(page.getByText("qa_S66 Primary 3A")).toBeVisible();
    await expect(page.getByText("qa_S66 Dropped 2A")).toBeVisible();

    // Student dashboard has no faculty edit/delete/archive controls
    for (const label of ["Edit class", "Archive class", "Create a class", "Delete", "Save student list"]) {
      await expect(page.getByRole("button", { name: new RegExp(label, "i") })).toHaveCount(0);
    }

    // Active class read-only inline index card
    await page.goto(`/student/classes/${classA.id}`);
    await expect(page.getByRole("region", { name: /Cards|Clara/i })).toBeVisible({ timeout: 20_000 });
    await expect(page.locator(".index-card")).not.toHaveClass(/is-flipped/);
    await expect(page.locator(".index-card-back")).toHaveAttribute("aria-hidden", "true");
    await page.getByRole("button", { name: "Flip card" }).first().click();
    await expect(page.locator(".index-card")).toHaveClass(/is-flipped/);
    await expect(page.locator(".index-card-back")).toHaveAttribute("aria-hidden", "false");
    await expect(page.getByText("S66 Quiz One")).toBeVisible();
    await expect(page.getByText("Activity 1A")).toBeVisible();
    await expect(page.getByText("91 / 100")).toBeVisible();
    for (const forbidden of ["Edit class", "Start attendance", "Shuffle", "New activity", "New quiz", "Export"]) {
      await expect(page.getByRole("button", { name: new RegExp(forbidden, "i") })).toHaveCount(0);
    }

    // Dropped class read-only retention banner + historical records
    await page.goto(`/student/classes/${droppedClass.id}`);
    await expect(page.getByText(/You were dropped from this class/i)).toBeVisible({ timeout: 20_000 });
    await page.getByRole("button", { name: "Flip card" }).first().click();
    await expect(page.getByText("Archived Lab")).toBeVisible();

    // Direct API mutations as student return 403
    const endpoints = [
      { method: "post", url: "/api/classes", data: { sectionName: "Hacked" } },
      { method: "patch", url: `/api/classes/${classA.id}`, data: { sectionName: "Hacked" } },
      { method: "put", url: `/api/sessions/${sessionA.id}/attendance/${stu1.studentProfile.id}`, data: { status: "PRESENT" } },
      { method: "post", url: `/api/classes/${classA.id}/quizzes`, data: { title: "Hack", totalItems: 10 } },
      { method: "delete", url: `/api/classes/${classA.id}` },
    ];
    for (const ep of endpoints) {
      const res = await page.request[ep.method](ep.url, ep.data ? { data: ep.data } : undefined);
      expect(res.status(), `${ep.method.toUpperCase()} ${ep.url} should be 403 for student`).toBe(403);
    }
  });

  test("STU-07: Student profile photo validation & dev data-URL upload fallback", async ({ page }) => {
    await loginAs(page, stu1Email, /\/student$/);
    await page.goto("/student/profile");
    await expect(page.getByLabel(/Full name/i)).toBeVisible();

    const fileInput = page.locator('input[type="file"]');

    // 1. Reject unsupported .txt
    await fileInput.setInputFiles({
      name: "notes.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("not an image"),
    });
    await expect(page.getByRole("alert")).toContainText("Choose a JPG, PNG, or WebP image.");

    // 2. Reject unsupported .gif
    await fileInput.setInputFiles({
      name: "anim.gif",
      mimeType: "image/gif",
      buffer: Buffer.from("GIF89a"),
    });
    await expect(page.getByRole("alert")).toContainText("Choose a JPG, PNG, or WebP image.");

    // 3. Reject > 5 MB PNG
    await fileInput.setInputFiles({
      name: "huge.png",
      mimeType: "image/png",
      buffer: Buffer.alloc(5 * 1024 * 1024 + 256, 0x41),
    });
    await expect(page.getByRole("alert")).toContainText("Choose an image smaller than 5 MB.");

    // 4. Intercept external Cloudinary (if configured) so dev fallback data URL is exercised deterministically
    await page.route("https://api.cloudinary.com/**", (route) => route.abort());

    const altPngBuffer = Buffer.from(ALT_PNG_BASE64, "base64");
    await fileInput.setInputFiles({
      name: "valid-avatar.png",
      mimeType: "image/png",
      buffer: altPngBuffer,
    });
    await expect(page.getByRole("alert")).toHaveCount(0);
    await expect(page.locator(".photo-preview img")).toHaveAttribute("src", new RegExp(ALT_PNG_BASE64.slice(0, 20)));

    await page.getByRole("button", { name: /Save index card/i }).click();
    await expect(page).toHaveURL(/\/student$/);
    await expect(page.getByText("Your index card has been saved.")).toBeVisible();

    // Reload profile and verify saved photo persisted in DB
    await page.goto("/student/profile");
    await expect(page.getByLabel(/Full name/i)).toBeVisible();
    await page.reload();
    const profileRes = await page.request.get("/api/student/profile");
    expect(profileRes.status()).toBe(200);
    const { profile } = await profileRes.json();
    expect(profile.photo).toContain(ALT_PNG_BASE64.slice(0, 20));
  });

  test("STU-05: Student profile edits propagate across multiple joined classes", async ({ page }) => {
    test.setTimeout(60_000);
    await loginAs(page, stu1Email, /\/student$/);
    await page.goto("/student/profile");
    await expect(page.getByLabel(/Full name/i)).toBeVisible();

    await page.getByLabel(/Full name/i).fill("qa_Clara Updated");
    await page.getByLabel(/^Program$/i).fill("BSCS");
    await page.getByLabel(/^Section$/i).fill("CS4B");
    await page.locator('label.field:has-text("Address") textarea').fill("Ormoc City, Leyte");
    await page.getByRole("button", { name: /Save index card/i }).click();

    await expect(page).toHaveURL(/\/student$/);
    await expect(page.getByText("Your index card has been saved.")).toBeVisible();

    // Both joined classes show updated name/program/section for the student
    for (const clsId of [classA.id, classB.id]) {
      await page.goto(`/student/classes/${clsId}`);
      await expect(page.locator("#student-detail-title")).toContainText(/Updated/i, { timeout: 20_000 });
      await expect(page.locator(".student-detail-info")).toContainText("BSCS");
      await expect(page.locator(".student-detail-info")).toContainText("CS4B");
    }

    // Faculty Class Deck + modal index card for BOTH classes reflects updated student profile (incl. address)
    const facCtx = await page.context().browser().newContext({ baseURL: page.url() });
    const facPage = await facCtx.newPage();
    try {
      await loginAs(facPage, fac1Email, /\/faculty$/);
      for (const clsId of [classA.id, classB.id]) {
        await facPage.goto(`/faculty/classes/${clsId}`);
        const card = facPage.locator("article.student-card").filter({ hasText: "Updated" });
        await expect(card).toBeVisible({ timeout: 20_000 });
        await expect(card).toContainText("BSCS");
        await expect(card).toContainText("CS4B");
      }
      await facPage.getByRole("button", { name: /Open .*'s index card profile and class records/i }).filter({ hasText: "Updated" }).click();
      await expect(facPage.getByRole("dialog").locator(".student-detail-info")).toContainText("Ormoc City, Leyte");
      await facPage.getByRole("button", { name: "Close student profile" }).click();
    } finally {
      await facCtx.close();
    }

    // Also expect student's own inline index card to reflect updated address (DEF-09)
    await page.goto(`/student/classes/${classA.id}`);
    await expect(page.locator(".student-detail-info")).toContainText("Ormoc City, Leyte", { timeout: 20_000 });
  });

  test("STU-06: Faculty flippable 3D index card modal, archived read-only card & cross-faculty 404", async ({ page }) => {
    test.setTimeout(60_000);
    await loginAs(page, fac1Email, /\/faculty$/);

    // 1. Open active class deck -> click Clara's card -> verify front/back records & flip
    await page.goto(`/faculty/classes/${classA.id}`);
    const claraBtn = page.getByRole("button", { name: /Open .*'s index card profile and class records/i }).filter({ hasText: "Clara" });
    await claraBtn.click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("Present 1 · Late 0 · Absent 0");
    await expect(dialog).toContainText("Score 5");
    await expect(dialog.locator(".index-card")).not.toHaveClass(/is-flipped/);

    // Flip to back via button & check class-scoped coursework (classA only, NOT droppedClass/archivedClass!)
    await dialog.getByRole("button", { name: "Flip card" }).first().click();
    await expect(dialog.locator(".index-card")).toHaveClass(/is-flipped/);
    await expect(dialog).toContainText("S66 Quiz One");
    await expect(dialog).toContainText("Activity 1A");
    await expect(dialog).toContainText("91 / 100");
    await expect(dialog).not.toContainText("Archived Lab");
    await expect(dialog).not.toContainText("Archived Quiz");

    // Keyboard flip ('f') flips back to front, Esc closes dialog
    await dialog.locator(".index-card-flip-btn:not([disabled])").first().focus().catch(() => {});
    await page.keyboard.press("f");
    await expect(dialog.locator(".index-card")).not.toHaveClass(/is-flipped/);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();

    // 2. Archived class index card still opens & flips read-only
    await page.goto(`/faculty/classes/${archivedClass.id}`);
    await expect(page.getByText("Archived · Read-only")).toBeVisible();
    await page.getByRole("button", { name: /Open .*'s index card/i }).first().click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByRole("dialog")).toContainText("Present 0 · Late 0 · Absent 1");
    await page.getByRole("dialog").getByRole("button", { name: "Flip card" }).first().click();
    await expect(page.getByRole("dialog")).toContainText("Archived Quiz");
    await expect(page.getByRole("dialog")).toContainText("85 / 100");
    await page.getByRole("button", { name: "Close student profile" }).click();

    // 3. Cross-faculty access to classA's student records is blocked with 404
    const ctx2 = await page.context().browser().newContext({ baseURL: page.url() });
    const page2 = await ctx2.newPage();
    try {
      await loginAs(page2, fac2Email, /\/faculty$/);
      const res = await page2.request.get(
        `/api/classes/${classA.id}/students/${stu1.studentProfile.id}/records`,
      );
      expect(res.status()).toBe(404);
    } finally {
      await ctx2.close();
    }
  });

  test("EXP-07: ExportModule UI None/Select all toggle, disabled hint & real .xlsx/.csv downloads", async ({ page }, testInfo) => {
    await loginAs(page, fac1Email, /\/faculty$/);
    await page.goto(`/faculty/classes/${classA.id}`);
    await page.locator("#module-tab-export").click();

    await expect(page.getByRole("heading", { name: "Export class data" })).toBeVisible();
    await expect(page.locator(".export-summary-strip")).toContainText("2 approved students");

    const exportBtn = page.locator("button.export-submit-button");
    await expect(exportBtn).toBeEnabled();
    await expect(exportBtn).toContainText("Export 7 sections as .xlsx");

    // Click None -> disables export and reveals hint
    await page.getByRole("button", { name: "None" }).click();
    await expect(exportBtn).toBeDisabled();
    await expect(page.locator("#export-disabled-hint")).toContainText(
      "Select at least one record type to export",
    );

    // Click Select all -> re-enables
    await page.getByRole("button", { name: "Select all" }).click();
    await expect(exportBtn).toBeEnabled();

    // Uncheck Recitation -> Export 6 sections as .xlsx
    await page.getByRole("checkbox", { name: /Recitation/i }).click();
    await expect(exportBtn).toContainText("Export 6 sections as .xlsx");

    // Trigger real .xlsx download & verify workbook bytes
    const [xlsxDownload] = await Promise.all([
      page.waitForEvent("download"),
      exportBtn.click(),
    ]);
    expect(xlsxDownload.suggestedFilename()).toMatch(/\.xlsx$/i);
    const xlsxPath = testInfo.outputPath(xlsxDownload.suggestedFilename());
    await xlsxDownload.saveAs(xlsxPath);
    const wb = XLSX.readFile(xlsxPath);
    expect(wb.SheetNames).toEqual([
      "Class Information",
      "Student List",
      "Attendance",
      "Activities",
      "Projects",
      "Quiz",
    ]);

    // Switch to CSV format -> check UI hint & trigger .csv download
    await page.getByRole("radio", { name: /CSV \(\.csv\)/i }).click();
    await expect(exportBtn).toContainText("Export 6 sections as .csv");
    await expect(page.locator(".export-format-hint")).toContainText("UTF-8 flat text file");

    const [csvDownload] = await Promise.all([
      page.waitForEvent("download"),
      exportBtn.click(),
    ]);
    expect(csvDownload.suggestedFilename()).toMatch(/\.csv$/i);
    const csvPath = testInfo.outputPath(csvDownload.suggestedFilename());
    await csvDownload.saveAs(csvPath);
    const csvBuf = fs.readFileSync(csvPath);
    expect(csvBuf.subarray(0, 3).toString("hex")).toBe("efbbbf");
    const csvText = csvBuf.toString("utf8");
    expect(csvText).toContain('"Class Information"');
    expect(csvText).toContain('"Activity 1A');
    expect(csvText).toContain('"S66 Quiz One');
  });
});
