const XLSX = require("xlsx");

function sanitizeExportValue(value) {
  if (typeof value !== "string") {
    return value;
  }
  if (/^[=+\-@]/.test(value)) {
    return `'${value}`;
  }
  return value;
}

function makeSheetRows(headers, rows) {
  const sanitizedRows = rows.map((row) => headers.map((header) => sanitizeExportValue(row[header] ?? "")));
  return [headers, ...sanitizedRows];
}

function appendSheet(workbook, name, headers, rows) {
  const data = makeSheetRows(headers, rows);
  const sheet = XLSX.utils.aoa_to_sheet(data);
  const colWidths = headers.map((header, colIdx) => {
    let maxLen = String(header).length;
    for (const r of data.slice(1)) {
      const cellVal = String(r[colIdx] ?? "");
      if (cellVal.length > maxLen) maxLen = cellVal.length;
    }
    return { wch: Math.min(Math.max(maxLen + 3, 12), 40) };
  });
  sheet["!cols"] = colWidths;
  XLSX.utils.book_append_sheet(workbook, sheet, name);
}

function buildStudentListRows(enrollments) {
  return enrollments.map((enrollment) => ({
    name: enrollment.studentProfile.name,
    studentId: String(enrollment.studentProfile.studentId ?? ""),
    email: enrollment.studentProfile.email,
    program: enrollment.studentProfile.program || "",
    section: enrollment.studentProfile.section || "",
    status: enrollment.status,
    joinedAt: enrollment.joinedAt.toISOString(),
  }));
}

function buildAttendanceRows(sessions) {
  const rows = [];
  for (const session of sessions) {
    for (const record of session.attendance || []) {
      rows.push({
        date: session.date.toISOString(),
        studentName: record.studentProfile.name,
        studentId: String(record.studentProfile.studentId ?? ""),
        status: record.status,
        markedAt: record.markedAt.toISOString(),
      });
    }
  }
  return rows;
}

function buildRecitationRows(sessions) {
  const rows = [];
  for (const session of sessions) {
    for (const record of session.recitations || []) {
      rows.push({
        date: session.date.toISOString(),
        studentName: record.studentProfile.name,
        studentId: String(record.studentProfile.studentId ?? ""),
        method: record.method,
        score: record.score === null || record.score === undefined ? "" : record.score,
        calledAt: record.calledAt.toISOString(),
      });
    }
  }
  return rows;
}

function buildActivityRows(activities) {
  const rows = [];
  for (const activity of activities) {
    for (const score of activity.scores || []) {
      rows.push({
        date: activity.session?.date ? activity.session.date.toISOString() : "",
        title: activity.title,
        studentName: score.studentProfile.name,
        studentId: String(score.studentProfile.studentId ?? ""),
        score: score.isAbsent ? "Absent" : score.score === null || score.score === undefined ? "" : score.score,
        maxScore: activity.maxScore ?? "",
      });
    }
  }
  return rows;
}

function buildProjectRows(projects) {
  const rows = [];
  for (const project of projects) {
    for (const score of project.scores || []) {
      rows.push({
        type: project.type,
        studentName: score.studentProfile.name,
        studentId: String(score.studentProfile.studentId ?? ""),
        score: score.isAbsent ? "Absent" : score.score === null || score.score === undefined ? "" : score.score,
        maxScore: project.maxScore ?? "",
      });
    }
  }
  return rows;
}

function buildQuizRows(quizSessions) {
  const rows = [];
  for (const quiz of quizSessions) {
    for (const score of quiz.scores || []) {
      rows.push({
        date: quiz.date.toISOString(),
        title: quiz.title,
        studentName: score.studentProfile.name,
        studentId: String(score.studentProfile.studentId ?? ""),
        score: score.isAbsent ? "Absent" : score.score === null || score.score === undefined ? "Not yet scored" : score.score,
        totalItems: quiz.totalItems,
      });
    }
  }
  return rows;
}

const ALL_TYPES = ["overview", "students", "attendance", "recitation", "activities", "projects", "quizzes"];

function parseTypes(rawTypes) {
  if (!rawTypes) return new Set(ALL_TYPES);
  const parts = String(rawTypes).split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  const valid = parts.filter((t) => ALL_TYPES.includes(t));
  return valid.length ? new Set(valid) : new Set(ALL_TYPES);
}

function buildExcelWorkbook(classRecord, rawTypes) {
  const types = parseTypes(rawTypes);
  const workbook = XLSX.utils.book_new();

  if (types.has("overview")) {
    appendSheet(workbook, "Overview", ["field", "value"], [
      { field: "Class name", value: classRecord.sectionName },
      { field: "Class code", value: classRecord.classCode },
      { field: "Description", value: classRecord.description || "" },
      { field: "Schedule", value: classRecord.schedule || "" },
      { field: "Faculty", value: classRecord.faculty?.name || "" },
      { field: "Student count", value: classRecord.enrollments.length },
      { field: "Attendance sessions", value: classRecord.sessions.length },
      { field: "Activities", value: classRecord.activities.length },
      { field: "Projects", value: classRecord.projects.length },
      { field: "Quiz sessions", value: classRecord.quizSessions.length },
    ]);
  }

  if (types.has("students")) appendSheet(workbook, "Student List", ["name", "studentId", "email", "program", "section", "status", "joinedAt"], buildStudentListRows(classRecord.enrollments));
  if (types.has("attendance")) appendSheet(workbook, "Attendance", ["date", "studentName", "studentId", "status", "markedAt"], buildAttendanceRows(classRecord.sessions));
  if (types.has("recitation")) appendSheet(workbook, "Recitation", ["date", "studentName", "studentId", "method", "score", "calledAt"], buildRecitationRows(classRecord.sessions));
  if (types.has("activities")) appendSheet(workbook, "Activities", ["date", "title", "studentName", "studentId", "score", "maxScore"], buildActivityRows(classRecord.activities));
  if (types.has("projects")) appendSheet(workbook, "Projects", ["type", "studentName", "studentId", "score", "maxScore"], buildProjectRows(classRecord.projects));
  if (types.has("quizzes")) appendSheet(workbook, "Quizzes", ["date", "title", "studentName", "studentId", "score", "totalItems"], buildQuizRows(classRecord.quizSessions));

  return XLSX.write(workbook, { bookType: "xlsx", type: "buffer" });
}

function csvEscape(value) {
  const sanitized = sanitizeExportValue(value);
  const text = sanitized === null || sanitized === undefined ? "" : String(sanitized);
  return `"${text.replace(/"/g, '""')}"`;
}

function rowsToCsv(headers, rows) {
  const lines = [headers.map(csvEscape).join(",")];
  for (const row of rows) {
    lines.push(headers.map((header) => csvEscape(row[header] ?? "")).join(","));
  }
  return `${lines.join("\r\n")}\r\n`;
}

function buildCsvExport(classRecord, rawTypes) {
  const types = parseTypes(rawTypes);
  const rows = [];

  if (types.has("overview")) {
    rows.push({ recordType: "Overview", field: "Class name", value: classRecord.sectionName });
    rows.push({ recordType: "Overview", field: "Class code", value: classRecord.classCode });
    rows.push({ recordType: "Overview", field: "Faculty", value: classRecord.faculty?.name || "" });
  }

  if (types.has("students")) {
    for (const student of buildStudentListRows(classRecord.enrollments)) {
      rows.push({ recordType: "Student List", name: student.name, studentId: student.studentId, email: student.email, program: student.program, section: student.section, status: student.status, date: student.joinedAt });
    }
  }

  if (types.has("attendance")) {
    for (const attendance of buildAttendanceRows(classRecord.sessions)) {
      rows.push({ recordType: "Attendance", date: attendance.date, name: attendance.studentName, studentId: attendance.studentId, status: attendance.status, score: "", notes: attendance.markedAt });
    }
  }

  if (types.has("recitation")) {
    for (const recitation of buildRecitationRows(classRecord.sessions)) {
      rows.push({ recordType: "Recitation", date: recitation.date, name: recitation.studentName, studentId: recitation.studentId, status: recitation.method, score: recitation.score, notes: recitation.calledAt });
    }
  }

  if (types.has("activities")) {
    for (const activity of buildActivityRows(classRecord.activities)) {
      rows.push({ recordType: "Activities", date: activity.date, title: activity.title, name: activity.studentName, studentId: activity.studentId, score: activity.score, maxScore: activity.maxScore });
    }
  }

  if (types.has("projects")) {
    for (const project of buildProjectRows(classRecord.projects)) {
      rows.push({ recordType: "Projects", type: project.type, name: project.studentName, studentId: project.studentId, score: project.score, maxScore: project.maxScore });
    }
  }

  if (types.has("quizzes")) {
    for (const quiz of buildQuizRows(classRecord.quizSessions)) {
      rows.push({ recordType: "Quizzes", date: quiz.date, title: quiz.title, name: quiz.studentName, studentId: quiz.studentId, score: quiz.score, maxScore: quiz.totalItems });
    }
  }

  return rowsToCsv(
    ["recordType", "field", "value", "name", "studentId", "email", "program", "section", "status", "date", "title", "type", "score", "maxScore", "notes"],
    rows,
  );
}

module.exports = {
  buildExcelWorkbook,
  buildCsvExport,
  sanitizeExportValue,
  buildStudentListRows,
  buildAttendanceRows,
  buildRecitationRows,
  buildActivityRows,
  buildProjectRows,
  buildQuizRows,
};
