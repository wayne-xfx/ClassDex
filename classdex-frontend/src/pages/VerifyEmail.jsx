import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { AuthLayout } from "../components/AuthLayout";
import { Skeleton } from "../components/DesignSystem";
import Icon from "../components/Icon";
import { api } from "../api";
import { useAuth } from "../context/AuthContext";

// Guards against React StrictMode double-invoking the verify POST on initial mount
const verifyRequestCache = new Map();

function verifyTokenOnce(token) {
  let pending = verifyRequestCache.get(token);
  if (!pending) {
    pending = api
      .verifyEmail({ token })
      .then((result) => ({ ok: true, result }))
      .catch((error) => ({ ok: false, error }));
    verifyRequestCache.set(token, pending);
  }
  return pending;
}

const STATE_COPY = {
  loading: {
    title: "Verifying your email",
    subtitle: "Hold on a moment while we confirm your ClassDex email address.",
  },
  success: {
    title: "Email verified",
    subtitle: "Your email address is now confirmed on your ClassDex account.",
  },
  expired: {
    title: "Verification link expired",
    subtitle: "For your security, email verification links expire after 24 hours.",
  },
  used: {
    title: "Verification link already used",
    subtitle: "Each email verification link can only be used once.",
  },
  invalid: {
    title: "Invalid verification link",
    subtitle: "We couldn’t verify this email confirmation link.",
  },
};

export default function VerifyEmail() {
  const [searchParams] = useSearchParams();
  const rawToken = (searchParams.get("token") || "").trim();
  const { user, loading: authLoading, refreshUser } = useAuth();

  const [verification, setVerification] = useState(() => ({
    checkedToken: rawToken ? null : "",
    status: rawToken ? "loading" : "invalid",
  }));
  const [resending, setResending] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [resendFeedback, setResendFeedback] = useState(null);

  useEffect(() => {
    if (!rawToken) return undefined;
    let cancelled = false;

    verifyTokenOnce(rawToken).then(async (outcome) => {
      if (cancelled) return;
      if (outcome.ok) {
        await refreshUser();
        if (!cancelled) {
          setVerification({ checkedToken: rawToken, status: "success" });
        }
      } else {
        const reason = ["expired", "used", "invalid"].includes(outcome.error?.reason)
          ? outcome.error.reason
          : "invalid";
        setVerification({ checkedToken: rawToken, status: reason });
      }
    });

    return () => {
      cancelled = true;
    };
  }, [rawToken, refreshUser]);

  const isCountingDown = cooldown > 0;

  useEffect(() => {
    if (!isCountingDown) return undefined;
    const timer = window.setInterval(() => {
      setCooldown((prev) => (prev <= 1 ? 0 : prev - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [isCountingDown]);

  const activeStatus = !rawToken
    ? "invalid"
    : verification.checkedToken === rawToken
      ? verification.status
      : "loading";

  const copy = STATE_COPY[activeStatus] || STATE_COPY.invalid;
  const dashboardPath = user?.role === "FACULTY" ? "/faculty" : "/student";

  async function handleResend() {
    if (resending || cooldown > 0) return;
    setResending(true);
    setResendFeedback(null);

    try {
      const response = await api.resendVerification();
      if (response?.alreadyVerified) {
        await refreshUser();
        setResendFeedback({
          type: "success",
          message: "Your email address is already verified.",
        });
        return;
      }
      const nextCooldown = Number(response?.retryAfter) > 0 ? Math.ceil(Number(response.retryAfter)) : 60;
      setCooldown(nextCooldown);
      setResendFeedback({
        type: "success",
        message: response?.message || "A fresh verification link has been sent to your email.",
      });
    } catch (error) {
      const retryAfter = Number(error?.retryAfter);
      if (retryAfter > 0) {
        setCooldown(Math.ceil(retryAfter));
      }
      setResendFeedback({
        type: "error",
        message: error?.message || "Unable to resend verification email right now.",
      });
    } finally {
      setResending(false);
    }
  }

  return (
    <AuthLayout
      showLnuLogo
      title={copy.title}
      subtitle={copy.subtitle}
      footer={
        activeStatus !== "success" ? (
          <Link to={user ? dashboardPath : "/login"} className="auth-back-link">
            <Icon name="chevron" size={15} />
            <span>{user ? "Back to Dashboard" : "Back to Login"}</span>
          </Link>
        ) : null
      }
    >
      {activeStatus === "loading" ? (
        <div
          className="reset-skeleton-stack"
          role="status"
          aria-live="polite"
          aria-label="Verifying email address"
        >
          <Skeleton className="h-14 w-14 rounded-2xl" />
          <Skeleton className="h-6 w-3/4 rounded-lg" />
          <Skeleton className="h-12 w-full rounded-xl" />
          <Skeleton className="h-11 w-full rounded-xl" />
        </div>
      ) : null}

      {activeStatus === "success" ? (
        <div className="auth-outcome-panel" role="status" aria-live="polite">
          <div className="auth-outcome-icon auth-outcome-icon-success" aria-hidden="true">
            <Icon name="shield" size={22} />
          </div>
          <p className="auth-outcome-lead">Your email address has been verified.</p>
          <p className="auth-outcome-note">
            Thank you for confirming your email. Password recovery and important ClassDex account alerts are connected to your inbox.
          </p>
          <div className="auth-outcome-actions">
            {user ? (
              <Link
                to={dashboardPath}
                className="auth-submit-btn inline-flex w-full items-center justify-center gap-2 rounded-lg bg-navy py-2.5 text-sm font-semibold text-white hover:bg-royal"
              >
                <span>Continue to Dashboard</span>
                <Icon name="arrow" size={16} />
              </Link>
            ) : (
              <Link
                to="/login"
                state={{ notice: "Your email address has been verified. Sign in to continue." }}
                className="auth-submit-btn inline-flex w-full items-center justify-center gap-2 rounded-lg bg-navy py-2.5 text-sm font-semibold text-white hover:bg-royal"
              >
                <span>Go to Login</span>
                <Icon name="arrow" size={16} />
              </Link>
            )}
          </div>
        </div>
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
              ? "This verification link has expired."
              : activeStatus === "used"
                ? "This verification link has already been used."
                : "This verification link is invalid or incomplete."}
          </p>
          <p className="auth-outcome-note">
            {user?.emailVerified
              ? "Good news — your ClassDex email address is already verified."
              : activeStatus === "expired"
                ? "Request a fresh verification email below and open it within 24 hours."
                : activeStatus === "used"
                  ? "If your account still needs verification, you can send a new verification link below."
                  : "Make sure you opened the complete link from your latest verification email, or request a new one below."}
          </p>

          <div aria-live="polite">
            {resendFeedback ? (
              <div
                className={`auth-status-banner ${
                  resendFeedback.type === "error" ? "auth-status-error" : "auth-status-success"
                }`}
                role={resendFeedback.type === "error" ? "alert" : "status"}
              >
                <Icon name={resendFeedback.type === "error" ? "alert" : "check"} size={16} />
                <span>{resendFeedback.message}</span>
              </div>
            ) : null}
          </div>

          <div className="auth-outcome-actions">
            {authLoading ? null : user && !user.emailVerified ? (
              <button
                type="button"
                onClick={handleResend}
                disabled={resending || cooldown > 0}
                className="auth-submit-btn inline-flex w-full items-center justify-center gap-2 rounded-lg bg-navy py-2.5 text-sm font-semibold text-white hover:bg-royal disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Icon name="mail" size={16} />
                <span>
                  {resending
                    ? "Sending verification email…"
                    : cooldown > 0
                      ? `Resend in ${cooldown}s`
                      : "Resend verification email"}
                </span>
              </button>
            ) : user && user.emailVerified ? (
              <Link
                to={dashboardPath}
                className="auth-submit-btn inline-flex w-full items-center justify-center gap-2 rounded-lg bg-navy py-2.5 text-sm font-semibold text-white hover:bg-royal"
              >
                <span>Continue to Dashboard</span>
                <Icon name="arrow" size={16} />
              </Link>
            ) : (
              <Link
                to="/login"
                className="auth-submit-btn inline-flex w-full items-center justify-center gap-2 rounded-lg bg-navy py-2.5 text-sm font-semibold text-white hover:bg-royal"
              >
                <Icon name="lock" size={16} />
                <span>Log in to resend</span>
              </Link>
            )}
          </div>
        </div>
      ) : null}
    </AuthLayout>
  );
}
