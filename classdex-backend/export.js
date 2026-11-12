const path = require("node:path");
const { compareStudents } = require(path.resolve(__dirname, "../shared/nameParser"));
const ExcelJS = require("exceljs");

function sanitizeExportValue(value) {
  if (typeof value === "string" && /^(?:[=+\-@\t\r\n]| +[=+\-@])/.test(value)) return `'${value}`;
  return value;
}

function dateLabel(value) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  return new Intl.DateTimeFormat("en-US", {
    month: "short", day: "numeric", year: "numeric", timeZone: "Asia/Manila",
  }).format(date);
}

function approvedStudents(classRecord) {
  return (classRecord.enrollments || [])
    .filter((enrollment) => enrollment.status === "APPROVED")
    .map(({ studentProfile }) => ({
      studentId: String(studentProfile.studentId ?? ""),
      studentName: studentProfile.name || "",
      firstName: studentProfile.firstName || "",
      middleName: studentProfile.middleName || "",
      lastName: studentProfile.lastName || "",
      suffix: studentProfile.suffix || "",
      sortKey: studentProfile.sortKey || "",
    }))
    .sort(compareStudents);
}

function droppedStudents(classRecord) {
  return (classRecord.enrollments || [])
    .filter((enrollment) => enrollment.status === "DROPPED")
    .map(({ studentProfile }) => ({
      studentId: String(studentProfile.studentId ?? ""),
      studentName: studentProfile.name || "",
      firstName: studentProfile.firstName || "",
      middleName: studentProfile.middleName || "",
      lastName: studentProfile.lastName || "",
      suffix: studentProfile.suffix || "",
      sortKey: studentProfile.sortKey || "",
    }))
    .sort(compareStudents);
}

function matrixSection(title, students, items, { itemLabel, resultFor }, droppedList = []) {
  const headers = ["Student ID", "Student Name", ...items.map(itemLabel)];
  const byId = new Map(students.map((student) => [student.studentId, student]));
  const values = new Map(students.map((student) => [student.studentId, Array(items.length).fill("")]));
  items.forEach((item, columnIndex) => {
    for (const result of resultFor(item)) {
      const studentId = String(result.studentId ?? "");
      if (!byId.has(studentId)) continue;
      values.get(studentId)[columnIndex] = result.value ?? "";
    }
  });
  const rows = students.map((student) => [student.studentId, student.studentName, ...values.get(student.studentId)]);
  if (droppedList && droppedList.length) {
    const droppedValues = new Map(droppedList.map((student) => [student.studentId, Array(items.length).fill("")]));
    items.forEach((item, columnIndex) => {
      for (const result of resultFor(item)) {
        const studentId = String(result.studentId ?? "");
        if (!droppedValues.has(studentId)) continue;
        droppedValues.get(studentId)[columnIndex] = result.value ?? "";
      }
    });
    rows.push(["Dropped", ...Array(headers.length - 1).fill("")]);
    for (const dropped of droppedList) {
      rows.push([dropped.studentId, dropped.studentName, ...droppedValues.get(dropped.studentId)]);
    }
  }
  return { title, headers, rows };
}

function latestBy(records, timestamp) {
  const latest = new Map();
  for (const record of records || []) {
    const studentId = String(record.studentProfile?.studentId ?? "");
    const current = latest.get(studentId);
    if (!current || new Date(record[timestamp] || 0) >= new Date(current[timestamp] || 0)) latest.set(studentId, record);
  }
  return [...latest.values()].map((record) => ({
    studentId: String(record.studentProfile?.studentId ?? ""),
    value: record.isAbsent ? "Absent" : record.status
      ? ({ PRESENT: "Present", LATE: "Late", ABSENT: "Absent" }[record.status] || record.status)
      : (record.score == null ? "" : record.score),
  }));
}

function buildRecordSections(classRecord) {
  const students = approvedStudents(classRecord);
  const droppedList = droppedStudents(classRecord);
  const sections = [];
  const sessions = [...(classRecord.sessions || [])].sort((a, b) => new Date(a.date) - new Date(b.date));
  const activities = [...(classRecord.activities || [])].sort((a, b) =>
    new Date(a.session?.date || 0) - new Date(b.session?.date || 0) || String(a.title).localeCompare(String(b.title)));
  const projects = [...(classRecord.projects || [])].sort((a, b) => {
    const order = { MIDTERM: 0, FINALS: 1 };
    return (order[a.type] ?? 2) - (order[b.type] ?? 2);
  });
  const quizzes = [...(classRecord.quizSessions || [])].sort(
    (a, b) => new Date(a.date) - new Date(b.date) || new Date(a.createdAt || 0) - new Date(b.createdAt || 0),
  );

  sections.push(matrixSection("Attendance", students, sessions, {
    itemLabel: (session) => dateLabel(session.date),
    resultFor: (session) => latestBy(session.attendance, "markedAt"),
  }, droppedList));
  sections.push(matrixSection("Recitation", students, sessions, {
    itemLabel: (session) => dateLabel(session.date),
    resultFor: (session) => latestBy(session.recitations, "calledAt"),
  }, droppedList));
  sections.push(matrixSection("Activities", students, activities, {
    itemLabel: (activity) => `${activity.title} - ${dateLabel(activity.session?.date)}`,
    resultFor: (activity) => latestBy(activity.scores, "updatedAt"),
  }, droppedList));
  sections.push(matrixSection("Projects", students, projects, {
    itemLabel: (project) => project.type === "MIDTERM" ? "Midterm Project" : "Finals Project",
    resultFor: (project) => latestBy(project.scores, "updatedAt"),
  }, droppedList));
  sections.push(matrixSection("Quiz", students, quizzes, {
    itemLabel: (quiz) => `${quiz.title} - ${dateLabel(quiz.date)} (/${quiz.totalItems})`,
    resultFor: (quiz) => latestBy(quiz.scores, "updatedAt"),
  }, droppedList));
  return sections;
}

const ALL_TYPES = ["overview", "students", "attendance", "recitation", "activities", "projects", "quizzes"];

function parseTypes(rawTypes) {
  if (!rawTypes) return new Set(ALL_TYPES);
  const valid = String(rawTypes).split(",").map((type) => type.trim().toLowerCase()).filter((type) => ALL_TYPES.includes(type));
  return valid.length ? new Set(valid) : new Set(ALL_TYPES);
}

function classInformation(classRecord) {
  return [
    ["Field", "Value"],
    ["Course code", classRecord.courseCode || ""],
    ["Course title", classRecord.courseTitle || ""],
    ["Class name", classRecord.sectionName],
    ["Class code", classRecord.classCode],
    ["Description", classRecord.description || ""],
    ["Schedule", classRecord.schedule || ""],
    ["Faculty", classRecord.faculty?.name || ""],
    ["Student count", approvedStudents(classRecord).length],
  ];
}

function appendMatrixSheet(workbook, section) {
  const worksheet = workbook.addWorksheet(section.title);
  const safeData = [section.headers, ...section.rows].map((row) => row.map(sanitizeExportValue));
  worksheet.views = [
    {
      state: "frozen",
      xSplit: 2,
      ySplit: 1,
      topLeftCell: "C2",
      activeCell: "C2",
    },
  ];
  worksheet.columns = section.headers.map((header, index) => {
    const maxLength = Math.max(
      String(header).length,
      ...safeData.slice(1).map((row) => String(row[index] ?? "").length),
    );
    return { width: Math.min(Math.max(maxLength + 2, index < 2 ? 14 : 12), 36) };
  });
  for (const safeRow of safeData) {
    worksheet.addRow(safeRow);
  }
  worksheet.getRow(1).font = { bold: true };
  if (section.title === "Attendance") {
    const fillByStatus = {
      Present: "FFDDF2E1",
      Late: "FFFFF0C2",
      Absent: "FFFADBD8",
    };
    for (let r = 2; r <= safeData.length; r += 1) {
      const row = worksheet.getRow(r);
      for (let c = 3; c <= section.headers.length; c += 1) {
        const cell = row.getCell(c);
        const argb = fillByStatus[cell.value];
        if (argb) {
          cell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb },
          };
        }
      }
    }
  }
}

async function buildExcelWorkbook(classRecord, rawTypes) {
  const types = parseTypes(rawTypes);
  const workbook = new ExcelJS.Workbook();
  if (types.has("overview")) {
    const infoSheet = workbook.addWorksheet("Class Information");
    const infoRows = classInformation(classRecord).map((row) => row.map(sanitizeExportValue));
    for (const row of infoRows) {
      infoSheet.addRow(row);
    }
  }
  if (types.has("students")) {
    const rows = (classRecord.enrollments || [])
      .filter(({ status }) => status === "APPROVED")
      .map(({ studentProfile, joinedAt }) => [
        String(studentProfile.studentId ?? ""),
        studentProfile.name,
        studentProfile.email || "",
        studentProfile.program || "",
        studentProfile.section || "",
        dateLabel(joinedAt),
      ]);
    appendMatrixSheet(workbook, {
      title: "Student List",
      headers: ["Student ID", "Student Name", "Email", "Program", "Section", "Joined"],
      rows,
    });
  }
  const typeMap = { attendance: "Attendance", recitation: "Recitation", activities: "Activities", projects: "Projects", quizzes: "Quiz" };
  for (const section of buildRecordSections(classRecord)) {
    const key = Object.keys(typeMap).find((type) => typeMap[type] === section.title);
    if (key && types.has(key)) {
      appendMatrixSheet(workbook, section);
    }
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

function csvEscape(value) {
  const sanitized = sanitizeExportValue(value);
  return `"${String(sanitized ?? "").replace(/"/g, '""')}"`;
}

function buildCsvExport(classRecord, rawTypes) {
  const types = parseTypes(rawTypes);
  const chunks = [];
  const addSection = (title, rows) => chunks.push([[title], ...rows].map((row) => row.map(csvEscape).join(",")).join("\r\n"));
  if (types.has("overview")) addSection("Class Information", classInformation(classRecord));
  if (types.has("students")) {
    const rows = [["Student ID", "Student Name", "Email", "Program", "Section", "Joined"], ...(classRecord.enrollments || []).filter(({ status }) => status === "APPROVED").map(({ studentProfile, joinedAt }) => [String(studentProfile.studentId ?? ""), studentProfile.name, studentProfile.email || "", studentProfile.program || "", studentProfile.section || "", dateLabel(joinedAt)])];
    addSection("Student List", rows);
  }
  const typeMap = { attendance: "Attendance", recitation: "Recitation", activities: "Activities", projects: "Projects", quizzes: "Quiz" };
  for (const section of buildRecordSections(classRecord)) {
    const key = Object.keys(typeMap).find((type) => typeMap[type] === section.title);
    if (key && types.has(key)) addSection(section.title, [section.headers, ...section.rows]);
  }
  return `${chunks.join("\r\n\r\n")}\r\n`;
}

module.exports = { buildExcelWorkbook, buildCsvExport, parseTypes, buildRecordSections, dateLabel, sanitizeExportValue };
