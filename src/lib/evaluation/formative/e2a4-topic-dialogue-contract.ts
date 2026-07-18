import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { AgentModelConfig } from "@/lib/llm/config";
import { stableHash } from "@/lib/operational/stable-hash";
import { evaluateTopicDialoguePolicyContractCompatibility } from "./e2a-readiness";

export const E2A4_TOPIC_DIALOGUE_CANDIDATE_PATH = path.join(
  process.cwd(),
  "config",
  "candidate-operational-agent-config.e2a4-topic-dialogue-contract-v2.json"
);
export const E2A4_BASELINE_MANIFEST_PATH = path.join(
  process.cwd(),
  "config",
  "candidate-operational-agent-config.gpt-5.6-full-v2.json"
);
export const E2A4_FAILED_CANDIDATE_PATH = path.join(
  process.cwd(),
  "config",
  "candidate-operational-agent-config.e2a2-topic-dialogue-contract-v1.json"
);
export const E2A4_APPROVED_V2_HASH =
  "8e30e24a3e04a3c2506b1e23c447557fc2fe623012550de557e5240d7c689993";
export const E2A4_FAILED_V3_HASH =
  "681ab5f96c9c18dfdd9aa17f335d3594a37cd7696bee6cbfe7c2e010c6943404";
export const E2A4_FAILED_V3_FILE_SHA256 =
  "1c8ac4e1400fb68b22133a157ec856f6b2ce64a701cd50055e6a3c83d6306bde";

export type E2A4BaselineManifest = {
  manifest_version: string;
  roles: Record<string, AgentModelConfig>;
  runtime_policy: {
    provider_timeout_ms: number;
    provider_max_retries: number;
    role_live_toggles: Record<string, boolean>;
    topic_dialogue_policy: {
      maximum_student_turns: number;
      recent_raw_turn_window: number;
      maximum_student_message_characters: number;
      assessment_system_questions_allowed: boolean;
    };
  };
  configuration_fingerprint: {
    role_version_metadata: Record<string, Record<string, unknown>>;
  };
};

const DeltaValueSchema = z.union([z.string(), z.number(), z.boolean()]);
const DeltaSchema = z.object({
  from: DeltaValueSchema,
  to: DeltaValueSchema
}).strict();

export const E2A4TopicDialogueCandidateSchema = z.object({
  manifest_version: z.literal("e2a4-topic-dialogue-contract-candidate-v1"),
  approval_state: z.literal("candidate_not_approved"),
  activation_state: z.literal("not_activated"),
  baseline_approved_runtime_hash: z.literal(E2A4_APPROVED_V2_HASH),
  baseline_candidate_manifest_path: z.string().min(1),
  baseline_candidate_manifest_sha256: z.string().length(64),
  failed_candidate_hash: z.literal(E2A4_FAILED_V3_HASH),
  failed_candidate_path: z.string().min(1),
  failed_candidate_sha256: z.literal(E2A4_FAILED_V3_FILE_SHA256),
  candidate_profile_name: z.string().min(1),
  evaluation_required: z.literal(true),
  human_review_required: z.literal(true),
  student_facing_operational_use_approved: z.literal(false),
  teacher_tool_use_approved: z.literal(false),
  roles_unchanged_from_baseline: z.literal(true),
  topic_dialogue_contract: z.object({
    input_schema_version: z.literal("topic-dialogue-input-v3"),
    output_schema_version: z.literal("topic-dialogue-output-v3"),
    validator_version: z.literal("eval-topic-boundary-v3"),
    fallback_version: z.string().min(1),
    maximum_student_turns: z.literal(10),
    student_turn_semantics: z.string().min(1),
    recent_raw_turn_window: z.literal(18),
    history_semantics: z.string().min(1),
    maximum_prior_visible_history_turns: z.literal(18),
    latest_student_message_separate: z.literal(true),
    internal_context_separate: z.literal(true),
    silent_history_truncation_allowed: z.literal(false),
    provider_payload_schema_version_required: z.literal(true),
    server_runtime_adapter_version: z.literal("topic-dialogue-output-v3-runtime-adapter-v1")
  }).strict(),
  exact_delta_from_baseline: z.record(z.string(), DeltaSchema),
  exact_delta_from_failed_candidate: z.record(z.string(), DeltaSchema),
  acceptance_criteria: z.record(z.string(), z.literal(true))
}).strict();

export type E2A4TopicDialogueCandidate = z.infer<
  typeof E2A4TopicDialogueCandidateSchema
>;

export function sha256(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

export function readE2A4TopicDialogueCandidate(
  candidatePath = E2A4_TOPIC_DIALOGUE_CANDIDATE_PATH
) {
  return E2A4TopicDialogueCandidateSchema.parse(
    JSON.parse(readFileSync(candidatePath, "utf8"))
  );
}

export function readE2A4BaselineManifest() {
  return JSON.parse(
    readFileSync(E2A4_BASELINE_MANIFEST_PATH, "utf8")
  ) as E2A4BaselineManifest;
}

export function deriveE2A4FullCandidate(
  baseline = readE2A4BaselineManifest()
): E2A4BaselineManifest {
  const derived = structuredClone(baseline);
  derived.runtime_policy.topic_dialogue_policy.recent_raw_turn_window = 18;
  const metadata =
    derived.configuration_fingerprint.role_version_metadata.topic_dialogue_agent;
  if (!metadata) throw new Error("e2a4_topic_dialogue_role_metadata_missing");
  metadata.input_schema_version = "topic-dialogue-input-v3";
  metadata.output_schema_version = "topic-dialogue-output-v3";
  metadata.validator_version = "eval-topic-boundary-v3";
  return derived;
}

export function changedPaths(before: unknown, after: unknown, prefix = ""): string[] {
  if (Object.is(before, after) || JSON.stringify(before) === JSON.stringify(after)) {
    return [];
  }
  if (
    !before ||
    !after ||
    typeof before !== "object" ||
    typeof after !== "object" ||
    Array.isArray(before) ||
    Array.isArray(after)
  ) {
    return [prefix || "root"];
  }
  const beforeRecord = before as Record<string, unknown>;
  const afterRecord = after as Record<string, unknown>;
  return [...new Set([...Object.keys(beforeRecord), ...Object.keys(afterRecord)])]
    .sort()
    .flatMap((key) => changedPaths(
      beforeRecord[key],
      afterRecord[key],
      prefix ? `${prefix}.${key}` : key
    ));
}

export function evaluateE2A4TopicDialogueCandidate(
  candidate = readE2A4TopicDialogueCandidate()
) {
  const baselineText = readFileSync(E2A4_BASELINE_MANIFEST_PATH, "utf8");
  const failedCandidateText = readFileSync(E2A4_FAILED_CANDIDATE_PATH, "utf8");
  const baseline = JSON.parse(baselineText) as E2A4BaselineManifest;
  const derived = deriveE2A4FullCandidate(baseline);
  const compatibility = evaluateTopicDialoguePolicyContractCompatibility({
    input_schema_version: candidate.topic_dialogue_contract.input_schema_version,
    policy: {
      maximum_student_turns: candidate.topic_dialogue_contract.maximum_student_turns,
      recent_raw_turn_window: candidate.topic_dialogue_contract.recent_raw_turn_window
    }
  });
  const roleConfigHashes = Object.fromEntries(
    Object.keys(derived.roles).sort().map((role) => [role, stableHash({
      role,
      model_config: derived.roles[role],
      version_metadata:
        derived.configuration_fingerprint.role_version_metadata[role] ?? null,
      runtime_policy: role === "topic_dialogue_agent"
        ? derived.runtime_policy.topic_dialogue_policy
        : null
    })])
  );
  return {
    candidate_configuration_hash: stableHash(candidate),
    candidate_file_sha256: sha256(
      readFileSync(E2A4_TOPIC_DIALOGUE_CANDIDATE_PATH)
    ),
    baseline_manifest_sha256: sha256(baselineText),
    failed_candidate_file_sha256: sha256(failedCandidateText),
    compatible: compatibility.compatible,
    compatibility,
    approved: false,
    activated: false,
    exact_delta_paths_from_baseline: changedPaths(baseline, derived),
    exact_delta_from_baseline: candidate.exact_delta_from_baseline,
    exact_delta_from_failed_candidate: candidate.exact_delta_from_failed_candidate,
    full_candidate: derived,
    role_config_hashes: roleConfigHashes
  };
}
