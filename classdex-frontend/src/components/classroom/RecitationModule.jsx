import { useEffect, useState } from "react";
import Icon from "../Icon";
import { formatStudentName } from "./studentNames";

export default function RecitationModule({
  eligibleStudents,
  currentCall,
  history,
  mode,
  onModeChange,
  onShuffle,
  onScoreChange,
  onSkip,
  busy = false,
  savingScore = false,
  animationEnabled = true,
  onAnimationChange,
  shufflePreview = null,
}) {
  const student = currentCall?.student || null;
  const count = eligibleStudents.length;
  const [previewIndex, setPreviewIndex] = useState(0);

  useEffect(() => {
    if (!busy || !eligibleStudents.length) return undefined;
    const interval = window.setInterval(() => {
      setPreviewIndex((index) => (index + 1) % eligibleStudents.length);
    }, 100);
    return () => window.clearInterval(interval);
  }, [busy, eligibleStudents.length]);
  const previewStudent = shufflePreview || eligibleStudents[previewIndex] || null;

  return (
    <div className="recitation-module">
      <div className="recitation-heading">
        <div>
          <span className="eyebrow"><Icon name="shuffle" /> Recitation</span>
          <h2>Who’s up next?</h2>
          <p>Only students marked Present today can be called.</p>
        </div>
        <div className="recitation-pool-count">
          <span>{count}</span>
          <div><strong>{count} {count === 1 ? "student" : "students"} in the pool</strong><small>Present today</small></div>
        </div>
      </div>

      <div className="recitation-mode" role="group" aria-label="Recitation shuffle mode">
        <span>Pick mode</span>
        <button
          type="button"
          aria-pressed={mode === "RANDOM"}
          className={mode === "RANDOM" ? "is-active" : ""}
          onClick={() => onModeChange("RANDOM")}
        >
          <Icon name="shuffle" size={16} /> Random
        </button>
        <button
          type="button"
          aria-pressed={mode === "WEIGHTED"}
          className={mode === "WEIGHTED" ? "is-active" : ""}
          onClick={() => onModeChange("WEIGHTED")}
        >
          <Icon name="sparkles" size={16} /> Weighted
        </button>
        <span className="recitation-mode-help">
          {mode === "WEIGHTED" ? "Favors students called less often this term." : "Every eligible student has an equal chance."}
        </span>
      </div>

      <section className="recitation-mini-deck" aria-label="Present students in the shuffle deck">
        <div className="recitation-mini-deck-heading">
          <strong>Shuffle deck</strong>
          <span>Present students only · {count} cards</span>
        </div>
        {count ? (
          <div className="recitation-mini-cards">
            {eligibleStudents.map((eligibleStudent) => (
              <div className="recitation-mini-card" key={eligibleStudent.id} title={formatStudentName(eligibleStudent.name)}>
                <div className="recitation-mini-photo">
                  {eligibleStudent.photo ? <img src={eligibleStudent.photo} alt="" /> : <Icon name="user" size={17} />}
                </div>
                <span>{formatStudentName(eligibleStudent.name)}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="recitation-mini-empty">Mark students Present in Take attendance to add their cards.</p>
        )}
      </section>

      <div className="recitation-animation-toggle">
        <label className="recitation-animation-switch">
          <span>Shuffle animation</span>
          <input
            type="checkbox"
            role="switch"
            aria-label="Shuffle animation"
            checked={animationEnabled}
            onChange={(event) => onAnimationChange(event.target.checked)}
          />
          <span className="recitation-switch-track" aria-hidden="true" />
        </label>
      </div>

      <section className="recitation-stage" aria-live="polite" aria-atomic="true">
        {busy && previewStudent ? (
          <article className="recitation-shuffling-card" key={previewStudent.id}>
            <div className="recitation-shuffling-photo">
              {previewStudent.photo ? <img src={previewStudent.photo} alt="" /> : <Icon name="user" size={30} />}
            </div>
            <strong>{formatStudentName(previewStudent.name)}</strong>
            <span>ID {previewStudent.studentId}</span>
            <div className="recitation-shuffling-lines" aria-hidden="true"><i /><i /><i /></div>
            <span className="recitation-shuffling-label">Shuffling the deck…</span>
          </article>
        ) : student ? (
          <article className="recitation-card" key={currentCall.log.id}>
            <div className="recitation-card-glint" aria-hidden="true" />
            <span className="recitation-call-label"><Icon name="check" size={15} /> Your next speaker</span>
            <div className="recitation-student-photo">
              {student.photo ? <img src={student.photo} alt="" /> : <Icon name="user" size={36} />}
            </div>
            <h3>{student.name}</h3>
            <p className="recitation-student-id">Student ID · {student.studentId}</p>
            <p className="recitation-student-program">
              {[student.program, student.section].filter(Boolean).join(" · ") || "Student"}
            </p>
            <div className="recitation-score">
              <span>{savingScore ? "Saving score…" : "Optional score"}</span>
              <div className="score-chips" role="group" aria-label={`Score for ${student.name}, from 0 to 5`}>
                {[0, 1, 2, 3, 4, 5].map((score) => (
                  <button
                    key={score}
                    type="button"
                    aria-label={`Score ${score}${currentCall.log.score === score ? ", selected; activate to clear" : ""}`}
                    aria-pressed={currentCall.log.score === score}
                    className={currentCall.log.score === score ? "is-active" : ""}
                    disabled={savingScore}
                    onClick={() => onScoreChange(currentCall.log.score === score ? null : score)}
                  >
                    {score}
                  </button>
                ))}
              </div>
            </div>
          </article>
        ) : (
          <div className="recitation-empty-card">
            <div className="recitation-deck-art" aria-hidden="true">
              <span /><span /><span><Icon name="shuffle" size={25} /></span>
            </div>
            <h3>{count ? "The deck is ready" : "No one in the pool yet"}</h3>
            <p>{count
              ? "Shuffle to reveal the next student. You can change or skip the pick at any time."
              : "Mark students Present in Take attendance. Late, Absent, and Unmarked students are never included."}</p>
          </div>
        )}
      </section>

      <div className="recitation-actions">
        <button
          type="button"
          className="button button-primary recitation-primary-action"
          disabled={!count || busy || savingScore}
          onClick={() => onShuffle(animationEnabled)}
        >
          <Icon name="shuffle" />
          {busy ? "Shuffling…" : student ? "Shuffle again" : "Shuffle"}
        </button>
        {student ? (
          <button type="button" className="button button-secondary" disabled={count < 2 || busy || savingScore} onClick={() => onSkip(animationEnabled)}>
            <Icon name="arrow" /> Skip
          </button>
        ) : null}
      </div>
      {!count ? (
        <p className="recitation-pool-hint"><Icon name="clock" size={15} /> The shuffle is disabled until at least one student is marked Present.</p>
      ) : null}

      {history.length ? (
        <section className="recitation-history" aria-label="Students called today">
          <div className="recitation-history-heading">
            <h3>Called today</h3>
            <span>{history.length}</span>
          </div>
          <ol>
            {history.map((call) => (
              <li key={call.id}>
                <div className="history-student-photo">
                  {call.student.photo ? <img src={call.student.photo} alt="" /> : <Icon name="user" size={16} />}
                </div>
                <span className="history-student-name">{call.student.name}</span>
                <span className="history-student-score">{call.score === null ? "No score" : `Score ${call.score}`}</span>
                <time dateTime={call.calledAt}>
                  {new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", timeZone: "Asia/Manila" }).format(new Date(call.calledAt))}
                </time>
              </li>
            ))}
          </ol>
        </section>
      ) : null}
    </div>
  );
}
