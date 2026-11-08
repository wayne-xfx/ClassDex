import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import AppShell from "../components/AppShell";
import Avatar from "../components/Avatar";
import EmailVerificationBanner from "../components/EmailVerificationBanner";
import Icon from "../components/Icon";
import RecaptchaWidget from "../components/RecaptchaWidget";
import { api } from "../api";
import { useAuth } from "../context/AuthContext";
import { ErrorState, PageHeader } from "../components/DesignSystem";
import { getClassDisplay } from "../utils/classDisplay";
import { formatClassSchedule } from "../utils/schedule";
import { getScheduleStatus, partitionAndOrderClasses } from "../utils/classOrdering";
import { useNow } from "../utils/useNow";

const LEDGER_FIELDS = [
  { key: "attendance", label: "Attendance" },
  { key: "recitation", label: "Recitation" },
  { key: "activities", label: "Activities" },
  { key: "quiz", label: "Quiz" },
];

function isEmptySummaryValue(value) {
  if (value === null || value === undefined) return true;
  const normalized = String(value).trim();
  return !normalized || normalized === "-" || normalized === "—";
}

export default function StudentDashboard() {
  const { user, updateUser } = useAuth();
  const location = useLocation();
  const now = useNow();
  const [profile, setProfile] = useState(null);
  const [classes, setClasses] = useState([]);
  const [classCode, setClassCode] = useState("");
  const [loading, setLoading] = useState(true);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [loadError, setLoadError] = useState("");
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
          setLoadError("");
          setProfile(profileData.profile);
          if (profileData.profile?.photo) {
            updateUser?.({ photo: profileData.profile.photo });
          }
          setClasses(classData.classes);
        }
      })
      .catch((requestError) => {
        if (!cancelled) setLoadError(requestError.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [updateUser, reloadNonce]);

  function retryLoadDashboard() {
    setLoadError("");
    setLoading(true);
    setReloadNonce((current) => current + 1);
  }

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
      const joinedLabel = getClassDisplay(joinResult.enrollment?.class).label;
      setNotice(
        joinResult.status === "PENDING"
          ? joinResult.message || "Waiting for instructor approval."
          : joinedLabel
            ? `You joined ${joinedLabel}. Welcome aboard!`
            : "You joined the class. Welcome aboard!"
      );
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

  const liveStudentKey = useMemo(
    () =>
      classes
        .filter((item) => getScheduleStatus(item, now, { role: "STUDENT" }).isLive)
        .map((item) => item.id)
        .sort()
        .join(","),
    [classes, now],
  );

  const { live: liveClasses, rest: restClasses } = useMemo(
    () => partitionAndOrderClasses(classes, { role: "STUDENT", now }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [classes, liveStudentKey],
  );

  function renderStudentCard(classRecord, index, { isLive = false, scheduleStatus = null } = {}) {
    const isPending = classRecord.enrollmentStatus === "PENDING";
    const isDropped = classRecord.enrollmentStatus === "DROPPED";
    const isDeclined = classRecord.enrollmentStatus === "DECLINED";
    const display = getClassDisplay(classRecord);
    const instructorName =
      classRecord.faculty?.facultyProfile?.name ||
      classRecord.faculty?.name ||
      "Faculty";
    const cardAccent = isLive
      ? "var(--accent-teal)"
      : index % 3 === 1
        ? "var(--accent-teal)"
        : index % 3 === 2
          ? "var(--accent-amber)"
          : "var(--royal)";

    return (
      <article
        className={`class-card student-index-card${isPending ? " is-pending" : ""}${
          isLive ? " is-live-class" : ""
        }`}
        key={classRecord.id}
        style={{ "--card-accent": cardAccent }}
      >
        <div className="class-card-top student-card-top">
          <div className="student-card-eyebrow">
            <span className="class-icon">
              <Icon name="book" size={17} />
            </span>
            <span className="class-label">
              {display.hasCourse ? display.eyebrow : "Section"}
            </span>
          </div>
          <div className="class-card-badges">
            {isLive ? (
              <span className="enrolled-pill live-now-badge">
                <span className="live-now-dot" aria-hidden="true" />
                Live now
              </span>
            ) : null}
            {classRecord.archivedAt ? (
              <span className="enrolled-pill enrolled-pill-archived">Archived</span>
            ) : null}
            <span
              className={`enrolled-pill${
                isDropped || isDeclined
                  ? " enrolled-pill-dropped"
                  : classRecord.enrollmentStatus !== "APPROVED"
                    ? " enrolled-pill-pending"
                    : ""
              }`}
            >
              {isDropped
                ? "Dropped"
                : isPending
                  ? "Pending approval"
                  : isDeclined
                    ? "Declined"
                    : "Enrolled"}
            </span>
          </div>
        </div>

        <div className="student-card-heading">
          <div className="student-card-title-block">
            <h3 className="class-card-title" title={display.title}>
              {display.title}
            </h3>
            {display.sectionLine ? (
              <p className="class-card-section-line">{display.sectionLine}</p>
            ) : null}
          </div>
          <div className="code-chip">
            Code <b>{classRecord.classCode}</b>
          </div>
        </div>

        {isPending ? (
          <p className="student-pending-note" role="status">
            <Icon name="clock" size={13} />
            <span>Waiting for instructor approval</span>
          </p>
        ) : null}

        <div className="student-card-meta">
          <p className="class-schedule">
            <Icon name="clock" size={14} />
            <span>{formatClassSchedule(classRecord)}</span>
          </p>
          {isLive && scheduleStatus?.endsAt ? (
            <p className="live-window-status">
              <span className="live-now-dot" aria-hidden="true" />
              <span>Ends {scheduleStatus.endsAt} · {scheduleStatus.minutesLeft}m left</span>
            </p>
          ) : null}
          <p className="faculty-byline">
            <Avatar
              src={classRecord.faculty?.facultyProfile?.photo}
              name={instructorName}
              size="xs"
              className="faculty-byline-avatar"
            />
            <span>{instructorName}</span>
          </p>
        </div>

        <div
          className="student-class-summary student-ledger"
          aria-label="Class record summary"
        >
          {LEDGER_FIELDS.map(({ key, label }) => {
            const rawValue = classRecord.recordSummary?.[key];
            const empty = isEmptySummaryValue(rawValue);
            return (
              <div key={key} className="student-ledger-row">
                <span className="student-ledger-label">{label}</span>
                <span className="student-ledger-leader" aria-hidden="true" />
                {empty ? (
                  <span className="student-ledger-value is-empty">none yet</span>
                ) : (
                  <strong className="student-ledger-value">{rawValue}</strong>
                )}
              </div>
            );
          })}
        </div>

        <Link
          to={`/student/classes/${classRecord.id}`}
          className={`button ${isLive ? "button-primary" : "button-secondary"} student-class-action`}
        >
          View class record <Icon name="arrow" size={15} />
        </Link>
      </article>
    );
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
          action={
            <Link to="/student/profile" className="button button-secondary">
              <Avatar
                src={profile?.photo || user?.photo}
                name={profile?.name || user?.name}
                size="xs"
                className="dashboard-profile-avatar"
              />
              {profile ? "Edit index card" : "Create index card"}
            </Link>
          }
        />
        {notice ? (
          <p className="notice notice-success" role="status">
            <Icon name="check" /> {notice}
          </p>
        ) : null}
        {error ? (
          <p className="notice notice-error" role="alert">
            {error}
          </p>
        ) : null}

        <EmailVerificationBanner />

        {!loading && !loadError ? (
          !profile ? (
            <section className="profile-prompt student-prompt">
              <div className="prompt-icon">
                <Icon name="camera" size={21} />
              </div>
              <div className="prompt-copy">
                <strong>Your photo is needed to create your index card</strong>
                <p>Complete your global student profile once, then use it in every class.</p>
              </div>
              <Link to="/student/profile" className="button button-primary">
                Create profile <Icon name="arrow" />
              </Link>
            </section>
          ) : (
            <section className="join-panel">
              <div>
                <span className="eyebrow">
                  <Icon name="plus" /> Join a class
                </span>
                <h2>Have an invite code?</h2>
                <p>Enter the code from your faculty member or open their invite link.</p>
              </div>
              <form onSubmit={handleJoin} className="join-form">
                <input
                  className="input"
                  aria-label="Class code"
                  value={classCode}
                  onChange={(event) => setClassCode(event.target.value.toUpperCase())}
                  placeholder="e.g. ENG3A25"
                />
                <button
                  ref={submitButtonRef}
                  className="button button-primary"
                  type="submit"
                  disabled={joining}
                >
                  {joining ? "Joining…" : "Join class"} <Icon name="arrow" />
                </button>
              </form>
              {captchaOpen ? (
                <RecaptchaWidget
                  ref={captchaRef}
                  onChange={handleCaptchaChange}
                  onClose={() => setCaptchaOpen(false)}
                  returnFocusRef={submitButtonRef}
                />
              ) : null}
            </section>
          )
        ) : null}

        <div className="section-heading">
          <div>
            <h2>My classes</h2>
            <p>
              {classes.length} {classes.length === 1 ? "class" : "classes"} joined
            </p>
          </div>
        </div>
        {loading ? (
          <div className="loading-card student-loading-index-card">Loading your classes…</div>
        ) : loadError ? (
          <ErrorState
            title="Unable to load your dashboard"
            message={loadError}
            onRetry={retryLoadDashboard}
          />
        ) : classes.length ? (
          <div className="dashboard-classes-stack">
            {liveClasses.length > 0 ? (
              <section
                className="happening-now-section"
                aria-labelledby="student-happening-now-heading"
              >
                <div className="happening-now-header">
                  <div className="happening-now-title-row">
                    <span className="live-now-dot" aria-hidden="true" />
                    <h3 id="student-happening-now-heading">Happening now</h3>
                  </div>
                  <span className="happening-now-count">
                    {liveClasses.length}{" "}
                    {liveClasses.length === 1 ? "class" : "classes"} in session
                  </span>
                </div>
                <div className="class-grid student-class-grid">
                  {liveClasses.map((classRecord, index) =>
                    renderStudentCard(classRecord, index, {
                      isLive: true,
                      scheduleStatus: getScheduleStatus(classRecord, now, { role: "STUDENT" }),
                    }),
                  )}
                </div>
              </section>
            ) : null}

            {restClasses.length > 0 ? (
              <div className="dashboard-other-classes">
                {liveClasses.length > 0 ? (
                  <div className="dashboard-sub-heading">
                    <h3>Other classes</h3>
                  </div>
                ) : null}
                <div className="class-grid student-class-grid">
                  {restClasses.map((classRecord, index) =>
                    renderStudentCard(classRecord, index),
                  )}
                </div>
              </div>
            ) : null}
          </div>
        ) : !loading && profile ? (
          <section className="empty-state student-empty-index-card">
            <div className="empty-art">
              <Icon name="book" size={28} />
            </div>
            <h3>You haven't joined any class yet — your first class card will appear here</h3>
            <p>Enter an invite code above, or open the class link your faculty shared.</p>
          </section>
        ) : null}
      </div>
    </AppShell>
  );
}
