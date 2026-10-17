import { useEffect, useRef } from "react";
import Avatar from "../Avatar";
import Icon from "../Icon";

export const ABSENCE_WARNING_THRESHOLD = 7;

export default function PendingValidationList({
  enrollments = [],
  absenceWarnings = [],
  className = "",
  onApprove,
  onDecline,
  onDismissWarning,
  onClose,
  busyId,
  dismissBusyId,
}) {
  const dialogRef = useRef(null);
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialogRef.current?.focus();
    function onKeyDown(event) {
      if (event.key === "Escape") onClose();
      if (event.key === "Tab" && dialogRef.current) {
        const focusable = [...dialogRef.current.querySelectorAll("button")];
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  const hasNotifications = absenceWarnings.length > 0 || enrollments.length > 0;

  return (
    <div
      className="pending-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <aside
        className="pending-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pending-validation-title"
        tabIndex={-1}
        ref={dialogRef}
      >
        <div className="pending-heading">
          <div>
            <span className="eyebrow">
              <Icon name="bell" /> Faculty notifications
            </span>
            <h2 id="pending-validation-title">Notifications</h2>
            <p>Pending join requests and attendance drop warnings for {className || "this class"}.</p>
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label="Close notifications"
            onClick={onClose}
          >
            <Icon name="x" />
          </button>
        </div>

        {hasNotifications ? (
          <div className="notifications-sections">
            {absenceWarnings.length > 0 ? (
              <section className="notifications-section" aria-label="Attendance warnings">
                <div className="notifications-section-header">
                  <span>
                    <Icon name="alert" size={15} /> Drop warnings ({ABSENCE_WARNING_THRESHOLD}+ absences)
                  </span>
                  <span className="notification-badge notification-badge-danger">
                    {absenceWarnings.length}
                  </span>
                </div>
                <div className="pending-list">
                  {absenceWarnings.map((warning) => {
                    const student = warning.studentProfile;
                    const resolvedClassName = warning.className || className || "this class";
                    return (
                      <article className="pending-row pending-row-warning" key={warning.id || student.id}>
                        <Avatar
                          src={student.photo}
                          name={student.name}
                          size="md"
                          className="pending-photo pending-photo-warning"
                        />
                        <div className="pending-student">
                          <strong>
                            {student.name} has {warning.absenceCount} absences in {resolvedClassName} and may be subject to dropping
                          </strong>
                          <span>
                            ID {student.studentId} · {student.program || "Program not set"} · {student.section || "Section not set"}
                          </span>
                        </div>
                        <div className="pending-actions">
                          <button
                            type="button"
                            className="button button-secondary button-small"
                            disabled={dismissBusyId === student.id}
                            onClick={() => onDismissWarning?.(student.id)}
                          >
                            {dismissBusyId === student.id ? "Dismissing…" : "Dismiss"}
                          </button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </section>
            ) : null}

            <section className="notifications-section" aria-label="Pending join requests">
              <div className="notifications-section-header">
                <span>
                  <Icon name="userCheck" size={15} /> Pending validation
                </span>
                {enrollments.length ? (
                  <span className="notification-badge">{enrollments.length}</span>
                ) : null}
              </div>
              {enrollments.length ? (
                <div className="pending-list">
                  {enrollments.map((enrollment) => {
                    const student = enrollment.studentProfile;
                    return (
                      <article className="pending-row" key={enrollment.id}>
                        <Avatar src={student.photo} name={student.name} size="md" className="pending-photo" />
                        <div className="pending-student">
                          <strong>{student.name}</strong>
                          <span>
                            ID {student.studentId} · {student.program || "Program not set"} · {student.section || "Section not set"}
                          </span>
                          <small>Submitted {new Date(enrollment.joinedAt).toLocaleString()}</small>
                        </div>
                        <div className="pending-actions">
                          <button
                            type="button"
                            className="button button-primary"
                            disabled={busyId === enrollment.id}
                            onClick={() => onApprove(enrollment.id)}
                          >
                            Approve
                          </button>
                          <button
                            type="button"
                            className="button button-quiet pending-decline"
                            disabled={busyId === enrollment.id}
                            onClick={() => {
                              if (window.confirm("Decline this join request? The student may submit again later.")) {
                                onDecline(enrollment.id);
                              }
                            }}
                          >
                            Decline
                          </button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              ) : (
                <p className="notifications-section-empty">No pending join requests right now.</p>
              )}
            </section>
          </div>
        ) : (
          <div className="empty-state pending-empty">
            <Icon name="check" />
            <strong>All caught up</strong>
            <span>New unmatched join requests and 7-absence drop warnings will appear here.</span>
          </div>
        )}
      </aside>
    </div>
  );
}

