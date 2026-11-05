import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import Icon from "./Icon";
import { api } from "../api";
import {
  DAYS_OF_WEEK,
  TIME_OPTIONS,
  formatScheduleText,
  parseTimeToMinutes,
  sortScheduleDays,
} from "../utils/schedule";

export default function ClassForm({
  mode = "create",
  initialValues = null,
  excludeClassId = "",
  onSubmit,
  onCancel,
  cancelTo = "",
  submitLabel = mode === "edit" ? "Save changes" : "Create class",
  savingLabel = mode === "edit" ? "Saving changes…" : "Creating class…",
  className = "panel form-panel",
}) {
  const isEdit = mode === "edit";
  const originalClassCode = String(initialValues?.classCode || "")
    .trim()
    .toUpperCase();

  const [form, setForm] = useState(() => ({
    sectionName: initialValues?.sectionName || "",
    classCode: initialValues?.classCode || "",
    description: initialValues?.description || "",
    scheduleDays: Array.isArray(initialValues?.scheduleDays)
      ? sortScheduleDays(initialValues.scheduleDays)
      : [],
    scheduleStartTime: initialValues?.scheduleStartTime || "",
    scheduleEndTime: initialValues?.scheduleEndTime || "",
  }));
  const [scheduleTouched, setScheduleTouched] = useState(false);
  const [codeCheck, setCodeCheck] = useState(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const classCode = form.classCode.trim().toUpperCase();
  const validCode = /^[A-Z0-9-]{3,20}$/.test(classCode);
  const isUnchangedEditCode = isEdit && Boolean(originalClassCode) && classCode === originalClassCode;
  const isChangedEditCode = isEdit && Boolean(originalClassCode) && Boolean(classCode) && classCode !== originalClassCode;

  const codeStatus = !form.classCode.trim()
    ? isEdit
      ? "required"
      : ""
    : !validCode
      ? "invalid"
      : codeCheck?.code === classCode
        ? codeCheck.error
          ? "unavailable"
          : codeCheck.available
            ? isUnchangedEditCode
              ? "unchanged"
              : "available"
            : "taken"
        : isUnchangedEditCode
          ? "unchanged"
          : "checking";

  useEffect(() => {
    if (!validCode) return undefined;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      api
        .checkClassCode(classCode, excludeClassId)
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
  }, [classCode, excludeClassId, validCode]);

  function update(field) {
    return (event) => {
      if (field === "scheduleStartTime" || field === "scheduleEndTime") {
        setScheduleTouched(true);
      }
      setForm((current) => ({ ...current, [field]: event.target.value }));
    };
  }

  function toggleDay(dayId) {
    setScheduleTouched(true);
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
    if (!form.sectionName.trim()) {
      setError("Section name is required.");
      return;
    }
    if (isEdit && !classCode) {
      setError("Enter a class code.");
      return;
    }
    if (classCode && !validCode) {
      setError("Use 3–20 letters, numbers, or hyphens for the class code.");
      return;
    }
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

    const preserveLegacySchedule =
      isEdit && !scheduleTouched && !hasScheduleInput && Boolean(initialValues?.schedule);

    const payload = {
      sectionName: form.sectionName,
      classCode,
      description: form.description,
      ...(preserveLegacySchedule
        ? {}
        : {
            scheduleDays: form.scheduleDays,
            scheduleStartTime: form.scheduleStartTime,
            scheduleEndTime: form.scheduleEndTime,
            schedule: schedulePreview,
          }),
    };

    setSaving(true);
    try {
      await onSubmit(payload);
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setSaving(false);
    }
  }

  const disableSubmit =
    saving ||
    (isEdit ? !validCode : Boolean(form.classCode && !validCode)) ||
    codeStatus === "taken" ||
    timeRangeInvalid;

  return (
    <form className={className} onSubmit={handleSubmit}>
      <label className="field">
        <span>
          Section name <b>*</b>
        </span>
        <input
          className="input"
          required
          value={form.sectionName}
          onChange={update("sectionName")}
          placeholder="e.g. BSEd English · Section 3A"
          autoFocus
        />
      </label>
      <label className="field">
        <span>
          Class code{isEdit ? <> <b>*</b></> : null}
        </span>
        <div className="input-with-action">
          <input
            className="input"
            required={isEdit}
            minLength={3}
            maxLength={20}
            pattern="[A-Za-z0-9-]{3,20}"
            value={form.classCode}
            onChange={update("classCode")}
            placeholder={isEdit ? "e.g. ENG3A25" : "Leave blank to generate one"}
            autoComplete="off"
          />
          <button type="button" className="button button-secondary" onClick={suggestCode}>
            Suggest code
          </button>
        </div>
        <span
          className={`field-hint ${
            codeStatus === "taken" || codeStatus === "invalid" || codeStatus === "required"
              ? "field-error"
              : codeStatus === "available"
                ? "field-success"
                : ""
          }`}
        >
          {codeStatus === "checking"
            ? "Checking code…"
            : codeStatus === "available"
              ? "This code is available."
              : codeStatus === "unchanged"
                ? "Current class invite code."
                : codeStatus === "taken"
                  ? "That code is taken. Try another."
                  : codeStatus === "required"
                    ? "Enter a 3–20 character class code."
                    : codeStatus === "invalid"
                      ? "Use 3–20 letters, numbers, or hyphens."
                      : codeStatus === "unavailable"
                        ? "Couldn’t check right now; the code will be checked when you save."
                        : "Students can use this code or its invite link to join."}
        </span>
        {isChangedEditCode ? (
          <span className="class-code-change-warning" role="status">
            <Icon name="alert" size={15} />
            <span>
              Changing the class code from <strong>{originalClassCode}</strong> means existing invite links and QR codes will stop working.
            </span>
          </span>
        ) : null}
      </label>
      <label className="field">
        <span>Description</span>
        <textarea
          className="input textarea"
          rows="3"
          value={form.description}
          onChange={update("description")}
          placeholder="A short note about this class"
        />
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
        ) : isEdit && !scheduleTouched && initialValues?.schedule ? (
          <span className="field-hint schedule-preview">
            <Icon name="clock" size={14} /> Current schedule: {initialValues.schedule}
          </span>
        ) : (
          <span className="field-hint">
            Choose the days and 30-minute start/end times this class meets.
          </span>
        )}
      </fieldset>
      {error ? (
        <p className="notice notice-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="form-actions">
        {cancelTo ? (
          <Link to={cancelTo} className="button button-quiet">
            Cancel
          </Link>
        ) : onCancel ? (
          <button type="button" className="button button-quiet" onClick={onCancel} disabled={saving}>
            Cancel
          </button>
        ) : null}
        <button className="button button-primary" type="submit" disabled={disableSubmit}>
          {saving ? savingLabel : submitLabel} <Icon name={isEdit ? "check" : "arrow"} />
        </button>
      </div>
    </form>
  );
}
