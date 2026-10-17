import { useState } from "react";
import Icon from "../Icon";
import { Badge, Button, Card, PageHeader } from "../DesignSystem";

const RECORD_TYPES = [
  { key: "overview", label: "Class Information" },
  { key: "students", label: "Student List" },
  { key: "attendance", label: "Attendance Logs" },
  { key: "recitation", label: "Recitation" },
  { key: "activities", label: "Activities" },
  { key: "projects", label: "Projects" },
  { key: "quizzes", label: "Quiz" },
];

export default function ExportModule({ classRecord, students = [], pendingEnrollments = [], onExcel, onCsv }) {
  const [selected, setSelected] = useState(new Set(RECORD_TYPES.map((t) => t.key)));
  const [format, setFormat] = useState("xlsx");
  const [busy, setBusy] = useState(false);

  const allSelected = selected.size === RECORD_TYPES.length;

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(RECORD_TYPES.map((t) => t.key)));
  }

  function toggleType(key) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
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

  return (
    <div className="export-module">
      <PageHeader
        eyebrow="Data export"
        icon="spreadsheet"
        title="Export class data"
        description="Choose which record types to include, select a format, then click Export."
      />

      <div className="export-summary-grid">
        <Card className="export-summary-card">
          <strong>{students.length}</strong>
          <span>Approved students</span>
        </Card>
        <Card className="export-summary-card">
          <strong>{pendingEnrollments.length}</strong>
          <span>Pending requests</span>
        </Card>
        <Card className="export-summary-card">
          <strong>{classRecord?.classCode || "—"}</strong>
          <span>Class code</span>
        </Card>
      </div>

      <Card className="export-config-card">
        <div className="export-section-header">
          <h3>Record types</h3>
          <button type="button" className="link-button" onClick={toggleAll}>
            {allSelected ? "Deselect all" : "Select all"}
          </button>
        </div>
        <ul className="export-type-list">
          {RECORD_TYPES.map(({ key, label }) => (
            <li key={key}>
              <label className="export-type-checkbox">
                <input
                  type="checkbox"
                  checked={selected.has(key)}
                  onChange={() => toggleType(key)}
                />
                {label}
              </label>
            </li>
          ))}
        </ul>

        <div className="export-format-row">
          <span className="export-format-label">Format</span>
          <label className="export-radio">
            <input
              type="radio"
              name="export-format"
              value="xlsx"
              checked={format === "xlsx"}
              onChange={() => setFormat("xlsx")}
            />
            .xlsx (Excel workbook)
          </label>
          <label className="export-radio">
            <input
              type="radio"
              name="export-format"
              value="csv"
              checked={format === "csv"}
              onChange={() => setFormat("csv")}
            />
            .csv (flat file, UTF-8)
          </label>
        </div>

        {noneSelected && (
          <p className="export-empty-message" role="alert">
            Select at least one record type to enable export.
          </p>
        )}

        <div className="export-actions">
          <Button
            variant="primary"
            disabled={noneSelected || busy || (!onExcel && format === "xlsx") || (!onCsv && format === "csv")}
            onClick={handleExport}
          >
            {busy ? "Exporting…" : `Export ${selected.size} section${selected.size !== 1 ? "s" : ""} as .${format}`}
          </Button>
          {!noneSelected && (
            <Badge tone="neutral">
              {[...selected].map((k) => RECORD_TYPES.find((t) => t.key === k)?.label).join(", ")}
            </Badge>
          )}
        </div>
      </Card>
    </div>
  );
}
