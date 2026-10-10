import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import QRCode from "qrcode";
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
import ExportModule from "../components/classroom/ExportModule";
import RecitationModule from "../components/classroom/RecitationModule";
import { ActivitiesModule, ProjectsModule } from "../components/classroom/ScoringModules";
import StudentListManager from "../components/classroom/StudentListManager";
import PendingValidationList from "../components/classroom/PendingValidationList";
import QuizModule from "../components/classroom/QuizModule";
import { api } from "../api";

const MODULE_LABELS = {
  deck: "Class deck",
  attendance: "Attendance",
  recitation: "Recitation",
  activities: "Activities",
  projects: "Projects",
  export: "Data export",
  quiz: "Quiz",
  "student-list": "Student List",
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
  const [showPending, setShowPending] = useState(false);
  const [pendingEnrollments, setPendingEnrollments] = useState([]);
  const [studentListCount, setStudentListCount] = useState(0);
  const [pendingBusyId, setPendingBusyId] = useState(null);
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
  const [inviteQr, setInviteQr] = useState("");
  const [inviteQrError, setInviteQrError] = useState("");
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

  const inviteLink = useMemo(
    () => (classRecord ? `${window.location.origin}/join/${classRecord.classCode}` : ""),
    [classRecord],
  );

  useEffect(() => {
    let cancelled = false;
    if (!inviteLink) {
      setInviteQr("");
      setInviteQrError("");
      return () => {};
    }
    QRCode.toDataURL(inviteLink, {
      errorCorrectionLevel: "M",
      margin: 1,
      width: 208,
      color: { dark: "#0f172a", light: "#ffffff" },
    })
      .then((dataUrl) => {
        if (!cancelled) {
          setInviteQr(dataUrl);
          setInviteQrError("");
        }
      })
      .catch((qrError) => {
        if (!cancelled) {
          setInviteQr("");
          setInviteQrError(qrError.message);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [inviteLink]);

  useEffect(() => { let cancelled = false; api.classRoster(id).then(({ roster }) => { if (!cancelled) setStudentListCount(roster.length); }).catch(() => {}); return () => { cancelled = true; }; }, [id]);
  const refreshPending = useCallback(() => api.pendingEnrollments(id).then(({ pending }) => setPendingEnrollments(pending)).catch(() => {}), [id]);
  useEffect(() => { refreshPending(); const interval = window.setInterval(refreshPending, 30000); window.addEventListener("focus", refreshPending); return () => { window.clearInterval(interval); window.removeEventListener("focus", refreshPending); }; }, [refreshPending]);

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
    () => sortedStudents.filter((student) => ["PRESENT", "LATE"].includes(student.status)),
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
      if (automaticLate) {
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
      showToast(attendanceError.message, "error");
      return null;
    } finally {
      setPendingStudentIds((current) => current.filter((studentId) => studentId !== student.id));
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
    try {
      const { roster } = await api.classRoster(id);
      if (!roster.length && !window.confirm("You haven't added a student list yet. Join requests that don't match a list entry will need your manual approval. Share the invite anyway?")) return;
    } catch (rosterError) {
      showToast(rosterError.message, "error");
      return;
    }
    try {
      await navigator.clipboard.writeText(inviteLink);
      showToast("Invite link copied. Share it with your students.");
    } catch {
      showToast(`Copy unavailable — share code ${classRecord.classCode} or link ${inviteLink}`, "error");
    }
  }

  async function downloadExcelExport() {
    try {
      const blob = await api.exportClassExcel(id);
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${classRecord?.sectionName || "class"}-export.xlsx`.replace(/[^\w.-]+/g, "-");
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.URL.revokeObjectURL(url);
      showToast("Excel export downloaded.");
    } catch (exportError) {
      showToast(exportError.message, "error");
    }
  }

  async function updatePending(enrollmentId, status) {
    setPendingBusyId(enrollmentId);
    try {
      await api.updatePendingEnrollment(id, enrollmentId, status);
      setPendingEnrollments((current) => current.filter((item) => item.id !== enrollmentId));
      showToast(status === "APPROVED" ? "Student approved." : "Request declined.");
    } catch (updateError) { showToast(updateError.message, "error"); } finally { setPendingBusyId(null); }
  }

  async function shuffleRecitation(skipCurrent = false, animate = recitationAnimationEnabled) {
      if (!classRecord?.session?.id || !eligibleStudents.length) return;
      setRecitationBusy(true);
      try {
        const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        if (animate && !reduceMotion) {
          await new Promise((resolve) => window.setTimeout(resolve, 2400));
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
                <p>{classRecord.description || "Your student list, organized like a deck of index cards."}</p>
              </div>
              <div className="classroom-meta">
                <span className="class-code-pill"><span>CLASS CODE</span><strong>{classRecord.classCode}</strong></span>
                <span className="class-schedule-pill"><Icon name="clock" /> {classRecord.schedule || "Schedule not set"}</span>
              </div>
            </header>

            <div className="classroom-date"><Icon name="calendar" size={16} /> {today}</div>
            <section className="panel class-share-panel" aria-labelledby="class-share-title">
              <div className="class-share-copy">
                <span className="eyebrow"><Icon name="copy" /> Share class invite</span>
                <h2 id="class-share-title">Invite students with a link or QR code</h2>
                <p>Students can scan the QR code or use the invite link to join this class.</p>
                <div className="class-share-actions">
                  <button type="button" className="button button-primary" onClick={copyInvite}>
                    <Icon name="copy" /> Copy invite link
                  </button>
                  <span className="class-share-code">Class code <strong>{classRecord.classCode}</strong></span>
                </div>
                <p className="class-share-link">{inviteLink}</p>
              </div>
              <div className="class-share-qr">
                {inviteQr ? <img src={inviteQr} alt={`QR code for joining ${classRecord.sectionName}`} /> : <div className="class-share-qr-placeholder">Generating QR…</div>}
                {inviteQrError ? <span className="class-share-error">{inviteQrError}</span> : null}
              </div>
            </section>

            <div className="classroom-pending-action"><button type="button" className="button button-quiet" onClick={() => setShowPending(true)}><Icon name="bell" size={16} /> Pending {pendingEnrollments.length ? <span className="notification-badge">{pendingEnrollments.length}</span> : null}</button></div>
            {showPending ? <PendingValidationList enrollments={pendingEnrollments} onApprove={(enrollmentId) => updatePending(enrollmentId, "APPROVED")} onDecline={(enrollmentId) => updatePending(enrollmentId, "DECLINED")} onClose={() => setShowPending(false)} busyId={pendingBusyId} /> : null}
            <ModuleTabs active={activeModule} onChange={setActiveModule} studentListCount={studentListCount} />
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
              aria-labelledby={activeModule === "deck" ? "module-deck-link" : `module-tab-${activeModule}`}
              className="classroom-module"
            >
              {activeModule === "student-list" ? <StudentListManager classId={id} onCountChange={setStudentListCount} onClose={() => setActiveModule("deck")} /> : activeModule === "deck" ? (
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
                  onLayoutChange={setLayout}
                  gracePeriodMinutes={gracePeriodMinutes}
                  onStatusChange={updateAttendance}
                  onSaveGracePeriod={saveGracePeriod}
                  pendingStudentIds={pendingStudentIds}
                  savingGracePeriod={savingGracePeriod}
                />
              ) : activeModule === "recitation" ? (
                <RecitationModule
                  eligibleStudents={eligibleStudents}
                  absentStudents={sortedStudents.filter((student) => student.status === "ABSENT")}
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
              ) : activeModule === "activities" ? (
                <ActivitiesModule key={classRecord.session.id} sessionId={classRecord.session.id} students={sortedStudents} />
              ) : activeModule === "projects" ? (
                <ProjectsModule key={id} classId={id} sessionId={classRecord.session.id} students={sortedStudents} />
              ) : activeModule === "export" ? (
                <ExportModule classRecord={classRecord} students={sortedStudents} pendingEnrollments={pendingEnrollments} onExcel={downloadExcelExport} />
              ) : activeModule === "quiz" ? (
                <QuizModule classId={id} students={sortedStudents} attendanceTaken={students.some((student) => student.status !== "UNMARKED")} onTakeAttendance={() => setActiveModule("attendance")} />
              ) : null}
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
