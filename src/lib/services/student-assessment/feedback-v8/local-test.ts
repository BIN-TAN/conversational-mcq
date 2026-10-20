import { FEEDBACK_V8_CONTRACT_VERSION, type FeedbackV8Input, type FeedbackV8Output } from "./contract";

/**
 * Deterministic stand-in used only with the mock provider (local development and tests).
 * It follows the focus priority mechanically, makes no claims about the student, and says
 * plainly that it is a test message.
 */
export function buildLocalTestFeedbackV8(context: FeedbackV8Input): FeedbackV8Output {
  if (context.mode === "opening") {
    const question = context.saved_questions[0];
    const misconception = context.possible_misconceptions[0];
    const item = context.items.find((entry) => entry.interpretation && entry.interpretation.item_status !== "supported");
    const focus = question
      ? { item_numbers: question.item_number ? [question.item_number] : [], focus_type: "student_question" as const, concept: "A question saved during the mini-test" }
      : misconception
        ? { item_numbers: misconception.item_numbers, focus_type: "possible_misconception" as const, concept: misconception.idea.slice(0, 200) }
        : item
          ? { item_numbers: [item.item_number], focus_type: "single_item" as const, concept: `Question ${item.item_number}` }
          : { item_numbers: [], focus_type: "extension" as const, concept: context.topic.title || "The topic" };
    return {
      contract_version: FEEDBACK_V8_CONTRACT_VERSION,
      student_visible_message:
        "This is a test message from the local setup. You can see the answer review above. " +
        "If you would like to talk through any question, ask here. You can also finish now.",
      focus,
      strategy: question ? "answer_request" : "invite_explanation",
      student_evidence: [],
      focus_status: null,
      instructor_review: { flag: "none", reason: null }
    };
  }
  return {
    contract_version: FEEDBACK_V8_CONTRACT_VERSION,
    student_visible_message:
      "This is a test reply from the local setup. Thank you for your message. " +
      "You can ask about another question, or finish whenever you are ready.",
    focus: { item_numbers: [], focus_type: "closing", concept: "Local test reply" },
    strategy: "clarify",
    student_evidence: [],
    focus_status: "not_discussed_further",
    instructor_review: { flag: "none", reason: null }
  };
}
