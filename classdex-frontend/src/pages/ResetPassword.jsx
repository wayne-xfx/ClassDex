import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { AuthLayout } from "../components/AuthLayout";
import { Skeleton } from "../components/DesignSystem";
import Icon from "../components/Icon";
import PasswordField from "../components/PasswordField";
import PasswordRulesChecklist from "../components/PasswordRulesChecklist";
import { api } from "../api";
import {
  PASSWORD_MIN_LENGTH,
  validatePasswordWithConfirm,
} from "../utils/passwordValidator";

const STATE_COPY = {
  loading: {
    title: "Checking your reset link",
    subtitle: "Hold on a moment while we verify your single-use security link.",
  },
  valid: {
    title: "Choose a new password",
    subtitle: "Enter a new password for your ClassDex account below.",
  },
  expired: {
    title: "Reset link expired",
    subtitle: "For your security, password reset links are only valid for a limited time.",
  },
  used: {
    title: "Reset link already used",
    subtitle: "Each password reset link can only be used once.",
  },
  invalid: {
    title: "Invalid reset link",
    subtitle: "We couldn’t verify this password reset link.",
  },
  success: {
    title: "Password updated",
    subtitle: "Your new password is saved and ready to use.",
  },
};

export default function ResetPassword() {
  const [searchParams] = useSearchParams();
  const rawToken = (searchParams.get("token") || "").trim();

  const [validation, setValidation] = useState(() => ({
    checkedToken: rawToken ? null : "",
    status: rawToken ? "loading" : "invalid",
  }));
  const [overrideStatus, setOverrideStatus] = useState(null);
  const [form, setForm] = useState({ password: "", confirmPassword: "" });
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!rawToken) return undefined;
    let cancelled = false;

    api
      .validateResetToken(rawToken)
      .then((result) => {
        if (cancelled) return;
        if (result?.valid) {
          setValidation({ checkedToken: rawToken, status: "valid" });
        } else {
          const reason = ["expired", "used", "invalid"].includes(result?.reason)
            ? result.reason
            : "invalid";
          setValidation({ checkedToken: rawToken, status: reason });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setValidation({ checkedToken: rawToken, status: "invalid" });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [rawToken]);

  const activeStatus = overrideStatus
    ? overrideStatus
    : !rawToken
      ? "invalid"
      : validation.checkedToken === rawToken
        ? validation.status
        : "loading";

  const passwordCheck = validatePasswordWithConfirm(form.password, form.confirmPassword);
  const canSubmit = passwordCheck.valid && !submitting;

  function updateField(field) {
    return (event) => {
      const value = event.target.value;
      setForm((prev) => ({ ...prev, [field]: value }));
      if (error) setError("");
    };
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (!canSubmit) return;
    setError("");
    setSubmitting(true);

    try {
      await api.resetPassword({
        token: rawToken,
        password: form.password,
      });
      setOverrideStatus("success");
    } catch (requestError) {
      if (["expired", "used", "invalid"].includes(requestError.reason)) {
        setOverrideStatus(requestError.reason);
      } else {
        setError(requestError.message || "Unable to reset password right now. Please try again.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  const copy = STATE_COPY[activeStatus] || STATE_COPY.invalid;

  return (
    <AuthLayout
      showLnuLogo
      title={copy.title}
      subtitle={copy.subtitle}
      footer={
        activeStatus !== "success" ? (
          <Link to="/login" className="auth-back-link">
            <Icon name="chevron" size={15} />
            <span>Back to Login</span>
          </Link>
        ) : null
      }
    >
      {activeStatus === "loading" ? (
        <div className="reset-skeleton-stack" role="status" aria-live="polite" aria-label="Validating reset link">
          <Skeleton className="h-11 w-full rounded-xl" />
          <Skeleton className="h-11 w-full rounded-xl" />
          <Skeleton className="h-20 w-full rounded-xl" />
          <Skeleton className="h-11 w-full rounded-xl" />
        </div>
      ) : null}

      {activeStatus === "valid" ? (
        <form className="space-y-4" onSubmit={handleSubmit} noValidate>
          <PasswordField
            id="reset-new-password"
            label="New password"
            name="password"
            value={form.password}
            onChange={updateField("password")}
            autoComplete="new-password"
            minLength={PASSWORD_MIN_LENGTH}
            disabled={submitting}
          />

          <PasswordField
            id="reset-confirm-password"
            label="Confirm new password"
            name="confirmPassword"
            value={form.confirmPassword}
            onChange={updateField("confirmPassword")}
            autoComplete="new-password"
            minLength={PASSWORD_MIN_LENGTH}
            disabled={submitting}
          />

          <PasswordRulesChecklist
            password={form.password}
            confirmPassword={form.confirmPassword}
          />

          <div aria-live="polite">
            {error ? (
              <div className="auth-status-banner auth-status-error" role="alert">
                <Icon name="alert" size={16} />
                <span>{error}</span>
              </div>
            ) : null}
          </div>

          <button
            type="submit"
            disabled={!canSubmit}
            className="auth-submit-btn inline-flex w-full items-center justify-center gap-2 rounded-lg bg-navy py-2.5 text-sm font-semibold text-white hover:bg-royal disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Icon name="lock" size={16} />
            <span>{submitting ? "Resetting password…" : "Reset password"}</span>
          </button>
        </form>
      ) : null}

      {activeStatus === "expired" || activeStatus === "used" || activeStatus === "invalid" ? (
        <div className="auth-outcome-panel" role="alert" aria-live="polite">
          <div
            className={`auth-outcome-icon ${
              activeStatus === "expired" ? "auth-outcome-icon-warning" : "auth-outcome-icon-danger"
            }`}
            aria-hidden="true"
          >
            <Icon name={activeStatus === "expired" ? "clock" : "alert"} size={22} />
          </div>
          <p className="auth-outcome-lead">
            {activeStatus === "expired"
              ? "This password reset link has expired."
              : activeStatus === "used"
                ? "This password reset link has already been used."
                : "This password reset link is invalid or incomplete."}
          </p>
          <p className="auth-outcome-note">
            {activeStatus === "expired"
              ? "Request a fresh reset link below and complete the reset within 30 minutes."
              : activeStatus === "used"
                ? "If you still need to change your password, request a new single-use reset link below."
                : "Make sure you opened the complete link from your latest reset email, or request a new link below."}
          </p>
          <div className="auth-outcome-actions">
            <Link
              to="/forgot-password"
              className="auth-submit-btn inline-flex w-full items-center justify-center gap-2 rounded-lg bg-navy py-2.5 text-sm font-semibold text-white hover:bg-royal"
            >
              <Icon name="mail" size={16} />
              <span>Request a new link</span>
            </Link>
          </div>
        </div>
      ) : null}

      {activeStatus === "success" ? (
        <div className="auth-outcome-panel" role="status" aria-live="polite">
          <div className="auth-outcome-icon auth-outcome-icon-success" aria-hidden="true">
            <Icon name="shield" size={22} />
          </div>
          <p className="auth-outcome-lead">Your password has been reset successfully.</p>
          <p className="auth-outcome-note">
            Any earlier sessions on other devices have been signed out for your protection. Sign in now with your new password.
          </p>
          <div className="auth-outcome-actions">
            <Link
              to="/login"
              state={{ notice: "Your password has been reset. Sign in with your new password." }}
              className="auth-submit-btn inline-flex w-full items-center justify-center gap-2 rounded-lg bg-navy py-2.5 text-sm font-semibold text-white hover:bg-royal"
            >
              <span>Go to Login</span>
              <Icon name="arrow" size={16} />
            </Link>
          </div>
        </div>
      ) : null}
    </AuthLayout>
  );
}
