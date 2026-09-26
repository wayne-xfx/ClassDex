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
  const faculty = user?.role === "FACULTY";

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
            <span className="header-user">{user?.name}</span>
            <button
              type="button"
              className="icon-button logout-button"
              onClick={handleLogout}
              aria-label="Log out"
              title="Log out"
            >
              <Icon name="logout" />
            </button>
          </div>
        </div>
      </header>
      {error ? <p className="global-error" role="alert">{error}</p> : null}
      <main className="page-content">{children}</main>
    </div>
  );
}
