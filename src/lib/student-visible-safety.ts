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
  if (/\b(?:delivery_review_feedback|pre_delivery_review|conversation-delivery-review-v[1-8]|teaching_accuracy_error|unsupported_learning_claim|teaching_claim_audit|teaching_block_audit|draft_blocks|draft_block_id|premise_assumption_check|conclusion_check|material_claims_checked|no_teaching_claims|private_learning_audit|proposed_learning_claims|private_learning_review_version|formative_private_learning_review|conversation-private-learning-review-v1)\b/i.test(normalized)) return true;
  if (/\b(?:current_reply|prior_tutor|source_binding|reply_sha256|current_reply_source_version|current_reply_bindings|quote_source|tutor_turn|conversation-current-reply-source-v1)\b/i.test(normalized)) return true;
  if (/\b(?:current_source_activation_projection_version|current_source_activation_bindings|original_preference_comparison_sha256|projected_preference_comparison_sha256|conversation-current-source-activation-projection-v1)\b/i.test(normalized)) return true;
  if (/\b(?:stored_preference_retention_version|formative_stored_preference_retention|conversation-stored-preference-retention-v1|deferred_need_link_version|formative_deferred_need_link|conversation-deferred-need-link-v1|deferred_need_link_feedback|conversation-resulting-state-feedback-v1)\b/i.test(normalized)) return true;
  if (/\b(?:preference_links|preference_linkage|honored_constraint|topic_of_support|support_preference_link_version|support_preference_link_bindings|conversation-support-preference-links-v1|strong_partial_reasoning_support|source_evidence_id|source_quote|correct_component|remaining_error|student-profile-output-v6|student-profiling-v(?:9|10)|student-profile-fact-binding-v3|student-profile-request-schema-v(?:3|4)|student-profile-semantic-repair-v2|evidence-id-request-enum-v1|evidence_id_request_schema_version|rejected_field_diagnostics|rejected_reasoning_assessments)\b/i.test(normalized)) return true;
  if (/\b(?:stored (?:answer )?key|historical scoring|immutable (?:item |assessment )?snapshot|backend (?:decision|state|record))\b/i.test(normalized)) return true;
  if (/\b(?:conversation_review|conversation_continuity|pre_reply_plan|post_reply_review|preference_comparisons|bootstrap_preference_origins|conversation-pre-reply-plan-v[12]|preference_updates|need_updates|recap_claims|quote_binding_feedback|prior_profile_version|changed_fields|formative-profile-update-proposal-v1|formative-tutor-input-v1|assistance_history|assistance_context_reconsidered|recognition_with_supplied_support|integration_constraints|source_agent_call_public_id|participation_evidence_policy|aligned_misconception_item_count|likely_misconception_eligible|conversation-assistance-history-v1|participation-evidence-constraints-v1|profile-integration-eligibility-v1)\b/i.test(normalized)) return true;
  return /\b(?:student_visible_message|profile_transition_recommendation|allowed_evidence_catalog|allowed_misconception_claim_catalog|canonical_evidence_ids|evidence_observations|lifecycle_recommendation|student_question_pending|student_question_addressed|assessment_content_ambiguity|robust_transfer_ready_understanding|mostly_correct_understanding|correct_but_fragile_understanding|uncatalogued_misconception)\b|\b(?:ev_[a-f0-9]{24}|(?:sess|asmt|item)_\d{8}_[\w-]+)\b|\b(?:system prompt|developer instructions|prompt version|provider payload|semantic regeneration|validation_issue_paths|token budget|output.token limit|API key|database URL)\b|\b(?:gpt-\d[\w.-]*|OPENAI_API_KEY|DATABASE_URL)\b|\b(?:I|we)\s+(?:am|are)\s+(?:updating|checking)\s+(?:your\s+)?(?:internal profile|evidence catalog)\b/i.test(normalized);
}
