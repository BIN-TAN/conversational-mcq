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
  TOPIC_DIALOGUE_MAX_STUDENT_MESSAGE_CHARS_DEFAULT,
  TOPIC_DIALOGUE_MAX_STUDENT_TURNS_DEFAULT,
  TOPIC_DIALOGUE_RECENT_TURN_WINDOW_DEFAULT,
  TopicDialogueAgentMediatedOutputSchema,
  TopicDialogueInputV1Schema,
  TopicDialogueOutputV1Schema,
  applyTopicDialogueReadinessGate,
  classifyTopicDialogueStudentMessage,
  topicDialoguePublicId,
  validateTopicDialogueOutput,
  type PostActivityLearningDecisionV1,
  type TopicDialogueAgentAction,
  type TopicDialogueOutputV1
} from "@/lib/services/student-assessment/topic-dialogue-agent";
import {
  applyCanonicalTopicDialogueActionGate,
  topicDialogueAuthorizationAuditProjection
} from "@/lib/services/student-assessment/topic-dialogue-action-normalization";
import {
  buildEvidenceFirstProgressionAuthorization,
  classifyTopicDialogueInteractionIntent,
  EVIDENCE_FIRST_PROFILE_ROUTING_VERSION,
  parseCumulativeEvidenceProfile,
  type EvidenceFirstRoute,
  type TopicDialogueTurnEvidenceProfile
} from "@/lib/services/student-assessment/topic-dialogue-evidence-first-routing";
import {
  buildActivityTargetEvidenceContractV5,
} from "@/lib/services/student-assessment/target-evidence-contract-v5";
import {
  buildTargetEvidenceScopedAdjudicationV1
} from "@/lib/services/student-assessment/target-evidence-scoped-adjudication-v1";
import {
  TURN_EVIDENCE_PROFILE_MAPPER_VERSION_V7
} from "@/lib/services/student-assessment/target-evidence-mapper-v7";
import {
  assertTutorDispatchUsesFinalizedProfile
} from "@/lib/services/student-assessment/pre-tutor-profile-finalization";
import {
  finalizeEvidenceFirstTurnBeforeTutorV4
} from "@/lib/services/student-assessment/pre-tutor-profile-finalization-v4";
import {
  buildNonconceptualStructuredTurnEvidenceV5,
  buildNoLiveStructuredTurnEvidenceV5ForTestOnly
} from "@/lib/services/student-assessment/production-turn-evidence-evaluator-v5";
import {
  AutonomousPedagogyOutputSchema,
  buildCompleteVisibleFormativeEpisode,
  completePedagogicalInterventionOutcome,
  createPedagogicalInterventionRecord,
  PedagogicalInterventionRecordSchema,
  type CompleteVisibleFormativeEpisode,
  type PedagogicalInterventionRecord
} from "@/lib/services/student-assessment/autonomous-formative-dialogue";
import {
  buildTopicDialogueModeFallback
} from "@/lib/services/student-assessment/topic-dialogue-response-mode";
import {
  resolveTopicDialogueExecutionPlan,
  type FormativeExecutionMode
} from "@/lib/services/student-assessment/formative-execution-mode";
import { operationalModeStatus } from "@/lib/operational/guarded-agent-integration";
import {
  resolveOperationalRoleLiveCallsEnabled,
  resolveTopicDialogueRuntimePolicy
} from "@/lib/llm/config";
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

function topicDialoguePolicyForExecutionMode(mode: FormativeExecutionMode) {
  const plan = resolveTopicDialogueExecutionPlan(mode);
  if (plan.configured_runtime_policy_used) {
    const liveEnvironmentAssertionsRequired =
      mode === "live_e2a_canary" ||
      (mode === "production" && operationalModeStatus().mode === "guarded_live");
    const approved = liveEnvironmentAssertionsRequired
      ? getTopicDialoguePolicy()
      : resolveTopicDialogueRuntimePolicy({ require_environment_match: false });
    return {
      plan,
      policy: {
        maximum_student_turns:
          approved.maximum_student_turns ?? TOPIC_DIALOGUE_MAX_STUDENT_TURNS_DEFAULT,
        recent_turn_window:
          approved.recent_turn_window ?? TOPIC_DIALOGUE_RECENT_TURN_WINDOW_DEFAULT,
        maximum_student_message_chars:
          approved.maximum_student_message_chars ??
          TOPIC_DIALOGUE_MAX_STUDENT_MESSAGE_CHARS_DEFAULT,
        allow_assessment_system_questions:
          approved.allow_assessment_system_questions ?? true
      }
    };
  }
  return {
    plan,
    policy: {
      maximum_student_turns: TOPIC_DIALOGUE_MAX_STUDENT_TURNS_DEFAULT,
      recent_turn_window: TOPIC_DIALOGUE_RECENT_TURN_WINDOW_DEFAULT,
      maximum_student_message_chars: TOPIC_DIALOGUE_MAX_STUDENT_MESSAGE_CHARS_DEFAULT,
      allow_assessment_system_questions: true
    }
  };
}

const alternativeActivityLabels: string[] = [];

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
  | "skip_activity_to_transfer"
  | "skip_activity_to_next_concept"
  | "finish_assessment"
  | "return_to_summary"
  | "move_on";

const FeedbackSchema = z.object({
  message: z.string().min(1),
  next_options: z.array(z.enum([
    "continue",
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
  execution_mode?: FormativeExecutionMode;
  client: PrismaClientLike;
}) {
  const executionPlan = resolveTopicDialogueExecutionPlan(
    input.execution_mode ?? "production"
  );
  const deterministicAdapter = executionPlan.adapter === "deterministic_mock_safe";
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
  if (!profileOverride && !deterministicAdapter) {
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
  const deterministicProfileOutput = deterministicAdapter
    ? carryForwardProfileOutput(current.profile)
    : null;
  const profileSucceeded = profileOverride?.stage === "profile" || deterministicAdapter ||
    (profileResult?.status === "succeeded" && Boolean(profileResult.output));
  const profileOutput = profileOverride?.stage === "profile"
    ? profileOverride.output
    : deterministicProfileOutput
      ? {
          ...deterministicProfileOutput,
          warnings: ["deterministic_evaluation_profile_projection"]
        }
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
    result_status: deterministicAdapter
      ? "deterministic_mock_safe"
      : profileSucceeded ? "succeeded" : profileResult?.status ?? "execution_failed",
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
  if (!planningOverride && !deterministicAdapter) {
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
  const deterministicPlanningOutput = deterministicAdapter
    ? carryForwardPlanningOutput(current.decision)
    : null;
  const planningSucceeded = planningOverride?.stage === "planning" || deterministicAdapter ||
    (planningResult?.status === "succeeded" && Boolean(planningResult.output));
  const planningOutput = planningOverride?.stage === "planning"
    ? planningOverride.output
    : deterministicPlanningOutput
      ? {
          ...deterministicPlanningOutput,
          warnings: ["deterministic_evaluation_plan_projection"]
        }
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
    result_status: deterministicAdapter
      ? "deterministic_mock_safe"
      : planningSucceeded ? "succeeded" : planningResult?.status ?? "execution_failed",
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

function topicDialogueRecoveryCategory(error: unknown):
  "provider_failure" | "schema_validation_failure" | "safety_failure" | null {
  if (error instanceof z.ZodError) return "schema_validation_failure";
  const message = error instanceof Error ? error.message : "";
  if (/(?:provider|agent_execution|evaluation_failed|candidate_execution_failed)/iu.test(message)) {
    return "provider_failure";
  }
  if (/(?:schema|structured_turn_evidence_v5_missing|evidence_packet_missing|post_activity_decision_missing|invalid_output)/iu.test(message)) {
    return "schema_validation_failure";
  }
  if (/(?:canonical_anchor|target_evidence|profile_consistency|pre_tutor|action_rejected|answer_key|unsafe|safety)/iu.test(message)) {
    return "safety_failure";
  }
  return null;
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
  client: PrismaClientLike,
  options: { maximum_dialogue_turns?: number } = {}
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
  const persistedDialogue = options.maximum_dialogue_turns === undefined
    ? await client.topicDialogue.findFirst({
        where: { activity_attempt_public_id: attempt.activity_attempt_public_id },
        select: { maximum_turns: true }
      })
    : null;
  const maximumDialogueTurns = options.maximum_dialogue_turns ??
    persistedDialogue?.maximum_turns ??
    getTopicDialoguePolicy().maximum_student_turns;
  const decision = packet && source
    ? buildPostActivityLearningDecision({
        activity_public_id: attempt.activity_attempt_public_id,
        growth_target:
          source.target_construct_or_boundary ??
          source.distractor_student_safe_description,
        evidence_packet: packet,
        maximum_dialogue_turns:
          maximumDialogueTurns
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

function pedagogicalInterventionFromPayload(value: unknown) {
  const parsed = PedagogicalInterventionRecordSchema.safeParse(
    recordFromJson(value).pedagogical_intervention
  );
  return parsed.success ? parsed.data : null;
}

async function completeVisibleEpisodeForRuntime(input: {
  assessment_session_db_id: string;
  activity_attempt_public_id: string;
  dialogue_public_id: string;
  latest_student_turn_id: string;
  latest_student_sequence_index: number;
  client: PrismaClientLike;
}): Promise<CompleteVisibleFormativeEpisode> {
  const turns = await input.client.conversationTurn.findMany({
    where: {
      assessment_session_db_id: input.assessment_session_db_id,
      structured_payload: {
        path: ["activity_attempt_public_id"],
        equals: input.activity_attempt_public_id
      }
    },
    orderBy: [{ sequence_index: "asc" }],
    select: {
      id: true,
      sequence_index: true,
      actor_type: true,
      message_text: true,
      structured_payload: true
    }
  });
  return buildCompleteVisibleFormativeEpisode({
    activity_attempt_public_id: input.activity_attempt_public_id,
    dialogue_public_id: input.dialogue_public_id,
    latest_student_turn_id: input.latest_student_turn_id,
    latest_student_sequence_index: input.latest_student_sequence_index,
    turns: turns.flatMap((turn) => {
      if ((turn.actor_type !== "student" && turn.actor_type !== "agent") ||
          !turn.message_text?.trim()) return [];
      const payload = recordFromJson(turn.structured_payload);
      const messageType = stringFromRecord(payload.message_type);
      const dialogueTurnNumber = typeof payload.dialogue_turn_number === "number"
        ? payload.dialogue_turn_number
        : messageType === "formative_activity_prompt" ? 0 : null;
      if (dialogueTurnNumber === null) return [];
      return [{
        visible_turn_id: turn.id,
        sequence_index: turn.sequence_index,
        dialogue_turn_number: dialogueTurnNumber,
        actor_type: turn.actor_type,
        message_text: turn.message_text,
        visibility_status: ["draft", "internal", "not_shown"].includes(
          stringFromRecord(payload.visibility_status)
        ) ? "not_shown" as const : "shown" as const,
        activity_attempt_public_id: stringFromRecord(
          payload.activity_attempt_public_id,
          input.activity_attempt_public_id
        ),
        topic_dialogue_public_id: stringFromRecord(
          payload.topic_dialogue_public_id
        ) || null
      }];
    })
  });
}

function alignTopicDialogueOutputToEvidenceFirstRoute(input: {
  candidate_output: TopicDialogueOutputV1;
  route: EvidenceFirstRoute;
  profile: TopicDialogueTurnEvidenceProfile;
  distractor_anchor: string;
}) {
  const expectedAction = input.route.selected_mode === "request_revision"
    ? "show_progression_choices"
    : input.route.selected_mode === "present_transfer"
      ? "continue_to_transfer"
      : input.route.selected_mode === "complete_episode"
        ? "end_assessment"
        : "await_topic_dialogue_response";
  const routeFieldsAligned = input.route.selected_mode === "remain_in_dialogue"
    ? input.candidate_output.next_action === expectedAction &&
      input.candidate_output.next_runtime_state === "AWAIT_TOPIC_DIALOGUE_RESPONSE" &&
      input.candidate_output.progression_readiness === "not_ready"
    : input.candidate_output.next_action === expectedAction &&
      input.candidate_output.progression_readiness === "ready" &&
      input.candidate_output.evidence_sufficiency === "sufficient_to_advance";
  if (routeFieldsAligned) {
    return { output: input.candidate_output, overridden: false };
  }
  const selectedMode = input.route.selected_mode;
  const fallback = buildTopicDialogueModeFallback({
    selected_mode: selectedMode,
    distractor_anchor: input.distractor_anchor,
    misconception_target: input.route.remaining_issue ??
      "the current anchor-specific conceptual boundary",
    platform_evidence_summary:
      `${input.profile.reasoning_quality}:${input.profile.misconception_status}`
  });
  return {
    output: TopicDialogueOutputV1Schema.parse({
      dialogue_schema_version: TOPIC_DIALOGUE_OUTPUT_SCHEMA_VERSION_V2,
      schema_version: TOPIC_DIALOGUE_OUTPUT_SCHEMA_VERSION_V2,
      tutor_message: fallback.tutor_message,
      student_message_function: "substantive_answer",
      dialogue_action: selectedMode === "request_revision"
        ? "request_revision"
        : selectedMode === "present_transfer"
          ? "offer_transfer"
          : "continue_dialogue",
      response_function: selectedMode === "request_revision"
        ? "readiness_confirmation"
        : "focused_question",
      evidence_update: fallback.evidence_update,
      remaining_issue: fallback.remaining_issue ??
        "No essential issue remains for the current anchor.",
      post_turn_understanding: input.profile.reasoning_quality === "sound"
        ? "sound_or_strong"
        : input.profile.reasoning_quality === "misconception"
          ? "misconception_present"
          : input.profile.reasoning_quality === "partial" ? "partial" : "unclear",
      evidence_sufficiency: selectedMode === "remain_in_dialogue"
        ? "needs_more_evidence"
        : "sufficient_to_advance",
      topic_relation: "current_assessment_content",
      topic_boundary: "inside_scope",
      system_question_answered: false,
      next_action: selectedMode === "request_revision"
        ? "show_progression_choices"
        : selectedMode === "present_transfer"
          ? "continue_to_transfer"
          : selectedMode === "complete_episode"
            ? "end_assessment"
            : "await_topic_dialogue_response",
      next_runtime_state: selectedMode === "remain_in_dialogue"
        ? "AWAIT_TOPIC_DIALOGUE_RESPONSE"
        : selectedMode === "complete_episode"
          ? "SHOW_FINAL_SUPPORT_OPTIONS"
          : "SHOW_PROGRESSION_CHOICES",
      progression_readiness: selectedMode === "remain_in_dialogue"
        ? "not_ready"
        : "ready",
      requires_student_response:
        selectedMode === "remain_in_dialogue" ||
        selectedMode === "request_revision",
      expected_response_guidance: fallback.expected_response_guidance ??
        "Respond to the current item-specific question.",
      safety_flags: fallback.safety_flags,
      student_safe_summary: fallback.student_safe_summary
    }),
    overridden: true
  };
}

function allowedTopicDialogueActions(input: {
  student_message_function: ReturnType<
    typeof classifyTopicDialogueStudentMessage
  >["student_message_function"];
  selected_mode: EvidenceFirstRoute["selected_mode"];
}): TopicDialogueAgentAction[] {
  if (input.selected_mode === "request_revision") return ["request_revision"];
  if (input.selected_mode === "present_transfer") return ["offer_transfer"];
  if (input.student_message_function === "clarification_request" ||
      input.student_message_function === "prompt_instruction_question") {
    return ["clarify_task"];
  }
  if (input.student_message_function === "request_for_example" ||
      input.student_message_function === "request_for_alternative_explanation") {
    return ["provide_example"];
  }
  return ["continue_dialogue", "provide_example"];
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
    helper_text: "You can try again or end the assessment.",
    allowed_actions: ["start_activity", "finish_assessment"],
    can_start: true,
    can_submit_response: false,
    can_choose_another_activity: false,
    can_move_on: true,
    can_continue: false,
    message_max_chars: ACTIVITY_RUNTIME_MAX_RESPONSE_CHARS,
    feedback: {
      message: "I could not safely prepare this activity right now. You can try again or end the assessment.",
      next_options: ["continue", "finish assessment"]
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
  loopResult?: ActivityRuntimeLoopResult,
  options: { maximum_dialogue_turns?: number } = {}
): Promise<StudentActivityRuntimeProjection> {
  const source = sourceFromAttempt(attempt);
  const evidence = await latestEvidenceContext(attempt, source, client, options);
  const loopFeedback = FeedbackSchema.safeParse(loopResult?.student_safe_feedback);
  const feedback = loopFeedback.success
    ? normalizeRuntimeFeedback(loopFeedback.data)
    : evidence.feedback;
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
                ? "Continue this activity"
                : uiState === "could_not_review_response_safely"
                  ? "I could not safely review this response right now."
                  : "Activity ready",
    focus_label: focusLabel,
    first_turn_message: source?.safe_activity_prompt ?? null,
    response_prompt: source?.expected_student_action_prompt ?? null,
    helper_text:
      uiState === "could_not_review_response_safely"
        ? "You can try again or end the assessment."
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
        ? ["submit_response", "finish_assessment"]
        : uiState === "feedback_ready"
          ? [
              ...(destinations.transfer_item_available ? ["skip_activity_to_transfer" as const] : []),
              ...(destinations.next_concept_available ? ["skip_activity_to_next_concept" as const] : []),
              "finish_assessment" as const
            ]
          : uiState === "could_not_review_response_safely"
            ? ["submit_response", "finish_assessment"]
            : ["finish_assessment"],
    can_start: false,
    can_submit_response:
      topicDialogue?.state === "awaiting_response" ||
      uiState === "waiting_for_your_response" ||
      uiState === "could_not_review_response_safely",
    can_choose_another_activity: false,
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
            message: "Continue working on the current idea.",
            next_options: ["continue"]
          }
        : uiState === "moved_on"
          ? {
              message: "The assessment has ended for this attempt.",
              next_options: ["return to assessment summary"]
            }
          : uiState === "could_not_review_response_safely"
            ? {
                message: "I could not safely review this response right now. You can try again or end the assessment.",
                next_options: ["continue", "skip this activity and continue"]
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
  execution_mode?: FormativeExecutionMode;
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

  if (!attempt) return projectionForNoAttempt();
  if (!input.execution_mode) return projectionForAttempt(attempt, client);
  const { policy } = topicDialoguePolicyForExecutionMode(input.execution_mode);
  return projectionForAttempt(attempt, client, undefined, {
    maximum_dialogue_turns: policy.maximum_student_turns
  });
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
  execution_mode?: FormativeExecutionMode;
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
  const { policy: dialoguePolicy } = topicDialoguePolicyForExecutionMode(
    input.execution_mode ?? "production"
  );
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
    execution_mode: input.execution_mode,
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
  execution_mode?: FormativeExecutionMode;
  client?: PrismaClientLike;
}) {
  const client = input.client ?? prisma;
  const context = await ownedSessionContext({
    student_user_db_id: input.student_user_db_id,
    session_public_id: input.session_public_id,
    client
  });
  const message = input.student_message.trim();
  const { plan: executionPlan, policy: dialoguePolicy } =
    topicDialoguePolicyForExecutionMode(input.execution_mode ?? "production");

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
    return completedReplay.projection ?? projectionForAttempt(attempt, client, undefined, {
      maximum_dialogue_turns: dialoguePolicy.maximum_student_turns
    });
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
    return projectionForAttempt(attempt, client, undefined, {
      maximum_dialogue_turns: dialoguePolicy.maximum_student_turns
    });
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
    select: { id: true, sequence_index: true, structured_payload: true }
  });

  const priorTurns = await client.conversationTurn.findMany({
    where: {
      assessment_session_db_id: context.session.id,
      structured_payload: { path: ["topic_dialogue_public_id"], equals: input.dialogue_public_id }
    },
    orderBy: [{ sequence_index: "asc" }],
    select: {
      id: true,
      sequence_index: true,
      actor_type: true,
      message_text: true,
      structured_payload: true
    }
  });
  if (claim.already_seen && !claim.resume_allowed) {
    return projectionForAttempt(attempt, client, undefined, {
      maximum_dialogue_turns: dialoguePolicy.maximum_student_turns
    });
  }
  const existingTurnPayload = recordFromJson(existingStudentTurn?.structured_payload);
  const priorStudentTurns = priorTurns.filter((turn) =>
    turn.actor_type === "student" && turn.id !== existingStudentTurn?.id
  ).length;
  const dialogueTurnNumber = typeof existingTurnPayload.dialogue_turn_number === "number"
    ? existingTurnPayload.dialogue_turn_number
    : priorStudentTurns + 1;
  const acceptedStudentTurn = existingStudentTurn ??
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
      },
      select: { id: true, sequence_index: true, structured_payload: true }
    });
  const completeVisibleEpisode = await completeVisibleEpisodeForRuntime({
    assessment_session_db_id: context.session.id,
    activity_attempt_public_id: attempt.activity_attempt_public_id,
    dialogue_public_id: input.dialogue_public_id,
    latest_student_turn_id: acceptedStudentTurn.id,
    latest_student_sequence_index: acceptedStudentTurn.sequence_index,
    client
  });
  const immediateInteractionIntent =
    classifyTopicDialogueInteractionIntent(message);

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

  const baseInterpretationContext = await buildAuthoritativeFormativeTurnContext({
    session_public_id: input.session_public_id,
    concept_unit_session_db_id: context.concept_unit_session.id,
    activity_attempt_public_id: attempt.activity_attempt_public_id,
    latest_student_message: message,
    client_operation_id: input.client_operation_id,
    agent_role: "response_interpretation",
    client
  });
  const interpretationContext = {
    ...baseInterpretationContext,
    active_formative_episode: completeVisibleEpisode
  };
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
  const evidence = await latestEvidenceContext(refreshedAttempt, source, client, {
    maximum_dialogue_turns: dialoguePolicy.maximum_student_turns
  });
  if (!evidence.decision) {
    throw new Error("formative_turn_post_activity_decision_missing");
  }
  if (!evidence.packet) {
    throw new Error("formative_turn_evidence_packet_missing");
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
    execution_mode: input.execution_mode,
    client
  });
  const boundedGrowthTarget = distractorFocusedGrowthTarget({
    source,
    growth_target: evidence.decision.growth_target
  });
  const distractorAnchor = [
    source.target_item_index ? `Item ${source.target_item_index}` : "current item",
    source.target_option_label ? `option ${source.target_option_label}` : null
  ].filter(Boolean).join(" ");
  const priorCumulativeProfile = priorTurns
    .filter((turn) => turn.id !== acceptedStudentTurn.id)
    .map((turn) => recordFromJson(turn.structured_payload)
      .evidence_first_cumulative_profile)
    .map(parseCumulativeEvidenceProfile)
    .filter((value) => value !== null)
    .at(-1) ?? null;
  const targetEvidenceContract = buildActivityTargetEvidenceContractV5({
    concept_id: currentConcept.concept_unit_public_id,
    item_id: source.target_item_index
      ? `item_${source.target_item_index}`
      : source.target_item_id ?? "current_item",
    distractor_option: source.target_option_label ?? "current_option",
    distractor_claim: source.distractor_student_safe_description,
    packet: evidence.packet
  });
  const structuredTurnEvidence = immediateInteractionIntent !==
      "ordinary_conceptual_response"
    ? buildNonconceptualStructuredTurnEvidenceV5({
        source_student_turn_id: acceptedStudentTurn.id,
        source_sequence_index: acceptedStudentTurn.sequence_index,
        alias_contract: targetEvidenceContract.active_anchor_alias_contract,
        interaction_intent: immediateInteractionIntent,
        confidence_evidence:
          evidence.packet.misconception_evidence_update.confidence
      })
    : loopResult.structured_turn_evidence ??
      (input.evaluator_override
        ? buildNoLiveStructuredTurnEvidenceV5ForTestOnly({
          source_student_turn_id: acceptedStudentTurn.id,
          source_sequence_index: acceptedStudentTurn.sequence_index,
          message,
          packet: evidence.packet,
          alias_contract: targetEvidenceContract.active_anchor_alias_contract,
          prior_visible_message: completeVisibleEpisode.visible_turns
            .slice(0, -1).at(-1)?.message_text ?? null
          })
        : null);
  if (!structuredTurnEvidence) {
    throw new Error("production_turn_evidence_v5_missing");
  }
  const scopedTargetEvidenceAdjudication =
    buildTargetEvidenceScopedAdjudicationV1({
      latest_student_message: message,
      packet: evidence.packet,
      structured_turn_evidence: structuredTurnEvidence,
      contract: targetEvidenceContract,
      expected_source_student_turn_id: acceptedStudentTurn.id,
      expected_source_sequence_index: acceptedStudentTurn.sequence_index,
      prior_visible_message: completeVisibleEpisode.visible_turns
        .slice(0, -1).at(-1)?.message_text ?? null
    });
  const targetEvidenceAdjudication =
    scopedTargetEvidenceAdjudication.adjudication;
  const latestAcceptedStudentTurn = await client.conversationTurn.findFirst({
    where: {
      assessment_session_db_id: context.session.id,
      actor_type: "student",
      structured_payload: {
        path: ["topic_dialogue_public_id"],
        equals: input.dialogue_public_id
      }
    },
    orderBy: [{ sequence_index: "desc" }],
    select: { id: true, sequence_index: true }
  });
  if (!latestAcceptedStudentTurn) {
    throw new Error("topic_dialogue_latest_student_turn_missing");
  }
  const finalizedProfile = finalizeEvidenceFirstTurnBeforeTutorV4({
    contract: targetEvidenceContract,
    adjudication: targetEvidenceAdjudication,
    latest_student_message: message,
    interaction_intent: immediateInteractionIntent,
    confidence_evidence:
      evidence.packet.misconception_evidence_update.confidence,
    source_student_turn_id: acceptedStudentTurn.id,
    source_sequence_index: acceptedStudentTurn.sequence_index,
    latest_accepted_student_turn_id: latestAcceptedStudentTurn.id,
    latest_accepted_sequence_index: latestAcceptedStudentTurn.sequence_index,
    concept_id: currentConcept.concept_unit_public_id,
    distractor_anchor: distractorAnchor,
    prior_cumulative_profile: priorCumulativeProfile
  });
  const targetEvidenceObservation = finalizedProfile.observation;
  const profileConsistency = finalizedProfile.consistency;
  const turnEvidenceProfile = finalizedProfile.profile;
  const cumulativeEvidenceProfile = finalizedProfile.cumulative;
  const evidenceFirstRoute = finalizedProfile.route;
  const profileFreshnessAttestation = finalizedProfile.attestation;
  const priorInterventionTurn = [...priorTurns].reverse().find((turn) =>
    turn.actor_type === "agent" &&
    pedagogicalInterventionFromPayload(turn.structured_payload) !== null
  ) ?? null;
  const priorIntervention = priorInterventionTurn
    ? pedagogicalInterventionFromPayload(priorInterventionTurn.structured_payload)
    : null;
  const completedPriorIntervention = priorIntervention &&
      !priorIntervention.next_student_turn_id
    ? completePedagogicalInterventionOutcome({
        intervention: priorIntervention,
        next_profile: turnEvidenceProfile,
        prior_cumulative: priorCumulativeProfile
      })
    : null;
  await client.conversationTurn.update({
    where: { id: acceptedStudentTurn.id },
    data: {
      structured_payload: prismaJson({
        ...recordFromJson(acceptedStudentTurn.structured_payload),
        evidence_first_turn_profile: turnEvidenceProfile,
        evidence_first_cumulative_profile: cumulativeEvidenceProfile,
        evidence_first_route: evidenceFirstRoute,
        evidence_first_target_contract: targetEvidenceContract,
        evidence_first_target_adjudication: targetEvidenceAdjudication,
        evidence_first_anchor_stance_scope_resolution:
          scopedTargetEvidenceAdjudication.anchor_stance_scope_resolution,
        evidence_first_target_adjudication_integration_version:
          scopedTargetEvidenceAdjudication.integration_version,
        evidence_first_profile_mapper_version:
          TURN_EVIDENCE_PROFILE_MAPPER_VERSION_V7,
        evidence_first_profile_consistency: profileConsistency,
        evidence_first_turn_observation:
          finalizedProfile.observation_record,
        evidence_first_profile_update_disposition:
          finalizedProfile.profile_update_record,
        evidence_first_cross_artifact_consistency:
          finalizedProfile.cross_artifact_consistency,
        evidence_first_pre_tutor_finalization: profileFreshnessAttestation
      })
    }
  });
  await logProcessEvent({
    assessment_session_db_id: context.session.id,
    concept_unit_session_db_id: context.concept_unit_session.id,
    event_type: "learning_profile_updated",
    event_category: "topic_dialogue",
    event_source: "backend",
    payload: {
      orchestration_version: EVIDENCE_FIRST_PROFILE_ROUTING_VERSION,
      profile_snapshot_id: turnEvidenceProfile.profile_snapshot_id,
      source_student_turn_id: turnEvidenceProfile.source_student_turn_id,
      source_sequence_index: turnEvidenceProfile.source_sequence_index,
      evaluator_version: turnEvidenceProfile.evaluator_version,
      profile_mapper_version: TURN_EVIDENCE_PROFILE_MAPPER_VERSION_V7,
      target_evidence_contract_version:
        targetEvidenceContract.contract_version,
      target_adjudication_integration_version:
        scopedTargetEvidenceAdjudication.integration_version,
      anchor_stance_scope_resolution_version:
        scopedTargetEvidenceAdjudication.anchor_stance_scope_resolution
          .resolver_version,
      anchor_stance_scope_resolution_basis:
        scopedTargetEvidenceAdjudication.anchor_stance_scope_resolution
          .stance_classification.resolution_basis,
      profile_consistency_policy_version: profileConsistency.policy_version,
      conceptual_evidence_applicability:
        finalizedProfile.conceptual_evidence_applicability,
      profile_update_disposition:
        finalizedProfile.profile_update_disposition,
      turn_observation_version:
        finalizedProfile.observation_record.observation_version,
      profile_update_contract_version:
        finalizedProfile.profile_update_record.update_contract_version,
      cross_artifact_consistency_version:
        finalizedProfile.cross_artifact_consistency.policy_version,
      interaction_intent: turnEvidenceProfile.interaction_intent,
      reasoning_quality: turnEvidenceProfile.reasoning_quality,
      misconception_status: turnEvidenceProfile.misconception_status,
      anchor_application: targetEvidenceObservation.anchor_application,
      anchor_stance: targetEvidenceObservation.anchor_stance,
      anchor_consistency: targetEvidenceObservation.anchor_consistency,
      anchor_resolution_status:
        targetEvidenceObservation.anchor_resolution_status,
      revision_readiness: turnEvidenceProfile.revision_readiness,
      selected_mode: evidenceFirstRoute.selected_mode,
      selected_operation: evidenceFirstRoute.selected_operation,
      provider_selected_route: false
    }
  });
  const authoritativePostActivityStatus = evidenceFirstRoute.selected_mode ===
    "request_revision"
    ? "ready_to_advance" as const
    : turnEvidenceProfile.reasoning_quality === "misconception"
      ? "specific_misconception_remaining" as const
      : turnEvidenceProfile.reasoning_quality === "insufficient"
        ? "insufficient_new_evidence" as const
        : "improving_but_incomplete" as const;
  const studentMessageClassification =
    classifyTopicDialogueStudentMessage(message);
  const allowedDialogueActions = allowedTopicDialogueActions({
    student_message_function:
      studentMessageClassification.student_message_function,
    selected_mode: evidenceFirstRoute.selected_mode
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
    remaining_issue: evidenceFirstRoute.remaining_issue ??
      "No essential conceptual link remains for the current anchor.",
    post_activity_status: authoritativePostActivityStatus,
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
      studentMessageClassification.student_message_function,
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
      "continue to transfer item when available",
      "end assessment"
    ],
    allowed_dialogue_actions: allowedDialogueActions,
    source_versions: {
      topic_dialogue_input_schema_version: TOPIC_DIALOGUE_INPUT_SCHEMA_VERSION_V2,
      topic_dialogue_output_schema_version: TOPIC_DIALOGUE_OUTPUT_SCHEMA_VERSION_V2,
      topic_dialogue_policy_version: "topic-dialogue-policy-v2",
      evidence_first_profile_routing_version:
        EVIDENCE_FIRST_PROFILE_ROUTING_VERSION
    }
  });
  const iterativeDialogueRole = formativeDialogueRoute("first_activity_response").role;
  const deterministicDialogueAdapter =
    executionPlan.adapter === "deterministic_mock_safe";
  const tutorRequired = profileFreshnessAttestation.tutor_dispatch_permitted;
  const topicDialogueLiveEnabled = executionPlan.adapter === "configured_live_runtime" &&
    resolveOperationalRoleLiveCallsEnabled(iterativeDialogueRole);
  if (topicDialogueLiveEnabled && tutorRequired) {
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
    complete_visible_formative_conversation: completeVisibleEpisode,
    topic_dialogue_orchestration: {
      current_activity_attempt:
        staged.dialogue_context.complete_activity_runtime_history.attempts
          .find((entry) => entry.is_current) ?? null,
      full_visible_formative_transcript: completeVisibleEpisode.visible_turns,
      latest_student_message: message,
      prior_attempted_activities:
        staged.dialogue_context.complete_activity_runtime_history.attempts
          .filter((entry) => !entry.is_current),
      failed_strategy_history:
        staged.dialogue_context.complete_activity_runtime_history
          .strategies_not_to_repeat,
      current_profile_evidence: {
        authoritative_turn_evidence_profile: turnEvidenceProfile,
        cumulative_evidence_profile: cumulativeEvidenceProfile,
        profile_history:
          staged.dialogue_context.complete_profile_history.versions
      },
      formative_goal: boundedGrowthTarget,
      allowed_actions: allowedDialogueActions
    },
    formative_turn_context: {
      ...staged.dialogue_context,
      authoritative_turn_evidence_profile: turnEvidenceProfile,
      cumulative_evidence_profile: cumulativeEvidenceProfile,
      platform_selected_route: evidenceFirstRoute,
      profile_freshness_attestation: profileFreshnessAttestation,
      progression_authorization:
        buildEvidenceFirstProgressionAuthorization(evidenceFirstRoute)
    }
  };
  const dialogueInvocationKey =
    `topic-dialogue:${input.dialogue_public_id}:${input.client_operation_id}`;
  const existingDialogueCall = await client.agentCall.findUnique({
    where: { agent_invocation_key: dialogueInvocationKey },
    select: { id: true, call_status: true, output_validated: true, output_payload: true }
  });
  const reusableDialogueOutput = !deterministicDialogueAdapter &&
    existingDialogueCall?.call_status === "succeeded" &&
    existingDialogueCall.output_validated
    ? TopicDialogueAgentMediatedOutputSchema.safeParse(
        existingDialogueCall.output_payload
      )
    : null;
  if (tutorRequired && !deterministicDialogueAdapter &&
      !reusableDialogueOutput?.success && !existingDialogueCall) {
    assertTutorDispatchUsesFinalizedProfile({
      profile: turnEvidenceProfile,
      attestation: profileFreshnessAttestation,
      latest_accepted_student_turn_id: latestAcceptedStudentTurn.id,
      latest_accepted_sequence_index: latestAcceptedStudentTurn.sequence_index
    });
  }
  const liveResult = !tutorRequired
    ? {
        status: "not_attempted" as const,
        blocked_reason: "platform_mode_does_not_require_tutor"
      }
    : deterministicDialogueAdapter
    ? {
        status: "not_attempted" as const,
        blocked_reason: "deterministic_mock_safe_adapter_selected"
      }
    : reusableDialogueOutput?.success
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
        output_schema: TopicDialogueAgentMediatedOutputSchema,
        invocation_key: dialogueInvocationKey,
        assessment_session_db_id: context.session.id,
        concept_unit_session_db_id: context.concept_unit_session.id,
        metadata: {
          dialogue_public_id: input.dialogue_public_id,
          schema_version: TOPIC_DIALOGUE_OUTPUT_SCHEMA_VERSION_V2,
          orchestration_version: EVIDENCE_FIRST_PROFILE_ROUTING_VERSION,
          profile_snapshot_id: turnEvidenceProfile.profile_snapshot_id,
          source_student_turn_id: turnEvidenceProfile.source_student_turn_id,
          source_sequence_index: String(turnEvidenceProfile.source_sequence_index),
          selected_mode: evidenceFirstRoute.selected_mode,
          selected_operation: evidenceFirstRoute.selected_operation ?? "none"
        }
      });
  const output = liveResult.status === "succeeded"
    ? liveResult.output
    : buildDeterministicTopicDialogueResponse(dialogueInput);
  const validation = validateTopicDialogueOutput(output, {
    allowed_dialogue_actions: allowedDialogueActions
  });
  const validatedOutput: TopicDialogueOutputV1 = validation.valid
    ? validation.output
    : buildDeterministicTopicDialogueResponse({
        ...dialogueInput,
        latest_student_message: "Please keep the discussion on this assessment topic."
      });
  const routeAlignmentResult = alignTopicDialogueOutputToEvidenceFirstRoute({
    candidate_output: validatedOutput,
    route: evidenceFirstRoute,
    profile: turnEvidenceProfile,
    distractor_anchor: distractorAnchor
  });
  const actionGateResult = applyCanonicalTopicDialogueActionGate({
    dialogue_input: dialogueInput,
    candidate_output: routeAlignmentResult.output,
    authorization: buildEvidenceFirstProgressionAuthorization(evidenceFirstRoute)
  });
  const readinessResult = evidenceFirstRoute.selected_mode !== "remain_in_dialogue"
    ? {
        output: actionGateResult.output,
        gate: {
          gate_version: EVIDENCE_FIRST_PROFILE_ROUTING_VERSION,
          ready: true,
          source_profile_snapshot_id: turnEvidenceProfile.profile_snapshot_id,
          source_sequence_index: turnEvidenceProfile.source_sequence_index,
          reason_code: "authoritative_turn_profile_revision_ready"
        },
        overridden: false
      }
    : applyTopicDialogueReadinessGate({
        dialogue_input: dialogueInput,
        candidate_output: actionGateResult.output
      });
  const persistedOutput = readinessResult.output;
  const interventionHistory = priorTurns.flatMap((turn) => {
    const intervention = pedagogicalInterventionFromPayload(
      turn.structured_payload
    );
    return intervention ? [intervention] : [];
  });
  const pedagogicalIntervention: PedagogicalInterventionRecord | null =
    evidenceFirstRoute.selected_mode === "remain_in_dialogue" &&
      immediateInteractionIntent === "ordinary_conceptual_response" &&
      evidenceFirstRoute.selected_operation
      ? createPedagogicalInterventionRecord({
          output: AutonomousPedagogyOutputSchema.parse({
            schema_version: "topic-dialogue-autonomous-output-v1",
            source_profile_snapshot_id:
              turnEvidenceProfile.profile_snapshot_id,
            source_student_turn_id: turnEvidenceProfile.source_student_turn_id,
            primary_learning_gap: evidenceFirstRoute.remaining_issue ??
              "current distractor-linked conceptual gap",
            pedagogical_goal: `Elicit new evidence for ${
              evidenceFirstRoute.remaining_issue ?? "the unresolved concept"
            }`,
            pedagogical_strategy: evidenceFirstRoute.selected_operation,
            why_this_strategy_fits_now:
              "The active approved runtime selected this operation from the latest authoritative profile.",
            prior_interventions_considered: interventionHistory.map(
              (entry) => entry.intervention_id
            ),
            repetition_risk: interventionHistory.at(-1)?.strategy_description ===
              evidenceFirstRoute.selected_operation ? "moderate" : "low",
            evidence_sought_from_next_response: [
              evidenceFirstRoute.remaining_issue ??
                "new anchor-specific conceptual evidence"
            ],
            student_facing_message: persistedOutput.tutor_message,
            requires_student_response: true
          })
        })
      : null;
  const actionValidationPassed = !actionGateResult.rejected;
  const actionValidationError = actionValidationPassed
    ? null
    : `topic_dialogue_action_rejected:${actionGateResult.normalization.rejection_code}`;
  const providerValidationError = validation.valid
    ? null
    : validation.issues.map((issue) => {
        const blocked = "blocked_pattern_label" in issue
          ? issue.blocked_pattern_label
          : undefined;
        return `${issue.field_path}:${blocked ?? issue.rule_code}`;
      }).join("; ");
  const fallbackUsed = !deterministicDialogueAdapter &&
    (liveResult.status !== "succeeded" ||
      !validation.valid ||
      routeAlignmentResult.overridden ||
      actionGateResult.overridden ||
      readinessResult.overridden);
  const generationSource = deterministicDialogueAdapter
    ? "deterministic_test_adapter" as const
    : fallbackUsed
      ? "deterministic_fallback" as const
      : "live_llm" as const;
  const validatorStatus = !validation.valid
    ? "failed" as const
    : actionValidationPassed
      ? "passed" as const
      : "action_rejected" as const;
  const actionGateAudit = {
    status: actionGateResult.normalization.status,
    authorized_action: actionGateResult.authorization.authorized_action,
    requested_dialogue_action: persistedOutput.dialogue_action ?? null,
    normalized_requested_action:
      actionGateResult.normalization.normalized_requested_action,
    effective_action: actionGateResult.normalization.effective_action,
    overridden: actionGateResult.overridden,
    rejection_code: actionGateResult.normalization.rejection_code
  };
  const agentCall = liveResult.status === "succeeded"
    ? await client.agentCall.update({
        where: { id: liveResult.agent_call_id },
        data: {
          output_payload: prismaJson(persistedOutput),
          output_validated: validation.valid && actionValidationPassed,
          validation_error: validation.valid && actionValidationPassed
            ? null
            : actionValidationError ?? providerValidationError,
          blocked_reason: actionValidationError ?? undefined,
          call_status: validation.valid && actionValidationPassed
            ? "succeeded"
            : "invalid_output"
        }
      })
    : existingDialogueCall
      ? await client.agentCall.update({
          where: { id: existingDialogueCall.id },
          data: {
            output_payload: prismaJson(persistedOutput),
            raw_output: prismaJson(persistedOutput),
            output_validated: validation.valid && actionValidationPassed,
            validation_error: validation.valid && actionValidationPassed
              ? null
              : actionValidationError ?? providerValidationError,
            blocked_reason: actionValidationError ??
              "existing_dialogue_call_not_reusable",
            call_status: validation.valid && actionValidationPassed
              ? "succeeded"
              : "invalid_output",
            completed_at: new Date()
          }
        })
      : await client.agentCall.create({
        data: {
          assessment_session_db_id: context.session.id,
          concept_unit_session_db_id: context.concept_unit_session.id,
          agent_name: iterativeDialogueRole,
          agent_version: TOPIC_DIALOGUE_PROMPT_VERSION,
          model_name: deterministicDialogueAdapter
            ? "deterministic_topic_dialogue_adapter"
            : "deterministic_topic_dialogue_fallback",
          provider: "mock",
          agent_invocation_key: `topic-dialogue:${input.dialogue_public_id}:${input.client_operation_id}`,
          prompt_version: TOPIC_DIALOGUE_PROMPT_VERSION,
          schema_version: TOPIC_DIALOGUE_OUTPUT_SCHEMA_VERSION_V2,
          prompt_hash: TOPIC_DIALOGUE_PROMPT_HASH,
          input_payload: prismaJson(dialogueRequestInput),
          output_payload: prismaJson(persistedOutput),
          raw_output: prismaJson(persistedOutput),
          output_validated: validation.valid && actionValidationPassed,
          validation_error: validation.valid && actionValidationPassed
            ? null
            : actionValidationError ?? providerValidationError,
          blocked_reason: !deterministicDialogueAdapter && liveResult.status === "not_attempted"
            ? liveResult.blocked_reason
            : actionValidationError ?? undefined,
          call_status: validation.valid && actionValidationPassed
            ? "succeeded"
            : "invalid_output",
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
    if (completedPriorIntervention && priorInterventionTurn) {
      const priorPayload = recordFromJson(
        priorInterventionTurn.structured_payload
      );
      await tx.conversationTurn.update({
        where: { id: priorInterventionTurn.id },
        data: {
          structured_payload: prismaJson({
            ...priorPayload,
            pedagogical_intervention: completedPriorIntervention
          })
        }
      });
      const priorTurnNumber = typeof priorPayload.dialogue_turn_number ===
        "number" ? priorPayload.dialogue_turn_number : null;
      if (priorTurnNumber !== null) {
        const priorTopicTurn = await tx.topicDialogueTurn.findUnique({
          where: {
            dialogue_public_id_turn_number_actor_type: {
              dialogue_public_id: input.dialogue_public_id,
              turn_number: priorTurnNumber,
              actor_type: "agent"
            }
          },
          select: { id: true, structured_payload: true }
        });
        if (priorTopicTurn) {
          await tx.topicDialogueTurn.update({
            where: { id: priorTopicTurn.id },
            data: {
              structured_payload: prismaJson({
                ...recordFromJson(priorTopicTurn.structured_payload),
                pedagogical_intervention: completedPriorIntervention
              })
            }
          });
        }
      }
    }
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
          agent_name: TOPIC_DIALOGUE_AGENT_NAME,
          generation_source: generationSource,
          visibility_status: "shown",
          dialogue_action: persistedOutput.dialogue_action ?? null,
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
          execution_mode: executionPlan.mode,
          dialogue_adapter: executionPlan.adapter,
          fallback_used: fallbackUsed,
          validator_status: validatorStatus,
          action_gate_result: actionGateAudit,
          fallback_version: TOPIC_DIALOGUE_FALLBACK_VERSION,
          boundary_validator_version: TOPIC_DIALOGUE_BOUNDARY_VALIDATOR_VERSION,
          readiness_gate: readinessResult.gate,
          readiness_gate_overrode_candidate: readinessResult.overridden,
          action_authorization: topicDialogueAuthorizationAuditProjection(
            actionGateResult.authorization
          ),
          action_normalization: actionGateResult.normalization,
          action_gate_overrode_candidate: actionGateResult.overridden,
          evidence_first_profile_snapshot: turnEvidenceProfile,
          cumulative_evidence_profile: cumulativeEvidenceProfile,
          evidence_first_route: evidenceFirstRoute,
          profile_freshness_attestation: profileFreshnessAttestation,
          route_alignment_overrode_candidate: routeAlignmentResult.overridden,
          complete_visible_formative_conversation: completeVisibleEpisode,
          pedagogical_intervention: pedagogicalIntervention,
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
          agent_name: TOPIC_DIALOGUE_AGENT_NAME,
          generation_source: generationSource,
          fallback_used: fallbackUsed,
          validator_status: validatorStatus,
          action_gate_result: actionGateAudit,
          readiness_gate: readinessResult.gate,
          readiness_gate_overrode_candidate: readinessResult.overridden,
          action_authorization: topicDialogueAuthorizationAuditProjection(
            actionGateResult.authorization
          ),
          action_normalization: actionGateResult.normalization,
          action_gate_overrode_candidate: actionGateResult.overridden,
          evidence_first_profile_snapshot: turnEvidenceProfile,
          cumulative_evidence_profile: cumulativeEvidenceProfile,
          evidence_first_route: evidenceFirstRoute,
          profile_freshness_attestation: profileFreshnessAttestation,
          route_alignment_overrode_candidate: routeAlignmentResult.overridden,
          complete_visible_formative_conversation: completeVisibleEpisode,
          pedagogical_intervention: pedagogicalIntervention
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
      dialogue_action: persistedOutput.dialogue_action ?? null,
      next_action: persistedOutput.next_action,
      topic_boundary: persistedOutput.topic_boundary,
      agent_call_id: agentCall.id,
      agent_name: TOPIC_DIALOGUE_AGENT_NAME,
      generation_source: generationSource,
      fallback_used: fallbackUsed,
      validator_status: validatorStatus,
      action_gate_result: actionGateAudit,
      execution_mode: executionPlan.mode,
      dialogue_adapter: executionPlan.adapter,
      readiness_gate: readinessResult.gate,
      readiness_gate_overrode_candidate: readinessResult.overridden,
      action_authorization: topicDialogueAuthorizationAuditProjection(
        actionGateResult.authorization
      ),
      action_normalization: actionGateResult.normalization,
      action_gate_overrode_candidate: actionGateResult.overridden,
      evidence_first_profile_snapshot_id:
        turnEvidenceProfile.profile_snapshot_id,
      evidence_first_source_student_turn_id:
        turnEvidenceProfile.source_student_turn_id,
      evidence_first_source_sequence_index:
        turnEvidenceProfile.source_sequence_index,
      evidence_first_selected_mode: evidenceFirstRoute.selected_mode,
      evidence_first_selected_operation: evidenceFirstRoute.selected_operation,
      route_alignment_overrode_candidate: routeAlignmentResult.overridden
    }
  });
  if (liveResult.status === "succeeded" && validation.valid && actionValidationPassed) {
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
  const completedProjection = await projectionForAttempt(committedAttempt, client, undefined, {
    maximum_dialogue_turns: dialoguePolicy.maximum_student_turns
  });
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
  execution_mode?: FormativeExecutionMode;
  client?: PrismaClientLike;
}) {
  try {
    return await processTopicDialogueResponse(input);
  } catch (error) {
    if (error instanceof StudentAssessmentServiceError) {
      throw error;
    }
    const executionPlan = resolveTopicDialogueExecutionPlan(
      input.execution_mode ?? "production"
    );
    const recoveryCategory = topicDialogueRecoveryCategory(error);
    if (!executionPlan.safe_recovery_eligible || !recoveryCategory) {
      throw error;
    }
    const { policy: dialoguePolicy } = topicDialoguePolicyForExecutionMode(
      executionPlan.mode
    );
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
              agent_name: TOPIC_DIALOGUE_AGENT_NAME,
              generation_source: "deterministic_fallback",
              recovery_message: true,
              fallback_used: true,
              validator_status: recoveryCategory,
              action_gate_result: {
                status: "not_reached",
                authorized_action: null,
                requested_dialogue_action: null,
                normalized_requested_action: null,
                effective_action: null,
                overridden: false,
                rejection_code: recoveryCategory
              },
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
        agent_name: TOPIC_DIALOGUE_AGENT_NAME,
        generation_source: "deterministic_fallback",
        fallback_used: true,
        validator_status: recoveryCategory,
        action_gate_result: {
          status: "not_reached",
          authorized_action: null,
          requested_dialogue_action: null,
          normalized_requested_action: null,
          effective_action: null,
          overridden: false,
          rejection_code: recoveryCategory
        },
        reason: recoveryCategory
      }
    });
    const recoveredAttempt = await client.activityRuntimeAttempt.findUniqueOrThrow({
      where: { id: attempt.id }
    });
    return projectionForAttempt(recoveredAttempt, client, undefined, {
      maximum_dialogue_turns: dialoguePolicy.maximum_student_turns
    });
  }
}

export async function recordStudentActivityRuntimeChoice(input: {
  student_user_db_id: string;
  session_public_id: string;
  activity_attempt_public_id?: string | null;
  choice_state: StudentActivityRuntimeChoiceAction;
  client_action_id: string;
  execution_mode?: FormativeExecutionMode;
  client?: PrismaClientLike;
}) {
  const client = input.client ?? prisma;
  const dialoguePolicy = input.execution_mode
    ? topicDialoguePolicyForExecutionMode(input.execution_mode).policy
    : null;
  const projectAttempt = (value: ActivityRuntimeAttempt) =>
    dialoguePolicy
      ? projectionForAttempt(value, client, undefined, {
          maximum_dialogue_turns: dialoguePolicy.maximum_student_turns
        })
      : projectionForAttempt(value, client);
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
    return projectionForNoAttempt();
  }

  const terminalChoice =
    input.choice_state === "move_on" ||
    input.choice_state === "finish_assessment" ||
    input.choice_state === "return_to_summary";
  const destinationChoice =
    input.choice_state === "skip_activity_to_transfer" ||
    input.choice_state === "skip_activity_to_next_concept";

  if (terminalChoice && attempt.status === "move_on_recommended") {
    return projectAttempt(attempt);
  }

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

    return projectAttempt(attempt);
  }

  if (!terminalChoice) {
    throw new StudentAssessmentServiceError(
      "invalid_phase_for_action",
      "This activity action is not available.",
      409
    );
  }

  const responseReference = attempt.latest_activity_response_reference
    ? undefined
    : prismaJson({
        activity_response_reference_id: `activity_choice_${input.client_action_id}`,
        student_choice_state: "move_on",
        raw_response_stored_elsewhere: false,
        submitted_at: new Date().toISOString()
      });
  const updated = await client.activityRuntimeAttempt.update({
    where: { id: attempt.id },
    data: {
      status: attempt.status === "continue_recommended" ? attempt.status : "move_on_recommended",
      completed_at: new Date(),
      ...(responseReference ? { latest_activity_response_reference: responseReference } : {})
    }
  });

  await logProcessEvent({
    assessment_session_db_id: context.session.id,
    concept_unit_session_db_id: context.concept_unit_session.id,
    event_type: "student_activity_runtime_move_on",
    event_category: "formative_activity_runtime",
    event_source: "frontend",
    payload: {
      activity_attempt_public_id: attempt.activity_attempt_public_id,
      client_action_id: input.client_action_id
    }
  });

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

  return projectAttempt(updated);
}
