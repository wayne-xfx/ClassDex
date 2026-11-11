import test from "node:test";
import assert from "node:assert/strict";
import {
  parseLines,
  validateNewStudentEntry,
  validateRows,
} from "../src/components/classroom/studentListValidation.js";

test("validateRows marks unchanged existing DB rows as Saved and new/edited rows as Ready to save", () => {
  const savedById = new Map([
    ["r1", { name: "John Wayne M. Abejar", studentId: "2300039" }],
    ["r2", { name: "Jepzxyy", studentId: "2403132" }],
  ]);

  const rows = [
    { id: "r1", name: "John Wayne M. Abejar", studentId: "2300039" },
    { id: "r2", name: "Jepzxyy Updated", studentId: "2403132" },
    { name: "Raze Wayne", studentId: "2300000" },
  ];

  const checked = validateRows(rows, { savedById });

  assert.equal(checked[0].status, "saved");
  assert.equal(checked[0].statusLabel, "Saved");
  assert.equal(checked[0].errors.length, 0);

  assert.equal(checked[1].status, "unsaved-edited");
  assert.equal(checked[1].statusLabel, "Edited · Ready to save");
  assert.equal(checked[1].isModified, true);

  assert.equal(checked[2].status, "unsaved-new");
  assert.equal(checked[2].statusLabel, "New · Ready to save");
});

test("validateRows flags BOTH rows when a duplicate Student ID exists", () => {
  const rows = [
    { id: "r1", name: "Alex Santos", studentId: "2300039" },
    { id: "r2", name: "Bea Cruz", studentId: "2300040" },
    { name: "Carlos Reyes", studentId: "2300039" },
  ];

  const checked = validateRows(rows);

  assert.equal(checked[0].status, "invalid");
  assert.match(checked[0].idError, /Duplicate student ID \(also row 3\)/);

  assert.equal(checked[1].status, "saved");

  assert.equal(checked[2].status, "invalid");
  assert.match(checked[2].idError, /Duplicate student ID \(also row 1\)/);
});

test("validateRows flags Student IDs that are currently in the Drop List", () => {
  const droppedIds = new Set(["2300099"]);
  const rows = [{ name: "Dropped Student", studentId: "2300099" }];

  const checked = validateRows(rows, { droppedIds });
  assert.equal(checked[0].status, "invalid");
  assert.match(checked[0].idError, /Already in Drop List/i);
});

test("validateRows rejects numeric-only or 1-character names and non-7-digit IDs", () => {
  const rows = [
    { name: "12345", studentId: "2300" },
    { name: "A", studentId: "" },
  ];

  const checked = validateRows(rows);
  assert.equal(checked[0].nameError, "Enter a valid student name");
  assert.equal(checked[0].idError, "Student ID must be exactly 7 digits");
  assert.equal(checked[1].nameError, "Enter a valid student name");
  assert.equal(checked[1].idError, "Missing student ID");
});

test("validateNewStudentEntry validates top Add Student form before appending", () => {
  const existingRows = [{ id: "r1", name: "Alex Santos", studentId: "2300039" }];
  const droppedIds = new Set(["2300088"]);

  assert.deepEqual(
    validateNewStudentEntry({ name: "", studentId: "2300040" }, { existingRows, droppedIds }),
    { valid: false, field: "name", message: "Missing name." },
  );

  assert.deepEqual(
    validateNewStudentEntry({ name: "Juan Cruz", studentId: "123" }, { existingRows, droppedIds }),
    { valid: false, field: "studentId", message: "Student ID must be exactly 7 digits." },
  );

  const dupActive = validateNewStudentEntry(
    { name: "Juan Cruz", studentId: "2300039" },
    { existingRows, droppedIds },
  );
  assert.equal(dupActive.valid, false);
  assert.equal(dupActive.field, "studentId");
  assert.match(dupActive.message, /already in this student list/i);

  const dupDropped = validateNewStudentEntry(
    { name: "Juan Cruz", studentId: "2300088" },
    { existingRows, droppedIds },
  );
  assert.equal(dupDropped.valid, false);
  assert.equal(dupDropped.field, "studentId");
  assert.match(dupDropped.message, /Drop List/i);

  const valid = validateNewStudentEntry(
    { name: "  Juan   Dela Cruz ", studentId: "2300045" },
    { existingRows, droppedIds },
  );
  assert.equal(valid.valid, true);
  assert.deepEqual(valid.entry, {
    name: "Juan Dela Cruz",
    studentId: "2300045",
    photo: "",
  });
});

test("parseLines supports Name, ID; Last, First, ID; ID, Name; and tab-separated rows", () => {
  const input = [
    "Alex Santos, 2300039",
    "Dela Cruz, Juan Miguel, 2300040",
    "2300041, Maria Clara",
    "2300042\tJose Rizal",
    "Andres Bonifacio - 2300043",
  ].join("\n");

  const parsed = parseLines(input);
  assert.deepEqual(parsed, [
    { name: "Alex Santos", studentId: "2300039", photo: "" },
    { name: "Dela Cruz, Juan Miguel", studentId: "2300040", photo: "" },
    { name: "Maria Clara", studentId: "2300041", photo: "" },
    { name: "Jose Rizal", studentId: "2300042", photo: "" },
    { name: "Andres Bonifacio", studentId: "2300043", photo: "" },
  ]);
});
