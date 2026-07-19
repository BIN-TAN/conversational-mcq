import {
  buildDeterministicTopicDialogueResponse,
  evaluateTopicDialogueReadinessGate,
  type TopicDialogueInputV1,
  type TopicDialogueOutputV1
} from "@/lib/services/student-assessment/topic-dialogue-agent";

export const TOPIC_DIALOGUE_ACTION_NORMALIZATION_VERSION =
  "topic-dialogue-action-normalization-v1" as const;

export type CanonicalTopicDialogueAction =
  | "remain_in_dialogue"
  | "request_revision"
  | "present_transfer"
  | "complete_episode";

export type TopicDialogueActionNormalizationStatus =
  | "canonical"
  | "legacy_alias"
  | "rejected_unknown"
  | "rejected_obsolete"
  | "rejected_unauthorized";

export type TopicDialogueProgressionAuthorization = {
  authorization_version: string;
  revision_authorized: boolean;
  transfer_authorized: boolean;
  completion_authorized: boolean;
  authorized_action: CanonicalTopicDialogueAction;
  authorization_evidence_summary: string;
};

const CANONICAL_ACTIONS = new Set<CanonicalTopicDialogueAction>([
  "remain_in_dialogue",
  "request_revision",
  "present_transfer",
  "complete_episode"
]);

const LEGACY_ALIASES = new Map<string, CanonicalTopicDialogueAction>([
  ["await_topic_dialogue_response", "remain_in_dialogue"],
  ["AWAIT_TOPIC_DIALOGUE_RESPONSE", "remain_in_dialogue"],
  ["show_progression_choices", "request_revision"],
  ["SHOW_PROGRESSION_CHOICES", "request_revision"],
  ["continue_to_transfer", "present_transfer"],
  ["end_assessment", "complete_episode"]
]);

const OBSOLETE_OR_NON_AUTHORIZING_ACTIONS = new Set([
  "show_final_support_options",
  "SHOW_FINAL_SUPPORT_OPTIONS",
  "continue_to_next_topic",
  "ready",
  "sufficient_to_advance",
  "move_on",
  "complete"
]);

const AUTHORIZATION_SUMMARY_FORBIDDEN =
  /\b(?:openai|provider|model|prompt|schema|agent[_ -]?call|profile|planning|specific_misconception_remaining|foundational_support_needed|ready_to_advance|insufficient_new_evidence|database|cookie|token)\b/iu;

export function isTopicDialogueAuthorizationSummarySafe(summary: string) {
  const value = summary.trim();
  return value.length > 0 && value.length <= 180 &&
    !AUTHORIZATION_SUMMARY_FORBIDDEN.test(value) &&
    !/[{}[\]"]|\b[a-z]+_[a-z_]+\b/u.test(value);
}

export function sanitizeTopicDialogueAuthorizationSummary(input: {
  authorized_action: CanonicalTopicDialogueAction;
  gate_ready: boolean;
}) {
  if (!input.gate_ready || input.authorized_action === "remain_in_dialogue") {
    return "Server evidence requires continued topic dialogue.";
  }
  return "Server evidence permits the requested bounded progression action.";
}

function declaredAuthorizationIsConsistent(
  authorization: TopicDialogueProgressionAuthorization
) {
  return authorization.revision_authorized ===
      (authorization.authorized_action === "request_revision") &&
    authorization.transfer_authorized ===
      (authorization.authorized_action === "present_transfer") &&
    authorization.completion_authorized ===
      (authorization.authorized_action === "complete_episode") &&
    isTopicDialogueAuthorizationSummarySafe(
      authorization.authorization_evidence_summary
    );
}

export function normalizeTopicDialogueProgressionAction(input: {
  provider_action: unknown;
  authorization: TopicDialogueProgressionAuthorization;
}) {
  const raw = typeof input.provider_action === "string"
    ? input.provider_action.trim()
    : "";
  if (!declaredAuthorizationIsConsistent(input.authorization)) {
    return {
      normalization_version: TOPIC_DIALOGUE_ACTION_NORMALIZATION_VERSION,
      input_action: raw || null,
      normalized_requested_action: "remain_in_dialogue" as const,
      effective_action: "remain_in_dialogue" as const,
      status: "rejected_unauthorized" as const,
      rejection_code: "authorization_contract_inconsistent" as const,
      authorization_aligned: false,
      progression_allowed: false
    };
  }

  if (OBSOLETE_OR_NON_AUTHORIZING_ACTIONS.has(raw)) {
    return {
      normalization_version: TOPIC_DIALOGUE_ACTION_NORMALIZATION_VERSION,
      input_action: raw,
      normalized_requested_action: "remain_in_dialogue" as const,
      effective_action: "remain_in_dialogue" as const,
      status: "rejected_obsolete" as const,
      rejection_code: "obsolete_or_non_authorizing_action" as const,
      authorization_aligned: input.authorization.authorized_action === "remain_in_dialogue",
      progression_allowed: false
    };
  }

  const canonical = CANONICAL_ACTIONS.has(raw as CanonicalTopicDialogueAction)
    ? raw as CanonicalTopicDialogueAction
    : LEGACY_ALIASES.get(raw);
  if (!canonical) {
    return {
      normalization_version: TOPIC_DIALOGUE_ACTION_NORMALIZATION_VERSION,
      input_action: raw || null,
      normalized_requested_action: "remain_in_dialogue" as const,
      effective_action: "remain_in_dialogue" as const,
      status: "rejected_unknown" as const,
      rejection_code: "unknown_progression_action" as const,
      authorization_aligned: input.authorization.authorized_action === "remain_in_dialogue",
      progression_allowed: false
    };
  }

  if (canonical !== input.authorization.authorized_action) {
    return {
      normalization_version: TOPIC_DIALOGUE_ACTION_NORMALIZATION_VERSION,
      input_action: raw,
      normalized_requested_action: canonical,
      effective_action: "remain_in_dialogue" as const,
      status: "rejected_unauthorized" as const,
      rejection_code: "provider_action_exceeds_authorization" as const,
      authorization_aligned: false,
      progression_allowed: false
    };
  }

  return {
    normalization_version: TOPIC_DIALOGUE_ACTION_NORMALIZATION_VERSION,
    input_action: raw,
    normalized_requested_action: canonical,
    effective_action: canonical,
    status: CANONICAL_ACTIONS.has(raw as CanonicalTopicDialogueAction)
      ? "canonical" as const
      : "legacy_alias" as const,
    rejection_code: null,
    authorization_aligned: true,
    progression_allowed: canonical !== "remain_in_dialogue"
  };
}

export function buildTopicDialogueRuntimeAuthorization(
  input: TopicDialogueInputV1
): TopicDialogueProgressionAuthorization {
  const readiness = evaluateTopicDialogueReadinessGate(input);
  const authorizedAction: CanonicalTopicDialogueAction = readiness.ready
    ? "request_revision"
    : "remain_in_dialogue";
  return {
    authorization_version: "topic-dialogue-runtime-authorization-v1",
    revision_authorized: authorizedAction === "request_revision",
    transfer_authorized: false,
    completion_authorized: false,
    authorized_action: authorizedAction,
    authorization_evidence_summary: sanitizeTopicDialogueAuthorizationSummary({
      authorized_action: authorizedAction,
      gate_ready: readiness.ready
    })
  };
}

function safeRemainInDialogueOutput(input: TopicDialogueInputV1) {
  const fallback = buildDeterministicTopicDialogueResponse(input);
  return {
    ...fallback,
    next_action: "await_topic_dialogue_response" as const,
    next_runtime_state: "AWAIT_TOPIC_DIALOGUE_RESPONSE" as const,
    progression_readiness: "not_ready" as const,
    requires_student_response: true,
    expected_response_guidance:
      fallback.expected_response_guidance ??
      "Respond to the current item-specific question."
  };
}

export function applyCanonicalTopicDialogueActionGate(input: {
  dialogue_input: TopicDialogueInputV1;
  candidate_output: TopicDialogueOutputV1;
  authorization?: TopicDialogueProgressionAuthorization;
}) {
  const authorization = input.authorization ??
    buildTopicDialogueRuntimeAuthorization(input.dialogue_input);
  const normalization = normalizeTopicDialogueProgressionAction({
    provider_action: input.candidate_output.next_action,
    authorization
  });
  const mustRemain = normalization.effective_action === "remain_in_dialogue";
  const candidateAlreadyRemains =
    input.candidate_output.next_action === "await_topic_dialogue_response";
  const rejected = normalization.status.startsWith("rejected_");
  const overridden = rejected || (mustRemain && !candidateAlreadyRemains);
  return {
    output: overridden
      ? safeRemainInDialogueOutput(input.dialogue_input)
      : input.candidate_output,
    authorization,
    normalization,
    rejected,
    overridden,
    activity_active: mustRemain
  };
}

export function topicDialogueAuthorizationAuditProjection(
  authorization: TopicDialogueProgressionAuthorization
) {
  return {
    authorization_version: authorization.authorization_version,
    authorized_action: authorization.authorized_action,
    revision_authorized: authorization.revision_authorized,
    transfer_authorized: authorization.transfer_authorized,
    completion_authorized: authorization.completion_authorized,
    authorization_evidence_summary: authorization.authorization_evidence_summary
  };
}
