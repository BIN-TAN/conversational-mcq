import { stableHash } from "@/lib/operational/stable-hash";
import {
  buildE2A19BudgetDraft,
  buildE2A19ProtocolDraft
} from "./e2a18-simulator-contract-adjudication";
import {
  E2A18_SIMULATOR_CONTRACT_VERSION,
  E2A18_SIMULATOR_EVIDENCE_CLASSIFIER_VERSION
} from "./e2a18-student-simulator-contract-v2";
import {
  E2A17_APPROVED_V2_HASH,
  E2A17_CANDIDATE_FILE_SHA256,
  E2A17_CANDIDATE_HASH
} from "./e2a17-protocol";

export const E2A19_RUNNER_VERSION =
  "e2a19-single-session-student-simulator-micro-canary-v1" as const;
export const E2A19_PROTOCOL_HASH =
  "66b63f107ad6b2cc2141720ed3d644935a5a99dd5962934eb914968541a0b46c" as const;
export const E2A19_AUTHORIZED_ARTIFACTS = [
  "canary-manifest.json",
  "frozen-protocol.json",
  "frozen-protocol.sha256",
  "candidate-integrity.json",
  "simulator-contract.json",
  "evidence-classifier-policy.json",
  "session-fixture.json",
  "information-flow-audit.jsonl",
  "simulator-provider-outputs.jsonl",
  "simulator-evidence-classifications.jsonl",
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

export type E2A19ArtifactName = typeof E2A19_AUTHORIZED_ARTIFACTS[number];

const artifactStages: Record<E2A19ArtifactName, string> = {
  "canary-manifest.json": "always_required",
  "frozen-protocol.json": "always_required",
  "frozen-protocol.sha256": "always_required",
  "candidate-integrity.json": "always_required",
  "simulator-contract.json": "always_required",
  "evidence-classifier-policy.json": "always_required",
  "session-fixture.json": "always_required",
  "information-flow-audit.jsonl": "simulator_request_constructed",
  "simulator-provider-outputs.jsonl": "simulator_provider_returned",
  "simulator-evidence-classifications.jsonl": "simulator_classified",
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

export const E2A19_FROZEN_PROTOCOL = buildE2A19ProtocolDraft();
export const E2A19_BUDGET = buildE2A19BudgetDraft();

export const E2A19_ARTIFACT_CONTRACT = {
  contract_version: "e2a19-abort-aware-artifact-contract-v1",
  integrity_policy_version: "e2a18-abort-aware-artifact-integrity-v1",
  required_artifact_count: E2A19_AUTHORIZED_ARTIFACTS.length,
  artifacts: E2A19_AUTHORIZED_ARTIFACTS.map((name) => ({
    name,
    stage: artifactStages[name],
    structurally_permitted_empty_after_early_abort: name.endsWith(".jsonl")
  })),
  empty_artifact_classifications: [
    "expected_empty_not_reached",
    "expected_empty_due_to_early_abort",
    "populated_and_valid",
    "missing",
    "malformed",
    "hash_mismatch"
  ]
} as const;

export const E2A19_ARTIFACT_CONTRACT_HASH = stableHash(
  E2A19_ARTIFACT_CONTRACT
);

export function validateE2A19FrozenProtocol() {
  const protocolCore = { ...E2A19_FROZEN_PROTOCOL } as Record<string, unknown>;
  delete protocolCore.frozen_protocol_hash;
  const computedProtocolHash = stableHash(protocolCore);
  const budget = E2A19_BUDGET;
  const checks = {
    protocol_hash_matches_frozen_draft:
      E2A19_FROZEN_PROTOCOL.frozen_protocol_hash === E2A19_PROTOCOL_HASH &&
      computedProtocolHash === E2A19_PROTOCOL_HASH,
    exact_one_session: E2A19_FROZEN_PROTOCOL.session_count === 1,
    maximum_student_turns_six:
      E2A19_FROZEN_PROTOCOL.maximum_student_turns === 6,
    maximum_visible_turns_twelve:
      E2A19_FROZEN_PROTOCOL.maximum_visible_dialogue_turns === 12,
    simulator_contract_v2:
      E2A19_FROZEN_PROTOCOL.simulator_contract_version ===
      E2A18_SIMULATOR_CONTRACT_VERSION,
    evidence_classifier_v2:
      E2A18_SIMULATOR_EVIDENCE_CLASSIFIER_VERSION ===
      "student-simulator-evidence-classifier-v2",
    candidate_hash_frozen: E2A17_CANDIDATE_HASH ===
      "f6b4eaaf22f4342d4ccfd37bd3bc10aa75c31206343a84c27abfbde8fbbbc58a",
    candidate_file_sha_frozen: E2A17_CANDIDATE_FILE_SHA256 ===
      "a229603d767bf4fa0adc19a0b31a60c976bd3ee0cb0ad3dcfed05a30663790e8",
    approved_v2_frozen: E2A17_APPROVED_V2_HASH ===
      "8e30e24a3e04a3c2506b1e23c447557fc2fe623012550de557e5240d7c689993",
    simulator_calls_six: budget.maximum_simulator_calls === 6,
    initial_tutor_calls_six:
      budget.maximum_tutor_initial_generation_calls === 6,
    tutor_regenerations_two: budget.maximum_tutor_regeneration_calls === 2,
    logical_calls_fourteen:
      budget.maximum_total_logical_generation_calls === 14,
    adapter_attempts_forty_two:
      budget.maximum_provider_adapter_attempts === 42,
    input_tokens_four_hundred_thousand:
      budget.maximum_input_tokens === 400_000,
    output_tokens_thirty_one_thousand:
      budget.maximum_output_tokens === 31_000,
    total_tokens_four_hundred_thirty_one_thousand:
      budget.maximum_total_tokens === 431_000,
    cost_ceiling_ten:
      budget.maximum_estimated_cost_usd_when_pricing_available === 10,
    provider_concurrency_one: budget.provider_concurrency === 1,
    artifact_count_exact:
      E2A19_AUTHORIZED_ARTIFACTS.length === 26
  };
  return {
    protocol: E2A19_FROZEN_PROTOCOL,
    budget,
    artifact_contract: E2A19_ARTIFACT_CONTRACT,
    artifact_contract_hash: E2A19_ARTIFACT_CONTRACT_HASH,
    computed_protocol_hash: computedProtocolHash,
    checks,
    passed: Object.values(checks).every(Boolean)
  };
}
