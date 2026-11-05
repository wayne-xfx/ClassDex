export const DAYS_OF_WEEK = [
  { id: "Mon", label: "Mon", fullLabel: "Monday" },
  { id: "Tue", label: "Tue", fullLabel: "Tuesday" },
  { id: "Wed", label: "Wed", fullLabel: "Wednesday" },
  { id: "Thu", label: "Thu", fullLabel: "Thursday" },
  { id: "Fri", label: "Fri", fullLabel: "Friday" },
  { id: "Sat", label: "Sat", fullLabel: "Saturday" },
  { id: "Sun", label: "Sun", fullLabel: "Sunday" },
];

const DAY_ORDER = DAYS_OF_WEEK.map((day) => day.id);

export function formatMinutesTo24h(minutes) {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
}

export function formatMinutesTo12h(minutes) {
  const hours24 = Math.floor(minutes / 60);
  const mins = minutes % 60;
  const period = hours24 >= 12 ? "PM" : "AM";
  const hours12 = hours24 % 12 || 12;
  return `${hours12}:${String(mins).padStart(2, "0")} ${period}`;
}

export function parseTimeToMinutes(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  const match24 = /^([01]?\d|2[0-3]):(00|30)$/.exec(text);
  if (match24) {
    return Number(match24[1]) * 60 + Number(match24[2]);
  }
  const match12 = /^(1[0-2]|0?[1-9]):(00|30)\s*(AM|PM)$/i.exec(text);
  if (match12) {
    let hours = Number(match12[1]) % 12;
    if (match12[3].toUpperCase() === "PM") hours += 12;
    return hours * 60 + Number(match12[2]);
  }
  return null;
}

export const TIME_OPTIONS = Array.from({ length: 33 }, (_, index) => {
  const minutes = (6 * 60) + index * 30; // 6:00 AM to 10:00 PM in 30-min steps
  return {
    value: formatMinutesTo24h(minutes),
    label: formatMinutesTo12h(minutes),
    minutes,
  };
});

export function sortScheduleDays(days = []) {
  const selected = new Set(Array.isArray(days) ? days : []);
  return DAY_ORDER.filter((day) => selected.has(day));
}

export function formatScheduleText({ days = [], startTime = "", endTime = "", schedule = "" } = {}) {
  const sortedDays = sortScheduleDays(days);
  const startMinutes = parseTimeToMinutes(startTime);
  const endMinutes = parseTimeToMinutes(endTime);
  if (sortedDays.length && startMinutes != null && endMinutes != null && endMinutes > startMinutes) {
    return `${sortedDays.join(", ")} · ${formatMinutesTo12h(startMinutes)} – ${formatMinutesTo12h(endMinutes)}`;
  }
  return String(schedule || "").trim();
}

export function formatClassSchedule(classRecord) {
  if (!classRecord) return "Schedule not set";
  const text = formatScheduleText({
    days: classRecord.scheduleDays || classRecord.days || [],
    startTime: classRecord.scheduleStartTime || classRecord.startTime || "",
    endTime: classRecord.scheduleEndTime || classRecord.endTime || "",
    schedule: classRecord.schedule || "",
  });
  return text || "Schedule not set";
}


export function formatScheduleChip(classRecord) {
  if (!classRecord) return "Schedule not set";
  const sortedDays = sortScheduleDays(classRecord.scheduleDays || classRecord.days || []);
  const startMinutes = parseTimeToMinutes(classRecord.scheduleStartTime || classRecord.startTime || "");
  const endMinutes = parseTimeToMinutes(classRecord.scheduleEndTime || classRecord.endTime || "");
  if (sortedDays.length && startMinutes != null && endMinutes != null && endMinutes > startMinutes) {
    const startHours24 = Math.floor(startMinutes / 60);
    const endHours24 = Math.floor(endMinutes / 60);
    const startPeriod = startHours24 >= 12 ? "PM" : "AM";
    const endPeriod = endHours24 >= 12 ? "PM" : "AM";
    const startHours12 = startHours24 % 12 || 12;
    const startClock = `${startHours12}:${String(startMinutes % 60).padStart(2, "0")}`;
    const timeRange =
      startPeriod === endPeriod
        ? `${startClock} – ${formatMinutesTo12h(endMinutes)}`
        : `${formatMinutesTo12h(startMinutes)} – ${formatMinutesTo12h(endMinutes)}`;
    return `${sortedDays.join(", ")} · ${timeRange}`;
  }
  if (sortedDays.length) {
    return sortedDays.join(", ");
  }
  return String(classRecord.schedule || "").trim() || "Schedule not set";
}

export function getManilaWeekday(date = new Date()) {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    timeZone: "Asia/Manila",
  }).format(date);
}

export function doesClassMeetToday(classRecord, date = new Date()) {
  const days = classRecord?.scheduleDays || classRecord?.days || [];
  if (!Array.isArray(days) || !days.length) return false;
  const todayShort = getManilaWeekday(date).slice(0, 3).toLowerCase();
  return days.some((day) => String(day || "").trim().slice(0, 3).toLowerCase() === todayShort);
}

export function formatManilaTodayChip(date = new Date()) {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "Asia/Manila",
  }).format(date);
}
