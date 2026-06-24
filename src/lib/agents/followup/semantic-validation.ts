import type { AgentOutputByName } from "@/lib/agents/contracts";
import { FollowupActionType } from "@/lib/agents/contracts";
import { ProcessEventTypeSchema } from "@/lib/domain/enums";
import type { FollowupContextConfig } from "./context";

type FollowupOutput = AgentOutputByName["followup_agent"];

const trustedEventTypes = new Set([
  "followup_task_assigned",
  "followup_turn_completed",
  "off_topic_followup",
  "prompt_injection_attempt"
]);

const prohibitedPatterns = [
  /change (the )?(assessment )?phase/i,
  /transition (the )?session/i,
  /overwrite (the )?initial/i,
  /update (the )?student profile/i,
  /create (a )?(new )?formative decision/i,
  /\b(system prompt|hidden instructions?|backend rules?)\s+(is|are|says?|state|:)/i,
  /\bcheat(?:ed|ing)?\b/i,
  /\bdishonest(?:y)?\b/i,
  /\bmisconduct\b/i,
  /\bused\s+genai\b/i,
  /\bgenai\s+use\s+(?:confirmed|proven)\b/i
];

function containsMoveOnRequest(message: string | null | undefined) {
  if (!message) {
    return false;
  }

  return /\b(move on|continue|next|done|finished|go ahead|ready to proceed)\b/i.test(message);
}

function isMoveOnOnlyTechnicalTrigger(input: {
  output: FollowupOutput;
  student_message?: string | null;
}) {
  return (
    input.output.should_offer_move_on &&
    containsMoveOnRequest(input.student_message) &&
    input.output.evidence_trigger_reasons.length === 1 &&
    input.output.evidence_trigger_reasons[0] === "move_on_request"
  );
}

export class FollowupSemanticValidationError extends Error {
  issues: string[];

  constructor(issues: string[]) {
    super(`Follow-up semantic validation failed: ${issues.join("; ")}`);
    this.name = "FollowupSemanticValidationError";
    this.issues = issues;
  }
}

export function validateFollowupSemantics(input: {
  output: FollowupOutput;
  current_formative_value: string;
  config: FollowupContextConfig;
  turn_type?: "opening" | "student_reply";
  student_message?: string | null;
}) {
  const issues: string[] = [];
  const warnings: string[] = [];
  const output = input.output;

  if (!output.assistant_message.trim()) {
    issues.push("assistant_message must be nonempty");
  }

  if (output.assistant_message.length > input.config.message_max_chars) {
    issues.push("assistant_message exceeds configured maximum length");
  }

  if (output.target_formative_value !== input.current_formative_value) {
    issues.push("target_formative_value must match the saved formative decision");
  }

  if (!FollowupActionType.safeParse(output.followup_action_type).success) {
    issues.push("followup_action_type is not approved");
  }

  if (output.evidence_request !== null && !output.evidence_request.trim()) {
    issues.push("evidence_request must be null or nonempty");
  }

  if (input.turn_type === "opening") {
    if (output.student_turn_substantive) {
      issues.push("opening turns must use student_turn_substantive=false");
    }

    if (output.evidence_trigger_candidate) {
      issues.push("opening turns must not set evidence_trigger_candidate=true");
    }

    if (output.evidence_trigger_reasons.length > 0) {
      issues.push("opening turns must use evidence_trigger_reasons=[]");
    }
  }

  const moveOnOnlyTechnicalTrigger = isMoveOnOnlyTechnicalTrigger({
    output,
    student_message: input.student_message
  });

  if (
    !output.student_turn_substantive &&
    output.evidence_trigger_reasons.length > 0 &&
    !moveOnOnlyTechnicalTrigger
  ) {
    issues.push("nonsubstantive turns must use evidence_trigger_reasons=[]");
  }

  if (
    output.evidence_trigger_candidate &&
    !output.student_turn_substantive &&
    !moveOnOnlyTechnicalTrigger
  ) {
    issues.push("evidence_trigger_candidate requires an interpretable substantive student turn.");
  }

  if (output.evidence_trigger_candidate && output.evidence_trigger_reasons.length === 0) {
    issues.push("evidence_trigger_candidate requires at least one approved evidence trigger reason.");
  }

  if (output.followup_action_type === "off_topic_redirect") {
    if (!output.off_topic_detected) {
      issues.push("off_topic_redirect requires off_topic_detected=true");
    }

    if (output.student_turn_substantive) {
      issues.push("pure off_topic_redirect must use student_turn_substantive=false");
    }

    if (output.evidence_trigger_candidate) {
      issues.push("pure off_topic_redirect must use evidence_trigger_candidate=false");
    }

    if (output.evidence_trigger_reasons.length > 0) {
      issues.push("pure off_topic_redirect must use evidence_trigger_reasons=[]");
    }

    if (output.should_offer_move_on) {
      issues.push("pure off_topic_redirect must use should_offer_move_on=false");
    }
  }

  if (
    output.evidence_trigger_reasons.includes("move_on_request") &&
    !containsMoveOnRequest(input.student_message)
  ) {
    issues.push("move_on_request evidence trigger requires an explicit move-on request in the student message.");
  }

  if (output.should_offer_move_on && !containsMoveOnRequest(input.student_message)) {
    issues.push("should_offer_move_on cannot be inferred from unrelated conversation.");
  }

  if (moveOnOnlyTechnicalTrigger && output.student_turn_substantive) {
    issues.push("pure move-on requests should not be counted as substantive conceptual evidence.");
  }

  for (const event of output.events_to_log) {
    const parsedType = ProcessEventTypeSchema.safeParse(event.event_type);

    if (!parsedType.success || !trustedEventTypes.has(parsedType.data)) {
      issues.push(`events_to_log contains untrusted event type: ${event.event_type}`);
    }

    if (event.event_source !== "agent") {
      issues.push("events_to_log entries must use event_source=agent");
    }
  }

  for (const pattern of prohibitedPatterns) {
    if (pattern.test(output.assistant_message)) {
      issues.push("assistant_message contains prohibited state, hidden-instruction, or misconduct language");
      break;
    }
  }

  const valueToLikelyActions: Record<string, string[]> = {
    diagnostic_clarification: ["clarification_prompt", "explanation", "hint", "off_topic_redirect"],
    reasoning_refinement: ["reasoning_refinement_prompt", "hint", "explanation", "off_topic_redirect"],
    confidence_calibration: ["confidence_calibration_prompt", "clarification_prompt", "off_topic_redirect"],
    independent_understanding_verification: [
      "independent_verification_prompt",
      "clarification_prompt",
      "off_topic_redirect"
    ],
    consolidation_or_transfer: ["transfer_task", "explanation", "move_on_offer", "off_topic_redirect"]
  };
  const likelyActions = valueToLikelyActions[input.current_formative_value] ?? [];

  if (likelyActions.length > 0 && !likelyActions.includes(output.followup_action_type)) {
    warnings.push(
      `followup_action_type ${output.followup_action_type} is weakly aligned with ${input.current_formative_value}`
    );
  }

  if (
    input.current_formative_value === "consolidation_or_transfer" &&
    output.followup_action_type === "independent_verification_prompt"
  ) {
    issues.push("consolidation_or_transfer plans must not silently become independent verification prompts.");
  }

  if (
    input.current_formative_value === "independent_understanding_verification" &&
    output.followup_action_type === "transfer_task"
  ) {
    issues.push("independent verification plans must not silently become transfer tasks.");
  }

  if (issues.length > 0) {
    throw new FollowupSemanticValidationError(issues);
  }

  return { warnings };
}

export function trustedFollowupEventTypes() {
  return [...trustedEventTypes];
}
