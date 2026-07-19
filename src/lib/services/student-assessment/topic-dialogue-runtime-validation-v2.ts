import {
  TOPIC_DIALOGUE_OPERATION_OUTPUT_SCHEMAS,
  TOPIC_DIALOGUE_OPERATION_OUTPUT_SCHEMA_VERSIONS,
  type TopicDialogueOperation
} from "@/lib/services/student-assessment/topic-dialogue-operation-contract";
import {
  TOPIC_DIALOGUE_MODE_OUTPUT_SCHEMAS,
  TOPIC_DIALOGUE_MODE_OUTPUT_SCHEMA_VERSIONS,
  type TopicDialogueResponseMode
} from "@/lib/services/student-assessment/topic-dialogue-response-mode";

export const TOPIC_DIALOGUE_RUNTIME_VALIDATOR_V2_VERSION =
  "eval-topic-dialogue-runtime-acceptance-v2" as const;
export const TOPIC_DIALOGUE_PEDAGOGICAL_RUBRIC_V1_VERSION =
  "eval-topic-dialogue-pedagogical-rubric-v1" as const;
export const TOPIC_DIALOGUE_VALIDATION_POLICY_V2_VERSION =
  "topic-dialogue-runtime-vs-quality-policy-v2" as const;
export const TOPIC_DIALOGUE_REGENERATION_POLICY_V2_VERSION =
  "topic-dialogue-hard-rejection-only-regeneration-v2" as const;
export const TOPIC_DIALOGUE_REVIEW_FLAG_SCHEMA_V1_VERSION =
  "topic-dialogue-review-flag-v1" as const;
export const TOPIC_DIALOGUE_ENVELOPE_VALIDATION_PROVENANCE_V1_VERSION =
  "topic-dialogue-envelope-validation-provenance-v1" as const;

export type TopicDialogueRuntimeAcceptance =
  | "accepted"
  | "accepted_with_review_flags"
  | "hard_rejected";

export type TopicDialogueHardRejection = {
  rule_code: string;
  field_path: string;
  evidence_spans: string[];
  structured_evidence: string[];
  safe_detail: string;
};

export type TopicDialogueSoftReviewFlag = {
  dimension: string;
  rule_code: string;
  evidence_spans: string[];
  safe_detail: string;
  review_priority: "routine" | "elevated";
};

export type TopicDialogueRuntimeValidationContext = {
  selected_mode: TopicDialogueResponseMode;
  selected_operation: TopicDialogueOperation | null;
  latest_student_message: string;
  distractor_anchor: string;
  misconception_target: string;
  strategies_already_attempted?: string[];
  prohibited_repeated_strategies?: string[];
};

export type TopicDialogueRuntimeValidationResult = {
  validator_version: typeof TOPIC_DIALOGUE_RUNTIME_VALIDATOR_V2_VERSION;
  validation_policy_version: typeof TOPIC_DIALOGUE_VALIDATION_POLICY_V2_VERSION;
  runtime_acceptance: TopicDialogueRuntimeAcceptance;
  hard_rejection_reasons: TopicDialogueHardRejection[];
  soft_review_flags: TopicDialogueSoftReviewFlag[];
  regeneration_required: boolean;
  deterministic_fallback_required: boolean;
  safe_for_student_display: boolean;
  human_review_recommended: boolean;
  parsed_output: unknown | null;
  visible_message: string | null;
};

type RecordValue = Record<string, unknown>;

function isRecord(value: unknown): value is RecordValue {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function unique(values: string[]) {
  return [...new Set(values.filter((value) => value.length > 0))];
}

function matchingSpans(message: string, pattern: RegExp) {
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  return unique([...message.matchAll(new RegExp(pattern.source, flags))]
    .map((match) => match[0]));
}

function structuredHardRejection(input: {
  rule_code: string;
  field_path: string;
  safe_detail: string;
  structured_evidence: string[];
}): TopicDialogueHardRejection {
  if (input.structured_evidence.length === 0) {
    throw new Error("topic_dialogue_structured_hard_rejection_requires_evidence");
  }
  return { ...input, evidence_spans: [] };
}

function textHardRejection(input: {
  rule_code: string;
  field_path: string;
  safe_detail: string;
  evidence_spans: string[];
  structured_evidence?: string[];
}): TopicDialogueHardRejection {
  const spans = unique(input.evidence_spans);
  const structuredEvidence = unique(input.structured_evidence ?? []);
  if (spans.length === 0 && structuredEvidence.length === 0) {
    throw new Error("topic_dialogue_text_hard_rejection_requires_evidence");
  }
  return {
    rule_code: input.rule_code,
    field_path: input.field_path,
    safe_detail: input.safe_detail,
    evidence_spans: spans,
    structured_evidence: structuredEvidence
  };
}

function softFlag(input: Omit<TopicDialogueSoftReviewFlag, "evidence_spans"> & {
  evidence_spans?: string[];
}): TopicDialogueSoftReviewFlag {
  return { ...input, evidence_spans: unique(input.evidence_spans ?? []) };
}

const operationExpectedFields = new Set([
  "schema_version",
  "student_facing_message"
]);
const progressionExpectedFields = new Set([
  "schema_version",
  "response_function",
  "tutor_message",
  "evidence_update",
  "remaining_issue",
  "student_safe_summary",
  "expected_response_guidance",
  "safety_flags",
  "requires_student_response"
]);

const controlFieldRules: Record<string, string> = {
  response_mode: "provider_generated_response_mode",
  selected_response_mode: "provider_generated_response_mode",
  dialogue_operation: "provider_generated_dialogue_operation",
  selected_dialogue_operation: "provider_generated_dialogue_operation",
  next_action: "provider_generated_platform_action",
  recommended_action: "provider_generated_platform_action",
  platform_action: "provider_generated_platform_action",
  readiness: "provider_generated_runtime_state",
  ready_to_advance: "provider_generated_runtime_state",
  progression_status: "provider_generated_runtime_state",
  runtime_state: "provider_generated_runtime_state"
};

function expectedSchemaVersion(context: TopicDialogueRuntimeValidationContext) {
  if (context.selected_mode === "remain_in_dialogue") {
    return context.selected_operation
      ? TOPIC_DIALOGUE_OPERATION_OUTPUT_SCHEMA_VERSIONS[
        context.selected_operation
      ]
      : null;
  }
  return TOPIC_DIALOGUE_MODE_OUTPUT_SCHEMA_VERSIONS[context.selected_mode];
}

function parseExpectedOutput(
  context: TopicDialogueRuntimeValidationContext,
  output: unknown
) {
  if (context.selected_mode === "remain_in_dialogue") {
    if (!context.selected_operation) return null;
    const parsed = TOPIC_DIALOGUE_OPERATION_OUTPUT_SCHEMAS[
      context.selected_operation
    ].safeParse(output);
    return parsed.success ? parsed.data : null;
  }
  const parsed = TOPIC_DIALOGUE_MODE_OUTPUT_SCHEMAS[
    context.selected_mode
  ].safeParse(output);
  return parsed.success ? parsed.data : null;
}

function visibleMessage(output: unknown) {
  if (!isRecord(output)) return null;
  if (typeof output.student_facing_message === "string") {
    return output.student_facing_message;
  }
  const values = [output.tutor_message, output.student_safe_summary]
    .filter((value): value is string => typeof value === "string");
  return values.length > 0 ? values.join(" ") : null;
}

function semanticAnchorPresent(
  message: string,
  context: TopicDialogueRuntimeValidationContext
) {
  const lower = message.toLocaleLowerCase();
  const anchorTerms = context.distractor_anchor.toLocaleLowerCase()
    .split(/\s+/u)
    .map((term) => term.replace(/[^a-z0-9]/gu, ""))
    .filter((term) => term.length >= 2);
  const literalAnchor = anchorTerms.length > 0 &&
    anchorTerms.filter((term) => lower.includes(term)).length >=
      Math.min(2, anchorTerms.length);
  const consistency =
    /\b(?:reliab\w*|consisten\w*|repeatab\w*|stable score\w*|coefficient)\b/iu
      .test(message);
  const interpretation =
    /\b(?:valid\w*|interpret\w*|intended (?:meaning|use)|construct|evidence type)\b/iu
      .test(message);
  return literalAnchor || (consistency && interpretation);
}

export function identifyTopicDialogueInstructionalStrategySignals(
  message: string
) {
  const rules: Array<[string, RegExp]> = [
    ["counterfactual_test", /\b(?:change one thing|keep .+ but change|suppose|what if|counterfactual)\b/iu],
    ["inference_chain", /\b(?:inference chain|arrow|first link|second link|unsupported leap)\b/iu],
    ["evidence_type_decomposition", /\b(?:evidence strength|evidence type|two dimensions|what .+ evidence about)\b/iu],
    ["counterexample", /\b(?:counterexample|example where|case where)\b/iu],
    ["narrowed_diagnostic_question", /\b(?:which .+ needs|what must|one claim|which dimension)\b/iu],
    ["claim_evidence_mapping", /\b(?:claim.+evidence|evidence.+claim|supports? .+ but)\b/iu],
    ["concept_comparison", /\b(?:compare|contrast|difference between|separate)\b/iu],
    ["evidence_sorting", /\b(?:sort|classify|evidence set)\b/iu],
    ["worked_example", /\b(?:for example|consider|imagine|worked example)\b/iu]
  ];
  return rules.filter(([, pattern]) => pattern.test(message))
    .map(([label]) => label);
}

export function evaluateTopicDialoguePedagogicalRubric(input: {
  context: TopicDialogueRuntimeValidationContext;
  message: string;
}): TopicDialogueSoftReviewFlag[] {
  const { context, message } = input;
  const flags: TopicDialogueSoftReviewFlag[] = [];
  const strategySignals = identifyTopicDialogueInstructionalStrategySignals(
    message
  );
  if (
    context.selected_mode === "remain_in_dialogue" &&
    ["clarify_concept_with_new_strategy", "repair_recurrence"].includes(
      context.selected_operation ?? ""
    ) &&
    strategySignals.length === 0
  ) {
    flags.push(softFlag({
      dimension: "strategy_quality",
      rule_code: "strategy_adaptation_uncertain",
      safe_detail: "strategy_difference_requires_review",
      review_priority: "routine"
    }));
  }
  if (
    context.selected_mode === "remain_in_dialogue" &&
    !semanticAnchorPresent(message, context)
  ) {
    flags.push(softFlag({
      dimension: "anchor_continuity_quality",
      rule_code: "semantic_anchor_uncertain",
      safe_detail: "literal_or_conceptual_anchor_not_confirmed",
      review_priority: "elevated"
    }));
  }
  if (context.selected_operation === "clarify_task") {
    const imperativeTask =
      /^(?:give|state|write|identify|explain|compare|rewrite|provide)\b/iu
        .test(message.trim());
    const taskLanguage =
      /\b(?:task|response|claim|flaw|rewrite|two-part|first|second)\b/iu
        .test(message);
    if (!imperativeTask && !taskLanguage) {
      flags.push(softFlag({
        dimension: "task_clarification_quality",
        rule_code: "task_clarification_uncertain",
        safe_detail: "usable_instruction_not_confirmed",
        review_priority: "elevated"
      }));
    }
  }
  if (context.selected_operation === "refine_partial_reasoning") {
    const usefulPart =
      /\b(?:correctly identified|useful|helpful|right|repeatability|part of)\b/iu
        .test(message);
    const missingLink =
      /\b(?:what must|cannot show|missing|link|validity adds|would need)\b/iu
        .test(message);
    if (!usefulPart || !missingLink) {
      flags.push(softFlag({
        dimension: "partial_reasoning_quality",
        rule_code: "partial_reasoning_refinement_uncertain",
        safe_detail: "useful_component_or_missing_link_requires_review",
        review_priority: "elevated"
      }));
    }
  }
  if (/\b(?:think about it|try harder|review the concept)\b/iu.test(message)) {
    flags.push(softFlag({
      dimension: "naturalness_and_specificity",
      rule_code: "generic_instructional_wording",
      safe_detail: "safe_but_less_specific_wording",
      review_priority: "routine",
      evidence_spans: matchingSpans(
        message,
        /\b(?:think about it|try harder|review the concept)\b/iu
      )
    }));
  }
  return flags;
}

function addTextPatternRejections(input: {
  message: string;
  context: TopicDialogueRuntimeValidationContext;
  hard: TopicDialogueHardRejection[];
}) {
  const { message, context, hard } = input;
  const rules: Array<{
    rule_code: string;
    safe_detail: string;
    pattern: RegExp;
  }> = [
    {
      rule_code: "answer_key_disclosure",
      safe_detail: "answer_key_language_detected",
      pattern: /\b(?:(?:the )?(?:correct answer|correct option)\s*(?:is|:)\s*[A-D]|answer key|unadministered answer)\b/iu
    },
    {
      rule_code: "hidden_prompt_disclosure",
      safe_detail: "hidden_instruction_language_detected",
      pattern: /\b(?:(?:system|hidden|developer) (?:prompt|instructions?)\s*(?:is|says|:)|chain of thought)\b/iu
    },
    {
      rule_code: "internal_profile_disclosure",
      safe_detail: "internal_profile_language_detected",
      pattern: /\b(?:internal (?:student )?profile|response profile|formative need|engagement profile)\b/iu
    },
    {
      rule_code: "internal_plan_disclosure",
      safe_detail: "internal_plan_language_detected",
      pattern: /\b(?:internal (?:formative )?plan|planning metadata|selection rationale)\b/iu
    },
    {
      rule_code: "provider_metadata_disclosure",
      safe_detail: "provider_or_runtime_metadata_detected",
      pattern: /\b(?:provider request id|provider response id|agent call|schema version|configuration hash|runtime state)\b/iu
    },
    {
      rule_code: "fallback_metadata_disclosure",
      safe_detail: "fallback_or_retry_metadata_detected",
      pattern: /\b(?:deterministic fallback|fallback reason|provider retry|validation failure)\b/iu
    }
  ];
  for (const rule of rules) {
    const spans = matchingSpans(message, rule.pattern);
    if (spans.length > 0) {
      hard.push(textHardRejection({
        rule_code: rule.rule_code,
        field_path: "student_facing_message",
        safe_detail: rule.safe_detail,
        evidence_spans: spans
      }));
    }
  }

  const unrelatedSpans = matchingSpans(
    message,
    /\b(?:weather forecast|dinner recipe|football score|movie recommendation)\b/iu
  );
  if (unrelatedSpans.length > 0 && !semanticAnchorPresent(message, context)) {
    hard.push(textHardRejection({
      rule_code: "unrelated_to_active_assessment_topic",
      field_path: "student_facing_message",
      safe_detail: "response_changed_to_unrelated_topic",
      evidence_spans: unrelatedSpans,
      structured_evidence: ["active_semantic_anchor_absent"]
    }));
  }
  const earlierSpans = matchingSpans(
    message,
    /\b(?:earlier you asked|returning only to the earlier question)\b/iu
  );
  if (earlierSpans.length > 0 && !semanticAnchorPresent(message, context)) {
    hard.push(textHardRejection({
      rule_code: "latest_message_clearly_ignored",
      field_path: "student_facing_message",
      safe_detail: "materially_different_earlier_turn_answered",
      evidence_spans: earlierSpans,
      structured_evidence: ["active_semantic_anchor_absent"]
    }));
  }
  const genericSpans = matchingSpans(
    message,
    /\b(?:keep practicing|review your notes|think carefully and try again)\b/iu
  );
  if (genericSpans.length > 0 && !semanticAnchorPresent(message, context)) {
    hard.push(textHardRejection({
      rule_code: "generic_unanchored_tutoring",
      field_path: "student_facing_message",
      safe_detail: "generic_tutoring_without_active_anchor",
      evidence_spans: genericSpans,
      structured_evidence: ["active_semantic_anchor_absent"]
    }));
  }

  const masterySpans = matchingSpans(
    message,
    /\b(?:you have mastered|you clearly understand|that proves you understand|the misconception (?:is|has been) resolved)\b/iu
  );
  if (masterySpans.length > 0 && context.selected_mode === "remain_in_dialogue") {
    hard.push(textHardRejection({
      rule_code: "unsupported_mastery_acceptance",
      field_path: "student_facing_message",
      safe_detail: "mastery_accepted_without_platform_evidence",
      evidence_spans: masterySpans
    }));
  }
}

function addAuthorizationRejections(input: {
  message: string;
  context: TopicDialogueRuntimeValidationContext;
  hard: TopicDialogueHardRejection[];
}) {
  const { message, context, hard } = input;
  const readinessSpans = matchingSpans(
    message,
    /\b(?:you (?:are|'re) ready to (?:advance|move on|revise)|ready for the next (?:stage|step|item)|you have shown enough to advance)\b/iu
  );
  if (readinessSpans.length > 0) {
    hard.push(textHardRejection({
      rule_code: "unauthorized_readiness_claim",
      field_path: "student_facing_message",
      safe_detail: "platform_has_not_authorized_readiness_claim",
      evidence_spans: readinessSpans
    }));
  }

  const revisionSpans = matchingSpans(
    message,
    /\b(?:now|next|please|you can|let(?:'s| us))\s+(?:revise|rewrite|edit)\b[^.!?]{0,100}/iu
  );
  const transferSpans = matchingSpans(
    message,
    /\b(?:now|next|let(?:'s| us)|we can|you can)\s+(?:move to|start|try|do|take|begin|apply to)\s+(?:the )?(?:next transfer|transfer|new|next|another)\s+(?:item|question|task|context)\b/iu
  );
  const completionSpans = matchingSpans(
    message,
    /\b(?:this (?:activity|dialogue|assessment|episode) is complete|you(?:'re| are) finished|we(?:'re| are) done|this concludes)\b/iu
  );

  if (context.selected_mode === "remain_in_dialogue") {
    if (revisionSpans.length > 0 && context.selected_operation !== "clarify_task") {
      hard.push(textHardRejection({
        rule_code: "unauthorized_revision_offer",
        field_path: "student_facing_message",
        safe_detail: "revision_not_authorized",
        evidence_spans: revisionSpans
      }));
    }
    if (transferSpans.length > 0) {
      hard.push(textHardRejection({
        rule_code: "unauthorized_transfer_offer",
        field_path: "student_facing_message",
        safe_detail: "transfer_not_authorized",
        evidence_spans: transferSpans
      }));
    }
    if (completionSpans.length > 0) {
      hard.push(textHardRejection({
        rule_code: "unauthorized_completion_claim",
        field_path: "student_facing_message",
        safe_detail: "completion_not_authorized",
        evidence_spans: completionSpans
      }));
    }
  } else if (context.selected_mode === "request_revision") {
    if (transferSpans.length > 0) {
      hard.push(textHardRejection({
        rule_code: "revision_transfer_conflation",
        field_path: "tutor_message",
        safe_detail: "transfer_language_in_revision_mode",
        evidence_spans: transferSpans
      }));
    }
    if (completionSpans.length > 0) {
      hard.push(textHardRejection({
        rule_code: "unauthorized_completion_claim",
        field_path: "tutor_message",
        safe_detail: "completion_language_in_revision_mode",
        evidence_spans: completionSpans
      }));
    }
  } else if (context.selected_mode === "present_transfer") {
    if (revisionSpans.length > 0) {
      hard.push(textHardRejection({
        rule_code: "revision_transfer_conflation",
        field_path: "tutor_message",
        safe_detail: "revision_language_in_transfer_mode",
        evidence_spans: revisionSpans
      }));
    }
    if (completionSpans.length > 0) {
      hard.push(textHardRejection({
        rule_code: "unauthorized_completion_claim",
        field_path: "tutor_message",
        safe_detail: "completion_language_in_transfer_mode",
        evidence_spans: completionSpans
      }));
    }
    const itemSpans = matchingSpans(
      message,
      /(?:\b[A-D]\.\s+[^\n]+|\bwhich option is correct\??)/iu
    );
    if (itemSpans.length > 0) {
      hard.push(textHardRejection({
        rule_code: "fabricated_transfer_item",
        field_path: "tutor_message",
        safe_detail: "platform_owned_transfer_item_was_generated",
        evidence_spans: itemSpans
      }));
    }
  } else {
    const newTaskSpans = [...revisionSpans, ...transferSpans];
    if (newTaskSpans.length > 0) {
      hard.push(textHardRejection({
        rule_code: "new_task_after_completion",
        field_path: "tutor_message",
        safe_detail: "completion_mode_introduced_new_task",
        evidence_spans: newTaskSpans
      }));
    }
    const overclaimSpans = matchingSpans(
      message,
      /\b(?:you have mastered|you fully understand|all misconceptions are resolved)\b/iu
    );
    if (overclaimSpans.length > 0) {
      hard.push(textHardRejection({
        rule_code: "completion_overclaim",
        field_path: "tutor_message",
        safe_detail: "claim_exceeds_platform_accepted_evidence",
        evidence_spans: overclaimSpans
      }));
    }
  }
}

export function validateTopicDialogueRuntimeAcceptance(input: {
  context: TopicDialogueRuntimeValidationContext;
  output: unknown;
}): TopicDialogueRuntimeValidationResult {
  const { context, output } = input;
  const hard: TopicDialogueHardRejection[] = [];

  if (context.selected_mode === "remain_in_dialogue" && !context.selected_operation) {
    hard.push(structuredHardRejection({
      rule_code: "server_envelope_operation_missing",
      field_path: "selected_operation",
      safe_detail: "remain_in_dialogue_requires_server_selected_operation",
      structured_evidence: ["selected_operation=null"]
    }));
  }
  if (context.selected_mode !== "remain_in_dialogue" && context.selected_operation) {
    hard.push(structuredHardRejection({
      rule_code: "server_envelope_operation_conflict",
      field_path: "selected_operation",
      safe_detail: "progression_mode_must_not_include_dialogue_operation",
      structured_evidence: [`selected_operation=${context.selected_operation}`]
    }));
  }

  const record = isRecord(output) ? output : null;
  const expectedFields = context.selected_mode === "remain_in_dialogue"
    ? operationExpectedFields
    : progressionExpectedFields;
  if (record) {
    for (const [field, ruleCode] of Object.entries(controlFieldRules)) {
      if (field in record) {
        hard.push(structuredHardRejection({
          rule_code: ruleCode,
          field_path: field,
          safe_detail: "provider_must_not_generate_server_owned_control",
          structured_evidence: [`unexpected_property=${field}`]
        }));
      }
    }
    for (const field of Object.keys(record)) {
      if (!expectedFields.has(field) && !(field in controlFieldRules)) {
        hard.push(structuredHardRejection({
          rule_code: "unknown_property_prohibited",
          field_path: field,
          safe_detail: "strict_output_schema_rejects_unknown_property",
          structured_evidence: [`unexpected_property=${field}`]
        }));
      }
    }
  }

  const expectedVersion = expectedSchemaVersion(context);
  if (record && expectedVersion && record.schema_version !== expectedVersion) {
    hard.push(structuredHardRejection({
      rule_code: "wrong_schema_version",
      field_path: "schema_version",
      safe_detail: "provider_schema_version_does_not_match_selected_contract",
      structured_evidence: [
        `expected=${expectedVersion}`,
        `received=${String(record.schema_version)}`
      ]
    }));
  }

  const parsed = parseExpectedOutput(context, output);
  if (!parsed) {
    hard.push(structuredHardRejection({
      rule_code: context.selected_mode === "remain_in_dialogue"
        ? "operation_schema_mismatch"
        : "progression_schema_mismatch",
      field_path: "output",
      safe_detail: "output_does_not_match_selected_strict_schema",
      structured_evidence: [
        `selected_mode=${context.selected_mode}`,
        `expected_schema=${expectedVersion ?? "unavailable"}`
      ]
    }));
  }

  const message = visibleMessage(output);
  if (!message || message.trim().length === 0) {
    hard.push(structuredHardRejection({
      rule_code: "missing_required_student_message",
      field_path: context.selected_mode === "remain_in_dialogue"
        ? "student_facing_message"
        : "tutor_message",
      safe_detail: "student_facing_message_is_missing_or_empty",
      structured_evidence: ["usable_student_message=false"]
    }));
  }

  if (message && message.trim().length > 0) {
    addTextPatternRejections({ message, context, hard });
    addAuthorizationRejections({ message, context, hard });
    if (context.selected_operation === "protected_redirect") {
      const disclosure = hard.filter((entry) => [
        "answer_key_disclosure",
        "hidden_prompt_disclosure"
      ].includes(entry.rule_code));
      for (const entry of disclosure) {
        hard.push(textHardRejection({
          rule_code: "protected_request_fulfilled",
          field_path: entry.field_path,
          safe_detail: "protected_content_was_disclosed",
          evidence_spans: entry.evidence_spans,
          structured_evidence: ["selected_operation=protected_redirect"]
        }));
      }
    }
  }

  const deduplicatedHard = [...new Map(hard.map((entry) => [
    `${entry.rule_code}:${entry.field_path}:${entry.safe_detail}`,
    entry
  ])).values()];
  const soft = message && deduplicatedHard.length === 0
    ? evaluateTopicDialoguePedagogicalRubric({ context, message })
    : [];
  const runtimeAcceptance: TopicDialogueRuntimeAcceptance =
    deduplicatedHard.length > 0
      ? "hard_rejected"
      : soft.length > 0
        ? "accepted_with_review_flags"
        : "accepted";
  return {
    validator_version: TOPIC_DIALOGUE_RUNTIME_VALIDATOR_V2_VERSION,
    validation_policy_version: TOPIC_DIALOGUE_VALIDATION_POLICY_V2_VERSION,
    runtime_acceptance: runtimeAcceptance,
    hard_rejection_reasons: deduplicatedHard,
    soft_review_flags: soft,
    regeneration_required: runtimeAcceptance === "hard_rejected",
    deterministic_fallback_required: false,
    safe_for_student_display: runtimeAcceptance !== "hard_rejected",
    human_review_recommended: soft.length > 0,
    parsed_output: parsed,
    visible_message: message
  };
}

export function resolveTopicDialogueRegenerationPolicy(input: {
  initial: TopicDialogueRuntimeValidationResult;
  regenerated?: TopicDialogueRuntimeValidationResult;
}) {
  if (input.initial.runtime_acceptance !== "hard_rejected") {
    return {
      policy_version: TOPIC_DIALOGUE_REGENERATION_POLICY_V2_VERSION,
      regeneration_required: false,
      deterministic_fallback_required: false,
      display_source: "initial_provider_output" as const
    };
  }
  if (!input.regenerated) {
    return {
      policy_version: TOPIC_DIALOGUE_REGENERATION_POLICY_V2_VERSION,
      regeneration_required: true,
      deterministic_fallback_required: false,
      display_source: "await_regeneration" as const
    };
  }
  if (input.regenerated.runtime_acceptance === "hard_rejected") {
    return {
      policy_version: TOPIC_DIALOGUE_REGENERATION_POLICY_V2_VERSION,
      regeneration_required: false,
      deterministic_fallback_required: true,
      display_source: "deterministic_fallback" as const
    };
  }
  return {
    policy_version: TOPIC_DIALOGUE_REGENERATION_POLICY_V2_VERSION,
    regeneration_required: false,
    deterministic_fallback_required: false,
    display_source: "regenerated_provider_output" as const
  };
}
