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

export function validateResponseCollectionOutputSemantics(input: {
  output: AgentOutputByName["response_collection_agent"];
  student_message: string;
  assistant_message_max_chars: number;
  has_existing_reasoning: boolean;
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

  if (
    output.reasoning_capture_status === "none" &&
    output.reasoning_evidence_segments.length > 0
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

  if (analysis.requires_option_button && !output.requires_option_button) {
    issues.push("requires_option_button must be true when natural-language option selection is detected.");
  }

  if (analysis.requires_confidence_control && !output.requires_confidence_control) {
    issues.push("requires_confidence_control must be true when natural-language confidence is detected.");
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
