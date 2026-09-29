import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import AppShell from "../components/AppShell";
import Icon from "../components/Icon";
import {
  EmptyState,
  ModuleTabs,
  StatCounter,
  StudentCard,
  StudentDetailDialog,
  Toast,
} from "../components/classroom/ClassroomComponents";
import { compareStudentsByLastName } from "../components/classroom/studentNames";
import AttendanceModule from "../components/classroom/AttendanceModule";
import RecitationModule from "../components/classroom/RecitationModule";
import { api } from "../api";

const MODULE_LABELS = {
  deck: "Class deck",
  attendance: "Take attendance",
  recitation: "Recitation",
};

function toRecitationCall(log) {
  return {
    id: log.id,
    log,
    student: log.studentProfile,
    score: log.score,
    calledAt: log.calledAt,
  };
}

export default function FacultyClass() {
  const { id } = useParams();
  const [classRecord, setClassRecord] = useState(null);
  const [loadedClassId, setLoadedClassId] = useState(null);
  const loading = loadedClassId !== id;
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [activeModule, setActiveModule] = useState("deck");
  const [search, setSearch] = useState("");
  const [layout, setLayout] = useState("grid");
  const [attendanceOverrides, setAttendanceOverrides] = useState({});
  const [gracePeriodMinutes, setGracePeriodMinutes] = useState(15);
  const [toastAction, setToastAction] = useState(null);
  const [toastActionLabel, setToastActionLabel] = useState("");
  const [toastType, setToastType] = useState("success");
  const [pendingStudentIds, setPendingStudentIds] = useState([]);
  const [savingGracePeriod, setSavingGracePeriod] = useState(false);
  const [recitationMode, setRecitationMode] = useState("RANDOM");
  const [recitationCall, setRecitationCall] = useState(null);
  const [recitationHistory, setRecitationHistory] = useState([]);
  const [recitationBusy, setRecitationBusy] = useState(false);
  const [savingRecitationScore, setSavingRecitationScore] = useState(false);
  const [recitationAnimationEnabled, setRecitationAnimationEnabled] = useState(true);
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [studentRecords, setStudentRecords] = useState(null);
  const [studentRecordsError, setStudentRecordsError] = useState("");
  const studentRecordsLoading = Boolean(selectedStudent && !studentRecords && !studentRecordsError);

  useEffect(() => {
    let cancelled = false;
    api
      .todaySession(id)
      .then(() => api.classDeck(id))
      .then((deck) => {
        if (!cancelled) {
          setClassRecord({ ...deck.class, session: deck.session, students: deck.students });
          setGracePeriodMinutes(deck.class.gracePeriodMinutes);
          setAttendanceOverrides({});
          setRecitationCall(null);
          setRecitationHistory((deck.recitationHistory || []).map(toRecitationCall));
        }
      })
      .catch((requestError) => {
        if (!cancelled) setError(requestError.message);
      })
      .finally(() => {
        if (!cancelled) setLoadedClassId(id);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  const dismissToast = useCallback(() => {
    setNotice("");
    setToastAction(null);
    setToastActionLabel("");
    setToastType("success");
  }, []);
  function showToast(message, type = "success", actionLabel = "", action = null) {
    setNotice(message);
    setToastType(type);
    setToastActionLabel(actionLabel);
    setToastAction(() => action);
  }
  const students = useMemo(
    () => (classRecord?.students || classRecord?.enrollments?.map(({ id: enrollmentId, studentProfile }) => ({
      ...studentProfile,
      enrollmentId,
    })) || []).map((student) => ({
      ...student,
      status: attendanceOverrides[student.id] ?? student.attendanceStatus ?? "UNMARKED",
    })),
    [attendanceOverrides, classRecord],
  );
  const sortedStudents = useMemo(() => [...students].sort(compareStudentsByLastName), [students]);
  const attendanceCounts = useMemo(() => students.reduce((counts, student) => {
    counts[student.status] += 1;
    return counts;
  }, { PRESENT: 0, LATE: 0, ABSENT: 0, UNMARKED: 0 }), [students]);
  const eligibleStudents = useMemo(
    () => sortedStudents.filter((student) => student.status === "PRESENT"),
    [sortedStudents],
  );
  const filteredStudents = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    if (!query) return sortedStudents;
    return sortedStudents.filter((student) =>
      `${student.name} ${student.studentId}`.toLocaleLowerCase().includes(query),
    );
  }, [search, sortedStudents]);

  const openStudentProfile = useCallback((student) => {
    setStudentRecords(null);
    setStudentRecordsError("");
    setSelectedStudent(student);
  }, []);
  const closeStudentProfile = useCallback(() => setSelectedStudent(null), []);

  useEffect(() => {
    if (!selectedStudent || !id) return undefined;
    let cancelled = false;
    api.studentClassRecords(id, selectedStudent.id)
      .then((data) => {
        if (!cancelled) setStudentRecords(data);
      })
      .catch((recordsError) => {
        if (!cancelled) setStudentRecordsError(recordsError.message);
      });
    return () => { cancelled = true; };
  }, [id, selectedStudent]);

  async function updateAttendance(student, requestedStatus, notify = true) {
    const previousStatus = student.status;
    const startedAt = Date.parse(classRecord?.session?.startedAt || "");
    const afterGrace = Number.isFinite(startedAt) && Date.now() > startedAt + gracePeriodMinutes * 60_000;
    const optimisticStatus = requestedStatus === "PRESENT" && afterGrace ? "LATE" : requestedStatus;
    setAttendanceOverrides((current) => ({ ...current, [student.id]: optimisticStatus }));
    setPendingStudentIds((current) => [...current, student.id]);
    try {
      const result = await api.setAttendance(classRecord.session.id, student.id, requestedStatus);
      const appliedStatus = result.appliedStatus || result.attendance?.status || requestedStatus;
      setAttendanceOverrides((current) => ({ ...current, [student.id]: appliedStatus }));
      const automaticLate = requestedStatus === "PRESENT" && appliedStatus === "LATE";
      if (notify && automaticLate) {
        showToast(
          `${student.name} was marked Late because the grace period has passed.`,
          "success",
          "Undo",
          () => updateAttendance({ ...student, status: appliedStatus }, previousStatus),
        );
      } else if (notify) {
        const label = appliedStatus === "UNMARKED"
          ? `${student.name}'s attendance was cleared.`
          : `${student.name} marked ${appliedStatus.toLowerCase()}.`;
        showToast(label);
      }
      return appliedStatus;
    } catch (attendanceError) {
      setAttendanceOverrides((current) => ({ ...current, [student.id]: previousStatus }));
      if (notify) showToast(attendanceError.message, "error");
      return null;
    } finally {
      setPendingStudentIds((current) => current.filter((studentId) => studentId !== student.id));
    }
  }

  async function markAllPresent() {
    const results = await Promise.all(students.map((student) => updateAttendance(student, "PRESENT", false)));
    const lateCount = results.filter((status) => status === "LATE").length;
    const failedCount = results.filter((status) => status === null).length;
    if (failedCount) {
      showToast(`${students.length - failedCount} saved; ${failedCount} attendance updates failed.`, "error");
    } else {
      const presentCount = results.filter((status) => status === "PRESENT").length;
      showToast(`${presentCount} marked Present${lateCount ? ` · ${lateCount} marked Late after the grace period` : ""}.`);
    }
  }

  async function saveGracePeriod(minutes) {
    setSavingGracePeriod(true);
    try {
      const result = await api.updateClass(id, { gracePeriodMinutes: minutes });
      setGracePeriodMinutes(result.class.gracePeriodMinutes);
      setClassRecord((current) => ({ ...current, gracePeriodMinutes: result.class.gracePeriodMinutes }));
      showToast(`Grace period set to ${result.class.gracePeriodMinutes} minutes.`);
      return true;
    } catch (saveError) {
      showToast(saveError.message, "error");
      return false;
    } finally {
      setSavingGracePeriod(false);
    }
  }

  async function copyInvite() {
    if (!classRecord) return;
    const link = `${window.location.origin}/join/${classRecord.classCode}`;
    try {
      await navigator.clipboard.writeText(link);
      showToast("Invite link copied. Share it with your students.");
    } catch {
      showToast(`Copy unavailable — share code ${classRecord.classCode} or link ${link}`, "error");
    }
  }

  async function shuffleRecitation(skipCurrent = false, animate = recitationAnimationEnabled) {
      if (!classRecord?.session?.id || !eligibleStudents.length) return;
      setRecitationBusy(true);
      try {
        const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        const shuffleDuration = animate && !reduceMotion ? 2400 : 0;
        if (shuffleDuration) {
          await new Promise((resolve) => window.setTimeout(resolve, shuffleDuration));
        }
        const excludeStudentId = skipCurrent ? recitationCall?.student.id : null;
        const { recitation } = await api.shuffleRecitation(
          classRecord.session.id,
          recitationMode,
          excludeStudentId,
        );
        const call = toRecitationCall(recitation);
        setRecitationCall(call);
        setRecitationHistory((current) => [call, ...current.filter((item) => item.id !== call.id)]);
        showToast(`${call.student.name} called for recitation.`);
      } catch (shuffleError) {
        showToast(shuffleError.message, "error");
      } finally {
        setRecitationBusy(false);
      }
  }

  async function updateRecitationScore(score) {
      if (!recitationCall) return;
      const previousScore = recitationCall.log.score;
      const optimisticLog = { ...recitationCall.log, score };
      const optimisticCall = toRecitationCall(optimisticLog);
      setRecitationCall(optimisticCall);
      setRecitationHistory((current) => current.map((call) =>
        call.id === recitationCall.id ? optimisticCall : call,
      ));
      setSavingRecitationScore(true);
      try {
        const { recitation } = await api.updateRecitationScore(recitationCall.id, score);
        const savedCall = toRecitationCall(recitation);
        setRecitationCall(savedCall);
        setRecitationHistory((current) => current.map((call) =>
          call.id === savedCall.id ? savedCall : call,
        ));
      } catch (scoreError) {
        const previousCall = toRecitationCall({ ...recitationCall.log, score: previousScore });
        setRecitationCall(previousCall);
        setRecitationHistory((current) => current.map((call) =>
          call.id === previousCall.id ? previousCall : call,
        ));
        showToast(scoreError.message, "error");
      } finally {
        setSavingRecitationScore(false);
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
            <Toast
              message={notice}
              type={toastType}
              onDismiss={dismissToast}
              actionLabel={toastActionLabel}
              onAction={toastAction}
            />

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
                          <StudentCard
                            key={student.id}
                            student={student}
                            status={student.status}
                            layout={layout}
                            onOpen={openStudentProfile}
                          />
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
              ) : activeModule === "attendance" ? (
                <AttendanceModule
                  students={sortedStudents}
                  counts={attendanceCounts}
                  layout={layout}
                  gracePeriodMinutes={gracePeriodMinutes}
                  onStatusChange={updateAttendance}
                  onOpenStudent={openStudentProfile}
                  onMarkAll={markAllPresent}
                  onSaveGracePeriod={saveGracePeriod}
                  pendingStudentIds={pendingStudentIds}
                  savingGracePeriod={savingGracePeriod}
                />
              ) : (
                <RecitationModule
                  eligibleStudents={eligibleStudents}
                  currentCall={recitationCall}
                  history={recitationHistory}
                  mode={recitationMode}
                  onModeChange={setRecitationMode}
                  onShuffle={(animate) => shuffleRecitation(false, animate)}
                  onScoreChange={updateRecitationScore}
                  onSkip={(animate) => shuffleRecitation(true, animate)}
                  busy={recitationBusy}
                  savingScore={savingRecitationScore}
                  animationEnabled={recitationAnimationEnabled}
                  onAnimationChange={setRecitationAnimationEnabled}
                />
              )}
            </section>
            {selectedStudent ? (
              <StudentDetailDialog
                student={selectedStudent}
                className={classRecord.sectionName}
                records={studentRecords}
                loading={studentRecordsLoading}
                error={studentRecordsError}
                onClose={closeStudentProfile}
              />
            ) : null}
          </>
        ) : null}
      </div>
    </AppShell>
  );
}
