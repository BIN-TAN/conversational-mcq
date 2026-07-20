import { stableHash } from "@/lib/operational/stable-hash";
import {
  E2A17_APPROVED_V2_HASH,
  E2A17_CANDIDATE_FILE_SHA256,
  E2A17_CANDIDATE_HASH
} from "./e2a17-protocol";
import {
  E2A20A_SIMULATOR_EVIDENCE_CLASSIFIER_VERSION
} from "./e2a20a-student-simulator-evidence-classifier-v3";
import { E2A21_SESSION } from "./e2a21-protocol";
import {
  EVIDENCE_FIRST_PROFILE_ROUTING_VERSION
} from "@/lib/services/student-assessment/topic-dialogue-evidence-first-routing";

export const E2A23_RUNNER_VERSION =
  "e2a23-evidence-first-single-session-micro-canary-v1" as const;

export const E2A23_AUTHORIZED_ARTIFACTS = [
  "canary-manifest.json",
  "composite-runtime-identity.json",
  "frozen-protocol.json",
  "frozen-protocol.sha256",
  "candidate-integrity.json",
  "classifier-integrity.json",
  "routing-integrity.json",
  "session-fixture.json",
  "information-flow-audit.jsonl",
  "student-provider-outputs.jsonl",
  "student-turn-results.jsonl",
  "intent-classifications.jsonl",
  "conceptual-evidence-evaluations.jsonl",
  "turn-profile-snapshots.jsonl",
  "cumulative-profile-updates.jsonl",
  "routing-decisions.jsonl",
  "profile-freshness-results.jsonl",
  "tutor-request-provenance.jsonl",
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
  "causal-timeline.json",
  "human-review-packet.json",
  "canary-summary.json"
] as const;

export type E2A23ArtifactName =
  typeof E2A23_AUTHORIZED_ARTIFACTS[number];

export const E2A23_BUDGET = {
  budget_version: "e2a23-evidence-first-micro-canary-budget-v1",
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

const protocolCore = {
  protocol_version: "e2a23-evidence-first-single-session-micro-canary-v1",
  status: "authorized_single_execution_only",
  approved_v2_hash: E2A17_APPROVED_V2_HASH,
  tutor_candidate_hash: E2A17_CANDIDATE_HASH,
  tutor_candidate_file_sha256: E2A17_CANDIDATE_FILE_SHA256,
  evidence_classifier_version:
    E2A20A_SIMULATOR_EVIDENCE_CLASSIFIER_VERSION,
  orchestration_version: EVIDENCE_FIRST_PROFILE_ROUTING_VERSION,
  conceptual_target: "Item 16 option A information-function misconception",
  required_endpoint: "revision_authorized",
  session_count: 1,
  maximum_student_turns: 6,
  maximum_visible_dialogue_turns: 12,
  latest_evidence_precedence: true,
  profile_update_precedes_tutor_request: true,
  no_minimum_dialogue_turn_requirement: true,
  platform_owns_route_selection: true,
  stale_profile_requests_fail_closed: true,
  sound_profile_routes_immediately_to_revision: true,
  valid_bounded_stop_allowed: true,
  candidate_approval_forbidden: true,
  candidate_activation_forbidden: true,
  four_session_canary_forbidden: true,
  thirty_six_session_matrix_forbidden: true,
  e2b_forbidden: true,
  provider_calls_authorized: true,
  provider_concurrency: 1,
  budget: E2A23_BUDGET
} as const;

export const E2A23_FROZEN_PROTOCOL = {
  ...protocolCore,
  protocol_hash: stableHash(protocolCore)
} as const;

export const E2A23_PROTOCOL_HASH = E2A23_FROZEN_PROTOCOL.protocol_hash;
export const E2A23_SESSION = E2A21_SESSION;

export const E2A23_ARTIFACT_CONTRACT = {
  contract_version: "e2a23-abort-aware-artifact-contract-v1",
  required_artifact_count: E2A23_AUTHORIZED_ARTIFACTS.length,
  required_artifacts: E2A23_AUTHORIZED_ARTIFACTS,
  artifacts: E2A23_AUTHORIZED_ARTIFACTS.map((name) => ({
    name,
    stage: name.endsWith(".jsonl") ? name : "always_required",
    structurally_permitted_empty_after_early_abort: name.endsWith(".jsonl")
  })),
  allowed_outcomes: [
    "e2a23_micro_canary_pass_profile_first_revision",
    "e2a23_micro_canary_complete_bounded_stop_pending_adjudication",
    "e2a23_micro_canary_failed_profile_freshness",
    "e2a23_micro_canary_failed_progression",
    "e2a23_micro_canary_failed_safety",
    "e2a23_micro_canary_failed_stability",
    "e2a23_micro_canary_incomplete_infrastructure"
  ],
  jsonl_artifacts_may_be_empty_only_after_early_abort: true,
  human_decisions_must_remain_null: true,
  historical_evidence_must_not_be_overwritten: true
} as const;

export const E2A23_ARTIFACT_CONTRACT_HASH = stableHash(
  E2A23_ARTIFACT_CONTRACT
);

export function validateE2A23Protocol() {
  const recomputed = stableHash(protocolCore);
  const logical = E2A23_BUDGET.maximum_simulator_calls +
    E2A23_BUDGET.maximum_tutor_initial_generation_calls +
    E2A23_BUDGET.maximum_tutor_regeneration_calls;
  const attempts = logical *
    (1 + E2A23_BUDGET.maximum_transport_retries_per_generation_call);
  const checks = {
    protocol_hash_matches: recomputed === E2A23_PROTOCOL_HASH,
    approved_v2_frozen: E2A17_APPROVED_V2_HASH ===
      "8e30e24a3e04a3c2506b1e23c447557fc2fe623012550de557e5240d7c689993",
    tutor_candidate_frozen: E2A17_CANDIDATE_HASH ===
      "f6b4eaaf22f4342d4ccfd37bd3bc10aa75c31206343a84c27abfbde8fbbbc58a",
    tutor_candidate_file_frozen: E2A17_CANDIDATE_FILE_SHA256 ===
      "a229603d767bf4fa0adc19a0b31a60c976bd3ee0cb0ad3dcfed05a30663790e8",
    classifier_v3: E2A20A_SIMULATOR_EVIDENCE_CLASSIFIER_VERSION ===
      "student-simulator-evidence-classifier-v3",
    evidence_first_routing_v1: EVIDENCE_FIRST_PROFILE_ROUTING_VERSION ===
      "e2a22-evidence-first-profile-routing-v1",
    exact_one_session: E2A23_BUDGET.maximum_sessions === 1,
    six_student_turns_max: E2A23_BUDGET.maximum_student_turns === 6,
    twelve_visible_turns_max:
      E2A23_BUDGET.maximum_visible_dialogue_turns === 12,
    logical_call_limit: logical === 14,
    adapter_attempt_limit: attempts === 42,
    token_limits: E2A23_BUDGET.maximum_input_tokens === 400_000 &&
      E2A23_BUDGET.maximum_output_tokens === 31_000 &&
      E2A23_BUDGET.maximum_total_tokens === 431_000,
    cost_limit: E2A23_BUDGET
      .maximum_estimated_cost_usd_when_pricing_available === 10,
    concurrency_one: E2A23_BUDGET.provider_concurrency === 1,
    artifact_count: E2A23_AUTHORIZED_ARTIFACTS.length === 33
  };
  return {
    protocol: E2A23_FROZEN_PROTOCOL,
    protocol_hash: E2A23_PROTOCOL_HASH,
    artifact_contract: E2A23_ARTIFACT_CONTRACT,
    artifact_contract_hash: E2A23_ARTIFACT_CONTRACT_HASH,
    logical_call_limit: logical,
    adapter_attempt_limit: attempts,
    checks,
    passed: Object.values(checks).every(Boolean)
  };
}
