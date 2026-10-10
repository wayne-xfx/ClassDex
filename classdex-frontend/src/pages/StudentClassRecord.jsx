import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import AppShell from "../components/AppShell";
import Icon from "../components/Icon";
import { Badge, Card, PageHeader, Skeleton } from "../components/DesignSystem";
import { api } from "../api";

const MOCK_SUMMARY = [
  { label: "Attendance", value: "92%", tone: "present" },
  { label: "Recitation", value: "4.6 / 5", tone: "late" },
  { label: "Quiz", value: "88%", tone: "neutral" },
  { label: "Projects", value: "94%", tone: "present" },
];

const MOCK_ATTENDANCE = [
  { date: "2026-10-10", label: "Present" },
  { date: "2026-10-03", label: "Late" },
  { date: "2026-09-26", label: "Present" },
];

const MOCK_RECITATION = [
  { date: "2026-10-08", label: "Random call", score: "4 / 5" },
  { date: "2026-09-29", label: "Weighted call", score: "5 / 5" },
];

const MOCK_QUIZ = [
  { title: "Quiz 1 · Reading check", score: "18 / 20" },
  { title: "Quiz 2 · Chapter review", score: "19 / 20" },
];

export default function StudentClassRecord() {
  const { id } = useParams();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [classRecord, setClassRecord] = useState(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.studentProfile(), api.studentClasses()])
      .then(([, data]) => {
        if (cancelled) return;
        const match = data.classes.find((item) => item.id === id);
        if (!match) {
          setError("You do not have access to that class record.");
        } else {
          setClassRecord(match);
        }
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
  }, [id]);

  const breadcrumbs = useMemo(() => [
    { label: "Dashboard", to: "/student" },
    { label: classRecord?.sectionName || "Class record" },
  ], [classRecord]);

  return (
    <AppShell active="home">
      <div className="content-wide">
        <nav className="class-breadcrumb" aria-label="Breadcrumb">
          {breadcrumbs.map((crumb, index) => (
            <span key={crumb.label} aria-current={index === breadcrumbs.length - 1 ? "page" : undefined}>
              {crumb.to ? <Link to={crumb.to}>{crumb.label}</Link> : crumb.label}
              {index < breadcrumbs.length - 1 ? <Icon name="chevron" size={14} /> : null}
            </span>
          ))}
        </nav>

        {loading ? (
          <div className="student-record-loading">
            <Skeleton className="student-record-skeleton" />
            <Skeleton className="student-record-skeleton" />
            <Skeleton className="student-record-skeleton" />
          </div>
        ) : error ? (
          <Card className="student-record-error">
            <Badge tone="danger">Not available</Badge>
            <h1>Class record unavailable</h1>
            <p>{error}</p>
            <Link to="/student" className="button button-secondary">
              Back to dashboard
            </Link>
          </Card>
        ) : classRecord ? (
          <>
            <PageHeader
              eyebrow="Student class record"
              icon="book"
              title={classRecord.sectionName}
              description={classRecord.description || "Your full class record is organized into one clean student view."}
              action={<Link to="/student" className="button button-secondary"><Icon name="chevron" /> Back to dashboard</Link>}
            />

            <section className="student-record-hero panel">
              <div className="student-record-meta">
                <Badge tone="neutral">Class code {classRecord.classCode}</Badge>
                <Badge tone={classRecord.enrollmentStatus === "PENDING" ? "warning" : classRecord.enrollmentStatus === "DECLINED" ? "danger" : "success"}>
                  {classRecord.enrollmentStatus === "PENDING" ? "Pending approval" : classRecord.enrollmentStatus === "DECLINED" ? "Declined" : "Enrolled"}
                </Badge>
              </div>
              <p className="student-record-copy">
                This screen is the design stub for the student class record view. It will be replaced with live summaries, score trends, and quiz records in the next ticket.
              </p>
            </section>

            <section className="student-record-summary-grid">
              {MOCK_SUMMARY.map((item) => (
                <Card key={item.label} className="student-record-summary-card">
                  <span className={`student-record-summary-tone student-record-summary-tone-${item.tone}`} />
                  <strong>{item.value}</strong>
                  <span>{item.label}</span>
                </Card>
              ))}
            </section>

            <section className="student-record-sections">
              <Card className="student-record-section">
                <div className="student-record-section-heading">
                  <div>
                    <span className="eyebrow"><Icon name="check" /> Attendance</span>
                    <h2>Attendance history</h2>
                  </div>
                  <Badge tone="neutral">Design preview</Badge>
                </div>
                <div className="student-record-list">
                  {MOCK_ATTENDANCE.map((item) => (
                    <article key={`${item.date}-${item.label}`} className="student-record-item">
                      <time dateTime={item.date}>{item.date}</time>
                      <strong>{item.label}</strong>
                    </article>
                  ))}
                </div>
              </Card>

              <Card className="student-record-section">
                <div className="student-record-section-heading">
                  <div>
                    <span className="eyebrow"><Icon name="user" /> Recitation</span>
                    <h2>Recitation calls</h2>
                  </div>
                  <Badge tone="neutral">Design preview</Badge>
                </div>
                <div className="student-record-list">
                  {MOCK_RECITATION.map((item) => (
                    <article key={`${item.date}-${item.label}`} className="student-record-item">
                      <time dateTime={item.date}>{item.date}</time>
                      <strong>{item.label}</strong>
                      <span>{item.score}</span>
                    </article>
                  ))}
                </div>
              </Card>

              <Card className="student-record-section">
                <div className="student-record-section-heading">
                  <div>
                    <span className="eyebrow"><Icon name="brain" /> Quiz records</span>
                    <h2>Quiz performance</h2>
                  </div>
                  <Badge tone="neutral">Design preview</Badge>
                </div>
                <div className="student-record-list">
                  {MOCK_QUIZ.map((item) => (
                    <article key={item.title} className="student-record-item">
                      <strong>{item.title}</strong>
                      <span>{item.score}</span>
                    </article>
                  ))}
                </div>
              </Card>
            </section>
          </>
        ) : null}
      </div>
    </AppShell>
  );
}
