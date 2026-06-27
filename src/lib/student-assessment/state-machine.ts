import { z } from "zod";

export const ChatNativeAssessmentStateSchema = z.enum([
  "SESSION_START",
  "ITEM_PRESENTED",
  "AWAIT_ANSWER",
  "AWAIT_REASON",
  "AWAIT_CONFIDENCE",
  "AWAIT_TEMPTING_OPTION",
  "AWAIT_TEMPTING_REASON",
  "ITEM_COMPLETE",
  "PACKAGE_REVIEW",
  "PACKAGE_ANALYSIS",
  "FORMATIVE_ACTIVITY",
  "FOLLOWUP_RESPONSE",
  "TARGETED_FEEDBACK",
  "REVISION",
  "NEXT_CHOICE",
  "TRANSFER_ITEM",
  "SESSION_COMPLETE"
]);

export type ChatNativeAssessmentState = z.infer<typeof ChatNativeAssessmentStateSchema>;

export const ChatNativeAssessmentActionSchema = z.enum([
  "begin_concept_unit",
  "present_item",
  "record_answer",
  "record_reasoning",
  "record_confidence",
  "record_tempting_option",
  "record_tempting_reason",
  "complete_item",
  "submit_package",
  "complete_package_analysis",
  "show_formative_activity",
  "submit_followup_response",
  "show_targeted_feedback",
  "submit_revision",
  "select_next_choice",
  "present_transfer_item",
  "complete_session"
]);

export type ChatNativeAssessmentAction = z.infer<typeof ChatNativeAssessmentActionSchema>;

const allowedActionsByState: Record<ChatNativeAssessmentState, ChatNativeAssessmentAction[]> = {
  SESSION_START: ["begin_concept_unit"],
  ITEM_PRESENTED: ["present_item"],
  AWAIT_ANSWER: ["record_answer"],
  AWAIT_REASON: ["record_reasoning"],
  AWAIT_CONFIDENCE: ["record_confidence"],
  AWAIT_TEMPTING_OPTION: ["record_tempting_option"],
  AWAIT_TEMPTING_REASON: ["record_tempting_reason"],
  ITEM_COMPLETE: ["complete_item"],
  PACKAGE_REVIEW: ["submit_package"],
  PACKAGE_ANALYSIS: ["complete_package_analysis"],
  FORMATIVE_ACTIVITY: ["show_formative_activity"],
  FOLLOWUP_RESPONSE: ["submit_followup_response"],
  TARGETED_FEEDBACK: ["show_targeted_feedback"],
  REVISION: ["submit_revision"],
  NEXT_CHOICE: ["select_next_choice"],
  TRANSFER_ITEM: ["present_transfer_item"],
  SESSION_COMPLETE: []
};

export function allowedChatNativeActions(
  state: ChatNativeAssessmentState
): ChatNativeAssessmentAction[] {
  return [...allowedActionsByState[state]];
}

export function canApplyChatNativeAction(input: {
  state: ChatNativeAssessmentState;
  action: ChatNativeAssessmentAction;
}) {
  return allowedActionsByState[input.state].includes(input.action);
}

export function assertChatNativeActionAllowed(input: {
  state: ChatNativeAssessmentState;
  action: ChatNativeAssessmentAction;
}) {
  if (!canApplyChatNativeAction(input)) {
    return {
      ok: false as const,
      allowed_actions: allowedChatNativeActions(input.state)
    };
  }

  return { ok: true as const };
}
