import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import QRCode from "qrcode";
import AppShell from "../components/AppShell";
import ClassForm from "../components/ClassForm";
import Icon from "../components/Icon";
import ClassShell from "../components/classroom/ClassShell";
import {
  ConfirmDialog,
  EmptyState,
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
import { ErrorState, Modal } from "../components/DesignSystem";
import { api } from "../api";

const VALID_MODULES = new Set([
  "deck",
  "attendance",
  "recitation",
  "activities",
  "projects",
  "quiz",
  "export",
  "student-list",
]);

function toRecitationCall(log, deckStudents = []) {
  const rawStudent = log.studentProfile;
  const matched = rawStudent?.id
    ? deckStudents.find((candidate) => candidate.id === rawStudent.id)
    : null;
  const student =
    rawStudent && matched
      ? {
          ...matched,
          ...rawStudent,
          firstName: rawStudent.firstName ?? matched.firstName,
          middleName: rawStudent.middleName ?? matched.middleName,
          lastName: rawStudent.lastName ?? matched.lastName,
          suffix: rawStudent.suffix ?? matched.suffix,
          program: rawStudent.program ?? matched.program,
          section: rawStudent.section ?? matched.section,
        }
      : rawStudent;
  return {
    id: log.id,
    log,
    student,
    score: log.score,
    calledAt: log.calledAt,
  };
}

export default function FacultyClass() {
  const { id } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const [classRecord, setClassRecord] = useState(null);
  const [loadedClassId, setLoadedClassId] = useState(null);
  const [reloadNonce, setReloadNonce] = useState(0);
  const loading = loadedClassId !== `${id}:${reloadNonce}`;
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState("");
  const [activeModule, setActiveModule] = useState(() => {
    const initialModule = new URLSearchParams(window.location.search).get("module");
    return initialModule && VALID_MODULES.has(initialModule) ? initialModule : "deck";
  });
  const [studentListDirty, setStudentListDirty] = useState(false);

  function handleModuleChange(targetModule) {
    if (activeModule === "student-list" && studentListDirty && targetModule !== "student-list") {
      const confirmLeave = window.confirm(
        "You have unsaved changes in the student list. Are you sure you want to leave without saving?",
      );
      if (!confirmLeave) return;
    }
    setActiveModule(targetModule);
  }
  const [showPending, setShowPending] = useState(() => new URLSearchParams(window.location.search).get("notifications") === "1");
  const [pendingEnrollments, setPendingEnrollments] = useState([]);
  const [autoApprovedNotifications, setAutoApprovedNotifications] = useState([]);
  const [absenceWarnings, setAbsenceWarnings] = useState([]);
  const [pendingLoadedForId, setPendingLoadedForId] = useState(null);
  const [pendingError, setPendingError] = useState("");
  const [pendingRetrying, setPendingRetrying] = useState(false);
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
  const [showEditClassModal, setShowEditClassModal] = useState(false);
  const [showArchiveConfirm, setShowArchiveConfirm] = useState(false);
  const [archiveBusy, setArchiveBusy] = useState(false);
  const isArchived = Boolean(classRecord?.archivedAt);
  const studentRecordsLoading = Boolean(selectedStudent && !studentRecords && !studentRecordsError);

  const notificationsParam = searchParams.get("notifications");
  useEffect(() => {
    if (notificationsParam === "1") {
      setShowPending(true);
    }
  }, [notificationsParam]);

  useEffect(() => {
    if (
      activeModule !== "student-list" &&
      (searchParams.has("module") || searchParams.has("focusStudent"))
    ) {
      const nextParams = new URLSearchParams(searchParams);
      nextParams.delete("module");
      nextParams.delete("focusStudent");
      setSearchParams(nextParams, { replace: true });
    }
  }, [activeModule, searchParams, setSearchParams]);

  useEffect(() => {
    let cancelled = false;
    const loadKey = `${id}:${reloadNonce}`;
    api
      .classDeck(id)
      .then((deck) => {
        if (!cancelled) {
          setError(null);
          setClassRecord({ ...deck.class, session: deck.session, students: deck.students });
          setGracePeriodMinutes(deck.class.gracePeriodMinutes);
          setRecitationShuffleSeconds(deck.class.recitationShuffleSeconds ?? 3);
          setStudentListCount(deck.rosterCount ?? 0);
          setAttendanceOverrides({});
          setRecitationCall(null);
          setRecitationHistory((deck.recitationHistory || []).map((entry) => toRecitationCall(entry, deck.students || [])));
        }
      })
      .catch((requestError) => {
        if (!cancelled) {
          setError({
            message: requestError.message,
            httpStatus: requestError.httpStatus,
          });
        }
      })
      .finally(() => {
        if (!cancelled) setLoadedClassId(loadKey);
      });
    return () => {
      cancelled = true;
    };
  }, [id, reloadNonce]);

  function retryLoadClass() {
    setError(null);
    setReloadNonce((current) => current + 1);
  }

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
  const pendingLoadedRef = useRef(null);
  const refreshPending = useCallback(
    (isFocus = false, forceReportError = false) => {
      const now = Date.now();
      if (!forceReportError && isFocus && now - lastPendingFetchRef.current < 10000) {
        return Promise.resolve();
      }
      lastPendingFetchRef.current = now;
      return api
        .pendingEnrollments(id)
        .then(({ pending, autoApproved, absenceWarnings: warnings }) => {
          setPendingEnrollments(pending || []);
          setAutoApprovedNotifications(autoApproved || []);
          setAbsenceWarnings(warnings || []);
          pendingLoadedRef.current = id;
          setPendingLoadedForId(id);
          setPendingError("");
        })
        .catch((fetchError) => {
          if (forceReportError || pendingLoadedRef.current !== id) {
            setPendingError(fetchError.message || "Unable to load notifications.");
            setPendingLoadedForId(id);
          }
        });
    },
    [id],
  );
  function retryPendingNotifications() {
    setPendingError("");
    setPendingRetrying(true);
    refreshPending(false, true).finally(() => setPendingRetrying(false));
  }
  useEffect(() => {
    if (loading || isArchived) return undefined;
    refreshPending();
    const interval = window.setInterval(() => refreshPending(false), 30000);
    const onFocus = () => refreshPending(true);
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, [isArchived, loading, refreshPending]);

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
  const closePendingDrawer = useCallback(() => {
    setShowPending(false);
    if (searchParams.has("notifications")) {
      const nextParams = new URLSearchParams(searchParams);
      nextParams.delete("notifications");
      setSearchParams(nextParams, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const togglePendingDrawer = useCallback(() => {
    setShowPending((current) => {
      const next = !current;
      if (!next && searchParams.has("notifications")) {
        const nextParams = new URLSearchParams(searchParams);
        nextParams.delete("notifications");
        setSearchParams(nextParams, { replace: true });
      }
      return next;
    });
  }, [searchParams, setSearchParams]);

  async function dismissAbsenceWarning(studentId) {
    setDismissBusyId(studentId);
    try {
      await api.dismissAbsenceWarning(id, studentId);
      setAbsenceWarnings((current) =>
        current.filter((item) => (item.studentProfile?.id || item.studentId) !== studentId),
      );
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
    const matchedStudent = warning.studentId
      ? (classRecord?.students || []).find((candidate) => candidate.id === warning.studentId)
      : null;
    const student =
      warning.studentProfile ||
      matchedStudent || {
        id: warning.studentId,
        studentId: warning.studentCode || "",
        name: warning.studentName || "Student",
        program: warning.program || "",
        section: warning.section || "",
        photo: warning.photo || warning.photoUrl || "",
      };
    setReadWarningBusyId(student.id);
    try {
      await api.markAbsenceWarningRead(id, student.id);
      setAbsenceWarnings((current) =>
        current.map((item) =>
          (item.studentProfile?.id || item.studentId) === student.id
            ? { ...item, isRead: true }
            : item,
        ),
      );
      closePendingDrawer();
      openStudentProfile(student);
    } catch (readError) {
      showToast(readError.message, "error");
      closePendingDrawer();
      openStudentProfile(student);
    } finally {
      setReadWarningBusyId(null);
    }
  }
  function reviewWarningInStudentList(warning, resolvedStudent) {
    const student = resolvedStudent || warning?.studentProfile || {};
    const focusTarget =
      warning?.studentCode ||
      student?.studentId ||
      warning?.studentId ||
      student?.id ||
      "";
    const targetProfileId = warning?.studentProfile?.id || warning?.studentId || student?.id;
    if (targetProfileId && !warning?.isRead) {
      api.markAbsenceWarningRead(id, targetProfileId).catch(() => {});
      setAbsenceWarnings((current) =>
        current.map((item) =>
          (item.studentProfile?.id || item.studentId) === targetProfileId
            ? { ...item, isRead: true }
            : item,
        ),
      );
    }
    setShowPending(false);
    setActiveModule("student-list");
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete("notifications");
    nextParams.set("module", "student-list");
    if (focusTarget) {
      nextParams.set("focusStudent", String(focusTarget));
    } else {
      nextParams.delete("focusStudent");
    }
    setSearchParams(nextParams, { replace: true });
  }
  async function refreshDeckAndRoster(failureMessage) {
    try {
      tabCache.invalidate();
      await Promise.all([
        refreshPending(),
        api.classDeck(id).then((deck) => {
          const activeStudentIds = new Set((deck.students || []).map((student) => student.id));
          setClassRecord({ ...deck.class, session: deck.session, students: deck.students });
          setStudentListCount(deck.rosterCount ?? 0);
          setAttendanceOverrides((current) => {
            const next = {};
            for (const [studentId, status] of Object.entries(current)) {
              if (activeStudentIds.has(studentId)) next[studentId] = status;
            }
            return next;
          });
          setSelectedStudent((current) => {
            if (current && !activeStudentIds.has(current.id)) {
              setStudentRecords(null);
              setStudentRecordsError("");
              return null;
            }
            return current;
          });
          setRecitationCall((current) =>
            current?.student?.id && !activeStudentIds.has(current.student.id) ? null : current,
          );
        }),
      ]);
    } catch {
      showToast(failureMessage, "error");
    }
  }
  function refreshAfterRosterApproval() {
    return refreshDeckAndRoster("Students were auto approved, but the class deck could not refresh.");
  }
  function handleRosterChanged() {
    return refreshDeckAndRoster("Student list updated, but the class deck could not refresh.");
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
  const unreadNotificationCount = isArchived
    ? 0
    : pendingEnrollments.length +
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
    if (!classRecord?.session?.id || classRecord.session.startedAt || isArchived) {
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
    if (!classRecord?.session?.id || isArchived) return null;
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
      if (result.sessionStartedAt !== undefined) {
        setClassRecord((current) =>
          current?.session
            ? {
                ...current,
                session: {
                  ...current.session,
                  startedAt: result.sessionStartedAt,
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
        showToast(
          label,
          "success",
          "Undo",
          () => updateAttendance({ ...student, status: appliedStatus }, previousStatus),
        );
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

  async function updateBulkAttendance(updates, previousSnapshot, successMessage) {
    if (!classRecord?.session?.id || isArchived) return false;
    tabCache.invalidate("activities");
    tabCache.invalidate("projects");
    tabCache.invalidate("quizzes");
    const studentIds = updates.map((u) => u.studentId);
    setPendingStudentIds((current) => [...current, ...studentIds]);
    const optimistic = {};
    for (const u of updates) {
      optimistic[u.studentId] = u.status;
    }
    setAttendanceOverrides((current) => ({ ...current, ...optimistic }));
    try {
      const result = await api.setBulkAttendance(classRecord.session.id, updates);
      if (result.sessionStartedAt !== undefined) {
        setClassRecord((current) =>
          current?.session
            ? {
                ...current,
                session: {
                  ...current.session,
                  startedAt: result.sessionStartedAt,
                },
              }
            : current,
        );
      }
      const applied = {};
      for (const r of result.results || []) {
        applied[r.studentId] = r.appliedStatus;
      }
      setAttendanceOverrides((current) => ({ ...current, ...applied }));
      refreshPending();
      if (previousSnapshot && previousSnapshot.length > 0) {
        showToast(
          successMessage || "Bulk attendance updated.",
          "success",
          "Undo",
          () => updateBulkAttendance(previousSnapshot, null, "Bulk attendance reverted."),
        );
      } else {
        showToast(successMessage || "Bulk attendance updated.", "success");
      }
      return true;
    } catch (bulkError) {
      if (previousSnapshot) {
        const revert = {};
        for (const s of previousSnapshot) {
          revert[s.studentId] = s.status;
        }
        setAttendanceOverrides((current) => ({ ...current, ...revert }));
      }
      showToast(bulkError.message, "error");
      return false;
    } finally {
      setPendingStudentIds((current) =>
        current.filter((id) => !studentIds.includes(id)),
      );
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
      if (!classRecord?.session?.id || !eligibleStudents.length || isArchived) return;
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
        const call = toRecitationCall(recitation, classRecord?.students || []);
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
      if (!recitationCall || isArchived) return;
      const previousScore = recitationCall.log.score;
      const optimisticLog = { ...recitationCall.log, score };
      const optimisticCall = toRecitationCall(optimisticLog, classRecord?.students || []);
      setRecitationCall(optimisticCall);
      setRecitationHistory((current) => current.map((call) =>
        call.id === recitationCall.id ? optimisticCall : call,
      ));
      setSavingRecitationScore(true);
      try {
        const { recitation } = await api.updateRecitationScore(recitationCall.id, score);
        const savedCall = toRecitationCall(recitation, classRecord?.students || []);
        setRecitationCall(savedCall);
        setRecitationHistory((current) => current.map((call) =>
          call.id === savedCall.id ? savedCall : call,
        ));
      } catch (scoreError) {
        const previousCall = toRecitationCall({ ...recitationCall.log, score: previousScore }, classRecord?.students || []);
        setRecitationCall(previousCall);
        setRecitationHistory((current) => current.map((call) =>
          call.id === previousCall.id ? previousCall : call,
        ));
        showToast(scoreError.message, "error");
      } finally {
        setSavingRecitationScore(false);
  }
    }

  async function handleSaveClassEdits(payload) {
    const { class: updated } = await api.updateClass(id, payload);
    setClassRecord((current) => (current ? { ...current, ...updated } : updated));
    setShowEditClassModal(false);
    showToast("Class details updated.");
  }

  async function handleArchiveClass() {
    setArchiveBusy(true);
    try {
      const { class: archived } = await api.archiveClass(id);
      setClassRecord((current) => (current ? { ...current, ...archived } : archived));
      setShowArchiveConfirm(false);
      setShowPending(false);
      setPendingEnrollments([]);
      setAutoApprovedNotifications([]);
      setAbsenceWarnings([]);
      showToast("Class archived. All records remain available in read-only mode.");
    } catch (archiveError) {
      showToast(archiveError.message, "error");
    } finally {
      setArchiveBusy(false);
    }
  }

  async function handleRestoreClass() {
    setArchiveBusy(true);
    try {
      await api.restoreClass(id);
      tabCache.invalidate();
      const deck = await api.classDeck(id);
      setClassRecord({ ...deck.class, session: deck.session, students: deck.students });
      setGracePeriodMinutes(deck.class.gracePeriodMinutes);
      setRecitationShuffleSeconds(deck.class.recitationShuffleSeconds ?? 3);
      setStudentListCount(deck.rosterCount ?? 0);
      setAttendanceOverrides({});
      setRecitationCall(null);
      setRecitationHistory((deck.recitationHistory || []).map((entry) => toRecitationCall(entry, deck.students || [])));
      await refreshPending();
      showToast("Class restored. You can take attendance and update records again.");
    } catch (restoreError) {
      showToast(restoreError.message, "error");
    } finally {
      setArchiveBusy(false);
    }
  }

  return (
    <AppShell
      active="home"
      notificationCount={unreadNotificationCount}
      notificationsOpen={showPending}
      onToggleNotifications={togglePendingDrawer}
    >
      <div className="content-wide classroom-page">
        {loading ? (
          <div className="student-grid student-grid-skeleton" aria-label="Loading class deck">
            {Array.from({ length: 8 }, (_, index) => <div className="student-skeleton" key={index} />)}
          </div>
        ) : error ? (
          <ErrorState
            badge={error.httpStatus === 404 ? "404 · Not found" : "Not available"}
            title={error.httpStatus === 404 ? "Class not found" : "Unable to load this class"}
            message={error.message}
            onRetry={error.httpStatus === 404 ? undefined : retryLoadClass}
            backTo="/faculty"
            backLabel="Back to dashboard"
          />
        ) : classRecord ? (
          <>
            {!isArchived && showLargeQr && inviteQr ? (
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
                enrollments={isArchived ? [] : pendingEnrollments}
                autoApproved={isArchived ? [] : autoApprovedNotifications}
                absenceWarnings={isArchived ? [] : absenceWarnings}
                className={classRecord.sectionName}
                loading={!isArchived && (pendingLoadedForId !== id || pendingRetrying)}
                error={isArchived ? "" : pendingError}
                onRetry={isArchived ? undefined : retryPendingNotifications}
                onApprove={(enrollmentId) => updatePending(enrollmentId, "APPROVED")}
                onDecline={(enrollmentId) => updatePending(enrollmentId, "DECLINED")}
                onMarkAllRead={markAllNotificationsRead}
                onViewWarning={viewAbsenceWarning}
                onDismissWarning={dismissAbsenceWarning}
                onReviewInStudentList={reviewWarningInStudentList}
                onClose={closePendingDrawer}
                busyId={pendingBusyId}
                dismissBusyId={dismissBusyId}
                readWarningBusyId={readWarningBusyId}
              />
            ) : null}
            {!isArchived && showEditClassModal ? (
              <Modal
                title="Edit class details"
                description="Update the section name, invite code, description, or class schedule."
                onClose={() => setShowEditClassModal(false)}
              >
                <ClassForm
                  mode="edit"
                  initialValues={classRecord}
                  excludeClassId={classRecord.id}
                  className="form-panel class-edit-form"
                  onCancel={() => setShowEditClassModal(false)}
                  onSubmit={handleSaveClassEdits}
                />
              </Modal>
            ) : null}
            {!isArchived && showArchiveConfirm ? (
              <ConfirmDialog
                title={`Archive ${classRecord.sectionName}?`}
                description="Archiving makes this class read-only and pauses new student joins. 100% of your student list, attendance, recitation, quiz, activity, and project records are kept, and you can restore the class anytime."
                confirmLabel={archiveBusy ? "Archiving…" : "Archive class"}
                onConfirm={handleArchiveClass}
                onCancel={() => setShowArchiveConfirm(false)}
                busy={archiveBusy}
              />
            ) : null}
            <ClassShell
              classRecord={classRecord}
              activeModule={activeModule}
              onModuleChange={handleModuleChange}
              studentListCount={studentListCount}
              isArchived={isArchived}
              archiveBusy={archiveBusy}
              inviteQr={inviteQr}
              inviteQrError={inviteQrError}
              onCopyInvite={copyInvite}
              onShowLargeQr={() => setShowLargeQr(true)}
              onEditClass={() => setShowEditClassModal(true)}
              onArchiveClass={() => setShowArchiveConfirm(true)}
              onRestoreClass={handleRestoreClass}
              toast={
                <Toast
                  message={notice}
                  type={toastType}
                  onDismiss={dismissToast}
                  actionLabel={toastActionLabel}
                  onAction={toastAction}
                />
              }
            >
              {activeModule === "student-list" ? <StudentListManager classId={id} onCountChange={setStudentListCount} onAutoApproved={refreshAfterRosterApproval} onRosterChanged={handleRosterChanged} onDirtyChange={setStudentListDirty} onClose={() => handleModuleChange("deck")} tabCache={tabCache} readOnly={isArchived} /> : activeModule === "deck" ? (
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
                      title={isArchived ? "No admitted students in this archived class" : "Your deck is ready for its first student"}
                      description={isArchived ? "Restore this class if you want to invite and admit students." : "Share an invite link or class code and admitted students will appear here as index cards."}
                      icon="users"
                      action={!isArchived ? (
                        <div className="empty-state-actions">
                          <button type="button" className="button button-primary" onClick={copyInvite}>
                            <Icon name="copy" /> Copy invite link
                          </button>
                          <span>Or share code <strong>{classRecord.classCode}</strong></span>
                        </div>
                      ) : null}
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
                  onBulkStatusChange={updateBulkAttendance}
                  onSaveGracePeriod={saveGracePeriod}
                  pendingStudentIds={pendingStudentIds}
                  savingGracePeriod={savingGracePeriod}
                  readOnly={isArchived}
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
                  readOnly={isArchived}
                />
              ) : activeModule === "activities" ? (
                <ActivitiesModule key={classRecord.session?.id || "no-session"} sessionId={classRecord.session?.id || null} students={sortedStudents} tabCache={tabCache} readOnly={isArchived} />
              ) : activeModule === "projects" ? (
                <ProjectsModule key={id} classId={id} sessionId={classRecord.session?.id || null} students={sortedStudents} tabCache={tabCache} readOnly={isArchived} />
              ) : activeModule === "export" ? (
                <ExportModule classRecord={classRecord} students={sortedStudents} pendingEnrollments={pendingEnrollments} onExcel={downloadExcelExport} onCsv={downloadCsvExport} />
              ) : activeModule === "quiz" ? (
                <QuizModule classId={id} students={sortedStudents} attendanceTaken={students.some((student) => student.status !== "UNMARKED")} onTakeAttendance={() => setActiveModule("attendance")} tabCache={tabCache} readOnly={isArchived} />
              ) : null}
            </ClassShell>
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
