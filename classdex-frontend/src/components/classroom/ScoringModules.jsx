import { useCallback, useEffect, useRef, useState } from "react";
import Icon from "../Icon";
import { Badge, Button, Card, Modal, PageHeader, Skeleton, StatusPill } from "../DesignSystem";
import { ConfirmDialog, EmptyState } from "./ClassroomComponents";
import { formatStudentName } from "./studentNames";
import { api } from "../../api";

function getRows(response) {
  return response.students || response.scores || response.records || [];
}

function getRelatedStudentId(row) {
  return row.studentId
    || row.studentProfile?.id
    || row.student?.id
    || row.profile?.id;
}

function formatScoreRows(response, students, sessionId) {
  const rows = getRows(response);
  return students.map((student) => {
    const scoreRow = rows.find((row) => getRelatedStudentId(row) === student.id);
    return {
      student,
      score: scoreRow?.score ?? null,
      isAbsent: Boolean(
        (scoreRow?.isAbsent || scoreRow?.absent)
          && (sessionId === undefined || scoreRow.sessionId === sessionId)
        || student.status === "ABSENT",
      ),
    };
  });
}

function parseOptionalInteger(value) {
  if (value === "") return null;
  if (!/^\d+$/.test(value)) return undefined;
  return Number(value);
}

function ScoreSkeleton() {
  return (
    <div className="scoring-skeleton-list" aria-label="Loading scores">
      {Array.from({ length: 6 }, (_, index) => (
        <Card key={index} className="scoring-skeleton-row">
          <Skeleton className="scoring-skeleton-avatar" />
          <Skeleton className="scoring-skeleton-name" />
          <Skeleton className="scoring-skeleton-input" />
        </Card>
      ))}
    </div>
  );
}

function AbsenceBanner({ count }) {
  if (!count) return null;
  return (
    <div className="scoring-absence-banner" role="status">
      <Icon name="info" />
      <span>{count} {count === 1 ? "student is" : "students are"} absent and locked for this session.</span>
    </div>
  );
}

function ScoreRow({ entry, maxScore, onSave, inputRef, onEnter }) {
  const [draftValue, setDraftValue] = useState(null);
  const value = draftValue ?? (entry.score == null ? "" : String(entry.score));
  const [state, setState] = useState("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const timer = useRef(null);
  const currentValue = useRef(value);
  const isAbsent = entry.isAbsent;

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const save = useCallback(async (scoreText) => {
    if (isAbsent) return;
    const parsed = parseOptionalInteger(scoreText);
    if (parsed === undefined || (parsed !== null && (parsed < 0 || (maxScore != null && parsed > maxScore)))) {
      setErrorMessage(`Enter a whole number from 0${maxScore == null ? " or greater" : ` to ${maxScore}`}.`);
      setState("error");
      return;
    }
    setState("saving");
    try {
      await onSave(entry.student.id, parsed);
      setDraftValue(null);
      setErrorMessage("");
      setState("saved");
      window.setTimeout(() => setState("idle"), 1100);
    } catch (saveError) {
      setErrorMessage(saveError.message);
      setState("error");
    }
  }, [entry.student.id, isAbsent, maxScore, onSave]);

  function changeValue(nextValue) {
    if (!/^\d*$/.test(nextValue)) return;
    currentValue.current = nextValue;
    setDraftValue(nextValue);
    setState("saving");
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => save(nextValue), 450);
  }

  function chooseScore(score) {
    const nextValue = String(score);
    window.clearTimeout(timer.current);
    currentValue.current = nextValue;
    setDraftValue(nextValue);
    save(nextValue);
  }

  function handleBlur() {
    window.clearTimeout(timer.current);
    if (currentValue.current !== (entry.score == null ? "" : String(entry.score))) {
      save(currentValue.current);
    }
  }

  const quickScores = maxScore == null
    ? []
    : [
        { label: "Full", value: maxScore },
        { label: "Half", value: Math.floor(maxScore / 2) },
        { label: "0", value: 0 },
      ];

  return (
    <div className={`scoring-row${isAbsent ? " scoring-row-absent" : ""}`}>
      <div className="scoring-student">
        <div className="scoring-student-photo">
          {entry.student.photo ? <img src={entry.student.photo} alt="" /> : <Icon name="user" size={20} />}
        </div>
        <div className="scoring-student-copy">
          <strong>{formatStudentName(entry.student.name)}</strong>
          <span>ID {entry.student.studentId}</span>
        </div>
        {isAbsent ? <StatusPill tone="absent" icon="x" title="Marked absent in attendance">Absent</StatusPill> : null}
      </div>
      <div className="scoring-entry-controls">
        <input
          ref={inputRef}
          className="scoring-input"
          type="number"
          inputMode="numeric"
          min="0"
          max={maxScore ?? undefined}
          step="1"
          value={value}
          aria-label={`Score for ${formatStudentName(entry.student.name)}`}
          disabled={isAbsent}
          onChange={(event) => changeValue(event.target.value)}
          onBlur={handleBlur}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              window.clearTimeout(timer.current);
              save(currentValue.current);
              onEnter();
            } else if (event.key === "Tab") {
              const moved = onEnter(event.shiftKey ? -1 : 1);
              if (moved) event.preventDefault();
            }
          }}
          onPaste={(event) => {
            const pasted = event.clipboardData.getData("text");
            if (!/^\d+$/.test(pasted)) event.preventDefault();
          }}
        />
        {quickScores.length ? (
          <div className="scoring-quick-scores" aria-label="Quick score">
            {quickScores.map((quick) => (
              <button
                type="button"
                key={quick.label}
                disabled={isAbsent}
                onClick={() => chooseScore(quick.value)}
                aria-label={`${quick.label} score, ${quick.value}`}
              >
                {quick.label}
              </button>
            ))}
          </div>
        ) : null}
        <span className={`scoring-save-state scoring-save-${state}`} aria-live="polite">
          {state === "saving" ? "Saving…" : state === "saved" ? <><Icon name="check" size={13} /> Saved</> : null}
          {state === "error" ? (
            <button type="button" title={errorMessage} aria-label={`Retry saving score. ${errorMessage}`} onClick={() => save(currentValue.current)}>
              Retry
            </button>
          ) : null}
        </span>
      </div>
    </div>
  );
}

export function ScoringSheet({ title, maxScore, entries, absentCount, onSave, back, backLabel = "Back" }) {
  const [filter, setFilter] = useState("ALL");
  const inputRefs = useRef([]);
  const scoredCount = entries.filter((entry) => !entry.isAbsent && entry.score != null).length;
  const scoredValues = entries.filter((entry) => !entry.isAbsent && entry.score != null).map((entry) => entry.score);
  const average = scoredValues.length
    ? (scoredValues.reduce((sum, value) => sum + value, 0) / scoredValues.length).toFixed(1)
    : "—";
  const highest = scoredValues.length ? Math.max(...scoredValues) : "—";
  const visibleEntries = entries.filter((entry) => {
    if (filter === "SCORED") return !entry.isAbsent && entry.score != null;
    if (filter === "UNSCORED") return entry.isAbsent || entry.score == null;
    return true;
  });
  useEffect(() => {
    inputRefs.current[0]?.focus();
  }, [entries.length]);

  return (
    <div className="scoring-sheet">
      <div className="scoring-sheet-heading">
        <div>
          <button type="button" className="back-link scoring-back" onClick={back}>
            <Icon name="chevron" /> {backLabel}
          </button>
          <PageHeader
            eyebrow="Scoring sheet"
            icon="book"
            title={title}
            description={`Scores save automatically as you enter them.${maxScore == null ? "" : ` Maximum score: ${maxScore}.`}`}
          />
        </div>
      </div>
      <div className="scoring-stats" aria-label="Scoring statistics">
        <Card><strong>{scoredCount}/{entries.length}</strong><span>Scored</span></Card>
        <Card><strong>{average}</strong><span>Class average</span></Card>
        <Card><strong>{highest}</strong><span>Highest score</span></Card>
      </div>
      <AbsenceBanner count={absentCount} />
      <div className="scoring-toolbar">
        <p>{entries.length} students</p>
        <div className="scoring-filters" role="group" aria-label="Filter students by score status">
          {[
            ["ALL", "All"],
            ["SCORED", "Scored"],
            ["UNSCORED", "Unscored"],
          ].map(([key, label]) => (
            <button type="button" key={key} className={filter === key ? "is-active" : ""} aria-pressed={filter === key} onClick={() => setFilter(key)}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="scoring-list">
        {visibleEntries.map((entry, index) => (
          <ScoreRow
            key={`${entry.student.id}-${entry.isAbsent}`}
            entry={entry}
            maxScore={maxScore}
            onSave={onSave}
            inputRef={(element) => { inputRefs.current[index] = element; }}
            onEnter={(direction = 1) => {
              const nextInput = inputRefs.current[index + direction];
              if (!nextInput) return false;
              nextInput.focus();
              return true;
            }}
          />
        ))}
      </div>
      {!entries.length ? <EmptyState title="No admitted students yet" description="Students will appear here after they join this class." icon="users" /> : null}
    </div>
  );
}

function ActivityForm({ activity, onClose, onSubmit, saving }) {
  const [title, setTitle] = useState(activity?.title || "");
  const [maxScore, setMaxScore] = useState(activity?.maxScore == null ? "" : String(activity.maxScore));
  const [error, setError] = useState("");

  async function submit(event) {
    event.preventDefault();
    const parsedMax = parseOptionalInteger(maxScore);
    if (parsedMax === undefined || (parsedMax !== null && parsedMax < 1)) {
      setError("Maximum score must be a whole number of 1 or greater.");
      return;
    }
    if (!title.trim()) {
      setError("Enter an activity title.");
      return;
    }
    setError("");
    try {
      await onSubmit({ title: title.trim(), maxScore: parsedMax });
    } catch (submitError) {
      setError(submitError.message);
    }
  }

  return (
    <Modal
      title={activity ? "Edit activity" : "New activity"}
      description="Add a title and, optionally, a maximum score."
      onClose={onClose}
    >
      <form className="activity-form" onSubmit={submit}>
        <label className="field">
          <span>Activity title <b>*</b></span>
          <input className="input" value={title} onChange={(event) => setTitle(event.target.value)} autoFocus maxLength={120} required />
        </label>
        <label className="field">
          <span>Out of <small>(optional)</small></span>
          <input
            className="input"
            type="number"
            min="1"
            step="1"
            inputMode="numeric"
            value={maxScore}
            onChange={(event) => /^\d*$/.test(event.target.value) && setMaxScore(event.target.value)}
            onPaste={(event) => { if (!/^\d+$/.test(event.clipboardData.getData("text"))) event.preventDefault(); }}
          />
        </label>
        {error ? <p className="notice notice-error" role="alert">{error}</p> : null}
        <div className="form-actions">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={saving}>{saving ? "Saving…" : "Save activity"}</Button>
        </div>
      </form>
    </Modal>
  );
}

export function ActivitiesModule({ sessionId, students }) {
  const [activities, setActivities] = useState([]);
  const [active, setActive] = useState(null);
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [scoresLoading, setScoresLoading] = useState(false);
  const [error, setError] = useState("");
  const [formActivity, setFormActivity] = useState(undefined);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState("");

  const reloadActivities = useCallback(async () => {
    try {
      const response = await api.sessionActivities(sessionId);
      setActivities(response.activities || []);
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    let cancelled = false;
    api.sessionActivities(sessionId)
      .then((response) => {
        if (!cancelled) setActivities(response.activities || []);
      })
      .catch((loadError) => {
        if (!cancelled) setError(loadError.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [sessionId]);

  const loadScores = useCallback(async (activity) => {
    if (!activity) return;
    try {
      const response = await api.activityScores(activity.id);
      setEntries(formatScoreRows(response, students));
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setScoresLoading(false);
    }
  }, [students]);

  const activeActivityId = active?.id;
  useEffect(() => {
    if (!activeActivityId) return undefined;
    let cancelled = false;
    api.activityScores(activeActivityId)
      .then((response) => {
        if (!cancelled) setEntries(formatScoreRows(response, students));
      })
      .catch((loadError) => {
        if (!cancelled) setError(loadError.message);
      })
      .finally(() => {
        if (!cancelled) setScoresLoading(false);
      });
    return () => { cancelled = true; };
  }, [activeActivityId, students]);

  async function saveActivity(payload) {
    setSaving(true);
    try {
      if (formActivity) {
        const response = await api.updateActivity(formActivity.id, payload);
        setActivities((current) => current.map((item) => item.id === formActivity.id ? response.activity : item));
        if (active?.id === formActivity.id) setActive(response.activity);
      } else {
        const response = await api.createActivity(sessionId, payload);
        setActivities((current) => [response.activity, ...current]);
        setScoresLoading(true);
        setActive(response.activity);
      }
      setFormActivity(undefined);
    } finally {
      setSaving(false);
    }
  }

  async function removeActivity() {
    if (!active) return;
    setSaving(true);
    try {
      await api.deleteActivity(active.id);
      setActivities((current) => current.filter((item) => item.id !== active.id));
      setActive(null);
      setConfirmDelete(false);
    } catch (deleteError) {
      setFeedback(deleteError.message);
    } finally {
      setSaving(false);
    }
  }

  function openActivity(activity) {
    setError("");
    setScoresLoading(true);
    setActive(activity);
  }

  async function saveScore(studentId, score) {
    const { score: savedScore } = await api.setActivityScore(active.id, studentId, score);
    setEntries((current) => current.map((entry) => entry.student.id === studentId ? { ...entry, score } : entry));
    setActivities((current) => current.map((item) => item.id === active.id
      ? { ...item, scores: [...(item.scores || []).filter((row) => row.studentId !== studentId), savedScore] }
      : item));
  }

  const rosterAbsentCount = students.filter((student) => student.status === "ABSENT").length;

  if (active) {
    return (
      <>
        {error ? <div className="notice notice-error" role="alert">{error}<button type="button" onClick={() => { setScoresLoading(true); setError(""); loadScores(active); }}>Retry</button></div> : null}
        {feedback ? <div className="notice notice-error" role="alert">{feedback}<button type="button" onClick={() => setFeedback("")}>Dismiss</button></div> : null}
        {scoresLoading ? <ScoreSkeleton /> : (
          <ScoringSheet
            title={active.title}
            maxScore={active.maxScore}
            entries={entries}
            absentCount={rosterAbsentCount}
            onSave={saveScore}
            back={() => { setActive(null); setError(""); }}
          />
        )}
        <div className="scoring-item-actions">
          <Button variant="secondary" onClick={() => setFormActivity(active)}><Icon name="edit" /> Edit activity</Button>
          <Button variant="destructive" onClick={() => setConfirmDelete(true)}><Icon name="trash" /> Delete activity</Button>
        </div>
        {formActivity !== undefined ? <ActivityForm activity={formActivity} onClose={() => setFormActivity(undefined)} onSubmit={saveActivity} saving={saving} /> : null}
        {confirmDelete ? (
          <ConfirmDialog
            title="Delete this activity?"
            description="Its scores will also be removed. This cannot be undone."
            confirmLabel="Delete activity"
            onConfirm={removeActivity}
            onCancel={() => setConfirmDelete(false)}
            busy={saving}
          />
        ) : null}
      </>
    );
  }

  return (
    <div className="activity-module">
      <PageHeader
        eyebrow="Class activities"
        icon="book"
        title="Activities"
        description="Create today’s activities and score each admitted student."
        action={<Button onClick={() => setFormActivity(null)}><Icon name="plus" /> New activity</Button>}
      />
      {error ? <div className="notice notice-error" role="alert">{error}<button type="button" onClick={() => { setLoading(true); setError(""); reloadActivities(); }}>Retry</button></div> : null}
      {feedback ? <div className="notice notice-error" role="alert">{feedback}<button type="button" onClick={() => setFeedback("")}>Dismiss</button></div> : null}
      <AbsenceBanner count={rosterAbsentCount} />
      {loading ? <ScoreSkeleton /> : activities.length ? (
        <div className="activity-list">
          {activities.map((activity) => (
            <Card key={activity.id} className="activity-card">
              <div className="activity-card-icon"><Icon name="book" /></div>
              <div className="activity-card-copy">
                <h2>{activity.title}</h2>
                <p>{activity.maxScore == null ? "No maximum score" : `Out of ${activity.maxScore}`}</p>
              </div>
              <Badge tone="neutral">{(activity.scores || []).filter((row) => row.score != null && !row.isAbsent && !row.absent).length}/{students.length} scored</Badge>
              <Button variant="secondary" onClick={() => openActivity(activity)}>Open scoring <Icon name="arrow" /></Button>
            </Card>
          ))}
        </div>
      ) : (
        <EmptyState
          title="No activities for today"
          description="Create an activity to start recording student scores."
          icon="book"
          action={<Button onClick={() => setFormActivity(null)}><Icon name="plus" /> New activity</Button>}
        />
      )}
      {formActivity !== undefined ? <ActivityForm activity={formActivity} onClose={() => setFormActivity(undefined)} onSubmit={saveActivity} saving={saving} /> : null}
    </div>
  );
}

export function ProjectsModule({ classId, sessionId, students }) {
  const [projects, setProjects] = useState([]);
  const [active, setActive] = useState(null);
  const [entries, setEntries] = useState([]);
  const [maxScoreInput, setMaxScoreInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [scoresLoading, setScoresLoading] = useState(false);
  const [savingMaxScore, setSavingMaxScore] = useState(false);
  const [error, setError] = useState("");

  const loadProjects = useCallback(async () => {
    try {
      const response = await api.classProjects(classId);
      setProjects(response.projects || []);
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  }, [classId]);

  useEffect(() => {
    let cancelled = false;
    api.classProjects(classId)
      .then((response) => {
        if (!cancelled) setProjects(response.projects || []);
      })
      .catch((loadError) => {
        if (!cancelled) setError(loadError.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [classId]);

  const loadScores = useCallback(async (project) => {
    if (!project) return;
    try {
      const response = await api.projectScores(project.id);
      setEntries(formatScoreRows(response, students, sessionId ?? null));
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setScoresLoading(false);
    }
  }, [students, sessionId]);

  const activeProjectId = active?.id;
  useEffect(() => {
    if (!activeProjectId) return undefined;
    let cancelled = false;
    api.projectScores(activeProjectId)
      .then((response) => {
        if (!cancelled) setEntries(formatScoreRows(response, students, sessionId ?? null));
      })
      .catch((loadError) => {
        if (!cancelled) setError(loadError.message);
      })
      .finally(() => {
        if (!cancelled) setScoresLoading(false);
      });
    return () => { cancelled = true; };
  }, [activeProjectId, students, sessionId]);

  function openProject(project) {
    setError("");
    setMaxScoreInput(project.maxScore == null ? "" : String(project.maxScore));
    setScoresLoading(true);
    setActive(project);
  }

  async function saveProjectScore(studentId, score) {
    const { score: savedScore } = await api.setProjectScore(active.id, studentId, score, sessionId);
    setEntries((current) => current.map((entry) => entry.student.id === studentId ? { ...entry, score } : entry));
    setProjects((current) => current.map((item) => item.id === active.id
      ? { ...item, scores: [...(item.scores || []).filter((row) => row.studentId !== studentId), savedScore] }
      : item));
  }

  async function saveMaxScore() {
    const score = parseOptionalInteger(maxScoreInput);
    if (score === null || score === undefined || score < 1) {
      setError("Maximum score must be a whole number of 1 or greater.");
      return;
    }
    setSavingMaxScore(true);
    setError("");
    try {
      const response = await api.updateProject(active.id, { maxScore: score });
      setProjects((current) => current.map((project) => project.id === active.id ? response.project : project));
      setActive(response.project);
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setSavingMaxScore(false);
    }
  }

  const rosterAbsentCount = students.filter((student) => student.status === "ABSENT").length;

  if (active) {
    return (
      <div className="project-scoring">
        {error ? <div className="notice notice-error" role="alert">{error}<button type="button" onClick={() => { setScoresLoading(true); setError(""); loadScores(active); }}>Retry</button></div> : null}
        <div className="project-score-settings">
          <label className="field">
            <span>Out of</span>
            <input
              className="input"
              type="number"
              min="1"
              step="1"
              inputMode="numeric"
              value={maxScoreInput}
              onChange={(event) => /^\d*$/.test(event.target.value) && setMaxScoreInput(event.target.value)}
              onPaste={(event) => { if (!/^\d+$/.test(event.clipboardData.getData("text"))) event.preventDefault(); }}
            />
          </label>
          <Button variant="secondary" onClick={saveMaxScore} disabled={savingMaxScore}>{savingMaxScore ? "Saving…" : "Save maximum"}</Button>
        </div>
        {scoresLoading ? <ScoreSkeleton /> : (
          <ScoringSheet
            title={active.type === "MIDTERM" ? "Midterm Project" : "Finals Project"}
            maxScore={active.maxScore}
            entries={entries}
            absentCount={rosterAbsentCount}
            onSave={saveProjectScore}
            back={() => { setActive(null); setError(""); }}
            backLabel="All projects"
          />
        )}
      </div>
    );
  }

  return (
    <div className="project-module">
      <PageHeader eyebrow="Class projects" icon="book" title="Projects" description="A shared scoring sheet for your two term projects." />
      {error ? <div className="notice notice-error" role="alert">{error}<button type="button" onClick={() => { setLoading(true); setError(""); loadProjects(); }}>Retry</button></div> : null}
      <AbsenceBanner count={rosterAbsentCount} />
      {loading ? <ScoreSkeleton /> : (
        <div className="project-card-grid">
          {["MIDTERM", "FINALS"].map((type) => {
            const project = projects.find((item) => item.type === type);
            const scoreRows = project?.scores || [];
            const scored = scoreRows.filter((row) => row.score != null && !row.isAbsent && !row.absent).map((row) => row.score);
            const scoredCount = scored.length;
            const average = scored.length ? (scored.reduce((sum, score) => sum + score, 0) / scored.length).toFixed(1) : "—";
            return (
              <Card className="project-card" key={type}>
                <span className="project-card-icon"><Icon name="book" /></span>
                <Badge tone="neutral">{type === "MIDTERM" ? "Midterm" : "Finals"}</Badge>
                <h2>{type === "MIDTERM" ? "Midterm Project" : "Finals Project"}</h2>
                <p>{project?.maxScore == null ? "Set the maximum score in the sheet." : `Out of ${project.maxScore}`}</p>
                <div className="project-card-stats">
                  <span><strong>{scoredCount}/{students.length}</strong> scored</span>
                  <span><strong>{average}</strong> average</span>
                </div>
                <Button onClick={() => project && openProject(project)} disabled={!project}>Open scoring <Icon name="arrow" /></Button>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
