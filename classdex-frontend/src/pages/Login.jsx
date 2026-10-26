import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { AuthLayout } from "../components/AuthLayout";
import Icon from "../components/Icon";
import PasswordField from "../components/PasswordField";
import { useAuth } from "../context/AuthContext";

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [form, setForm] = useState({ email: "", password: "" });
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const statusNotice = location.state?.notice || "";

  function update(field) {
    return (event) => setForm((prev) => ({ ...prev, [field]: event.target.value }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const user = await login(form);
      const requestedPath = location.state?.from?.pathname;
      const safeRequestedPath =
        user.role === "STUDENT" && requestedPath?.startsWith("/join/")
          ? requestedPath
          : user.role === "FACULTY" && requestedPath?.startsWith("/faculty/")
            ? requestedPath
            : null;
      navigate(
        safeRequestedPath || (user.role === "FACULTY" ? "/faculty" : "/student"),
        {
          replace: true,
        },
      );
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout
      showLnuLogo
      title="Welcome back"
      subtitle="Sign in with the email and password you used to register."
      footer={
        <>
          New to ClassDex?{" "}
          <Link
            to="/register"
            className="font-semibold text-royal hover:underline"
          >
            Create an account
          </Link>
        </>
      }
    >
      {statusNotice ? (
        <div
          className="auth-status-banner auth-status-success mb-4"
          role="status"
          aria-live="polite"
        >
          <Icon name="check" size={16} />
          <span>{statusNotice}</span>
        </div>
      ) : null}

      <form className="space-y-4" onSubmit={handleSubmit}>
        <label htmlFor="login-email" className="block text-sm font-medium text-navy">
          Email
          <input
            id="login-email"
            required
            type="email"
            value={form.email}
            onChange={update("email")}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-ink outline-none focus:border-royal"
            autoComplete="email"
          />
        </label>

        <div>
          <PasswordField
            id="login-password"
            label="Password"
            name="password"
            value={form.password}
            onChange={update("password")}
            autoComplete="current-password"
          />
          <div className="mt-2 flex justify-end">
            <Link
              to="/forgot-password"
              className="auth-inline-link text-xs font-semibold text-royal hover:underline"
            >
              Forgot password?
            </Link>
          </div>
        </div>

        <div aria-live="polite">
          {error ? (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
              {error}
            </p>
          ) : null}
        </div>

        <button
          type="submit"
          disabled={submitting}
          className="auth-submit-btn w-full rounded-lg bg-navy py-2.5 text-sm font-semibold text-white hover:bg-royal disabled:opacity-70"
        >
          {submitting ? "Signing in…" : "Log in"}
        </button>
      </form>
    </AuthLayout>
  );
}
