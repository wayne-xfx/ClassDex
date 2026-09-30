import { useEffect } from "react";
import Icon from "./Icon";

export function Button({
  variant = "primary",
  size = "",
  className = "",
  type = "button",
  children,
  ...props
}) {
  return (
    <button
      type={type}
      className={`button button-${variant}${size ? ` button-${size}` : ""}${className ? ` ${className}` : ""}`}
      {...props}
    >
      {children}
    </button>
  );
}

export function Card({ as: Element = "div", className = "", children, ...props }) {
  return (
    <Element className={`panel${className ? ` ${className}` : ""}`} {...props}>
      {children}
    </Element>
  );
}

export function Input({ label, id, hint, error, className = "", ...props }) {
  return (
    <label className="field" htmlFor={id}>
      {label ? <span>{label}</span> : null}
      <input id={id} className={`input${error ? " input-invalid" : ""}${className ? ` ${className}` : ""}`} aria-invalid={Boolean(error)} {...props} />
      {error ? <span className="field-error">{error}</span> : hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  );
}

export function Select({ label, id, className = "", children, ...props }) {
  return (
    <label className="field" htmlFor={id}>
      {label ? <span>{label}</span> : null}
      <select id={id} className={`input design-select${className ? ` ${className}` : ""}`} {...props}>
        {children}
      </select>
    </label>
  );
}

export function Badge({ tone = "neutral", className = "", children, ...props }) {
  return <span className={`design-badge design-badge-${tone}${className ? ` ${className}` : ""}`} {...props}>{children}</span>;
}

export function Modal({ title, description, onClose, children, footer, labelledBy = "design-modal-title" }) {
  useEffect(() => {
    function closeOnEscape(event) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  return (
    <div className="design-modal-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="design-modal" role="dialog" aria-modal="true" aria-labelledby={labelledBy}>
        <button type="button" className="design-modal-close" aria-label="Close dialog" onClick={onClose}>
          <Icon name="x" />
        </button>
        <span className="eyebrow"><Icon name="sparkles" /> ClassDex</span>
        <h2 id={labelledBy}>{title}</h2>
        {description ? <p className="design-modal-description">{description}</p> : null}
        <div className="design-modal-content">{children}</div>
        {footer ? <div className="design-modal-footer">{footer}</div> : null}
      </section>
    </div>
  );
}

export function StatusPill({ tone = "neutral", icon = "check", children, ...props }) {
  return (
    <span className={`design-status-pill design-status-${tone}`} {...props}>
      <Icon name={icon} size={13} />
      {children}
    </span>
  );
}

export function PageHeader({ eyebrow, title, description, icon, action, className = "" }) {
  return (
    <header className={`page-heading design-page-header${className ? ` ${className}` : ""}`}>
      {eyebrow ? <span className="eyebrow">{icon ? <Icon name={icon} /> : null}{eyebrow}</span> : null}
      <div className="design-page-header-row">
        <div>
          <h1>{title}</h1>
          {description ? <p>{description}</p> : null}
        </div>
        {action ? <div className="design-page-header-action">{action}</div> : null}
      </div>
    </header>
  );
}

export function Skeleton({ className = "", ...props }) {
  return <div className={`design-skeleton${className ? ` ${className}` : ""}`} aria-hidden="true" {...props} />;
}
