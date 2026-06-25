import type { MockProviderMode } from "@/lib/llm/providers/mock-provider";
import { executeOperationalAgent } from "@/lib/agents/operational/executor";
import { persistOperationalEffectiveResult } from "@/lib/agents/operational/effective-results";
import { prisma } from "@/lib/db";
import { createResponsePackage } from "@/lib/services/response-packages";
import { logProcessEvent } from "@/lib/services/process-events";
import { updateAssessmentSessionPhase } from "@/lib/services/session-state";
import {
  buildInitialStudentProfilingInput,
  buildUpdatedStudentProfilingInput,
  type BuiltStudentProfilingInput
} from "./input-builder";
import { persistInitialStudentProfile } from "./persistence";
import {
  serializeStudentProfileForTeacher,
  type StudentProfileWithAgentCall
} from "./serializers";
import { validateStudentProfileOutputSemantics } from "./semantic-validation";

export class StudentProfilingServiceError extends Error {
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
    this.name = "StudentProfilingServiceError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

type RunInitialStudentProfilingInput = {
  concept_unit_session_db_id: string;
  requested_by_user_db_id?: string;
  invocation_reason: string;
  force_new_invocation?: boolean;
  mock_provider_mode?: MockProviderMode;
};

type StudentProfilingCandidateInput = {
  concept_unit_session_db_id: string;
  followup_evidence_package_db_id: string;
  previous_student_profile_db_id: string;
  cycle_public_id: string;
  invocation_reason: string;
  force_new_invocation?: boolean;
  mock_provider_mode?: MockProviderMode;
};

async function latestInitialResponsePackage(conceptUnitSessionDbId: string) {
  return prisma.responsePackage.findFirst({
    where: {
      concept_unit_session_db_id: conceptUnitSessionDbId,
      package_type: "initial_concept_unit_response_package"
    },
    orderBy: [{ created_at: "desc" }]
  });
}

async function profileByInvocationKey(agentInvocationKey: string) {
  return prisma.studentProfile.findFirst({
    where: {
      profile_type: "initial",
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

async function logAgentEvent(input: {
  assessment_session_db_id: string;
  concept_unit_session_db_id: string;
  event_type:
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
    event_category: "agent_execution",
    event_source: input.event_type.startsWith("agent_call") ? "agent" : "backend",
    payload: input.payload,
    occurred_at: new Date()
  });
}

function profileSummary(profile: StudentProfileWithAgentCall) {
  return serializeStudentProfileForTeacher(profile);
}

function profilingContextPublicId(built: BuiltStudentProfilingInput) {
  const metadata = built.input.concept_unit_metadata as {
    assessment_session?: { session_public_id?: string };
    concept_unit?: { concept_unit_public_id?: string };
  };

  return [
    metadata.assessment_session?.session_public_id ?? "unknown_session",
    metadata.concept_unit?.concept_unit_public_id ?? "unknown_concept_unit"
  ].join(":");
}

function deterministicInitialProfileFallback(built: BuiltStudentProfilingInput) {
  return {
    agent_name: "student_profiling_agent" as const,
    agent_version: "deterministic-fallback",
    prompt_version: "student-profiling-deterministic-fallback-v1",
    schema_version: "student-profile-output-v2",
    output_status: "ok" as const,
    warnings: [
      "Deterministic conservative fallback used; this is not an LLM-derived student profile."
    ],
    profile_type: built.input.profile_type,
    ability_profile: "insufficient_evidence" as const,
    ability_pattern_flags: [],
    engagement_profile: "insufficient_process_evidence" as const,
    engagement_pattern_flags: [],
    integrated_diagnostic_profile: "insufficient_evidence_for_formative_decision" as const,
    integrated_profile_confidence: "low" as const,
    integrated_profile_rationale:
      "The operational profiling agent was unavailable or invalid, so no diagnostic inference was made.",
    evidence_sufficiency: "insufficient" as const,
    confidence_alignment: "insufficient_evidence" as const,
    independence_interpretability: "insufficient_evidence" as const,
    misconception_indicators: [],
    item_level_evidence: [],
    reasoning_quality_summary:
      "No LLM-derived reasoning-quality summary is available from this fallback.",
    engagement_summary:
      "No LLM-derived engagement summary is available from this fallback.",
    process_interpretation_cautions: [
      "Fallback-derived profile; do not interpret as validated student profiling output."
    ],
    profile_confidence: "low" as const,
    rationale:
      "A conservative fallback was used to keep the workflow resumable without overclaiming student understanding.",
    recommended_next_evidence: [
      {
        evidence_type: "teacher_review_or_later_followup",
        reason: "The profiling agent did not produce a validated effective result.",
        item_public_id: null
      }
    ]
  };
}

async function executeProfilingBuiltInput(input: {
  built: BuiltStudentProfilingInput;
  invocation_reason: string;
  force_new_invocation?: boolean;
  mock_provider_mode?: MockProviderMode;
  requested_by_user_db_id?: string;
}) {
  await logAgentEvent({
    assessment_session_db_id: input.built.assessment_session_db_id,
    concept_unit_session_db_id: input.built.concept_unit_session_db_id,
    event_type: "agent_call_started",
    payload: {
      agent_name: "student_profiling_agent",
      invocation_reason: input.invocation_reason,
      agent_invocation_key: input.built.agent_invocation_key
    }
  });

  const result = await executeOperationalAgent({
    agentName: "student_profiling_agent",
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
      requested_by_role: input.requested_by_user_db_id ? "teacher_researcher" : "backend",
      ...(input.mock_provider_mode ? { mock_mode: input.mock_provider_mode } : {})
    }
  });

  if (result.status !== "succeeded") {
    await logAgentEvent({
      assessment_session_db_id: input.built.assessment_session_db_id,
      concept_unit_session_db_id: input.built.concept_unit_session_db_id,
      event_type:
        result.status === "invalid_output" ? "schema_validation_failed" : "agent_call_failed",
      payload: {
        agent_name: "student_profiling_agent",
        result_status: result.status,
        agent_call_id: "agent_call_id" in result ? result.agent_call_id : null
      }
    });

    return {
      status: result.status,
      output: null,
      agent_call_id: "agent_call_id" in result ? result.agent_call_id : null,
      agent_invocation_key: input.built.agent_invocation_key,
      retry_count: result.retry_count
    };
  }

  const semantic = validateStudentProfileOutputSemantics({
    providerInput: input.built.input,
    output: result.output
  });

  if (!semantic.ok) {
    await prisma.agentCall.update({
      where: { id: result.agent_call_id },
      data: {
        output_validated: false,
        validation_error: semantic.issues.join("; "),
        call_status: "invalid_output",
        error_category: "semantic_validation"
      }
    });

    await logAgentEvent({
      assessment_session_db_id: input.built.assessment_session_db_id,
      concept_unit_session_db_id: input.built.concept_unit_session_db_id,
      event_type: "schema_validation_failed",
      payload: {
        agent_name: "student_profiling_agent",
        result_status: "semantic_validation_failed",
        agent_call_id: result.agent_call_id,
        semantic_issues: semantic.issues
      }
    });

    return {
      status: "semantic_validation_failed" as const,
      output: null,
      agent_call_id: result.agent_call_id,
      agent_invocation_key: input.built.agent_invocation_key,
      retry_count: result.retry_count
    };
  }

  await logAgentEvent({
    assessment_session_db_id: input.built.assessment_session_db_id,
    concept_unit_session_db_id: input.built.concept_unit_session_db_id,
    event_type: "schema_validation_succeeded",
    payload: {
      agent_name: "student_profiling_agent",
      agent_call_id: result.agent_call_id
    }
  });
  await logAgentEvent({
    assessment_session_db_id: input.built.assessment_session_db_id,
    concept_unit_session_db_id: input.built.concept_unit_session_db_id,
    event_type: "agent_call_succeeded",
    payload: {
      agent_name: "student_profiling_agent",
      agent_call_id: result.agent_call_id,
      retry_count: result.retry_count
    }
  });

  await persistOperationalEffectiveResult({
    agent_call_db_id: result.agent_call_id,
    agent_name: "student_profiling_agent",
    operational_context_type: `${input.built.input.profile_type}_student_profile`,
    operational_context_public_id: profilingContextPublicId(input.built),
    invocation_key: input.built.agent_invocation_key,
    canonicalization_version: "student-profiling-canonical-v1",
    raw_output_status: "succeeded",
    raw_semantic_status: "pass",
    effective_semantic_status: "pass",
    effective_overall_status: "pass",
    effective_student_facing_usable: false,
    effective_workflow_usable: true,
    canonicalization_applied: true,
    effective_output: result.output,
    effective_actions: {
      profile_type: input.built.input.profile_type,
      may_update_profile_pointer: true
    },
    warnings: result.output.warnings
  });

  return {
    status: "succeeded" as const,
    output: result.output,
    agent_call_id: result.agent_call_id,
    agent_invocation_key: input.built.agent_invocation_key,
    retry_count: result.retry_count
  };
}

export async function executeStudentProfilingCandidate(
  input: StudentProfilingCandidateInput
) {
  const built = await buildUpdatedStudentProfilingInput({
    concept_unit_session_db_id: input.concept_unit_session_db_id,
    followup_evidence_package_db_id: input.followup_evidence_package_db_id,
    previous_student_profile_db_id: input.previous_student_profile_db_id,
    cycle_public_id: input.cycle_public_id
  });

  return executeProfilingBuiltInput({
    built,
    invocation_reason: input.invocation_reason,
    force_new_invocation: input.force_new_invocation,
    mock_provider_mode: input.mock_provider_mode
  });
}

export async function runInitialStudentProfiling(input: RunInitialStudentProfilingInput) {
  const conceptUnitSession = await prisma.conceptUnitSession.findUnique({
    where: { id: input.concept_unit_session_db_id },
    select: {
      id: true,
      assessment_session_db_id: true,
      initial_completed_at: true,
      assessment_session: {
        select: {
          current_phase: true,
          session_public_id: true
        }
      }
    }
  });

  if (!conceptUnitSession) {
    throw new StudentProfilingServiceError(
      "concept_unit_session_not_found",
      "Concept-unit session was not found.",
      404
    );
  }

  if (!conceptUnitSession.initial_completed_at) {
    throw new StudentProfilingServiceError(
      "initial_administration_incomplete",
      "Student profiling can run only after initial concept-unit administration is completed.",
      409,
      { session_public_id: conceptUnitSession.assessment_session.session_public_id }
    );
  }

  let responsePackage = await latestInitialResponsePackage(conceptUnitSession.id);

  if (!responsePackage) {
    responsePackage = await createResponsePackage({
      concept_unit_session_db_id: conceptUnitSession.id,
      package_type: "initial_concept_unit_response_package"
    });
  }

  const built = await buildInitialStudentProfilingInput(conceptUnitSession.id, responsePackage.id);
  const existingProfile = await profileByInvocationKey(built.agent_invocation_key);

  if (existingProfile && !input.force_new_invocation) {
    await prisma.conceptUnitSession.update({
      where: { id: conceptUnitSession.id },
      data: { latest_student_profile_db_id: existingProfile.id }
    });

    if (conceptUnitSession.assessment_session.current_phase === "profiling_pending") {
      await updateAssessmentSessionPhase({
        assessment_session_db_id: conceptUnitSession.assessment_session_db_id,
        to_phase: "profiling_completed",
        reason: "idempotent_student_profile_already_exists",
        payload: { agent_invocation_key: built.agent_invocation_key }
      });
    }

    return {
      status: "already_profiled" as const,
      profile: profileSummary(existingProfile),
      agent_invocation_key: built.agent_invocation_key
    };
  }

  if (conceptUnitSession.assessment_session.current_phase !== "profiling_pending") {
    throw new StudentProfilingServiceError(
      "profiling_not_pending",
      "Student profiling can run only while the assessment session is in profiling_pending.",
      409,
      {
        session_public_id: conceptUnitSession.assessment_session.session_public_id,
        current_phase: conceptUnitSession.assessment_session.current_phase
      }
    );
  }

  await logAgentEvent({
    assessment_session_db_id: built.assessment_session_db_id,
    concept_unit_session_db_id: built.concept_unit_session_db_id,
    event_type: "agent_call_started",
    payload: {
      agent_name: "student_profiling_agent",
      invocation_reason: input.invocation_reason,
      agent_invocation_key: built.agent_invocation_key
    }
  });

  const result = await executeOperationalAgent({
    agentName: "student_profiling_agent",
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
      requested_by_role: input.requested_by_user_db_id ? "teacher_researcher" : "backend",
      ...(input.mock_provider_mode ? { mock_mode: input.mock_provider_mode } : {})
    }
  });

  if (result.status !== "succeeded") {
    await logAgentEvent({
      assessment_session_db_id: built.assessment_session_db_id,
      concept_unit_session_db_id: built.concept_unit_session_db_id,
      event_type:
        result.status === "invalid_output" ? "schema_validation_failed" : "agent_call_failed",
      payload: {
        agent_name: "student_profiling_agent",
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

    const fallbackOutput = deterministicInitialProfileFallback(built);
    await persistOperationalEffectiveResult({
      agent_call_db_id: "agent_call_id" in result ? result.agent_call_id : null,
      agent_name: "student_profiling_agent",
      operational_context_type: "initial_student_profile",
      operational_context_public_id: profilingContextPublicId(built),
      invocation_key: built.agent_invocation_key,
      canonicalization_version: "student-profiling-canonical-v1",
      fallback_version: "student-profiling-deterministic-fallback-v1",
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
        profile_type: "initial",
        may_update_profile_pointer: true,
        fallback_derived: true
      },
      warnings: fallbackOutput.warnings
    });

    const fallbackProfile = await persistInitialStudentProfile({
      concept_unit_session_db_id: built.concept_unit_session_db_id,
      based_on_agent_call_db_id: "agent_call_id" in result ? result.agent_call_id ?? null : null,
      output: fallbackOutput
    });

    await updateAssessmentSessionPhase({
      assessment_session_db_id: built.assessment_session_db_id,
      to_phase: "profiling_completed",
      reason: "student_profiling_deterministic_fallback_completed",
      payload: {
        agent_name: "student_profiling_agent",
        fallback_derived: true,
        result_status: result.status
      }
    });

    return {
      status: "profile_created" as const,
      profile: profileSummary(fallbackProfile),
      agent_call_id: "agent_call_id" in result ? result.agent_call_id : null,
      agent_invocation_key: built.agent_invocation_key
    };
  }

  const semantic = validateStudentProfileOutputSemantics({
    providerInput: built.input,
    output: result.output
  });

  if (!semantic.ok) {
    await prisma.agentCall.update({
      where: { id: result.agent_call_id },
      data: {
        output_validated: false,
        validation_error: semantic.issues.join("; "),
        call_status: "invalid_output",
        error_category: "semantic_validation"
      }
    });

    await logAgentEvent({
      assessment_session_db_id: built.assessment_session_db_id,
      concept_unit_session_db_id: built.concept_unit_session_db_id,
      event_type: "schema_validation_failed",
      payload: {
        agent_name: "student_profiling_agent",
        result_status: "semantic_validation_failed",
        agent_call_id: result.agent_call_id,
        semantic_issues: semantic.issues
      }
    });

    return {
      status: "semantic_validation_failed" as const,
      profile: null,
      agent_call_id: result.agent_call_id,
      agent_invocation_key: built.agent_invocation_key
    };
  }

  await logAgentEvent({
    assessment_session_db_id: built.assessment_session_db_id,
    concept_unit_session_db_id: built.concept_unit_session_db_id,
    event_type: "schema_validation_succeeded",
    payload: {
      agent_name: "student_profiling_agent",
      agent_call_id: result.agent_call_id
    }
  });

  await persistOperationalEffectiveResult({
    agent_call_db_id: result.agent_call_id,
    agent_name: "student_profiling_agent",
    operational_context_type: "initial_student_profile",
    operational_context_public_id: profilingContextPublicId(built),
    invocation_key: built.agent_invocation_key,
    canonicalization_version: "student-profiling-canonical-v1",
    raw_output_status: "succeeded",
    raw_semantic_status: "pass",
    effective_semantic_status: "pass",
    effective_overall_status: "pass",
    effective_student_facing_usable: false,
    effective_workflow_usable: true,
    canonicalization_applied: true,
    effective_output: result.output,
    effective_actions: {
      profile_type: "initial",
      may_update_profile_pointer: true
    },
    warnings: result.output.warnings
  });

  const profile = await persistInitialStudentProfile({
    concept_unit_session_db_id: built.concept_unit_session_db_id,
    based_on_agent_call_db_id: result.agent_call_id,
    output: result.output
  });

  await updateAssessmentSessionPhase({
    assessment_session_db_id: built.assessment_session_db_id,
    to_phase: "profiling_completed",
    reason: "student_profiling_agent_completed",
    payload: {
      agent_name: "student_profiling_agent",
      agent_call_id: result.agent_call_id,
      retry_count: result.retry_count
    }
  });

  await logAgentEvent({
    assessment_session_db_id: built.assessment_session_db_id,
    concept_unit_session_db_id: built.concept_unit_session_db_id,
    event_type: "agent_call_succeeded",
    payload: {
      agent_name: "student_profiling_agent",
      agent_call_id: result.agent_call_id,
      retry_count: result.retry_count
    }
  });

  return {
    status: "profile_created" as const,
    profile: profileSummary(profile),
    agent_call_id: result.agent_call_id,
    agent_invocation_key: built.agent_invocation_key
  };
}
