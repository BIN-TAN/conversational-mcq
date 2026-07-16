import { readFileSync } from "node:fs";
import { strict as assert } from "node:assert";

const source = readFileSync(
  "src/components/student-assessment/available-assessments-client.tsx",
  "utf8"
);

const completionBadgeMatches = source.match(/Assessment completed/g) ?? [];

assert.equal(
  completionBadgeMatches.length,
  1,
  "Completed assessment cards should have one authoritative visible completion badge source."
);
assert.doesNotMatch(source, /You finished this assessment\./);
assert.match(source, /Start another attempt/);
assert.match(source, /Assessment in progress/);
assert.match(source, /End current assessment/);
assert.match(source, /aria-label=\{isCompleted \? "This assessment is completed" : undefined\}/);
assert.doesNotMatch(source, /Latest completed attempt:/);
assert.doesNotMatch(source, /previous attempts/);
assert.doesNotMatch(source, /Next attempt:/);
assert.doesNotMatch(source, /Current attempt .* status/);
assert.doesNotMatch(source, /latest completed attempt/i);
assert.doesNotMatch(source, /next attempt/i);
assert.match(source, /const canStartNew = assessment\.can_start && !canOpen;/);

console.log(JSON.stringify({
  status: "passed",
  smoke: "student:assessment-completed-card-smoke",
  openai_call_made: false
}));
