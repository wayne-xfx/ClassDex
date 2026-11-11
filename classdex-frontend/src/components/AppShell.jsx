import { Link, NavLink, useNavigate } from "react-router-dom";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { api } from "../api";
import Avatar from "./Avatar";
import ThemeToggle from "./ThemeToggle";
import Icon from "./Icon";
import { getClassDisplay } from "../utils/classDisplay";

export function Brand({ to = "/" }) {
  return (
    <Link to={to} className="brand" aria-label="ClassDex home">
      <img src="/classdex-logo.svg" alt="" className="brand-logo logo-light" />
      <img src="/classdex-logo-dark.svg" alt="" className="brand-logo logo-dark" />
    </Link>
  );
}

export default function AppShell({
  children,
  active = "",
  notificationCount,
  notificationsOpen = false,
  onToggleNotifications,
}) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState("");
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [globalBellOpen, setGlobalBellOpen] = useState(false);
  const [globalCounts, setGlobalCounts] = useState({});
  const [facultyClasses, setFacultyClasses] = useState([]);
  const [globalLoaded, setGlobalLoaded] = useState(false);

  const headerRef = useRef(null);
  const userMenuRef = useRef(null);
  const bellWrapRef = useRef(null);
  const bellButtonRef = useRef(null);
  const pollInFlightRef = useRef(false);

  const faculty = user?.role === "FACULTY";
  const profilePath = faculty ? "/faculty/profile" : "/student/profile";
  const isClassManagedNotifications = typeof onToggleNotifications === "function";

  useEffect(() => {
    const headerEl = headerRef.current;
    if (!headerEl || typeof ResizeObserver === "undefined") return undefined;
    const updateHeight = () => {
      const height = Math.ceil(headerEl.getBoundingClientRect().height);
      if (height > 0) {
        document.documentElement.style.setProperty("--app-header-height", `${height}px`);
      }
    };
    updateHeight();
    const observer = new ResizeObserver(updateHeight);
    observer.observe(headerEl);
    return () => observer.disconnect();
  }, []);

  const refreshGlobalNotifications = useCallback(async (fetchClassesToo = false) => {
    if (pollInFlightRef.current) return;
    pollInFlightRef.current = true;
    try {
      const requests = [api.facultyPendingCounts()];
      if (fetchClassesToo) {
        requests.push(api.facultyClasses());
      }
      const [countsData, classesData] = await Promise.all(requests);
      setGlobalCounts(countsData?.counts || {});
      if (classesData?.classes) {
        setFacultyClasses(classesData.classes);
      }
      setGlobalLoaded(true);
    } catch {
      setGlobalLoaded(true);
    } finally {
      pollInFlightRef.current = false;
    }
  }, []);

  useEffect(() => {
    if (!faculty || isClassManagedNotifications) return undefined;
    void refreshGlobalNotifications(true);
    const interval = window.setInterval(() => {
      void refreshGlobalNotifications(false);
    }, 30000);
    const onFocus = () => {
      void refreshGlobalNotifications(true);
    };
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, [faculty, isClassManagedNotifications, refreshGlobalNotifications]);

  useEffect(() => {
    if (!userMenuOpen && !globalBellOpen) return undefined;

    function handleMouseDown(event) {
      if (userMenuOpen && userMenuRef.current && !userMenuRef.current.contains(event.target)) {
        setUserMenuOpen(false);
      }
      if (globalBellOpen && bellWrapRef.current && !bellWrapRef.current.contains(event.target)) {
        setGlobalBellOpen(false);
      }
    }

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        if (globalBellOpen) {
          setGlobalBellOpen(false);
          bellButtonRef.current?.focus();
        }
        if (userMenuOpen) {
          setUserMenuOpen(false);
        }
      }
    }

    document.addEventListener("mousedown", handleMouseDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [globalBellOpen, userMenuOpen]);

  const classNotificationRows = useMemo(() => {
    const classById = new Map(facultyClasses.map((item) => [item.id, item]));
    return Object.entries(globalCounts)
      .map(([classId, rawCount]) => {
        const count = Number(rawCount) || 0;
        const classInfo = classById.get(classId);
        if (count <= 0 || classInfo?.archivedAt) return null;
        const display = getClassDisplay(classInfo);
        return {
          id: classId,
          label: display.label || "Class",
          sectionName: classInfo?.sectionName || "Class",
          classCode: classInfo?.classCode || "",
          count,
        };
      })
      .filter(Boolean);
  }, [facultyClasses, globalCounts]);

  const globalTotalCount = useMemo(
    () => classNotificationRows.reduce((sum, item) => sum + item.count, 0),
    [classNotificationRows],
  );

  const effectiveBellCount = isClassManagedNotifications
    ? Number(notificationCount) || 0
    : globalTotalCount;

  const isBellOpen = isClassManagedNotifications ? Boolean(notificationsOpen) : globalBellOpen;

  function handleBellClick() {
    setUserMenuOpen(false);
    if (isClassManagedNotifications) {
      onToggleNotifications();
      return;
    }
    setGlobalBellOpen((open) => {
      const next = !open;
      if (next) {
        void refreshGlobalNotifications(true);
      }
      return next;
    });
  }

  async function handleLogout() {
    try {
      await logout(() => navigate("/", { replace: true }));
    } catch (logoutError) {
      setError(logoutError.message);
    }
  }

  return (
    <div className="app-shell">
      <header className="app-header" ref={headerRef}>
        <div className="app-header-inner">
          <Brand to={faculty ? "/faculty" : "/student"} />
          <nav className="main-nav" aria-label="Main navigation">
            <NavLink
              to={faculty ? "/faculty" : "/student"}
              className={active === "home" ? "nav-link active" : "nav-link"}
            >
              <Icon name={faculty ? "book" : "users"} />
              <span>Dashboard</span>
            </NavLink>
            {faculty ? (
              <NavLink
                to="/faculty/profile"
                className={active === "profile" ? "nav-link active" : "nav-link"}
              >
                <Icon name="user" />
                <span>My profile</span>
              </NavLink>
            ) : (
              <NavLink
                to="/student/profile"
                className={active === "profile" ? "nav-link active" : "nav-link"}
              >
                <Icon name="user" />
                <span>My index card</span>
              </NavLink>
            )}
          </nav>
          <div className="header-actions">
            {faculty ? (
              <div className="header-notifications" ref={bellWrapRef}>
                <button
                  ref={bellButtonRef}
                  type="button"
                  className={`icon-button header-bell-trigger${isBellOpen ? " is-open" : ""}`}
                  aria-label={`Notifications${effectiveBellCount > 0 ? ` (${effectiveBellCount} unread)` : ""}`}
                  aria-expanded={isBellOpen}
                  aria-haspopup="dialog"
                  title="Notifications"
                  onClick={handleBellClick}
                >
                  <Icon name="bell" size={18} />
                  {effectiveBellCount > 0 ? (
                    <span className="notification-badge header-bell-badge">
                      {effectiveBellCount}
                    </span>
                  ) : null}
                </button>

                {!isClassManagedNotifications && globalBellOpen ? (
                  <div
                    className="header-notifications-popover"
                    role="dialog"
                    aria-label="Class notifications"
                  >
                    <div className="header-notifications-head">
                      <strong>Notifications</strong>
                      {effectiveBellCount > 0 ? (
                        <span className="notification-badge">{effectiveBellCount} unread</span>
                      ) : null}
                    </div>
                    {!globalLoaded ? (
                      <div className="header-notifications-empty" role="status">
                        <span>Loading notifications…</span>
                      </div>
                    ) : classNotificationRows.length > 0 ? (
                      <div className="header-notifications-list">
                        {classNotificationRows.map((item) => (
                          <Link
                            key={item.id}
                            to={`/faculty/classes/${item.id}?notifications=1`}
                            className="header-notification-item"
                            onClick={() => setGlobalBellOpen(false)}
                          >
                            <div className="header-notification-copy">
                              <strong>{item.label}</strong>
                              {item.classCode ? <span>Code {item.classCode}</span> : null}
                            </div>
                            <span className="notification-badge">{item.count}</span>
                            <Icon name="chevron" size={14} />
                          </Link>
                        ))}
                      </div>
                    ) : (
                      <div className="header-notifications-empty">
                        <Icon name="check" size={16} />
                        <span>All caught up — no unread notifications.</span>
                      </div>
                    )}
                  </div>
                ) : null}
              </div>
            ) : null}

            <ThemeToggle />

            <div className="user-menu" ref={userMenuRef}>
              <button
                type="button"
                className="user-menu-trigger"
                aria-expanded={userMenuOpen}
                aria-haspopup="menu"
                onClick={() => {
                  setGlobalBellOpen(false);
                  setUserMenuOpen((open) => !open);
                }}
              >
                <Avatar src={user?.photo} name={user?.name} size="sm" className="user-menu-avatar" />
                <span className="header-user">{user?.name}</span>
                <Icon name="chevron" size={14} />
              </button>
              {userMenuOpen ? (
                <div className="user-menu-popover" role="menu">
                  <Link to={profilePath} role="menuitem" onClick={() => setUserMenuOpen(false)}>
                    <Icon name="user" /> Profile
                  </Link>
                  <Link to="/settings" role="menuitem" onClick={() => setUserMenuOpen(false)}>
                    <Icon name="settings" /> Account settings
                  </Link>
                  <button type="button" role="menuitem" onClick={handleLogout}>
                    <Icon name="logout" /> Log out
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </header>
      {error ? <p className="global-error" role="alert">{error}</p> : null}
      <main className="page-content">{children}</main>
    </div>
  );
}
