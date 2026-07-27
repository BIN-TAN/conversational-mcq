import { readFileSync } from "node:fs";
import { strict as assert } from "node:assert";

const source = readFileSync(
  "src/components/student-assessment/assessment-session-client.tsx",
  "utf8"
);

assert.match(source, /PackageResultsChatCard/);
assert.match(source, /Review your answers/);
assert.match(source, /data-testid="package-results-chat-card"/);
assert.match(source, /initial-answer-review-list/);
assert.match(source, />Confidence:<\/span>/);
assert(
  source.indexOf("beforePackageResults.map") <
    source.indexOf("<PackageResultsChatCard") &&
    source.indexOf("<PackageResultsChatCard") <
    source.indexOf("afterPackageResults.map"),
  "Answer review must be inserted before post-package tutor and activity messages."
);
assert.doesNotMatch(source, /student-learning-profile-panel/);
assert.doesNotMatch(source, /LearningProfilePanel/);
assert.doesNotMatch(source, /lg:grid-cols-\[minmax\(0,1fr\)_18rem\]/);
assert.doesNotMatch(source, /data-testid="student-flow-stage"/);
assert.doesNotMatch(source, /Continue to feedback/);
assert.doesNotMatch(source, /I have your \d+ responses/);
assert.match(source, /This will end the current assessment conversation\./);
assert.doesNotMatch(source, /You will not complete another activity or transfer item/);

console.log(JSON.stringify({
  status: "passed",
  smoke: "student:chat-native-results-smoke",
  openai_call_made: false
}));
