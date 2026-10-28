import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { Modal } from "../components/DesignSystem";
import { api } from "../api";
import { formatClassSchedule } from "../utils/schedule";

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
  const [showPending, setShowPending] = useState(() => new URLSearchParams(window.location.search).get("notifications") === "1");
  const [pendingEnrollments, setPendingEnrollments] = useState([]);
  const [autoApprovedNotifications, setAutoApprovedNotifications] = useState([]);
  const [absenceWarnings, setAbsenceWarnings] = useState([]);
  const [studentListCount, setStudentListCount] = useState(0);
  const [pendingBusyId, setPendingBusyId] = useState(null);
  const [dismissBusyId, setDismissBusyId] = useState(null);
  const [readWarningBusyId, setReadWarningBusyId] = useState(null);
  const [search, setSearch] = useState("");
  const [layout, setLayout] = useState("grid");
  const [attendanceOverrides, setAttendanceOverrides] = useState({});
  const [gracePeriodMinutes, setGracePeriodMinutes] = useState(15);
  const [toastAction, setToastAction] = useState(null);
  const [toastActionLabel, setToastActionLabel] = useState("");
  const [toastType, setToastType] = useState("success");
  const [pendingStudentIds, setPendingStudentIds] = useState([]);
  const [savingGracePeriod, setSavingGracePeriod] = useState(false);
  const [recitationShuffleSeconds, setRecitationShuffleSeconds] = useState(3);
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
  const [showLargeQr, setShowLargeQr] = useState(false);
  const [inviteExpanded, setInviteExpanded] = useState(false);
  const studentRecordsLoading = Boolean(selectedStudent && !studentRecords && !studentRecordsError);

  useEffect(() => {
    if (!classRecord?.id) return;
    try {
      setInviteExpanded(window.localStorage.getItem(`classdex:invite-expanded:${classRecord.id}`) === "true");
    } catch {
      setInviteExpanded(false);
    }
  }, [classRecord?.id]);

  function toggleInviteExpanded() {
    const nextExpanded = !inviteExpanded;
    setInviteExpanded(nextExpanded);
    try {
      window.localStorage.setItem(`classdex:invite-expanded:${classRecord.id}`, String(nextExpanded));
    } catch {
      // Keep the choice for this page session when storage is unavailable.
    }
  }

  useEffect(() => {
    let cancelled = false;
    api
      .classDeck(id)
      .then((deck) => {
        if (!cancelled) {
          setClassRecord({ ...deck.class, session: deck.session, students: deck.students });
          setGracePeriodMinutes(deck.class.gracePeriodMinutes);
          setRecitationShuffleSeconds(deck.class.recitationShuffleSeconds ?? 3);
          setStudentListCount(deck.rosterCount ?? 0);
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

  // Roster count initialized from classDeck response (P3)
  const tabCacheRef = useRef(new Map());
  const tabCache = useMemo(() => ({
    get: (key) => tabCacheRef.current.get(key),
    set: (key, val) => tabCacheRef.current.set(key, val),
    invalidate: (prefix) => {
      if (!prefix) {
        tabCacheRef.current.clear();
        return;
      }
      for (const k of tabCacheRef.current.keys()) {
        if (k.includes(prefix)) {
          tabCacheRef.current.delete(k);
        }
      }
    },
  }), []);

  const lastPendingFetchRef = useRef(0);
  const refreshPending = useCallback(
    (isFocus = false) => {
      const now = Date.now();
      if (isFocus && now - lastPendingFetchRef.current < 10000) return Promise.resolve();
      lastPendingFetchRef.current = now;
      return api
        .pendingEnrollments(id)
        .then(({ pending, autoApproved, absenceWarnings: warnings }) => {
          setPendingEnrollments(pending || []);
          setAutoApprovedNotifications(autoApproved || []);
          setAbsenceWarnings(warnings || []);
        })
        .catch(() => {});
    },
    [id],
  );
  useEffect(() => {
    refreshPending();
    const interval = window.setInterval(() => refreshPending(false), 30000);
    const onFocus = () => refreshPending(true);
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, [refreshPending]);

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
  async function updatePending(enrollmentId, status) {
    setPendingBusyId(enrollmentId);
    try {
      const result = await api.updatePendingEnrollment(id, enrollmentId, status);
      setPendingEnrollments((current) => current.filter((item) => item.id !== enrollmentId));
      if (status === "APPROVED") {
        try {
          tabCache.invalidate();
          const deck = await api.classDeck(id);
          setClassRecord({ ...deck.class, session: deck.session, students: deck.students });
          setStudentListCount(deck.rosterCount ?? 0);
        } catch {
          showToast("Student approved, but the class list could not refresh.", "error");
          return;
        }
      }
      refreshPending();
      if (status === "APPROVED") {
        if (result?.warning === "missing_or_invalid_student_id") {
          showToast("Student approved, but they have not completed a valid 7-digit student ID for the student list.", "warning");
        } else {
          showToast("Student approved.");
        }
      } else {
        showToast("Request declined.");
      }
    } catch (error) {
      showToast(error.message, "error");
    } finally {
      setPendingBusyId(null);
    }
  }
  async function dismissAbsenceWarning(studentId) {
    setDismissBusyId(studentId);
    try {
      await api.dismissAbsenceWarning(id, studentId);
      setAbsenceWarnings((current) => current.filter((item) => item.studentProfile?.id !== studentId));
      showToast("Absence warning dismissed.");
    } catch (dismissError) {
      showToast(dismissError.message, "error");
    } finally {
      setDismissBusyId(null);
    }
  }
  async function markAllNotificationsRead() {
    try {
      const result = await api.markClassNotificationsRead(id);
      await refreshPending();
      if (result.pendingCount) {
        showToast(`Completed notifications marked as read. ${result.pendingCount} pending ${result.pendingCount === 1 ? "request remains" : "requests remain"} at the top for your review.`);
      } else {
        showToast("All completed notifications marked as read.");
      }
    } catch (readError) {
      showToast(readError.message, "error");
    }
  }
  async function viewAbsenceWarning(warning) {
    const student = warning.studentProfile;
    setReadWarningBusyId(student.id);
    try {
      await api.markAbsenceWarningRead(id, student.id);
      setAbsenceWarnings((current) => current.map((item) =>
        item.studentProfile?.id === student.id ? { ...item, isRead: true } : item,
      ));
      setShowPending(false);
      openStudentProfile(student);
    } catch (readError) {
      showToast(readError.message, "error");
      setShowPending(false);
      openStudentProfile(student);
    } finally {
      setReadWarningBusyId(null);
    }
  }
  async function refreshAfterRosterApproval() {
    try {
      tabCache.invalidate();
      await Promise.all([
        refreshPending(),
        api.classDeck(id).then((deck) => {
          setClassRecord({ ...deck.class, session: deck.session, students: deck.students });
          setStudentListCount(deck.rosterCount ?? 0);
        }),
      ]);
    } catch {
      showToast("Students were auto approved, but the class deck could not refresh.", "error");
    }
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
  const unreadNotificationCount =
    pendingEnrollments.length +
    autoApprovedNotifications.filter((item) => !item.isRead).length +
    absenceWarnings.filter((item) => !item.isRead).length;

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

  async function startAttendanceSession() {
    if (!classRecord?.session?.id || classRecord.session.startedAt) {
      return classRecord?.session || null;
    }
    try {
      const { session } = await api.startAttendanceSession(classRecord.session.id);
      setClassRecord((current) =>
        current
          ? { ...current, session: { ...current.session, ...session } }
          : current,
      );
      return session;
    } catch (startError) {
      showToast(startError.message, "error");
      return null;
    }
  }

  async function updateAttendance(student, requestedStatus, notify = true) {
    tabCache.invalidate("activities");
    tabCache.invalidate("projects");
    tabCache.invalidate("quizzes");
    const previousStatus = student.status;
    const effectiveGraceMinutes =
      Number.isInteger(gracePeriodMinutes) && gracePeriodMinutes >= 0
        ? gracePeriodMinutes
        : 15;
    const startedAt = Date.parse(classRecord?.session?.startedAt || "");
    const afterGrace =
      Number.isFinite(startedAt) &&
      Date.now() > startedAt + effectiveGraceMinutes * 60_000;
    const optimisticStatus = requestedStatus === "PRESENT" && afterGrace ? "LATE" : requestedStatus;
    setAttendanceOverrides((current) => ({ ...current, [student.id]: optimisticStatus }));
    setPendingStudentIds((current) => [...current, student.id]);
    try {
      const result = await api.setAttendance(classRecord.session.id, student.id, requestedStatus);
      const appliedStatus = result.appliedStatus || result.attendance?.status || requestedStatus;
      if (result.sessionStartedAt) {
        setClassRecord((current) =>
          current?.session
            ? {
                ...current,
                session: {
                  ...current.session,
                  startedAt: current.session.startedAt || result.sessionStartedAt,
                },
              }
            : current,
        );
      }
      setAttendanceOverrides((current) => ({ ...current, [student.id]: appliedStatus }));
      refreshPending();
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

  async function saveShuffleDuration(seconds) {
    const previous = recitationShuffleSeconds;
    setRecitationShuffleSeconds(seconds);
    try {
      const result = await api.updateClass(id, { recitationShuffleSeconds: seconds });
      setRecitationShuffleSeconds(result.class.recitationShuffleSeconds);
      setClassRecord((current) => ({ ...current, recitationShuffleSeconds: result.class.recitationShuffleSeconds }));
      showToast(`Shuffle duration set to ${result.class.recitationShuffleSeconds} s.`);
      return true;
    } catch (saveError) {
      setRecitationShuffleSeconds(previous);
      showToast(saveError.message, "error");
      return false;
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
    if (studentListCount === 0 && !window.confirm("You haven't added a student list yet. Join requests that don't match a list entry will need your manual approval. Share the invite anyway?")) {
      return;
    }
    try {
      await navigator.clipboard.writeText(inviteLink);
      showToast("Invite link copied. Share it with your students.");
    } catch {
      showToast(`Copy unavailable — share code ${classRecord.classCode} instead.`, "error");
    }
  }

  async function downloadExcelExport(types) {
    try {
      const blob = await api.exportClassExcel(id, types);
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      const dateStr = new Date().toISOString().slice(0, 10);
      const code = (classRecord?.classCode || "class").replace(/[^\w.-]+/g, "_");
      const section = (classRecord?.sectionName || "section").replace(/[^\w.-]+/g, "_");
      anchor.download = `${code}_${section}_${dateStr}.xlsx`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.URL.revokeObjectURL(url);
      showToast("Excel export downloaded.");
    } catch (exportError) {
      showToast(exportError.message, "error");
    }
  }

  async function downloadCsvExport(types) {
    try {
      const blob = await api.exportClassCsv(id, types);
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      const dateStr = new Date().toISOString().slice(0, 10);
      const code = (classRecord?.classCode || "class").replace(/[^\w.-]+/g, "_");
      const section = (classRecord?.sectionName || "section").replace(/[^\w.-]+/g, "_");
      anchor.download = `${code}_${section}_${dateStr}.csv`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.URL.revokeObjectURL(url);
      showToast("CSV export downloaded.");
    } catch (exportError) {
      showToast(exportError.message, "error");
    }
  }

  async function shuffleRecitation(skipCurrent = false, animate = recitationAnimationEnabled) {
      if (!classRecord?.session?.id || !eligibleStudents.length) return;
      setRecitationBusy(true);
      try {
        const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        const durationMs = (recitationShuffleSeconds || 3) * 1000;
        if (animate && !reduceMotion) {
          await new Promise((resolve) => window.setTimeout(resolve, durationMs));
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
                <span className="class-schedule-pill"><Icon name="clock" /> {formatClassSchedule(classRecord)}</span>
              </div>
            </header>

            <div className="classroom-date"><Icon name="calendar" size={16} /> {today}</div>
            <section className={`panel class-share-panel${inviteExpanded ? " is-expanded" : ""}`} aria-labelledby="class-share-title">
              <div className="class-share-row">
                <button type="button" className="class-share-toggle" aria-expanded={inviteExpanded} aria-controls="class-share-expanded" onClick={toggleInviteExpanded}>
                  <Icon name="qrCode" />
                  <span id="class-share-title">Share class invite</span>
                  <Icon name="chevron" className={inviteExpanded ? "is-rotated" : ""} />
                </button>
                <span className="class-share-code">{classRecord.classCode}</span>
                <button type="button" className="button button-primary" onClick={copyInvite}>
                  <Icon name="copy" /> Copy invite link
                </button>
                <button
                  type="button"
                  className="button button-quiet class-share-pending"
                  aria-label={`Notifications${unreadNotificationCount ? ` (${unreadNotificationCount})` : ""}`}
                  title="Notifications"
                  onClick={() => setShowPending(true)}
                >
                  <Icon name="bell" size={17} />
                  {unreadNotificationCount > 0 ? (
                    <span className="notification-badge">{unreadNotificationCount}</span>
                  ) : null}
                </button>
              </div>
              {inviteExpanded ? (
                <div id="class-share-expanded" className="class-share-expanded">
                  <div className="class-share-copy">
                    <h2>Invite students with a link or QR code</h2>
                    <p>Students can scan the QR code or use the invite link to join this class.</p>
                  </div>
                  <div className="class-share-qr">
                    {inviteQr ? (
                      <>
                        <img src={inviteQr} alt={`QR code for joining ${classRecord.sectionName}`} />
                        <div className="class-share-qr-actions">
                          <button type="button" className="button button-quiet" onClick={() => setShowLargeQr(true)}>Show larger</button>
                          <a href={inviteQr} download={`${classRecord.classCode || "class"}-qr.png`} className="button button-quiet">Download QR</a>
                        </div>
                      </>
                    ) : <div className="class-share-qr-placeholder">Generating QR…</div>}
                    {inviteQrError ? <span className="class-share-error">{inviteQrError}</span> : null}
                  </div>
                </div>
              ) : null}
            </section>

            {showLargeQr && inviteQr ? (
              <Modal
                title="Class join QR code"
                description={`Scan with any mobile camera or QR reader to join ${classRecord.sectionName}.`}
                onClose={() => setShowLargeQr(false)}
                footer={
                  <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem" }}>
                    <button type="button" className="button button-secondary" onClick={() => setShowLargeQr(false)}>Close</button>
                    <a href={inviteQr} download={`${classRecord.classCode || "class"}-qr.png`} className="button button-primary">Download QR</a>
                  </div>
                }
              >
                <div style={{ display: "grid", placeItems: "center", padding: "1.25rem", textAlign: "center" }}>
                  <img src={inviteQr} alt={`Large QR code for ${classRecord.sectionName}`} style={{ width: "260px", height: "260px", borderRadius: "12px", border: "1px solid var(--border-color, #e2e8f0)" }} />
                  <p style={{ marginTop: "0.75rem", fontWeight: "bold" }}>Class code: {classRecord.classCode}</p>
                </div>
              </Modal>
            ) : null}
            {showPending ? (
              <PendingValidationList
                enrollments={pendingEnrollments}
                autoApproved={autoApprovedNotifications}
                absenceWarnings={absenceWarnings}
                className={classRecord.sectionName}
                onApprove={(enrollmentId) => updatePending(enrollmentId, "APPROVED")}
                onDecline={(enrollmentId) => updatePending(enrollmentId, "DECLINED")}
                onMarkAllRead={markAllNotificationsRead}
                onViewWarning={viewAbsenceWarning}
                onDismissWarning={dismissAbsenceWarning}
                onClose={() => setShowPending(false)}
                busyId={pendingBusyId}
                dismissBusyId={dismissBusyId}
                readWarningBusyId={readWarningBusyId}
              />
            ) : null}
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
              {activeModule === "student-list" ? <StudentListManager classId={id} onCountChange={setStudentListCount} onAutoApproved={refreshAfterRosterApproval} onClose={() => setActiveModule("deck")} tabCache={tabCache} /> : activeModule === "deck" ? (
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
                  sessionStartedAt={classRecord.session?.startedAt || null}
                  onStartAttendance={startAttendanceSession}
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
                  durationSeconds={recitationShuffleSeconds}
                  onDurationChange={saveShuffleDuration}
                />
              ) : activeModule === "activities" ? (
                <ActivitiesModule key={classRecord.session.id} sessionId={classRecord.session.id} students={sortedStudents} tabCache={tabCache} />
              ) : activeModule === "projects" ? (
                <ProjectsModule key={id} classId={id} sessionId={classRecord.session.id} students={sortedStudents} tabCache={tabCache} />
              ) : activeModule === "export" ? (
                <ExportModule classRecord={classRecord} students={sortedStudents} pendingEnrollments={pendingEnrollments} onExcel={downloadExcelExport} onCsv={downloadCsvExport} />
              ) : activeModule === "quiz" ? (
                <QuizModule classId={id} students={sortedStudents} attendanceTaken={students.some((student) => student.status !== "UNMARKED")} onTakeAttendance={() => setActiveModule("attendance")} tabCache={tabCache} />
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
