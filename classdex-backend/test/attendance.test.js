const test = require("node:test");
const assert = require("node:assert/strict");
const { applyGracePeriod, resolveSessionStart } = require("../attendance");

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

test("First student marked on an unstarted session starts the clock and is Present; student after grace window is Late", () => {
  const pageOpenedAt = new Date("2026-09-29T08:00:00.000Z");
  const firstActionAt = new Date(pageOpenedAt.getTime() + 45 * 60 * 1000); // 45 mins after page opened
  const sessionStartedAt = resolveSessionStart(null, firstActionAt);

  // First student marked Present when session starts is Present
  assert.deepEqual(
    applyGracePeriod("PRESENT", sessionStartedAt, undefined, firstActionAt.getTime()),
    { appliedStatus: "PRESENT", lateOverride: false },
  );

  // Student marked Present within 15-min default grace period is Present
  assert.deepEqual(
    applyGracePeriod("PRESENT", sessionStartedAt, undefined, firstActionAt.getTime() + 10 * 60 * 1000),
    { appliedStatus: "PRESENT", lateOverride: false },
  );

  // Student marked Present after 15-min grace period has passed is Late
  assert.deepEqual(
    applyGracePeriod("PRESENT", sessionStartedAt, undefined, firstActionAt.getTime() + 15 * 60 * 1000 + 1),
    { appliedStatus: "LATE", lateOverride: true },
  );
});
