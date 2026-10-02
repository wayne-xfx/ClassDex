const ELIGIBLE_ATTENDANCE_STATUSES = new Set(["PRESENT", "LATE"]);

function eligibleCandidates(attendanceRecords) {
  return attendanceRecords
    .filter((record) => ELIGIBLE_ATTENDANCE_STATUSES.has(record.status))
    .map((record) => ({
      ...record,
      priorCalls: Number(record.priorCalls) || 0,
    }));
}

function selectRecitationCandidate(candidates, mode, random = Math.random) {
  if (!candidates.length) return null;

  if (mode === "RANDOM") {
    return candidates[Math.min(candidates.length - 1, Math.floor(random() * candidates.length))];
  }

  const weights = candidates.map(({ priorCalls }) => 1 / (1 + Math.max(0, priorCalls)));
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  let selection = random() * totalWeight;
  for (let index = 0; index < candidates.length; index += 1) {
    selection -= weights[index];
    if (selection < 0) return candidates[index];
  }
  return candidates[candidates.length - 1];
}

module.exports = { eligibleCandidates, selectRecitationCandidate };
