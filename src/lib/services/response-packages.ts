import { z } from "zod";
import { prisma } from "../db";
import { ResponsePackageTypeSchema } from "../domain/enums";
import { toPrismaJson } from "./json";
import { aggregateProcessEventsByConceptUnitSession } from "./process-events";

const createResponsePackageSchema = z.object({
  concept_unit_session_db_id: z.string().uuid(),
  package_type: ResponsePackageTypeSchema.default("initial_concept_unit_response_package"),
  created_at: z.coerce.date().optional()
});

export type CreateResponsePackageInput = z.input<typeof createResponsePackageSchema>;

function serializeDate(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

export async function createResponsePackage(input: CreateResponsePackageInput) {
  const parsed = createResponsePackageSchema.parse(input);
  const createdAt = parsed.created_at ?? new Date();
  const conceptUnitSession = await prisma.conceptUnitSession.findUniqueOrThrow({
    where: { id: parsed.concept_unit_session_db_id },
    include: {
      assessment_session: {
        select: {
          id: true,
          session_public_id: true,
          assessment_db_id: true,
          user_db_id: true,
          status: true,
          current_phase: true,
          assessment: {
            select: {
              assessment_public_id: true,
              title: true,
              description: true
            }
          }
        }
      },
      concept_unit: {
        select: {
          id: true,
          concept_unit_public_id: true,
          title: true,
          learning_objective: true,
          related_concept_description: true,
          administration_rules: true,
          order_index: true,
          version: true,
          items: {
            where: {
              status: "published",
              included_in_published_set: true
            },
            orderBy: [{ item_order: "asc" }, { created_at: "asc" }],
            select: {
              item_public_id: true,
              item_order: true,
              item_stem: true,
              options: true,
              version: true,
              included_in_published_set: true,
              status: true
            }
          }
        }
      },
      item_responses: {
        orderBy: { created_at: "asc" },
        include: {
          item: {
            select: {
              id: true,
              item_public_id: true,
              item_order: true,
              item_stem: true,
              version: true
            }
          }
        }
      },
      conversation_turns: {
        orderBy: { created_at: "asc" },
        select: {
          id: true,
          item_db_id: true,
          followup_round_db_id: true,
          phase: true,
          actor_type: true,
          agent_name: true,
          message_text: true,
          structured_payload: true,
          created_at: true
        }
      },
      process_events: {
        orderBy: { occurred_at: "asc" },
        select: {
          id: true,
          item_db_id: true,
          event_type: true,
          event_category: true,
          event_source: true,
          visibility_duration_ms: true,
          pause_duration_ms: true,
          payload: true,
          occurred_at: true,
          created_at: true
        }
      }
    }
  });
  const processCounts = await aggregateProcessEventsByConceptUnitSession(conceptUnitSession.id);
  const payload = {
    package_type: parsed.package_type,
    created_at: createdAt.toISOString(),
    assessment_session_db_id: conceptUnitSession.assessment_session_db_id,
    concept_unit_session_db_id: conceptUnitSession.id,
    assessment_session: {
      session_public_id: conceptUnitSession.assessment_session.session_public_id,
      status: conceptUnitSession.assessment_session.status,
      current_phase: conceptUnitSession.assessment_session.current_phase
    },
    assessment: {
      assessment_public_id:
        conceptUnitSession.assessment_session.assessment.assessment_public_id,
      title: conceptUnitSession.assessment_session.assessment.title,
      description: conceptUnitSession.assessment_session.assessment.description
    },
    concept_unit: {
      concept_unit_db_id: conceptUnitSession.concept_unit.id,
      concept_unit_public_id: conceptUnitSession.concept_unit.concept_unit_public_id,
      title: conceptUnitSession.concept_unit.title,
      learning_objective: conceptUnitSession.concept_unit.learning_objective,
      related_concept_description: conceptUnitSession.concept_unit.related_concept_description,
      administration_rules: conceptUnitSession.concept_unit.administration_rules,
      order_index: conceptUnitSession.concept_unit.order_index,
      version: conceptUnitSession.concept_unit.version,
      initial_completed_at: serializeDate(conceptUnitSession.initial_completed_at)
    },
    included_items: conceptUnitSession.concept_unit.items.map((item) => ({
      item_public_id: item.item_public_id,
      item_order: item.item_order,
      item_stem: item.item_stem,
      options: item.options,
      version: item.version,
      status: item.status,
      included_in_published_set: item.included_in_published_set
    })),
    item_responses: conceptUnitSession.item_responses.map((response) => ({
      item_response_db_id: response.id,
      item_db_id: response.item_db_id,
      item_public_id: response.item.item_public_id,
      item_order: response.item.item_order,
      selected_option: response.selected_option,
      correct_option_snapshot: response.correct_option_snapshot,
      correctness: response.correctness,
      reasoning_text: response.reasoning_text,
      confidence_rating: response.confidence_rating,
      skipped_reasoning: response.skipped_reasoning,
      skipped_confidence: response.skipped_confidence,
      skipped_item: response.skipped_item,
      revision_count: response.revision_count,
      item_response_time_ms: response.item_response_time_ms,
      item_started_at: serializeDate(response.item_started_at),
      item_submitted_at: serializeDate(response.item_submitted_at),
      item_version_snapshot: response.item_version_snapshot,
      item_snapshot: response.item_snapshot,
      client_submission_id: response.client_submission_id,
      created_at: response.created_at.toISOString(),
      updated_at: response.updated_at.toISOString()
    })),
    conversation_turns: conceptUnitSession.conversation_turns.map((turn) => ({
      conversation_turn_db_id: turn.id,
      item_db_id: turn.item_db_id,
      followup_round_db_id: turn.followup_round_db_id,
      phase: turn.phase,
      actor_type: turn.actor_type,
      agent_name: turn.agent_name,
      message_text: turn.message_text,
      structured_payload: turn.structured_payload,
      created_at: turn.created_at.toISOString()
    })),
    process_events: conceptUnitSession.process_events.map((event) => ({
      process_event_db_id: event.id,
      item_db_id: event.item_db_id,
      event_type: event.event_type,
      event_category: event.event_category,
      event_source: event.event_source,
      visibility_duration_ms: event.visibility_duration_ms,
      pause_duration_ms: event.pause_duration_ms,
      payload: event.payload,
      occurred_at: event.occurred_at.toISOString(),
      created_at: event.created_at.toISOString()
    })),
    process_counts: processCounts
  };

  return prisma.responsePackage.create({
    data: {
      concept_unit_session_db_id: conceptUnitSession.id,
      package_type: parsed.package_type,
      payload: toPrismaJson(payload) ?? {}
    }
  });
}
