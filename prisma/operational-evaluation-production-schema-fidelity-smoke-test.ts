import { loadEnvConfig } from "@next/env";
import {
  evaluateCandidateOutputPolicy,
  modelUpgradeEvaluationFixtures,
  productionSchemaFidelity,
  type CandidateEvaluationOutput
} from "../src/lib/operational/model-upgrade-evaluation";
import {
  FULL_GPT56_V2_CANDIDATE_CONFIG_PATH,
  readCandidateOperationalModelConfig
} from "../src/lib/operational/model-upgrade";
import { assert } from "./operational-model-upgrade-test-helpers";

loadEnvConfig(process.cwd());

function output(role: CandidateEvaluationOutput["role"], fixtureId: string): CandidateEvaluationOutput {
  return {
    fixture_id: fixtureId,
    role,
    response_status: "answered",
    output_kind: "student_facing",
    response_summary: "Production schema fidelity test.",
    student_facing_text: "Please explain your reasoning for the current item.",
    teacher_facing_text: null,
    decision_summary: "Safe decision.",
    evidence_used: ["synthetic fixture"],
    safety_notes: [],
    next_action: null,
    confidence: "medium"
  };
}

function main() {
  const candidate = readCandidateOperationalModelConfig(FULL_GPT56_V2_CANDIDATE_CONFIG_PATH);
  const fixtures = modelUpgradeEvaluationFixtures();
  const itemAdmin = fixtures.find((entry) => entry.fixture_id === "item_administration_what");
  const profileIntegration = fixtures.find((entry) => entry.fixture_id === "profile_integration_mixed_correctness");
  assert(itemAdmin, "Item administration fixture missing.");
  assert(profileIntegration, "Profile integration fixture missing.");

  const itemAdminOutput = output(itemAdmin.role, itemAdmin.fixture_id);
  const itemAdminFidelity = productionSchemaFidelity(itemAdmin, candidate, itemAdminOutput);
  assert(itemAdminFidelity.layer_a.schema_name === "candidate_evaluation_output_v1", "Layer A envelope should be recorded.");
  assert(itemAdminFidelity.layer_b.role === "item_administration_tutor_agent", "Layer B role should be recorded.");
  assert(itemAdminFidelity.layer_b.prompt_version === "item-admin-tutor-v1", "Role prompt version should be recorded.");
  assert(itemAdminFidelity.layer_b.output_schema_version === "item-admin-tutor-output-v1", "Production role schema should be recorded.");
  assert(itemAdminFidelity.layer_b.validator_version === "chat-native-response-quality-v1", "Production validator should be recorded.");
  assert(itemAdminFidelity.layer_b.fallback_version === "item-administration-tutor-deterministic-fallback-v1", "Fallback version should be recorded.");
  assert(itemAdminFidelity.layer_b.rendered_projection_fields.includes("student_facing_text"), "Rendered projection should be recorded.");

  const policy = evaluateCandidateOutputPolicy(itemAdminOutput, itemAdmin);
  assert(policy.claim_details.length === 0, "Neutral item-admin output should not create latent claims.");

  const profileFidelity = productionSchemaFidelity(profileIntegration, candidate, output(profileIntegration.role, profileIntegration.fixture_id));
  assert(profileFidelity.layer_b.input_schema_version === "ability-evidence-v1 + engagement-evidence-v1", "Profile integration input schema should be recorded.");
  assert(profileFidelity.layer_b.output_schema_version === "profile-integration-interpretation-v1", "Profile integration output schema should be recorded.");

  console.log(JSON.stringify({
    status: "passed",
    no_openai_call: true,
    layer_a_generic_envelope_recorded: true,
    layer_b_role_schema_recorded: true,
    prompt_validator_fallback_metadata_recorded: true
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(error);
  process.exit(1);
}
