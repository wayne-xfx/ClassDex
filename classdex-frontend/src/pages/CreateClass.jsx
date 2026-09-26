import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import AppShell from "../components/AppShell";
import Icon from "../components/Icon";
import { api } from "../api";

export default function CreateClass() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ sectionName: "", classCode: "", description: "", schedule: "" });
  const [codeCheck, setCodeCheck] = useState(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const classCode = form.classCode.trim().toUpperCase();
  const validCode = /^[A-Z0-9-]{3,20}$/.test(classCode);
  const codeStatus = !form.classCode.trim()
    ? ""
    : !validCode
      ? "invalid"
      : codeCheck?.code === classCode
        ? codeCheck.error
          ? "unavailable"
          : codeCheck.available
            ? "available"
            : "taken"
        : "checking";

  useEffect(() => {
    if (!validCode) return undefined;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      api
        .checkClassCode(classCode)
        .then(({ available }) => {
          if (!cancelled) setCodeCheck({ code: classCode, available });
        })
        .catch(() => {
          if (!cancelled) setCodeCheck({ code: classCode, error: true });
        });
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [classCode, validCode]);

  function update(field) {
    return (event) => setForm((current) => ({ ...current, [field]: event.target.value }));
  }

  function suggestCode() {
    const suggestion = Math.random().toString(36).slice(2, 8).toUpperCase();
    setForm((current) => ({ ...current, classCode: suggestion }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setSaving(true);
    try {
      const { class: createdClass } = await api.createClass({ ...form, classCode });
      navigate("/faculty", { state: { notice: `${createdClass.sectionName} is ready. Invite code: ${createdClass.classCode}` } });
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <AppShell active="home">
      <div className="content-narrow">
        <Link to="/faculty" className="back-link"><Icon name="chevron" /> Dashboard</Link>
        <header className="page-heading">
          <span className="eyebrow"><Icon name="plus" /> New classroom</span>
          <h1>Create a class</h1>
          <p>Set up a class space and share its invite code with students.</p>
        </header>
        <form className="panel form-panel" onSubmit={handleSubmit}>
          <label className="field">
            <span>Section name <b>*</b></span>
            <input className="input" required value={form.sectionName} onChange={update("sectionName")} placeholder="e.g. BSEd English · Section 3A" autoFocus />
          </label>
          <label className="field">
            <span>Class code</span>
            <div className="input-with-action">
              <input
                className="input"
                minLength={3}
                maxLength={20}
                pattern="[A-Za-z0-9-]{3,20}"
                value={form.classCode}
                onChange={update("classCode")}
                placeholder="Leave blank to generate one"
                autoComplete="off"
              />
              <button type="button" className="button button-secondary" onClick={suggestCode}>Suggest code</button>
            </div>
            <span className={`field-hint ${codeStatus === "taken" || codeStatus === "invalid" ? "field-error" : codeStatus === "available" ? "field-success" : ""}`}>
              {codeStatus === "checking" ? "Checking code…" : codeStatus === "available" ? "This code is available." : codeStatus === "taken" ? "That code is taken. Try another." : codeStatus === "invalid" ? "Use 3–20 letters, numbers, or hyphens." : codeStatus === "unavailable" ? "Couldn’t check right now; the code will be checked when you save." : "Students can use this code or its invite link to join."}
            </span>
          </label>
          <label className="field">
            <span>Description</span>
            <textarea className="input textarea" rows="3" value={form.description} onChange={update("description")} placeholder="A short note about this class" />
          </label>
          <label className="field">
            <span>Schedule</span>
            <input className="input" value={form.schedule} onChange={update("schedule")} placeholder="e.g. M/W/F · 9:00–10:00 AM" />
          </label>
          {error ? <p className="notice notice-error" role="alert">{error}</p> : null}
          <div className="form-actions">
            <Link to="/faculty" className="button button-quiet">Cancel</Link>
            <button className="button button-primary" type="submit" disabled={saving || (form.classCode && !validCode)}>
              {saving ? "Creating class…" : "Create class"} <Icon name="arrow" />
            </button>
          </div>
        </form>
      </div>
    </AppShell>
  );
}
