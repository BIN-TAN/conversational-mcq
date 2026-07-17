import { createHash } from "node:crypto";
import { Prisma, type ActivityRuntimeAttempt } from "@prisma/client";
import { z } from "zod";
import {
  FormativePlanningOutput,
  StudentProfileOutput,
  type AgentOutputByName
} from "@/lib/agents/contracts";
import { executeStudentProfilingCandidate } from "@/lib/agents/student-profiling/service";
import { executeFormativePlanningCandidate } from "@/lib/agents/formative-planning/service";
import { studentProfileCreateData } from "@/lib/agents/student-profiling/persistence";
import { formativeDecisionCreateData } from "@/lib/agents/formative-planning/persistence";
import { prisma } from "@/lib/db";
import { logProcessEvent } from "@/lib/services/process-events";
import { toPrismaJson } from "@/lib/services/json";
import {
  ACTIVITY_RUNTIME_MAX_RESPONSE_CHARS,
  StudentActivityRuntimeProjectionSchema,
  assertStudentActivityRuntimeProjectionIsSafe,
  studentActivityFocusLabel,
  studentActivityRecommendationLabel,
  type StudentActivityRuntimeProjection
} from "@/lib/student-assessment/activity-runtime-projection";
import {
  createActivityRuntimeAttemptFromEvidenceIntegratedRouter,
  createActivityRuntimeAttemptFromLiveActivityPacket,
  submitStudentActivityResponseForEvidenceUpdate,
  type ActivityRuntimeLoopResult
} from "@/lib/services/student-assessment/activity-runtime-loop";
import {
  buildDeterministicTopicDialogueResponse,
  buildPostActivityLearningDecision,
  getTopicDialoguePolicy,
  POST_ACTIVITY_LEARNING_DECISION_VERSION,
  TOPIC_DIALOGUE_AGENT_NAME,
  TOPIC_DIALOGUE_FALLBACK_VERSION,
  TOPIC_DIALOGUE_INPUT_SCHEMA_VERSION,
  TOPIC_DIALOGUE_INPUT_SCHEMA_VERSION_V2,
  TOPIC_DIALOGUE_OUTPUT_SCHEMA_VERSION,
  TOPIC_DIALOGUE_OUTPUT_SCHEMA_VERSION_V2,
  TOPIC_DIALOGUE_PROMPT_HASH,
  TOPIC_DIALOGUE_PROMPT_INSTRUCTIONS,
  TOPIC_DIALOGUE_PROMPT_VERSION,
  TOPIC_DIALOGUE_BOUNDARY_VALIDATOR_VERSION,
  TopicDialogueInputV1Schema,
  TopicDialogueOutputV1Schema,
  applyTopicDialogueReadinessGate,
  classifyTopicDialogueStudentMessage,
  topicDialoguePublicId,
  validateTopicDialogueOutput,
  type PostActivityLearningDecisionV1,
  type TopicDialogueOutputV1
} from "@/lib/services/student-assessment/topic-dialogue-agent";
import { resolveOperationalRoleLiveCallsEnabled } from "@/lib/llm/config";
import {
  executeStudentRuntimeLiveAgent,
} from "@/lib/services/student-assessment/student-runtime-live-agent";
import { updateAssessmentSessionPhase } from "@/lib/services/session-state";
import { submitChatNativeNextChoice } from "@/lib/services/student-assessment/formative-profile";
import {
  executeLiveFormativeActivityDialogueAgent,
  type FormativeActivityLiveExecutionResult
} from "@/lib/services/student-assessment/formative-activity-live";
import {
  FORMATIVE_ACTIVITY_AGENT_NAME,
  FormativeActivityFamilySchema,
  FormativeActivityPacketV1Schema,
  type FormativeActivityFamily,
  type FormativeActivityPacketV1
} from "@/lib/services/student-assessment/formative-activity-design";
import {
  buildProfileIntegrationInterpretationPacketForSession,
  type ProfileIntegrationInterpretationPacketV1
} from "@/lib/services/student-assessment/profile-integration";
import {
  buildFormativeValueDeterminationPacketForSession,
  type FormativeValueDeterminationPacketV1
} from "@/lib/services/student-assessment/formative-value-determination";
import type {
  ActivityMisconceptionEvidenceLiveEvaluationInput,
  ActivityMisconceptionEvidenceLiveExecutionResult
} from "@/lib/services/student-assessment/activity-misconception-evidence-live";
import {
  ActivityMisconceptionEvidencePacketV1Schema,
  type ActivityMisconceptionEvidencePacketV1
} from "@/lib/services/student-assessment/activity-misconception-evidence";
import { StudentAssessmentServiceError } from "./errors";
import {
  buildAuthoritativeFormativeTurnContext,
  type AuthoritativeFormativeTurnContext
} from "./assessment-interpretation-context";
import { formativeDialogueRoute } from "./dialogue-routing-contract";

type PrismaClientLike = typeof prisma;

const alternativeActivityLabels: string[] = [];

const alternativeFamilyOrder: FormativeActivityFamily[] = [
  "distractor_contrast",
  "reasoning_chain_repair",
  "independent_reconstruction",
  "confidence_evidence_audit",
  "basic_concept_grounding",
  "transfer_and_distractor_generation"
];

const SourceActivityPacketRefSchema = z.object({
  schema_version: z.string().min(1),
  activity_packet_hash: z.string().min(1),
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
  safe_activity_prompt: z.string().min(1),
  expected_student_action_prompt: z.string().min(1),
  distractor_role: z.string().min(1),
  distractor_student_safe_description: z.string().min(1),
  source_profile_integration_snapshot_id: z.string().min(1).optional(),
  source_formative_value_packet_id: z.string().min(1).optional(),
  target_item_index: z.number().int().positive().nullable().optional(),
  target_item_id: z.string().min(1).nullable().optional(),
  target_option_label: z.string().min(1).max(8).nullable().optional(),
  target_construct_or_boundary: z.string().min(1).nullable().optional(),
  student_task_prompt: z.string().min(1).optional(),
  expected_response_mode: z.enum(["short_text", "free_text"]).optional(),
  rationale_for_selection: z.string().min(1).optional(),
  semantic_deduplication_key: z.string().min(1).optional()
}).passthrough();

type StudentActivityRuntimeChoiceAction =
  | "choose_another_activity"
  | "skip_activity_to_transfer"
  | "skip_activity_to_next_concept"
  | "finish_assessment"
  | "return_to_summary"
  | "move_on";

const FeedbackSchema = z.object({
  message: z.string().min(1),
  next_options: z.array(z.enum([
    "continue",
    "choose another activity",
    "skip this activity and continue",
    "continue to transfer item",
    "continue to next concept",
    "finish assessment",
    "return to assessment summary",
    "move on"
  ])).min(1).max(3)
}).strict();

function normalizeRuntimeFeedback(feedback: z.infer<typeof FeedbackSchema>):
  StudentActivityRuntimeProjection["feedback"] {
  return {
    message: feedback.message
      .replace(/\bmove on\b/gi, "end the assessment")
      .replace(/\bMove on\b/g, "End assessment"),
    next_options: feedback.next_options.map((option) =>
      option === "move on" ? "skip this activity and continue" : option
    ) as NonNullable<StudentActivityRuntimeProjection["feedback"]>["next_options"]
  };
}

export type StudentActivityRuntimeGenerationOverride = (input: {
  profile_integration_packet: ProfileIntegrationInterpretationPacketV1;
  formative_value_packet: FormativeValueDeterminationPacketV1;
}) => Promise<FormativeActivityLiveExecutionResult>;

export type StudentActivityRuntimeEvaluatorOverride = (
  input: ActivityMisconceptionEvidenceLiveEvaluationInput
) => Promise<ActivityMisconceptionEvidenceLiveExecutionResult>;

type StudentProfileAgentOutput = AgentOutputByName["student_profiling_agent"];
type FormativePlanningAgentOutput = AgentOutputByName["formative_value_and_planning_agent"];

export type StudentActivityTurnOrchestrationOverride = (input: {
  context: AuthoritativeFormativeTurnContext;
  stage: "profile" | "planning";
  staged_profile_output?: StudentProfileAgentOutput;
}) => Promise<
  | { stage: "profile"; output: StudentProfileAgentOutput; agent_call_id: string | null }
  | { stage: "planning"; output: FormativePlanningAgentOutput; agent_call_id: string | null }
>;

function prismaJson(value: unknown) {
  return toPrismaJson(value) ?? Prisma.JsonNull;
}

function hashStudentRuntimeValue(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function jsonArray(value: Prisma.JsonValue): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringJsonArray(value: Prisma.JsonValue): string[] {
  return jsonArray(value).filter((entry): entry is string => typeof entry === "string");
}

function carryForwardProfileOutput(
  profile: Awaited<ReturnType<typeof currentProfileAndPlan>>["profile"]
): StudentProfileAgentOutput {
  const priorOutput = StudentProfileOutput.safeParse(
    profile.based_on_agent_call?.output_payload
  );
  if (priorOutput.success) {
    return {
      ...priorOutput.data,
      profile_type: "updated",
      output_status: "needs_review",
      warnings: [
        ...priorOutput.data.warnings,
        "provider_update_unavailable_previous_profile_preserved"
      ]
    };
  }
  return StudentProfileOutput.parse({
    agent_name: "student_profiling_agent",
    agent_version: "formative-turn-safe-carry-forward-v1",
    prompt_version: "student-profiling-v3",
    schema_version: "student-profile-output-v2",
    output_status: "needs_review",
    warnings: ["provider_update_unavailable_previous_profile_preserved"],
    profile_type: "updated",
    ability_profile: profile.ability_profile,
    ability_pattern_flags: jsonArray(profile.ability_pattern_flags),
    engagement_profile: profile.engagement_profile,
    engagement_pattern_flags: jsonArray(profile.engagement_pattern_flags),
    integrated_diagnostic_profile: profile.integrated_diagnostic_profile,
    integrated_profile_confidence: profile.integrated_profile_confidence,
    integrated_profile_rationale: profile.integrated_profile_rationale,
    evidence_sufficiency: profile.evidence_sufficiency,
    confidence_alignment: profile.confidence_alignment,
    independence_interpretability: profile.independence_interpretability,
    misconception_indicators: [],
    item_level_evidence: [],
    reasoning_quality_summary: profile.reasoning_quality_summary,
    engagement_summary: profile.engagement_summary,
    process_interpretation_cautions: [
      ...stringJsonArray(profile.process_interpretation_cautions),
      "The latest turn could not be re-profiled; the previous evidence-based profile was preserved."
    ],
    profile_confidence: profile.profile_confidence,
    rationale: `${profile.rationale} The latest turn remains available for a later validated update.`,
    recommended_next_evidence: []
  });
}

function carryForwardPlanningOutput(
  decision: Awaited<ReturnType<typeof currentProfileAndPlan>>["decision"]
): FormativePlanningAgentOutput {
  const priorOutput = FormativePlanningOutput.safeParse(
    decision.based_on_agent_call?.output_payload
  );
  if (priorOutput.success) {
    return {
      ...priorOutput.data,
      output_status: "needs_review",
      warnings: [
        ...priorOutput.data.warnings,
        "provider_update_unavailable_previous_plan_preserved"
      ]
    };
  }
  return FormativePlanningOutput.parse({
    agent_name: "formative_value_and_planning_agent",
    agent_version: "formative-turn-safe-carry-forward-v1",
    prompt_version: "formative-planning-v2",
    schema_version: "formative-planning-output-v1",
    output_status: "needs_review",
    warnings: ["provider_update_unavailable_previous_plan_preserved"],
    formative_value: decision.formative_value,
    formative_action_plan: decision.formative_action_plan,
    target_evidence: stringJsonArray(decision.target_evidence),
    success_criteria: stringJsonArray(decision.success_criteria),
    followup_prompt_constraints: stringJsonArray(decision.followup_prompt_constraints),
    profile_update_triggers: stringJsonArray(decision.profile_update_triggers),
    rationale: `${decision.rationale} The prior plan remains active until a later validated update.`,
    mapping_followed: decision.mapping_followed,
    mapping_deviation_reason: decision.mapping_deviation_reason
  });
}

async function currentProfileAndPlan(conceptUnitSessionDbId: string, client: PrismaClientLike) {
  const concept = await client.conceptUnitSession.findUniqueOrThrow({
    where: { id: conceptUnitSessionDbId },
    include: {
      latest_student_profile: {
        include: {
          based_on_agent_call: { select: { output_payload: true } }
        }
      },
      latest_formative_decision: {
        include: {
          based_on_agent_call: { select: { output_payload: true } }
        }
      }
    }
  });
  if (!concept.latest_student_profile || !concept.latest_formative_decision) {
    throw new Error("formative_turn_current_profile_or_plan_missing");
  }
  return {
    assessment_session_db_id: concept.assessment_session_db_id,
    profile: concept.latest_student_profile,
    decision: concept.latest_formative_decision
  };
}

async function contextResponsePackage(input: {
  concept_unit_session_db_id: string;
  client_operation_id: string;
  stage: "profile" | "planning";
  context: AuthoritativeFormativeTurnContext;
  evidence_record_public_id: string | null;
  client: PrismaClientLike;
}) {
  const existing = await input.client.responsePackage.findFirst({
    where: {
      concept_unit_session_db_id: input.concept_unit_session_db_id,
      package_type: "followup_evidence_update_package",
      AND: [
        { payload: { path: ["formative_turn", "client_operation_id"], equals: input.client_operation_id } },
        { payload: { path: ["formative_turn", "stage"], equals: input.stage } }
      ]
    },
    orderBy: [{ created_at: "desc" }]
  });
  if (existing) return existing;

  return input.client.responsePackage.create({
    data: {
      concept_unit_session_db_id: input.concept_unit_session_db_id,
      package_type: "followup_evidence_update_package",
      payload: prismaJson({
        package_type: "followup_evidence_update_package",
        package_version: "formative-turn-orchestration-v1",
        formative_turn: {
          client_operation_id: input.client_operation_id,
          stage: input.stage,
          evidence_record_public_id: input.evidence_record_public_id
        },
        authoritative_formative_turn_context: input.context
      })
    }
  });
}

type FormativeTurnStageAudit = {
  stage: "profile" | "planning";
  update_failed: boolean;
  stale_version_used: boolean;
  fallback_source_version: string | null;
  failure_agent_call_id: string | null;
  result_status: string;
  failure_reason_code: string | null;
};

function fallbackSourceVersion(kind: "profile" | "plan", id: string, createdAt: Date) {
  return `${kind}_${createdAt.toISOString()}_${hashStudentRuntimeValue(id).slice(0, 12)}`;
}

async function persistFormativeTurnStageAudit(input: {
  response_package: Awaited<ReturnType<typeof contextResponsePackage>>;
  audit: FormativeTurnStageAudit;
  assessment_session_db_id: string;
  concept_unit_session_db_id: string;
  client_operation_id: string;
  client: PrismaClientLike;
}) {
  await input.client.responsePackage.update({
    where: { id: input.response_package.id },
    data: {
      payload: prismaJson({
        ...recordFromJson(input.response_package.payload),
        orchestration_result: input.audit
      })
    }
  });

  if (!input.audit.update_failed) return;
  await logProcessEvent({
    assessment_session_db_id: input.assessment_session_db_id,
    concept_unit_session_db_id: input.concept_unit_session_db_id,
    event_type: input.audit.stage === "profile"
      ? "followup_profile_update_failed"
      : "followup_planning_update_failed",
    event_category: "formative_activity_runtime",
    event_source: "backend",
    payload: {
      client_operation_id: input.client_operation_id,
      activity_turn_stage: input.audit.stage,
      profile_update_failed: input.audit.stage === "profile",
      planning_update_failed: input.audit.stage === "planning",
      stale_profile_used: input.audit.stage === "profile",
      stale_plan_used: input.audit.stage === "planning",
      fallback_source_version: input.audit.fallback_source_version,
      failure_agent_call_id: input.audit.failure_agent_call_id,
      result_status: input.audit.result_status,
      failure_reason_code: input.audit.failure_reason_code
    }
  });
}

async function runFormativeTurnProfileAndPlan(input: {
  session_public_id: string;
  concept_unit_session_db_id: string;
  activity_attempt_public_id: string;
  latest_student_message: string;
  client_operation_id: string;
  evidence_record_public_id: string | null;
  orchestration_override?: StudentActivityTurnOrchestrationOverride;
  client: PrismaClientLike;
}) {
  const current = await currentProfileAndPlan(input.concept_unit_session_db_id, input.client);
  const profileContext = await buildAuthoritativeFormativeTurnContext({
    ...input,
    agent_role: "student_profile_update",
    client: input.client
  });
  const profilePackage = await contextResponsePackage({
    ...input,
    stage: "profile",
    context: profileContext
  });
  const profileCyclePublicId = `formative_turn_${hashStudentRuntimeValue({
    client_operation_id: input.client_operation_id,
    stage: "profile"
  }).slice(0, 24)}`;
  const profileOverride = input.orchestration_override
    ? await input.orchestration_override({ context: profileContext, stage: "profile" })
    : null;
  let profileResult: Awaited<ReturnType<typeof executeStudentProfilingCandidate>> | null = null;
  let profileFailureReasonCode: string | null = null;
  if (!profileOverride) {
    try {
      profileResult = await executeStudentProfilingCandidate({
        concept_unit_session_db_id: input.concept_unit_session_db_id,
        followup_evidence_package_db_id: profilePackage.id,
        previous_student_profile_db_id: current.profile.id,
        cycle_public_id: profileCyclePublicId,
        invocation_reason: "formative_activity_turn_profile_update"
      });
    } catch {
      profileResult = null;
      profileFailureReasonCode = "profile_candidate_execution_failed";
    }
  }
  const profileSucceeded = profileOverride?.stage === "profile" ||
    (profileResult?.status === "succeeded" && Boolean(profileResult.output));
  const profileOutput = profileOverride?.stage === "profile"
    ? profileOverride.output
    : profileResult?.status === "succeeded" && profileResult.output
      ? profileResult.output
      : carryForwardProfileOutput(current.profile);
  const profileAgentCallId = profileOverride?.stage === "profile"
    ? profileOverride.agent_call_id
    : profileResult?.agent_call_id ?? null;
  const profileAudit: FormativeTurnStageAudit = {
    stage: "profile",
    update_failed: !profileSucceeded,
    stale_version_used: !profileSucceeded,
    fallback_source_version: profileSucceeded
      ? null
      : fallbackSourceVersion("profile", current.profile.id, current.profile.created_at),
    failure_agent_call_id: profileSucceeded ? null : profileAgentCallId,
    result_status: profileSucceeded ? "succeeded" : profileResult?.status ?? "execution_failed",
    failure_reason_code: profileSucceeded
      ? null
      : profileFailureReasonCode ?? `profile_${profileResult?.status ?? "execution_failed"}`
  };
  await persistFormativeTurnStageAudit({
    response_package: profilePackage,
    audit: profileAudit,
    assessment_session_db_id: current.assessment_session_db_id,
    concept_unit_session_db_id: input.concept_unit_session_db_id,
    client_operation_id: input.client_operation_id,
    client: input.client
  });

  const planningContext = await buildAuthoritativeFormativeTurnContext({
    ...input,
    agent_role: "formative_plan_update",
    staged_profile_output: profileOutput,
    client: input.client
  });
  const planningPackage = await contextResponsePackage({
    ...input,
    stage: "planning",
    context: planningContext
  });
  const planningCyclePublicId = `formative_turn_${hashStudentRuntimeValue({
    client_operation_id: input.client_operation_id,
    stage: "planning"
  }).slice(0, 24)}`;
  const planningOverride = input.orchestration_override
    ? await input.orchestration_override({
        context: planningContext,
        stage: "planning",
        staged_profile_output: profileOutput
      })
    : null;
  let planningResult: Awaited<ReturnType<typeof executeFormativePlanningCandidate>> | null = null;
  let planningFailureReasonCode: string | null = null;
  if (!planningOverride) {
    try {
      planningResult = await executeFormativePlanningCandidate({
        concept_unit_session_db_id: input.concept_unit_session_db_id,
        followup_evidence_package_db_id: planningPackage.id,
        staged_student_profile_output: profileOutput,
        previous_student_profile_db_id: current.profile.id,
        cycle_public_id: planningCyclePublicId,
        invocation_reason: "formative_activity_turn_plan_update"
      });
    } catch {
      planningResult = null;
      planningFailureReasonCode = "planning_candidate_execution_failed";
    }
  }
  const planningSucceeded = planningOverride?.stage === "planning" ||
    (planningResult?.status === "succeeded" && Boolean(planningResult.output));
  const planningOutput = planningOverride?.stage === "planning"
    ? planningOverride.output
    : planningResult?.status === "succeeded" && planningResult.output
      ? planningResult.output
      : carryForwardPlanningOutput(current.decision);
  const planningAgentCallId = planningOverride?.stage === "planning"
    ? planningOverride.agent_call_id
    : planningResult?.agent_call_id ?? null;
  const planningAudit: FormativeTurnStageAudit = {
    stage: "planning",
    update_failed: !planningSucceeded,
    stale_version_used: !planningSucceeded,
    fallback_source_version: planningSucceeded
      ? null
      : fallbackSourceVersion("plan", current.decision.id, current.decision.created_at),
    failure_agent_call_id: planningSucceeded ? null : planningAgentCallId,
    result_status: planningSucceeded ? "succeeded" : planningResult?.status ?? "execution_failed",
    failure_reason_code: planningSucceeded
      ? null
      : planningFailureReasonCode ?? `planning_${planningResult?.status ?? "execution_failed"}`
  };
  await persistFormativeTurnStageAudit({
    response_package: planningPackage,
    audit: planningAudit,
    assessment_session_db_id: current.assessment_session_db_id,
    concept_unit_session_db_id: input.concept_unit_session_db_id,
    client_operation_id: input.client_operation_id,
    client: input.client
  });

  const dialogueContext = await buildAuthoritativeFormativeTurnContext({
    ...input,
    agent_role: "student_facing_dialogue",
    staged_profile_output: profileOutput,
    staged_planning_output: planningOutput,
    client: input.client
  });
  return {
    profile_output: profileOutput,
    profile_agent_call_id: profileAgentCallId,
    profile_source_db_id: current.profile.id,
    planning_output: planningOutput,
    planning_agent_call_id: planningAgentCallId,
    planning_source_db_id: current.decision.id,
    profile_audit: profileAudit,
    planning_audit: planningAudit,
    dialogue_context: dialogueContext
  };
}

function itemRoleFromRules(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const role = (value as Record<string, unknown>).item_role;
  return typeof role === "string" && role.trim() ? role.trim() : null;
}

function inferTargetItemIndex(source: z.infer<typeof SourceActivityPacketRefSchema>) {
  if (source.target_item_index) {
    return source.target_item_index;
  }
  const match = /\bItem\s+(\d+)\b/i.exec(source.safe_activity_prompt);
  return match ? Number(match[1]) : null;
}

function inferTargetOptionLabel(source: z.infer<typeof SourceActivityPacketRefSchema>) {
  if (source.target_option_label) {
    return source.target_option_label;
  }
  const match = /\boption\s+([A-D])\b/i.exec(
    `${source.distractor_student_safe_description} ${source.safe_activity_prompt}`
  );
  return match?.[1]?.toUpperCase() ?? null;
}

function distractorFocusedGrowthTarget(input: {
  source: z.infer<typeof SourceActivityPacketRefSchema>;
  growth_target: string;
}) {
  const itemIndex = inferTargetItemIndex(input.source);
  const optionLabel = inferTargetOptionLabel(input.source);
  if (!itemIndex && !optionLabel) return input.growth_target;
  const anchor = [
    itemIndex ? `Item ${itemIndex}` : null,
    optionLabel ? `Option ${optionLabel}` : null
  ].filter(Boolean).join(", ");
  const distractorBoundary = input.source.distractor_student_safe_description?.trim();
  return `${anchor}: ${distractorBoundary || input.growth_target}`;
}

function boundedTopicDialogueRecoveryMessage(attempt: ActivityRuntimeAttempt) {
  const source = SourceActivityPacketRefSchema.safeParse(attempt.source_activity_packet_ref);
  if (!source.success) {
    return "I could not complete that review just now. Please try your response again about the current activity.";
  }
  const focus = distractorFocusedGrowthTarget({
    source: source.data,
    growth_target:
      source.data.target_construct_or_boundary ??
      source.data.distractor_student_safe_description
  });
  return `Let's stay with ${focus}. I could not complete that review just now, so please name one part of this option or distinction that is still unclear.`;
}

function studentSafeOptionText(options: Prisma.JsonValue, label: string) {
  for (const option of jsonArray(options)) {
    const entry = recordFromJson(option);
    if (String(entry.label ?? "").toUpperCase() === label.toUpperCase()) {
      const text = typeof entry.text === "string" ? entry.text.trim() : "";
      return text || null;
    }
  }
  return null;
}

async function deriveInitialDistractorAnchor(
  conceptUnitSessionDbId: string,
  client: PrismaClientLike
) {
  const temptingTurns = await client.conversationTurn.findMany({
    where: {
      concept_unit_session_db_id: conceptUnitSessionDbId,
      actor_type: "student",
      item_db_id: { not: null }
    },
    orderBy: [{ sequence_index: "desc" }],
    take: 50,
    select: {
      structured_payload: true,
      item: {
        select: {
          item_public_id: true,
          item_order: true,
          options: true,
          concept_unit: { select: { learning_objective: true } }
        }
      }
    }
  });
  for (const turn of temptingTurns) {
    const payload = recordFromJson(turn.structured_payload);
    const source = typeof payload.source === "string" ? payload.source : "";
    const label = typeof payload.tempting_option === "string"
      ? payload.tempting_option.trim().toUpperCase()
      : "";
    if (!turn.item || !label || !/initial_tempting_option|package_review_tempting_option/.test(source)) {
      continue;
    }
    const optionText = studentSafeOptionText(turn.item.options, label);
    return {
      target_item_index: turn.item.item_order,
      target_item_id: turn.item.item_public_id,
      target_option_label: label,
      target_construct_or_boundary: turn.item.concept_unit.learning_objective,
      distractor_student_safe_description: optionText
        ? `Option ${label} says: ${optionText}`.slice(0, 520)
        : `Option ${label} was the tempting alternative selected for review.`
    };
  }

  const responses = await client.itemResponse.findMany({
    where: { concept_unit_session_db_id: conceptUnitSessionDbId },
    orderBy: [{ created_at: "asc" }],
    include: {
      item: {
        select: {
          item_public_id: true,
          item_order: true,
          options: true,
          concept_unit: { select: { learning_objective: true } }
        }
      }
    }
  });
  const incorrect = responses.find((response) =>
    response.selected_option && response.selected_option !== response.correct_option_snapshot
  );
  if (!incorrect?.selected_option) return null;
  const label = incorrect.selected_option.toUpperCase();
  const optionText = studentSafeOptionText(incorrect.item.options, label);
  return {
    target_item_index: incorrect.item.item_order,
    target_item_id: incorrect.item.item_public_id,
    target_option_label: label,
    target_construct_or_boundary: incorrect.item.concept_unit.learning_objective,
    distractor_student_safe_description: optionText
      ? `Option ${label} says: ${optionText}`.slice(0, 520)
      : `Option ${label} was selected and is the current alternative under review.`
  };
}

async function enrichAttemptWithInitialDistractorAnchor(input: {
  attempt: ActivityRuntimeAttempt;
  concept_unit_session_db_id: string;
  client: PrismaClientLike;
}) {
  const anchor = await deriveInitialDistractorAnchor(input.concept_unit_session_db_id, input.client);
  if (!anchor) return input.attempt;
  return input.client.activityRuntimeAttempt.update({
    where: { id: input.attempt.id },
    data: {
      source_activity_packet_ref: prismaJson({
        ...recordFromJson(input.attempt.source_activity_packet_ref),
        ...anchor
      })
    }
  });
}

function nextAlternativeFamily(currentFamily: FormativeActivityFamily): FormativeActivityFamily {
  const currentIndex = alternativeFamilyOrder.indexOf(currentFamily);
  const nextIndex = currentIndex >= 0
    ? (currentIndex + 1) % alternativeFamilyOrder.length
    : 0;
  return alternativeFamilyOrder[nextIndex];
}

function promptForAlternativeActivity(input: {
  source: z.infer<typeof SourceActivityPacketRefSchema>;
  family: FormativeActivityFamily;
}) {
  const itemIndex = inferTargetItemIndex(input.source);
  const optionLabel = itemIndex ? inferTargetOptionLabel(input.source) : null;
  const itemPrefix = itemIndex ? `For Item ${itemIndex}, ` : "Using one answer from your first set, ";
  const optionPhrase = optionLabel ? `option ${optionLabel}` : "one tempting option";

  switch (input.family) {
    case "distractor_contrast":
      return {
        prompt: `${itemPrefix}${optionPhrase} may still feel plausible. Explain what makes it tempting, then name the key boundary that separates it from the idea you want to use.`,
        expected: "Write two or three sentences that compare the tempting idea with your own reasoning.",
        construct: "separating a tempting distractor from the target idea"
      };
    case "reasoning_chain_repair":
      return {
        prompt: `${itemPrefix}rewrite your explanation about ${optionPhrase} as two linked steps: first the idea that makes the option tempting, then the boundary that shows where its conclusion goes too far.`,
        expected: "Write the repaired explanation in the chat box.",
        construct: "linking evidence to a conclusion"
      };
    case "independent_reconstruction":
      return {
        prompt: `${itemPrefix}setting the option choices aside, explain in your own words the distinction that makes ${optionPhrase} misleading.`,
        expected: "Write a short explanation without using the answer choices.",
        construct: "explaining the idea without relying on the options"
      };
    case "confidence_evidence_audit":
      return {
        prompt: `${itemPrefix}consider ${optionPhrase}. Name the evidence that could make it seem convincing, then name the evidence that shows its boundary.`,
        expected: "Write a short confidence check in the chat box.",
        construct: "connecting confidence to evidence"
      };
    case "basic_concept_grounding":
      return {
        prompt: `${itemPrefix}start with the basic distinction behind ${optionPhrase}. In your own words, describe what belongs to the learner and what belongs to the item.`,
        expected: "Write a concise explanation of the distinction.",
        construct: "grounding the learner-versus-item distinction"
      };
    case "transfer_and_distractor_generation":
      return {
        prompt: `${itemPrefix}use the tempting idea in ${optionPhrase} to create a nearby example that could confuse someone. Then explain the boundary that would keep the example from being misleading.`,
        expected: "Write the example and the boundary in the chat box.",
        construct: "testing the idea in a nearby example"
      };
  }
}

function assertAlternativeActivityIsExecutable(input: {
  prompt: string;
  expected: string;
  targetItemIndex: number | null;
  targetOptionLabel: string | null;
}) {
  if (!/\b(write|explain|describe|name|create|rewrite)\b/i.test(`${input.prompt} ${input.expected}`)) {
    throw new StudentAssessmentServiceError(
      "validation_failed",
      "I could not safely prepare this activity right now.",
      409
    );
  }

  if (input.targetOptionLabel && !input.targetItemIndex) {
    throw new StudentAssessmentServiceError(
      "validation_failed",
      "I could not safely prepare this activity right now.",
      409
    );
  }

  if (/\b(workflow|runtime|routing|schema|fallback|recorded for this version|future version)\b/i.test(input.prompt)) {
    throw new StudentAssessmentServiceError(
      "validation_failed",
      "I could not safely prepare this activity right now.",
      409
    );
  }
}

async function activityDestinationAvailability(input: {
  attempt: ActivityRuntimeAttempt;
  client: PrismaClientLike;
}) {
  const session = await input.client.assessmentSession.findUnique({
    where: { session_public_id: input.attempt.session_public_id },
    select: {
      current_concept_unit_db_id: true,
      current_concept_unit: {
        select: {
          assessment_db_id: true,
          order_index: true
        }
      }
    }
  });

  if (!session?.current_concept_unit_db_id || !session.current_concept_unit) {
    return {
      transfer_item_available: false,
      next_concept_available: false
    };
  }

  const [candidateTransferItems, nextConceptCount] = await Promise.all([
    input.client.item.findMany({
      where: {
        concept_unit_db_id: session.current_concept_unit_db_id,
        included_in_published_set: false,
        status: { not: "archived" }
      },
      select: { administration_rules: true },
      orderBy: [{ item_order: "asc" }, { created_at: "asc" }]
    }),
    input.client.conceptUnit.count({
      where: {
        assessment_db_id: session.current_concept_unit.assessment_db_id,
        order_index: { gt: session.current_concept_unit.order_index },
        status: "published"
      }
    })
  ]);

  return {
    transfer_item_available: candidateTransferItems.some((item) =>
      itemRoleFromRules(item.administration_rules) === "transfer"
    ),
    next_concept_available: nextConceptCount > 0
  };
}

function feedbackOptionsForDestinations(input: {
  transfer_item_available: boolean;
  next_concept_available: boolean;
}) {
  const options: NonNullable<StudentActivityRuntimeProjection["feedback"]>["next_options"] = [];

  if (input.transfer_item_available) {
    options.push("continue to transfer item");
  }
  if (input.next_concept_available) {
    options.push("continue to next concept");
  }
  options.push("finish assessment");

  return options.slice(0, 3);
}

async function createAlternativeActivityAttempt(input: {
  source: z.infer<typeof SourceActivityPacketRefSchema>;
  attempt: ActivityRuntimeAttempt;
  assessment_session_db_id: string;
  concept_unit_session_db_id: string;
  client: PrismaClientLike;
}) {
  const family = nextAlternativeFamily(input.source.activity_family);
  const targetItemIndex = inferTargetItemIndex(input.source);
  const targetOptionLabel = targetItemIndex ? inferTargetOptionLabel(input.source) : null;
  const alternative = promptForAlternativeActivity({
    source: input.source,
    family
  });

  assertAlternativeActivityIsExecutable({
    prompt: alternative.prompt,
    expected: alternative.expected,
    targetItemIndex,
    targetOptionLabel
  });

  const earlierActivityWasShown = Boolean(await input.client.conversationTurn.findFirst({
    where: {
      assessment_session_db_id: input.assessment_session_db_id,
      actor_type: "agent",
      structured_payload: {
        path: ["activity_attempt_public_id"],
        equals: input.attempt.activity_attempt_public_id
      }
    },
    select: { id: true }
  }));
  const nextAttempt = await createActivityRuntimeAttemptFromEvidenceIntegratedRouter({
    session_public_id: input.attempt.session_public_id,
    student_public_id: input.attempt.student_public_id,
    assessment_public_id: input.attempt.assessment_public_id,
    concept_unit_id: input.attempt.concept_unit_id,
    activity_family:
      family === "distractor_contrast"
        ? "distractor_focused_activity"
        : family === "basic_concept_grounding"
          ? "foundational_support_activity"
          : "diagnostic_clarification",
    diagnostic_purpose:
      family === "distractor_contrast"
        ? "distractor_misconception_probe"
        : family === "reasoning_chain_repair"
          ? "reasoning_boundary_repair"
          : family === "basic_concept_grounding"
            ? "conceptual_entry_grounding"
            : "independent_misconception_verification",
    selected_formative_value: input.source.selected_formative_value,
    safe_activity_prompt: earlierActivityWasShown
      ? `Here is a different way to work on the same idea.\n\n${alternative.prompt}`
      : alternative.prompt,
    expected_student_action_prompt: alternative.expected,
    distractor_role: input.source.distractor_role,
    distractor_student_safe_description: input.source.distractor_student_safe_description,
    source_profile_integration_snapshot_id:
      input.source.source_profile_integration_snapshot_id ?? input.source.activity_packet_hash,
    source_formative_value_packet_id:
      input.source.source_formative_value_packet_id ?? input.source.activity_packet_hash,
    next_interaction_schema_version: "student-activity-runtime-alternative-v1",
    routing_policy_version: "student-requested-alternative-v1",
    activity_type: `student_requested_alternative_${family}`,
    routing_justification:
      "Student requested a different activity, so the runtime selected a different activity family with a chat-answerable prompt.",
    target_item_index: targetItemIndex,
    target_item_id: input.source.target_item_id ?? null,
    target_option_label: targetOptionLabel,
    target_construct_or_boundary:
      input.source.target_construct_or_boundary ?? alternative.construct,
    student_task_prompt: alternative.prompt,
    expected_response_mode: "free_text",
    rationale_for_selection:
      "Student requested a different activity; this activity uses a different response pattern while staying anchored to the same response package.",
    semantic_deduplication_key: hashStudentRuntimeValue({
      family,
      source_attempt: input.attempt.activity_attempt_public_id,
      prompt: alternative.prompt
    }),
    replaced_activity_attempt_public_id: input.attempt.activity_attempt_public_id,
    activity_switch_reason: "student_requested_different_activity",
    limitations: []
  }, input.client);
  await ensureActivityPromptVisible({
    attempt: nextAttempt,
    assessment_session_db_id: input.assessment_session_db_id,
    concept_unit_session_db_id: input.concept_unit_session_db_id,
    client: input.client
  });
  return nextAttempt;
}

async function assertActiveStudentAccount(studentUserDbId: string, client: PrismaClientLike) {
  const user = await client.user.findUnique({
    where: { id: studentUserDbId },
    select: { role: true, account_status: true }
  });

  if (!user || user.role !== "student" || user.account_status !== "active") {
    throw new StudentAssessmentServiceError(
      "account_unavailable",
      "This account is currently unavailable.",
      403
    );
  }
}

async function ownedSessionContext(input: {
  student_user_db_id: string;
  session_public_id: string;
  client: PrismaClientLike;
}) {
  await assertActiveStudentAccount(input.student_user_db_id, input.client);
  const session = await input.client.assessmentSession.findFirst({
    where: {
      session_public_id: input.session_public_id,
      user_db_id: input.student_user_db_id
    },
    select: {
      id: true,
      session_public_id: true,
      current_phase: true,
      current_concept_unit_db_id: true,
      user: { select: { user_id: true } },
      assessment: { select: { assessment_public_id: true } },
      current_concept_unit: {
        select: {
          concept_unit_public_id: true,
          title: true,
          learning_objective: true
        }
      }
    }
  });

  if (!session) {
    throw new StudentAssessmentServiceError(
      "session_not_owned",
      "Session was not found for this student.",
      403
    );
  }

  if (!session.current_concept_unit_db_id || !session.current_concept_unit) {
    throw new StudentAssessmentServiceError(
      "concept_unit_not_current",
      "No current concept unit is set for this session.",
      409
    );
  }

  const conceptUnitSession = await input.client.conceptUnitSession.findUnique({
    where: {
      assessment_session_db_id_concept_unit_db_id: {
        assessment_session_db_id: session.id,
        concept_unit_db_id: session.current_concept_unit_db_id
      }
    },
    select: {
      id: true,
      initial_completed_at: true
    }
  });

  if (!conceptUnitSession) {
    throw new StudentAssessmentServiceError(
      "concept_unit_not_current",
      "Current concept-unit session was not found.",
      409
    );
  }

  return {
    session,
    concept_unit_session: conceptUnitSession
  };
}

async function latestAttemptForSession(sessionPublicId: string, client: PrismaClientLike) {
  return client.activityRuntimeAttempt.findFirst({
    where: { session_public_id: sessionPublicId },
    orderBy: [{ created_at: "desc" }]
  });
}

type LatestEvidenceContext = {
  feedback: StudentActivityRuntimeProjection["feedback"];
  decision: PostActivityLearningDecisionV1 | null;
  packet: ActivityMisconceptionEvidencePacketV1 | null;
};

async function latestEvidenceContext(
  attempt: ActivityRuntimeAttempt,
  source: z.infer<typeof SourceActivityPacketRefSchema> | null,
  client: PrismaClientLike
): Promise<LatestEvidenceContext> {
  if (!attempt.latest_evidence_record_public_id) {
    return { feedback: null, decision: null, packet: null };
  }

  const record = await client.activityMisconceptionEvidenceRecord.findUnique({
    where: { evidence_public_id: attempt.latest_evidence_record_public_id },
    select: {
      student_safe_feedback: true,
      evidence_packet: true
    }
  });
  const feedbackParsed = FeedbackSchema.safeParse(record?.student_safe_feedback);
  const packetParsed = ActivityMisconceptionEvidencePacketV1Schema.safeParse(record?.evidence_packet);
  const packet = packetParsed.success ? packetParsed.data : null;
  const dialoguePolicy = getTopicDialoguePolicy();
  const decision = packet && source
    ? buildPostActivityLearningDecision({
        activity_public_id: attempt.activity_attempt_public_id,
        growth_target:
          source.target_construct_or_boundary ??
          source.distractor_student_safe_description,
        evidence_packet: packet,
        maximum_dialogue_turns: dialoguePolicy.maximum_student_turns
      })
    : null;

  return {
    feedback: feedbackParsed.success ? normalizeRuntimeFeedback(feedbackParsed.data) : null,
    decision,
    packet
  };
}

function recordFromJson(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringFromRecord(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function dialogueTurnPayload(value: unknown) {
  const record = recordFromJson(value);
  return {
    message_type: stringFromRecord(record.message_type),
    topic_dialogue_public_id: stringFromRecord(record.topic_dialogue_public_id),
    dialogue_turn_number: typeof record.dialogue_turn_number === "number"
      ? record.dialogue_turn_number
      : null,
    client_operation_id: stringFromRecord(record.client_operation_id),
    next_action: stringFromRecord(record.next_action),
    topic_boundary: stringFromRecord(record.topic_boundary)
  };
}

async function latestTopicDialogueProjection(input: {
  attempt: ActivityRuntimeAttempt;
  source: z.infer<typeof SourceActivityPacketRefSchema> | null;
  decision: PostActivityLearningDecisionV1 | null;
  client: PrismaClientLike;
}): Promise<StudentActivityRuntimeProjection["topic_dialogue"]> {
  if (!input.source || !input.decision) {
    return null;
  }

  const dialoguePublicId = topicDialoguePublicId({
    session_public_id: input.attempt.session_public_id,
    activity_attempt_public_id: input.attempt.activity_attempt_public_id
  });
  const turns = await input.client.conversationTurn.findMany({
    where: {
      assessment_session: { session_public_id: input.attempt.session_public_id },
      structured_payload: { path: ["topic_dialogue_public_id"], equals: dialoguePublicId }
    },
    orderBy: [{ sequence_index: "asc" }],
    select: {
      actor_type: true,
      message_text: true,
      structured_payload: true
    }
  });
  const tutorTurns = turns.filter((turn) => turn.actor_type === "agent");
  const latestTutor = tutorTurns.at(-1) ?? null;
  const latestPayload = latestTutor ? dialogueTurnPayload(latestTutor.structured_payload) : null;
  const studentTurnCount = turns.filter((turn) => turn.actor_type === "student").length;

  if (
    latestPayload?.next_action === "show_progression_choices" ||
    latestPayload?.next_action === "continue_to_transfer" ||
    latestPayload?.next_action === "continue_to_next_topic"
  ) {
    return {
      dialogue_public_id: dialoguePublicId,
      state: "ready_to_advance",
      turn_number: studentTurnCount,
      maximum_turns: input.decision.maximum_dialogue_turns,
      tutor_message: latestTutor?.message_text ?? null,
      response_prompt: null,
      remaining_issue: null,
      next_action: latestPayload.next_action,
      topic_boundary: latestPayload.topic_boundary === "redirected_to_topic"
        ? "redirected_to_topic"
        : "inside_scope"
    };
  }

  if (!latestPayload && input.decision.post_activity_status === "ready_to_advance") {
    return {
      dialogue_public_id: dialoguePublicId,
      state: "ready_to_advance",
      turn_number: studentTurnCount,
      maximum_turns: input.decision.maximum_dialogue_turns,
      tutor_message: null,
      response_prompt: null,
      remaining_issue: null,
      next_action: "show_progression_choices",
      topic_boundary: "inside_scope"
    };
  }

  if (
    studentTurnCount >= input.decision.maximum_dialogue_turns ||
    latestPayload?.next_action === "show_final_support_options"
  ) {
    return {
      dialogue_public_id: dialoguePublicId,
      state: "final_support",
      turn_number: studentTurnCount,
      maximum_turns: input.decision.maximum_dialogue_turns,
      tutor_message:
        latestTutor?.message_text ??
        `The main issue to keep working on is ${input.decision.growth_target}. You can continue to the next available step, or end the assessment now.`,
      response_prompt: null,
      remaining_issue: input.decision.remaining_issue,
      next_action: "show_final_support_options",
      topic_boundary: latestPayload?.topic_boundary === "redirected_to_topic"
        ? "redirected_to_topic"
        : "inside_scope"
    };
  }

  return {
    dialogue_public_id: dialoguePublicId,
    state: "awaiting_response",
    turn_number: studentTurnCount,
    maximum_turns: input.decision.maximum_dialogue_turns,
      tutor_message:
        latestTutor?.message_text ??
        `Focus on this part: ${input.decision.growth_target}`,
    response_prompt: "Write one short response or ask one question about this topic.",
    remaining_issue: input.decision.remaining_issue,
    next_action: "await_topic_dialogue_response",
    topic_boundary: latestPayload?.topic_boundary === "redirected_to_topic"
      ? "redirected_to_topic"
      : "inside_scope"
  };
}

function projectionForNoAttempt(): StudentActivityRuntimeProjection {
  const projection: StudentActivityRuntimeProjection = {
    available: false,
    activity_attempt_public_id: null,
    ui_state: "not_started",
    status_message: "The next activity will appear when it is ready.",
    focus_label: null,
    first_turn_message: null,
    response_prompt: null,
    helper_text: "Wait for the next prompt before responding.",
    allowed_actions: [],
    can_start: false,
    can_submit_response: false,
    can_choose_another_activity: false,
    can_move_on: false,
    can_continue: false,
    message_max_chars: ACTIVITY_RUNTIME_MAX_RESPONSE_CHARS,
    feedback: null,
    first_turn_visible_in_transcript: false,
    latest_reply_visible_in_transcript: false,
    topic_dialogue: null,
    next_recommendation_label: null,
    alternative_activity_labels: alternativeActivityLabels
  };
  assertStudentActivityRuntimeProjectionIsSafe(projection);
  return projection;
}

function projectionForStartFailure(): StudentActivityRuntimeProjection {
  const projection: StudentActivityRuntimeProjection = {
    available: false,
    activity_attempt_public_id: null,
    ui_state: "could_not_prepare_activity_safely",
    status_message: "I could not safely prepare this activity right now.",
    focus_label: null,
    first_turn_message: null,
    response_prompt: null,
    helper_text: "You can try again, choose another activity, or end the assessment.",
    allowed_actions: ["start_activity", "choose_another_activity", "finish_assessment"],
    can_start: true,
    can_submit_response: false,
    can_choose_another_activity: true,
    can_move_on: true,
    can_continue: false,
    message_max_chars: ACTIVITY_RUNTIME_MAX_RESPONSE_CHARS,
    feedback: {
      message: "I could not safely prepare this activity right now. You can try again, choose another activity, or end the assessment.",
      next_options: ["continue", "choose another activity", "finish assessment"]
    },
    first_turn_visible_in_transcript: false,
    latest_reply_visible_in_transcript: false,
    topic_dialogue: null,
    next_recommendation_label: null,
    alternative_activity_labels: alternativeActivityLabels
  };
  assertStudentActivityRuntimeProjectionIsSafe(projection);
  return projection;
}

function sourceFromAttempt(attempt: ActivityRuntimeAttempt) {
  const parsed = SourceActivityPacketRefSchema.safeParse(attempt.source_activity_packet_ref);
  return parsed.success ? parsed.data : null;
}

async function ensureActivityPromptVisible(input: {
  attempt: ActivityRuntimeAttempt;
  assessment_session_db_id: string;
  concept_unit_session_db_id: string;
  client: PrismaClientLike;
}) {
  const source = sourceFromAttempt(input.attempt);
  if (!source) return false;
  const existing = await input.client.conversationTurn.findFirst({
    where: {
      assessment_session_db_id: input.assessment_session_db_id,
      actor_type: "agent",
      structured_payload: {
        path: ["activity_attempt_public_id"],
        equals: input.attempt.activity_attempt_public_id
      }
    },
    select: { id: true }
  });
  if (existing) return true;
  const message = [source.safe_activity_prompt, source.expected_student_action_prompt]
    .filter(Boolean)
    .join("\n\n");
  await input.client.conversationTurn.create({
    data: {
      assessment_session_db_id: input.assessment_session_db_id,
      concept_unit_session_db_id: input.concept_unit_session_db_id,
      phase: "planning_completed",
      actor_type: "agent",
      agent_name: FORMATIVE_ACTIVITY_AGENT_NAME,
      message_text: message,
      structured_payload: prismaJson({
        message_type: "formative_activity_prompt",
        activity_attempt_public_id: input.attempt.activity_attempt_public_id,
        source_agent_call_id: input.attempt.first_turn_agent_call_db_id,
        visibility_status: "shown",
        activity_family: input.attempt.activity_family,
        replaced_activity_attempt_public_id:
          source.replaced_activity_attempt_public_id ?? null
      })
    }
  });
  return true;
}

function uiStateForAttempt(attempt: ActivityRuntimeAttempt):
  StudentActivityRuntimeProjection["ui_state"] {
  switch (attempt.status) {
    case "awaiting_student_activity_response":
      return "waiting_for_your_response";
    case "student_activity_response_received":
    case "evidence_evaluation_pending":
    case "evidence_evaluated":
    case "evidence_persisted":
    case "post_activity_snapshot_created":
      return "reviewing_your_response";
    case "continue_recommended":
      return "feedback_ready";
    case "choose_alternative_recommended":
      return "alternative_requested";
    case "move_on_recommended":
      return "moved_on";
    case "failed_closed":
      return "could_not_review_response_safely";
    default:
      return "activity_ready";
  }
}

async function projectionForAttempt(
  attempt: ActivityRuntimeAttempt,
  client: PrismaClientLike,
  loopResult?: ActivityRuntimeLoopResult
): Promise<StudentActivityRuntimeProjection> {
  const source = sourceFromAttempt(attempt);
  const evidence = await latestEvidenceContext(attempt, source, client);
  const feedback = loopResult?.student_safe_feedback ?? evidence.feedback;
  const uiState = uiStateForAttempt(attempt);
  const topicDialogue = await latestTopicDialogueProjection({
    attempt,
    source,
    decision: evidence.decision,
    client
  });
  const topicDialogueActive =
    topicDialogue?.state === "awaiting_response" ||
    topicDialogue?.state === "final_support";
  const shouldResolveDestinations =
    uiState === "feedback_ready" &&
    (!topicDialogueActive || topicDialogue?.state === "final_support");
  const destinations = shouldResolveDestinations
    ? await activityDestinationAvailability({ attempt, client })
    : { transfer_item_available: false, next_concept_available: false };
  const feedbackWithDestinations = uiState === "feedback_ready" && !topicDialogueActive
    ? {
        message: feedback?.message ?? "Nice work. You can continue when you are ready.",
        next_options: feedbackOptionsForDestinations(destinations)
      }
    : topicDialogueActive
      ? {
          message:
            topicDialogue?.tutor_message ??
            "Let us work through the remaining part of this idea together.",
          next_options: topicDialogue?.state === "final_support"
            ? ([
                ...(destinations.transfer_item_available ? ["continue to transfer item" as const] : []),
                "finish assessment" as const
              ])
            : ["continue" as const]
        }
    : feedback;
  const focusLabel = source
    ? studentActivityFocusLabel({
        diagnostic_purpose: source.diagnostic_purpose,
        selected_formative_value: source.selected_formative_value,
        activity_family: source.activity_family
      })
    : "Work on this idea";
  const recommendation =
    loopResult?.next_runtime_recommendation ??
    (attempt.status === "move_on_recommended"
        ? "move_on"
      : attempt.status === "choose_alternative_recommended"
        ? "choose_alternative_activity"
        : attempt.status === "failed_closed"
          ? "failed_closed"
          : null);
  const [firstTurnVisible, latestReplyVisible] = await Promise.all([
    client.conversationTurn.findFirst({
      where: {
        assessment_session: { session_public_id: attempt.session_public_id },
        actor_type: "agent",
        structured_payload: {
          path: ["activity_attempt_public_id"],
          equals: attempt.activity_attempt_public_id
        },
        agent_name: FORMATIVE_ACTIVITY_AGENT_NAME
      },
      select: { id: true }
    }),
    client.conversationTurn.findFirst({
      where: {
        assessment_session: { session_public_id: attempt.session_public_id },
        actor_type: "agent",
        agent_name: TOPIC_DIALOGUE_AGENT_NAME,
        structured_payload: {
          path: ["activity_attempt_public_id"],
          equals: attempt.activity_attempt_public_id
        }
      },
      orderBy: [{ sequence_index: "desc" }],
      select: { id: true }
    })
  ]);

  const projection: StudentActivityRuntimeProjection = {
    available: Boolean(source) && attempt.status !== "failed_closed",
    activity_attempt_public_id: attempt.activity_attempt_public_id,
    ui_state: uiState,
    status_message:
      uiState === "waiting_for_your_response"
        ? "Activity ready"
        : uiState === "reviewing_your_response"
          ? "Reviewing your response"
          : uiState === "feedback_ready"
            ? "Feedback ready"
            : uiState === "moved_on"
              ? "Assessment ended"
              : uiState === "alternative_requested"
                ? "Preparing a different activity"
                : uiState === "could_not_review_response_safely"
                  ? "I could not safely review this response right now."
                  : "Activity ready",
    focus_label: focusLabel,
    first_turn_message: source?.safe_activity_prompt ?? null,
    response_prompt: source?.expected_student_action_prompt ?? null,
    helper_text:
      uiState === "could_not_review_response_safely"
        ? "You can try again, choose another activity, or end the assessment."
        : "Write a short response in your own words.",
    allowed_actions:
      topicDialogue?.state === "awaiting_response"
        ? ["submit_topic_dialogue_response", "finish_assessment"]
        : topicDialogue?.state === "final_support"
          ? [
              ...(destinations.transfer_item_available ? ["skip_activity_to_transfer" as const] : []),
              ...(destinations.next_concept_available ? ["skip_activity_to_next_concept" as const] : []),
              "finish_assessment" as const
            ]
        : uiState === "waiting_for_your_response"
        ? ["submit_response", "choose_another_activity", "finish_assessment"]
        : uiState === "feedback_ready"
          ? [
              ...(destinations.transfer_item_available ? ["skip_activity_to_transfer" as const] : []),
              ...(destinations.next_concept_available ? ["skip_activity_to_next_concept" as const] : []),
              "finish_assessment" as const
            ]
          : uiState === "could_not_review_response_safely"
            ? ["submit_response", "choose_another_activity", "finish_assessment"]
            : ["choose_another_activity", "finish_assessment"],
    can_start: false,
    can_submit_response:
      topicDialogue?.state === "awaiting_response" ||
      uiState === "waiting_for_your_response" ||
      uiState === "could_not_review_response_safely",
    can_choose_another_activity:
      !topicDialogueActive &&
      uiState !== "moved_on" && uiState !== "reviewing_your_response" && uiState !== "feedback_ready",
    can_move_on: uiState !== "reviewing_your_response" && uiState !== "moved_on",
    can_continue:
      uiState === "feedback_ready" &&
      (!topicDialogueActive || topicDialogue?.state === "final_support") &&
      (destinations.transfer_item_available || destinations.next_concept_available),
    message_max_chars: ACTIVITY_RUNTIME_MAX_RESPONSE_CHARS,
    feedback:
      feedbackWithDestinations ??
      (uiState === "alternative_requested"
        ? {
            message: "I am preparing a different activity.",
            next_options: ["continue"]
          }
        : uiState === "moved_on"
          ? {
              message: "The assessment has ended for this attempt.",
              next_options: ["return to assessment summary"]
            }
          : uiState === "could_not_review_response_safely"
            ? {
                message: "I could not safely review this response right now. You can try again, choose another activity, or end the assessment.",
                next_options: ["continue", "choose another activity", "skip this activity and continue"]
              }
            : null),
    first_turn_visible_in_transcript: Boolean(firstTurnVisible),
    latest_reply_visible_in_transcript: Boolean(latestReplyVisible),
    topic_dialogue: topicDialogue,
    next_recommendation_label: studentActivityRecommendationLabel(recommendation),
    alternative_activity_labels: alternativeActivityLabels
  };
  assertStudentActivityRuntimeProjectionIsSafe(projection);
  return projection;
}

async function latestValidatedLiveActivityPacket(input: {
  assessment_session_db_id: string;
  session_public_id: string;
  client: PrismaClientLike;
}) {
  const calls = await input.client.agentCall.findMany({
    where: {
      assessment_session_db_id: input.assessment_session_db_id,
      agent_name: FORMATIVE_ACTIVITY_AGENT_NAME,
      provider: "openai",
      call_status: "succeeded",
      output_validated: true,
      output_payload: { not: Prisma.JsonNull }
    },
    orderBy: [{ created_at: "desc" }],
    take: 10,
    select: { id: true, output_payload: true }
  });

  for (const call of calls) {
    const parsed = FormativeActivityPacketV1Schema.safeParse(call.output_payload);
    if (parsed.success && parsed.data.session_public_id === input.session_public_id) {
      return {
        packet: parsed.data,
        agent_call_id: call.id
      };
    }
  }

  return null;
}

export async function getStudentActivityRuntimeState(input: {
  student_user_db_id: string;
  session_public_id: string;
  client?: PrismaClientLike;
}) {
  const client = input.client ?? prisma;
  const context = await ownedSessionContext({
    student_user_db_id: input.student_user_db_id,
    session_public_id: input.session_public_id,
    client
  });
  const attempt = await latestAttemptForSession(input.session_public_id, client);

  if (attempt) {
    await ensureActivityPromptVisible({
      attempt,
      assessment_session_db_id: context.session.id,
      concept_unit_session_db_id: context.concept_unit_session.id,
      client
    });
  }

  return attempt ? projectionForAttempt(attempt, client) : projectionForNoAttempt();
}

export async function startStudentActivityForSession(input: {
  student_user_db_id: string;
  session_public_id: string;
  activity_generation_override?: StudentActivityRuntimeGenerationOverride;
  client?: PrismaClientLike;
}) {
  const client = input.client ?? prisma;
  const context = await ownedSessionContext({
    student_user_db_id: input.student_user_db_id,
    session_public_id: input.session_public_id,
    client
  });

  if (!context.concept_unit_session.initial_completed_at) {
    throw new StudentAssessmentServiceError(
      "conflict",
      "The activity is not available until the initial responses are complete.",
      409
    );
  }

  const existingAttempt = await latestAttemptForSession(input.session_public_id, client);
  if (existingAttempt) {
    await ensureActivityPromptVisible({
      attempt: existingAttempt,
      assessment_session_db_id: context.session.id,
      concept_unit_session_db_id: context.concept_unit_session.id,
      client
    });
    return projectionForAttempt(existingAttempt, client);
  }

  try {
    const existingPacket = await latestValidatedLiveActivityPacket({
      assessment_session_db_id: context.session.id,
      session_public_id: input.session_public_id,
      client
    });
    let packet: FormativeActivityPacketV1;
    let firstTurnAgentCallId: string;
    let reviewerAgentCallId: string | null = null;
    let repairAgentCallId: string | null = null;

    if (existingPacket) {
      packet = existingPacket.packet;
      firstTurnAgentCallId = existingPacket.agent_call_id;
    } else {
      const profileIntegrationPacket = await buildProfileIntegrationInterpretationPacketForSession(
        input.session_public_id,
        { execution_mode: "deterministic_mock" }
      );
      const formativeValuePacket = await buildFormativeValueDeterminationPacketForSession(
        input.session_public_id,
        { execution_mode: "deterministic_mock" }
      );
      const result = input.activity_generation_override
        ? await input.activity_generation_override({
            profile_integration_packet: profileIntegrationPacket,
            formative_value_packet: formativeValuePacket
          })
        : await executeLiveFormativeActivityDialogueAgent({
            profile_integration_packet: profileIntegrationPacket,
            formative_value_packet: formativeValuePacket
          });

      if (result.status !== "succeeded") {
        await logProcessEvent({
          assessment_session_db_id: context.session.id,
          concept_unit_session_db_id: context.concept_unit_session.id,
          event_type: "student_activity_runtime_start_failed",
          event_category: "formative_activity_runtime",
          event_source: "backend",
          payload: {
            blocked_reason: result.blocked_reason,
            issue_count: result.validation_issues.length
          }
        });
        return projectionForStartFailure();
      }

      packet = result.packet;
      firstTurnAgentCallId = result.repair_agent_call_id ?? result.generator_agent_call_id;
      reviewerAgentCallId = result.reviewer_agent_call_id;
      repairAgentCallId = result.repair_agent_call_id ?? null;
    }

    const createdAttempt = await createActivityRuntimeAttemptFromLiveActivityPacket({
      activity_packet: packet,
      first_turn_agent_call_db_id: firstTurnAgentCallId,
      reviewer_agent_call_db_id: reviewerAgentCallId,
      repair_agent_call_db_id: repairAgentCallId,
      limitations: []
    }, client);
    const attempt = await enrichAttemptWithInitialDistractorAnchor({
      attempt: createdAttempt,
      concept_unit_session_db_id: context.concept_unit_session.id,
      client
    });
    await ensureActivityPromptVisible({
      attempt,
      assessment_session_db_id: context.session.id,
      concept_unit_session_db_id: context.concept_unit_session.id,
      client
    });

    await logProcessEvent({
      assessment_session_db_id: context.session.id,
      concept_unit_session_db_id: context.concept_unit_session.id,
      event_type: "student_activity_runtime_started",
      event_category: "formative_activity_runtime",
      event_source: "backend",
      payload: {
        activity_attempt_public_id: attempt.activity_attempt_public_id,
        source: "live_llm_activity_packet"
      }
    });

    return projectionForAttempt(attempt, client);
  } catch (error) {
    await logProcessEvent({
      assessment_session_db_id: context.session.id,
      concept_unit_session_db_id: context.concept_unit_session.id,
      event_type: "student_activity_runtime_start_failed",
      event_category: "formative_activity_runtime",
      event_source: "backend",
      payload: {
        blocked_reason: error instanceof Error ? error.message : "unknown_activity_start_error"
      }
    });
    return projectionForStartFailure();
  }
}

export async function submitStudentActivityRuntimeResponse(input: {
  student_user_db_id: string;
  session_public_id: string;
  activity_attempt_public_id: string;
  response_text: string;
  client_message_id: string;
  evaluator_override?: StudentActivityRuntimeEvaluatorOverride;
  orchestration_override?: StudentActivityTurnOrchestrationOverride;
  client?: PrismaClientLike;
}) {
  const client = input.client ?? prisma;
  await ownedSessionContext({
    student_user_db_id: input.student_user_db_id,
    session_public_id: input.session_public_id,
    client
  });
  const message = input.response_text.trim();

  if (!message) {
    throw new StudentAssessmentServiceError(
      "validation_failed",
      "Enter a response before sending.",
      400
    );
  }
  const dialoguePolicy = getTopicDialoguePolicy();
  if (message.length > dialoguePolicy.maximum_student_message_chars) {
    throw new StudentAssessmentServiceError(
      "validation_failed",
      `Keep the response under ${dialoguePolicy.maximum_student_message_chars} characters.`,
      400
    );
  }

  const attempt = await client.activityRuntimeAttempt.findUniqueOrThrow({
    where: { activity_attempt_public_id: input.activity_attempt_public_id }
  });
  if (attempt.session_public_id !== input.session_public_id) {
    throw new StudentAssessmentServiceError(
      "validation_failed",
      "This activity is no longer current.",
      409
    );
  }
  return submitTopicDialogueResponse({
    student_user_db_id: input.student_user_db_id,
    session_public_id: input.session_public_id,
    dialogue_public_id: topicDialoguePublicId({
      session_public_id: attempt.session_public_id,
      activity_attempt_public_id: attempt.activity_attempt_public_id
    }),
    activity_attempt_public_id: attempt.activity_attempt_public_id,
    student_message: message,
    client_operation_id: input.client_message_id,
    evaluator_override: input.evaluator_override,
    orchestration_override: input.orchestration_override,
    client
  });
}

export async function reopenFormativeEpisodeAfterTransferFailure(input: {
  student_user_db_id: string;
  session_public_id: string;
  transfer_item_public_id: string;
  client_operation_id: string;
  client?: PrismaClientLike;
}) {
  const client = input.client ?? prisma;
  const context = await ownedSessionContext({
    student_user_db_id: input.student_user_db_id,
    session_public_id: input.session_public_id,
    client
  });
  const transferResponse = await client.itemResponse.findFirst({
    where: {
      concept_unit_session_db_id: context.concept_unit_session.id,
      item: { item_public_id: input.transfer_item_public_id }
    },
    select: {
      selected_option: true,
      correct_option_snapshot: true,
      reasoning_text: true
    }
  });
  if (
    !transferResponse?.selected_option ||
    transferResponse.selected_option === transferResponse.correct_option_snapshot
  ) {
    return { reopened: false as const, reason: "transfer_evidence_did_not_fail" };
  }

  const attempt = await latestAttemptForSession(input.session_public_id, client);
  const source = attempt ? sourceFromAttempt(attempt) : null;
  if (!attempt || !source) {
    return { reopened: false as const, reason: "formative_activity_attempt_missing" };
  }
  const message = transferResponse.reasoning_text?.trim() ||
    "The transfer response did not yet apply the current distinction.";
  const staged = await runFormativeTurnProfileAndPlan({
    session_public_id: input.session_public_id,
    concept_unit_session_db_id: context.concept_unit_session.id,
    activity_attempt_public_id: attempt.activity_attempt_public_id,
    latest_student_message: message,
    client_operation_id: input.client_operation_id,
    evidence_record_public_id: attempt.latest_evidence_record_public_id,
    client
  });
  const explicitTarget = [
    source.target_item_index ? `Item ${source.target_item_index}` : null,
    source.target_option_label ? `option ${source.target_option_label}` : null
  ].filter(Boolean).join(", ");
  const embeddedTarget = source.distractor_student_safe_description.match(
    /^(Item\s+\d+)\s+option\s+([A-D])/iu
  );
  const target = explicitTarget || (embeddedTarget
    ? `${embeddedTarget[1]}, option ${embeddedTarget[2]}`
    : "the current item and distractor");
  const tutorMessage =
    `The transfer response shows that the distinction behind ${target} still needs work. ` +
    "Explain how the item feature differs from the person attribute in this new case.";

  await client.$transaction(async (tx) => {
    const profile = staged.profile_audit.stale_version_used
      ? { id: staged.profile_source_db_id }
      : await tx.studentProfile.create({
          data: studentProfileCreateData({
            concept_unit_session_db_id: context.concept_unit_session.id,
            based_on_agent_call_db_id: staged.profile_agent_call_id,
            output: staged.profile_output
          })
        });
    const decision = staged.planning_audit.stale_version_used
      ? { id: staged.planning_source_db_id }
      : await tx.formativeDecision.create({
          data: formativeDecisionCreateData({
            concept_unit_session_db_id: context.concept_unit_session.id,
            student_profile_db_id: profile.id,
            based_on_agent_call_db_id: staged.planning_agent_call_id,
            output: staged.planning_output
          })
        });
    await tx.conceptUnitSession.update({
      where: { id: context.concept_unit_session.id },
      data: {
        status: "followup_active",
        latest_student_profile_db_id: profile.id,
        latest_formative_decision_db_id: decision.id
      }
    });
    const latestRound = await tx.followupRound.findFirst({
      where: { concept_unit_session_db_id: context.concept_unit_session.id },
      orderBy: [{ round_index: "desc" }],
      select: { id: true, started_at: true }
    });
    if (latestRound) {
      await tx.followupRound.update({
        where: { id: latestRound.id },
        data: {
          status: "active",
          formative_decision_db_id: decision.id,
          updated_student_profile_db_id: profile.id,
          started_at: latestRound.started_at ?? new Date(),
          completed_at: null,
          evidence_trigger_type: "transfer_failure"
        }
      });
    }
    await tx.activityRuntimeAttempt.update({
      where: { id: attempt.id },
      data: {
        status: "awaiting_student_activity_response",
        completed_at: null,
        limitations: prismaJson([
          ...jsonArray(attempt.limitations),
          "transfer_failure_reopened_formative_episode"
        ])
      }
    });
    await tx.topicDialogue.updateMany({
      where: {
        assessment_session_db_id: context.session.id,
        activity_attempt_public_id: attempt.activity_attempt_public_id
      },
      data: {
        status: "active",
        current_remaining_issue: "Transfer evidence did not yet apply the current distinction."
      }
    });
    await tx.conversationTurn.create({
      data: {
        assessment_session_db_id: context.session.id,
        concept_unit_session_db_id: context.concept_unit_session.id,
        phase: "planning_completed",
        actor_type: "agent",
        agent_name: TOPIC_DIALOGUE_AGENT_NAME,
        message_text: tutorMessage,
        structured_payload: prismaJson({
          message_type: "topic_dialogue_tutor",
          topic_dialogue_public_id: topicDialoguePublicId({
            session_public_id: attempt.session_public_id,
            activity_attempt_public_id: attempt.activity_attempt_public_id
          }),
          activity_attempt_public_id: attempt.activity_attempt_public_id,
          client_operation_id: input.client_operation_id,
          visibility_status: "shown",
          response_function: "misconception_contrast",
          next_action: "await_topic_dialogue_response",
          next_runtime_state: "AWAIT_TOPIC_DIALOGUE_RESPONSE",
          progression_readiness: "not_ready",
          readiness_gate: {
            ready: false,
            reason_code: "transfer_evidence_failed"
          },
          turn_orchestration_audit: {
            profile: staged.profile_audit,
            planning: staged.planning_audit
          }
        })
      }
    });
  });
  const phase = await updateAssessmentSessionPhase({
    assessment_session_db_id: context.session.id,
    to_phase: "planning_completed",
    reason: "transfer_failure_reopened_formative_episode",
    payload: { transfer_item_public_id: input.transfer_item_public_id }
  });
  if (!phase.transition.allowed) {
    throw new Error("transfer_failure_formative_reentry_transition_rejected");
  }
  await logProcessEvent({
    assessment_session_db_id: context.session.id,
    concept_unit_session_db_id: context.concept_unit_session.id,
    event_type: "transfer_failure_returned_to_formative_dialogue",
    event_category: "formative_activity_runtime",
    event_source: "backend",
    payload: {
      activity_attempt_public_id: attempt.activity_attempt_public_id,
      transfer_item_public_id: input.transfer_item_public_id,
      client_operation_id: input.client_operation_id,
      profile_update_failed: staged.profile_audit.update_failed,
      planning_update_failed: staged.planning_audit.update_failed
    }
  });
  return {
    reopened: true as const,
    activity_attempt_public_id: attempt.activity_attempt_public_id,
    profile_updated: !staged.profile_audit.update_failed,
    planning_updated: !staged.planning_audit.update_failed
  };
}

async function claimFormativeTurn(input: {
  assessment_session_db_id: string;
  client_operation_id: string;
  activity_attempt_public_id: string;
  message: string;
  client: PrismaClientLike;
}) {
  const requestHash = hashStudentRuntimeValue({
    activity_attempt_public_id: input.activity_attempt_public_id,
    message: input.message
  });
  const where = {
    assessment_session_db_id_client_action_id: {
      assessment_session_db_id: input.assessment_session_db_id,
      client_action_id: input.client_operation_id
    }
  };
  const existing = await input.client.studentActionIdempotencyKey.findUnique({ where });
  if (existing) {
    if (existing.request_hash !== requestHash) {
      throw new StudentAssessmentServiceError(
        "idempotency_conflict",
        "This message identifier was already used for a different response.",
        409
      );
    }
    const payload = recordFromJson(existing.response_payload);
    return {
      already_seen: true,
      completed: payload.status === "completed",
      resume_allowed:
        payload.status !== "completed" &&
        Date.now() - existing.updated_at.getTime() >= 120_000
    };
  }
  try {
    await input.client.studentActionIdempotencyKey.create({
      data: {
        assessment_session_db_id: input.assessment_session_db_id,
        client_action_id: input.client_operation_id,
        action_type: "formative_activity_turn",
        request_hash: requestHash,
        response_payload: prismaJson({
          status: "processing",
          activity_attempt_public_id: input.activity_attempt_public_id,
          started_at: new Date().toISOString()
        })
      }
    });
    return { already_seen: false, completed: false, resume_allowed: true };
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
      throw error;
    }
    const raced = await input.client.studentActionIdempotencyKey.findUniqueOrThrow({ where });
    if (raced.request_hash !== requestHash) {
      throw new StudentAssessmentServiceError(
        "idempotency_conflict",
        "This message identifier was already used for a different response.",
        409
      );
    }
    return { already_seen: true, completed: false, resume_allowed: false };
  }
}

async function completedFormativeTurnReplay(input: {
  assessment_session_db_id: string;
  client_operation_id: string;
  activity_attempt_public_id: string;
  message: string;
  client: PrismaClientLike;
}) {
  const requestHash = hashStudentRuntimeValue({
    activity_attempt_public_id: input.activity_attempt_public_id,
    message: input.message
  });
  const existing = await input.client.studentActionIdempotencyKey.findUnique({
    where: {
      assessment_session_db_id_client_action_id: {
        assessment_session_db_id: input.assessment_session_db_id,
        client_action_id: input.client_operation_id
      }
    }
  });
  if (!existing) return { completed: false as const, projection: null };
  if (existing.request_hash !== requestHash) {
    throw new StudentAssessmentServiceError(
      "idempotency_conflict",
      "This message identifier was already used for a different response.",
      409
    );
  }
  const payload = recordFromJson(existing.response_payload);
  if (payload.status !== "completed") {
    return { completed: false as const, projection: null };
  }
  const cachedProjection = StudentActivityRuntimeProjectionSchema.safeParse(
    payload.completed_projection
  );
  return {
    completed: true as const,
    projection: cachedProjection.success ? cachedProjection.data : null
  };
}

async function claimActivityAttemptForTurn(input: {
  attempt: ActivityRuntimeAttempt;
  claim: Awaited<ReturnType<typeof claimFormativeTurn>>;
  assessment_session_db_id: string;
  client_operation_id: string;
  client: PrismaClientLike;
}) {
  const claimableStatuses = input.claim.already_seen && input.claim.resume_allowed
    ? [
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
      ]
    : [
        "awaiting_student_activity_response",
        "continue_recommended",
        "choose_alternative_recommended",
        "move_on_recommended"
      ];
  const claimed = await input.client.activityRuntimeAttempt.updateMany({
    where: {
      id: input.attempt.id,
      status: { in: claimableStatuses }
    },
    data: {
      status: "student_activity_response_received",
      completed_at: null
    }
  });
  if (claimed.count === 1) return;

  if (!input.claim.already_seen) {
    await input.client.studentActionIdempotencyKey.deleteMany({
      where: {
        assessment_session_db_id: input.assessment_session_db_id,
        client_action_id: input.client_operation_id,
        action_type: "formative_activity_turn"
      }
    });
  }
  throw new StudentAssessmentServiceError(
    "conflict",
    "Please wait for the current response before sending another message.",
    409
  );
}

async function processTopicDialogueResponse(input: {
  student_user_db_id: string;
  session_public_id: string;
  dialogue_public_id: string;
  activity_attempt_public_id?: string;
  student_message: string;
  client_operation_id: string;
  expected_dialogue_version?: string | null;
  evaluator_override?: StudentActivityRuntimeEvaluatorOverride;
  orchestration_override?: StudentActivityTurnOrchestrationOverride;
  client?: PrismaClientLike;
}) {
  const client = input.client ?? prisma;
  const context = await ownedSessionContext({
    student_user_db_id: input.student_user_db_id,
    session_public_id: input.session_public_id,
    client
  });
  const message = input.student_message.trim();
  const dialoguePolicy = getTopicDialoguePolicy();

  if (!message) {
    throw new StudentAssessmentServiceError(
      "validation_failed",
      "Enter a response before sending.",
      400
    );
  }
  if (message.length > dialoguePolicy.maximum_student_message_chars) {
    throw new StudentAssessmentServiceError(
      "validation_failed",
      `Keep the response under ${dialoguePolicy.maximum_student_message_chars} characters.`,
      400
    );
  }

  const attempt = input.activity_attempt_public_id
    ? await client.activityRuntimeAttempt.findUnique({
        where: { activity_attempt_public_id: input.activity_attempt_public_id }
      })
    : await latestAttemptForSession(input.session_public_id, client);
  const source = attempt ? sourceFromAttempt(attempt) : null;
  if (!attempt || !source) {
    throw new StudentAssessmentServiceError(
      "conflict",
      "There is no active topic dialogue for this assessment.",
      409
    );
  }
  const expectedDialoguePublicId = topicDialoguePublicId({
    session_public_id: attempt.session_public_id,
    activity_attempt_public_id: attempt.activity_attempt_public_id
  });
  if (input.dialogue_public_id !== expectedDialoguePublicId) {
    throw new StudentAssessmentServiceError(
      "validation_failed",
      "This topic dialogue is no longer current.",
      409
    );
  }

  const completedReplay = await completedFormativeTurnReplay({
    assessment_session_db_id: context.session.id,
    client_operation_id: input.client_operation_id,
    activity_attempt_public_id: attempt.activity_attempt_public_id,
    message,
    client
  });
  if (completedReplay.completed) {
    return completedReplay.projection ?? projectionForAttempt(attempt, client);
  }
  if (context.session.current_phase === "session_completed") {
    throw new StudentAssessmentServiceError(
      "conflict",
      "This formative episode has already ended.",
      409
    );
  }
  const currentConcept = context.session.current_concept_unit;
  if (!currentConcept) {
    throw new StudentAssessmentServiceError(
      "concept_unit_not_current",
      "No current concept unit is set for this session.",
      409
    );
  }

  const claim = await claimFormativeTurn({
    assessment_session_db_id: context.session.id,
    client_operation_id: input.client_operation_id,
    activity_attempt_public_id: attempt.activity_attempt_public_id,
    message,
    client
  });
  if (claim.completed) {
    return projectionForAttempt(attempt, client);
  }
  await claimActivityAttemptForTurn({
    attempt,
    claim,
    assessment_session_db_id: context.session.id,
    client_operation_id: input.client_operation_id,
    client
  });

  const existingStudentTurn = await client.conversationTurn.findFirst({
    where: {
      assessment_session_db_id: context.session.id,
      structured_payload: {
        path: ["client_operation_id"],
        equals: input.client_operation_id
      }
    },
    select: { id: true, structured_payload: true }
  });

  const priorTurns = await client.conversationTurn.findMany({
    where: {
      assessment_session_db_id: context.session.id,
      structured_payload: { path: ["topic_dialogue_public_id"], equals: input.dialogue_public_id }
    },
    orderBy: [{ sequence_index: "asc" }],
    select: {
      id: true,
      actor_type: true,
      message_text: true,
      structured_payload: true
    }
  });
  if (claim.already_seen && !claim.resume_allowed) {
    return projectionForAttempt(attempt, client);
  }
  const existingTurnPayload = recordFromJson(existingStudentTurn?.structured_payload);
  const priorStudentTurns = priorTurns.filter((turn) =>
    turn.actor_type === "student" && turn.id !== existingStudentTurn?.id
  ).length;
  const dialogueTurnNumber = typeof existingTurnPayload.dialogue_turn_number === "number"
    ? existingTurnPayload.dialogue_turn_number
    : priorStudentTurns + 1;
  if (!existingStudentTurn) {
    await client.conversationTurn.create({
      data: {
        assessment_session_db_id: context.session.id,
        concept_unit_session_db_id: context.concept_unit_session.id,
        phase: "planning_completed",
        actor_type: "student",
        message_text: message,
        structured_payload: prismaJson({
          message_type: "topic_dialogue_student",
          topic_dialogue_public_id: input.dialogue_public_id,
          dialogue_turn_number: dialogueTurnNumber,
          client_operation_id: input.client_operation_id,
          activity_attempt_public_id: attempt.activity_attempt_public_id,
          visibility_status: "shown",
          dialogue_schema_version: input.expected_dialogue_version ?? TOPIC_DIALOGUE_INPUT_SCHEMA_VERSION
        })
      }
    });
  }

  if (priorStudentTurns === 0 && !existingStudentTurn) {
    await logProcessEvent({
      assessment_session_db_id: context.session.id,
      concept_unit_session_db_id: context.concept_unit_session.id,
      event_type: "topic_dialogue_started",
      event_category: "topic_dialogue",
      event_source: "frontend",
      payload: {
        topic_dialogue_public_id: input.dialogue_public_id,
        dialogue_turn_number: dialogueTurnNumber,
        client_operation_id: input.client_operation_id
      }
    });
  }

  await logProcessEvent({
    assessment_session_db_id: context.session.id,
    concept_unit_session_db_id: context.concept_unit_session.id,
    event_type: "topic_dialogue_response_submitted",
    event_category: "topic_dialogue",
    event_source: "frontend",
    payload: {
      topic_dialogue_public_id: input.dialogue_public_id,
      dialogue_turn_number: dialogueTurnNumber,
      client_operation_id: input.client_operation_id
    }
  });
  await logProcessEvent({
    assessment_session_db_id: context.session.id,
    concept_unit_session_db_id: context.concept_unit_session.id,
    event_type: "student_activity_response_submitted",
    event_category: "formative_activity_runtime",
    event_source: "frontend",
    payload: {
      activity_attempt_public_id: attempt.activity_attempt_public_id,
      client_operation_id: input.client_operation_id
    }
  });

  const interpretationContext = await buildAuthoritativeFormativeTurnContext({
    session_public_id: input.session_public_id,
    concept_unit_session_db_id: context.concept_unit_session.id,
    activity_attempt_public_id: attempt.activity_attempt_public_id,
    latest_student_message: message,
    client_operation_id: input.client_operation_id,
    agent_role: "response_interpretation",
    client
  });
  const loopResult = await submitStudentActivityResponseForEvidenceUpdate({
    activity_attempt_public_id: attempt.activity_attempt_public_id,
    session_public_id: input.session_public_id,
    student_response_text: message,
    student_choice_state: "continue",
    formative_turn_context: interpretationContext,
    allow_additional_turn: true,
    attempt_already_claimed: true,
    defer_final_attempt_activation: true,
    evaluator_override: input.evaluator_override
  }, client);
  if (loopResult.status !== "ok") {
    throw new Error(`formative_turn_evaluation_failed:${loopResult.limitations.join("|")}`);
  }
  const refreshedAttempt = await client.activityRuntimeAttempt.findUniqueOrThrow({
    where: { id: attempt.id }
  });
  const evidence = await latestEvidenceContext(refreshedAttempt, source, client);
  if (!evidence.decision) {
    throw new Error("formative_turn_post_activity_decision_missing");
  }
  const learningDecision = evidence.decision;
  await logProcessEvent({
    assessment_session_db_id: context.session.id,
    concept_unit_session_db_id: context.concept_unit_session.id,
    event_type: "post_activity_decision_created",
    event_category: "topic_dialogue",
    event_source: "backend",
    payload: {
      activity_attempt_public_id: attempt.activity_attempt_public_id,
      decision_version: POST_ACTIVITY_LEARNING_DECISION_VERSION,
      post_activity_status: learningDecision.post_activity_status,
      recommended_route: learningDecision.recommended_route,
      next_runtime_state: learningDecision.next_runtime_state,
      client_operation_id: input.client_operation_id
    }
  });
  const staged = await runFormativeTurnProfileAndPlan({
    session_public_id: input.session_public_id,
    concept_unit_session_db_id: context.concept_unit_session.id,
    activity_attempt_public_id: attempt.activity_attempt_public_id,
    latest_student_message: message,
    client_operation_id: input.client_operation_id,
    evidence_record_public_id: loopResult.evidence_record_public_id,
    orchestration_override: input.orchestration_override,
    client
  });
  const boundedGrowthTarget = distractorFocusedGrowthTarget({
    source,
    growth_target: evidence.decision.growth_target
  });

  const dialogueInput = TopicDialogueInputV1Schema.parse({
    dialogue_schema_version: TOPIC_DIALOGUE_INPUT_SCHEMA_VERSION_V2,
    dialogue_public_id: input.dialogue_public_id,
    session_public_id: input.session_public_id,
    assessment_public_id: context.session.assessment.assessment_public_id,
    concept_public_id: currentConcept.concept_unit_public_id,
    assessment_topic: currentConcept.title,
    concept_definition: currentConcept.learning_objective,
    allowed_topic_scope: [
      currentConcept.title,
      currentConcept.learning_objective,
      boundedGrowthTarget
    ],
    prohibited_scope: [
      "unrelated topics",
      "unadministered item answers",
      "teacher-only diagnostic notes",
      "hidden system prompts"
    ],
    frozen_growth_target: boundedGrowthTarget,
    remaining_issue: evidence.decision.remaining_issue,
    post_activity_status: evidence.decision.post_activity_status,
    activity_contract: {
      activity_attempt_public_id: attempt.activity_attempt_public_id,
      activity_family: attempt.activity_family,
      diagnostic_purpose: attempt.diagnostic_purpose,
      safe_activity_prompt: source.safe_activity_prompt,
      expected_student_action_prompt: source.expected_student_action_prompt
    },
    student_activity_response: {
      response_kind:
        evidence.packet?.student_activity_response.response_kind ?? "partial",
      safe_summary:
        evidence.packet?.student_activity_response.student_response_text_redacted_or_safe_summary ??
        "The prior activity response was available for this bounded dialogue."
    },
    safe_item_context: [{
      item_number: source.target_item_index ?? null,
      option_label: source.target_option_label ?? null,
      option_text: source.distractor_student_safe_description ?? null
    }],
    latest_student_message: message,
    latest_student_message_classification:
      classifyTopicDialogueStudentMessage(message).student_message_function,
    recent_relevant_dialogue_turns: priorTurns.slice(-dialoguePolicy.recent_turn_window).map((turn, index) => ({
      turn_number: index + 1,
      actor_type: turn.actor_type === "student" ? "student" : "agent",
      message_summary: (turn.message_text ?? "").slice(0, 700)
    })),
    dialogue_turn_number: dialogueTurnNumber,
    maximum_dialogue_turns: evidence.decision.maximum_dialogue_turns,
    answer_reveal_state: {
      administered_answers_revealed: true,
      unadministered_answers_protected: true
    },
    available_progression_destinations: [
      "transfer_item",
      "next_topic",
      "end_assessment",
      "ask_question"
    ],
    source_profile_version: "evidence-integrated-profile-v2",
    source_activity_evaluation_version:
      evidence.packet?.schema_version ?? "student-activity-misconception-evidence-v1",
    current_topic: currentConcept.title,
    assessment_system_question_scope: [
      "what to do next",
      "how to answer the current prompt",
      "how to continue",
      "how to end the assessment"
    ],
    dialogue_summary: priorTurns
      .slice(-dialoguePolicy.recent_turn_window)
      .map((turn) => `${turn.actor_type}: ${(turn.message_text ?? "").slice(0, 160)}`)
      .join(" | ") || "This is the first topic-dialogue response for the current activity.",
    progression_options: [
      "continue with this topic",
      "choose another activity",
      "continue to transfer item when available",
      "end assessment"
    ],
    source_versions: {
      topic_dialogue_input_schema_version: TOPIC_DIALOGUE_INPUT_SCHEMA_VERSION_V2,
      topic_dialogue_output_schema_version: TOPIC_DIALOGUE_OUTPUT_SCHEMA_VERSION_V2,
      topic_dialogue_policy_version: "topic-dialogue-policy-v2"
    }
  });
  const iterativeDialogueRole = formativeDialogueRoute("first_activity_response").role;
  const topicDialogueLiveEnabled = resolveOperationalRoleLiveCallsEnabled(iterativeDialogueRole);
  if (topicDialogueLiveEnabled) {
    await logProcessEvent({
      assessment_session_db_id: context.session.id,
      concept_unit_session_db_id: context.concept_unit_session.id,
      event_type: "topic_dialogue_live_call_started",
      event_category: "topic_dialogue",
      event_source: "backend",
      payload: {
        topic_dialogue_public_id: input.dialogue_public_id,
        dialogue_turn_number: dialogueTurnNumber,
        output_schema_version: TOPIC_DIALOGUE_OUTPUT_SCHEMA_VERSION_V2
      }
    });
  }
  const dialogueRequestInput = {
    ...dialogueInput,
    formative_turn_context: staged.dialogue_context
  };
  const dialogueInvocationKey =
    `topic-dialogue:${input.dialogue_public_id}:${input.client_operation_id}`;
  const existingDialogueCall = await client.agentCall.findUnique({
    where: { agent_invocation_key: dialogueInvocationKey },
    select: { id: true, call_status: true, output_validated: true, output_payload: true }
  });
  const reusableDialogueOutput = existingDialogueCall?.call_status === "succeeded" &&
    existingDialogueCall.output_validated
    ? TopicDialogueOutputV1Schema.safeParse(existingDialogueCall.output_payload)
    : null;
  const liveResult = reusableDialogueOutput?.success
    ? {
        status: "succeeded" as const,
        output: reusableDialogueOutput.data,
        agent_call_id: existingDialogueCall!.id,
        provider: "openai" as const,
        model_config: null
      }
    : existingDialogueCall
      ? {
          status: "not_attempted" as const,
          blocked_reason: "existing_dialogue_call_not_reusable"
        }
    : await executeStudentRuntimeLiveAgent({
        client,
        live_enabled: topicDialogueLiveEnabled,
        role: iterativeDialogueRole,
        agent_name: iterativeDialogueRole,
        agent_version: TOPIC_DIALOGUE_PROMPT_VERSION,
        prompt_version: TOPIC_DIALOGUE_PROMPT_VERSION,
        prompt_hash: TOPIC_DIALOGUE_PROMPT_HASH,
        schema_version: TOPIC_DIALOGUE_OUTPUT_SCHEMA_VERSION_V2,
        schema_name: TOPIC_DIALOGUE_OUTPUT_SCHEMA_VERSION_V2,
        instructions: TOPIC_DIALOGUE_PROMPT_INSTRUCTIONS,
        request_input: dialogueRequestInput,
        output_schema: TopicDialogueOutputV1Schema,
        invocation_key: dialogueInvocationKey,
        assessment_session_db_id: context.session.id,
        concept_unit_session_db_id: context.concept_unit_session.id,
        metadata: {
          dialogue_public_id: input.dialogue_public_id,
          schema_version: TOPIC_DIALOGUE_OUTPUT_SCHEMA_VERSION_V2
        }
      });
  const output = liveResult.status === "succeeded"
    ? liveResult.output
    : buildDeterministicTopicDialogueResponse(dialogueInput);
  const validation = validateTopicDialogueOutput(output);
  const validatedOutput: TopicDialogueOutputV1 = validation.valid
    ? output
    : buildDeterministicTopicDialogueResponse({
        ...dialogueInput,
        latest_student_message: "Please keep the discussion on this assessment topic."
      });
  const readinessResult = applyTopicDialogueReadinessGate({
    dialogue_input: dialogueInput,
    candidate_output: validatedOutput
  });
  const persistedOutput = readinessResult.output;
  const fallbackUsed = liveResult.status !== "succeeded" || !validation.valid;
  const agentCall = liveResult.status === "succeeded"
    ? await client.agentCall.update({
        where: { id: liveResult.agent_call_id },
        data: {
          output_payload: prismaJson(persistedOutput),
          output_validated: validation.valid,
          validation_error: validation.valid
            ? null
            : validation.issues.map((issue) => {
                const blocked = "blocked_pattern_label" in issue ? issue.blocked_pattern_label : undefined;
                return `${issue.field_path}:${blocked ?? issue.rule_code}`;
              }).join("; "),
          call_status: validation.valid ? "succeeded" : "invalid_output"
        }
      })
    : existingDialogueCall
      ? await client.agentCall.update({
          where: { id: existingDialogueCall.id },
          data: {
            output_payload: prismaJson(persistedOutput),
            raw_output: prismaJson(persistedOutput),
            output_validated: validation.valid,
            validation_error: validation.valid
              ? null
              : validation.issues.map((issue) => {
                  const blocked = "blocked_pattern_label" in issue
                    ? issue.blocked_pattern_label
                    : undefined;
                  return `${issue.field_path}:${blocked ?? issue.rule_code}`;
                }).join("; "),
            blocked_reason: "existing_dialogue_call_not_reusable",
            call_status: validation.valid ? "succeeded" : "invalid_output",
            completed_at: new Date()
          }
        })
      : await client.agentCall.create({
        data: {
          assessment_session_db_id: context.session.id,
          concept_unit_session_db_id: context.concept_unit_session.id,
          agent_name: iterativeDialogueRole,
          agent_version: TOPIC_DIALOGUE_PROMPT_VERSION,
          model_name: "deterministic_topic_dialogue_fallback",
          provider: "mock",
          agent_invocation_key: `topic-dialogue:${input.dialogue_public_id}:${input.client_operation_id}`,
          prompt_version: TOPIC_DIALOGUE_PROMPT_VERSION,
          schema_version: TOPIC_DIALOGUE_OUTPUT_SCHEMA_VERSION_V2,
          prompt_hash: TOPIC_DIALOGUE_PROMPT_HASH,
          input_payload: prismaJson(dialogueRequestInput),
          output_payload: prismaJson(persistedOutput),
          raw_output: prismaJson(persistedOutput),
          output_validated: validation.valid,
          validation_error: validation.valid
            ? null
            : validation.issues.map((issue) => {
                const blocked = "blocked_pattern_label" in issue ? issue.blocked_pattern_label : undefined;
                return `${issue.field_path}:${blocked ?? issue.rule_code}`;
              }).join("; "),
          blocked_reason:
            liveResult.status === "not_attempted" ? liveResult.blocked_reason : undefined,
          call_status: validation.valid ? "succeeded" : "invalid_output",
          live_call_allowed: false,
          started_at: new Date(),
          completed_at: new Date()
        }
      });

  await client.$transaction(async (tx) => {
    const profile = staged.profile_audit.stale_version_used
      ? { id: staged.profile_source_db_id }
      : await tx.studentProfile.create({
          data: studentProfileCreateData({
            concept_unit_session_db_id: context.concept_unit_session.id,
            based_on_agent_call_db_id: staged.profile_agent_call_id,
            output: staged.profile_output
          })
        });
    const decision = staged.planning_audit.stale_version_used
      ? { id: staged.planning_source_db_id }
      : await tx.formativeDecision.create({
          data: formativeDecisionCreateData({
            concept_unit_session_db_id: context.concept_unit_session.id,
            student_profile_db_id: profile.id,
            based_on_agent_call_db_id: staged.planning_agent_call_id,
            output: staged.planning_output
          })
        });
    await tx.topicDialogue.upsert({
      where: {
        assessment_session_db_id_activity_attempt_public_id: {
          assessment_session_db_id: context.session.id,
          activity_attempt_public_id: attempt.activity_attempt_public_id
        }
      },
      update: {
        current_remaining_issue: persistedOutput.remaining_issue,
        current_turn: dialogueTurnNumber,
        status:
          persistedOutput.next_action === "show_progression_choices" ||
          persistedOutput.next_action === "show_final_support_options"
            ? "ready_for_progression"
            : "active"
      },
      create: {
        dialogue_public_id: input.dialogue_public_id,
        assessment_session_db_id: context.session.id,
        concept_unit_session_db_id: context.concept_unit_session.id,
        activity_attempt_public_id: attempt.activity_attempt_public_id,
        topic_anchor: prismaJson({
          assessment_topic: currentConcept.title,
          concept_public_id: currentConcept.concept_unit_public_id,
          safe_item_context: dialogueInput.safe_item_context
        }),
        growth_target: boundedGrowthTarget,
        initial_remaining_issue: learningDecision.remaining_issue,
        current_remaining_issue: persistedOutput.remaining_issue,
        maximum_turns: learningDecision.maximum_dialogue_turns,
        current_turn: dialogueTurnNumber,
        status:
          persistedOutput.next_action === "show_progression_choices" ||
          persistedOutput.next_action === "show_final_support_options"
            ? "ready_for_progression"
            : "active",
        policy_version: "topic-dialogue-policy-v2"
      }
    });
    await tx.topicDialogueTurn.upsert({
      where: {
        dialogue_public_id_turn_number_actor_type: {
          dialogue_public_id: input.dialogue_public_id,
          turn_number: dialogueTurnNumber,
          actor_type: "student"
        }
      },
      update: {},
      create: {
        dialogue_public_id: input.dialogue_public_id,
        assessment_session_db_id: context.session.id,
        concept_unit_session_db_id: context.concept_unit_session.id,
        activity_attempt_public_id: attempt.activity_attempt_public_id,
        turn_number: dialogueTurnNumber,
        actor_type: "student",
        message_function: dialogueInput.latest_student_message_classification ?? null,
        topic_relation: classifyTopicDialogueStudentMessage(message).topic_relation,
        message_text: message,
        structured_payload: prismaJson({
          client_operation_id: input.client_operation_id,
          input_schema_version: TOPIC_DIALOGUE_INPUT_SCHEMA_VERSION_V2
        })
      }
    });
    await tx.conversationTurn.create({
      data: {
        assessment_session_db_id: context.session.id,
        concept_unit_session_db_id: context.concept_unit_session.id,
        phase: "planning_completed",
        actor_type: "agent",
        agent_name: TOPIC_DIALOGUE_AGENT_NAME,
        message_text: persistedOutput.tutor_message,
        structured_payload: prismaJson({
          message_type: "topic_dialogue_tutor",
          topic_dialogue_public_id: input.dialogue_public_id,
          activity_attempt_public_id: attempt.activity_attempt_public_id,
          dialogue_turn_number: dialogueTurnNumber,
          client_operation_id: input.client_operation_id,
          agent_call_id: agentCall.id,
          visibility_status: "shown",
          response_function: persistedOutput.response_function,
          evidence_update: persistedOutput.evidence_update,
          evidence_sufficiency: persistedOutput.evidence_sufficiency,
          topic_boundary: persistedOutput.topic_boundary,
          next_action: persistedOutput.next_action,
          next_runtime_state: persistedOutput.next_runtime_state,
          progression_readiness: persistedOutput.progression_readiness,
          student_message_function: persistedOutput.student_message_function ?? null,
          topic_relation: persistedOutput.topic_relation ?? null,
          system_question_answered: persistedOutput.system_question_answered ?? false,
          post_turn_understanding: persistedOutput.post_turn_understanding ?? null,
          requires_student_response: persistedOutput.requires_student_response ?? null,
          expected_response_guidance: persistedOutput.expected_response_guidance ?? null,
          safety_flags: persistedOutput.safety_flags ?? [],
          schema_version: persistedOutput.schema_version ?? TOPIC_DIALOGUE_OUTPUT_SCHEMA_VERSION,
          fallback_used: fallbackUsed,
          fallback_version: TOPIC_DIALOGUE_FALLBACK_VERSION,
          boundary_validator_version: TOPIC_DIALOGUE_BOUNDARY_VALIDATOR_VERSION,
          readiness_gate: readinessResult.gate,
          readiness_gate_overrode_candidate: readinessResult.overridden,
          turn_orchestration_audit: {
            profile: staged.profile_audit,
            planning: staged.planning_audit
          }
        })
      }
    });
    await tx.topicDialogueTurn.upsert({
      where: {
        dialogue_public_id_turn_number_actor_type: {
          dialogue_public_id: input.dialogue_public_id,
          turn_number: dialogueTurnNumber,
          actor_type: "agent"
        }
      },
      update: {},
      create: {
        dialogue_public_id: input.dialogue_public_id,
        assessment_session_db_id: context.session.id,
        concept_unit_session_db_id: context.concept_unit_session.id,
        activity_attempt_public_id: attempt.activity_attempt_public_id,
        turn_number: dialogueTurnNumber,
        actor_type: "agent",
        message_function: persistedOutput.student_message_function ?? null,
        topic_relation: persistedOutput.topic_relation ?? null,
        system_question_answered: persistedOutput.system_question_answered ?? false,
        evidence_update: persistedOutput.evidence_update,
        remaining_issue: persistedOutput.remaining_issue,
        post_turn_understanding: persistedOutput.post_turn_understanding ?? null,
        next_action: persistedOutput.next_action,
        next_runtime_state: persistedOutput.next_runtime_state,
        progression_readiness: persistedOutput.progression_readiness,
        requires_student_response: persistedOutput.requires_student_response ?? null,
        fallback_used: fallbackUsed,
        agent_call_db_id: agentCall.id,
        message_text: persistedOutput.tutor_message,
        structured_payload: prismaJson({
          ...persistedOutput,
          readiness_gate: readinessResult.gate,
          readiness_gate_overrode_candidate: readinessResult.overridden
        })
      }
    });
    await tx.conceptUnitSession.update({
      where: { id: context.concept_unit_session.id },
      data: {
        latest_student_profile_db_id: profile.id,
        latest_formative_decision_db_id: decision.id
      }
    });
    await tx.activityRuntimeAttempt.update({
      where: { id: attempt.id },
      data: {
        status: loopResult.runtime_state === "move_on_recommended"
          ? "continue_recommended"
          : loopResult.runtime_state,
        completed_at: new Date()
      }
    });
    await tx.studentActionIdempotencyKey.update({
      where: {
        assessment_session_db_id_client_action_id: {
          assessment_session_db_id: context.session.id,
          client_action_id: input.client_operation_id
        }
      },
      data: {
        response_payload: prismaJson({
          status: "completed",
          activity_attempt_public_id: attempt.activity_attempt_public_id,
          dialogue_turn_number: dialogueTurnNumber,
          visible_reply_persisted: true,
          completed_at: new Date().toISOString()
        })
      }
    });
  });

  await logProcessEvent({
    assessment_session_db_id: context.session.id,
    concept_unit_session_db_id: context.concept_unit_session.id,
    event_type: "topic_dialogue_response_generated",
    event_category: "topic_dialogue",
    event_source: "backend",
    payload: {
      topic_dialogue_public_id: input.dialogue_public_id,
      dialogue_turn_number: dialogueTurnNumber,
      response_function: persistedOutput.response_function,
      next_action: persistedOutput.next_action,
      topic_boundary: persistedOutput.topic_boundary,
      agent_call_id: agentCall.id,
      fallback_used: fallbackUsed,
      readiness_gate: readinessResult.gate,
      readiness_gate_overrode_candidate: readinessResult.overridden
    }
  });
  if (liveResult.status === "succeeded" && validation.valid) {
    await logProcessEvent({
      assessment_session_db_id: context.session.id,
      concept_unit_session_db_id: context.concept_unit_session.id,
      event_type: "topic_dialogue_live_call_completed",
      event_category: "topic_dialogue",
      event_source: "backend",
      payload: {
        topic_dialogue_public_id: input.dialogue_public_id,
        dialogue_turn_number: dialogueTurnNumber,
        agent_call_id: agentCall.id
      }
    });
  }
  if (fallbackUsed) {
    await logProcessEvent({
      assessment_session_db_id: context.session.id,
      concept_unit_session_db_id: context.concept_unit_session.id,
      event_type: "topic_dialogue_fallback_used",
      event_category: "topic_dialogue",
      event_source: "backend",
      payload: {
        topic_dialogue_public_id: input.dialogue_public_id,
        dialogue_turn_number: dialogueTurnNumber,
        reason:
          liveResult.status === "not_attempted"
            ? liveResult.blocked_reason
            : validation.valid
              ? "live_call_failed"
              : "topic_dialogue_output_validation_failed"
      }
    });
  }
  if (persistedOutput.student_message_function === "clarification_request") {
    await logProcessEvent({
      assessment_session_db_id: context.session.id,
      concept_unit_session_db_id: context.concept_unit_session.id,
      event_type: "topic_dialogue_clarification_requested",
      event_category: "topic_dialogue",
      event_source: "backend",
      payload: {
        topic_dialogue_public_id: input.dialogue_public_id,
        dialogue_turn_number: dialogueTurnNumber
      }
    });
  }
  if (persistedOutput.system_question_answered) {
    await logProcessEvent({
      assessment_session_db_id: context.session.id,
      concept_unit_session_db_id: context.concept_unit_session.id,
      event_type: "topic_dialogue_system_question_answered",
      event_category: "topic_dialogue",
      event_source: "backend",
      payload: {
        topic_dialogue_public_id: input.dialogue_public_id,
        dialogue_turn_number: dialogueTurnNumber
      }
    });
  }
  if (persistedOutput.topic_boundary === "redirected_to_topic") {
    await logProcessEvent({
      assessment_session_db_id: context.session.id,
      concept_unit_session_db_id: context.concept_unit_session.id,
      event_type: "topic_dialogue_boundary_redirected",
      event_category: "topic_dialogue",
      event_source: "backend",
      payload: {
        topic_dialogue_public_id: input.dialogue_public_id,
        dialogue_turn_number: dialogueTurnNumber
      }
    });
    await logProcessEvent({
      assessment_session_db_id: context.session.id,
      concept_unit_session_db_id: context.concept_unit_session.id,
      event_type: "topic_dialogue_off_topic_redirected",
      event_category: "topic_dialogue",
      event_source: "backend",
      payload: {
        topic_dialogue_public_id: input.dialogue_public_id,
        dialogue_turn_number: dialogueTurnNumber
      }
    });
  }
  if (persistedOutput.next_action === "show_progression_choices") {
    await logProcessEvent({
      assessment_session_db_id: context.session.id,
      concept_unit_session_db_id: context.concept_unit_session.id,
      event_type: "topic_dialogue_ready_to_advance",
      event_category: "topic_dialogue",
      event_source: "backend",
      payload: {
        topic_dialogue_public_id: input.dialogue_public_id,
        dialogue_turn_number: dialogueTurnNumber
      }
    });
  }
  if (dialogueTurnNumber >= evidence.decision.maximum_dialogue_turns) {
    await logProcessEvent({
      assessment_session_db_id: context.session.id,
      concept_unit_session_db_id: context.concept_unit_session.id,
      event_type: "topic_dialogue_turn_limit_reached",
      event_category: "topic_dialogue",
      event_source: "backend",
      payload: {
        topic_dialogue_public_id: input.dialogue_public_id,
        dialogue_turn_number: dialogueTurnNumber,
        maximum_dialogue_turns: evidence.decision.maximum_dialogue_turns
      }
    });
  }

  const committedAttempt = await client.activityRuntimeAttempt.findUniqueOrThrow({
    where: { id: attempt.id }
  });
  const completedProjection = await projectionForAttempt(committedAttempt, client);
  await client.studentActionIdempotencyKey.update({
    where: {
      assessment_session_db_id_client_action_id: {
        assessment_session_db_id: context.session.id,
        client_action_id: input.client_operation_id
      }
    },
    data: {
      response_payload: prismaJson({
        status: "completed",
        activity_attempt_public_id: attempt.activity_attempt_public_id,
        dialogue_turn_number: dialogueTurnNumber,
        visible_reply_persisted: true,
        completed_projection: completedProjection,
        completed_at: new Date().toISOString()
      })
    }
  });
  return completedProjection;
}

export async function submitTopicDialogueResponse(input: {
  student_user_db_id: string;
  session_public_id: string;
  dialogue_public_id: string;
  activity_attempt_public_id?: string;
  student_message: string;
  client_operation_id: string;
  expected_dialogue_version?: string | null;
  evaluator_override?: StudentActivityRuntimeEvaluatorOverride;
  orchestration_override?: StudentActivityTurnOrchestrationOverride;
  client?: PrismaClientLike;
}) {
  try {
    return await processTopicDialogueResponse(input);
  } catch (error) {
    if (error instanceof StudentAssessmentServiceError) {
      throw error;
    }
    const client = input.client ?? prisma;
    const context = await ownedSessionContext({
      student_user_db_id: input.student_user_db_id,
      session_public_id: input.session_public_id,
      client
    });
    const attempt = input.activity_attempt_public_id
      ? await client.activityRuntimeAttempt.findUnique({
          where: { activity_attempt_public_id: input.activity_attempt_public_id }
        })
      : await latestAttemptForSession(input.session_public_id, client);
    if (!attempt) throw error;
    const existingStudent = await client.conversationTurn.findFirst({
      where: {
        assessment_session_db_id: context.session.id,
        actor_type: "student",
        structured_payload: { path: ["client_operation_id"], equals: input.client_operation_id }
      }
    });
    if (!existingStudent) throw error;
    await client.$transaction(async (tx) => {
      const existingReply = await tx.conversationTurn.findFirst({
        where: {
          assessment_session_db_id: context.session.id,
          actor_type: "agent",
          structured_payload: { path: ["client_operation_id"], equals: input.client_operation_id }
        }
      });
      if (!existingReply) {
        await tx.conversationTurn.create({
          data: {
            assessment_session_db_id: context.session.id,
            concept_unit_session_db_id: context.concept_unit_session.id,
            phase: "planning_completed",
            actor_type: "agent",
            agent_name: formativeDialogueRoute("provider_failure_recovery").role,
            message_text: boundedTopicDialogueRecoveryMessage(attempt),
            structured_payload: prismaJson({
              message_type: "topic_dialogue_safe_recovery",
              topic_dialogue_public_id: input.dialogue_public_id,
              activity_attempt_public_id: attempt.activity_attempt_public_id,
              client_operation_id: input.client_operation_id,
              visibility_status: "shown",
              recovery_message: true,
              fallback_used: true,
              fallback_version: "formative-turn-safe-recovery-v2",
              distractor_anchor_preserved: true
            })
          }
        });
      }
      await tx.activityRuntimeAttempt.update({
        where: { id: attempt.id },
        data: {
          status: "awaiting_student_activity_response",
          completed_at: null,
          limitations: prismaJson([
            "formative_turn_cycle_recovery_used",
            error instanceof Error ? error.message.slice(0, 300) : "unknown_turn_cycle_failure"
          ])
        }
      });
      await tx.studentActionIdempotencyKey.updateMany({
        where: {
          assessment_session_db_id: context.session.id,
          client_action_id: input.client_operation_id
        },
        data: {
          response_payload: prismaJson({
            status: "completed",
            activity_attempt_public_id: attempt.activity_attempt_public_id,
            visible_reply_persisted: true,
            recovery_used: true,
            completed_at: new Date().toISOString()
          })
        }
      });
    });
    await logProcessEvent({
      assessment_session_db_id: context.session.id,
      concept_unit_session_db_id: context.concept_unit_session.id,
      event_type: "topic_dialogue_fallback_used",
      event_category: "topic_dialogue",
      event_source: "backend",
      payload: {
        topic_dialogue_public_id: input.dialogue_public_id,
        client_operation_id: input.client_operation_id,
        reason: "formative_turn_cycle_failed"
      }
    });
    const recoveredAttempt = await client.activityRuntimeAttempt.findUniqueOrThrow({
      where: { id: attempt.id }
    });
    return projectionForAttempt(recoveredAttempt, client);
  }
}

export async function recordStudentActivityRuntimeChoice(input: {
  student_user_db_id: string;
  session_public_id: string;
  activity_attempt_public_id?: string | null;
  choice_state: StudentActivityRuntimeChoiceAction;
  selected_alternative_activity_family?: FormativeActivityFamily | null;
  client_action_id: string;
  client?: PrismaClientLike;
}) {
  const client = input.client ?? prisma;
  const context = await ownedSessionContext({
    student_user_db_id: input.student_user_db_id,
    session_public_id: input.session_public_id,
    client
  });
  const attempt = input.activity_attempt_public_id
    ? await client.activityRuntimeAttempt.findUnique({
        where: { activity_attempt_public_id: input.activity_attempt_public_id }
      })
    : await latestAttemptForSession(input.session_public_id, client);

  if (!attempt || attempt.session_public_id !== input.session_public_id) {
    if (input.choice_state === "choose_another_activity") {
      return projectionForStartFailure();
    }
    return projectionForNoAttempt();
  }

  const terminalChoice =
    input.choice_state === "move_on" ||
    input.choice_state === "finish_assessment" ||
    input.choice_state === "return_to_summary";
  const destinationChoice =
    input.choice_state === "skip_activity_to_transfer" ||
    input.choice_state === "skip_activity_to_next_concept";

  if (
    (terminalChoice && attempt.status === "move_on_recommended") ||
    (input.choice_state === "choose_another_activity" && attempt.status === "choose_alternative_recommended")
  ) {
    if (input.choice_state === "choose_another_activity") {
      const latestAttempt = await latestAttemptForSession(input.session_public_id, client);
      if (latestAttempt && latestAttempt.id !== attempt.id) {
        return projectionForAttempt(latestAttempt, client);
      }
    }
    return projectionForAttempt(attempt, client);
  }

  const source = sourceFromAttempt(attempt);

  if (destinationChoice) {
    if (attempt.status !== "continue_recommended") {
      throw new StudentAssessmentServiceError(
        "invalid_phase_for_action",
        "You can continue after this activity response has been reviewed.",
        409
      );
    }

    const destinations = await activityDestinationAvailability({ attempt, client });
    if (input.choice_state === "skip_activity_to_transfer" && !destinations.transfer_item_available) {
      throw new StudentAssessmentServiceError(
        "transfer_item_unavailable",
        "No transfer item is available for this concept unit.",
        409
      );
    }
    if (input.choice_state === "skip_activity_to_next_concept" && !destinations.next_concept_available) {
      throw new StudentAssessmentServiceError(
        "invalid_phase_for_action",
        "No next concept is available from this activity.",
        409
      );
    }

    await logProcessEvent({
      assessment_session_db_id: context.session.id,
      concept_unit_session_db_id: context.concept_unit_session.id,
      event_type:
        input.choice_state === "skip_activity_to_transfer"
          ? "continue_to_transfer_selected"
          : "continue_to_next_concept_selected",
      event_category: "formative_activity_runtime",
      event_source: "frontend",
      payload: {
        activity_attempt_public_id: attempt.activity_attempt_public_id,
        client_action_id: input.client_action_id,
        selected_navigation_destination:
          input.choice_state === "skip_activity_to_transfer"
            ? "transfer_item"
            : "next_concept"
      }
    });

    await updateAssessmentSessionPhase({
      assessment_session_db_id: context.session.id,
      to_phase: "followup_stopped",
      reason:
        input.choice_state === "skip_activity_to_transfer"
          ? "activity_runtime_continue_to_transfer"
          : "activity_runtime_continue_to_next_concept",
      payload: {
        activity_attempt_public_id: attempt.activity_attempt_public_id
      }
    });

    await submitChatNativeNextChoice({
      student_user_db_id: input.student_user_db_id,
      session_public_id: input.session_public_id,
      choice: input.choice_state === "skip_activity_to_transfer" ? "try_another" : "move_next",
      client_action_id: input.client_action_id
    });

    return projectionForAttempt(attempt, client);
  }

  const responseReference = attempt.latest_activity_response_reference
    ? undefined
    : prismaJson({
        activity_response_reference_id: `activity_choice_${input.client_action_id}`,
        student_choice_state: input.choice_state === "choose_another_activity"
          ? "choose_another_activity"
          : "move_on",
        selected_alternative_activity_family: input.selected_alternative_activity_family ?? null,
        raw_response_stored_elsewhere: false,
        submitted_at: new Date().toISOString()
      });
  const nextStatus = terminalChoice ? "move_on_recommended" : "choose_alternative_recommended";
  const updated = await client.activityRuntimeAttempt.update({
    where: { id: attempt.id },
    data: {
      status: terminalChoice && attempt.status === "continue_recommended" ? attempt.status : nextStatus,
      completed_at: new Date(),
      ...(responseReference ? { latest_activity_response_reference: responseReference } : {})
    }
  });

  await logProcessEvent({
    assessment_session_db_id: context.session.id,
    concept_unit_session_db_id: context.concept_unit_session.id,
    event_type: terminalChoice
      ? "student_activity_runtime_move_on"
      : "student_activity_runtime_choose_another",
    event_category: "formative_activity_runtime",
    event_source: "frontend",
    payload: {
      activity_attempt_public_id: attempt.activity_attempt_public_id,
      client_action_id: input.client_action_id,
      selected_alternative_activity_family: input.selected_alternative_activity_family ?? null
    }
  });

  if (terminalChoice) {
    const now = new Date();
    if (context.session.current_phase !== "session_completed") {
      await client.assessmentSession.update({
        where: { id: context.session.id },
        data: {
          current_phase: "session_completed",
          status: "completed",
          completed_at: now,
          last_activity_at: now
        }
      });
      await client.conceptUnitSession.update({
        where: { id: context.concept_unit_session.id },
        data: {
          status: "completed",
          followup_status: "stopped",
          followup_completed_at: now
        }
      });
    }

    await logProcessEvent({
      assessment_session_db_id: context.session.id,
      concept_unit_session_db_id: context.concept_unit_session.id,
      event_type: "formative_activity_skipped",
      event_category: "formative_activity_runtime",
      event_source: "frontend",
      payload: {
        activity_attempt_public_id: attempt.activity_attempt_public_id,
        client_action_id: input.client_action_id,
        selected_navigation_destination: "end_assessment",
        terminal_reason: "ended_during_formative_activity",
        next_runtime_state: "SESSION_COMPLETE",
        skipped_not_completed: attempt.status !== "continue_recommended"
      }
    });
    await logProcessEvent({
      assessment_session_db_id: context.session.id,
      concept_unit_session_db_id: context.concept_unit_session.id,
      event_type: "finish_assessment_selected",
      event_category: "assessment_navigation",
      event_source: "frontend",
      payload: {
        activity_attempt_public_id: attempt.activity_attempt_public_id,
        client_action_id: input.client_action_id,
        destination_type: "assessment_end",
        terminal_reason: "ended_during_formative_activity"
      }
    });
    await logProcessEvent({
      assessment_session_db_id: context.session.id,
      concept_unit_session_db_id: context.concept_unit_session.id,
      event_type: "session_completed",
      event_category: "session",
      event_source: "backend",
      payload: {
        terminal_reason: "ended_during_formative_activity",
        activity_attempt_public_id: attempt.activity_attempt_public_id
      }
    });
  } else {
    if (!source) {
      return projectionForStartFailure();
    }
    const nextAttempt = await createAlternativeActivityAttempt({
      source,
      attempt,
      assessment_session_db_id: context.session.id,
      concept_unit_session_db_id: context.concept_unit_session.id,
      client
    });
    await logProcessEvent({
      assessment_session_db_id: context.session.id,
      concept_unit_session_db_id: context.concept_unit_session.id,
      event_type: "alternative_activity_requested",
      event_category: "formative_activity_runtime",
      event_source: "frontend",
      payload: {
        activity_attempt_public_id: attempt.activity_attempt_public_id,
        replacement_activity_attempt_public_id: nextAttempt.activity_attempt_public_id,
        client_action_id: input.client_action_id,
        selected_alternative_activity_family: nextAttempt.activity_family,
        activity_switch_reason: "student_requested_different_activity"
      }
    });
    return projectionForAttempt(nextAttempt, client);
  }

  return projectionForAttempt(updated, client);
}
