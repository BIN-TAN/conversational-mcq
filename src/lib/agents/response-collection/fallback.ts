import type { AgentOutputByName } from "@/lib/agents/contracts";
import { analyzeResponseCollectionMessage } from "./reasoning-extraction";

export type ResponseCollectionFallbackReason =
  | "deterministic_mode"
  | "mock_provider_disabled"
  | "live_provider_not_ready"
  | "agent_execution_failed"
  | "semantic_validation_failed"
  | "usage_blocked";

function assistantMessage(input: {
  blocked_content_help: boolean;
  reasoningSaved: boolean;
  requiresOptionButton: boolean;
  requiresConfidenceControl: boolean;
  requestedControlAction: string;
}) {
  if (input.blocked_content_help) {
    return "I can't provide hints, explanations, answer checks, or answer choices during the initial questions. Use the option buttons to choose an answer and the confidence buttons to report confidence.";
  }

  if (input.requestedControlAction === "save_and_exit") {
    return "Use the Save and exit button when you want to leave and continue later.";
  }

  if (input.requestedControlAction === "skip_item") {
    return "Use the skip controls if you want to continue with missing evidence.";
  }

  if (input.reasoningSaved) {
    return "I saved the reasoning you provided. Use the option buttons to choose an answer and the confidence buttons to report confidence.";
  }

  if (input.requiresOptionButton || input.requiresConfidenceControl) {
    return "Use the option buttons to choose an answer and the confidence buttons to report confidence.";
  }

  return "Please write your reasoning in your own words, or use the structured controls to continue.";
}

export function buildResponseCollectionFallback(input: {
  student_message: string;
  has_existing_reasoning: boolean;
  fallback_reason: ResponseCollectionFallbackReason;
}): AgentOutputByName["response_collection_agent"] {
  const analysis = analyzeResponseCollectionMessage({
    message: input.student_message,
    has_existing_reasoning: input.has_existing_reasoning
  });
  const reasoningSaved = analysis.reasoning_evidence_segments.length > 0;

  return {
    agent_name: "response_collection_agent",
    agent_version: "deterministic-fallback",
    prompt_version: "response-collection-fallback-v1",
    schema_version: "response-collection-output-v2",
    output_status: "ok",
    warnings: [`Deterministic fallback used: ${input.fallback_reason}.`],
    assistant_message: assistantMessage({
      blocked_content_help: analysis.blocked_content_help,
      reasoningSaved,
      requiresOptionButton: analysis.requires_option_button,
      requiresConfidenceControl: analysis.requires_confidence_control,
      requestedControlAction: analysis.requested_control_action
    }),
    intervention_type: analysis.blocked_content_help
      ? "boundary_redirect"
      : analysis.requested_control_action === "save_and_exit"
        ? "save_and_exit_confirmation"
        : "procedural_clarification",
    should_advance: false,
    blocked_content_help: analysis.blocked_content_help,
    missing_evidence_status: "not_applicable",
    recognized_intents: analysis.recognized_intents,
    reasoning_capture_status: analysis.reasoning_capture_status,
    reasoning_evidence_segments: analysis.reasoning_evidence_segments,
    requires_option_button: analysis.requires_option_button,
    requires_confidence_control: analysis.requires_confidence_control,
    requested_control_action: analysis.requested_control_action,
    recommended_interaction_outcome: analysis.recommended_interaction_outcome,
    events_to_log: [
      ...(analysis.blocked_content_help
        ? [
            {
              event_type: "invalid_help_request" as const,
              event_category: "initial_administration",
              event_source: "system" as const,
              payload: { fallback_reason: input.fallback_reason }
            }
          ]
        : []),
      ...(analysis.recognized_intents.includes("prompt_injection_attempt")
        ? [
            {
              event_type: "prompt_injection_attempt" as const,
              event_category: "initial_administration",
              event_source: "system" as const,
              payload: { fallback_reason: input.fallback_reason }
            }
          ]
        : []),
      ...(analysis.recognized_intents.includes("procedural_clarification")
        ? [
            {
              event_type: "procedural_clarification_request" as const,
              event_category: "initial_administration",
              event_source: "system" as const,
              payload: { fallback_reason: input.fallback_reason }
            }
          ]
        : []),
      ...(analysis.recognized_intents.includes("frustration_or_uncertainty")
        ? [
            {
              event_type: "emotional_or_frustration_response" as const,
              event_category: "initial_administration",
              event_source: "system" as const,
              payload: { fallback_reason: input.fallback_reason }
            }
          ]
        : [])
    ]
  };
}

