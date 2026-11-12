const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { inflateRawSync } = require("node:zlib");
const { spawn } = require("node:child_process");
const net = require("node:net");

const {
  QA_PASSWORD,
  initSecurityBackend,
  apiRequest,
  loginAs,
  createSecurityFixtures,
} = require("./helpers/security-harness.cjs");

const sec = initSecurityBackend();
const repoRoot = path.resolve(__dirname, "../..");
const { prisma, mailer } = sec;
const XLSX = require(path.join(repoRoot, "classdex-backend", "node_modules", "xlsx"));

function findFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close((err) => (err ? reject(err) : resolve(port)));
    });
  });
}

function unzipXmlEntries(buffer) {
  let endOffset = -1;
  for (let offset = buffer.length - 22; offset >= Math.max(0, buffer.length - 65557); offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) {
      endOffset = offset;
      break;
    }
  }
  if (endOffset < 0) throw new Error("Not a valid zip archive");
  const count = buffer.readUInt16LE(endOffset + 10);
  let offset = buffer.readUInt32LE(endOffset + 16);
  const entries = {};
  for (let i = 0; i < count; i += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) break;
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLen = buffer.readUInt16LE(offset + 28);
    const extraLen = buffer.readUInt16LE(offset + 30);
    const commentLen = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.subarray(offset + 46, offset + 46 + nameLen).toString("utf8");
    const localNameLen = buffer.readUInt16LE(localOffset + 26);
    const localExtraLen = buffer.readUInt16LE(localOffset + 28);
    const dataOffset = localOffset + 30 + localNameLen + localExtraLen;
    const compressed = buffer.subarray(dataOffset, dataOffset + compressedSize);
    const data = method === 8 ? inflateRawSync(compressed) : Buffer.from(compressed);
    entries[name] = data.toString("utf8");
    offset += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

async function rawHttpRequest(baseUrl, method, urlPath, { cookie, body, headers = {}, rawBody } = {}) {
  const reqHeaders = { ...headers };
  if (cookie) reqHeaders.Cookie = cookie;
  let payload = rawBody;
  if (rawBody === undefined && body !== undefined) {
    payload = JSON.stringify(body);
    if (!reqHeaders["Content-Type"]) reqHeaders["Content-Type"] = "application/json";
  }
  const res = await fetch(`${baseUrl}${urlPath}`, {
    method,
    headers: reqHeaders,
    body: payload,
    redirect: "manual",
  });
  const arrayBuf = await res.arrayBuffer();
  const buffer = Buffer.from(arrayBuf);
  const text = buffer.toString("utf8");
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: res.status, headers: res.headers, buffer, text, json };
}

const TINY_PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

test("SCRUM-71: Input Validation, SQLi, Email Escaping, Uploads, Exports & Error Handling", async (t) => {
  const srv = await sec.startServer();
  const fx = await createSecurityFixtures(prisma, "s71");

  const facLogin = await loginAs(srv.baseUrl, fx.facA.email);
  assert.equal(facLogin.status, 200);
  const facCookie = facLogin.sidCookie;

  const stuLogin = await loginAs(srv.baseUrl, fx.stuA1.email);
  assert.equal(stuLogin.status, 200);
  const stuCookie = stuLogin.sidCookie;

  t.after(async () => {
    await fx.cleanup();
    await srv.close();
    await prisma.$disconnect();
  });

  await t.test("INJ-01: static raw SQL audit confirms zero unsafe SQL interpolation and runtime queries handle SQL chars safely", async () => {
    const backendDir = path.join(repoRoot, "classdex-backend");
    const jsFiles = [];
    function walk(dir) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name === "generated") continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith(".js")) jsFiles.push(full);
      }
    }
    walk(backendDir);

    const unsafeHits = [];
    const parameterizedHits = [];
    for (const file of jsFiles) {
      const content = fs.readFileSync(file, "utf8");
      const lines = content.split(/\r?\n/);
      lines.forEach((line, idx) => {
        if (/(\$queryRawUnsafe|\$executeRawUnsafe|Prisma\.raw\s*\()/i.test(line)) {
          unsafeHits.push(`${path.relative(repoRoot, file)}:${idx + 1}: ${line.trim()}`);
        }
        if (/(\$queryRaw|\$executeRaw)\b/.test(line)) {
          parameterizedHits.push(`${path.relative(repoRoot, file)}:${idx + 1}`);
        }
      });
    }

    assert.deepEqual(unsafeHits, []);
    const indexRawHits = parameterizedHits.filter((h) =>
      /^classdex-backend[\\/]index\.js:\d+$/.test(h),
    );
    assert.equal(
      indexRawHits.length,
      2,
      `Expected 2 parameterized $queryRaw/$executeRaw calls in classdex-backend/index.js, found ${indexRawHits.join(", ")}`,
    );

    const pCounts = await apiRequest(srv.baseUrl, "GET", "/api/faculty/classes/pending-counts", { cookie: facCookie });
    assert.equal(pCounts.status, 200);
    const sClasses = await apiRequest(srv.baseUrl, "GET", "/api/student/classes", { cookie: stuCookie });
    assert.equal(sClasses.status, 200);
  });

  await t.test("INJ-02: runtime SQL injection payloads across text fields, queries, and path params cause no SQL execution or leaks", async () => {
    const beforeUsers = await prisma.user.count();
    const sqliPayloads = [
      "' OR '1'='1",
      "1'; DROP TABLE \"User\";--",
      "' UNION SELECT NULL,NULL--",
    ];

    for (const payload of sqliPayloads) {
      const l = await apiRequest(srv.baseUrl, "POST", "/api/auth/login", {
        body: { email: `qa_${payload}@test.local`, password: payload },
      });
      assert.ok([400, 401].includes(l.status));
      assert.ok(!/sql|prisma|syntax|postgres/i.test(l.rawText));

      const noSpaceLogin = await apiRequest(srv.baseUrl, "POST", "/api/auth/login", {
        body: { email: `qa_${payload.replace(/\s+/g, "")}@test.local`, password: payload },
      });
      assert.equal(noSpaceLogin.status, 401);
      assert.ok(!/sql|prisma|syntax|postgres/i.test(noSpaceLogin.rawText));

      const chk = await apiRequest(srv.baseUrl, "GET", `/api/classes/check-code?code=${encodeURIComponent(payload)}`, {
        cookie: facCookie,
      });
      assert.equal(chk.status, 200);
      assert.equal(chk.json.available, false);

      const joinRes = await apiRequest(srv.baseUrl, "POST", "/api/classes/join", {
        cookie: stuCookie,
        body: { classCode: payload, recaptchaToken: "ok" },
      });
      assert.ok([400, 404].includes(joinRes.status));
      assert.ok(!/sql|prisma|syntax|postgres/i.test(joinRes.rawText));

      const idProbe = await apiRequest(srv.baseUrl, "GET", `/api/classes/${encodeURIComponent(payload)}`, {
        cookie: facCookie,
      });
      assert.equal(idProbe.status, 404);
    }

    const sqliClass = await apiRequest(srv.baseUrl, "POST", "/api/classes", {
      cookie: facCookie,
      body: {
        sectionName: `qa_SQLi ' OR '1'='1 -- ${fx.runId}`,
        courseCode: "QA-SQL 1",
        courseTitle: "qa_SQLi '; DROP TABLE \"User\";--",
        description: "Test' UNION SELECT 1--",
      },
    });
    assert.equal(sqliClass.status, 201);
    assert.equal(sqliClass.json.class.description, "Test' UNION SELECT 1--");
    await prisma.class.delete({ where: { id: sqliClass.json.class.id } });

    const afterUsers = await prisma.user.count();
    assert.equal(afterUsers, beforeUsers);
  });

  await t.test("INJ-03: Prisma/NoSQL operator objects and arrays in string fields must return 400 instead of coercing to '[object Object]'", { todo: "SEC-15" }, async () => {
    const resCls = await apiRequest(srv.baseUrl, "POST", "/api/classes", {
      cookie: facCookie,
      body: {
        sectionName: { $gt: "" },
        courseCode: `QA-OBJ1`,
        courseTitle: "qa_ValidCourseTitle",
      },
    });
    if (resCls.status === 201 && resCls.json?.class?.id) {
      await prisma.class.delete({ where: { id: resCls.json.class.id } });
    }
    assert.equal(resCls.status, 400, `Expected 400 for object sectionName, got ${resCls.status} (${resCls.rawText})`);

    const resProf = await apiRequest(srv.baseUrl, "PUT", "/api/faculty/profile", {
      cookie: facCookie,
      body: { name: { $gt: "" }, department: ["qa_IT"] },
    });
    assert.equal(resProf.status, 400, `Expected 400 for object/array profile fields, got ${resProf.status}`);
  });

  await t.test("INJ-04a: standard negative, decimal, non-numeric, and above-max scores & limits rejected cleanly (400)", async () => {
    for (const badGrace of [-1, 1.5, "15", null, 1441, { $gt: 0 }]) {
      const r = await apiRequest(srv.baseUrl, "PATCH", `/api/classes/${fx.facAClass1.id}`, {
        cookie: facCookie,
        body: { gracePeriodMinutes: badGrace },
      });
      assert.equal(r.status, 400);
    }

    for (const badTotal of [0, -5, 10.5, "ten", null, { $gt: 0 }]) {
      const r = await apiRequest(srv.baseUrl, "POST", `/api/classes/${fx.facAClass1.id}/quizzes`, {
        cookie: facCookie,
        body: { title: "qa_BadQuiz", totalItems: badTotal },
      });
      assert.equal(r.status, 400);
    }

    for (const badScore of [-1, 5.5, 999, "NaN", "10"]) {
      const rAct = await apiRequest(srv.baseUrl, "PUT", `/api/activities/${fx.a1Data.activity.id}/scores/${fx.stuA1.studentProfile.id}`, {
        cookie: facCookie,
        body: { score: badScore },
      });
      assert.equal(rAct.status, 400);
    }

    for (const badScore of [-1, 5.5, 999, "NaN"]) {
      const rQuiz = await apiRequest(srv.baseUrl, "PUT", `/api/quizzes/${fx.a1Data.quiz.id}/scores/${fx.stuA1.studentProfile.id}`, {
        cookie: facCookie,
        body: { score: badScore },
      });
      assert.equal(rQuiz.status, 400);
    }

    const rRec = await apiRequest(srv.baseUrl, "PATCH", `/api/recitation-logs/${fx.a1Data.recitationLog.id}`, {
      cookie: facCookie,
      body: { score: 6 },
    });
    assert.equal(rRec.status, 400);

    for (const badProjScore of [-1, 10.5, 101, "NaN", "999"]) {
      const rProj = await apiRequest(srv.baseUrl, "PUT", `/api/projects/${fx.a1Data.midtermProject.id}/scores/${fx.stuA1.studentProfile.id}`, {
        cookie: facCookie,
        body: { score: badProjScore, sessionId: null },
      });
      assert.equal(rProj.status, 400, `Project score accepted invalid value=${JSON.stringify(badProjScore)}`);
    }
  });

  await t.test("INJ-04b: INT4 overflow integers and string/boolean quiz score coercion must reject cleanly with 400 (never 500)", { todo: "SEC-12" }, async () => {
    const overflowQuiz = await apiRequest(srv.baseUrl, "POST", `/api/classes/${fx.facAClass1.id}/quizzes`, {
      cookie: facCookie,
      body: { title: "qa_OverflowQuiz", totalItems: 99_999_999_999 },
    });
    if (overflowQuiz.status === 201 && overflowQuiz.json?.session?.id) {
      await prisma.quizSession.delete({ where: { id: overflowQuiz.json.session.id } });
    }
    assert.equal(overflowQuiz.status, 400, `Expected 400 for INT4 overflow totalItems, got ${overflowQuiz.status}`);

    const strQuizScore = await apiRequest(srv.baseUrl, "PUT", `/api/quizzes/${fx.a1Data.quiz.id}/scores/${fx.stuA1.studentProfile.id}`, {
      cookie: facCookie,
      body: { score: "10" },
    });
    assert.equal(strQuizScore.status, 400, `Expected strict integer 400 for string quiz score, got ${strQuizScore.status}`);
  });

  await t.test("INJ-05: 7-digit studentId bypass payloads rejected cleanly (400)", async () => {
    for (const badId of ["123456", "12345678", "123 456", "123\n4567", "१२३४५६७", "123456a", { $gt: "" }]) {
      const rProf = await apiRequest(srv.baseUrl, "PUT", "/api/student/profile", {
        cookie: stuCookie,
        body: {
          name: fx.stuA1.name,
          studentId: badId,
          email: fx.stuA1.email,
          photo: TINY_PNG_DATA_URL,
        },
      });
      assert.equal(rProf.status, 400, `Profile accepted bad studentId=${JSON.stringify(badId)}`);

      const rRos = await apiRequest(srv.baseUrl, "POST", `/api/classes/${fx.facAClass1.id}/roster`, {
        cookie: facCookie,
        body: { entries: [{ studentName: "qa_BadId", studentId: badId }] },
      });
      assert.equal(rRos.status, 400, `Roster accepted bad studentId=${JSON.stringify(badId)}`);
    }
  });

  await t.test("INJ-08: email templates HTML-escape interpolated user names, class titles, and section names in stub mailbox", async () => {
    mailer.clearStubEmails();
    const xssPayload = '<script>window.__xss=1</script><img src=x onerror="alert(1)">';
    const xssEmail = `qa_mailxss_${fx.runId}@test.local`;
    let createdUserId = null;
    let createdClassId = null;

    try {
      const reg = await apiRequest(srv.baseUrl, "POST", "/api/auth/register", {
        body: {
          name: xssPayload,
          email: xssEmail,
          password: QA_PASSWORD,
          confirmPassword: QA_PASSWORD,
          role: "STUDENT",
          recaptchaToken: "ok",
        },
      });
      assert.equal(reg.status, 201);
      createdUserId = reg.json.user.id;
      const stuXssCookie = reg.sidCookie;

      await apiRequest(srv.baseUrl, "POST", "/api/auth/forgot-password", {
        body: { email: xssEmail, recaptchaToken: "ok" },
      });

      await apiRequest(srv.baseUrl, "PUT", "/api/student/profile", {
        cookie: stuXssCookie,
        body: {
          name: xssPayload,
          studentId: "9912345",
          email: xssEmail,
          photo: TINY_PNG_DATA_URL,
        },
      });

      const xssClass = await apiRequest(srv.baseUrl, "POST", "/api/classes", {
        cookie: facCookie,
        body: {
          sectionName: `qa_${xssPayload}`,
          courseCode: "QA-XSS",
          courseTitle: `qa_${xssPayload}`,
        },
      });
      assert.equal(xssClass.status, 201);
      createdClassId = xssClass.json.class.id;

      await apiRequest(srv.baseUrl, "POST", "/api/classes/join", {
        cookie: stuXssCookie,
        body: { classCode: xssClass.json.class.classCode, recaptchaToken: "ok" },
      });

      const mails = mailer.getStubEmails();
      assert.ok(mails.length >= 4);
      const allowedTagRegex = /^<\/?(?:!DOCTYPE|html|head|meta|title|body|div|table|tr|td|span|h1|p|strong|a|br)\b/i;
      for (const m of mails) {
        const htmlTags = m.html.match(/<[^>]+>/g) || [];
        const unexpectedTags = htmlTags.filter((tag) => !allowedTagRegex.test(tag));
        assert.deepEqual(unexpectedTags, [], `Unexpected HTML tags rendered in email "${m.subject}": ${unexpectedTags.join(", ")}`);
        assert.ok(m.html.includes("&lt;script&gt;"), `Expected entity-escaped payload in email "${m.subject}"`);
      }
    } finally {
      if (createdClassId) await prisma.class.deleteMany({ where: { id: createdClassId } });
      if (createdUserId) await prisma.user.deleteMany({ where: { id: createdUserId } });
    }
  });

  await t.test("INJ-09a: roster upload enforces extensions, 2MB cap, corrupt zip, 500 row cap, formula non-eval & repetitive compression", async () => {
    const badExt = await apiRequest(srv.baseUrl, "POST", `/api/classes/${fx.facAClass1.id}/roster/import`, {
      cookie: facCookie,
      body: { fileName: "evil.svg", fileBase64: Buffer.from("<svg/>").toString("base64") },
    });
    assert.equal(badExt.status, 400);

    const doubleExtCsv = await apiRequest(srv.baseUrl, "POST", `/api/classes/${fx.facAClass1.id}/roster/import`, {
      cookie: facCookie,
      body: { fileName: "bad.exe.html", fileBase64: Buffer.from("<html/>").toString("base64") },
    });
    assert.equal(doubleExtCsv.status, 400);

    const over2Mb = await apiRequest(srv.baseUrl, "POST", `/api/classes/${fx.facAClass1.id}/roster/import`, {
      cookie: facCookie,
      body: { fileName: "big.csv", fileBase64: Buffer.alloc(2 * 1024 * 1024 + 50, 65).toString("base64") },
    });
    assert.equal(over2Mb.status, 400);

    const corruptZip = await apiRequest(srv.baseUrl, "POST", `/api/classes/${fx.facAClass1.id}/roster/import`, {
      cookie: facCookie,
      body: { fileName: "bad.xlsx", fileBase64: Buffer.from("PK\x03\x04corrupt").toString("base64") },
    });
    assert.equal(corruptZip.status, 400);

    const wbMany = XLSX.utils.book_new();
    const aoa = [["Full Name", "Student ID"]];
    for (let i = 0; i < 505; i += 1) {
      aoa.push([`qa_Student ${i}`, String(8000000 + i)]);
    }
    XLSX.utils.book_append_sheet(wbMany, XLSX.utils.aoa_to_sheet(aoa), "Student List");
    const manyBuf = XLSX.write(wbMany, { type: "buffer", bookType: "xlsx" });
    const over500 = await apiRequest(srv.baseUrl, "POST", `/api/classes/${fx.facAClass1.id}/roster/import`, {
      cookie: facCookie,
      body: { fileName: "many.xlsx", fileBase64: manyBuf.toString("base64") },
    });
    assert.equal(over500.status, 400);

    const wbFormula = XLSX.utils.book_new();
    const aoaF = [
      ["STUDENTS", ""],
      ["Full Name", "Student ID"],
      [{ f: "1+1" }, "8123456"],
      ["qa_Repetitive " + "A".repeat(200), "8123457"],
    ];
    XLSX.utils.book_append_sheet(wbFormula, XLSX.utils.aoa_to_sheet(aoaF), "Student List");
    const fBuf = XLSX.write(wbFormula, { type: "buffer", bookType: "xlsx", compression: true });
    const impF = await apiRequest(srv.baseUrl, "POST", `/api/classes/${fx.facAClass1.id}/roster/import`, {
      cookie: facCookie,
      body: { fileName: "safe.xlsx", fileBase64: fBuf.toString("base64") },
    });
    assert.equal(impF.status, 200);
    assert.equal(impF.json.rows[0].studentName, "");
    assert.equal(impF.json.rows[1].studentId, "8123457");
  });

  await t.test("INJ-09b: roster import must reject non-string fileBase64 (400) and disguised HTML content inside .xlsx extension", { todo: "SEC-13" }, async () => {
    const badTypeB64 = await apiRequest(srv.baseUrl, "POST", `/api/classes/${fx.facAClass1.id}/roster/import`, {
      cookie: facCookie,
      body: { fileName: "test.csv", fileBase64: { $gt: "" } },
    });
    assert.equal(badTypeB64.status, 400, `Non-string fileBase64 returned ${badTypeB64.status}: ${badTypeB64.rawText}`);

    const disguisedHtml = Buffer.from("<html><body><table><tr><th>Name</th><th>Student ID</th></tr><tr><td>qa_Disguised</td><td>8234567</td></tr></table></body></html>");
    const htmlInXlsx = await apiRequest(srv.baseUrl, "POST", `/api/classes/${fx.facAClass1.id}/roster/import`, {
      cookie: facCookie,
      body: { fileName: "roster.html.xlsx", fileBase64: disguisedHtml.toString("base64") },
    });
    assert.equal(htmlInXlsx.status, 400, `Expected 400 for HTML bytes inside .xlsx, got ${htmlInXlsx.status}`);
  });

  await t.test("INJ-10a: faculty profile photo endpoint must enforce isValidPhoto and reject SVG/javascript/http payloads", async () => {
    for (const badPhoto of [
      "javascript:alert(1)",
      "data:image/svg+xml;base64," + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="window.__xss=9"></svg>').toString("base64"),
      "http://evil.example/a.jpg",
    ]) {
      const r = await apiRequest(srv.baseUrl, "PUT", "/api/faculty/profile", {
        cookie: facCookie,
        body: { name: fx.facA.name, department: "qa_IT", photo: badPhoto },
      });
      assert.equal(r.status, 400, `Faculty profile accepted unsafe photo=${badPhoto.slice(0, 32)} with status ${r.status}`);
    }
  });

  await t.test("INJ-10b: student profile photo must validate image magic bytes and disallow arbitrary external 302 redirect URLs", async () => {
    try {
      const fakeJpg = `data:image/jpeg;base64,${Buffer.from("<html><script>window.__xss=8</script></html>").toString("base64")}`;
      const rFake = await apiRequest(srv.baseUrl, "PUT", "/api/student/profile", {
        cookie: stuCookie,
        body: { name: fx.stuA1.name, studentId: fx.stuA1.studentProfile.studentId, email: fx.stuA1.email, photo: fakeJpg },
      });
      assert.equal(rFake.status, 400, `Student profile accepted disguised HTML bytes as JPEG (status ${rFake.status})`);

      const rExt = await apiRequest(srv.baseUrl, "PUT", "/api/student/profile", {
        cookie: stuCookie,
        body: {
          name: fx.stuA1.name,
          studentId: fx.stuA1.studentProfile.studentId,
          email: fx.stuA1.email,
          photo: "https://evil.example/phish.html",
        },
      });
      assert.equal(rExt.status, 400, `Student profile accepted arbitrary third-party URL (status ${rExt.status})`);
    } finally {
      await apiRequest(srv.baseUrl, "PUT", "/api/student/profile", {
        cookie: stuCookie,
        body: { name: fx.stuA1.name, studentId: fx.stuA1.studentProfile.studentId, email: fx.stuA1.email, photo: TINY_PNG_DATA_URL },
      });
    }
  });

  await t.test("INJ-11a: express.json >8MB returns 413, deeply nested JSON & RTL Unicode handled safely, and valid photo restored", async () => {
    const over8MbJson = JSON.stringify({ pad: "A".repeat(8 * 1024 * 1024 + 512) });
    const r413 = await rawHttpRequest(srv.baseUrl, "POST", "/api/classes", {
      cookie: facCookie,
      rawBody: over8MbJson,
      headers: { "Content-Type": "application/json" },
    });
    assert.equal(r413.status, 413);

    let nested = { leaf: "ok" };
    for (let i = 0; i < 200; i += 1) nested = { level: nested };
    const rDeep = await apiRequest(srv.baseUrl, "POST", "/api/classes", {
      cookie: facCookie,
      body: nested,
    });
    assert.equal(rDeep.status, 400);

    const rtlClass = await apiRequest(srv.baseUrl, "POST", "/api/classes", {
      cookie: facCookie,
      body: {
        sectionName: `qa_RTL_\u202Egpj.exe_${fx.runId}`,
        courseCode: "QA-RTL1",
        courseTitle: "qa_UnicodeRTL",
      },
    });
    assert.ok([201, 400].includes(rtlClass.status));
    if (rtlClass.status === 201 && rtlClass.json?.class?.id) {
      await prisma.class.delete({ where: { id: rtlClass.json.class.id } });
    }

    await apiRequest(srv.baseUrl, "PUT", "/api/student/profile", {
      cookie: stuCookie,
      body: { name: fx.stuA1.name, studentId: fx.stuA1.studentProfile.studentId, email: fx.stuA1.email, photo: TINY_PNG_DATA_URL },
    });
    await apiRequest(srv.baseUrl, "PUT", "/api/faculty/profile", {
      cookie: facCookie,
      body: { name: fx.facA.name, department: "qa_IT", photo: TINY_PNG_DATA_URL },
    });
  });

  await t.test("INJ-11b: null bytes (\\u0000) and >100KB text fields must reject cleanly with 400 (never 500)", { todo: "SEC-14" }, async () => {
    const rNull = await apiRequest(srv.baseUrl, "POST", "/api/classes", {
      cookie: facCookie,
      body: {
        sectionName: `qa_Null\u0000Byte_${fx.runId}`,
        courseCode: "QA-NULL1",
        courseTitle: "qa_NullByte",
      },
    });
    if (rNull.status === 201 && rNull.json?.class?.id) {
      await prisma.class.delete({ where: { id: rNull.json.class.id } });
    }
    assert.equal(rNull.status, 400, `Null byte returned ${rNull.status}: ${rNull.rawText}`);

    const r100k = await apiRequest(srv.baseUrl, "POST", "/api/classes", {
      cookie: facCookie,
      body: {
        sectionName: `qa_${"X".repeat(100_000)}`,
        courseCode: "QA-BIG1",
        courseTitle: "qa_BigTitle",
      },
    });
    if (r100k.status === 201 && r100k.json?.class?.id) {
      await prisma.class.delete({ where: { id: r100k.json.class.id } });
    }
    assert.equal(r100k.status, 400, `100KB sectionName returned ${r100k.status}`);
  });

  await t.test("INJ-12a: CSV & XLSX exports neutralize =, +, -, @ prefixes cleanly and emit zero <f> formula elements", async () => {
    const prefixes = ["=1+1", "+1+1", "-1+1", "@SUM(1,1)"];
    const formulaStudents = [];
    for (let i = 0; i < prefixes.length; i += 1) {
      const payload = prefixes[i];
      const u = await prisma.user.create({
        data: {
          name: `qa_fa_${i}`,
          email: `qa_s71_fa_${i}_${fx.runId}@test.local`,
          password: fx.stuA1.password,
          role: "STUDENT",
          emailVerified: true,
        },
      });
      const sp = await prisma.studentProfile.create({
        data: {
          userId: u.id,
          name: payload,
          firstName: payload,
          lastName: payload,
          sortKey: `fa_${i}`,
          studentId: `771000${i}`,
          email: u.email,
          photo: TINY_PNG_DATA_URL,
        },
      });
      await prisma.classEnrollment.create({
        data: { classId: fx.facAClass1.id, studentProfileId: sp.id, status: "APPROVED" },
      });
      formulaStudents.push(u.id);
    }

    try {
      const csvRes = await rawHttpRequest(srv.baseUrl, "GET", `/api/classes/${fx.facAClass1.id}/export/csv?types=students`, {
        cookie: facCookie,
      });
      assert.equal(csvRes.status, 200);
      for (const expectedCsv of ["'=1+1", "'+1+1", "'-1+1", "'@SUM(1,1)"]) {
        assert.ok(csvRes.text.includes(expectedCsv), `CSV missing ${expectedCsv}`);
      }

      const xlsxRes = await rawHttpRequest(srv.baseUrl, "GET", `/api/classes/${fx.facAClass1.id}/export/excel?types=students`, {
        cookie: facCookie,
      });
      assert.equal(xlsxRes.status, 200);
      const xmlMap = unzipXmlEntries(xlsxRes.buffer);
      const combinedXml = Object.values(xmlMap).join("\n");
      assert.ok(!/<f[ >]/.test(combinedXml), "XLSX contains executable <f> formula elements");
      for (const expectedXml of ["&apos;=1+1", "&apos;+1+1", "&apos;-1+1", "&apos;@SUM(1,1)"]) {
        assert.ok(combinedXml.includes(expectedXml), `XLSX XML missing ${expectedXml}`);
      }
    } finally {
      await prisma.user.deleteMany({ where: { id: { in: formulaStudents } } });
    }
  });

  await t.test("INJ-12b: CSV & XLSX exports must also neutralize leading tab (\\t), CR (\\r), and leading whitespace formulas", { todo: "SEC-11" }, async () => {
    const prefixes = ["\t=1+1", "\r=1+1", " =1+1"];
    const formulaStudents = [];
    for (let i = 0; i < prefixes.length; i += 1) {
      const payload = prefixes[i];
      const u = await prisma.user.create({
        data: {
          name: `qa_fb_${i}`,
          email: `qa_s71_fb_${i}_${fx.runId}@test.local`,
          password: fx.stuA1.password,
          role: "STUDENT",
          emailVerified: true,
        },
      });
      const sp = await prisma.studentProfile.create({
        data: {
          userId: u.id,
          name: payload,
          firstName: payload,
          lastName: payload,
          sortKey: `fb_${i}`,
          studentId: `771010${i}`,
          email: u.email,
          photo: TINY_PNG_DATA_URL,
        },
      });
      await prisma.classEnrollment.create({
        data: { classId: fx.facAClass1.id, studentProfileId: sp.id, status: "APPROVED" },
      });
      formulaStudents.push(u.id);
    }

    try {
      const csvRes = await rawHttpRequest(srv.baseUrl, "GET", `/api/classes/${fx.facAClass1.id}/export/csv?types=students`, {
        cookie: facCookie,
      });
      assert.equal(csvRes.status, 200);
      assert.ok(csvRes.text.includes(`"'\t=1+1"`), "CSV failed to neutralize leading TAB (\\t=1+1)");
      assert.ok(csvRes.text.includes(`"'\r=1+1"`), "CSV failed to neutralize leading CR (\\r=1+1)");
      assert.ok(csvRes.text.includes(`"' =1+1"`), "CSV failed to neutralize leading SPACE formula ( =1+1)");

      const xlsxRes = await rawHttpRequest(srv.baseUrl, "GET", `/api/classes/${fx.facAClass1.id}/export/excel?types=students`, {
        cookie: facCookie,
      });
      assert.equal(xlsxRes.status, 200);
      const xmlMap = unzipXmlEntries(xlsxRes.buffer);
      const combinedXml = Object.values(xmlMap).join("\n");
      assert.ok(combinedXml.includes("&apos;\t=1+1"), "XLSX failed to prefix leading TAB (\\t=1+1)");
      assert.ok(combinedXml.includes("&apos;\r=1+1") || combinedXml.includes("&apos;&#x0d;=1+1"), "XLSX failed to prefix leading CR (\\r=1+1)");
      assert.ok(combinedXml.includes("&apos; =1+1"), "XLSX failed to prefix leading SPACE formula ( =1+1)");
    } finally {
      await prisma.user.deleteMany({ where: { id: { in: formulaStudents } } });
    }
  });

  await t.test("INJ-13a: NODE_ENV=production hides stack traces and filesystem paths on malformed JSON & 413 errors", async () => {
    const prodPort = await findFreePort();
    const wrapperPath = path.join(repoRoot, "tests", "scripts", "start-test-backend.cjs");
    const prodChild = spawn(process.execPath, [wrapperPath, `--port=${prodPort}`, "--production"], {
      cwd: repoRoot,
      env: { ...process.env, NODE_ENV: "production", EMAIL_MODE: "stub" },
      stdio: ["ignore", "pipe", "pipe"],
    });

    try {
      const prodUrl = `http://127.0.0.1:${prodPort}`;
      const deadline = Date.now() + 25_000;
      let ready = false;
      while (Date.now() < deadline) {
        try {
          const st = await fetch(`${prodUrl}/api/status`);
          if (st.ok) {
            ready = true;
            break;
          }
        } catch {}
        await new Promise((r) => setTimeout(r, 250));
      }
      assert.ok(ready, "Production-mode test backend failed to start");

      const prodMalformed = await rawHttpRequest(prodUrl, "POST", "/api/auth/login", {
        rawBody: "{bad-json",
        headers: { "Content-Type": "application/json" },
      });
      assert.equal(prodMalformed.status, 400);
      assert.ok(!/SyntaxError[\s\S]*at\s+|node_modules|ClassDex/i.test(prodMalformed.text));
    } finally {
      prodChild.kill();
      await new Promise((r) => setTimeout(r, 250));
    }
  });

  await t.test("INJ-13b: malformed JSON & middleware errors must use custom JSON error handler without leaking stack traces in dev/test", { todo: "SEC-16" }, async () => {
    const testMalformed = await rawHttpRequest(srv.baseUrl, "POST", "/api/auth/login", {
      rawBody: "{bad-json",
      headers: { "Content-Type": "application/json" },
    });
    assert.equal(testMalformed.status, 400);
    assert.ok(
      !/SyntaxError[\s\S]*at\s+|ClassDex|node_modules/i.test(testMalformed.text),
      "Malformed JSON leaked stack trace and server filesystem path",
    );
  });

  await t.test("INJ-14: spoofed Host / X-Forwarded-Host headers & open-redirect query params never poison email links", async () => {
    mailer.clearStubEmails();
    const res = await rawHttpRequest(
      srv.baseUrl,
      "POST",
      "/api/auth/forgot-password?redirect=https://evil.example&next=//evil.example&returnUrl=javascript:alert(1)",
      {
        headers: {
          "Content-Type": "application/json",
          "X-Forwarded-Host": "evil.attacker.test",
          "X-Forwarded-Proto": "https",
        },
        body: {
          email: fx.facUnverified.email,
          recaptchaToken: "ok",
          redirect: "https://evil.example",
        },
      },
    );
    assert.equal(res.status, 200);
    const mail = mailer.getStubEmails().at(-1);
    assert.ok(mail && mail.link);
    assert.ok(!mail.link.includes("evil.attacker.test") && !mail.link.includes("evil.example"));
    assert.ok(!mail.html.includes("evil.attacker.test"));
  });

  await t.test("INJ-15: Content-Disposition headers quote filenames and block CRLF / header parameter injection", async () => {
    const weirdClass = await apiRequest(srv.baseUrl, "POST", "/api/classes", {
      cookie: facCookie,
      body: {
        sectionName: 'qa_Test";filename="evil.exe\r\nX-Injected: 1',
        courseCode: "QA-HDR1",
        courseTitle: "qa_HeaderTest",
        classCode: "QAHDR1",
      },
    });
    assert.equal(weirdClass.status, 201);
    try {
      for (const ep of [
        `/api/classes/${weirdClass.json.class.id}/export/excel`,
        `/api/classes/${weirdClass.json.class.id}/export/csv`,
        `/api/classes/${weirdClass.json.class.id}/roster/template`,
      ]) {
        const res = await rawHttpRequest(srv.baseUrl, "GET", ep, { cookie: facCookie });
        assert.equal(res.status, 200);
        const cd = res.headers.get("content-disposition") || "";
        assert.ok(cd.startsWith("attachment; filename="));
        assert.ok(!/[\r\n]/.test(cd));
        assert.equal(res.headers.get("x-injected"), null);
        const quoteCount = (cd.match(/"/g) || []).length;
        assert.equal(quoteCount, 2, `Unexpected quotes in Content-Disposition: ${cd}`);
      }
    } finally {
      await prisma.class.delete({ where: { id: weirdClass.json.class.id } });
    }
  });

  await t.test("INJ-16: bulk array shapes, prototype pollution keys (__proto__/constructor), and duplicate IDs handled safely", async () => {
    const protoRes = await rawHttpRequest(srv.baseUrl, "POST", "/api/classes", {
      cookie: facCookie,
      rawBody: JSON.stringify({
        sectionName: `qa_Proto_${fx.runId}`,
        courseCode: "QA-PRT1",
        courseTitle: "qa_ProtoTest",
      }).replace("{", '{"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}},'),
      headers: { "Content-Type": "application/json" },
    });
    assert.equal(({}).polluted, undefined);
    if (protoRes.status === 201 && protoRes.json?.class?.id) {
      await prisma.class.delete({ where: { id: protoRes.json.class.id } });
    }

    const badBulkAtt = await apiRequest(srv.baseUrl, "PUT", `/api/sessions/${fx.a1Data.session.id}/attendance`, {
      cookie: facCookie,
      body: { updates: "not-an-array" },
    });
    assert.equal(badBulkAtt.status, 400);

    const dupQuiz = await apiRequest(srv.baseUrl, "PUT", `/api/quizzes/${fx.a1Data.quiz.id}/scores`, {
      cookie: facCookie,
      body: {
        scores: [
          { studentId: fx.stuA1.studentProfile.id, score: 5 },
          { studentId: fx.stuA1.studentProfile.id, score: 8 },
        ],
      },
    });
    assert.ok([200, 400, 409].includes(dupQuiz.status), `Duplicate bulk quiz IDs returned unexpected ${dupQuiz.status}: ${dupQuiz.rawText}`);
  });
});
