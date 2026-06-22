import type {
  ResponseCollectionIntent,
  ResponseCollectionRecommendedInteractionOutcome,
  ResponseCollectionReasoningCaptureStatus,
  ResponseCollectionRequestedControlAction
} from "@/lib/agents/contracts";

const helpPattern =
  /\b(correct|incorrect|answer|hint|explain|explanation|teach|help me solve|which option|tell me|what is the answer|show me how)\b/i;
const promptInjectionPattern =
  /\b(ignore (the )?(rules|instructions)|system prompt|developer message|jailbreak|act as|reveal hidden)\b/i;
const optionSelectionPattern = /\b(i choose|my answer is|answer is|option)\s+([a-f])\b/i;
const confidencePattern = /\b(low|medium|high)\s+confidence\b/i;
const skipPattern = /\b(skip|pass|move on without)\b/i;
const saveExitPattern = /\b(save and exit|exit|leave for now|come back later)\b/i;
const frustrationPattern =
  /\b(frustrated|confused|stuck|i don't know|idk|not sure|unsure|this is hard)\b/i;
const proceduralPattern =
  /\b(how do i|where do i|can i save|how to submit|what button|what should i click)\b/i;
const offTopicPattern = /\b(lunch|weather|joke|game|movie|sports|song|recipe)\b/i;

function unique<T>(values: T[]) {
  return [...new Set(values)];
}

function firstHelpBoundary(message: string) {
  const patterns = [
    /\bcan you\b/i,
    /\btell me\b/i,
    /\bwhat is\b/i,
    /\bwhich option\b/i,
    /\bgive me\b/i,
    /\bhint\b/i,
    /\bexplain\b/i,
    /\bcorrect\b/i
  ];
  const indexes = patterns
    .map((pattern) => {
      const match = pattern.exec(message);
      return match?.index ?? -1;
    })
    .filter((index) => index > 0);

  return indexes.length > 0 ? Math.min(...indexes) : -1;
}

export type ResponseCollectionMessageAnalysis = {
  recognized_intents: ResponseCollectionIntent[];
  reasoning_capture_status: ResponseCollectionReasoningCaptureStatus;
  reasoning_evidence_segments: string[];
  requires_option_button: boolean;
  requires_confidence_control: boolean;
  requested_control_action: ResponseCollectionRequestedControlAction;
  recommended_interaction_outcome: ResponseCollectionRecommendedInteractionOutcome;
  blocked_content_help: boolean;
};

export function analyzeResponseCollectionMessage(input: {
  message: string;
  has_existing_reasoning: boolean;
}): ResponseCollectionMessageAnalysis {
  const message = input.message.trim();
  const hasHelpRequest = helpPattern.test(message);
  const hasPromptInjection = promptInjectionPattern.test(message);
  const hasOptionText = optionSelectionPattern.test(message);
  const hasConfidenceText = confidencePattern.test(message);
  const hasSkip = skipPattern.test(message);
  const hasSaveExit = saveExitPattern.test(message);
  const hasFrustration = frustrationPattern.test(message);
  const hasProcedural = proceduralPattern.test(message);
  const hasOffTopic = offTopicPattern.test(message);
  const intents: ResponseCollectionIntent[] = [];

  if (hasPromptInjection) {
    intents.push("prompt_injection_attempt", "invalid_help_request");
  }

  if (hasHelpRequest) {
    intents.push("invalid_help_request");

    if (/\bhint\b/i.test(message)) {
      intents.push("hint_request");
    }

    if (/\b(correct|incorrect)\b/i.test(message)) {
      intents.push("correctness_request");
    }

    if (/\bexplain|explanation|teach\b/i.test(message)) {
      intents.push("explanation_request");
    }

    if (/\bwhich option|answer\b/i.test(message)) {
      intents.push("content_clarification_request");
    }
  }

  if (hasProcedural) {
    intents.push("procedural_clarification");
  }

  if (hasFrustration) {
    intents.push("frustration_or_uncertainty");
  }

  if (hasSkip) {
    intents.push("skip_request");
  }

  if (hasSaveExit) {
    intents.push("save_exit_request");
  }

  if (hasOffTopic) {
    intents.push("off_topic");
  }

  let segment = "";

  if (!hasPromptInjection) {
    const boundary = firstHelpBoundary(message);
    const candidate = boundary > 0 ? message.slice(0, boundary).trim() : message;
    const hasBecause = /\bbecause\b/i.test(candidate);
    const looksOnlyLikeControl =
      hasOptionText && !hasBecause && candidate.length <= 32;
    const looksOnlyConfidence =
      hasConfidenceText && !hasBecause && candidate.length <= 48;
    const looksOnlyProcedural = hasProcedural && !hasBecause;
    const looksOnlySkipOrExit = (hasSkip || hasSaveExit) && !hasBecause;
    const looksOnlyFrustration = hasFrustration && !hasBecause;

    if (
      candidate &&
      !hasOffTopic &&
      !looksOnlyLikeControl &&
      !looksOnlyConfidence &&
      !looksOnlyProcedural &&
      !looksOnlySkipOrExit &&
      !looksOnlyFrustration &&
      (!hasHelpRequest || hasBecause)
    ) {
      segment = candidate;
    }
  }

  if (segment) {
    intents.push(input.has_existing_reasoning ? "reasoning_revision" : "reasoning_submission");
  }

  if (intents.length === 0) {
    intents.push(message ? "unclear" : "unclear");
  }

  const requestedControlAction: ResponseCollectionRequestedControlAction = hasSaveExit
    ? "save_and_exit"
    : hasSkip
      ? "skip_item"
      : "none";
  const recommendedInteractionOutcome: ResponseCollectionRecommendedInteractionOutcome =
    requestedControlAction === "save_and_exit"
      ? "offer_save_and_exit"
      : requestedControlAction === "skip_item"
        ? "offer_skip"
        : "stay_current_step";

  return {
    recognized_intents: unique(intents),
    reasoning_capture_status: segment
      ? input.has_existing_reasoning
        ? "reasoning_revision"
        : "new_reasoning"
      : "none",
    reasoning_evidence_segments: segment ? [segment] : [],
    requires_option_button: hasOptionText,
    requires_confidence_control: hasConfidenceText,
    requested_control_action: requestedControlAction,
    recommended_interaction_outcome: recommendedInteractionOutcome,
    blocked_content_help: hasHelpRequest || hasPromptInjection
  };
}
