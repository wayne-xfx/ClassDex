export const APP_TIME_ZONE = "Asia/Manila";

const CANONICAL_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const DAY_TOKEN_PATTERNS = [
  { regex: /^(?:monday|mon)/i, day: "Mon" },
  { regex: /^(?:tuesday|tues|tue)/i, day: "Tue" },
  { regex: /^(?:wednesday|weds|wed)/i, day: "Wed" },
  { regex: /^(?:thursday|thurs|thur|thu|th)/i, day: "Thu" },
  { regex: /^(?:friday|fri)/i, day: "Fri" },
  { regex: /^(?:saturday|sat)/i, day: "Sat" },
  { regex: /^(?:sunday|sun|su)/i, day: "Sun" },
  { regex: /^m/i, day: "Mon" },
  { regex: /^t/i, day: "Tue" },
  { regex: /^w/i, day: "Wed" },
  { regex: /^f/i, day: "Fri" },
  { regex: /^s/i, day: "Sat" },
];

export function formatMinutesTo12h(minutes) {
  const hours24 = Math.floor(minutes / 60);
  const mins = minutes % 60;
  const period = hours24 >= 12 ? "PM" : "AM";
  const hours12 = hours24 % 12 || 12;
  return `${hours12}:${String(mins).padStart(2, "0")} ${period}`;
}

export function parseFlexibleTimeToMinutes(value) {
  const text = String(value ?? "").trim();
  if (!text) return null;

  const match12 = /^(1[0-2]|0?[1-9])(?::([0-5]\d))?\s*(a\.?m\.?|p\.?m\.?)$/i.exec(text);
  if (match12) {
    let hours = Number(match12[1]) % 12;
    const isPm = match12[3].toLowerCase().startsWith("p");
    if (isPm) hours += 12;
    const minutes = match12[2] !== undefined ? Number(match12[2]) : 0;
    return hours * 60 + minutes;
  }

  const match24 = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(text);
  if (match24) {
    return Number(match24[1]) * 60 + Number(match24[2]);
  }

  return null;
}

function parseSingleDayWord(word) {
  const cleaned = String(word ?? "").trim();
  if (!cleaned || !/^[a-zA-Z]+$/.test(cleaned)) return null;

  const found = [];
  let remaining = cleaned;
  while (remaining.length > 0) {
    let matched = false;
    for (const { regex, day } of DAY_TOKEN_PATTERNS) {
      const m = regex.exec(remaining);
      if (m) {
        found.push(day);
        remaining = remaining.slice(m[0].length);
        matched = true;
        break;
      }
    }
    if (!matched) {
      return null;
    }
  }
  return found.length > 0 ? found : null;
}

export function parseDaysTokens(input) {
  if (Array.isArray(input)) {
    const collected = new Set();
    for (const item of input) {
      const days = parseDaysTokens(String(item ?? ""));
      for (const d of days) collected.add(d);
    }
    return CANONICAL_DAYS.filter((day) => collected.has(day));
  }

  const normalized = String(input ?? "")
    .replace(/[·•,/&|–—-]+/g, " ")
    .replace(/\band\b/gi, " ")
    .trim();
  if (!normalized) return [];

  const words = normalized.split(/\s+/).filter(Boolean);
  if (!words.length) return [];

  const collected = new Set();
  for (const word of words) {
    const parsed = parseSingleDayWord(word);
    if (!parsed) return [];
    for (const d of parsed) collected.add(d);
  }

  return CANONICAL_DAYS.filter((day) => collected.has(day));
}

function parseRawTimeToken(raw) {
  const text = String(raw ?? "").trim();
  if (!text) return null;
  const m = /^([01]?\d|2[0-3])(?::([0-5]\d))?(?:\s*(a\.?m\.?|p\.?m\.?))?$/i.exec(text);
  if (!m) return null;
  const hour = Number(m[1]);
  const hasColon = m[2] !== undefined;
  const minute = hasColon ? Number(m[2]) : 0;
  const meridiemRaw = m[3] ? m[3].toLowerCase() : null;
  const meridiem = meridiemRaw ? (meridiemRaw.startsWith("p") ? "PM" : "AM") : null;
  return { hour, minute, hasColon, meridiem };
}

function toMinutesWithMeridiem(hour, minute, meridiem) {
  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    let h = hour % 12;
    if (meridiem === "PM") h += 12;
    return h * 60 + minute;
  }
  if (hour < 0 || hour > 23) return null;
  return hour * 60 + minute;
}

function resolveTimeRangeMinutes(startRaw, endRaw) {
  const startToken = parseRawTimeToken(startRaw);
  const endToken = parseRawTimeToken(endRaw);
  if (!startToken || !endToken) return null;

  if (!startToken.meridiem && !endToken.meridiem && (!startToken.hasColon || !endToken.hasColon)) {
    return null;
  }

  let startMinutes = null;
  let endMinutes = null;

  if (startToken.meridiem && endToken.meridiem) {
    startMinutes = toMinutesWithMeridiem(startToken.hour, startToken.minute, startToken.meridiem);
    endMinutes = toMinutesWithMeridiem(endToken.hour, endToken.minute, endToken.meridiem);
  } else if (!startToken.meridiem && endToken.meridiem) {
    endMinutes = toMinutesWithMeridiem(endToken.hour, endToken.minute, endToken.meridiem);
    if (endMinutes === null) return null;
    if (startToken.hour > 12 || startToken.hour === 0) {
      startMinutes = toMinutesWithMeridiem(startToken.hour, startToken.minute, null);
    } else {
      const sameMeridiemStart = toMinutesWithMeridiem(
        startToken.hour,
        startToken.minute,
        endToken.meridiem,
      );
      if (sameMeridiemStart !== null && sameMeridiemStart < endMinutes) {
        startMinutes = sameMeridiemStart;
      } else {
        startMinutes = toMinutesWithMeridiem(startToken.hour, startToken.minute, "AM");
      }
    }
  } else if (startToken.meridiem && !endToken.meridiem) {
    startMinutes = toMinutesWithMeridiem(startToken.hour, startToken.minute, startToken.meridiem);
    if (startMinutes === null) return null;
    if (endToken.hour > 12 || endToken.hour === 0) {
      endMinutes = toMinutesWithMeridiem(endToken.hour, endToken.minute, null);
    } else {
      const sameMeridiemEnd = toMinutesWithMeridiem(
        endToken.hour,
        endToken.minute,
        startToken.meridiem,
      );
      if (sameMeridiemEnd !== null && sameMeridiemEnd > startMinutes) {
        endMinutes = sameMeridiemEnd;
      } else {
        endMinutes = toMinutesWithMeridiem(endToken.hour, endToken.minute, "PM");
      }
    }
  } else {
    startMinutes = toMinutesWithMeridiem(startToken.hour, startToken.minute, null);
    endMinutes = toMinutesWithMeridiem(endToken.hour, endToken.minute, null);
  }

  if (startMinutes === null || endMinutes === null || endMinutes <= startMinutes) {
    return null;
  }

  return { startMinutes, endMinutes };
}

function splitScheduleGroups(scheduleText) {
  const withoutParens = String(scheduleText ?? "")
    .replace(/\([^)]*\)/g, " ")
    .trim();
  if (!withoutParens) return [];

  const semiParts = withoutParens
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean);

  const groups = [];
  for (const semiPart of semiParts) {
    const slashSegments = semiPart.split("/");
    let current = "";
    for (let i = 0; i < slashSegments.length; i += 1) {
      const seg = slashSegments[i];
      if (!current) {
        current = seg;
        continue;
      }
      const remaining = slashSegments.slice(i).join("/");
      if (/\d/.test(current) && /\d/.test(remaining)) {
        groups.push(current.trim());
        current = seg;
      } else {
        current = `${current}/${seg}`;
      }
    }
    if (current.trim()) {
      groups.push(current.trim());
    }
  }

  return groups;
}

const GROUP_TIME_RANGE_REGEX = new RegExp(
  String.raw`^(.*?)\b((?:[01]?\d|2[0-3])(?::[0-5]\d)?(?:\s*(?:a\.?m\.?|p\.?m\.?))?)\s*(?:[-–—]|to)\s*((?:[01]?\d|2[0-3])(?::[0-5]\d)?(?:\s*(?:a\.?m\.?|p\.?m\.?))?)\s*$`,
  "i",
);

function parseSingleScheduleGroup(groupText) {
  const cleaned = String(groupText ?? "")
    .replace(/\([^)]*\)/g, " ")
    .trim();
  if (!cleaned) return null;

  const match = GROUP_TIME_RANGE_REGEX.exec(cleaned);
  if (!match) return null;

  const daysPrefix = match[1].trim();
  const startRaw = match[2].trim();
  const endRaw = match[3].trim();

  const days = parseDaysTokens(daysPrefix);
  if (!days.length) return null;

  const range = resolveTimeRangeMinutes(startRaw, endRaw);
  if (!range) return null;

  return {
    days,
    startMinutes: range.startMinutes,
    endMinutes: range.endMinutes,
  };
}

export function parseScheduleWindows(classRecord) {
  if (!classRecord || typeof classRecord !== "object") return [];

  const rawDays = Array.isArray(classRecord.scheduleDays)
    ? classRecord.scheduleDays
    : Array.isArray(classRecord.days)
      ? classRecord.days
      : [];
  const rawStart = classRecord.scheduleStartTime ?? classRecord.startTime ?? "";
  const rawEnd = classRecord.scheduleEndTime ?? classRecord.endTime ?? "";

  if (rawDays.length > 0) {
    const structuredDays = parseDaysTokens(rawDays);
    const startMinutes = parseFlexibleTimeToMinutes(rawStart);
    const endMinutes = parseFlexibleTimeToMinutes(rawEnd);
    if (
      structuredDays.length > 0 &&
      startMinutes !== null &&
      endMinutes !== null &&
      endMinutes > startMinutes
    ) {
      return [{ days: structuredDays, startMinutes, endMinutes }];
    }
  }

  const scheduleText = String(classRecord.schedule ?? "").trim();
  if (!scheduleText) return [];

  const groups = splitScheduleGroups(scheduleText);
  if (!groups.length) return [];

  const windows = [];
  for (const group of groups) {
    const parsed = parseSingleScheduleGroup(group);
    if (parsed) {
      windows.push(parsed);
    }
  }

  return windows;
}

const manilaClockFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: APP_TIME_ZONE,
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function getManilaClockParts(now) {
  const dateObj = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(dateObj.getTime())) return null;

  const parts = manilaClockFormatter.formatToParts(dateObj);
  let weekday = null;
  let hour = null;
  let minute = null;

  for (const part of parts) {
    if (part.type === "weekday") weekday = part.value;
    else if (part.type === "hour") hour = Number(part.value);
    else if (part.type === "minute") minute = Number(part.value);
  }

  if (!weekday || !Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  const normalizedHour = hour === 24 ? 0 : hour;
  return {
    weekday,
    nowMinutes: normalizedHour * 60 + minute,
  };
}

function isEligibleToBeLive(classRecord, role) {
  if (!classRecord || typeof classRecord !== "object") return false;
  if (classRecord.archivedAt) return false;

  const normalizedRole = role ? String(role).toUpperCase() : null;
  if (normalizedRole === "STUDENT") {
    return String(classRecord.enrollmentStatus || "").toUpperCase() === "APPROVED";
  }

  if (classRecord.enrollmentStatus !== undefined && classRecord.enrollmentStatus !== null) {
    return String(classRecord.enrollmentStatus).toUpperCase() === "APPROVED";
  }

  return true;
}

export function getScheduleStatus(classRecord, now = new Date(), { role } = {}) {
  const inactive = {
    isLive: false,
    endsAt: null,
    endMinutes: null,
    minutesLeft: null,
  };

  if (!isEligibleToBeLive(classRecord, role)) {
    return inactive;
  }

  const clock = getManilaClockParts(now);
  if (!clock) return inactive;

  const windows = parseScheduleWindows(classRecord);
  if (!windows.length) return inactive;

  let activeWindow = null;
  for (const win of windows) {
    if (!Array.isArray(win.days) || win.endMinutes <= win.startMinutes) continue;
    if (
      win.days.includes(clock.weekday) &&
      win.startMinutes <= clock.nowMinutes &&
      clock.nowMinutes < win.endMinutes
    ) {
      if (!activeWindow || win.endMinutes > activeWindow.endMinutes) {
        activeWindow = win;
      }
    }
  }

  if (!activeWindow) return inactive;

  return {
    isLive: true,
    endsAt: formatMinutesTo12h(activeWindow.endMinutes),
    endMinutes: activeWindow.endMinutes,
    minutesLeft: activeWindow.endMinutes - clock.nowMinutes,
  };
}

function parseValidTimestamp(value) {
  if (!value) return null;
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  const ms = Date.parse(String(value));
  return Number.isFinite(ms) ? ms : null;
}

function getBucketRank(classRecord, { role, now }) {
  const normalizedRole = role
    ? String(role).toUpperCase()
    : classRecord?.enrollmentStatus != null
      ? "STUDENT"
      : "FACULTY";

  if (normalizedRole === "STUDENT") {
    if (classRecord?.archivedAt) return 5;
    const status = String(classRecord?.enrollmentStatus || "APPROVED").toUpperCase();
    if (status === "APPROVED") {
      const liveStatus = getScheduleStatus(classRecord, now, { role: "STUDENT" });
      return liveStatus.isLive ? 1 : 2;
    }
    if (status === "PENDING") return 3;
    return 4;
  }

  if (classRecord?.archivedAt) return 3;
  const liveStatus = getScheduleStatus(classRecord, now, { role: "FACULTY" });
  return liveStatus.isLive ? 1 : 2;
}

export function compareClasses(a, b, { role, now = new Date() } = {}) {
  const bucketA = getBucketRank(a, { role, now });
  const bucketB = getBucketRank(b, { role, now });
  if (bucketA !== bucketB) return bucketA - bucketB;

  const lastA = parseValidTimestamp(a?.lastSessionAt);
  const lastB = parseValidTimestamp(b?.lastSessionAt);
  if (lastA !== null && lastB === null) return -1;
  if (lastA === null && lastB !== null) return 1;
  if (lastA !== null && lastB !== null && lastA !== lastB) {
    return lastB - lastA;
  }

  const createdA = parseValidTimestamp(a?.createdAt ?? a?.joinedAt);
  const createdB = parseValidTimestamp(b?.createdAt ?? b?.joinedAt);
  if (createdA !== null && createdB === null) return -1;
  if (createdA === null && createdB !== null) return 1;
  if (createdA !== null && createdB !== null && createdA !== createdB) {
    return createdB - createdA;
  }

  const nameA = String(a?.sectionName ?? "").trim();
  const nameB = String(b?.sectionName ?? "").trim();
  const nameCmp = nameA.localeCompare(nameB, "en", { sensitivity: "base" });
  if (nameCmp !== 0) return nameCmp;

  const idA = String(a?.id ?? "");
  const idB = String(b?.id ?? "");
  if (idA < idB) return -1;
  if (idA > idB) return 1;
  return 0;
}

export function partitionAndOrderClasses(classes, { role, now = new Date() } = {}) {
  if (!Array.isArray(classes) || classes.length === 0) {
    return { live: [], rest: [] };
  }

  const ordered = [...classes].sort((a, b) => compareClasses(a, b, { role, now }));
  const live = [];
  const rest = [];

  for (const item of ordered) {
    const status = getScheduleStatus(item, now, { role });
    if (status.isLive) {
      live.push(item);
    } else {
      rest.push(item);
    }
  }

  return { live, rest };
}
