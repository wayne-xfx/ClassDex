import { useEffect, useId, useMemo, useRef, useState } from "react";
import Avatar from "../Avatar";
import Icon from "../Icon";
import AttendanceStudentCard from "./AttendanceStudentCard";
import { ModuleHeader } from "./ClassShell";
import { ConfirmDialog } from "./ClassroomComponents";
import {
  formatProgramSection,
  formatStudentDisplayName,
  formatStudentName,
} from "./studentNames";

const ATTENDANCE_STATUSES = ["PRESENT", "LATE", "ABSENT"];

function formatManilaTime(dateValue) {
  if (!dateValue) return "";
  try {
    const d = new Date(dateValue);
    if (Number.isNaN(d.getTime())) return "";
    return new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit",
      timeZone: "Asia/Manila",
    }).format(d);
  } catch {
    return "";
  }
}

export default function AttendanceModule({
  students = [],
  counts = { PRESENT: 0, LATE: 0, ABSENT: 0, UNMARKED: 0 },
  layout = "grid",
  onLayoutChange,
  gracePeriodMinutes = 15,
  sessionStartedAt = null,
  onStartAttendance,
  onStatusChange,
  onBulkStatusChange,
  onSaveGracePeriod,
  pendingStudentIds = [],
  savingGracePeriod = false,
  readOnly = false,
}) {
  const [activeFilter, setActiveFilter] = useState("ALL"); // ALL | PRESENT | LATE | ABSENT | UNMARKED
  const [search, setSearch] = useState("");
  const [takingAttendance, setTakingAttendance] = useState(false);
  const [currentStudentId, setCurrentStudentId] = useState(null);

  // Grace popover state
  const [graceOpen, setGraceOpen] = useState(false);
  const [graceValue, setGraceValue] = useState(null);
  const [graceError, setGraceError] = useState("");
  const graceInputRef = useRef(null);
  const graceAnchorRef = useRef(null);
  const gracePopoverRef = useRef(null);
  const graceInputId = useId();

  // Confirm dialog state for bulk absent
  const [confirmAbsentOpen, setConfirmAbsentOpen] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);

  // Live timer for grace period countdown
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!sessionStartedAt) return;
    const timer = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(timer);
  }, [sessionStartedAt]);

  const inputGraceValue = graceValue ?? String(gracePeriodMinutes ?? 15);

  // Close grace popover on outside click or Escape
  useEffect(() => {
    if (!graceOpen) return;
    function handleKeyDown(event) {
      if (event.key === "Escape") {
        setGraceOpen(false);
        graceAnchorRef.current?.focus();
      }
    }
    function handleClickOutside(event) {
      if (
        gracePopoverRef.current &&
        !gracePopoverRef.current.contains(event.target) &&
        !graceAnchorRef.current?.contains(event.target)
      ) {
        setGraceOpen(false);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [graceOpen]);

  // Status strip computation
  const statusStripInfo = useMemo(() => {
    if (!sessionStartedAt) {
      return {
        isStarted: false,
        text: `Session not started · students count as Late ${gracePeriodMinutes} min after your first mark`,
      };
    }
    const startedTimeStr = formatManilaTime(sessionStartedAt);
    const startedMs = Date.parse(sessionStartedAt);
    if (!Number.isFinite(startedMs)) {
      return { isStarted: true, text: "Session active" };
    }
    const effectiveGrace = Number.isInteger(gracePeriodMinutes) && gracePeriodMinutes >= 0 ? gracePeriodMinutes : 15;
    const deadlineMs = startedMs + effectiveGrace * 60_000;
    const diffMs = deadlineMs - now;

    if (diffMs > 0) {
      const remainingMin = Math.ceil(diffMs / 60_000);
      return {
        isStarted: true,
        text: `Started at ${startedTimeStr} · ${remainingMin} min left before Late`,
        isGraceActive: true,
      };
    }
    return {
      isStarted: true,
      text: `Started at ${startedTimeStr} · Grace period ended · Present marks convert to Late`,
      isGraceActive: false,
    };
  }, [gracePeriodMinutes, now, sessionStartedAt]);

  // Filtering displayed students
  const displayedStudents = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return students.filter((student) => {
      const matchesSearch =
        !query || `${student.name} ${student.studentId}`.toLocaleLowerCase().includes(query);
      const matchesFilter =
        activeFilter === "ALL" || student.status === activeFilter;
      return matchesSearch && matchesFilter;
    });
  }, [activeFilter, search, students]);

  const currentStudent = students.find((student) => student.id === currentStudentId) || null;
  const unmarkedStudents = students.filter((student) => student.status === "UNMARKED");
  const completedCount = students.length - unmarkedStudents.length;
  const activeIndex = students.findIndex(({ id }) => id === currentStudentId);

  async function saveGracePeriod(event) {
    event.preventDefault();
    const trimmed = String(inputGraceValue).trim();
    const minutes = Number(trimmed);
    if (!trimmed || !/^\d+$/.test(trimmed) || !Number.isInteger(minutes) || minutes < 0 || minutes > 1440) {
      setGraceError("Grace period must be a whole number from 0 to 1440 minutes.");
      return;
    }
    setGraceError("");
    const saved = await onSaveGracePeriod(minutes);
    if (saved) {
      setGraceValue(null);
      setGraceOpen(false);
    }
  }

  function startTakingAttendance() {
    onStartAttendance?.();
    setTakingAttendance(true);
    setCurrentStudentId(unmarkedStudents[0]?.id || students[0]?.id || null);
  }

  async function markCurrentStudent(status) {
    if (!currentStudent || pendingStudentIds.includes(currentStudent.id)) return;
    const requestedStatus = currentStudent.status === status ? "UNMARKED" : status;
    const savedStatus = await onStatusChange(currentStudent, requestedStatus, false);
    if (!savedStatus) return;
    if (requestedStatus === "UNMARKED") return;

    const nextStudent = students
      .slice(activeIndex + 1)
      .find((student) => student.status === "UNMARKED" && student.id !== currentStudent.id);
    if (nextStudent) {
      setCurrentStudentId(nextStudent.id);
      return;
    }

    const firstRemaining = students.find(
      (student) => student.id !== currentStudent.id && student.status === "UNMARKED",
    );
    if (firstRemaining) {
      setCurrentStudentId(firstRemaining.id);
      return;
    }

    setCurrentStudentId(null);
  }

  function goToPreviousStudent() {
    const previousStudent = students
      .slice(0, activeIndex)
      .reverse()
      .find((student) => student.status !== "UNMARKED");
    if (previousStudent) setCurrentStudentId(previousStudent.id);
  }

  // Bulk: Mark All Present
  async function handleMarkAllPresent() {
    if (!students.length || readOnly || !onBulkStatusChange) return;
    const targets = unmarkedStudents.length > 0 ? unmarkedStudents : students;
    const previousSnapshot = targets.map((s) => ({ studentId: s.id, status: s.status }));
    const updates = targets.map((s) => ({ studentId: s.id, status: "PRESENT" }));
    setBulkBusy(true);
    try {
      await onBulkStatusChange(
        updates,
        previousSnapshot,
        `Marked ${targets.length} student${targets.length === 1 ? "" : "s"} as Present.`,
      );
    } finally {
      setBulkBusy(false);
    }
  }

  // Bulk: Mark Remaining Absent
  async function handleConfirmMarkRemainingAbsent() {
    if (!unmarkedStudents.length || readOnly || !onBulkStatusChange) {
      setConfirmAbsentOpen(false);
      return;
    }
    const previousSnapshot = unmarkedStudents.map((s) => ({ studentId: s.id, status: s.status }));
    const updates = unmarkedStudents.map((s) => ({ studentId: s.id, status: "ABSENT" }));
    setBulkBusy(true);
    try {
      await onBulkStatusChange(
        updates,
        previousSnapshot,
        `Marked ${unmarkedStudents.length} remaining student${unmarkedStudents.length === 1 ? "" : "s"} as Absent.`,
      );
    } finally {
      setBulkBusy(false);
      setConfirmAbsentOpen(false);
    }
  }

  return (
    <div className="attendance-module">
      <ModuleHeader
        title="Attendance"
        subtitle="Review attendance cards, roll call one student at a time, or mark attendance in bulk."
      />

      {/* Slim status strip with grace period popover trigger */}
      <section className="attendance-status-strip" aria-live="polite">
        <div className="attendance-strip-info">
          <Icon name="clock" size={17} className="attendance-strip-icon" />
          <span className="attendance-strip-text">{statusStripInfo.text}</span>
        </div>
        {!readOnly ? (
          <div className="attendance-strip-actions">
            <button
              ref={graceAnchorRef}
              type="button"
              className={`button button-secondary attendance-grace-btn${graceOpen ? " is-active" : ""}`}
              onClick={() => {
                setGraceOpen((open) => !open);
                if (!graceOpen) {
                  setTimeout(() => graceInputRef.current?.focus(), 50);
                }
              }}
              aria-expanded={graceOpen}
              aria-haspopup="dialog"
              aria-label="Attendance settings: adjust grace period"
              title="Attendance settings: adjust grace period"
            >
              <Icon name="settings" size={16} />
              <span>Grace ({gracePeriodMinutes}m)</span>
            </button>

            {graceOpen ? (
              <div
                ref={gracePopoverRef}
                className="attendance-grace-popover"
                role="dialog"
                aria-modal="false"
                aria-label="Grace period settings"
              >
                <div className="attendance-grace-popover-header">
                  <strong>Grace period</strong>
                  <button
                    type="button"
                    className="attendance-popover-close"
                    onClick={() => setGraceOpen(false)}
                    aria-label="Close grace period settings"
                  >
                    <Icon name="x" size={14} />
                  </button>
                </div>
                <form noValidate onSubmit={saveGracePeriod} className="attendance-grace-popover-form">
                  <label htmlFor={graceInputId} className="sr-only">
                    Grace period in minutes
                  </label>
                  <div className="grace-input-row">
                    <input
                      ref={graceInputRef}
                      id={graceInputId}
                      className={`input${graceError ? " input-invalid" : ""}`}
                      type="number"
                      min="0"
                      max="1440"
                      step="1"
                      required
                      value={inputGraceValue}
                      onChange={(event) => {
                        setGraceValue(event.target.value);
                        if (graceError) setGraceError("");
                      }}
                      aria-invalid={Boolean(graceError)}
                    />
                    <span>min</span>
                    <button
                      className="button button-primary"
                      type="submit"
                      disabled={savingGracePeriod}
                    >
                      {savingGracePeriod ? "Saving…" : "Save"}
                    </button>
                  </div>
                  {graceError ? (
                    <div className="field-error" role="alert" style={{ marginTop: 6 }}>
                      {graceError}
                    </div>
                  ) : null}
                  <p className="attendance-grace-popover-help">
                    Present is recorded as Late after the session starts plus this time.
                  </p>
                </form>
              </div>
            ) : null}
          </div>
        ) : null}
      </section>

      {/* Filter pills */}
      <div className="attendance-filter-pills" role="tablist" aria-label="Filter students by attendance status">
        <button
          type="button"
          role="tab"
          aria-selected={activeFilter === "ALL"}
          className={`attendance-filter-pill${activeFilter === "ALL" ? " is-active" : ""}`}
          onClick={() => setActiveFilter("ALL")}
        >
          <Icon name="users" size={15} />
          <span>All</span>
          <strong className="attendance-pill-count">{students.length}</strong>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeFilter === "PRESENT"}
          className={`attendance-filter-pill pill-present${activeFilter === "PRESENT" ? " is-active" : ""}`}
          onClick={() => setActiveFilter("PRESENT")}
        >
          <Icon name="check" size={15} />
          <span>Present</span>
          <strong className="attendance-pill-count">{counts.PRESENT}</strong>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeFilter === "LATE"}
          className={`attendance-filter-pill pill-late${activeFilter === "LATE" ? " is-active" : ""}`}
          onClick={() => setActiveFilter("LATE")}
        >
          <Icon name="clock" size={15} />
          <span>Late</span>
          <strong className="attendance-pill-count">{counts.LATE}</strong>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeFilter === "ABSENT"}
          className={`attendance-filter-pill pill-absent${activeFilter === "ABSENT" ? " is-active" : ""}`}
          onClick={() => setActiveFilter("ABSENT")}
        >
          <Icon name="alert" size={15} />
          <span>Absent</span>
          <strong className="attendance-pill-count">{counts.ABSENT}</strong>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeFilter === "UNMARKED"}
          className={`attendance-filter-pill pill-unmarked${activeFilter === "UNMARKED" ? " is-active" : ""}`}
          onClick={() => setActiveFilter("UNMARKED")}
        >
          <Icon name="info" size={15} />
          <span>Unmarked</span>
          <strong className="attendance-pill-count">{counts.UNMARKED}</strong>
        </button>
      </div>

      {takingAttendance ? (
        <section className="attendance-taking" aria-live="polite">
          <div className="attendance-taking-header">
            <div>
              <span className="eyebrow"><Icon name="clipboardCheck" /> Roll call</span>
              <strong>{students.length - counts.UNMARKED} of {students.length} students marked</strong>
              <span className="attendance-mode-caption">One-student-at-a-time card mode</span>
            </div>
            <button
              type="button"
              className="button button-secondary"
              onClick={() => setTakingAttendance(false)}
            >
              Back to student list
            </button>
          </div>
          {currentStudent ? (
            <>
              <div
                className="attendance-progress"
                role="progressbar"
                aria-valuemin="0"
                aria-valuemax={students.length}
                aria-valuenow={completedCount}
              >
                <span
                  style={{
                    width: `${students.length ? (completedCount / students.length) * 100 : 0}%`,
                  }}
                />
              </div>
              <div className="recitation-stage attendance-focus-stage">
                <article className="recitation-card attendance-focus-card">
                  <span className="recitation-call-label">
                    Student {activeIndex + 1} of {students.length}
                  </span>
                  <Avatar
                    src={currentStudent.photo || currentStudent.photoUrl}
                    name={currentStudent.name}
                    size="lg"
                    className="recitation-student-photo"
                  />
                  <h3>
                    {formatStudentDisplayName(currentStudent.name, currentStudent) ||
                      formatStudentName(currentStudent.name)}
                  </h3>
                  <p className="recitation-student-id">Student ID · {currentStudent.studentId}</p>
                  <p className="recitation-student-program">
                    {formatProgramSection(currentStudent.program, currentStudent.section) ||
                      "Student"}
                  </p>
                  <div
                    className="attendance-focus-actions"
                    aria-label={`Mark ${currentStudent.name}`}
                  >
                    {ATTENDANCE_STATUSES.map((status) => {
                      const isActive = currentStudent.status === status;
                      return (
                        <button
                          key={status}
                          type="button"
                          className={`attendance-action-btn attendance-action-btn-${status.toLowerCase()}${
                            isActive ? " is-active" : ""
                          }`}
                          aria-pressed={isActive}
                          disabled={pendingStudentIds.includes(currentStudent.id)}
                          onClick={() => markCurrentStudent(status)}
                        >
                          <Icon
                            name={
                              status === "PRESENT"
                                ? "check"
                                : status === "LATE"
                                ? "clock"
                                : "alert"
                            }
                            size={16}
                          />
                          <span>
                            {status === "PRESENT"
                              ? "Present"
                              : status === "LATE"
                              ? "Late"
                              : "Absent"}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  {activeIndex > 0 ? (
                    <button
                      type="button"
                      className="attendance-previous"
                      onClick={goToPreviousStudent}
                    >
                      <Icon name="chevron" size={15} /> Previous student
                    </button>
                  ) : null}
                </article>
              </div>
            </>
          ) : (
            <div className="attendance-complete">
              <span>
                <Icon name="check" size={27} />
              </span>
              <h3>
                {students.length ? "Roll call complete" : "No students in this class yet"}
              </h3>
              <p>
                {students.length
                  ? "Every student has an attendance status. You can still change any status from the student list."
                  : "Students will appear here when they join the class."}
              </p>
              <button
                type="button"
                className="button button-primary"
                onClick={() => setTakingAttendance(false)}
              >
                Return to student list
              </button>
            </div>
          )}
        </section>
      ) : (
        <>
          <div className="attendance-toolbar">
            <div className="deck-actions attendance-roster-actions">
              <label className="deck-search">
                <Icon name="search" size={17} />
                <span className="sr-only">Search student list by name or student ID</span>
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search name or ID"
                  type="search"
                />
              </label>
              <div
                className="layout-toggle"
                role="group"
                aria-label="Attendance student list layout"
              >
                <button
                  type="button"
                  className={layout === "grid" ? "is-active" : ""}
                  aria-pressed={layout === "grid"}
                  onClick={() => onLayoutChange("grid")}
                >
                  <Icon name="grid" size={14} />
                  <span>Grid</span>
                </button>
                <button
                  type="button"
                  className={layout === "list" ? "is-active" : ""}
                  aria-pressed={layout === "list"}
                  onClick={() => onLayoutChange("list")}
                >
                  <Icon name="list" size={14} />
                  <span>List</span>
                </button>
              </div>
            </div>

            <div className="attendance-toolbar-actions">
              {!readOnly ? (
                <>
                  <button
                    type="button"
                    className="button button-secondary attendance-bulk-btn"
                    disabled={!students.length || bulkBusy}
                    onClick={handleMarkAllPresent}
                    title="Mark all unmarked students as Present"
                  >
                    <Icon name="check" size={15} />
                    <span>Mark all present</span>
                  </button>
                  <button
                    type="button"
                    className="button button-secondary attendance-bulk-btn"
                    disabled={!unmarkedStudents.length || bulkBusy}
                    onClick={() => setConfirmAbsentOpen(true)}
                    title="Mark remaining unmarked students as Absent"
                  >
                    <Icon name="alert" size={15} />
                    <span>Mark remaining absent</span>
                  </button>
                  <button
                    type="button"
                    className="button button-primary attendance-rollcall-btn"
                    disabled={!students.length}
                    onClick={startTakingAttendance}
                    title="Roll call: One-student-at-a-time card mode"
                  >
                    <Icon name="clipboardCheck" size={16} />
                    <span>
                      {counts.UNMARKED
                        ? completedCount
                          ? "Continue roll call"
                          : "Roll call"
                        : "Review roll call"}
                    </span>
                  </button>
                </>
              ) : null}
            </div>
          </div>

          {displayedStudents.length ? (
            <div
              className={`student-grid ${
                layout === "list" ? "student-grid-list" : ""
              }`}
            >
              {displayedStudents.map((student) => {
                const baseCount = student.absentCount || 0;
                const isAbsent = student.status === "ABSENT";
                const wasAbsentInitially = student.attendanceStatus === "ABSENT";
                const effectiveAbsentCount = Math.max(
                  0,
                  baseCount + (isAbsent ? (wasAbsentInitially ? 0 : 1) : wasAbsentInitially ? -1 : 0),
                );

                return (
                  <AttendanceStudentCard
                    key={student.id}
                    student={student}
                    status={student.status}
                    effectiveAbsentCount={effectiveAbsentCount}
                    layout={layout}
                    onStatusChange={(status) => onStatusChange(student, status)}
                    pending={pendingStudentIds.includes(student.id)}
                    readOnly={readOnly}
                  />
                );
              })}
            </div>
          ) : (
            <section className="attendance-filter-empty">
              <Icon name="check" size={24} />
              <strong>
                {students.length
                  ? "No matching students in this filter"
                  : "No students to mark yet"}
              </strong>
              <span>
                {students.length
                  ? "Try selecting another status pill or clearing the search query."
                  : "Students will appear here when they join this class."}
              </span>
              {students.length && activeFilter !== "ALL" ? (
                <button
                  type="button"
                  className="button button-secondary"
                  onClick={() => setActiveFilter("ALL")}
                  style={{ marginTop: 12 }}
                >
                  Show all students
                </button>
              ) : null}
            </section>
          )}
        </>
      )}

      {/* Confirmation dialog for Mark Remaining Absent */}
      {confirmAbsentOpen ? (
        <ConfirmDialog
          title="Mark remaining students absent?"
          description={`Marking ${unmarkedStudents.length} remaining unmarked student${
            unmarkedStudents.length === 1 ? "" : "s"
          } absent will automatically flag their Activities, Projects, and Quizzes for today's session, and count toward their 7-absence warning limit. Are you sure you want to proceed?`}
          confirmLabel={bulkBusy ? "Marking…" : "Mark absent"}
          busy={bulkBusy}
          onConfirm={handleConfirmMarkRemainingAbsent}
          onCancel={() => setConfirmAbsentOpen(false)}
        />
      ) : null}
    </div>
  );
}
