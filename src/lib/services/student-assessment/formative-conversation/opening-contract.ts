import {
  FormativeConversationAgentOutputSchema,
  type FormativeConversationAgentOutput
} from "./agent-contract";

export const FORMATIVE_CONVERSATION_OPENING_VERSION: string =
  "formative-conversation-opening-v3";
export const FORMATIVE_CONVERSATION_OPENING_CLIENT_MESSAGE_ID =
  "assistant-opening:formative-conversation-opening-v3";

export type FormativeConversationOpeningValidation = {
  valid: boolean;
  issue_codes: string[];
  output: FormativeConversationAgentOutput | null;
};

const scopedForbiddenOpeningPatterns: Array<{
  issue_code: string;
  pattern: RegExp;
}> = [
  {
    issue_code: "opening_exposes_profile_language",
    pattern:
      /\b(?:your|the student's?)\s+(?:(?:current|learning|response|diagnostic)\s+)?profile\b|\b(?:profile|profile status)\s+(?:shows?|indicates?|classifies?|categorizes?)\s+(?:that\s+)?(?:you|your)\b/i
  },
  {
    issue_code: "opening_exposes_diagnosis_language",
    pattern:
      /\b(?:your|the student's?)\s+(?:diagnosis|diagnostic (?:classification|result|status))\b|\b(?:you|the student)\s+(?:were|was|are|is|have been|has been)\s+(?:diagnosed|classified|categorized)\b|\bassessment stage\b/i
  },
  {
    issue_code: "opening_exposes_hidden_reasoning",
    pattern:
      /\b(?:chain[- ]of[- ]thought|hidden (?:reasoning|prompt|analysis)|internal (?:reasoning|prompt|analysis)|system prompt|developer prompt)\b|\bI (?:was|am) instructed (?:internally|by (?:the )?system)\b/i
  },
  {
    issue_code: "opening_exposes_teacher_only_information",
    pattern:
      /\b(?:your|the)\s+(?:teacher|instructor)\s+(?:noted|said|reported|wrote|indicated|told)\b|\b(?:teacher|instructor)[- ]only\s+(?:notes?|information|guidance)\b|\b(?:teacher|instructor)\s+(?:notes?|guidance|comments?)\s+(?:say|show|indicate|suggest)\b/i
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

const hypotheticalResultContext =
  /\b(?:for example|suppose|imagine|hypothetical(?:ly)?|consider (?:a|an|the)|if (?:a student|a person|someone|you) (?:scores?|scored|answers?|answered|gets?|got))\b/i;

const studentAssessmentResultPatterns = [
  /\byour\s+(?:(?:assessment|overall)\s+)?score\s+(?:was|is)\s+(?:\d+(?:\.\d+)?%?|\d+\s+(?:of|out of)\s+\d+|high|low|strong|weak|excellent|poor)\b/i,
  /\byour\s+(?:assessment\s+)?(?:results?|performance)\b.{0,80}\b(?:\d+(?:\.\d+)?%|\d+\s+(?:of|out of)\s+\d+|correct|incorrect|right|wrong|high|low|strong|weak|excellent|poor)\b/i,
  /\byour\s+(?:answer|response)\s+(?:to|for|on)\b.{0,50}\b(?:was|is)\s+(?:correct|incorrect|right|wrong)\b/i,
  /\byou\s+(?:got|answered|had)\b.{0,80}\b(?:correct(?:ly)?|incorrect(?:ly)?|right|wrong)\b/i,
  /\byou\s+(?:scored|earned|got)\s+(?:\d+(?:\.\d+)?%|\d+\s+(?:of|out of)\s+\d+)\b/i,
  /\b(?:one|two|three|\d+)\s+(?:of|out of)\s+your\s+(?:(?:one|two|three|\d+)\s+)?(?:answers?|items?|questions?)\b.{0,50}\b(?:was|were)?\s*(?:correct|incorrect|right|wrong)\b/i,
  /\b(?:most|all|some|none)\s+of\s+your\s+(?:answers?|items?|questions?)\b.{0,50}\b(?:was|were)?\s*(?:correct|incorrect|right|wrong)\b/i,
  /\boverall\b.{0,40}\b(?:one|two|three|\d+)\s+(?:of|out of)\s+(?:one|two|three|\d+)\b.{0,50}\b(?:correct|incorrect|right|wrong)\b/i,
  /\byou\s+(?:did|performed)\s+(?:well|poorly|strongly)\b.{0,50}\b(?:assessment|answers?|items?|questions?)\b/i,
  /\b(?:on|in)\s+(?:this|the)\s+assessment\b.{0,80}\b(?:you|your)\b.{0,80}\b(?:scored|earned|got|answered|correct|incorrect|result|performance)\b/i,
  /\b(?:the|this)\s+assessment\s+(?:score|result)\s+(?:was|is)\s+(?:\d+(?:\.\d+)?%?|\d+\s+(?:of|out of)\s+\d+)\b/i
] as const;

const assessmentAcknowledgementPatterns = [
  /\b(?:review(?:ed|ing)?|look(?:ed|ing)?|went|go(?:ing)?)\s+(?:back\s+)?(?:through|over|at)?\s*(?:the|your)?\s*(?:answers?|responses?|results?|reasoning|assessment)\b/i,
  /\b(?:now that|after)\s+(?:you(?:'ve| have)?\s+)?(?:reviewed|completed|worked through|answered)\b.{0,60}\b(?:answers?|responses?|questions?|assessment)\b/i,
  /\b(?:you(?:'ve| have)?|you)\s+(?:already\s+)?(?:identified|explained|noticed|recognized|distinguished|pointed out|worked through|considered)\b/i,
  /\b(?:from|in|based on)\s+(?:what\s+)?you(?:'ve| have)?\s+(?:said|explained|written|wrote|reasoned|noticed|identified)\b/i,
  /\bI\s+(?:noticed|saw)\b.{0,80}\b(?:in|from)\s+your\s+(?:answers?|responses?|reasoning|explanation)\b/i
] as const;

export function hasFormativeConversationOpeningAssessmentAcknowledgement(
  message: string
) {
  return assessmentAcknowledgementPatterns.some((pattern) =>
    pattern.test(message)
  );
}

function repeatsStudentAssessmentResult(message: string) {
  return message
    .split(/(?:[.!?]\s+|\n+)/)
    .some(
      (clause) =>
        !hypotheticalResultContext.test(clause) &&
        studentAssessmentResultPatterns.some((pattern) => pattern.test(clause))
    );
}

export function validateFormativeConversationOpeningDisclosureScope(
  message: string
) {
  const issues = new Set<string>();
  for (const entry of scopedForbiddenOpeningPatterns) {
    if (entry.pattern.test(message)) {
      issues.add(entry.issue_code);
    }
  }
  if (repeatsStudentAssessmentResult(message)) {
    issues.add("opening_repeats_score");
  }
  return [...issues].sort();
}

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

  for (const issue of validateFormativeConversationOpeningDisclosureScope(
    message
  )) {
    issues.add(issue);
  }
  if (!hasFormativeConversationOpeningAssessmentAcknowledgement(message)) {
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
