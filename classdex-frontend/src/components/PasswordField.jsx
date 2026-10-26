import { useId, useState } from "react";
import Icon from "./Icon";

export default function PasswordField({
  label,
  name,
  id,
  value,
  onChange,
  autoComplete,
  minLength,
  required = true,
  disabled = false,
  hint,
  error,
}) {
  const generatedId = useId();
  const inputId = id || generatedId;
  const messageId = `${inputId}-message`;
  const [visible, setVisible] = useState(false);

  return (
    <div className="block text-sm font-medium text-navy">
      <label htmlFor={inputId} className="block text-sm font-medium text-navy">
        {label}
      </label>
      <span className="password-control">
        <input
          id={inputId}
          required={required}
          disabled={disabled}
          name={name}
          type={visible ? "text" : "password"}
          minLength={minLength}
          value={value}
          onChange={onChange}
          aria-invalid={Boolean(error)}
          aria-describedby={error || hint ? messageId : undefined}
          className={`mt-1 w-full rounded-lg border px-3 py-2 pr-12 text-ink outline-none focus:border-royal disabled:opacity-60 ${
            error ? "border-red-500 input-invalid" : "border-slate-300"
          }`}
          autoComplete={autoComplete}
        />
        <button
          type="button"
          className="password-toggle"
          disabled={disabled}
          onClick={() => setVisible((current) => !current)}
          aria-label={`${visible ? "Hide" : "Show"} ${label.toLowerCase()}`}
          aria-pressed={visible}
          title={`${visible ? "Hide" : "Show"} password`}
        >
          <Icon name={visible ? "eyeOff" : "eye"} size={18} />
        </button>
      </span>
      {error ? (
        <span id={messageId} className="mt-1 block field-error" role="alert">
          {error}
        </span>
      ) : hint ? (
        <span id={messageId} className="mt-1 block text-xs font-normal text-slate-500">
          {hint}
        </span>
      ) : null}
    </div>
  );
}
