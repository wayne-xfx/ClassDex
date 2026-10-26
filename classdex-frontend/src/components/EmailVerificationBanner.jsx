import { useEffect, useState } from "react";
import Icon from "./Icon";
import { api } from "../api";
import { useAuth } from "../context/AuthContext";

const DISMISS_STORAGE_PREFIX = "classdex:verify-email-banner-dismissed:";

function isDismissedInSession(userId) {
  if (!userId) return false;
  try {
    return window.sessionStorage.getItem(`${DISMISS_STORAGE_PREFIX}${userId}`) === "1";
  } catch {
    return false;
  }
}

export default function EmailVerificationBanner() {
  const { user, refreshUser } = useAuth();
  const [dismissedIds, setDismissedIds] = useState(() => new Set());
  const [sending, setSending] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [feedback, setFeedback] = useState(null);

  const isCountingDown = cooldown > 0;

  useEffect(() => {
    if (!isCountingDown) return undefined;
    const timer = window.setInterval(() => {
      setCooldown((prev) => (prev <= 1 ? 0 : prev - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [isCountingDown]);

  if (!user || user.emailVerified) {
    return null;
  }

  if (dismissedIds.has(user.id) || isDismissedInSession(user.id)) {
    return null;
  }

  function handleDismiss() {
    try {
      window.sessionStorage.setItem(`${DISMISS_STORAGE_PREFIX}${user.id}`, "1");
    } catch {
      // Ignore storage errors
    }
    setDismissedIds((prev) => {
      const next = new Set(prev);
      next.add(user.id);
      return next;
    });
  }

  async function handleResend() {
    if (sending || cooldown > 0) return;
    setSending(true);
    setFeedback(null);

    try {
      const response = await api.resendVerification();
      if (response?.alreadyVerified) {
        await refreshUser();
        return;
      }
      const nextCooldown = Number(response?.retryAfter) > 0 ? Math.ceil(Number(response.retryAfter)) : 60;
      setCooldown(nextCooldown);
      setFeedback({
        type: "success",
        message: response?.message || `Verification link sent to ${user.email}.`,
      });
    } catch (error) {
      const retryAfter = Number(error?.retryAfter);
      if (retryAfter > 0) {
        setCooldown(Math.ceil(retryAfter));
      }
      setFeedback({
        type: "error",
        message: error?.message || "Unable to send verification email right now.",
      });
    } finally {
      setSending(false);
    }
  }

  return (
    <section className="verify-email-banner" aria-label="Verify your email address">
      <div className="verify-email-banner-main">
        <span className="verify-email-banner-icon" aria-hidden="true">
          <Icon name="mail" size={18} />
        </span>
        <div className="verify-email-banner-copy">
          <p className="verify-email-banner-title">
            <strong>Verify your email address</strong>
            <span>
              We sent a verification link to <b>{user.email}</b>. Confirming your email keeps account recovery ready.
            </span>
          </p>
          <div aria-live="polite">
            {feedback ? (
              <p
                className={`verify-email-banner-feedback ${
                  feedback.type === "error" ? "is-error" : "is-success"
                }`}
                role={feedback.type === "error" ? "alert" : "status"}
              >
                <Icon name={feedback.type === "error" ? "alert" : "check"} size={14} />
                <span>{feedback.message}</span>
              </p>
            ) : null}
          </div>
        </div>
      </div>

      <div className="verify-email-banner-actions">
        <button
          type="button"
          className="verify-email-resend-btn"
          onClick={handleResend}
          disabled={sending || cooldown > 0}
        >
          <Icon name="refresh" size={14} />
          <span>
            {sending
              ? "Sending…"
              : cooldown > 0
                ? `Resend in ${cooldown}s`
                : "Resend Verification Email"}
          </span>
        </button>
        <button
          type="button"
          className="prompt-skip verify-email-dismiss-btn"
          aria-label="Dismiss email verification reminder for this session"
          onClick={handleDismiss}
        >
          Dismiss
        </button>
      </div>
    </section>
  );
}
