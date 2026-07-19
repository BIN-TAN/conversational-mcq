import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { stableHash } from "@/lib/operational/stable-hash";
import {
  TOPIC_DIALOGUE_MODE_CONTRACT_FAMILY_VERSION,
  TOPIC_DIALOGUE_MODE_FALLBACK_VERSION,
  TOPIC_DIALOGUE_MODE_INPUT_SCHEMA_VERSION,
  TOPIC_DIALOGUE_MODE_OUTPUT_SCHEMA_VERSIONS,
  TOPIC_DIALOGUE_MODE_PROMPT_FAMILY_HASH,
  TOPIC_DIALOGUE_MODE_PROMPT_FAMILY_VERSION,
  TOPIC_DIALOGUE_MODE_PROMPT_HASHES,
  TOPIC_DIALOGUE_MODE_SERVER_ENVELOPE_VERSION,
  TOPIC_DIALOGUE_MODE_VALIDATOR_VERSION,
  TopicDialogueResponseModeSchema,
  type TopicDialogueResponseMode
} from "@/lib/services/student-assessment/topic-dialogue-response-mode";
import {
  changedPaths,
  E2A4_APPROVED_V2_HASH,
  readE2A4BaselineManifest,
  sha256,
  type E2A4BaselineManifest
} from "./e2a4-topic-dialogue-contract";
import {
  E2A5_FAILED_V4_FILE_SHA256,
  E2A5_FAILED_V4_HASH,
  E2A5_PROGRESSION_AUTHORIZATION_VERSION,
  deriveE2A5FullCandidate,
  type TopicDialogueInputV4
} from "./e2a5-topic-dialogue-progression-contract";
import { TopicDialogueInputV3Schema } from
  "./e2a-topic-dialogue-contract-candidate";
import {
  E2A6_CANDIDATE_FILE_SHA256,
  E2A6_CANDIDATE_HASH,
  E2A6_FAILED_V4_EVALUATION_SHA256
} from "./e2a6-v5-topic-dialogue-evaluation";

export const E2A7_CANDIDATE_PATH = path.join(
  process.cwd(),
  "config",
  "candidate-operational-agent-config.e2a7-topic-dialogue-mode-contract-v1.json"
);
export const E2A7_RESPONSE_MODE_SELECTION_VERSION =
  "topic-dialogue-platform-mode-selection-v1" as const;
export const E2A7_CANDIDATE_HASH =
  "2ba4b434d89455da8632fa91b9cdc948567c469625fc10e33db74d4d536f7f31";
export const E2A7_CANDIDATE_FILE_SHA256 =
  "95253eec51daaa88866f5dd22d50218678ab87e7810c33a83a0ff3c1a2c29af1";

export const TopicDialogueModeInputV1Schema = TopicDialogueInputV3Schema.omit({
  dialogue_schema_version: true
}).extend({
  dialogue_schema_version: z.literal(TOPIC_DIALOGUE_MODE_INPUT_SCHEMA_VERSION),
  selected_response_mode: TopicDialogueResponseModeSchema,
  mode_context: z.object({
    communication_function: z.string().min(1).max(300),
    platform_evidence_summary: z.string().min(1).max(300)
  }).strict()
}).strict();
export type TopicDialogueModeInputV1 = z.infer<
  typeof TopicDialogueModeInputV1Schema
>;

const modeCommunicationFunctions: Record<TopicDialogueResponseMode, string> = {
  remain_in_dialogue:
    "Directly answer or clarify the latest message, retain the distractor anchor, and elicit the next needed evidence.",
  request_revision:
    "Ask for one bounded revision tied to the active distractor or conceptual distinction.",
  present_transfer:
    "Briefly transition to applying the same distinction in a new context; the platform presents the item.",
  complete_episode:
    "Acknowledge only the evidence accepted by the platform and close the bounded dialogue concisely."
};

export function buildTopicDialogueModeProviderInput(input: {
  dialogue_input: TopicDialogueInputV4;
  selected_mode?: TopicDialogueResponseMode;
}) {
  const selectedMode = input.selected_mode ??
    input.dialogue_input.progression_authorization.authorized_action;
  if (selectedMode !== input.dialogue_input.progression_authorization.authorized_action) {
    throw new Error("e2a7_selected_mode_must_equal_platform_authorization");
  }
  const {
    progression_authorization: authorization,
    dialogue_schema_version: dialogueSchemaVersion,
    ...shared
  } = input.dialogue_input;
  void dialogueSchemaVersion;
  return TopicDialogueModeInputV1Schema.parse({
    ...shared,
    dialogue_schema_version: TOPIC_DIALOGUE_MODE_INPUT_SCHEMA_VERSION,
    selected_response_mode: selectedMode,
    mode_context: {
      communication_function: modeCommunicationFunctions[selectedMode],
      platform_evidence_summary: authorization.authorization_evidence_summary
    }
  });
}

const DeltaValueSchema = z.union([z.string(), z.number(), z.boolean()]);
const DeltaSchema = z.object({
  from: DeltaValueSchema,
  to: DeltaValueSchema
}).strict();
const ModeMapSchema = z.object({
  remain_in_dialogue: z.string().min(1),
  request_revision: z.string().min(1),
  present_transfer: z.string().min(1),
  complete_episode: z.string().min(1)
}).strict();

export const E2A7CandidateManifestSchema = z.object({
  manifest_version: z.literal("e2a7-topic-dialogue-mode-contract-candidate-v1"),
  approval_state: z.literal("candidate_not_approved"),
  activation_state: z.literal("not_activated"),
  baseline_approved_runtime_hash: z.literal(E2A4_APPROVED_V2_HASH),
  failed_v5_candidate_hash: z.literal(E2A6_CANDIDATE_HASH),
  failed_v5_candidate_path: z.string().min(1),
  failed_v5_candidate_sha256: z.literal(E2A6_CANDIDATE_FILE_SHA256),
  candidate_profile_name: z.string().min(1),
  evaluation_required: z.literal(true),
  human_review_required: z.literal(true),
  student_facing_operational_use_approved: z.literal(false),
  teacher_tool_use_approved: z.literal(false),
  roles_unchanged_from_baseline: z.literal(true),
  topic_dialogue_contract: z.object({
    input_schema_version: z.literal(TOPIC_DIALOGUE_MODE_INPUT_SCHEMA_VERSION),
    contract_family_version: z.literal(TOPIC_DIALOGUE_MODE_CONTRACT_FAMILY_VERSION),
    output_schema_versions: ModeMapSchema,
    prompt_family_version: z.literal(TOPIC_DIALOGUE_MODE_PROMPT_FAMILY_VERSION),
    prompt_family_hash: z.string().length(64),
    prompt_hashes: ModeMapSchema,
    validator_version: z.literal(TOPIC_DIALOGUE_MODE_VALIDATOR_VERSION),
    progression_authorization_version: z.literal(E2A5_PROGRESSION_AUTHORIZATION_VERSION),
    response_mode_selection_version: z.literal(E2A7_RESPONSE_MODE_SELECTION_VERSION),
    server_envelope_version: z.literal(TOPIC_DIALOGUE_MODE_SERVER_ENVELOPE_VERSION),
    fallback_version: z.literal(TOPIC_DIALOGUE_MODE_FALLBACK_VERSION),
    maximum_student_turns: z.literal(10),
    recent_raw_turn_window: z.literal(18),
    provider_payload_schema_version_required: z.literal(true),
    bounded_regeneration_attempts: z.literal(1),
    provider_generates_progression_action: z.literal(false),
    platform_gate_remains_independent: z.literal(true)
  }).strict(),
  exact_delta_from_approved_v2: z.record(z.string(), DeltaSchema),
  exact_delta_from_failed_v5: z.record(z.string(), DeltaSchema),
  acceptance_criteria: z.record(z.string(), z.literal(true))
}).strict();

export function readE2A7Candidate() {
  const raw = readFileSync(E2A7_CANDIDATE_PATH, "utf8");
  const candidate = E2A7CandidateManifestSchema.parse(JSON.parse(raw));
  if (
    candidate.topic_dialogue_contract.prompt_family_hash !==
      TOPIC_DIALOGUE_MODE_PROMPT_FAMILY_HASH ||
    JSON.stringify(candidate.topic_dialogue_contract.prompt_hashes) !==
      JSON.stringify(TOPIC_DIALOGUE_MODE_PROMPT_HASHES) ||
    JSON.stringify(candidate.topic_dialogue_contract.output_schema_versions) !==
      JSON.stringify(TOPIC_DIALOGUE_MODE_OUTPUT_SCHEMA_VERSIONS)
  ) {
    throw new Error("e2a7_candidate_contract_hash_mismatch");
  }
  return {
    candidate,
    file_sha256: sha256(raw)
  };
}

export function deriveE2A7FullCandidate(
  baseline: E2A4BaselineManifest = readE2A4BaselineManifest()
) {
  const derived = structuredClone(baseline);
  derived.runtime_policy.topic_dialogue_policy.recent_raw_turn_window = 18;
  const metadata =
    derived.configuration_fingerprint.role_version_metadata.topic_dialogue_agent;
  if (!metadata) throw new Error("e2a7_topic_dialogue_role_metadata_missing");
  metadata.prompt_version = TOPIC_DIALOGUE_MODE_PROMPT_FAMILY_VERSION;
  metadata.prompt_hash = TOPIC_DIALOGUE_MODE_PROMPT_FAMILY_HASH;
  metadata.input_schema_version = TOPIC_DIALOGUE_MODE_INPUT_SCHEMA_VERSION;
  metadata.output_schema_version = TOPIC_DIALOGUE_MODE_CONTRACT_FAMILY_VERSION;
  metadata.validator_version = TOPIC_DIALOGUE_MODE_VALIDATOR_VERSION;
  metadata.progression_authorization_version = E2A5_PROGRESSION_AUTHORIZATION_VERSION;
  metadata.response_mode_selection_version = E2A7_RESPONSE_MODE_SELECTION_VERSION;
  metadata.server_envelope_version = TOPIC_DIALOGUE_MODE_SERVER_ENVELOPE_VERSION;
  metadata.fallback_version = TOPIC_DIALOGUE_MODE_FALLBACK_VERSION;
  metadata.provider_generates_progression_action = false;
  metadata.mode_output_schema_versions = TOPIC_DIALOGUE_MODE_OUTPUT_SCHEMA_VERSIONS;
  metadata.mode_prompt_hashes = TOPIC_DIALOGUE_MODE_PROMPT_HASHES;
  return derived;
}

export function evaluateE2A7Candidate() {
  const { candidate, file_sha256: fileSha256 } = readE2A7Candidate();
  const baseline = readE2A4BaselineManifest();
  const failedV5 = deriveE2A5FullCandidate(baseline);
  const fullCandidate = deriveE2A7FullCandidate(baseline);
  const roleConfigHashes = Object.fromEntries(
    Object.keys(fullCandidate.roles).sort().map((role) => [role, stableHash({
      role,
      model_config: fullCandidate.roles[role],
      version_metadata:
        fullCandidate.configuration_fingerprint.role_version_metadata[role] ?? null,
      runtime_policy: role === "topic_dialogue_agent"
        ? fullCandidate.runtime_policy.topic_dialogue_policy
        : null
    })])
  );
  const v5RoleConfigHashes = Object.fromEntries(
    Object.keys(failedV5.roles).sort().map((role) => [role, stableHash({
      role,
      model_config: failedV5.roles[role],
      version_metadata:
        failedV5.configuration_fingerprint.role_version_metadata[role] ?? null,
      runtime_policy: role === "topic_dialogue_agent"
        ? failedV5.runtime_policy.topic_dialogue_policy
        : null
    })])
  );
  const unrelatedRoleHashMismatches = Object.keys(roleConfigHashes).filter((role) =>
    role !== "topic_dialogue_agent" &&
    roleConfigHashes[role] !== v5RoleConfigHashes[role]
  );
  if (unrelatedRoleHashMismatches.length > 0) {
    throw new Error(
      `e2a7_unrelated_role_changed:${unrelatedRoleHashMismatches.join(",")}`
    );
  }
  const candidateConfigurationHash = stableHash(fullCandidate);
  if (
    candidateConfigurationHash !== E2A7_CANDIDATE_HASH ||
    fileSha256 !== E2A7_CANDIDATE_FILE_SHA256
  ) {
    throw new Error("e2a7_candidate_hash_not_reproducible");
  }
  return {
    candidate,
    candidate_configuration_hash: candidateConfigurationHash,
    candidate_file_sha256: fileSha256,
    full_candidate: fullCandidate,
    role_config_hashes: roleConfigHashes,
    inherited_role_hashes: Object.fromEntries(
      Object.entries(roleConfigHashes).filter(([role]) => role !== "topic_dialogue_agent")
    ),
    exact_delta_paths_from_approved_v2: changedPaths(baseline, fullCandidate),
    exact_delta_paths_from_failed_v5: changedPaths(failedV5, fullCandidate),
    approved_v2_hash: E2A4_APPROVED_V2_HASH,
    failed_v4_hash: E2A5_FAILED_V4_HASH,
    failed_v4_file_sha256: E2A5_FAILED_V4_FILE_SHA256,
    failed_v4_evaluation_sha256: E2A6_FAILED_V4_EVALUATION_SHA256,
    failed_v5_hash: E2A6_CANDIDATE_HASH,
    failed_v5_file_sha256: E2A6_CANDIDATE_FILE_SHA256,
    contract_hash: createHash("sha256").update(JSON.stringify({
      prompt_hashes: TOPIC_DIALOGUE_MODE_PROMPT_HASHES,
      output_schemas: TOPIC_DIALOGUE_MODE_OUTPUT_SCHEMA_VERSIONS,
      validator: TOPIC_DIALOGUE_MODE_VALIDATOR_VERSION,
      envelope: TOPIC_DIALOGUE_MODE_SERVER_ENVELOPE_VERSION
    })).digest("hex"),
    candidate_approved: false,
    candidate_activated: false
  };
}
