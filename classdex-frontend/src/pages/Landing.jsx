import { Link } from "react-router-dom";
import { Brand } from "../components/AppShell";
import ThemeToggle from "../components/ThemeToggle";

export default function Landing() {
  return (
    <div className="min-h-screen bg-paper">
      <header className="border-b border-slate-200 bg-white/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
          <Brand />
          <nav className="flex items-center gap-3">
            <ThemeToggle />
            <Link
              to="/login"
              className="rounded-lg px-4 py-2 text-sm font-medium text-navy hover:bg-slate-100"
            >
              Log in
            </Link>
            <Link
              to="/register"
              className="rounded-lg bg-navy px-4 py-2 text-sm font-medium text-white hover:bg-royal"
            >
              Register
            </Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-16">
        <section className="grid items-center gap-12 lg:grid-cols-2">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.22em] text-royal">
              For LNU faculty & students
            </p>
            <h1 className="mt-4 text-4xl font-semibold leading-tight text-navy sm:text-5xl">
              The digital index card for every classroom.
            </h1>
            <p className="mt-5 max-w-xl text-lg text-slate-600">
              ClassDex replaces paper index cards with one reusable student
              profile, class lists faculty can trust, and a fair shuffler for
              cold-calling present students.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                to="/register"
                className="rounded-lg bg-navy px-5 py-3 text-sm font-semibold text-white hover:bg-royal"
              >
                Create an account
              </Link>
              <Link
                to="/login"
                className="rounded-lg border border-navy px-5 py-3 text-sm font-semibold text-navy hover:bg-white"
              >
                Sign in
              </Link>
            </div>
          </div>

          <div className="relative mx-auto w-full max-w-md">
            <div className="absolute inset-x-8 top-6 h-full rounded-2xl bg-royal/15" />
            <div className="absolute inset-x-4 top-3 h-full rounded-2xl bg-navy/10" />
            <article className="relative rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-widest text-royal">
                    Index card
                  </p>
                  <h2 className="mt-2 text-2xl font-semibold text-navy">
                    Juan Dela Cruz
                  </h2>
                  <p className="text-sm text-slate-600">BSEd English · 3A</p>
                </div>
                <div className="grid h-16 w-16 place-items-center rounded-md bg-paper text-xs font-semibold text-navy">
                  Photo
                </div>
              </div>
              <dl className="mt-6 grid gap-3 text-sm text-slate-600">
                <div className="flex justify-between border-b border-dashed border-slate-200 pb-2">
                  <dt>Student ID</dt>
                  <dd className="font-medium text-navy">2300039</dd>
                </div>
                <div className="flex justify-between border-b border-dashed border-slate-200 pb-2">
                  <dt>Email</dt>
                  <dd className="font-medium text-navy">juan@lnu.edu.ph</dd>
                </div>
                <div className="flex justify-between">
                  <dt>Reusable across classes</dt>
                  <dd className="font-medium text-royal">Yes</dd>
                </div>
              </dl>
            </article>
          </div>
        </section>

        <section className="mt-20 grid gap-4 sm:grid-cols-3">
          {[
            {
              title: "One card, every class",
              body: "Students keep a single profile that follows them into every course they join.",
            },
            {
              title: "Join by link or code",
              body: "Faculty share an invite. Students enroll without paper signup sheets.",
            },
            {
              title: "Fair cold-calls next",
              body: "A shuffler will pick from students marked present — no more drawing names from a hat.",
            },
          ].map((item) => (
            <article
              key={item.title}
              className="rounded-2xl border border-slate-200 bg-white p-5"
            >
              <h3 className="font-semibold text-navy">{item.title}</h3>
              <p className="mt-2 text-sm text-slate-600">{item.body}</p>
            </article>
          ))}
        </section>
      </main>
    </div>
  );
}
