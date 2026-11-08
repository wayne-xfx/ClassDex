import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  APP_TIME_ZONE,
  compareClasses,
  getScheduleStatus,
  parseFlexibleTimeToMinutes,
  parseScheduleWindows,
  partitionAndOrderClasses,
} from "./classOrdering.js";

// 2026-08-03T00:00:00.000Z is:
// - Sunday, Aug 2, 2026, 17:00 PDT in America/Los_Angeles
// - Monday, Aug 3, 2026, 08:00 PHT in Asia/Manila
const MONDAY_0800_MANILA = new Date("2026-08-03T00:00:00.000Z");
const MONDAY_0730_MANILA = new Date("2026-08-02T23:30:00.000Z");
const MONDAY_0900_MANILA = new Date("2026-08-03T01:00:00.000Z");
const WEDNESDAY_0830_MANILA = new Date("2026-08-05T00:30:00.000Z");
const THURSDAY_0815_MANILA = new Date("2026-08-06T00:15:00.000Z");

test("APP_TIME_ZONE is Asia/Manila", () => {
  assert.equal(APP_TIME_ZONE, "Asia/Manila");
});

test("parseFlexibleTimeToMinutes accepts any minute 00-59 in 12h and 24h formats", () => {
  assert.equal(parseFlexibleTimeToMinutes("07:30"), 450);
  assert.equal(parseFlexibleTimeToMinutes("7:15 AM"), 435);
  assert.equal(parseFlexibleTimeToMinutes("8am"), 480);
  assert.equal(parseFlexibleTimeToMinutes("12:00 PM"), 720);
  assert.equal(parseFlexibleTimeToMinutes("12:05 am"), 5);
  assert.equal(parseFlexibleTimeToMinutes("14:45"), 885);
  assert.equal(parseFlexibleTimeToMinutes("9:59 pm"), 21 * 60 + 59);
  assert.equal(parseFlexibleTimeToMinutes("25:00"), null);
  assert.equal(parseFlexibleTimeToMinutes("8:60 AM"), null);
  assert.equal(parseFlexibleTimeToMinutes(""), null);
});

test("parseScheduleWindows prioritizes valid structured fields and falls back to free-text schedule", () => {
  const structured = {
    scheduleDays: ["Mon", "Wed"],
    scheduleStartTime: "07:15",
    scheduleEndTime: "08:45",
    schedule: "Fri 1:00 PM - 2:00 PM",
  };
  assert.deepEqual(parseScheduleWindows(structured), [
    { days: ["Mon", "Wed"], startMinutes: 435, endMinutes: 525 },
  ]);

  const fullDayNameStructured = {
    scheduleDays: ["Monday", "Wednesday"],
    scheduleStartTime: "7:30 AM",
    scheduleEndTime: "9:00 AM",
  };
  assert.deepEqual(parseScheduleWindows(fullDayNameStructured), [
    { days: ["Mon", "Wed"], startMinutes: 450, endMinutes: 540 },
  ]);

  const invalidStructuredFallsBack = {
    scheduleDays: ["Mon"],
    scheduleStartTime: "10:00",
    scheduleEndTime: "09:00",
    schedule: "Mon, Wed · 8:00 AM – 9:30 AM",
  };
  assert.deepEqual(parseScheduleWindows(invalidStructuredFallsBack), [
    { days: ["Mon", "Wed"], startMinutes: 480, endMinutes: 570 },
  ]);
});

test("parseScheduleWindows parses legacy multi-range, compact MTH/TTH, and slash-separated day schedules", () => {
  assert.deepEqual(
    parseScheduleWindows({
      schedule: "MTH 7:30 - 9:00 am / W 8:00 - 10:00 am (CON105A)",
    }),
    [
      { days: ["Mon", "Thu"], startMinutes: 450, endMinutes: 540 },
      { days: ["Wed"], startMinutes: 480, endMinutes: 600 },
    ],
  );

  assert.deepEqual(
    parseScheduleWindows({
      schedule: "T/FRI - 7:30 - 10:00 AM",
    }),
    [{ days: ["Tue", "Fri"], startMinutes: 450, endMinutes: 600 }],
  );

  assert.deepEqual(
    parseScheduleWindows({
      schedule: "Mon, Wed · 8:00 AM – 9:30 AM",
    }),
    [{ days: ["Mon", "Wed"], startMinutes: 480, endMinutes: 570 }],
  );

  assert.deepEqual(
    parseScheduleWindows({
      schedule: "M/TH 1:00 - 3:30 pm",
    }),
    [{ days: ["Mon", "Thu"], startMinutes: 780, endMinutes: 930 }],
  );

  assert.deepEqual(
    parseScheduleWindows({
      schedule: "TTH 10:15 - 11:45 am",
    }),
    [{ days: ["Tue", "Thu"], startMinutes: 615, endMinutes: 705 }],
  );

  assert.deepEqual(
    parseScheduleWindows({
      schedule: "M/W/F 8:00 - 9:00 AM",
    }),
    [{ days: ["Mon", "Wed", "Fri"], startMinutes: 480, endMinutes: 540 }],
  );
});

test("getScheduleStatus enforces start <= now < end boundaries and rejects invalid/missing schedules", () => {
  const earlyClass = {
    id: "c1",
    sectionName: "CS 101",
    scheduleDays: ["Mon"],
    scheduleStartTime: "07:30",
    scheduleEndTime: "09:00",
  };
  const nextClass = {
    id: "c2",
    sectionName: "CS 102",
    scheduleDays: ["Mon"],
    scheduleStartTime: "09:00",
    scheduleEndTime: "10:30",
  };

  // Exactly at start (07:30) -> live
  const atStart = getScheduleStatus(earlyClass, MONDAY_0730_MANILA);
  assert.deepEqual(atStart, {
    isLive: true,
    endsAt: "9:00 AM",
    endMinutes: 540,
    minutesLeft: 90,
  });

  // Mid-session (08:00) -> live with 60m left
  const midSession = getScheduleStatus(earlyClass, MONDAY_0800_MANILA);
  assert.deepEqual(midSession, {
    isLive: true,
    endsAt: "9:00 AM",
    endMinutes: 540,
    minutesLeft: 60,
  });

  // Boundary minute (09:00): back-to-back classes are never both live
  const earlyAtBoundary = getScheduleStatus(earlyClass, MONDAY_0900_MANILA);
  const nextAtBoundary = getScheduleStatus(nextClass, MONDAY_0900_MANILA);
  assert.equal(earlyAtBoundary.isLive, false);
  assert.equal(nextAtBoundary.isLive, true);
  assert.equal(nextAtBoundary.endsAt, "10:30 AM");
  assert.equal(nextAtBoundary.minutesLeft, 90);

  // Wrong weekday (Wednesday 08:30 Manila for a Monday-only class)
  assert.equal(getScheduleStatus(earlyClass, WEDNESDAY_0830_MANILA).isLive, false);

  // Multi-group class is live on both MTH 7:30-9:00 and W 8:00-10:00
  const multiGroup = {
    id: "c3",
    schedule: "MTH 7:30 - 9:00 am / W 8:00 - 10:00 am (CON105A)",
  };
  assert.equal(getScheduleStatus(multiGroup, THURSDAY_0815_MANILA).isLive, true);
  assert.equal(getScheduleStatus(multiGroup, THURSDAY_0815_MANILA).minutesLeft, 45);
  assert.equal(getScheduleStatus(multiGroup, WEDNESDAY_0830_MANILA).isLive, true);
  assert.equal(getScheduleStatus(multiGroup, WEDNESDAY_0830_MANILA).endsAt, "10:00 AM");
  assert.equal(getScheduleStatus(multiGroup, WEDNESDAY_0830_MANILA).minutesLeft, 90);

  // Invalid / missing / end <= start never throw and are never live
  assert.equal(
    getScheduleStatus(
      { scheduleDays: ["Mon"], scheduleStartTime: "09:00", scheduleEndTime: "09:00" },
      MONDAY_0900_MANILA,
    ).isLive,
    false,
  );
  assert.equal(
    getScheduleStatus(
      { scheduleDays: ["Mon"], scheduleStartTime: "10:00", scheduleEndTime: "08:00" },
      MONDAY_0800_MANILA,
    ).isLive,
    false,
  );
  assert.equal(getScheduleStatus({ schedule: "TBA / Room 302" }, MONDAY_0800_MANILA).isLive, false);
  assert.equal(getScheduleStatus({}, MONDAY_0800_MANILA).isLive, false);
  assert.equal(getScheduleStatus(null, MONDAY_0800_MANILA).isLive, false);
});

test("time-zone invariance: evaluates Asia/Manila even when process TZ=America/Los_Angeles on a different calendar day", () => {
  const mondayMorningClass = {
    id: "tz-class",
    sectionName: "Manila Monday Class",
    scheduleDays: ["Mon"],
    scheduleStartTime: "07:30",
    scheduleEndTime: "09:00",
  };
  const sundayAfternoonClass = {
    id: "la-sunday-class",
    sectionName: "Sunday Afternoon Class",
    scheduleDays: ["Sun"],
    scheduleStartTime: "16:30",
    scheduleEndTime: "18:00",
  };

  assert.equal(getScheduleStatus(mondayMorningClass, MONDAY_0800_MANILA).isLive, true);
  assert.equal(getScheduleStatus(sundayAfternoonClass, MONDAY_0800_MANILA).isLive, false);

  if (process.env.CLASS_ORDERING_SUBPROCESS !== "1") {
    const result = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `
          import assert from "node:assert/strict";
          import { getScheduleStatus } from ${JSON.stringify(new URL("./classOrdering.js", import.meta.url).href)};
          const instant = new Date("2026-08-03T00:00:00.000Z"); // Sunday 17:00 PDT in LA, Monday 08:00 PHT in Manila
          const monClass = { scheduleDays: ["Mon"], scheduleStartTime: "07:30", scheduleEndTime: "09:00" };
          const sunClass = { scheduleDays: ["Sun"], scheduleStartTime: "16:30", scheduleEndTime: "18:00" };
          assert.equal(getScheduleStatus(monClass, instant).isLive, true);
          assert.equal(getScheduleStatus(sunClass, instant).isLive, false);
        `,
      ],
      {
        env: {
          ...process.env,
          TZ: "America/Los_Angeles",
          CLASS_ORDERING_SUBPROCESS: "1",
        },
        encoding: "utf8",
      },
    );
    assert.equal(result.status, 0, result.stderr || result.stdout);
  }
});

test("faculty ordering contract and tie-breakers: live pinned first, then lastSessionAt, createdAt, sectionName, id; archived never live", () => {
  const classes = [
    {
      id: "b-id",
      sectionName: "Beta Section",
      schedule: "Tue 8:00 AM - 9:00 AM",
      lastSessionAt: null,
      createdAt: "2026-09-01T00:00:00.000Z",
      archivedAt: null,
    },
    {
      id: "a-id",
      sectionName: "alpha section",
      schedule: "Tue 8:00 AM - 9:00 AM",
      lastSessionAt: null,
      createdAt: "2026-09-01T00:00:00.000Z",
      archivedAt: null,
    },
    {
      id: "newer-created",
      sectionName: "Zeta Section",
      schedule: "Tue 8:00 AM - 9:00 AM",
      lastSessionAt: null,
      createdAt: "2026-10-01T00:00:00.000Z",
      archivedAt: null,
    },
    {
      id: "older-session",
      sectionName: "Session Older",
      schedule: "Tue 8:00 AM - 9:00 AM",
      lastSessionAt: "2026-10-10T00:00:00.000Z",
      createdAt: "2026-08-01T00:00:00.000Z",
      archivedAt: null,
    },
    {
      id: "newer-session",
      sectionName: "Session Newer",
      schedule: "Tue 8:00 AM - 9:00 AM",
      lastSessionAt: "2026-10-20T00:00:00.000Z",
      createdAt: "2026-07-01T00:00:00.000Z",
      archivedAt: null,
    },
    {
      id: "live-no-session",
      sectionName: "Live Without Session",
      schedule: "Mon 7:30 AM - 9:00 AM",
      lastSessionAt: null,
      createdAt: "2026-07-01T00:00:00.000Z",
      archivedAt: null,
    },
    {
      id: "live-with-session",
      sectionName: "Live With Session",
      schedule: "Mon 8:00 AM - 9:30 AM",
      lastSessionAt: "2026-10-15T00:00:00.000Z",
      createdAt: "2026-06-01T00:00:00.000Z",
      archivedAt: null,
    },
  ];

  const { live, rest } = partitionAndOrderClasses(classes, {
    role: "FACULTY",
    now: MONDAY_0800_MANILA,
  });

  assert.deepEqual(
    live.map((c) => c.id),
    ["live-with-session", "live-no-session"],
  );
  assert.deepEqual(
    rest.map((c) => c.id),
    ["newer-session", "older-session", "newer-created", "a-id", "b-id"],
  );

  // Final id tie-breaker when sectionName is identical (case-insensitive)
  const sameSection = [
    { id: "id-2", sectionName: "CS 101", createdAt: "2026-09-01T00:00:00.000Z" },
    { id: "id-1", sectionName: "cs 101", createdAt: "2026-09-01T00:00:00.000Z" },
  ];
  sameSection.sort((a, b) => compareClasses(a, b, { role: "FACULTY", now: MONDAY_0800_MANILA }));
  assert.deepEqual(
    sameSection.map((c) => c.id),
    ["id-1", "id-2"],
  );

  // Archived faculty classes are never pinned as live even if their schedule matches now
  const archivedClasses = [
    {
      id: "arch-older-session",
      sectionName: "Archived Older",
      schedule: "Mon 7:30 AM - 9:00 AM",
      archivedAt: "2026-10-25T00:00:00.000Z",
      lastSessionAt: "2026-10-01T00:00:00.000Z",
      createdAt: "2026-09-01T00:00:00.000Z",
    },
    {
      id: "arch-newer-session",
      sectionName: "Archived Newer",
      schedule: "Mon 7:30 AM - 9:00 AM",
      archivedAt: "2026-10-25T00:00:00.000Z",
      lastSessionAt: "2026-10-12T00:00:00.000Z",
      createdAt: "2026-08-01T00:00:00.000Z",
    },
  ];
  const archivedPartition = partitionAndOrderClasses(archivedClasses, {
    role: "FACULTY",
    now: MONDAY_0800_MANILA,
  });
  assert.deepEqual(archivedPartition.live, []);
  assert.deepEqual(
    archivedPartition.rest.map((c) => c.id),
    ["arch-newer-session", "arch-older-session"],
  );
});

test("student ordering contract: Live Enrolled -> Other Enrolled -> Pending -> Dropped/Declined -> Archived", () => {
  const studentClasses = [
    {
      id: "archived-approved-on-schedule",
      sectionName: "Archived Approved",
      enrollmentStatus: "APPROVED",
      archivedAt: "2026-10-30T00:00:00.000Z",
      schedule: "Mon 7:30 AM - 9:00 AM",
      lastSessionAt: "2026-10-29T00:00:00.000Z",
      createdAt: "2026-09-01T00:00:00.000Z",
    },
    {
      id: "dropped-on-schedule",
      sectionName: "Dropped Class",
      enrollmentStatus: "DROPPED",
      archivedAt: null,
      schedule: "Mon 7:30 AM - 9:00 AM",
      lastSessionAt: "2026-10-28T00:00:00.000Z",
      createdAt: "2026-09-01T00:00:00.000Z",
    },
    {
      id: "pending-on-schedule",
      sectionName: "Pending Class",
      enrollmentStatus: "PENDING",
      archivedAt: null,
      schedule: "Mon 7:30 AM - 9:00 AM",
      lastSessionAt: "2026-10-27T00:00:00.000Z",
      createdAt: "2026-09-01T00:00:00.000Z",
    },
    {
      id: "enrolled-other-older",
      sectionName: "Enrolled Older",
      enrollmentStatus: "APPROVED",
      archivedAt: null,
      schedule: "Wed 8:00 AM - 10:00 AM",
      lastSessionAt: "2026-10-10T00:00:00.000Z",
      createdAt: "2026-09-01T00:00:00.000Z",
    },
    {
      id: "enrolled-other-newer",
      sectionName: "Enrolled Newer",
      enrollmentStatus: "APPROVED",
      archivedAt: null,
      schedule: "Wed 1:00 PM - 3:00 PM",
      lastSessionAt: "2026-10-20T00:00:00.000Z",
      createdAt: "2026-08-01T00:00:00.000Z",
    },
    {
      id: "enrolled-live",
      sectionName: "Enrolled Live",
      enrollmentStatus: "APPROVED",
      archivedAt: null,
      schedule: "MTH 7:30 - 9:00 am / W 8:00 - 10:00 am (CON105A)",
      lastSessionAt: null,
      createdAt: "2026-08-01T00:00:00.000Z",
    },
  ];

  const { live, rest } = partitionAndOrderClasses(studentClasses, {
    role: "STUDENT",
    now: MONDAY_0800_MANILA,
  });

  assert.deepEqual(
    live.map((c) => c.id),
    ["enrolled-live"],
  );
  assert.deepEqual(
    rest.map((c) => c.id),
    [
      "enrolled-other-newer",
      "enrolled-other-older",
      "pending-on-schedule",
      "dropped-on-schedule",
      "archived-approved-on-schedule",
    ],
  );
});
