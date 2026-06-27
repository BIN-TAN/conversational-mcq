import type {
  MissingEvidenceField,
  StudentConversationFrame,
  StudentSessionState
} from "./types";
import { StudentConversationFrameSchema } from "./types";

function awaitingAnalysisMessage(phase: string) {
  if (phase === "profiling_completed") {
    return "Thanks. I’m using your responses to prepare the next step.";
  }

  if (phase === "planning_pending") {
    return "Preparing follow-up. Your responses are saved.";
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
    return "Preparing follow-up. Your responses are saved.";
  }

  if (nextStep === "automatic_followup_opening_pending") {
    return "Preparing follow-up. This usually takes a short moment.";
  }

  return "I’m having trouble preparing the next step. Your responses are saved, and you can return later.";
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
  const questionNumber = Math.min(
    state.progress.completed_item_count + 1,
    Math.max(state.progress.total_item_count, 1)
  );
  const base = {
    current_item: state.current_item,
    missing_fields: state.missing_evidence,
    can_review_responses: Boolean(state.current_concept_unit),
    can_exit: state.can_exit,
    can_continue: true
  };
  const frame: StudentConversationFrame =
    state.next_step === "session_completed"
      ? {
          ...base,
          assistant_message: "Your assessment is complete. Your responses and conversation have been saved.",
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
              "I’m reviewing your latest response so the next step can be better matched to your current understanding. Your progress has been saved.",
            interaction_type: "followup_updating",
            allowed_actions: ["review_responses", "save_exit", "stop_followup"],
            can_review_responses: true,
            can_continue: false
          }
      : state.next_step === "followup_stopped"
        ? {
            ...base,
            assistant_message:
              "This follow-up round has been stopped. Your conversation has been saved.",
            interaction_type: "followup_stopped",
            allowed_actions: ["review_responses"],
            can_review_responses: true,
            can_continue: false
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
              "Thanks. Your response is saved. Targeted feedback is not available yet in this prototype.",
            interaction_type: "formative_response_saved",
            allowed_actions: ["review_responses", "save_exit"],
            can_review_responses: true,
            can_continue: false
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
            assistant_message: `Question ${questionNumber} of ${state.progress.total_item_count}. Choose the option that best fits the evidence.`,
            interaction_type: "present_item",
            allowed_actions: ["select_option", "skip_item"]
          }
        : state.next_step === "request_reasoning"
          ? {
              ...base,
              assistant_message:
                "Tell me why you chose that answer. A short explanation is fine.",
              interaction_type: "request_reasoning",
              allowed_actions: ["save_reasoning", "skip_reasoning"]
            }
          : state.next_step === "request_confidence"
            ? {
                ...base,
                assistant_message:
                  "How confident are you?",
                interaction_type: "request_confidence",
                allowed_actions: ["select_confidence", "skip_confidence"]
              }
            : state.next_step === "request_tempting_option"
              ? {
                  ...base,
                  assistant_message:
                    "Was another option tempting? If yes, which one, and what made it tempting? You can also say No.",
                  interaction_type: "request_tempting_option",
                  allowed_actions: ["record_tempting_option"]
                }
              : state.next_step === "request_tempting_reason"
                ? {
                    ...base,
                    assistant_message: "What made that option seem tempting?",
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
                      assistant_message:
                        "You can review the three responses as one package before the next step is prepared.",
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
                      assistant_message: `You’ve answered the initial questions for ${conceptTitle}. Submit your responses when you’re ready.`,
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
