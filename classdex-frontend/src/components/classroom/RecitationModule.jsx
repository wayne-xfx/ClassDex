import Icon from "../Icon";

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
}) {
  const student = currentCall?.student || null;
  const count = eligibleStudents.length;

  return (
    <div className="recitation-module">
      <div className="recitation-heading">
        <div>
          <span className="eyebrow"><Icon name="shuffle" /> Recitation</span>
          <h2>Who’s up next?</h2>
          <p>Only students marked Present or Late today can be called.</p>
        </div>
        <div className="recitation-pool-count">
          <span>{count}</span>
          <div><strong>{count} {count === 1 ? "student" : "students"} in the pool</strong><small>Present or Late today</small></div>
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

      <section className="recitation-stage" aria-live="polite" aria-atomic="true">
        {student ? (
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
              : "Mark students Present or Late in Take attendance. Absent and Unmarked students are never included."}</p>
          </div>
        )}
      </section>

      <div className="recitation-actions">
        <button
          type="button"
          className="button button-primary recitation-primary-action"
          disabled={!count || busy}
          onClick={onShuffle}
        >
          <Icon name="shuffle" />
          {busy ? "Shuffling…" : student ? "Call next" : "Shuffle"}
        </button>
        {student ? (
          <button type="button" className="button button-secondary" disabled={!count || busy} onClick={onSkip}>
            <Icon name="arrow" /> Skip
          </button>
        ) : null}
      </div>
      {!count ? (
        <p className="recitation-pool-hint"><Icon name="clock" size={15} /> The shuffle is disabled until at least one student is marked Present or Late.</p>
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
