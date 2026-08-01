export const FORMATIVE_CONVERSATION_PROFILE_FIELD_SEMANTICS_VERSION =
  "formative-conversation-profile-field-semantics-v1" as const;

export type FormativeConversationMisconceptionEvidenceRole =
  | "current_misconception_evidence"
  | "resolved_prior_misconception"
  | "remaining_limitation_or_question";

const RESOLVED_PRIOR_MISCONCEPTION_PATTERNS = [
  /\bno longer\b/i,
  /\b(?:has|have|was|were) (?:been )?corrected\b/i,
  /\b(?:has|have|was|were) (?:been )?resolved\b/i,
  /\bprevious(?:ly)? (?:believed|treated|thought|confused)\b/i,
  /\bearlier (?:belief|misconception|error|confusion)\b/i
] as const;

const REMAINING_LIMITATION_OR_QUESTION_PATTERNS = [
  /\bremaining (?:uncertainty|question|limitation|gap)\b/i,
  /\b(?:is|remains) unsure (?:about|whether|how|why|when)\b/i,
  /\buncertain (?:about|whether|how|why|when)\b/i,
  /\b(?:has|have) not yet (?:shown|demonstrated|applied|explained)\b/i,
  /\bneeds? (?:more|further|additional) evidence\b/i
] as const;

export function classifyFormativeConversationMisconceptionEvidence(
  value: string
): FormativeConversationMisconceptionEvidenceRole {
  if (
    RESOLVED_PRIOR_MISCONCEPTION_PATTERNS.some((pattern) =>
      pattern.test(value)
    )
  ) {
    return "resolved_prior_misconception";
  }
  if (
    REMAINING_LIMITATION_OR_QUESTION_PATTERNS.some((pattern) =>
      pattern.test(value)
    )
  ) {
    return "remaining_limitation_or_question";
  }
  return "current_misconception_evidence";
}

export function validateFormativeConversationMisconceptionEvidence(
  values: readonly string[]
) {
  return values.flatMap((value, index) => {
    const role =
      classifyFormativeConversationMisconceptionEvidence(value);
    return role === "current_misconception_evidence"
      ? []
      : [
          {
            index,
            role,
            reason_code:
              role === "resolved_prior_misconception"
                ? "resolved_misconception_not_current"
                : "limitation_or_question_not_misconception"
          } as const
        ];
  });
}
