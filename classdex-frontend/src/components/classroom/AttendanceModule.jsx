import { useMemo, useState } from "react";
import Icon from "../Icon";
import { StatCounter, StatusButton, StudentCard } from "./ClassroomComponents";
import { formatStudentName } from "./studentNames";

const ATTENDANCE_STATUSES = ["PRESENT", "LATE", "ABSENT"];

export default function AttendanceModule({
  students,
  counts,
  layout,
  onLayoutChange,
  gracePeriodMinutes,
  onStatusChange,
  onSaveGracePeriod,
  pendingStudentIds = [],
  savingGracePeriod,
}) {
  const [onlyUnmarked, setOnlyUnmarked] = useState(false);
  const [graceValue, setGraceValue] = useState(null);
  const [search, setSearch] = useState("");
  const [takingAttendance, setTakingAttendance] = useState(false);
  const [currentStudentId, setCurrentStudentId] = useState(null);
  const inputGraceValue = graceValue ?? String(gracePeriodMinutes);

  const displayedStudents = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return students.filter((student) => {
      const matchesSearch = !query
        || `${student.name} ${student.studentId}`.toLocaleLowerCase().includes(query);
      return matchesSearch && (!onlyUnmarked || student.status === "UNMARKED");
    });
  }, [onlyUnmarked, search, students]);
  const currentStudent = students.find((student) => student.id === currentStudentId) || null;
  const unmarkedStudents = students.filter((student) => student.status === "UNMARKED");
  const completedCount = students.length - unmarkedStudents.length;
  const activeIndex = students.findIndex(({ id }) => id === currentStudentId);

  async function saveGracePeriod(event) {
    event.preventDefault();
    const minutes = Number(inputGraceValue);
    if (!Number.isInteger(minutes) || minutes < 0 || minutes > 1440) return;
    const saved = await onSaveGracePeriod(minutes);
    if (saved) setGraceValue(null);
  }

  function startTakingAttendance() {
    setTakingAttendance(true);
    setCurrentStudentId(unmarkedStudents[0]?.id || null);
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

    const firstRemaining = students.find((student) =>
      student.id !== currentStudent.id && student.status === "UNMARKED",
    );
    if (firstRemaining) {
      setCurrentStudentId(firstRemaining.id);
      return;
    }

    setCurrentStudentId(null);
  }

  async function markStudentFromRoster(student, status) {
    await onStatusChange(student, status === student.status ? "UNMARKED" : status);
  }

  function goToPreviousStudent() {
    const previousStudent = students
      .slice(0, activeIndex)
      .reverse()
      .find((student) => student.status !== "UNMARKED");
    if (previousStudent) setCurrentStudentId(previousStudent.id);
  }

  return (
    <div className="attendance-module">
      <div className="attendance-heading">
        <div>
          <span className="eyebrow"><Icon name="check" /> Attendance</span>
          <h2>Attendance</h2>
          <p>Review attendance cards or take attendance one student at a time.</p>
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

      {takingAttendance ? (
        <section className="attendance-taking" aria-live="polite">
          <div className="attendance-taking-header">
            <div>
              <span className="eyebrow"><Icon name="check" /> Taking attendance</span>
              <strong>{students.length - counts.UNMARKED} of {students.length} students marked</strong>
            </div>
            <button type="button" className="button button-secondary" onClick={() => setTakingAttendance(false)}>
              Back to roster
            </button>
          </div>
          {currentStudent ? (
            <>
              <div className="attendance-progress" role="progressbar" aria-valuemin="0" aria-valuemax={students.length} aria-valuenow={completedCount}>
                <span style={{ width: `${students.length ? (completedCount / students.length) * 100 : 0}%` }} />
              </div>
              <div className="recitation-stage attendance-focus-stage">
                <article className="recitation-card attendance-focus-card">
                  <span className="recitation-call-label">Student {activeIndex + 1} of {students.length}</span>
                  <div className="recitation-student-photo">
                    {currentStudent.photo ? <img src={currentStudent.photo} alt="" /> : <Icon name="user" size={36} />}
                  </div>
                  <h3>{formatStudentName(currentStudent.name)}</h3>
                  <p className="recitation-student-id">Student ID · {currentStudent.studentId}</p>
                  <p className="recitation-student-program">
                    {[currentStudent.program, currentStudent.section].filter(Boolean).join(" · ") || "Student"}
                  </p>
                  <div className="attendance-focus-actions" aria-label={`Mark ${currentStudent.name}`}>
                    {ATTENDANCE_STATUSES.map((status) => (
                      <StatusButton
                        key={status}
                        status={status}
                        active={currentStudent.status === status}
                        disabled={pendingStudentIds.includes(currentStudent.id)}
                        onClick={() => markCurrentStudent(status)}
                      />
                    ))}
                  </div>
                  {activeIndex > 0 ? (
                    <button type="button" className="attendance-previous" onClick={goToPreviousStudent}>
                      <Icon name="chevron" size={15} /> Previous student
                    </button>
                  ) : null}
                </article>
              </div>
            </>
          ) : (
            <div className="attendance-complete">
              <span><Icon name="check" size={27} /></span>
              <h3>{students.length ? "Attendance complete" : "No students in this class yet"}</h3>
              <p>{students.length
                ? "Every student has an attendance status. You can still change any status from the roster."
                : "Students will appear here when they join the class."}</p>
              <button type="button" className="button button-primary" onClick={() => setTakingAttendance(false)}>
                Return to roster
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
                <span className="sr-only">Search attendance by name or student ID</span>
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search name or ID"
                  type="search"
                />
              </label>
              <div className="layout-toggle" role="group" aria-label="Attendance roster layout">
                <button
                  type="button"
                  className={layout === "grid" ? "is-active" : ""}
                  aria-pressed={layout === "grid"}
                  onClick={() => onLayoutChange("grid")}
                >Grid</button>
                <button
                  type="button"
                  className={layout === "list" ? "is-active" : ""}
                  aria-pressed={layout === "list"}
                  onClick={() => onLayoutChange("list")}
                >List</button>
              </div>
            </div>
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
              disabled={!students.length}
              onClick={startTakingAttendance}
            >
              <Icon name="check" />
              {counts.UNMARKED ? (completedCount ? "Continue attendance" : "Take attendance") : "Review attendance"}
            </button>
          </div>

          {displayedStudents.length ? (
            <div className={`student-grid ${layout === "list" ? "student-grid-list" : ""}`}>
              {displayedStudents.map((student) => (
                <StudentCard key={student.id} student={student} status={student.status} layout={layout}>
                  <div className="status-button-row" aria-label={`Attendance status for ${student.name}`}>
                    {ATTENDANCE_STATUSES.map((status) => (
                      <StatusButton
                        key={status}
                        status={status}
                        active={student.status === status}
                        disabled={pendingStudentIds.includes(student.id)}
                        onClick={() => markStudentFromRoster(student, status)}
                      />
                    ))}
                  </div>
                </StudentCard>
              ))}
            </div>
          ) : (
            <section className="attendance-filter-empty">
              <Icon name="check" />
              <strong>{students.length ? "No matching students" : "No students to mark yet"}</strong>
              <span>{students.length ? "Try another name or ID." : "Students will appear here when they join this class."}</span>
              {students.length && onlyUnmarked ? (
                <button type="button" className="button button-secondary" onClick={() => setOnlyUnmarked(false)}>
                  Show all students
                </button>
              ) : null}
            </section>
          )}
        </>
      )}
    </div>
  );
}
