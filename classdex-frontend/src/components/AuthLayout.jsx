import { Link } from "react-router-dom";

export function Logo({ to = "/", light = false }) {
  return (
    <Link to={to} className="inline-flex items-center gap-2 no-underline">
      <span
        className={`grid h-9 w-9 place-items-center rounded-md border-2 text-sm font-bold ${
          light
            ? "border-white/70 bg-white/10 text-white"
            : "border-navy bg-white text-navy"
        }`}
      >
        CD
      </span>
      <span
        className={`text-lg font-semibold tracking-tight ${
          light ? "text-white" : "text-navy"
        }`}
      >
        ClassDex
      </span>
    </Link>
  );
}

export function AuthLayout({ title, subtitle, children, footer }) {
  return (
    <div className="min-h-screen bg-paper">
      <div className="mx-auto grid min-h-screen max-w-6xl items-center gap-10 px-4 py-10 lg:grid-cols-2">
        <aside className="hidden lg:block">
          <Logo />
          <p className="mt-8 max-w-md text-sm uppercase tracking-[0.2em] text-royal">
            Leyte Normal University
          </p>
          <h1 className="mt-3 text-4xl font-semibold leading-tight text-navy">
            Your classroom index cards, digitized.
          </h1>
          <p className="mt-4 max-w-md text-slate-600">
            One reusable student card. One faculty dashboard. Fair cold-calls
            later — clear records today.
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

        <main className="mx-auto w-full max-w-md">
          <div className="mb-6 lg:hidden">
            <Logo />
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
            <h2 className="text-2xl font-semibold text-navy">{title}</h2>
            <p className="mt-2 text-sm text-slate-600">{subtitle}</p>
            <div className="mt-6">{children}</div>
          </div>
          {footer ? (
            <p className="mt-5 text-center text-sm text-slate-600">{footer}</p>
          ) : null}
        </main>
      </div>
    </div>
  );
}
