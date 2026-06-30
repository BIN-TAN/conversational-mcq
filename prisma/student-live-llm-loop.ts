import {
  allowedChatNativeActions,
  type ChatNativeAssessmentAction,
  ChatNativeAssessmentStateSchema,
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
  returned_payload_keys: string[];
  refetch_attempted: boolean;
  refetch_succeeded: boolean;
  state_source: "direct" | "nested_state" | "refetched";
};

type SubmitLoopAction = (input: LiveSmokeLoopSubmission) => Promise<unknown>;
type FetchLoopState = (input: {
  action: LiveSmokeLoopAction;
  returned_payload_keys: string[];
  turn_index: number;
}) => Promise<unknown>;
type ParseLoopState = (value: unknown) => LiveSmokeLoopState;

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

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function payloadKeys(value: unknown) {
  return record(value) ? Object.keys(value as Record<string, unknown>).sort().slice(0, 40) : [];
}

function issuePaths(error: unknown) {
  const issues = Array.isArray(record(error)?.issues) ? (record(error)?.issues as unknown[]) : [];

  return issues
    .map((issue) => {
      const issueRecord = record(issue);
      const path = Array.isArray(issueRecord?.path) ? issueRecord.path : [];

      return path
        .map((entry) => (typeof entry === "string" || typeof entry === "number" ? String(entry) : null))
        .filter((entry): entry is string => Boolean(entry))
        .join(".");
    })
    .filter((path) => path.length > 0)
    .slice(0, 50);
}

function parseLiveSmokeLoopState(value: unknown): LiveSmokeLoopState {
  const valueRecord = record(value);
  const assessmentState = ChatNativeAssessmentStateSchema.parse(valueRecord?.assessment_state);

  return {
    assessment_state: assessmentState,
    current_phase:
      typeof valueRecord?.current_phase === "string" ? valueRecord.current_phase : null,
    effective_phase:
      typeof valueRecord?.effective_phase === "string" ? valueRecord.effective_phase : null,
    next_step: typeof valueRecord?.next_step === "string" ? valueRecord.next_step : null
  };
}

function tryParseState(input: {
  value: unknown;
  parse_state: ParseLoopState;
}) {
  try {
    return {
      ok: true as const,
      state: input.parse_state(input.value)
    };
  } catch (error) {
    return {
      ok: false as const,
      error,
      missing_paths: issuePaths(error)
    };
  }
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

export async function normalizeLiveSmokeStateAfterAction(input: {
  action: LiveSmokeLoopAction;
  turn_index: number;
  action_result: unknown;
  parse_state?: ParseLoopState;
  fetch_state: FetchLoopState;
}) {
  const parseState = input.parse_state ?? parseLiveSmokeLoopState;
  const returnedPayloadKeys = payloadKeys(input.action_result);
  const direct = tryParseState({
    value: input.action_result,
    parse_state: parseState
  });

  if (direct.ok) {
    return {
      state: direct.state,
      returned_payload_keys: returnedPayloadKeys,
      refetch_attempted: false,
      refetch_succeeded: false,
      state_source: "direct" as const,
      missing_paths: [] as string[]
    };
  }

  const resultRecord = record(input.action_result);
  const nested = tryParseState({
    value: resultRecord?.state,
    parse_state: parseState
  });

  if (nested.ok) {
    return {
      state: nested.state,
      returned_payload_keys: returnedPayloadKeys,
      refetch_attempted: false,
      refetch_succeeded: false,
      state_source: "nested_state" as const,
      missing_paths: [] as string[]
    };
  }

  let refetched: unknown;

  try {
    refetched = await input.fetch_state({
      action: input.action,
      returned_payload_keys: returnedPayloadKeys,
      turn_index: input.turn_index
    });
  } catch {
    throw new StudentAssessmentServiceError(
      "live_smoke_flow_mismatch",
      "Live smoke action did not return a full student state, and authoritative state refetch failed.",
      409,
      {
        failure_stage: "live_smoke_state_shape_error",
        expected_schema: "student_assessment_state",
        missing_paths: [...new Set([...direct.missing_paths, ...nested.missing_paths])],
        returned_payload_keys: returnedPayloadKeys,
        last_action_attempted: input.action,
        refetch_attempted: true,
        refetch_succeeded: false,
        resulting_state_if_refetched: null
      }
    );
  }

  const parsedRefetch = tryParseState({
    value: refetched,
    parse_state: parseState
  });

  if (!parsedRefetch.ok) {
    throw new StudentAssessmentServiceError(
      "live_smoke_flow_mismatch",
      "Authoritative state refetch did not return a valid student state.",
      409,
      {
        failure_stage: "live_smoke_state_shape_error",
        expected_schema: "student_assessment_state",
        missing_paths: parsedRefetch.missing_paths,
        returned_payload_keys: returnedPayloadKeys,
        last_action_attempted: input.action,
        refetch_attempted: true,
        refetch_succeeded: false,
        resulting_state_if_refetched: null
      }
    );
  }

  return {
    state: parsedRefetch.state,
    returned_payload_keys: returnedPayloadKeys,
    refetch_attempted: true,
    refetch_succeeded: true,
    state_source: "refetched" as const,
    missing_paths: [...new Set([...direct.missing_paths, ...nested.missing_paths])]
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
  parse_state?: ParseLoopState;
  fetch_state: FetchLoopState;
  submit_formative_activity_response: SubmitLoopAction;
  submit_followup_response: SubmitLoopAction;
  submit_revision_response: SubmitLoopAction;
  assert_student_visible_text_safe?: (state: LiveSmokeLoopState) => void;
}) {
  let state = input.state;
  const maxTurns = input.max_turns ?? 8;
  const history: LiveSmokeLoopHistoryEntry[] = [];
  let lastActionAttempted: LiveSmokeLoopAction | null = null;
  let lastNormalization: Awaited<ReturnType<typeof normalizeLiveSmokeStateAfterAction>> | null = null;

  for (let turnIndex = 0; turnIndex < maxTurns; turnIndex += 1) {
    if (state.assessment_state === "NEXT_CHOICE" || state.assessment_state === "SESSION_COMPLETE") {
      return {
        state,
        history,
        terminal_reason:
          state.assessment_state === "NEXT_CHOICE" ? "next_choice" as const : "session_complete" as const
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

    const actionResult = await submit({
      message: messageAt(messages, turnIndex),
      client_message_id: `${input.prefix}_${choice.action}_${turnIndex + 1}`,
      turn_index: turnIndex,
      state
    });
    const normalized = await normalizeLiveSmokeStateAfterAction({
      action: choice.action,
      turn_index: turnIndex,
      action_result: actionResult,
      parse_state: input.parse_state,
      fetch_state: input.fetch_state
    });
    state = normalized.state;
    lastNormalization = normalized;
    input.assert_student_visible_text_safe?.(state);
    history.push({
      turn_index: turnIndex,
      from_state: fromState,
      action: choice.action,
      to_state: state.assessment_state,
      next_step: state.next_step ?? null,
      returned_payload_keys: normalized.returned_payload_keys,
      refetch_attempted: normalized.refetch_attempted,
      refetch_succeeded: normalized.refetch_succeeded,
      state_source: normalized.state_source
    });
  }

  if (state.assessment_state === "NEXT_CHOICE" || state.assessment_state === "SESSION_COMPLETE") {
    return {
      state,
      history,
      terminal_reason:
        state.assessment_state === "NEXT_CHOICE" ? "next_choice" as const : "session_complete" as const
    };
  }

  throw new StudentAssessmentServiceError(
    "live_smoke_flow_mismatch",
    `Formative loop did not reach a terminal state within ${maxTurns} valid turn(s).`,
    409,
    {
      failure_stage: "formative_loop_limit_exceeded",
      expected_states: ["NEXT_CHOICE", "SESSION_COMPLETE"],
      ...safeStateDetail(state),
      last_action_attempted: lastActionAttempted,
      returned_payload_keys: lastNormalization?.returned_payload_keys ?? [],
      refetch_attempted: lastNormalization?.refetch_attempted ?? false,
      refetch_succeeded: lastNormalization?.refetch_succeeded ?? false,
      runtime_guard_status: "not_triggered",
      loop_turns: maxTurns,
      loop_history: history
    }
  );
}
