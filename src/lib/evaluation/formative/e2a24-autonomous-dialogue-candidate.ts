import { readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { stableHash } from "@/lib/operational/stable-hash";
import {
  AUTONOMOUS_FORMATIVE_DIALOGUE_ARCHITECTURE_VERSION,
  AUTONOMOUS_FORMATIVE_REPETITION_POLICY_VERSION,
  AUTONOMOUS_PEDAGOGY_INPUT_SCHEMA_VERSION,
  AUTONOMOUS_PEDAGOGY_OUTPUT_SCHEMA_VERSION,
  AUTONOMOUS_PEDAGOGY_PROMPT_HASH,
  AUTONOMOUS_PEDAGOGY_PROMPT_VERSION,
  AUTONOMOUS_PEDAGOGY_QUALITY_REVIEW_VERSION,
  AUTONOMOUS_PEDAGOGY_VALIDATOR_VERSION,
  COMPLETE_VISIBLE_FORMATIVE_EPISODE_VERSION,
  PEDAGOGICAL_INTERVENTION_MEMORY_VERSION
} from "@/lib/services/student-assessment/autonomous-formative-dialogue";
import {
  TOPIC_DIALOGUE_CUMULATIVE_PROFILE_VERSION,
  TOPIC_DIALOGUE_TURN_PROFILE_VERSION
} from "@/lib/services/student-assessment/topic-dialogue-evidence-first-routing";
import {
  PROFILE_CONSISTENCY_POLICY_VERSION,
  PRODUCTION_TURN_EVIDENCE_EVALUATOR_VERSION,
  TARGET_EVIDENCE_CONTRACT_VERSION,
  TURN_EVIDENCE_PROFILE_MAPPER_VERSION
} from "@/lib/services/student-assessment/target-evidence-contract";
import {
  changedPaths,
  E2A4_APPROVED_V2_HASH,
  readE2A4BaselineManifest,
  sha256,
  type E2A4BaselineManifest
} from "./e2a4-topic-dialogue-contract";
import {
  deriveE2A14FullCandidate,
  E2A14_CANDIDATE_FILE_SHA256,
  E2A14_CANDIDATE_HASH,
  E2A14_CANDIDATE_PATH
} from "./e2a14-protected-request-validator-candidate";

export const E2A24_CANDIDATE_PATH = path.join(
  process.cwd(),
  "config",
  "candidate-operational-agent-config.e2a24-autonomous-formative-dialogue-v1.json"
);
export const E2A24_CANDIDATE_STATUS =
  "e2a24_autonomous_formative_dialogue_candidate_unapproved" as const;
export const E2A24_FULL_CONVERSATION_POLICY_VERSION =
  "e2a24-full-visible-episode-context-v1" as const;
export const E2A24_EVALUATOR_INTEGRATION_VERSION =
  "e2a24-independent-turn-evaluator-integration-v1" as const;
export const E2A24_PLATFORM_AUTHORITY_VERSION =
  "e2a24-platform-progression-authority-v1" as const;
export const E2A24_FORMER_OPERATION_TAXONOMY_VERSION =
  "e2a24-operation-taxonomy-post-hoc-v1" as const;

const DeltaValueSchema = z.union([
  z.string(), z.number(), z.boolean(), z.null()
]);
const DeltaSchema = z.object({
  from: DeltaValueSchema,
  to: DeltaValueSchema
}).strict();

export const E2A24CandidateManifestSchema = z.object({
  manifest_version: z.literal(
    "e2a24-autonomous-formative-dialogue-candidate-v1"
  ),
  candidate_status: z.literal(E2A24_CANDIDATE_STATUS),
  approval_state: z.literal("candidate_not_approved"),
  activation_state: z.literal("not_activated"),
  approved_v2_hash: z.literal(E2A4_APPROVED_V2_HASH),
  previous_candidate_hash: z.literal(E2A14_CANDIDATE_HASH),
  previous_candidate_path: z.string().min(1),
  previous_candidate_file_sha256: z.literal(E2A14_CANDIDATE_FILE_SHA256),
  candidate_configuration_hash: z.string().length(64),
  candidate_profile_name: z.string().min(1),
  evaluation_required: z.literal(true),
  human_review_required: z.literal(true),
  student_facing_operational_use_approved: z.literal(false),
  teacher_tool_use_approved: z.literal(false),
  e2a25_execution_authorized: z.literal(false),
  roles_unchanged_from_previous_candidate: z.literal(true),
  unrelated_role_hashes_unchanged: z.literal(true),
  topic_dialogue_contract: z.object({
    architecture_version: z.literal(
      AUTONOMOUS_FORMATIVE_DIALOGUE_ARCHITECTURE_VERSION
    ),
    prompt_version: z.literal(AUTONOMOUS_PEDAGOGY_PROMPT_VERSION),
    prompt_hash: z.literal(AUTONOMOUS_PEDAGOGY_PROMPT_HASH),
    input_schema_version: z.literal(
      AUTONOMOUS_PEDAGOGY_INPUT_SCHEMA_VERSION
    ),
    output_schema_version: z.literal(
      AUTONOMOUS_PEDAGOGY_OUTPUT_SCHEMA_VERSION
    ),
    validator_version: z.literal(AUTONOMOUS_PEDAGOGY_VALIDATOR_VERSION),
    quality_review_version: z.literal(
      AUTONOMOUS_PEDAGOGY_QUALITY_REVIEW_VERSION
    ),
    full_conversation_context_version: z.literal(
      COMPLETE_VISIBLE_FORMATIVE_EPISODE_VERSION
    ),
    full_conversation_policy_version: z.literal(
      E2A24_FULL_CONVERSATION_POLICY_VERSION
    ),
    turn_evaluator_integration_version: z.literal(
      E2A24_EVALUATOR_INTEGRATION_VERSION
    ),
    target_evidence_contract_version: z.literal(
      TARGET_EVIDENCE_CONTRACT_VERSION
    ),
    turn_evaluator_version: z.literal(
      PRODUCTION_TURN_EVIDENCE_EVALUATOR_VERSION
    ),
    turn_profile_version: z.literal(TOPIC_DIALOGUE_TURN_PROFILE_VERSION),
    cumulative_profile_version: z.literal(
      TOPIC_DIALOGUE_CUMULATIVE_PROFILE_VERSION
    ),
    profile_mapper_version: z.literal(TURN_EVIDENCE_PROFILE_MAPPER_VERSION),
    profile_consistency_version: z.literal(
      PROFILE_CONSISTENCY_POLICY_VERSION
    ),
    intervention_memory_version: z.literal(
      PEDAGOGICAL_INTERVENTION_MEMORY_VERSION
    ),
    repetition_policy_version: z.literal(
      AUTONOMOUS_FORMATIVE_REPETITION_POLICY_VERSION
    ),
    platform_authority_version: z.literal(E2A24_PLATFORM_AUTHORITY_VERSION),
    former_operation_taxonomy_version: z.literal(
      E2A24_FORMER_OPERATION_TAXONOMY_VERSION
    ),
    complete_history_maximum_visible_turns: z.literal(21),
    raw_turn_truncation_allowed: z.literal(false),
    minimum_turn_requirement: z.literal(false),
    maximum_regenerations_after_hard_rejection: z.literal(1),
    soft_findings_trigger_regeneration: z.literal(false),
    post_activity_evaluator_called_on_each_turn: z.literal(false)
  }).strict(),
  exact_delta_from_previous_candidate: z.record(z.string(), DeltaSchema),
  acceptance_criteria: z.record(z.string(), z.literal(true))
}).strict();

export type E2A24CandidateManifest = z.infer<
  typeof E2A24CandidateManifestSchema
>;

export function deriveE2A24FullCandidate(
  baseline: E2A4BaselineManifest = readE2A4BaselineManifest()
) {
  const derived = deriveE2A14FullCandidate(baseline);
  derived.runtime_policy.topic_dialogue_policy.recent_raw_turn_window = 21;
  const metadata =
    derived.configuration_fingerprint.role_version_metadata
      .topic_dialogue_agent;
  if (!metadata) throw new Error("e2a24_topic_dialogue_metadata_missing");
  metadata.prompt_version = AUTONOMOUS_PEDAGOGY_PROMPT_VERSION;
  metadata.prompt_hash = AUTONOMOUS_PEDAGOGY_PROMPT_HASH;
  metadata.input_schema_version = AUTONOMOUS_PEDAGOGY_INPUT_SCHEMA_VERSION;
  metadata.output_schema_version = AUTONOMOUS_PEDAGOGY_OUTPUT_SCHEMA_VERSION;
  metadata.validator_version = AUTONOMOUS_PEDAGOGY_VALIDATOR_VERSION;
  metadata.pedagogical_evaluation_rubric_version =
    AUTONOMOUS_PEDAGOGY_QUALITY_REVIEW_VERSION;
  metadata.autonomous_dialogue_architecture_version =
    AUTONOMOUS_FORMATIVE_DIALOGUE_ARCHITECTURE_VERSION;
  metadata.full_conversation_context_version =
    COMPLETE_VISIBLE_FORMATIVE_EPISODE_VERSION;
  metadata.full_conversation_policy_version =
    E2A24_FULL_CONVERSATION_POLICY_VERSION;
  metadata.turn_evidence_evaluator_integration_version =
    E2A24_EVALUATOR_INTEGRATION_VERSION;
  metadata.target_evidence_contract_version = TARGET_EVIDENCE_CONTRACT_VERSION;
  metadata.turn_evidence_evaluator_version =
    PRODUCTION_TURN_EVIDENCE_EVALUATOR_VERSION;
  metadata.turn_profile_version = TOPIC_DIALOGUE_TURN_PROFILE_VERSION;
  metadata.cumulative_profile_version =
    TOPIC_DIALOGUE_CUMULATIVE_PROFILE_VERSION;
  metadata.profile_mapper_version = TURN_EVIDENCE_PROFILE_MAPPER_VERSION;
  metadata.profile_consistency_version = PROFILE_CONSISTENCY_POLICY_VERSION;
  metadata.intervention_memory_version =
    PEDAGOGICAL_INTERVENTION_MEMORY_VERSION;
  metadata.repetition_policy_version =
    AUTONOMOUS_FORMATIVE_REPETITION_POLICY_VERSION;
  metadata.platform_authority_version = E2A24_PLATFORM_AUTHORITY_VERSION;
  metadata.former_operation_taxonomy_version =
    E2A24_FORMER_OPERATION_TAXONOMY_VERSION;
  metadata.minimum_turn_requirement = false;
  metadata.raw_turn_truncation_allowed = false;
  metadata.post_activity_evaluator_called_on_each_turn = false;
  return derived;
}

function roleHashes(candidate: E2A4BaselineManifest) {
  return Object.fromEntries(Object.keys(candidate.roles).sort().map((role) => [
    role,
    stableHash({
      role,
      model_config: candidate.roles[role],
      version_metadata:
        candidate.configuration_fingerprint.role_version_metadata[role] ??
        null,
      runtime_policy: role === "topic_dialogue_agent"
        ? candidate.runtime_policy.topic_dialogue_policy
        : null
    })
  ]));
}

function deltaRecord(before: unknown, after: unknown) {
  const readPath = (value: unknown, dotted: string) => dotted.split(".")
    .reduce<unknown>((current, part) => current && typeof current === "object"
      ? (current as Record<string, unknown>)[part]
      : undefined, value);
  return Object.fromEntries(changedPaths(before, after).map((entry) => [
    entry,
    {
      from: readPath(before, entry) ?? null,
      to: readPath(after, entry) ?? null
    }
  ]));
}

export function readE2A24CandidateManifest() {
  const raw = readFileSync(E2A24_CANDIDATE_PATH, "utf8");
  return {
    candidate: E2A24CandidateManifestSchema.parse(JSON.parse(raw)),
    raw,
    file_sha256: sha256(raw)
  };
}

export function evaluateE2A24Candidate(options: {
  enforce_manifest_hash?: boolean;
} = {}) {
  const baseline = readE2A4BaselineManifest();
  const previous = deriveE2A14FullCandidate(baseline);
  const candidate = deriveE2A24FullCandidate(baseline);
  const manifest = readE2A24CandidateManifest();
  const previousRoleHashes = roleHashes(previous);
  const candidateRoleHashes = roleHashes(candidate);
  const unchangedRoleHashes = Object.fromEntries(
    Object.entries(candidateRoleHashes).filter(([role]) =>
      role !== "topic_dialogue_agent"
    )
  );
  const changedUnrelatedRoles = Object.keys(unchangedRoleHashes).filter(
    (role) => candidateRoleHashes[role] !== previousRoleHashes[role]
  );
  if (changedUnrelatedRoles.length > 0) {
    throw new Error(
      `e2a24_unrelated_role_changed:${changedUnrelatedRoles.join(",")}`
    );
  }
  const exactDelta = deltaRecord(previous, candidate);
  if (JSON.stringify(exactDelta) !== JSON.stringify(
    manifest.candidate.exact_delta_from_previous_candidate
  )) {
    throw new Error("e2a24_candidate_delta_mismatch");
  }
  const configurationHash = stableHash(candidate);
  if (options.enforce_manifest_hash !== false &&
      configurationHash !== manifest.candidate.candidate_configuration_hash) {
    throw new Error("e2a24_candidate_configuration_hash_mismatch");
  }
  return {
    manifest: manifest.candidate,
    candidate_configuration_hash: configurationHash,
    candidate_file_sha256: manifest.file_sha256,
    full_candidate: candidate,
    previous_full_candidate: previous,
    exact_delta_from_previous_candidate: exactDelta,
    exact_delta_paths_from_previous_candidate: changedPaths(
      previous, candidate
    ),
    role_hashes: candidateRoleHashes,
    unchanged_role_hashes: unchangedRoleHashes,
    previous_role_hashes: previousRoleHashes,
    changed_unrelated_roles: changedUnrelatedRoles,
    approved_v2_hash: E2A4_APPROVED_V2_HASH,
    previous_candidate_hash: E2A14_CANDIDATE_HASH,
    previous_candidate_file_sha256: E2A14_CANDIDATE_FILE_SHA256,
    previous_candidate_path: E2A14_CANDIDATE_PATH,
    candidate_approved: false,
    candidate_activated: false
  };
}
