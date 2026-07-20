import {
  evaluateTopicDialoguePedagogicalRubric,
  validateTopicDialogueRuntimeAcceptance,
  type TopicDialogueHardRejection,
  type TopicDialogueRuntimeAcceptance,
  type TopicDialogueRuntimeValidationContext,
  type TopicDialogueRuntimeValidationResult,
  type TopicDialogueSoftReviewFlag
} from "@/lib/services/student-assessment/topic-dialogue-runtime-validation-v2";

export const TOPIC_DIALOGUE_RUNTIME_VALIDATOR_V3_VERSION =
  "eval-topic-dialogue-runtime-acceptance-v3" as const;
export const TOPIC_DIALOGUE_VALIDATION_POLICY_V3_VERSION =
  "topic-dialogue-runtime-vs-quality-policy-v3" as const;
export const TOPIC_DIALOGUE_PROTECTED_REQUEST_POLICY_V1_VERSION =
  "topic-dialogue-protected-disclosure-semantics-v1" as const;
export const TOPIC_DIALOGUE_PROTECTED_HARD_REJECTION_POLICY_V1_VERSION =
  "topic-dialogue-protected-disclosure-evidence-v1" as const;

export type TopicDialogueProtectedHardRejection = TopicDialogueHardRejection & {
  disclosure_explanation: string;
};

export type TopicDialogueRuntimeValidationV3Result = Omit<
  TopicDialogueRuntimeValidationResult,
  "validator_version" | "validation_policy_version" | "hard_rejection_reasons"
> & {
  validator_version: typeof TOPIC_DIALOGUE_RUNTIME_VALIDATOR_V3_VERSION;
  validation_policy_version: typeof TOPIC_DIALOGUE_VALIDATION_POLICY_V3_VERSION;
  hard_rejection_reasons: Array<
    TopicDialogueHardRejection | TopicDialogueProtectedHardRejection
  >;
};

type VisibleField = {
  field_path: string;
  text: string;
};

type ProtectedDisclosureRule = {
  rule_code: string;
  safe_detail: string;
  disclosure_explanation: string;
  patterns: RegExp[];
};

const V2_PROTECTED_LEXICAL_RULES = new Set([
  "answer_key_disclosure",
  "hidden_prompt_disclosure",
  "internal_profile_disclosure",
  "internal_plan_disclosure",
  "provider_metadata_disclosure",
  "fallback_metadata_disclosure",
  "protected_request_fulfilled"
]);

const refusalIntentPattern =
  /\b(?:(?:i|we)\s+(?:(?:can(?:not|'t)|cannot|won't|will not|am unable to|are unable to)\s+(?:provide|reveal|share|show|give|send|paste|disclose|display|access|discuss|help with)|(?:must|need to)\s+(?:keep|leave)\s+[^.!?\n]{0,50}\s+(?:private|hidden|protected))|(?:that|this|it)\s+(?:is|isn't|is not)\s+not\s+(?:information|something)\s+i\s+can\s+(?:provide|share|reveal))\b/iu;

const protectedObjectPattern =
  /\b(?:answer key|correct answer|correct option|keyed (?:answer|choice|option)|unadministered answer|hidden (?:system )?(?:prompt|instructions?|rubric)|system (?:prompt|instructions?)|developer (?:prompt|instructions?)|evaluator prompt|private (?:directions?|instructions?)|internal (?:student )?profile|hidden assessment profile|response profile|formative need|engagement profile|internal (?:formative )?plan|planning metadata|selection rationale|teacher-only rationale|teacher diagnostic notes?|teacher notes?|distractor rationale|provider request id|provider response id|agent call|schema version|configuration hash|runtime state|validator version|deterministic fallback|fallback reason|provider retry|validation failure)\b/giu;

const disclosureRules: ProtectedDisclosureRule[] = [
  {
    rule_code: "internal_profile_disclosure",
    safe_detail: "internal_profile_content_disclosed",
    disclosure_explanation:
      "The response attributes a substantive classification or inference to a hidden student profile.",
    patterns: [
      /\b(?:your|the student(?:'s)?|the student's|this student(?:'s)?)\s+(?:(?:internal|hidden|assessment|response|engagement)\s+){0,2}profile\s+(?:says?|shows?|indicates?|records?|lists?|contains?|identifies?|classifies?|marks?)\b[^.!?\n]{0,180}/giu,
      /\b(?:your|the student(?:'s)?|the student's)\s+(?:formative need|response profile|engagement profile)\s*(?:is|says?|shows?|indicates?|records?|:)\s*[^.!?\n]{1,180}/giu,
      /\bthe system\s+(?:classified|labels?|marked|identified)\s+you\s+as\b[^.!?\n]{0,140}/giu
    ]
  },
  {
    rule_code: "hidden_prompt_disclosure",
    safe_detail: "hidden_instruction_content_disclosed",
    disclosure_explanation:
      "The response states or paraphrases content attributed to hidden instructions or a private rubric.",
    patterns: [
      /\b(?:the\s+)?(?:hidden|system|developer|evaluator|private)\s+(?:system\s+)?(?:prompt|instructions?|rubric|directions?)\s*(?:says?|requires?|instructs?|tells?|reads?|contains?|is|are|:)\s*[^.!?\n]{1,180}/giu,
      /\b(?:the\s+)?evaluator prompt\s+(?:says?|requires?|instructs?|contains?|is|:)\s*[^.!?\n]{1,180}/giu
    ]
  },
  {
    rule_code: "answer_key_disclosure",
    safe_detail: "answer_key_content_disclosed",
    disclosure_explanation:
      "The response identifies a keyed or correct option rather than refusing the protected request.",
    patterns: [
      /\b(?:the\s+)?(?:correct answer|correct option|keyed (?:answer|choice|option))\s*(?:is|:|=)\s*(?:option\s*)?[A-D]\b/giu,
      /\boption\s+[A-D]\s+(?:is|was)\s+(?:the\s+)?correct\b/giu,
      /\b(?:the\s+)?answer key\s+(?:says?|shows?|lists?|identifies?|gives?|marks?|contains?)\s+(?:that\s+)?(?:option\s+)?[A-D]\b[^.!?\n]{0,100}/giu
    ]
  },
  {
    rule_code: "provider_metadata_disclosure",
    safe_detail: "provider_or_runtime_metadata_disclosed",
    disclosure_explanation:
      "The response reveals a provider, runtime, schema, configuration, or validator value.",
    patterns: [
      /\b(?:the\s+)?(?:openai|provider|model)\s+(?:system\s+)?(?:generated|returned|used|selected|reported)\b[^.!?\n]{1,180}/giu,
      /\b(?:your|the)?\s*(?:provider request id|provider response id|agent call|schema version|configuration hash|runtime state|validator version)\s*(?:is|:|=|says?|shows?)\s*[^.!?\n]{1,180}/giu
    ]
  },
  {
    rule_code: "internal_plan_disclosure",
    safe_detail: "teacher_or_internal_plan_content_disclosed",
    disclosure_explanation:
      "The response states content attributed to an internal plan, teacher-only rationale, or diagnostic note.",
    patterns: [
      /\b(?:the\s+)?(?:internal (?:formative )?plan|planning metadata|selection rationale|teacher-only rationale|teacher diagnostic notes?|teacher notes?|distractor rationale)\s*(?:says?|shows?|indicates?|records?|contains?|is|:)\s*[^.!?\n]{1,180}/giu
    ]
  },
  {
    rule_code: "fallback_metadata_disclosure",
    safe_detail: "fallback_or_retry_metadata_disclosed",
    disclosure_explanation:
      "The response reveals fallback, retry, or validation-failure execution metadata.",
    patterns: [
      /\b(?:a\s+|the\s+)?(?:deterministic fallback|fallback reason|provider retry|validation failure)\s+(?:was|is|says?|shows?|occurred|used|triggered)\b[^.!?\n]{0,160}/giu
    ]
  }
];

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function matchingSpans(text: string, pattern: RegExp) {
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  return unique([...text.matchAll(new RegExp(pattern.source, flags))]
    .map((match) => match[0].trim()));
}

function visibleFields(output: unknown): VisibleField[] {
  if (!output || typeof output !== "object" || Array.isArray(output)) return [];
  const record = output as Record<string, unknown>;
  const candidates: Array<[string, unknown]> = [
    ["student_facing_message", record.student_facing_message],
    ["tutor_message", record.tutor_message],
    ["student_safe_summary", record.student_safe_summary]
  ];
  return candidates.flatMap(([fieldPath, value]) => typeof value === "string"
    ? [{ field_path: fieldPath, text: value }]
    : []);
}

function protectedDisclosureRejections(fields: VisibleField[]) {
  return fields.flatMap((field) => disclosureRules.flatMap((rule) => {
    const spans = unique(rule.patterns.flatMap((pattern) =>
      matchingSpans(field.text, pattern)
    )).filter((span) => !/\b(?:cannot|can't|won't|will not|is not information i can|is not something i can)\b/iu
      .test(span));
    return spans.length === 0 ? [] : [{
      rule_code: rule.rule_code,
      field_path: field.field_path,
      evidence_spans: spans,
      structured_evidence: [],
      safe_detail: rule.safe_detail,
      disclosure_explanation: rule.disclosure_explanation
    } satisfies TopicDialogueProtectedHardRejection];
  }));
}

function protectedRefusalReviewFlags(fields: VisibleField[]) {
  const flags: TopicDialogueSoftReviewFlag[] = [];
  for (const field of fields) {
    const protectedMentions = matchingSpans(field.text, protectedObjectPattern);
    if (protectedMentions.length === 0) continue;
    const refusalIntent = refusalIntentPattern.test(field.text);
    if (!refusalIntent) {
      flags.push({
        dimension: "protected_request_quality",
        rule_code: "protected_concept_mention_ambiguous",
        evidence_spans: protectedMentions,
        safe_detail: "protected_term_mentioned_without_disclosure_or_clear_refusal",
        review_priority: "elevated"
      });
      continue;
    }
    const redirectPresent = /\b(?:but|instead|return|focus|compare|analy[sz]e|work through|work on|consider|explain|what|how|why)\b/iu
      .test(field.text);
    if (!redirectPresent) {
      flags.push({
        dimension: "protected_request_quality",
        rule_code: "protected_refusal_redirect_weak",
        evidence_spans: protectedMentions,
        safe_detail: "safe_refusal_does_not_provide_a_clear_formative_redirect",
        review_priority: "routine"
      });
    }
    const awkward = matchingSpans(
      field.text,
      /\b(?:can't do that|not giving you that|nope|that is off limits)\b/giu
    );
    if (awkward.length > 0) {
      flags.push({
        dimension: "protected_request_quality",
        rule_code: "protected_refusal_wording_awkward",
        evidence_spans: awkward,
        safe_detail: "safe_refusal_wording_requires_human_quality_review",
        review_priority: "routine"
      });
    }
  }
  return flags;
}

function deduplicateHard(
  values: Array<TopicDialogueHardRejection | TopicDialogueProtectedHardRejection>
) {
  return [...new Map(values.map((entry) => [
    `${entry.rule_code}:${entry.field_path}:${entry.safe_detail}`,
    entry
  ])).values()];
}

function deduplicateSoft(values: TopicDialogueSoftReviewFlag[]) {
  return [...new Map(values.map((entry) => [
    `${entry.dimension}:${entry.rule_code}:${entry.safe_detail}`,
    entry
  ])).values()];
}

export function validateTopicDialogueRuntimeAcceptanceV3(input: {
  context: TopicDialogueRuntimeValidationContext;
  output: unknown;
}): TopicDialogueRuntimeValidationV3Result {
  const v2 = validateTopicDialogueRuntimeAcceptance(input);
  const fields = visibleFields(input.output);
  const inheritedHard = v2.hard_rejection_reasons.filter((entry) =>
    !V2_PROTECTED_LEXICAL_RULES.has(entry.rule_code)
  );
  const protectedHard = protectedDisclosureRejections(fields);
  const hard = deduplicateHard([...inheritedHard, ...protectedHard]);
  const soft = hard.length === 0
    ? deduplicateSoft([
      ...(v2.visible_message
        ? evaluateTopicDialoguePedagogicalRubric({
          context: input.context,
          message: v2.visible_message
        })
        : []),
      ...protectedRefusalReviewFlags(fields)
    ])
    : [];
  const runtimeAcceptance: TopicDialogueRuntimeAcceptance = hard.length > 0
    ? "hard_rejected"
    : soft.length > 0
      ? "accepted_with_review_flags"
      : "accepted";
  return {
    validator_version: TOPIC_DIALOGUE_RUNTIME_VALIDATOR_V3_VERSION,
    validation_policy_version: TOPIC_DIALOGUE_VALIDATION_POLICY_V3_VERSION,
    runtime_acceptance: runtimeAcceptance,
    hard_rejection_reasons: hard,
    soft_review_flags: soft,
    regeneration_required: runtimeAcceptance === "hard_rejected",
    deterministic_fallback_required: false,
    safe_for_student_display: runtimeAcceptance !== "hard_rejected",
    human_review_recommended: soft.length > 0,
    parsed_output: v2.parsed_output,
    visible_message: v2.visible_message
  };
}

export function resolveTopicDialogueRegenerationPolicyV3(input: {
  initial: TopicDialogueRuntimeValidationV3Result;
  regenerated?: TopicDialogueRuntimeValidationV3Result;
}) {
  if (input.initial.runtime_acceptance !== "hard_rejected") {
    return {
      policy_version: "topic-dialogue-hard-rejection-only-regeneration-v2",
      regeneration_required: false,
      deterministic_fallback_required: false,
      display_source: "initial_provider_output" as const
    };
  }
  if (!input.regenerated) {
    return {
      policy_version: "topic-dialogue-hard-rejection-only-regeneration-v2",
      regeneration_required: true,
      deterministic_fallback_required: false,
      display_source: "await_regeneration" as const
    };
  }
  if (input.regenerated.runtime_acceptance === "hard_rejected") {
    return {
      policy_version: "topic-dialogue-hard-rejection-only-regeneration-v2",
      regeneration_required: false,
      deterministic_fallback_required: true,
      display_source: "deterministic_fallback" as const
    };
  }
  return {
    policy_version: "topic-dialogue-hard-rejection-only-regeneration-v2",
    regeneration_required: false,
    deterministic_fallback_required: false,
    display_source: "regenerated_provider_output" as const
  };
}
