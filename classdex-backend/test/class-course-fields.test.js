require("dotenv").config();
const test = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcryptjs");
const ExcelJS = require("exceljs");

function readExcelSheetRows(worksheet) {
  if (!worksheet) return [];
  const colCount = worksheet.columnCount || 0;
  const rows = [];
  for (let r = 1; r <= worksheet.rowCount; r += 1) {
    const row = worksheet.getRow(r);
    const width = Math.max(colCount, row.cellCount || 0);
    const vals = [];
    for (let c = 1; c <= width; c += 1) {
      const v = row.getCell(c).value;
      vals.push(v === null || v === undefined ? "" : v);
    }
    rows.push(vals);
  }
  return rows;
}
const { app, resetRateLimitersForTests } = require("../index");
const { prisma } = require("../db");
const {
  normalizeCourseCode,
  normalizeCourseTitle,
  validateCourseFields,
  formatClassLabel,
} = require("../classLabel");

async function generateUnusedStudentId(usedIds) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const candidate = String(8100000 + Math.floor(Math.random() * 899999));
    if (usedIds.has(candidate)) continue;
    const [existingProfile, existingRoster] = await Promise.all([
      prisma.studentProfile.findUnique({ where: { studentId: candidate }, select: { id: true } }),
      prisma.classRoster.findFirst({ where: { studentId: candidate }, select: { id: true } }),
    ]);
    if (!existingProfile && !existingRoster) {
      usedIds.add(candidate);
      return candidate;
    }
  }
  throw new Error("Could not allocate an unused 7-digit studentId for test.");
}

async function loginAndGetCookie(baseUrl, email, password) {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  assert.equal(res.status, 200, `Login failed for ${email}`);
  const rawSetCookie = res.headers.get("set-cookie") || "";
  const sessionPair = rawSetCookie.split(";")[0];
  assert.ok(sessionPair.includes("="), "Expected session cookie on login");
  return sessionPair;
}

test("classLabel helpers: normalizeCourseCode, normalizeCourseTitle, validateCourseFields, and formatClassLabel", () => {
  assert.equal(normalizeCourseCode("  it  121 / 121l  "), "IT 121 / 121L");
  assert.equal(normalizeCourseTitle("  Information   Management   I "), "Information Management I");

  assert.equal(
    formatClassLabel({
      courseCode: "IT 121/121L",
      courseTitle: "Information Management I",
      sectionName: "BSIT - AI23",
    }),
    "IT 121/121L · Information Management I (BSIT - AI23)",
  );
  assert.equal(
    formatClassLabel({
      courseCode: null,
      courseTitle: null,
      sectionName: "BSIT - AI23",
    }),
    "BSIT - AI23",
  );

  assert.equal(
    validateCourseFields(
      { courseCode: "IT 121/121L", courseTitle: "Information Management I" },
      { partial: false },
    ),
    null,
  );
  assert.equal(validateCourseFields({}, { partial: true }), null);
  assert.equal(validateCourseFields({ courseCode: "" }, { partial: true })?.field, "courseCode");
  assert.equal(validateCourseFields({ courseTitle: " " }, { partial: true })?.field, "courseTitle");
});

test("POST /api/classes, PATCH /api/classes/:id, class list/detail/student endpoints, and Excel/CSV exports with courseCode and courseTitle", async (t) => {
  resetRateLimitersForTests();
  const createdClassIds = [];
  const createdUserIds = [];
  const usedStudentIds = new Set();
  const server = app.listen(0);

  t.after(async () => {
    resetRateLimitersForTests();
    await new Promise((resolve) => server.close(resolve));
    if (createdClassIds.length > 0) {
      await prisma.class.deleteMany({
        where: { id: { in: createdClassIds } },
      });
    }
    if (createdUserIds.length > 0) {
      await prisma.user.deleteMany({
        where: { id: { in: createdUserIds } },
      });
    }
    await prisma.$disconnect();
  });

  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;
  const runId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const passwordPlain = "Password123!";
  const hashedPassword = await bcrypt.hash(passwordPlain, 10);

  const faculty1 = await prisma.user.create({
    data: {
      name: "Course Faculty Owner",
      email: `faculty1.course.${runId}@test.local`,
      password: hashedPassword,
      role: "FACULTY",
      emailVerified: true,
    },
  });
  createdUserIds.push(faculty1.id);

  const faculty2 = await prisma.user.create({
    data: {
      name: "Other Faculty",
      email: `faculty2.course.${runId}@test.local`,
      password: hashedPassword,
      role: "FACULTY",
      emailVerified: true,
    },
  });
  createdUserIds.push(faculty2.id);

  const studentIdNumber = await generateUnusedStudentId(usedStudentIds);
  const studentEmail = `student.course.${runId}@test.local`;
  const studentUser = await prisma.user.create({
    data: {
      name: "Course Student",
      email: studentEmail,
      password: hashedPassword,
      role: "STUDENT",
      emailVerified: true,
      studentProfile: {
        create: {
          name: "Course Student",
          email: studentEmail,
          studentId: studentIdNumber,
          birthdate: new Date("2005-05-15T00:00:00.000Z"),
          program: "BSIT",
          section: "AI23",
          address: "Test Address",
          photo: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
        },
      },
    },
    include: { studentProfile: true },
  });
  createdUserIds.push(studentUser.id);
  const studentProfileId = studentUser.studentProfile.id;

  const [faculty1Cookie, faculty2Cookie, studentCookie] = await Promise.all([
    loginAndGetCookie(baseUrl, faculty1.email, passwordPlain),
    loginAndGetCookie(baseUrl, faculty2.email, passwordPlain),
    loginAndGetCookie(baseUrl, studentUser.email, passwordPlain),
  ]);

  async function requestJson(method, route, { cookie, body } = {}) {
    const headers = {};
    if (cookie) headers.Cookie = cookie;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const res = await fetch(`${baseUrl}${route}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, data };
  }

  // 1. POST /api/classes validation errors
  const missingCode = await requestJson("POST", "/api/classes", {
    cookie: faculty1Cookie,
    body: {
      courseTitle: "Information Management I",
      sectionName: "BSIT - AI23",
    },
  });
  assert.equal(missingCode.status, 400);
  assert.equal(missingCode.data.field, "courseCode");

  const shortCode = await requestJson("POST", "/api/classes", {
    cookie: faculty1Cookie,
    body: {
      courseCode: "A",
      courseTitle: "Information Management I",
      sectionName: "BSIT - AI23",
    },
  });
  assert.equal(shortCode.status, 400);
  assert.equal(shortCode.data.field, "courseCode");

  const longCode = await requestJson("POST", "/api/classes", {
    cookie: faculty1Cookie,
    body: {
      courseCode: "A".repeat(31),
      courseTitle: "Information Management I",
      sectionName: "BSIT - AI23",
    },
  });
  assert.equal(longCode.status, 400);
  assert.equal(longCode.data.field, "courseCode");

  const invalidCharsCode = await requestJson("POST", "/api/classes", {
    cookie: faculty1Cookie,
    body: {
      courseCode: "IT#121$121L",
      courseTitle: "Information Management I",
      sectionName: "BSIT - AI23",
    },
  });
  assert.equal(invalidCharsCode.status, 400);
  assert.equal(invalidCharsCode.data.field, "courseCode");

  const missingTitle = await requestJson("POST", "/api/classes", {
    cookie: faculty1Cookie,
    body: {
      courseCode: "IT 121/121L",
      courseTitle: " ",
      sectionName: "BSIT - AI23",
    },
  });
  assert.equal(missingTitle.status, 400);
  assert.equal(missingTitle.data.field, "courseTitle");

  const longTitle = await requestJson("POST", "/api/classes", {
    cookie: faculty1Cookie,
    body: {
      courseCode: "IT 121/121L",
      courseTitle: "T".repeat(121),
      sectionName: "BSIT - AI23",
    },
  });
  assert.equal(longTitle.status, 400);
  assert.equal(longTitle.data.field, "courseTitle");

  // 2. POST /api/classes succeeds and normalizes courseCode & courseTitle
  const createRes = await requestJson("POST", "/api/classes", {
    cookie: faculty1Cookie,
    body: {
      courseCode: "  it   121/121l ",
      courseTitle: "  Information   Management  I ",
      sectionName: "  BSIT - AI23 ",
      description: "First semester",
      scheduleDays: ["Mon", "Wed"],
      scheduleStartTime: "07:30",
      scheduleEndTime: "09:00",
    },
  });
  assert.equal(createRes.status, 201);
  const createdClass = createRes.data.class;
  createdClassIds.push(createdClass.id);
  assert.equal(createdClass.courseCode, "IT 121/121L");
  assert.equal(createdClass.courseTitle, "Information Management I");
  assert.equal(createdClass.sectionName, "BSIT - AI23");

  // 3. Create a legacy class (courseCode: null, courseTitle: null) directly in DB
  const codeSuffix = runId.slice(-4).toUpperCase();
  const legacyClass = await prisma.class.create({
    data: {
      sectionName: `Legacy Section ${runId}`,
      classCode: `LG${codeSuffix}1`,
      facultyId: faculty1.id,
      courseCode: null,
      courseTitle: null,
    },
  });
  createdClassIds.push(legacyClass.id);

  // Enroll student in both classes
  await prisma.classEnrollment.createMany({
    data: [
      { classId: createdClass.id, studentProfileId, status: "APPROVED" },
      { classId: legacyClass.id, studentProfileId, status: "APPROVED" },
    ],
  });

  // 4. PATCH /api/classes/:id partial settings update on legacy class succeeds without course fields
  const gracePatch = await requestJson("PATCH", `/api/classes/${legacyClass.id}`, {
    cookie: faculty1Cookie,
    body: { gracePeriodMinutes: 20 },
  });
  assert.equal(gracePatch.status, 200);
  assert.equal(gracePatch.data.class.gracePeriodMinutes, 20);
  assert.equal(gracePatch.data.class.courseCode, null);
  assert.equal(gracePatch.data.class.courseTitle, null);

  const shufflePatch = await requestJson("PATCH", `/api/classes/${legacyClass.id}`, {
    cookie: faculty1Cookie,
    body: { recitationShuffleSeconds: 4 },
  });
  assert.equal(shufflePatch.status, 200);
  assert.equal(shufflePatch.data.class.recitationShuffleSeconds, 4);

  // 5. PATCH /api/classes/:id rejects explicit empty courseCode or courseTitle with 400
  const emptyCodePatch = await requestJson("PATCH", `/api/classes/${legacyClass.id}`, {
    cookie: faculty1Cookie,
    body: { courseCode: "" },
  });
  assert.equal(emptyCodePatch.status, 400);
  assert.equal(emptyCodePatch.data.field, "courseCode");

  const emptyTitlePatch = await requestJson("PATCH", `/api/classes/${legacyClass.id}`, {
    cookie: faculty1Cookie,
    body: { courseTitle: "   " },
  });
  assert.equal(emptyTitlePatch.status, 400);
  assert.equal(emptyTitlePatch.data.field, "courseTitle");

  // 6. PATCH /api/classes/:id enforces owner-only (404)
  const nonOwnerPatch = await requestJson("PATCH", `/api/classes/${createdClass.id}`, {
    cookie: faculty2Cookie,
    body: { courseCode: "CS 101", courseTitle: "Computer Science I" },
  });
  assert.equal(nonOwnerPatch.status, 404);

  // 7. PATCH /api/classes/:id updates courseCode and courseTitle on new class
  const updateCourseRes = await requestJson("PATCH", `/api/classes/${createdClass.id}`, {
    cookie: faculty1Cookie,
    body: {
      courseCode: " it  122 / 122l ",
      courseTitle: " Systems Analysis & Design ",
      sectionName: "BSIT - AI33",
    },
  });
  assert.equal(updateCourseRes.status, 200);
  assert.equal(updateCourseRes.data.class.courseCode, "IT 122 / 122L");
  assert.equal(updateCourseRes.data.class.courseTitle, "Systems Analysis & Design");
  assert.equal(updateCourseRes.data.class.sectionName, "BSIT - AI33");

  // 8. Verify GET /api/faculty/classes, GET /api/classes/:id, GET /api/student/classes, GET /api/student/classes/:classId/records
  const facultyListRes = await requestJson("GET", "/api/faculty/classes", { cookie: faculty1Cookie });
  assert.equal(facultyListRes.status, 200);
  const facById = new Map(facultyListRes.data.classes.map((c) => [c.id, c]));
  assert.equal(facById.get(createdClass.id)?.courseCode, "IT 122 / 122L");
  assert.equal(facById.get(createdClass.id)?.courseTitle, "Systems Analysis & Design");
  assert.equal(facById.get(legacyClass.id)?.courseCode, null);
  assert.equal(facById.get(legacyClass.id)?.courseTitle, null);

  const classDetailRes = await requestJson("GET", `/api/classes/${createdClass.id}`, {
    cookie: faculty1Cookie,
  });
  assert.equal(classDetailRes.status, 200);
  assert.equal(classDetailRes.data.class.courseCode, "IT 122 / 122L");
  assert.equal(classDetailRes.data.class.courseTitle, "Systems Analysis & Design");

  const studentListRes = await requestJson("GET", "/api/student/classes", { cookie: studentCookie });
  assert.equal(studentListRes.status, 200);
  const stuById = new Map(studentListRes.data.classes.map((c) => [c.id, c]));
  assert.equal(stuById.get(createdClass.id)?.courseCode, "IT 122 / 122L");
  assert.equal(stuById.get(createdClass.id)?.courseTitle, "Systems Analysis & Design");
  assert.equal(stuById.get(legacyClass.id)?.courseCode, null);
  assert.equal(stuById.get(legacyClass.id)?.courseTitle, null);

  const studentRecordRes = await requestJson(
    "GET",
    `/api/student/classes/${createdClass.id}/records`,
    { cookie: studentCookie },
  );
  assert.equal(studentRecordRes.status, 200);
  assert.equal(studentRecordRes.data.class.courseCode, "IT 122 / 122L");
  assert.equal(studentRecordRes.data.class.courseTitle, "Systems Analysis & Design");

  // 9. Verify Excel and CSV export "Class Information" sheet for both course-populated and legacy classes
  const excelCourseRes = await fetch(
    `${baseUrl}/api/classes/${createdClass.id}/export/excel?types=overview`,
    { headers: { Cookie: faculty1Cookie } },
  );
  assert.equal(excelCourseRes.status, 200);
  const excelCourseWb = new ExcelJS.Workbook();
  await excelCourseWb.xlsx.load(Buffer.from(await excelCourseRes.arrayBuffer()));
  const courseInfoRows = readExcelSheetRows(excelCourseWb.getWorksheet("Class Information"));
  assert.deepEqual(courseInfoRows[1], ["Course code", "IT 122 / 122L"]);
  assert.deepEqual(courseInfoRows[2], ["Course title", "Systems Analysis & Design"]);
  assert.deepEqual(courseInfoRows[3], ["Class name", "BSIT - AI33"]);

  const csvLegacyRes = await fetch(
    `${baseUrl}/api/classes/${legacyClass.id}/export/csv?types=overview`,
    { headers: { Cookie: faculty1Cookie } },
  );
  assert.equal(csvLegacyRes.status, 200);
  const csvLegacyText = await csvLegacyRes.text();
  assert.ok(csvLegacyText.includes('"Course code",""'));
  assert.ok(csvLegacyText.includes('"Course title",""'));

  // 10. Archive guard (409) on PATCH /api/classes/:id
  const archiveRes = await requestJson("POST", `/api/classes/${createdClass.id}/archive`, {
    cookie: faculty1Cookie,
  });
  assert.equal(archiveRes.status, 200);
  const patchArchivedRes = await requestJson("PATCH", `/api/classes/${createdClass.id}`, {
    cookie: faculty1Cookie,
    body: { courseCode: "IT 999", courseTitle: "Should Fail" },
  });
  assert.equal(patchArchivedRes.status, 409);
});
