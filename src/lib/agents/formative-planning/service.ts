import { Prisma } from "@prisma/client";
import type { MockProviderMode } from "@/lib/llm/providers/mock-provider";
import { executeAgent } from "@/lib/agents/execute-agent";
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

  const result = await executeAgent({
    agent_name: "formative_value_and_planning_agent",
    input: input.built.input,
    assessment_session_db_id: input.built.assessment_session_db_id,
    concept_unit_session_db_id: input.built.concept_unit_session_db_id,
    agent_invocation_key: input.built.agent_invocation_key,
    force_new_invocation: input.force_new_invocation,
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

  const result = await executeAgent({
    agent_name: "formative_value_and_planning_agent",
    input: built.input,
    assessment_session_db_id: built.assessment_session_db_id,
    concept_unit_session_db_id: built.concept_unit_session_db_id,
    agent_invocation_key: built.agent_invocation_key,
    force_new_invocation: input.force_new_invocation,
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

    return {
      status: result.status,
      decision: null,
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

    return {
      status: "semantic_validation_failed" as const,
      decision: null,
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
