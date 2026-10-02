const test = require("node:test");
const assert = require("node:assert/strict");
const { applyGracePeriod } = require("../attendance");

test("Present is converted to Late only after the grace-period deadline", () => {
  const startedAt = new Date("2026-09-29T09:00:00.000Z");
  const deadline = startedAt.getTime() + 15 * 60 * 1000;

  assert.deepEqual(
    applyGracePeriod("PRESENT", startedAt, 15, deadline),
    { appliedStatus: "PRESENT", lateOverride: false },
  );
  assert.deepEqual(
    applyGracePeriod("PRESENT", startedAt, 15, deadline + 1),
    { appliedStatus: "LATE", lateOverride: true },
  );
});

test("Late and Absent remain editable after the grace period", () => {
  const startedAt = new Date("2026-09-29T09:00:00.000Z");
  const afterDeadline = startedAt.getTime() + 16 * 60 * 1000;

  assert.deepEqual(
    applyGracePeriod("LATE", startedAt, 15, afterDeadline),
    { appliedStatus: "LATE", lateOverride: false },
  );
  assert.deepEqual(
    applyGracePeriod("ABSENT", startedAt, 15, afterDeadline),
    { appliedStatus: "ABSENT", lateOverride: false },
  );
});
