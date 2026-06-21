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
  /system prompt/i,
  /hidden instructions?/i,
  /backend rules?/i,
  /\bcheat(?:ed|ing)?\b/i,
  /\bdishonest(?:y)?\b/i,
  /\bmisconduct\b/i,
  /\bused\s+genai\b/i,
  /\bgenai\s+use\s+(?:confirmed|proven)\b/i
];

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

  if (issues.length > 0) {
    throw new FollowupSemanticValidationError(issues);
  }

  return { warnings };
}

export function trustedFollowupEventTypes() {
  return [...trustedEventTypes];
}
