import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import {
  RECENT_REVIEWABLE_ATTEMPT_LIMIT,
  recentReviewableAttempts
} from "../src/lib/services/student-assessment/attempt-history";

const now = new Date("2026-08-29T12:00:00.000Z");
const sessions = [
  {
    session_public_id: "active-attempt-5",
    attempt_number: 5,
    status: "active",
    current_phase: "initial_admin",
    completed_at: null,
    created_at: now,
    updated_at: now
  },
  ...[4, 3, 2, 1].map((attemptNumber) => ({
    session_public_id: `terminal-attempt-${attemptNumber}`,
    attempt_number: attemptNumber,
    status: attemptNumber % 2 === 0 ? "completed" : "student_exited",
    current_phase:
      attemptNumber % 2 === 0 ? "session_completed" : "student_exited",
    completed_at: attemptNumber % 2 === 0 ? now : null,
    created_at: now,
    updated_at: now
  }))
];

const recentAttempts = recentReviewableAttempts(sessions);

assert.equal(RECENT_REVIEWABLE_ATTEMPT_LIMIT, 3);
assert.equal(recentAttempts.length, 3);
assert.deepEqual(
  recentAttempts.map((attempt) => attempt.attempt_number),
  [4, 3, 2]
);
assert.ok(
  recentAttempts.every((attempt) => attempt.session_public_id !== "active-attempt-5"),
  "Active attempts must not enter read-only attempt history."
);

const assessmentClient = readFileSync(
  "src/components/student-assessment/assessment-session-client.tsx",
  "utf8"
);
const assessmentList = readFileSync(
  "src/components/student-assessment/available-assessments-client.tsx",
  "utf8"
);
const processEvents = readFileSync(
  "src/components/student-assessment/process-events.ts",
  "utf8"
);
const reviewRoute = readFileSync(
  "src/app/student/assessment/[sessionPublicId]/page.tsx",
  "utf8"
);

assert.match(assessmentClient, /Preparing a response\.\.\./);
assert.match(
  assessmentClient,
  /Still preparing a response\. Your message is saved\./
);
assert.match(
  assessmentClient,
  /This is taking a little longer than usual\. You can review your answers or earlier messages while you wait\./
);
assert.doesNotMatch(assessmentClient, /Thinking about your question/);
assert.match(assessmentClient, /FORMATIVE_RESPONSE_SAVED_NOTICE_MS = 10_000/);
assert.match(assessmentClient, /FORMATIVE_RESPONSE_DELAY_NOTICE_MS = 25_000/);
assert.match(assessmentClient, /readOnlyReview && state\.attempt_lifecycle\?\.terminal === true/);
assert.match(assessmentClient, /enabled: !readOnlyReview/);
assert.match(processEvents, /if \(input\.enabled === false\)/);
assert.match(assessmentList, /recent_reviewable_attempts/);
assert.match(assessmentList, /Review previous attempts/);
assert.match(assessmentList, /\?review=1/);
assert.match(reviewRoute, /readOnlyReview=\{review === "1"\}/);

console.log(
  JSON.stringify({
    status: "passed",
    smoke: "student:formative-waiting-attempt-review-smoke",
    recent_attempt_limit: RECENT_REVIEWABLE_ATTEMPT_LIMIT,
    provider_calls: 0
  })
);
