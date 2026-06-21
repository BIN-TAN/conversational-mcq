import { prisma } from "@/lib/db";
import { serializeStudentProfileForTeacher } from "@/lib/agents/student-profiling/serializers";
import { serializeAssessmentContentState } from "@/lib/services/content/governance";
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

  return {
    session: {
      session_public_id: session.session_public_id,
      attempt_number: session.attempt_number,
      status: session.status,
      current_phase: session.current_phase,
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
        session.current_phase === "profiling_pending" &&
        Boolean(conceptUnitSession.initial_completed_at) &&
        !conceptUnitSession.latest_student_profile,
      latest_student_profile: conceptUnitSession.latest_student_profile
        ? serializeStudentProfileForTeacher(conceptUnitSession.latest_student_profile)
        : null
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
        "Student Profiling Agent records may exist after Phase 6B. Formative planning and follow-up remain unimplemented."
    }
  };
}
