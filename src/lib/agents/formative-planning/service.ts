import { Prisma } from "@prisma/client";
import type { MockProviderMode } from "@/lib/llm/providers/mock-provider";
import { executeOperationalAgent } from "@/lib/agents/operational/executor";
import { persistOperationalEffectiveResult } from "@/lib/agents/operational/effective-results";
import { prisma } from "@/lib/db";
import { logProcessEvent } from "@/lib/services/process-events";
import { updateAssessmentSessionPhase } from "@/lib/services/session-state";
import { toPrismaJson } from "@/lib/services/json";
import {
  buildInitialFormativePlanningInput,
  buildUpdatedFormativePlanningInput,
  type BuiltFormativePlanningInput
} from "./input-builder";
import { persistInitialFormativeDecision } from "./persistence";
import {
  canonicalizeFormativePlanningOutput,
  FormativePlanningSemanticValidationError,
  validateFormativePlanningSemantics
} from "./semantic-validation";
import {
  serializeFormativeDecisionForTeacher,
  type FormativeDecisionWithAgentCall
} from "./serializers";

export class FormativePlanningServiceError extends Error {
  code: string;
  status: number;
  details: Record<string, unknown>;

  constructor(
    code: string,
    message: string,
    status = 400,
    details: Record<string, unknown> = {}
  ) {
    super(message);
    this.name = "FormativePlanningServiceError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

type RunInitialFormativePlanningInput = {
  concept_unit_session_db_id: string;
  requested_by_user_db_id?: string;
  invocation_reason: string;
  force_new_invocation?: boolean;
  mock_provider_mode?: MockProviderMode;
};

type FormativePlanningCandidateInput = {
  concept_unit_session_db_id: string;
  followup_evidence_package_db_id: string;
  staged_student_profile_output: Record<string, unknown>;
  previous_student_profile_db_id: string;
  cycle_public_id: string;
  invocation_reason: string;
  force_new_invocation?: boolean;
  mock_provider_mode?: MockProviderMode;
};

async function decisionByInvocationKey(agentInvocationKey: string) {
  return prisma.formativeDecision.findFirst({
    where: {
      based_on_agent_call: {
        agent_invocation_key: agentInvocationKey,
        call_status: "succeeded",
        output_validated: true
      }
    },
    include: {
      based_on_agent_call: {
        select: {
          agent_name: true,
          provider: true,
          model_name: true,
          agent_version: true,
          prompt_version: true,
          schema_version: true,
          prompt_hash: true,
          retry_count: true,
          call_status: true,
          output_validated: true,
          live_call_allowed: true,
          blocked_reason: true,
          created_at: true,
          completed_at: true
        }
      }
    }
  });
}

async function logPlanningEvent(input: {
  assessment_session_db_id: string;
  concept_unit_session_db_id: string;
  event_type:
    | "formative_planning_started"
    | "formative_planning_succeeded"
    | "formative_planning_failed"
    | "agent_call_started"
    | "agent_call_succeeded"
    | "agent_call_failed"
    | "schema_validation_succeeded"
    | "schema_validation_failed";
  payload?: Record<string, unknown>;
}) {
  await logProcessEvent({
    assessment_session_db_id: input.assessment_session_db_id,
    concept_unit_session_db_id: input.concept_unit_session_db_id,
    event_type: input.event_type,
    event_category: input.event_type.startsWith("formative_planning")
      ? "formative_planning"
      : "agent_execution",
    event_source: input.event_type.startsWith("agent_call") ? "agent" : "backend",
    payload: input.payload,
    occurred_at: new Date()
  });
}

function decisionSummary(decision: FormativeDecisionWithAgentCall) {
  return serializeFormativeDecisionForTeacher(decision);
}

function planningContextPublicId(built: BuiltFormativePlanningInput) {
  const metadata = built.input.concept_unit_metadata as {
    assessment_session?: { session_public_id?: string };
    concept_unit?: { concept_unit_public_id?: string };
  };

  return [
    metadata.assessment_session?.session_public_id ?? "unknown_session",
    metadata.concept_unit?.concept_unit_public_id ?? "unknown_concept_unit"
  ].join(":");
}

function deterministicPlanningFallback(built: BuiltFormativePlanningInput) {
  return {
    agent_name: "formative_value_and_planning_agent" as const,
    agent_version: "deterministic-fallback",
    prompt_version: "formative-planning-deterministic-fallback-v1",
    schema_version: "formative-planning-output-v1",
    output_status: "ok" as const,
    warnings: [
      "Deterministic conservative fallback used; this is not an LLM-derived formative plan."
    ],
    formative_value: built.default_formative_value as
      | "diagnostic_clarification"
      | "reasoning_refinement"
      | "confidence_calibration"
      | "independent_understanding_verification"
      | "consolidation_or_transfer",
    formative_action_plan:
      "Use a conservative, course-agnostic follow-up plan that asks the student for one additional piece of evidence before any later decision.",
    target_evidence: [
      "One concise student-provided explanation or example connected to the current concept."
    ],
    success_criteria: [
      "The student provides interpretable evidence that can be reviewed without inferring unsupported profile labels."
    ],
    followup_prompt_constraints: [
      "Do not reveal profile labels, formative-value labels, answer keys, correctness feedback, or hidden system metadata."
    ],
    profile_update_triggers: [
      "A substantive student response that adds interpretable evidence may trigger the normal backend-owned update cycle."
    ],
    rationale:
      "The planning agent did not produce a validated effective result, so the backend used the approved default mapping to keep the workflow resumable without overclaiming.",
    mapping_followed: true,
    mapping_deviation_reason: null
  };
}

async function executePlanningBuiltInput(input: {
  built: BuiltFormativePlanningInput;
  invocation_reason: string;
  force_new_invocation?: boolean;
  mock_provider_mode?: MockProviderMode;
  requested_by_user_db_id?: string;
}) {
  await logPlanningEvent({
    assessment_session_db_id: input.built.assessment_session_db_id,
    concept_unit_session_db_id: input.built.concept_unit_session_db_id,
    event_type: "formative_planning_started",
    payload: {
      agent_name: "formative_value_and_planning_agent",
      invocation_reason: input.invocation_reason,
      default_formative_value: input.built.default_formative_value
    }
  });
  await logPlanningEvent({
    assessment_session_db_id: input.built.assessment_session_db_id,
    concept_unit_session_db_id: input.built.concept_unit_session_db_id,
    event_type: "agent_call_started",
    payload: {
      agent_name: "formative_value_and_planning_agent",
      agent_invocation_key: input.built.agent_invocation_key
    }
  });

  const result = await executeOperationalAgent({
    agentName: "formative_value_and_planning_agent",
    allowlistedInput: input.built.input,
    invocationKey: input.built.agent_invocation_key,
    operationalContext: {
      assessment_session_db_id: input.built.assessment_session_db_id,
      concept_unit_session_db_id: input.built.concept_unit_session_db_id
    },
    forceNewInvocation: input.force_new_invocation,
    metadata: {
      invocation_reason: input.invocation_reason,
      response_package_type: input.built.response_package.package_type,
      response_package_created_at: input.built.response_package.created_at.toISOString(),
      default_formative_value: input.built.default_formative_value,
      requested_by_role: input.requested_by_user_db_id ? "teacher_researcher" : "backend",
      ...(input.mock_provider_mode ? { mock_mode: input.mock_provider_mode } : {})
    }
  });

  if (result.status !== "succeeded") {
    await logPlanningEvent({
      assessment_session_db_id: input.built.assessment_session_db_id,
      concept_unit_session_db_id: input.built.concept_unit_session_db_id,
      event_type:
        result.status === "invalid_output" ? "schema_validation_failed" : "agent_call_failed",
      payload: {
        agent_name: "formative_value_and_planning_agent",
        result_status: result.status,
        agent_call_id: "agent_call_id" in result ? result.agent_call_id : null
      }
    });
    await logPlanningEvent({
      assessment_session_db_id: input.built.assessment_session_db_id,
      concept_unit_session_db_id: input.built.concept_unit_session_db_id,
      event_type: "formative_planning_failed",
      payload: {
        result_status: result.status,
        agent_call_id: "agent_call_id" in result ? result.agent_call_id : null
      }
    });

    const fallbackOutput = deterministicPlanningFallback(input.built);
    await persistOperationalEffectiveResult({
      agent_call_db_id: "agent_call_id" in result ? result.agent_call_id : null,
      agent_name: "formative_value_and_planning_agent",
      operational_context_type: "updated_formative_planning_candidate",
      operational_context_public_id: planningContextPublicId(input.built),
      invocation_key: input.built.agent_invocation_key,
      canonicalization_version: "formative-planning-canonical-v1",
      fallback_version: "formative-planning-deterministic-fallback-v1",
      raw_output_status: result.status,
      raw_semantic_status: "not_run",
      effective_semantic_status: "pass",
      effective_overall_status: "fallback_preserve_prior",
      effective_student_facing_usable: false,
      effective_workflow_usable: false,
      canonicalization_applied: true,
      fallback_applied: true,
      effective_output: fallbackOutput,
      effective_actions: {
        default_formative_value: input.built.default_formative_value,
        may_update_decision_pointer: false,
        preserve_prior_decision: true
      },
      warnings: fallbackOutput.warnings
    });

    return {
      status: result.status,
      output: null,
      agent_call_id: "agent_call_id" in result ? result.agent_call_id : null,
      default_formative_value: input.built.default_formative_value,
      agent_invocation_key: input.built.agent_invocation_key,
      retry_count: result.retry_count
    };
  }

  const canonical = canonicalizeFormativePlanningOutput({
    output: result.output,
    integrated_diagnostic_profile:
      input.built.student_profile.integrated_diagnostic_profile
  });

  try {
    validateFormativePlanningSemantics({
      output: canonical.output,
      integrated_diagnostic_profile:
        input.built.student_profile.integrated_diagnostic_profile
    });
  } catch (error) {
    const issues =
      error instanceof FormativePlanningSemanticValidationError
        ? error.issues
        : ["semantic validation failed"];

    await prisma.agentCall.update({
      where: { id: result.agent_call_id },
      data: {
        output_validated: false,
        call_status: "invalid_output",
        error_category: "semantic_validation",
        validation_error: issues.join("; "),
        output_payload: Prisma.JsonNull,
        raw_output: toPrismaJson(result.output) ?? Prisma.JsonNull
      }
    });
    await logPlanningEvent({
      assessment_session_db_id: input.built.assessment_session_db_id,
      concept_unit_session_db_id: input.built.concept_unit_session_db_id,
      event_type: "schema_validation_failed",
      payload: {
        agent_name: "formative_value_and_planning_agent",
        agent_call_id: result.agent_call_id,
        issues
      }
    });
    await logPlanningEvent({
      assessment_session_db_id: input.built.assessment_session_db_id,
      concept_unit_session_db_id: input.built.concept_unit_session_db_id,
      event_type: "formative_planning_failed",
      payload: {
        result_status: "semantic_validation_failed",
        agent_call_id: result.agent_call_id
      }
    });

    const fallbackOutput = deterministicPlanningFallback(input.built);
    await persistOperationalEffectiveResult({
      agent_call_db_id: result.agent_call_id,
      agent_name: "formative_value_and_planning_agent",
      operational_context_type: "updated_formative_planning_candidate",
      operational_context_public_id: planningContextPublicId(input.built),
      invocation_key: input.built.agent_invocation_key,
      canonicalization_version: "formative-planning-canonical-v1",
      fallback_version: "formative-planning-deterministic-fallback-v1",
      raw_output_status: "semantic_validation_failed",
      raw_semantic_status: "fail",
      effective_semantic_status: "pass",
      effective_overall_status: "fallback_preserve_prior",
      effective_student_facing_usable: false,
      effective_workflow_usable: false,
      canonicalization_applied: true,
      fallback_applied: true,
      effective_output: fallbackOutput,
      effective_actions: {
        default_formative_value: input.built.default_formative_value,
        may_update_decision_pointer: false,
        preserve_prior_decision: true,
        semantic_validation_issues: issues
      },
      warnings: fallbackOutput.warnings
    });

    return {
      status: "semantic_validation_failed" as const,
      output: null,
      agent_call_id: result.agent_call_id,
      default_formative_value: input.built.default_formative_value,
      semantic_validation_issues: issues,
      agent_invocation_key: input.built.agent_invocation_key,
      retry_count: result.retry_count
    };
  }

  await logPlanningEvent({
    assessment_session_db_id: input.built.assessment_session_db_id,
    concept_unit_session_db_id: input.built.concept_unit_session_db_id,
    event_type: "schema_validation_succeeded",
    payload: {
      agent_name: "formative_value_and_planning_agent",
      agent_call_id: result.agent_call_id
    }
  });

  await persistOperationalEffectiveResult({
    agent_call_db_id: result.agent_call_id,
    agent_name: "formative_value_and_planning_agent",
    operational_context_type: "updated_formative_planning_candidate",
    operational_context_public_id: planningContextPublicId(input.built),
    invocation_key: input.built.agent_invocation_key,
    canonicalization_version: "formative-planning-canonical-v1",
    raw_output_status: "succeeded",
    raw_semantic_status: "pass",
    effective_semantic_status: "pass",
    effective_overall_status: "pass",
    effective_student_facing_usable: false,
    effective_workflow_usable: true,
    canonicalization_applied: canonical.backend_canonicalized,
    effective_output: canonical.output,
    effective_actions: {
      default_formative_value: input.built.default_formative_value,
      mapping_followed: canonical.output.mapping_followed,
      raw_mapping_followed: canonical.raw_mapping_followed,
      raw_mapping_deviation_reason: canonical.raw_mapping_deviation_reason,
      may_update_decision_pointer: true
    },
    warnings: canonical.backend_canonicalized
      ? ["Backend canonicalized formative-planning mapping metadata."]
      : []
  });
  await logPlanningEvent({
    assessment_session_db_id: input.built.assessment_session_db_id,
    concept_unit_session_db_id: input.built.concept_unit_session_db_id,
    event_type: "agent_call_succeeded",
    payload: {
      agent_name: "formative_value_and_planning_agent",
      agent_call_id: result.agent_call_id,
      retry_count: result.retry_count
    }
  });
  await logPlanningEvent({
    assessment_session_db_id: input.built.assessment_session_db_id,
    concept_unit_session_db_id: input.built.concept_unit_session_db_id,
    event_type: "formative_planning_succeeded",
    payload: {
      agent_name: "formative_value_and_planning_agent",
      agent_call_id: result.agent_call_id,
      formative_value: canonical.output.formative_value,
      staged_only: true
    }
  });

  return {
    status: "succeeded" as const,
    output: canonical.output,
    agent_call_id: result.agent_call_id,
    default_formative_value: input.built.default_formative_value,
    agent_invocation_key: input.built.agent_invocation_key,
    retry_count: result.retry_count
  };
}

export async function executeFormativePlanningCandidate(
  input: FormativePlanningCandidateInput
) {
  const built = await buildUpdatedFormativePlanningInput({
    concept_unit_session_db_id: input.concept_unit_session_db_id,
    followup_evidence_package_db_id: input.followup_evidence_package_db_id,
    staged_student_profile_output: input.staged_student_profile_output,
    previous_student_profile_db_id: input.previous_student_profile_db_id,
    cycle_public_id: input.cycle_public_id
  });

  return executePlanningBuiltInput({
    built,
    invocation_reason: input.invocation_reason,
    force_new_invocation: input.force_new_invocation,
    mock_provider_mode: input.mock_provider_mode
  });
}

async function transitionToPlanningCompleted(input: {
  assessment_session_db_id: string;
  current_phase: string;
  payload: Record<string, unknown>;
}) {
  if (input.current_phase === "profiling_completed") {
    await updateAssessmentSessionPhase({
      assessment_session_db_id: input.assessment_session_db_id,
      to_phase: "planning_pending",
      reason: "formative_planning_ready",
      payload: input.payload
    });
  }

  await updateAssessmentSessionPhase({
    assessment_session_db_id: input.assessment_session_db_id,
    to_phase: "planning_completed",
    reason: "formative_planning_agent_completed",
    payload: input.payload
  });
}

export async function runInitialFormativePlanning(input: RunInitialFormativePlanningInput) {
  const conceptUnitSession = await prisma.conceptUnitSession.findUnique({
    where: { id: input.concept_unit_session_db_id },
    select: {
      id: true,
      assessment_session_db_id: true,
      latest_student_profile_db_id: true,
      latest_student_profile: {
        select: {
          id: true,
          concept_unit_session_db_id: true
        }
      },
      assessment_session: {
        select: {
          current_phase: true,
          session_public_id: true
        }
      }
    }
  });

  if (!conceptUnitSession) {
    throw new FormativePlanningServiceError(
      "concept_unit_session_not_found",
      "Concept-unit session was not found.",
      404
    );
  }

  if (!conceptUnitSession.latest_student_profile) {
    throw new FormativePlanningServiceError(
      "latest_student_profile_required",
      "A valid latest student profile is required before formative planning can run.",
      409,
      { session_public_id: conceptUnitSession.assessment_session.session_public_id }
    );
  }

  if (
    conceptUnitSession.latest_student_profile.concept_unit_session_db_id !==
    conceptUnitSession.id
  ) {
    throw new FormativePlanningServiceError(
      "latest_student_profile_mismatch",
      "The latest student profile does not belong to this concept-unit session.",
      409,
      { session_public_id: conceptUnitSession.assessment_session.session_public_id }
    );
  }

  const responsePackage = await prisma.responsePackage.findFirst({
    where: {
      concept_unit_session_db_id: conceptUnitSession.id,
      package_type: "initial_concept_unit_response_package"
    },
    orderBy: [{ created_at: "desc" }],
    select: { id: true }
  });

  if (!responsePackage) {
    throw new FormativePlanningServiceError(
      "response_package_required",
      "An initial response package is required before formative planning can run.",
      409,
      { session_public_id: conceptUnitSession.assessment_session.session_public_id }
    );
  }

  const built = await buildInitialFormativePlanningInput(conceptUnitSession.id);
  const existingDecision = await decisionByInvocationKey(built.agent_invocation_key);

  if (existingDecision && !input.force_new_invocation) {
    await prisma.conceptUnitSession.update({
      where: { id: conceptUnitSession.id },
      data: { latest_formative_decision_db_id: existingDecision.id }
    });

    if (
      conceptUnitSession.assessment_session.current_phase === "profiling_completed" ||
      conceptUnitSession.assessment_session.current_phase === "planning_pending"
    ) {
      await transitionToPlanningCompleted({
        assessment_session_db_id: conceptUnitSession.assessment_session_db_id,
        current_phase: conceptUnitSession.assessment_session.current_phase,
        payload: { agent_invocation_key: built.agent_invocation_key }
      });
    }

    return {
      status: "already_planned" as const,
      decision: decisionSummary(existingDecision),
      default_formative_value: built.default_formative_value,
      agent_invocation_key: built.agent_invocation_key
    };
  }

  if (
    conceptUnitSession.assessment_session.current_phase !== "profiling_completed" &&
    conceptUnitSession.assessment_session.current_phase !== "planning_pending"
  ) {
    throw new FormativePlanningServiceError(
      "planning_not_ready",
      "Formative planning can run only after profiling is completed or while planning is pending.",
      409,
      {
        session_public_id: conceptUnitSession.assessment_session.session_public_id,
        current_phase: conceptUnitSession.assessment_session.current_phase
      }
    );
  }

  if (conceptUnitSession.assessment_session.current_phase === "profiling_completed") {
    await updateAssessmentSessionPhase({
      assessment_session_db_id: built.assessment_session_db_id,
      to_phase: "planning_pending",
      reason: "formative_planning_started",
      payload: {
        agent_name: "formative_value_and_planning_agent",
        agent_invocation_key: built.agent_invocation_key
      }
    });
  }

  await logPlanningEvent({
    assessment_session_db_id: built.assessment_session_db_id,
    concept_unit_session_db_id: built.concept_unit_session_db_id,
    event_type: "formative_planning_started",
    payload: {
      agent_name: "formative_value_and_planning_agent",
      invocation_reason: input.invocation_reason,
      default_formative_value: built.default_formative_value
    }
  });
  await logPlanningEvent({
    assessment_session_db_id: built.assessment_session_db_id,
    concept_unit_session_db_id: built.concept_unit_session_db_id,
    event_type: "agent_call_started",
    payload: {
      agent_name: "formative_value_and_planning_agent",
      agent_invocation_key: built.agent_invocation_key
    }
  });

  const result = await executeOperationalAgent({
    agentName: "formative_value_and_planning_agent",
    allowlistedInput: built.input,
    invocationKey: built.agent_invocation_key,
    operationalContext: {
      assessment_session_db_id: built.assessment_session_db_id,
      concept_unit_session_db_id: built.concept_unit_session_db_id
    },
    forceNewInvocation: input.force_new_invocation,
    metadata: {
      invocation_reason: input.invocation_reason,
      response_package_type: built.response_package.package_type,
      response_package_created_at: built.response_package.created_at.toISOString(),
      default_formative_value: built.default_formative_value,
      requested_by_role: input.requested_by_user_db_id ? "teacher_researcher" : "backend",
      ...(input.mock_provider_mode ? { mock_mode: input.mock_provider_mode } : {})
    }
  });

  if (result.status !== "succeeded") {
    await logPlanningEvent({
      assessment_session_db_id: built.assessment_session_db_id,
      concept_unit_session_db_id: built.concept_unit_session_db_id,
      event_type:
        result.status === "invalid_output" ? "schema_validation_failed" : "agent_call_failed",
      payload: {
        agent_name: "formative_value_and_planning_agent",
        result_status: result.status,
        agent_call_id: "agent_call_id" in result ? result.agent_call_id : null,
        reason:
          result.status === "blocked_by_usage_limit"
            ? result.reason
            : result.status === "invalid_output"
              ? result.validation_error
              : result.status === "refused"
                ? result.refusal
                : result.status === "incomplete"
                  ? result.reason
                  : result.status === "failed"
                    ? result.error.message
                    : null
      }
    });
    await logPlanningEvent({
      assessment_session_db_id: built.assessment_session_db_id,
      concept_unit_session_db_id: built.concept_unit_session_db_id,
      event_type: "formative_planning_failed",
      payload: {
        result_status: result.status,
        agent_call_id: "agent_call_id" in result ? result.agent_call_id : null
      }
    });

    const fallbackOutput = deterministicPlanningFallback(built);
    await persistOperationalEffectiveResult({
      agent_call_db_id: "agent_call_id" in result ? result.agent_call_id : null,
      agent_name: "formative_value_and_planning_agent",
      operational_context_type: "initial_formative_planning",
      operational_context_public_id: planningContextPublicId(built),
      invocation_key: built.agent_invocation_key,
      canonicalization_version: "formative-planning-canonical-v1",
      fallback_version: "formative-planning-deterministic-fallback-v1",
      raw_output_status: result.status,
      raw_semantic_status: "not_run",
      effective_semantic_status: "pass",
      effective_overall_status: "fallback_safe",
      effective_student_facing_usable: false,
      effective_workflow_usable: true,
      canonicalization_applied: true,
      fallback_applied: true,
      effective_output: fallbackOutput,
      effective_actions: {
        default_formative_value: built.default_formative_value,
        may_update_decision_pointer: true,
        fallback_derived: true
      },
      warnings: fallbackOutput.warnings
    });

    const decision = await persistInitialFormativeDecision({
      concept_unit_session_db_id: built.concept_unit_session_db_id,
      student_profile_db_id: built.student_profile.id,
      based_on_agent_call_db_id: "agent_call_id" in result ? result.agent_call_id ?? null : null,
      output: fallbackOutput
    });

    await updateAssessmentSessionPhase({
      assessment_session_db_id: built.assessment_session_db_id,
      to_phase: "planning_completed",
      reason: "formative_planning_deterministic_fallback_completed",
      payload: {
        agent_name: "formative_value_and_planning_agent",
        fallback_derived: true,
        result_status: result.status,
        default_formative_value: built.default_formative_value
      }
    });

    return {
      status: "decision_created" as const,
      decision: decisionSummary(decision),
      agent_call_id: "agent_call_id" in result ? result.agent_call_id : null,
      default_formative_value: built.default_formative_value,
      agent_invocation_key: built.agent_invocation_key
    };
  }

  const canonical = canonicalizeFormativePlanningOutput({
    output: result.output,
    integrated_diagnostic_profile: built.student_profile.integrated_diagnostic_profile
  });

  try {
    validateFormativePlanningSemantics({
      output: canonical.output,
      integrated_diagnostic_profile: built.student_profile.integrated_diagnostic_profile
    });
  } catch (error) {
    const issues =
      error instanceof FormativePlanningSemanticValidationError
        ? error.issues
        : ["semantic validation failed"];

    await prisma.agentCall.update({
      where: { id: result.agent_call_id },
      data: {
        output_validated: false,
        call_status: "invalid_output",
        error_category: "semantic_validation",
        validation_error: issues.join("; "),
        output_payload: Prisma.JsonNull,
        raw_output: toPrismaJson(result.output) ?? Prisma.JsonNull
      }
    });
    await logPlanningEvent({
      assessment_session_db_id: built.assessment_session_db_id,
      concept_unit_session_db_id: built.concept_unit_session_db_id,
      event_type: "schema_validation_failed",
      payload: {
        agent_name: "formative_value_and_planning_agent",
        agent_call_id: result.agent_call_id,
        issues
      }
    });
    await logPlanningEvent({
      assessment_session_db_id: built.assessment_session_db_id,
      concept_unit_session_db_id: built.concept_unit_session_db_id,
      event_type: "formative_planning_failed",
      payload: {
        result_status: "semantic_validation_failed",
        agent_call_id: result.agent_call_id
      }
    });

    const fallbackOutput = deterministicPlanningFallback(built);
    await persistOperationalEffectiveResult({
      agent_call_db_id: result.agent_call_id,
      agent_name: "formative_value_and_planning_agent",
      operational_context_type: "initial_formative_planning",
      operational_context_public_id: planningContextPublicId(built),
      invocation_key: built.agent_invocation_key,
      canonicalization_version: "formative-planning-canonical-v1",
      fallback_version: "formative-planning-deterministic-fallback-v1",
      raw_output_status: "semantic_validation_failed",
      raw_semantic_status: "fail",
      effective_semantic_status: "pass",
      effective_overall_status: "fallback_safe",
      effective_student_facing_usable: false,
      effective_workflow_usable: true,
      canonicalization_applied: true,
      fallback_applied: true,
      effective_output: fallbackOutput,
      effective_actions: {
        default_formative_value: built.default_formative_value,
        may_update_decision_pointer: true,
        fallback_derived: true,
        semantic_validation_issues: issues
      },
      warnings: fallbackOutput.warnings
    });

    const decision = await persistInitialFormativeDecision({
      concept_unit_session_db_id: built.concept_unit_session_db_id,
      student_profile_db_id: built.student_profile.id,
      based_on_agent_call_db_id: result.agent_call_id,
      output: fallbackOutput
    });

    await updateAssessmentSessionPhase({
      assessment_session_db_id: built.assessment_session_db_id,
      to_phase: "planning_completed",
      reason: "formative_planning_semantic_fallback_completed",
      payload: {
        agent_name: "formative_value_and_planning_agent",
        agent_call_id: result.agent_call_id,
        fallback_derived: true,
        default_formative_value: built.default_formative_value
      }
    });

    return {
      status: "decision_created" as const,
      decision: decisionSummary(decision),
      agent_call_id: result.agent_call_id,
      default_formative_value: built.default_formative_value,
      semantic_validation_issues: issues,
      agent_invocation_key: built.agent_invocation_key
    };
  }

  await logPlanningEvent({
    assessment_session_db_id: built.assessment_session_db_id,
    concept_unit_session_db_id: built.concept_unit_session_db_id,
    event_type: "schema_validation_succeeded",
    payload: {
      agent_name: "formative_value_and_planning_agent",
      agent_call_id: result.agent_call_id
    }
  });

  await persistOperationalEffectiveResult({
    agent_call_db_id: result.agent_call_id,
    agent_name: "formative_value_and_planning_agent",
    operational_context_type: "initial_formative_planning",
    operational_context_public_id: planningContextPublicId(built),
    invocation_key: built.agent_invocation_key,
    canonicalization_version: "formative-planning-canonical-v1",
    raw_output_status: "succeeded",
    raw_semantic_status: "pass",
    effective_semantic_status: "pass",
    effective_overall_status: "pass",
    effective_student_facing_usable: false,
    effective_workflow_usable: true,
    canonicalization_applied: canonical.backend_canonicalized,
    effective_output: canonical.output,
    effective_actions: {
      default_formative_value: built.default_formative_value,
      mapping_followed: canonical.output.mapping_followed,
      raw_mapping_followed: canonical.raw_mapping_followed,
      raw_mapping_deviation_reason: canonical.raw_mapping_deviation_reason,
      may_update_decision_pointer: true
    },
    warnings: canonical.backend_canonicalized
      ? ["Backend canonicalized formative-planning mapping metadata."]
      : []
  });

  const decision = await persistInitialFormativeDecision({
    concept_unit_session_db_id: built.concept_unit_session_db_id,
    student_profile_db_id: built.student_profile.id,
    based_on_agent_call_db_id: result.agent_call_id,
    output: canonical.output
  });

  await updateAssessmentSessionPhase({
    assessment_session_db_id: built.assessment_session_db_id,
    to_phase: "planning_completed",
    reason: "formative_planning_agent_completed",
    payload: {
      agent_name: "formative_value_and_planning_agent",
      agent_call_id: result.agent_call_id,
      retry_count: result.retry_count,
      default_formative_value: built.default_formative_value
    }
  });

  await logPlanningEvent({
    assessment_session_db_id: built.assessment_session_db_id,
    concept_unit_session_db_id: built.concept_unit_session_db_id,
    event_type: "agent_call_succeeded",
    payload: {
      agent_name: "formative_value_and_planning_agent",
      agent_call_id: result.agent_call_id,
      retry_count: result.retry_count
    }
  });
  await logPlanningEvent({
    assessment_session_db_id: built.assessment_session_db_id,
    concept_unit_session_db_id: built.concept_unit_session_db_id,
    event_type: "formative_planning_succeeded",
    payload: {
      agent_name: "formative_value_and_planning_agent",
      agent_call_id: result.agent_call_id,
      formative_value: decision.formative_value
    }
  });

  return {
    status: "decision_created" as const,
    decision: decisionSummary(decision),
    agent_call_id: result.agent_call_id,
    default_formative_value: built.default_formative_value,
    agent_invocation_key: built.agent_invocation_key
  };
}
