const DEFAULT_GRACE_PERIOD_MINUTES = 15;

function resolveSessionStart(startedAt, now = Date.now()) {
  if (startedAt instanceof Date && !Number.isNaN(startedAt.getTime())) {
    return startedAt;
  }
  if (typeof startedAt === "string" || typeof startedAt === "number") {
    const parsed = new Date(startedAt);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return now instanceof Date ? now : new Date(now);
}

function applyGracePeriod(
  status,
  startedAt,
  gracePeriodMinutes = DEFAULT_GRACE_PERIOD_MINUTES,
  now = Date.now(),
) {
  const effectiveMinutes =
    Number.isInteger(gracePeriodMinutes) && gracePeriodMinutes >= 0
      ? gracePeriodMinutes
      : DEFAULT_GRACE_PERIOD_MINUTES;
  const effectiveStart = resolveSessionStart(startedAt, now);
  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  const graceDeadline = effectiveStart.getTime() + effectiveMinutes * 60 * 1000;
  const lateOverride = status === "PRESENT" && nowMs > graceDeadline;
  return {
    appliedStatus: lateOverride ? "LATE" : status,
    lateOverride,
  };
}

module.exports = {
  DEFAULT_GRACE_PERIOD_MINUTES,
  applyGracePeriod,
  resolveSessionStart,
};
