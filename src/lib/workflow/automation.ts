import type { AssessmentWorkflowMode } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getGuardedOperationalAgentIntegrationReadiness } from "@/lib/operational/guarded-agent-integration";
import { operationalReadinessHasFatalConfigurationBlock } from "@/lib/operational/guarded-agent-integration";
import { enqueueWorkflowJob, type WorkflowJobSummary } from "./jobs";

export type SessionAutomationState =
  | "manual"
  | "automatic_idle"
  | "automatic_processing"
  | "automatic_paused"
  | "automatic_failed"
  | "automatic_active_followup"
  | "automatic_completed_step";

function workflowPayload(input: {
  session_public_id: string;
  concept_unit_public_id: string;
  assessment_public_id: string;
  step: string;
  evidence_public_key?: string;
}) {
  return {
    session_public_id: input.session_public_id,
    concept_unit_public_id: input.concept_unit_public_id,
    assessment_public_id: input.assessment_public_id,
    step: input.step,
    evidence_public_key: input.evidence_public_key ?? null
  };
}

export async function enqueueInitialProfilingJobIfAutomatic(conceptUnitSessionDbId: string) {
  const context = await prisma.conceptUnitSession.findUnique({
    where: { id: conceptUnitSessionDbId },
    select: {
      id: true,
      assessment_session_db_id: true,
      assessment_session: {
        select: {
          workflow_mode_snapshot: true,
          session_public_id: true,
          automation_paused_at: true,
          assessment: {
            select: {
              assessment_public_id: true
            }
          }
        }
      },
      concept_unit: {
        select: {
          concept_unit_public_id: true
        }
      },
      response_packages: {
        where: { package_type: "initial_concept_unit_response_package" },
        orderBy: [{ created_at: "desc" }],
        take: 1,
        select: {
          id: true,
          created_at: true
        }
      }
    }
  });

  if (!context || context.assessment_session.workflow_mode_snapshot !== "automatic") {
    return null;
  }

  const responsePackage = context.response_packages[0];

  if (!responsePackage) {
    return null;
  }

  const readiness = await getGuardedOperationalAgentIntegrationReadiness({
    checkDatabase: true
  });

  if (!readiness.allowed && operationalReadinessHasFatalConfigurationBlock(readiness)) {
    return null;
  }

  return enqueueWorkflowJob({
    job_type: "run_initial_profiling",
    assessment_session_db_id: context.assessment_session_db_id,
    concept_unit_session_db_id: context.id,
    idempotency_key: `run_initial_profiling:${context.id}:${responsePackage.id}`,
    payload: workflowPayload({
      session_public_id: context.assessment_session.session_public_id,
      concept_unit_public_id: context.concept_unit.concept_unit_public_id,
      assessment_public_id: context.assessment_session.assessment.assessment_public_id,
      step: "run_initial_profiling",
      evidence_public_key: `initial_response_package:${responsePackage.created_at.toISOString()}`
    })
  });
}

export async function enqueueInitialPlanningJob(conceptUnitSessionDbId: string) {
  const context = await prisma.conceptUnitSession.findUnique({
    where: { id: conceptUnitSessionDbId },
    select: {
      id: true,
      assessment_session_db_id: true,
      latest_student_profile_db_id: true,
      assessment_session: {
        select: {
          session_public_id: true,
          assessment: {
            select: {
              assessment_public_id: true
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

  if (!context?.latest_student_profile_db_id) {
    return null;
  }

  const readiness = await getGuardedOperationalAgentIntegrationReadiness({
    checkDatabase: true
  });

  if (!readiness.allowed && operationalReadinessHasFatalConfigurationBlock(readiness)) {
    return null;
  }

  return enqueueWorkflowJob({
    job_type: "run_initial_planning",
    assessment_session_db_id: context.assessment_session_db_id,
    concept_unit_session_db_id: context.id,
    idempotency_key: `run_initial_planning:${context.id}:${context.latest_student_profile_db_id}`,
    payload: workflowPayload({
      session_public_id: context.assessment_session.session_public_id,
      concept_unit_public_id: context.concept_unit.concept_unit_public_id,
      assessment_public_id: context.assessment_session.assessment.assessment_public_id,
      step: "run_initial_planning",
      evidence_public_key: "latest_student_profile"
    })
  });
}

export async function enqueueInitialFollowupStartupJob(conceptUnitSessionDbId: string) {
  const context = await prisma.conceptUnitSession.findUnique({
    where: { id: conceptUnitSessionDbId },
    select: {
      id: true,
      assessment_session_db_id: true,
      latest_formative_decision_db_id: true,
      assessment_session: {
        select: {
          session_public_id: true,
          assessment: {
            select: {
              assessment_public_id: true
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

  if (!context?.latest_formative_decision_db_id) {
    return null;
  }

  const readiness = await getGuardedOperationalAgentIntegrationReadiness({
    checkDatabase: true
  });

  if (!readiness.allowed && operationalReadinessHasFatalConfigurationBlock(readiness)) {
    return null;
  }

  return enqueueWorkflowJob({
    job_type: "start_initial_followup",
    assessment_session_db_id: context.assessment_session_db_id,
    concept_unit_session_db_id: context.id,
    idempotency_key: `start_initial_followup:${context.id}:${context.latest_formative_decision_db_id}`,
    payload: workflowPayload({
      session_public_id: context.assessment_session.session_public_id,
      concept_unit_public_id: context.concept_unit.concept_unit_public_id,
      assessment_public_id: context.assessment_session.assessment.assessment_public_id,
      step: "start_initial_followup",
      evidence_public_key: "latest_formative_decision"
    })
  });
}

export function deriveAutomationState(input: {
  workflow_mode_snapshot: AssessmentWorkflowMode;
  current_phase: string;
  automation_paused_at: Date | string | null;
  automation_exception_reason: string | null;
  workflow_jobs?: WorkflowJobSummary[];
}): SessionAutomationState {
  if (input.workflow_mode_snapshot === "manual_review") {
    return "manual";
  }

  if (input.automation_paused_at) {
    return "automatic_paused";
  }

  const jobs = input.workflow_jobs ?? [];
  const latestJob = jobs[0] ?? null;

  if (input.automation_exception_reason || latestJob?.status === "failed") {
    return "automatic_failed";
  }

  if (
    input.current_phase === "followup_profile_update_pending" ||
    input.current_phase === "followup_planning_update_pending"
  ) {
    return "automatic_processing";
  }

  if (input.current_phase === "followup_active") {
    return "automatic_active_followup";
  }

  if (jobs.some((job) => ["pending", "running", "retryable"].includes(job.status))) {
    return "automatic_processing";
  }

  if (
    ["profiling_completed", "planning_completed", "followup_stopped"].includes(
      input.current_phase
    )
  ) {
    return "automatic_completed_step";
  }

  return "automatic_idle";
}
