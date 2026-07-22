import { createHash } from "node:crypto";
import { z } from "zod";
import type {
  ActivityMisconceptionEvidencePacketV1
} from "@/lib/services/student-assessment/activity-misconception-evidence";
import {
  classifyTopicDialogueStudentMessage
} from "@/lib/services/student-assessment/topic-dialogue-agent";
import type {
  TopicDialogueProgressionAuthorization
} from "@/lib/services/student-assessment/topic-dialogue-action-normalization";
import type {
  TopicDialogueOperation
} from "@/lib/services/student-assessment/topic-dialogue-operation-contract";
import type {
  TopicDialogueResponseMode
} from "@/lib/services/student-assessment/topic-dialogue-response-mode";

export const EVIDENCE_FIRST_PROFILE_ROUTING_VERSION =
  "e2a22-evidence-first-profile-routing-v1" as const;
export const TOPIC_DIALOGUE_TURN_PROFILE_VERSION =
  "topic-dialogue-turn-evidence-profile-v1" as const;
export const TOPIC_DIALOGUE_CUMULATIVE_PROFILE_VERSION =
  "topic-dialogue-cumulative-evidence-profile-v1" as const;
export const TOPIC_DIALOGUE_TURN_PROFILE_EVALUATOR_VERSION =
  "topic-dialogue-platform-evidence-adjudicator-v1" as const;
export const TOPIC_DIALOGUE_STALE_PROFILE_GUARD_VERSION =
  "topic-dialogue-stale-profile-guard-v1" as const;

export const TopicDialogueInteractionIntentSchema = z.enum([
  "task_language_confusion",
  "protected_request",
  "off_topic_response",
  "ordinary_conceptual_response"
]);
export const TopicDialogueReasoningQualitySchema = z.enum([
  "insufficient",
  "misconception",
  "partial",
  "sound"
]);
export const TopicDialogueAnchorApplicationSchema = z.enum([
  "absent",
  "implicit",
  "explicit"
]);
export const TopicDialogueMisconceptionStatusSchema = z.enum([
  "persists",
  "uncertain",
  "resolved_for_current_anchor"
]);
export const TopicDialogueObservableEvidenceSpanSchema = z.object({
  label: z.string().min(1).max(120),
  span: z.string().min(1).max(900)
}).strict();
export const TopicDialogueStructuredContradictionSchema = z.object({
  contradiction_type: z.string().min(1).max(240),
  anchor_id: z.string().min(1).max(240),
  anchor_text: z.string().min(1).max(1400),
  observed_anchor_stance: z.enum([
    "not_expressed",
    "ambiguous",
    "endorses_distractor",
    "rejects_distractor"
  ]),
  conceptual_claim: z.enum([
    "endorses_distractor",
    "rejects_distractor"
  ]),
  conflicting_evidence_spans: z.array(
    TopicDialogueObservableEvidenceSpanSchema
  ).min(1).max(12),
  blocking: z.literal(true),
  source_evaluator_version: z.string().min(1),
  mapper_version: z.string().min(1)
}).strict();

export const TopicDialogueTurnEvidenceProfileSchema = z.object({
  profile_version: z.literal(TOPIC_DIALOGUE_TURN_PROFILE_VERSION),
  profile_snapshot_id: z.string().min(1),
  source_student_turn_id: z.string().min(1),
  source_sequence_index: z.number().int().positive(),
  evaluator_version: z.string().min(1),
  concept_id: z.string().min(1),
  distractor_anchor: z.string().min(1),
  interaction_intent: TopicDialogueInteractionIntentSchema,
  reasoning_quality: TopicDialogueReasoningQualitySchema,
  anchor_application: TopicDialogueAnchorApplicationSchema,
  misconception_status: TopicDialogueMisconceptionStatusSchema,
  essential_missing_links: z.array(z.string().min(1).max(240)).max(12),
  contradictions: z.array(z.string().min(1).max(240)).max(12),
  structured_contradictions: z.array(
    TopicDialogueStructuredContradictionSchema
  ).max(12).optional(),
  observable_evidence_spans: z.array(
    TopicDialogueObservableEvidenceSpanSchema
  ).max(12),
  confidence_evidence: z.enum(["high", "medium", "low"]).nullable(),
  revision_readiness: z.boolean(),
  transfer_readiness: z.boolean(),
  completion_readiness: z.boolean(),
  evidence_limitations: z.array(z.string().min(1).max(240)).max(12),
  created_at: z.string().datetime()
}).strict();
export type TopicDialogueTurnEvidenceProfile = z.infer<
  typeof TopicDialogueTurnEvidenceProfileSchema
>;

export const TopicDialogueCumulativeEvidenceProfileSchema = z.object({
  cumulative_profile_version: z.literal(
    TOPIC_DIALOGUE_CUMULATIVE_PROFILE_VERSION
  ),
  latest_turn_profile_snapshot_id: z.string().min(1),
  current_conceptual_profile_snapshot_id: z.string().min(1),
  current_reasoning_quality: TopicDialogueReasoningQualitySchema,
  current_anchor_application: TopicDialogueAnchorApplicationSchema,
  current_misconception_status: TopicDialogueMisconceptionStatusSchema,
  current_revision_readiness: z.boolean(),
  current_transfer_readiness: z.boolean(),
  current_completion_readiness: z.boolean(),
  historical_profile_snapshot_ids: z.array(z.string().min(1)),
  historical_misconception_snapshot_ids: z.array(z.string().min(1)),
  misconception_reopened_count: z.number().int().nonnegative(),
  latest_evidence_precedence: z.literal(true),
  updated_at: z.string().datetime()
}).strict();
export type TopicDialogueCumulativeEvidenceProfile = z.infer<
  typeof TopicDialogueCumulativeEvidenceProfileSchema
>;

export const EvidenceFirstRouteSchema = z.object({
  orchestration_version: z.literal(EVIDENCE_FIRST_PROFILE_ROUTING_VERSION),
  source_profile_snapshot_id: z.string().min(1),
  source_student_turn_id: z.string().min(1),
  source_sequence_index: z.number().int().positive(),
  selected_mode: z.enum([
    "remain_in_dialogue",
    "request_revision",
    "present_transfer",
    "complete_episode"
  ]),
  selected_operation: z.enum([
    "elicit_anchor_evidence",
    "clarify_concept_with_new_strategy",
    "clarify_task",
    "protected_redirect",
    "repair_recurrence",
    "redirect_off_topic",
    "refine_partial_reasoning"
  ]).nullable(),
  routing_classification: z.string().min(1),
  remaining_issue: z.string().min(1).max(700).nullable(),
  immediate_intent_override: z.boolean(),
  provider_selected_route: z.literal(false),
  minimum_turn_requirement_applied: z.literal(false)
}).strict();
export type EvidenceFirstRoute = z.infer<typeof EvidenceFirstRouteSchema>;

export type TurnEvidenceObservation = {
  interaction_intent: z.infer<typeof TopicDialogueInteractionIntentSchema>;
  reasoning_quality: z.infer<typeof TopicDialogueReasoningQualitySchema>;
  anchor_application: z.infer<typeof TopicDialogueAnchorApplicationSchema>;
  misconception_status: z.infer<typeof TopicDialogueMisconceptionStatusSchema>;
  essential_missing_links: string[];
  contradictions: string[];
  structured_contradictions?: Array<z.infer<
    typeof TopicDialogueStructuredContradictionSchema
  >>;
  observable_evidence_spans: Array<{ label: string; span: string }>;
  confidence_evidence: "high" | "medium" | "low" | null;
  evidence_limitations: string[];
};

const PROTECTED_REQUEST =
  /\b(?:answer key|correct option|correct answer|hidden prompt|system prompt|developer message|chain of thought|internal profile|teacher notes?|raw process|api key|authorization header)\b/iu;
const GENERIC_UNDERSTANDING =
  /^(?:i\s+)?(?:now\s+)?(?:understand|understand\s+now|get\s+it|see)(?:\s+(?:it|now))?[.!]?$/iu;

function unique(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

export function classifyTopicDialogueInteractionIntent(
  message: string
): TurnEvidenceObservation["interaction_intent"] {
  if (PROTECTED_REQUEST.test(message)) return "protected_request";
  const classified = classifyTopicDialogueStudentMessage(message);
  if (classified.topic_relation === "off_topic") return "off_topic_response";
  if ([
    "clarification_request",
    "assessment_system_question",
    "unclear_but_valid"
  ].includes(classified.student_message_function)) {
    return "task_language_confusion";
  }
  return "ordinary_conceptual_response";
}

export function buildTurnEvidenceObservationFromActivityPacket(input: {
  latest_student_message: string;
  packet: ActivityMisconceptionEvidencePacketV1 | null;
  interaction_intent?: TurnEvidenceObservation["interaction_intent"];
}): TurnEvidenceObservation {
  const intent = input.interaction_intent ??
    classifyTopicDialogueInteractionIntent(input.latest_student_message);
  const packet = input.packet;
  const noConceptualEvidence = intent !== "ordinary_conceptual_response";
  if (!packet || noConceptualEvidence || GENERIC_UNDERSTANDING.test(
    input.latest_student_message.trim()
  )) {
    return {
      interaction_intent: intent,
      reasoning_quality: "insufficient",
      anchor_application: "absent",
      misconception_status: "uncertain",
      essential_missing_links: ["anchor_specific_conceptual_evidence"],
      contradictions: [],
      observable_evidence_spans: [],
      confidence_evidence: packet?.misconception_evidence_update.confidence ?? null,
      evidence_limitations: unique([
        ...(packet?.misconception_evidence_update.limitations ?? []),
        noConceptualEvidence
          ? "immediate_intent_did_not_replace_current_conceptual_profile"
          : "generic_understanding_claim_is_not_revision_evidence"
      ])
    };
  }

  const update = packet.misconception_evidence_update;
  const elicited = packet.evidence_elicited;
  const responseKind = packet.student_activity_response.response_kind;
  const explicitAnchor = [
    elicited.student_explained_target_boundary,
    elicited.student_reconstructed_concept_independently,
    elicited.student_repaired_reasoning_link,
    elicited.student_identified_hidden_assumption
  ].some((value) => value === "yes");
  const implicitAnchor = explicitAnchor || [
    elicited.student_explained_target_boundary,
    elicited.student_reconstructed_concept_independently,
    elicited.student_repaired_reasoning_link,
    elicited.student_identified_hidden_assumption
  ].some((value) => value === "partial");
  const soundStatus = new Set([
    "misconception_unsupported",
    "boundary_understanding_improved",
    "independent_evidence_supported",
    "no_actionable_misconception_evidence"
  ]).has(update.status);
  const misconceptionStatus = new Set([
    "misconception_persisted",
    "conceptual_entry_gap_remains",
    "reasoning_boundary_still_blurred"
  ]).has(update.status);
  const evaluatorSupportedExplicitAnchor = explicitAnchor ||
    (soundStatus && elicited.elicited);
  const sound = soundStatus && evaluatorSupportedExplicitAnchor &&
    ["high", "medium"].includes(update.evidence_quality) &&
    responseKind === "substantive";
  const reasoningQuality: TurnEvidenceObservation["reasoning_quality"] = sound
    ? "sound"
    : misconceptionStatus
      ? "misconception"
      : update.evidence_quality === "insufficient" ||
          ["low_information", "unclear", "question"].includes(responseKind)
        ? "insufficient"
        : "partial";
  const missing = reasoningQuality === "sound" ? [] : unique([
    !explicitAnchor ? "explicit_anchor_application" : "",
    !elicited.student_repaired_reasoning_link.includes("yes")
      ? "essential_reasoning_link"
      : "",
    reasoningQuality === "misconception" ? "conceptual_contradiction_repair" : ""
  ]);
  return {
    interaction_intent: intent,
    reasoning_quality: reasoningQuality,
    anchor_application: evaluatorSupportedExplicitAnchor
      ? "explicit"
      : implicitAnchor ? "implicit" : "absent",
    misconception_status: sound
      ? "resolved_for_current_anchor"
      : misconceptionStatus ? "persists" : "uncertain",
    essential_missing_links: missing,
    contradictions: misconceptionStatus ? ["evaluator_reported_current_conceptual_conflict"] : [],
    observable_evidence_spans: elicited.elicited ? [{
      label: "latest_evaluator_supported_response",
      span: input.latest_student_message.slice(0, 900)
    }] : [],
    confidence_evidence: update.confidence,
    evidence_limitations: update.limitations
  };
}

export function createTopicDialogueTurnEvidenceProfile(input: {
  source_student_turn_id: string;
  source_sequence_index: number;
  concept_id: string;
  distractor_anchor: string;
  observation: TurnEvidenceObservation;
  evaluator_version?: string;
  transfer_readiness?: boolean;
  completion_readiness?: boolean;
  created_at?: string;
}) {
  const evaluatorVersion = input.evaluator_version ??
    TOPIC_DIALOGUE_TURN_PROFILE_EVALUATOR_VERSION;
  const snapshotCore = {
    source_student_turn_id: input.source_student_turn_id,
    source_sequence_index: input.source_sequence_index,
    evaluator_version: evaluatorVersion,
    concept_id: input.concept_id,
    distractor_anchor: input.distractor_anchor,
    observation: input.observation,
    transfer_readiness: input.transfer_readiness ?? false,
    completion_readiness: input.completion_readiness ?? false
  };
  const profileSnapshotId = `tdp_${createHash("sha256")
    .update(JSON.stringify(snapshotCore)).digest("hex").slice(0, 24)}`;
  const anchorV3 = input.observation as TurnEvidenceObservation & {
    anchor_stance?: string;
    anchor_consistency?: string;
    anchor_resolution_status?: string;
  };
  const v3AnchorReady = anchorV3.anchor_stance === undefined || (
    anchorV3.anchor_stance === "rejects_distractor" &&
    anchorV3.anchor_consistency ===
      "consistent_with_conceptual_reasoning" &&
    anchorV3.anchor_resolution_status === "resolved_against_distractor"
  );
  const revisionReadiness =
    input.observation.interaction_intent === "ordinary_conceptual_response" &&
    input.observation.reasoning_quality === "sound" &&
    input.observation.anchor_application === "explicit" &&
    v3AnchorReady &&
    input.observation.misconception_status === "resolved_for_current_anchor" &&
    input.observation.essential_missing_links.length === 0 &&
    input.observation.contradictions.length === 0;
  return TopicDialogueTurnEvidenceProfileSchema.parse({
    profile_version: TOPIC_DIALOGUE_TURN_PROFILE_VERSION,
    profile_snapshot_id: profileSnapshotId,
    source_student_turn_id: input.source_student_turn_id,
    source_sequence_index: input.source_sequence_index,
    evaluator_version: evaluatorVersion,
    concept_id: input.concept_id,
    distractor_anchor: input.distractor_anchor,
    interaction_intent: input.observation.interaction_intent,
    reasoning_quality: input.observation.reasoning_quality,
    anchor_application: input.observation.anchor_application,
    misconception_status: input.observation.misconception_status,
    observable_evidence_spans: input.observation.observable_evidence_spans,
    confidence_evidence: input.observation.confidence_evidence,
    essential_missing_links: unique(input.observation.essential_missing_links),
    contradictions: unique(input.observation.contradictions),
    structured_contradictions: input.observation.structured_contradictions,
    revision_readiness: revisionReadiness,
    transfer_readiness: input.transfer_readiness ?? false,
    completion_readiness: input.completion_readiness ?? false,
    evidence_limitations: unique(input.observation.evidence_limitations),
    created_at: input.created_at ?? new Date().toISOString()
  });
}

export function integrateTopicDialogueEvidenceProfile(input: {
  prior: TopicDialogueCumulativeEvidenceProfile | null;
  current: TopicDialogueTurnEvidenceProfile;
}) {
  const prior = input.prior;
  const current = input.current;
  const immediate = current.interaction_intent !== "ordinary_conceptual_response";
  const noNewConceptualEvidence = current.reasoning_quality === "insufficient" &&
    current.observable_evidence_spans.length === 0;
  const retainsPriorConceptualState = Boolean(prior) &&
    (immediate || noNewConceptualEvidence);
  const currentConceptualSnapshot = retainsPriorConceptualState && prior
    ? prior.current_conceptual_profile_snapshot_id
    : current.profile_snapshot_id;
  const currentReasoning = retainsPriorConceptualState && prior
    ? prior.current_reasoning_quality
    : current.reasoning_quality;
  const currentAnchor = retainsPriorConceptualState && prior
    ? prior.current_anchor_application
    : current.anchor_application;
  const currentMisconception = retainsPriorConceptualState && prior
    ? prior.current_misconception_status
    : current.misconception_status;
  const currentRevision = retainsPriorConceptualState && prior
    ? prior.current_revision_readiness
    : current.revision_readiness;
  const reopened = Boolean(prior?.current_misconception_status ===
    "resolved_for_current_anchor" && current.misconception_status === "persists");
  return TopicDialogueCumulativeEvidenceProfileSchema.parse({
    cumulative_profile_version: TOPIC_DIALOGUE_CUMULATIVE_PROFILE_VERSION,
    latest_turn_profile_snapshot_id: current.profile_snapshot_id,
    current_conceptual_profile_snapshot_id: currentConceptualSnapshot,
    current_reasoning_quality: currentReasoning,
    current_anchor_application: currentAnchor,
    current_misconception_status: currentMisconception,
    current_revision_readiness: currentRevision,
    current_transfer_readiness: retainsPriorConceptualState && prior
      ? prior.current_transfer_readiness
      : current.transfer_readiness,
    current_completion_readiness: retainsPriorConceptualState && prior
      ? prior.current_completion_readiness
      : current.completion_readiness,
    historical_profile_snapshot_ids: unique([
      ...(prior?.historical_profile_snapshot_ids ?? []),
      current.profile_snapshot_id
    ]),
    historical_misconception_snapshot_ids: unique([
      ...(prior?.historical_misconception_snapshot_ids ?? []),
      ...(current.misconception_status === "persists"
        ? [current.profile_snapshot_id]
        : [])
    ]),
    misconception_reopened_count:
      (prior?.misconception_reopened_count ?? 0) + (reopened ? 1 : 0),
    latest_evidence_precedence: true,
    updated_at: current.created_at
  });
}

function remainRoute(input: {
  profile: TopicDialogueTurnEvidenceProfile;
  operation: TopicDialogueOperation;
  classification: string;
  remainingIssue: string;
  immediate?: boolean;
}): EvidenceFirstRoute {
  return EvidenceFirstRouteSchema.parse({
    orchestration_version: EVIDENCE_FIRST_PROFILE_ROUTING_VERSION,
    source_profile_snapshot_id: input.profile.profile_snapshot_id,
    source_student_turn_id: input.profile.source_student_turn_id,
    source_sequence_index: input.profile.source_sequence_index,
    selected_mode: "remain_in_dialogue",
    selected_operation: input.operation,
    routing_classification: input.classification,
    remaining_issue: input.remainingIssue,
    immediate_intent_override: input.immediate ?? false,
    provider_selected_route: false,
    minimum_turn_requirement_applied: false
  });
}

export function selectEvidenceFirstTopicDialogueRoute(input: {
  profile: TopicDialogueTurnEvidenceProfile;
  cumulative: TopicDialogueCumulativeEvidenceProfile;
}) {
  const profile = input.profile;
  if (profile.interaction_intent === "protected_request") {
    return remainRoute({ profile, operation: "protected_redirect",
      classification: "protected_request",
      remainingIssue: "Return to the current bounded conceptual task.", immediate: true });
  }
  if (profile.interaction_intent === "off_topic_response") {
    return remainRoute({ profile, operation: "redirect_off_topic",
      classification: "off_topic_response",
      remainingIssue: "Return to the current assessment topic.", immediate: true });
  }
  if (profile.interaction_intent === "task_language_confusion") {
    return remainRoute({ profile, operation: "clarify_task",
      classification: "task_language_confusion",
      remainingIssue: "Clarify what the current task asks the student to produce.",
      immediate: true });
  }
  const retainedConceptualProfile =
    input.cumulative.current_conceptual_profile_snapshot_id !==
      profile.profile_snapshot_id;
  if (retainedConceptualProfile &&
      input.cumulative.current_revision_readiness) {
    return EvidenceFirstRouteSchema.parse({
      orchestration_version: EVIDENCE_FIRST_PROFILE_ROUTING_VERSION,
      source_profile_snapshot_id: profile.profile_snapshot_id,
      source_student_turn_id: profile.source_student_turn_id,
      source_sequence_index: profile.source_sequence_index,
      selected_mode: "request_revision",
      selected_operation: null,
      routing_classification: "retained_sound_evidence_after_no_new_evidence",
      remaining_issue: null,
      immediate_intent_override: false,
      provider_selected_route: false,
      minimum_turn_requirement_applied: false
    });
  }
  if (retainedConceptualProfile &&
      input.cumulative.current_reasoning_quality === "partial") {
    return remainRoute({
      profile,
      operation: "refine_partial_reasoning",
      classification: "retained_partial_evidence_after_no_new_evidence",
      remainingIssue: "Add the missing conceptual link for the active distractor."
    });
  }
  if (retainedConceptualProfile &&
      input.cumulative.current_reasoning_quality === "misconception") {
    return remainRoute({
      profile,
      operation: input.cumulative.misconception_reopened_count > 0
        ? "repair_recurrence"
        : "clarify_concept_with_new_strategy",
      classification: "retained_misconception_after_no_new_evidence",
      remainingIssue: "Repair the current conceptual contradiction."
    });
  }
  if (profile.completion_readiness) {
    return EvidenceFirstRouteSchema.parse({
      orchestration_version: EVIDENCE_FIRST_PROFILE_ROUTING_VERSION,
      source_profile_snapshot_id: profile.profile_snapshot_id,
      source_student_turn_id: profile.source_student_turn_id,
      source_sequence_index: profile.source_sequence_index,
      selected_mode: "complete_episode",
      selected_operation: null,
      routing_classification: "independent_transfer_evidence_accepted",
      remaining_issue: null,
      immediate_intent_override: false,
      provider_selected_route: false,
      minimum_turn_requirement_applied: false
    });
  }
  if (profile.transfer_readiness) {
    return EvidenceFirstRouteSchema.parse({
      orchestration_version: EVIDENCE_FIRST_PROFILE_ROUTING_VERSION,
      source_profile_snapshot_id: profile.profile_snapshot_id,
      source_student_turn_id: profile.source_student_turn_id,
      source_sequence_index: profile.source_sequence_index,
      selected_mode: "present_transfer",
      selected_operation: null,
      routing_classification: "acceptable_revision_accepted",
      remaining_issue: null,
      immediate_intent_override: false,
      provider_selected_route: false,
      minimum_turn_requirement_applied: false
    });
  }
  if (profile.revision_readiness) {
    return EvidenceFirstRouteSchema.parse({
      orchestration_version: EVIDENCE_FIRST_PROFILE_ROUTING_VERSION,
      source_profile_snapshot_id: profile.profile_snapshot_id,
      source_student_turn_id: profile.source_student_turn_id,
      source_sequence_index: profile.source_sequence_index,
      selected_mode: "request_revision",
      selected_operation: null,
      routing_classification: "sound_anchor_specific_reasoning",
      remaining_issue: null,
      immediate_intent_override: false,
      provider_selected_route: false,
      minimum_turn_requirement_applied: false
    });
  }
  if (profile.reasoning_quality === "misconception") {
    const recurrence = input.cumulative.misconception_reopened_count > 0;
    return remainRoute({
      profile,
      operation: recurrence ? "repair_recurrence" : "clarify_concept_with_new_strategy",
      classification: recurrence
        ? "recurrence_after_apparent_improvement"
        : "continued_conceptual_confusion",
      remainingIssue: profile.essential_missing_links[0] ??
        "Repair the current conceptual contradiction."
    });
  }
  if (profile.reasoning_quality === "partial") {
    return remainRoute({
      profile,
      operation: "refine_partial_reasoning",
      classification: "partial_but_incomplete_reasoning",
      remainingIssue: profile.essential_missing_links[0] ??
        "Add the missing conceptual link for the active distractor."
    });
  }
  return remainRoute({
    profile,
    operation: "elicit_anchor_evidence",
    classification: "unsupported_understanding_claim",
    remainingIssue: profile.essential_missing_links[0] ??
      "Provide anchor-specific conceptual evidence."
  });
}

export function buildEvidenceFirstProgressionAuthorization(
  route: EvidenceFirstRoute
): TopicDialogueProgressionAuthorization {
  const action = route.selected_mode as TopicDialogueResponseMode;
  return {
    authorization_version: EVIDENCE_FIRST_PROFILE_ROUTING_VERSION,
    revision_authorized: action === "request_revision",
    transfer_authorized: action === "present_transfer",
    completion_authorized: action === "complete_episode",
    authorized_action: action,
    authorization_evidence_summary: action === "remain_in_dialogue"
      ? "Server evidence requires continued topic dialogue."
      : "Server evidence permits the requested bounded progression action."
  };
}

export function assertEvidenceFirstProfileIsFresh(input: {
  profile: TopicDialogueTurnEvidenceProfile;
  route: EvidenceFirstRoute;
  cumulative?: TopicDialogueCumulativeEvidenceProfile;
  latest_student_turn_id: string;
  latest_sequence_index: number;
}) {
  const errors: string[] = [];
  if (input.profile.source_student_turn_id !== input.latest_student_turn_id) {
    errors.push("profile_source_turn_is_not_latest");
  }
  if (input.profile.source_sequence_index !== input.latest_sequence_index) {
    errors.push("profile_source_sequence_is_not_latest");
  }
  if (input.route.source_profile_snapshot_id !== input.profile.profile_snapshot_id) {
    errors.push("route_profile_snapshot_mismatch");
  }
  if (input.route.source_student_turn_id !== input.profile.source_student_turn_id ||
      input.route.source_sequence_index !== input.profile.source_sequence_index) {
    errors.push("route_source_turn_mismatch");
  }
  if (input.route.selected_mode === "request_revision" &&
      !input.profile.revision_readiness &&
      !input.cumulative?.current_revision_readiness) {
    errors.push("revision_not_authorized_by_current_profile");
  }
  if (input.route.selected_mode === "present_transfer" &&
      !input.profile.transfer_readiness) {
    errors.push("transfer_not_authorized_by_current_profile");
  }
  if (input.route.selected_mode === "complete_episode" &&
      !input.profile.completion_readiness) {
    errors.push("completion_not_authorized_by_current_profile");
  }
  if (input.profile.revision_readiness &&
      input.profile.interaction_intent === "ordinary_conceptual_response" &&
      input.route.selected_mode !== "request_revision") {
    errors.push("sound_profile_must_request_revision");
  }
  if (errors.length > 0) {
    throw new Error(
      `topic_dialogue_stale_or_incompatible_profile:${errors.join("|")}`
    );
  }
  return {
    guard_version: TOPIC_DIALOGUE_STALE_PROFILE_GUARD_VERSION,
    passed: true,
    profile_snapshot_id: input.profile.profile_snapshot_id,
    source_student_turn_id: input.profile.source_student_turn_id,
    source_sequence_index: input.profile.source_sequence_index
  };
}

export function parseCumulativeEvidenceProfile(value: unknown) {
  const result = TopicDialogueCumulativeEvidenceProfileSchema.safeParse(value);
  return result.success ? result.data : null;
}
