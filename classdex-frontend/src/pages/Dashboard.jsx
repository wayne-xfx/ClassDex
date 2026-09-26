import { useNavigate } from "react-router-dom";
import { Logo } from "../components/AuthLayout";
import { useAuth } from "../context/AuthContext";

export default function Dashboard({ roleLabel, nextHint }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  async function handleLogout() {
    await logout();
    navigate("/", { replace: true });
  }

  return (
    <div className="min-h-screen bg-paper">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
          <Logo to={user?.role === "FACULTY" ? "/faculty" : "/student"} />
          <button
            type="button"
            onClick={handleLogout}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-navy hover:bg-slate-50"
          >
            Log out
          </button>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-10">
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-royal">
          {roleLabel} dashboard
        </p>
        <h1 className="mt-2 text-3xl font-semibold text-navy">
          Hello, {user?.name}
        </h1>
        <p className="mt-2 text-slate-600">{nextHint}</p>
        <div className="card-stack mt-8 max-w-lg rounded-2xl border border-slate-200 bg-white p-6">
          <p className="text-xs font-semibold uppercase tracking-widest text-royal">
            Signed in as
          </p>
          <p className="mt-2 font-medium text-navy">{user?.email}</p>
          <p className="mt-1 text-sm text-slate-600">{roleLabel}</p>
        </div>
      </main>
    </div>
  );
}
