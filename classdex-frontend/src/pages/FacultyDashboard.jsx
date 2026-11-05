import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import AppShell from "../components/AppShell";
import EmailVerificationBanner from "../components/EmailVerificationBanner";
import Icon from "../components/Icon";
import { api } from "../api";
import { useAuth } from "../context/AuthContext";
import { PageHeader } from "../components/DesignSystem";
import { formatClassSchedule } from "../utils/schedule";

const PROMPT_DISMISSED_KEY = "classdex:faculty-profile-prompt-dismissed";

function isFacultyProfileComplete(profile, user) {
  if (!profile) return Boolean(user?.profileCompleted);
  if (typeof profile.profileCompleted === "boolean") return profile.profileCompleted;
  return Boolean(
    profile.department?.trim() ||
      profile.contact?.trim() ||
      profile.photo?.trim() ||
      user?.photo?.trim(),
  );
}

export default function FacultyDashboard() {
  const { user } = useAuth();
  const location = useLocation();
  const [classes, setClasses] = useState([]);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState(location.state?.notice || "");
  const [profilePromptDismissed, setProfilePromptDismissed] = useState(() => {
    try {
      return window.sessionStorage.getItem(PROMPT_DISMISSED_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [pendingCounts, setPendingCounts] = useState({});
  const pendingCountsInFlight = useRef(false);
  const [activeTab, setActiveTab] = useState("active");
  const [restoringId, setRestoringId] = useState(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.facultyClasses(), api.facultyProfile({ summary: true })])
      .then(([classData, profileData]) => {
        if (cancelled) return;
        setClasses(classData.classes || []);
        setProfile(profileData.profile || null);
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

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      if (pendingCountsInFlight.current) return;
      pendingCountsInFlight.current = true;
      try {
        const { counts } = await api.facultyPendingCounts();
        if (!cancelled) setPendingCounts(counts || {});
      } catch {
        // Keep the last successful notification counts if a refresh fails.
      } finally {
        pendingCountsInFlight.current = false;
      }
    };
    void refresh();
    const interval = window.setInterval(refresh, 30000);
    window.addEventListener("focus", refresh);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener("focus", refresh);
    };
  }, []);

  function dismissProfilePrompt() {
    setProfilePromptDismissed(true);
    try {
      window.sessionStorage.setItem(PROMPT_DISMISSED_KEY, "1");
    } catch {
      // Ignore storage errors
    }
  }

  async function copyInvite(classCode) {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/join/${classCode}`);
      setNotice("Invite link copied. Share it with your students.");
    } catch {
      setNotice(`Invite link: ${window.location.origin}/join/${classCode}`);
    }
  }

  async function handleRestore(classRecord) {
    setRestoringId(classRecord.id);
    setError("");
    try {
      const { class: restored } = await api.restoreClass(classRecord.id);
      setClasses((current) =>
        current.map((item) => (item.id === classRecord.id ? { ...item, ...restored, archivedAt: null } : item)),
      );
      setNotice(`${classRecord.sectionName} restored to your active classes.`);
      try {
        const { counts } = await api.facultyPendingCounts();
        setPendingCounts(counts || {});
      } catch {
        // Ignore background count refresh failure.
      }
    } catch (restoreError) {
      setError(restoreError.message);
    } finally {
      setRestoringId(null);
    }
  }

  const profileCompleted = isFacultyProfileComplete(profile, user);
  const displayName = profile?.name?.trim() || user?.name?.split(" ")[0] || "Faculty";
  const activeClasses = classes.filter((item) => !item.archivedAt);
  const archivedClasses = classes.filter((item) => Boolean(item.archivedAt));
  const visibleClasses = activeTab === "archived" ? archivedClasses : activeClasses;

  return (
    <AppShell active="home">
      <div className="content-wide faculty-dashboard-content">
        <PageHeader
          className="dashboard-heading"
          eyebrow="Faculty workspace"
          icon="book"
          title={`Welcome back, ${displayName}`}
          description="All your classes, student lists, and invitations in one place."
          action={<Link to="/faculty/classes/new" className="button button-primary"><Icon name="plus" /> Create a class</Link>}
        />

        {notice ? <p className="notice notice-success" role="status"><Icon name="check" /> {notice}</p> : null}
        {error ? <p className="notice notice-error" role="alert">{error}</p> : null}

        <EmailVerificationBanner />

        {!loading && !profileCompleted && !profilePromptDismissed ? (
          <section className="profile-banner-compact" aria-label="Complete faculty profile">
            <span className="profile-banner-icon" aria-hidden="true"><Icon name="user" size={16} /></span>
            <p className="profile-banner-text">
              <strong>Complete your faculty profile</strong> — add your department and contact details any time.
            </p>
            <div className="profile-banner-actions">
              <Link to="/faculty/profile" className="text-link">Set up profile</Link>
              <button type="button" className="prompt-skip" aria-label="Dismiss profile reminder" onClick={dismissProfilePrompt}>
                Dismiss
              </button>
            </div>
          </section>
        ) : null}

        <div className="section-heading">
          <div>
            <h2>Your classes</h2>
            <p>
              {activeTab === "archived"
                ? `${archivedClasses.length} archived ${archivedClasses.length === 1 ? "class" : "classes"}`
                : `${activeClasses.length} active ${activeClasses.length === 1 ? "class" : "classes"}`}
            </p>
          </div>
          {!loading && classes.length > 0 ? (
            <div className="dashboard-archive-tabs" role="tablist" aria-label="Filter classes by status">
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === "active"}
                className={`button button-small ${activeTab === "active" ? "button-primary" : "button-quiet"}`}
                onClick={() => setActiveTab("active")}
              >
                Active ({activeClasses.length})
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === "archived"}
                className={`button button-small ${activeTab === "archived" ? "button-primary" : "button-quiet"}`}
                onClick={() => setActiveTab("archived")}
              >
                <Icon name="archive" size={14} /> Archived ({archivedClasses.length})
              </button>
            </div>
          ) : null}
        </div>

        {loading ? <div className="loading-card">Loading your classes…</div> : visibleClasses.length ? (
          <div className="class-grid">
            {visibleClasses.map((classRecord, index) => {
              const isArchived = Boolean(classRecord.archivedAt);
              return (
                <article className="class-card" key={classRecord.id} style={{ "--card-accent": index % 2 ? "var(--accent-teal)" : "var(--accent-amber)" }}>
                  <div className="class-card-top">
                    <span className="class-icon"><Icon name="book" /></span>
                    <div className="class-card-counts">
                      <span className="class-count"><Icon name="users" /> {classRecord._count.enrollments}</span>
                      {isArchived ? (
                        <span className="enrolled-pill enrolled-pill-archived">
                          <Icon name="archive" size={13} /> Archived
                        </span>
                      ) : pendingCounts[classRecord.id] ? (
                        <Link
                          to={`/faculty/classes/${classRecord.id}?notifications=1`}
                          className="class-count class-pending-count"
                          aria-label={`${pendingCounts[classRecord.id]} class notification${pendingCounts[classRecord.id] === 1 ? "" : "s"}`}
                          title="Open class notifications"
                        >
                          <Icon name="bell" size={15} />
                          <span className="notification-badge">{pendingCounts[classRecord.id]}</span>
                        </Link>
                      ) : null}
                    </div>
                  </div>
                  <p className="class-label">Section</p>
                  <h3>{classRecord.sectionName}</h3>
                  <div className="code-chip">Code <b>{classRecord.classCode}</b></div>
                  <p className="class-schedule"><Icon name="clock" /> {formatClassSchedule(classRecord)}</p>
                  <div className="class-card-actions">
                    <Link to={`/faculty/classes/${classRecord.id}`} className="button button-primary button-small">Open class <Icon name="arrow" /></Link>
                    {isArchived ? (
                      <button
                        type="button"
                        className="button button-secondary button-small"
                        disabled={restoringId === classRecord.id}
                        onClick={() => handleRestore(classRecord)}
                      >
                        {restoringId === classRecord.id ? "Restoring…" : "Restore"}
                      </button>
                    ) : (
                      <button type="button" className="button button-secondary button-small" onClick={() => copyInvite(classRecord.classCode)}><Icon name="copy" /> Invite</button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        ) : !loading && classes.length > 0 ? (
          <section className="empty-state">
            <div className="empty-art"><Icon name={activeTab === "archived" ? "archive" : "book"} size={28} /></div>
            <h3>{activeTab === "archived" ? "No archived classes" : "No active classes"}</h3>
            <p>
              {activeTab === "archived"
                ? "Classes you archive at the end of a term will appear here in read-only mode."
                : "All of your classes are currently archived. Switch to the Archived tab to view or restore one, or create a new class."}
            </p>
            {activeTab === "active" ? (
              <Link to="/faculty/classes/new" className="button button-primary"><Icon name="plus" /> Create a class</Link>
            ) : null}
          </section>
        ) : !loading ? (
          <section className="empty-state">
            <div className="empty-art"><Icon name="book" size={28} /></div>
            <h3>No classes yet</h3>
            <p>Create your first class to start building your classroom student list.</p>
            <Link to="/faculty/classes/new" className="button button-primary"><Icon name="plus" /> Create your first class</Link>
          </section>
        ) : null}
      </div>
    </AppShell>
  );
}

