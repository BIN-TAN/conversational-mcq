import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { stableHash } from "@/lib/operational/stable-hash";
import {
  TOPIC_DIALOGUE_OPERATION_CONTRACT_FAMILY_VERSION,
  TOPIC_DIALOGUE_OPERATION_FALLBACK_VERSION,
  TOPIC_DIALOGUE_OPERATION_INPUT_SCHEMA_VERSION,
  TOPIC_DIALOGUE_OPERATION_OUTPUT_SCHEMA_VERSIONS,
  TOPIC_DIALOGUE_OPERATION_POSITIVE_PURPOSES,
  TOPIC_DIALOGUE_OPERATION_PROMPT_FAMILY_HASH,
  TOPIC_DIALOGUE_OPERATION_PROMPT_FAMILY_VERSION,
  TOPIC_DIALOGUE_OPERATION_PROMPT_HASHES,
  TOPIC_DIALOGUE_OPERATION_SELECTION_VERSION,
  TOPIC_DIALOGUE_OPERATION_SERVER_ENVELOPE_VERSION,
  TOPIC_DIALOGUE_OPERATION_VALIDATOR_VERSION,
  TopicDialogueOperationRoutingClassificationSchema,
  TopicDialogueOperationSchema,
  selectTopicDialogueOperation,
  type TopicDialogueOperation,
  type TopicDialogueOperationRoutingClassification
} from "@/lib/services/student-assessment/topic-dialogue-operation-contract";
import {
  TOPIC_DIALOGUE_MODE_OUTPUT_SCHEMA_VERSIONS
} from "@/lib/services/student-assessment/topic-dialogue-response-mode";
import {
  changedPaths,
  E2A4_APPROVED_V2_HASH,
  readE2A4BaselineManifest,
  sha256,
  type E2A4BaselineManifest
} from "./e2a4-topic-dialogue-contract";
import { E2A5_FAILED_V4_HASH, type TopicDialogueInputV4 } from
  "./e2a5-topic-dialogue-progression-contract";
import { E2A6_CANDIDATE_HASH } from "./e2a6-v5-topic-dialogue-evaluation";
import {
  buildTopicDialogueModeProviderInput,
  deriveE2A7FullCandidate,
  E2A7_CANDIDATE_FILE_SHA256,
  E2A7_CANDIDATE_HASH,
  E2A7_CANDIDATE_PATH,
  E2A7_RESPONSE_MODE_SELECTION_VERSION,
  TopicDialogueModeInputV1Schema
} from "./e2a7-topic-dialogue-mode-candidate";

export const E2A9_CANDIDATE_PATH = path.join(
  process.cwd(),
  "config",
  "candidate-operational-agent-config.e2a9-topic-dialogue-operation-contract-v1.json"
);
export const E2A9_CANDIDATE_HASH =
  "a7443a3d4b7386d8abfd723fd9fea35257fea46491453d3701f1ca0cee7e2254";
export const E2A9_CANDIDATE_FILE_SHA256 =
  "1c6faf3001d54010867547b9070042ce87adf83c07fc3c21b02372665dd575f1";

const operationInputBase = TopicDialogueModeInputV1Schema.omit({
  dialogue_schema_version: true,
  selected_response_mode: true,
  mode_context: true,
  available_progression_destinations: true,
  progression_options: true,
  post_activity_status: true,
  source_versions: true,
  source_profile_version: true,
  source_activity_evaluation_version: true
});

export const TopicDialogueOperationInputV1Schema = operationInputBase.extend({
  dialogue_schema_version: z.literal(
    TOPIC_DIALOGUE_OPERATION_INPUT_SCHEMA_VERSION
  ),
  selected_response_mode: z.literal("remain_in_dialogue"),
  selected_dialogue_operation: TopicDialogueOperationSchema,
  operation_context: z.object({
    routing_classification:
      TopicDialogueOperationRoutingClassificationSchema,
    positive_communication_purpose: z.string().min(1).max(500),
    current_turn_authoritative_directive: z.string().min(1).max(500),
    current_distractor_anchor: z.string().min(1).max(300),
    current_misconception_target: z.string().min(1).max(700),
    current_evidence_needed: z.string().min(1).max(700),
    strategies_already_attempted: z.array(z.string().min(1).max(120)).max(20),
    strategies_marked_unsuccessful:
      z.array(z.string().min(1).max(120)).max(20),
    historical_recommendations_authoritative: z.literal(false),
    evaluation_only_fields_removed: z.literal(true)
  }).strict()
}).strict();
export type TopicDialogueOperationInputV1 = z.infer<
  typeof TopicDialogueOperationInputV1Schema
>;

export function buildTopicDialogueOperationProviderInput(input: {
  dialogue_input: TopicDialogueInputV4;
  selected_operation: TopicDialogueOperation;
  routing_classification: TopicDialogueOperationRoutingClassification;
  distractor_anchor: string;
  misconception_target: string;
  evidence_needed: string;
  strategies_already_attempted: string[];
  strategies_marked_unsuccessful: string[];
}) {
  if (
    input.dialogue_input.progression_authorization.authorized_action !==
      "remain_in_dialogue"
  ) {
    throw new Error("e2a9_operation_input_requires_remain_authorization");
  }
  const selected = selectTopicDialogueOperation({
    selected_response_mode: "remain_in_dialogue",
    latest_response_classification: input.routing_classification
  });
  if (selected !== input.selected_operation) {
    throw new Error("e2a9_operation_must_equal_platform_selection");
  }
  const modeInput = buildTopicDialogueModeProviderInput({
    dialogue_input: input.dialogue_input,
    selected_mode: "remain_in_dialogue"
  });
  const {
    dialogue_schema_version: _dialogueSchemaVersion,
    selected_response_mode: _selectedMode,
    mode_context: _modeContext,
    available_progression_destinations: _availableProgressionDestinations,
    progression_options: _progressionOptions,
    post_activity_status: _postActivityStatus,
    source_versions: _sourceVersions,
    source_profile_version: _sourceProfileVersion,
    source_activity_evaluation_version: _sourceActivityEvaluationVersion,
    ...safeContext
  } = modeInput;
  void _dialogueSchemaVersion;
  void _selectedMode;
  void _modeContext;
  void _availableProgressionDestinations;
  void _progressionOptions;
  void _postActivityStatus;
  void _sourceVersions;
  void _sourceProfileVersion;
  void _sourceActivityEvaluationVersion;
  return TopicDialogueOperationInputV1Schema.parse({
    ...safeContext,
    dialogue_schema_version: TOPIC_DIALOGUE_OPERATION_INPUT_SCHEMA_VERSION,
    selected_response_mode: "remain_in_dialogue",
    selected_dialogue_operation: input.selected_operation,
    operation_context: {
      routing_classification: input.routing_classification,
      positive_communication_purpose:
        TOPIC_DIALOGUE_OPERATION_POSITIVE_PURPOSES[input.selected_operation],
      current_turn_authoritative_directive:
        `Perform only ${input.selected_operation}; remain in dialogue.`,
      current_distractor_anchor: input.distractor_anchor,
      current_misconception_target: input.misconception_target,
      current_evidence_needed: input.evidence_needed,
      strategies_already_attempted: input.strategies_already_attempted,
      strategies_marked_unsuccessful: input.strategies_marked_unsuccessful,
      historical_recommendations_authoritative: false,
      evaluation_only_fields_removed: true
    }
  });
}

const DeltaValueSchema = z.union([z.string(), z.number(), z.boolean()]);
const DeltaSchema = z.object({
  from: DeltaValueSchema,
  to: DeltaValueSchema
}).strict();
const operationMapShape = Object.fromEntries(
  TopicDialogueOperationSchema.options.map((operation) => [
    operation,
    z.string().min(1)
  ])
) as Record<TopicDialogueOperation, z.ZodString>;
const OperationMapSchema = z.object(operationMapShape).strict();

export const E2A9CandidateManifestSchema = z.object({
  manifest_version: z.literal(
    "e2a9-topic-dialogue-operation-contract-candidate-v1"
  ),
  approval_state: z.literal("candidate_not_approved"),
  activation_state: z.literal("not_activated"),
  baseline_approved_runtime_hash: z.literal(E2A4_APPROVED_V2_HASH),
  failed_v6_candidate_hash: z.literal(E2A7_CANDIDATE_HASH),
  failed_v6_candidate_path: z.string().min(1),
  failed_v6_candidate_sha256: z.literal(E2A7_CANDIDATE_FILE_SHA256),
  candidate_profile_name: z.string().min(1),
  evaluation_required: z.literal(true),
  human_review_required: z.literal(true),
  student_facing_operational_use_approved: z.literal(false),
  teacher_tool_use_approved: z.literal(false),
  roles_unchanged_from_baseline: z.literal(true),
  topic_dialogue_contract: z.object({
    top_level_response_mode_contract_family_version: z.string().min(1),
    retained_progression_output_schema_versions: z.object({
      request_revision: z.string().min(1),
      present_transfer: z.string().min(1),
      complete_episode: z.string().min(1)
    }).strict(),
    operation_input_schema_version: z.literal(
      TOPIC_DIALOGUE_OPERATION_INPUT_SCHEMA_VERSION
    ),
    operation_contract_family_version: z.literal(
      TOPIC_DIALOGUE_OPERATION_CONTRACT_FAMILY_VERSION
    ),
    operation_output_schema_versions: OperationMapSchema,
    operation_prompt_family_version: z.literal(
      TOPIC_DIALOGUE_OPERATION_PROMPT_FAMILY_VERSION
    ),
    operation_prompt_family_hash: z.string().length(64),
    operation_prompt_hashes: OperationMapSchema,
    operation_validator_version: z.literal(
      TOPIC_DIALOGUE_OPERATION_VALIDATOR_VERSION
    ),
    response_mode_selection_version: z.literal(
      E2A7_RESPONSE_MODE_SELECTION_VERSION
    ),
    operation_selection_version: z.literal(
      TOPIC_DIALOGUE_OPERATION_SELECTION_VERSION
    ),
    operation_server_envelope_version: z.literal(
      TOPIC_DIALOGUE_OPERATION_SERVER_ENVELOPE_VERSION
    ),
    operation_fallback_version: z.literal(
      TOPIC_DIALOGUE_OPERATION_FALLBACK_VERSION
    ),
    maximum_student_turns: z.literal(10),
    recent_raw_turn_window: z.literal(18),
    bounded_regeneration_attempts: z.literal(1),
    provider_generates_progression_action: z.literal(false),
    provider_generates_response_function: z.literal(false),
    provider_generates_dialogue_operation: z.literal(false),
    complete_visible_history_required: z.literal(true),
    evaluation_only_context_removed: z.literal(true),
    historical_recommendations_non_authoritative: z.literal(true)
  }).strict(),
  exact_delta_from_approved_v2: z.record(z.string(), DeltaSchema),
  exact_delta_from_failed_v6: z.record(z.string(), DeltaSchema),
  acceptance_criteria: z.record(z.string(), z.literal(true))
}).strict();

export function readE2A9Candidate() {
  const raw = readFileSync(E2A9_CANDIDATE_PATH, "utf8");
  const candidate = E2A9CandidateManifestSchema.parse(JSON.parse(raw));
  if (
    candidate.topic_dialogue_contract.operation_prompt_family_hash !==
      TOPIC_DIALOGUE_OPERATION_PROMPT_FAMILY_HASH ||
    JSON.stringify(
      candidate.topic_dialogue_contract.operation_prompt_hashes
    ) !== JSON.stringify(TOPIC_DIALOGUE_OPERATION_PROMPT_HASHES) ||
    JSON.stringify(
      candidate.topic_dialogue_contract.operation_output_schema_versions
    ) !== JSON.stringify(TOPIC_DIALOGUE_OPERATION_OUTPUT_SCHEMA_VERSIONS)
  ) {
    throw new Error("e2a9_candidate_contract_hash_mismatch");
  }
  return { candidate, raw, file_sha256: sha256(raw) };
}

export function deriveE2A9FullCandidate(
  baseline: E2A4BaselineManifest = readE2A4BaselineManifest()
) {
  const derived = deriveE2A7FullCandidate(baseline);
  const metadata =
    derived.configuration_fingerprint.role_version_metadata.topic_dialogue_agent;
  if (!metadata) throw new Error("e2a9_topic_dialogue_role_metadata_missing");
  metadata.prompt_version = TOPIC_DIALOGUE_OPERATION_PROMPT_FAMILY_VERSION;
  metadata.prompt_hash = TOPIC_DIALOGUE_OPERATION_PROMPT_FAMILY_HASH;
  metadata.input_schema_version = TOPIC_DIALOGUE_OPERATION_INPUT_SCHEMA_VERSION;
  metadata.output_schema_version =
    TOPIC_DIALOGUE_OPERATION_CONTRACT_FAMILY_VERSION;
  metadata.validator_version = TOPIC_DIALOGUE_OPERATION_VALIDATOR_VERSION;
  metadata.server_envelope_version =
    TOPIC_DIALOGUE_OPERATION_SERVER_ENVELOPE_VERSION;
  metadata.fallback_version = TOPIC_DIALOGUE_OPERATION_FALLBACK_VERSION;
  metadata.dialogue_operation_selection_version =
    TOPIC_DIALOGUE_OPERATION_SELECTION_VERSION;
  metadata.provider_generates_progression_action = false;
  metadata.provider_generates_response_function = false;
  metadata.provider_generates_dialogue_operation = false;
  metadata.operation_output_schema_versions =
    TOPIC_DIALOGUE_OPERATION_OUTPUT_SCHEMA_VERSIONS;
  metadata.operation_prompt_hashes = TOPIC_DIALOGUE_OPERATION_PROMPT_HASHES;
  return derived;
}

export function evaluateE2A9Candidate(options: {
  enforce_expected_hashes?: boolean;
} = {}) {
  const { candidate, file_sha256: fileSha256 } = readE2A9Candidate();
  const baseline = readE2A4BaselineManifest();
  const failedV6 = deriveE2A7FullCandidate(baseline);
  const fullCandidate = deriveE2A9FullCandidate(baseline);
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
  const v6RoleConfigHashes = Object.fromEntries(
    Object.keys(failedV6.roles).sort().map((role) => [role, stableHash({
      role,
      model_config: failedV6.roles[role],
      version_metadata:
        failedV6.configuration_fingerprint.role_version_metadata[role] ?? null,
      runtime_policy: role === "topic_dialogue_agent"
        ? failedV6.runtime_policy.topic_dialogue_policy
        : null
    })])
  );
  const unrelatedRoleHashMismatches = Object.keys(roleConfigHashes).filter(
    (role) => role !== "topic_dialogue_agent" &&
      roleConfigHashes[role] !== v6RoleConfigHashes[role]
  );
  if (unrelatedRoleHashMismatches.length > 0) {
    throw new Error(
      `e2a9_unrelated_role_changed:${unrelatedRoleHashMismatches.join(",")}`
    );
  }
  const candidateConfigurationHash = stableHash(fullCandidate);
  if (options.enforce_expected_hashes !== false && (
    candidateConfigurationHash !== E2A9_CANDIDATE_HASH ||
    fileSha256 !== E2A9_CANDIDATE_FILE_SHA256
  )) {
    throw new Error("e2a9_candidate_hash_not_reproducible");
  }
  return {
    candidate,
    candidate_configuration_hash: candidateConfigurationHash,
    candidate_file_sha256: fileSha256,
    full_candidate: fullCandidate,
    role_config_hashes: roleConfigHashes,
    inherited_role_hashes: Object.fromEntries(
      Object.entries(roleConfigHashes).filter(([role]) =>
        role !== "topic_dialogue_agent"
      )
    ),
    exact_delta_paths_from_approved_v2: changedPaths(baseline, fullCandidate),
    exact_delta_paths_from_failed_v6: changedPaths(failedV6, fullCandidate),
    approved_v2_hash: E2A4_APPROVED_V2_HASH,
    failed_v4_hash: E2A5_FAILED_V4_HASH,
    failed_v5_hash: E2A6_CANDIDATE_HASH,
    failed_v6_hash: E2A7_CANDIDATE_HASH,
    failed_v6_file_sha256: E2A7_CANDIDATE_FILE_SHA256,
    failed_v6_candidate_path: E2A7_CANDIDATE_PATH,
    contract_hash: createHash("sha256").update(JSON.stringify({
      operation_prompt_hashes: TOPIC_DIALOGUE_OPERATION_PROMPT_HASHES,
      operation_output_schemas:
        TOPIC_DIALOGUE_OPERATION_OUTPUT_SCHEMA_VERSIONS,
      retained_progression_schemas: {
        request_revision:
          TOPIC_DIALOGUE_MODE_OUTPUT_SCHEMA_VERSIONS.request_revision,
        present_transfer:
          TOPIC_DIALOGUE_MODE_OUTPUT_SCHEMA_VERSIONS.present_transfer,
        complete_episode:
          TOPIC_DIALOGUE_MODE_OUTPUT_SCHEMA_VERSIONS.complete_episode
      },
      validator: TOPIC_DIALOGUE_OPERATION_VALIDATOR_VERSION,
      envelope: TOPIC_DIALOGUE_OPERATION_SERVER_ENVELOPE_VERSION
    })).digest("hex"),
    candidate_approved: false,
    candidate_activated: false
  };
}
