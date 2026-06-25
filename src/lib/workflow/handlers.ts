import type { WorkflowJob } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  runInitialStudentProfiling,
  StudentProfilingServiceError
} from "@/lib/agents/student-profiling/service";
import {
  FormativePlanningServiceError,
  runInitialFormativePlanning
} from "@/lib/agents/formative-planning/service";
import {
  FollowupServiceError,
  startFollowupRoundForTeacher
} from "@/lib/agents/followup/service";
import {
  enqueueInitialFollowupStartupJob,
  enqueueInitialPlanningJob
} from "./automation";
import {
  finalizeFollowupUpdate,
  FollowupUpdateCycleError,
  runFollowupPlanningUpdate,
  runFollowupProfileUpdate
} from "@/lib/agents/followup-updates/service";
import {
  finalizeConceptProgression,
  ConceptProgressionServiceError
} from "@/lib/services/concept-progression/progression";
import { getGuardedOperationalAgentIntegrationReadiness } from "@/lib/operational/guarded-agent-integration";
import { operationalReadinessHasFatalConfigurationBlock } from "@/lib/operational/guarded-agent-integration";

type HandlerResult = {
  outcome: "completed" | "retryable" | "failed";
  error_category?: string;
  error_message?: string;
};

function isRetryableAgentStatus(status: string) {
  return status === "blocked_by_usage_limit" || status === "failed" || status === "incomplete";
}

function failureFromStatus(status: string): HandlerResult {
  return {
    outcome: isRetryableAgentStatus(status) ? "retryable" : "failed",
    error_category: status,
    error_message: `Agent workflow step returned ${status}.`
  };
}

const guardedOperationalJobTypes = new Set([
  "run_initial_profiling",
  "run_initial_planning",
  "start_initial_followup",
  "run_followup_profile_update",
  "run_followup_planning_update",
  "finalize_followup_update",
  "finalize_concept_progression"
]);

async function guardedOperationalIntegrationFailure(job: WorkflowJob): Promise<HandlerResult | null> {
  if (!guardedOperationalJobTypes.has(job.job_type)) {
    return null;
  }

  const readiness = await getGuardedOperationalAgentIntegrationReadiness({
    checkDatabase: true
  });

  if (readiness.allowed || !operationalReadinessHasFatalConfigurationBlock(readiness)) {
    return null;
  }

  return {
    outcome: "failed",
    error_category: readiness.block_reason ?? "operational_guard_blocked",
    error_message: `Workflow job ${job.job_type} blocked by Phase 8A guarded operational integration gate: ${readiness.block_reason}.`
  };
}

function cyclePublicIdFromJob(job: WorkflowJob) {
  const payload =
    job.payload && typeof job.payload === "object" && !Array.isArray(job.payload)
      ? (job.payload as Record<string, unknown>)
      : {};
  const cyclePublicId = payload.cycle_public_id;

  if (typeof cyclePublicId !== "string" || !cyclePublicId) {
    throw new Error("Follow-up update workflow job requires cycle_public_id.");
  }

  return cyclePublicId;
}

function progressionPublicIdFromJob(job: WorkflowJob) {
  const payload =
    job.payload && typeof job.payload === "object" && !Array.isArray(job.payload)
      ? (job.payload as Record<string, unknown>)
      : {};
  const progressionPublicId = payload.progression_public_id;

  if (typeof progressionPublicId !== "string" || !progressionPublicId) {
    throw new Error("Concept progression workflow job requires progression_public_id.");
  }

  return progressionPublicId;
}

async function jobContext(job: WorkflowJob) {
  if (!job.concept_unit_session_db_id) {
    throw new Error("Workflow job requires a concept-unit session.");
  }

  const conceptUnitSession = await prisma.conceptUnitSession.findUnique({
    where: { id: job.concept_unit_session_db_id },
    select: {
      id: true,
      assessment_session: {
        select: {
          session_public_id: true,
          current_phase: true,
          assessment: {
            select: {
              created_by_user_db_id: true
            }
          }
        }
      },
      concept_unit: {
        select: {
          concept_unit_public_id: true
        }
      }
    }
  });

  if (!conceptUnitSession) {
    throw new Error("Concept-unit session was not found for workflow job.");
  }

  return conceptUnitSession;
}

async function handleInitialProfiling(job: WorkflowJob): Promise<HandlerResult> {
  const context = await jobContext(job);

  try {
    const result = await runInitialStudentProfiling({
      concept_unit_session_db_id: context.id,
      invocation_reason: "automatic_workflow_phase6d2a_initial_profiling"
    });

    if (result.status === "profile_created" || result.status === "already_profiled") {
      await enqueueInitialPlanningJob(context.id);
      return { outcome: "completed" };
    }

    return failureFromStatus((result as { status: string }).status);
  } catch (error) {
    if (error instanceof StudentProfilingServiceError) {
      return {
        outcome: "failed",
        error_category: error.code,
        error_message: error.message
      };
    }

    throw error;
  }
}

async function handleInitialPlanning(job: WorkflowJob): Promise<HandlerResult> {
  const context = await jobContext(job);

  try {
    await runInitialFormativePlanning({
      concept_unit_session_db_id: context.id,
      invocation_reason: "automatic_workflow_phase6d2a_initial_planning"
    });

    await enqueueInitialFollowupStartupJob(context.id);
    return { outcome: "completed" };
  } catch (error) {
    if (error instanceof FormativePlanningServiceError) {
      return {
        outcome: "failed",
        error_category: error.code,
        error_message: error.message
      };
    }

    throw error;
  }
}

async function handleInitialFollowup(job: WorkflowJob): Promise<HandlerResult> {
  const context = await jobContext(job);

  try {
    const result = await startFollowupRoundForTeacher({
      session_public_id: context.assessment_session.session_public_id,
      concept_unit_public_id: context.concept_unit.concept_unit_public_id,
      requested_by_user_db_id: context.assessment_session.assessment.created_by_user_db_id
    });

    if (result.status === "followup_started" || result.status === "already_active") {
      return { outcome: "completed" };
    }

    return failureFromStatus(result.status);
  } catch (error) {
    if (error instanceof FollowupServiceError) {
      return {
        outcome: "failed",
        error_category: error.code,
        error_message: error.message
      };
    }

    throw error;
  }
}

async function handleFollowupProfileUpdate(job: WorkflowJob): Promise<HandlerResult> {
  try {
    const result = await runFollowupProfileUpdate(cyclePublicIdFromJob(job));

    if (
      result.status === "profile_update_staged" ||
      result.status === "profile_update_already_staged" ||
      result.status === "already_completed"
    ) {
      return { outcome: "completed" };
    }

    return failureFromStatus(result.status);
  } catch (error) {
    if (error instanceof FollowupUpdateCycleError) {
      return {
        outcome: "failed",
        error_category: error.code,
        error_message: error.message
      };
    }

    throw error;
  }
}

async function handleFollowupPlanningUpdate(job: WorkflowJob): Promise<HandlerResult> {
  try {
    const result = await runFollowupPlanningUpdate(cyclePublicIdFromJob(job));

    if (
      result.status === "planning_update_staged" ||
      result.status === "planning_update_already_staged" ||
      result.status === "already_completed"
    ) {
      return { outcome: "completed" };
    }

    return failureFromStatus(result.status);
  } catch (error) {
    if (error instanceof FollowupUpdateCycleError) {
      return {
        outcome: "failed",
        error_category: error.code,
        error_message: error.message
      };
    }

    throw error;
  }
}

async function handleFollowupFinalize(job: WorkflowJob): Promise<HandlerResult> {
  try {
    const result = await finalizeFollowupUpdate(cyclePublicIdFromJob(job));

    if (
      result.status === "followup_update_completed" ||
      result.status === "already_completed"
    ) {
      return { outcome: "completed" };
    }

    return failureFromStatus(result.status);
  } catch (error) {
    if (error instanceof FollowupUpdateCycleError) {
      return {
        outcome: "failed",
        error_category: error.code,
        error_message: error.message
      };
    }

    throw error;
  }
}

async function handleConceptProgressionFinalize(job: WorkflowJob): Promise<HandlerResult> {
  try {
    const result = await finalizeConceptProgression(progressionPublicIdFromJob(job));

    if (
      result.status === "already_completed" ||
      result.status === "next_concept_ready" ||
      result.status === "assessment_completed" ||
      result.status === "unresolved_confirmation_required" ||
      result.status === "progression_offered"
    ) {
      return { outcome: "completed" };
    }

    if (result.status === "final_update_still_processing") {
      return {
        outcome: "retryable",
        error_category: result.status,
        error_message: "Concept progression final update is still processing."
      };
    }

    return failureFromStatus(result.status);
  } catch (error) {
    if (error instanceof ConceptProgressionServiceError) {
      return {
        outcome: "failed",
        error_category: error.code,
        error_message: error.message
      };
    }

    throw error;
  }
}

export async function handleWorkflowJob(job: WorkflowJob): Promise<HandlerResult> {
  const guardedFailure = await guardedOperationalIntegrationFailure(job);

  if (guardedFailure) {
    return guardedFailure;
  }

  if (job.job_type === "run_initial_profiling") {
    return handleInitialProfiling(job);
  }

  if (job.job_type === "run_initial_planning") {
    return handleInitialPlanning(job);
  }

  if (job.job_type === "start_initial_followup") {
    return handleInitialFollowup(job);
  }

  if (job.job_type === "run_followup_profile_update") {
    return handleFollowupProfileUpdate(job);
  }

  if (job.job_type === "run_followup_planning_update") {
    return handleFollowupPlanningUpdate(job);
  }

  if (job.job_type === "finalize_followup_update") {
    return handleFollowupFinalize(job);
  }

  if (job.job_type === "finalize_concept_progression") {
    return handleConceptProgressionFinalize(job);
  }

  return {
    outcome: "failed",
    error_category: "unsupported_job_type",
    error_message: `Unsupported workflow job type ${job.job_type}.`
  };
}
