const test = require("node:test");
const assert = require("node:assert/strict");
const { eligibleCandidates, selectRecitationCandidate } = require("../recitation");

test("only Present students enter the recitation pool", () => {
  const candidates = eligibleCandidates([
    { studentId: "present", status: "PRESENT" },
    { studentId: "late", status: "LATE" },
    { studentId: "absent", status: "ABSENT" },
    { studentId: "unmarked", status: null },
  ]);

  assert.deepEqual(
    candidates.map(({ studentId }) => studentId),
    ["present"],
  );
  for (const mode of ["RANDOM", "WEIGHTED"]) {
    for (const value of [0, 0.25, 0.5, 0.75, 0.999]) {
      const selected = selectRecitationCandidate(candidates, mode, () => value);
      assert.equal(selected.studentId, "present");
    }
  }
});

test("weighted selection favors a student with fewer prior calls", () => {
  const candidates = [
    { studentId: "undercalled", priorCalls: 0 },
    { studentId: "often-called", priorCalls: 9 },
  ];

  assert.equal(
    selectRecitationCandidate(candidates, "WEIGHTED", () => 0.5).studentId,
    "undercalled",
  );
  assert.equal(
    selectRecitationCandidate(candidates, "WEIGHTED", () => 0.95).studentId,
    "often-called",
  );
});
