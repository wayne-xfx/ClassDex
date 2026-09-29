import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import AppShell from "../components/AppShell";
import Icon from "../components/Icon";
import {
  EmptyState,
  ModuleTabs,
  StatCounter,
  StudentCard,
  Toast,
} from "../components/classroom/ClassroomComponents";
import { api } from "../api";

const MODULE_LABELS = {
  deck: "Class deck",
  attendance: "Take attendance",
  recitation: "Recitation",
};

export default function FacultyClass() {
  const { id } = useParams();
  const [classRecord, setClassRecord] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [activeModule, setActiveModule] = useState("deck");
  const [search, setSearch] = useState("");
  const [layout, setLayout] = useState("grid");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    api
      .todaySession(id)
      .then(() => api.classDeck(id))
      .then((deck) => {
        if (!cancelled) setClassRecord(deck);
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

  const dismissToast = useCallback(() => setNotice(""), []);
  const students = useMemo(
    () => (classRecord?.students || classRecord?.enrollments?.map(({ id: enrollmentId, studentProfile }) => ({
      ...studentProfile,
      enrollmentId,
    })) || []).map((student) => ({
      ...student,
      status: student.attendanceStatus || "UNMARKED",
    })),
    [classRecord],
  );
  const attendanceCounts = useMemo(() => students.reduce((counts, student) => {
    counts[student.status] += 1;
    return counts;
  }, { PRESENT: 0, LATE: 0, ABSENT: 0, UNMARKED: 0 }), [students]);
  const filteredStudents = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    if (!query) return students;
    return students.filter((student) =>
      `${student.name} ${student.studentId}`.toLocaleLowerCase().includes(query),
    );
  }, [search, students]);

  async function copyInvite() {
    if (!classRecord) return;
    const link = `${window.location.origin}/join/${classRecord.classCode}`;
    try {
      await navigator.clipboard.writeText(link);
      setNotice("Invite link copied. Share it with your students.");
    } catch {
      setNotice(`Copy unavailable — share code ${classRecord.classCode} or link ${link}`);
    }
  }

  const today = new Intl.DateTimeFormat("en-PH", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "Asia/Manila",
  }).format(new Date());

  return (
    <AppShell active="home">
      <div className="content-wide classroom-page">
        <nav className="class-breadcrumb" aria-label="Breadcrumb">
          <Link to="/faculty">Dashboard</Link>
          <Icon name="chevron" size={14} />
          <span>{classRecord?.sectionName || "Class"}</span>
          <Icon name="chevron" size={14} />
          <span aria-current="page">{MODULE_LABELS[activeModule]}</span>
        </nav>

        {loading ? (
          <div className="student-grid student-grid-skeleton" aria-label="Loading class deck">
            {Array.from({ length: 8 }, (_, index) => <div className="student-skeleton" key={index} />)}
          </div>
        ) : error ? (
          <div className="notice notice-error" role="alert">{error}</div>
        ) : classRecord ? (
          <>
            <header className="classroom-heading">
              <div className="classroom-title">
                <span className="eyebrow"><Icon name="book" /> Your classroom</span>
                <h1>{classRecord.sectionName}</h1>
                <p>{classRecord.description || "Your class roster, organized like a deck of index cards."}</p>
              </div>
              <div className="classroom-meta">
                <span className="class-code-pill"><span>CLASS CODE</span><strong>{classRecord.classCode}</strong></span>
                <span className="class-schedule-pill"><Icon name="clock" /> {classRecord.schedule || "Schedule not set"}</span>
              </div>
            </header>

            <div className="classroom-date"><Icon name="clock" size={16} /> {today}</div>
            <ModuleTabs active={activeModule} onChange={setActiveModule} />
            <Toast message={notice} onDismiss={dismissToast} />

            <section
              id={`module-panel-${activeModule}`}
              role="tabpanel"
              aria-labelledby={`module-tab-${activeModule}`}
              className="classroom-module"
            >
              {activeModule === "deck" ? (
                <>
                  <div className="deck-toolbar">
                    <div className="deck-title">
                      <h2>Student deck</h2>
                      <p>{students.length} {students.length === 1 ? "student" : "students"} admitted to this class</p>
                    </div>
                    <div className="deck-actions">
                      <label className="deck-search">
                        <Icon name="search" size={17} />
                        <span className="sr-only">Search students by name or ID</span>
                        <input
                          value={search}
                          onChange={(event) => setSearch(event.target.value)}
                          placeholder="Search name or ID"
                          type="search"
                        />
                      </label>
                      <div className="layout-toggle" role="group" aria-label="Student card layout">
                        <button
                          type="button"
                          className={layout === "grid" ? "is-active" : ""}
                          aria-pressed={layout === "grid"}
                          onClick={() => setLayout("grid")}
                        >Grid</button>
                        <button
                          type="button"
                          className={layout === "list" ? "is-active" : ""}
                          aria-pressed={layout === "list"}
                          onClick={() => setLayout("list")}
                        >List</button>
                      </div>
                    </div>
                  </div>
                  <div className="deck-counts" aria-label="Today's attendance counts">
                    <StatCounter label="Present" value={attendanceCounts.PRESENT} tone="present" />
                    <StatCounter label="Late" value={attendanceCounts.LATE} tone="late" />
                    <StatCounter label="Absent" value={attendanceCounts.ABSENT} tone="absent" />
                    <StatCounter label="Unmarked" value={attendanceCounts.UNMARKED} tone="neutral" />
                  </div>
                  {students.length ? (
                    filteredStudents.length ? (
                      <div className={`student-grid ${layout === "list" ? "student-grid-list" : ""}`}>
                        {filteredStudents.map((student) => (
                          <StudentCard key={student.id} student={student} status={student.status} layout={layout} />
                        ))}
                      </div>
                    ) : (
                      <div className="deck-no-results">
                        <Icon name="search" />
                        <strong>No matching students</strong>
                        <span>Try another name or student ID.</span>
                      </div>
                    )
                  ) : (
                    <EmptyState
                      title="Your deck is ready for its first student"
                      description="Share an invite link or class code and admitted students will appear here as index cards."
                      icon="users"
                      action={(
                        <div className="empty-state-actions">
                          <button type="button" className="button button-primary" onClick={copyInvite}>
                            <Icon name="copy" /> Copy invite link
                          </button>
                          <span>Or share code <strong>{classRecord.classCode}</strong></span>
                        </div>
                      )}
                    />
                  )}
                </>
              ) : (
                <div className="module-placeholder panel">
                  <span className="module-placeholder-icon"><Icon name={activeModule === "attendance" ? "check" : "user"} size={24} /></span>
                  <h2>{MODULE_LABELS[activeModule]}</h2>
                  <p>This module is being prepared for your class.</p>
                </div>
              )}
            </section>
          </>
        ) : null}
      </div>
    </AppShell>
  );
}
