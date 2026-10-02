import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import AppShell from "../components/AppShell";
import Icon from "../components/Icon";
import { api } from "../api";
import { useAuth } from "../context/AuthContext";
import { uploadPhoto } from "../utils/photoUpload";
import { PageHeader } from "../components/DesignSystem";

const EMPTY_FORM = {
  name: "",
  department: "",
  photo: "",
  email: "",
  contact: "",
};

export default function FacultyProfile() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ ...EMPTY_FORM, name: user?.name || "", email: user?.email || "" });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    api
      .facultyProfile()
      .then(({ profile }) => {
        if (profile && !cancelled) setForm({ ...EMPTY_FORM, ...profile });
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
  }, []);

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
    setError("");
    setSaving(true);
    try {
      await api.saveFacultyProfile(form);
      navigate("/faculty", { state: { notice: "Your profile has been saved." } });
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <AppShell active="profile">
      <div className="content-narrow">
        <Link to="/faculty" className="back-link"><Icon name="chevron" /> Dashboard</Link>
        <PageHeader
          eyebrow="Faculty card"
          icon="user"
          title="Your faculty profile"
          description="Share a few details with students. You can update this any time."
        />
        <form className="panel profile-panel" onSubmit={handleSubmit}>
          {loading ? <p className="muted">Loading your profile…</p> : (
            <>
              <div className="photo-upload">
                <div className="photo-preview">
                  {form.photo ? <img src={form.photo} alt="Faculty profile" /> : <Icon name="camera" size={28} />}
                </div>
                <div>
                  <label className="button button-secondary file-button">
                    <Icon name="camera" /> {uploading ? "Uploading…" : "Add a photo"}
                    <input type="file" accept="image/png,image/jpeg,image/webp" onChange={handlePhoto} disabled={uploading} />
                  </label>
                  <p className="field-hint">Optional · JPG, PNG, or WebP · up to 5 MB</p>
                </div>
              </div>
              <div className="form-grid">
                <label className="field">
                  <span>Full name</span>
                  <input className="input" value={form.name || ""} onChange={update("name")} autoComplete="name" />
                </label>
                <label className="field">
                  <span>Department or program</span>
                  <input className="input" value={form.department || ""} onChange={update("department")} placeholder="e.g. College of Education" />
                </label>
                <label className="field">
                  <span>Email</span>
                  <input className="input" type="email" value={form.email || ""} onChange={update("email")} autoComplete="email" />
                </label>
                <label className="field">
                  <span>Contact number</span>
                  <input className="input" type="tel" value={form.contact || ""} onChange={update("contact")} autoComplete="tel" />
                </label>
              </div>
              {error ? <p className="notice notice-error" role="alert">{error}</p> : null}
              <div className="form-actions">
                <Link to="/faculty" className="button button-quiet">Skip for now</Link>
                <button className="button button-primary" type="submit" disabled={saving || uploading}>
                  {saving ? "Saving…" : "Save profile"} <Icon name="arrow" />
                </button>
              </div>
            </>
          )}
        </form>
      </div>
    </AppShell>
  );
}
