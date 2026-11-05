import { useEffect, useRef, useState } from "react";
import Avatar from "../Avatar";
import Icon from "../Icon";
import { formatStudentName } from "./studentNames";

const STATUS_LABELS = {
  PRESENT: "Present",
  LATE: "Late",
  ABSENT: "Absent",
  UNMARKED: "Unmarked",
};
const DETAIL_STATUS_LABELS = {
  PRESENT: "Present",
  LATE: "Late",
  ABSENT: "Absent",
};

export function ModuleTabs({ active, onChange, studentListCount = 0 }) {
  const tabRefs = useRef([]);
  const tabs = [
    { id: "attendance", label: "Attendance", icon: "clipboardCheck" },
    { id: "recitation", label: "Recitation", icon: "message" },
    { id: "activities", label: "Activities", icon: "listChecks" },
    { id: "projects", label: "Projects", icon: "folder" },
    { id: "quiz", label: "Quiz", icon: "brain" },
    { id: "export", label: "Data export", icon: "exportSheet" },
    { id: "student-list", label: `Student List (${studentListCount})`, icon: "users" },
  ];

  function handleTabKeyDown(event, index) {
    const enabledTabs = tabs.filter((tab) => !tab.disabled);
    const currentIndex = enabledTabs.findIndex((tab) => tab.id === tabs[index].id);
    const nextEnabledIndex = event.key === "ArrowRight"
      ? (currentIndex + 1) % enabledTabs.length
      : event.key === "ArrowLeft"
        ? (currentIndex - 1 + enabledTabs.length) % enabledTabs.length
        : event.key === "Home"
          ? 0
          : event.key === "End"
            ? enabledTabs.length - 1
            : -1;
    if (nextEnabledIndex < 0) return;
    event.preventDefault();
    const nextTab = enabledTabs[nextEnabledIndex];
    onChange(nextTab.id);
    tabRefs.current[tabs.indexOf(nextTab)]?.focus();
  }

  return (
    <div className="module-navigation">
      <button
        type="button"
        className={`module-deck-link${active === "deck" ? " is-active" : ""}`}
        id="module-deck-link"
        aria-current={active === "deck" ? "page" : undefined}
        aria-controls="module-panel-deck"
        onClick={() => onChange("deck")}
      >
        <Icon name="book" size={17} /> Class Deck
      </button>
      <div className="module-tabs" role="tablist" aria-label="Class modules">
        {[tabs.slice(0, 5), tabs.slice(5)].map((group, groupIndex) => (
        <div className={`module-tab-group${groupIndex === 1 ? " module-tab-group-secondary" : ""}`} key={groupIndex}>
        {groupIndex === 1 ? <span className="module-tab-divider" aria-hidden="true" /> : null}
        {group.map((tab) => {
          const index = tabs.indexOf(tab);
          return (
        <button
          className={`module-tab${active === tab.id ? " is-active" : ""}${tab.disabled ? " module-tab-disabled" : ""}`}
          id={`module-tab-${tab.id}`}
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={active === tab.id}
          aria-controls={tab.disabled ? undefined : `module-panel-${tab.id}`}
          aria-disabled={tab.disabled || undefined}
          title={tab.disabled ? "Quiz is coming soon" : undefined}
          tabIndex={tab.disabled ? -1 : active === tab.id ? 0 : -1}
          ref={(element) => { tabRefs.current[index] = element; }}
          onKeyDown={(event) => !tab.disabled && handleTabKeyDown(event, index)}
          onClick={() => !tab.disabled && onChange(tab.id)}
        >
          <Icon name={tab.icon} size={17} />
          {tab.label}
          {tab.disabled ? <span className="coming-soon-badge">Coming soon</span> : null}
        </button>
          );
        })}
        </div>
        ))}
      </div>
    </div>
  );
}

export function StatCounter({ label, value, tone = "neutral" }) {
  return (
    <div className={`stat-counter stat-counter-${tone}`} aria-live="polite">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

export function StudentCard({ student, status = "UNMARKED", children, layout = "grid", onOpen }) {
  return (
    <article className={`student-card student-card-${layout} student-card-${status.toLowerCase()}`}>
      <div className="student-card-edge" />
      <div className="student-card-content">
        {onOpen ? (
          <button
            type="button"
            className="student-card-open"
            onClick={() => onOpen(student)}
            aria-label={`Open ${formatStudentName(student.name)}'s index card profile and class records`}
          >
            <div className="student-card-identity">
              <Avatar src={student.photo} name={student.name} size="md" className="student-card-photo" />
              <div className="student-card-copy">
                <h3>{formatStudentName(student.name)}</h3>
                <span className="student-card-id">ID {student.studentId}</span>
              </div>
              <span className={`student-status status-${status.toLowerCase()}`} title={status === "ABSENT" ? "Marked absent in attendance" : undefined}>
                <span aria-hidden="true" className="status-mark">
                  {status === "PRESENT" ? "✓" : status === "LATE" ? "◷" : status === "ABSENT" ? "!" : "·"}
                </span>
                {STATUS_LABELS[status] || STATUS_LABELS.UNMARKED}
              </span>
            </div>
            <div className="student-card-details">
              <span>{student.program || "Program not provided"}</span>
              <span>{student.section || "Section not provided"}</span>
            </div>
            <span className="student-card-open-hint">View index card <Icon name="arrow" size={13} /></span>
          </button>
        ) : (
          <>
            <div className="student-card-identity">
              <Avatar src={student.photo} name={student.name} size="md" className="student-card-photo" />
              <div className="student-card-copy">
                <h3>{formatStudentName(student.name)}</h3>
                <span className="student-card-id">ID {student.studentId}</span>
              </div>
              <span className={`student-status status-${status.toLowerCase()}`} title={status === "ABSENT" ? "Marked absent in attendance" : undefined}>
                <span aria-hidden="true" className="status-mark">
                  {status === "PRESENT" ? "✓" : status === "LATE" ? "◷" : status === "ABSENT" ? "!" : "·"}
                </span>
                {STATUS_LABELS[status] || STATUS_LABELS.UNMARKED}
              </span>
            </div>
            <div className="student-card-details">
              <span>{student.program || "Program not provided"}</span>
              <span>{student.section || "Section not provided"}</span>
            </div>
          </>
        )}
        {children ? <div className="student-card-actions">{children}</div> : null}
      </div>
    </article>
  );
}

export function StudentDetailDialog({ student, className, records, loading, error, onClose }) {
  const [isFlipped, setIsFlipped] = useState(false);
  const frontHeadingRef = useRef(null);
  const backHeadingRef = useRef(null);
  const dialogRef = useRef(null);

  // Reset flip to front whenever student changes
  useEffect(() => {
    setIsFlipped(false);
  }, [student?.id]);

  // Keyboard navigation: Esc to close, F to toggle flip
  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (
        (event.key === "f" || event.key === "F") &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey
      ) {
        const activeTag = document.activeElement?.tagName?.toLowerCase();
        if (activeTag !== "input" && activeTag !== "textarea") {
          event.preventDefault();
          setIsFlipped((prev) => !prev);
        }
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  // Focus visible face heading on flip
  useEffect(() => {
    if (isFlipped) {
      backHeadingRef.current?.focus();
    } else {
      frontHeadingRef.current?.focus();
    }
  }, [isFlipped]);

  const formatDate = (isoStr) => {
    if (!isoStr) return "";
    try {
      return new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
        timeZone: "Asia/Manila",
      }).format(new Date(isoStr));
    } catch {
      return String(isoStr);
    }
  };

  const formatMode = (mode) => {
    if (!mode) return "";
    const lower = String(mode).toLowerCase();
    return lower.charAt(0).toUpperCase() + lower.slice(1);
  };

  // Back face calculations
  const quizzes = records?.quizzes || [];
  const scoredQuizzes = quizzes.filter(
    (q) => !q.isAbsent && q.score !== null && q.session?.totalItems > 0
  );
  const quizAvg =
    scoredQuizzes.length > 0
      ? Math.round(
          scoredQuizzes.reduce(
            (acc, q) => acc + (q.score / q.session.totalItems) * 100,
            0
          ) / scoredQuizzes.length
        )
      : null;

  const activities = records?.activities || [];
  const scoredActivities = activities.filter(
    (a) => !a.isAbsent && a.score !== null && a.activity?.maxScore > 0
  );
  const actAvg =
    scoredActivities.length > 0
      ? Math.round(
          scoredActivities.reduce(
            (acc, a) => acc + (a.score / a.activity.maxScore) * 100,
            0
          ) / scoredActivities.length
        )
      : null;

  const projects = records?.projects || [];
  const gradedProjects = projects.filter(
    (p) => !p.isAbsent && p.score !== null
  );

  return (
    <div
      className="student-detail-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {isFlipped
          ? "Showing back of card: quizzes, activities and projects"
          : "Showing front of card: profile, attendance and recitation"}
      </div>

      <div
        ref={dialogRef}
        className="index-card-scene"
        role="dialog"
        aria-modal="true"
        aria-labelledby={isFlipped ? "student-detail-back-title" : "student-detail-title"}
      >
        <div className={`index-card${isFlipped ? " is-flipped" : ""}`}>
          {/* FRONT FACE */}
          <section
            className="index-card-face index-card-front"
            role="group"
            aria-label="Front: profile, attendance and recitation"
            aria-hidden={isFlipped}
            inert={isFlipped}
          >
            <div className="index-card-header">
              <div className="student-detail-profile">
                <Avatar
                  src={student.photo}
                  name={student.name}
                  size="lg"
                  className="student-detail-photo"
                />
                <div className="student-detail-profile-text">
                  <span className="eyebrow">
                    <Icon name="book" size={13} /> {className} · index card
                  </span>
                  <h2
                    id="student-detail-title"
                    ref={frontHeadingRef}
                    tabIndex={-1}
                  >
                    {formatStudentName(student.name)}
                  </h2>
                  <p className="student-detail-id">
                    Student ID · {student.studentId}
                  </p>
                </div>
              </div>

              <div className="index-card-header-actions">
                <button
                  type="button"
                  className="index-card-flip-btn"
                  aria-label="Flip card"
                  aria-pressed={isFlipped}
                  onClick={() => setIsFlipped((prev) => !prev)}
                >
                  <Icon name="flip" size={15} />
                  <span>Flip card</span>
                </button>
                <button
                  type="button"
                  className="student-detail-close"
                  aria-label="Close student profile"
                  onClick={onClose}
                >
                  <Icon name="x" size={18} />
                </button>
              </div>
            </div>

            <div className="student-detail-info">
              <div>
                <span>Program</span>
                <strong>{student.program || "Not provided"}</strong>
              </div>
              <div>
                <span>Section</span>
                <strong>{student.section || "Not provided"}</strong>
              </div>
              {records?.student?.email ? (
                <div>
                  <span>Email</span>
                  <strong>{records.student.email}</strong>
                </div>
              ) : null}
              {records?.student?.address ? (
                <div>
                  <span>Address</span>
                  <strong>{records.student.address}</strong>
                </div>
              ) : null}
            </div>

            <div className="index-card-records-wrapper">
              {loading ? (
                <p className="student-detail-message">Loading class records…</p>
              ) : null}
              {error ? (
                <p
                  className="student-detail-message student-detail-error"
                  role="alert"
                >
                  {error}
                </p>
              ) : null}
              {!loading && !error ? (
                <div className="index-card-front-columns">
                  {/* Attendance Column */}
                  <div className="index-card-col">
                    <h4 className="index-card-col-title">
                      <Icon name="clipboardCheck" size={15} />
                      <span>Attendance</span>
                      <span className="index-card-col-count">
                        ({records?.attendance?.length || 0})
                      </span>
                    </h4>
                    <div className="index-card-records">
                      {records?.attendance?.length ? (
                        <ul className="index-card-list">
                          {records.attendance.map((record) => (
                            <li key={record.id} className="index-card-row">
                              <time dateTime={record.session?.date}>
                                {formatDate(record.session?.date)}
                              </time>
                              <span
                                className={`student-status status-${record.status.toLowerCase()}`}
                              >
                                {DETAIL_STATUS_LABELS[record.status] || record.status}
                              </span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="student-detail-message">
                          No attendance records yet.
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Recitation Column */}
                  <div className="index-card-col">
                    <h4 className="index-card-col-title">
                      <Icon name="message" size={15} />
                      <span>Recitation</span>
                      <span className="index-card-col-count">
                        ({records?.recitations?.length || 0})
                      </span>
                    </h4>
                    <div className="index-card-records">
                      {records?.recitations?.length ? (
                        <ul className="index-card-list">
                          {records.recitations.map((record) => (
                            <li key={record.id} className="index-card-row">
                              <time dateTime={record.calledAt}>
                                {formatDate(record.calledAt)}
                              </time>
                              <span className="index-card-mode">
                                {formatMode(record.method || record.mode)}
                              </span>
                              <strong className="index-card-score">
                                {record.score === null
                                  ? "No score"
                                  : `Score ${record.score}`}
                              </strong>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="student-detail-message">
                          No recitation records yet.
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              ) : null}
            </div>

            <div className="index-card-footer">
              <span className="index-card-hint">
                Flip for quizzes, activities & projects
              </span>
              <button
                type="button"
                className="index-card-dog-ear"
                aria-label="Flip to back: quizzes, activities and projects"
                onClick={() => setIsFlipped(true)}
              >
                <span className="dog-ear-fold" aria-hidden="true" />
                <span className="dog-ear-label">
                  <Icon name="flip" size={13} />
                  <span>Flip</span>
                </span>
              </button>
            </div>
          </section>

          {/* BACK FACE */}
          <section
            className="index-card-face index-card-back"
            role="group"
            aria-label="Back: quizzes, activities and projects"
            aria-hidden={!isFlipped}
            inert={!isFlipped}
          >
            <div className="index-card-header index-card-header-compact">
              <div className="student-detail-profile student-detail-profile-compact">
                <Avatar
                  src={student.photo}
                  name={student.name}
                  size="sm"
                  className="index-card-back-avatar"
                />
                <div className="student-detail-profile-text">
                  <span className="eyebrow">Back · Scores</span>
                  <h2
                    id="student-detail-back-title"
                    ref={backHeadingRef}
                    tabIndex={-1}
                  >
                    {formatStudentName(student.name)}
                  </h2>
                  <p className="student-detail-id">
                    Student ID · {student.studentId}
                  </p>
                </div>
              </div>

              <div className="index-card-header-actions">
                <button
                  type="button"
                  className="index-card-flip-btn"
                  aria-label="Flip card"
                  aria-pressed={isFlipped}
                  onClick={() => setIsFlipped((prev) => !prev)}
                >
                  <Icon name="flip" size={15} />
                  <span>Flip card</span>
                </button>
                <button
                  type="button"
                  className="student-detail-close"
                  aria-label="Close student profile"
                  onClick={onClose}
                >
                  <Icon name="x" size={18} />
                </button>
              </div>
            </div>

            <div className="index-card-records-wrapper">
              {loading ? (
                <p className="student-detail-message">Loading class records…</p>
              ) : null}
              {error ? (
                <p
                  className="student-detail-message student-detail-error"
                  role="alert"
                >
                  {error}
                </p>
              ) : null}
              {!loading && !error ? (
                <div className="index-card-back-columns">
                  {/* Quizzes Column */}
                  <div className="index-card-col">
                    <h4 className="index-card-col-title">
                      <div className="index-card-col-title-left">
                        <Icon name="brain" size={15} />
                        <span>Quizzes</span>
                      </div>
                      <span className="index-card-col-summary">
                        {quizzes.length}
                        {quizAvg !== null ? ` · ${quizAvg}% avg` : ""}
                      </span>
                    </h4>
                    <div className="index-card-records">
                      {quizzes.length ? (
                        <ul className="index-card-list">
                          {quizzes.map((quiz) => {
                            const dateStr = formatDate(
                              quiz.session?.date || quiz.createdAt
                            );
                            const titleStr = quiz.session?.title || "Quiz";
                            return (
                              <li key={quiz.id} className="index-card-row">
                                <time dateTime={quiz.session?.date || quiz.createdAt}>
                                  {dateStr}
                                </time>
                                <span className="index-card-item-title" title={titleStr}>
                                  {titleStr}
                                </span>
                                {quiz.isAbsent ? (
                                  <span className="student-status status-absent">
                                    Absent
                                  </span>
                                ) : quiz.score === null ? (
                                  <span className="index-card-ungraded">
                                    Not graded
                                  </span>
                                ) : (
                                  <strong className="index-card-score">
                                    {quiz.score} / {quiz.session?.totalItems || "?"}
                                  </strong>
                                )}
                              </li>
                            );
                          })}
                        </ul>
                      ) : (
                        <p className="student-detail-message">
                          No quizzes recorded yet.
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Activities Column */}
                  <div className="index-card-col">
                    <h4 className="index-card-col-title">
                      <div className="index-card-col-title-left">
                        <Icon name="listChecks" size={15} />
                        <span>Activities</span>
                      </div>
                      <span className="index-card-col-summary">
                        {activities.length}
                        {actAvg !== null ? ` · ${actAvg}% avg` : ""}
                      </span>
                    </h4>
                    <div className="index-card-records">
                      {activities.length ? (
                        <ul className="index-card-list">
                          {activities.map((act) => {
                            const dateStr = formatDate(
                              act.session?.date || act.createdAt
                            );
                            const titleStr = act.activity?.title || "Activity";
                            const maxScore = act.activity?.maxScore;
                            return (
                              <li key={act.id} className="index-card-row">
                                <time dateTime={act.session?.date || act.createdAt}>
                                  {dateStr}
                                </time>
                                <span className="index-card-item-title" title={titleStr}>
                                  {titleStr}
                                </span>
                                {act.isAbsent ? (
                                  <span className="student-status status-absent">
                                    Absent
                                  </span>
                                ) : act.score === null ? (
                                  <span className="index-card-ungraded">
                                    Not graded
                                  </span>
                                ) : (
                                  <strong className="index-card-score">
                                    {act.score}
                                    {maxScore ? ` / ${maxScore}` : ""}
                                  </strong>
                                )}
                              </li>
                            );
                          })}
                        </ul>
                      ) : (
                        <p className="student-detail-message">
                          No activities recorded yet.
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Projects Column */}
                  <div className="index-card-col">
                    <h4 className="index-card-col-title">
                      <div className="index-card-col-title-left">
                        <Icon name="folder" size={15} />
                        <span>Projects</span>
                      </div>
                      <span className="index-card-col-summary">
                        {`${gradedProjects.length} of ${projects.length} graded`}
                      </span>
                    </h4>
                    <div className="index-card-records">
                      {projects.length ? (
                        <ul className="index-card-list">
                          {projects.map((proj) => {
                            const type = proj.project?.type || "PROJECT";
                            const isMidterm = type === "MIDTERM";
                            const maxScore = proj.project?.maxScore || 100;
                            return (
                              <li key={proj.id} className="index-card-row">
                                <span
                                  className={`index-card-project-tag ${
                                    isMidterm
                                      ? "project-tag-midterm"
                                      : "project-tag-finals"
                                  }`}
                                >
                                  {isMidterm ? "Midterm" : "Finals"}
                                </span>
                                <time dateTime={proj.session?.date || proj.createdAt}>
                                  {formatDate(proj.session?.date || proj.createdAt)}
                                </time>
                                {proj.isAbsent ? (
                                  <span className="student-status status-absent">
                                    Absent
                                  </span>
                                ) : proj.score === null ? (
                                  <span className="index-card-ungraded">
                                    Not graded
                                  </span>
                                ) : (
                                  <strong className="index-card-score">
                                    {proj.score} / {maxScore}
                                  </strong>
                                )}
                              </li>
                            );
                          })}
                        </ul>
                      ) : (
                        <p className="student-detail-message">
                          No projects recorded yet.
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              ) : null}
            </div>

            <div className="index-card-footer">
              <div className="index-card-tally">
                <span>
                  Quizzes {quizAvg !== null ? `${quizAvg}%` : "—"}
                </span>{" "}
                ·{" "}
                <span>
                  Activities {actAvg !== null ? `${actAvg}%` : "—"}
                </span>{" "}
                ·{" "}
                <span>
                  Projects {gradedProjects.length}/{projects.length}
                </span>
              </div>
              <button
                type="button"
                className="index-card-dog-ear"
                aria-label="Flip to front: profile, attendance and recitation"
                onClick={() => setIsFlipped(false)}
              >
                <span className="dog-ear-fold" aria-hidden="true" />
                <span className="dog-ear-label">
                  <Icon name="flip" size={13} />
                  <span>Flip</span>
                </span>
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

export function StatusButton({ status, active, disabled = false, clearOnActive = true, onClick }) {
  const names = { PRESENT: "Present", LATE: "Late", ABSENT: "Absent" };
  const icons = { PRESENT: "check", LATE: "clock", ABSENT: "x" };
  return (
    <button
      type="button"
      className={`status-button status-button-${status.toLowerCase()}${active ? " is-active" : ""}`}
      aria-label={`${names[status]}${active && clearOnActive ? " (selected; activate to clear)" : ""}`}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon name={icons[status]} size={15} />
      {names[status]}
    </button>
  );
}

export function EmptyState({ title, description, action, icon = "users" }) {
  return (
    <section className="class-empty-state">
      <div className="class-empty-art" aria-hidden="true">
        <span className="empty-card empty-card-back" />
        <span className="empty-card empty-card-front"><Icon name={icon} size={31} /></span>
      </div>
      <h2>{title}</h2>
      <p>{description}</p>
      {action}
    </section>
  );
}

export function Toast({ message, type = "success", actionLabel, onAction, onDismiss }) {
  useEffect(() => {
    if (!message) return undefined;
    const timeout = window.setTimeout(onDismiss, 5000);
    return () => window.clearTimeout(timeout);
  }, [message, onDismiss]);

  if (!message) return null;
  return (
    <div className={`class-toast class-toast-${type}`} role={type === "error" ? "alert" : "status"}>
      <Icon name={type === "error" ? "x" : "check"} size={17} />
      <span>{message}</span>
      {actionLabel ? (
        <button type="button" className="class-toast-action" onClick={onAction}>
          {actionLabel}
        </button>
      ) : null}
      <button type="button" className="class-toast-close" aria-label="Dismiss notification" onClick={onDismiss}>
        <Icon name="x" size={15} />
      </button>
    </div>
  );
}

export function ConfirmDialog({ title, description, confirmLabel, onConfirm, onCancel, busy = false }) {
  useEffect(() => {
    function closeOnEscape(event) {
      if (event.key === "Escape" && !busy) onCancel();
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [busy, onCancel]);

  return (
    <div className="confirm-backdrop">
      <section className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
        <span className="confirm-icon"><Icon name="users" size={22} /></span>
        <h2 id="confirm-title">{title}</h2>
        <p>{description}</p>
        <div className="confirm-actions">
          <button type="button" className="button button-secondary" onClick={onCancel} disabled={busy} autoFocus>Cancel</button>
          <button type="button" className="button button-primary" onClick={onConfirm} disabled={busy}>
            {busy ? "Saving…" : confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}
