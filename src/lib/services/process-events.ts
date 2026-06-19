import { z } from "zod";
import { prisma } from "../db";
import {
  EventSourceSchema,
  ProcessEventTypeSchema,
  type ProcessEventType
} from "../domain/enums";
import { toPrismaJson } from "./json";

const logProcessEventSchema = z.object({
  assessment_session_db_id: z.string().uuid(),
  concept_unit_session_db_id: z.string().uuid().optional(),
  item_db_id: z.string().uuid().optional(),
  event_type: ProcessEventTypeSchema,
  event_category: z.string().min(1),
  event_source: EventSourceSchema,
  visibility_duration_ms: z.number().int().nonnegative().optional(),
  pause_duration_ms: z.number().int().nonnegative().optional(),
  payload: z.unknown().optional(),
  occurred_at: z.coerce.date().optional()
});

export type LogProcessEventInput = z.input<typeof logProcessEventSchema>;

export type ProcessEventAggregation = {
  event_count_by_type: Partial<Record<ProcessEventType, number>>;
  page_switch_count: number;
  long_pause_count: number;
  invalid_help_request_count: number;
  prompt_injection_attempt_count: number;
  procedural_clarification_count: number;
  emotional_response_count: number;
  agent_retry_count: number;
  validation_failure_count: number;
  followup_turn_count: number;
};

export async function logProcessEvent(input: LogProcessEventInput) {
  const parsed = logProcessEventSchema.parse(input);

  return prisma.processEvent.create({
    data: {
      assessment_session_db_id: parsed.assessment_session_db_id,
      concept_unit_session_db_id: parsed.concept_unit_session_db_id,
      item_db_id: parsed.item_db_id,
      event_type: parsed.event_type,
      event_category: parsed.event_category,
      event_source: parsed.event_source,
      visibility_duration_ms: parsed.visibility_duration_ms,
      pause_duration_ms: parsed.pause_duration_ms,
      payload: toPrismaJson(parsed.payload),
      occurred_at: parsed.occurred_at ?? new Date()
    }
  });
}

function countEvents(types: Partial<Record<ProcessEventType, number>>, keys: ProcessEventType[]): number {
  return keys.reduce((total, key) => total + (types[key] ?? 0), 0);
}

export async function aggregateProcessEventsByConceptUnitSession(
  conceptUnitSessionDbId: string
): Promise<ProcessEventAggregation> {
  const conceptUnitSession = await prisma.conceptUnitSession.findUniqueOrThrow({
    where: { id: conceptUnitSessionDbId },
    select: { assessment_session_db_id: true }
  });
  const events = await prisma.processEvent.findMany({
    where: { concept_unit_session_db_id: conceptUnitSessionDbId },
    select: { event_type: true }
  });
  const eventCountByType: Partial<Record<ProcessEventType, number>> = {};

  for (const event of events) {
    const parsed = ProcessEventTypeSchema.safeParse(event.event_type);

    if (parsed.success) {
      eventCountByType[parsed.data] = (eventCountByType[parsed.data] ?? 0) + 1;
    }
  }

  const followupTurnCount = await prisma.conversationTurn.count({
    where: {
      assessment_session_db_id: conceptUnitSession.assessment_session_db_id,
      concept_unit_session_db_id: conceptUnitSessionDbId,
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

  return {
    event_count_by_type: eventCountByType,
    page_switch_count: countEvents(eventCountByType, ["page_hidden", "page_visible"]),
    long_pause_count: countEvents(eventCountByType, ["long_pause"]),
    invalid_help_request_count: countEvents(eventCountByType, ["invalid_help_request"]),
    prompt_injection_attempt_count: countEvents(eventCountByType, ["prompt_injection_attempt"]),
    procedural_clarification_count: countEvents(eventCountByType, [
      "procedural_clarification_request"
    ]),
    emotional_response_count: countEvents(eventCountByType, ["emotional_or_frustration_response"]),
    agent_retry_count: countEvents(eventCountByType, ["agent_retry_scheduled"]),
    validation_failure_count: countEvents(eventCountByType, ["schema_validation_failed"]),
    followup_turn_count: followupTurnCount
  };
}
