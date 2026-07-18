import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import {
  classifyTopicDialogueStudentMessage,
  evaluateTopicDialogueReadinessGate,
  TOPIC_DIALOGUE_INPUT_SCHEMA_VERSION_V2,
  TOPIC_DIALOGUE_MAX_STUDENT_TURNS_DEFAULT,
  TOPIC_DIALOGUE_PROMPT_INSTRUCTIONS,
  TOPIC_DIALOGUE_RECENT_TURN_WINDOW_DEFAULT,
  TopicDialogueInputV1Schema,
  type TopicDialogueInputV1
} from "@/lib/services/student-assessment/topic-dialogue-agent";
import {
  TopicDialogueOutputV3Schema,
  validateTopicDialogueOutputV3,
  type TopicDialogueOutputV3
} from "@/lib/services/student-assessment/topic-dialogue-output-v3";
import { stableHash } from "@/lib/operational/stable-hash";
import {
  TopicDialogueInputV3Schema,
  type TopicDialogueInputV3
} from "./e2a-topic-dialogue-contract-candidate";
import {
  changedPaths,
  E2A4_APPROVED_V2_HASH,
  E2A4_BASELINE_MANIFEST_PATH,
  E2A4_TOPIC_DIALOGUE_CANDIDATE_PATH,
  readE2A4BaselineManifest,
  sha256,
  type E2A4BaselineManifest
} from "./e2a4-topic-dialogue-contract";

export const E2A5_TOPIC_DIALOGUE_INPUT_SCHEMA_VERSION =
  "topic-dialogue-input-v4" as const;
export const E2A5_TOPIC_DIALOGUE_PROMPT_VERSION =
  "topic-dialogue-v2-progression-authorized" as const;
export const E2A5_TOPIC_DIALOGUE_VALIDATOR_VERSION =
  "eval-topic-boundary-v4" as const;
export const E2A5_PROGRESSION_AUTHORIZATION_VERSION =
  "topic-dialogue-progression-authorization-v1" as const;
export const E2A5_FAILED_V4_HASH =
  "34323b51adef1839b42be2f93b50874f6c649d2cb31e7f2434fbda132532fbab";
export const E2A5_FAILED_V4_FILE_SHA256 =
  "8178b5a0262c02a60c1e8cd7b436ad2c95013a1be446a625543b22c168806e18";
export const E2A5_CANDIDATE_PATH = path.join(
  process.cwd(),
  "config",
  "candidate-operational-agent-config.e2a5-topic-dialogue-progression-v1.json"
);

export const TopicDialogueAuthorizedActionSchema = z.enum([
  "remain_in_dialogue",
  "request_revision",
  "present_transfer",
  "complete_episode"
]);
export type TopicDialogueAuthorizedAction = z.infer<
  typeof TopicDialogueAuthorizedActionSchema
>;

export const TopicDialogueProgressionAuthorizationV1Schema = z.object({
  authorization_version: z.literal(E2A5_PROGRESSION_AUTHORIZATION_VERSION),
  revision_authorized: z.boolean(),
  transfer_authorized: z.boolean(),
  completion_authorized: z.boolean(),
  authorized_action: TopicDialogueAuthorizedActionSchema,
  authorization_evidence_summary: z.string().min(1).max(300)
}).strict();
export type TopicDialogueProgressionAuthorizationV1 = z.infer<
  typeof TopicDialogueProgressionAuthorizationV1Schema
>;

export const TopicDialogueInputV4Schema = TopicDialogueInputV3Schema.omit({
  dialogue_schema_version: true
}).extend({
  dialogue_schema_version: z.literal(E2A5_TOPIC_DIALOGUE_INPUT_SCHEMA_VERSION),
  progression_authorization: TopicDialogueProgressionAuthorizationV1Schema
}).strict();
export type TopicDialogueInputV4 = z.infer<typeof TopicDialogueInputV4Schema>;

export const E2A5_TOPIC_DIALOGUE_PROMPT_INSTRUCTIONS = `${TOPIC_DIALOGUE_PROMPT_INSTRUCTIONS.trim()}

Platform authorization contract:
1. Treat progression_authorization as server-owned fact. Never broaden it.
2. When authorized_action is remain_in_dialogue, directly address the latest student message, retain the current distractor anchor, ask for appropriate next evidence, and use await_topic_dialogue_response. Do not claim readiness, resolution, transfer, or completion.
3. When authorized_action is request_revision, revision language is permitted; transfer and completion language remain prohibited.
4. When authorized_action is present_transfer, transfer language is permitted; completion language remains prohibited.
5. When authorized_action is complete_episode, completion language is permitted only because the platform explicitly authorized it.
6. A conceptual question must be answered directly. Continued confusion must receive a genuinely different bounded explanation or question, not progression language.
7. Return the topic-dialogue-output-v3 object. The platform validates authorization again before anything is shown or persisted.`;

export const E2A5_TOPIC_DIALOGUE_PROMPT_HASH = createHash("sha256")
  .update(E2A5_TOPIC_DIALOGUE_PROMPT_INSTRUCTIONS)
  .digest("hex");

const ACTION_OUTPUTS: Record<TopicDialogueAuthorizedAction, Set<TopicDialogueOutputV3["next_action"]>> = {
  remain_in_dialogue: new Set(["await_topic_dialogue_response"]),
  request_revision: new Set(["show_progression_choices"]),
  present_transfer: new Set(["continue_to_transfer"]),
  complete_episode: new Set(["end_assessment"])
};

const RESPONSE_FUNCTIONS_BY_STUDENT_MESSAGE: Record<
  NonNullable<TopicDialogueOutputV3["student_message_function"]>,
  Set<TopicDialogueOutputV3["response_function"]>
> = {
  substantive_answer: new Set([
    "focused_question",
    "misconception_contrast",
    "foundational_scaffold",
    "worked_example",
    "readiness_confirmation"
  ]),
  conceptual_question: new Set([
    "answer_student_question",
    "focused_question",
    "misconception_contrast",
    "foundational_scaffold",
    "worked_example"
  ]),
  clarification_request: new Set(["clarification"]),
  prompt_instruction_question: new Set(["clarification"]),
  assessment_system_question: new Set(["answer_student_question", "clarification"]),
  request_for_example: new Set(["worked_example", "foundational_scaffold"]),
  request_for_alternative_explanation: new Set([
    "worked_example",
    "foundational_scaffold",
    "misconception_contrast"
  ]),
  off_topic: new Set(["topic_redirect"]),
  unclear_but_valid: new Set(["clarification", "focused_question"])
};

export type E2A5ProgressionLanguageFinding = {
  level: "student_facing_progression_offer";
  rule_code:
    | "unauthorized_readiness_claim"
    | "unauthorized_resolution_claim"
    | "unauthorized_transfer_claim"
    | "unauthorized_completion_claim"
    | "unavailable_control_instruction";
  pattern_label: string;
};

export function detectUnauthorizedProgressionLanguage(
  message: string,
  authorization: TopicDialogueProgressionAuthorizationV1
): E2A5ProgressionLanguageFinding[] {
  const findings: E2A5ProgressionLanguageFinding[] = [];
  const push = (
    ruleCode: E2A5ProgressionLanguageFinding["rule_code"],
    patternLabel: string
  ) => findings.push({
    level: "student_facing_progression_offer",
    rule_code: ruleCode,
    pattern_label: patternLabel
  });
  if (
    authorization.authorized_action === "remain_in_dialogue" &&
    /\b(?:you(?:['’]re| are)|this (?:means|shows) you are)\s+ready\s+to\s+(?:continue|move on|revise|transfer)\b/iu.test(message)
  ) {
    push("unauthorized_readiness_claim", "student_declared_ready_to_progress");
  }
  if (
    authorization.authorized_action === "remain_in_dialogue" &&
    /\b(?:the\s+)?(?:misconception|issue|confusion)\s+(?:is|has been)\s+(?:resolved|cleared|finished)\b/iu.test(message)
  ) {
    push("unauthorized_resolution_claim", "issue_declared_resolved");
  }
  if (
    !authorization.transfer_authorized &&
    /\b(?:you\s+can|let(?:'s| us)|now)\s+(?:continue\s+to|start|move\s+to)\s+(?:the\s+)?transfer\b/iu.test(message)
  ) {
    push("unauthorized_transfer_claim", "transfer_presented_as_available");
  }
  if (
    !authorization.completion_authorized &&
    /\b(?:the\s+activity\s+is\s+complete|you(?:['’]re| are)\s+finished|assessment\s+is\s+complete)\b/iu.test(message)
  ) {
    push("unauthorized_completion_claim", "episode_declared_complete");
  }
  if (
    authorization.authorized_action === "remain_in_dialogue" &&
    /\b(?:click|select|choose|press)\s+(?:continue|transfer|complete|finish)\b/iu.test(message)
  ) {
    push("unavailable_control_instruction", "unavailable_progression_control");
  }
  return findings;
}

export type E2A5CandidateValidationIssue = {
  field_path: string;
  rule_code:
    | "v3_output_invalid"
    | "recommendation_exceeds_authorization"
    | "student_message_function_mismatch"
    | "direct_response_function_mismatch"
    | "student_facing_progression_language"
    | "distractor_anchor_lost"
    | "unsupported_understanding_treated_as_mastery"
    | "continued_confusion_answered_with_progression";
  taxonomy_level:
    | "internal_recommendation"
    | "student_facing_progression_offer"
    | "platform_authorization";
  safe_detail: string;
};

const ANCHOR_TERMS = /\b(?:reliab\w*|valid\w*|consisten\w*|interpret\w*|item\s*2|option\s*a|coefficient)\b/iu;

export function validateTopicDialogueOutputForE2A5(input: {
  output: unknown;
  dialogue_input: TopicDialogueInputV4;
}) {
  const base = validateTopicDialogueOutputV3(input.output);
  if (!base.valid) {
    return {
      valid: false as const,
      regeneration_required: true,
      maximum_regeneration_attempts: 1 as const,
      issues: base.issues.map((issue): E2A5CandidateValidationIssue => ({
        field_path: issue.field_path,
        rule_code: "v3_output_invalid",
        taxonomy_level: "internal_recommendation",
        safe_detail: issue.rule_code
      }))
    };
  }

  const output = base.provider_output;
  const authorization = input.dialogue_input.progression_authorization;
  const issues: E2A5CandidateValidationIssue[] = [];
  if (!ACTION_OUTPUTS[authorization.authorized_action].has(output.next_action)) {
    issues.push({
      field_path: "next_action",
      rule_code: "recommendation_exceeds_authorization",
      taxonomy_level: "internal_recommendation",
      safe_detail: `authorized=${authorization.authorized_action};recommended=${output.next_action}`
    });
  }

  const classified = classifyTopicDialogueStudentMessage(
    input.dialogue_input.latest_student_message
  );
  if (output.student_message_function !== classified.student_message_function) {
    issues.push({
      field_path: "student_message_function",
      rule_code: "student_message_function_mismatch",
      taxonomy_level: "platform_authorization",
      safe_detail: `expected=${classified.student_message_function};received=${output.student_message_function}`
    });
  }
  if (!RESPONSE_FUNCTIONS_BY_STUDENT_MESSAGE[classified.student_message_function].has(
    output.response_function
  )) {
    issues.push({
      field_path: "response_function",
      rule_code: "direct_response_function_mismatch",
      taxonomy_level: "platform_authorization",
      safe_detail: `latest=${classified.student_message_function};received=${output.response_function}`
    });
  }

  for (const finding of detectUnauthorizedProgressionLanguage(
    output.tutor_message,
    authorization
  )) {
    issues.push({
      field_path: "tutor_message",
      rule_code: "student_facing_progression_language",
      taxonomy_level: finding.level,
      safe_detail: finding.pattern_label
    });
  }

  if (!ANCHOR_TERMS.test(`${output.tutor_message} ${output.student_safe_summary}`)) {
    issues.push({
      field_path: "tutor_message",
      rule_code: "distractor_anchor_lost",
      taxonomy_level: "platform_authorization",
      safe_detail: "current_distractor_anchor_not_present"
    });
  }

  const gate = evaluateTopicDialogueReadinessGate(
    topicDialogueInputV3ToReadinessGateV2(
      topicDialogueInputV4ToV3(input.dialogue_input)
    )
  );
  if (
    gate.unsupported_understanding_claim &&
    (output.progression_readiness === "ready" || output.next_action !== "await_topic_dialogue_response")
  ) {
    issues.push({
      field_path: "progression_readiness",
      rule_code: "unsupported_understanding_treated_as_mastery",
      taxonomy_level: "platform_authorization",
      safe_detail: "unsupported_understanding_requires_more_evidence"
    });
  }
  if (gate.continued_confusion_present && output.next_action !== "await_topic_dialogue_response") {
    issues.push({
      field_path: "next_action",
      rule_code: "continued_confusion_answered_with_progression",
      taxonomy_level: "platform_authorization",
      safe_detail: "continued_confusion_requires_direct_help"
    });
  }

  return {
    valid: issues.length === 0,
    regeneration_required: issues.length > 0,
    maximum_regeneration_attempts: 1 as const,
    issues,
    output
  };
}

export function buildE2A5ProgressionAuthorization(input: {
  dialogue_input: TopicDialogueInputV3;
  requested_authorized_action?: TopicDialogueAuthorizedAction;
}): TopicDialogueProgressionAuthorizationV1 {
  const gate = evaluateTopicDialogueReadinessGate(
    topicDialogueInputV3ToReadinessGateV2(input.dialogue_input)
  );
  const requested = input.requested_authorized_action ?? "remain_in_dialogue";
  const authorizedAction = gate.ready ? requested : "remain_in_dialogue";
  return TopicDialogueProgressionAuthorizationV1Schema.parse({
    authorization_version: E2A5_PROGRESSION_AUTHORIZATION_VERSION,
    revision_authorized: authorizedAction === "request_revision",
    transfer_authorized: authorizedAction === "present_transfer",
    completion_authorized: authorizedAction === "complete_episode",
    authorized_action: authorizedAction,
    authorization_evidence_summary: gate.ready
      ? `Platform readiness gate authorized ${authorizedAction}.`
      : `Platform readiness gate requires continued dialogue: ${gate.reason_code}.`
  });
}

export function topicDialogueInputV4ToV3(
  input: TopicDialogueInputV4
): TopicDialogueInputV3 {
  const {
    progression_authorization: progressionAuthorization,
    ...shared
  } = input;
  void progressionAuthorization;
  return TopicDialogueInputV3Schema.parse({
    ...shared,
    dialogue_schema_version: "topic-dialogue-input-v3"
  });
}

// The approved readiness gate reads only current evidence fields. This adapter
// supplies its legacy V2 container without changing the V3 provider history.
export function topicDialogueInputV3ToReadinessGateV2(
  input: TopicDialogueInputV3
): TopicDialogueInputV1 {
  const {
    visible_dialogue_history: visibleHistory,
    latest_student_turn_id: latestStudentTurnId,
    ...shared
  } = input;
  void latestStudentTurnId;
  return TopicDialogueInputV1Schema.parse({
    ...shared,
    dialogue_schema_version: TOPIC_DIALOGUE_INPUT_SCHEMA_VERSION_V2,
    recent_relevant_dialogue_turns: visibleHistory
      .slice(-TOPIC_DIALOGUE_RECENT_TURN_WINDOW_DEFAULT)
      .map((turn) => ({
      turn_number: turn.dialogue_turn_number,
      actor_type: turn.actor_type,
      message_summary: turn.message_text.slice(0, 700)
    })),
    maximum_dialogue_turns: Math.min(
      input.maximum_dialogue_turns,
      TOPIC_DIALOGUE_MAX_STUDENT_TURNS_DEFAULT
    ),
    dialogue_summary: visibleHistory
      .map((turn) => `${turn.actor_type}: ${turn.message_text.slice(0, 160)}`)
      .join(" | ")
      .slice(0, 1000) || "This is the first visible turn in the bounded dialogue."
  });
}

export function toTopicDialogueInputV4(input: {
  dialogue_input: TopicDialogueInputV3;
  requested_authorized_action?: TopicDialogueAuthorizedAction;
}) {
  return TopicDialogueInputV4Schema.parse({
    ...input.dialogue_input,
    dialogue_schema_version: E2A5_TOPIC_DIALOGUE_INPUT_SCHEMA_VERSION,
    progression_authorization: buildE2A5ProgressionAuthorization(input)
  });
}

const CandidateDeltaSchema = z.object({
  from: z.union([z.string(), z.number(), z.boolean()]),
  to: z.union([z.string(), z.number(), z.boolean()])
}).strict();

export const E2A5CandidateManifestSchema = z.object({
  manifest_version: z.literal("e2a5-topic-dialogue-progression-candidate-v1"),
  approval_state: z.literal("candidate_not_approved"),
  activation_state: z.literal("not_activated"),
  baseline_approved_runtime_hash: z.literal(E2A4_APPROVED_V2_HASH),
  failed_v4_candidate_hash: z.literal(E2A5_FAILED_V4_HASH),
  failed_v4_candidate_path: z.string().min(1),
  failed_v4_candidate_sha256: z.literal(E2A5_FAILED_V4_FILE_SHA256),
  candidate_profile_name: z.string().min(1),
  evaluation_required: z.literal(true),
  human_review_required: z.literal(true),
  student_facing_operational_use_approved: z.literal(false),
  teacher_tool_use_approved: z.literal(false),
  roles_unchanged_from_baseline: z.literal(true),
  topic_dialogue_contract: z.object({
    input_schema_version: z.literal(E2A5_TOPIC_DIALOGUE_INPUT_SCHEMA_VERSION),
    output_schema_version: z.literal("topic-dialogue-output-v3"),
    prompt_version: z.literal(E2A5_TOPIC_DIALOGUE_PROMPT_VERSION),
    prompt_hash: z.string().length(64),
    validator_version: z.literal(E2A5_TOPIC_DIALOGUE_VALIDATOR_VERSION),
    progression_authorization_version: z.literal(E2A5_PROGRESSION_AUTHORIZATION_VERSION),
    fallback_version: z.string().min(1),
    maximum_student_turns: z.literal(10),
    recent_raw_turn_window: z.literal(18),
    provider_payload_schema_version_required: z.literal(true),
    bounded_regeneration_attempts: z.literal(1)
  }).strict(),
  exact_delta_from_approved_v2: z.record(z.string(), CandidateDeltaSchema),
  exact_delta_from_failed_v4: z.record(z.string(), CandidateDeltaSchema),
  acceptance_criteria: z.record(z.string(), z.literal(true))
}).strict();
export type E2A5CandidateManifest = z.infer<typeof E2A5CandidateManifestSchema>;

export function readE2A5Candidate() {
  const candidate = E2A5CandidateManifestSchema.parse(
    JSON.parse(readFileSync(E2A5_CANDIDATE_PATH, "utf8"))
  );
  if (candidate.topic_dialogue_contract.prompt_hash !== E2A5_TOPIC_DIALOGUE_PROMPT_HASH) {
    throw new Error("e2a5_candidate_prompt_hash_mismatch");
  }
  return candidate;
}

export function deriveE2A5FullCandidate(
  baseline: E2A4BaselineManifest = readE2A4BaselineManifest()
) {
  const derived = structuredClone(baseline);
  derived.runtime_policy.topic_dialogue_policy.recent_raw_turn_window = 18;
  const metadata = derived.configuration_fingerprint.role_version_metadata.topic_dialogue_agent;
  if (!metadata) throw new Error("e2a5_topic_dialogue_role_metadata_missing");
  metadata.prompt_version = E2A5_TOPIC_DIALOGUE_PROMPT_VERSION;
  metadata.prompt_hash = E2A5_TOPIC_DIALOGUE_PROMPT_HASH;
  metadata.input_schema_version = E2A5_TOPIC_DIALOGUE_INPUT_SCHEMA_VERSION;
  metadata.output_schema_version = "topic-dialogue-output-v3";
  metadata.validator_version = E2A5_TOPIC_DIALOGUE_VALIDATOR_VERSION;
  metadata.progression_authorization_version = E2A5_PROGRESSION_AUTHORIZATION_VERSION;
  return derived;
}

export function evaluateE2A5Candidate(candidate = readE2A5Candidate()) {
  const baseline = readE2A4BaselineManifest();
  const v4Full = (() => {
    const value = structuredClone(baseline);
    value.runtime_policy.topic_dialogue_policy.recent_raw_turn_window = 18;
    const metadata = value.configuration_fingerprint.role_version_metadata.topic_dialogue_agent!;
    metadata.input_schema_version = "topic-dialogue-input-v3";
    metadata.output_schema_version = "topic-dialogue-output-v3";
    metadata.validator_version = "eval-topic-boundary-v3";
    return value;
  })();
  const fullCandidate = deriveE2A5FullCandidate(baseline);
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
  return {
    candidate_configuration_hash: stableHash(candidate),
    candidate_file_sha256: sha256(readFileSync(E2A5_CANDIDATE_PATH)),
    approved_v2_hash: E2A4_APPROVED_V2_HASH,
    failed_v4_hash: E2A5_FAILED_V4_HASH,
    failed_v4_file_sha256: sha256(readFileSync(E2A4_TOPIC_DIALOGUE_CANDIDATE_PATH)),
    baseline_manifest_sha256: sha256(readFileSync(E2A4_BASELINE_MANIFEST_PATH)),
    exact_delta_paths_from_approved_v2: changedPaths(baseline, fullCandidate),
    exact_delta_paths_from_failed_v4: changedPaths(v4Full, fullCandidate),
    exact_delta_from_approved_v2: candidate.exact_delta_from_approved_v2,
    exact_delta_from_failed_v4: candidate.exact_delta_from_failed_v4,
    full_candidate: fullCandidate,
    role_config_hashes: roleConfigHashes,
    approved: false,
    activated: false
  };
}

export function parseTopicDialogueOutputV3(value: unknown) {
  return TopicDialogueOutputV3Schema.parse(value);
}
