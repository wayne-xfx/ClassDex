import { Link } from "react-router-dom";
import { Brand } from "../components/AppShell";
import Icon from "../components/Icon";
import ThemeToggle from "../components/ThemeToggle";

const FEATURES = [
  {
    number: "01",
    icon: "user",
    title: "One profile. Every class.",
    description: "A reusable student index card keeps names, IDs, programs, and sections together.",
  },
  {
    number: "02",
    icon: "check",
    title: "Attendance that keeps moving.",
    description: "Mark students one by one or update the full roster with clear, editable records.",
  },
  {
    number: "03",
    icon: "shuffle",
    title: "Fair, thoughtful recitation.",
    description: "Call from the students who are here, with a weighted option that favors quieter voices.",
  },
];

export default function Landing() {
  return (
    <div className="landing-page">
      <header className="landing-header">
        <div className="landing-header-inner">
          <Brand />
          <nav className="landing-nav" aria-label="Main navigation">
            <a href="#how-it-works">How it works</a>
            <ThemeToggle />
            <Link to="/login" className="landing-login">Log in</Link>
            <Link to="/register" className="button button-primary landing-register">Get started <Icon name="arrow" size={16} /></Link>
          </nav>
        </div>
      </header>

      <main className="landing-main">
        <section className="landing-hero">
          <div className="landing-copy">
            <span className="landing-kicker"><span /> Made for Leyte Normal University</span>
            <h1>Make every student <span>count.</span></h1>
            <p className="landing-lead">
              Your classroom, your roster, your call. ClassDex turns the familiar index card into a better way to manage class and bring every voice into the room.
            </p>
            <div className="landing-ctas">
              <Link to="/register" className="button button-primary landing-cta-primary">
                Create your free account <Icon name="arrow" size={17} />
              </Link>
              <Link to="/login" className="landing-cta-secondary">
                I already have an account <Icon name="chevron" size={15} />
              </Link>
            </div>
            <div className="landing-proof">
              <div className="landing-proof-avatars" aria-hidden="true">
                <span>F</span><span>S</span><span><Icon name="users" size={16} /></span>
              </div>
              <p><strong>For faculty and students</strong><br />Built around the way LNU classrooms work.</p>
            </div>
          </div>

          <div className="landing-visual" aria-label="Preview of a ClassDex student index card and attendance dashboard">
            <div className="landing-orbit landing-orbit-one" />
            <div className="landing-orbit landing-orbit-two" />
            <div className="landing-floating-note landing-note-top"><Icon name="check" size={15} /> Attendance saved</div>
            <article className="landing-preview-card">
              <div className="landing-card-top">
                <div>
                  <span className="landing-card-label"><Icon name="book" size={14} /> Student index card</span>
                  <h2>Juan Dela Cruz</h2>
                  <p>BSEd English <span>·</span> Section 3A</p>
                </div>
                <div className="landing-avatar" aria-hidden="true">JD</div>
              </div>
              <div className="landing-card-rule" />
              <dl className="landing-student-meta">
                <div><dt>Student ID</dt><dd>2300039</dd></div>
                <div><dt>Class status</dt><dd className="landing-present"><span /> Present</dd></div>
              </dl>
              <div className="landing-card-footer">
                <span><Icon name="pin" size={14} /> One profile, every class</span>
                <span className="landing-card-mark"><Icon name="check" size={14} /></span>
              </div>
            </article>
            <article className="landing-mini-panel">
              <div className="landing-mini-heading"><span>Today's attendance</span><strong>24 / 28</strong></div>
              <div className="landing-attendance-bar"><span /></div>
              <div className="landing-mini-legend">
                <span><i className="legend-present" /> Present</span>
                <span><i className="legend-late" /> Late</span>
                <span><i className="legend-unmarked" /> Unmarked</span>
              </div>
            </article>
            <div className="landing-floating-note landing-note-bottom"><Icon name="shuffle" size={15} /> A fairer way to call on students</div>
          </div>
        </section>

        <section className="landing-how" id="how-it-works">
          <div className="landing-section-heading">
            <span className="landing-section-label">A better class routine</span>
            <h2>Less time organizing.<br /><span>More time teaching.</span></h2>
            <p>Everything you need to keep your classroom in sync, all in one calm, clear space.</p>
          </div>
          <div className="landing-feature-grid">
            {FEATURES.map((feature) => (
              <article className="landing-feature" key={feature.number}>
                <div className="landing-feature-top">
                  <span className="landing-feature-icon"><Icon name={feature.icon} size={20} /></span>
                  <span className="landing-feature-number">{feature.number}</span>
                </div>
                <h3>{feature.title}</h3>
                <p>{feature.description}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="landing-bottom-cta">
          <div>
            <span>Ready when you are</span>
            <h2>Bring your classroom together.</h2>
          </div>
          <Link to="/register" className="button button-primary">Get started with ClassDex <Icon name="arrow" size={16} /></Link>
        </section>
      </main>

      <footer className="landing-footer">
        <Brand />
        <span>Designed for better classroom moments at Leyte Normal University.</span>
      </footer>
    </div>
  );
}
