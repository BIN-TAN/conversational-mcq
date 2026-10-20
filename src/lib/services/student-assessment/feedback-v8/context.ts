import { prisma } from "@/lib/db";
import { InterpretationOutputV8Schema } from "@/lib/services/student-assessment/interpretation-v8/contract";
import { buildInterpretationInputV8FromPackage } from "@/lib/services/student-assessment/interpretation-v8/input-builder";
import { readStoredInterpretationV8 } from "@/lib/services/student-assessment/interpretation-v8/profile";
import { formativeConversationTurnLimit } from "@/lib/services/student-assessment/formative-conversation/lifecycle-contract-v18r2";
import {
  FEEDBACK_V8_CONTEXT_VERSION,
  FEEDBACK_V8_CONTRACT_VERSION,
  type FeedbackV8Input,
  type FeedbackV8Item
} from "./contract";

/**
 * Builds the feedback v8 input for one conversation from stored records: the sealed
 * response package (item specifications and the student's responses), the v8 profile
 * (item ratings, possible misconceptions, considered ideas, answer patterns), the process
 * interpretations from the validated profiling call, questions the student saved during
 * the mini-test, and the conversation so far. Raw process logs and identities are not
 * included.
 */
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

export class FeedbackV8ContextError extends Error {
  constructor(public readonly code: "conversation_not_found" | "profile_not_v8" | "response_package_missing") {
    super(code);
    this.name = "FeedbackV8ContextError";
  }
}

const SAVED_QUESTION_CLASSES = new Set(["content_question", "answer_request"]);

export async function compileFeedbackV8Context(input: { conversation_public_id: string }): Promise<{ context: FeedbackV8Input }> {
  const conversation = await prisma.formativeConversationSession.findUnique({
    where: { conversation_public_id: input.conversation_public_id },
    select: {
      status: true,
      concept_unit_session_db_id: true,
      initial_student_profile: {
        select: {
          item_level_evidence: true,
          based_on_agent_call: { select: { output_payload: true, output_validated: true, call_status: true } }
        }
      },
      conversation_turns: {
        orderBy: { sequence_index: "asc" },
        select: { sequence_index: true, actor_type: true, message_text: true, structured_payload: true }
      }
    }
  });
  if (!conversation) throw new FeedbackV8ContextError("conversation_not_found");
  const stored = readStoredInterpretationV8(conversation.initial_student_profile?.item_level_evidence);
  if (!stored) throw new FeedbackV8ContextError("profile_not_v8");
  const responsePackage = await prisma.responsePackage.findUnique({
    where: { id: stored.response_package_id },
    select: { payload: true }
  });
  if (!responsePackage) throw new FeedbackV8ContextError("response_package_missing");
  const built = buildInterpretationInputV8FromPackage(responsePackage.payload, new Map());

  const call = conversation.initial_student_profile?.based_on_agent_call;
  const parsedProfiling = call?.output_validated && call.call_status === "succeeded"
    ? InterpretationOutputV8Schema.safeParse(call.output_payload)
    : null;
  const processById = new Map(
    (parsedProfiling?.success ? parsedProfiling.data.items : []).map((entry) => [entry.item_id, entry.process_interpretation])
  );
  const storedById = new Map(stored.items.map((entry) => [entry.item_id, entry]));
  const numberById = new Map(built.items.map((item, index) => [item.item_id, index + 1]));
  const numbers = (ids: string[]) => ids.map((id) => numberById.get(id)).filter((value): value is number => typeof value === "number");
  const fallback = stored.generation_mode === "fallback";

  const items: FeedbackV8Item[] = built.items.map((item, index) => {
    const rating = storedById.get(item.item_id);
    const processEntry = processById.get(item.item_id) ?? null;
    return {
      item_number: index + 1,
      item_id: item.item_id,
      stem: item.stem,
      options: item.options,
      correct_option: item.correct_option,
      instructor_explanation: item.target_reasoning,
      essential_elements: item.essential_elements,
      distractor_rationales: item.references
        .filter((reference) => reference.kind === "distractor_rationale" && reference.option_label)
        .map((reference) => ({ option_label: reference.option_label!, rationale: reference.text })),
      student_response: {
        selected_option: item.response.selected_option,
        answer_correct: item.response.answer_correct,
        reported_confidence: item.response.reported_confidence,
        explanation: item.response.explanation,
        tempting_option: item.response.tempting_option,
        tempting_option_reason: item.response.tempting_option_reason
      },
      interpretation: !fallback && rating?.explanation_quality
        ? {
            explanation_quality: rating.explanation_quality,
            adds_beyond_option_text: rating.adds_beyond_option_text,
            evidence_quote: rating.evidence_quote,
            missing_elements: rating.missing_elements,
            rationale: rating.rationale,
            error_source: rating.error_source,
            uncertainty_note: rating.uncertainty_note,
            item_status: rating.status,
            possible_item_issue: rating.item_review_flag
          }
        : null,
      process_interpretation: processEntry
        ? { type: processEntry.type, note: processEntry.note, alternatives: processEntry.alternatives }
        : null
    };
  });

  const itemTurns = await prisma.conversationTurn.findMany({
    where: {
      concept_unit_session_db_id: conversation.concept_unit_session_db_id,
      formative_conversation_session_db_id: null,
      actor_type: "student",
      item_db_id: { not: null }
    },
    orderBy: { sequence_index: "asc" },
    select: { message_text: true, structured_payload: true, item: { select: { item_public_id: true } } }
  });
  const savedQuestions = itemTurns.flatMap((turn) => {
    const payload = record(turn.structured_payload);
    const classification = typeof payload.message_classification === "string" ? payload.message_classification : null;
    const deferred = typeof payload.deferred_concern_summary === "string" && payload.deferred_concern_summary.trim();
    if (!turn.message_text?.trim() || !((classification && SAVED_QUESTION_CLASSES.has(classification)) || deferred)) return [];
    return [{
      item_number: turn.item ? numberById.get(turn.item.item_public_id) ?? null : null,
      question: turn.message_text.trim().slice(0, 600)
    }];
  });

  const turns = conversation.conversation_turns
    .filter((turn) => (turn.actor_type === "student" || turn.actor_type === "agent") && turn.message_text?.trim())
    .map((turn) => ({
      sequence_index: turn.sequence_index,
      actor: turn.actor_type === "student" ? ("student" as const) : ("tutor" as const),
      text: turn.message_text!.trim(),
      opening: record(turn.structured_payload).message_type === "formative_conversation_opening"
    }));
  const openingTurn = turns.find((turn) => turn.opening) ?? null;
  const last = turns.at(-1) ?? null;
  const latest = last && last.actor === "student" ? last : null;
  const visible = turns
    .filter((turn) => turn !== openingTurn && turn !== latest)
    .map(({ sequence_index, actor, text }) => ({ sequence_index, actor, text }));
  const studentTurns = turns.filter((turn) => turn.actor === "student").length;
  const maxTurns = formativeConversationTurnLimit({
    status: conversation.status,
    conversation_turns: conversation.conversation_turns
  });

  return {
    context: {
      contract_version: FEEDBACK_V8_CONTRACT_VERSION,
      context_version: FEEDBACK_V8_CONTEXT_VERSION,
      mode: turns.length === 0 ? "opening" : "reply",
      topic: {
        title: built.topic.title,
        learning_objective: built.topic.learning_objective,
        description: built.topic.description
      },
      profile_available: !fallback,
      items,
      possible_misconceptions: fallback ? [] : stored.possible_misconceptions.map((entry) => ({
        item_numbers: numbers(entry.item_ids),
        idea: entry.idea,
        student_quote: entry.student_quote,
        endorsement: entry.endorsement
      })),
      considered_ideas: fallback ? [] : stored.considered_ideas.map((entry) => ({
        item_number: numberById.get(entry.item_id) ?? 0,
        idea: entry.idea,
        student_quote: entry.student_quote
      })),
      answer_patterns: stored.answer_patterns.map((pattern) => ({
        shared_idea: pattern.misconception_tag,
        item_numbers: numbers(pattern.item_ids)
      })),
      saved_questions: savedQuestions,
      opening_message: openingTurn?.text ?? null,
      visible_transcript: visible,
      latest_student_message: latest ? { sequence_index: latest.sequence_index, text: latest.text } : null,
      lifecycle: {
        student_turns_used: studentTurns,
        max_student_turns: maxTurns,
        final_allowed_turn: studentTurns === maxTurns,
        another_student_turn_available: studentTurns < maxTurns
      }
    }
  };
}

/** True when the conversation's mini-test profile came from interpretation v8. */
export async function conversationUsesFeedbackV8(where: { conversation_public_id: string } | { concept_unit_session_db_id: string }) {
  const conversation = await prisma.formativeConversationSession.findUnique({
    where,
    select: { initial_student_profile: { select: { item_level_evidence: true } } }
  });
  return Boolean(readStoredInterpretationV8(conversation?.initial_student_profile?.item_level_evidence));
}
