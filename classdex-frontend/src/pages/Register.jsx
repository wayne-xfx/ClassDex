import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AuthLayout } from "../components/AuthLayout";
import { useAuth } from "../context/AuthContext";

const ROLES = [
  {
    value: "FACULTY",
    label: "Faculty",
    hint: "Create classes and manage records",
  },
  {
    value: "STUDENT",
    label: "Student",
    hint: "Carry one index card across classes",
  },
];

export default function Register() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
    role: "FACULTY",
  });
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
      const user = await register(form);
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
      title="Create your account"
      subtitle="Choose Faculty or Student so ClassDex can open the right dashboard."
      footer={
        <>
          Already have an account?{" "}
          <Link to="/login" className="font-semibold text-royal hover:underline">
            Log in
          </Link>
        </>
      }
    >
      <form className="space-y-4" onSubmit={handleSubmit}>
        <fieldset>
          <legend className="mb-2 text-sm font-medium text-navy">I am a</legend>
          <div className="grid grid-cols-2 gap-3">
            {ROLES.map((role) => {
              const selected = form.role === role.value;
              return (
                <label
                  key={role.value}
                  className={`cursor-pointer rounded-xl border p-3 text-left ${
                    selected
                      ? "border-royal bg-royal/5 ring-2 ring-royal/20"
                      : "border-slate-200 hover:border-navy/40"
                  }`}
                >
                  <input
                    type="radio"
                    name="role"
                    value={role.value}
                    checked={selected}
                    onChange={update("role")}
                    className="sr-only"
                  />
                  <span className="block text-sm font-semibold text-navy">
                    {role.label}
                  </span>
                  <span className="mt-1 block text-xs text-slate-600">
                    {role.hint}
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>

        <label className="block text-sm font-medium text-navy">
          Full name
          <input
            required
            value={form.name}
            onChange={update("name")}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-ink outline-none focus:border-royal"
            autoComplete="name"
          />
        </label>

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
            minLength={8}
            value={form.password}
            onChange={update("password")}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-ink outline-none focus:border-royal"
            autoComplete="new-password"
          />
          <span className="mt-1 block text-xs font-normal text-slate-500">
            At least 8 characters
          </span>
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
          {submitting ? "Creating account…" : "Register"}
        </button>
      </form>
    </AuthLayout>
  );
}
