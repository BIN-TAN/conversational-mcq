import type { AgentOutputByName } from "@/lib/agents/contracts";
import { analyzeResponseCollectionMessage } from "./reasoning-extraction";

const forbiddenAssistantPatterns = [
  /\b(the )?correct answer\b/i,
  /\b(option|answer)\s+[a-f]\s+(is|would be)\s+(correct|best|right)\b/i,
  /\bchoose\s+(option\s+)?[a-f]\b/i,
  /\byour reasoning is (correct|incorrect|right|wrong)\b/i,
  /\byou are (correct|incorrect|right|wrong)\b/i
];

export type ResponseCollectionSemanticValidation = {
  ok: boolean;
  issues: string[];
};

function arraysOverlap(left: string[], right: string[]) {
  return left.some((value) => right.includes(value));
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function truthyState(value: unknown) {
  return value === true || (typeof value === "string" && value.trim().length > 0);
}

function normalizeMissingField(field: string) {
  const normalized = field.trim().toLowerCase();

  if (["answer", "option", "selected_option", "selected option"].includes(normalized)) {
    return "answer";
  }

  if (["confidence", "confidence_rating", "confidence rating"].includes(normalized)) {
    return "confidence";
  }

  if (["reasoning", "reasoning_text", "reasoning text"].includes(normalized)) {
    return "reasoning";
  }

  return normalized;
}

function missingEvidenceFields(input: {
  collected_response_state?: unknown;
  missing_evidence_state?: unknown;
}) {
  const collected = asRecord(input.collected_response_state);
  const missing = asRecord(input.missing_evidence_state);
  const fields = new Set<string>();

  let sawExplicitMissingList = false;

  for (const key of ["missing_fields", "required_missing_fields", "evidence_missing", "missing"]) {
    for (const field of stringArray(missing[key])) {
      sawExplicitMissingList = true;
      fields.add(normalizeMissingField(field));
    }
  }

  const fieldAliases: Array<[string, string[]]> = [
    ["answer", ["missing_answer", "answer_missing", "selected_option_missing"]],
    ["reasoning", ["missing_reasoning", "reasoning_missing"]],
    ["confidence", ["missing_confidence", "confidence_missing"]]
  ];

  for (const [field, keys] of fieldAliases) {
    if (keys.some((key) => missing[key] === true)) {
      fields.add(field);
    }
  }

  const selectedOptionPresent =
    truthyState(collected.selected_option) ||
    collected.selected_option_present === true ||
    collected.answer_present === true;
  const reasoningSatisfied =
    truthyState(collected.reasoning_text) ||
    collected.reasoning_present === true ||
    collected.reasoning_skip_confirmed === true ||
    collected.skipped_reasoning === true;
  const confidenceSatisfied =
    truthyState(collected.confidence_rating) ||
    collected.confidence_present === true ||
    collected.confidence_skip_confirmed === true ||
    collected.skipped_confidence === true;

  if (!sawExplicitMissingList) {
    if (!selectedOptionPresent) {
      fields.add("answer");
    }

    if (!reasoningSatisfied) {
      fields.add("reasoning");
    }

    if (!confidenceSatisfied) {
      fields.add("confidence");
    }
  }

  return fields;
}

export function validateResponseCollectionOutputSemantics(input: {
  output: AgentOutputByName["response_collection_agent"];
  student_message: string;
  assistant_message_max_chars: number;
  has_existing_reasoning: boolean;
  collected_response_state?: unknown;
  missing_evidence_state?: unknown;
}): ResponseCollectionSemanticValidation {
  const issues: string[] = [];
  const { output } = input;
  const analysis = analyzeResponseCollectionMessage({
    message: input.student_message,
    has_existing_reasoning: input.has_existing_reasoning
  });

  if (!output.assistant_message.trim()) {
    issues.push("assistant_message must be nonempty.");
  }

  if (output.assistant_message.length > input.assistant_message_max_chars) {
    issues.push("assistant_message exceeds the configured maximum length.");
  }

  for (const segment of output.reasoning_evidence_segments) {
    if (!input.student_message.includes(segment)) {
      issues.push("reasoning_evidence_segments must be exact substrings of student_message.");
    }
  }

  for (const segment of analysis.reasoning_evidence_segments) {
    if (!output.reasoning_evidence_segments.includes(segment)) {
      issues.push("Valid reasoning in a mixed message must be captured as an exact reasoning_evidence_segments entry.");
    }
  }

  if (
    output.reasoning_capture_status === "none" &&
    (output.reasoning_evidence_segments.length > 0 || analysis.reasoning_evidence_segments.length > 0)
  ) {
    issues.push("reasoning_capture_status none cannot include reasoning segments.");
  }

  if (
    output.reasoning_capture_status !== "none" &&
    output.reasoning_evidence_segments.length === 0
  ) {
    issues.push("reasoning_capture_status requires at least one reasoning segment.");
  }

  const helpIntents = [
    "invalid_help_request",
    "hint_request",
    "correctness_request",
    "explanation_request",
    "content_clarification_request",
    "prompt_injection_attempt"
  ];

  if (arraysOverlap(output.recognized_intents, helpIntents) && !output.blocked_content_help) {
    issues.push("blocked_content_help must be true for help, correctness, explanation, or prompt-injection intents.");
  }

  if (arraysOverlap(output.recognized_intents, helpIntents)) {
    const eventTypes = output.events_to_log.map((event) => event.event_type);

    if (
      output.recognized_intents.includes("prompt_injection_attempt") &&
      !eventTypes.includes("prompt_injection_attempt")
    ) {
      issues.push("prompt_injection_attempt intent requires a prompt_injection_attempt event.");
    }

    if (
      !output.recognized_intents.includes("procedural_clarification") &&
      !eventTypes.includes("invalid_help_request")
    ) {
      issues.push("Disallowed help intents require an invalid_help_request event.");
    }
  }

  if (analysis.requires_option_button && !output.requires_option_button) {
    issues.push("requires_option_button must be true when natural-language option selection is detected.");
  }

  if (analysis.requires_confidence_control && !output.requires_confidence_control) {
    issues.push("requires_confidence_control must be true when natural-language confidence is detected.");
  }

  const missingFields = missingEvidenceFields({
    collected_response_state: input.collected_response_state,
    missing_evidence_state: input.missing_evidence_state
  });

  if (output.missing_evidence_status === "complete" && missingFields.size > 0) {
    issues.push(
      `missing_evidence_status=complete conflicts with backend missing evidence: ${[...missingFields].sort().join(", ")}.`
    );
  }

  if (output.missing_evidence_status === "missing_answer" && !missingFields.has("answer")) {
    issues.push("missing_evidence_status=missing_answer conflicts with backend response state.");
  }

  if (output.missing_evidence_status === "missing_reasoning" && !missingFields.has("reasoning")) {
    issues.push("missing_evidence_status=missing_reasoning conflicts with backend response state.");
  }

  if (output.missing_evidence_status === "missing_confidence" && !missingFields.has("confidence")) {
    issues.push("missing_evidence_status=missing_confidence conflicts with backend response state.");
  }

  if (
    output.missing_evidence_status !== "multiple_missing_fields" &&
    missingFields.size > 1
  ) {
    issues.push("missing_evidence_status must be multiple_missing_fields when more than one required evidence field is missing.");
  }

  if (
    forbiddenAssistantPatterns.some((pattern) => pattern.test(output.assistant_message))
  ) {
    issues.push("assistant_message appears to reveal correctness, evaluate reasoning, or recommend an option.");
  }

  const serialized = JSON.stringify(output).toLowerCase();
  const forbiddenPayloadKeys = [
    "correct_option",
    "ability_profile",
    "engagement_profile",
    "integrated_diagnostic_profile",
    "formative_value",
    "formative_action_plan",
    "phase_update",
    "selected_option_update",
    "confidence_rating_update",
    "cheating",
    "misconduct",
    "genai use confirmed"
  ];

  for (const key of forbiddenPayloadKeys) {
    if (serialized.includes(key)) {
      issues.push(`Output contains forbidden orchestration or misconduct field/text: ${key}.`);
    }
  }

  return {
    ok: issues.length === 0,
    issues
  };
}
