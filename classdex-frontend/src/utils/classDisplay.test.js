import assert from "node:assert/strict";
import test from "node:test";

import {
  formatClassLabel,
  getClassDisplay,
  normalizeCourseCode,
  normalizeCourseTitle,
  validateCourseFields,
} from "./classDisplay.js";

test("getClassDisplay and formatClassLabel format classes with full course data", () => {
  const cls = {
    courseCode: "IT 121/121L",
    courseTitle: "Information Management I",
    sectionName: "BSIT - AI23",
  };
  assert.equal(
    formatClassLabel(cls),
    "IT 121/121L · Information Management I (BSIT - AI23)",
  );
  assert.deepEqual(getClassDisplay(cls), {
    hasCourse: true,
    courseCode: "IT 121/121L",
    courseTitle: "Information Management I",
    eyebrow: "IT 121/121L",
    title: "Information Management I",
    sectionLine: "Section: BSIT - AI23",
    label: "IT 121/121L · Information Management I (BSIT - AI23)",
  });
});

test("getClassDisplay and formatClassLabel fall back cleanly for legacy classes without course fields", () => {
  const legacy = {
    courseCode: null,
    courseTitle: null,
    sectionName: "AI33 - IT-121/121L IM",
  };
  assert.equal(formatClassLabel(legacy), "AI33 - IT-121/121L IM");
  assert.deepEqual(getClassDisplay(legacy), {
    hasCourse: false,
    courseCode: "",
    courseTitle: "",
    eyebrow: "",
    title: "AI33 - IT-121/121L IM",
    sectionLine: "",
    label: "AI33 - IT-121/121L IM",
  });
});

test("getClassDisplay falls back to legacy display when only one course field is populated", () => {
  const onlyCode = {
    courseCode: "IT 121",
    courseTitle: "   ",
    sectionName: "BSIT - AI23",
  };
  assert.equal(getClassDisplay(onlyCode).hasCourse, false);
  assert.equal(getClassDisplay(onlyCode).title, "BSIT - AI23");
  assert.equal(getClassDisplay(onlyCode).eyebrow, "");
  assert.equal(getClassDisplay(onlyCode).sectionLine, "");
  assert.equal(formatClassLabel(onlyCode), "BSIT - AI23");

  const onlyTitle = {
    courseCode: null,
    courseTitle: "Information Management I",
    sectionName: "BSIT - AI23",
  };
  assert.equal(getClassDisplay(onlyTitle).hasCourse, false);
  assert.equal(getClassDisplay(onlyTitle).title, "BSIT - AI23");
  assert.equal(getClassDisplay(onlyTitle).eyebrow, "");
  assert.equal(getClassDisplay(onlyTitle).sectionLine, "");
  assert.equal(formatClassLabel(onlyTitle), "BSIT - AI23");
});

test("normalizes extra whitespace, case, and handles null/undefined inputs without rendering 'null' or 'undefined'", () => {
  const messy = {
    courseCode: "  it   121 / 121l  ",
    courseTitle: "  Information    Management   I ",
    sectionName: "  BSIT -   AI23 ",
  };
  assert.equal(normalizeCourseCode(messy.courseCode), "IT 121 / 121L");
  assert.equal(normalizeCourseTitle(messy.courseTitle), "Information Management I");
  assert.deepEqual(getClassDisplay(messy), {
    hasCourse: true,
    courseCode: "IT 121 / 121L",
    courseTitle: "Information Management I",
    eyebrow: "IT 121 / 121L",
    title: "Information Management I",
    sectionLine: "Section: BSIT - AI23",
    label: "IT 121 / 121L · Information Management I (BSIT - AI23)",
  });

  assert.deepEqual(getClassDisplay(null), {
    hasCourse: false,
    courseCode: "",
    courseTitle: "",
    eyebrow: "",
    title: "",
    sectionLine: "",
    label: "",
  });
  assert.deepEqual(getClassDisplay(undefined), {
    hasCourse: false,
    courseCode: "",
    courseTitle: "",
    eyebrow: "",
    title: "",
    sectionLine: "",
    label: "",
  });
});

test("validateCourseFields enforces length, allowed characters, and partial mode", () => {
  assert.equal(
    validateCourseFields({
      courseCode: "IT 121/121L",
      courseTitle: "Information Management I",
    }),
    null,
  );
  assert.equal(validateCourseFields({}, { partial: true }), null);
  assert.equal(validateCourseFields({ courseCode: "A" })?.field, "courseCode");
  assert.equal(validateCourseFields({ courseCode: "IT@121", courseTitle: "Valid Title" })?.field, "courseCode");
  assert.equal(validateCourseFields({ courseCode: "IT 121", courseTitle: "A" })?.field, "courseTitle");
});
