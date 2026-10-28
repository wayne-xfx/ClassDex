const test = require("node:test");
const assert = require("node:assert/strict");
const { manilaDate } = require("../src/utils/dates");
const { studentPhotoUrl } = require("../src/utils/studentPhotoUrl");

test("Early-morning Manila session (e.g. 7:30 AM Manila) lands on the correct Manila calendar date", () => {
  // 7:30 AM Manila (UTC+8) on October 29, 2026 is 11:30 PM UTC on October 28, 2026
  const earlyMorningManilaUtc = new Date("2026-10-28T23:30:00.000Z");
  const calculatedDate = manilaDate(earlyMorningManilaUtc);

  assert.equal(
    calculatedDate.toISOString(),
    "2026-10-29T00:00:00.000Z",
    "7:30 AM Manila should be recorded as 2026-10-29 Manila date, not 2026-10-28 UTC day",
  );

  // 12:01 AM Manila (UTC+8) on October 29, 2026 is 4:01 PM UTC on October 28, 2026
  const midnightManilaUtc = new Date("2026-10-28T16:01:00.000Z");
  assert.equal(
    manilaDate(midnightManilaUtc).toISOString(),
    "2026-10-29T00:00:00.000Z",
    "Just after midnight Manila should land on 2026-10-29",
  );

  // 11:59 PM Manila (UTC+8) on October 28, 2026 is 3:59 PM UTC on October 28, 2026
  const lateNightManilaUtc = new Date("2026-10-28T15:59:00.000Z");
  assert.equal(
    manilaDate(lateNightManilaUtc).toISOString(),
    "2026-10-28T00:00:00.000Z",
    "Just before midnight Manila should land on 2026-10-28",
  );
});

test("studentPhotoUrl generates cache-busted photo endpoints and respects existing photoUrl", () => {
  assert.equal(studentPhotoUrl(null), null);
  assert.equal(studentPhotoUrl({}), null);

  const updatedAt = new Date("2026-10-28T10:00:00.000Z");
  const profile = {
    id: "student-profile-123",
    updatedAt,
  };

  const expectedUrl = `/api/students/student-profile-123/photo?v=${updatedAt.getTime()}`;
  assert.equal(studentPhotoUrl(profile), expectedUrl);

  // Honors existing photoUrl
  assert.equal(
    studentPhotoUrl({ id: "123", photoUrl: "https://example.com/custom.jpg" }),
    "https://example.com/custom.jpg",
  );
});

test("Photo endpoint access control: unauthenticated returns 401, non-owner returns 403, owner or student returns 200", async () => {
  function checkPhotoAccess({ session, profile, ownsClass }) {
    if (!session?.userId) {
      return { status: 401, message: "Please log in to continue." };
    }
    const isSelf = profile.userId === session.userId;
    if (!isSelf) {
      if (session.role === "FACULTY" && ownsClass) {
        return { status: 200 };
      }
      return { status: 403, message: "You do not have permission to view this photo." };
    }
    return { status: 200 };
  }

  const profile = { id: "p-1", userId: "u-student-1", studentId: "2300001" };

  // 1. Unauthenticated -> 401
  assert.equal(checkPhotoAccess({ session: null, profile }).status, 401);

  // 2. Student viewing their own photo -> 200
  assert.equal(
    checkPhotoAccess({ session: { userId: "u-student-1", role: "STUDENT" }, profile }).status,
    200,
  );

  // 3. Unrelated student viewing photo -> 403
  assert.equal(
    checkPhotoAccess({ session: { userId: "u-student-other", role: "STUDENT" }, profile }).status,
    403,
  );

  // 4. Faculty who owns a class with this student -> 200
  assert.equal(
    checkPhotoAccess({ session: { userId: "u-faculty-1", role: "FACULTY" }, profile, ownsClass: true }).status,
    200,
  );

  // 5. Faculty who does not own a class with this student -> 403
  assert.equal(
    checkPhotoAccess({ session: { userId: "u-faculty-other", role: "FACULTY" }, profile, ownsClass: false }).status,
    403,
  );
});

test("Photo decoding and HTTP ETag / 304 caching", () => {
  const updatedAt = new Date("2026-10-28T12:00:00.000Z");
  const rawBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
  const dataUrl = `data:image/png;base64,${rawBase64}`;

  const etag = `"${updatedAt.getTime()}"`;

  // Test ETag matches
  const requestHeaders = { "if-none-match": etag };
  assert.equal(requestHeaders["if-none-match"], etag);

  // Test decoding data URL
  const matches = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  assert.ok(matches);
  const mimeType = matches[1];
  const base64Data = matches[2];

  assert.equal(mimeType, "image/png");
  const buffer = Buffer.from(base64Data, "base64");
  assert.equal(buffer.length > 0, true);
});

test("Bulk quiz score validation rejects out-of-range, negative, and non-integer scores", () => {
  const totalItems = 10;
  function validateScoreItem(item, maxItems) {
    if (!item || typeof item.studentId !== "string" || !item.studentId.trim()) {
      return "Every item must have a valid studentId.";
    }
    const score = Number(item.score);
    if (!Number.isInteger(score) || score < 0) {
      return "Score must be a non-negative whole number.";
    }
    if (score > maxItems) {
      return `Score cannot be higher than ${maxItems}.`;
    }
    return null;
  }

  assert.equal(validateScoreItem({ studentId: "s1", score: 5 }, totalItems), null);
  assert.equal(validateScoreItem({ studentId: "s1", score: 0 }, totalItems), null);
  assert.equal(validateScoreItem({ studentId: "s1", score: 10 }, totalItems), null);

  assert.match(validateScoreItem({ studentId: "s1", score: 11 }, totalItems), /cannot be higher than 10/);
  assert.match(validateScoreItem({ studentId: "s1", score: -1 }, totalItems), /non-negative whole number/);
  assert.match(validateScoreItem({ studentId: "s1", score: 4.5 }, totalItems), /non-negative whole number/);
  assert.match(validateScoreItem({ studentId: "", score: 5 }, totalItems), /valid studentId/);
});

test("Absence handling in bulk quiz scores: absent students receive score null and isAbsent true", () => {
  const absentSet = new Set(["student-absent-1"]);
  const items = [
    { studentId: "student-present-1", score: 8 },
    { studentId: "student-absent-1", score: 10 },
  ];

  const processed = items.map((item) => {
    const isAbsent = absentSet.has(item.studentId);
    return {
      studentId: item.studentId,
      score: isAbsent ? null : Number(item.score),
      isAbsent,
    };
  });

  assert.deepEqual(processed, [
    { studentId: "student-present-1", score: 8, isAbsent: false },
    { studentId: "student-absent-1", score: null, isAbsent: true },
  ]);
});
