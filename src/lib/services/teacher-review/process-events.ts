import { prisma } from "@/lib/db";
import type { ProcessEventType } from "@/lib/domain/enums";
import type { ProcessEventQuery } from "./filters";
import { TeacherReviewServiceError } from "./errors";
import { asRecord, serializeDate, stripInternalKeys } from "./serializers";

type EventCounts = Partial<Record<ProcessEventType | string, number>>;

function countEvents(types: EventCounts, keys: string[]) {
  return keys.reduce((total, key) => total + (types[key] ?? 0), 0);
}

function hasRevisionPayload(payload: unknown) {
  const record = asRecord(payload);

  return record.revision === true || Number(record.revision_count ?? 0) > 0;
}

export async function getTeacherReviewProcessEvents(
  sessionPublicId: string,
  query: ProcessEventQuery
) {
  const session = await prisma.assessmentSession.findUnique({
    where: { session_public_id: sessionPublicId },
    select: { id: true, session_public_id: true }
  });

  if (!session) {
    throw new TeacherReviewServiceError(
      "not_found",
      "Assessment session was not found.",
      404,
      { session_public_id: sessionPublicId }
    );
  }

  const where = {
    assessment_session_db_id: session.id,
    ...(query.event_type ? { event_type: query.event_type } : {}),
    ...(query.event_source ? { event_source: query.event_source } : {}),
    ...(query.concept_unit_public_id
      ? {
          concept_unit_session: {
            concept_unit: {
              concept_unit_public_id: query.concept_unit_public_id
            }
          }
        }
      : {})
  };
  const total = await prisma.processEvent.count({ where });
  const events = await prisma.processEvent.findMany({
    where,
    orderBy: [{ occurred_at: "asc" }, { created_at: "asc" }],
    skip: (query.page - 1) * query.page_size,
    take: query.page_size,
    select: {
      event_type: true,
      event_category: true,
      event_source: true,
      visibility_duration_ms: true,
      pause_duration_ms: true,
      payload: true,
      occurred_at: true,
      created_at: true,
      concept_unit_session: {
        select: {
          concept_unit: {
            select: {
              concept_unit_public_id: true,
              title: true
            }
          }
        }
      },
      item: {
        select: {
          item_public_id: true,
          item_order: true
        }
      }
    }
  });
  const allSessionEvents = await prisma.processEvent.findMany({
    where: { assessment_session_db_id: session.id },
    select: {
      event_type: true,
      payload: true
    }
  });
  const eventCounts = allSessionEvents.reduce<EventCounts>((counts, event) => {
    counts[event.event_type] = (counts[event.event_type] ?? 0) + 1;
    return counts;
  }, {});
  const optionRevisionCount = allSessionEvents.filter(
    (event) => event.event_type === "option_selected" && hasRevisionPayload(event.payload)
  ).length;
  const followupTurnCount = await prisma.conversationTurn.count({
    where: {
      assessment_session_db_id: session.id,
      phase: {
        in: [
          "followup_active",
          "followup_profile_update_pending",
          "followup_planning_update_pending",
          "followup_stopped"
        ]
      }
    }
  });
  const conceptUnits = await prisma.conceptUnitSession.findMany({
    where: { assessment_session_db_id: session.id },
    orderBy: [{ concept_unit: { order_index: "asc" } }],
    select: {
      concept_unit: {
        select: {
          concept_unit_public_id: true,
          title: true
        }
      }
    }
  });

  return {
    session_public_id: session.session_public_id,
    aggregates: {
      event_count_by_type: eventCounts,
      page_switch_count: countEvents(eventCounts, ["page_hidden", "page_visible"]),
      long_pause_count: countEvents(eventCounts, ["long_pause"]),
      inactivity_count: countEvents(eventCounts, ["inactivity_detected"]),
      navigation_event_count: countEvents(eventCounts, ["navigation_event"]),
      invalid_help_request_count: countEvents(eventCounts, ["invalid_help_request"]),
      prompt_injection_attempt_count: countEvents(eventCounts, ["prompt_injection_attempt"]),
      procedural_clarification_count: countEvents(eventCounts, [
        "procedural_clarification_request"
      ]),
      emotional_response_count: countEvents(eventCounts, [
        "emotional_or_frustration_response"
      ]),
      reasoning_revision_count: countEvents(eventCounts, ["reasoning_revised"]),
      option_revision_count: optionRevisionCount,
      validation_failure_count: countEvents(eventCounts, ["schema_validation_failed"]),
      agent_retry_count: countEvents(eventCounts, ["agent_retry_scheduled"]),
      followup_turn_count: followupTurnCount
    },
    events: events.map((event) => ({
      event_type: event.event_type,
      event_category: event.event_category,
      event_source: event.event_source,
      occurred_at: serializeDate(event.occurred_at),
      created_at: serializeDate(event.created_at),
      visibility_duration_ms: event.visibility_duration_ms,
      pause_duration_ms: event.pause_duration_ms,
      concept_unit_public_id:
        event.concept_unit_session?.concept_unit.concept_unit_public_id ?? null,
      concept_unit_title: event.concept_unit_session?.concept_unit.title ?? null,
      item_public_id: event.item?.item_public_id ?? null,
      item_order: event.item?.item_order ?? null,
      payload: stripInternalKeys(event.payload)
    })),
    concept_units: conceptUnits.map((conceptUnitSession) => ({
      concept_unit_public_id: conceptUnitSession.concept_unit.concept_unit_public_id,
      title: conceptUnitSession.concept_unit.title
    })),
    pagination: {
      page: query.page,
      page_size: query.page_size,
      total,
      total_pages: Math.max(1, Math.ceil(total / query.page_size))
    },
    interpretation_boundary:
      "Process events are contextual evidence for engagement and evidence sufficiency; they are not misconduct labels."
  };
}
