import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import Avatar from "../Avatar";
import Icon from "../Icon";
import { Button, Modal } from "../DesignSystem";
import { api } from "../../api";
import ModuleSkeleton from "./ModuleSkeleton";
import { ModuleHeader } from "./ClassShell";
import { formatStudentDisplayName, formatStudentName } from "./studentNames";
import {
  buildTemplateFilename,
  normalizeWhitespace,
  parseLines,
  validateNewStudentEntry,
  validateRows,
} from "./studentListValidation";

export default function StudentListManager({
  classId,
  classRecord,
  onClose,
  onCountChange,
  onAutoApproved,
  onRosterChanged,
  onDirtyChange,
  tabCache,
  readOnly = false,
}) {
  const [searchParams] = useSearchParams();
  const focusStudent = searchParams.get("focusStudent") || "";

  const cachedRoster = tabCache?.get(`roster:${classId}`);
  const [activeTab, setActiveTab] = useState("active"); // "active" | "dropList"
  const [rows, setRows] = useState(cachedRoster || []);
  const [savedRoster, setSavedRoster] = useState(cachedRoster || []);
  const initialRosterRef = useRef(cachedRoster ? JSON.stringify(cachedRoster) : "");
  const [dropList, setDropList] = useState([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [name, setName] = useState("");
  const [studentId, setStudentId] = useState("");
  const [entryError, setEntryError] = useState({ field: null, message: "" });
  const [pasteValue, setPasteValue] = useState("");
  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [loading, setLoading] = useState(!cachedRoster);
  const [dropLoading, setDropLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [removalModal, setRemovalModal] = useState(null); // { row, index, loading, recordCount }
  const [removing, setRemoving] = useState(false);
  const [restoringIds, setRestoringIds] = useState([]);

  const mountedRef = useRef(true);
  const rosterReqIdRef = useRef(0);
  const dropReqIdRef = useRef(0);
  const localDirtyMutationRef = useRef(false);

  // Drop list sorting state
  const [dropSortField, setDropSortField] = useState("droppedAt"); // "name" | "studentId" | "droppedAt" | "recordCount"
  const [dropSortOrder, setDropSortOrder] = useState("desc"); // "asc" | "desc"

  const savedById = useMemo(
    () =>
      new Map(
        savedRoster
          .filter((r) => r.id)
          .map((r) => [
            r.id,
            {
              name: normalizeWhitespace(r.name),
              studentId: String(r.studentId || "").trim(),
            },
          ]),
      ),
    [savedRoster],
  );

  const droppedIds = useMemo(
    () =>
      new Set(
        dropList
          .map((entry) => String(entry.studentId || "").trim())
          .filter(Boolean),
      ),
    [dropList],
  );

  const checkedRows = useMemo(
    () => validateRows(rows, { savedById, droppedIds }),
    [rows, savedById, droppedIds],
  );
  const invalidCount = checkedRows.filter((row) => row.errors.length > 0).length;
  const unsavedCount = checkedRows.filter(
    (row) => row.status === "unsaved-new" || row.status === "unsaved-edited",
  ).length;

  // Unsaved changes detection
  const isDirty = useMemo(() => {
    if (readOnly || activeTab !== "active") return false;
    if (!initialRosterRef.current) return rows.length > 0;
    const currentSimplified = rows.map((r) => ({
      name: normalizeWhitespace(r.name),
      studentId: String(r.studentId || "").trim(),
    }));
    try {
      const initialParsed = JSON.parse(initialRosterRef.current).map((r) => ({
        name: normalizeWhitespace(r.name),
        studentId: String(r.studentId || "").trim(),
      }));
      return JSON.stringify(currentSimplified) !== JSON.stringify(initialParsed);
    } catch {
      return false;
    }
  }, [activeTab, readOnly, rows]);

  useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);

  // Window beforeunload guard
  useEffect(() => {
    if (!isDirty) return;
    function handleBeforeUnload(e) {
      e.preventDefault();
      e.returnValue = "";
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isDirty]);

  const loadRoster = useCallback(() => {
    const reqId = ++rosterReqIdRef.current;
    return api
      .classRoster(classId)
      .then(({ roster }) => {
        if (!mountedRef.current || reqId !== rosterReqIdRef.current) return;
        const mapped = roster.map((entry) => ({
          id: entry.id,
          name: entry.studentName,
          studentId: entry.studentId,
          photo: entry.photo || entry.photoUrl || "",
        }));
        initialRosterRef.current = JSON.stringify(mapped);
        tabCache?.set(`roster:${classId}`, mapped);
        setSavedRoster(mapped);
        setRows((currentRows) => {
          if (!localDirtyMutationRef.current) return mapped;
          const currentById = new Map(
            currentRows.filter((row) => row.id).map((row) => [row.id, row]),
          );
          const unsavedRows = currentRows.filter((row) => !row.id);
          const mergedSaved = mapped.map((entry) => {
            const local = currentById.get(entry.id);
            return local
              ? { ...entry, name: local.name, studentId: local.studentId }
              : entry;
          });
          return [...mergedSaved, ...unsavedRows];
        });
        onCountChange?.(roster.length);
      })
      .catch((error) => {
        if (!mountedRef.current || reqId !== rosterReqIdRef.current) return;
        setMessage("");
        setErrorMessage(error.message);
      })
      .finally(() => {
        if (mountedRef.current && reqId === rosterReqIdRef.current) {
          setLoading(false);
        }
      });
  }, [classId, onCountChange, tabCache]);

  const loadDropList = useCallback(() => {
    const reqId = ++dropReqIdRef.current;
    setDropLoading(true);
    return api
      .dropList(classId)
      .then(({ dropList: list }) => {
        if (!mountedRef.current || reqId !== dropReqIdRef.current) return;
        setDropList(list || []);
      })
      .catch((error) => {
        if (!mountedRef.current || reqId !== dropReqIdRef.current) return;
        setMessage("");
        setErrorMessage(error.message);
      })
      .finally(() => {
        if (mountedRef.current && reqId === dropReqIdRef.current) {
          setDropLoading(false);
        }
      });
  }, [classId]);

  useEffect(() => {
    mountedRef.current = true;
    loadRoster();
    loadDropList();
    return () => {
      mountedRef.current = false;
      rosterReqIdRef.current += 1;
      dropReqIdRef.current += 1;
    };
  }, [loadRoster, loadDropList]);

  // Consume focusStudent query parameter
  useEffect(() => {
    if (!focusStudent) return;
    setSearchTerm(focusStudent);
    // If student is in drop list, switch to drop list tab
    const inDropList = dropList.some(
      (d) =>
        d.studentId === focusStudent ||
        d.id === focusStudent ||
        d.studentName.toLowerCase().includes(focusStudent.toLowerCase()),
    );
    if (inDropList) {
      setActiveTab("dropList");
    } else {
      setActiveTab("active");
    }
  }, [focusStudent, dropList]);

  function handleClose() {
    if (isDirty) {
      const confirmLeave = window.confirm(
        "You have unsaved changes in the student list. Are you sure you want to leave without saving?",
      );
      if (!confirmLeave) return;
    }
    onClose?.();
  }

  function addRow(event) {
    event.preventDefault();
    const validation = validateNewStudentEntry(
      { name, studentId },
      { existingRows: rows, droppedIds },
    );
    if (!validation.valid) {
      setEntryError({ field: validation.field, message: validation.message });
      return;
    }
    setEntryError({ field: null, message: "" });
    setMessage("");
    setErrorMessage("");
    localDirtyMutationRef.current = true;
    setRows((current) => [...current, validation.entry]);
    setName("");
    setStudentId("");
  }

  function updateRow(index, field, value) {
    setMessage("");
    localDirtyMutationRef.current = true;
    setRows((current) =>
      current.map((row, rowIndex) => (rowIndex === index ? { ...row, [field]: value } : row)),
    );
  }

  function normalizeRowName(index) {
    setRows((current) =>
      current.map((row, rowIndex) => {
        if (rowIndex !== index) return row;
        const normalized = normalizeWhitespace(row.name);
        if (normalized !== row.name) {
          localDirtyMutationRef.current = true;
          return { ...row, name: normalized };
        }
        return row;
      }),
    );
  }

  function revertRow(index) {
    setRows((current) =>
      current.map((row, rowIndex) => {
        if (rowIndex !== index || !row.id) return row;
        const saved = savedById.get(row.id);
        if (!saved) return row;
        return { ...row, name: saved.name, studentId: saved.studentId };
      }),
    );
  }

  function importPasted() {
    const parsed = parseLines(pasteValue);
    if (!parsed.length) return;
    localDirtyMutationRef.current = true;
    setRows((current) => [...current, ...parsed]);
    setPasteValue("");
    setErrorMessage("");
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
        if (!mountedRef.current) return;
        if (res.rows?.length) {
          localDirtyMutationRef.current = true;
          setRows((current) => [
            ...current,
            ...res.rows.map((r) => ({ name: r.studentName, studentId: r.studentId, photo: "" })),
          ]);
          let msg = `Imported ${res.rows.length} rows from ${file.name}. Review validation before saving.`;
          if (res.warnings?.length) {
            msg += ` (${res.warnings.join("; ")})`;
          }
          setErrorMessage("");
          setMessage(msg);
        }
      } catch (err) {
        setMessage("");
        setErrorMessage(err.message);
      }
    };
    reader.readAsDataURL(file);
    event.target.value = "";
  }

  async function downloadTemplate() {
    try {
      setErrorMessage("");
      const blob = await api.downloadRosterTemplate(classId);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = buildTemplateFilename(classRecord);
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err) {
      setMessage("");
      setErrorMessage(err.message);
    }
  }

  async function saveStudentList() {
    setSaving(true);
    setErrorMessage("");
    rosterReqIdRef.current += 1;
    try {
      const { roster, autoApprovedCount = 0 } = await api.saveClassRoster(
        classId,
        checkedRows.map((row) => ({
          studentName: normalizeWhitespace(row.name),
          studentId: String(row.studentId || "").trim(),
        })),
      );
      const mapped = roster.map((entry) => ({
        id: entry.id,
        name: entry.studentName,
        studentId: entry.studentId,
        photo: entry.photo || entry.photoUrl || "",
      }));
      localDirtyMutationRef.current = false;
      initialRosterRef.current = JSON.stringify(mapped);
      tabCache?.set(`roster:${classId}`, mapped);
      setSavedRoster(mapped);
      setRows(mapped);
      onCountChange?.(roster.length);
      setMessage(
        autoApprovedCount
          ? `Student list saved. ${autoApprovedCount} pending ${autoApprovedCount === 1 ? "request was" : "requests were"} auto approved; review the notification and mark it as read when ready.`
          : "Student list saved.",
      );
      if (autoApprovedCount) onAutoApproved?.();
    } catch (error) {
      setMessage("");
      setErrorMessage(error.message);
    } finally {
      setSaving(false);
    }
  }

  async function loadRemovalImpact(row, index) {
    setRemovalModal({ row, index, loading: true, recordCount: null, error: "" });
    try {
      const { recordCount = 0 } = await api.rosterImpact(classId, row.id);
      setRemovalModal((current) =>
        current && current.row.id === row.id
          ? { ...current, loading: false, recordCount, error: "" }
          : current,
      );
    } catch (error) {
      setRemovalModal((current) =>
        current && current.row.id === row.id
          ? {
              ...current,
              loading: false,
              recordCount: null,
              error: error.message || "Unable to calculate removal impact.",
            }
          : current,
      );
    }
  }

  async function promptRemoveRow(index) {
    const row = rows[index];
    if (!row.id) {
      localDirtyMutationRef.current = true;
      setRows((current) => current.filter((_, rowIndex) => rowIndex !== index));
      return;
    }
    await loadRemovalImpact(row, index);
  }

  async function executeRemoval() {
    if (!removalModal || removalModal.loading || removalModal.error) return;
    const { row, index } = removalModal;
    setRemoving(true);
    setErrorMessage("");
    try {
      rosterReqIdRef.current += 1;
      const outcome = await api.deleteClassRosterEntry(classId, row.id);
      tabCache?.invalidate();
      const nextRows = rows.filter((_, rowIndex) => rowIndex !== index);
      const nextSaved = savedRoster.filter((entry) => entry.id !== row.id);
      initialRosterRef.current = JSON.stringify(nextSaved);
      setSavedRoster(nextSaved);
      setRows(nextRows);
      onCountChange?.(nextRows.length);
      setMessage(
        outcome.result === "dropped"
          ? `${row.name} was moved to the Drop List (${outcome.recordCount} records preserved).`
          : `${row.name} was removed from the student list.`,
      );
      setRemovalModal(null);
      await Promise.all([loadDropList(), Promise.resolve(onRosterChanged?.())]);
    } catch (error) {
      setMessage("");
      setErrorMessage(error.message);
    } finally {
      setRemoving(false);
    }
  }

  async function restoreStudent(entry) {
    if (restoringIds.includes(entry.id)) return;
    setErrorMessage("");
    setRestoringIds((current) => [...current, entry.id]);
    try {
      await api.restoreDroppedStudent(classId, entry.id);
      tabCache?.invalidate();
      setMessage(`${entry.studentName} was restored to the active student list.`);
      await Promise.all([loadRoster(), loadDropList(), Promise.resolve(onRosterChanged?.())]);
    } catch (error) {
      setMessage("");
      setErrorMessage(error.message);
    } finally {
      setRestoringIds((current) => current.filter((itemId) => itemId !== entry.id));
    }
  }

  // Filtered rows for active roster
  const filteredRowsWithIndices = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return checkedRows
      .map((row, index) => ({ row, index }))
      .filter(({ row }) => {
        if (!q) return true;
        const statusText = readOnly ? "read-only" : row.statusLabel;
        return (
          row.name.toLowerCase().includes(q) ||
          row.studentId.includes(q) ||
          statusText.toLowerCase().includes(q)
        );
      });
  }, [checkedRows, readOnly, searchTerm]);

  // Sort & filter drop list
  const filteredAndSortedDropList = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    let list = dropList;
    if (q) {
      list = list.filter((entry) => {
        const droppedDateStr = entry.droppedAt
          ? new Date(entry.droppedAt).toLocaleDateString().toLowerCase()
          : "";
        return (
          entry.studentName.toLowerCase().includes(q) ||
          entry.studentId.includes(q) ||
          droppedDateStr.includes(q) ||
          String(entry.recordCount).includes(q)
        );
      });
    }

    return [...list].sort((a, b) => {
      let valA, valB;
      if (dropSortField === "name") {
        valA = (a.studentName || "").toLowerCase();
        valB = (b.studentName || "").toLowerCase();
      } else if (dropSortField === "studentId") {
        valA = a.studentId || "";
        valB = b.studentId || "";
      } else if (dropSortField === "recordCount") {
        valA = a.recordCount || 0;
        valB = b.recordCount || 0;
      } else {
        valA = a.droppedAt ? new Date(a.droppedAt).getTime() : 0;
        valB = b.droppedAt ? new Date(b.droppedAt).getTime() : 0;
      }

      if (valA < valB) return dropSortOrder === "asc" ? -1 : 1;
      if (valA > valB) return dropSortOrder === "asc" ? 1 : -1;
      return 0;
    });
  }, [dropList, dropSortField, dropSortOrder, searchTerm]);

  function handleDropSort(field) {
    if (dropSortField === field) {
      setDropSortOrder((order) => (order === "asc" ? "desc" : "asc"));
    } else {
      setDropSortField(field);
      setDropSortOrder(field === "name" || field === "studentId" ? "asc" : "desc");
    }
  }

  return (
    <section className="panel student-list-manager" aria-labelledby="student-list-manager-title">
      <ModuleHeader
        titleId="student-list-manager-title"
        title={readOnly ? "View the students in this class" : "Manage the students in this class"}
        subtitle={
          readOnly
            ? "This class is archived. View the student list and drop list in read-only mode."
            : "Use the student list to automatically recognize join requests and maintain official class enrollment."
        }
        actions={
          <button type="button" className="button button-quiet" onClick={handleClose}>
            Close
          </button>
        }
      />

      <div className="flex items-center justify-between flex-wrap gap-3 border-b border-slate-200 dark:border-slate-800 pb-3 mt-4">
        <div className="flex gap-2" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "active"}
            className={`button ${activeTab === "active" ? "button-primary" : "button-quiet"}`}
            onClick={() => setActiveTab("active")}
          >
            <Icon name="users" size={16} /> Student List ({rows.length})
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "dropList"}
            className={`button ${activeTab === "dropList" ? "button-primary" : "button-quiet"}`}
            onClick={() => setActiveTab("dropList")}
          >
            <Icon name="userMinus" size={16} /> Drop List ({dropList.length})
          </button>
        </div>

        {/* Instant Search Bar */}
        <label className="student-list-search-bar">
          <Icon name="search" size={16} className="text-muted" />
          <input
            type="search"
            placeholder="Search name, ID, or status…"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
          {searchTerm ? (
            <button
              type="button"
              className="student-list-search-clear"
              onClick={() => setSearchTerm("")}
              aria-label="Clear search"
            >
              <Icon name="x" size={13} />
            </button>
          ) : null}
        </label>
      </div>

      {errorMessage ? <p className="notice notice-error mt-3" role="alert">{errorMessage}</p> : null}
      {message ? <p className="notice notice-success mt-3" role="status">{message}</p> : null}

      {activeTab === "active" ? (
        <>
          {!readOnly ? (
            <>
              {!loading && rows.length === 0 ? (
                <div className="student-list-warning notice notice-warning">
                  <Icon name="info" />
                  <span>You haven't added a student list yet. Join requests that don't match a list entry will need your manual approval.</span>
                </div>
              ) : null}
              <div className="student-list-input-grid">
                <div>
                  <form className="student-list-entry-form" onSubmit={addRow} noValidate>
                    <label className="field">
                      <span>Student name</span>
                      <input
                        className={`input ${entryError.field === "name" ? "input-invalid" : ""}`}
                        value={name}
                        onChange={(event) => {
                          setName(event.target.value);
                          if (entryError.message) setEntryError({ field: null, message: "" });
                        }}
                        placeholder="e.g., Juan Dela Cruz"
                        aria-invalid={entryError.field === "name" ? "true" : undefined}
                      />
                    </label>
                    <label className="field">
                      <span>7-digit student ID</span>
                      <input
                        className={`input ${entryError.field === "studentId" ? "input-invalid" : ""}`}
                        inputMode="numeric"
                        maxLength={7}
                        value={studentId}
                        onChange={(event) => {
                          setStudentId(event.target.value.replace(/\D/g, "").slice(0, 7));
                          if (entryError.message) setEntryError({ field: null, message: "" });
                        }}
                        placeholder="2300039"
                        aria-invalid={entryError.field === "studentId" ? "true" : undefined}
                      />
                    </label>
                    <button type="submit" className="button button-secondary">
                      <Icon name="plus" /> Add student
                    </button>
                  </form>
                  {entryError.message ? (
                    <p className="student-list-entry-error" role="alert">
                      {entryError.message}
                    </p>
                  ) : null}
                </div>
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
            </>
          ) : null}

          <div className="student-list-preview-heading">
            <div>
              <h3>
                {readOnly || (!isDirty && !invalidCount) ? "Student list" : "Student list preview"}
              </h3>
              <span>
                {filteredRowsWithIndices.length} {filteredRowsWithIndices.length === 1 ? "row" : "rows"}
                {searchTerm ? ` (filtered from ${rows.length})` : ""}
                {!readOnly && invalidCount
                  ? ` · ${invalidCount} need${invalidCount === 1 ? "s" : ""} attention`
                  : !readOnly && unsavedCount
                  ? ` · ${unsavedCount} unsaved ${unsavedCount === 1 ? "change" : "changes"}`
                  : !readOnly && rows.length
                  ? " · All changes saved"
                  : ""}
              </span>
            </div>
            {!readOnly ? (
              <button
                type="button"
                className="button button-primary"
                onClick={saveStudentList}
                disabled={saving || !rows.length || Boolean(invalidCount) || !isDirty}
              >
                {saving
                  ? "Saving…"
                  : !isDirty && !invalidCount && rows.length
                  ? "Saved"
                  : "Save student list"}
              </button>
            ) : null}
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
                    <th>{readOnly ? "Status" : "Validation"}</th>
                    {!readOnly ? <th><span className="sr-only">Actions</span></th> : null}
                  </tr>
                </thead>
                <tbody>
                  {filteredRowsWithIndices.map(({ row, index }) => {
                    const isFocused =
                      Boolean(focusStudent) &&
                      (row.studentId === focusStudent ||
                        row.id === focusStudent ||
                        row.name.toLowerCase().includes(focusStudent.toLowerCase()));

                    return (
                      <tr
                        key={row.id || `draft-${index}`}
                        className={isFocused ? "is-focused-student-row" : ""}
                        ref={(el) => {
                          if (el && isFocused) {
                            el.scrollIntoView({ behavior: "smooth", block: "center" });
                          }
                        }}
                      >
                        <td>
                          <div className="student-list-name-cell">
                            <Avatar src={row.photo} name={row.name} size="sm" className="student-list-avatar" />
                            <input
                              className={`input ${!readOnly && row.nameError ? "input-invalid" : ""}`}
                              value={row.name}
                              disabled={readOnly}
                              aria-invalid={!readOnly && row.nameError ? "true" : undefined}
                              onChange={(event) => updateRow(index, "name", event.target.value)}
                              onBlur={() => normalizeRowName(index)}
                            />
                          </div>
                        </td>
                        <td>
                          <input
                            className={`input ${!readOnly && row.idError ? "input-invalid" : ""}`}
                            inputMode="numeric"
                            maxLength={7}
                            value={row.studentId}
                            disabled={readOnly}
                            aria-invalid={!readOnly && row.idError ? "true" : undefined}
                            onChange={(event) =>
                              updateRow(index, "studentId", event.target.value.replace(/\D/g, "").slice(0, 7))
                            }
                          />
                        </td>
                        <td>
                          {readOnly ? (
                            <span className="student-list-row-valid">Read-only</span>
                          ) : row.status === "invalid" ? (
                            <div className="student-list-status-cell">
                              <span className="student-list-row-error">{row.statusLabel}</span>
                              {row.id && row.isModified ? (
                                <button
                                  type="button"
                                  className="student-list-undo-btn"
                                  onClick={() => revertRow(index)}
                                >
                                  Undo
                                </button>
                              ) : null}
                            </div>
                          ) : row.status === "unsaved-new" || row.status === "unsaved-edited" ? (
                            <div className="student-list-status-cell">
                              <span className="student-list-row-pending">{row.statusLabel}</span>
                              {row.status === "unsaved-edited" ? (
                                <button
                                  type="button"
                                  className="student-list-undo-btn"
                                  onClick={() => revertRow(index)}
                                >
                                  Undo
                                </button>
                              ) : null}
                            </div>
                          ) : (
                            <span className="student-list-row-valid">{row.statusLabel}</span>
                          )}
                        </td>
                        {!readOnly ? (
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
                        ) : null}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty-state student-list-empty">
              <Icon name="users" />
              <strong>Your student list is empty</strong>
              <span>
                {readOnly
                  ? "No students were added to this student list."
                  : "Add students above, paste a class list, or import an Excel/CSV file to begin."}
              </span>
            </div>
          )}
        </>
      ) : (
        <div className="drop-list-view mt-4">
          <div className="student-list-preview-heading">
            <div>
              <h3>Drop List</h3>
              <span>
                {filteredAndSortedDropList.length} dropped {filteredAndSortedDropList.length === 1 ? "student" : "students"} with recorded coursework
                {searchTerm ? ` (filtered from ${dropList.length})` : ""}
              </span>
            </div>
          </div>
          {dropLoading && !dropList.length ? (
            <ModuleSkeleton aria-label="Loading drop list" />
          ) : dropList.length ? (
            <div className="student-list-table-wrap">
              <table className="student-list-table">
                <thead>
                  <tr>
                    <th>
                      <button
                        type="button"
                        className="drop-list-sort-btn"
                        onClick={() => handleDropSort("name")}
                      >
                        <span>Name</span>
                        {dropSortField === "name" ? (
                          <span aria-hidden="true">{dropSortOrder === "asc" ? "▲" : "▼"}</span>
                        ) : null}
                      </button>
                    </th>
                    <th>
                      <button
                        type="button"
                        className="drop-list-sort-btn"
                        onClick={() => handleDropSort("studentId")}
                      >
                        <span>Student ID</span>
                        {dropSortField === "studentId" ? (
                          <span aria-hidden="true">{dropSortOrder === "asc" ? "▲" : "▼"}</span>
                        ) : null}
                      </button>
                    </th>
                    <th>
                      <button
                        type="button"
                        className="drop-list-sort-btn"
                        onClick={() => handleDropSort("droppedAt")}
                      >
                        <span>Dropped Date</span>
                        {dropSortField === "droppedAt" ? (
                          <span aria-hidden="true">{dropSortOrder === "asc" ? "▲" : "▼"}</span>
                        ) : null}
                      </button>
                    </th>
                    <th>
                      <button
                        type="button"
                        className="drop-list-sort-btn"
                        onClick={() => handleDropSort("recordCount")}
                      >
                        <span>Coursework Records</span>
                        {dropSortField === "recordCount" ? (
                          <span aria-hidden="true">{dropSortOrder === "asc" ? "▲" : "▼"}</span>
                        ) : null}
                      </button>
                    </th>
                    {!readOnly ? <th>Action</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {filteredAndSortedDropList.map((entry) => {
                    const isFocused =
                      Boolean(focusStudent) &&
                      (entry.studentId === focusStudent ||
                        entry.id === focusStudent ||
                        entry.studentName.toLowerCase().includes(focusStudent.toLowerCase()));

                    return (
                      <tr
                        key={entry.id}
                        className={isFocused ? "is-focused-student-row" : ""}
                        ref={(el) => {
                          if (el && isFocused) {
                            el.scrollIntoView({ behavior: "smooth", block: "center" });
                          }
                        }}
                      >
                        <td>
                          <div className="student-list-name-cell">
                            <Avatar src={entry.photo} name={entry.studentName} size="sm" className="student-list-avatar" />
                            <span>
                              {formatStudentDisplayName(entry.studentName, entry) ||
                                formatStudentName(entry.studentName, entry)}
                            </span>
                          </div>
                        </td>
                        <td>{entry.studentId}</td>
                        <td>
                          {entry.droppedAt
                            ? new Intl.DateTimeFormat("en-US", {
                                month: "short",
                                day: "numeric",
                                year: "numeric",
                              }).format(new Date(entry.droppedAt))
                            : "—"}
                        </td>
                        <td>{entry.recordCount} {entry.recordCount === 1 ? "record" : "records"}</td>
                        {!readOnly ? (
                          <td>
                            <Button
                              variant="secondary"
                              disabled={restoringIds.includes(entry.id)}
                              onClick={() => restoreStudent(entry)}
                            >
                              {restoringIds.includes(entry.id) ? "Restoring…" : "Restore"}
                            </Button>
                          </td>
                        ) : null}
                      </tr>
                    );
                  })}
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
          title={
            removalModal.loading || removalModal.error
              ? "Remove Student"
              : removalModal.recordCount === 0
              ? "Remove from Student List"
              : "Move to Drop List"
          }
          onClose={() => setRemovalModal(null)}
        >
          <div className="p-4 space-y-4">
            {removalModal.loading ? (
              <p>Checking student records…</p>
            ) : removalModal.error ? (
              <div className="notice notice-error" role="alert" style={{ alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", margin: 0 }}>
                <span>{removalModal.error}</span>
                <Button variant="secondary" onClick={() => loadRemovalImpact(removalModal.row, removalModal.index)}>
                  Retry
                </Button>
              </div>
            ) : removalModal.recordCount === 0 ? (
              <div className="space-y-2">
                <p>
                  <strong>{removalModal.row.name}</strong> (ID: {removalModal.row.studentId}) has{" "}
                  <strong>no recorded coursework</strong> in this class.
                </p>
                <p className="text-sm text-slate-500">
                  They will be permanently removed from this class roster and un-enrolled.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                <p>
                  <strong>{removalModal.row.name}</strong> (ID: {removalModal.row.studentId}) has{" "}
                  <strong>
                    {removalModal.recordCount} {removalModal.recordCount === 1 ? "coursework record" : "coursework records"}
                  </strong>{" "}
                  (attendance, recitations, activities, projects, or quizzes).
                </p>
                <p className="text-sm text-slate-500">
                  To preserve historical records and transcripts, they will be moved to the <strong>Drop List</strong>. You can restore them at any time.
                </p>
              </div>
            )}
            <div className="form-actions flex justify-end gap-2 pt-2">
              <Button variant="secondary" onClick={() => setRemovalModal(null)} autoFocus>
                Cancel
              </Button>
              <Button
                variant="destructive"
                disabled={removalModal.loading || Boolean(removalModal.error) || removing}
                onClick={executeRemoval}
              >
                {removing
                  ? "Processing…"
                  : removalModal.loading || removalModal.error || removalModal.recordCount === 0
                  ? "Remove from list"
                  : "Move to Drop List"}
              </Button>
            </div>
          </div>
        </Modal>
      ) : null}
    </section>
  );
}
