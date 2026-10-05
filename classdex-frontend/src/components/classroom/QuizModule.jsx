import { useState } from "react";
import Icon from "../Icon";

export default function QuizModule({ students = [], onCreateSession, onSaveScore }) {
  const [title, setTitle] = useState("");
  const [totalItems, setTotalItems] = useState(10);
  const [scores, setScores] = useState({});
  const [sessionOpen, setSessionOpen] = useState(false);
  const [error, setError] = useState("");

  function openSession(event) {
    event.preventDefault();
    if (!title.trim() || !Number.isInteger(Number(totalItems)) || Number(totalItems) < 1) { setError("Enter a quiz title and a positive whole-number item total."); return; }
    setError(""); setSessionOpen(true); onCreateSession?.({ title: title.trim(), totalItems: Number(totalItems) });
  }

  function updateScore(studentId, value) {
    if (value === "") { setScores((current) => ({ ...current, [studentId]: "" })); return; }
    const next = Number(value);
    if (!Number.isInteger(next) || next < 0 || next > Number(totalItems)) { setError(`Scores must be whole numbers from 0 to ${totalItems}.`); return; }
    setError(""); setScores((current) => ({ ...current, [studentId]: next })); onSaveScore?.(studentId, next);
  }

  return <div className="quiz-module">
    <div className="quiz-heading"><div><span className="eyebrow"><Icon name="book" /> Quick scoring</span><h2>Quiz scores</h2><p>Open a session, then score every approved student against the same total.</p></div>{sessionOpen ? <span className="quiz-session-pill">{title} · /{totalItems}</span> : null}</div>
    {!sessionOpen ? <form className="panel quiz-session-form" onSubmit={openSession}><label className="field"><span>Quiz title or label</span><input className="input" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Quiz 1 · Reading check" /></label><label className="field"><span>Total items</span><input className="input" type="number" min="1" step="1" value={totalItems} onChange={(event) => setTotalItems(event.target.value)} /></label><button className="button button-primary" type="submit">Open quiz session <Icon name="arrow" /></button></form> : <div className="quiz-card-grid">{students.map((student) => { const absent = student.attendanceStatus === "ABSENT"; return <article className={`quiz-student-card${absent ? " quiz-student-absent" : ""}`} key={student.id}><div className="quiz-student-photo">{student.photo ? <img src={student.photo} alt="" /> : <Icon name="user" />}</div><div className="quiz-student-copy"><strong>{student.name}</strong><span>ID {student.studentId}</span></div>{absent ? <span className="quiz-absent-flag"><Icon name="lock" /> Absent</span> : <label className="quiz-score-field"><span className="sr-only">Score for {student.name}</span><input className="input" type="number" min="0" max={totalItems} step="1" value={scores[student.id] ?? ""} onChange={(event) => updateScore(student.id, event.target.value)} placeholder="—" /><b>/ {totalItems}</b></label>}</article>; })}</div>}
    {error ? <p className="notice notice-error" role="alert">{error}</p> : null}
    {sessionOpen && !students.length ? <div className="empty-state"><Icon name="users" /><strong>No approved students yet</strong><span>Approved class members will appear here.</span></div> : null}
  </div>;
}
