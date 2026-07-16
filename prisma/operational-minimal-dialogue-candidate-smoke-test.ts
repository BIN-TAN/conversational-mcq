import { loadEnvConfig } from "@next/env";
import {
  activeOperationalConfigHash,
  readApprovedOperationalAgentConfig
} from "../src/lib/agents/operational/approved-config";
import {
  buildOperationalModelUpgradeComparison,
  candidateActiveOperationalConfigHash,
  candidateOperationalModelHash,
  GPT56_CANDIDATE_CONFIG_PATH,
  minimalLiveStudentDialogueEvaluationCases,
  MINIMAL_LIVE_STUDENT_DIALOGUE_CANDIDATE_CONFIG_PATH,
  readCandidateOperationalModelConfig
} from "../src/lib/operational/model-upgrade";

loadEnvConfig(process.cwd());

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function main() {
  const approved = readApprovedOperationalAgentConfig();
  const currentActiveHash = activeOperationalConfigHash();
  const minimal = readCandidateOperationalModelConfig(MINIMAL_LIVE_STUDENT_DIALOGUE_CANDIDATE_CONFIG_PATH);
  const fullMixed = readCandidateOperationalModelConfig(GPT56_CANDIDATE_CONFIG_PATH);
  const comparison = buildOperationalModelUpgradeComparison({
    manifestPath: MINIMAL_LIVE_STUDENT_DIALOGUE_CANDIDATE_CONFIG_PATH
  });

  const minimalManifestHash = candidateOperationalModelHash(minimal);
  const minimalActiveHash = candidateActiveOperationalConfigHash(minimal);
  const fullMixedManifestHash = candidateOperationalModelHash(fullMixed);
  const fullMixedActiveHash = candidateActiveOperationalConfigHash(fullMixed);
  const changedRoles = comparison.role_comparisons
    .filter((entry) => entry.changed_fields.length > 0)
    .map((entry) => entry.role)
    .sort();

  assert(comparison.compatibility_ok, "Minimal dialogue candidate should be model/effort compatible.");
  assert(minimalManifestHash !== fullMixedManifestHash, "Minimal manifest hash must differ from full mixed-stack manifest hash.");
  assert(minimalActiveHash !== fullMixedActiveHash, "Minimal active configuration hash must differ from full mixed-stack active hash.");
  assert(minimalActiveHash !== approved.approved_active_configuration_hash, "Minimal active hash should differ from the current approved hash.");
  assert(currentActiveHash === approved.approved_active_configuration_hash, "Current active hash should remain the approved baseline in this no-live smoke.");
  assert(
    JSON.stringify(changedRoles) === JSON.stringify(["student_communication_agent", "topic_dialogue_agent"]),
    `Only the two student-dialogue roles should change; got ${changedRoles.join(", ")}.`
  );

  const studentCommunication = minimal.roles.student_communication_agent;
  assert(studentCommunication, "Minimal candidate must include student_communication_agent.");
  assert(studentCommunication.model_name === "gpt-5.6-terra", "Student Communication should use gpt-5.6-terra.");
  assert(studentCommunication.reasoning_effort === "medium", "Student Communication should use medium effort.");
  assert(studentCommunication.max_output_tokens === 2500, "Student Communication should use 2500 max output tokens.");

  const topicDialogue = minimal.roles.topic_dialogue_agent;
  assert(topicDialogue, "Minimal candidate must include topic_dialogue_agent.");
  assert(topicDialogue.model_name === "gpt-5.6-sol", "Topic Dialogue should use gpt-5.6-sol.");
  assert(topicDialogue.reasoning_effort === "medium", "Topic Dialogue should use medium effort.");
  assert(topicDialogue.max_output_tokens === 3500, "Topic Dialogue should use 3500 max output tokens.");

  assert(minimal.runtime_policy?.provider_timeout_ms === 90000, "Provider timeout should be 90000 ms.");
  assert(minimal.runtime_policy?.role_live_toggles.student_communication_agent, "Student Communication live toggle should be fingerprinted as true.");
  assert(minimal.runtime_policy?.role_live_toggles.topic_dialogue_agent, "Topic Dialogue live toggle should be fingerprinted as true.");
  assert(minimal.runtime_policy?.topic_dialogue_policy.maximum_student_turns === 10, "Topic dialogue should allow 10 student turns.");
  assert(minimal.runtime_policy?.topic_dialogue_policy.recent_raw_turn_window === 12, "Topic dialogue recent window should be 12.");
  assert(minimal.runtime_policy?.topic_dialogue_policy.maximum_student_message_characters === 5000, "Topic dialogue message limit should be 5000.");
  assert(minimal.runtime_policy?.topic_dialogue_policy.assessment_system_questions_allowed === true, "Assessment-system questions should be allowed.");

  assert(minimal.student_facing_output_human_review_required === true, "Student-facing output must require human review.");
  assert(minimal.human_review_required === true, "Candidate must require human review.");
  assert(minimal.student_facing_operational_use_approved === false, "Candidate must not be auto-approved for student-facing runtime.");

  const expectedCases = [...minimalLiveStudentDialogueEvaluationCases];
  assert(
    JSON.stringify(minimal.evaluation_cases) === JSON.stringify(expectedCases),
    "Minimal candidate should use the fixed live dialogue evaluation cases."
  );
  assert(comparison.fixtures.fixture_count === expectedCases.length, "Comparison fixture count should use minimal candidate cases.");

  for (const entry of comparison.role_comparisons) {
    if (entry.role === "student_communication_agent" || entry.role === "topic_dialogue_agent") {
      assert(entry.approval_boundary === "operational_extension_required", `${entry.role} should require extension approval.`);
      continue;
    }
    assert(entry.changed_fields.length === 0, `${entry.role} should remain baseline-aligned.`);
  }

  console.log(JSON.stringify({
    status: "passed",
    no_openai_call: true,
    current_active_configuration_hash: currentActiveHash,
    old_approved_hash: approved.approved_active_configuration_hash,
    minimal_candidate_manifest_hash: minimalManifestHash,
    minimal_candidate_active_configuration_hash: minimalActiveHash,
    full_mixed_candidate_manifest_hash: fullMixedManifestHash,
    full_mixed_candidate_active_configuration_hash: fullMixedActiveHash,
    changed_roles: changedRoles,
    evaluation_case_count: expectedCases.length
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(error);
  process.exit(1);
}
