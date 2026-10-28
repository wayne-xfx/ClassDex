require("dotenv").config();
const test = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcryptjs");
const XLSX = require("xlsx");
const { app, resetRateLimitersForTests } = require("../index");
const { prisma } = require("../db");

test("§3c: Student List Excel Template & Import", async (t) => {
  resetRateLimitersForTests();
  const server = app.listen(0);
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;
  const runId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const hashedPassword = await bcrypt.hash("password123", 10);

  // 1. Create Faculty User & Class
  const facultyUser = await prisma.user.create({
    data: {
      name: "Template Faculty",
      email: `faculty.tmpl.${runId}@test.local`,
      password: hashedPassword,
      role: "FACULTY",
      emailVerified: true,
    },
  });

  const testClass = await prisma.class.create({
    data: {
      sectionName: "CS 101 Template Test",
      classCode: `TMP-${runId}`.slice(0, 10).toUpperCase(),
      description: "Intro to CS",
      schedule: "MWF 9:00 AM - 10:30 AM",
      facultyId: facultyUser.id,
    },
  });

  // Seed initial roster in class
  await prisma.classRoster.createMany({
    data: [
      {
        classId: testClass.id,
        studentName: "Dela Cruz, Juan Jr.",
        firstName: "Juan",
        middleName: null,
        lastName: "Dela Cruz",
        suffix: "Jr.",
        sortKey: "DELACRUZ JUAN",
        studentId: "2400001",
      },
      {
        classId: testClass.id,
        studentName: "=Formula Risk",
        firstName: "=Formula",
        middleName: null,
        lastName: "Risk",
        suffix: null,
        sortKey: "RISK FORMULA",
        studentId: "2400002",
      },
    ],
  });

  // Login helper
  async function loginAs(email, password = "password123") {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const cookie = res.headers.get("set-cookie");
    return cookie ? cookie.split(";")[0] : "";
  }

  const facultyCookie = await loginAs(facultyUser.email);

  // Test 1: Download Template
  await t.test("GET /api/classes/:id/roster/template returns valid xlsx with header and pre-filled rows", async () => {
    const res = await fetch(`${baseUrl}/api/classes/${testClass.id}/roster/template`, {
      headers: { Cookie: facultyCookie },
    });
    assert.strictEqual(res.status, 200);
    assert.ok(res.headers.get("content-type").includes("spreadsheetml"));
    const disposition = res.headers.get("content-disposition");
    assert.ok(disposition.includes(`${testClass.classCode}_student_list_template.xlsx`));

    const arrayBuffer = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const workbook = XLSX.read(buffer, { type: "buffer" });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });

    // Verify Class Information section
    assert.strictEqual(rows[0][0], "CLASS INFORMATION");
    assert.strictEqual(rows[1][0], "Class Name");
    assert.strictEqual(rows[1][1], "CS 101 Template Test");
    assert.strictEqual(rows[2][0], "Class Code");
    assert.strictEqual(rows[2][1], testClass.classCode);

    // Verify formula escaping in template
    const formulaRow = rows.find((r) => r[1] === "2400002");
    assert.ok(formulaRow, "Formula row should be present");
    assert.strictEqual(formulaRow[0], "'=Formula Risk", "Formula should be prefixed with apostrophe");

    // Verify STUDENTS marker
    const studentsMarkerIdx = rows.findIndex((r) => r[0] === "STUDENTS");
    assert.ok(studentsMarkerIdx >= 0, "STUDENTS marker must exist");
  });

  // Test 2: Round-trip import
  await t.test("POST /api/classes/:id/roster/import round-trips template rows and ignores Class Information", async () => {
    // Generate an xlsx with STUDENTS marker and data rows
    const wb = XLSX.utils.book_new();
    const wsData = [
      ["CLASS INFORMATION", ""],
      ["Class Name", "Irrelevant Ignored Data"],
      ["", ""],
      ["STUDENTS", ""],
      ["Full Name (e.g., Jose P. Rizal)", "Student ID (7 digits)"],
      ["Santos, Maria Clara", "2500001"],
      ["Rizal, Jose P.", 2500002], // numeric to test left padding & coercion
      ["Al-Mansoor, Tariq", "2500003"],
    ];
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

    const res = await fetch(`${baseUrl}/api/classes/${testClass.id}/roster/import`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: facultyCookie,
      },
      body: JSON.stringify({
        fileName: "students.xlsx",
        fileBase64: buf.toString("base64"),
      }),
    });

    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.rows.length, 3);
    assert.strictEqual(body.rows[0].studentId, "2500001");
    // Name reordered from Surname, Given
    assert.ok(body.rows[0].studentName.includes("Maria Clara Santos"));
    assert.strictEqual(body.rows[1].studentId, "2500002");
    assert.strictEqual(body.rows[2].studentId, "2500003");
  });

  // Test 3: Fallback header detection (no STUDENTS marker)
  await t.test("POST /api/classes/:id/roster/import parses plain table without STUDENTS marker", async () => {
    const wb = XLSX.utils.book_new();
    const wsData = [
      ["Student Name", "Student ID"],
      ["Bonifacio, Andres", "2500004"],
      ["Silang, Gabriela", "2500005"],
    ];
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

    const res = await fetch(`${baseUrl}/api/classes/${testClass.id}/roster/import`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: facultyCookie,
      },
      body: JSON.stringify({
        fileName: "roster.csv",
        fileBase64: buf.toString("base64"),
      }),
    });

    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.rows.length, 2);
    assert.strictEqual(body.rows[0].studentId, "2500004");
  });

  // Test 4: Missing marker and headers error
  await t.test("POST /api/classes/:id/roster/import returns 400 when no headers found", async () => {
    const wb = XLSX.utils.book_new();
    const wsData = [
      ["Random Column", "Another Column"],
      ["Data 1", "Data 2"],
    ];
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

    const res = await fetch(`${baseUrl}/api/classes/${testClass.id}/roster/import`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: facultyCookie,
      },
      body: JSON.stringify({
        fileName: "invalid.xlsx",
        fileBase64: buf.toString("base64"),
      }),
    });

    assert.strictEqual(res.status, 400);
    const body = await res.json();
    assert.ok(body.message.includes("No STUDENTS section found"));
  });

  // Test 5: Rejects file over 2 MB
  await t.test("POST /api/classes/:id/roster/import rejects file over 2 MB", async () => {
    const largeBuffer = Buffer.alloc(2.1 * 1024 * 1024, "a");
    const res = await fetch(`${baseUrl}/api/classes/${testClass.id}/roster/import`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: facultyCookie,
      },
      body: JSON.stringify({
        fileName: "large.xlsx",
        fileBase64: largeBuffer.toString("base64"),
      }),
    });

    assert.strictEqual(res.status, 400);
    const body = await res.json();
    assert.ok(body.message.includes("exceeds 2 MB limit"));
  });

  // Cleanup
  await prisma.classRoster.deleteMany({ where: { classId: testClass.id } });
  await prisma.class.delete({ where: { id: testClass.id } });
  await prisma.user.delete({ where: { id: facultyUser.id } });
  server.close();
});
