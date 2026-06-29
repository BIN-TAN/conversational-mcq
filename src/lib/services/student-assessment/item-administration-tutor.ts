import { z } from "zod";
import {
  evaluateResponseQuality,
  type ResponseQualityResult,
  type ResponseQualityStage
} from "@/lib/services/student-assessment/response-quality";
import type { ChatNativeAssessmentState } from "@/lib/student-assessment/state-machine";

export const ITEM_ADMINISTRATION_TUTOR_VERSION = "item-administration-tutor-v1";

export const ItemAdministrationTutorMessageClassificationSchema = z.enum([
  "usable_reasoning",
  "weak_but_usable_reasoning",
  "insufficient_knowledge",
  "procedural_question",
  "content_question",
  "answer_request",
  "edit_request",
  "affective_expression",
  "incomplete",
  "off_topic",
  "gibberish",
  "continuation"
]);
export type ItemAdministrationTutorMessageClassification = z.infer<
  typeof ItemAdministrationTutorMessageClassificationSchema
>;

export const ItemAdministrationTutorResponseQualitySchema = z.enum([
  "adequate",
  "weak_but_usable",
  "low_information",
  "not_usable"
]);
export type ItemAdministrationTutorResponseQuality = z.infer<
  typeof ItemAdministrationTutorResponseQualitySchema
>;

export const ItemAdministrationTutorNextExpectedActionSchema = z.enum([
  "continue_current_step",
  "ask_repair",
  "answer_procedural_question",
  "defer_content_question",
  "accept_uncertainty",
  "edit_previous_response",
  "advance"
]);
export type ItemAdministrationTutorNextExpectedAction = z.infer<
  typeof ItemAdministrationTutorNextExpectedActionSchema
>;

export type ItemAdministrationTutorStatePacket = {
  assessment_state: ChatNativeAssessmentState;
  item_public_id: string;
  item_order: number;
  item_role: "initial" | "transfer";
  required_evidence_type: "reasoning" | "tempting_reason";
  selected_option?: string | null;
  latest_student_message: string;
  correctness_feedback_prohibited: boolean;
  prior_uncertainty: boolean;
};

export type ItemAdministrationTutorResult = {
  tutor_version: typeof ITEM_ADMINISTRATION_TUTOR_VERSION;
  response_quality_result: ResponseQualityResult;
  message_classification: ItemAdministrationTutorMessageClassification;
  response_quality: ItemAdministrationTutorResponseQuality;
  should_advance: boolean;
  next_expected_action: ItemAdministrationTutorNextExpectedAction;
  student_facing_message: string;
  deferred_concern_summary: string | null;
  store_deferred_concern: boolean;
  safety_validated: boolean;
};

const CONTENT_DEFER_MESSAGE =
  "I can explain that after the three-question set. For now, give your best reason, or say “I don’t know the reason yet.”";
const PROCEDURAL_MESSAGE =
  "You can write one sentence. Try to explain what led you to your choice, or say “I don’t know the reason yet.”";
const AFFECTIVE_MESSAGE =
  "That can feel tricky. Stay with this one step: give your best reason, or say “I don’t know the reason yet.”";
const EDIT_MESSAGE = "Use the edit option for that response, then we can continue from here.";
const INCOMPLETE_MESSAGE =
  "I need a little more to use this as your response. Try a short reason, or say “I don’t know the reason yet.”";
const OFF_TOPIC_MESSAGE = "Let’s keep this focused on the current question. What is your reason for your choice?";
const GIBBERISH_MESSAGE =
  "I could not read that as a response. Try your reason again, or say “I don’t know the reason yet.”";

const FORBIDDEN_STUDENT_TEXT = [
  /answer\s*key/i,
  /correct\s+option/i,
  /the\s+correct\s+answer\s+is/i,
  /distractor\s+rationale/i,
  /system\s+prompt/i,
  /structured\s+output/i,
  /agent\s+call/i
];

function normalize(text: string) {
  return text.trim().replace(/\s+/g, " ");
}

function lowerText(text: string) {
  return normalize(text).toLowerCase();
}

function isExplicitUnknownReason(lower: string) {
  return (
    /\bi\s*(do not|don't|dont)\s+know\s+(the\s+)?reason\b/.test(lower) ||
    /\bi\s*(do not|don't|dont)\s+know\s+why\b/.test(lower) ||
    /\bnot\s+sure\s+why\b/.test(lower) ||
    /\bi\s+cannot\s+explain\b/.test(lower) ||
    /\bi\s+can't\s+explain\b/.test(lower) ||
    /\bno\s+idea\b/.test(lower) ||
    /\bidk\b/.test(lower)
  );
}

function isAffectiveOnly(lower: string) {
  if (isExplicitUnknownReason(lower)) {
    return false;
  }

  return (
    /\bi(?:\s+am|'m)\s+(confused|lost|stuck|unsure)\b/.test(lower) ||
    /\bthis\s+is\s+(hard|confusing|stressful)\b/.test(lower) ||
    /\bi\s*(do not|don't|dont)\s+know\s+what\s+to\s+write\b/.test(lower)
  );
}

function summaryForDeferredConcern(text: string, classification: ItemAdministrationTutorMessageClassification) {
  const lower = lowerText(text);

  if (/\b(theta|ability|latent trait)\b/.test(lower) && /\b(difficulty|discrimination|parameter|item)\b/.test(lower)) {
    return "Asked how theta relates to item parameters during item administration.";
  }

  if (/\b(theta|ability|latent trait)\b/.test(lower)) {
    return "Asked what theta means during item administration.";
  }

  if (/\b(difficulty|discrimination|parameter|item)\b/.test(lower)) {
    return "Asked how item parameters work during item administration.";
  }

  if (classification === "answer_request") {
    return "Asked for the answer during item administration.";
  }

  if (classification === "insufficient_knowledge" || classification === "affective_expression") {
    return "Indicated uncertainty about the reason during item administration.";
  }

  if (classification === "procedural_question") {
    return "Asked a procedural question during item administration.";
  }

  return null;
}

function safeStudentMessage(message: string) {
  return !FORBIDDEN_STUDENT_TEXT.some((pattern) => pattern.test(message));
}

function baseClassification(result: ResponseQualityResult): ItemAdministrationTutorMessageClassification {
  const output = result.output;

  if (output.response_quality === "adequate" && output.reasoning_signal === "usable") {
    return "usable_reasoning";
  }

  if (output.response_quality === "adequate" || output.reasoning_signal === "weak_but_usable") {
    return "weak_but_usable_reasoning";
  }

  if (output.response_quality === "insufficient_knowledge") {
    return "insufficient_knowledge";
  }

  if (output.response_quality === "clarification_question") {
    return "procedural_question";
  }

  if (output.response_quality === "too_short") {
    return "incomplete";
  }

  return output.response_quality;
}

function responseQualityForClassification(
  classification: ItemAdministrationTutorMessageClassification
): ItemAdministrationTutorResponseQuality {
  if (classification === "usable_reasoning") {
    return "adequate";
  }

  if (classification === "weak_but_usable_reasoning") {
    return "weak_but_usable";
  }

  if (classification === "insufficient_knowledge") {
    return "low_information";
  }

  return "not_usable";
}

function actionForClassification(
  classification: ItemAdministrationTutorMessageClassification
): ItemAdministrationTutorNextExpectedAction {
  switch (classification) {
    case "usable_reasoning":
    case "weak_but_usable_reasoning":
      return "advance";
    case "insufficient_knowledge":
      return "accept_uncertainty";
    case "procedural_question":
      return "answer_procedural_question";
    case "content_question":
    case "answer_request":
      return "defer_content_question";
    case "edit_request":
      return "edit_previous_response";
    default:
      return "ask_repair";
  }
}

function messageForClassification(
  classification: ItemAdministrationTutorMessageClassification,
  result: ResponseQualityResult
) {
  switch (classification) {
    case "procedural_question":
      return PROCEDURAL_MESSAGE;
    case "content_question":
    case "answer_request":
      return CONTENT_DEFER_MESSAGE;
    case "edit_request":
      return EDIT_MESSAGE;
    case "affective_expression":
      return AFFECTIVE_MESSAGE;
    case "off_topic":
      return OFF_TOPIC_MESSAGE;
    case "gibberish":
      return GIBBERISH_MESSAGE;
    case "incomplete":
    case "continuation":
      return INCOMPLETE_MESSAGE;
    default:
      return result.output.student_facing_message;
  }
}

export function buildItemAdministrationTutorStatePacket(input: ItemAdministrationTutorStatePacket) {
  return {
    tutor_version: ITEM_ADMINISTRATION_TUTOR_VERSION,
    assessment_state: input.assessment_state,
    item_public_id: input.item_public_id,
    item_order: input.item_order,
    item_role: input.item_role,
    required_evidence_type: input.required_evidence_type,
    selected_option: input.selected_option ?? null,
    latest_student_message_length: input.latest_student_message.trim().length,
    correctness_feedback_prohibited: input.correctness_feedback_prohibited,
    prior_uncertainty: input.prior_uncertainty
  };
}

export async function runItemAdministrationTutor(input: {
  state_packet: ItemAdministrationTutorStatePacket;
  stage: ResponseQualityStage;
  text: string;
  item_stem: string;
}) {
  const qualityResult = await evaluateResponseQuality({
    stage: input.stage,
    text: input.text,
    selected_option: input.state_packet.selected_option,
    item_public_id: input.state_packet.item_public_id,
    item_stem: input.item_stem
  });
  const lower = lowerText(input.text);
  const base = baseClassification(qualityResult);
  const classification: ItemAdministrationTutorMessageClassification = isAffectiveOnly(lower)
    ? "affective_expression"
    : base;
  const responseQuality = responseQualityForClassification(classification);
  const nextAction = actionForClassification(classification);
  const shouldAdvance =
    nextAction === "advance" || nextAction === "accept_uncertainty";
  const studentFacingMessage = messageForClassification(classification, qualityResult);
  const deferredConcernSummary = summaryForDeferredConcern(input.text, classification);
  const result: ItemAdministrationTutorResult = {
    tutor_version: ITEM_ADMINISTRATION_TUTOR_VERSION,
    response_quality_result: qualityResult,
    message_classification: classification,
    response_quality: responseQuality,
    should_advance: shouldAdvance,
    next_expected_action: nextAction,
    student_facing_message: safeStudentMessage(studentFacingMessage)
      ? studentFacingMessage
      : INCOMPLETE_MESSAGE,
    deferred_concern_summary: deferredConcernSummary,
    store_deferred_concern: Boolean(deferredConcernSummary),
    safety_validated: safeStudentMessage(studentFacingMessage)
  };

  return result;
}
