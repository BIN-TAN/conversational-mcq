import { z } from "zod";

export const ACTIVITY_RUNTIME_MAX_RESPONSE_CHARS = 5000;

export const StudentActivityRuntimeUiStateSchema = z.enum([
  "not_started",
  "activity_ready",
  "waiting_for_your_response",
  "reviewing_your_response",
  "feedback_ready",
  "moved_on",
  "alternative_requested",
  "could_not_prepare_activity_safely",
  "could_not_review_response_safely"
]);

export const StudentActivityRuntimeActionSchema = z.enum([
  "start_activity",
  "submit_response",
  "choose_another_activity",
  "move_on"
]);

export const StudentActivityRuntimeFeedbackSchema = z.object({
  message: z.string().min(1).max(700),
  next_options: z.array(z.enum(["continue", "choose another activity", "move on"])).min(1).max(3)
}).strict();

export const StudentActivityRuntimeProjectionSchema = z.object({
  available: z.boolean(),
  activity_attempt_public_id: z.string().nullable(),
  ui_state: StudentActivityRuntimeUiStateSchema,
  status_message: z.string().min(1).max(260),
  focus_label: z.string().min(1).max(120).nullable(),
  first_turn_message: z.string().min(1).max(2600).nullable(),
  response_prompt: z.string().min(1).max(420).nullable(),
  helper_text: z.string().min(1).max(260),
  allowed_actions: z.array(StudentActivityRuntimeActionSchema).max(4),
  can_start: z.boolean(),
  can_submit_response: z.boolean(),
  can_choose_another_activity: z.boolean(),
  can_move_on: z.boolean(),
  can_continue: z.boolean(),
  message_max_chars: z.number().int().positive().max(ACTIVITY_RUNTIME_MAX_RESPONSE_CHARS),
  feedback: StudentActivityRuntimeFeedbackSchema.nullable(),
  next_recommendation_label: z.string().min(1).max(180).nullable(),
  alternative_activity_labels: z.array(z.string().min(1).max(120)).max(6)
}).strict();

export type StudentActivityRuntimeUiState = z.infer<typeof StudentActivityRuntimeUiStateSchema>;
export type StudentActivityRuntimeProjection = z.infer<
  typeof StudentActivityRuntimeProjectionSchema
>;

export type StudentActivityProjectionIssue = {
  field_path: string;
  rule_code:
    | "schema_invalid"
    | "answer_key_or_correctness_label_detected"
    | "internal_activity_label_detected"
    | "internal_diagnostic_label_detected"
    | "engagement_or_ai_label_detected"
    | "provider_or_debug_label_detected"
    | "raw_process_or_metadata_label_detected"
    | "secret_or_header_label_detected"
    | "misconduct_language_detected";
  blocked_pattern_label?: string;
};

const ACTIVITY_FOCUS_LABELS = {
  conceptual_entry_grounding: "Start from the basic idea",
  distractor_misconception_probe: "Work through a tempting option",
  reasoning_boundary_repair: "Repair your explanation",
  independent_misconception_verification: "Explain it without the options",
  diagnostic_clarification: "Start from the basic idea",
  reasoning_refinement: "Repair your explanation",
  confidence_calibration: "Check your confidence using your evidence",
  independent_understanding_verification: "Explain it without the options",
  consolidation_and_transfer: "Try a nearby unscored practice idea",
  basic_concept_grounding: "Start from the basic idea",
  distractor_contrast: "Work through a tempting option",
  reasoning_chain_repair: "Repair your explanation",
  independent_reconstruction: "Explain it without the options",
  confidence_evidence_audit: "Check your confidence using your evidence",
  transfer_and_distractor_generation: "Try a nearby unscored practice idea"
} as const;

export function studentActivityFocusLabel(input: {
  diagnostic_purpose?: string | null;
  selected_formative_value?: string | null;
  activity_family?: string | null;
}) {
  const keys = [
    input.diagnostic_purpose,
    input.selected_formative_value,
    input.activity_family
  ].filter((value): value is keyof typeof ACTIVITY_FOCUS_LABELS =>
    typeof value === "string" && value in ACTIVITY_FOCUS_LABELS
  );

  return keys.length > 0 ? ACTIVITY_FOCUS_LABELS[keys[0]] : "Work on this idea";
}

export function studentActivityRecommendationLabel(value: string | null | undefined) {
  switch (value) {
    case "continue_conceptual_entry_grounding":
      return "Keep building the basic idea";
    case "continue_distractor_misconception_probe":
      return "Try another look at the tempting option";
    case "continue_reasoning_boundary_repair":
      return "Keep repairing the explanation";
    case "continue_independent_verification":
      return "Explain it again in your own words";
    case "optional_extension_or_move_on":
      return "You can try an extension or move on";
    case "retry_or_choose_or_move_on":
      return "Try again, choose another activity, or move on";
    case "choose_alternative_activity":
      return "Choose another activity";
    case "move_on":
      return "Move on";
    case "failed_closed":
      return "The activity could not be reviewed safely";
    default:
      return null;
  }
}

function collectStrings(value: unknown, path = "projection"): Array<{ path: string; value: string }> {
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

const blockedPatterns: Array<{
  rule_code: StudentActivityProjectionIssue["rule_code"];
  blocked_pattern_label: string;
  pattern: RegExp;
}> = [
  {
    rule_code: "answer_key_or_correctness_label_detected",
    blocked_pattern_label: "answer_key_or_correctness_language",
    pattern: /\b(answer key|correct answer|correct option|correctness label|the correct option is|the answer is)\b/i
  },
  {
    rule_code: "internal_activity_label_detected",
    blocked_pattern_label: "internal_activity_enum",
    pattern: /\b(basic_concept_grounding|distractor_contrast|reasoning_chain_repair|independent_reconstruction|confidence_evidence_audit|transfer_and_distractor_generation)\b/i
  },
  {
    rule_code: "internal_diagnostic_label_detected",
    blocked_pattern_label: "internal_diagnostic_enum_or_label",
    pattern: /\b(conceptual_entry_grounding|distractor_misconception_probe|reasoning_boundary_repair|independent_misconception_verification|misconception status|diagnostic purpose|diagnosis state|misconception id|raw misconception)\b/i
  },
  {
    rule_code: "engagement_or_ai_label_detected",
    blocked_pattern_label: "engagement_or_ai_label",
    pattern: /\b(engagement category|engagement profile|ai assistance signal|external assistance signal|ai assistance)\b/i
  },
  {
    rule_code: "provider_or_debug_label_detected",
    blocked_pattern_label: "provider_or_debug_label",
    pattern: /\b(agent call|structured output|raw model output|raw llm output|provider response|provider request|validator|llm)\b/i
  },
  {
    rule_code: "raw_process_or_metadata_label_detected",
    blocked_pattern_label: "raw_process_or_metadata_label",
    pattern: /\b(raw process|process payload|raw distractor metadata|distractor metadata|metadata field|evidence quality enum)\b/i
  },
  {
    rule_code: "secret_or_header_label_detected",
    blocked_pattern_label: "secret_or_header_label",
    pattern: /\b(api key|authorization header|bearer token|session secret|database url|password hash|access code hash)\b/i
  },
  {
    rule_code: "misconduct_language_detected",
    blocked_pattern_label: "misconduct_language",
    pattern: /\b(cheating|misconduct|academic integrity|authenticity|suspicious behavior)\b/i
  }
];

export function validateStudentActivityRuntimeProjection(value: unknown):
  | { valid: true; projection: StudentActivityRuntimeProjection; issues: [] }
  | { valid: false; issues: StudentActivityProjectionIssue[] } {
  const parsed = StudentActivityRuntimeProjectionSchema.safeParse(value);

  if (!parsed.success) {
    return {
      valid: false,
      issues: parsed.error.issues.map((issue) => ({
        field_path: issue.path.join(".") || "projection",
        rule_code: "schema_invalid"
      }))
    };
  }

  const issues: StudentActivityProjectionIssue[] = [];
  for (const entry of collectStrings(parsed.data)) {
    for (const blocked of blockedPatterns) {
      if (blocked.pattern.test(entry.value)) {
        issues.push({
          field_path: entry.path,
          rule_code: blocked.rule_code,
          blocked_pattern_label: blocked.blocked_pattern_label
        });
      }
    }
  }

  if (issues.length > 0) {
    return { valid: false, issues };
  }

  return { valid: true, projection: parsed.data, issues: [] };
}

export function assertStudentActivityRuntimeProjectionIsSafe(
  value: unknown
): asserts value is StudentActivityRuntimeProjection {
  const validation = validateStudentActivityRuntimeProjection(value);
  if (!validation.valid) {
    throw new Error(
      `student_activity_runtime_projection_unsafe:${validation.issues
        .map((issue) => `${issue.field_path}:${issue.blocked_pattern_label ?? issue.rule_code}`)
        .join(",")}`
    );
  }
}
