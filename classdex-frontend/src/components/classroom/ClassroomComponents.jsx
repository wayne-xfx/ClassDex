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

export function IndexCardView({
  student,
  className,
  classCode,
  statusBadges,
  banner,
  records,
  loading,
  error,
  variant = "dialog",
  onClose,
}) {
  const studentKey = student?.id ?? records?.student?.id ?? "__card__";
  const [flippedKey, setFlippedKey] = useState(null);
  const isFlipped = flippedKey === studentKey;
  const setIsFlipped = (next) => {
    setFlippedKey((prev) => {
      const currentlyFlipped = prev === studentKey;
      const shouldFlip = typeof next === "function" ? next(currentlyFlipped) : Boolean(next);
      return shouldFlip ? studentKey : null;
    });
  };
  const frontHeadingRef = useRef(null);
  const backHeadingRef = useRef(null);
  const sceneRef = useRef(null);
  const hasMountedRef = useRef(false);
  const isDialog = variant === "dialog";

  // Keyboard navigation: Esc to close (dialog only), F to toggle flip (when focus is inside card/dialog)
  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key === "Escape") {
        if (isDialog && onClose) {
          onClose();
        }
        return;
      }
      if (
        (event.key === "f" || event.key === "F") &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey
      ) {
        const activeEl = document.activeElement;
        const activeTag = activeEl?.tagName?.toLowerCase();
        if (
          activeTag === "input" ||
          activeTag === "textarea" ||
          activeTag === "select" ||
          activeEl?.isContentEditable
        ) {
          return;
        }
        const focusInsideCard = isDialog
          ? sceneRef.current?.contains(activeEl) || activeEl === document.body
          : Boolean(sceneRef.current?.contains(activeEl));
        if (focusInsideCard) {
          event.preventDefault();
          setFlippedKey((prev) => (prev === studentKey ? null : studentKey));
        }
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isDialog, onClose, studentKey]);

  // Focus visible face heading on flip (do not steal focus on initial mount in inline variant)
  useEffect(() => {
    if (!hasMountedRef.current) {
      hasMountedRef.current = true;
      if (isDialog) {
        frontHeadingRef.current?.focus();
      }
      return;
    }
    if (isFlipped) {
      backHeadingRef.current?.focus();
    } else {
      frontHeadingRef.current?.focus();
    }
  }, [isFlipped, isDialog]);

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

  const attendanceList = records?.attendance || [];
  const presentCount = attendanceList.filter((r) => r.status === "PRESENT").length;
  const lateCount = attendanceList.filter((r) => r.status === "LATE").length;
  const absentCount = attendanceList.filter((r) => r.status === "ABSENT").length;

  const recitationsList = records?.recitations || [];

  // Back face calculations
  const quizzes = records?.quizzes || [];
  const scoredQuizzes = quizzes.filter(
    (q) =>
      !q.isAbsent &&
      q.score !== null &&
      q.score !== undefined &&
      q.session?.totalItems > 0
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
    (a) =>
      !a.isAbsent &&
      a.score !== null &&
      a.score !== undefined &&
      a.activity?.maxScore > 0
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

  const projectOrder = { MIDTERM: 0, FINALS: 1 };
  const projects = [...(records?.projects || [])].sort(
    (a, b) =>
      (projectOrder[a.project?.type] ?? 99) -
      (projectOrder[b.project?.type] ?? 99)
  );
  const gradedProjects = projects.filter(
    (p) => !p.isAbsent && p.score !== null && p.score !== undefined
  );

  const studentObj = student || records?.student || {};
  const studentEmail = records?.student?.email || studentObj.email;
  const studentAddress = records?.student?.address || studentObj.address;

  return (
    <>
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {isFlipped
          ? "Showing back of card: quizzes, activities and projects"
          : "Showing front of card: profile, attendance and recitation"}
      </div>

      {banner ? <div className="index-card-banner-slot">{banner}</div> : null}

      <div
        ref={sceneRef}
        tabIndex={-1}
        className={`index-card-scene${isDialog ? "" : " index-card-scene-inline"}`}
        role={isDialog ? "dialog" : "region"}
        aria-modal={isDialog ? "true" : undefined}
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
                  src={studentObj.photo}
                  name={studentObj.name}
                  size="lg"
                  className="student-detail-photo"
                />
                <div className="student-detail-profile-text">
                  <span className="eyebrow">
                    <Icon name="book" size={13} /> {className}
                    {classCode ? ` · ${classCode}` : ""} · index card
                  </span>
                  <h2
                    id="student-detail-title"
                    ref={frontHeadingRef}
                    tabIndex={-1}
                  >
                    {formatStudentName(studentObj.name)}
                  </h2>
                  <p className="student-detail-id">
                    Student ID · {studentObj.studentId}
                  </p>
                </div>
              </div>

              <div className="index-card-header-actions">
                {statusBadges ? (
                  <div className="index-card-status-badges">{statusBadges}</div>
                ) : null}
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
                {isDialog && onClose ? (
                  <button
                    type="button"
                    className="student-detail-close"
                    aria-label="Close student profile"
                    onClick={onClose}
                  >
                    <Icon name="x" size={18} />
                  </button>
                ) : null}
              </div>
            </div>

            <div className="student-detail-info">
              <div>
                <span>Program</span>
                <strong>{studentObj.program || "Not provided"}</strong>
              </div>
              <div>
                <span>Section</span>
                <strong>{studentObj.section || "Not provided"}</strong>
              </div>
              {studentEmail ? (
                <div>
                  <span>Email</span>
                  <strong>{studentEmail}</strong>
                </div>
              ) : null}
              {studentAddress ? (
                <div>
                  <span>Address</span>
                  <strong>{studentAddress}</strong>
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
                      <div className="index-card-col-title-left">
                        <Icon name="clipboardCheck" size={15} />
                        <span>Attendance</span>
                      </div>
                      <span className="index-card-col-summary">
                        Present {presentCount} · Late {lateCount} · Absent {absentCount}
                      </span>
                    </h4>
                    <div className="index-card-records">
                      {attendanceList.length ? (
                        <ul className="index-card-list">
                          {attendanceList.map((record) => (
                            <li key={record.id} className="index-card-row">
                              <time dateTime={record.session?.date}>
                                {formatDate(record.session?.date)}
                              </time>
                              <span
                                className={`student-status status-${(record.status || "UNMARKED").toLowerCase()}`}
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
                      <div className="index-card-col-title-left">
                        <Icon name="message" size={15} />
                        <span>Recitation</span>
                      </div>
                      <span className="index-card-col-count">
                        ({recitationsList.length})
                      </span>
                    </h4>
                    <div className="index-card-records">
                      {recitationsList.length ? (
                        <ul className="index-card-list">
                          {recitationsList.map((record) => {
                            const calledDate = record.calledAt || record.session?.date;
                            return (
                              <li key={record.id} className="index-card-row">
                                <time dateTime={calledDate}>
                                  {formatDate(calledDate)}
                                </time>
                                <span className="index-card-mode">
                                  {formatMode(record.method || record.mode)}
                                </span>
                                {record.score === null || record.score === undefined ? (
                                  <span className="index-card-ungraded">
                                    Not scored
                                  </span>
                                ) : (
                                  <strong className="index-card-score">
                                    Score {record.score}
                                  </strong>
                                )}
                              </li>
                            );
                          })}
                        </ul>
                      ) : (
                        <p className="student-detail-message">
                          No recitation calls yet.
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
                  src={studentObj.photo}
                  name={studentObj.name}
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
                    {formatStudentName(studentObj.name)}
                  </h2>
                  <p className="student-detail-id">
                    Student ID · {studentObj.studentId}
                  </p>
                </div>
              </div>

              <div className="index-card-header-actions">
                {statusBadges ? (
                  <div className="index-card-status-badges">{statusBadges}</div>
                ) : null}
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
                {isDialog && onClose ? (
                  <button
                    type="button"
                    className="student-detail-close"
                    aria-label="Close student profile"
                    onClick={onClose}
                  >
                    <Icon name="x" size={18} />
                  </button>
                ) : null}
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
                                ) : quiz.score === null || quiz.score === undefined ? (
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
                                ) : act.score === null || act.score === undefined ? (
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
                          No activity scores yet.
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
                                ) : proj.score === null || proj.score === undefined ? (
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
                          No project scores yet.
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
    </>
  );
}

export function StudentDetailDialog({ student, className, classCode, statusBadges, banner, records, loading, error, onClose }) {
  return (
    <div
      className="student-detail-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose?.();
      }}
    >
      <IndexCardView
        variant="dialog"
        student={student}
        className={className}
        classCode={classCode}
        statusBadges={statusBadges}
        banner={banner}
        records={records}
        loading={loading}
        error={error}
        onClose={onClose}
      />
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
