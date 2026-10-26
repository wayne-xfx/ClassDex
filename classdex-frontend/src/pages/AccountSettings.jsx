import { useEffect, useState } from "react";
import AppShell from "../components/AppShell";
import { PageHeader } from "../components/DesignSystem";
import Icon from "../components/Icon";
import PasswordField from "../components/PasswordField";
import PasswordRulesChecklist from "../components/PasswordRulesChecklist";
import { api } from "../api";
import { useAuth } from "../context/AuthContext";
import {
  PASSWORD_MIN_LENGTH,
  validatePasswordWithConfirm,
} from "../utils/passwordValidator";

const INITIAL_FORM = {
  currentPassword: "",
  newPassword: "",
  confirmPassword: "",
};

export default function AccountSettings() {
  const { user, updateUser } = useAuth();
  const [form, setForm] = useState(INITIAL_FORM);
  const [formKey, setFormKey] = useState(0);
  const [fieldErrors, setFieldErrors] = useState({});
  const [bannerError, setBannerError] = useState("");
  const [toastMessage, setToastMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const hasToast = Boolean(toastMessage);

  useEffect(() => {
    if (!hasToast) return undefined;
    const timer = window.setTimeout(() => {
      setToastMessage("");
    }, 6000);
    return () => window.clearTimeout(timer);
  }, [hasToast, formKey]);

  const passwordCheck = validatePasswordWithConfirm(form.newPassword, form.confirmPassword);
  const canSubmit =
    Boolean(form.currentPassword) && passwordCheck.valid && !submitting;

  function handleFieldChange(field) {
    return (event) => {
      const value = event.target.value;
      setForm((prev) => ({ ...prev, [field]: value }));
      if (fieldErrors[field]) {
        setFieldErrors((prev) => ({ ...prev, [field]: "" }));
      }
      if (bannerError) {
        setBannerError("");
      }
    };
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (submitting) return;

    setBannerError("");
    const nextFieldErrors = {};

    if (!form.currentPassword) {
      nextFieldErrors.currentPassword = "Enter your current password.";
    }
    if (!passwordCheck.valid) {
      if (passwordCheck.message === "Passwords do not match.") {
        nextFieldErrors.confirmPassword = passwordCheck.message;
      } else {
        nextFieldErrors.newPassword = passwordCheck.message;
      }
    }

    if (Object.keys(nextFieldErrors).length > 0) {
      setFieldErrors(nextFieldErrors);
      return;
    }

    setFieldErrors({});
    setSubmitting(true);

    try {
      const response = await api.changePassword({
        currentPassword: form.currentPassword,
        newPassword: form.newPassword,
        confirmPassword: form.confirmPassword,
      });

      if (response?.user) {
        updateUser(response.user);
      }

      setForm(INITIAL_FORM);
      setFieldErrors({});
      setBannerError("");
      setFormKey((prev) => prev + 1);
      setToastMessage(
        response?.message ||
          "Your password has been updated. Other devices have been signed out.",
      );
    } catch (error) {
      if (
        error?.field &&
        ["currentPassword", "newPassword", "confirmPassword"].includes(error.field)
      ) {
        setFieldErrors({ [error.field]: error.message });
      } else {
        setBannerError(error?.message || "Unable to update your password right now.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AppShell active="settings">
      <div className="content-narrow settings-layout">
        <PageHeader
          eyebrow="Account security"
          icon="settings"
          title="Account Settings"
          description={`Signed in as ${user?.email || "your ClassDex account"}. Update your password below.`}
        />

        <section className="settings-card" aria-labelledby="change-password-heading">
          <div className="settings-card-header">
            <span className="settings-card-icon" aria-hidden="true">
              <Icon name="shield" size={20} />
            </span>
            <div>
              <h2 id="change-password-heading">Change password</h2>
              <p>
                Updating your password keeps this device signed in and signs out any earlier sessions on other browsers or devices.
              </p>
            </div>
          </div>

          <form
            key={formKey}
            className="settings-password-form"
            onSubmit={handleSubmit}
            noValidate
          >
            <PasswordField
              id="settings-current-password"
              label="Current password"
              name="currentPassword"
              value={form.currentPassword}
              onChange={handleFieldChange("currentPassword")}
              autoComplete="current-password"
              disabled={submitting}
              error={fieldErrors.currentPassword}
            />

            <PasswordField
              id="settings-new-password"
              label="New password"
              name="newPassword"
              value={form.newPassword}
              onChange={handleFieldChange("newPassword")}
              autoComplete="new-password"
              minLength={PASSWORD_MIN_LENGTH}
              disabled={submitting}
              error={fieldErrors.newPassword}
            />

            <PasswordField
              id="settings-confirm-password"
              label="Confirm new password"
              name="confirmPassword"
              value={form.confirmPassword}
              onChange={handleFieldChange("confirmPassword")}
              autoComplete="new-password"
              minLength={PASSWORD_MIN_LENGTH}
              disabled={submitting}
              error={fieldErrors.confirmPassword}
            />

            <PasswordRulesChecklist
              password={form.newPassword}
              confirmPassword={form.confirmPassword}
            />

            <div aria-live="polite">
              {bannerError ? (
                <div className="auth-status-banner auth-status-error" role="alert">
                  <Icon name="alert" size={16} />
                  <span>{bannerError}</span>
                </div>
              ) : null}
            </div>

            <div className="settings-form-actions">
              <button
                type="submit"
                disabled={!canSubmit}
                className="button button-primary settings-submit-btn"
              >
                <Icon name="lock" size={16} />
                <span>{submitting ? "Updating password…" : "Update password"}</span>
              </button>
            </div>
          </form>
        </section>

        {toastMessage ? (
          <div className="class-toast class-toast-success" role="status" aria-live="polite">
            <Icon name="check" size={16} />
            <span>{toastMessage}</span>
            <button
              type="button"
              className="class-toast-close"
              aria-label="Dismiss notification"
              onClick={() => setToastMessage("")}
            >
              <Icon name="x" size={15} />
            </button>
          </div>
        ) : null}
      </div>
    </AppShell>
  );
}
