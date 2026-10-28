import { useCallback, useEffect, useMemo, useState } from "react";
import Avatar from "../Avatar";
import Icon from "../Icon";
import { Button, Modal } from "../DesignSystem";
import { api } from "../../api";
import ModuleSkeleton from "./ModuleSkeleton";
import { formatStudentName } from "./studentNames";

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
  return value
    .split(/\r?\n/)
    .map((line) => {
      const parts = line.includes(",") ? line.split(",") : line.split(/\s*[-\t]\s*/);
      return { name: String(parts[0] || "").trim(), studentId: String(parts[1] || "").trim() };
    })
    .filter((row) => row.name || row.studentId);
}

export default function StudentListManager({ classId, onClose, onCountChange, onAutoApproved, tabCache }) {
  const cachedRoster = tabCache?.get(`roster:${classId}`);
  const [activeTab, setActiveTab] = useState("active"); // "active" | "dropList"
  const [rows, setRows] = useState(cachedRoster || []);
  const [dropList, setDropList] = useState([]);
  const [name, setName] = useState("");
  const [studentId, setStudentId] = useState("");
  const [pasteValue, setPasteValue] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(!cachedRoster);
  const [dropLoading, setDropLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [removalModal, setRemovalModal] = useState(null); // { row, index, loading, recordCount }
  const [removing, setRemoving] = useState(false);

  const checkedRows = useMemo(() => validateRows(rows), [rows]);
  const invalidCount = checkedRows.filter((row) => row.errors.length).length;

  const loadRoster = useCallback(() => {
    return api
      .classRoster(classId)
      .then(({ roster }) => {
        const mapped = roster.map((entry) => ({
          id: entry.id,
          name: entry.studentName,
          studentId: entry.studentId,
          photo: entry.photo || entry.photoUrl || "",
        }));
        tabCache?.set(`roster:${classId}`, mapped);
        setRows(mapped);
        onCountChange?.(roster.length);
      })
      .catch((error) => {
        setMessage(error.message);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [classId, onCountChange, tabCache]);

  const loadDropList = useCallback(() => {
    setDropLoading(true);
    return api
      .dropList(classId)
      .then(({ dropList: list }) => {
        setDropList(list || []);
      })
      .catch((error) => {
        setMessage(error.message);
      })
      .finally(() => {
        setDropLoading(false);
      });
  }, [classId]);

  useEffect(() => {
    loadRoster();
    loadDropList();
  }, [loadRoster, loadDropList]);

  function addRow(event) {
    event.preventDefault();
    setRows((current) => [...current, { name, studentId, photo: "" }]);
    setName("");
    setStudentId("");
  }

  function updateRow(index, field, value) {
    setRows((current) => current.map((row, rowIndex) => (rowIndex === index ? { ...row, [field]: value } : row)));
  }

  function importPasted() {
    setRows((current) => [...current, ...parseLines(pasteValue)]);
    setPasteValue("");
    setMessage("Pasted rows added to the preview. Review validation before saving.");
  }

  async function handleFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const fileBase64 = String(reader.result).split(",")[1];
        const res = await api.importRosterFile(classId, { fileName: file.name, fileBase64 });
        if (res.rows?.length) {
          setRows((current) => [
            ...current,
            ...res.rows.map((r) => ({ name: r.studentName, studentId: r.studentId, photo: "" })),
          ]);
          let msg = `Imported ${res.rows.length} rows from ${file.name}. Review validation before saving.`;
          if (res.warnings?.length) {
            msg += ` (${res.warnings.join("; ")})`;
          }
          setMessage(msg);
        }
      } catch (err) {
        setMessage(err.message);
      }
    };
    reader.readAsDataURL(file);
    event.target.value = "";
  }

  async function downloadTemplate() {
    try {
      const blob = await api.downloadRosterTemplate(classId);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "student_list_template.xlsx";
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err) {
      setMessage(err.message);
    }
  }

  async function saveStudentList() {
    setSaving(true);
    try {
      const { roster, autoApprovedCount = 0 } = await api.saveClassRoster(
        classId,
        checkedRows.map((row) => ({ studentName: row.name, studentId: row.studentId })),
      );
      const mapped = roster.map((entry) => ({
        id: entry.id,
        name: entry.studentName,
        studentId: entry.studentId,
        photo: entry.photo || entry.photoUrl || "",
      }));
      tabCache?.set(`roster:${classId}`, mapped);
      setRows(mapped);
      onCountChange?.(roster.length);
      setMessage(
        autoApprovedCount
          ? `Student list saved. ${autoApprovedCount} pending ${autoApprovedCount === 1 ? "request was" : "requests were"} auto approved; review the notification and mark it as read when ready.`
          : "Student list saved.",
      );
      if (autoApprovedCount) onAutoApproved?.();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setSaving(false);
    }
  }

  async function promptRemoveRow(index) {
    const row = rows[index];
    if (!row.id) {
      setRows((current) => current.filter((_, rowIndex) => rowIndex !== index));
      return;
    }
    setRemovalModal({ row, index, loading: true, recordCount: 0 });
    try {
      const { recordCount = 0 } = await api.rosterImpact(classId, row.id);
      setRemovalModal((current) => (current ? { ...current, loading: false, recordCount } : null));
    } catch {
      setRemovalModal((current) => (current ? { ...current, loading: false, recordCount: 0 } : null));
    }
  }

  async function executeRemoval() {
    if (!removalModal) return;
    const { row, index } = removalModal;
    setRemoving(true);
    try {
      const outcome = await api.deleteClassRosterEntry(classId, row.id);
      tabCache?.invalidate();
      setRows((current) => current.filter((_, rowIndex) => rowIndex !== index));
      onCountChange?.(rows.length - 1);
      setMessage(
        outcome.result === "dropped"
          ? `${row.name} was moved to the Drop List (${outcome.recordCount} records preserved).`
          : `${row.name} was removed from the student list.`,
      );
      setRemovalModal(null);
      loadDropList();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setRemoving(false);
    }
  }

  async function restoreStudent(entry) {
    try {
      await api.restoreDroppedStudent(classId, entry.id);
      tabCache?.invalidate();
      setMessage(`${entry.studentName} was restored to the active student list.`);
      await Promise.all([loadRoster(), loadDropList()]);
    } catch (error) {
      setMessage(error.message);
    }
  }

  return (
    <section className="panel student-list-manager" aria-labelledby="student-list-manager-title">
      <div className="student-list-manager-heading">
        <div>
          <span className="eyebrow"><Icon name="users" /> Student List</span>
          <h2 id="student-list-manager-title">Manage the students in this class</h2>
          <p>Use the student list to automatically recognize join requests and maintain official class enrollment.</p>
        </div>
        <button type="button" className="button button-quiet" onClick={onClose}>Close</button>
      </div>

      <div className="flex gap-2 border-b border-slate-200 dark:border-slate-800 pb-3 mt-4" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "active"}
          className={`button ${activeTab === "active" ? "button-primary" : "button-quiet"}`}
          onClick={() => setActiveTab("active")}
        >
          <Icon name="users" /> Student List ({rows.length})
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "dropList"}
          className={`button ${activeTab === "dropList" ? "button-primary" : "button-quiet"}`}
          onClick={() => setActiveTab("dropList")}
        >
          <Icon name="userMinus" /> Drop List ({dropList.length})
        </button>
      </div>

      {message ? <p className="notice notice-info mt-3" role="status">{message}</p> : null}

      {activeTab === "active" ? (
        <>
          <div className="student-list-warning notice notice-warning">
            <Icon name="info" />
            <span>You haven't added a student list yet. Join requests that don't match a list entry will need your manual approval.</span>
          </div>
          <div className="student-list-input-grid">
            <form className="student-list-entry-form" onSubmit={addRow}>
              <label className="field">
                <span>Student name</span>
                <input
                  className="input"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="e.g., Jose P. Rizal"
                />
                <span className="field-hint">
                  First name, middle initial, surname; add Jr./Sr./III at the end; &ldquo;Dela Cruz, Juan P.&rdquo; also works
                </span>
              </label>
              <label className="field">
                <span>7-digit student ID</span>
                <input
                  className="input"
                  inputMode="numeric"
                  maxLength={7}
                  value={studentId}
                  onChange={(event) => setStudentId(event.target.value.replace(/\D/g, "").slice(0, 7))}
                  placeholder="2300039"
                />
              </label>
              <button type="submit" className="button button-secondary">
                <Icon name="plus" /> Add student
              </button>
            </form>
            <div className="student-list-import-box">
              <label className="field">
                <span>Paste one student per line</span>
                <textarea
                  className="input"
                  rows={4}
                  value={pasteValue}
                  onChange={(event) => setPasteValue(event.target.value)}
                  placeholder={"Alex Santos, 2300039\nBea Cruz, 2300040"}
                />
              </label>
              <div className="student-list-import-actions">
                <button type="button" className="button button-quiet" onClick={importPasted} disabled={!pasteValue.trim()}>
                  Add pasted rows
                </button>
                <button type="button" className="button button-quiet" onClick={downloadTemplate}>
                  <Icon name="download" /> Download template
                </button>
                <label className="button button-quiet">
                  <Icon name="upload" /> Import student list
                  <input type="file" accept=".csv,.xlsx,.xls" hidden onChange={handleFile} />
                </label>
              </div>
            </div>
          </div>

          <div className="student-list-preview-heading">
            <div>
              <h3>Student list preview</h3>
              <span>{rows.length} {rows.length === 1 ? "row" : "rows"}{invalidCount ? ` · ${invalidCount} need${invalidCount === 1 ? "s" : ""} attention` : ""}</span>
            </div>
            <button
              type="button"
              className="button button-primary"
              onClick={saveStudentList}
              disabled={saving || !rows.length || invalidCount}
            >
              {saving ? "Saving…" : "Save student list"}
            </button>
          </div>

          {loading && !rows.length ? (
            <ModuleSkeleton aria-label="Loading student list" />
          ) : rows.length ? (
            <div className="student-list-table-wrap">
              <table className="student-list-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Student ID</th>
                    <th>Validation</th>
                    <th><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {checkedRows.map((row, index) => (
                    <tr key={`${index}-${row.studentId}`}>
                      <td>
                        <div className="student-list-name-cell">
                          <Avatar src={row.photo} name={row.name} size="sm" className="student-list-avatar" />
                          <input
                            className="input"
                            value={row.name}
                            onChange={(event) => updateRow(index, "name", event.target.value)}
                          />
                        </div>
                      </td>
                      <td>
                        <input
                          className="input"
                          inputMode="numeric"
                          maxLength={7}
                          value={row.studentId}
                          onChange={(event) => updateRow(index, "studentId", event.target.value.replace(/\D/g, "").slice(0, 7))}
                        />
                      </td>
                      <td>
                        {row.errors.length ? (
                          <span className="student-list-row-error">{row.errors.join(" · ")}</span>
                        ) : (
                          <span className="student-list-row-valid">Ready to save</span>
                        )}
                      </td>
                      <td>
                        <button
                          type="button"
                          className="icon-button"
                          aria-label={`Remove ${row.name || "row"}`}
                          onClick={() => promptRemoveRow(index)}
                        >
                          ×
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty-state student-list-empty">
              <Icon name="users" />
              <strong>Your student list is empty</strong>
              <span>Add students above, paste a class list, or import an Excel/CSV file to begin.</span>
            </div>
          )}
        </>
      ) : (
        <div className="drop-list-view mt-4">
          <div className="student-list-preview-heading">
            <div>
              <h3>Drop List</h3>
              <span>Students who were dropped with recorded coursework</span>
            </div>
          </div>
          {dropLoading && !dropList.length ? (
            <ModuleSkeleton aria-label="Loading drop list" />
          ) : dropList.length ? (
            <div className="student-list-table-wrap">
              <table className="student-list-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Student ID</th>
                    <th>Dropped Date</th>
                    <th>Coursework Records</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {dropList.map((entry) => (
                    <tr key={entry.id}>
                      <td>
                        <div className="student-list-name-cell">
                          <Avatar src={entry.photo} name={entry.studentName} size="sm" className="student-list-avatar" />
                          <span>{formatStudentName(entry.studentName, entry)}</span>
                        </div>
                      </td>
                      <td>{entry.studentId}</td>
                      <td>{entry.droppedAt ? new Date(entry.droppedAt).toLocaleDateString() : "—"}</td>
                      <td>{entry.recordCount} {entry.recordCount === 1 ? "record" : "records"}</td>
                      <td>
                        <Button variant="secondary" onClick={() => restoreStudent(entry)}>
                          Restore
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty-state student-list-empty">
              <Icon name="userMinus" />
              <strong>No dropped students</strong>
              <span>Students removed from this class who have coursework will appear here.</span>
            </div>
          )}
        </div>
      )}

      {removalModal ? (
        <Modal
          title={removalModal.recordCount === 0 ? "Remove from Student List" : "Move to Drop List"}
          onClose={() => setRemovalModal(null)}
        >
          <div className="p-4 space-y-4">
            {removalModal.loading ? (
              <p>Checking student records…</p>
            ) : removalModal.recordCount === 0 ? (
              <p>
                <em>{removalModal.row.name}</em> has no records and will be removed from this class.
              </p>
            ) : (
              <p>
                <em>{removalModal.row.name}</em> has {removalModal.recordCount} {removalModal.recordCount === 1 ? "record" : "records"} and will be moved to the Drop List; their records are kept.
              </p>
            )}
            <div className="form-actions flex justify-end gap-2 pt-2">
              <Button variant="secondary" onClick={() => setRemovalModal(null)} autoFocus>
                Cancel
              </Button>
              <Button
                variant="destructive"
                disabled={removalModal.loading || removing}
                onClick={executeRemoval}
              >
                {removing
                  ? "Processing…"
                  : removalModal.recordCount === 0
                  ? "Remove"
                  : "Move to Drop List"}
              </Button>
            </div>
          </div>
        </Modal>
      ) : null}
    </section>
  );
}
