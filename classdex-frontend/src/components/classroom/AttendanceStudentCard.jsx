import Avatar from "../Avatar";
import Icon from "../Icon";
import {
  formatProgramSection,
  formatStudentDisplayName,
  formatStudentName,
} from "./studentNames";

const STATUS_CONFIG = {
  PRESENT: {
    label: "Present",
    icon: "check",
    colorClass: "status-present",
    btnActiveClass: "attendance-btn-present-active",
  },
  LATE: {
    label: "Late",
    icon: "clock",
    colorClass: "status-late",
    btnActiveClass: "attendance-btn-late-active",
  },
  ABSENT: {
    label: "Absent",
    icon: "alert",
    colorClass: "status-absent",
    btnActiveClass: "attendance-btn-absent-active",
  },
  UNMARKED: {
    label: "Unmarked",
    icon: "info",
    colorClass: "status-unmarked",
  },
};

const ACTION_STATUSES = ["PRESENT", "LATE", "ABSENT"];

export default function AttendanceStudentCard({
  student,
  status = "UNMARKED",
  effectiveAbsentCount = 0,
  layout = "grid",
  onStatusChange,
  pending = false,
  readOnly = false,
}) {
  const currentStatus = status || student.status || "UNMARKED";
  const statusCfg = STATUS_CONFIG[currentStatus] || STATUS_CONFIG.UNMARKED;
  const isOverLimit = effectiveAbsentCount >= 7;
  const displayName =
    formatStudentDisplayName(student.name, student) || formatStudentName(student.name);

  return (
    <article
      className={`attendance-student-card attendance-student-card-${layout} attendance-card-${currentStatus.toLowerCase()}`}
      data-student-id={student.id}
    >
      <div className="attendance-card-edge" aria-hidden="true" />
      <div className="attendance-card-body">
        <div className="attendance-card-header">
          <Avatar
            src={student.photo || student.photoUrl}
            name={student.name}
            size="md"
            className="attendance-card-photo"
          />
          <div className="attendance-card-identity">
            <h3 className="attendance-card-name" title={displayName}>
              {displayName}
            </h3>

            <div className="attendance-card-subinfo">
              <span className="attendance-card-id">ID {student.studentId}</span>
              <span className="attendance-card-dot" aria-hidden="true">·</span>
              <span className="attendance-card-program">
                {formatProgramSection(student.program, student.section) || "Student"}
              </span>
            </div>

            <div className="attendance-card-meta-row">
              <span
                className={`attendance-status-badge ${statusCfg.colorClass}`}
                title={`Status: ${statusCfg.label}`}
              >
                <Icon name={statusCfg.icon} size={13} />
                <span>{statusCfg.label}</span>
              </span>
              <span
                className={`attendance-absent-counter ${isOverLimit ? "is-warning" : ""}`}
                title={
                  isOverLimit
                    ? `Warning: Student has reached or exceeded 7 cumulative absences (${effectiveAbsentCount})`
                    : `Cumulative absences in this class: ${effectiveAbsentCount} of 7`
                }
              >
                {isOverLimit ? <Icon name="alert" size={13} /> : null}
                <span>Absences: {effectiveAbsentCount} of 7</span>
              </span>
            </div>
          </div>
        </div>

        {!readOnly ? (
          <div
            className="attendance-card-actions"
            role="group"
            aria-label={`Attendance options for ${displayName}`}
          >
            {ACTION_STATUSES.map((st) => {
              const cfg = STATUS_CONFIG[st];
              const isActive = currentStatus === st;
              return (
                <button
                  key={st}
                  type="button"
                  className={`attendance-action-btn attendance-action-btn-${st.toLowerCase()}${
                    isActive ? ` is-active ${cfg.btnActiveClass}` : ""
                  }`}
                  aria-pressed={isActive}
                  disabled={pending}
                  onClick={() => onStatusChange(isActive ? "UNMARKED" : st)}
                  title={
                    isActive
                      ? `Currently marked ${cfg.label}. Click to unmark.`
                      : `Mark ${displayName} as ${cfg.label}`
                  }
                >
                  <Icon name={cfg.icon} size={15} />
                  <span>{cfg.label}</span>
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
    </article>
  );
}
