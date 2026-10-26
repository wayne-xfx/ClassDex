import Icon from "./Icon";
import { evaluatePasswordRules } from "../utils/passwordValidator";

export default function PasswordRulesChecklist({
  password = "",
  confirmPassword = "",
  showMatch = true,
}) {
  const ruleResults = evaluatePasswordRules(password);
  const hasConfirmInput = String(confirmPassword).length > 0;
  const passwordsMatch = Boolean(password) && password === confirmPassword;

  return (
    <div
      className="password-checklist"
      role="region"
      aria-label="Password requirements"
      aria-live="polite"
    >
      <p className="password-checklist-title">Password checklist</p>
      <ul className="password-checklist-items">
        {ruleResults.map((rule) => (
          <li
            key={rule.id}
            className={`password-checklist-item ${
              rule.passed ? "is-passed" : "is-pending"
            }`}
          >
            <span className="password-checklist-indicator" aria-hidden="true">
              {rule.passed ? <Icon name="check" size={13} /> : <span className="password-checklist-dot" />}
            </span>
            <span>{rule.label}</span>
          </li>
        ))}
        {showMatch ? (
          <li
            className={`password-checklist-item ${
              !hasConfirmInput
                ? "is-pending"
                : passwordsMatch
                  ? "is-passed"
                  : "is-failed"
            }`}
          >
            <span className="password-checklist-indicator" aria-hidden="true">
              {!hasConfirmInput ? (
                <span className="password-checklist-dot" />
              ) : passwordsMatch ? (
                <Icon name="check" size={13} />
              ) : (
                <Icon name="x" size={13} />
              )}
            </span>
            <span>
              {!hasConfirmInput
                ? "Confirmation matches new password"
                : passwordsMatch
                  ? "Passwords match"
                  : "Passwords do not match"}
            </span>
          </li>
        ) : null}
      </ul>
    </div>
  );
}
