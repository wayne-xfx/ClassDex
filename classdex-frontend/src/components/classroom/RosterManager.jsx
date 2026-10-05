import { useEffect, useMemo, useState } from "react";
import Icon from "../Icon";
import { api } from "../../api";

const ID_PATTERN = /^\d{6}$/;

function validateRows(rows) {
  const seen = new Set();
  return rows.map((row) => {
    const errors = [];
    if (!row.name.trim()) errors.push("Missing name");
    if (!ID_PATTERN.test(row.studentId.trim())) errors.push("Student ID must be exactly 6 digits");
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

export default function RosterManager({ classId, onClose }) {
  const [rows, setRows] = useState([]);
  const [name, setName] = useState("");
  const [studentId, setStudentId] = useState("");
  const [pasteValue, setPasteValue] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    api.classRoster(classId).then(({ roster }) => { if (active) setRows(roster.map((entry) => ({ id: entry.id, name: entry.studentName, studentId: entry.studentId }))); }).catch((error) => { if (active) setMessage(error.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [classId]);

  const checkedRows = useMemo(() => validateRows(rows), [rows]);
  const invalidCount = checkedRows.filter((row) => row.errors.length).length;

  function addRow(event) {
    event.preventDefault();
    setRows((current) => validateRows([...current, { name, studentId }]));
    setName("");
    setStudentId("");
    setMessage("");
  }

  function importPasted() {
    setRows((current) => validateRows([...current, ...parseLines(pasteValue)]));
    setPasteValue("");
    setMessage("Pasted rows added to the preview. Review validation before saving.");
  }

  function updateRow(index, field, value) {
    setRows((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, [field]: value } : row));
  }

  async function saveRoster() {
    setSaving(true);
    try {
      await api.saveClassRoster(classId, checkedRows.map((row) => ({ studentName: row.name, studentId: row.studentId })));
      setMessage("Official roster saved.");
    } catch (error) { setMessage(error.message); } finally { setSaving(false); }
  }

  async function removeRow(index) {
    const row = rows[index];
    if (row.id) {
      try { await api.deleteClassRosterEntry(classId, row.id); } catch (error) { setMessage(error.message); return; }
    }
    setRows((current) => current.filter((_, rowIndex) => rowIndex !== index));
  }

  function handleFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!/\.csv$/i.test(file.name)) {
      setMessage("CSV files are supported here. XLSX parsing will be enabled when the roster is wired to the server.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setRows((current) => validateRows([...current, ...parseLines(String(reader.result || ""))]));
    reader.readAsText(file);
  }

  return (
    <section className="panel roster-manager" aria-labelledby="roster-manager-title">
      <div className="roster-manager-heading">
        <div>
          <span className="eyebrow"><Icon name="users" /> Official roster</span>
          <h2 id="roster-manager-title">Add the students in this class</h2>
          <p>Use the official roster to automatically recognize join requests. Nothing is saved until the implementation is connected.</p>
        </div>
        <button type="button" className="button button-quiet" onClick={onClose}>Close</button>
      </div>

      <div className="roster-warning notice notice-warning">
        <Icon name="info" /> <span>No roster yet? Sharing the invite without one means unmatched submissions may need manual validation.</span>
      </div>

      <div className="roster-input-grid">
        <form className="roster-entry-form" onSubmit={addRow}>
          <label className="field"><span>Student name</span><input className="input" value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Alex Santos" /></label>
          <label className="field"><span>6-digit student ID</span><input className="input" inputMode="numeric" maxLength={6} value={studentId} onChange={(event) => setStudentId(event.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="230039" /></label>
          <button type="submit" className="button button-secondary"><Icon name="plus" /> Add student</button>
        </form>
        <div className="roster-import-box">
          <label className="field"><span>Paste one student per line</span><textarea className="input" rows={4} value={pasteValue} onChange={(event) => setPasteValue(event.target.value)} placeholder={"Alex Santos, 230039\nBea Cruz, 230040"} /></label>
          <div className="roster-import-actions"><button type="button" className="button button-quiet" onClick={importPasted} disabled={!pasteValue.trim()}>Add pasted rows</button><label className="button button-quiet"><Icon name="upload" /> Upload CSV<input type="file" accept=".csv,.xlsx" hidden onChange={handleFile} /></label></div>
        </div>
      </div>

      {message ? <p className="notice notice-info" role="status">{message}</p> : null}
      {loading ? <div className="empty-state roster-empty" aria-label="Loading roster">Loading official roster…</div> : null}
      <div className="roster-preview-heading"><div><h3>Roster preview</h3><span>{rows.length} {rows.length === 1 ? "row" : "rows"}{invalidCount ? ` · ${invalidCount} need${invalidCount === 1 ? "s" : ""} attention` : ""}</span></div><button type="button" className="button button-primary" onClick={saveRoster} disabled={saving || !rows.length || invalidCount}>{saving ? "Saving…" : "Save official roster"}</button></div>
      {rows.length ? <div className="roster-table-wrap"><table className="roster-table"><thead><tr><th scope="col">Name</th><th scope="col">Student ID</th><th scope="col">Validation</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead><tbody>{checkedRows.map((row, index) => <tr key={`${index}-${row.studentId}`}><td><input className="input" value={row.name} onChange={(event) => updateRow(index, "name", event.target.value)} /></td><td><input className="input" inputMode="numeric" maxLength={6} value={row.studentId} onChange={(event) => updateRow(index, "studentId", event.target.value.replace(/\D/g, "").slice(0, 6))} /></td><td>{row.errors.length ? <span className="roster-row-error">{row.errors.join(" · ")}</span> : <span className="roster-row-valid">Ready to save</span>}</td><td><button type="button" className="icon-button" aria-label={`Remove ${row.name || "row"}`} onClick={() => removeRow(index)}>×</button></td></tr>)}</tbody></table></div> : <div className="empty-state roster-empty"><Icon name="users" /><strong>Your official roster is empty</strong><span>Add students above or paste a class list to begin.</span></div>}
    </section>
  );
}
