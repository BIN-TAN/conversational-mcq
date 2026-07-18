import { readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { stableHash } from "@/lib/operational/stable-hash";
import { evaluateTopicDialoguePolicyContractCompatibility } from "./e2a-readiness";

export const E2A2_TOPIC_DIALOGUE_CANDIDATE_PATH = path.join(
  process.cwd(),
  "config",
  "candidate-operational-agent-config.e2a2-topic-dialogue-contract-v1.json"
);

export const E2A2_MISMATCH_CLASSIFICATION =
  "approved candidate inconsistency" as const;

const E2A2TopicDialogueCandidateSchema = z.object({
  manifest_version: z.literal("e2a2-topic-dialogue-contract-candidate-v1"),
  approval_state: z.literal("candidate_not_approved"),
  activation_state: z.literal("not_activated"),
  baseline_approved_runtime_hash: z.string().length(64),
  baseline_candidate_manifest_path: z.string().min(1),
  baseline_candidate_manifest_sha256: z.string().length(64),
  candidate_profile_name: z.string().min(1),
  evaluation_required: z.literal(true),
  human_review_required: z.literal(true),
  student_facing_operational_use_approved: z.literal(false),
  teacher_tool_use_approved: z.literal(false),
  roles_unchanged_from_baseline: z.literal(true),
  topic_dialogue_contract: z.object({
    input_schema_version: z.literal("topic-dialogue-input-v3"),
    output_schema_version: z.literal("topic-dialogue-output-v2"),
    validator_version: z.string().min(1),
    fallback_version: z.string().min(1),
    maximum_student_turns: z.literal(10),
    student_turn_semantics: z.string().min(1),
    recent_raw_turn_window: z.number().int().min(18),
    history_semantics: z.string().min(1),
    maximum_prior_visible_history_turns: z.literal(18),
    latest_student_message_separate: z.literal(true),
    internal_context_separate: z.literal(true),
    silent_history_truncation_allowed: z.literal(false)
  }).strict(),
  exact_delta_from_baseline: z.record(z.string(), z.object({
    from: z.union([z.string(), z.number()]),
    to: z.union([z.string(), z.number()])
  }).strict()),
  acceptance_criteria: z.record(z.string(), z.literal(true))
}).strict();

export function readE2A2TopicDialogueCandidate(
  candidatePath = E2A2_TOPIC_DIALOGUE_CANDIDATE_PATH
) {
  return E2A2TopicDialogueCandidateSchema.parse(
    JSON.parse(readFileSync(candidatePath, "utf8"))
  );
}

export function evaluateE2A2TopicDialogueCandidate(
  candidate = readE2A2TopicDialogueCandidate()
) {
  const compatibility = evaluateTopicDialoguePolicyContractCompatibility({
    input_schema_version: candidate.topic_dialogue_contract.input_schema_version,
    policy: {
      maximum_student_turns:
        candidate.topic_dialogue_contract.maximum_student_turns,
      recent_raw_turn_window:
        candidate.topic_dialogue_contract.recent_raw_turn_window
    }
  });
  return {
    candidate_configuration_hash: stableHash(candidate),
    compatible: compatibility.compatible,
    compatibility,
    activated: false,
    approved: false,
    exact_delta_from_baseline: candidate.exact_delta_from_baseline
  };
}
