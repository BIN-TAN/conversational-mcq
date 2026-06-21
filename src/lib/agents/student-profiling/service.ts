import type { MockProviderMode } from "@/lib/llm/providers/mock-provider";
import { executeAgent } from "@/lib/agents/execute-agent";
import { prisma } from "@/lib/db";
import { createResponsePackage } from "@/lib/services/response-packages";
import { logProcessEvent } from "@/lib/services/process-events";
import { updateAssessmentSessionPhase } from "@/lib/services/session-state";
import { buildInitialStudentProfilingInput } from "./input-builder";
import { persistInitialStudentProfile } from "./persistence";
import {
  serializeStudentProfileForTeacher,
  type StudentProfileWithAgentCall
} from "./serializers";

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

  const result = await executeAgent({
    agent_name: "student_profiling_agent",
    input: built.input,
    assessment_session_db_id: built.assessment_session_db_id,
    concept_unit_session_db_id: built.concept_unit_session_db_id,
    agent_invocation_key: built.agent_invocation_key,
    force_new_invocation: input.force_new_invocation,
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

    return {
      status: result.status,
      profile: null,
      agent_call_id: "agent_call_id" in result ? result.agent_call_id : null,
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
