import {
  FormativeConversationAgentOutputSchema,
  type FormativeConversationAgentOutput
} from "./agent-contract";

export const FORMATIVE_CONVERSATION_OPENING_VERSION =
  "formative-conversation-opening-v1";
export const FORMATIVE_CONVERSATION_OPENING_CLIENT_MESSAGE_ID =
  "assistant-opening:formative-conversation-opening-v1";

export type FormativeConversationOpeningValidation = {
  valid: boolean;
  issue_codes: string[];
  output: FormativeConversationAgentOutput | null;
};

const forbiddenOpeningPatterns: Array<{
  issue_code: string;
  pattern: RegExp;
}> = [
  {
    issue_code: "opening_repeats_score",
    pattern:
      /\b(?:your|assessment|overall)\s+score\b|\bscore\s+(?:was|is)\b|\btotal correct\b|\b\d+\s+(?:of|out of)\s+\d+\b|\b\d+(?:\.\d+)?%\b|\byou\s+(?:answered|got).{0,50}\b(?:correct|incorrect)\b/i
  },
  {
    issue_code: "opening_exposes_profile_language",
    pattern: /\b(?:learning profile|response profile|profile status|profile)\b/i
  },
  {
    issue_code: "opening_exposes_diagnosis_language",
    pattern: /\b(?:diagnosis|diagnostic result|assessment stage)\b/i
  },
  {
    issue_code: "opening_exposes_growth_target_language",
    pattern: /\b(?:growth target|precision to check|conceptually usable)\b/i
  },
  {
    issue_code: "opening_prescribes_activity",
    pattern:
      /\b(?:recommended activity|next activity|matched activity|try this next|complete this activity|activity family)\b/i
  }
];

export function validateFormativeConversationOpeningOutput(
  value: unknown
): FormativeConversationOpeningValidation {
  const parsed = FormativeConversationAgentOutputSchema.safeParse(value);
  if (!parsed.success) {
    return {
      valid: false,
      issue_codes: ["opening_schema_invalid"],
      output: null
    };
  }

  const issues = new Set<string>();
  const message = parsed.data.student_visible_message;

  for (const entry of forbiddenOpeningPatterns) {
    if (entry.pattern.test(message)) {
      issues.add(entry.issue_code);
    }
  }
  if (!/\b(?:review(?:ed)?|answers?|questions?|assessment)\b/i.test(message)) {
    issues.add("opening_assessment_acknowledgement_missing");
  }
  if (parsed.data.evidence_observations.length > 0) {
    issues.add("opening_must_not_create_student_evidence");
  }
  if (parsed.data.profile_transition_recommendation !== null) {
    issues.add("opening_must_not_recommend_profile_transition");
  }
  if (parsed.data.teacher_assistance_recommendation.recommended) {
    issues.add("opening_must_not_recommend_teacher_assistance");
  }
  if (parsed.data.lifecycle_recommendation !== "continue") {
    issues.add("opening_must_continue_conversation");
  }

  return {
    valid: issues.size === 0,
    issue_codes: [...issues].sort(),
    output: parsed.data
  };
}
