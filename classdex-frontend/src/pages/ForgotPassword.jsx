import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { AuthLayout } from "../components/AuthLayout";
import Icon from "../components/Icon";
import RecaptchaWidget from "../components/RecaptchaWidget";
import { api } from "../api";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const GENERIC_CONFIRMATION =
  "If an account exists for that email, we've sent a reset link.";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [fieldError, setFieldError] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [confirmationMessage, setConfirmationMessage] = useState(GENERIC_CONFIRMATION);
  const [captchaOpen, setCaptchaOpen] = useState(false);
  const captchaRef = useRef(null);
  const submitButtonRef = useRef(null);

  function handleEmailChange(event) {
    const nextValue = event.target.value;
    setEmail(nextValue);
    if (fieldError && EMAIL_PATTERN.test(nextValue.trim())) {
      setFieldError("");
    }
    if (error) {
      setError("");
    }
  }

  function handleSubmit(event) {
    event.preventDefault();
    if (submitting) return;
    setError("");
    setFieldError("");

    const normalized = email.trim().toLowerCase();
    if (!normalized) {
      setFieldError("Enter your email address.");
      return;
    }
    if (!EMAIL_PATTERN.test(normalized)) {
      setFieldError("Enter a valid email address (for example, name@lnu.edu.ph).");
      return;
    }

    setCaptchaOpen(true);
  }

  async function submitWithToken(recaptchaToken) {
    if (submitting) return;
    const normalized = email.trim().toLowerCase();
    setSubmitting(true);
    try {
      const response = await api.forgotPassword({
        email: normalized,
        recaptchaToken,
      });
      setConfirmationMessage(response?.message || GENERIC_CONFIRMATION);
      setSubmitted(true);
    } catch (requestError) {
      setError(requestError.message || "Unable to send reset link right now. Please try again.");
    } finally {
      setSubmitting(false);
      captchaRef.current?.reset();
      setCaptchaOpen(false);
    }
  }

  function handleCaptchaChange(token) {
    if (!token) return;
    captchaRef.current?.reset();
    setCaptchaOpen(false);
    void submitWithToken(token);
  }

  return (
    <AuthLayout
      showLnuLogo
      title={submitted ? "Check your email" : "Forgot your password?"}
      subtitle={
        submitted
          ? "Follow the single-use link in your inbox to choose a new password."
          : "Enter the email address you use for ClassDex and we’ll send instructions to reset your password."
      }
      footer={
        <Link to="/login" className="auth-back-link">
          <Icon name="chevron" size={15} />
          <span>Back to Login</span>
        </Link>
      }
    >
      {submitted ? (
        <div className="auth-outcome-panel" role="status" aria-live="polite">
          <div className="auth-outcome-icon auth-outcome-icon-info" aria-hidden="true">
            <Icon name="mail" size={22} />
          </div>
          <p className="auth-outcome-lead">{confirmationMessage}</p>
          <p className="auth-outcome-note">
            Don’t see it after a minute? Check your spam or promotions folder. Reset links expire after 30 minutes for your security.
          </p>
          <div className="auth-outcome-actions">
            <Link
              to="/login"
              className="auth-submit-btn inline-flex w-full items-center justify-center gap-2 rounded-lg bg-navy py-2.5 text-sm font-semibold text-white hover:bg-royal"
            >
              <span>Back to Login</span>
              <Icon name="arrow" size={16} />
            </Link>
            <button
              type="button"
              className="auth-secondary-btn w-full"
              onClick={() => {
                setSubmitted(false);
                setError("");
                setFieldError("");
              }}
            >
              Try a different email address
            </button>
          </div>
        </div>
      ) : (
        <form className="space-y-4" onSubmit={handleSubmit} noValidate>
          <div>
            <label htmlFor="forgot-email" className="block text-sm font-medium text-navy">
              Email address
            </label>
            <div className="auth-input-wrap mt-1">
              <span className="auth-input-icon" aria-hidden="true">
                <Icon name="mail" size={17} />
              </span>
              <input
                id="forgot-email"
                name="email"
                type="email"
                required
                disabled={submitting}
                value={email}
                onChange={handleEmailChange}
                placeholder="you@example.com"
                autoComplete="email"
                aria-invalid={Boolean(fieldError)}
                aria-describedby={fieldError ? "forgot-email-error" : "forgot-email-hint"}
                className={`w-full rounded-lg border py-2 pr-3 pl-10 text-ink outline-none focus:border-royal disabled:opacity-60 ${
                  fieldError ? "border-red-500 input-invalid" : "border-slate-300"
                }`}
              />
            </div>
            {fieldError ? (
              <p id="forgot-email-error" className="mt-1.5 field-error" role="alert">
                {fieldError}
              </p>
            ) : (
              <p id="forgot-email-hint" className="mt-1.5 text-xs text-slate-500">
                Works for both Faculty and Student accounts.
              </p>
            )}
          </div>

          <div aria-live="polite">
            {error ? (
              <div className="auth-status-banner auth-status-error" role="alert">
                <Icon name="alert" size={16} />
                <span>{error}</span>
              </div>
            ) : null}
          </div>

          <button
            ref={submitButtonRef}
            type="submit"
            disabled={submitting}
            className="auth-submit-btn inline-flex w-full items-center justify-center gap-2 rounded-lg bg-navy py-2.5 text-sm font-semibold text-white hover:bg-royal disabled:cursor-not-allowed disabled:opacity-70"
          >
            <Icon name="mail" size={16} />
            <span>{submitting ? "Sending reset link…" : "Send reset link"}</span>
          </button>
        </form>
      )}
      {captchaOpen ? (
        <RecaptchaWidget
          ref={captchaRef}
          onChange={handleCaptchaChange}
          onClose={() => setCaptchaOpen(false)}
          returnFocusRef={submitButtonRef}
        />
      ) : null}
    </AuthLayout>
  );
}
