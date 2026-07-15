import { z } from "zod";
import { prisma } from "../db";
import { ResponsePackageTypeSchema } from "../domain/enums";
import { teacherDiagnosticContextForProvider } from "./content/teacher-diagnostic-context";
import {
  llmMediaContextForAssets,
  serializeItemMediaAsset
} from "./content/item-media";
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

function jsonRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function boolValue(record: Record<string, unknown>, key: string): boolean {
  return record[key] === true;
}

function stringArrayValue(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.replace(/\s+/g, " ").trim())
    .filter((entry) => entry.length > 0 && !/^correct answer\.?$/i.test(entry));
}

function optionText(options: unknown, label: string | null): string | null {
  if (!label || !Array.isArray(options)) {
    return null;
  }

  for (const option of options) {
    const record = jsonRecord(option);
    if (stringValue(record, "label")?.toUpperCase() === label.toUpperCase()) {
      return stringValue(record, "text");
    }
  }

  return null;
}

function conciseStudentAnswerExplanation(input: {
  options: unknown;
  correct_option: string;
  expected_reasoning_patterns: unknown;
}) {
  const patterns = stringArrayValue(input.expected_reasoning_patterns).slice(0, 2);

  if (patterns.length > 0) {
    return patterns.join(" ");
  }

  const correctText = optionText(input.options, input.correct_option);
  if (correctText) {
    return `Option ${input.correct_option} fits the item because it states the relevant measurement relationship: ${correctText}`;
  }

  return `Option ${input.correct_option} best matches the measurement relationship described in this item.`;
}

function itemMetadataFromRules(value: unknown) {
  const rules = jsonRecord(value);

  return {
    item_set_name: stringValue(rules, "item_set_name"),
    domain: stringValue(rules, "domain"),
    item_role: stringValue(rules, "item_role"),
    cognitive_demand: stringValue(rules, "cognitive_demand"),
    difficulty: stringValue(rules, "difficulty"),
    knowledge_component: stringValue(rules, "knowledge_component"),
    misconception_cluster: stringValue(rules, "misconception_cluster")
  };
}

function normalizeTemptingPayload(value: unknown) {
  const payload = jsonRecord(value);

  if (payload.source !== "initial_tempting_option") {
    return null;
  }

  const noTemptingOption = boolValue(payload, "no_tempting_option");
  const temptingOption = stringValue(payload, "tempting_option");
  const temptingOptionReason = stringValue(payload, "tempting_option_reason");

  if (!noTemptingOption && !temptingOption) {
    return null;
  }

  return {
    no_tempting_option: noTemptingOption,
    tempting_option: noTemptingOption ? null : temptingOption,
    tempting_option_reason: noTemptingOption ? null : temptingOptionReason
  };
}

function elapsedMs(from: Date | null | undefined, to: Date | null | undefined): number | null {
  if (!from || !to) {
    return null;
  }

  return Math.max(0, to.getTime() - from.getTime());
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
              description: true,
              diagnostic_focus: true
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
              distractor_rationales: true,
              expected_reasoning_patterns: true,
              possible_misconception_indicators: true,
              administration_rules: true,
              version: true,
              media_assets: {
                where: { active: true },
                orderBy: [{ order_index: "asc" }, { created_at: "asc" }]
              },
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
              options: true,
              distractor_rationales: true,
              expected_reasoning_patterns: true,
              possible_misconception_indicators: true,
              administration_rules: true,
              version: true,
              media_assets: {
                where: { active: true },
                orderBy: [{ order_index: "asc" }, { created_at: "asc" }]
              }
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
  const initialItemIds = conceptUnitSession.concept_unit.items.map((item) => item.item_public_id);
  const initialItemPositionByPublicId = new Map(
    initialItemIds.map((itemPublicId, index) => [itemPublicId, index + 1])
  );
  const initialItemCount = conceptUnitSession.concept_unit.items.length;
  const completedInitialItemCount = conceptUnitSession.item_responses.filter((response) =>
    Boolean(response.item_submitted_at && initialItemPositionByPublicId.has(response.item.item_public_id))
  ).length;
  const payload = {
    package_type: parsed.package_type,
    created_at: createdAt.toISOString(),
    initial_item_count: initialItemCount,
    completed_initial_item_count: completedInitialItemCount,
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
      description: conceptUnitSession.assessment_session.assessment.description,
      diagnostic_focus: conceptUnitSession.assessment_session.assessment.diagnostic_focus
    },
    concept_unit: {
      concept_unit_db_id: conceptUnitSession.concept_unit.id,
      concept_unit_public_id: conceptUnitSession.concept_unit.concept_unit_public_id,
      title: conceptUnitSession.concept_unit.title,
      learning_objective: conceptUnitSession.concept_unit.learning_objective,
      related_concept_description: conceptUnitSession.concept_unit.related_concept_description,
      administration_rules: conceptUnitSession.concept_unit.administration_rules,
      teacher_diagnostic_context: teacherDiagnosticContextForProvider({
        administration_rules: conceptUnitSession.concept_unit.administration_rules,
        assessment_diagnostic_focus:
          conceptUnitSession.assessment_session.assessment.diagnostic_focus
      }),
      order_index: conceptUnitSession.concept_unit.order_index,
      version: conceptUnitSession.concept_unit.version,
      initial_completed_at: serializeDate(conceptUnitSession.initial_completed_at)
    },
    included_items: conceptUnitSession.concept_unit.items.map((item) => ({
      item_public_id: item.item_public_id,
      item_order: item.item_order,
      initial_item_position: initialItemPositionByPublicId.get(item.item_public_id) ?? null,
      initial_item_count: initialItemCount,
      item_stem: item.item_stem,
      options: item.options,
      version: item.version,
      status: item.status,
      included_in_published_set: item.included_in_published_set,
      media_assets: item.media_assets.map(serializeItemMediaAsset),
      llm_media_context: llmMediaContextForAssets(item.media_assets),
      ...itemMetadataFromRules(item.administration_rules),
      teacher_diagnostic_context: teacherDiagnosticContextForProvider({
        administration_rules: item.administration_rules,
        assessment_diagnostic_focus:
          conceptUnitSession.assessment_session.assessment.diagnostic_focus,
        distractor_rationales: item.distractor_rationales,
        expected_reasoning_patterns: item.expected_reasoning_patterns,
        possible_misconception_indicators: item.possible_misconception_indicators
      })
    })),
    item_responses: conceptUnitSession.item_responses.map((response) => {
      const itemTurns = conceptUnitSession.conversation_turns.filter(
        (turn) => turn.item_db_id === response.item_db_id && turn.actor_type === "student"
      );
      const selectedTurns = itemTurns.filter((turn) => {
        const structuredPayload = jsonRecord(turn.structured_payload);
        return typeof structuredPayload.selected_option === "string";
      });
      const confidenceTurns = itemTurns.filter((turn) => {
        const structuredPayload = jsonRecord(turn.structured_payload);
        return typeof structuredPayload.confidence_rating === "string";
      });
      const reasoningTurns = itemTurns.filter((turn) => {
        const structuredPayload = jsonRecord(turn.structured_payload);
        return (
          Boolean(turn.message_text) &&
          structuredPayload.source !== "initial_tempting_option" &&
          typeof structuredPayload.selected_option !== "string" &&
          typeof structuredPayload.confidence_rating !== "string"
        );
      });
      const temptingTurns = itemTurns
        .map((turn) => ({
          turn,
          evidence: normalizeTemptingPayload(turn.structured_payload)
        }))
        .filter((entry): entry is { turn: typeof itemTurns[number]; evidence: NonNullable<ReturnType<typeof normalizeTemptingPayload>> } =>
          Boolean(entry.evidence)
        );
      const latestTemptingEvidence = temptingTurns.at(-1)?.evidence ?? null;
      const selectedAnswerInitial = stringValue(
        jsonRecord(selectedTurns[0]?.structured_payload),
        "selected_option"
      );
      const confidenceInitial = stringValue(
        jsonRecord(confidenceTurns[0]?.structured_payload),
        "confidence_rating"
      );
      const answerSelectedAt = selectedTurns[0]?.created_at ?? null;
      const reasoningSubmittedAt = reasoningTurns.at(-1)?.created_at ?? null;
      const confidenceSelectedAt = confidenceTurns[0]?.created_at ?? null;
      const temptingOptionSubmittedAt = temptingTurns[0]?.turn.created_at ?? null;
      const temptingOptionReasonSubmittedAt =
        temptingTurns.find((entry) => Boolean(entry.evidence.tempting_option_reason))?.turn.created_at ?? null;
      const metadata = itemMetadataFromRules(response.item.administration_rules);
      const teacherDiagnosticContext = teacherDiagnosticContextForProvider({
        administration_rules: response.item.administration_rules,
        assessment_diagnostic_focus:
          conceptUnitSession.assessment_session.assessment.diagnostic_focus,
        distractor_rationales: response.item.distractor_rationales,
        expected_reasoning_patterns: response.item.expected_reasoning_patterns,
        possible_misconception_indicators: response.item.possible_misconception_indicators
      });
      const answerChanged =
        selectedTurns.length > 1 ||
        Boolean(selectedAnswerInitial && response.selected_option && selectedAnswerInitial !== response.selected_option);

      return {
        item_response_db_id: response.id,
        item_db_id: response.item_db_id,
        item_public_id: response.item.item_public_id,
        item_order: response.item.item_order,
        initial_item_position: initialItemPositionByPublicId.get(response.item.item_public_id) ?? null,
        initial_item_count: initialItemCount,
        item_role: metadata.item_role,
        cognitive_demand: metadata.cognitive_demand,
        difficulty: metadata.difficulty,
        knowledge_component: metadata.knowledge_component,
        misconception_cluster: metadata.misconception_cluster,
        media_assets: response.item.media_assets.map(serializeItemMediaAsset),
        llm_media_context: llmMediaContextForAssets(response.item.media_assets),
        teacher_diagnostic_context: teacherDiagnosticContext,
        selected_option: response.selected_option,
        selected_answer_initial: selectedAnswerInitial,
        selected_answer_final: response.selected_option,
        answer_changed: answerChanged,
        correct_option_snapshot: response.correct_option_snapshot,
        correctness: response.correctness,
        reasoning_text: response.reasoning_text,
        reasoning_text_initial: reasoningTurns[0]?.message_text ?? null,
        reasoning_text_final: response.reasoning_text,
        confidence_rating: response.confidence_rating,
        confidence_initial: confidenceInitial,
        confidence_final: response.confidence_rating,
        no_tempting_option: latestTemptingEvidence?.no_tempting_option ?? null,
        tempting_option: latestTemptingEvidence?.tempting_option ?? null,
        tempting_option_reason: latestTemptingEvidence?.tempting_option_reason ?? null,
        answer_explanation_revealed: response.answer_explanation_revealed,
        revealed_at: serializeDate(response.revealed_at),
        reveal_trigger: response.reveal_trigger,
        explanation_version: response.explanation_version,
        student_display_acknowledged_at: serializeDate(response.student_display_acknowledged_at),
        student_safe_answer_explanation: conciseStudentAnswerExplanation({
          options: response.item.options,
          correct_option: response.correct_option_snapshot,
          expected_reasoning_patterns: response.item.expected_reasoning_patterns
        }),
        student_safe_distractor_boundary: null,
        skipped_reasoning: response.skipped_reasoning,
        skipped_confidence: response.skipped_confidence,
        skipped_item: response.skipped_item,
        revision_count: response.revision_count,
        item_response_time_ms: response.item_response_time_ms,
        response_time_answer_ms: elapsedMs(response.item_started_at, answerSelectedAt),
        response_time_reasoning_ms: elapsedMs(answerSelectedAt, reasoningSubmittedAt),
        response_time_confidence_ms: elapsedMs(reasoningSubmittedAt, confidenceSelectedAt),
        total_item_time_ms: response.item_response_time_ms,
        item_started_at: serializeDate(response.item_started_at),
        answer_selected_at: serializeDate(answerSelectedAt),
        reasoning_started_at: null,
        reasoning_submitted_at: serializeDate(reasoningSubmittedAt),
        confidence_selected_at: serializeDate(confidenceSelectedAt),
        tempting_option_submitted_at: serializeDate(temptingOptionSubmittedAt),
        tempting_option_reason_submitted_at: serializeDate(temptingOptionReasonSubmittedAt),
        item_completed_at: serializeDate(response.item_submitted_at),
        item_submitted_at: serializeDate(response.item_submitted_at),
        item_version_snapshot: response.item_version_snapshot,
        item_snapshot: response.item_snapshot,
        client_submission_id: response.client_submission_id,
        created_at: response.created_at.toISOString(),
        updated_at: response.updated_at.toISOString()
      };
    }),
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
    process_counts: processCounts,
    response_package_evidence: {
      initial_item_count: initialItemCount,
      completed_initial_item_count: completedInitialItemCount,
      item_response_count: conceptUnitSession.item_responses.length,
      completed_response_count: conceptUnitSession.item_responses.filter((response) =>
        Boolean(response.item_submitted_at)
      ).length,
      includes_tempting_option_evidence: conceptUnitSession.conversation_turns.some((turn) =>
        Boolean(normalizeTemptingPayload(turn.structured_payload))
      ),
      includes_fixed_item_metadata: conceptUnitSession.concept_unit.items.some((item) =>
        Boolean(itemMetadataFromRules(item.administration_rules).item_role)
      ),
      includes_timing_evidence: conceptUnitSession.item_responses.some((response) =>
        Boolean(response.item_started_at || response.item_response_time_ms)
      )
    },
    logging_limitations: {
      reasoning_started_at:
        "not_captured_reliably_without_additional_frontend_focus_or_typing_telemetry"
    }
  };

  return prisma.responsePackage.create({
    data: {
      concept_unit_session_db_id: conceptUnitSession.id,
      package_type: parsed.package_type,
      payload: toPrismaJson(payload) ?? {}
    }
  });
}
