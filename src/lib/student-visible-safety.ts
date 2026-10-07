export const STUDENT_OUTPUT_LANGUAGE_INSTRUCTIONS = `
Write all student-facing messages, headings, and teaching material in English, even when source
metadata or student input uses another language. Do not copy Chinese topic titles or Chinese
quotations into your reply; explain their meaning in English when relevant. Preserve mathematical
symbols. This is an output-language rule, not a reason to reject or downgrade a student's response.
`;

// Screen generated/display text only. Never rewrite original student evidence or research records.
export function containsChineseText(value: string): boolean {
  return /\p{Script=Han}/u.test(value.normalize("NFKC"));
}

export function studentDisplayText(value: string, fallback: string): string {
  return containsChineseText(value) ? fallback : value;
}

// A narrow leak screen, not a substitute for prompt boundaries or semantic review.
export function containsInternalSystemInformation(value: string): boolean {
  const normalized = value.normalize("NFKC").replace(/[\u200B-\u200D\uFEFF]/g, "");
  if (/\b(?:stored (?:answer )?key|historical scoring|immutable (?:item |assessment )?snapshot|backend (?:decision|state|record))\b/i.test(normalized)) return true;
  if (/\b(?:assistance_history|assistance_context_reconsidered|recognition_with_supplied_support|integration_constraints|source_agent_call_public_id|participation_evidence_policy|aligned_misconception_item_count|likely_misconception_eligible|conversation-assistance-history-v1|participation-evidence-constraints-v1|profile-integration-eligibility-v1)\b/i.test(normalized)) return true;
  return /\b(?:student_visible_message|profile_transition_recommendation|allowed_evidence_catalog|allowed_misconception_claim_catalog|canonical_evidence_ids|evidence_observations|lifecycle_recommendation|student_question_pending|student_question_addressed|assessment_content_ambiguity|robust_transfer_ready_understanding|mostly_correct_understanding|correct_but_fragile_understanding|uncatalogued_misconception)\b|\b(?:ev_[a-f0-9]{24}|(?:sess|asmt|item)_\d{8}_[\w-]+)\b|\b(?:system prompt|developer instructions|prompt version|provider payload|semantic regeneration|validation_issue_paths|token budget|output.token limit|API key|database URL)\b|\b(?:gpt-\d[\w.-]*|OPENAI_API_KEY|DATABASE_URL)\b|\b(?:I|we)\s+(?:am|are)\s+(?:updating|checking)\s+(?:your\s+)?(?:internal profile|evidence catalog)\b/i.test(normalized);
}
