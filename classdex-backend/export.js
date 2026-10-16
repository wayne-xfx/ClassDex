const XLSX = require("xlsx");
const { inflateRawSync } = require("node:zlib");

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function unzipEntries(buffer) {
  let endOffset = -1;
  for (let offset = buffer.length - 22; offset >= Math.max(0, buffer.length - 65557); offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) { endOffset = offset; break; }
  }
  if (endOffset < 0) throw new Error("Unable to read generated Excel archive.");
  const count = buffer.readUInt16LE(endOffset + 10);
  let offset = buffer.readUInt32LE(endOffset + 16);
  const entries = [];
  for (let index = 0; index < count; index += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error("Invalid Excel archive directory.");
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = buffer.subarray(dataOffset, dataOffset + compressedSize);
    const data = method === 8 ? inflateRawSync(compressed) : Buffer.from(compressed);
    entries.push({ name, data });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function zipEntries(entries) {
  const locals = [];
  const centrals = [];
  let localOffset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data, "utf8");
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt32LE(localOffset, 42);
    centrals.push(central, name);
    localOffset += local.length + name.length + data.length;
  }
  const centralDirectory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(localOffset, 16);
  return Buffer.concat([...locals, centralDirectory, end]);
}

function styledExcelBuffer(buffer, matrixSheetNames) {
  const entries = unzipEntries(buffer);
  const byName = new Map(entries.map((entry) => [entry.name, entry]));
  const workbookXml = byName.get("xl/workbook.xml")?.data.toString("utf8") || "";
  const relsXml = byName.get("xl/_rels/workbook.xml.rels")?.data.toString("utf8") || "";
  const relationships = new Map([...relsXml.matchAll(/<Relationship[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g)]
    .map((match) => [match[1], match[2].replace(/^\//, "").startsWith("xl/") ? match[2].replace(/^\//, "") : "xl/" + match[2].replace(/^\//, "")]));
  const sheetPaths = new Map([...workbookXml.matchAll(/<sheet[^>]*name="([^"]+)"[^>]*r:id="([^"]+)"/g)]
    .map((match) => [match[1], relationships.get(match[2])]));

  for (const sheetName of matrixSheetNames) {
    const path = sheetPaths.get(sheetName);
    const entry = byName.get(path);
    if (!entry) continue;
    let xml = entry.data.toString("utf8");
    xml = xml.replace(/<sheetView([^>]*)\/>/, '<sheetView$1><pane xSplit="2" ySplit="1" topLeftCell="C2" activePane="bottomRight" state="frozen"/><selection pane="bottomRight" activeCell="C2" sqref="C2"/></sheetView>');
    xml = xml.replace(/<c([^>]*\br="([A-Z]+)1"[^>]*)>/g, (_cell, attrs) => "<c" + attrs + ' s="1">');
    if (sheetName === "Attendance") {
      xml = xml.replace(/<c([^>]*\br="([A-Z]+[2-9][0-9]*)"[^>]*)>([\s\S]*?)<\/c>/g, (cell, attrs, _ref, body) => {
        const value = body.match(/<v>([^<]*)<\/v>/)?.[1];
        const style = value === "Present" ? 2 : value === "Late" ? 3 : value === "Absent" ? 4 : 0;
        return style ? "<c" + attrs + ' s="' + style + '">' + body + "</c>" : cell;
      });
    }
    entry.data = Buffer.from(xml, "utf8");
  }
  const styles = byName.get("xl/styles.xml");
  if (styles && matrixSheetNames.length) {
    let xml = styles.data.toString("utf8");
    xml = xml.replace(/<fonts count="1">[\s\S]*?<\/fonts>/, '<fonts count="2"><font><sz val="12"/><color theme="1"/><name val="Calibri"/><family val="2"/><scheme val="minor"/></font><font><b/><sz val="12"/><color theme="1"/><name val="Calibri"/><family val="2"/><scheme val="minor"/></font></fonts>');
    xml = xml.replace(/<fills count="2">[\s\S]*?<\/fills>/, '<fills count="5"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFDDF2E1"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFF0C2"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFADBD8"/><bgColor indexed="64"/></patternFill></fill></fills>');
    xml = xml.replace(/<cellXfs count="1">[\s\S]*?<\/cellXfs>/, '<cellXfs count="5"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="0" fontId="0" fillId="2" borderId="0" xfId="0" applyFill="1"/><xf numFmtId="0" fontId="0" fillId="3" borderId="0" xfId="0" applyFill="1"/><xf numFmtId="0" fontId="0" fillId="4" borderId="0" xfId="0" applyFill="1"/></cellXfs>');
    styles.data = Buffer.from(xml, "utf8");
  }
  return zipEntries(entries);
}

function sanitizeExportValue(value) {
  if (typeof value === "string" && /^[=+\-@]/.test(value)) return `'${value}`;
  return value;
}

function dateLabel(value) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  return new Intl.DateTimeFormat("en-US", {
    month: "short", day: "numeric", year: "numeric", timeZone: "UTC",
  }).format(date);
}

function approvedStudents(classRecord) {
  return (classRecord.enrollments || [])
    .filter((enrollment) => enrollment.status === "APPROVED")
    .map(({ studentProfile }) => ({
      studentId: String(studentProfile.studentId ?? ""),
      studentName: studentProfile.name || "",
    }))
    .sort((a, b) => a.studentId.localeCompare(b.studentId));
}

function matrixSection(title, students, items, { itemLabel, resultFor }) {
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
  const sections = [];
  const sessions = [...(classRecord.sessions || [])].sort((a, b) => new Date(a.date) - new Date(b.date));
  const activities = [...(classRecord.activities || [])].sort((a, b) =>
    new Date(a.session?.date || 0) - new Date(b.session?.date || 0) || String(a.title).localeCompare(String(b.title)));
  const projects = [...(classRecord.projects || [])].sort((a, b) => {
    const order = { MIDTERM: 0, FINALS: 1 };
    return (order[a.type] ?? 2) - (order[b.type] ?? 2);
  });
  const quizzes = [...(classRecord.quizSessions || [])].sort((a, b) => new Date(a.date) - new Date(b.date));

  sections.push(matrixSection("Attendance", students, sessions, {
    itemLabel: (session) => dateLabel(session.date),
    resultFor: (session) => latestBy(session.attendance, "markedAt"),
  }));
  sections.push(matrixSection("Recitation", students, sessions, {
    itemLabel: (session) => dateLabel(session.date),
    resultFor: (session) => latestBy(session.recitations, "calledAt"),
  }));
  sections.push(matrixSection("Activities", students, activities, {
    itemLabel: (activity) => `${activity.title} - ${dateLabel(activity.session?.date)}`,
    resultFor: (activity) => latestBy(activity.scores, "updatedAt"),
  }));
  sections.push(matrixSection("Projects", students, projects, {
    itemLabel: (project) => project.type === "MIDTERM" ? "Midterm Project" : "Finals Project",
    resultFor: (project) => latestBy(project.scores, "updatedAt"),
  }));
  sections.push(matrixSection("Quiz", students, quizzes, {
    itemLabel: (quiz) => `${quiz.title} - ${dateLabel(quiz.date)} (/${quiz.totalItems})`,
    resultFor: (quiz) => latestBy(quiz.scores, "updatedAt"),
  }));
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
    ["Class name", classRecord.sectionName],
    ["Class code", classRecord.classCode],
    ["Description", classRecord.description || ""],
    ["Schedule", classRecord.schedule || ""],
    ["Faculty", classRecord.faculty?.name || ""],
    ["Student count", approvedStudents(classRecord).length],
  ];
}

function appendMatrixSheet(workbook, section) {
  const safeData = [section.headers, ...section.rows].map((row) => row.map(sanitizeExportValue));
  const worksheet = XLSX.utils.aoa_to_sheet(safeData);
  const data = safeData;
  worksheet["!cols"] = section.headers.map((header, index) => {
    const maxLength = Math.max(String(header).length, ...data.slice(1).map((row) => String(row[index] ?? "").length));
    return { wch: Math.min(Math.max(maxLength + 2, index < 2 ? 14 : 12), 36) };
  });
  XLSX.utils.book_append_sheet(workbook, worksheet, section.title);
}

function buildExcelWorkbook(classRecord, rawTypes) {
  const types = parseTypes(rawTypes);
  const workbook = XLSX.utils.book_new();
  const formattedSheets = [];
  if (types.has("overview")) {
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(classInformation(classRecord).map((row) => row.map(sanitizeExportValue))), "Class Information");
    formattedSheets.push("Class Information");
  }
  if (types.has("students")) {
    const rows = (classRecord.enrollments || []).filter(({ status }) => status === "APPROVED").map(({ studentProfile, joinedAt }) => [
      String(studentProfile.studentId ?? ""), studentProfile.name, studentProfile.email || "", studentProfile.program || "", studentProfile.section || "", dateLabel(joinedAt),
    ]);
    appendMatrixSheet(workbook, { title: "Student List", headers: ["Student ID", "Student Name", "Email", "Program", "Section", "Joined"], rows });
    formattedSheets.push("Student List");
  }
  const typeMap = { attendance: "Attendance", recitation: "Recitation", activities: "Activities", projects: "Projects", quizzes: "Quiz" };
  for (const section of buildRecordSections(classRecord)) {
    const key = Object.keys(typeMap).find((type) => typeMap[type] === section.title);
    if (key && types.has(key)) {
      appendMatrixSheet(workbook, section);
      formattedSheets.push(section.title);
    }
  }
  return styledExcelBuffer(XLSX.write(workbook, { bookType: "xlsx", type: "buffer" }), formattedSheets);
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
