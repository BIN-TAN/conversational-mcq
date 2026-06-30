import {
  allowedChatNativeActions,
  type ChatNativeAssessmentAction,
  type ChatNativeAssessmentState
} from "../src/lib/student-assessment/state-machine";
import { StudentAssessmentServiceError } from "../src/lib/services/student-assessment/errors";

export type LiveSmokeLoopState = {
  assessment_state: ChatNativeAssessmentState;
  current_phase?: string | null;
  effective_phase?: string | null;
  next_step?: string | null;
};

export type LiveSmokeLoopSubmission = {
  message: string;
  client_message_id: string;
  turn_index: number;
  state: LiveSmokeLoopState;
};

export type LiveSmokeLoopAction =
  | "submit_formative_activity_response"
  | "submit_followup_response"
  | "submit_revision_response";

export type LiveSmokeLoopHistoryEntry = {
  turn_index: number;
  from_state: ChatNativeAssessmentState;
  action: LiveSmokeLoopAction;
  to_state: ChatNativeAssessmentState;
  next_step: string | null;
};

type SubmitLoopAction = (input: LiveSmokeLoopSubmission) => Promise<LiveSmokeLoopState>;

const defaultFormativeMessages = [
  "Theta is the person estimate on the linked scale. Difficulty describes where an item is located.",
  "Theta belongs to the person, while difficulty and discrimination are item features that affect item behavior.",
  "The linked scale keeps theta comparable even when item parameters differ."
];

const defaultFollowupMessages = [
  "I think theta is the person's location on the latent trait scale, while item parameters describe how each item behaves.",
  "Item difficulty says where an item is located, and discrimination affects how sharply it separates nearby theta values.",
  "So theta is about the student estimate, and item parameters are about the item response pattern."
];

const defaultRevisionMessages = [
  "Theta is about the student on the linked latent trait scale, while item parameters describe item behavior.",
  "A person's theta can be compared on the linked scale, and item parameters explain how each item functions.",
  "The key distinction is that theta describes the learner estimate, while difficulty and discrimination describe the item."
];

function messageAt(messages: string[], turnIndex: number) {
  return messages[Math.min(turnIndex, messages.length - 1)];
}

function safeStateDetail(state: LiveSmokeLoopState) {
  return {
    actual_state: state.assessment_state,
    allowed_actions: allowedChatNativeActions(state.assessment_state),
    current_phase: state.current_phase ?? null,
    effective_phase: state.effective_phase ?? null,
    next_step: state.next_step ?? null
  };
}

function chooseAction(state: LiveSmokeLoopState): {
  action: LiveSmokeLoopAction;
  state_action: ChatNativeAssessmentAction;
} {
  if (state.assessment_state === "FORMATIVE_ACTIVITY") {
    return {
      action: "submit_formative_activity_response",
      state_action: "show_formative_activity"
    };
  }

  if (state.assessment_state === "FOLLOWUP_RESPONSE") {
    return {
      action: "submit_followup_response",
      state_action: "submit_followup_response"
    };
  }

  if (state.assessment_state === "REVISION") {
    return {
      action: "submit_revision_response",
      state_action: "submit_revision"
    };
  }

  if (state.assessment_state === "TARGETED_FEEDBACK") {
    if (state.next_step === "followup_active") {
      return {
        action: "submit_followup_response",
        state_action: "show_targeted_feedback"
      };
    }

    if (state.next_step === "revision_requested" || state.next_step === null) {
      return {
        action: "submit_revision_response",
        state_action: "show_targeted_feedback"
      };
    }
  }

  throw new StudentAssessmentServiceError(
    "live_smoke_flow_mismatch",
    `Unexpected formative-loop state: ${state.assessment_state}.`,
    409,
    {
      failure_stage: "formative_loop_state_mismatch",
      expected_states: ["FORMATIVE_ACTIVITY", "FOLLOWUP_RESPONSE", "TARGETED_FEEDBACK", "REVISION", "NEXT_CHOICE"],
      ...safeStateDetail(state)
    }
  );
}

export async function advanceLiveSmokeFormativeLoop(input: {
  state: LiveSmokeLoopState;
  prefix: string;
  max_turns?: number;
  formative_activity_messages?: string[];
  followup_messages?: string[];
  revision_messages?: string[];
  submit_formative_activity_response: SubmitLoopAction;
  submit_followup_response: SubmitLoopAction;
  submit_revision_response: SubmitLoopAction;
  assert_student_visible_text_safe?: (state: LiveSmokeLoopState) => void;
}) {
  let state = input.state;
  const maxTurns = input.max_turns ?? 6;
  const history: LiveSmokeLoopHistoryEntry[] = [];
  let lastActionAttempted: LiveSmokeLoopAction | null = null;

  for (let turnIndex = 0; turnIndex < maxTurns; turnIndex += 1) {
    if (state.assessment_state === "NEXT_CHOICE") {
      return {
        state,
        history,
        terminal_reason: "next_choice" as const
      };
    }

    const choice = chooseAction(state);
    lastActionAttempted = choice.action;
    const fromState = state.assessment_state;
    const messages =
      choice.action === "submit_formative_activity_response"
        ? input.formative_activity_messages ?? defaultFormativeMessages
        : choice.action === "submit_followup_response"
          ? input.followup_messages ?? defaultFollowupMessages
          : input.revision_messages ?? defaultRevisionMessages;
    const submit =
      choice.action === "submit_formative_activity_response"
        ? input.submit_formative_activity_response
        : choice.action === "submit_followup_response"
          ? input.submit_followup_response
          : input.submit_revision_response;

    state = await submit({
      message: messageAt(messages, turnIndex),
      client_message_id: `${input.prefix}_${choice.action}_${turnIndex + 1}`,
      turn_index: turnIndex,
      state
    });
    input.assert_student_visible_text_safe?.(state);
    history.push({
      turn_index: turnIndex,
      from_state: fromState,
      action: choice.action,
      to_state: state.assessment_state,
      next_step: state.next_step ?? null
    });
  }

  if (state.assessment_state === "NEXT_CHOICE") {
    return {
      state,
      history,
      terminal_reason: "next_choice" as const
    };
  }

  throw new StudentAssessmentServiceError(
    "live_smoke_flow_mismatch",
    `Formative loop did not reach NEXT_CHOICE within ${maxTurns} valid turn(s).`,
    409,
    {
      failure_stage: "formative_loop_state_mismatch",
      expected_states: ["NEXT_CHOICE"],
      ...safeStateDetail(state),
      last_action_attempted: lastActionAttempted,
      loop_turns: maxTurns,
      loop_history: history
    }
  );
}
