import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import AppShell from "../components/AppShell";
import Icon from "../components/Icon";
import { Badge, Card, PageHeader, Skeleton } from "../components/DesignSystem";
import { api } from "../api";

export default function StudentClassRecord() {
  const { id } = useParams();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [classRecord, setClassRecord] = useState(null);
  const [records, setRecords] = useState(null);
  const quizStats = useMemo(() => {
    const quizzes = records?.quizzes || [];
    const scored = quizzes.filter((item) => item.score !== null && item.score !== undefined);
    const totalPossible = scored.reduce((sum, item) => sum + (item.session.totalItems || 0), 0);
    const totalScore = scored.reduce((sum, item) => sum + item.score, 0);
    const bestItem = scored.reduce((best, item) => {
      const currentPercent = item.session.totalItems ? item.score / item.session.totalItems : 0;
      const bestPercent = best && best.session.totalItems ? best.score / best.session.totalItems : -1;
      return currentPercent > bestPercent ? item : best;
    }, null);
    return {
      attempts: quizzes.length,
      average: totalPossible ? `${Math.round((totalScore / totalPossible) * 100)}%` : "—",
      best: bestItem
        ? `${Math.round((bestItem.session.totalItems ? (bestItem.score / bestItem.session.totalItems) * 100 : 0))}%`
        : "—",
      latest: scored[0]?.score === undefined ? "—" : scored[0]?.score,
    };
  }, [records]);

  useEffect(() => {
    let cancelled = false;
    api.studentClassRecord(id)
      .then((data) => {
        if (cancelled) return;
        setClassRecord(data.class);
        setRecords(data);
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

  return (
    <AppShell active="home">
      <div className="content-wide">
        <nav className="class-breadcrumb" aria-label="Breadcrumb">
          <Link to="/student">Dashboard</Link>
          <Icon name="chevron" size={14} />
          <span aria-current="page">{classRecord?.sectionName || "Class record"}</span>
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
                Here is your live class record for this class, scoped to your own student profile and session history.
              </p>
            </section>

            <section className="student-record-summary-grid">
              {Object.entries(classRecord.recordSummary || { attendance: "—", recitation: "—", activities: "—", quiz: "—" }).map(([label, value]) => (
                <Card key={label} className="student-record-summary-card">
                  <span className={`student-record-summary-tone student-record-summary-tone-${label === "attendance" ? "present" : label === "recitation" ? "late" : "neutral"}`} />
                  <strong>{value}</strong>
                  <span>{label}</span>
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
                  <Badge tone="success">Live data</Badge>
                </div>
                <div className="student-record-list">
                  {(records?.attendance || []).map((item) => (
                    <article key={item.id} className="student-record-item">
                      <time dateTime={item.session.date}>{new Date(item.session.date).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric", timeZone: "Asia/Manila" })}</time>
                      <strong>{item.status}</strong>
                    </article>
                  ))}
                  {!records?.attendance?.length ? <p className="student-record-empty">No attendance records yet.</p> : null}
                </div>
              </Card>

              <Card className="student-record-section">
                <div className="student-record-section-heading">
                  <div>
                    <span className="eyebrow"><Icon name="user" /> Recitation</span>
                    <h2>Recitation calls</h2>
                  </div>
                  <Badge tone="success">Live data</Badge>
                </div>
                <div className="student-record-list">
                  {(records?.recitations || []).map((item) => (
                    <article key={item.id} className="student-record-item">
                      <time dateTime={item.session.date}>{new Date(item.session.date).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric", timeZone: "Asia/Manila" })}</time>
                      <strong>{item.method}</strong>
                      <span>{item.score === null ? "No score" : `Score ${item.score}`}</span>
                    </article>
                  ))}
                  {!records?.recitations?.length ? <p className="student-record-empty">No recitation records yet.</p> : null}
                </div>
              </Card>

              <Card className="student-record-section">
                <div className="student-record-section-heading">
                  <div>
                    <span className="eyebrow"><Icon name="book" /> Activities</span>
                    <h2>Activity scores</h2>
                  </div>
                  <Badge tone="success">Live data</Badge>
                </div>
                <div className="student-record-list">
                  {(records?.activities || []).map((item) => (
                    <article key={item.id} className="student-record-item">
                      <strong>{item.activity?.title || "Activity"}</strong>
                      {item.session?.date ? (
                        <time dateTime={item.session.date}>{new Date(item.session.date).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric", timeZone: "Asia/Manila" })}</time>
                      ) : null}
                      <span>{item.isAbsent ? "Absent" : item.score === null || item.score === undefined ? "No score" : `Score ${item.score}${item.activity?.maxScore ? ` / ${item.activity.maxScore}` : ""}`}</span>
                    </article>
                  ))}
                  {!records?.activities?.length ? <p className="student-record-empty">No activity scores yet.</p> : null}
                </div>
              </Card>

              <Card className="student-record-section">
                <div className="student-record-section-heading">
                  <div>
                    <span className="eyebrow"><Icon name="folder" /> Projects</span>
                    <h2>Project scores</h2>
                  </div>
                  <Badge tone="success">Live data</Badge>
                </div>
                <div className="student-record-list">
                  {(records?.projects || []).map((item) => (
                    <article key={item.id} className="student-record-item">
                      <strong>{item.project?.type === "MIDTERM" ? "Midterm project" : item.project?.type === "FINALS" ? "Finals project" : item.project?.type || "Project"}</strong>
                      {item.session?.date ? (
                        <time dateTime={item.session.date}>{new Date(item.session.date).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric", timeZone: "Asia/Manila" })}</time>
                      ) : null}
                      <span>{item.isAbsent ? "Absent" : item.score === null || item.score === undefined ? "No score" : `Score ${item.score}${item.project?.maxScore ? ` / ${item.project.maxScore}` : ""}`}</span>
                    </article>
                  ))}
                  {!records?.projects?.length ? <p className="student-record-empty">No project scores yet.</p> : null}
                </div>
              </Card>

              <Card className="student-record-section">
                <div className="student-record-section-heading">
                  <div>
                    <span className="eyebrow"><Icon name="brain" /> Quiz records</span>
                    <h2>Quiz performance</h2>
                  </div>
                  <Badge tone="success">Live data</Badge>
                </div>
                <div className="student-record-quiz-stats">
                  <div>
                    <strong>{quizStats.average}</strong>
                    <span>Average</span>
                  </div>
                  <div>
                    <strong>{quizStats.best}</strong>
                    <span>Best attempt</span>
                  </div>
                  <div>
                    <strong>{quizStats.attempts}</strong>
                    <span>Recorded quizzes</span>
                  </div>
                </div>
                <div className="student-record-list">
                  {(records?.quizzes || []).map((item) => (
                    <article key={item.id} className="student-record-item">
                      <strong>{item.session.title}</strong>
                      <time dateTime={item.session.date}>{new Date(item.session.date).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric", timeZone: "Asia/Manila" })}</time>
                      <span>{item.isAbsent ? "Absent" : item.score === null || item.score === undefined ? "Not yet scored" : `Score ${item.score}${item.session.totalItems ? ` / ${item.session.totalItems}` : ""}`}</span>
                    </article>
                  ))}
                  {!records?.quizzes?.length ? <p className="student-record-empty">No quiz records yet.</p> : null}
                </div>
              </Card>
            </section>
          </>
        ) : null}
      </div>
    </AppShell>
  );
}
