import { useState } from "react";
import Icon from "./Icon";

export default function PasswordField({
  label,
  name,
  value,
  onChange,
  autoComplete,
  minLength,
  required = true,
  hint,
}) {
  const [visible, setVisible] = useState(false);

  return (
    <label className="block text-sm font-medium text-navy">
      {label}
      <span className="password-control">
        <input
          required={required}
          name={name}
          type={visible ? "text" : "password"}
          minLength={minLength}
          value={value}
          onChange={onChange}
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 pr-12 text-ink outline-none focus:border-royal"
          autoComplete={autoComplete}
        />
        <button
          type="button"
          className="password-toggle"
          onClick={() => setVisible((current) => !current)}
          aria-label={`${visible ? "Hide" : "Show"} ${label.toLowerCase()}`}
          aria-pressed={visible}
          title={`${visible ? "Hide" : "Show"} password`}
        >
          <Icon name={visible ? "eyeOff" : "eye"} size={18} />
        </button>
      </span>
      {hint ? <span className="mt-1 block text-xs font-normal text-slate-500">{hint}</span> : null}
    </label>
  );
}
