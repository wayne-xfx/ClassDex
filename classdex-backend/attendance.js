function applyGracePeriod(status, startedAt, gracePeriodMinutes, now = Date.now()) {
  const graceDeadline = startedAt.getTime() + gracePeriodMinutes * 60 * 1000;
  const lateOverride = status === "PRESENT" && now > graceDeadline;
  return {
    appliedStatus: lateOverride ? "LATE" : status,
    lateOverride,
  };
}

module.exports = { applyGracePeriod };
