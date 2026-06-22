import { prisma } from "@/lib/db";
import { serializeFormativeDecisionForTeacher } from "@/lib/agents/formative-planning/serializers";
import { serializeFollowupRoundForTeacher } from "@/lib/agents/followup/serializers";
import { serializeFollowupUpdateCycleForTeacher } from "@/lib/agents/followup-updates/service";
import { serializeStudentProfileForTeacher } from "@/lib/agents/student-profiling/serializers";
import { getServerEnv } from "@/lib/env";
import { serializeProgressionForTeacher } from "@/lib/services/concept-progression/progression";
import { serializeAssessmentContentState } from "@/lib/services/content/governance";
import { deriveAutomationState } from "@/lib/workflow/automation";
import { serializeWorkflowJob } from "@/lib/workflow/jobs";
import { TeacherReviewServiceError } from "./errors";
import { serializeDate } from "./serializers";

export async function getTeacherReviewSessionDetail(sessionPublicId: string) {
  const session = await prisma.assessmentSession.findUnique({
    where: { session_public_id: sessionPublicId },
    select: {
      id: true,
      session_public_id: true,
      attempt_number: true,
      status: true,
      current_phase: true,
      workflow_mode_snapshot: true,
      automation_paused_at: true,
      automation_exception_reason: true,
      needs_review: true,
      needs_review_reason: true,
      started_at: true,
      last_activity_at: true,
      completed_at: true,
      user: {
        select: {
          user_id: true
        }
      },
      assessment: {
        select: {
          assessment_public_id: true,
          title: true,
          description: true,
          status: true,
          _count: {
            select: {
              assessment_sessions: true,
              concept_units: true
            }
          }
        }
      },
      current_concept_unit: {
        select: {
          concept_unit_public_id: true,
          title: true
        }
      },
      concept_unit_sessions: {
        orderBy: [
          {
            concept_unit: {
              order_index: "asc"
            }
          },
          { created_at: "asc" }
        ],
        select: {
          id: true,
          status: true,
          initial_started_at: true,
          initial_completed_at: true,
          followup_started_at: true,
          followup_completed_at: true,
          followup_status: true,
          followup_round_count: true,
          latest_student_profile: {
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
          },
          latest_formative_decision: {
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
          },
          followup_rounds: {
            orderBy: [{ round_index: "asc" }],
            include: {
              formative_decision: {
                select: {
                  formative_value: true,
                  created_at: true
                }
              },
              conversation_turns: {
                orderBy: [{ created_at: "asc" }],
                select: {
                  actor_type: true,
                  agent_name: true,
                  message_text: true,
                  structured_payload: true,
                  created_at: true
                }
              },
              agent_calls: {
                where: { agent_name: "followup_agent" },
                orderBy: [{ created_at: "asc" }],
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
                  latency_ms: true,
                  input_tokens: true,
                  output_tokens: true,
                  total_tokens: true,
                  created_at: true,
                  completed_at: true
                }
              }
            }
          },
          followup_update_cycles: {
            orderBy: [{ created_at: "asc" }],
            select: {
              cycle_public_id: true,
              trigger_type: true,
              trigger_details: true,
              status: true,
              final_update: true,
              create_next_round: true,
              stop_after_cycle: true,
              evidence_cutoff_at: true,
              profile_agent_call_db_id: true,
              planning_agent_call_db_id: true,
              opening_agent_call_db_id: true,
              staged_profile_output: true,
              staged_planning_output: true,
              staged_opening_output: true,
              failure_stage: true,
              failure_category: true,
              failure_message: true,
              created_at: true,
              updated_at: true,
              completed_at: true
            }
          },
          concept_progression_records: {
            orderBy: [{ requested_at: "asc" }],
            select: {
              progression_public_id: true,
              progression_type: true,
              trigger_type: true,
              student_choice: true,
              status: true,
              resolution_status: true,
              moved_on_with_unresolved_evidence: true,
              completed_with_unresolved_evidence: true,
              requested_at: true,
              confirmed_at: true,
              completed_at: true,
              destination_concept_unit: {
                select: {
                  concept_unit_public_id: true,
                  title: true,
                  order_index: true
                }
              },
              final_update_cycle: {
                select: {
                  cycle_public_id: true,
                  status: true,
                  completed_at: true
                }
              }
            }
          },
          concept_unit: {
            select: {
              concept_unit_public_id: true,
              title: true,
              order_index: true
            }
          },
          _count: {
            select: {
              item_responses: true,
              response_packages: true,
              student_profiles: true,
              formative_decisions: true,
              followup_rounds: true,
              agent_calls: true
            }
          }
        }
      },
      workflow_jobs: {
        orderBy: [{ created_at: "desc" }]
      },
      workflow_overrides: {
        orderBy: [{ created_at: "desc" }],
        select: {
          override_public_id: true,
          action_type: true,
          reason: true,
          created_at: true
        }
      },
      _count: {
        select: {
          agent_calls: true
        }
      }
    }
  });

  if (!session) {
    throw new TeacherReviewServiceError(
      "not_found",
      "Assessment session was not found.",
      404,
      { session_public_id: sessionPublicId }
    );
  }

  const itemResponseCount = session.concept_unit_sessions.reduce(
    (total, conceptUnitSession) => total + conceptUnitSession._count.item_responses,
    0
  );
  const responsePackageCount = session.concept_unit_sessions.reduce(
    (total, conceptUnitSession) => total + conceptUnitSession._count.response_packages,
    0
  );
  const studentProfileCount = session.concept_unit_sessions.reduce(
    (total, conceptUnitSession) => total + conceptUnitSession._count.student_profiles,
    0
  );
  const formativeDecisionCount = session.concept_unit_sessions.reduce(
    (total, conceptUnitSession) => total + conceptUnitSession._count.formative_decisions,
    0
  );
  const followupRoundCount = session.concept_unit_sessions.reduce(
    (total, conceptUnitSession) => total + conceptUnitSession._count.followup_rounds,
    0
  );
  const conceptUnitCount = session.assessment._count.concept_units;
  const completedConceptUnitCount = session.concept_unit_sessions.filter((conceptUnitSession) =>
    ["initial_completed", "followup_completed", "completed"].includes(conceptUnitSession.status)
  ).length;
  const serializedWorkflowJobs = session.workflow_jobs.map(serializeWorkflowJob);
  const latestWorkflowJob = serializedWorkflowJobs[0] ?? null;
  const automationState = deriveAutomationState({
    workflow_mode_snapshot: session.workflow_mode_snapshot,
    current_phase: session.current_phase,
    automation_paused_at: session.automation_paused_at,
    automation_exception_reason: session.automation_exception_reason,
    workflow_jobs: serializedWorkflowJobs
  });
  const manualReview = session.workflow_mode_snapshot === "manual_review";
  const developmentControlsEnabled = getServerEnv().DEVELOPMENT_ACTIVE_SESSION_CONTROLS_ENABLED;
  const hasFailedWorkflowJob =
    Boolean(session.automation_exception_reason) || latestWorkflowJob?.status === "failed";

  return {
    session: {
      session_public_id: session.session_public_id,
      attempt_number: session.attempt_number,
      status: session.status,
      current_phase: session.current_phase,
      workflow_mode_snapshot: session.workflow_mode_snapshot,
      automation_state: automationState,
      automation_paused_at: serializeDate(session.automation_paused_at),
      automation_exception_reason: session.automation_exception_reason,
      needs_review: session.needs_review,
      needs_review_reason: session.needs_review_reason,
      started_at: serializeDate(session.started_at),
      last_activity_at: serializeDate(session.last_activity_at),
      completed_at: serializeDate(session.completed_at)
    },
    student: {
      user_id: session.user.user_id,
      display_name: null
    },
    assessment: {
      assessment_public_id: session.assessment.assessment_public_id,
      title: session.assessment.title,
      description: session.assessment.description,
      content_state: serializeAssessmentContentState(session.assessment)
    },
    automation: {
      workflow_mode_snapshot: session.workflow_mode_snapshot,
      automation_state: automationState,
      automation_paused_at: serializeDate(session.automation_paused_at),
      automation_exception_reason: session.automation_exception_reason,
      workflow_jobs: serializedWorkflowJobs,
      workflow_overrides: session.workflow_overrides.map((override) => ({
        override_public_id: override.override_public_id,
        action_type: override.action_type,
        reason: override.reason,
        created_at: serializeDate(override.created_at)
      })),
      can_pause:
        developmentControlsEnabled &&
        session.workflow_mode_snapshot === "automatic" &&
        !session.automation_paused_at &&
        ["pending", "running", "retryable"].some((status) =>
          serializedWorkflowJobs.some((job) => job.status === status)
        ),
      can_resume:
        developmentControlsEnabled &&
        session.workflow_mode_snapshot === "automatic" &&
        Boolean(session.automation_paused_at),
      can_retry_current_step:
        developmentControlsEnabled &&
        session.workflow_mode_snapshot === "automatic" && hasFailedWorkflowJob,
      can_stop_followup:
        developmentControlsEnabled &&
        session.workflow_mode_snapshot === "automatic" &&
        session.current_phase === "followup_active"
    },
    current_concept_unit: session.current_concept_unit
      ? {
          concept_unit_public_id: session.current_concept_unit.concept_unit_public_id,
          title: session.current_concept_unit.title
        }
      : null,
    concept_unit_sessions: session.concept_unit_sessions.map((conceptUnitSession) => ({
      concept_unit_public_id: conceptUnitSession.concept_unit.concept_unit_public_id,
      title: conceptUnitSession.concept_unit.title,
      order_index: conceptUnitSession.concept_unit.order_index,
      status: conceptUnitSession.status,
      initial_started_at: serializeDate(conceptUnitSession.initial_started_at),
      initial_completed_at: serializeDate(conceptUnitSession.initial_completed_at),
      followup_started_at: serializeDate(conceptUnitSession.followup_started_at),
      followup_completed_at: serializeDate(conceptUnitSession.followup_completed_at),
      followup_status: conceptUnitSession.followup_status,
      followup_round_count: conceptUnitSession.followup_round_count,
      item_response_count: conceptUnitSession._count.item_responses,
      response_package_count: conceptUnitSession._count.response_packages,
      can_run_profiling:
        developmentControlsEnabled &&
        manualReview &&
        session.current_phase === "profiling_pending" &&
        Boolean(conceptUnitSession.initial_completed_at) &&
        !conceptUnitSession.latest_student_profile,
      can_run_planning:
        developmentControlsEnabled &&
        manualReview &&
        ["profiling_completed", "planning_pending"].includes(session.current_phase) &&
        Boolean(conceptUnitSession.latest_student_profile) &&
        !conceptUnitSession.latest_formative_decision,
      can_start_followup:
        developmentControlsEnabled &&
        manualReview &&
        session.current_phase === "planning_completed" &&
        Boolean(conceptUnitSession.latest_student_profile) &&
        Boolean(conceptUnitSession.latest_formative_decision) &&
        !conceptUnitSession.followup_rounds.some((round) => round.status === "active"),
      can_run_followup_update:
        developmentControlsEnabled &&
        manualReview &&
        session.current_phase === "followup_active" &&
        conceptUnitSession.followup_rounds.some((round) => round.status === "active") &&
        !conceptUnitSession.followup_update_cycles.some((cycle) =>
          [
            "pending",
            "profiling",
            "profiling_completed",
            "planning",
            "planning_completed",
            "opening",
            "committing"
          ].includes(cycle.status)
        ),
      latest_student_profile: conceptUnitSession.latest_student_profile
        ? serializeStudentProfileForTeacher(conceptUnitSession.latest_student_profile)
        : null,
      latest_formative_decision: conceptUnitSession.latest_formative_decision
        ? serializeFormativeDecisionForTeacher(conceptUnitSession.latest_formative_decision)
        : null,
      followup_rounds: conceptUnitSession.followup_rounds.map(serializeFollowupRoundForTeacher),
      followup_update_cycles: conceptUnitSession.followup_update_cycles.map(
        serializeFollowupUpdateCycleForTeacher
      ),
      concept_progression_records: conceptUnitSession.concept_progression_records.map(
        serializeProgressionForTeacher
      )
    })),
    summary: {
      concept_unit_count: conceptUnitCount,
      completed_concept_unit_count: completedConceptUnitCount,
      item_response_count: itemResponseCount,
      response_package_count: responsePackageCount,
      assessment_content_locked: serializeAssessmentContentState(session.assessment).is_content_locked
    },
    future_agent_data: {
      student_profile_count: studentProfileCount,
      formative_decision_count: formativeDecisionCount,
      followup_round_count: followupRoundCount,
      agent_call_count: session._count.agent_calls,
      message:
        "Student Profiling, Formative Planning, Follow-up Agent, and staged follow-up update-cycle records may exist. Staged outputs become current only after a completed update cycle."
    }
  };
}
