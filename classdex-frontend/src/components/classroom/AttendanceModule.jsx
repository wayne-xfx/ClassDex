import { useState } from "react";
import Icon from "../Icon";
import { ConfirmDialog, StatCounter, StatusButton, StudentCard } from "./ClassroomComponents";

export default function AttendanceModule({
  students,
  counts,
  layout,
  gracePeriodMinutes,
  onStatusChange,
  onMarkAll,
  onSaveGracePeriod,
  pendingStudentIds = [],
  savingGracePeriod,
}) {
  const [onlyUnmarked, setOnlyUnmarked] = useState(false);
  const [confirmingBulk, setConfirmingBulk] = useState(false);
  const [graceValue, setGraceValue] = useState(null);
  const inputGraceValue = graceValue ?? String(gracePeriodMinutes);

  const displayedStudents = onlyUnmarked
    ? students.filter((student) => student.status === "UNMARKED")
    : students;

  async function saveGracePeriod(event) {
    event.preventDefault();
    const minutes = Number(inputGraceValue);
    if (!Number.isInteger(minutes) || minutes < 0 || minutes > 1440) return;
    await onSaveGracePeriod(minutes);
    setGraceValue(null);
  }

  return (
    <div className="attendance-module">
      <div className="attendance-heading">
        <div>
          <span className="eyebrow"><Icon name="check" /> Attendance</span>
          <h2>Take attendance</h2>
          <p>Tap a status on each card. Tap the selected status again to clear it.</p>
        </div>
        <form className="grace-control" onSubmit={saveGracePeriod}>
          <label htmlFor="grace-period">Grace period</label>
          <div className="grace-input-row">
            <input
              id="grace-period"
              className="input"
              type="number"
              min="0"
              max="1440"
              step="1"
              required
              value={inputGraceValue}
              onChange={(event) => setGraceValue(event.target.value)}
              aria-describedby="grace-period-help"
            />
            <span>min</span>
            <button className="button button-secondary" type="submit" disabled={savingGracePeriod}>
              {savingGracePeriod ? "Saving…" : "Save"}
            </button>
          </div>
          <span id="grace-period-help">Present is recorded as Late after the session starts plus this time.</span>
        </form>
      </div>

      <div className="attendance-stats">
        <StatCounter label="Present" value={counts.PRESENT} tone="present" />
        <StatCounter label="Late" value={counts.LATE} tone="late" />
        <StatCounter label="Absent" value={counts.ABSENT} tone="absent" />
        <StatCounter label="Unmarked" value={counts.UNMARKED} tone="neutral" />
      </div>

      <div className="attendance-toolbar">
        <label className="unmarked-filter">
          <input
            type="checkbox"
            checked={onlyUnmarked}
            onChange={(event) => setOnlyUnmarked(event.target.checked)}
          />
          <span>Show only Unmarked</span>
          <strong>{counts.UNMARKED}</strong>
        </label>
        <button
          type="button"
          className="button button-primary"
          disabled={!students.length || students.every((student) => student.status === "PRESENT")}
          onClick={() => setConfirmingBulk(true)}
        >
          <Icon name="check" /> Mark all Present
        </button>
      </div>

      {displayedStudents.length ? (
        <div className={`student-grid ${layout === "list" ? "student-grid-list" : ""}`}>
          {displayedStudents.map((student) => (
            <StudentCard key={student.id} student={student} status={student.status} layout={layout}>
              <div className="status-button-row" aria-label={`Attendance status for ${student.name}`}>
                {["PRESENT", "LATE", "ABSENT"].map((status) => (
                  <StatusButton
                    key={status}
                    status={status}
                    active={student.status === status}
                    disabled={pendingStudentIds.includes(student.id)}
                    onClick={() => onStatusChange(student, status === student.status ? "UNMARKED" : status)}
                  />
                ))}
              </div>
            </StudentCard>
          ))}
        </div>
      ) : (
        <section className="attendance-filter-empty">
          <Icon name="check" />
          <strong>{students.length ? "All caught up!" : "No students to mark yet"}</strong>
          <span>{students.length ? "Every student has an attendance status." : "Students will appear here when they join this class."}</span>
          {students.length ? (
            <button type="button" className="button button-secondary" onClick={() => setOnlyUnmarked(false)}>
              Show all students
            </button>
          ) : null}
        </section>
      )}

      {confirmingBulk ? (
        <ConfirmDialog
          title="Mark everyone Present?"
          description={`This will mark all ${students.length} students Present, subject to the grace period. You can still edit any individual status afterward.`}
          confirmLabel="Mark all Present"
          onCancel={() => setConfirmingBulk(false)}
          onConfirm={() => {
            setConfirmingBulk(false);
            onMarkAll();
          }}
        />
      ) : null}
    </div>
  );
}
