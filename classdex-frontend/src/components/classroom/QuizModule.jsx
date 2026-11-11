import { useCallback, useEffect, useRef, useState } from "react";
import Avatar from "../Avatar";
import Icon from "../Icon";
import { Button, Modal } from "../DesignSystem";
import { EmptyState } from "./ClassroomComponents";
import { ModuleHeader } from "./ClassShell";
import ModuleSkeleton from "./ModuleSkeleton";
import { formatProgramSection, formatStudentDisplayName } from "./studentNames";
import { api } from "../../api";

function QuizForm({ onClose, onSubmit }) {
  const [title, setTitle] = useState("");
  const [totalItems, setTotalItems] = useState("10");
  const [error, setError] = useState("");
  function submit(event) {
    event.preventDefault();
    const total = Number(totalItems);
    if (!title.trim()) {
      setError("Enter a quiz title.");
      return;
    }
    if (!Number.isInteger(total) || total < 1) {
      setError("Total items must be a whole number of 1 or greater.");
      return;
    }
    onSubmit({ title: title.trim(), totalItems: total });
  }
  return (
    <Modal
      title="New quiz"
      description="Add a title and the total number of items before scoring students."
      onClose={onClose}
    >
      <form className="activity-form" onSubmit={submit}>
        <label className="field">
          <span>
            Quiz title or label <b>*</b>
          </span>
          <input
            className="input"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Quiz 1 - Reading check"
            autoFocus
            maxLength={120}
            required
          />
        </label>
        <label className="field">
          <span>
            Total items <b>*</b>
          </span>
          <input
            className="input"
            type="number"
            min="1"
            step="1"
            inputMode="numeric"
            value={totalItems}
            onChange={(event) =>
              /^\d*$/.test(event.target.value) && setTotalItems(event.target.value)
            }
            required
          />
        </label>
        {error ? (
          <p className="notice notice-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="form-actions">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit">Create quiz</Button>
        </div>
      </form>
    </Modal>
  );
}

export default function QuizModule({
  classId,
  students = [],
  attendanceTaken = false,
  onTakeAttendance,
  tabCache,
  readOnly = false,
}) {
  const cachedSessions = tabCache?.get(`quizzes:${classId}`);
  const [sessions, setSessions] = useState(cachedSessions || []);
  const [selected, setSelected] = useState(null);
  const [view, setView] = useState("list");
  const [title, setTitle] = useState("");
  const [totalItems, setTotalItems] = useState(10);
  const [scores, setScores] = useState({});
  const [loading, setLoading] = useState(!cachedSessions);
  const [saved, setSaved] = useState(true);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [attendancePrompt, setAttendancePrompt] = useState(false);
  const [attendanceWarning, setAttendanceWarning] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);

  const mountedRef = useRef(true);
  const loadReqIdRef = useRef(0);
  const selectedRef = useRef(null);
  const draftDirtyRef = useRef(false);

  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);

  const loadSessions = useCallback(
    async ({ syncEditor = false } = {}) => {
      const reqId = ++loadReqIdRef.current;
      try {
        const { sessions: result } = await api.quizSessions(classId);
        if (!mountedRef.current || reqId !== loadReqIdRef.current) return;
        setSessions(result);
        tabCache?.set(`quizzes:${classId}`, result);
        const currentSelected = selectedRef.current;
        if (currentSelected) {
          const refreshed = result.find((item) => item.id === currentSelected.id);
          if (refreshed) {
            selectedRef.current = refreshed;
            setSelected(refreshed);
            if (syncEditor || !draftDirtyRef.current) {
              setScores(
                Object.fromEntries(
                  (refreshed.scores || []).map((item) => [item.studentId, item.score ?? ""]),
                ),
              );
            }
          }
        }
      } catch (loadError) {
        if (mountedRef.current && reqId === loadReqIdRef.current) {
          setError(loadError.message);
        }
      } finally {
        if (mountedRef.current && reqId === loadReqIdRef.current) {
          setLoading(false);
        }
      }
    },
    [classId, tabCache],
  );

  useEffect(() => {
    mountedRef.current = true;
    loadSessions();
    return () => {
      mountedRef.current = false;
      loadReqIdRef.current += 1;
    };
  }, [loadSessions]);

  useEffect(() => {
    if (!selected) return;
    setSelected((current) =>
      current
        ? {
            ...current,
            scores: (current.scores || []).map((item) => {
              const student = students.find((candidate) => candidate.id === item.studentId);
              return student && ["PRESENT", "LATE"].includes(student.status || student.attendanceStatus)
                ? { ...item, isAbsent: false }
                : item;
            }),
          }
        : current,
    );
  }, [students, selected?.id]);

  function openQuiz(session) {
    selectedRef.current = session;
    draftDirtyRef.current = false;
    setSelected(session);
    setTitle(session.title);
    setTotalItems(session.totalItems);
    setScores(
      Object.fromEntries((session.scores || []).map((item) => [item.studentId, item.score ?? ""])),
    );
    setSaved(true);
    setMessage("");
    setView("editor");
  }

  function beginNewQuiz() {
    if (readOnly) return;
    if (!attendanceTaken) {
      setAttendancePrompt(true);
      return;
    }
    setComposerOpen(true);
  }

  function newQuiz({ title: nextTitle, totalItems: nextTotal }) {
    selectedRef.current = null;
    draftDirtyRef.current = true;
    setSelected(null);
    setTitle(nextTitle);
    setTotalItems(nextTotal);
    setScores({});
    setSaved(false);
    setMessage("");
    setAttendanceWarning(false);
    setComposerOpen(false);
    setView("editor");
  }

  function continueWithoutAttendance() {
    setAttendancePrompt(false);
    setAttendanceWarning(true);
    setComposerOpen(true);
  }

  function backToList() {
    if (!readOnly && !saved && !window.confirm("You have unsaved changes. Leave without saving?")) {
      return;
    }
    setView("list");
    setError("");
  }

  function updateScore(studentId, value) {
    if (readOnly) return;
    const liveStudent = students.find((candidate) => candidate.id === studentId);
    const liveStatus = liveStudent?.status || liveStudent?.attendanceStatus;
    const absent = liveStatus === "ABSENT" || (!["PRESENT", "LATE"].includes(liveStatus) && selected?.scores?.some((item) => item.studentId === studentId && item.isAbsent));
    if (absent) return;
    if (value === "") {
      draftDirtyRef.current = true;
      setScores((current) => ({ ...current, [studentId]: "" }));
      setSaved(false);
      return;
    }
    const score = Number(value);
    if (!Number.isInteger(score) || score < 0 || score > Number(totalItems)) {
      setError(`Scores must be whole numbers from 0 to ${totalItems}.`);
      return;
    }
    setError("");
    draftDirtyRef.current = true;
    setScores((current) => ({ ...current, [studentId]: score }));
    setSaved(false);
  }

  async function saveQuiz() {
    if (readOnly) return;
    const total = Number(totalItems);
    if (!title.trim() || !Number.isInteger(total) || total < 1) {
      setError("Enter a title and positive whole-number total.");
      return;
    }
    const conflicts = Object.entries(scores).filter(
      ([, score]) => score !== "" && Number(score) > total,
    );
    if (conflicts.length) {
      const conflictNames = conflicts
        .map(([studentId]) => {
          const found = students.find((student) => student.id === studentId);
          return found ? formatStudentDisplayName(found.name, found) || found.name : studentId;
        })
        .join(", ");
      setError(`These scores exceed the new total: ${conflictNames}.`);
      return;
    }
    try {
      let session = selected;
      if (session) {
        ({ session } = await api.updateQuizSession(session.id, {
          title: title.trim(),
          totalItems: total,
        }));
      } else {
        ({ session } = await api.createQuizSession(classId, {
          title: title.trim(),
          totalItems: total,
        }));
        selectedRef.current = session;
        setSelected(session);
      }
      const scorePayload = Object.entries(scores)
        .filter(([, score]) => score !== "")
        .map(([studentId, score]) => ({ studentId, score: Number(score) }));
      if (scorePayload.length > 0) {
        await api.setQuizScoresBulk(session.id, scorePayload);
      }
      draftDirtyRef.current = false;
      tabCache?.invalidate(`quizzes:${classId}`);
      await loadSessions({ syncEditor: true });
      setSaved(true);
      setMessage("All changes saved.");
    } catch (saveError) {
      setError(saveError.message);
    }
  }

  async function deleteQuiz() {
    if (readOnly || !selected || !window.confirm("Delete this quiz? This cannot be undone.")) return;
    try {
      tabCache?.invalidate(`quizzes:${classId}`);
      await api.deleteQuizSession(selected.id);
      selectedRef.current = null;
      draftDirtyRef.current = false;
      setSelected(null);
      setView("list");
      await loadSessions();
    } catch (deleteError) {
      setError(deleteError.message);
    }
  }

  if (loading && !sessions.length) return <ModuleSkeleton aria-label="Loading quizzes" />;
  if (loading && view === "editor" && !selected) return <ModuleSkeleton aria-label="Loading quiz" />;

  if (view === "list") {
    return (
      <div className="quiz-module">
        <ModuleHeader
          title="Quizzes"
          subtitle={
            readOnly
              ? "Browse saved quiz sessions in read-only mode."
              : "Browse saved quiz sessions or open a new one."
          }
          actions={
            !readOnly && sessions.length > 0 ? (
              <Button onClick={beginNewQuiz}>
                <Icon name="plus" /> New quiz
              </Button>
            ) : null
          }
        />
        {attendanceWarning ? (
          <p className="notice notice-warning">Attendance not taken, absences not applied.</p>
        ) : null}
        {sessions.length ? (
          <div className="quiz-list">
            {sessions.map((session) => (
              <button
                type="button"
                className="quiz-list-row"
                key={session.id}
                onClick={() => openQuiz(session)}
              >
                <span className="quiz-list-icon">
                  <Icon name="brain" />
                </span>
                <span>
                  <strong>{session.title}</strong>
                  <small>
                    {new Date(session.date).toLocaleDateString(undefined, { timeZone: "Asia/Manila" })} · /{session.totalItems}
                  </small>
                </span>
                <span className="quiz-list-meta">
                  {(session.scores || []).filter((item) => item.score !== null).length} scored · Saved
                </span>
                <Icon name="chevron" />
              </button>
            ))}
          </div>
        ) : (
          <EmptyState
            title="No quizzes yet"
            description={
              readOnly
                ? "No quiz sessions were recorded for this class."
                : "A dated, item-counted quiz sheet with automatic absence locking."
            }
            icon="brain"
            action={
              !readOnly ? (
                <Button onClick={beginNewQuiz}>
                  <Icon name="plus" /> New quiz
                </Button>
              ) : null
            }
          />
        )}
        {error ? (
          <p className="notice notice-error" role="alert">
            {error}
          </p>
        ) : null}
        {!readOnly && composerOpen ? (
          <QuizForm onClose={() => setComposerOpen(false)} onSubmit={newQuiz} />
        ) : null}
        {!readOnly && attendancePrompt ? (
          <div className="pending-overlay" role="presentation">
            <div
              className="pending-drawer quiz-attendance-prompt"
              role="dialog"
              aria-modal="true"
              aria-labelledby="quiz-attendance-title"
            >
              <Icon name="clipboardCheck" />
              <h2 id="quiz-attendance-title">Take attendance first</h2>
              <p>Students who are absent can&apos;t be scored on a quiz.</p>
              <div className="form-actions">
                <button
                  type="button"
                  className="button button-primary"
                  onClick={() => {
                    setAttendancePrompt(false);
                    onTakeAttendance?.();
                  }}
                >
                  Take Attendance
                </button>
                <button
                  type="button"
                  className="button button-quiet"
                  onClick={continueWithoutAttendance}
                >
                  Continue anyway
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  const absentIds = new Set(
    (selected?.scores || []).filter((item) => item.isAbsent).map((item) => item.studentId),
  );

  return (
    <div className="quiz-module">
      <div className="quiz-editor-toolbar">
        <button type="button" className="button button-quiet" onClick={backToList}>
          ← Back to Quizzes
        </button>
        <span className={saved ? "quiz-saved" : "quiz-unsaved"}>
          {readOnly ? "Read-only" : saved ? "All changes saved" : "Unsaved changes"}
        </span>
        {!readOnly && selected ? (
          <button type="button" className="button button-quiet pending-decline" onClick={deleteQuiz}>
            <Icon name="trash" /> Delete quiz
          </button>
        ) : null}
      </div>
      {attendanceWarning ? (
        <p className="notice notice-warning">Attendance not taken, absences not applied.</p>
      ) : null}
      <ModuleHeader
        title={selected?.title || "New quiz"}
        subtitle={
          readOnly
            ? "This class is archived. Quiz scores are read-only."
            : "Scores are held as a draft until Save."
        }
      />
      <div className="panel quiz-editor-fields">
        <label className="field">
          <span>Quiz title or label</span>
          <input
            className="input"
            value={title}
            disabled={readOnly}
            onChange={(event) => {
              if (!readOnly) {
                draftDirtyRef.current = true;
                setTitle(event.target.value);
                setSaved(false);
              }
            }}
            placeholder="Quiz 1 - Reading check"
          />
        </label>
        <label className="field">
          <span>Total items</span>
          <input
            className="input"
            type="number"
            min="1"
            step="1"
            value={totalItems}
            disabled={readOnly}
            onChange={(event) => {
              if (!readOnly) {
                draftDirtyRef.current = true;
                setTotalItems(event.target.value);
                setSaved(false);
              }
            }}
          />
        </label>
      </div>
      <div className="quiz-card-grid">
        {students.map((student) => {
          const liveStatus = student.status || student.attendanceStatus;
          const absent = liveStatus === "ABSENT" || (!["PRESENT", "LATE"].includes(liveStatus) && absentIds.has(student.id));
          const displayName = formatStudentDisplayName(student.name, student) || student.name;
          const programSection = formatProgramSection(student.program, student.section);
          return (
            <article
              className={`quiz-student-card${absent ? " quiz-student-absent" : ""}`}
              key={student.id}
            >
              <Avatar
                src={student.photo}
                name={student.name}
                size="md"
                className="quiz-student-photo"
              />
              <div className="quiz-student-copy">
                <strong>{displayName}</strong>
                <span>
                  ID {student.studentId}
                  {programSection ? ` · ${programSection}` : ""}
                </span>
              </div>
              {absent ? (
                <span className="quiz-absent-flag">
                  <Icon name="lock" /> Absent
                </span>
              ) : (
                <label className="quiz-score-field">
                  <span className="sr-only">Score for {displayName}</span>
                  <input
                    className="input"
                    type="number"
                    min="0"
                    max={totalItems}
                    step="1"
                    value={scores[student.id] ?? ""}
                    disabled={readOnly}
                    onChange={(event) => updateScore(student.id, event.target.value)}
                    placeholder="-"
                  />
                  <b>/ {totalItems}</b>
                </label>
              )}
            </article>
          );
        })}
      </div>
      {error ? (
        <p className="notice notice-error" role="alert">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="notice notice-success" role="status">
          {message}
        </p>
      ) : null}
      {!readOnly ? (
        <div className="quiz-editor-actions">
          <button type="button" className="button button-primary" onClick={saveQuiz}>
            <Icon name="check" /> Save
          </button>
        </div>
      ) : null}
    </div>
  );
}
