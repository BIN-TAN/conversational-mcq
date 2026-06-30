import { StudentAssessmentServiceError } from "../src/lib/services/student-assessment/errors";
import {
  advanceLiveSmokeFormativeLoop,
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
  const result = await advanceLiveSmokeFormativeLoop({
    state: state("FOLLOWUP_RESPONSE", "followup_active"),
    prefix: "loop_smoke_single",
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
  assert(
    actions.join(",") === "submit_followup_response",
    "FOLLOWUP_RESPONSE must use the follow-up message service, not the revision service."
  );
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

async function runTargetedFeedbackRouting() {
  const actions: LiveSmokeLoopAction[] = [];
  await advanceLiveSmokeFormativeLoop({
    state: state("TARGETED_FEEDBACK", "followup_active"),
    prefix: "loop_smoke_targeted_followup",
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
      submit_formative_activity_response: async () => state("FOLLOWUP_RESPONSE", "followup_active"),
      submit_followup_response: async () => state("FOLLOWUP_RESPONSE", "followup_active"),
      submit_revision_response: async () => state("FOLLOWUP_RESPONSE", "followup_active")
    });
    throw new Error("Stuck loop should fail.");
  } catch (error) {
    assert(error instanceof StudentAssessmentServiceError, "Stuck loop should use service error taxonomy.");
    assert(error.code === "live_smoke_flow_mismatch", "Stuck loop should use live_smoke_flow_mismatch.");
    assert(
      error.details.failure_stage === "formative_loop_state_mismatch",
      "Stuck loop should include a state-mismatch failure stage."
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

async function main() {
  await runSingleFollowupTurn();
  await runMultipleTurnLoop();
  await runAlreadyAtNextChoice();
  await runTargetedFeedbackRouting();
  await runStuckLoopDiagnostics();

  console.log("Student live LLM formative-loop smoke passed. No OpenAI call was made.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
