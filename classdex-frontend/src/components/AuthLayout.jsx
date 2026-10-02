import { Link } from "react-router-dom";
import ThemeToggle from "./ThemeToggle";
import { Card } from "./DesignSystem";

export function Logo({ to = "/" }) {
  return (
    <Link to={to} className="brand" aria-label="ClassDex home">
      <img src="/classdex-logo.svg" alt="" className="brand-logo logo-light" />
      <img src="/classdex-logo-dark.svg" alt="" className="brand-logo logo-dark" />
    </Link>
  );
}

export function AuthLayout({ title, subtitle, children, footer }) {
  return (
    <div className="min-h-screen bg-paper">
      <div className="auth-theme-toggle"><ThemeToggle /></div>
      <div className="auth-layout-inner">
        <aside className="auth-brand-pane hidden lg:block">
          <Logo />
          <p className="mt-8 max-w-md text-sm uppercase tracking-[0.2em] text-royal">
            Leyte Normal University
          </p>
          <h1 className="mt-3 text-4xl font-semibold leading-tight text-navy">
            Your classroom index cards, digitized.
          </h1>
          <p className="mt-4 max-w-md text-slate-600">
            One reusable student card. Faster attendance. Fairer recitation.
            Clear records for every class.
          </p>
          <div className="card-stack mt-10 max-w-sm rounded-2xl border border-slate-200 bg-white p-5">
            <p className="text-xs font-semibold uppercase tracking-widest text-royal">
              Index card
            </p>
            <p className="mt-3 text-lg font-semibold text-navy">Student Profile</p>
            <div className="mt-4 space-y-2 text-sm text-slate-600">
              <p>Name · Program · Section</p>
              <p>Student ID · Email · Photo</p>
            </div>
          </div>
        </aside>

        <main className="auth-form-pane">
          <div className="mb-6 lg:hidden">
            <Logo />
          </div>
          <Card className="auth-card rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
            <h2 className="text-2xl font-semibold text-navy">{title}</h2>
            <p className="mt-2 text-sm text-slate-600">{subtitle}</p>
            <div className="mt-6">{children}</div>
          </Card>
          {footer ? (
            <p className="mt-5 text-center text-sm text-slate-600">{footer}</p>
          ) : null}
        </main>
      </div>
    </div>
  );
}
