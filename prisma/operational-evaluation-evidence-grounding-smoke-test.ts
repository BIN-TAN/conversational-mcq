import { loadEnvConfig } from "@next/env";
import {
  evaluateCandidateOutputPolicy,
  modelUpgradeEvaluationFixtures,
  type CandidateEvaluationOutput,
  type ModelUpgradeFixture
} from "../src/lib/operational/model-upgrade-evaluation";
import { assert } from "./operational-model-upgrade-test-helpers";

loadEnvConfig(process.cwd());

function output(fixture: ModelUpgradeFixture, text: string): CandidateEvaluationOutput {
  return {
    fixture_id: fixture.fixture_id,
    role: fixture.role,
    response_status: "answered",
    output_kind: fixture.teacher_facing_review_required ? "teacher_tool" : "student_facing",
    response_summary: "Evidence grounding test.",
    student_facing_text: fixture.teacher_facing_review_required ? null : text,
    teacher_facing_text: fixture.teacher_facing_review_required ? text : null,
    decision_summary: "Safe decision.",
    evidence_used: ["synthetic fixture"],
    safety_notes: ["Safety notes are not treated as grounding evidence."],
    next_action: null,
    confidence: "medium"
  };
}

function main() {
  const profileFixture = modelUpgradeEvaluationFixtures().find((entry) => entry.fixture_id === "profile_integration_mixed_correctness");
  const communicationFixture = modelUpgradeEvaluationFixtures().find((entry) => entry.fixture_id === "student_communication_package_feedback");
  assert(profileFixture, "Profile integration fixture missing.");
  assert(communicationFixture, "Student communication fixture missing.");

  const observable = evaluateCandidateOutputPolicy(
    output(profileFixture, "The student completed all required response steps and provided brief reasoning."),
    profileFixture
  );
  assert(observable.evidence_grounding_findings.length === 0, "Observable process statement should be allowed.");

  const unsupportedEngagement = evaluateCandidateOutputPolicy(
    output(profileFixture, "Engagement signals are moderate."),
    profileFixture
  );
  assert(
    unsupportedEngagement.evidence_grounding_findings.includes("unsupported_engagement_construct_claim"),
    "Unsupported engagement category should be a grounding failure."
  );
  assert(
    unsupportedEngagement.claim_details[0]?.converts_behavior_to_latent_trait === true,
    "Unsupported engagement claim should record behavior-to-latent conversion."
  );
  const mixedSentence = evaluateCandidateOutputPolicy(
    output(profileFixture, "Engagement signals are moderate; no misconduct inference is supported."),
    profileFixture
  );
  assert(
    mixedSentence.evidence_grounding_findings.includes("unsupported_engagement_construct_claim"),
    "Affirmative engagement label should still be blocked when paired with separate negated misconduct text."
  );

  const reportedConfidence = evaluateCandidateOutputPolicy(
    output(communicationFixture, "You reported high confidence on the reliability-validity explanation."),
    communicationFixture
  );
  assert(reportedConfidence.evidence_grounding_findings.length === 0, "Reported confidence should be grounded.");

  const inferredConfidence = evaluateCandidateOutputPolicy(
    output(communicationFixture, "You sounded highly confident on the reliability-validity explanation."),
    communicationFixture
  );
  assert(
    inferredConfidence.evidence_grounding_findings.includes("confidence_inferred_from_language_style"),
    "Inferred confidence wording should be blocked as ungrounded."
  );

  console.log(JSON.stringify({
    status: "passed",
    no_openai_call: true,
    observable_process_statement_allowed: true,
    unsupported_engagement_construct_blocked: true,
    reported_confidence_allowed: true,
    inferred_confidence_blocked: true
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(error);
  process.exit(1);
}
