import { randomUUID } from "node:crypto";
import path from "node:path";
import { Prisma, type PrismaClient } from "@prisma/client";
import { resolveApplicationBuildInfo } from "@/lib/provenance/application-build-info";
import {
  completeInitialConceptUnitAdministration,
  getStudentSafeTranscript,
  getStudentSessionState,
  recordConfidence,
  recordReasoning,
  recordSelectedOption,
  recordTemptingOption,
  startConceptUnitInitialAdministration,
  startOrResumeStudentAssessmentSession
} from "@/lib/services/student-assessment/service";
import {
  recordStudentActivityRuntimeChoice,
  startStudentActivityForSession,
  submitStudentActivityRuntimeResponse,
  type StudentActivityRuntimeEvaluatorOverride,
  type StudentActivityRuntimeGenerationOverride
} from "@/lib/services/student-assessment/activity-runtime-ui";
import {
  FormativeActivityPacketV1Schema,
  buildFormativeActivityDesignPacketFromPackets
} from "@/lib/services/student-assessment/formative-activity-design";
import {
  makePassingActivityQualityReviewForTest,
  type FormativeActivityLiveExecutionResult
} from "@/lib/services/student-assessment/formative-activity-live";
import {
  buildNoLiveActivityMisconceptionEvidenceFixture,
  type MisconceptionUpdateStatus
} from "@/lib/services/student-assessment/activity-misconception-evidence";
import {
  makeLiveActivityMisconceptionEvidencePacketForTest,
  type ActivityMisconceptionEvidenceLiveEvaluationInput,
  type ActivityMisconceptionEvidenceLiveExecutionResult
} from "@/lib/services/student-assessment/activity-misconception-evidence-live";
import type { StudentSessionState } from "@/lib/student-assessment-ui/types";
import { BranchingStudentSimulator } from "./branching-student";
import { classifyInstructionalStrategy, evaluateScenarioExpectations } from "./deterministic-pedagogical-checks";
import { createFormativeEvaluationFixture, cleanupFormativeEvaluationFixture, type FormativeEvaluationFixture } from "./fixture";
import { evaluateHardInvariants, stableEvaluationHash } from "./hard-invariants";
import { assertAndConfigureE1NoLiveGuard } from "./no-live-guard";
import { evaluatePedagogicalRubric } from "./pedagogical-rubric";
import {
  APPROVED_OPERATIONAL_RUNTIME_HASH,
  FORMATIVE_EVALUATION_ARTIFACT_SCHEMA_VERSION,
  type FormativeEvaluationScenario,
  type StudentIntent
} from "./schemas";
import { buildScriptedStudentTurns } from "./scripted-student";
import { assertStudentPayloadPrivacy } from "./student-privacy-scanner";
import { writeFormativeEvaluationRunArtifacts, type RunManifest } from "./artifact-writer";
import type {
  ActivityAttemptRecord,
  BranchDecision,
  FormativeEvaluationRunArtifacts,
  FormativeEvaluationRunSummary,
  InternalEvaluationRecord,
  PlanHistoryRecord,
  ProfileHistoryRecord,
  SeededStudentTurn,
  StateTransitionRecord,
  VisibleTurnRecord
} from "./types";

type EvaluationContext = {
  student_db_id: string;
  session_public_id: string;
  assessment_session_db_id: string;
  concept_unit_session_db_id: string;
  concept_unit_public_id: string;
};

export type FormativeEvaluationStudentTurnRenderInput = {
  scenario: FormativeEvaluationScenario;
  expression_variant: 1 | 2 | 3;
  turn: SeededStudentTurn | BranchDecision;
  latest_assistant_message: string;
  visible_conversation: Array<{
    role: "assistant" | "student";
    content: string;
    sequence_index: number;
  }>;
};

export type FormativeEvaluationStudentTurnRenderer = (
  input: FormativeEvaluationStudentTurnRenderInput
) => Promise<{ message: string }>;

export type FormativeEvaluationOperationalTurnCompletion = {
  turn: SeededStudentTurn | BranchDecision;
  operational_assistant_response: string | null;
};

export type E2AOperationalUsageRecord = {
  agent_name: string;
  provider: string;
  call_status: string;
  provider_request_present: boolean;
  provider_response_present: boolean;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  estimated_cost_usd: number | null;
  latency_ms: number | null;
  retry_count: number;
};

function jsonRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function prismaJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

async function createMockAgentCall(input: {
  prisma: PrismaClient;
  context: EvaluationContext;
  suffix: string;
  agent_name: string;
  agent_version: string;
  prompt_version: string;
  schema_version: string;
  output_payload: unknown;
}) {
  return input.prisma.agentCall.create({
    data: {
      assessment_session_db_id: input.context.assessment_session_db_id,
      concept_unit_session_db_id: input.context.concept_unit_session_db_id,
      agent_name: input.agent_name,
      agent_version: input.agent_version,
      model_name: "e1-deterministic-mock",
      provider: "mock",
      client_request_id: `e1_${input.suffix}_${randomUUID()}`,
      provider_request_id: `e1_mock_request_${input.suffix}`,
      provider_response_id: `e1_mock_response_${input.suffix}`,
      prompt_version: input.prompt_version,
      schema_version: input.schema_version,
      input_payload: { evaluation_harness: true, protected_inputs_omitted: true },
      output_payload: prismaJson(input.output_payload),
      output_validated: true,
      live_call_allowed: false,
      call_status: "succeeded",
      input_tokens: 1,
      output_tokens: 1,
      total_tokens: 2,
      token_usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
      started_at: new Date(),
      completed_at: new Date()
    }
  });
}

function makeGenerationOverride(input: {
  prisma: PrismaClient;
  context: EvaluationContext;
  scenario: FormativeEvaluationScenario;
}): StudentActivityRuntimeGenerationOverride {
  return async ({ profile_integration_packet, formative_value_packet }) => {
    const deterministic = buildFormativeActivityDesignPacketFromPackets({
      profile_integration_packet,
      formative_value_packet
    });
    const focusItem = input.context.concept_unit_public_id;
    const packet = FormativeActivityPacketV1Schema.parse({
      ...deterministic,
      generation_source: "live_llm",
      runtime_servable_to_student: true,
      review_only: false,
      activity_goal: {
        ...deterministic.activity_goal,
        internal_goal: `${deterministic.activity_goal.internal_goal} E1 focus ${input.scenario.distractor_target.misconception_id}.`
      },
      distractor_use: {
        ...deterministic.distractor_use,
        student_safe_description: deterministic.distractor_use.student_safe_description || `Compare the tempting option in ${focusItem}.`
      }
    });
    const qualityReview = makePassingActivityQualityReviewForTest();
    const generator = await createMockAgentCall({
      prisma: input.prisma,
      context: input.context,
      suffix: `${input.scenario.scenario_id}_activity`,
      agent_name: "formative_activity_dialogue_agent",
      agent_version: "formative-activity-dialogue-e1-mock-v1",
      prompt_version: "approved-production-prompt-unmodified",
      schema_version: "student-formative-activity-v1",
      output_payload: packet
    });
    const reviewer = await createMockAgentCall({
      prisma: input.prisma,
      context: input.context,
      suffix: `${input.scenario.scenario_id}_reviewer`,
      agent_name: "formative_activity_quality_reviewer_agent",
      agent_version: "formative-activity-quality-reviewer-e1-mock-v1",
      prompt_version: "approved-production-prompt-unmodified",
      schema_version: "formative-activity-quality-review-v1",
      output_payload: qualityReview
    });
    return {
      status: "succeeded",
      packet,
      quality_review: qualityReview,
      generator_agent_call_id: generator.id,
      reviewer_agent_call_id: reviewer.id,
      repair_attempted: false,
      generator_call_status: "succeeded",
      reviewer_call_status: "succeeded",
      repair_status: "not_attempted"
    } satisfies FormativeActivityLiveExecutionResult;
  };
}

function evaluatorStatus(intent: StudentIntent, activityFamily: string): MisconceptionUpdateStatus {
  const positive = intent === "revision_evidence" || intent === "robust_explanation";
  const partial = intent === "partial_explanation";
  if (activityFamily === "basic_concept_grounding") {
    if (positive) return "ready_for_distractor_probe";
    if (partial) return "conceptual_entry_improved";
    return "conceptual_entry_gap_remains";
  }
  if (positive) return "no_actionable_misconception_evidence";
  if (partial) return "misconception_weakened";
  if (intent === "off_topic_response" || intent === "assessment_system_question") {
    return "insufficient_new_evidence";
  }
  return "misconception_persisted";
}

function fixtureForStatus(status: MisconceptionUpdateStatus) {
  const distractorStatuses = new Set<MisconceptionUpdateStatus>([
    "misconception_persisted",
    "misconception_weakened",
    "no_actionable_misconception_evidence",
    "insufficient_new_evidence"
  ]);
  const conceptual = !distractorStatuses.has(status);
  return buildNoLiveActivityMisconceptionEvidenceFixture({
    case_id: `e1_${status}`,
    activity_family: conceptual ? "basic_concept_grounding" : "distractor_contrast",
    selected_formative_value: conceptual ? "diagnostic_clarification" : "reasoning_refinement",
    profile_condition: `E1 controlled ${status}`,
    source_diagnostic_purpose: conceptual ? "conceptual_entry_grounding" : "distractor_misconception_probe",
    response_kind: status === "insufficient_new_evidence" ? "unclear" : status.includes("improved") || status.includes("weakened") ? "partial" : "substantive",
    response_length_band: "medium",
    response_summary: "A controlled E1 response supplies redacted evidence for deterministic workflow evaluation.",
    primary_target: conceptual ? "basic_concept_distinction" : "distractor_hidden_assumption",
    evidence_types: conceptual ? ["basic_concept_distinction_stated"] : ["distractor_tempting_reason_explained"],
    update_status: status,
    evidence_quality: status === "insufficient_new_evidence" ? "low" : "medium"
  });
}

function makeEvaluatorOverride(input: {
  prisma: PrismaClient;
  context: EvaluationContext;
  scenario: FormativeEvaluationScenario;
  intent: StudentIntent;
  suffix: string;
}): StudentActivityRuntimeEvaluatorOverride {
  return async (
    evaluationInput: ActivityMisconceptionEvidenceLiveEvaluationInput
  ): Promise<ActivityMisconceptionEvidenceLiveExecutionResult> => {
    const status = evaluatorStatus(input.intent, evaluationInput.source_activity_family);
    const base = fixtureForStatus(status);
    const packet = makeLiveActivityMisconceptionEvidencePacketForTest(base, {
      session_public_id: evaluationInput.session_public_id,
      student_public_id: evaluationInput.student_public_id,
      assessment_public_id: evaluationInput.assessment_public_id,
      concept_unit_id: evaluationInput.concept_unit_id,
      activity_attempt_id: evaluationInput.activity_attempt_id,
      source_activity_family: evaluationInput.source_activity_family,
      source_diagnostic_purpose: evaluationInput.source_diagnostic_purpose,
      source_activity_generation_source: "live_llm",
      source_activity_runtime_servable_to_student: true,
      student_activity_response: {
        ...base.student_activity_response,
        response_kind: evaluationInput.response_kind_hint ?? base.student_activity_response.response_kind,
        student_response_text_redacted_or_safe_summary: "Controlled E1 student response; raw text remains in the conversation table."
      }
    });
    const call = await createMockAgentCall({
      prisma: input.prisma,
      context: input.context,
      suffix: `${input.scenario.scenario_id}_${input.suffix}_evaluator`,
      agent_name: "formative_activity_response_evaluator_agent",
      agent_version: "formative-activity-response-evaluator-e1-mock-v1",
      prompt_version: "approved-production-prompt-unmodified",
      schema_version: "formative-activity-response-evaluation-v1",
      output_payload: packet
    });
    return {
      status: "succeeded",
      packet,
      evaluator_agent_call_id: call.id,
      repair_attempted: false,
      evaluator_call_status: "succeeded",
      repair_status: "not_attempted"
    };
  };
}

async function submitInitialItem(input: {
  context: EvaluationContext;
  state: StudentSessionState;
  response: FormativeEvaluationScenario["initial_responses"][number];
  operation_prefix: string;
}) {
  const item = input.state.current_item;
  if (!item) throw new Error("e1_initial_item_missing");
  let state = (await recordSelectedOption({
    student_user_db_id: input.context.student_db_id,
    session_public_id: input.context.session_public_id,
    item_public_id: item.item_public_id,
    data: { selected_option: input.response.selected_option, client_action_id: `${input.operation_prefix}_answer` }
  })).state;
  const reasoningCandidates = [
    input.response.reasoning_text,
    `${input.response.reasoning_text} I am explaining how person theta differs from an item parameter.`,
    "I do not know the reason yet."
  ];
  for (const [index, reasoning] of reasoningCandidates.entries()) {
    if (state.assessment_state !== "AWAIT_REASON") break;
    state = (await recordReasoning({
      student_user_db_id: input.context.student_db_id,
      session_public_id: input.context.session_public_id,
      item_public_id: item.item_public_id,
      data: { reasoning_text: reasoning, client_action_id: `${input.operation_prefix}_reason_${index + 1}` }
    })).state;
  }
  if (state.assessment_state !== "AWAIT_CONFIDENCE") {
    throw new Error(`e1_reasoning_not_accepted:${state.assessment_state}`);
  }
  state = (await recordConfidence({
    student_user_db_id: input.context.student_db_id,
    session_public_id: input.context.session_public_id,
    item_public_id: item.item_public_id,
    data: { confidence_rating: input.response.confidence, client_action_id: `${input.operation_prefix}_confidence` }
  })).state;
  if (input.response.no_tempting_option) {
    return (await recordTemptingOption({
      student_user_db_id: input.context.student_db_id,
      session_public_id: input.context.session_public_id,
      item_public_id: item.item_public_id,
      data: { no_tempting_option: true, client_action_id: `${input.operation_prefix}_tempting_none` }
    })).state;
  }
  state = (await recordTemptingOption({
    student_user_db_id: input.context.student_db_id,
    session_public_id: input.context.session_public_id,
    item_public_id: item.item_public_id,
    data: { tempting_option: input.response.tempting_option ?? undefined, client_action_id: `${input.operation_prefix}_tempting` }
  })).state;
  const temptingCandidates = [
    input.response.tempting_option_reason ?? "It initially seemed plausible.",
    `${input.response.tempting_option_reason ?? "It seemed plausible."} I was comparing the person estimate with the item feature.`,
    "I do not know why it was tempting yet."
  ];
  for (const [index, reason] of temptingCandidates.entries()) {
    if (state.assessment_state !== "AWAIT_TEMPTING_REASON") break;
    state = (await recordTemptingOption({
      student_user_db_id: input.context.student_db_id,
      session_public_id: input.context.session_public_id,
      item_public_id: item.item_public_id,
      data: { tempting_option_reason: reason, client_action_id: `${input.operation_prefix}_tempting_reason_${index + 1}` }
    })).state;
  }
  return state;
}

async function createCompletedInitialPackage(input: {
  prisma: PrismaClient;
  fixture: FormativeEvaluationFixture;
  scenario: FormativeEvaluationScenario;
}) {
  const started = await startOrResumeStudentAssessmentSession({
    student_user_db_id: input.fixture.student_user_db_id,
    assessment_public_id: input.fixture.assessment_public_id,
    new_attempt: true
  });
  input.fixture.session_public_ids.push(started.session.session_public_id);
  const conceptUnitPublicId = started.state.current_concept_unit?.concept_unit_public_id;
  if (!conceptUnitPublicId) throw new Error("e1_concept_unit_missing");
  let state = await startConceptUnitInitialAdministration({
    student_user_db_id: input.fixture.student_user_db_id,
    session_public_id: started.session.session_public_id,
    concept_unit_public_id: conceptUnitPublicId
  });
  const session = await input.prisma.assessmentSession.findUniqueOrThrow({
    where: { session_public_id: started.session.session_public_id },
    select: { id: true }
  });
  const conceptSession = await input.prisma.conceptUnitSession.findFirstOrThrow({
    where: { assessment_session_db_id: session.id },
    select: { id: true }
  });
  const context: EvaluationContext = {
    student_db_id: input.fixture.student_user_db_id,
    session_public_id: started.session.session_public_id,
    assessment_session_db_id: session.id,
    concept_unit_session_db_id: conceptSession.id,
    concept_unit_public_id: conceptUnitPublicId
  };
  for (const [index, response] of input.scenario.initial_responses.entries()) {
    state = await submitInitialItem({
      context,
      state,
      response,
      operation_prefix: `e1_${input.scenario.scenario_id}_initial_${index + 1}`
    });
  }
  if (state.assessment_state !== "PACKAGE_REVIEW") {
    throw new Error(`e1_package_review_not_reached:${state.assessment_state}`);
  }
  const completed = await completeInitialConceptUnitAdministration({
    student_user_db_id: context.student_db_id,
    session_public_id: context.session_public_id,
    concept_unit_public_id: context.concept_unit_public_id
  });
  if (completed.state.assessment_state !== "FORMATIVE_ACTIVITY") {
    throw new Error(`e1_formative_activity_not_reached:${completed.state.assessment_state}`);
  }
  return context;
}

function clientOperationId(turnId: string, runId: string) {
  return `e1_${runId.slice(-16)}_${turnId}`.slice(0, 120);
}

async function collectVisibleTurns(prisma: PrismaClient, context: EvaluationContext): Promise<VisibleTurnRecord[]> {
  const rows = await prisma.conversationTurn.findMany({
    where: { assessment_session_db_id: context.assessment_session_db_id },
    orderBy: [{ sequence_index: "asc" }],
    select: { sequence_index: true, actor_type: true, message_text: true, phase: true, structured_payload: true, agent_name: true }
  });
  return rows.filter((row) => {
    const payload = jsonRecord(row.structured_payload);
    return payload.shown_to_student !== false && payload.visibility_status !== "not_shown";
  }).map((row) => {
    const payload = jsonRecord(row.structured_payload);
    return {
      turn_key: `turn_${row.sequence_index}`,
      sequence_index: row.sequence_index,
      actor_type: row.actor_type,
      message_text: row.message_text ?? "",
      phase: row.phase,
      client_operation_id: typeof payload.client_operation_id === "string" ? payload.client_operation_id : null,
      message_type: typeof payload.message_type === "string" ? payload.message_type : null,
      agent_name: row.agent_name,
      response_function: typeof payload.response_function === "string" ? payload.response_function : null,
      progression_readiness: typeof payload.progression_readiness === "string" ? payload.progression_readiness : null,
      readiness_gate_reason:
        typeof jsonRecord(payload.readiness_gate).reason_code === "string"
          ? String(jsonRecord(payload.readiness_gate).reason_code)
          : null
    };
  });
}

function simulatorVisibleConversation(turns: VisibleTurnRecord[]) {
  return turns
    .filter((turn) =>
      turn.actor_type === "student" ||
      (turn.actor_type === "agent" && /^(?:formative_activity|topic_dialogue)/u.test(turn.message_type ?? ""))
    )
    .slice(-12)
    .map((turn) => ({
      role: turn.actor_type === "student" ? "student" as const : "assistant" as const,
      content: turn.message_text,
      sequence_index: turn.sequence_index
    }));
}

async function renderStudentTurn(input: {
  renderer?: FormativeEvaluationStudentTurnRenderer;
  scenario: FormativeEvaluationScenario;
  expression_variant: 1 | 2 | 3;
  turn: SeededStudentTurn | BranchDecision;
  latest_assistant_message: string;
  prisma: PrismaClient;
  context: EvaluationContext;
}) {
  if (!input.renderer) return input.turn;
  const visibleTurns = await collectVisibleTurns(input.prisma, input.context);
  const rendered = await input.renderer({
    scenario: input.scenario,
    expression_variant: input.expression_variant,
    turn: input.turn,
    latest_assistant_message: input.latest_assistant_message,
    visible_conversation: simulatorVisibleConversation(visibleTurns)
  });
  const message = rendered.message.trim();
  if (!message) throw new Error("e2a_renderer_returned_empty_message");
  return { ...input.turn, message };
}

async function collectHistories(prisma: PrismaClient, context: EvaluationContext) {
  const [profiles, plans, attempts, evaluations, packages, events, dialogueTurns] = await Promise.all([
    prisma.studentProfile.findMany({ where: { concept_unit_session_db_id: context.concept_unit_session_db_id }, orderBy: [{ created_at: "asc" }] }),
    prisma.formativeDecision.findMany({ where: { concept_unit_session_db_id: context.concept_unit_session_db_id }, orderBy: [{ created_at: "asc" }] }),
    prisma.activityRuntimeAttempt.findMany({ where: { session_public_id: context.session_public_id }, orderBy: [{ created_at: "asc" }] }),
    prisma.activityMisconceptionEvidenceRecord.findMany({ where: { session_public_id: context.session_public_id }, orderBy: [{ created_at: "asc" }] }),
    prisma.responsePackage.findMany({ where: { concept_unit_session_db_id: context.concept_unit_session_db_id }, orderBy: [{ created_at: "asc" }] }),
    prisma.processEvent.findMany({ where: { assessment_session_db_id: context.assessment_session_db_id }, orderBy: [{ occurred_at: "asc" }] }),
    prisma.topicDialogueTurn.findMany({ where: { assessment_session_db_id: context.assessment_session_db_id, actor_type: "agent" }, orderBy: [{ created_at: "asc" }] })
  ]);
  const profileHistory: ProfileHistoryRecord[] = profiles.map((profile, index) => ({
    version_index: index + 1,
    ability_profile: profile.ability_profile,
    engagement_profile: profile.engagement_profile,
    integrated_diagnostic_profile: profile.integrated_diagnostic_profile,
    evidence_sufficiency: profile.evidence_sufficiency,
    created_at: profile.created_at.toISOString()
  }));
  const planHistory: PlanHistoryRecord[] = plans.map((plan, index) => ({
    version_index: index + 1,
    formative_value: plan.formative_value,
    mapping_followed: plan.mapping_followed,
    mapping_deviation_present: Boolean(plan.mapping_deviation_reason),
    created_at: plan.created_at.toISOString()
  }));
  const activityAttempts: ActivityAttemptRecord[] = attempts.map((attempt) => {
    const source = jsonRecord(attempt.source_activity_packet_ref);
    const limitations = Array.isArray(attempt.limitations) ? attempt.limitations : [];
    const distractorAnchorPresent =
      Object.keys(jsonRecord(source.distractor_anchor)).length > 0 ||
      Object.keys(jsonRecord(source.distractor_use)).length > 0 ||
      typeof source.target_option_label === "string" ||
      typeof source.distractor_role === "string" ||
      typeof source.distractor_student_safe_description === "string";
    return {
      activity_attempt_public_id: attempt.activity_attempt_public_id,
      activity_family: attempt.activity_family,
      diagnostic_purpose: attempt.diagnostic_purpose,
      generation_source: attempt.generation_source,
      status: attempt.status,
      distractor_anchor_present: distractorAnchorPresent,
      replaced_activity_attempt_public_id: typeof source.replaced_activity_attempt_public_id === "string" ? source.replaced_activity_attempt_public_id : null,
      recovery_used: limitations.some((entry) => String(entry).includes("recovery"))
    };
  });
  const internalEvaluations: InternalEvaluationRecord[] = evaluations.map((entry) => ({
    evaluation_public_id: entry.evidence_public_id,
    activity_attempt_public_id: entry.activity_attempt_id,
    status: entry.misconception_update_status,
    evidence_quality: entry.evidence_quality,
    evaluation_source: entry.evaluation_source
  }));
  const stateTransitions: StateTransitionRecord[] = events.filter((event) =>
    /state|phase|session_(?:started|completed)|continue_to_transfer/i.test(event.event_type)
  ).map((event, index) => {
    const payload = jsonRecord(event.payload);
    return {
      transition_key: `transition_${index + 1}`,
      from_state: typeof payload.from_phase === "string" ? payload.from_phase : null,
      to_state: typeof payload.to_phase === "string" ? payload.to_phase : event.event_type,
      reason: typeof payload.reason === "string" ? payload.reason : null,
      valid: !String(payload.transition_valid ?? "true").includes("false")
    };
  });
  const packageStageAudits = packages.flatMap((entry) => {
    const audit = jsonRecord(jsonRecord(entry.payload).orchestration_result);
    if (audit.stage !== "profile" && audit.stage !== "planning") return [];
    const stage = audit.stage === "profile" ? "profile" as const : "planning" as const;
    return [{
      stage,
      update_failed: audit.update_failed === true,
      stale_version_used: audit.stale_version_used === true,
      fallback_source_version_present: typeof audit.fallback_source_version === "string"
    }];
  });
  const eventStageAudits = events.flatMap((event) => {
    if (event.event_type !== "followup_profile_update_failed" && event.event_type !== "followup_planning_update_failed") {
      return [];
    }
    const payload = jsonRecord(event.payload);
    return [{
      stage: event.event_type === "followup_profile_update_failed" ? "profile" as const : "planning" as const,
      update_failed: true,
      stale_version_used: payload.stale_profile_used === true || payload.stale_plan_used === true,
      fallback_source_version_present: typeof payload.fallback_source_version === "string"
    }];
  });
  const stageAudits = [...packageStageAudits, ...eventStageAudits];
  const strategies = [
    ...activityAttempts.map((attempt) => classifyInstructionalStrategy({ activity_family: attempt.activity_family })),
    ...dialogueTurns.map((turn) => {
      const payload = jsonRecord(turn.structured_payload);
      return classifyInstructionalStrategy({
        response_function:
          typeof payload.response_function === "string"
            ? payload.response_function
            : turn.message_function,
        recovery_used: payload.recovery_message === true
      });
    })
  ];
  return { profileHistory, planHistory, activityAttempts, internalEvaluations, stateTransitions, stageAudits, events, strategies };
}

function safetyFindings(visibleTurns: VisibleTurnRecord[]) {
  const text = visibleTurns.map((turn) => turn.message_text).join("\n");
  const checks = [
    ["raw_answer_key_structure", /\b(correct_option|correctness|answer_key|distractor_rationales|expected_reasoning_patterns|possible_misconception_indicators)\b/i, "critical"],
    ["internal_profile_or_plan", /\b(ability_profile|engagement_profile|integrated_diagnostic_profile|formative_value)\b/i, "critical"],
    ["agent_metadata", /\b(agent_name|prompt_version|schema_version|operational_config_hash|raw_output)\b/i, "major"],
    ["fallback_metadata", /\b(fallback_source_version|failure_agent_call_id|stale_profile_used|stale_plan_used)\b/i, "major"]
  ] as const;
  return checks.map(([findingId, pattern, severity]) => ({
    finding_id: findingId,
    passed: !pattern.test(text),
    severity,
    detail: pattern.test(text) ? `Protected ${findingId} language appeared in student-visible text.` : `No ${findingId} language appeared in student-visible text.`
  }));
}

async function providerCallCount(prisma: PrismaClient, context: EvaluationContext) {
  return prisma.agentCall.count({
    where: {
      assessment_session_db_id: context.assessment_session_db_id,
      provider: { not: "mock" },
      OR: [
        { provider_request_id: { not: null } },
        { provider_response_id: { not: null } },
        { total_tokens: { not: null } }
      ]
    }
  });
}

async function collectE2AOperationalUsage(
  prisma: PrismaClient,
  context: EvaluationContext
): Promise<E2AOperationalUsageRecord[]> {
  return (await prisma.agentCall.findMany({
    where: {
      assessment_session_db_id: context.assessment_session_db_id,
      provider: { not: "mock" }
    },
    orderBy: [{ created_at: "asc" }],
    select: {
      agent_name: true,
      provider: true,
      call_status: true,
      provider_request_id: true,
      provider_response_id: true,
      input_tokens: true,
      output_tokens: true,
      total_tokens: true,
      estimated_cost: true,
      latency_ms: true,
      retry_count: true
    }
  })).map((call) => ({
    agent_name: call.agent_name,
    provider: call.provider,
    call_status: call.call_status,
    provider_request_present: Boolean(call.provider_request_id),
    provider_response_present: Boolean(call.provider_response_id),
    input_tokens: call.input_tokens ?? 0,
    output_tokens: call.output_tokens ?? 0,
    total_tokens: call.total_tokens ?? 0,
    estimated_cost_usd: call.estimated_cost === null ? null : Number(call.estimated_cost),
    latency_ms: call.latency_ms,
    retry_count: call.retry_count
  }));
}

async function completeTransferFailure(input: {
  context: EvaluationContext;
  state: StudentSessionState;
  run_id: string;
  reasoning_text?: string;
}) {
  const item = input.state.current_item;
  if (!item) throw new Error("e1_transfer_item_missing");
  let state = (await recordSelectedOption({
    student_user_db_id: input.context.student_db_id,
    session_public_id: input.context.session_public_id,
    item_public_id: item.item_public_id,
    data: { selected_option: "A", client_action_id: `${input.run_id}_transfer_answer` }
  })).state;
  state = (await recordReasoning({
    student_user_db_id: input.context.student_db_id,
    session_public_id: input.context.session_public_id,
    item_public_id: item.item_public_id,
    data: {
      reasoning_text: input.reasoning_text ?? "The student with harder items must have higher ability.",
      client_action_id: `${input.run_id}_transfer_reason`
    }
  })).state;
  if (state.assessment_state === "AWAIT_REASON") {
    state = (await recordReasoning({
      student_user_db_id: input.context.student_db_id,
      session_public_id: input.context.session_public_id,
      item_public_id: item.item_public_id,
      data: { reasoning_text: "I still think harder items directly indicate higher person ability.", client_action_id: `${input.run_id}_transfer_reason_retry` }
    })).state;
  }
  state = (await recordConfidence({
    student_user_db_id: input.context.student_db_id,
    session_public_id: input.context.session_public_id,
    item_public_id: item.item_public_id,
    data: { confidence_rating: "high", client_action_id: `${input.run_id}_transfer_confidence` }
  })).state;
  state = (await recordTemptingOption({
    student_user_db_id: input.context.student_db_id,
    session_public_id: input.context.session_public_id,
    item_public_id: item.item_public_id,
    data: { no_tempting_option: true, client_action_id: `${input.run_id}_transfer_tempting_none` }
  })).state;
  return state;
}

export type RunFormativeEvaluationOptions = {
  prisma: PrismaClient;
  scenario: FormativeEvaluationScenario;
  seed: number;
  run_index?: number;
  artifact_dir?: string;
  keep_fixture_on_failure?: boolean;
  fail_on_major?: boolean;
  e2a_execution?: {
    mode: "e2a_live_operational" | "e2a_injected_no_live_test";
    expression_variant: 1 | 2 | 3;
    student_turn_renderer: FormativeEvaluationStudentTurnRenderer;
    on_operational_turn_completed?: (
      input: FormativeEvaluationOperationalTurnCompletion
    ) => Promise<void> | void;
    on_operational_usage_collected?: (
      usage: E2AOperationalUsageRecord[]
    ) => Promise<void> | void;
  };
};

export type FormativeEvaluationE1RunResult = {
  manifest: RunManifest;
  artifacts: FormativeEvaluationRunArtifacts;
  artifact_directory: string;
};

export type FormativeEvaluationE2ACoreRunResult = {
  manifest: {
    artifact_schema_version: "formative-evaluation-e2a-core-v1";
    run_id: string;
    scenario_id: string;
    scenario_version: string;
    expression_variant: 1 | 2 | 3;
    git_commit: string;
    operational_runtime_hash: string;
    provider_access_enabled: boolean;
    cleanup_result: {
      attempted: boolean;
      succeeded: boolean;
      retained_on_failure: boolean;
      detail: string;
    };
  };
  artifacts: FormativeEvaluationRunArtifacts;
  artifact_directory: null;
  operational_usage: E2AOperationalUsageRecord[];
};

export function runFormativeEvaluationScenario(
  options: RunFormativeEvaluationOptions & { e2a_execution: NonNullable<RunFormativeEvaluationOptions["e2a_execution"]> }
): Promise<FormativeEvaluationE2ACoreRunResult>;
export function runFormativeEvaluationScenario(
  options: RunFormativeEvaluationOptions & { e2a_execution?: undefined }
): Promise<FormativeEvaluationE1RunResult>;

export async function runFormativeEvaluationScenario(
  options: RunFormativeEvaluationOptions
): Promise<FormativeEvaluationE1RunResult | FormativeEvaluationE2ACoreRunResult> {
  const e2aExecution = options.e2a_execution;
  const liveOperationalExecution = e2aExecution?.mode === "e2a_live_operational";
  const noLive = liveOperationalExecution ? null : assertAndConfigureE1NoLiveGuard();
  // E1 runs from the checked-out source tree. A previously generated local build
  // artifact may legitimately describe an older commit, so use the shared
  // resolver's deployment metadata and Git sources for this source evaluation.
  const buildInfo = resolveApplicationBuildInfo({
    artifactPath: path.join(process.cwd(), "__nonexistent_e1_build_info.json")
  });
  if (!buildInfo.ok) throw new Error(buildInfo.code);
  const runIndex = options.run_index ?? 1;
  const runId = `${e2aExecution ? "fev_e2a" : "fev"}_${options.scenario.scenario_id}_${options.seed}_${runIndex}_${buildInfo.info.application_git_commit.slice(0, 8)}`;
  const artifactRoot = path.resolve(options.artifact_dir ?? "artifacts/formative-evaluation");
  const startedAt = new Date();
  let fixture: FormativeEvaluationFixture | null = null;
  let cleanup = { attempted: false, succeeded: false, retained_on_failure: false, detail: "cleanup_not_started" };
  let failed: unknown = null;
  let captured: Omit<FormativeEvaluationRunArtifacts, "hard_invariants" | "pedagogical_rubric" | "safety_findings" | "run_summary"> | null = null;
  let hardInvariants: FormativeEvaluationRunArtifacts["hard_invariants"] = [];
  let pedagogicalRubric: FormativeEvaluationRunArtifacts["pedagogical_rubric"] = [];
  let findings: FormativeEvaluationRunArtifacts["safety_findings"] = [];
  let summary: FormativeEvaluationRunSummary | null = null;
  let context: EvaluationContext | null = null;
  let duplicateCycleExtraCount = 0;
  let idempotentReplayRejectedCount = 0;
  let terminalSubmissionRejectedCount = 0;
  let operationalUsage: E2AOperationalUsageRecord[] = [];

  try {
    fixture = await createFormativeEvaluationFixture({ prisma: options.prisma, scenario_id: options.scenario.scenario_id, seed: options.seed });
    context = await createCompletedInitialPackage({ prisma: options.prisma, fixture, scenario: options.scenario });
    if (e2aExecution) {
      assertStudentPayloadPrivacy(
        await getStudentSessionState({ student_user_db_id: context.student_db_id, session_public_id: context.session_public_id }),
        "e2a.initial_package_state"
      );
    }
    let projection = await startStudentActivityForSession({
      student_user_db_id: context.student_db_id,
      session_public_id: context.session_public_id,
      ...(liveOperationalExecution
        ? {}
        : { activity_generation_override: makeGenerationOverride({ prisma: options.prisma, context, scenario: options.scenario }) })
    });
    if (e2aExecution) assertStudentPayloadPrivacy(projection, "e2a.activity_projection");
    if (!projection.activity_attempt_public_id || !projection.first_turn_message) {
      throw new Error("e1_activity_not_started");
    }

    const studentTurns: SeededStudentTurn[] = [];
    const branchDecisions: BranchDecision[] = [];
    let scriptedIndex = 0;
    const scripted = options.scenario.simulator_mode === "scripted"
      ? buildScriptedStudentTurns({ scenario: options.scenario })
      : [];
    const branching = options.scenario.simulator_mode === "branching"
      ? new BranchingStudentSimulator(options.scenario, options.seed)
      : null;
    let latestAssistant = projection.first_turn_message;
    let idempotencyChecked = false;
    let lastAcceptedState = structuredClone(options.scenario.initial_student_state);

    while (true) {
      const branchTurn = branching?.next(latestAssistant) ?? null;
      const deterministicTurn: SeededStudentTurn | BranchDecision | null =
        branchTurn ?? scripted[scriptedIndex++] ?? null;
      if (!deterministicTurn) break;
      const turn = await renderStudentTurn({
        renderer: e2aExecution?.student_turn_renderer,
        scenario: options.scenario,
        expression_variant: e2aExecution?.expression_variant ?? 1,
        turn: deterministicTurn,
        latest_assistant_message: latestAssistant,
        prisma: options.prisma,
        context
      });
      studentTurns.push(turn);
      if (branchTurn) branchDecisions.push(turn as BranchDecision);
      const operationId = clientOperationId(turn.turn_id, runId);
      const submittedActivityAttemptPublicId = projection.activity_attempt_public_id ?? "";
      try {
        projection = await submitStudentActivityRuntimeResponse({
          student_user_db_id: context.student_db_id,
          session_public_id: context.session_public_id,
          activity_attempt_public_id: submittedActivityAttemptPublicId,
          response_text: turn.message,
          client_message_id: operationId,
          ...(liveOperationalExecution
            ? {}
            : { evaluator_override: makeEvaluatorOverride({ prisma: options.prisma, context, scenario: options.scenario, intent: turn.intent, suffix: turn.turn_id }) })
        });
      } catch (error) {
        if (error instanceof Error && error.message === "This formative episode has already ended.") {
          terminalSubmissionRejectedCount += 1;
          break;
        }
        throw error;
      }
      if (e2aExecution) assertStudentPayloadPrivacy(projection, `e2a.turn.${turn.turn_id}.projection`);
      lastAcceptedState = structuredClone(turn.resulting_state);
      latestAssistant = projection.topic_dialogue?.response_prompt ?? projection.feedback?.message ?? latestAssistant;
      await e2aExecution?.on_operational_turn_completed?.({
        turn,
        operational_assistant_response: latestAssistant
      });

      if (!idempotencyChecked) {
        const before = {
          turns: await options.prisma.conversationTurn.count({ where: { assessment_session_db_id: context.assessment_session_db_id } }),
          packages: await options.prisma.responsePackage.count({ where: { concept_unit_session_db_id: context.concept_unit_session_db_id } }),
          evidence: await options.prisma.activityMisconceptionEvidenceRecord.count({ where: { session_public_id: context.session_public_id } })
        };
        try {
          await submitStudentActivityRuntimeResponse({
            student_user_db_id: context.student_db_id,
            session_public_id: context.session_public_id,
            activity_attempt_public_id: submittedActivityAttemptPublicId,
            response_text: turn.message,
            client_message_id: operationId,
            ...(liveOperationalExecution
              ? {}
              : { evaluator_override: makeEvaluatorOverride({ prisma: options.prisma, context, scenario: options.scenario, intent: turn.intent, suffix: `${turn.turn_id}_replay` }) })
          });
        } catch (error) {
          if (error instanceof Error && error.message === "This formative episode has already ended.") {
            idempotentReplayRejectedCount += 1;
          } else {
            throw error;
          }
        }
        const after = {
          turns: await options.prisma.conversationTurn.count({ where: { assessment_session_db_id: context.assessment_session_db_id } }),
          packages: await options.prisma.responsePackage.count({ where: { concept_unit_session_db_id: context.concept_unit_session_db_id } }),
          evidence: await options.prisma.activityMisconceptionEvidenceRecord.count({ where: { session_public_id: context.session_public_id } })
        };
        duplicateCycleExtraCount = (after.turns - before.turns) + (after.packages - before.packages) + (after.evidence - before.evidence);
        idempotencyChecked = true;
      }
      const recurrenceEvidencePending = Boolean(
        branching &&
        options.scenario.branching_policy?.recur_on_final_turn &&
        lastAcceptedState.turn_index < options.scenario.branching_policy.max_turns
      );
      if (!projection.can_submit_response && !recurrenceEvidencePending) break;
    }

    let finalState = lastAcceptedState;
    let platformState = (await getStudentSessionState({ student_user_db_id: context.student_db_id, session_public_id: context.session_public_id })).assessment_state;
    if (options.scenario.expected_behavior.transfer_expected) {
      if (!projection.can_continue) {
        const deterministicNavigationTurn: SeededStudentTurn = {
          turn_id: "transfer_navigation_evidence",
          intent: "unsupported_understanding_claim",
          message: "I understand now.",
          prior_state: structuredClone(finalState),
          resulting_state: structuredClone({ ...finalState, turn_index: finalState.turn_index + 1 })
        };
        const navigationTurn = await renderStudentTurn({
          renderer: e2aExecution?.student_turn_renderer,
          scenario: options.scenario,
          expression_variant: e2aExecution?.expression_variant ?? 1,
          turn: deterministicNavigationTurn,
          latest_assistant_message: latestAssistant,
          prisma: options.prisma,
          context
        });
        studentTurns.push(navigationTurn);
        try {
          projection = await submitStudentActivityRuntimeResponse({
            student_user_db_id: context.student_db_id,
            session_public_id: context.session_public_id,
            activity_attempt_public_id: projection.activity_attempt_public_id ?? "",
            response_text: navigationTurn.message,
            client_message_id: clientOperationId(navigationTurn.turn_id, runId),
            ...(liveOperationalExecution
              ? {}
              : { evaluator_override: makeEvaluatorOverride({ prisma: options.prisma, context, scenario: options.scenario, intent: navigationTurn.intent, suffix: navigationTurn.turn_id }) })
          });
          finalState = navigationTurn.resulting_state;
          latestAssistant = projection.topic_dialogue?.response_prompt ?? projection.feedback?.message ?? latestAssistant;
          await e2aExecution?.on_operational_turn_completed?.({
            turn: navigationTurn,
            operational_assistant_response: latestAssistant
          });
        } catch (error) {
          if (error instanceof Error && error.message === "This formative episode has already ended.") {
            terminalSubmissionRejectedCount += 1;
          } else {
            throw error;
          }
        }
      }
      if (projection.can_continue && projection.allowed_actions.includes("skip_activity_to_transfer")) {
        const deterministicTransferEvidenceTurn = scripted.slice(scriptedIndex).find((turn) =>
          turn.intent === "transfer_failure"
        ) ?? null;
        const transferEvidenceTurn = deterministicTransferEvidenceTurn
          ? await renderStudentTurn({
              renderer: e2aExecution?.student_turn_renderer,
              scenario: options.scenario,
              expression_variant: e2aExecution?.expression_variant ?? 1,
              turn: deterministicTransferEvidenceTurn,
              latest_assistant_message: latestAssistant,
              prisma: options.prisma,
              context
            })
          : null;
        await recordStudentActivityRuntimeChoice({
          student_user_db_id: context.student_db_id,
          session_public_id: context.session_public_id,
          activity_attempt_public_id: projection.activity_attempt_public_id,
          choice_state: "skip_activity_to_transfer",
          client_action_id: `${runId}_continue_transfer`
        });
        let transferState = await getStudentSessionState({ student_user_db_id: context.student_db_id, session_public_id: context.session_public_id });
        platformState = transferState.assessment_state;
        if (transferState.assessment_state === "TRANSFER_ITEM") {
          transferState = await completeTransferFailure({
            context,
            state: transferState,
            run_id: runId,
            reasoning_text: transferEvidenceTurn?.message
          });
          platformState = transferState.assessment_state;
          if (transferEvidenceTurn) {
            studentTurns.push(transferEvidenceTurn);
            finalState = structuredClone(transferEvidenceTurn.resulting_state);
            scriptedIndex = scripted.indexOf(transferEvidenceTurn) + 1;
            await e2aExecution?.on_operational_turn_completed?.({
              turn: transferEvidenceTurn,
              operational_assistant_response: null
            });
          }
        }
      }
    }

    const transcriptBefore = await getStudentSafeTranscript({ student_user_db_id: context.student_db_id, session_public_id: context.session_public_id });
    const visibleBefore = await collectVisibleTurns(options.prisma, context);
    const transcriptAfter = await getStudentSafeTranscript({ student_user_db_id: context.student_db_id, session_public_id: context.session_public_id });
    const visibleAfter = await collectVisibleTurns(options.prisma, context);
    const histories = await collectHistories(options.prisma, context);
    const providerCalls = await providerCallCount(options.prisma, context);
    if (!e2aExecution && providerCalls !== 0) {
      throw new Error("e1_live_provider_call_detected");
    }
    if (e2aExecution) {
      assertStudentPayloadPrivacy(transcriptBefore, "e2a.transcript_before_refresh");
      assertStudentPayloadPrivacy(transcriptAfter, "e2a.transcript_after_refresh");
      operationalUsage = await collectE2AOperationalUsage(options.prisma, context);
      await e2aExecution.on_operational_usage_collected?.(operationalUsage);
    }
    findings = safetyFindings(visibleAfter);
    const activeCount = histories.activityAttempts.filter((attempt) => !["move_on_recommended", "choose_alternative_recommended", "failed_closed"].includes(attempt.status)).length;
    const recoveryCount = histories.activityAttempts.filter((attempt) => attempt.recovery_used).length + histories.events.filter((event) => event.event_type.includes("fallback_used")).length;
    const typedRecoveryCount = histories.events.filter((event) =>
      event.event_type.includes("fallback_used") &&
      (Boolean(jsonRecord(event.payload).reason) || Boolean(event.event_type))
    ).length + histories.activityAttempts.filter((attempt) => attempt.recovery_used).length;
    const requestedInvariants = e2aExecution
      ? options.scenario.hard_invariants.filter((invariant) => invariant !== "no_live_provider_call")
      : options.scenario.hard_invariants;
    hardInvariants = evaluateHardInvariants({
      visible_turns: visibleAfter,
      profile_history: histories.profileHistory,
      plan_history: histories.planHistory,
      activity_attempts: histories.activityAttempts,
      state_transitions: histories.stateTransitions,
      response_package_stage_audits: histories.stageAudits,
      refresh_projection_hash_before: stableEvaluationHash(transcriptBefore),
      refresh_projection_hash_after: stableEvaluationHash(transcriptAfter),
      visible_turn_hash_before: stableEvaluationHash(visibleBefore),
      visible_turn_hash_after: stableEvaluationHash(visibleAfter),
      runtime_hash: APPROVED_OPERATIONAL_RUNTIME_HASH,
      provider_call_count: providerCalls,
      duplicate_cycle_extra_count: duplicateCycleExtraCount,
      idempotent_replay_rejected_count: idempotentReplayRejectedCount,
      active_activity_count: activeCount,
      recovery_turn_count: recoveryCount,
      typed_recovery_turn_count: typedRecoveryCount,
      fallback_student_visible_leak_count: findings.filter((finding) => finding.finding_id === "fallback_metadata" && !finding.passed).length,
      replacement_history_preserved: true
    }, requestedInvariants);
    const answerKeyLeakCount = findings.filter((finding) => finding.finding_id === "raw_answer_key_structure" && !finding.passed).length;
    pedagogicalRubric = evaluatePedagogicalRubric({
      scenario: options.scenario,
      artifacts: {
        visible_turns: visibleAfter,
        final_student_state: finalState,
        profile_history: histories.profileHistory,
        plan_history: histories.planHistory
      },
      strategies: histories.strategies,
      answer_key_leak_count: answerKeyLeakCount
    });
    const expectation = evaluateScenarioExpectations({
      scenario: options.scenario,
      artifacts: {
        visible_turns: visibleAfter,
        final_student_state: finalState,
        profile_history: histories.profileHistory,
        plan_history: histories.planHistory,
        state_transitions: histories.stateTransitions
      },
      strategies: histories.strategies,
      final_platform_state: platformState.toLowerCase()
    });
    const criticalFailures = hardInvariants.filter((entry) => !entry.passed && entry.severity === "critical").length;
    const majorFailures = hardInvariants.filter((entry) => !entry.passed && entry.severity === "major").length;
    const minorFailures = hardInvariants.filter((entry) => !entry.passed && entry.severity === "minor").length;
    const studentDialogueTurns = visibleAfter.filter((turn) => turn.actor_type === "student" && turn.client_operation_id);
    const assistantReplies = studentDialogueTurns.filter((student) => visibleAfter.some((turn) => turn.actor_type === "agent" && turn.client_operation_id === student.client_operation_id && turn.sequence_index > student.sequence_index)).length;
    const prematureCount = expectation.premature_resolution ? 1 : 0;
    const failedExpectations = [
      ...(!expectation.minimum_replies_passed ? ["minimum_visible_assistant_replies"] : []),
      ...(!expectation.strategy_change_expectation_passed ? ["minimum_strategy_changes"] : []),
      ...(!expectation.distractor_focus_passed ? ["expected_distractor_focus"] : []),
      ...(!expectation.permitted_final_state ? ["permitted_final_state"] : []),
      ...(expectation.premature_resolution ? ["misconception_resolution_timing"] : []),
      ...(!expectation.revision_expectation_passed ? ["revision_expected"] : []),
      ...(!expectation.transfer_expectation_passed ? ["transfer_expected"] : [])
    ];
    const failedHardInvariants = hardInvariants.filter((entry) => !entry.passed).map((entry) => entry.invariant_id);
    const criticalFindings = [
      ...hardInvariants.filter((entry) => !entry.passed && entry.severity === "critical").map((entry) => entry.invariant_id),
      ...findings.filter((entry) => !entry.passed && entry.severity === "critical").map((entry) => entry.finding_id)
    ];
    const rubricDimensionsNeedingReview = pedagogicalRubric
      .filter((entry) => entry.status === "manual_review_required")
      .map((entry) => entry.dimension);
    const passed = criticalFailures === 0 &&
      expectation.minimum_replies_passed &&
      expectation.strategy_change_expectation_passed &&
      expectation.distractor_focus_passed &&
      expectation.permitted_final_state &&
      expectation.revision_expectation_passed &&
      expectation.transfer_expectation_passed &&
      !expectation.premature_resolution &&
      (!options.fail_on_major || majorFailures === 0);
    const artifactPath = path.join(artifactRoot, runId);
    summary = {
      artifact_schema_version: FORMATIVE_EVALUATION_ARTIFACT_SCHEMA_VERSION,
      run_id: runId,
      scenario_id: options.scenario.scenario_id,
      scenario_version: options.scenario.scenario_version,
      simulator_mode: options.scenario.simulator_mode,
      seed: options.seed,
      passed,
      critical_invariant_failure_count: criticalFailures,
      major_invariant_failure_count: majorFailures,
      minor_invariant_failure_count: minorFailures,
      visible_student_turn_count: studentDialogueTurns.length,
      visible_assistant_reply_count: assistantReplies,
      missing_reply_count: studentDialogueTurns.length - assistantReplies,
      terminal_submission_rejected_count: terminalSubmissionRejectedCount,
      idempotent_replay_rejected_count: idempotentReplayRejectedCount,
      strategy_change_count: expectation.strategy_change_count,
      strategies: histories.strategies,
      fallback_count: histories.events.filter((event) => event.event_type.includes("fallback")).length,
      recovery_turn_count: recoveryCount,
      replacement_activity_count: histories.activityAttempts.filter((attempt) => attempt.replaced_activity_attempt_public_id).length,
      refresh_mismatch_count: stableEvaluationHash(transcriptBefore) === stableEvaluationHash(transcriptAfter) ? 0 : 1,
      answer_key_leak_count: answerKeyLeakCount,
      internal_metadata_leak_count: findings.filter((finding) => !finding.passed && finding.finding_id !== "raw_answer_key_structure").length,
      premature_resolution_flag_count: prematureCount,
      revision_readiness_count: histories.strategies.filter(
        (strategy) => strategy === "revision_request"
      ).length,
      transfer_readiness_count:
        options.scenario.expected_behavior.transfer_expected && expectation.transfer_was_presented
          ? 1
          : 0,
      manual_review_required_count: pedagogicalRubric.filter((entry) => entry.status === "manual_review_required").length,
      failed_expectations: failedExpectations,
      failed_hard_invariants: failedHardInvariants,
      critical_findings: criticalFindings,
      rubric_dimensions_needing_review: rubricDimensionsNeedingReview,
      final_profile_status: histories.profileHistory.at(-1)?.integrated_diagnostic_profile ?? null,
      final_plan_action: histories.planHistory.at(-1)?.formative_value ?? null,
      final_platform_state: platformState.toLowerCase(),
      final_hidden_state: finalState,
      misconception_type: options.scenario.distractor_target.misconception_id,
      initial_conceptual_state: options.scenario.initial_student_state.conceptual_state,
      initial_engagement_state: options.scenario.initial_student_state.engagement,
      initial_confidence: options.scenario.initial_student_state.confidence,
      provider_call_count: providerCalls,
      fixture_cleaned: false,
      artifact_path: artifactPath
    };
    captured = {
      scenario: options.scenario,
      initial_student_state: options.scenario.initial_student_state,
      final_student_state: finalState,
      student_turns: studentTurns,
      visible_assistant_turns: visibleAfter.filter((turn) => turn.actor_type === "agent"),
      visible_turns: visibleAfter,
      profile_history: histories.profileHistory,
      plan_history: histories.planHistory,
      activity_attempts: histories.activityAttempts,
      internal_evaluations: histories.internalEvaluations,
      state_transitions: histories.stateTransitions,
      branch_decisions: branchDecisions
    };
  } catch (error) {
    failed = error;
    if (e2aExecution && context) {
      try {
        operationalUsage = await collectE2AOperationalUsage(options.prisma, context);
        await e2aExecution.on_operational_usage_collected?.(operationalUsage);
      } catch {
        // Preserve the primary run failure; missing usage is visible in E2A artifacts.
      }
    }
  } finally {
    if (fixture) {
      cleanup.attempted = true;
      if (failed && options.keep_fixture_on_failure) {
        cleanup = { attempted: true, succeeded: false, retained_on_failure: true, detail: "Fixture retained because --keep-fixture-on-failure was set." };
      } else {
        try {
          await cleanupFormativeEvaluationFixture({ prisma: options.prisma, fixture });
          cleanup = { attempted: true, succeeded: true, retained_on_failure: false, detail: "Only E1 fixture records were removed." };
        } catch (cleanupError) {
          cleanup = { attempted: true, succeeded: false, retained_on_failure: false, detail: cleanupError instanceof Error ? cleanupError.message : "cleanup_failed" };
          failed ??= cleanupError;
        }
      }
    }
  }

  if (failed || !fixture || !context || !captured || !summary) {
    throw failed instanceof Error ? failed : new Error("e1_run_failed_without_result");
  }
  summary.fixture_cleaned = cleanup.succeeded;
  const completedAt = new Date();
  const artifacts: FormativeEvaluationRunArtifacts = {
    ...captured,
    hard_invariants: hardInvariants,
    pedagogical_rubric: pedagogicalRubric,
    safety_findings: findings,
    run_summary: summary
  };
  if (e2aExecution) {
    return {
      manifest: {
        artifact_schema_version: "formative-evaluation-e2a-core-v1",
        run_id: runId,
        scenario_id: options.scenario.scenario_id,
        scenario_version: options.scenario.scenario_version,
        expression_variant: e2aExecution.expression_variant,
        git_commit: buildInfo.info.application_git_commit,
        operational_runtime_hash: APPROVED_OPERATIONAL_RUNTIME_HASH,
        provider_access_enabled: liveOperationalExecution,
        cleanup_result: cleanup
      },
      artifacts,
      artifact_directory: null,
      operational_usage: operationalUsage
    } satisfies FormativeEvaluationE2ACoreRunResult;
  }
  if (!noLive) throw new Error("e1_no_live_guard_missing");
  const manifest: RunManifest = {
    artifact_schema_version: FORMATIVE_EVALUATION_ARTIFACT_SCHEMA_VERSION,
    run_id: runId,
    scenario_id: options.scenario.scenario_id,
    scenario_version: options.scenario.scenario_version,
    seed: options.seed,
    simulator_mode: options.scenario.simulator_mode,
    git_commit: buildInfo.info.application_git_commit,
    operational_runtime_hash: APPROVED_OPERATIONAL_RUNTIME_HASH,
    model_mode: noLive.model_mode,
    provider_access_enabled: false,
    provider_call_count: 0,
    live_student_simulator_enabled: false,
    live_rubric_evaluator_enabled: false,
    started_at: startedAt.toISOString(),
    completed_at: completedAt.toISOString(),
    fixture_public_ids: {
      assessment_public_id: fixture.assessment_public_id,
      concept_unit_public_id: fixture.concept_unit_public_id,
      item_public_ids: fixture.item_public_ids,
      session_public_id: context.session_public_id
    },
    cleanup_result: cleanup
  };
  const artifactDirectory = await writeFormativeEvaluationRunArtifacts({ artifact_root: artifactRoot, manifest, artifacts });
  return { manifest, artifacts, artifact_directory: artifactDirectory };
}
