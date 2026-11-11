import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");
const csvPath = path.join(repoRoot, "docs/testing/TEST_CASES.csv");

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\r" && text[i + 1] === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i += 1;
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

export function csvCell(value) {
  const str = String(value ?? "");
  return /[",\r\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

export function updateTestCases(updatesById) {
  const raw = fs.readFileSync(csvPath, "utf8");
  const rows = parseCsv(raw);
  if (rows.length !== 90) {
    throw new Error(`Expected 90 CSV rows (1 header + 89 cases), found ${rows.length}`);
  }
  if (rows.some((r) => r.length !== 12)) {
    throw new Error("CSV column count mismatch detected before update");
  }
  const idsSeen = new Set();
  for (let i = 1; i < rows.length; i += 1) {
    const id = rows[i][0];
    if (idsSeen.has(id)) throw new Error(`Duplicate CSV ID ${id}`);
    idsSeen.add(id);
    const patch = updatesById[id];
    if (patch) {
      if (patch.status !== undefined) rows[i][9] = patch.status;
      if (patch.date !== undefined) rows[i][10] = patch.date;
      if (patch.notes !== undefined) rows[i][11] = patch.notes;
    }
  }
  for (const key of Object.keys(updatesById)) {
    if (!idsSeen.has(key)) throw new Error(`Unknown test case ID in update map: ${key}`);
  }
  const output = `${rows.map((r) => r.map(csvCell).join(",")).join("\r\n")}\r\n`;
  fs.writeFileSync(csvPath, output, "utf8");

  // Re-parse to confirm integrity
  const check = parseCsv(fs.readFileSync(csvPath, "utf8"));
  if (check.length !== 90 || check.some((r) => r.length !== 12)) {
    throw new Error("Post-write CSV verification failed");
  }
  return check.length - 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const jsonArg = process.argv[2];
  if (!jsonArg) {
    console.error("Usage: node update-csv.mjs <updates.json>");
    process.exit(1);
  }
  const payload = JSON.parse(fs.readFileSync(path.resolve(jsonArg), "utf8"));
  const count = updateTestCases(payload);
  console.log(`Updated ${Object.keys(payload).length} case(s); verified ${count} test case rows (12 cols each).`);
}
