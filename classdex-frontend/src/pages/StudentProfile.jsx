import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import AppShell from "../components/AppShell";
import Icon from "../components/Icon";
import { api } from "../api";
import { useAuth } from "../context/AuthContext";
import { uploadPhoto } from "../utils/photoUpload";

function emptyForm(user) {
  return {
    name: user?.name || "",
    address: "",
    program: "",
    section: "",
    studentId: "",
    photo: "",
    email: user?.email || "",
    birthdate: "",
  };
}

export default function StudentProfile() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState(() => emptyForm(user));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [idTouched, setIdTouched] = useState(false);
  const [error, setError] = useState("");
  const idInvalid = !/^\d{7}$/.test(form.studentId);

  useEffect(() => {
    let cancelled = false;
    api
      .studentProfile()
      .then(({ profile }) => {
        if (profile && !cancelled) {
          setForm({ ...emptyForm(user), ...profile, birthdate: profile.birthdate?.slice(0, 10) || "" });
        }
      })
      .catch((requestError) => {
        if (!cancelled) setError(requestError.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  function update(field) {
    return (event) => setForm((current) => ({ ...current, [field]: event.target.value }));
  }

  async function handlePhoto(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    setError("");
    setUploading(true);
    try {
      const photo = await uploadPhoto(file);
      setForm((current) => ({ ...current, photo }));
    } catch (uploadError) {
      setError(uploadError.message);
    } finally {
      setUploading(false);
      event.target.value = "";
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setIdTouched(true);
    setError("");
    if (idInvalid) return;
    setSaving(true);
    try {
      await api.saveStudentProfile(form);
      navigate("/student", { state: { notice: "Your index card has been saved." } });
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <AppShell active="profile">
      <div className="content-narrow">
        <Link to="/student" className="back-link"><Icon name="chevron" /> Dashboard</Link>
        <header className="page-heading">
          <span className="eyebrow"><Icon name="book" /> Your global index card</span>
          <h1>Student profile</h1>
          <p>This one card follows you into every class you join.</p>
        </header>
        <form className="panel profile-panel" onSubmit={handleSubmit}>
          {loading ? <p className="muted">Loading your index card…</p> : (
            <>
              <div className="photo-upload">
                <div className="photo-preview student-photo">
                  {form.photo ? <img src={form.photo} alt="Student profile" /> : <Icon name="camera" size={28} />}
                </div>
                <div>
                  <label className="button button-secondary file-button">
                    <Icon name="camera" /> {uploading ? "Uploading…" : form.photo ? "Change photo" : "Upload a photo *"}
                    <input type="file" accept="image/png,image/jpeg,image/webp" onChange={handlePhoto} />
                  </label>
                  <p className="field-hint">Required · JPG, PNG, or WebP · up to 5 MB</p>
                </div>
              </div>
              <div className="form-grid">
                <label className="field">
                  <span>Full name <b>*</b></span>
                  <input className="input" required value={form.name || ""} onChange={update("name")} autoComplete="name" />
                </label>
                <label className="field">
                  <span>Student ID <b>*</b></span>
                  <input
                    className={`input ${idTouched && idInvalid ? "input-invalid" : ""}`}
                    required
                    type="text"
                    inputMode="numeric"
                    maxLength={7}
                    pattern="\d{7}"
                    title="Enter exactly 7 digits, for example 2300039."
                    value={form.studentId || ""}
                    onChange={(event) => {
                      setForm((current) => ({ ...current, studentId: event.target.value }));
                      setIdTouched(true);
                    }}
                    onBlur={() => setIdTouched(true)}
                    aria-describedby="student-id-hint"
                  />
                  <span id="student-id-hint" className={idTouched && idInvalid ? "field-error" : "field-hint"}>
                    {idTouched && idInvalid ? "Enter exactly 7 digits (e.g. 2300039)." : "7 numbers, no letters or spaces."}
                  </span>
                </label>
                <label className="field">
                  <span>Email <b>*</b></span>
                  <input className="input" required type="email" value={form.email || ""} onChange={update("email")} autoComplete="email" />
                </label>
                <label className="field">
                  <span>Birthdate</span>
                  <input className="input" type="date" value={form.birthdate || ""} onChange={update("birthdate")} />
                </label>
                <label className="field">
                  <span>Program</span>
                  <input className="input" value={form.program || ""} onChange={update("program")} placeholder="e.g. BSEd English" />
                </label>
                <label className="field">
                  <span>Section</span>
                  <input className="input" value={form.section || ""} onChange={update("section")} placeholder="e.g. 3A" />
                </label>
                <label className="field field-wide">
                  <span>Address</span>
                  <textarea className="input textarea" rows="3" value={form.address || ""} onChange={update("address")} autoComplete="street-address" />
                </label>
              </div>
              {!form.photo ? <p className="notice notice-warm"><Icon name="camera" /> Add a profile photo before saving your index card.</p> : null}
              {error ? <p className="notice notice-error" role="alert">{error}</p> : null}
              <div className="form-actions">
                <Link to="/student" className="button button-quiet">Cancel</Link>
                <button className="button button-primary" type="submit" disabled={saving || uploading || !form.photo}>
                  {saving ? "Saving…" : "Save index card"} <Icon name="arrow" />
                </button>
              </div>
            </>
          )}
        </form>
      </div>
    </AppShell>
  );
}
