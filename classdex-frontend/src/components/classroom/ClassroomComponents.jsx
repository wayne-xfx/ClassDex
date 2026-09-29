import { useEffect, useRef } from "react";
import Icon from "../Icon";

const STATUS_LABELS = {
  PRESENT: "Present",
  LATE: "Late",
  ABSENT: "Absent",
  UNMARKED: "Unmarked",
};

export function ModuleTabs({ active, onChange }) {
  const tabRefs = useRef([]);
  const tabs = [
    { id: "deck", label: "Class deck", icon: "book" },
    { id: "attendance", label: "Take attendance", icon: "check" },
    { id: "recitation", label: "Recitation", icon: "user" },
  ];

  function handleTabKeyDown(event, index) {
    const nextIndex = event.key === "ArrowRight"
      ? (index + 1) % tabs.length
      : event.key === "ArrowLeft"
        ? (index - 1 + tabs.length) % tabs.length
        : event.key === "Home"
          ? 0
          : event.key === "End"
            ? tabs.length - 1
            : -1;
    if (nextIndex < 0) return;
    event.preventDefault();
    onChange(tabs[nextIndex].id);
    tabRefs.current[nextIndex]?.focus();
  }

  return (
    <div className="module-tabs" role="tablist" aria-label="Class modules">
      {tabs.map((tab, index) => (
        <button
          className={`module-tab${active === tab.id ? " is-active" : ""}`}
          id={`module-tab-${tab.id}`}
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={active === tab.id}
          aria-controls={`module-panel-${tab.id}`}
          tabIndex={active === tab.id ? 0 : -1}
          ref={(element) => { tabRefs.current[index] = element; }}
          onKeyDown={(event) => handleTabKeyDown(event, index)}
          onClick={() => onChange(tab.id)}
        >
          <Icon name={tab.icon} size={17} />
          {tab.label}
        </button>
      ))}
      {["Activities", "Projects"].map((label) => (
        <button
          className="module-tab module-tab-disabled"
          key={label}
          type="button"
          disabled
          aria-label={`${label}, coming soon`}
        >
          {label}
          <span>Coming soon</span>
        </button>
      ))}
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

export function StudentCard({ student, status = "UNMARKED", children, layout = "grid" }) {
  return (
    <article className={`student-card student-card-${layout} student-card-${status.toLowerCase()}`}>
      <div className="student-card-edge" />
      <div className="student-card-content">
        <div className="student-card-identity">
          <div className="student-card-photo">
            {student.photo ? <img src={student.photo} alt="" /> : <Icon name="user" size={24} />}
          </div>
          <div className="student-card-copy">
            <h3>{student.name}</h3>
            <span className="student-card-id">ID {student.studentId}</span>
          </div>
          <span className={`student-status status-${status.toLowerCase()}`}>
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
        {children ? <div className="student-card-actions">{children}</div> : null}
      </div>
    </article>
  );
}

export function StatusButton({ status, active, disabled = false, onClick }) {
  const names = { PRESENT: "Present", LATE: "Late", ABSENT: "Absent" };
  const icons = { PRESENT: "check", LATE: "clock", ABSENT: "x" };
  return (
    <button
      type="button"
      className={`status-button status-button-${status.toLowerCase()}${active ? " is-active" : ""}`}
      aria-label={`${names[status]}${active ? " (selected; activate to clear)" : ""}`}
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
