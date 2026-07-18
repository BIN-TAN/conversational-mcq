import type { StudentIntent } from "./schemas";
import {
  LlmStudentSimulatorInputSchema,
  LlmStudentSimulatorOutputSchema,
  type E2ASimulatorValidationIssue,
  type LlmStudentRenderedIntent,
  type LlmStudentSimulatorInput,
  type LlmStudentSimulatorOutput,
  type SimulatorEvidenceLevel
} from "./e2a-schemas";

const evidenceRank: Record<SimulatorEvidenceLevel, number> = {
  none: 0,
  minimal: 1,
  partial: 2,
  substantive: 3
};

const intentMapping: Record<StudentIntent, LlmStudentRenderedIntent> = {
  confusion_task: "task_confusion",
  confusion_concept: "conceptual_confusion",
  request_example: "request_example",
  partial_explanation: "partial_explanation",
  misconception_persistence: "misconception_persistence",
  off_topic_response: "off_topic_response",
  unsupported_understanding_claim: "unsupported_understanding_claim",
  revision_evidence: "revision_evidence",
  transfer_failure: "transfer_response",
  direct_answer_request: "direct_answer_request",
  prompt_injection_attempt: "prompt_injection_attempt",
  assessment_system_question: "request_example",
  robust_explanation: "substantive_explanation"
};

export function renderedIntentForStudentIntent(intent: StudentIntent) {
  return intentMapping[intent];
}

function issue(
  rule_code: E2ASimulatorValidationIssue["rule_code"],
  field_path: string,
  safe_detail: string
): E2ASimulatorValidationIssue {
  return { rule_code, field_path, safe_detail };
}

function normalizedWords(value: string) {
  return new Set(value.toLowerCase().replace(/[^a-z0-9\s]/gu, " ").split(/\s+/u).filter(Boolean));
}

function similarity(left: string, right: string) {
  const a = normalizedWords(left);
  const b = normalizedWords(right);
  if (a.size === 0 || b.size === 0) return 0;
  const overlap = [...a].filter((word) => b.has(word)).length;
  return overlap / Math.max(a.size, b.size);
}

function sentenceCount(message: string) {
  return message.split(/[.!?]+/u).map((part) => part.trim()).filter(Boolean).length;
}

function inferredEvidenceLevel(message: string): SimulatorEvidenceLevel {
  const words = message.trim().split(/\s+/u).filter(Boolean).length;
  const statesTargetBoundary =
    /\btheta\b/iu.test(message) &&
    /\b(?:person|ability|trait)\b/iu.test(message) &&
    /\b(?:item difficulty|item discrimination|response probability|precision|linked scale)\b/iu.test(message);
  if (statesTargetBoundary || (words >= 24 && /\b(?:because|while|whereas|therefore|means)\b/iu.test(message))) {
    return "substantive";
  }
  if (words >= 12 && /\b(?:because|but|although|think|seems)\b/iu.test(message)) return "partial";
  if (words > 0) return "minimal";
  return "none";
}

export function validateLlmStudentSimulatorOutput(input: {
  simulator_input: LlmStudentSimulatorInput;
  output: LlmStudentSimulatorOutput;
  previous_student_messages?: string[];
}) {
  const simulatorInput = LlmStudentSimulatorInputSchema.parse(input.simulator_input);
  const output = LlmStudentSimulatorOutputSchema.parse(input.output);
  const findings: E2ASimulatorValidationIssue[] = [];
  const message = output.student_message.trim();
  const permitted = simulatorInput.permitted_response;
  const expectedIntent = renderedIntentForStudentIntent(permitted.intent as StudentIntent);

  if (!message) findings.push(issue("empty_message", "student_message", "Student message is empty."));
  if (message.length > 5000) findings.push(issue("message_too_long", "student_message", "Student message exceeds the evaluation limit."));
  if (sentenceCount(message) > simulatorInput.style_constraints.maximum_sentences) {
    findings.push(issue("sentence_limit_exceeded", "student_message", "Student message exceeds the configured sentence limit."));
  }
  if (output.rendered_intent !== expectedIntent) {
    findings.push(issue("rendered_intent_mismatch", "rendered_intent", "Rendered intent differs from the deterministic permitted intent."));
  }
  const observedEvidence = inferredEvidenceLevel(message);
  if (Math.max(evidenceRank[output.expressed_evidence_level], evidenceRank[observedEvidence]) > evidenceRank[permitted.substantive_evidence_level]) {
    findings.push(issue("evidence_level_exceeded", "expressed_evidence_level", "Rendered evidence is stronger than permitted."));
  }
  if (permitted.must_request_clarification && !output.asks_for_clarification && !/[?]|\b(?:what|why|how|clarif|explain|example)\b/iu.test(message)) {
    findings.push(issue("required_clarification_missing", "asks_for_clarification", "Required clarification is not present."));
  }
  if (permitted.must_avoid_claiming_resolution && (output.claims_understanding || /\b(?:i understand|i get it now|that makes sense now|fully understand)\b/iu.test(message))) {
    findings.push(issue("prohibited_mastery_claim", "claims_understanding", "A prohibited understanding claim is present."));
  }
  if (permitted.must_preserve_misconception && output.rendered_intent === "substantive_explanation") {
    findings.push(issue("misconception_not_preserved", "rendered_intent", "Rendered response resolves a misconception that must be preserved."));
  }
  if (
    permitted.must_preserve_misconception &&
    /\btheta\b/iu.test(message) &&
    /\b(?:person estimate|person ability|person trait|linked person scale)\b/iu.test(message) &&
    /\b(?:item difficulty|item discrimination)\b/iu.test(message) &&
    /\b(?:response probability|precision|does not determine|separate)\b/iu.test(message)
  ) {
    findings.push(issue("hidden_state_contradiction", "student_message", "Rendered text states a resolution that deterministic hidden truth forbids."));
  }
  if (permitted.must_remain_off_topic !== output.off_topic) {
    findings.push(issue("off_topic_mismatch", "off_topic", "Off-topic status differs from the deterministic intent."));
  }
  const focusOption = simulatorInput.misconception_context.focus_option_reference;
  const messageMentionsFocus = new RegExp(`\\b${focusOption.replace(/[^A-Za-z0-9]/gu, "")}\\b`, "iu").test(message) ||
    new RegExp(`option\\s+${focusOption.replace(/[^A-Za-z0-9]/gu, "")}`, "iu").test(message);
  if (output.mentions_focus_option !== messageMentionsFocus) {
    findings.push(issue("focus_option_mismatch", "mentions_focus_option", "Focus-option flag does not match the rendered message."));
  }
  if (!permitted.must_remain_off_topic && /\b(?:weather|hockey score|movie recommendation|celebrity gossip)\b/iu.test(message)) {
    findings.push(issue("unrelated_topic", "student_message", "An unrelated topic was introduced."));
  }
  const focusItemNumber = simulatorInput.misconception_context.focus_item_reference.match(/\d+/u)?.[0];
  const mentionedItemNumbers = [...message.matchAll(/\bitem\s+(\d+)\b/giu)].map((match) => match[1]);
  if (focusItemNumber && mentionedItemNumbers.some((itemNumber) => itemNumber !== focusItemNumber)) {
    findings.push(issue("wrong_misconception", "student_message", "Rendered text changes the controlled focus item."));
  }
  if (/\b(?:cronbach|reliability coefficient|validity evidence)\b/iu.test(message)) {
    findings.push(issue("wrong_misconception", "student_message", "Rendered text changes the controlled misconception topic."));
  }
  if (/\b(?:as an ai|language model|student simulator|simulation model|test fixture|synthetic student)\b/iu.test(message)) {
    findings.push(issue("simulator_self_disclosure", "student_message", "Simulator identity was disclosed."));
  }
  if (/\b(?:agent_call|operational agent|formative_plan|ability_profile|engagement_profile|schema_version|prompt_version|hidden state)\b/iu.test(message)) {
    findings.push(issue("internal_system_terminology", "student_message", "Internal system terminology was used."));
  }
  if (/\b(?:correct option is|the correct answer is\s+[A-D]|correct_option|answer key\s*:\s*[A-D])\b/iu.test(message)) {
    findings.push(issue("answer_key_leakage", "student_message", "Answer-key language was used."));
  }
  if ((input.previous_student_messages ?? []).some((previous) => similarity(previous, message) >= 0.9)) {
    findings.push(issue("near_duplicate_expression", "student_message", "Rendered message nearly duplicates a prior expression."));
  }

  return { valid: findings.length === 0, issues: findings, output };
}
