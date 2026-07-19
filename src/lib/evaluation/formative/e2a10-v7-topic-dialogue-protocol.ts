import { stableHash } from "@/lib/operational/stable-hash";
import type { TopicDialogueResponseMode } from
  "@/lib/services/student-assessment/topic-dialogue-response-mode";
import type {
  TopicDialogueOperation,
  TopicDialogueOperationRoutingClassification
} from "@/lib/services/student-assessment/topic-dialogue-operation-contract";
import type { TopicDialogueInputV4 } from
  "./e2a5-topic-dialogue-progression-contract";
import { e2a8CanaryCases } from "./e2a8-v6-topic-dialogue-protocol";
import { e2a9HeldOutOperationCases } from
  "./e2a9-topic-dialogue-operation-protocol";

export const E2A10_PROTOCOL_VERSION =
  "e2a10-v7-operation-specific-live-canary-v1" as const;

export type E2A10TopicDialogueCase = {
  case_id: string;
  case_number: number;
  selected_mode: TopicDialogueResponseMode;
  selected_operation: TopicDialogueOperation | null;
  routing_classification:
    TopicDialogueOperationRoutingClassification | null;
  dialogue_input: TopicDialogueInputV4;
  distractor_anchor: string;
  misconception_target: string;
  evidence_needed: string;
  strategies_already_attempted: string[];
  strategies_marked_unsuccessful: string[];
  scenario_truth_summary: string;
  require_tenth_turn_context: boolean;
};

function progressionSource(mode: Exclude<
  TopicDialogueResponseMode,
  "remain_in_dialogue"
>) {
  const found = e2a8CanaryCases().find((entry) =>
    entry.selected_mode === mode
  );
  if (!found) throw new Error(`e2a10_progression_source_missing:${mode}`);
  return found;
}

function withLatestMessage(
  input: TopicDialogueInputV4,
  latestStudentMessage: string,
  suffix: string
): TopicDialogueInputV4 {
  return {
    ...structuredClone(input),
    latest_student_message: latestStudentMessage,
    latest_student_turn_id: `e2a10_${suffix}`,
    latest_student_message_classification: suffix
  };
}

function progressionCase(input: {
  case_number: number;
  case_id: string;
  selected_mode: Exclude<TopicDialogueResponseMode, "remain_in_dialogue">;
  latest_student_message: string;
  scenario_truth_summary: string;
}): E2A10TopicDialogueCase {
  const source = progressionSource(input.selected_mode);
  return {
    case_id: input.case_id,
    case_number: input.case_number,
    selected_mode: input.selected_mode,
    selected_operation: null,
    routing_classification: null,
    dialogue_input: withLatestMessage(
      source.dialogue_input,
      input.latest_student_message,
      input.selected_mode
    ),
    distractor_anchor: source.distractor_anchor,
    misconception_target: source.misconception_target,
    evidence_needed:
      "Language limited to the exact progression mode authorized by the platform.",
    strategies_already_attempted: [],
    strategies_marked_unsuccessful: [],
    scenario_truth_summary: input.scenario_truth_summary,
    require_tenth_turn_context: false
  };
}

export function e2a10CanaryCases(): E2A10TopicDialogueCase[] {
  const operationCases = e2a9HeldOutOperationCases().map((entry, index) => ({
    case_id: entry.case_id.replace("e2a9_held_out", "e2a10_v7"),
    case_number: index + 1,
    selected_mode: "remain_in_dialogue" as const,
    selected_operation: entry.operation,
    routing_classification: entry.routing_classification,
    dialogue_input: structuredClone(entry.dialogue_input),
    distractor_anchor: entry.distractor_anchor,
    misconception_target: entry.misconception_target,
    evidence_needed: entry.evidence_needed,
    strategies_already_attempted: [...entry.strategies_already_attempted],
    strategies_marked_unsuccessful:
      [...entry.strategies_marked_unsuccessful],
    scenario_truth_summary:
      `The platform selected ${entry.operation}; generation must remain within that operation and preserve the active distractor boundary.`,
    require_tenth_turn_context: [
      "clarify_concept_with_new_strategy",
      "repair_recurrence"
    ].includes(entry.operation)
  }));
  const cases: E2A10TopicDialogueCase[] = [
    ...operationCases,
    progressionCase({
      case_number: 8,
      case_id: "e2a10_v7_revision_authorized",
      selected_mode: "request_revision",
      latest_student_message:
        "I can now separate evidence about consistent scores from evidence about what those scores mean.",
      scenario_truth_summary:
        "The platform accepted the bounded distinction and authorized revision only."
    }),
    progressionCase({
      case_number: 9,
      case_id: "e2a10_v7_transfer_authorized",
      selected_mode: "present_transfer",
      latest_student_message:
        "My revised explanation now limits reliability to consistency and treats validity as a separate interpretation claim.",
      scenario_truth_summary:
        "The platform accepted the revision and authorized transfer presentation only."
    }),
    progressionCase({
      case_number: 10,
      case_id: "e2a10_v7_completion_authorized",
      selected_mode: "complete_episode",
      latest_student_message:
        "In the new context, I again kept consistency evidence separate from evidence for the intended interpretation.",
      scenario_truth_summary:
        "The platform accepted the bounded transfer evidence and authorized completion only."
    })
  ];
  if (cases.length !== 10) throw new Error("e2a10_case_inventory_invalid");
  if (cases.filter((entry) => entry.require_tenth_turn_context).length !== 2) {
    throw new Error("e2a10_tenth_turn_inventory_invalid");
  }
  if (new Set(cases.map((entry) => entry.case_id)).size !== cases.length) {
    throw new Error("e2a10_case_ids_not_unique");
  }
  return cases;
}

export function e2a10ProtocolSnapshot() {
  const cases = e2a10CanaryCases();
  return {
    protocol_version: E2A10_PROTOCOL_VERSION,
    case_count: cases.length,
    provider_case_concurrency: 1,
    maximum_regenerations_per_case: 1,
    human_review_required: true,
    approval_allowed: false,
    activation_allowed: false,
    thirty_case_evaluation_included: false,
    e2a_student_simulator_included: false,
    full_36_session_matrix_included: false,
    cases: cases.map((entry) => ({
      case_id: entry.case_id,
      case_number: entry.case_number,
      selected_mode: entry.selected_mode,
      selected_operation: entry.selected_operation,
      routing_classification: entry.routing_classification,
      student_turn_number: entry.dialogue_input.dialogue_turn_number,
      visible_prior_turn_count:
        entry.dialogue_input.visible_dialogue_history.length,
      require_tenth_turn_context: entry.require_tenth_turn_context
    }))
  };
}

export function e2a10ProtocolHash() {
  return stableHash(e2a10ProtocolSnapshot());
}
