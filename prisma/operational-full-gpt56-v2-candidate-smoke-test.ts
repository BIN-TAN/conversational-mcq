import { loadEnvConfig } from "@next/env";
import {
  activeOperationalConfigHash,
  readApprovedOperationalAgentConfig
} from "../src/lib/agents/operational/approved-config";
import {
  liveModelRoleEnvSources,
  liveModelRoles,
  type LiveModelRole
} from "../src/lib/llm/config";
import {
  buildOperationalModelUpgradeComparison,
  candidateActiveOperationalConfigHash,
  candidateOperationalModelHash,
  FULL_GPT56_V2_CANDIDATE_CONFIG_PATH,
  fullGpt56V2EvaluationCases,
  GPT56_CANDIDATE_CONFIG_PATH,
  MINIMAL_LIVE_STUDENT_DIALOGUE_CANDIDATE_CONFIG_PATH,
  readCandidateOperationalModelConfig
} from "../src/lib/operational/model-upgrade";

loadEnvConfig(process.cwd());

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

const expectedRoleConfig: Record<LiveModelRole, {
  model_name: string;
  reasoning_effort: string;
  max_output_tokens: number;
}> = {
  item_verification_agent: {
    model_name: "gpt-5.6-terra",
    reasoning_effort: "medium",
    max_output_tokens: 3000
  },
  item_administration_tutor_agent: {
    model_name: "gpt-5.6-luna",
    reasoning_effort: "low",
    max_output_tokens: 1200
  },
  response_collection_agent: {
    model_name: "gpt-5.6-luna",
    reasoning_effort: "low",
    max_output_tokens: 1500
  },
  student_profiling_agent: {
    model_name: "gpt-5.6-terra",
    reasoning_effort: "medium",
    max_output_tokens: 4000
  },
  profile_integration_agent: {
    model_name: "gpt-5.6-terra",
    reasoning_effort: "medium",
    max_output_tokens: 3000
  },
  formative_value_and_planning_agent: {
    model_name: "gpt-5.6-sol",
    reasoning_effort: "medium",
    max_output_tokens: 3000
  },
  formative_value_determination_agent: {
    model_name: "gpt-5.6-terra",
    reasoning_effort: "medium",
    max_output_tokens: 2500
  },
  followup_agent: {
    model_name: "gpt-5.6-sol",
    reasoning_effort: "medium",
    max_output_tokens: 2500
  },
  formative_activity_dialogue_agent: {
    model_name: "gpt-5.6-sol",
    reasoning_effort: "medium",
    max_output_tokens: 3500
  },
  formative_activity_quality_reviewer_agent: {
    model_name: "gpt-5.6-sol",
    reasoning_effort: "medium",
    max_output_tokens: 2500
  },
  formative_activity_response_evaluator_agent: {
    model_name: "gpt-5.6-sol",
    reasoning_effort: "medium",
    max_output_tokens: 3000
  },
  post_activity_evidence_evaluator_agent: {
    model_name: "gpt-5.6-sol",
    reasoning_effort: "medium",
    max_output_tokens: 3000
  },
  student_communication_agent: {
    model_name: "gpt-5.6-terra",
    reasoning_effort: "medium",
    max_output_tokens: 2500
  },
  topic_dialogue_agent: {
    model_name: "gpt-5.6-sol",
    reasoning_effort: "medium",
    max_output_tokens: 3500
  },
  mcq_diagnostic_authoring_assistant_agent: {
    model_name: "gpt-5.6-terra",
    reasoning_effort: "medium",
    max_output_tokens: 2500
  },
  mcq_import_formatting_assistant_agent: {
    model_name: "gpt-5.6-luna",
    reasoning_effort: "low",
    max_output_tokens: 3000
  },
  connectivity_test: {
    model_name: "gpt-5.6-luna",
    reasoning_effort: "none",
    max_output_tokens: 200
  }
};

function main() {
  const approved = readApprovedOperationalAgentConfig();
  const currentActiveHash = activeOperationalConfigHash();
  const fullV2 = readCandidateOperationalModelConfig(FULL_GPT56_V2_CANDIDATE_CONFIG_PATH);
  const oldFullMixed = readCandidateOperationalModelConfig(GPT56_CANDIDATE_CONFIG_PATH);
  const minimal = readCandidateOperationalModelConfig(MINIMAL_LIVE_STUDENT_DIALOGUE_CANDIDATE_CONFIG_PATH);
  const comparison = buildOperationalModelUpgradeComparison({
    manifestPath: FULL_GPT56_V2_CANDIDATE_CONFIG_PATH
  });

  const fullV2ManifestHash = candidateOperationalModelHash(fullV2);
  const fullV2ActiveHash = candidateActiveOperationalConfigHash(fullV2);
  const oldFullMixedManifestHash = candidateOperationalModelHash(oldFullMixed);
  const oldFullMixedActiveHash = candidateActiveOperationalConfigHash(oldFullMixed);
  const minimalManifestHash = candidateOperationalModelHash(minimal);
  const minimalActiveHash = candidateActiveOperationalConfigHash(minimal);
  const changedRoles = comparison.role_comparisons
    .filter((entry) => entry.changed_fields.length > 0)
    .map((entry) => entry.role)
    .sort();

  assert(comparison.compatibility_ok, "Full GPT-5.6 v2 candidate should be model/effort compatible.");
  assert(fullV2.approval_state === "candidate_not_approved", "Full GPT-5.6 v2 candidate must not be approved.");
  assert(fullV2.student_facing_operational_use_approved === false, "Student-facing use must not be auto-approved.");
  assert(fullV2.teacher_tool_use_approved === false, "Teacher-tool use must not be auto-approved.");
  assert(fullV2.student_facing_output_human_review_required === true, "Student-facing output must require human review.");
  assert(approved.approved_active_configuration_hash === fullV2.configuration_fingerprint?.approved_baseline_active_configuration_hash, "Full v2 candidate should preserve the old approved baseline hash for rollback.");
  assert(fullV2ManifestHash !== oldFullMixedManifestHash, "Full v2 manifest hash must differ from old full mixed-stack manifest hash.");
  assert(fullV2ActiveHash !== oldFullMixedActiveHash, "Full v2 active hash must differ from old full mixed-stack active hash.");
  assert(fullV2ManifestHash !== minimalManifestHash, "Full v2 manifest hash must differ from minimal candidate manifest hash.");
  assert(fullV2ActiveHash !== minimalActiveHash, "Full v2 active hash must differ from minimal candidate active hash.");
  assert(fullV2ActiveHash !== approved.approved_active_configuration_hash, "Full v2 active hash must differ from the approved baseline.");
  assert(changedRoles.length === liveModelRoles.length, "Every covered role should differ from the GPT-5.4-mini baseline.");

  for (const role of liveModelRoles) {
    const actual = fullV2.roles[role];
    const expected = expectedRoleConfig[role];
    assert(actual, `Full v2 candidate is missing ${role}.`);
    assert(actual.model_name === expected.model_name, `${role} model mismatch.`);
    assert(!actual.model_name.includes("gpt-5.4-mini"), `${role} must not remain on gpt-5.4-mini.`);
    assert(actual.reasoning_effort === expected.reasoning_effort, `${role} reasoning effort mismatch.`);
    assert(actual.max_output_tokens === expected.max_output_tokens, `${role} max output tokens mismatch.`);
  }

  assert(fullV2.runtime_policy?.provider_timeout_ms === 90000, "Provider timeout should be 90000 ms.");
  assert(fullV2.runtime_policy?.provider_max_retries === 2, "Provider max retries should be fingerprinted as 2.");
  assert(fullV2.runtime_policy?.role_live_toggles.student_communication_agent === true, "Student Communication live toggle should be true.");
  assert(fullV2.runtime_policy?.role_live_toggles.topic_dialogue_agent === true, "Topic Dialogue live toggle should be true.");
  assert(fullV2.runtime_policy?.topic_dialogue_policy.maximum_student_turns === 10, "Topic Dialogue turn cap should be 10.");
  assert(fullV2.runtime_policy?.topic_dialogue_policy.recent_raw_turn_window === 12, "Topic Dialogue recent-turn window should be 12.");
  assert(fullV2.runtime_policy?.topic_dialogue_policy.maximum_student_message_characters === 5000, "Topic Dialogue message limit should be 5000.");
  assert(fullV2.runtime_policy?.topic_dialogue_policy.assessment_system_questions_allowed === true, "Assessment-system questions should be allowed.");

  const envSources = liveModelRoleEnvSources();
  assert(envSources.formative_value_determination_agent[0]?.model === "OPENAI_MODEL_FORMATIVE_VALUE_DETERMINATION", "Formative Value Determination should have a role-specific model env key.");
  assert(envSources.formative_activity_dialogue_agent[0]?.model === "OPENAI_MODEL_FORMATIVE_ACTIVITY_DIALOGUE", "Formative Activity Dialogue should have a role-specific model env key.");
  assert(envSources.formative_activity_quality_reviewer_agent[0]?.model === "OPENAI_MODEL_FORMATIVE_ACTIVITY_QUALITY_REVIEWER", "Formative Activity Quality Reviewer should have a role-specific model env key.");
  assert(envSources.formative_activity_response_evaluator_agent[0]?.model === "OPENAI_MODEL_FORMATIVE_ACTIVITY_RESPONSE_EVALUATOR", "Formative Activity Response Evaluator should have a role-specific model env key.");
  assert(envSources.post_activity_evidence_evaluator_agent[0]?.model === "OPENAI_MODEL_POST_ACTIVITY_EVIDENCE_EVALUATOR", "Post-Activity Evidence Evaluator should have a role-specific model env key.");

  assert(fullV2.configuration_fingerprint, "Full v2 candidate must include a configuration fingerprint.");
  assert(
    fullV2.configuration_fingerprint?.approved_baseline_active_configuration_hash === approved.approved_active_configuration_hash,
    "Full v2 fingerprint should record the approved baseline hash."
  );
  assert(
    fullV2.configuration_fingerprint?.semantic_validator_version === approved.semantic_validator_version,
    "Semantic validator version should match the approved baseline."
  );
  assert(
    fullV2.configuration_fingerprint?.safety_validator_version === approved.safety_validator_version,
    "Safety validator version should match the approved baseline."
  );

  for (const role of liveModelRoles) {
    assert(
      fullV2.configuration_fingerprint?.role_version_metadata[role],
      `Full v2 fingerprint must include version metadata for ${role}.`
    );
  }

  const expectedCases = [...fullGpt56V2EvaluationCases];
  assert(JSON.stringify(fullV2.evaluation_cases) === JSON.stringify(expectedCases), "Full v2 should use the fixed synthetic evaluation case list.");
  assert(comparison.fixtures.fixture_count === expectedCases.length, "Comparison fixture count should use full v2 cases.");
  for (const requiredCase of [
    "item_administration_what",
    "item_administration_about_what",
    "item_administration_which_item_do_you_mean",
    "item_administration_request_for_an_example",
    "response_collection_substantive_correct_answer",
    "response_collection_partial_understanding",
    "student_profiling_specific_misconception",
    "followup_assessment_system_question",
    "topic_dialogue_unrelated_question"
  ]) {
    assert(expectedCases.includes(requiredCase as typeof fullGpt56V2EvaluationCases[number]), `Missing fixed evaluation case ${requiredCase}.`);
  }

  console.log(JSON.stringify({
    status: "passed",
    no_openai_call: true,
    old_approved_baseline_hash: approved.approved_active_configuration_hash,
    current_active_configuration_hash: currentActiveHash,
    old_full_mixed_candidate_manifest_hash: oldFullMixedManifestHash,
    old_full_mixed_candidate_active_configuration_hash: oldFullMixedActiveHash,
    minimal_candidate_manifest_hash: minimalManifestHash,
    minimal_candidate_active_configuration_hash: minimalActiveHash,
    full_v2_candidate_manifest_hash: fullV2ManifestHash,
    full_v2_candidate_active_configuration_hash: fullV2ActiveHash,
    approved_hash_after_explicit_approval: null,
    changed_role_count: changedRoles.length,
    evaluation_case_count: expectedCases.length
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(error);
  process.exit(1);
}
