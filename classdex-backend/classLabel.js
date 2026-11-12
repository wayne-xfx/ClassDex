const COURSE_CODE_REGEX = /^[A-Z0-9][A-Z0-9 ./&-]{1,29}$/;

const COURSE_CODE_ERROR = {
  field: "courseCode",
  message: "Enter a valid course code (2–30 characters, e.g. IT 121/121L).",
};

const COURSE_TITLE_ERROR = {
  field: "courseTitle",
  message: "Enter the course title (2–120 characters, e.g. Information Management I).",
};

function normalizeCourseCode(raw) {
  return String(raw ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();
}

function normalizeCourseTitle(raw) {
  return String(raw ?? "")
    .trim()
    .replace(/\s+/g, " ");
}

function validateCourseFields({ courseCode, courseTitle } = {}, { partial = false } = {}) {
  const shouldCheckCode = !partial || courseCode !== undefined;
  const shouldCheckTitle = !partial || courseTitle !== undefined;

  if (shouldCheckCode) {
    if (typeof courseCode !== "string") {
      return { ...COURSE_CODE_ERROR };
    }
    const normalizedCode = normalizeCourseCode(courseCode);
    if (
      normalizedCode.length < 2 ||
      normalizedCode.length > 30 ||
      !COURSE_CODE_REGEX.test(normalizedCode)
    ) {
      return { ...COURSE_CODE_ERROR };
    }
  }

  if (shouldCheckTitle) {
    if (typeof courseTitle !== "string") {
      return { ...COURSE_TITLE_ERROR };
    }
    const normalizedTitle = normalizeCourseTitle(courseTitle);
    if (normalizedTitle.length < 2 || normalizedTitle.length > 120) {
      return { ...COURSE_TITLE_ERROR };
    }
  }

  return null;
}

function formatClassLabel(cls) {
  const courseCode = normalizeCourseCode(cls?.courseCode);
  const courseTitle = normalizeCourseTitle(cls?.courseTitle);
  const sectionName = String(cls?.sectionName ?? "").trim();

  if (courseCode && courseTitle) {
    return sectionName
      ? `${courseCode} · ${courseTitle} (${sectionName})`
      : `${courseCode} · ${courseTitle}`;
  }

  return sectionName;
}

module.exports = {
  COURSE_CODE_REGEX,
  COURSE_CODE_ERROR,
  COURSE_TITLE_ERROR,
  normalizeCourseCode,
  normalizeCourseTitle,
  validateCourseFields,
  formatClassLabel,
};
