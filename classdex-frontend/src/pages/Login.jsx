import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AuthLayout } from "../components/AuthLayout";
import { useAuth } from "../context/AuthContext";

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ email: "", password: "" });
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function update(field) {
    return (event) => setForm((prev) => ({ ...prev, [field]: event.target.value }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const user = await login(form);
      navigate(user.role === "FACULTY" ? "/faculty" : "/student", {
        replace: true,
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout
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
      <form className="space-y-4" onSubmit={handleSubmit}>
        <label className="block text-sm font-medium text-navy">
          Email
          <input
            required
            type="email"
            value={form.email}
            onChange={update("email")}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-ink outline-none focus:border-royal"
            autoComplete="email"
          />
        </label>

        <label className="block text-sm font-medium text-navy">
          Password
          <input
            required
            type="password"
            value={form.password}
            onChange={update("password")}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-ink outline-none focus:border-royal"
            autoComplete="current-password"
          />
        </label>

        {error ? (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-lg bg-navy py-2.5 text-sm font-semibold text-white hover:bg-royal disabled:opacity-70"
        >
          {submitting ? "Signing in…" : "Log in"}
        </button>
      </form>
    </AuthLayout>
  );
}
