export const COURSE_CODE_REGEX = /^[A-Z0-9][A-Z0-9 ./&-]{1,29}$/;

export const COURSE_CODE_ERROR_MESSAGE =
  "Enter a valid course code (2–30 characters, e.g. IT 121/121L).";
export const COURSE_TITLE_ERROR_MESSAGE =
  "Enter the course title (2–120 characters, e.g. Information Management I).";

export function normalizeCourseCode(raw) {
  return String(raw ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();
}

export function normalizeCourseTitle(raw) {
  return String(raw ?? "")
    .trim()
    .replace(/\s+/g, " ");
}

export function validateCourseFields({ courseCode, courseTitle } = {}, { partial = false } = {}) {
  const shouldCheckCode = !partial || courseCode !== undefined;
  const shouldCheckTitle = !partial || courseTitle !== undefined;

  if (shouldCheckCode) {
    const normalizedCode = normalizeCourseCode(courseCode);
    if (
      normalizedCode.length < 2 ||
      normalizedCode.length > 30 ||
      !COURSE_CODE_REGEX.test(normalizedCode)
    ) {
      return {
        field: "courseCode",
        message: COURSE_CODE_ERROR_MESSAGE,
      };
    }
  }

  if (shouldCheckTitle) {
    const normalizedTitle = normalizeCourseTitle(courseTitle);
    if (normalizedTitle.length < 2 || normalizedTitle.length > 120) {
      return {
        field: "courseTitle",
        message: COURSE_TITLE_ERROR_MESSAGE,
      };
    }
  }

  return null;
}

export function formatClassLabel(cls) {
  const courseCode = normalizeCourseCode(cls?.courseCode);
  const courseTitle = normalizeCourseTitle(cls?.courseTitle);
  const sectionName = String(cls?.sectionName ?? "")
    .trim()
    .replace(/\s+/g, " ");

  if (courseCode && courseTitle) {
    return sectionName
      ? `${courseCode} · ${courseTitle} (${sectionName})`
      : `${courseCode} · ${courseTitle}`;
  }

  return sectionName;
}

export function getClassDisplay(cls) {
  const courseCode = normalizeCourseCode(cls?.courseCode);
  const courseTitle = normalizeCourseTitle(cls?.courseTitle);
  const sectionName = String(cls?.sectionName ?? "")
    .trim()
    .replace(/\s+/g, " ");

  if (courseCode && courseTitle) {
    return {
      hasCourse: true,
      courseCode,
      courseTitle,
      eyebrow: courseCode,
      title: courseTitle,
      sectionLine: sectionName ? `Section: ${sectionName}` : "",
      label: formatClassLabel(cls),
    };
  }

  return {
    hasCourse: false,
    courseCode: "",
    courseTitle: "",
    eyebrow: "",
    title: sectionName,
    sectionLine: "",
    label: sectionName,
  };
}
