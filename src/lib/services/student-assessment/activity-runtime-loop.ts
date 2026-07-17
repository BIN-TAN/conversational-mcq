import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { Prisma, type ActivityRuntimeAttempt } from "@prisma/client";
import { z } from "zod";
import { redactForAudit } from "@/lib/agents/redaction";
import { prisma } from "@/lib/db";
import { toPrismaJson } from "@/lib/services/json";
import {
  type ActivityMisconceptionEvidenceLiveExecutionResult,
  executeLiveActivityMisconceptionEvidenceEvaluator,
  type ActivityMisconceptionEvidenceLiveEvaluationInput,
  type ActivityMisconceptionEvidenceProviderAudit
} from "@/lib/services/student-assessment/activity-misconception-evidence-live";
import {
  type ActivityMisconceptionEvidencePacketV1,
  type ActivityResponseKind,
  type DiagnosticPurpose,
  validateActivityMisconceptionEvidencePacket
} from "@/lib/services/student-assessment/activity-misconception-evidence";
import {
  persistActivityMisconceptionEvidenceUpdate,
  type ActivityMisconceptionEvidencePersistenceGuardResult
} from "@/lib/services/student-assessment/activity-misconception-update";
import {
  FORMATIVE_ACTIVITY_AGENT_NAME,
  FormativeActivityFamilySchema,
  assertFormativeActivityPacketIsNotReviewOnlyForRuntime,
  type FormativeActivityFamily,
  type FormativeActivityPacketV1
} from "@/lib/services/student-assessment/formative-activity-design";
import type { FormativeValue } from "@/lib/services/student-assessment/formative-value-determination";
import type { AuthoritativeFormativeTurnContext } from "@/lib/services/student-assessment/assessment-interpretation-context";

export const ACTIVITY_RUNTIME_LOOP_VERSION = "activity-runtime-loop-v1" as const;
export const ACTIVITY_RUNTIME_REVIEW_ARTIFACT_VERSION =
  "activity-runtime-loop-review-v1" as const;

export const ActivityRuntimeStateSchema = z.enum([
  "activity_ready",
  "activity_first_turn_generated",
  "awaiting_student_activity_response",
  "student_activity_response_received",
  "evidence_evaluation_pending",
  "evidence_evaluated",
  "evidence_persisted",
  "post_activity_snapshot_created",
  "continue_recommended",
  "choose_alternative_recommended",
  "move_on_recommended",
  "failed_closed"
]);

export const StudentActivityChoiceStateSchema = z.enum([
  "continue",
  "choose_another_activity",
  "move_on"
]);

export const ActivityRuntimeRecommendationSchema = z.enum([
  "continue_conceptual_entry_grounding",
  "continue_distractor_misconception_probe",
  "continue_reasoning_boundary_repair",
  "continue_independent_verification",
  "optional_extension_or_move_on",
  "retry_or_choose_or_move_on",
  "choose_alternative_activity",
  "move_on",
  "failed_closed"
]);

export type ActivityRuntimeState = z.infer<typeof ActivityRuntimeStateSchema>;
export type StudentActivityChoiceState = z.infer<typeof StudentActivityChoiceStateSchema>;
export type ActivityRuntimeRecommendation = z.infer<typeof ActivityRuntimeRecommendationSchema>;

type PrismaClientLike = typeof prisma;
type PrismaWriteClientLike = typeof prisma | Prisma.TransactionClient;

type SourceActivityPacketRef = {
  runtime_loop_version: typeof ACTIVITY_RUNTIME_LOOP_VERSION;
  schema_version: string;
  activity_packet_hash: string;
  activity_family: FormativeActivityFamily;
  diagnostic_purpose: DiagnosticPurpose;
  selected_formative_value: FormativeValue;
  generation_source: FormativeActivityPacketV1["generation_source"] | "evidence_integrated_router";
  runtime_servable_to_student: boolean;
  review_only: boolean;
  safe_activity_prompt: string;
  first_turn_message_hash: string;
  expected_student_action_prompt: string;
  expected_student_action_prompt_hash: string;
  distractor_role: string;
  distractor_student_safe_description: string;
  source_profile_integration_snapshot_id: string;
  source_formative_value_packet_id: string;
  source_activity_agent_name: typeof FORMATIVE_ACTIVITY_AGENT_NAME;
  next_interaction_schema_version?: string;
  routing_policy_version?: string;
  activity_type?: string;
  routing_justification?: string;
  target_item_index?: number | null;
  target_item_id?: string | null;
  target_option_label?: string | null;
  target_construct_or_boundary?: string | null;
  student_task_prompt?: string;
  expected_response_mode?: "short_text" | "free_text";
  rationale_for_selection?: string;
  semantic_deduplication_key?: string;
  replaced_activity_attempt_public_id?: string | null;
  activity_switch_reason?: string | null;
};

const SourceActivityPacketRefSchema: z.ZodType<SourceActivityPacketRef> = z.object({
  runtime_loop_version: z.literal(ACTIVITY_RUNTIME_LOOP_VERSION),
  schema_version: z.string().min(1),
  activity_packet_hash: z.string().min(16),
  activity_family: FormativeActivityFamilySchema,
  diagnostic_purpose: z.enum([
    "conceptual_entry_grounding",
    "distractor_misconception_probe",
    "reasoning_boundary_repair",
    "independent_misconception_verification"
  ]),
  selected_formative_value: z.enum([
    "diagnostic_clarification",
    "reasoning_refinement",
    "confidence_calibration",
    "independent_understanding_verification",
    "consolidation_and_transfer"
  ]),
  generation_source: z.enum(["deterministic_review", "live_llm", "evidence_integrated_router"]),
  runtime_servable_to_student: z.boolean(),
  review_only: z.boolean(),
  safe_activity_prompt: z.string().min(1).max(2600),
  first_turn_message_hash: z.string().min(16),
  expected_student_action_prompt: z.string().min(1).max(420),
  expected_student_action_prompt_hash: z.string().min(16),
  distractor_role: z.string().min(1).max(120),
  distractor_student_safe_description: z.string().min(1).max(520),
  source_profile_integration_snapshot_id: z.string().min(1),
  source_formative_value_packet_id: z.string().min(1),
  source_activity_agent_name: z.literal(FORMATIVE_ACTIVITY_AGENT_NAME),
  next_interaction_schema_version: z.string().optional(),
  routing_policy_version: z.string().optional(),
  activity_type: z.string().optional(),
  routing_justification: z.string().optional(),
  target_item_index: z.number().int().positive().nullable().optional(),
  target_item_id: z.string().min(1).nullable().optional(),
  target_option_label: z.string().min(1).max(8).nullable().optional(),
  target_construct_or_boundary: z.string().min(1).nullable().optional(),
  student_task_prompt: z.string().min(1).optional(),
  expected_response_mode: z.enum(["short_text", "free_text"]).optional(),
  rationale_for_selection: z.string().min(1).optional(),
  semantic_deduplication_key: z.string().min(1).optional(),
  replaced_activity_attempt_public_id: z.string().min(1).nullable().optional(),
  activity_switch_reason: z.string().min(1).max(260).nullable().optional()
}).strict();

export type CreateActivityRuntimeAttemptInput = {
  activity_packet: FormativeActivityPacketV1;
  activity_attempt_public_id?: string;
  first_turn_agent_call_db_id: string;
  reviewer_agent_call_db_id?: string | null;
  repair_agent_call_db_id?: string | null;
  limitations?: string[];
};

export type CreateEvidenceIntegratedActivityRuntimeAttemptInput = {
  session_public_id: string;
  student_public_id: string;
  assessment_public_id: string;
  concept_unit_id: string;
  activity_attempt_public_id?: string;
  activity_family: "distractor_focused_activity" | "foundational_support_activity" | "diagnostic_clarification";
  diagnostic_purpose: DiagnosticPurpose;
  selected_formative_value: FormativeValue;
  safe_activity_prompt: string;
  expected_student_action_prompt: string;
  distractor_role: string;
  distractor_student_safe_description: string;
  source_profile_integration_snapshot_id: string;
  source_formative_value_packet_id: string;
  next_interaction_schema_version: string;
  routing_policy_version: string;
  activity_type: string;
  routing_justification: string;
  target_item_index?: number | null;
  target_item_id?: string | null;
  target_option_label?: string | null;
  target_construct_or_boundary?: string | null;
  student_task_prompt?: string;
  expected_response_mode?: "short_text" | "free_text";
  rationale_for_selection?: string;
  semantic_deduplication_key?: string;
  replaced_activity_attempt_public_id?: string | null;
  activity_switch_reason?: string | null;
  limitations?: string[];
};

export type SubmitStudentActivityResponseForEvidenceUpdateInput = {
  activity_attempt_public_id: string;
  session_public_id: string;
  student_response_text: string;
  student_choice_state: StudentActivityChoiceState;
  selected_alternative_activity_family?: FormativeActivityFamily | null;
  process_context_summary?: Record<string, unknown> | null;
  pre_activity_diagnostic_state?: string | null;
  formative_turn_context?: AuthoritativeFormativeTurnContext;
  allow_additional_turn?: boolean;
  attempt_already_claimed?: boolean;
  defer_final_attempt_activation?: boolean;
  evaluator_override?: (
    input: ActivityMisconceptionEvidenceLiveEvaluationInput
  ) => Promise<ActivityMisconceptionEvidenceLiveExecutionResult>;
};

export type ActivityRuntimeLoopResult = {
  status: "ok" | "failed_closed";
  activity_attempt_public_id: string;
  evidence_record_public_id: string | null;
  post_activity_snapshot_public_id: string | null;
  student_safe_feedback: {
    message: string;
    next_options: Array<"continue" | "choose another activity" | "skip this activity and continue">;
  };
  next_runtime_recommendation: ActivityRuntimeRecommendation;
  runtime_state: ActivityRuntimeState;
  limitations: string[];
};

function prismaJson(value: unknown) {
  return toPrismaJson(value) ?? Prisma.JsonNull;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableJson(entryValue)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

function hashValue(value: unknown) {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function publicId(prefix: string) {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

function diagnosticPurposeForActivityFamily(family: FormativeActivityFamily): DiagnosticPurpose {
  switch (family) {
    case "basic_concept_grounding":
      return "conceptual_entry_grounding";
    case "distractor_contrast":
      return "distractor_misconception_probe";
    case "reasoning_chain_repair":
      return "reasoning_boundary_repair";
    case "independent_reconstruction":
    case "confidence_evidence_audit":
    case "transfer_and_distractor_generation":
      return "independent_misconception_verification";
  }
}

function sourceActivityPacketRef(packet: FormativeActivityPacketV1): SourceActivityPacketRef {
  return {
    runtime_loop_version: ACTIVITY_RUNTIME_LOOP_VERSION,
    schema_version: packet.schema_version,
    activity_packet_hash: hashValue(packet),
    activity_family: packet.activity_family,
    diagnostic_purpose: diagnosticPurposeForActivityFamily(packet.activity_family),
    selected_formative_value: packet.selected_formative_value,
    generation_source: packet.generation_source,
    runtime_servable_to_student: packet.runtime_servable_to_student,
    review_only: packet.review_only,
    safe_activity_prompt: packet.first_turn.message,
    first_turn_message_hash: hashValue(packet.first_turn.message),
    expected_student_action_prompt: packet.expected_student_action.prompt,
    expected_student_action_prompt_hash: hashValue(packet.expected_student_action.prompt),
    distractor_role: packet.distractor_use.distractor_role,
    distractor_student_safe_description: packet.distractor_use.student_safe_description,
    source_profile_integration_snapshot_id: packet.source_profile_integration_snapshot_id,
    source_formative_value_packet_id: packet.source_formative_value_packet_id,
    source_activity_agent_name: FORMATIVE_ACTIVITY_AGENT_NAME,
    target_item_index: null,
    target_item_id: null,
    target_option_label: null,
    target_construct_or_boundary: packet.activity_goal.student_safe_goal,
    student_task_prompt: packet.first_turn.message,
    expected_response_mode: "free_text",
    rationale_for_selection: "Activity selected by the live activity agent from the response package evidence.",
    semantic_deduplication_key: hashValue({
      activity_family: packet.activity_family,
      diagnostic_purpose: diagnosticPurposeForActivityFamily(packet.activity_family),
      selected_formative_value: packet.selected_formative_value,
      student_safe_goal: packet.activity_goal.student_safe_goal
    })
  };
}

function activityFamilyForRuntime(
  family: CreateEvidenceIntegratedActivityRuntimeAttemptInput["activity_family"]
): FormativeActivityFamily {
  switch (family) {
    case "distractor_focused_activity":
      return "distractor_contrast";
    case "foundational_support_activity":
      return "basic_concept_grounding";
    case "diagnostic_clarification":
      return "independent_reconstruction";
  }
}

function statusForRecommendation(recommendation: ActivityRuntimeRecommendation): ActivityRuntimeState {
  if (recommendation === "move_on") return "move_on_recommended";
  if (recommendation === "choose_alternative_activity") return "choose_alternative_recommended";
  if (recommendation === "failed_closed") return "failed_closed";
  return "continue_recommended";
}

export function recommendationFromEvaluatorPacket(
  packet: ActivityMisconceptionEvidencePacketV1
): ActivityRuntimeRecommendation {
  const status = packet.misconception_evidence_update.status;

  if (packet.recommended_next_diagnostic_purpose === "move_on_or_exit") {
    return "move_on";
  }

  switch (status) {
    case "student_chose_move_on":
      return "move_on";
    case "student_requested_alternative_activity":
      return "choose_alternative_activity";
    case "conceptual_entry_gap_remains":
      return "continue_conceptual_entry_grounding";
    case "conceptual_entry_improved":
    case "ready_for_distractor_probe":
      return "continue_distractor_misconception_probe";
    case "misconception_persisted":
      return "continue_distractor_misconception_probe";
    case "misconception_weakened":
    case "boundary_understanding_improved":
    case "reasoning_boundary_still_blurred":
      return "continue_reasoning_boundary_repair";
    case "independent_evidence_supported":
    case "misconception_unsupported":
      return "continue_independent_verification";
    case "no_actionable_misconception_evidence":
      return "optional_extension_or_move_on";
    case "insufficient_new_evidence":
      return "retry_or_choose_or_move_on";
  }
}

function responseKindHint(input: {
  choice_state: StudentActivityChoiceState;
  text: string;
}): ActivityResponseKind {
  if (input.choice_state === "move_on") return "move_on";
  if (input.choice_state === "choose_another_activity") return "choose_other_activity";
  if (input.text.length < 12) return "low_information";
  if (input.text.length < 80) return "partial";
  return "substantive";
}

function summarizeStudentResponse(text: string) {
  const trimmed = text.trim().replace(/\s+/g, " ");
  return trimmed.slice(0, 900);
}

function defaultFailedFeedback() {
  return {
    message: "I cannot safely update this activity evidence right now. You can try again, choose another activity, or continue to the next step.",
    next_options: ["continue", "choose another activity", "skip this activity and continue"] as Array<
      "continue" | "choose another activity" | "skip this activity and continue"
    >
  };
}

function normalizeStudentSafeFeedback(input: {
  message: string;
  next_options: Array<
    "continue" | "choose another activity" | "skip this activity and continue" | "move on"
  >;
}): ActivityRuntimeLoopResult["student_safe_feedback"] {
  return {
    message: input.message
      .replace(/\bmove on\b/gi, "end the assessment")
      .replace(/\bMove on\b/g, "End assessment"),
    next_options: input.next_options.map((option) =>
      option === "move on" ? "skip this activity and continue" : option
    )
  };
}

async function assertSourceActivityAgentCall(input: {
  client: PrismaClientLike;
  agent_call_id?: string | null;
}) {
  if (!input.agent_call_id) {
    throw new Error("activity_runtime_source_activity_agent_call_missing");
  }

  const call = await input.client.agentCall.findUnique({
    where: { id: input.agent_call_id },
    select: {
      agent_name: true,
      provider: true,
      call_status: true,
      output_validated: true,
      provider_request_id: true,
      provider_response_id: true,
      input_tokens: true,
      output_tokens: true,
      total_tokens: true
    }
  });

  if (!call) {
    throw new Error("activity_runtime_source_activity_agent_call_not_found");
  }
  if (call.agent_name !== FORMATIVE_ACTIVITY_AGENT_NAME) {
    throw new Error("activity_runtime_source_activity_agent_call_wrong_agent");
  }
  if (call.call_status !== "succeeded" || !call.output_validated) {
    throw new Error("activity_runtime_source_activity_agent_call_not_validated");
  }
  if (call.provider !== "openai") {
    throw new Error("activity_runtime_source_activity_agent_call_not_live_provider");
  }
  if (!call.provider_request_id && !call.provider_response_id) {
    throw new Error("activity_runtime_source_activity_agent_call_missing_provider_metadata");
  }
  if (
    !Number.isFinite(call.input_tokens) ||
    !Number.isFinite(call.output_tokens) ||
    !Number.isFinite(call.total_tokens)
  ) {
    throw new Error("activity_runtime_source_activity_agent_call_missing_token_usage");
  }
}

export async function activityMisconceptionEvidenceAuditFromAgentCall(
  agentCallId: string,
  client: PrismaClientLike = prisma
): Promise<ActivityMisconceptionEvidenceProviderAudit> {
  const call = await client.agentCall.findUnique({
    where: { id: agentCallId },
    select: {
      id: true,
      provider: true,
      model_name: true,
      client_request_id: true,
      provider_request_id: true,
      provider_response_id: true,
      call_status: true,
      output_validated: true,
      input_tokens: true,
      output_tokens: true,
      total_tokens: true
    }
  });

  if (!call) {
    throw new Error("activity_runtime_evaluator_agent_call_not_found");
  }

  return {
    agent_call_id: call.id,
    provider: call.provider === "openai" ? "openai" : "mock",
    model_name: call.model_name,
    client_request_id: call.client_request_id ?? undefined,
    provider_request_id: call.provider_request_id ?? undefined,
    provider_response_id: call.provider_response_id ?? undefined,
    call_status:
      call.call_status === "succeeded"
        ? "succeeded"
        : call.call_status === "invalid_output"
          ? "invalid_output"
          : call.call_status === "started"
            ? "started"
            : "failed",
    output_validated: call.output_validated,
    input_tokens: call.input_tokens ?? undefined,
    output_tokens: call.output_tokens ?? undefined,
    total_tokens: call.total_tokens ?? undefined
  };
}

export async function createActivityRuntimeAttemptFromLiveActivityPacket(
  input: CreateActivityRuntimeAttemptInput,
  client: PrismaClientLike = prisma
) {
  assertFormativeActivityPacketIsNotReviewOnlyForRuntime(input.activity_packet);
  await assertSourceActivityAgentCall({
    client,
    agent_call_id: input.first_turn_agent_call_db_id
  });

  const ref = sourceActivityPacketRef(input.activity_packet);
  const attemptPublicId = input.activity_attempt_public_id ?? publicId("act_attempt");

  return client.activityRuntimeAttempt.create({
    data: {
      activity_attempt_public_id: attemptPublicId,
      session_public_id: input.activity_packet.session_public_id,
      student_public_id: input.activity_packet.student_public_id,
      assessment_public_id: input.activity_packet.assessment_public_id,
      concept_unit_id: input.activity_packet.concept_unit_id,
      source_activity_packet_ref: prismaJson(redactForAudit(ref)),
      activity_family: input.activity_packet.activity_family,
      diagnostic_purpose: ref.diagnostic_purpose,
      generation_source: input.activity_packet.generation_source,
      first_turn_agent_call_db_id: input.first_turn_agent_call_db_id,
      reviewer_agent_call_db_id: input.reviewer_agent_call_db_id ?? undefined,
      repair_agent_call_db_id: input.repair_agent_call_db_id ?? undefined,
      status: "awaiting_student_activity_response",
      limitations: prismaJson(input.limitations ?? [])
    }
  });
}

export async function createActivityRuntimeAttemptFromEvidenceIntegratedRouter(
  input: CreateEvidenceIntegratedActivityRuntimeAttemptInput,
  client: PrismaWriteClientLike = prisma
) {
  const runtimeFamily = activityFamilyForRuntime(input.activity_family);
  const ref: SourceActivityPacketRef = {
    runtime_loop_version: ACTIVITY_RUNTIME_LOOP_VERSION,
    schema_version: input.next_interaction_schema_version,
    activity_packet_hash: hashValue({
      prompt: input.safe_activity_prompt,
      response_prompt: input.expected_student_action_prompt,
      routing_policy_version: input.routing_policy_version,
      activity_type: input.activity_type
    }),
    activity_family: runtimeFamily,
    diagnostic_purpose: input.diagnostic_purpose,
    selected_formative_value: input.selected_formative_value,
    generation_source: "evidence_integrated_router",
    runtime_servable_to_student: true,
    review_only: false,
    safe_activity_prompt: input.safe_activity_prompt,
    first_turn_message_hash: hashValue(input.safe_activity_prompt),
    expected_student_action_prompt: input.expected_student_action_prompt,
    expected_student_action_prompt_hash: hashValue(input.expected_student_action_prompt),
    distractor_role: input.distractor_role,
    distractor_student_safe_description: input.distractor_student_safe_description,
    source_profile_integration_snapshot_id: input.source_profile_integration_snapshot_id,
    source_formative_value_packet_id: input.source_formative_value_packet_id,
    source_activity_agent_name: FORMATIVE_ACTIVITY_AGENT_NAME,
    next_interaction_schema_version: input.next_interaction_schema_version,
    routing_policy_version: input.routing_policy_version,
    activity_type: input.activity_type,
    routing_justification: input.routing_justification,
    target_item_index: input.target_item_index ?? null,
    target_item_id: input.target_item_id ?? null,
    target_option_label: input.target_option_label ?? null,
    target_construct_or_boundary: input.target_construct_or_boundary ?? null,
    student_task_prompt: input.student_task_prompt ?? input.safe_activity_prompt,
    expected_response_mode: input.expected_response_mode ?? "free_text",
    rationale_for_selection: input.rationale_for_selection ?? input.routing_justification,
    semantic_deduplication_key: input.semantic_deduplication_key ?? hashValue({
      activity_family: runtimeFamily,
      diagnostic_purpose: input.diagnostic_purpose,
      selected_formative_value: input.selected_formative_value,
      prompt: input.safe_activity_prompt
    }),
    replaced_activity_attempt_public_id: input.replaced_activity_attempt_public_id ?? null,
    activity_switch_reason: input.activity_switch_reason ?? null
  };
  const attemptPublicId = input.activity_attempt_public_id ?? publicId("act_attempt");

  return client.activityRuntimeAttempt.create({
    data: {
      activity_attempt_public_id: attemptPublicId,
      session_public_id: input.session_public_id,
      student_public_id: input.student_public_id,
      assessment_public_id: input.assessment_public_id,
      concept_unit_id: input.concept_unit_id,
      source_activity_packet_ref: prismaJson(redactForAudit(ref)),
      activity_family: runtimeFamily,
      diagnostic_purpose: input.diagnostic_purpose,
      generation_source: "evidence_integrated_router",
      status: "awaiting_student_activity_response",
      limitations: prismaJson(input.limitations ?? [])
    }
  });
}

function buildEvaluationInput(input: {
  attempt: ActivityRuntimeAttempt;
  source: SourceActivityPacketRef;
  response_summary: string;
  response_kind_hint: ActivityResponseKind;
  formative_turn_context?: AuthoritativeFormativeTurnContext;
}) {
  return {
    session_public_id: input.attempt.session_public_id,
    student_public_id: input.attempt.student_public_id,
    assessment_public_id: input.attempt.assessment_public_id,
    concept_unit_id: input.attempt.concept_unit_id,
    activity_attempt_id: input.attempt.activity_attempt_public_id,
    source_activity_family: input.source.activity_family,
    selected_formative_value: input.source.selected_formative_value,
    source_diagnostic_purpose: input.source.diagnostic_purpose,
    profile_condition: "runtime_activity_attempt_response",
    distractor_role: input.source.distractor_student_safe_description,
    safe_activity_prompt: input.source.safe_activity_prompt,
    safe_student_activity_response: input.response_summary,
    response_kind_hint: input.response_kind_hint,
    expected_evidence_focus:
      "Evaluate the latest activity response using the complete authoritative formative-turn context.",
    formative_turn_context: input.formative_turn_context
  } satisfies ActivityMisconceptionEvidenceLiveEvaluationInput;
}

async function failClosed(input: {
  client: PrismaClientLike;
  attempt: ActivityRuntimeAttempt;
  reason: string;
  limitations?: string[];
}): Promise<ActivityRuntimeLoopResult> {
  const limitations = [input.reason, ...(input.limitations ?? [])];
  await input.client.activityRuntimeAttempt.update({
    where: { id: input.attempt.id },
    data: {
      status: "failed_closed",
      completed_at: new Date(),
      limitations: prismaJson(limitations)
    }
  });
  return {
    status: "failed_closed",
    activity_attempt_public_id: input.attempt.activity_attempt_public_id,
    evidence_record_public_id: null,
    post_activity_snapshot_public_id: null,
    student_safe_feedback: defaultFailedFeedback(),
    next_runtime_recommendation: "failed_closed",
    runtime_state: "failed_closed",
    limitations
  };
}

export async function submitStudentActivityResponseForEvidenceUpdate(
  input: SubmitStudentActivityResponseForEvidenceUpdateInput,
  client: PrismaClientLike = prisma
): Promise<ActivityRuntimeLoopResult> {
  const attempt = await client.activityRuntimeAttempt.findUnique({
    where: { activity_attempt_public_id: input.activity_attempt_public_id }
  });

  if (!attempt || attempt.session_public_id !== input.session_public_id) {
    throw new Error("activity_runtime_attempt_not_found");
  }

  const currentStatus = ActivityRuntimeStateSchema.safeParse(attempt.status);
  if (!currentStatus.success) {
    return failClosed({
      client,
      attempt,
      reason: "activity_runtime_attempt_invalid_status"
    });
  }
  let effectiveCurrentStatus: ActivityRuntimeState = currentStatus.data;

  if (currentStatus.data === "student_activity_response_received" && input.attempt_already_claimed) {
    effectiveCurrentStatus = "awaiting_student_activity_response";
  }

  if (
    currentStatus.data === "continue_recommended" ||
    currentStatus.data === "choose_alternative_recommended" ||
    currentStatus.data === "move_on_recommended"
  ) {
    if (input.allow_additional_turn) {
      await client.activityRuntimeAttempt.update({
        where: { id: attempt.id },
        data: {
          status: "awaiting_student_activity_response",
          completed_at: null
        }
      });
      effectiveCurrentStatus = "awaiting_student_activity_response";
    } else {
      const recommendation =
        currentStatus.data === "move_on_recommended"
          ? "move_on"
          : currentStatus.data === "choose_alternative_recommended"
            ? "choose_alternative_activity"
            : "continue_distractor_misconception_probe";
      return {
        status: "ok",
        activity_attempt_public_id: attempt.activity_attempt_public_id,
        evidence_record_public_id: attempt.latest_evidence_record_public_id,
        post_activity_snapshot_public_id: attempt.latest_snapshot_public_id,
        student_safe_feedback: defaultFailedFeedback(),
        next_runtime_recommendation: recommendation,
        runtime_state: currentStatus.data,
        limitations: ["activity_attempt_already_processed"]
      };
    }
  }

  if (effectiveCurrentStatus !== "awaiting_student_activity_response") {
    return failClosed({
      client,
      attempt,
      reason: "activity_runtime_attempt_not_awaiting_response"
    });
  }

  const sourceRefResult = SourceActivityPacketRefSchema.safeParse(attempt.source_activity_packet_ref);
  if (!sourceRefResult.success) {
    return failClosed({
      client,
      attempt,
      reason: "activity_runtime_source_activity_ref_invalid"
    });
  }
  const source = sourceRefResult.data;
  if (
    !["live_llm", "evidence_integrated_router"].includes(source.generation_source) ||
    source.review_only ||
    !source.runtime_servable_to_student
  ) {
    return failClosed({
      client,
      attempt,
      reason: "activity_runtime_source_activity_not_live_runtime_servable"
    });
  }

  const trimmed = input.student_response_text.trim();
  if (!trimmed) {
    return failClosed({
      client,
      attempt,
      reason: "activity_runtime_student_response_empty"
    });
  }

  const responseSummary = summarizeStudentResponse(trimmed);
  const responseKind = responseKindHint({
    choice_state: input.student_choice_state,
    text: responseSummary
  });
  const responseReference = {
    runtime_loop_version: ACTIVITY_RUNTIME_LOOP_VERSION,
    activity_response_reference_id: publicId("act_response"),
    response_text_safe_summary: responseSummary,
    response_hash: hashValue(responseSummary),
    response_kind_hint: responseKind,
    student_choice_state: input.student_choice_state,
    selected_alternative_activity_family: input.selected_alternative_activity_family ?? null,
    process_context_summary: input.process_context_summary
      ? redactForAudit(input.process_context_summary)
      : null,
    raw_response_stored_elsewhere: true,
    submitted_at: new Date().toISOString()
  };

  const receivedAttempt = await client.activityRuntimeAttempt.update({
    where: { id: attempt.id },
    data: {
      status: "student_activity_response_received",
      latest_activity_response_reference: prismaJson(redactForAudit(responseReference))
    }
  });

  await client.activityRuntimeAttempt.update({
    where: { id: attempt.id },
    data: { status: "evidence_evaluation_pending" }
  });

  const evaluationInput = buildEvaluationInput({
    attempt: receivedAttempt,
    source,
    response_summary: responseSummary,
    response_kind_hint: responseKind,
    formative_turn_context: input.formative_turn_context
  });

  const evaluator =
    input.evaluator_override ??
    ((evaluation_input: ActivityMisconceptionEvidenceLiveEvaluationInput) =>
      executeLiveActivityMisconceptionEvidenceEvaluator({ evaluation_input }));
  const evaluation = await evaluator(evaluationInput);

  if (evaluation.status !== "succeeded") {
    return failClosed({
      client,
      attempt: receivedAttempt,
      reason: evaluation.blocked_reason,
      limitations: evaluation.validation_issues.map((issue) =>
        `${issue.field_path}:${issue.blocked_pattern_label ?? issue.rule_code}`
      )
    });
  }

  const packetValidation = validateActivityMisconceptionEvidencePacket(evaluation.packet);
  if (!packetValidation.valid) {
    return failClosed({
      client,
      attempt: receivedAttempt,
      reason: "activity_runtime_evaluator_packet_invalid",
      limitations: packetValidation.issues.map((issue) =>
        `${issue.field_path}:${issue.blocked_pattern_label ?? issue.rule_code}`
      )
    });
  }

  await client.activityRuntimeAttempt.update({
    where: { id: attempt.id },
    data: { status: "evidence_evaluated" }
  });

  const sourceAgentCallId = evaluation.repair_agent_call_id ?? evaluation.evaluator_agent_call_id;
  const evaluatorAudit = await activityMisconceptionEvidenceAuditFromAgentCall(sourceAgentCallId, client);
  let persisted;
  try {
    persisted = await persistActivityMisconceptionEvidenceUpdate({
      packet: evaluation.packet,
      evaluator_audit: evaluatorAudit,
      mode: "production_diagnosis",
      source_activity_packet_ref: {
        activity_attempt_public_id: attempt.activity_attempt_public_id,
        activity_family: source.activity_family,
        diagnostic_purpose: source.diagnostic_purpose,
        activity_packet_hash: source.activity_packet_hash,
        first_turn_message_hash: source.first_turn_message_hash,
        final_source_agent_call: evaluation.repair_agent_call_id ? "repair" : "evaluator"
      },
      pre_activity_diagnostic_state: input.pre_activity_diagnostic_state ?? null
    }, client);
  } catch (error) {
    const guard = (error as { guard?: ActivityMisconceptionEvidencePersistenceGuardResult }).guard;
    return failClosed({
      client,
      attempt: receivedAttempt,
      reason: "activity_runtime_persistence_guard_failed",
      limitations: guard?.issues.map((issue) =>
        `${issue.field_path}:${issue.blocked_pattern_label ?? issue.rule_code}`
      ) ?? [error instanceof Error ? error.message : "unknown_persistence_error"]
    });
  }

  const recommendation = recommendationFromEvaluatorPacket(evaluation.packet);
  const finalState = statusForRecommendation(recommendation);
  await client.activityRuntimeAttempt.update({
    where: { id: attempt.id },
    data: {
      status: input.defer_final_attempt_activation
        ? persisted.snapshot
          ? "post_activity_snapshot_created"
          : "evidence_persisted"
        : finalState,
      completed_at: input.defer_final_attempt_activation ? null : new Date(),
      latest_evidence_record_public_id: persisted.record.evidence_public_id,
      latest_snapshot_public_id: persisted.snapshot?.snapshot_public_id ?? undefined,
      limitations: prismaJson(evaluation.packet.misconception_evidence_update.limitations)
    }
  });

  return {
    status: "ok",
    activity_attempt_public_id: attempt.activity_attempt_public_id,
    evidence_record_public_id: persisted.record.evidence_public_id,
    post_activity_snapshot_public_id: persisted.snapshot?.snapshot_public_id ?? null,
    student_safe_feedback: normalizeStudentSafeFeedback(evaluation.packet.student_safe_feedback),
    next_runtime_recommendation: recommendation,
    runtime_state: finalState,
    limitations: evaluation.packet.misconception_evidence_update.limitations
  };
}

function redactedAttemptForReview(attempt: ActivityRuntimeAttempt) {
  const source = SourceActivityPacketRefSchema.safeParse(attempt.source_activity_packet_ref);
  return {
    activity_attempt_public_id: attempt.activity_attempt_public_id,
    session_public_id: attempt.session_public_id,
    student_public_id: attempt.student_public_id,
    assessment_public_id: attempt.assessment_public_id,
    concept_unit_id: attempt.concept_unit_id,
    activity_family: attempt.activity_family,
    diagnostic_purpose: attempt.diagnostic_purpose,
    generation_source: attempt.generation_source,
    status: attempt.status,
    started_at: attempt.started_at.toISOString(),
    completed_at: attempt.completed_at?.toISOString() ?? null,
    source_activity_packet_ref: source.success ? {
      schema_version: source.data.schema_version,
      activity_packet_hash: source.data.activity_packet_hash,
      activity_family: source.data.activity_family,
      diagnostic_purpose: source.data.diagnostic_purpose,
      generation_source: source.data.generation_source,
      runtime_servable_to_student: source.data.runtime_servable_to_student,
      review_only: source.data.review_only,
      first_turn_message_hash: source.data.first_turn_message_hash,
      expected_student_action_prompt_hash: source.data.expected_student_action_prompt_hash,
      safe_activity_prompt_present: Boolean(source.data.safe_activity_prompt),
      safe_activity_prompt_length: source.data.safe_activity_prompt.length
    } : {
      invalid: true
    },
    latest_activity_response_reference_present: Boolean(attempt.latest_activity_response_reference),
    latest_evidence_record_public_id: attempt.latest_evidence_record_public_id,
    latest_snapshot_public_id: attempt.latest_snapshot_public_id,
    limitations: attempt.limitations
  };
}

function timestampSlug() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

export async function writeActivityRuntimeLoopReview(input: {
  session_public_id?: string;
  output_dir?: string;
  client?: PrismaClientLike;
}) {
  const client = input.client ?? prisma;
  const attempts = await client.activityRuntimeAttempt.findMany({
    where: input.session_public_id ? { session_public_id: input.session_public_id } : undefined,
    orderBy: { created_at: "desc" },
    take: input.session_public_id ? 100 : 20
  });
  const evidenceRecords = attempts.length > 0
    ? await client.activityMisconceptionEvidenceRecord.findMany({
        where: {
          activity_attempt_id: {
            in: attempts.map((attempt) => attempt.activity_attempt_public_id)
          }
        },
        select: {
          evidence_public_id: true,
          activity_attempt_id: true,
          evaluation_source: true,
          production_mode: true,
          misconception_update_status: true,
          evidence_quality: true,
          recommended_next_diagnostic_purpose: true,
          created_at: true
        },
        orderBy: { created_at: "desc" }
      })
    : [];
  const snapshots = attempts.length > 0
    ? await client.postActivityDiagnosticSnapshot.findMany({
        where: {
          activity_attempt_id: {
            in: attempts.map((attempt) => attempt.activity_attempt_public_id)
          }
        },
        select: {
          snapshot_public_id: true,
          activity_attempt_id: true,
          post_activity_diagnostic_state: true,
          next_diagnostic_purpose: true,
          update_strength: true,
          created_at: true
        },
        orderBy: { created_at: "desc" }
      })
    : [];

  const outputDir = input.output_dir ?? path.join(process.cwd(), ".data", "activity-runtime-loop-review");
  await mkdir(outputDir, { recursive: true });
  const artifactPath = path.join(outputDir, `activity-runtime-loop-review-${timestampSlug()}.json`);
  const artifact = {
    artifact_version: ACTIVITY_RUNTIME_REVIEW_ARTIFACT_VERSION,
    generated_at: new Date().toISOString(),
    no_live_provider_call_made: true,
    summary: {
      status: attempts.length > 0 ? "passed" : "completed_with_limitations",
      session_public_id: input.session_public_id ?? null,
      runtime_attempt_count: attempts.length,
      evidence_record_count: evidenceRecords.length,
      snapshot_count: snapshots.length,
      latest_status: attempts[0]?.status ?? null,
      limitations: attempts.length > 0 ? [] : ["no_activity_runtime_attempts_found"]
    },
    attempts: attempts.map(redactedAttemptForReview),
    evidence_records: evidenceRecords.map((record) => ({
      evidence_public_id: record.evidence_public_id,
      activity_attempt_id: record.activity_attempt_id,
      evaluation_source: record.evaluation_source,
      production_mode: record.production_mode,
      misconception_update_status: record.misconception_update_status,
      evidence_quality: record.evidence_quality,
      recommended_next_diagnostic_purpose: record.recommended_next_diagnostic_purpose,
      created_at: record.created_at.toISOString()
    })),
    snapshots: snapshots.map((snapshot) => ({
      snapshot_public_id: snapshot.snapshot_public_id,
      activity_attempt_id: snapshot.activity_attempt_id,
      post_activity_diagnostic_state: snapshot.post_activity_diagnostic_state,
      next_diagnostic_purpose: snapshot.next_diagnostic_purpose,
      update_strength: snapshot.update_strength,
      created_at: snapshot.created_at.toISOString()
    }))
  };
  await writeFile(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  return {
    ...artifact.summary,
    artifact_path: artifactPath
  };
}
