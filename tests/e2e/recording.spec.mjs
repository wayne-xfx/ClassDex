import { createRequire } from "node:module";
import { test, expect } from "@playwright/test";

const require = createRequire(import.meta.url);
const { loadBackendTestEnv } = require("../scripts/load-test-env.cjs");
loadBackendTestEnv();

const bcrypt = require("../../classdex-backend/node_modules/bcryptjs");
const { prisma } = require("../../classdex-backend/db");
const { manilaDate } = require("../../classdex-backend/src/utils/dates");

const TEST_PASSWORD = "QaPassword123!";
const SAMPLE_PHOTO =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

test.describe("SCRUM-65 Recording Modules E2E (REC-08, REC-12, REC-16)", () => {
  const runId = Date.now().toString(36).slice(-5);
  const facEmail = `qa_e2e_s65_fac_${runId}@test.local`;
  const stu1Email = `qa_e2e_s65_stu1_${runId}@test.local`;
  const stu2Email = `qa_e2e_s65_stu2_${runId}@test.local`;
  const stu3Email = `qa_e2e_s65_stu3_${runId}@test.local`;

  const createdUserEmails = [facEmail, stu1Email, stu2Email, stu3Email];
  const createdClassIds = [];

  let facultyUser;
  let stu1;
  let stu2;
  let stu3;
  let recitationClass;
  let quizClass;
  let warnClassA;
  let warnClassB;
  let warnClassC;

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

  async function loginAsFaculty(page) {
    await page.goto("/login");
    await page.locator("#login-email").fill(facEmail);
    await page.locator("#login-password").fill(TEST_PASSWORD);
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page).toHaveURL(/\/faculty$/);
  }

  test.beforeAll(async ({}, testInfo) => {
    testInfo.setTimeout(90_000);
    const hash = await bcrypt.hash(TEST_PASSWORD, 10);

    facultyUser = await prisma.user.create({
      data: {
        name: "qa_E2E S65 Faculty",
        email: facEmail,
        password: hash,
        role: "FACULTY",
        emailVerified: true,
        emailVerifiedAt: new Date(),
        facultyProfile: {
          create: {
            name: "qa_E2E S65 Faculty",
            department: "Information Technology",
            email: facEmail,
          },
        },
      },
    });

    const [id1, id2, id3] = await Promise.all([
      allocId(8610000),
      allocId(8620000),
      allocId(8630000),
    ]);

    const makeStu = async (email, firstName, lastName, studentId) =>
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
              photo: SAMPLE_PHOTO,
            },
          },
        },
        include: { studentProfile: true },
      });

    [stu1, stu2, stu3] = await Promise.all([
      makeStu(stu1Email, "qa_Alice", "Alpha", id1),
      makeStu(stu2Email, "qa_Bob", "Bravo", id2),
      makeStu(stu3Email, "qa_Carol", "Absentee", id3),
    ]);

    const makeClass = async (suffix, students) => {
      const cls = await prisma.class.create({
        data: {
          facultyId: facultyUser.id,
          sectionName: `qa_E2E ${suffix}`,
          courseCode: "IT 165",
          courseTitle: `qa_Recording E2E ${suffix}`,
          classCode: `Q65E${suffix}${runId}`.toUpperCase().slice(0, 14),
          schedule: "Mon, Wed · 9:00 AM – 10:30 AM",
          scheduleDays: ["Mon", "Wed"],
          scheduleStartTime: "09:00",
          scheduleEndTime: "10:30",
          gracePeriodMinutes: 15,
          recitationShuffleSeconds: 3,
          projects: { create: [{ type: "MIDTERM" }, { type: "FINALS" }] },
        },
      });
      createdClassIds.push(cls.id);
      await Promise.all([
        prisma.classEnrollment.createMany({
          data: students.map((s) => ({
            classId: cls.id,
            studentProfileId: s.studentProfile.id,
            status: "APPROVED",
          })),
        }),
        prisma.classRoster.createMany({
          data: students.map((s) => ({
            classId: cls.id,
            studentId: s.studentProfile.studentId,
            studentName: s.studentProfile.name,
            firstName: s.studentProfile.firstName,
            lastName: s.studentProfile.lastName,
            sortKey: s.studentProfile.sortKey,
          })),
        }),
      ]);
      return cls;
    };

    [recitationClass, quizClass, warnClassA, warnClassB, warnClassC] = await Promise.all([
      makeClass("REC", [stu1, stu2, stu3]),
      makeClass("QUIZ", [stu1, stu2]),
      makeClass("WARNA", [stu1]),
      makeClass("WARNB", [stu1]),
      makeClass("WARNC", [stu1]),
    ]);

    // Seed today's session in recitationClass + 7 historical ABSENT sessions for warnClassA/B/C
    await Promise.all([
      prisma.classSession.create({
        data: {
          classId: recitationClass.id,
          date: manilaDate(),
          startedAt: new Date(),
          attendance: {
            create: [
              { studentId: stu1.studentProfile.id, status: "PRESENT" },
              { studentId: stu2.studentProfile.id, status: "LATE" },
              { studentId: stu3.studentProfile.id, status: "ABSENT" },
            ],
          },
        },
      }),
      ...[warnClassA, warnClassB, warnClassC].flatMap((wCls) =>
        Array.from({ length: 7 }, (_, idx) => {
          const day = idx + 1;
          const d = new Date(Date.now() - day * 86_400_000);
          d.setUTCHours(0, 0, 0, 0);
          return prisma.classSession.create({
            data: {
              classId: wCls.id,
              date: d,
              startedAt: d,
              attendance: {
                create: [{ studentId: stu1.studentProfile.id, status: "ABSENT" }],
              },
            },
          });
        }),
      ),
    ]);
  });

  test.afterAll(async () => {
    try {
      if (createdClassIds.length) {
        await prisma.class.deleteMany({ where: { id: { in: createdClassIds } } });
      }
      await prisma.user.deleteMany({ where: { email: { in: createdUserEmails } } });
    } finally {
      await prisma.$disconnect();
    }
  });

  test("REC-08: Recitation shuffler UI controls (animation, mute, 1s duration, skip, score, history)", async ({
    page,
  }) => {
    await loginAsFaculty(page);
    await page.goto(`/faculty/classes/${recitationClass.id}`);

    await page.locator("#module-tab-recitation").click();
    await expect(page.getByText(/2 eligible students/i)).toBeVisible();

    // Open Shuffle settings -> mute sound, set 1s duration, toggle animation off
    await page.getByRole("button", { name: "Recitation shuffle settings" }).click();
    const settingsDialog = page.getByRole("dialog", { name: "Shuffle settings" });
    await expect(settingsDialog).toBeVisible();

    await settingsDialog.getByRole("button", { name: "Mute shuffle sound" }).click();
    await expect(settingsDialog.getByRole("button", { name: "Unmute shuffle sound" })).toBeVisible();

    const durationPatch = page.waitForResponse(
      (res) =>
        res.url().includes(`/api/classes/${recitationClass.id}`) &&
        res.request().method() === "PATCH" &&
        res.status() === 200,
    );
    await page.locator("#recitation-duration-slider").fill("1");
    await durationPatch;
    await expect(settingsDialog.getByText("Duration (1s)")).toBeVisible();

    const animSwitch = settingsDialog.getByRole("switch", { name: "Shuffle animation" });
    const animSwitchRow = settingsDialog.locator("label.recitation-switch-row");
    await expect(animSwitch).toBeChecked();
    await animSwitchRow.click();
    await expect(animSwitch).not.toBeChecked();
    await page.keyboard.press("Escape");

    // Shuffle with animation disabled -> immediate speaker reveal (never ABSENT stu3)
    await page.getByRole("button", { name: "Shuffle", exact: true }).click();
    const speakerCard = page.locator(".recitation-card");
    await expect(speakerCard).toBeVisible();
    await expect(speakerCard).not.toContainText("Carol");

    // Re-enable Shuffle animation -> verify shuffling card & ~1s duration completion
    await page.getByRole("button", { name: "Recitation shuffle settings" }).click();
    await expect(settingsDialog).toBeVisible();
    await animSwitchRow.click();
    await expect(animSwitch).toBeChecked();
    await page.keyboard.press("Escape");

    const animStart = Date.now();
    await page.getByRole("button", { name: "Shuffle again" }).click();
    await expect(page.locator(".recitation-shuffling-card")).toBeVisible();
    await expect(speakerCard).toBeVisible({ timeout: 5000 });
    const elapsedMs = Date.now() - animStart;
    expect(elapsedMs).toBeGreaterThanOrEqual(850);
    expect(elapsedMs).toBeLessThan(4000);

    const firstPickedId = await speakerCard.locator(".recitation-student-id").textContent();

    // Skip to other eligible student
    await page.getByRole("button", { name: "Skip" }).click();
    await expect(speakerCard).toBeVisible({ timeout: 5000 });
    const skippedPickedId = await speakerCard.locator(".recitation-student-id").textContent();
    expect(skippedPickedId).not.toBe(firstPickedId);
    await expect(speakerCard).not.toContainText("Carol");

    // Score 4 -> chips active & "Called today" history shows Score 4
    const score4Btn = speakerCard.getByRole("button", { name: /^Score 4/ });
    const scorePatch = page.waitForResponse(
      (res) => res.url().includes("/api/recitation-logs/") && res.request().method() === "PATCH",
    );
    await score4Btn.click();
    await scorePatch;
    await expect(score4Btn).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".recitation-history")).toContainText("Score 4");

    // Confirm Class Deck API returns populated recitationHistory name fields
    const deckRes = await page.request.get(`/api/classes/${recitationClass.id}/deck`);
    expect(deckRes.status()).toBe(200);
    const deckJson = await deckRes.json();
    expect(deckJson.recitationHistory.length).toBeGreaterThanOrEqual(3);
    expect(deckJson.recitationHistory[0].score).toBe(4);
    expect(deckJson.recitationHistory[0].studentProfile.firstName).toBeTruthy();
    expect(deckJson.recitationHistory[0].studentProfile.lastName).toBeTruthy();
  });

  test("REC-12a: Quiz UI prompts for attendance when unmarked and browse/edit persists scores", async ({
    page,
  }) => {
    await loginAsFaculty(page);
    await page.goto(`/faculty/classes/${quizClass.id}`);

    await page.locator("#module-tab-quiz").click();
    await expect(page.getByText("No quizzes yet")).toBeVisible();

    // Unmarked attendance triggers "Take attendance first" prompt
    await page.getByRole("button", { name: "New quiz" }).click();
    await expect(page.locator("#quiz-attendance-title")).toHaveText("Take attendance first");
    await page.getByRole("button", { name: "Take Attendance" }).click();

    // Attendance tab opens -> mark stu1 Present and stu2 Absent
    await expect(page.locator(".attendance-module")).toBeVisible();
    const stu1Card = page.locator(`article[data-student-id="${stu1.studentProfile.id}"]`);
    const stu2Card = page.locator(`article[data-student-id="${stu2.studentProfile.id}"]`);

    const put1 = page.waitForResponse(
      (res) =>
        res.url().includes(`/attendance/${stu1.studentProfile.id}`) &&
        res.request().method() === "PUT" &&
        res.status() === 200,
    );
    await stu1Card.getByRole("button", { name: "Present" }).click();
    await put1;
    await expect(stu1Card.getByRole("button", { name: "Present" })).toHaveAttribute("aria-pressed", "true");

    const put2 = page.waitForResponse(
      (res) =>
        res.url().includes(`/attendance/${stu2.studentProfile.id}`) &&
        res.request().method() === "PUT" &&
        res.status() === 200,
    );
    await stu2Card.getByRole("button", { name: "Absent" }).click();
    await put2;
    await expect(stu2Card.getByRole("button", { name: "Absent" })).toHaveAttribute("aria-pressed", "true");

    // Return to Quiz tab -> New quiz opens modal directly without prompt
    await page.locator("#module-tab-quiz").click();
    await page.getByRole("button", { name: "New quiz" }).click();
    await expect(page.locator("#quiz-attendance-title")).toHaveCount(0);

    const quizModal = page.getByRole("dialog", { name: "New quiz" });
    await quizModal.getByLabel(/Quiz title/i).fill("qa_E2E Quiz 1");
    await quizModal.getByLabel(/Total items/i).fill("15");
    await quizModal.getByRole("button", { name: "Create quiz" }).click();

    // Score Present student (stu1) and Save
    const qStu1 = page.locator(".quiz-student-card", { hasText: stu1.studentProfile.studentId });
    const stu1Input = qStu1.locator(".quiz-score-field input");
    await stu1Input.fill("12");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("All changes saved.")).toBeVisible();

    // After save reloads sessions from server, absent lock appears on stu2
    const qStu2 = page.locator(".quiz-student-card", { hasText: stu2.studentProfile.studentId });
    await expect(qStu2.locator(".quiz-absent-flag")).toContainText("Absent");

    // Navigate back to Quizzes list and reopen to edit score 12 -> 14
    await page.getByRole("button", { name: /Back to Quizzes/i }).click();
    const row = page.locator(".quiz-list-row", { hasText: "qa_E2E Quiz 1" });
    await expect(row).toContainText("1 scored · Saved");
    await row.click();

    await expect(stu1Input).toHaveValue("12");
    await stu1Input.fill("14");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("All changes saved.")).toBeVisible();

    // Reload page and reopen quiz to prove persistence
    await page.goto(`/faculty/classes/${quizClass.id}?module=quiz`);
    await page.locator(".quiz-list-row", { hasText: "qa_E2E Quiz 1" }).click();
    await expect(stu1Input).toHaveValue("14");
  });

  test("REC-12b: Mid-session attendance change to Absent immediately locks student in Quiz draft without reload", async ({
    page,
  }) => {
    await loginAsFaculty(page);
    await page.goto(`/faculty/classes/${quizClass.id}`);

    // Note: in quizClass, attendance today was already taken for stu2=ABSENT from REC-12a,
    // so toggle stu2 Present -> Absent (or vice-versa) cleanly in-session before opening New Quiz
    await page.locator("#module-tab-attendance").click();
    const stu2Card = page.locator(`article[data-student-id="${stu2.studentProfile.id}"]`);
    const putPresent = page.waitForResponse(
      (res) =>
        res.url().includes(`/attendance/${stu2.studentProfile.id}`) &&
        res.request().method() === "PUT" &&
        res.status() === 200,
    );
    await stu2Card.getByRole("button", { name: "Present" }).click();
    await putPresent;

    // Reload so initial attendanceStatus on load is PRESENT, then toggle Absent mid-session
    await page.goto(`/faculty/classes/${quizClass.id}?module=attendance`);
    const stu2CardReloaded = page.locator(`article[data-student-id="${stu2.studentProfile.id}"]`);
    const putAbsent = page.waitForResponse(
      (res) =>
        res.url().includes(`/attendance/${stu2.studentProfile.id}`) &&
        res.request().method() === "PUT" &&
        res.status() === 200,
    );
    await stu2CardReloaded.getByRole("button", { name: "Absent" }).click();
    await putAbsent;

    // Open Quiz -> New quiz without reload: stu2 must immediately be locked as Absent in draft
    await page.locator("#module-tab-quiz").click();
    await page.getByRole("button", { name: "New quiz" }).click();
    const quizModal = page.getByRole("dialog", { name: "New quiz" });
    await quizModal.getByLabel(/Quiz title/i).fill("qa_E2E Quiz 2 LockCheck");
    await quizModal.getByLabel(/Total items/i).fill("10");
    await quizModal.getByRole("button", { name: "Create quiz" }).click();

    const qStu2 = page.locator(".quiz-student-card", { hasText: stu2.studentProfile.studentId });
    await expect(qStu2.locator(".quiz-absent-flag")).toContainText("Absent");
    await expect(qStu2.locator("input")).toHaveCount(0);
  });

  test("REC-12c: Browse existing saved quiz, edit score, and verify persistence across reload", async ({
    page,
  }) => {
    // Seed a saved quiz session on recitationClass (stu1=PRESENT, stu2=LATE, stu3=ABSENT)
    await prisma.quizSession.create({
      data: {
        classId: recitationClass.id,
        title: "qa_E2E Seeded Quiz",
        totalItems: 20,
        scores: {
          create: [
            { studentId: stu1.studentProfile.id, score: 10, isAbsent: false },
            { studentId: stu3.studentProfile.id, score: null, isAbsent: true },
          ],
        },
      },
    });

    await loginAsFaculty(page);
    await page.goto(`/faculty/classes/${recitationClass.id}`);
    await page.locator("#module-tab-quiz").click();

    const row = page.locator(".quiz-list-row", { hasText: "qa_E2E Seeded Quiz" });
    await expect(row).toBeVisible();
    await row.click();

    // Absent stu3 is locked; Present stu1 has pre-loaded score 10
    const qStu3 = page.locator(".quiz-student-card", { hasText: stu3.studentProfile.studentId });
    await expect(qStu3.locator(".quiz-absent-flag")).toContainText("Absent");
    await expect(qStu3.locator("input")).toHaveCount(0);

    const qStu1 = page.locator(".quiz-student-card", { hasText: stu1.studentProfile.studentId });
    const stu1Input = qStu1.locator(".quiz-score-field input");
    await expect(stu1Input).toHaveValue("10");

    // Edit score 10 -> 14 and save
    await stu1Input.fill("14");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("All changes saved.")).toBeVisible();

    // Reload class and reopen quiz to verify 14 persisted
    await page.goto(`/faculty/classes/${recitationClass.id}`);
    await page.locator("#module-tab-quiz").click();
    await page.locator(".quiz-list-row", { hasText: "qa_E2E Seeded Quiz" }).click();
    await expect(stu1Input).toHaveValue("14");
  });

  test("REC-16a: Absence warning View index card, Review in Student List, and switching back to Attendance tab", async ({
    page,
  }) => {
    await loginAsFaculty(page);
    await page.goto(`/faculty/classes/${warnClassA.id}`);

    const bellTrigger = page.locator("button.header-bell-trigger");
    await expect(bellTrigger.locator(".header-bell-badge")).toHaveText("1");
    await bellTrigger.click();

    const drawer = page.getByRole("dialog", { name: "Notifications" });
    await expect(drawer).toBeVisible();
    const warningRow = drawer.locator(".pending-row-warning");
    await expect(warningRow).toContainText("7 absences");
    await expect(warningRow).not.toHaveClass(/pending-row-read/);

    // 1. Click "View attendance & index card" -> opens StudentDetailDialog & marks warning read
    await warningRow.getByRole("button", { name: "View attendance & index card" }).click();
    const cardDialog = page.locator('.index-card-scene[role="dialog"]');
    await expect(cardDialog).toBeVisible();
    await expect(cardDialog).toContainText(stu1.studentProfile.studentId);
    await cardDialog.getByRole("button", { name: "Close student profile" }).click();
    await expect(cardDialog).toHaveCount(0);
    await expect(bellTrigger.locator(".header-bell-badge")).toHaveCount(0);

    // 2. Open drawer -> click "Review in Student List" -> focuses student row in Student List
    await bellTrigger.click();
    await expect(drawer.locator(".pending-row-warning")).toHaveClass(/pending-row-read/);
    await drawer.getByRole("button", { name: "Review in Student List" }).click();
    await expect(page.locator("#module-tab-student-list")).toHaveClass(/is-active/);
    await expect(page.locator('.student-list-search-bar input[type="search"]')).toHaveValue(
      stu1.studentProfile.studentId,
    );
    await expect(page.locator(".student-list-manager table tbody tr")).toHaveCount(1);
    await expect(page.locator(".student-list-manager table tbody tr input").nth(1)).toHaveValue(
      stu1.studentProfile.studentId,
    );

    // 3. Switch from Student List back to Attendance tab (exposes DEF-06 if URL ?module=student-list snaps back)
    await page.locator("#module-tab-attendance").click();
    await expect(page.locator(".attendance-module")).toBeVisible({ timeout: 5000 });
  });

  test("REC-16c: Dismiss absence warning removes it until an 8th absence is recorded", async ({
    page,
  }) => {
    await loginAsFaculty(page);
    await page.goto(`/faculty/classes/${warnClassC.id}`);

    const bellTrigger = page.locator("button.header-bell-trigger");
    await expect(bellTrigger.locator(".header-bell-badge")).toHaveText("1");
    await bellTrigger.click();

    const drawer = page.getByRole("dialog", { name: "Notifications" });
    await expect(drawer.locator(".pending-row-warning")).toContainText("7 absences");

    // Dismiss warning -> removed until next absence
    await drawer.getByRole("button", { name: "Dismiss" }).click();
    await expect(drawer.locator(".pending-row-warning")).toHaveCount(0);
    await expect(drawer.getByText("All caught up")).toBeVisible();
    await drawer.getByRole("button", { name: "Close notifications" }).click();

    // Add an 8th absence today -> warning reappears with "8 absences"
    await page.locator("#module-tab-attendance").click();
    await expect(page.locator(".attendance-module")).toBeVisible();
    const stuCard = page.locator(`article[data-student-id="${stu1.studentProfile.id}"]`);
    const attPromise = page.waitForResponse(
      (res) => res.url().includes("/attendance/") && res.request().method() === "PUT" && res.status() === 200,
    );
    await stuCard.getByRole("button", { name: "Absent" }).click();
    await attPromise;

    await expect(bellTrigger.locator(".header-bell-badge")).toHaveText("1", { timeout: 10000 });
    await bellTrigger.click();
    await expect(drawer.locator(".pending-row-warning")).toContainText("8 absences");
  });

  test("REC-16b: Mark all as read marks unread 7-absence warning read in Notifications drawer", async ({
    page,
  }) => {
    await loginAsFaculty(page);
    await page.goto(`/faculty/classes/${warnClassB.id}`);

    const bellTrigger = page.locator("button.header-bell-trigger");
    await expect(bellTrigger.locator(".header-bell-badge")).toHaveText("1");
    await bellTrigger.click();

    const drawer = page.getByRole("dialog", { name: "Notifications" });
    const warningRow = drawer.locator(".pending-row-warning");
    await expect(warningRow).toContainText("7 absences");
    await expect(warningRow).not.toHaveClass(/pending-row-read/);

    const markBtn = drawer.getByRole("button", { name: "Mark all as read" });
    await expect(markBtn).toBeEnabled();

    const readReq = page.waitForResponse(
      (res) =>
        res.url().includes(`/api/classes/${warnClassB.id}/notifications/read`) &&
        res.request().method() === "POST",
    );
    await markBtn.click();
    const readRes = await readReq;
    expect(readRes.status()).toBe(200);

    // Must mark the warning row read and clear unread bell badge
    await expect(warningRow).toHaveClass(/pending-row-read/, { timeout: 5000 });
    await expect(bellTrigger.locator(".header-bell-badge")).toHaveCount(0);
  });
});
