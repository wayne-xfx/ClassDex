import { useEffect, useState } from "react";
import Icon from "../Icon";
import { api } from "../../api";

export default function QuizModule({ classId, students = [] }) {
  const [title, setTitle] = useState("");
  const [totalItems, setTotalItems] = useState(10);
  const [scores, setScores] = useState({});
  const [absentIds, setAbsentIds] = useState(new Set());
  const [sessionId, setSessionId] = useState(null);
  const [sessionOpen, setSessionOpen] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    api.quizSessions(classId).then(({ sessions }) => {
      const latest = sessions[0];
      if (active && latest) {
        setSessionId(latest.id); setTitle(latest.title); setTotalItems(latest.totalItems); setSessionOpen(true);
        setScores(Object.fromEntries(latest.scores.map((item) => [item.studentId, item.score ?? ""])));
        setAbsentIds(new Set(latest.scores.filter((item) => item.isAbsent).map((item) => item.studentId)));
      }
    }).catch((loadError) => { if (active) setError(loadError.message); });
    return () => { active = false; };
  }, [classId]);

  function openSession(event) {
    event.preventDefault();
    const total = Number(totalItems);
    if (!title.trim() || !Number.isInteger(total) || total < 1) { setError("Enter a quiz title and a positive whole-number item total."); return; }
    api.createQuizSession(classId, { title: title.trim(), totalItems: total }).then(({ session }) => { setSessionId(session.id); setSessionOpen(true); }).catch((saveError) => setError(saveError.message));
  }

  function updateScore(studentId, value) {
    if (absentIds.has(studentId)) return;
    if (value === "") { setScores((current) => ({ ...current, [studentId]: "" })); return; }
    const score = Number(value);
    if (!Number.isInteger(score) || score < 0 || score > Number(totalItems)) { setError(`Scores must be whole numbers from 0 to ${totalItems}.`); return; }
    setError(""); setScores((current) => ({ ...current, [studentId]: score }));
    api.setQuizScore(sessionId, studentId, score).catch((saveError) => setError(saveError.message));
  }

  return <div className="quiz-module">
    <div className="quiz-heading"><div><span className="eyebrow"><Icon name="book" /> Quick scoring</span><h2>Quiz scores</h2><p>Open a session, then score every approved student.</p></div>{sessionOpen ? <span className="quiz-session-pill">{title} /{totalItems}</span> : null}</div>
    {!sessionOpen ? <form className="panel quiz-session-form" onSubmit={openSession}><label className="field"><span>Quiz title or label</span><input className="input" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Quiz 1 - Reading check" /></label><label className="field"><span>Total items</span><input className="input" type="number" min="1" step="1" value={totalItems} onChange={(event) => setTotalItems(event.target.value)} /></label><button className="button button-primary" type="submit">Open quiz session <Icon name="arrow" /></button></form> : <div className="quiz-card-grid">{students.map((student) => { const absent = student.attendanceStatus === "ABSENT" || absentIds.has(student.id); return <article className={`quiz-student-card${absent ? " quiz-student-absent" : ""}`} key={student.id}><div className="quiz-student-photo">{student.photo ? <img src={student.photo} alt="" /> : <Icon name="user" />}</div><div className="quiz-student-copy"><strong>{student.name}</strong><span>ID {student.studentId}</span></div>{absent ? <span className="quiz-absent-flag"><Icon name="lock" /> Absent</span> : <label className="quiz-score-field"><span className="sr-only">Score for {student.name}</span><input className="input" type="number" min="0" max={totalItems} step="1" value={scores[student.id] ?? ""} onChange={(event) => updateScore(student.id, event.target.value)} placeholder="-" /><b>/ {totalItems}</b></label>}</article>; })}</div>}
    {error ? <p className="notice notice-error" role="alert">{error}</p> : null}
    {sessionOpen && !students.length ? <div className="empty-state"><Icon name="users" /><strong>No approved students yet</strong><span>Approved class members will appear here.</span></div> : null}
  </div>;
}
