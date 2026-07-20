import { stableHash } from "@/lib/operational/stable-hash";
import {
  E2A17_APPROVED_V2_HASH,
  E2A17_CANDIDATE_FILE_SHA256,
  E2A17_CANDIDATE_HASH
} from "./e2a17-protocol";
import {
  E2A18_SIMULATOR_CONTRACT_VERSION
} from "./e2a18-student-simulator-contract-v2";
import {
  E2A20_ORCHESTRATION_VERSION,
  buildE2A21ProtocolDraft
} from "./e2a20-evidence-driven-transition-adjudication";
import {
  E2A20A_SIMULATOR_EVIDENCE_CLASSIFIER_VERSION
} from "./e2a20a-student-simulator-evidence-classifier-v3";
import { E2A19_FROZEN_PROTOCOL } from "./e2a19-protocol";

export const E2A21_RUNNER_VERSION =
  "e2a21-evidence-driven-single-session-micro-canary-v1" as const;

export const E2A21_AUTHORIZED_ARTIFACTS = [
  "canary-manifest.json",
  "frozen-protocol.json",
  "frozen-protocol.sha256",
  "candidate-integrity.json",
  "classifier-integrity.json",
  "session-orchestration-policy.json",
  "session-fixture.json",
  "information-flow-audit.jsonl",
  "simulator-provider-outputs.jsonl",
  "simulator-evidence-classifications.jsonl",
  "objective-fulfillment-results.jsonl",
  "hidden-state-transition-results.jsonl",
  "student-turn-results.jsonl",
  "routing-decisions.jsonl",
  "tutor-provider-outputs.jsonl",
  "runtime-validation-results.jsonl",
  "pedagogical-rubric-results.jsonl",
  "progression-results.jsonl",
  "persistence-results.jsonl",
  "student-projection-results.jsonl",
  "audit-projection-results.jsonl",
  "transcript-refresh-results.jsonl",
  "privacy-results.jsonl",
  "context-coverage-results.jsonl",
  "fixture-cleanup-result.json",
  "provider-usage.json",
  "human-review-packet.json",
  "canary-summary.json"
] as const;

export type E2A21ArtifactName =
  typeof E2A21_AUTHORIZED_ARTIFACTS[number];

const artifactStages: Record<E2A21ArtifactName, string> = {
  "canary-manifest.json": "always_required",
  "frozen-protocol.json": "always_required",
  "frozen-protocol.sha256": "always_required",
  "candidate-integrity.json": "always_required",
  "classifier-integrity.json": "always_required",
  "session-orchestration-policy.json": "always_required",
  "session-fixture.json": "always_required",
  "information-flow-audit.jsonl": "simulator_request_constructed",
  "simulator-provider-outputs.jsonl": "simulator_provider_returned",
  "simulator-evidence-classifications.jsonl": "simulator_classified",
  "objective-fulfillment-results.jsonl": "evidence_transition_adjudicated",
  "hidden-state-transition-results.jsonl": "evidence_transition_adjudicated",
  "student-turn-results.jsonl": "student_turn_persisted",
  "routing-decisions.jsonl": "route_selected",
  "tutor-provider-outputs.jsonl": "tutor_provider_returned",
  "runtime-validation-results.jsonl": "tutor_runtime_validated",
  "pedagogical-rubric-results.jsonl": "pedagogical_rubric_applied",
  "progression-results.jsonl": "progression_applied",
  "persistence-results.jsonl": "effective_result_persisted",
  "student-projection-results.jsonl": "student_projection_created",
  "audit-projection-results.jsonl": "audit_projection_created",
  "transcript-refresh-results.jsonl": "transcript_refreshed",
  "privacy-results.jsonl": "privacy_scanned",
  "context-coverage-results.jsonl": "context_audited",
  "fixture-cleanup-result.json": "always_required",
  "provider-usage.json": "always_required",
  "human-review-packet.json": "always_required",
  "canary-summary.json": "always_required"
};

export const E2A21_FROZEN_PROTOCOL = buildE2A21ProtocolDraft();
export const E2A21_PROTOCOL_HASH = E2A21_FROZEN_PROTOCOL.protocol_hash;
export const E2A21_SESSION = E2A19_FROZEN_PROTOCOL.session;

export const E2A21_BUDGET = {
  budget_version: "e2a21-single-session-micro-canary-budget-v1",
  maximum_sessions: 1,
  maximum_student_turns: 6,
  maximum_visible_dialogue_turns: 12,
  maximum_simulator_calls: 6,
  maximum_tutor_initial_generation_calls: 6,
  maximum_tutor_regeneration_calls: 2,
  maximum_tutor_regenerations_per_turn: 1,
  maximum_total_logical_generation_calls: 14,
  maximum_transport_retries_per_generation_call: 2,
  maximum_provider_adapter_attempts: 42,
  per_request_token_caps: {
    simulator_input_tokens: 24_000,
    simulator_output_tokens: 500,
    tutor_input_tokens: 32_000,
    tutor_output_tokens: 3_500
  },
  maximum_input_tokens: 400_000,
  maximum_output_tokens: 31_000,
  maximum_total_tokens: 431_000,
  maximum_estimated_cost_usd_when_pricing_available: 10,
  pricing_unavailable_behavior: "record_null_cost_and_do_not_fabricate",
  provider_concurrency: 1
} as const;

export const E2A21_ARTIFACT_CONTRACT = {
  contract_version: "e2a21-abort-aware-artifact-contract-v1",
  required_artifact_count: E2A21_AUTHORIZED_ARTIFACTS.length,
  artifacts: E2A21_AUTHORIZED_ARTIFACTS.map((name) => ({
    name,
    stage: artifactStages[name],
    structurally_permitted_empty_after_early_abort: name.endsWith(".jsonl")
  })),
  allowed_session_outcomes: [
    "passed_required_endpoint",
    "completed_valid_bounded_stop",
    "failed_contract",
    "failed_safety",
    "failed_stability",
    "incomplete_infrastructure"
  ],
  empty_artifact_classifications: [
    "expected_empty_due_to_early_abort",
    "not_generated_because_provider_not_called",
    "populated_and_valid",
    "missing",
    "malformed",
    "hash_mismatch"
  ]
} as const;

export const E2A21_ARTIFACT_CONTRACT_HASH = stableHash(
  E2A21_ARTIFACT_CONTRACT
);

export function validateE2A21FrozenProtocol() {
  const protocol = E2A21_FROZEN_PROTOCOL;
  const protocolCore = { ...protocol } as Record<string, unknown>;
  delete protocolCore.protocol_hash;
  const computedProtocolHash = stableHash(protocolCore);
  const checks = {
    protocol_hash_matches:
      computedProtocolHash === E2A21_PROTOCOL_HASH &&
      protocol.protocol_hash === E2A21_PROTOCOL_HASH,
    exact_one_session: protocol.session_count === 1,
    maximum_six_student_turns: protocol.maximum_student_turns === 6,
    maximum_twelve_visible_turns:
      protocol.maximum_visible_dialogue_turns === 12,
    classifier_v3: protocol.evidence_classifier_version ===
      E2A20A_SIMULATOR_EVIDENCE_CLASSIFIER_VERSION,
    evidence_driven_orchestration: protocol.orchestration_version ===
      E2A20_ORCHESTRATION_VERSION,
    simulator_contract_v2: protocol.simulator_contract_version ===
      E2A18_SIMULATOR_CONTRACT_VERSION,
    observed_evidence_controls_transition:
      protocol.observed_evidence_controls_transition,
    no_fixed_turn_transition: !protocol.fixed_turn_evidence_transition_required,
    candidate_hash_frozen: E2A17_CANDIDATE_HASH ===
      "f6b4eaaf22f4342d4ccfd37bd3bc10aa75c31206343a84c27abfbde8fbbbc58a",
    candidate_file_sha_frozen: E2A17_CANDIDATE_FILE_SHA256 ===
      "a229603d767bf4fa0adc19a0b31a60c976bd3ee0cb0ad3dcfed05a30663790e8",
    approved_v2_frozen: E2A17_APPROVED_V2_HASH ===
      "8e30e24a3e04a3c2506b1e23c447557fc2fe623012550de557e5240d7c689993",
    sessions_one: E2A21_BUDGET.maximum_sessions === 1,
    simulator_calls_six: E2A21_BUDGET.maximum_simulator_calls === 6,
    tutor_calls_six:
      E2A21_BUDGET.maximum_tutor_initial_generation_calls === 6,
    tutor_regenerations_two:
      E2A21_BUDGET.maximum_tutor_regeneration_calls === 2,
    logical_calls_fourteen:
      E2A21_BUDGET.maximum_total_logical_generation_calls === 14,
    adapter_attempts_forty_two:
      E2A21_BUDGET.maximum_provider_adapter_attempts === 42,
    input_tokens_400k: E2A21_BUDGET.maximum_input_tokens === 400_000,
    output_tokens_31k: E2A21_BUDGET.maximum_output_tokens === 31_000,
    total_tokens_431k: E2A21_BUDGET.maximum_total_tokens === 431_000,
    cost_ten: E2A21_BUDGET
      .maximum_estimated_cost_usd_when_pricing_available === 10,
    concurrency_one: E2A21_BUDGET.provider_concurrency === 1,
    artifact_count_exact: E2A21_AUTHORIZED_ARTIFACTS.length === 28
  };
  return {
    protocol,
    budget: E2A21_BUDGET,
    artifact_contract: E2A21_ARTIFACT_CONTRACT,
    artifact_contract_hash: E2A21_ARTIFACT_CONTRACT_HASH,
    computed_protocol_hash: computedProtocolHash,
    checks,
    passed: Object.values(checks).every(Boolean)
  };
}
