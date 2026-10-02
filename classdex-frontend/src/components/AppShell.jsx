import { Link, NavLink, useNavigate } from "react-router-dom";
import { useState } from "react";
import { useAuth } from "../context/AuthContext";
import ThemeToggle from "./ThemeToggle";
import Icon from "./Icon";

export function Brand({ to = "/" }) {
  return (
    <Link to={to} className="brand" aria-label="ClassDex home">
      <img src="/classdex-logo.svg" alt="" className="brand-logo logo-light" />
      <img src="/classdex-logo-dark.svg" alt="" className="brand-logo logo-dark" />
    </Link>
  );
}

export default function AppShell({ children, active = "" }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState("");
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const faculty = user?.role === "FACULTY";
  const profilePath = faculty ? "/faculty/profile" : "/student/profile";

  async function handleLogout() {
    try {
      await logout();
      navigate("/", { replace: true });
    } catch (error) {
      setError(error.message);
    }
  }

  return (
    <div className="app-shell">
      <header className="app-header">
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
            <ThemeToggle />
            <div className="user-menu">
              <button
                type="button"
                className="user-menu-trigger"
                aria-expanded={userMenuOpen}
                aria-haspopup="menu"
                onClick={() => setUserMenuOpen((open) => !open)}
              >
                <span className="user-menu-avatar" aria-hidden="true">{user?.name?.charAt(0)?.toUpperCase() || "U"}</span>
                <span className="header-user">{user?.name}</span>
                <Icon name="chevron" size={14} />
              </button>
              {userMenuOpen ? (
                <div className="user-menu-popover" role="menu">
                  <Link to={profilePath} role="menuitem" onClick={() => setUserMenuOpen(false)}>
                    <Icon name="user" /> Profile
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
