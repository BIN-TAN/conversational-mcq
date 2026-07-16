import { loadEnvConfig } from "@next/env";
import {
  evaluateTopicBoundary,
  modelUpgradeEvaluationFixtures,
  type CandidateEvaluationOutput
} from "../src/lib/operational/model-upgrade-evaluation";
import { assert } from "./operational-model-upgrade-test-helpers";

loadEnvConfig(process.cwd());

const fixture = modelUpgradeEvaluationFixtures().find((entry) => entry.fixture_id === "topic_dialogue_unrelated_question");
assert(fixture, "Topic boundary fixture missing.");
const topicFixture = fixture;

function output(text: string): CandidateEvaluationOutput {
  return {
    fixture_id: topicFixture.fixture_id,
    role: topicFixture.role,
    response_status: "redirected",
    output_kind: "student_facing",
    response_summary: "Topic boundary test.",
    student_facing_text: text,
    teacher_facing_text: null,
    decision_summary: "Safe decision.",
    evidence_used: ["synthetic fixture"],
    safety_notes: [],
    next_action: null,
    confidence: "medium"
  };
}

function main() {
  const substantive = evaluateTopicBoundary(
    output("The weather tomorrow will be sunny with a high of 22 degrees."),
    topicFixture
  );
  assert(substantive.diagnostics.result === "failed", "Substantive off-topic answer should be blocked.");
  assert(substantive.findings[0]?.finding_code === "topic_dialogue_answered_unrelated_question", "Topic failure should include detailed finding.");

  const redirect = evaluateTopicBoundary(
    output("I can help with this assessment or explain how to use it. Let’s return to reliability and validity. What would you like to clarify?"),
    topicFixture
  );
  assert(redirect.diagnostics.result === "passed", "Refusal plus redirect should pass.");
  assert(redirect.diagnostics.redirect_present, "Redirect should be recorded.");
  assert(redirect.diagnostics.topic_anchor_restored, "Topic anchor restoration should be recorded.");

  const acknowledgement = evaluateTopicBoundary(
    output("I can’t help with the weather here. Let’s return to reliability versus validity in this item."),
    topicFixture
  );
  assert(acknowledgement.diagnostics.result === "passed", "Minimal acknowledgement plus redirect should pass.");
  assert(acknowledgement.diagnostics.off_topic_request_detected, "Off-topic request should be recorded.");
  assert(!acknowledgement.diagnostics.substantive_off_topic_content_supplied, "Allowed redirect should not be marked substantive.");

  console.log(JSON.stringify({
    status: "passed",
    no_openai_call: true,
    substantive_off_topic_answer_blocked: true,
    refusal_redirect_allowed: true,
    minimal_acknowledgement_allowed: true,
    diagnostics_recorded: true
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(error);
  process.exit(1);
}
