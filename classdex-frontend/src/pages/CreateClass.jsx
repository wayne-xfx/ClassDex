import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import AppShell from "../components/AppShell";
import Icon from "../components/Icon";
import { api } from "../api";
import { PageHeader } from "../components/DesignSystem";
import {
  DAYS_OF_WEEK,
  TIME_OPTIONS,
  formatScheduleText,
  parseTimeToMinutes,
  sortScheduleDays,
} from "../utils/schedule";

export default function CreateClass() {
  const navigate = useNavigate();
  const [form, setForm] = useState({
    sectionName: "",
    classCode: "",
    description: "",
    scheduleDays: [],
    scheduleStartTime: "",
    scheduleEndTime: "",
  });
  const [codeCheck, setCodeCheck] = useState(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const classCode = form.classCode.trim().toUpperCase();
  const validCode = /^[A-Z0-9-]{3,20}$/.test(classCode);
  const codeStatus = !form.classCode.trim()
    ? ""
    : !validCode
      ? "invalid"
      : codeCheck?.code === classCode
        ? codeCheck.error
          ? "unavailable"
          : codeCheck.available
            ? "available"
            : "taken"
        : "checking";

  useEffect(() => {
    if (!validCode) return undefined;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      api
        .checkClassCode(classCode)
        .then(({ available }) => {
          if (!cancelled) setCodeCheck({ code: classCode, available });
        })
        .catch(() => {
          if (!cancelled) setCodeCheck({ code: classCode, error: true });
        });
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [classCode, validCode]);

  function update(field) {
    return (event) => setForm((current) => ({ ...current, [field]: event.target.value }));
  }

  function toggleDay(dayId) {
    setForm((current) => {
      const exists = current.scheduleDays.includes(dayId);
      const nextDays = exists
        ? current.scheduleDays.filter((item) => item !== dayId)
        : [...current.scheduleDays, dayId];
      return {
        ...current,
        scheduleDays: sortScheduleDays(nextDays),
        scheduleStartTime: current.scheduleStartTime || (!exists ? "07:30" : ""),
        scheduleEndTime: current.scheduleEndTime || (!exists ? "09:00" : ""),
      };
    });
  }

  function suggestCode() {
    const suggestion = Math.random().toString(36).slice(2, 8).toUpperCase();
    setForm((current) => ({ ...current, classCode: suggestion }));
  }

  const startMinutes = parseTimeToMinutes(form.scheduleStartTime);
  const endMinutes = parseTimeToMinutes(form.scheduleEndTime);
  const hasScheduleInput =
    form.scheduleDays.length > 0 ||
    Boolean(form.scheduleStartTime) ||
    Boolean(form.scheduleEndTime);
  const timeRangeInvalid =
    startMinutes != null && endMinutes != null && endMinutes <= startMinutes;

  const schedulePreview = useMemo(
    () =>
      formatScheduleText({
        days: form.scheduleDays,
        startTime: form.scheduleStartTime,
        endTime: form.scheduleEndTime,
      }),
    [form.scheduleDays, form.scheduleStartTime, form.scheduleEndTime],
  );

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    if (hasScheduleInput) {
      if (!form.scheduleDays.length) {
        setError("Select at least one day of the week for the schedule.");
        return;
      }
      if (!form.scheduleStartTime || !form.scheduleEndTime) {
        setError("Select both a start time and an end time.");
        return;
      }
      if (timeRangeInvalid) {
        setError("End time must be after start time.");
        return;
      }
    }
    setSaving(true);
    try {
      const { class: createdClass } = await api.createClass({
        sectionName: form.sectionName,
        classCode,
        description: form.description,
        scheduleDays: form.scheduleDays,
        scheduleStartTime: form.scheduleStartTime,
        scheduleEndTime: form.scheduleEndTime,
        schedule: schedulePreview,
      });
      navigate("/faculty", { state: { notice: `${createdClass.sectionName} is ready. Invite code: ${createdClass.classCode}` } });
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <AppShell active="home">
      <div className="content-narrow">
        <Link to="/faculty" className="back-link"><Icon name="chevron" /> Dashboard</Link>
        <PageHeader
          eyebrow="New classroom"
          icon="plus"
          title="Create a class"
          description="Set up a class space and share its invite code with students."
        />
        <form className="panel form-panel" onSubmit={handleSubmit}>
          <label className="field">
            <span>Section name <b>*</b></span>
            <input className="input" required value={form.sectionName} onChange={update("sectionName")} placeholder="e.g. BSEd English · Section 3A" autoFocus />
          </label>
          <label className="field">
            <span>Class code</span>
            <div className="input-with-action">
              <input
                className="input"
                minLength={3}
                maxLength={20}
                pattern="[A-Za-z0-9-]{3,20}"
                value={form.classCode}
                onChange={update("classCode")}
                placeholder="Leave blank to generate one"
                autoComplete="off"
              />
              <button type="button" className="button button-secondary" onClick={suggestCode}>Suggest code</button>
            </div>
            <span className={`field-hint ${codeStatus === "taken" || codeStatus === "invalid" ? "field-error" : codeStatus === "available" ? "field-success" : ""}`}>
              {codeStatus === "checking" ? "Checking code…" : codeStatus === "available" ? "This code is available." : codeStatus === "taken" ? "That code is taken. Try another." : codeStatus === "invalid" ? "Use 3–20 letters, numbers, or hyphens." : codeStatus === "unavailable" ? "Couldn’t check right now; the code will be checked when you save." : "Students can use this code or its invite link to join."}
            </span>
          </label>
          <label className="field">
            <span>Description</span>
            <textarea className="input textarea" rows="3" value={form.description} onChange={update("description")} placeholder="A short note about this class" />
          </label>
          <fieldset className="field schedule-fieldset">
            <legend className="schedule-legend">Schedule</legend>
            <div className="schedule-days-group" role="group" aria-label="Days of the week">
              {DAYS_OF_WEEK.map((day) => {
                const selected = form.scheduleDays.includes(day.id);
                return (
                  <button
                    key={day.id}
                    type="button"
                    className={`schedule-day-pill${selected ? " is-selected" : ""}`}
                    aria-pressed={selected}
                    aria-label={day.fullLabel}
                    onClick={() => toggleDay(day.id)}
                  >
                    {day.label}
                  </button>
                );
              })}
            </div>
            <div className="schedule-time-grid">
              <label className="field">
                <span>Start time</span>
                <select
                  className="input select"
                  value={form.scheduleStartTime}
                  onChange={update("scheduleStartTime")}
                >
                  <option value="">Select start time</option>
                  {TIME_OPTIONS.slice(0, -1).map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>End time</span>
                <select
                  className="input select"
                  value={form.scheduleEndTime}
                  onChange={update("scheduleEndTime")}
                >
                  <option value="">Select end time</option>
                  {TIME_OPTIONS.slice(1).map((option) => (
                    <option
                      key={option.value}
                      value={option.value}
                      disabled={startMinutes != null && option.minutes <= startMinutes}
                    >
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {timeRangeInvalid ? (
              <span className="field-hint field-error" role="alert">
                End time must be after start time.
              </span>
            ) : schedulePreview ? (
              <span className="field-hint schedule-preview">
                <Icon name="clock" size={14} /> {schedulePreview}
              </span>
            ) : (
              <span className="field-hint">
                Choose the days and 30-minute start/end times this class meets.
              </span>
            )}
          </fieldset>
          {error ? <p className="notice notice-error" role="alert">{error}</p> : null}
          <div className="form-actions">
            <Link to="/faculty" className="button button-quiet">Cancel</Link>
            <button
              className="button button-primary"
              type="submit"
              disabled={saving || Boolean(form.classCode && !validCode) || timeRangeInvalid}
            >
              {saving ? "Creating class…" : "Create class"} <Icon name="arrow" />
            </button>
          </div>
        </form>
      </div>
    </AppShell>
  );
}
