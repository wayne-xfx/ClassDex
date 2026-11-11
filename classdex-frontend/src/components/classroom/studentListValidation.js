export const STUDENT_ID_PATTERN = /^\d{7}$/;

const HAS_LETTER_PATTERN = /\p{L}/u;

export function normalizeWhitespace(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

export function validateStudentName(rawName) {
  const name = normalizeWhitespace(rawName);
  if (!name) return "Missing name";
  if (name.length < 2 || !HAS_LETTER_PATTERN.test(name)) {
    return "Enter a valid student name";
  }
  return "";
}

export function validateStudentIdFormat(rawStudentId) {
  const studentId = String(rawStudentId || "").trim();
  if (!studentId) return "Missing student ID";
  if (!STUDENT_ID_PATTERN.test(studentId)) {
    return "Student ID must be exactly 7 digits";
  }
  return "";
}

/**
 * Validates all rows in the active student list editor.
 * - Flags both/all rows involved in a duplicate Student ID collision
 * - Flags rows whose Student ID is currently in the class Drop List
 * - Classifies each row's status: "invalid" | "unsaved-new" | "unsaved-edited" | "saved"
 */
export function validateRows(rows, { savedById = new Map(), droppedIds = new Set() } = {}) {
  const idOccurrences = new Map();

  rows.forEach((row, index) => {
    const trimmedId = String(row.studentId || "").trim();
    if (!trimmedId) return;
    const list = idOccurrences.get(trimmedId) || [];
    list.push(index + 1);
    idOccurrences.set(trimmedId, list);
  });

  return rows.map((row, index) => {
    const trimmedName = normalizeWhitespace(row.name);
    const trimmedId = String(row.studentId || "").trim();
    const errors = [];

    const nameError = validateStudentName(trimmedName);
    if (nameError) errors.push(nameError);

    let idError = validateStudentIdFormat(trimmedId);
    if (idError) {
      errors.push(idError);
    } else {
      const matchingRows = idOccurrences.get(trimmedId) || [];
      if (matchingRows.length > 1) {
        const otherRows = matchingRows.filter((r) => r !== index + 1);
        idError = `Duplicate student ID (also row ${otherRows.join(", ")})`;
        errors.push(idError);
      } else if (droppedIds.has(trimmedId)) {
        idError = "Already in Drop List (restore instead)";
        errors.push(idError);
      }
    }

    const saved = row.id ? savedById.get(row.id) : null;
    const isModified = Boolean(
      saved && (saved.name !== trimmedName || saved.studentId !== trimmedId),
    );

    let status = "saved";
    let statusLabel = "Saved";
    if (errors.length > 0) {
      status = "invalid";
      statusLabel = errors.join(" · ");
    } else if (!row.id) {
      status = "unsaved-new";
      statusLabel = "New · Ready to save";
    } else if (isModified) {
      status = "unsaved-edited";
      statusLabel = "Edited · Ready to save";
    }

    return {
      ...row,
      errors,
      nameError,
      idError,
      isModified,
      status,
      statusLabel,
    };
  });
}

/**
 * Validates the top "+ Add student" form before appending a row.
 */
export function validateNewStudentEntry(
  { name, studentId },
  { existingRows = [], droppedIds = new Set() } = {},
) {
  const trimmedName = normalizeWhitespace(name);
  const trimmedId = String(studentId || "").trim();

  const nameError = validateStudentName(trimmedName);
  if (nameError) {
    return { valid: false, field: "name", message: `${nameError}.` };
  }

  const idError = validateStudentIdFormat(trimmedId);
  if (idError) {
    return { valid: false, field: "studentId", message: `${idError}.` };
  }

  const duplicateInActive = existingRows.some(
    (r) => String(r.studentId || "").trim() === trimmedId,
  );
  if (duplicateInActive) {
    return {
      valid: false,
      field: "studentId",
      message: `Student ID ${trimmedId} is already in this student list.`,
    };
  }

  if (droppedIds.has(trimmedId)) {
    return {
      valid: false,
      field: "studentId",
      message: `Student ID ${trimmedId} is in the Drop List. Restore them from the Drop List tab instead.`,
    };
  }

  return {
    valid: true,
    field: null,
    message: "",
    entry: { name: trimmedName, studentId: trimmedId, photo: "" },
  };
}

/**
 * Parses pasted lines flexibly:
 * - "Juan Dela Cruz, 2300039"
 * - "Dela Cruz, Juan, 2300039" (preserves comma inside "Last, First")
 * - "2300039, Juan Dela Cruz" or "2300039\tJuan Dela Cruz"
 * - "Juan Dela Cruz - 2300039"
 */
export function parseLines(value) {
  return String(value || "")
    .split(/\r?\n/)
    .map((rawLine) => {
      const line = rawLine.trim();
      if (!line) return null;

      // Tab-separated
      if (line.includes("\t")) {
        const parts = line.split("\t").map((p) => p.trim()).filter(Boolean);
        if (parts.length >= 2) {
          if (STUDENT_ID_PATTERN.test(parts[0]) && !STUDENT_ID_PATTERN.test(parts[parts.length - 1])) {
            return {
              studentId: parts[0],
              name: normalizeWhitespace(parts.slice(1).join(" ")),
              photo: "",
            };
          }
          return {
            name: normalizeWhitespace(parts.slice(0, -1).join(" ")),
            studentId: parts[parts.length - 1],
            photo: "",
          };
        }
      }

      // Comma-separated (handles "Last, First, 2300039" as well as "Name, 2300039" or "2300039, Name")
      if (line.includes(",")) {
        const parts = line.split(",").map((p) => p.trim());
        const first = parts[0] || "";
        const last = parts[parts.length - 1] || "";
        if (parts.length >= 2 && STUDENT_ID_PATTERN.test(first) && !STUDENT_ID_PATTERN.test(last)) {
          return {
            studentId: first,
            name: normalizeWhitespace(parts.slice(1).join(", ")),
            photo: "",
          };
        }
        return {
          name: normalizeWhitespace(parts.slice(0, -1).join(", ")),
          studentId: last,
          photo: "",
        };
      }

      // Hyphen / whitespace separated
      const hyphenParts = line.split(/\s+-\s+/);
      if (hyphenParts.length >= 2) {
        const first = hyphenParts[0].trim();
        const last = hyphenParts[hyphenParts.length - 1].trim();
        if (STUDENT_ID_PATTERN.test(first) && !STUDENT_ID_PATTERN.test(last)) {
          return {
            studentId: first,
            name: normalizeWhitespace(hyphenParts.slice(1).join(" - ")),
            photo: "",
          };
        }
        return {
          name: normalizeWhitespace(hyphenParts.slice(0, -1).join(" - ")),
          studentId: last,
          photo: "",
        };
      }

      return { name: normalizeWhitespace(line), studentId: "", photo: "" };
    })
    .filter((row) => row && (row.name || row.studentId));
}
