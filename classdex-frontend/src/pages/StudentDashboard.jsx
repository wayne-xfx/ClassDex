import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import AppShell from "../components/AppShell";
import Avatar from "../components/Avatar";
import Icon from "../components/Icon";
import RecaptchaWidget from "../components/RecaptchaWidget";
import { api } from "../api";
import { useAuth } from "../context/AuthContext";
import { PageHeader } from "../components/DesignSystem";
import { formatClassSchedule } from "../utils/schedule";

export default function StudentDashboard() {
  const { user, updateUser } = useAuth();
  const location = useLocation();
  const [profile, setProfile] = useState(null);
  const [classes, setClasses] = useState([]);
  const [classCode, setClassCode] = useState("");
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState(location.state?.notice || "");
  const [captchaOpen, setCaptchaOpen] = useState(false);
  const captchaRef = useRef(null);
  const submitButtonRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.studentProfile(), api.studentClasses()])
      .then(([profileData, classData]) => {
        if (!cancelled) {
          setProfile(profileData.profile);
          if (profileData.profile?.photo) {
            updateUser?.({ photo: profileData.profile.photo });
          }
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
  }, [updateUser]);

  function handleJoin(event) {
    event.preventDefault();
    if (joining) return;
    setError("");
    const normalizedCode = classCode.trim().toUpperCase();
    if (!normalizedCode) {
      setError("Enter a class invite code.");
      return;
    }
    if (!/^[A-Z0-9-]{3,20}$/.test(normalizedCode)) {
      setError("Use 3–20 letters, numbers, or hyphens.");
      return;
    }
    setCaptchaOpen(true);
  }

  async function joinWithToken(recaptchaToken) {
    if (joining) return;
    setJoining(true);
    try {
      const joinResult = await api.joinClass(classCode.trim().toUpperCase(), recaptchaToken);
      setClassCode("");
      setNotice(joinResult.status === "PENDING" ? joinResult.message || "Waiting for instructor approval." : "You joined the class. Welcome aboard!");
      const result = await api.studentClasses();
      setClasses(result.classes);
    } catch (joinError) {
      if (joinError.status === "PENDING" || joinError.status === "APPROVED") setNotice(joinError.message);
      else setError(joinError.message);
    } finally {
      setJoining(false);
      captchaRef.current?.reset();
      setCaptchaOpen(false);
    }
  }

  function handleCaptchaChange(token) {
    if (!token) return;
    captchaRef.current?.reset();
    setCaptchaOpen(false);
    void joinWithToken(token);
  }

  return (
    <AppShell active="home">
      <div className="content-wide">
        <PageHeader
          className="dashboard-heading"
          eyebrow="Student workspace"
          icon="users"
          title={`Hello, ${profile?.name || user?.name?.split(" ")[0]}`}
          description="Your index card and every class you’re part of."
          action={(
            <Link to="/student/profile" className="button button-secondary">
              <Avatar src={profile?.photo || user?.photo} name={profile?.name || user?.name} size="xs" className="dashboard-profile-avatar" />
              {profile ? "Edit index card" : "Create index card"}
            </Link>
          )}
        />
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
              <input className="input" aria-label="Class code" value={classCode} onChange={(event) => setClassCode(event.target.value.toUpperCase())} placeholder="e.g. ENG3A25" />
              <button ref={submitButtonRef} className="button button-primary" type="submit" disabled={joining}>{joining ? "Joining…" : "Join class"} <Icon name="arrow" /></button>
            </form>
            {captchaOpen ? <RecaptchaWidget ref={captchaRef} onChange={handleCaptchaChange} onClose={() => setCaptchaOpen(false)} returnFocusRef={submitButtonRef} /> : null}
          </section>
        )}

        <div className="section-heading">
          <div><h2>My classes</h2><p>{classes.length} {classes.length === 1 ? "class" : "classes"} joined</p></div>
        </div>
        {loading ? <div className="loading-card">Loading your classes…</div> : classes.length ? (
          <div className="class-grid student-class-grid">
            {classes.map((classRecord, index) => (
              <article className="class-card" key={classRecord.id} style={{ "--card-accent": index % 2 ? "var(--accent-teal)" : "var(--accent-amber)" }}>
                <div className="class-card-top"><span className="class-icon"><Icon name="book" /></span><span className={`enrolled-pill ${classRecord.enrollmentStatus !== "APPROVED" ? "enrolled-pill-pending" : ""}`}>{classRecord.enrollmentStatus === "PENDING" ? "Pending approval" : classRecord.enrollmentStatus === "DECLINED" ? "Declined" : "Enrolled"}</span></div>
                <p className="class-label">Section</p>
                <h3>{classRecord.sectionName}</h3>
                <div className="code-chip">Code <b>{classRecord.classCode}</b></div>
                <p className="class-schedule"><Icon name="clock" /> {formatClassSchedule(classRecord)}</p>
                <p className="faculty-byline">
                  <Avatar
                    src={classRecord.faculty?.facultyProfile?.photo}
                    name={classRecord.faculty?.facultyProfile?.name || classRecord.faculty?.name || "Faculty"}
                    size="xs"
                    className="faculty-byline-avatar"
                  />
                  {classRecord.faculty?.facultyProfile?.name || classRecord.faculty?.name || "Faculty"}
                </p>
                <div className="student-class-summary" aria-label="Class record summary">
                  {Object.entries(classRecord.recordSummary || { attendance: "—", recitation: "—", activities: "—", quiz: "—" }).map(([label, value]) => (
                    <span key={label}><b>{value}</b>{label}</span>
                  ))}
                </div>
                <Link to={`/student/classes/${classRecord.id}`} className="button button-secondary student-class-action">
                  View class record <Icon name="arrow" />
                </Link>
              </article>
            ))}
          </div>
        ) : !loading && profile ? (
          <section className="empty-state">
            <div className="empty-art"><Icon name="users" size={28} /></div>
            <h3>You haven’t joined any class yet</h3>
            <p>Enter an invite code above, or open the class link your faculty shared.</p>
          </section>
        ) : null}
      </div>
    </AppShell>
  );
}
