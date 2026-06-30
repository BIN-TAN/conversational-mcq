import { StudentAssessmentServiceError } from "../src/lib/services/student-assessment/errors";
import {
  advanceLiveSmokeFormativeLoop,
  normalizeLiveSmokeStateAfterAction,
  type LiveSmokeLoopAction,
  type LiveSmokeLoopState
} from "./student-live-llm-loop";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function state(
  assessmentState: LiveSmokeLoopState["assessment_state"],
  nextStep: string | null = null
): LiveSmokeLoopState {
  return {
    assessment_state: assessmentState,
    current_phase:
      assessmentState === "NEXT_CHOICE"
        ? "followup_stopped"
        : assessmentState === "FORMATIVE_ACTIVITY"
          ? "planning_completed"
          : "followup_active",
    effective_phase:
      assessmentState === "NEXT_CHOICE"
        ? "followup_stopped"
        : assessmentState === "FORMATIVE_ACTIVITY"
          ? "planning_completed"
          : "followup_active",
    next_step: nextStep
  };
}

async function runSingleFollowupTurn() {
  const actions: LiveSmokeLoopAction[] = [];
  let fetchCount = 0;
  const result = await advanceLiveSmokeFormativeLoop({
    state: state("FOLLOWUP_RESPONSE", "followup_active"),
    prefix: "loop_smoke_single",
    fetch_state: async () => {
      fetchCount += 1;
      return state("NEXT_CHOICE", "followup_stopped");
    },
    submit_formative_activity_response: async () => {
      actions.push("submit_formative_activity_response");
      return state("NEXT_CHOICE", "followup_stopped");
    },
    submit_followup_response: async () => {
      actions.push("submit_followup_response");
      return state("NEXT_CHOICE", "followup_stopped");
    },
    submit_revision_response: async () => {
      actions.push("submit_revision_response");
      return state("NEXT_CHOICE", "followup_stopped");
    }
  });

  assert(result.state.assessment_state === "NEXT_CHOICE", "Follow-up turn should reach next choice.");
  assert(fetchCount === 0, "Full state responses should not be refetched.");
  assert(
    actions.join(",") === "submit_followup_response",
    "FOLLOWUP_RESPONSE must use the follow-up message service, not the revision service."
  );
}

async function runPartialFollowupPayloadRefetch() {
  const result = await advanceLiveSmokeFormativeLoop({
    state: state("FOLLOWUP_RESPONSE", "followup_active"),
    prefix: "loop_smoke_partial",
    fetch_state: async () => state("NEXT_CHOICE", "followup_stopped"),
    submit_formative_activity_response: async () => state("NEXT_CHOICE", "followup_stopped"),
    submit_followup_response: async () => ({
      message_status: "assistant_replied",
      assistant_message: "A safe assistant reply.",
      state: {
        session_public_id: "sess_partial",
        current_phase: "followup_active",
        followup: null
      }
    }),
    submit_revision_response: async () => state("NEXT_CHOICE", "followup_stopped")
  });

  assert(result.state.assessment_state === "NEXT_CHOICE", "Partial follow-up payload should refetch state.");
  assert(result.history[0]?.refetch_attempted === true, "Partial payload should require state refetch.");
  assert(result.history[0]?.refetch_succeeded === true, "Refetch should be recorded as successful.");
  assert(result.history[0]?.state_source === "refetched", "State source should be refetched.");
  assert(
    result.history[0]?.returned_payload_keys.includes("message_status"),
    "Returned payload keys should be recorded without values."
  );
}

async function runNestedFullStatePayload() {
  let fetchCount = 0;
  const result = await advanceLiveSmokeFormativeLoop({
    state: state("FORMATIVE_ACTIVITY", "formative_activity"),
    prefix: "loop_smoke_nested",
    fetch_state: async () => {
      fetchCount += 1;
      return state("FOLLOWUP_RESPONSE", "followup_active");
    },
    submit_formative_activity_response: async () => ({
      message_status: "saved",
      targeted_feedback_available: true,
      state: state("NEXT_CHOICE", "followup_stopped")
    }),
    submit_followup_response: async () => state("NEXT_CHOICE", "followup_stopped"),
    submit_revision_response: async () => state("NEXT_CHOICE", "followup_stopped")
  });

  assert(result.state.assessment_state === "NEXT_CHOICE", "Nested full state should be accepted.");
  assert(fetchCount === 0, "Nested full state should not refetch.");
  assert(result.history[0]?.state_source === "nested_state", "State source should be nested_state.");
}

async function runMultipleTurnLoop() {
  const actions: LiveSmokeLoopAction[] = [];
  const path = [
    state("REVISION", "revision_requested"),
    state("FOLLOWUP_RESPONSE", "followup_active"),
    state("NEXT_CHOICE", "followup_stopped")
  ];
  let index = 0;
  const result = await advanceLiveSmokeFormativeLoop({
    state: state("FORMATIVE_ACTIVITY", "formative_activity"),
    prefix: "loop_smoke_multi",
    fetch_state: async () => state("NEXT_CHOICE", "followup_stopped"),
    submit_formative_activity_response: async () => {
      actions.push("submit_formative_activity_response");
      return path[index++];
    },
    submit_followup_response: async () => {
      actions.push("submit_followup_response");
      return path[index++];
    },
    submit_revision_response: async () => {
      actions.push("submit_revision_response");
      return path[index++];
    }
  });

  assert(result.state.assessment_state === "NEXT_CHOICE", "Multiple-turn loop should stop at next choice.");
  assert(
    actions.join(",") ===
      "submit_formative_activity_response,submit_revision_response,submit_followup_response",
    "Loop should follow the app-owned state sequence."
  );
}

async function runAlreadyAtNextChoice() {
  let callCount = 0;
  const result = await advanceLiveSmokeFormativeLoop({
    state: state("NEXT_CHOICE", "followup_stopped"),
    prefix: "loop_smoke_terminal",
    fetch_state: async () => {
      callCount += 1;
      return state("NEXT_CHOICE", "followup_stopped");
    },
    submit_formative_activity_response: async () => {
      callCount += 1;
      return state("NEXT_CHOICE", "followup_stopped");
    },
    submit_followup_response: async () => {
      callCount += 1;
      return state("NEXT_CHOICE", "followup_stopped");
    },
    submit_revision_response: async () => {
      callCount += 1;
      return state("NEXT_CHOICE", "followup_stopped");
    }
  });

  assert(result.terminal_reason === "next_choice", "NEXT_CHOICE should be terminal.");
  assert(callCount === 0, "No service call should be made once NEXT_CHOICE is reached.");
}

async function runAlreadyAtSessionComplete() {
  let callCount = 0;
  const result = await advanceLiveSmokeFormativeLoop({
    state: state("SESSION_COMPLETE", "session_completed"),
    prefix: "loop_smoke_session_complete",
    fetch_state: async () => {
      callCount += 1;
      return state("SESSION_COMPLETE", "session_completed");
    },
    submit_formative_activity_response: async () => {
      callCount += 1;
      return state("SESSION_COMPLETE", "session_completed");
    },
    submit_followup_response: async () => {
      callCount += 1;
      return state("SESSION_COMPLETE", "session_completed");
    },
    submit_revision_response: async () => {
      callCount += 1;
      return state("SESSION_COMPLETE", "session_completed");
    }
  });

  assert(result.terminal_reason === "session_complete", "SESSION_COMPLETE should be terminal.");
  assert(callCount === 0, "No service call should be made once SESSION_COMPLETE is reached.");
}

async function runTargetedFeedbackRouting() {
  const actions: LiveSmokeLoopAction[] = [];
  await advanceLiveSmokeFormativeLoop({
    state: state("TARGETED_FEEDBACK", "followup_active"),
    prefix: "loop_smoke_targeted_followup",
    fetch_state: async () => state("NEXT_CHOICE", "followup_stopped"),
    submit_formative_activity_response: async () => state("NEXT_CHOICE", "followup_stopped"),
    submit_followup_response: async () => {
      actions.push("submit_followup_response");
      return state("NEXT_CHOICE", "followup_stopped");
    },
    submit_revision_response: async () => {
      actions.push("submit_revision_response");
      return state("NEXT_CHOICE", "followup_stopped");
    }
  });
  await advanceLiveSmokeFormativeLoop({
    state: state("TARGETED_FEEDBACK", "revision_requested"),
    prefix: "loop_smoke_targeted_revision",
    fetch_state: async () => state("NEXT_CHOICE", "followup_stopped"),
    submit_formative_activity_response: async () => state("NEXT_CHOICE", "followup_stopped"),
    submit_followup_response: async () => {
      actions.push("submit_followup_response");
      return state("NEXT_CHOICE", "followup_stopped");
    },
    submit_revision_response: async () => {
      actions.push("submit_revision_response");
      return state("NEXT_CHOICE", "followup_stopped");
    }
  });

  assert(
    actions.join(",") === "submit_followup_response,submit_revision_response",
    "TARGETED_FEEDBACK should route according to returned next_step."
  );
}

async function runStuckLoopDiagnostics() {
  try {
    await advanceLiveSmokeFormativeLoop({
      state: state("FOLLOWUP_RESPONSE", "followup_active"),
      prefix: "loop_smoke_stuck",
      max_turns: 2,
      fetch_state: async () => state("FOLLOWUP_RESPONSE", "followup_active"),
      submit_formative_activity_response: async () => state("FOLLOWUP_RESPONSE", "followup_active"),
      submit_followup_response: async () => state("FOLLOWUP_RESPONSE", "followup_active"),
      submit_revision_response: async () => state("FOLLOWUP_RESPONSE", "followup_active")
    });
    throw new Error("Stuck loop should fail.");
  } catch (error) {
    assert(error instanceof StudentAssessmentServiceError, "Stuck loop should use service error taxonomy.");
    assert(error.code === "live_smoke_flow_mismatch", "Stuck loop should use live_smoke_flow_mismatch.");
    assert(
      error.details.failure_stage === "formative_loop_limit_exceeded",
      "Stuck loop should include a loop-limit failure stage."
    );
    assert(error.details.actual_state === "FOLLOWUP_RESPONSE", "Stuck loop should include actual state.");
    assert(
      Array.isArray(error.details.expected_states) &&
        error.details.expected_states.includes("NEXT_CHOICE"),
      "Stuck loop should include expected states."
    );
    assert(
      error.details.last_action_attempted === "submit_followup_response",
      "Stuck loop should include the last attempted action."
    );
  }
}

async function runStateShapeFailureDiagnostics() {
  try {
    await normalizeLiveSmokeStateAfterAction({
      action: "submit_followup_response",
      turn_index: 0,
      action_result: {
        message_status: "assistant_replied",
        state: {
          session_public_id: "sess_partial",
          current_phase: "followup_active"
        }
      },
      parse_state: (value) => {
        const valueRecord = value as Record<string, unknown>;

        if (valueRecord.assessment_state !== "NEXT_CHOICE") {
          const error = new Error("mock zod failure") as Error & {
            issues: Array<{ path: string[] }>;
          };
          error.name = "ZodError";
          error.issues = [{ path: ["assessment_state"] }, { path: ["next_step"] }];
          throw error;
        }

        return state("NEXT_CHOICE", "followup_stopped");
      },
      fetch_state: async () => ({
        session_public_id: "sess_bad_refetch"
      })
    });
    throw new Error("State-shape failure should fail.");
  } catch (error) {
    assert(error instanceof StudentAssessmentServiceError, "Shape failure should use service error taxonomy.");
    assert(error.code === "live_smoke_flow_mismatch", "Shape failure should use live smoke mismatch code.");
    assert(
      error.details.failure_stage === "live_smoke_state_shape_error",
      "Shape failure should include the state-shape failure stage."
    );
    assert(
      Array.isArray(error.details.missing_paths) &&
        error.details.missing_paths.includes("assessment_state"),
      "Shape failure should include safe missing paths."
    );
    assert(
      Array.isArray(error.details.returned_payload_keys) &&
        error.details.returned_payload_keys.includes("message_status"),
      "Shape failure should include returned payload keys only."
    );
    assert(error.details.refetch_attempted === true, "Shape failure should record refetch attempt.");
    assert(error.details.refetch_succeeded === false, "Shape failure should record failed refetch.");
  }
}

async function main() {
  await runSingleFollowupTurn();
  await runPartialFollowupPayloadRefetch();
  await runNestedFullStatePayload();
  await runMultipleTurnLoop();
  await runAlreadyAtNextChoice();
  await runAlreadyAtSessionComplete();
  await runTargetedFeedbackRouting();
  await runStuckLoopDiagnostics();
  await runStateShapeFailureDiagnostics();

  console.log("Student live LLM formative-loop smoke passed. No OpenAI call was made.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
