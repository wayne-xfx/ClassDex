import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import AppShell from "../components/AppShell";
import Icon from "../components/Icon";
import { ErrorState, Skeleton } from "../components/DesignSystem";
import { IndexCardView } from "../components/classroom/ClassroomComponents";
import { useAuth } from "../context/AuthContext";
import { api } from "../api";
import { getClassDisplay } from "../utils/classDisplay";

const SUMMARY_FIELDS = [
  { key: "attendance", label: "Attendance" },
  { key: "recitation", label: "Recitation" },
  { key: "activities", label: "Activities" },
  { key: "quiz", label: "Quiz" },
];

function isEmptySummaryValue(value) {
  if (value === null || value === undefined) return true;
  const normalized = String(value).trim();
  return !normalized || normalized === "-" || normalized === "—";
}

export default function StudentClassRecord() {
  const { id } = useParams();
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [error, setError] = useState("");
  const [classRecord, setClassRecord] = useState(null);
  const [records, setRecords] = useState(null);

  useEffect(() => {
    let cancelled = false;
    api
      .studentClassRecord(id)
      .then((data) => {
        if (cancelled) return;
        setError("");
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
  }, [id, reloadNonce]);

  function retryLoadRecord() {
    setError("");
    setLoading(true);
    setReloadNonce((current) => current + 1);
  }

  const adaptedRecords = useMemo(() => {
    if (!records) return null;
    const projectOrder = { MIDTERM: 0, FINALS: 1 };
    return {
      student: records.student,
      attendance: records.attendance || [],
      recitations: (records.recitations || []).map((r) => ({
        ...r,
        calledAt: r.calledAt || r.session?.date || null,
      })),
      quizzes: (records.quizzes || []).map((q) => ({
        ...q,
        session: q.session || {},
      })),
      activities: (records.activities || []).map((a) => ({
        ...a,
        activity: a.activity || { title: a.title, maxScore: a.maxScore },
        session: a.session || a.activity?.session || null,
      })),
      projects: [...(records.projects || [])].sort(
        (a, b) =>
          (projectOrder[a.project?.type] ?? 99) -
          (projectOrder[b.project?.type] ?? 99)
      ),
    };
  }, [records]);

  const studentIdentity = useMemo(() => {
    const base = records?.student || {};
    return {
      ...base,
      name: base.name || user?.name || "Student",
      photo: base.photo || user?.photo || "",
    };
  }, [records?.student, user?.name, user?.photo]);

  const isDropped = classRecord?.enrollmentStatus === "DROPPED";
  const isPending = classRecord?.enrollmentStatus === "PENDING";
  const isDeclined = classRecord?.enrollmentStatus === "DECLINED";
  const display = getClassDisplay(classRecord);

  return (
    <AppShell active="home">
      <div className="content-wide student-record-page">
        <nav className="class-breadcrumb" aria-label="Breadcrumb">
          <Link to="/student">Dashboard</Link>
          <Icon name="chevron" size={14} />
          <span aria-current="page">
            {display.label || "Class record"}
          </span>
        </nav>

        {loading ? (
          <div
            className="student-record-loading-shell"
            role="status"
            aria-label="Loading class record"
          >
            <div className="student-record-header-skeleton">
              <Skeleton className="student-skeleton-title" />
              <Skeleton className="student-skeleton-meta" />
            </div>
            <div className="student-record-summary-strip is-loading">
              {SUMMARY_FIELDS.map(({ key }) => (
                <div key={key} className="student-record-summary-cell">
                  <Skeleton className="student-skeleton-stat" />
                </div>
              ))}
            </div>
            <div className="index-card-scene index-card-scene-inline index-card-skeleton-scene">
              <div className="index-card-face index-card-skeleton-face">
                <div className="student-skeleton-card-head">
                  <Skeleton className="student-skeleton-avatar" />
                  <div className="student-skeleton-lines">
                    <Skeleton className="student-skeleton-line-lg" />
                    <Skeleton className="student-skeleton-line-sm" />
                  </div>
                </div>
                <div className="student-skeleton-cols">
                  <Skeleton className="student-skeleton-col" />
                  <Skeleton className="student-skeleton-col" />
                </div>
              </div>
            </div>
          </div>
        ) : error ? (
          <ErrorState
            title="Class record unavailable"
            message={error}
            onRetry={retryLoadRecord}
            backTo="/student"
            backLabel="Back to dashboard"
          />
        ) : classRecord ? (
          <>
            <header className="student-record-header">
              <div className="student-record-header-main">
                <span className="eyebrow">
                  <Icon name="book" size={14} />{" "}
                  {display.hasCourse ? display.eyebrow : "Student class record"}
                </span>
                <h1>{display.title}</h1>
                {display.sectionLine ? (
                  <p className="student-record-section-line">
                    {display.sectionLine}
                  </p>
                ) : null}
                {classRecord.description &&
                classRecord.description.trim().toLowerCase() !== display.courseTitle.toLowerCase() ? (
                  <p className="student-record-description">
                    {classRecord.description}
                  </p>
                ) : null}
              </div>

              <div className="student-record-meta" aria-label="Class details">
                {classRecord.classCode ? (
                  <span className="code-chip student-record-code-chip">
                    Class code <b>{classRecord.classCode}</b>
                  </span>
                ) : null}
                {classRecord.faculty?.name ? (
                  <span className="student-record-meta-chip">
                    <Icon name="user" size={13} />
                    <span>{classRecord.faculty.name}</span>
                  </span>
                ) : null}
                {classRecord.archivedAt ? (
                  <span className="enrolled-pill enrolled-pill-archived">
                    <Icon name="archive" size={12} /> Archived
                  </span>
                ) : null}
                <span
                  className={`enrolled-pill${
                    isDropped || isDeclined
                      ? " enrolled-pill-dropped"
                      : classRecord.enrollmentStatus !== "APPROVED"
                      ? " enrolled-pill-pending"
                      : ""
                  }`}
                >
                  {isDropped
                    ? "Dropped"
                    : isPending
                    ? "Pending approval"
                    : isDeclined
                    ? "Declined"
                    : "Enrolled"}
                </span>
              </div>
            </header>

            <div className="student-record-card-stage">
              {isDropped ? (
                <div
                  className="notice notice-warm student-record-banner"
                  role="status"
                >
                  <Icon name="info" />
                  <span>
                    You were dropped from this class
                    {classRecord.droppedAt
                      ? ` on ${new Date(classRecord.droppedAt).toLocaleDateString(
                          undefined,
                          {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                            timeZone: "Asia/Manila",
                          }
                        )}`
                      : ""}
                    . Your recorded coursework is preserved below as a read-only
                    record.
                  </span>
                </div>
              ) : null}

              {isPending ? (
                <div
                  className="notice notice-warm student-record-banner"
                  role="status"
                >
                  <Icon name="clock" />
                  <span>
                    Waiting for instructor approval. Your coursework will appear
                    on this index card once your enrollment is approved.
                  </span>
                </div>
              ) : null}

              <section
                className="student-record-summary-strip"
                aria-label="Class record summary"
              >
                {SUMMARY_FIELDS.map(({ key, label }) => {
                  const rawValue = classRecord.recordSummary?.[key];
                  const empty = isEmptySummaryValue(rawValue);
                  return (
                    <div key={key} className="student-record-summary-cell">
                      <span className="student-record-summary-label">
                        {label}
                      </span>
                      {empty ? (
                        <span className="student-record-summary-value is-empty">
                          none yet
                        </span>
                      ) : (
                        <strong className="student-record-summary-value">
                          {rawValue}
                        </strong>
                      )}
                    </div>
                  );
                })}
              </section>

              <IndexCardView
                variant="inline"
                student={studentIdentity}
                className={display.label}
                classCode={classRecord.classCode}
                records={adaptedRecords}
                loading={false}
                error=""
              />
            </div>
          </>
        ) : null}
      </div>
    </AppShell>
  );
}
