import Icon from "../Icon";
import { Badge, Button, Card, PageHeader } from "../DesignSystem";

function ExportOption({ icon, title, description, bullets, disabled = false, onAction, actionLabel = "Download" }) {
  return (
    <Card className="export-option-card">
      <div className="export-option-heading">
        <span className="export-option-icon"><Icon name={icon} /></span>
        <div>
          <h3>{title}</h3>
          <p>{description}</p>
        </div>
      </div>
      <ul className="export-option-list">
        {bullets.map((bullet) => <li key={bullet}>{bullet}</li>)}
      </ul>
      <div className="export-option-actions">
        <Button disabled={disabled} variant="secondary" onClick={onAction}>{disabled ? "Coming next" : actionLabel}</Button>
        <Badge tone="neutral">{disabled ? "Preview only" : "Ready"}</Badge>
      </div>
    </Card>
  );
}

export default function ExportModule({ classRecord, students = [], pendingEnrollments = [], onExcel, onCsv }) {
  return (
    <div className="export-module">
      <PageHeader
        eyebrow="Data export"
        icon="folderKanban"
        title="Export class data"
        description="Prepare a workbook or CSV bundle with the student list, attendance, recitation, activity, project, and quiz records."
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

      <div className="export-option-grid">
        <ExportOption
          icon="book"
          title="Excel workbook"
          description="A multi-sheet workbook for reporting and record keeping."
          bullets={[
            "Student list sheet with contact-safe data",
            "Attendance, recitation, activity, project, and quiz tabs",
            "Built from sanitized export data",
          ]}
          disabled={!onExcel}
          onAction={onExcel}
        />
        <ExportOption
          icon="listChecks"
          title="CSV bundle"
          description="Flat CSV exports for spreadsheets, filters, and quick sharing."
          bullets={[
            "Single CSV with labeled sections per record type",
            "Formula-safe output with sanitized cells",
            "UTF-8 with BOM, quoted fields",
          ]}
          disabled={!onCsv}
          onAction={onCsv}
        />
      </div>
    </div>
  );
}
