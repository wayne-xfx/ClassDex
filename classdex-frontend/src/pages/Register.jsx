import { useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { AuthLayout } from "../components/AuthLayout";
import RecaptchaWidget from "../components/RecaptchaWidget";
import PasswordField from "../components/PasswordField";
import { useAuth } from "../context/AuthContext";
import {
  PASSWORD_MIN_LENGTH,
  PASSWORD_MISMATCH_MESSAGE,
  validatePasswordWithConfirm,
} from "../utils/passwordValidator";

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
  const location = useLocation();
  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
    confirmPassword: "",
    role: "FACULTY",
  });
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [captchaOpen, setCaptchaOpen] = useState(false);
  const captchaRef = useRef(null);
  const submitButtonRef = useRef(null);

  function update(field) {
    return (event) => setForm((prev) => ({ ...prev, [field]: event.target.value }));
  }

  function handleSubmit(event) {
    event.preventDefault();
    if (submitting) return;
    setError("");
    if (!ROLES.some((role) => role.value === form.role) || !form.name.trim()) {
      setError("Choose an account type and enter your full name.");
      return;
    }
    const passwordCheck = validatePasswordWithConfirm(form.password, form.confirmPassword);
    if (!passwordCheck.valid) {
      setError(passwordCheck.message);
      return;
    }
    setCaptchaOpen(true);
  }

  async function submitWithToken(recaptchaToken) {
    if (submitting) return;
    setSubmitting(true);
    try {
      const user = await register({ ...form, recaptchaToken });
      const requestedPath = location.state?.from?.pathname;
      const safeRequestedPath =
        user.role === "STUDENT" && requestedPath?.startsWith("/join/")
          ? requestedPath
          : user.role === "FACULTY" && requestedPath?.startsWith("/faculty/")
            ? requestedPath
            : null;
      navigate(safeRequestedPath || (user.role === "FACULTY" ? "/faculty" : "/student"), { replace: true });
    } catch (err) {
      setError(err.message);
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
            placeholder="e.g., Jose P. Rizal"
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-ink outline-none focus:border-royal"
            autoComplete="name"
          />
          <span className="mt-1 block text-xs text-slate-500">
            First name, middle initial, surname; add Jr./Sr./III at the end; &ldquo;Dela Cruz, Juan P.&rdquo; also works
          </span>
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

        <PasswordField
          label="Password"
          name="password"
          value={form.password}
          onChange={update("password")}
          autoComplete="new-password"
          minLength={PASSWORD_MIN_LENGTH}
          hint="At least 8 characters"
        />

        <PasswordField
          label="Confirm password"
          name="confirmPassword"
          value={form.confirmPassword}
          onChange={update("confirmPassword")}
          autoComplete="new-password"
          minLength={PASSWORD_MIN_LENGTH}
        />
        {form.confirmPassword && form.password !== form.confirmPassword ? (
          <p className="field-error" role="alert">{PASSWORD_MISMATCH_MESSAGE}</p>
        ) : null}

        {error ? (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        ) : null}

        <button
          ref={submitButtonRef}
          type="submit"
          disabled={submitting}
          className="w-full rounded-lg bg-navy py-2.5 text-sm font-semibold text-white hover:bg-royal disabled:opacity-70"
        >
          {submitting ? "Creating account…" : "Register"}
        </button>
      </form>
      {captchaOpen ? <RecaptchaWidget ref={captchaRef} onChange={handleCaptchaChange} onClose={() => setCaptchaOpen(false)} returnFocusRef={submitButtonRef} /> : null}
    </AuthLayout>
  );
}
