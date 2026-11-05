import { useEffect, useRef, useState } from "react";
import Avatar from "../Avatar";
import Icon from "../Icon";
import { ModuleHeader } from "./ClassShell";
import {
  formatProgramSection,
  formatStudentDisplayName,
  formatStudentName,
} from "./studentNames";
import {
  getSavedShuffleMuted,
  playShuffleReveal,
  playShuffleTick,
  saveShuffleMuted,
  unlockShuffleAudio,
} from "../../utils/shuffleSound";

export default function RecitationModule({
  eligibleStudents = [],
  currentCall = null,
  history = [],
  mode = "RANDOM",
  onModeChange,
  onShuffle,
  onScoreChange,
  onSkip,
  onOpenAttendance,
  busy = false,
  savingScore = false,
  animationEnabled = true,
  onAnimationChange,
  durationSeconds = 3,
  onDurationChange,
  readOnly = false,
}) {
  const durationMs = Math.max(1, Math.min(7, Number(durationSeconds) || 3)) * 1000;
  const student = currentCall?.student || null;
  const count = eligibleStudents.length;
  const [previewIndex, setPreviewIndex] = useState(0);
  const [soundMuted, setSoundMuted] = useState(getSavedShuffleMuted);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [showWeightedInfo, setShowWeightedInfo] = useState(false);

  const soundMutedRef = useRef(soundMuted);
  const userGestureActiveRef = useRef(false);
  const lastRevealedLogIdRef = useRef(currentCall?.log?.id || null);
  const settingsRef = useRef(null);
  const tooltipRef = useRef(null);

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

  function handleSettingsToggle() {
    unlockShuffleAudio();
    setSettingsOpen((prev) => !prev);
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

  // Click outside and Escape key handler for Settings popover and Weighted Info tooltip
  useEffect(() => {
    function handleClickOutside(event) {
      if (settingsRef.current && !settingsRef.current.contains(event.target)) {
        setSettingsOpen(false);
      }
      if (tooltipRef.current && !tooltipRef.current.contains(event.target)) {
        setShowWeightedInfo(false);
      }
    }
    function handleKeyDown(event) {
      if (event.key === "Escape") {
        setSettingsOpen(false);
        setShowWeightedInfo(false);
      }
    }
    if (settingsOpen || showWeightedInfo) {
      document.addEventListener("mousedown", handleClickOutside);
      document.addEventListener("keydown", handleKeyDown);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [settingsOpen, showWeightedInfo]);

  useEffect(() => {
    const reduceMotion = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!busy || !animationEnabled || reduceMotion || !eligibleStudents.length) return undefined;
    let cancelled = false;
    let timeoutId = null;
    const startTime = performance.now();

    function step() {
      if (cancelled) return;
      const elapsed = performance.now() - startTime;
      const progress = Math.min(1, elapsed / durationMs);

      setPreviewIndex((index) => (index + 1) % eligibleStudents.length);
      if (userGestureActiveRef.current && !soundMutedRef.current && animationEnabled && !reduceMotion) {
        playShuffleTick(progress);
      }

      // Start fast (~55ms) and decelerate smoothly (~250ms) with the shuffle animation
      const nextDelay = Math.round(55 + (progress * progress) * 195);
      timeoutId = window.setTimeout(step, nextDelay);
    }

    if (userGestureActiveRef.current && !soundMutedRef.current && animationEnabled && !reduceMotion) {
      playShuffleTick(0);
    }
    timeoutId = window.setTimeout(step, 55);

    return () => {
      cancelled = true;
      if (timeoutId !== null) window.clearTimeout(timeoutId);
    };
  }, [animationEnabled, busy, eligibleStudents.length, durationMs]);

  useEffect(() => {
    const logId = currentCall?.log?.id || null;
    if (busy || !logId) return;
    const reduceMotion = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (logId !== lastRevealedLogIdRef.current) {
      lastRevealedLogIdRef.current = logId;
      if (userGestureActiveRef.current && !soundMutedRef.current && animationEnabled && !reduceMotion) {
        playShuffleReveal();
      }
      userGestureActiveRef.current = false;
    }
  }, [animationEnabled, busy, currentCall?.log?.id]);

  const previewStudent = eligibleStudents[previewIndex] || null;

  return (
    <div className="recitation-module">
      <ModuleHeader
        title="Who’s up next?"
        subtitle="Students marked Present or Late today can be called."
        actions={
          <div className="recitation-pool-badge">
            <Icon name="users" size={16} />
            <span>{count} eligible {count === 1 ? "student" : "students"} · Present or Late today</span>
          </div>
        }
      />

      {/* Merged Deck & Mode Card */}
      <section className="recitation-deck-card" aria-label="Recitation controls and shuffle deck">
        <div className="recitation-deck-toolbar">
          <div className="recitation-mode-block">
            <span className="recitation-mode-label">Pick mode</span>
            <div className="recitation-mode-toggle" role="group" aria-label="Recitation shuffle mode">
              <button
                type="button"
                aria-pressed={mode === "RANDOM"}
                className={`recitation-mode-btn ${mode === "RANDOM" ? "is-active" : ""}`}
                onClick={() => onModeChange("RANDOM")}
              >
                <Icon name="shuffle" size={15} />
                <span>Random</span>
              </button>
              <button
                type="button"
                aria-pressed={mode === "WEIGHTED"}
                className={`recitation-mode-btn ${mode === "WEIGHTED" ? "is-active" : ""}`}
                onClick={() => onModeChange("WEIGHTED")}
              >
                <Icon name="sparkles" size={15} />
                <span>Weighted</span>
              </button>
            </div>

            <div className="recitation-tooltip-anchor" ref={tooltipRef}>
              <button
                type="button"
                className="recitation-help-btn"
                aria-label="Weighted selection information"
                aria-expanded={showWeightedInfo}
                onClick={() => setShowWeightedInfo((prev) => !prev)}
                onFocus={() => setShowWeightedInfo(true)}
                onBlur={() => setShowWeightedInfo(false)}
                onMouseEnter={() => setShowWeightedInfo(true)}
                onMouseLeave={() => setShowWeightedInfo(false)}
              >
                ?
              </button>
              {showWeightedInfo ? (
                <div className="recitation-help-popover" role="tooltip">
                  Students with fewer prior recitation calls in this class receive higher selection weight (1 / (1 + calls)).
                </div>
              ) : null}
            </div>

            <span className="recitation-mode-help">
              {mode === "WEIGHTED" ? "Favors students called less often this term." : "Every eligible student has an equal chance."}
            </span>
          </div>

          {!readOnly ? (
            <div className="recitation-actions-bar">
              <button
                type="button"
                className="button button-primary recitation-shuffle-btn"
                disabled={!count || busy || savingScore}
                onClick={handleShuffleClick}
              >
                <Icon name="shuffle" size={16} />
                <span>{busy ? "Picking…" : student ? "Shuffle again" : "Shuffle"}</span>
              </button>
              {student ? (
                <button
                  type="button"
                  className="button button-secondary recitation-skip-btn"
                  disabled={count < 2 || busy || savingScore}
                  onClick={handleSkipClick}
                >
                  <Icon name="arrow" size={16} />
                  <span>Skip</span>
                </button>
              ) : null}

              <div className="recitation-settings-anchor" ref={settingsRef}>
                <button
                  type="button"
                  className={`button button-secondary recitation-settings-btn ${settingsOpen ? "is-active" : ""}`}
                  aria-label="Recitation shuffle settings"
                  aria-haspopup="dialog"
                  aria-expanded={settingsOpen}
                  onClick={handleSettingsToggle}
                >
                  <Icon name="settings" size={17} />
                </button>

                {settingsOpen ? (
                  <div className="recitation-settings-popover" role="dialog" aria-label="Shuffle settings">
                    <div className="recitation-settings-header">
                      <strong>Shuffle settings</strong>
                    </div>
                    <div className="recitation-settings-body">
                      <button
                        type="button"
                        className={`recitation-sound-btn ${soundMuted ? "is-muted" : ""}`}
                        aria-pressed={!soundMuted}
                        aria-label={soundMuted ? "Unmute shuffle sound" : "Mute shuffle sound"}
                        onClick={toggleSoundMuted}
                      >
                        <Icon name={soundMuted ? "volumeOff" : "volume"} size={16} />
                        <span>{soundMuted ? "Sound muted" : "Sound on"}</span>
                      </button>

                      <label className="recitation-switch-row">
                        <span>Shuffle animation</span>
                        <input
                          type="checkbox"
                          role="switch"
                          aria-label="Shuffle animation"
                          checked={animationEnabled}
                          onChange={(e) => onAnimationChange(e.target.checked)}
                        />
                        <span className="recitation-switch-track" aria-hidden="true" />
                      </label>

                      <div className="recitation-duration-row">
                        <label className="recitation-duration-label" htmlFor="recitation-duration-slider">
                          <Icon name="timer" size={15} />
                          <span>Duration ({durationSeconds}s)</span>
                        </label>
                        <input
                          id="recitation-duration-slider"
                          type="range"
                          min="1"
                          max="7"
                          step="1"
                          value={durationSeconds}
                          disabled={!animationEnabled || busy}
                          aria-label="Shuffle animation duration"
                          onChange={(e) => onDurationChange?.(Number(e.target.value))}
                        />
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>

        {/* Eligible student strip */}
        {count ? (
          <div className="recitation-mini-cards">
            {eligibleStudents.map((eligibleStudent) => {
              const displayName =
                formatStudentDisplayName(eligibleStudent.name, eligibleStudent) ||
                formatStudentName(eligibleStudent.name);
              return (
                <div
                  className={`recitation-mini-card${eligibleStudent.status === "LATE" ? " is-late" : ""}`}
                  key={eligibleStudent.id}
                  title={`${displayName} · ${eligibleStudent.status === "LATE" ? "Late" : "Present"}`}
                >
                  <Avatar
                    src={eligibleStudent.photo}
                    name={eligibleStudent.name}
                    size="md"
                    className="recitation-mini-photo"
                  />
                  <span className="recitation-mini-name">{displayName}</span>
                  {eligibleStudent.status === "LATE" ? (
                    <small className="recitation-mini-late">Late</small>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : (
          <p className="recitation-mini-empty">Mark students Present or Late in Attendance to add their cards.</p>
        )}
      </section>

      {/* Stage: Shuffling card, Revealed speaker card, or Compact empty card */}
      <section className="recitation-stage" aria-live="polite" aria-atomic="true">
        {busy && animationEnabled && previewStudent ? (
          <article className="recitation-shuffling-card" key={previewStudent.id}>
            <Avatar src={previewStudent.photo} name={previewStudent.name} size="lg" className="recitation-shuffling-photo" />
            <strong>{formatStudentDisplayName(previewStudent.name, previewStudent) || formatStudentName(previewStudent.name)}</strong>
            <span>ID {previewStudent.studentId}</span>
            <div className="recitation-shuffling-lines" aria-hidden="true"><i /><i /><i /></div>
            <span className="recitation-shuffling-label">Shuffling the deck…</span>
          </article>
        ) : student ? (
          <article className="recitation-card" key={currentCall.log.id}>
            <span className="recitation-call-label"><Icon name="check" size={15} /> Your next speaker</span>
            <Avatar src={student.photo} name={student.name} size="lg" className="recitation-student-photo" />
            <h3>{formatStudentDisplayName(student.name, student) || formatStudentName(student.name)}</h3>
            <p className="recitation-student-id">Student ID · {student.studentId}</p>
            <p className="recitation-student-program">
              {formatProgramSection(student.program, student.section) || "Student"}
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
                    disabled={savingScore || readOnly}
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
              <span /><span /><span><Icon name="shuffle" size={24} /></span>
            </div>
            <h3>{count ? "The deck is ready" : "No one in the pool yet"}</h3>
            <p>
              {count
                ? "Shuffle to reveal the next student. You can change or skip the pick at any time."
                : "Mark students Present or Late in Attendance. Absent and Unmarked students are never included."}
            </p>
            {!count && onOpenAttendance ? (
              <button
                type="button"
                className="button button-secondary recitation-empty-attendance-btn"
                onClick={onOpenAttendance}
              >
                <Icon name="clipboardCheck" size={16} />
                <span>Go to Attendance</span>
              </button>
            ) : null}
          </div>
        )}
      </section>

      {/* History */}
      {history.length ? (
        <section className="recitation-history" aria-label="Students called today">
          <div className="recitation-history-heading">
            <h3>Called today</h3>
            <span>{history.length}</span>
          </div>
          <ol>
            {history.map((call) => {
              const displayName =
                formatStudentDisplayName(call.student?.name, call.student) ||
                formatStudentName(call.student?.name) ||
                call.student?.name;
              return (
                <li key={call.id}>
                  <Avatar src={call.student?.photo} name={call.student?.name} size="sm" className="history-student-photo" />
                  <span className="history-student-name">{displayName}</span>
                  <span className="history-student-score">{call.score === null ? "No score" : `Score ${call.score}`}</span>
                  <time dateTime={call.calledAt}>
                    {new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", timeZone: "Asia/Manila" }).format(new Date(call.calledAt))}
                  </time>
                </li>
              );
            })}
          </ol>
        </section>
      ) : null}
    </div>
  );
}
