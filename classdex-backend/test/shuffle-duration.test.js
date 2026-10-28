require("dotenv").config();
const test = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcryptjs");
const { app, resetRateLimitersForTests } = require("../index");
const { prisma } = require("../db");

test("§4: Recitation Shuffle Duration", async (t) => {
  resetRateLimitersForTests();
  const server = app.listen(0);
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;
  const runId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const hashedPassword = await bcrypt.hash("password123", 10);

  // 1. Create Faculty User & Class
  const facultyUser = await prisma.user.create({
    data: {
      name: "Shuffle Duration Faculty",
      email: `faculty.shuffle.${runId}@test.local`,
      password: hashedPassword,
      role: "FACULTY",
      emailVerified: true,
    },
  });

  const testClass = await prisma.class.create({
    data: {
      sectionName: "Shuffle Test Section",
      classCode: `SHF-${runId}`.slice(0, 10).toUpperCase(),
      facultyId: facultyUser.id,
    },
  });

  // Verify default is 3
  assert.strictEqual(testClass.recitationShuffleSeconds, 3);

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

  // Test deck endpoint returns recitationShuffleSeconds
  await t.test("GET /api/classes/:id/deck returns default recitationShuffleSeconds", async () => {
    const res = await fetch(`${baseUrl}/api/classes/${testClass.id}/deck`, {
      headers: { Cookie: facultyCookie },
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.class.recitationShuffleSeconds, 3);
  });

  // Test PATCH invalid values
  const invalidValues = [0, 8, 2.5, "abc", -1, 10];
  for (const val of invalidValues) {
    await t.test(`PATCH /api/classes/:id rejects invalid value: ${JSON.stringify(val)}`, async () => {
      const res = await fetch(`${baseUrl}/api/classes/${testClass.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Cookie: facultyCookie,
        },
        body: JSON.stringify({ recitationShuffleSeconds: val }),
      });
      assert.strictEqual(res.status, 400);
      const body = await res.json();
      assert.ok(body.message.includes("between 1 and 7 seconds"));
    });
  }

  // Test PATCH valid values: 1 and 7
  await t.test("PATCH /api/classes/:id accepts boundary value 1", async () => {
    const res = await fetch(`${baseUrl}/api/classes/${testClass.id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Cookie: facultyCookie,
      },
      body: JSON.stringify({ recitationShuffleSeconds: 1 }),
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.class.recitationShuffleSeconds, 1);
  });

  await t.test("PATCH /api/classes/:id accepts boundary value 7", async () => {
    const res = await fetch(`${baseUrl}/api/classes/${testClass.id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Cookie: facultyCookie,
      },
      body: JSON.stringify({ recitationShuffleSeconds: 7 }),
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.class.recitationShuffleSeconds, 7);
  });

  // Cleanup
  await prisma.class.delete({ where: { id: testClass.id } });
  await prisma.user.delete({ where: { id: facultyUser.id } });
  server.close();
});
