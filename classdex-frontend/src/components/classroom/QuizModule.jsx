import { useState } from "react";
import Icon from "../Icon";

const MOCK_QUIZZES = [{ id: "mock-quiz-1", title: "Quiz 1 - Reading check", date: "Today", totalItems: 10, scored: 24, status: "Open" }];

export default function QuizModule({ students = [] }) {
  const [view, setView] = useState("list");
  const [selected, setSelected] = useState(null);
  const [title, setTitle] = useState("");
  const [totalItems, setTotalItems] = useState(10);
  const [scores, setScores] = useState({});
  const [saved, setSaved] = useState(true);
  const [message, setMessage] = useState("");
  const [quizzes, setQuizzes] = useState(MOCK_QUIZZES);

  function openQuiz(quiz) { setSelected(quiz); setTitle(quiz.title); setTotalItems(quiz.totalItems); setView("editor"); setSaved(true); }
  function newQuiz() { setSelected(null); setTitle(""); setTotalItems(10); setScores({}); setSaved(false); setView("editor"); }
  function backToList() { if (!saved && !window.confirm("You have unsaved changes. Leave without saving?")) return; setView("list"); }
  function saveQuiz() { if (!title.trim() || !Number.isInteger(Number(totalItems)) || Number(totalItems) < 1) { setMessage("Enter a title and positive whole-number total."); return; } const next = selected ? quizzes.map((quiz) => quiz.id === selected.id ? { ...quiz, title: title.trim(), totalItems: Number(totalItems) } : quiz) : [...quizzes, { id: `mock-${Date.now()}`, title: title.trim(), totalItems: Number(totalItems), date: "Today", scored: 0, status: "Open" }]; setQuizzes(next); setSaved(true); setMessage("All changes saved."); }
  function updateScore(studentId, value) { if (value === "") { setScores((current) => ({ ...current, [studentId]: "" })); setSaved(false); return; } const score = Number(value); if (!Number.isInteger(score) || score < 0 || score > Number(totalItems)) { setMessage(`Scores must be whole numbers from 0 to ${totalItems}.`); return; } setScores((current) => ({ ...current, [studentId]: score })); setSaved(false); }
  function deleteQuiz() { if (!selected || !window.confirm("Delete this quiz? This cannot be undone.")) return; setQuizzes((current) => current.filter((quiz) => quiz.id !== selected.id)); setView("list"); }

  if (view === "list") return <div className="quiz-module"><div className="quiz-heading"><div><span className="eyebrow"><Icon name="brain" /> Quiz module</span><h2>Quizzes</h2><p>Browse saved quiz sessions or open a new one.</p></div><button type="button" className="button button-primary" onClick={newQuiz}><Icon name="plus" /> New Quiz</button></div>{quizzes.length ? <div className="quiz-list">{quizzes.map((quiz) => <button type="button" className="quiz-list-row" key={quiz.id} onClick={() => openQuiz(quiz)}><span className="quiz-list-icon"><Icon name="brain" /></span><span><strong>{quiz.title}</strong><small>{quiz.date} · /{quiz.totalItems}</small></span><span className="quiz-list-meta">{quiz.scored} scored · {quiz.status}</span><Icon name="chevron" /></button>)}</div> : <div className="empty-state"><Icon name="brain" /><strong>No quizzes yet</strong><span>Open a new quiz session to start scoring.</span></div>}</div>;

  return <div className="quiz-module"><div className="quiz-editor-toolbar"><button type="button" className="button button-quiet" onClick={backToList}>← Back to Quizzes</button><span className={saved ? "quiz-saved" : "quiz-unsaved"}>{saved ? "All changes saved" : "Unsaved changes"}</span>{selected ? <button type="button" className="button button-quiet pending-decline" onClick={deleteQuiz}><Icon name="trash" /> Delete quiz</button> : null}</div><div className="quiz-heading"><div><span className="eyebrow"><Icon name="brain" /> Quiz editor</span><h2>{selected?.title || "New quiz"}</h2><p>Scores are drafts until you press Save.</p></div></div><div className="panel quiz-editor-fields"><label className="field"><span>Quiz title or label</span><input className="input" value={title} onChange={(event) => { setTitle(event.target.value); setSaved(false); }} placeholder="Quiz 1 - Reading check" /></label><label className="field"><span>Total items</span><input className="input" type="number" min="1" step="1" value={totalItems} onChange={(event) => { setTotalItems(event.target.value); setSaved(false); }} /></label></div><div className="quiz-card-grid">{students.map((student) => <article className="quiz-student-card" key={student.id}><div className="quiz-student-photo">{student.photo ? <img src={student.photo} alt="" /> : <Icon name="user" />}</div><div className="quiz-student-copy"><strong>{student.name}</strong><span>ID {student.studentId}</span></div><label className="quiz-score-field"><span className="sr-only">Score for {student.name}</span><input className="input" type="number" min="0" max={totalItems} step="1" value={scores[student.id] ?? ""} onChange={(event) => updateScore(student.id, event.target.value)} placeholder="-" /><b>/ {totalItems}</b></label></article>)}</div>{message ? <p className="notice notice-info" role="status">{message}</p> : null}<div className="quiz-editor-actions"><button type="button" className="button button-primary" onClick={saveQuiz}><Icon name="check" /> Save</button></div></div>;
}
