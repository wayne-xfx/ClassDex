import { useEffect, useRef, useState } from "react";
import Avatar from "../Avatar";
import Icon from "../Icon";
import { formatStudentName } from "./studentNames";
import {
  getSavedShuffleMuted,
  playShuffleReveal,
  playShuffleTick,
  saveShuffleMuted,
  unlockShuffleAudio,
} from "../../utils/shuffleSound";

const SHUFFLE_DURATION_MS = 2400;

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
}) {
  const student = currentCall?.student || null;
  const count = eligibleStudents.length;
  const [previewIndex, setPreviewIndex] = useState(0);
  const [soundMuted, setSoundMuted] = useState(getSavedShuffleMuted);
  const soundMutedRef = useRef(soundMuted);
  const userGestureActiveRef = useRef(false);
  const lastRevealedLogIdRef = useRef(currentCall?.log?.id || null);

  useEffect(() => {
    soundMutedRef.current = soundMuted;
  }, [soundMuted]);

  function toggleSoundMuted() {
    setSoundMuted((current) => {
      const nextMuted = !current;
      saveShuffleMuted(nextMuted);
      if (!nextMuted) {
        unlockShuffleAudio();
      }
      return nextMuted;
    });
  }

  function handleShuffleClick() {
    userGestureActiveRef.current = true;
    if (!soundMutedRef.current) {
      unlockShuffleAudio();
    }
    onShuffle(animationEnabled);
  }

  function handleSkipClick() {
    userGestureActiveRef.current = true;
    if (!soundMutedRef.current) {
      unlockShuffleAudio();
    }
    onSkip(animationEnabled);
  }

  useEffect(() => {
    if (!busy || !animationEnabled || !eligibleStudents.length) return undefined;
    let cancelled = false;
    let timeoutId = null;
    const startTime = performance.now();

    function step() {
      if (cancelled) return;
      const elapsed = performance.now() - startTime;
      const progress = Math.min(1, elapsed / SHUFFLE_DURATION_MS);

      setPreviewIndex((index) => (index + 1) % eligibleStudents.length);
      if (userGestureActiveRef.current && !soundMutedRef.current) {
        playShuffleTick(progress);
      }

      // Start fast (~55ms) and decelerate smoothly (~250ms) with the shuffle animation
      const nextDelay = Math.round(55 + (progress * progress) * 195);
      timeoutId = window.setTimeout(step, nextDelay);
    }

    if (userGestureActiveRef.current && !soundMutedRef.current) {
      playShuffleTick(0);
    }
    timeoutId = window.setTimeout(step, 55);

    return () => {
      cancelled = true;
      if (timeoutId !== null) window.clearTimeout(timeoutId);
    };
  }, [animationEnabled, busy, eligibleStudents.length]);

  useEffect(() => {
    const logId = currentCall?.log?.id || null;
    if (busy || !logId) return;
    if (logId !== lastRevealedLogIdRef.current) {
      lastRevealedLogIdRef.current = logId;
      if (userGestureActiveRef.current && !soundMutedRef.current) {
        playShuffleReveal();
      }
      userGestureActiveRef.current = false;
    }
  }, [busy, currentCall?.log?.id]);

  const previewStudent = eligibleStudents[previewIndex] || null;

  return (
    <div className="recitation-module">
      <div className="recitation-heading">
        <div>
          <span className="eyebrow"><Icon name="mic" /> Recitation</span>
          <h2>Who’s up next?</h2>
          <p>Students marked Present or Late today can be called.</p>
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

      <section className="recitation-mini-deck" aria-label="Eligible students in the shuffle deck">
        <div className="recitation-mini-deck-heading">
          <strong>Shuffle deck</strong>
          <span>Present and Late students · {count} cards</span>
        </div>
        {count ? (
          <div className="recitation-mini-cards">
            {eligibleStudents.map((eligibleStudent) => (
              <div
                className="recitation-mini-card"
                key={eligibleStudent.id}
                title={`${formatStudentName(eligibleStudent.name)} · ${eligibleStudent.status === "LATE" ? "Late" : "Present"}`}
              >
                <Avatar src={eligibleStudent.photo} name={eligibleStudent.name} className="recitation-mini-photo" />
                <span>{formatStudentName(eligibleStudent.name)}</span>
                {eligibleStudent.status === "LATE" ? <small className="recitation-mini-late">Late</small> : null}
              </div>
            ))}
          </div>
        ) : (
          <p className="recitation-mini-empty">Mark students Present or Late in Attendance to add their cards.</p>
        )}
      </section>

      <div className="recitation-animation-toggle">
        <button
          type="button"
          className={`recitation-sound-toggle${soundMuted ? " is-muted" : ""}`}
          aria-pressed={!soundMuted}
          aria-label={soundMuted ? "Unmute shuffle sound" : "Mute shuffle sound"}
          onClick={toggleSoundMuted}
        >
          <Icon name={soundMuted ? "volumeOff" : "volume"} size={16} />
          <span>{soundMuted ? "Sound muted" : "Sound on"}</span>
        </button>
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
        {busy && animationEnabled && previewStudent ? (
          <article className="recitation-shuffling-card" key={previewStudent.id}>
            <Avatar src={previewStudent.photo} name={previewStudent.name} className="recitation-shuffling-photo" />
            <strong>{formatStudentName(previewStudent.name)}</strong>
            <span>ID {previewStudent.studentId}</span>
            <div className="recitation-shuffling-lines" aria-hidden="true"><i /><i /><i /></div>
            <span className="recitation-shuffling-label">Shuffling the deck…</span>
          </article>
        ) : student ? (
          <article className="recitation-card" key={currentCall.log.id}>
            <span className="recitation-call-label"><Icon name="check" size={15} /> Your next speaker</span>
            <Avatar src={student.photo} name={student.name} className="recitation-student-photo" />
            <h3>{formatStudentName(student.name)}</h3>
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
              : "Mark students Present or Late in Attendance. Absent and Unmarked students are never included."}</p>
          </div>
        )}
      </section>

      <div className="recitation-actions">
        <button
          type="button"
          className="button button-primary recitation-primary-action"
          disabled={!count || busy || savingScore}
          onClick={handleShuffleClick}
        >
          <Icon name="shuffle" />
          {busy ? "Picking…" : student ? "Shuffle again" : "Shuffle"}
        </button>
        {student ? (
          <button type="button" className="button button-secondary" disabled={count < 2 || busy || savingScore} onClick={handleSkipClick}>
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
                <Avatar src={call.student.photo} name={call.student.name} className="history-student-photo" />
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
