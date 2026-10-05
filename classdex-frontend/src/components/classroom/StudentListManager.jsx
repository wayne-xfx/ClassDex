import { useMemo, useState } from "react";
import Icon from "../Icon";

const ID_PATTERN = /^\d{7}$/;
function validateRows(rows) {
  const seen = new Set();
  return rows.map((row) => {
    const errors = [];
    if (!row.name.trim()) errors.push("Missing name");
    if (!ID_PATTERN.test(row.studentId.trim())) errors.push("Student ID must be exactly 7 digits");
    if (row.studentId.trim() && seen.has(row.studentId.trim())) errors.push("Duplicate student ID");
    if (row.studentId.trim()) seen.add(row.studentId.trim());
    return { ...row, errors };
  });
}
function parseLines(value) {
  return value.split(/\r?\n/).map((line) => {
    const parts = line.includes(",") ? line.split(",") : line.split(/\s*[-\t]\s*/);
    return { name: String(parts[0] || "").trim(), studentId: String(parts[1] || "").trim() };
  }).filter((row) => row.name || row.studentId);
}

export default function StudentListManager({ onClose }) {
  const [rows, setRows] = useState([]);
  const [name, setName] = useState("");
  const [studentId, setStudentId] = useState("");
  const [pasteValue, setPasteValue] = useState("");
  const [message, setMessage] = useState("");
  const checkedRows = useMemo(() => validateRows(rows), [rows]);
  const invalidCount = checkedRows.filter((row) => row.errors.length).length;
  function addRow(event) { event.preventDefault(); setRows((current) => [...current, { name, studentId }]); setName(""); setStudentId(""); }
  function updateRow(index, field, value) { setRows((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, [field]: value } : row)); }
  function importPasted() { setRows((current) => [...current, ...parseLines(pasteValue)]); setPasteValue(""); setMessage("Pasted rows added to the preview. Review validation before saving."); }
  function handleFile(event) { const file = event.target.files?.[0]; if (!file) return; if (!/\.csv$/i.test(file.name)) { setMessage("CSV files are supported here. XLSX parsing will be enabled when the student list is wired to the server."); return; } const reader = new FileReader(); reader.onload = () => setRows((current) => [...current, ...parseLines(String(reader.result || ""))]); reader.readAsText(file); }
  return <section className="panel student-list-manager" aria-labelledby="student-list-manager-title">
    <div className="student-list-manager-heading"><div><span className="eyebrow"><Icon name="users" /> Student List</span><h2 id="student-list-manager-title">Add the students in this class</h2><p>Use the student list to automatically recognize join requests.</p></div><button type="button" className="button button-quiet" onClick={onClose}>Close</button></div>
    <div className="student-list-warning notice notice-warning"><Icon name="info" /><span>You haven't added a student list yet. Join requests that don't match a list entry will need your manual approval.</span></div>
    <div className="student-list-input-grid"><form className="student-list-entry-form" onSubmit={addRow}><label className="field"><span>Student name</span><input className="input" value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Alex Santos" /></label><label className="field"><span>7-digit student ID</span><input className="input" inputMode="numeric" maxLength={7} value={studentId} onChange={(event) => setStudentId(event.target.value.replace(/\D/g, "").slice(0, 7))} placeholder="2300039" /></label><button type="submit" className="button button-secondary"><Icon name="plus" /> Add student</button></form><div className="student-list-import-box"><label className="field"><span>Paste one student per line</span><textarea className="input" rows={4} value={pasteValue} onChange={(event) => setPasteValue(event.target.value)} placeholder={"Alex Santos, 2300039\nBea Cruz, 2300040"} /></label><div className="student-list-import-actions"><button type="button" className="button button-quiet" onClick={importPasted} disabled={!pasteValue.trim()}>Add pasted rows</button><label className="button button-quiet"><Icon name="upload" /> Import student list<input type="file" accept=".csv,.xlsx" hidden onChange={handleFile} /></label></div></div></div>
    {message ? <p className="notice notice-info" role="status">{message}</p> : null}<div className="student-list-preview-heading"><div><h3>Student list preview</h3><span>{rows.length} {rows.length === 1 ? "row" : "rows"}{invalidCount ? ` · ${invalidCount} need${invalidCount === 1 ? "s" : ""} attention` : ""}</span></div><button type="button" className="button button-primary" disabled={!rows.length || invalidCount}>Save student list</button></div>
    {rows.length ? <div className="student-list-table-wrap"><table className="student-list-table"><thead><tr><th>Name</th><th>Student ID</th><th>Validation</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{checkedRows.map((row, index) => <tr key={`${index}-${row.studentId}`}><td><input className="input" value={row.name} onChange={(event) => updateRow(index, "name", event.target.value)} /></td><td><input className="input" inputMode="numeric" maxLength={7} value={row.studentId} onChange={(event) => updateRow(index, "studentId", event.target.value.replace(/\D/g, "").slice(0, 7))} /></td><td>{row.errors.length ? <span className="student-list-row-error">{row.errors.join(" · ")}</span> : <span className="student-list-row-valid">Ready to save</span>}</td><td><button type="button" className="icon-button" aria-label={`Remove ${row.name || "row"}`} onClick={() => setRows((current) => current.filter((_, rowIndex) => rowIndex !== index))}>×</button></td></tr>)}</tbody></table></div> : <div className="empty-state student-list-empty"><Icon name="users" /><strong>Your student list is empty</strong><span>Add students above or paste a class list to begin.</span></div>}
  </section>;
}
