import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import AppShell from "../components/AppShell";
import Icon from "../components/Icon";
import { api } from "../api";
import { useAuth } from "../context/AuthContext";

export default function StudentDashboard() {
  const { user } = useAuth();
  const location = useLocation();
  const [profile, setProfile] = useState(null);
  const [classes, setClasses] = useState([]);
  const [classCode, setClassCode] = useState("");
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState(location.state?.notice || "");

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.studentProfile(), api.studentClasses()])
      .then(([profileData, classData]) => {
        if (!cancelled) {
          setProfile(profileData.profile);
          setClasses(classData.classes);
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
  }, []);

  async function handleJoin(event) {
    event.preventDefault();
    setError("");
    setJoining(true);
    try {
      await api.joinClass(classCode);
      setNotice("You’ve joined the class. Welcome aboard!");
      setClassCode("");
      const result = await api.studentClasses();
      setClasses(result.classes);
    } catch (joinError) {
      setError(joinError.message);
    } finally {
      setJoining(false);
    }
  }

  return (
    <AppShell active="home">
      <div className="content-wide">
        <div className="dashboard-heading">
          <div>
            <span className="eyebrow"><Icon name="users" /> Student workspace</span>
            <h1>Hello, {profile?.name || user?.name?.split(" ")[0]}</h1>
            <p>Your index card and every class you’re part of.</p>
          </div>
          <Link to="/student/profile" className="button button-secondary"><Icon name="user" /> {profile ? "Edit index card" : "Create index card"}</Link>
        </div>
        {notice ? <p className="notice notice-success" role="status"><Icon name="check" /> {notice}</p> : null}
        {error ? <p className="notice notice-error" role="alert">{error}</p> : null}

        {!profile ? (
          <section className="profile-prompt student-prompt">
            <div className="prompt-icon"><Icon name="camera" size={21} /></div>
            <div className="prompt-copy">
              <strong>Your photo is needed to create your index card</strong>
              <p>Complete your global student profile once, then use it in every class.</p>
            </div>
            <Link to="/student/profile" className="button button-primary">Create profile <Icon name="arrow" /></Link>
          </section>
        ) : (
          <section className="join-panel">
            <div>
              <span className="eyebrow"><Icon name="plus" /> Join a class</span>
              <h2>Have an invite code?</h2>
              <p>Enter the code from your faculty member or open their invite link.</p>
            </div>
            <form onSubmit={handleJoin} className="join-form">
              <input className="input" aria-label="Class code" value={classCode} onChange={(event) => setClassCode(event.target.value.toUpperCase())} placeholder="e.g. ENG3A25" required />
              <button className="button button-primary" type="submit" disabled={joining}>{joining ? "Joining…" : "Join class"} <Icon name="arrow" /></button>
            </form>
          </section>
        )}

        <div className="section-heading">
          <div><h2>My classes</h2><p>{classes.length} {classes.length === 1 ? "class" : "classes"} joined</p></div>
        </div>
        {loading ? <div className="loading-card">Loading your classes…</div> : classes.length ? (
          <div className="class-grid student-class-grid">
            {classes.map((classRecord, index) => (
              <article className="class-card" key={classRecord.id} style={{ "--card-accent": index % 2 ? "var(--accent-teal)" : "var(--accent-amber)" }}>
                <div className="class-card-top"><span className="class-icon"><Icon name="book" /></span><span className="enrolled-pill">Enrolled</span></div>
                <p className="class-label">Section</p>
                <h3>{classRecord.sectionName}</h3>
                <div className="code-chip">Code <b>{classRecord.classCode}</b></div>
                <p className="class-schedule"><Icon name="clock" /> {classRecord.schedule || "Schedule not set"}</p>
                <p className="faculty-byline"><Icon name="user" /> {classRecord.faculty?.name || "Faculty"}</p>
              </article>
            ))}
          </div>
        ) : !loading && profile ? (
          <section className="empty-state">
            <div className="empty-art"><Icon name="users" size={28} /></div>
            <h3>No classes joined yet</h3>
            <p>Enter an invite code above, or open the class link your faculty shared.</p>
          </section>
        ) : null}
      </div>
    </AppShell>
  );
}
