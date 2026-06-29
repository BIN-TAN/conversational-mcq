import type {
  MissingEvidenceField,
  StudentConversationFrame,
  StudentSessionState
} from "./types";
import { StudentConversationFrameSchema } from "./types";
import {
  buildInitialAdminPrompt,
  studentIndicatedReasoningUncertainty
} from "@/lib/student-assessment/initial-admin-prompts";

function awaitingAnalysisMessage(phase: string) {
  if (phase === "profiling_completed") {
    return "Thanks. I’m using your responses to prepare the next step.";
  }

  if (phase === "planning_pending") {
    return "Preparing follow-up. Your responses are recorded.";
  }

  if (phase === "planning_completed") {
    return "The next follow-up is almost ready.";
  }

  return "Thanks. I’m using your responses to prepare the next step.";
}

function automaticWorkflowMessage(nextStep: StudentSessionState["next_step"]) {
  if (nextStep === "automatic_profiling_pending") {
    return "Thanks. I’m using your responses to prepare the next step.";
  }

  if (nextStep === "automatic_planning_pending") {
    return "Preparing follow-up. Your responses are recorded.";
  }

  if (nextStep === "automatic_followup_opening_pending") {
    return "Preparing follow-up. This usually takes a short moment.";
  }

  return "I’m having trouble preparing the next step. Your responses are recorded, and you can return later.";
}

function fieldLabel(field: MissingEvidenceField) {
  if (field === "answer") {
    return "answer choice";
  }

  if (field === "reasoning") {
    return "reasoning";
  }

  return "confidence";
}

function missingFieldList(fields: MissingEvidenceField[]) {
  if (fields.length === 0) {
    return "the missing information";
  }

  return fields.map(fieldLabel).join(", ");
}

export function buildStudentConversationFrame(state: StudentSessionState): StudentConversationFrame {
  const conceptTitle = state.current_concept_unit?.title ?? "this topic";
  const base = {
    current_item: state.current_item,
    missing_fields: state.missing_evidence,
    can_review_responses: Boolean(state.current_concept_unit),
    can_exit: state.can_exit,
    can_continue: true
  };
  const selectedOption = state.current_item?.existing_selected_option ?? null;
  const reasoningText = state.current_item?.existing_reasoning_text ?? null;
  const itemPublicId = state.current_item?.item_public_id ?? null;
  const itemOrder = state.current_item?.item_order ?? null;
  const itemRole = state.assessment_state === "TRANSFER_ITEM" || state.next_step === "transfer_item"
    ? "transfer"
    : "initial";
  const frame: StudentConversationFrame =
    state.next_step === "session_completed"
      ? {
          ...base,
          assistant_message: "Your assessment is complete. Your responses and conversation have been recorded.",
          interaction_type: "session_completed",
          allowed_actions: ["review_responses"],
          can_review_responses: true,
          can_continue: false,
          can_exit: false
        }
      : state.next_step === "followup_active"
      ? {
          ...base,
          assistant_message:
            state.progression?.neutral_message ??
            "Let’s do a short follow-up about your reasoning. Try to explain your thinking in your own words.",
          interaction_type: "followup_active",
          allowed_actions: [
            "send_followup_message",
            "request_progression",
            "save_exit",
            "stop_followup"
          ],
          can_review_responses: true
        }
      : state.next_step === "followup_updating"
        ? {
            ...base,
            assistant_message:
              "I’m reviewing your latest response so the next step can be better matched to your current understanding. Your progress is recorded.",
            interaction_type: "followup_updating",
            allowed_actions: ["review_responses", "save_exit", "stop_followup"],
            can_review_responses: true,
            can_continue: false
          }
      : state.next_step === "followup_stopped"
        ? {
            ...base,
            assistant_message:
              state.assessment_state === "NEXT_CHOICE"
                ? "Choose one:\nA. Move to the next concept.\nB. Try another question on the same idea."
                : "This follow-up round has been stopped. Your conversation is recorded.",
            interaction_type:
              state.assessment_state === "NEXT_CHOICE"
                ? "progression_decision"
                : "followup_stopped",
            allowed_actions:
              state.assessment_state === "NEXT_CHOICE"
                ? ["select_next_choice"]
                : ["review_responses"],
            can_review_responses: true,
            can_continue: state.assessment_state === "NEXT_CHOICE"
          }
        : [
              "automatic_profiling_pending",
              "automatic_planning_pending",
              "automatic_followup_opening_pending",
              "automatic_workflow_failed"
            ].includes(state.next_step)
          ? {
              ...base,
              assistant_message: automaticWorkflowMessage(state.next_step),
              interaction_type:
                state.next_step === "automatic_workflow_failed"
                  ? "automatic_failed"
                  : "automatic_processing",
              allowed_actions: ["review_responses", "save_exit"],
              can_continue: false
            }
      : state.next_step === "formative_activity"
        ? {
            ...base,
            assistant_message: "Respond to the activity in the chat.",
            interaction_type: "formative_activity",
            allowed_actions: ["send_formative_activity_response", "save_exit"],
            can_review_responses: true
          }
      : state.next_step === "formative_response_saved"
        ? {
            ...base,
            assistant_message:
              "Thanks. Your response has been recorded. Targeted feedback is not available yet in this prototype.",
            interaction_type: "formative_response_saved",
            allowed_actions: ["review_responses", "save_exit"],
            can_review_responses: true,
            can_continue: false
          }
      : state.next_step === "revision_requested"
        ? {
            ...base,
            assistant_message: "Write your revision in the chat.",
            interaction_type: "revision_requested",
            allowed_actions: ["send_revision_response", "save_exit"],
            can_review_responses: true
          }
      : state.next_step === "transfer_item" || state.assessment_state === "TRANSFER_ITEM"
        ? {
            ...base,
            assistant_message: "Try this additional question using the same answer, reason, confidence, and tempting-option steps.",
            interaction_type: "transfer_item",
            allowed_actions: ["select_option", "save_exit"],
            can_review_responses: true
          }
      : state.assessment_state === "NEXT_CHOICE"
        ? {
            ...base,
            assistant_message:
              "Choose one:\nA. Move to the next concept.\nB. Try another question on the same idea.",
            interaction_type: "progression_decision",
            allowed_actions: ["select_next_choice"],
            can_review_responses: true
          }
      : state.next_step === "concept_unit_intro"
      ? {
          ...base,
          assistant_message:
            "Let’s start with a few short questions. Answer using your current thinking. I won’t give hints or explanations during this first part.",
          interaction_type: "concept_unit_intro",
          allowed_actions: ["begin_concept_unit"]
        }
      : state.next_step === "present_item"
        ? {
            ...base,
            assistant_message: buildInitialAdminPrompt({
              kind: "answer_prompt",
              assessmentState: "AWAIT_ANSWER",
              itemPublicId,
              itemOrder,
              itemRole
            }).prompt_text,
            interaction_type: "present_item",
            allowed_actions: ["select_option", "skip_item"]
          }
        : state.next_step === "request_reasoning"
          ? {
              ...base,
              assistant_message: buildInitialAdminPrompt({
                kind: "reasoning_prompt",
                assessmentState: "AWAIT_REASON",
                itemPublicId,
                itemOrder,
                itemRole,
                selectedOption
              }).prompt_text,
              interaction_type: "request_reasoning",
              allowed_actions: ["save_reasoning", "skip_reasoning"]
            }
          : state.next_step === "request_confidence"
            ? {
                ...base,
                assistant_message: buildInitialAdminPrompt({
                  kind: "confidence_prompt",
                  assessmentState: "AWAIT_CONFIDENCE",
                  itemPublicId,
                  itemOrder,
                  itemRole,
                  selectedOption,
                  latestStudentResponse: reasoningText,
                  indicatedUnknown: studentIndicatedReasoningUncertainty(reasoningText)
                }).prompt_text,
                interaction_type: "request_confidence",
                allowed_actions: ["select_confidence", "skip_confidence"]
              }
            : state.next_step === "request_tempting_option"
              ? {
                  ...base,
                  assistant_message: buildInitialAdminPrompt({
                    kind: "tempting_option_prompt",
                    assessmentState: "AWAIT_TEMPTING_OPTION",
                    itemPublicId,
                    itemOrder,
                    itemRole,
                    selectedOption
                  }).prompt_text,
                  interaction_type: "request_tempting_option",
                  allowed_actions: ["record_tempting_option"]
                }
              : state.next_step === "request_tempting_reason"
                ? {
                    ...base,
                    assistant_message: buildInitialAdminPrompt({
                      kind: "tempting_reason_prompt",
                      assessmentState: "AWAIT_TEMPTING_REASON",
                      itemPublicId,
                      itemOrder,
                      itemRole
                    }).prompt_text,
                    interaction_type: "request_tempting_reason",
                    allowed_actions: ["record_tempting_reason"]
                  }
            : state.next_step === "missing_evidence_repair"
              ? {
                  ...base,
                  assistant_message: `This response is missing ${missingFieldList(state.missing_evidence)}. You can add it now, or continue without it. Continuing means the system will have less evidence about your thinking.`,
                  interaction_type: "missing_evidence_repair",
                  allowed_actions: ["add_missing_information", "confirm_skip_missing"]
                }
              : state.next_step === "item_complete"
                ? {
                    ...base,
                    assistant_message:
                      "Thanks. I have what I need for this question.",
                    interaction_type: "item_completed",
                    allowed_actions: ["review_responses"]
                  }
                : state.next_step === "package_review"
                  ? {
                      ...base,
                      assistant_message: buildInitialAdminPrompt({
                        kind: "package_review_prompt",
                        assessmentState: "PACKAGE_REVIEW"
                      }).prompt_text,
                      interaction_type: "package_review",
                      allowed_actions: ["complete_initial_concept_unit", "review_responses"]
                    }
                  : state.next_step === "package_analysis"
                    ? {
                        ...base,
                        assistant_message:
                          "Thanks. I’m using your response package to prepare the next step.",
                        interaction_type: "package_analysis",
                        allowed_actions: ["review_responses", "save_exit"],
                        can_continue: false
                      }
                : state.next_step === "initial_concept_unit_complete"
                  ? {
                      ...base,
                      assistant_message: `You’ve answered the initial questions for ${conceptTitle}. Continue when you’re ready to prepare the next step.`,
                      interaction_type: "concept_unit_completed",
                      allowed_actions: ["complete_initial_concept_unit", "review_responses"]
                    }
                  : {
                      ...base,
                      assistant_message: awaitingAnalysisMessage(state.effective_phase),
                      interaction_type: "awaiting_profiling",
                      allowed_actions: ["review_responses"],
                      can_continue: false
                    };

  return StudentConversationFrameSchema.parse(frame);
}

export function buildSkipConfirmationFrame(fields: MissingEvidenceField[]): StudentConversationFrame {
  return StudentConversationFrameSchema.parse({
    assistant_message: `Continue without ${missingFieldList(fields)}? The system will keep going, but it will have less evidence for this response.`,
    interaction_type: "confirm_skip",
    allowed_actions: ["confirm_skip", "cancel_skip"],
    current_item: null,
    missing_fields: fields,
    can_review_responses: true,
    can_exit: true,
    can_continue: true
  });
}
