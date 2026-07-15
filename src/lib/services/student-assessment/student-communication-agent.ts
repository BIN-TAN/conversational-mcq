import { z } from "zod";

export const STUDENT_COMMUNICATION_AGENT_NAME = "student_communication_agent" as const;
export const STUDENT_COMMUNICATION_PROMPT_VERSION =
  "student-communication-v1" as const;
export const STUDENT_COMMUNICATION_INPUT_SCHEMA_VERSION =
  "student-communication-input-v1" as const;
export const STUDENT_COMMUNICATION_OUTPUT_SCHEMA_VERSION =
  "student-communication-output-v1" as const;
export const STUDENT_COMMUNICATION_FACT_LOCK_VALIDATOR_VERSION =
  "student-communication-fact-lock-validator-v1" as const;
export const STUDENT_COMMUNICATION_LANGUAGE_VALIDATOR_VERSION =
  "student-communication-language-validator-v1" as const;
export const STUDENT_COMMUNICATION_FALLBACK_VERSION =
  "student-communication-deterministic-fallback-v1" as const;
export const STUDENT_COMMUNICATION_RENDERED_VERSION =
  "student-communication-rendered-v1" as const;

const StudentCommunicationItemSummarySchema = z.object({
  item_number: z.number().int().positive(),
  item_public_id: z.string().min(1),
  status_label: z.enum(["Correct", "Incorrect", "Unanswered", "Not scored"]),
  student_answer_label: z.string().min(1),
  correct_answer_label: z.string().min(1).nullable(),
  answer_explanation: z.string().min(1).nullable(),
  distractor_boundary: z.string().min(1).nullable()
}).strict();

export const StudentCommunicationInputV1Schema = z.object({
  communication_input_schema_version: z.literal(STUDENT_COMMUNICATION_INPUT_SCHEMA_VERSION),
  session_public_id: z.string().min(1),
  package_public_id: z.string().min(1),
  communication_purpose: z.enum([
    "initial_package_results",
    "replacement_activity_transition",
    "completion_summary"
  ]),
  administered_item_summaries: z.array(StudentCommunicationItemSummarySchema).min(1),
  validated_outcome_summary: z.object({
    items_administered: z.number().int().positive(),
    items_correct: z.number().int().nonnegative(),
    initial_results: z.string().min(1)
  }).strict(),
  validated_understanding_summary: z.object({
    status: z.enum(["Mostly understood", "Still developing", "Needs more work"]),
    student_label: z.string().min(1),
    safe_explanation: z.string().min(1)
  }).strict(),
  validated_reasoning_summary: z.object({
    student_label: z.string().min(1),
    safe_explanation: z.string().min(1)
  }).strict(),
  validated_confidence_summary: z.object({
    student_label: z.string().min(1),
    safe_explanation: z.string().min(1)
  }).strict(),
  validated_evidence_limitations: z.array(z.string().min(1)),
  validated_growth_target: z.object({
    student_facing_text: z.string().min(1),
    compatible_activity_types: z.array(z.string().min(1)).min(1)
  }).strict(),
  validated_item_explanations: z.array(z.object({
    item_number: z.number().int().positive(),
    why_correct: z.string().min(1),
    distractor_boundary: z.string().min(1).nullable()
  }).strict()).min(1),
  validated_activity_contract: z.object({
    activity_family: z.string().min(1),
    activity_type: z.string().min(1),
    source_item_number: z.number().int().positive().nullable(),
    source_option_label: z.string().min(1).nullable(),
    source_option_text: z.string().min(1).nullable(),
    expected_response_format: z.string().min(1),
    next_runtime_state: z.string().min(1),
    prompt: z.string().min(1)
  }).strict(),
  answer_reveal_state: z.object({
    full_answer_key_revealed: z.boolean(),
    may_show_correct_options_for_administered_items: z.boolean()
  }).strict(),
  language: z.literal("en"),
  reading_level_target: z.literal("undergraduate_plain_english"),
  maximum_length_constraints: z.object({
    initial_results_intro_max_chars: z.number().int().positive(),
    summary_max_chars: z.number().int().positive(),
    activity_prompt_max_chars: z.number().int().positive(),
    completion_message_max_chars: z.number().int().positive()
  }).strict(),
  source_profile_version: z.string().min(1),
  source_activity_version: z.string().min(1)
}).strict();
export type StudentCommunicationInputV1 = z.infer<typeof StudentCommunicationInputV1Schema>;

export const StudentCommunicationOutputV1Schema = z.object({
  communication_schema_version: z.literal(STUDENT_COMMUNICATION_OUTPUT_SCHEMA_VERSION),
  package_feedback_narrative: z.string().min(1).max(1200),
  item_review_introductions: z.array(z.object({
    item_number: z.number().int().positive(),
    status_label: z.enum(["Correct", "Incorrect", "Unanswered", "Not scored"]),
    student_answer_label: z.string().min(1),
    correct_answer_label: z.string().min(1).nullable(),
    introduction: z.string().min(1).max(260)
  }).strict()).min(1),
  activity_transition: z.string().min(1).max(260),
  activity_prompt: z.string().min(1).max(900),
  post_activity_feedback: z.string().min(1).max(700),
  ready_to_advance_message: z.string().min(1).max(300),
  topic_dialogue_transition: z.string().min(1).max(300),
  completion_message: z.string().min(1).max(260),
  evidence_reference_map: z.array(z.object({
    item_number: z.number().int().positive(),
    evidence_summary: z.string().min(1).max(220)
  }).strict()).min(1)
}).strict();
export type StudentCommunicationOutputV1 = z.infer<typeof StudentCommunicationOutputV1Schema>;

export type StudentCommunicationIssue = {
  rule_code:
    | "schema_invalid"
    | "item_count_changed"
    | "item_review_missing"
    | "correctness_changed"
    | "selected_answer_changed"
    | "correct_answer_changed"
    | "generic_answer_explanation"
    | "growth_target_changed"
    | "activity_type_changed"
    | "activity_source_omitted"
    | "activity_task_missing"
    | "unadministered_answer_reveal"
    | "unsupported_process_claim"
    | "internal_term_detected";
  field_path: string;
  blocked_pattern_label?: string;
};

export type StudentCommunicationValidationResult = {
  valid: boolean;
  validator_version: string;
  issues: StudentCommunicationIssue[];
};

function collectStrings(value: unknown, path = "output"): Array<{ path: string; value: string }> {
  if (typeof value === "string") {
    return [{ path, value }];
  }

  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => collectStrings(entry, `${path}.${index}`));
  }

  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).flatMap(([key, entry]) =>
      collectStrings(entry, `${path}.${key}`)
    );
  }

  return [];
}

const forbiddenStudentLanguagePatterns: Array<{
  label: string;
  pattern: RegExp;
}> = [
  { label: "selected_option", pattern: /\bselected_option\b/i },
  { label: "scored_outcome", pattern: /\bscored_outcome\b/i },
  { label: "tempting_option_unavailable", pattern: /\btempting_option_unavailable\b/i },
  { label: "tempting_option", pattern: /\btempting_option\b/i },
  { label: "reasoning_unavailable", pattern: /\breasoning_unavailable\b/i },
  { label: "confidence_unavailable", pattern: /\bconfidence_unavailable\b/i },
  { label: "calibration_label", pattern: /\b(calibration|reasonably_calibrated|overconfident|underconfident)\b/i },
  { label: "ontology_label", pattern: /\bontology\b/i },
  { label: "profile_schema_label", pattern: /\bprofile schema\b/i },
  { label: "evidence_package_label", pattern: /\bevidence package\b/i },
  { label: "persistence_label", pattern: /\b(persisted|recorded for this version)\b/i },
  { label: "runtime_label", pattern: /\bruntime\b/i },
  { label: "routing_label", pattern: /\brouting\b/i },
  { label: "diagnostic_purpose_label", pattern: /\bdiagnostic purpose\b/i },
  { label: "source_reference_label", pattern: /\bsource reference\b/i },
  { label: "future_version_label", pattern: /\bfuture version\b/i },
  { label: "schema_label", pattern: /\bschema\b/i },
  { label: "fallback_label", pattern: /\bfallback\b/i },
  { label: "provider_debug_label", pattern: /\b(agent call|raw llm output|raw model output|structured output|system prompt)\b/i },
  { label: "secret_label", pattern: /\b(api key|authorization header|bearer token|database url|session secret|password hash)\b/i }
];

function sentence(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function activityPromptFor(input: StudentCommunicationInputV1) {
  const contract = input.validated_activity_contract;
  const sourcePrefix =
    contract.source_item_number && contract.source_option_label && contract.source_option_text
      ? `For Item ${contract.source_item_number}, option ${contract.source_option_label} says: "${contract.source_option_text}".`
      : contract.source_item_number && contract.source_option_label
        ? `For Item ${contract.source_item_number}, option ${contract.source_option_label} is the focus.`
        : contract.source_item_number
          ? `For Item ${contract.source_item_number}, use the item you just reviewed.`
          : "Use one item from the first set you just reviewed.";

  const normalizedPrompt = sentence(contract.prompt)
    .replace(/^Option\s+([A-D])\b/i, `Option $1`)
    .replace(/\bOption\s+([A-D]) could\b/i, `option $1 could`);

  return `${sourcePrefix} ${normalizedPrompt} ${contract.expected_response_format}`;
}

function joinNaturalSentences(parts: Array<string | null | undefined>) {
  return parts
    .map((part) => part?.trim().replace(/\s+/g, " "))
    .filter((part): part is string => Boolean(part))
    .join(" ");
}

function cleanConfidenceText(value: string) {
  return value
    .replace(/\bconfidence calibrated\b/gi, "confidence mostly matched the evidence")
    .replace(/\breasonably_calibrated\b/gi, "mostly matched")
    .replace(/\boverconfident\b/gi, "sounded more certain than the evidence supported")
    .replace(/\bunderconfident\b/gi, "sounded less certain than the answer evidence supported")
    .replace(/\bcalibration\b/gi, "confidence pattern");
}

export function buildDeterministicStudentCommunicationFallback(
  input: StudentCommunicationInputV1
): StudentCommunicationOutputV1 {
  const itemReviews = input.administered_item_summaries.map((item) => ({
    item_number: item.item_number,
    status_label: item.status_label,
    student_answer_label: item.student_answer_label,
    correct_answer_label: input.answer_reveal_state.may_show_correct_options_for_administered_items
      ? item.correct_answer_label
      : null,
    introduction: `Item ${item.item_number} is ready for review.`
  }));
  const limitationText = input.validated_evidence_limitations.length > 0
    ? input.validated_evidence_limitations[0]
    : "";
  const packageNarrative = joinNaturalSentences([
    `You answered ${input.validated_outcome_summary.initial_results}.`,
    input.validated_understanding_summary.safe_explanation,
    input.validated_reasoning_summary.safe_explanation,
    cleanConfidenceText(input.validated_confidence_summary.safe_explanation || input.validated_confidence_summary.student_label),
    limitationText,
    `The main idea to strengthen is: ${input.validated_growth_target.student_facing_text}.`,
    "Based on your responses, here is a recommended activity that can help you strengthen this idea:"
  ]);

  return {
    communication_schema_version: STUDENT_COMMUNICATION_OUTPUT_SCHEMA_VERSION,
    package_feedback_narrative: packageNarrative,
    item_review_introductions: itemReviews,
    activity_transition: "Here is a different way to work on the same idea.",
    activity_prompt: activityPromptFor(input),
    post_activity_feedback: "Thanks. I can use that response to decide whether to continue with this idea or move to the next step.",
    ready_to_advance_message: "Your response addresses the key distinction clearly. You can continue when you are ready.",
    topic_dialogue_transition: "Let us work through the remaining part of this idea together.",
    completion_message: "You can use this next response to make the idea clearer.",
    evidence_reference_map: input.administered_item_summaries.map((item) => ({
      item_number: item.item_number,
      evidence_summary: `Item ${item.item_number} used the answer choice, result, explanation, confidence rating, and tempting-option evidence when available.`
    }))
  };
}

export function validateStudentCommunicationLanguage(
  value: unknown
): StudentCommunicationValidationResult {
  const parsed = StudentCommunicationOutputV1Schema.safeParse(value);
  if (!parsed.success) {
    return {
      valid: false,
      validator_version: STUDENT_COMMUNICATION_LANGUAGE_VALIDATOR_VERSION,
      issues: parsed.error.issues.map((issue) => ({
        rule_code: "schema_invalid",
        field_path: issue.path.join(".") || "output"
      }))
    };
  }

  const issues: StudentCommunicationIssue[] = [];
  for (const entry of collectStrings(parsed.data)) {
    for (const forbidden of forbiddenStudentLanguagePatterns) {
      if (forbidden.pattern.test(entry.value)) {
        issues.push({
          rule_code: "internal_term_detected",
          field_path: entry.path,
          blocked_pattern_label: forbidden.label
        });
      }
    }
    if (/\b(cheating|misconduct|dishonest|low effort|poor effort|high effort|motivation)\b/i.test(entry.value)) {
      issues.push({
        rule_code: "unsupported_process_claim",
        field_path: entry.path,
        blocked_pattern_label: "unsupported_process_or_motivation_claim"
      });
    }
  }

  return {
    valid: issues.length === 0,
    validator_version: STUDENT_COMMUNICATION_LANGUAGE_VALIDATOR_VERSION,
    issues
  };
}

export function validateStudentCommunicationOutputFacts(input: {
  frozen_input: StudentCommunicationInputV1;
  output: unknown;
}): StudentCommunicationValidationResult {
  const parsed = StudentCommunicationOutputV1Schema.safeParse(input.output);
  if (!parsed.success) {
    return {
      valid: false,
      validator_version: STUDENT_COMMUNICATION_FACT_LOCK_VALIDATOR_VERSION,
      issues: parsed.error.issues.map((issue) => ({
        rule_code: "schema_invalid",
        field_path: issue.path.join(".") || "output"
      }))
    };
  }

  const output = parsed.data;
  const issues: StudentCommunicationIssue[] = [];
  const expectedItems = input.frozen_input.administered_item_summaries;

  if (output.item_review_introductions.length !== expectedItems.length) {
    issues.push({
      rule_code: "item_count_changed",
      field_path: "item_review_introductions"
    });
  }

  for (const expected of expectedItems) {
    const actual = output.item_review_introductions.find((item) => item.item_number === expected.item_number);
    if (!actual) {
      issues.push({
        rule_code: "item_review_missing",
        field_path: `item_review_introductions.item_${expected.item_number}`
      });
      continue;
    }
    if (actual.status_label !== expected.status_label) {
      issues.push({
        rule_code: "correctness_changed",
        field_path: `item_review_introductions.item_${expected.item_number}.status_label`
      });
    }
    if (actual.student_answer_label !== expected.student_answer_label) {
      issues.push({
        rule_code: "selected_answer_changed",
        field_path: `item_review_introductions.item_${expected.item_number}.student_answer_label`
      });
    }
    const expectedCorrect = input.frozen_input.answer_reveal_state.may_show_correct_options_for_administered_items
      ? expected.correct_answer_label
      : null;
    if (actual.correct_answer_label !== expectedCorrect) {
      issues.push({
        rule_code: expectedCorrect ? "correct_answer_changed" : "unadministered_answer_reveal",
        field_path: `item_review_introductions.item_${expected.item_number}.correct_answer_label`
      });
    }
  }

  if (!output.package_feedback_narrative.includes(input.frozen_input.validated_growth_target.student_facing_text)) {
    issues.push({
      rule_code: "growth_target_changed",
      field_path: "package_feedback_narrative"
    });
  }

  const contract = input.frozen_input.validated_activity_contract;
  if (!output.activity_prompt.includes(contract.expected_response_format)) {
    issues.push({
      rule_code: "activity_task_missing",
      field_path: "activity_prompt"
    });
  }
  if (contract.source_item_number && !new RegExp(`\\bItem\\s+${contract.source_item_number}\\b`, "i").test(output.activity_prompt)) {
    issues.push({
      rule_code: "activity_source_omitted",
      field_path: "activity_prompt"
    });
  }
  if (contract.source_option_label && !new RegExp(`\\boption\\s+${contract.source_option_label}\\b`, "i").test(output.activity_prompt)) {
    issues.push({
      rule_code: "activity_source_omitted",
      field_path: "activity_prompt"
    });
  }
  if (contract.source_option_text && !output.activity_prompt.includes(contract.source_option_text)) {
    issues.push({
      rule_code: "activity_source_omitted",
      field_path: "activity_prompt"
    });
  }

  const language = validateStudentCommunicationLanguage(output);
  issues.push(...language.issues);

  return {
    valid: issues.length === 0,
    validator_version: STUDENT_COMMUNICATION_FACT_LOCK_VALIDATOR_VERSION,
    issues
  };
}

export function buildValidatedStudentCommunication(input: StudentCommunicationInputV1) {
  const output = buildDeterministicStudentCommunicationFallback(input);
  const factValidation = validateStudentCommunicationOutputFacts({
    frozen_input: input,
    output
  });
  const languageValidation = validateStudentCommunicationLanguage(output);

  return {
    output,
    fact_validation: factValidation,
    language_validation: languageValidation,
    metadata: {
      agent_name: STUDENT_COMMUNICATION_AGENT_NAME,
      agent_call_public_id: null,
      model: null,
      reasoning_effort: null,
      prompt_version: STUDENT_COMMUNICATION_PROMPT_VERSION,
      input_schema_version: STUDENT_COMMUNICATION_INPUT_SCHEMA_VERSION,
      output_schema_version: STUDENT_COMMUNICATION_OUTPUT_SCHEMA_VERSION,
      fact_lock_validator_version: STUDENT_COMMUNICATION_FACT_LOCK_VALIDATOR_VERSION,
      language_validator_version: STUDENT_COMMUNICATION_LANGUAGE_VALIDATOR_VERSION,
      fallback_version: STUDENT_COMMUNICATION_FALLBACK_VERSION,
      rendered_communication_version: STUDENT_COMMUNICATION_RENDERED_VERSION,
      validation_status:
        factValidation.valid && languageValidation.valid ? "validated" as const : "blocked" as const,
      fallback_used: true,
      live_generation_approved: false
    }
  };
}

export type StudentCommunicationBundleV1 = ReturnType<
  typeof buildValidatedStudentCommunication
> & {
  input: StudentCommunicationInputV1;
};
