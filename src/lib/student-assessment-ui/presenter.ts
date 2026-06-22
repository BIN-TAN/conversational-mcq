import type {
  MissingEvidenceField,
  StudentConversationFrame,
  StudentSessionState
} from "./types";
import { StudentConversationFrameSchema } from "./types";

function awaitingAnalysisMessage(phase: string) {
  if (phase === "profiling_completed") {
    return "Your initial responses have been reviewed. The system is preparing the next support step.";
  }

  if (phase === "planning_pending") {
    return "The next support step is being prepared. Your progress has been saved.";
  }

  if (phase === "planning_completed") {
    return "A support plan has been prepared. Interactive follow-up is not available yet in this prototype.";
  }

  return "The initial questions are complete. The system is preparing the next step.";
}

function automaticWorkflowMessage(nextStep: StudentSessionState["next_step"]) {
  if (nextStep === "automatic_profiling_pending") {
    return "Your initial responses have been saved. The system is reviewing them to prepare the next step. You may leave and return later.";
  }

  if (nextStep === "automatic_planning_pending") {
    return "The system is preparing the next support step. Your progress has been saved.";
  }

  if (nextStep === "automatic_followup_opening_pending") {
    return "Your follow-up conversation is being prepared. You may leave and return later.";
  }

  return "The system is having trouble preparing the next step. Your progress has been saved, and you can return later.";
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
    state.next_step === "followup_active"
      ? {
          ...base,
          assistant_message:
            "Continue the follow-up conversation in your own words. Your initial responses are locked and saved.",
          interaction_type: "followup_active",
          allowed_actions: ["send_followup_message", "save_exit", "stop_followup"],
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
        : state.next_step === "concept_unit_intro"
      ? {
          ...base,
          assistant_message:
            "This first part is designed to understand your current thinking. Please answer using your current understanding. I will not provide hints or explanations during these initial questions. After the initial questions, the system will provide follow-up support.",
          interaction_type: "concept_unit_intro",
          allowed_actions: ["begin_concept_unit"]
        }
      : state.next_step === "present_item"
        ? {
            ...base,
            assistant_message: `Question ${questionNumber} of ${state.progress.total_item_count}. Choose the option that best matches your current understanding.`,
            interaction_type: "present_item",
            allowed_actions: ["select_option", "skip_item"]
          }
        : state.next_step === "request_reasoning"
          ? {
              ...base,
              assistant_message:
                "Please explain your thinking in your own words. A short explanation is fine if that reflects your current thinking.",
              interaction_type: "request_reasoning",
              allowed_actions: ["save_reasoning", "skip_reasoning"]
            }
          : state.next_step === "request_confidence"
            ? {
                ...base,
                assistant_message:
                  "How confident do you feel about this response right now?",
                interaction_type: "request_confidence",
                allowed_actions: ["select_confidence", "skip_confidence"]
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
                      "Your response for this question is saved. You can review it or continue to the next step.",
                    interaction_type: "item_completed",
                    allowed_actions: ["submit_item", "review_responses"]
                  }
                : state.next_step === "initial_concept_unit_complete"
                  ? {
                      ...base,
                      assistant_message: `The initial questions for ${conceptTitle} are complete. Submit this section when you are ready.`,
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
