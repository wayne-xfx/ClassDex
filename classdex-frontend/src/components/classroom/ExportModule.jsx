import { useState, useEffect } from "react";
import Icon from "../Icon";
import { Button, Card } from "../DesignSystem";
import { ModuleHeader } from "./ClassShell";
import { api } from "../../api";

export default function ExportModule({
  classRecord,
  exportCounts: initialExportCounts,
  students = [],
  pendingEnrollments = [],
  onExcel,
  onCsv,
}) {
  const [counts, setCounts] = useState(
    initialExportCounts || classRecord?.exportCounts || null
  );
  const [selected, setSelected] = useState(
    new Set([
      "overview",
      "students",
      "attendance",
      "recitation",
      "activities",
      "projects",
      "quizzes",
    ])
  );
  const [format, setFormat] = useState("xlsx");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (initialExportCounts) {
      setCounts(initialExportCounts);
    } else if (classRecord?.exportCounts) {
      setCounts(classRecord.exportCounts);
    } else if (classRecord?.id && !counts) {
      api
        .exportSummary(classRecord.id)
        .then((data) => setCounts(data))
        .catch((err) => {
          console.error("Could not load export counts:", err);
        });
    }
  }, [classRecord?.id, classRecord?.exportCounts, initialExportCounts, counts]);

  const approvedCount = students.length;
  const pendingCount = pendingEnrollments.length;

  const N = counts?.students ?? approvedCount;
  const S = counts?.sessions ?? 0;
  const R = counts?.recitations ?? 0;
  const A = counts?.activities ?? 0;
  const P = counts?.projectScores ?? 0;
  const Q = counts?.quizzes ?? 0;

  const RECORD_TYPES = [
    {
      key: "overview",
      label: "Class Information",
      icon: "book",
      subtitle: "Section & schedule metadata",
    },
    {
      key: "students",
      label: "Student List",
      icon: "users",
      subtitle: `${N} approved student${N === 1 ? "" : "s"}`,
    },
    {
      key: "attendance",
      label: "Attendance Logs",
      icon: "clipboardCheck",
      subtitle: `${S} session${S === 1 ? "" : "s"}`,
    },
    {
      key: "recitation",
      label: "Recitation",
      icon: "mic",
      subtitle: `${R} call${R === 1 ? "" : "s"} logged`,
    },
    {
      key: "activities",
      label: "Activities",
      icon: "listChecks",
      subtitle: `${A} activit${A === 1 ? "y" : "ies"}`,
    },
    {
      key: "projects",
      label: "Projects",
      icon: "folderKanban",
      subtitle: `2 term projects (${P} scored)`,
    },
    {
      key: "quizzes",
      label: "Quiz",
      icon: "brain",
      subtitle: `${Q} quizz${Q === 1 ? "" : "es"}`,
    },
  ];

  function toggleType(key) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function selectAll() {
    setSelected(new Set(RECORD_TYPES.map((t) => t.key)));
  }

  function selectNone() {
    setSelected(new Set());
  }

  async function handleExport() {
    if (!selected.size) return;
    setBusy(true);
    try {
      const types = [...selected];
      if (format === "xlsx") await onExcel?.(types);
      else await onCsv?.(types);
    } finally {
      setBusy(false);
    }
  }

  const noneSelected = selected.size === 0;
  const allSelected = selected.size === RECORD_TYPES.length;

  return (
    <div className="export-module">
      <ModuleHeader
        title="Export class data"
        subtitle="Choose which record types to include, select a format, then click Export."
      />

      {/* 1. Single inline summary strip */}
      <div className="export-summary-strip" role="status">
        <span className="export-summary-chip">
          <Icon name="users" size={15} />
          <span>
            <strong>{approvedCount}</strong>{" "}
            {approvedCount === 1 ? "approved student" : "approved students"}
          </span>
        </span>
        <span className="export-summary-divider" aria-hidden="true">
          ·
        </span>
        <span className="export-summary-chip">
          <Icon name="userCheck" size={15} />
          <span>
            <strong>{pendingCount}</strong>{" "}
            {pendingCount === 1 ? "pending request" : "pending requests"}
          </span>
        </span>
      </div>

      {approvedCount === 0 ? (
        <div className="notice notice-warm mb-5" role="status">
          <Icon name="info" />
          <span>
            No approved students are in this class yet. You can still export
            class information now, or add students to your Student List so their
            records appear in exports.
          </span>
        </div>
      ) : null}

      <Card className="export-config-card">
        {/* 2. Record types header with Select all / None */}
        <div className="export-section-header">
          <div>
            <h3 className="export-section-title">Record types</h3>
            <p className="export-section-desc">
              Select datasets to include in the export file
            </p>
          </div>
          <div className="export-quick-actions">
            <button
              type="button"
              className="export-link-btn"
              onClick={selectAll}
              disabled={allSelected}
            >
              Select all
            </button>
            <span aria-hidden="true" className="export-link-divider">
              ·
            </span>
            <button
              type="button"
              className="export-link-btn"
              onClick={selectNone}
              disabled={noneSelected}
            >
              None
            </button>
          </div>
        </div>

        {/* 2-column selectable cards grid */}
        <div className="export-type-grid" role="group" aria-label="Record types">
          {RECORD_TYPES.map(({ key, label, icon, subtitle }) => {
            const isChecked = selected.has(key);
            return (
              <button
                key={key}
                type="button"
                role="checkbox"
                aria-checked={isChecked}
                className={`export-type-card ${isChecked ? "is-selected" : ""}`}
                onClick={() => toggleType(key)}
              >
                <div
                  className={`export-checkbox-indicator ${
                    isChecked ? "is-checked" : ""
                  }`}
                  aria-hidden="true"
                >
                  {isChecked ? <Icon name="check" size={13} /> : null}
                </div>
                <div className="export-type-icon-wrapper" aria-hidden="true">
                  <Icon name={icon} size={18} />
                </div>
                <div className="export-type-info">
                  <span className="export-type-title">{label}</span>
                  <span className="export-type-count">{subtitle}</span>
                </div>
              </button>
            );
          })}
        </div>

        {/* 3. Segmented format control (.xlsx | .csv) */}
        <div className="export-format-wrapper">
          <label className="export-format-heading" id="export-format-label">
            Export format
          </label>
          <div
            className="export-format-segmented"
            role="radiogroup"
            aria-labelledby="export-format-label"
          >
            <button
              type="button"
              role="radio"
              aria-checked={format === "xlsx"}
              className={`export-format-tab ${
                format === "xlsx" ? "is-active" : ""
              }`}
              onClick={() => setFormat("xlsx")}
            >
              <Icon name="spreadsheet" size={16} />
              <span>Excel (.xlsx)</span>
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={format === "csv"}
              className={`export-format-tab ${
                format === "csv" ? "is-active" : ""
              }`}
              onClick={() => setFormat("csv")}
            >
              <Icon name="exportSheet" size={16} />
              <span>CSV (.csv)</span>
            </button>
          </div>
          <p className="export-format-hint">
            {format === "xlsx"
              ? "Styled Excel workbook with a separate sheet tab for each selected record type."
              : "UTF-8 flat text file stacking each selected section separated by blank lines."}
          </p>
        </div>

        {/* 4. Clean export footer */}
        <div className="export-footer">
          <div className="export-footer-action-group">
            <Button
              variant="primary"
              disabled={
                noneSelected ||
                busy ||
                (!onExcel && format === "xlsx") ||
                (!onCsv && format === "csv")
              }
              onClick={handleExport}
              title={
                noneSelected
                  ? "Select at least one record type to export"
                  : undefined
              }
              aria-describedby={
                noneSelected ? "export-disabled-hint" : undefined
              }
              className="export-submit-button"
            >
              {busy ? (
                <>
                  <Icon name="refresh" className="animate-spin" size={16} />
                  <span>Exporting…</span>
                </>
              ) : (
                <>
                  <Icon name="download" size={16} />
                  <span>
                    Export {selected.size}{" "}
                    {selected.size === 1 ? "section" : "sections"} as .{format}
                  </span>
                </>
              )}
            </Button>

            {noneSelected && (
              <p
                id="export-disabled-hint"
                className="export-disabled-hint"
                role="alert"
              >
                <Icon name="info" size={14} />
                <span>Select at least one record type to export</span>
              </p>
            )}
          </div>
        </div>
      </Card>
    </div>
  );
}
