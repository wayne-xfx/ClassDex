import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import AppShell from "../components/AppShell";
import Icon from "../components/Icon";
import { api } from "../api";
import { useAuth } from "../context/AuthContext";

export default function FacultyDashboard() {
  const { user } = useAuth();
  const location = useLocation();
  const [classes, setClasses] = useState([]);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState(location.state?.notice || "");
  const [profilePromptDismissed, setProfilePromptDismissed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.facultyClasses(), api.facultyProfile()])
      .then(([classData, profileData]) => {
        if (cancelled) return;
        setClasses(classData.classes);
        setProfile(profileData.profile);
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

  async function copyInvite(classCode) {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/join/${classCode}`);
      setNotice("Invite link copied. Share it with your students.");
    } catch {
      setNotice(`Invite link: ${window.location.origin}/join/${classCode}`);
    }
  }

  return (
    <AppShell active="home">
      <div className="content-wide">
        <div className="dashboard-heading">
          <div>
            <span className="eyebrow"><Icon name="book" /> Faculty workspace</span>
            <h1>Welcome back, {profile?.name || user?.name?.split(" ")[0]}</h1>
            <p>All your classes, rosters, and invitations in one place.</p>
          </div>
          <Link to="/faculty/classes/new" className="button button-primary"><Icon name="plus" /> Create a class</Link>
        </div>

        {notice ? <p className="notice notice-success" role="status"><Icon name="check" /> {notice}</p> : null}
        {error ? <p className="notice notice-error" role="alert">{error}</p> : null}

        {!profile && !profilePromptDismissed ? (
          <section className="profile-prompt">
            <div className="prompt-icon"><Icon name="user" size={21} /></div>
            <div className="prompt-copy">
              <strong>Make your faculty card yours</strong>
              <p>Add your department and contact details. It’s optional and can be completed any time.</p>
            </div>
            <Link to="/faculty/profile" className="button button-secondary">Set up profile <Icon name="arrow" /></Link>
            <button type="button" className="prompt-skip" onClick={() => setProfilePromptDismissed(true)}>Skip for now</button>
          </section>
        ) : null}

        <div className="section-heading">
          <div>
            <h2>Your classes</h2>
            <p>{classes.length} {classes.length === 1 ? "class" : "classes"} created</p>
          </div>
          {profile ? <Link to="/faculty/profile" className="text-link"><Icon name="user" /> Edit profile</Link> : null}
        </div>

        {loading ? <div className="loading-card">Loading your classes…</div> : classes.length ? (
          <div className="class-grid">
            {classes.map((classRecord, index) => (
              <article className="class-card" key={classRecord.id} style={{ "--card-accent": index % 2 ? "var(--accent-teal)" : "var(--accent-amber)" }}>
                <div className="class-card-top">
                  <span className="class-icon"><Icon name="book" /></span>
                  <span className="class-count"><Icon name="users" /> {classRecord._count.enrollments}</span>
                </div>
                <p className="class-label">Section</p>
                <h3>{classRecord.sectionName}</h3>
                <div className="code-chip">Code <b>{classRecord.classCode}</b></div>
                <p className="class-schedule"><Icon name="clock" /> {classRecord.schedule || "Schedule not set"}</p>
                <div className="class-card-actions">
                  <Link to={`/faculty/classes/${classRecord.id}`} className="button button-primary button-small">Open class <Icon name="arrow" /></Link>
                  <button type="button" className="button button-secondary button-small" onClick={() => copyInvite(classRecord.classCode)}><Icon name="copy" /> Invite</button>
                </div>
              </article>
            ))}
          </div>
        ) : !loading ? (
          <section className="empty-state">
            <div className="empty-art"><Icon name="book" size={28} /></div>
            <h3>No classes yet</h3>
            <p>Create your first class to start building your classroom roster.</p>
            <Link to="/faculty/classes/new" className="button button-primary"><Icon name="plus" /> Create your first class</Link>
          </section>
        ) : null}
      </div>
    </AppShell>
  );
}
