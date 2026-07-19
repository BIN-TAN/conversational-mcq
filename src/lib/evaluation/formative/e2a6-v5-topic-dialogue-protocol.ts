import { stableHash } from "@/lib/operational/stable-hash";
import { classifyTopicDialogueStudentMessage } from
  "@/lib/services/student-assessment/topic-dialogue-agent";
import {
  e2a3TopicDialogueCases,
  type E2A3TopicDialogueCase
} from "./e2a3-topic-dialogue-protocol";
import { TopicDialogueInputV3Schema } from
  "./e2a-topic-dialogue-contract-candidate";
import {
  E2A5_PROGRESSION_AUTHORIZATION_VERSION,
  E2A5_TOPIC_DIALOGUE_INPUT_SCHEMA_VERSION,
  TopicDialogueInputV4Schema,
  toTopicDialogueInputV4,
  type TopicDialogueAuthorizedAction,
  type TopicDialogueInputV4
} from "./e2a5-topic-dialogue-progression-contract";

export const E2A6_PROTOCOL_VERSION =
  "e2a6-v5-topic-dialogue-provider-evaluation-v1" as const;

export type E2A6CasePhase = "dispatch_canary" | "full_protocol";

export type E2A6TopicDialogueCase = {
  case_id: string;
  source_case_id: string;
  category: string;
  repetition_index: number;
  student_turn_count: number;
  tenth_turn: boolean;
  phase: E2A6CasePhase;
  description: string;
  input: TopicDialogueInputV4;
  context_case: E2A3TopicDialogueCase;
  expected_authorized_action: TopicDialogueAuthorizedAction;
  expected_response_functions: string[];
  prior_strategy_functions: string[];
  require_distractor_anchor: boolean;
  require_strategy_adaptation: boolean;
  unsupported_understanding: boolean;
  recurrence: boolean;
  revision_transfer_boundary: boolean;
};

function sourceCase(caseId: string) {
  const value = e2a3TopicDialogueCases().find((entry) => entry.case_id === caseId);
  if (!value) throw new Error(`e2a6_source_case_missing:${caseId}`);
  return value;
}

function withLatestEvidence(input: {
  source: E2A3TopicDialogueCase;
  latest_student_message: string;
  post_activity_status?: "ready_to_advance" | "specific_misconception_remaining";
}) {
  const nextInput = TopicDialogueInputV3Schema.parse({
    ...input.source.input,
    latest_student_message: input.latest_student_message,
    post_activity_status:
      input.post_activity_status ?? input.source.input.post_activity_status
  });
  return {
    ...input.source,
    input: nextInput
  } satisfies E2A3TopicDialogueCase;
}

function evaluationCase(input: {
  case_id: string;
  source: E2A3TopicDialogueCase;
  phase: E2A6CasePhase;
  authorized_action: TopicDialogueAuthorizedAction;
  description?: string;
  expected_response_functions?: string[];
  require_strategy_adaptation?: boolean;
  unsupported_understanding?: boolean;
  recurrence?: boolean;
}) {
  const dialogueInput = toTopicDialogueInputV4({
    dialogue_input: input.source.input,
    requested_authorized_action: input.authorized_action
  });
  if (dialogueInput.progression_authorization.authorized_action !== input.authorized_action) {
    throw new Error(
      `e2a6_fixture_authorization_rejected:${input.case_id}:${input.authorized_action}`
    );
  }
  const latestFunction = classifyTopicDialogueStudentMessage(
    dialogueInput.latest_student_message
  ).student_message_function;
  const directResponseFunctions = latestFunction === "conceptual_question" ||
    latestFunction === "assessment_system_question"
    ? ["answer_student_question"]
    : latestFunction === "clarification_request" ||
        latestFunction === "prompt_instruction_question" ||
        latestFunction === "unclear_but_valid"
      ? ["clarification"]
      : latestFunction === "request_for_example"
        ? ["worked_example", "foundational_scaffold"]
        : latestFunction === "off_topic"
          ? ["topic_redirect"]
          : [];
  return {
    case_id: input.case_id,
    source_case_id: input.source.case_id,
    category: input.source.category,
    repetition_index: input.source.repetition_index,
    student_turn_count: input.source.student_turn_count,
    tenth_turn: input.source.expectation.tenth_turn,
    phase: input.phase,
    description: input.description ?? input.source.description,
    input: dialogueInput,
    context_case: input.source,
    expected_authorized_action: input.authorized_action,
    expected_response_functions: [
      ...(input.expected_response_functions ?? input.source.expectation.expected_response_functions),
      ...directResponseFunctions
    ].filter((value, index, values) => values.indexOf(value) === index),
    prior_strategy_functions: input.source.expectation.prior_strategy_functions,
    require_distractor_anchor: input.source.expectation.require_distractor_anchor,
    require_strategy_adaptation: input.require_strategy_adaptation ?? (
      input.source.expectation.recurrence ||
      input.source.category === "repeated_conceptual_confusion"
    ),
    unsupported_understanding:
      input.unsupported_understanding ?? input.source.expectation.unsupported_understanding,
    recurrence: input.recurrence ?? input.source.expectation.recurrence,
    revision_transfer_boundary: input.source.expectation.revision_transfer_boundary
  } satisfies E2A6TopicDialogueCase;
}

export function e2a6DispatchCanaryCases(): E2A6TopicDialogueCase[] {
  const unsupported = sourceCase("e2a3_unsupported_understanding_01");
  const repeated = sourceCase("e2a3_repeated_conceptual_confusion_01");
  const revisionSource = withLatestEvidence({
    source: sourceCase("e2a3_revision_transfer_boundary_1"),
    latest_student_message:
      "My revision says reliability supports score consistency, while validity still needs separate evidence for the intended interpretation.",
    post_activity_status: "ready_to_advance"
  });
  const transferSource = withLatestEvidence({
    source: sourceCase("e2a3_revision_transfer_boundary_2"),
    latest_student_message:
      "My revision separates reliability-based score consistency from validity evidence for an intended interpretation, so the distinction can now be checked in a transfer item.",
    post_activity_status: "ready_to_advance"
  });
  const completionSource = withLatestEvidence({
    source: sourceCase("e2a3_baseline_turn_8_v1"),
    latest_student_message:
      "On the transfer item, I separated score consistency from interpretation evidence and explained why reliability alone was insufficient.",
    post_activity_status: "ready_to_advance"
  });

  return [
    evaluationCase({
      case_id: "e2a6_canary_remain_unsupported_understanding",
      source: unsupported,
      phase: "dispatch_canary",
      authorized_action: "remain_in_dialogue",
      description: "Unsupported understanding must remain in dialogue.",
      unsupported_understanding: true
    }),
    evaluationCase({
      case_id: "e2a6_canary_remain_repeated_confusion",
      source: repeated,
      phase: "dispatch_canary",
      authorized_action: "remain_in_dialogue",
      description: "Repeated confusion requires a different direct strategy.",
      require_strategy_adaptation: true
    }),
    evaluationCase({
      case_id: "e2a6_canary_revision_authorized",
      source: revisionSource,
      phase: "dispatch_canary",
      authorized_action: "request_revision",
      description: "Server-authorized revision language only.",
      expected_response_functions: ["readiness_confirmation", "focused_question"]
    }),
    evaluationCase({
      case_id: "e2a6_canary_transfer_authorized",
      source: transferSource,
      phase: "dispatch_canary",
      authorized_action: "present_transfer",
      description: "Server-authorized transfer language without completion.",
      expected_response_functions: ["readiness_confirmation", "focused_question"]
    }),
    evaluationCase({
      case_id: "e2a6_canary_completion_authorized",
      source: completionSource,
      phase: "dispatch_canary",
      authorized_action: "complete_episode",
      description: "Server-authorized completion without mastery overclaim.",
      expected_response_functions: ["readiness_confirmation"]
    })
  ];
}

export function e2a6FullProtocolCases(): E2A6TopicDialogueCase[] {
  return e2a3TopicDialogueCases().map((source) => {
    if (source.case_id === "e2a3_revision_transfer_boundary_1") {
      return evaluationCase({
        case_id: source.case_id,
        source: withLatestEvidence({
          source,
          latest_student_message:
            "My revision now limits reliability to score consistency and keeps validity evidence tied to the intended interpretation.",
          post_activity_status: "ready_to_advance"
        }),
        phase: "full_protocol",
        authorized_action: "request_revision",
        expected_response_functions: ["readiness_confirmation", "focused_question"]
      });
    }
    if (source.case_id === "e2a3_revision_transfer_boundary_2") {
      return evaluationCase({
        case_id: source.case_id,
        source: withLatestEvidence({
          source,
          latest_student_message:
            "My revision separates reliability-based score consistency from validity evidence for an intended interpretation, so the distinction can now be checked in a transfer item.",
          post_activity_status: "ready_to_advance"
        }),
        phase: "full_protocol",
        authorized_action: "present_transfer",
        expected_response_functions: ["readiness_confirmation", "focused_question"]
      });
    }
    return evaluationCase({
      case_id: source.case_id,
      source,
      phase: "full_protocol",
      authorized_action: "remain_in_dialogue"
    });
  });
}

export function e2a6ProtocolSnapshot() {
  const canary = e2a6DispatchCanaryCases();
  const full = e2a6FullProtocolCases();
  if (canary.length !== 5 || full.length !== 30) {
    throw new Error("e2a6_protocol_case_inventory_invalid");
  }
  if (full.filter((entry) => entry.tenth_turn).length !== 18) {
    throw new Error("e2a6_tenth_turn_inventory_invalid");
  }
  return {
    protocol_version: E2A6_PROTOCOL_VERSION,
    input_schema_version: E2A5_TOPIC_DIALOGUE_INPUT_SCHEMA_VERSION,
    output_schema_version: "topic-dialogue-output-v3",
    authorization_version: E2A5_PROGRESSION_AUTHORIZATION_VERSION,
    no_llm_judge: true,
    human_review_required: true,
    dispatch_canary_case_count: canary.length,
    full_protocol_case_count: full.length,
    tenth_turn_case_count: full.filter((entry) => entry.tenth_turn).length,
    baseline_or_boundary_case_count: full.filter((entry) => !entry.tenth_turn).length,
    cases: [...canary, ...full].map((entry) => ({
      case_id: entry.case_id,
      source_case_id: entry.source_case_id,
      phase: entry.phase,
      category: entry.category,
      student_turn_count: entry.student_turn_count,
      tenth_turn: entry.tenth_turn,
      authorized_action: entry.expected_authorized_action,
      input_valid: TopicDialogueInputV4Schema.safeParse(entry.input).success
    }))
  };
}

export function e2a6ProtocolHash() {
  return stableHash(e2a6ProtocolSnapshot());
}
