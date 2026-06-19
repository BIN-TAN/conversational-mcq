import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { SessionListQuery } from "./filters";
import { serializeDate } from "./serializers";

function sessionWhereFromQuery(query: SessionListQuery): Prisma.AssessmentSessionWhereInput {
  return {
    ...(query.search
      ? {
          user: {
            user_id: {
              contains: query.search,
              mode: "insensitive"
            }
          }
        }
      : {}),
    ...(query.assessment_public_id
      ? { assessment: { assessment_public_id: query.assessment_public_id } }
      : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.phase ? { current_phase: query.phase } : {}),
    ...(typeof query.needs_review === "boolean" ? { needs_review: query.needs_review } : {})
  };
}

export async function listTeacherReviewSessions(query: SessionListQuery) {
  const where = sessionWhereFromQuery(query);
  const total = await prisma.assessmentSession.count({ where });
  const sessions = await prisma.assessmentSession.findMany({
    where,
    orderBy: [{ [query.sort]: query.direction }, { created_at: "desc" }],
    skip: (query.page - 1) * query.page_size,
    take: query.page_size,
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
          _count: {
            select: {
              concept_units: true
            }
          }
        }
      },
      current_concept_unit: {
        select: {
          title: true
        }
      }
    }
  });
  const sessionIds = sessions.map((session) => session.id);
  const conceptUnitSessions =
    sessionIds.length > 0
      ? await prisma.conceptUnitSession.findMany({
          where: { assessment_session_db_id: { in: sessionIds } },
          select: {
            assessment_session_db_id: true,
            status: true,
            _count: {
              select: {
                item_responses: true
              }
            }
          }
        })
      : [];
  const conceptUnitCounts = new Map<
    string,
    { completed_concept_unit_count: number; item_response_count: number }
  >();

  for (const conceptUnitSession of conceptUnitSessions) {
    const current =
      conceptUnitCounts.get(conceptUnitSession.assessment_session_db_id) ?? {
        completed_concept_unit_count: 0,
        item_response_count: 0
      };
    const isCompleted = [
      "initial_completed",
      "followup_completed",
      "completed"
    ].includes(conceptUnitSession.status);

    conceptUnitCounts.set(conceptUnitSession.assessment_session_db_id, {
      completed_concept_unit_count:
        current.completed_concept_unit_count + (isCompleted ? 1 : 0),
      item_response_count: current.item_response_count + conceptUnitSession._count.item_responses
    });
  }

  const assessmentFilters = await prisma.assessment.findMany({
    where: { assessment_sessions: { some: {} } },
    orderBy: [{ title: "asc" }, { assessment_public_id: "asc" }],
    select: {
      assessment_public_id: true,
      title: true
    }
  });

  return {
    sessions: sessions.map((session) => {
      const counts = conceptUnitCounts.get(session.id);

      return {
        session_public_id: session.session_public_id,
        student_user_id: session.user.user_id,
        student_display_name: null,
        assessment_public_id: session.assessment.assessment_public_id,
        assessment_title: session.assessment.title,
        attempt_number: session.attempt_number,
        session_status: session.status,
        current_phase: session.current_phase,
        needs_review: session.needs_review,
        needs_review_reason: session.needs_review_reason,
        started_at: serializeDate(session.started_at),
        last_activity_at: serializeDate(session.last_activity_at),
        completed_at: serializeDate(session.completed_at),
        concept_unit_count: session.assessment._count.concept_units,
        completed_concept_unit_count: counts?.completed_concept_unit_count ?? 0,
        current_concept_unit_title: session.current_concept_unit?.title ?? null,
        item_response_count: counts?.item_response_count ?? 0
      };
    }),
    pagination: {
      page: query.page,
      page_size: query.page_size,
      total,
      total_pages: Math.max(1, Math.ceil(total / query.page_size))
    },
    filters: {
      assessments: assessmentFilters
    }
  };
}
