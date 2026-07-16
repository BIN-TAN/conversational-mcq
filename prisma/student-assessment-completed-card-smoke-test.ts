import { readFileSync } from "node:fs";
import { strict as assert } from "node:assert";

const source = readFileSync(
  "src/components/student-assessment/available-assessments-client.tsx",
  "utf8"
);

assert.match(source, /Assessment completed/);
assert.match(source, /You finished this assessment\./);
assert.match(source, /Start another attempt/);
assert.match(source, /Assessment in progress/);
assert.match(source, /End current assessment/);
assert.doesNotMatch(source, /Latest completed attempt:/);
assert.doesNotMatch(source, /previous attempts/);
assert.doesNotMatch(source, /Next attempt:/);
assert.doesNotMatch(source, /Current attempt .* status/);

console.log(JSON.stringify({
  status: "passed",
  smoke: "student:assessment-completed-card-smoke",
  openai_call_made: false
}));
