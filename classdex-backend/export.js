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
  const sheet = XLSX.utils.aoa_to_sheet(makeSheetRows(headers, rows));
  XLSX.utils.book_append_sheet(workbook, sheet, name);
}

function buildStudentListRows(enrollments) {
  return enrollments.map((enrollment) => ({
    name: enrollment.studentProfile.name,
    studentId: enrollment.studentProfile.studentId,
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
        studentId: record.studentProfile.studentId,
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
        studentId: record.studentProfile.studentId,
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
        studentId: score.studentProfile.studentId,
        score: score.score === null || score.score === undefined ? "" : score.score,
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
        studentId: score.studentProfile.studentId,
        score: score.score === null || score.score === undefined ? "" : score.score,
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
        studentId: score.studentProfile.studentId,
        score: score.score === null || score.score === undefined ? "" : score.score,
        totalItems: quiz.totalItems,
      });
    }
  }
  return rows;
}

function buildExcelWorkbook(classRecord) {
  const workbook = XLSX.utils.book_new();
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

  appendSheet(workbook, "Student List", ["name", "studentId", "email", "program", "section", "status", "joinedAt"], buildStudentListRows(classRecord.enrollments));
  appendSheet(workbook, "Attendance", ["date", "studentName", "studentId", "status", "markedAt"], buildAttendanceRows(classRecord.sessions));
  appendSheet(workbook, "Recitation", ["date", "studentName", "studentId", "method", "score", "calledAt"], buildRecitationRows(classRecord.sessions));
  appendSheet(workbook, "Activities", ["date", "title", "studentName", "studentId", "score", "maxScore"], buildActivityRows(classRecord.activities));
  appendSheet(workbook, "Projects", ["type", "studentName", "studentId", "score", "maxScore"], buildProjectRows(classRecord.projects));
  appendSheet(workbook, "Quizzes", ["date", "title", "studentName", "studentId", "score", "totalItems"], buildQuizRows(classRecord.quizSessions));

  return XLSX.write(workbook, { bookType: "xlsx", type: "buffer" });
}

module.exports = {
  buildExcelWorkbook,
  sanitizeExportValue,
  buildStudentListRows,
  buildAttendanceRows,
  buildRecitationRows,
  buildActivityRows,
  buildProjectRows,
  buildQuizRows,
};
