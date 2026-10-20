import {
  ENDORSEMENTS,
  ERROR_SOURCES,
  EXPLANATION_QUALITIES,
  INTERPRETATION_V8_PROMPT_VERSION,
  INTERPRETATION_V8_SCHEMA_VERSION,
  NO_USABLE_REASONS,
  PROCESS_INTERPRETATION_TYPES,
  QUOTE_SOURCES
} from "@/lib/services/student-assessment/interpretation-v8/contract";
import { PROCESS_INDICATOR_DEFINITIONS, PROCESS_INDICATORS_VERSION } from "@/lib/services/student-assessment/interpretation-v8/indicators";
import {
  INTERPRETATION_RULES_VERSION,
  ITEM_STATUSES,
  PENDING_ITEM_REVIEW_LABEL,
  RAPID_SELECTION_THRESHOLD_MS,
  TOPIC_SUMMARY_LABELS
} from "@/lib/services/student-assessment/interpretation-v8/rules";
import { INTERPRETATION_V8_PROFILE_SCHEMA } from "@/lib/services/student-assessment/interpretation-v8/profile";
import { ATTEMPT_CONTEXT_VERSION } from "@/lib/services/student-assessment/interpretation-v8/attempts";
import {
  FEEDBACK_V8_CONTRACT_VERSION,
  FEEDBACK_V8_CONVERSATION_PROMPT_VERSION,
  FEEDBACK_V8_OPENING_PROMPT_VERSION,
  FOCUS_STATUSES,
  FOCUS_TYPES,
  REVIEW_FLAGS,
  STRATEGIES
} from "@/lib/services/student-assessment/feedback-v8/contract";

/**
 * Research export of interpretation v8, feedback v8 turn records, instructor item decisions
 * and item administration v4 (docs/AI_MODULE_REDESIGN_2026-10-19.md, sections 4, 5, 6, 8 and
 * 10). This module holds the file layouts and the dictionary text; the rows are built in
 * interpretation-v8-export.ts and every column is documented in research_data_dictionary.csv
 * through dictionary.ts.
 */
export const INTERPRETATION_V8_EXPORT_VERSION = "interpretation-v8-export-v1" as const;
export const INTERPRETATION_V8_NOTES_FILE = "interpretation_v8_notes.txt";

export const INTERPRETATION_V8_TABLES = [
  "interpretation_item_ratings",
  "interpretation_claims",
  "interpretation_summaries",
  "interpretation_process_audit",
  "feedback_turn_records",
  "item_review_decisions"
] as const;
export type InterpretationV8Table = (typeof INTERPRETATION_V8_TABLES)[number];

/** Produced only in restricted exports: model input and output kept for audit (section 6). */
export const INTERPRETATION_V8_RESTRICTED_TABLES: readonly InterpretationV8Table[] = ["interpretation_process_audit"];
/** Restricted columns inside default v8 files (same policy as item_responses.correctness). */
export const INTERPRETATION_V8_RESTRICTED_COLUMNS = ["answer_correct"] as const;

const ATTEMPT_IDENTITY = [
  "interpretation_export_version",
  "research_student_id",
  "assessment_public_id",
  "session_public_id",
  "attempt_number",
  "family_attempt_number",
  "attempt_role",
  "concept_unit_public_id",
  "profile_record_id"
] as const;

const ITEM_IDENTITY = ["item_public_id", "item_snapshot_public_id", "item_version", "item_order", "item_position", "item_number"] as const;

export const INTERPRETATION_ITEM_RATINGS_COLUMNS = [
  ...ATTEMPT_IDENTITY,
  ...ITEM_IDENTITY,
  "selected_option",
  "answer_correct",
  "reported_confidence",
  "rapid_selection",
  "explanation_quality",
  "no_usable_reason",
  "adds_beyond_option_text",
  "evidence_quote",
  "evidence_source",
  "reference_id",
  "missing_elements",
  "rationale",
  "error_source",
  "side_remark",
  "uncertainty_note",
  "item_status",
  "item_review_flag",
  "rating_unavailable",
  "instructor_item_decision",
  "instructor_item_decision_at",
  "item_counted_with_decisions",
  "generation_mode",
  "fallback_reason",
  "prompt_version",
  "schema_version",
  "rules_version",
  "profile_created_at"
] as const;

export const INTERPRETATION_CLAIMS_COLUMNS = [
  ...ATTEMPT_IDENTITY,
  "claim_id",
  "claim_type",
  "claim_index",
  "claim_item_public_ids",
  "claim_item_numbers",
  "quote_item_public_id",
  "idea",
  "student_quote",
  "quote_source",
  "endorsement",
  "contradicts_reference_id",
  "matching_distractor_reference_id",
  "alternative_explanation",
  "generation_mode",
  "prompt_version",
  "schema_version",
  "rules_version"
] as const;

export const INTERPRETATION_SUMMARIES_COLUMNS = [
  ...ATTEMPT_IDENTITY,
  "generation_mode",
  "fallback_reason",
  "stored_label",
  "stored_reason",
  "stored_rule_label",
  "stored_rule_reason",
  "stored_label_without_pending",
  "stored_pending_review_item_ids",
  "label_with_decisions",
  "reason_with_decisions",
  "rule_label_with_decisions",
  "label_without_pending_with_decisions",
  "pending_review_item_ids_with_decisions",
  "excluded_item_ids_with_decisions",
  "administered_item_count",
  "counted_item_count",
  "interpretable_item_count",
  "supported_item_count",
  "partly_supported_item_count",
  "not_supported_item_count",
  "not_interpretable_item_count",
  "counted_item_count_with_decisions",
  "interpretable_item_count_with_decisions",
  "possible_misconception_count",
  "considered_idea_count",
  "answer_patterns",
  "output_repair_codes",
  "output_salvaged",
  "salvage_unrated_item_ids",
  "salvage_dropped_claim_count",
  "profiling_call_count",
  "profiling_output_rejected_count",
  "profiling_provider_failure_count",
  "first_output_passed",
  "profiling_model_name",
  "profiling_prompt_hash",
  "attempt_context_version",
  "earlier_attempt_count",
  "feedback_seen_attempt_numbers",
  "answer_review_seen_before",
  "opening_message_seen_before",
  "student_turns_seen_before",
  "tutor_turns_seen_before",
  "feedback_seen_before_json",
  "rules_version",
  "prompt_version",
  "schema_version",
  "indicators_version",
  "profile_created_at"
] as const;

/** Wide indicator columns, one per process indicator of section 6.1 (fixed names and roles). */
export const PROCESS_AUDIT_INDICATOR_COLUMNS = {
  rapid_selection: "indicator_rapid_selection",
  answer_change: "indicator_answer_change",
  explanation_revised: "indicator_explanation_revised",
  confidence_change: "indicator_confidence_change",
  focused_time: "indicator_focused_time_seconds",
  focus_loss: "indicator_focus_loss_seconds",
  longest_pause: "indicator_longest_pause_seconds",
  blocked_paste_attempts: "indicator_blocked_paste_attempts"
} as const satisfies Record<keyof typeof PROCESS_INDICATOR_DEFINITIONS, string>;

export const INTERPRETATION_PROCESS_AUDIT_COLUMNS = [
  ...ATTEMPT_IDENTITY,
  ...ITEM_IDENTITY,
  "audience",
  "profiling_agent_call_public_id",
  "profiling_call_status",
  "profiling_output_validated",
  "profiling_provider",
  "generation_mode",
  ...Object.values(PROCESS_AUDIT_INDICATOR_COLUMNS),
  "process_indicators_json",
  "process_interpretation_status",
  "process_interpretation_type",
  "process_interpretation_indicator_ids",
  "process_interpretation_content_quote",
  "process_interpretation_content_source",
  "process_interpretation_note",
  "process_interpretation_alternatives",
  "indicators_version",
  "prompt_version",
  "schema_version"
] as const;

export const FEEDBACK_TURN_RECORDS_COLUMNS = [
  "interpretation_export_version",
  "research_student_id",
  "assessment_public_id",
  "session_public_id",
  "attempt_number",
  "family_attempt_number",
  "conversation_public_id",
  "agent_call_public_id",
  "turn_sequence_index",
  "conversation_local_turn_sequence_index",
  "turn_created_at",
  "feedback_mode",
  "focus_item_numbers",
  "focus_item_public_ids",
  "focus_type",
  "focus_concept",
  "strategy",
  "focus_status",
  "student_evidence_count",
  "student_evidence_quotes",
  "student_evidence_notes",
  "instructor_review_flag",
  "instructor_review_reason",
  "review_signal_public_id",
  "review_signal_status",
  "provider",
  "model_name",
  "prompt_version",
  "mode_prompt_version",
  "schema_version",
  "prompt_hash",
  "call_completed_at"
] as const;

export const ITEM_REVIEW_DECISIONS_COLUMNS = [
  "interpretation_export_version",
  "decision_public_id",
  "assessment_public_id",
  "item_public_id",
  "item_version",
  "decision",
  "note",
  "decided_at",
  "superseded_at",
  "decision_current",
  "research_instructor_id",
  "research_pseudonym_version"
] as const;

export const INTERPRETATION_V8_TABLE_COLUMNS: Record<InterpretationV8Table, readonly string[]> = {
  interpretation_item_ratings: INTERPRETATION_ITEM_RATINGS_COLUMNS,
  interpretation_claims: INTERPRETATION_CLAIMS_COLUMNS,
  interpretation_summaries: INTERPRETATION_SUMMARIES_COLUMNS,
  interpretation_process_audit: INTERPRETATION_PROCESS_AUDIT_COLUMNS,
  feedback_turn_records: FEEDBACK_TURN_RECORDS_COLUMNS,
  item_review_decisions: ITEM_REVIEW_DECISIONS_COLUMNS
};

/** Columns added to existing row types that print profile labels (sessions, assessment_summary, profile_result, conversations). */
export const INTERPRETATION_V8_PROFILE_COLUMNS = [
  "interpretation_profile_schema",
  "interpretation_generation_mode",
  "interpretation_summary_label",
  "interpretation_summary_label_with_decisions",
  "interpretation_rules_version"
] as const;

/** Item administration v4 summary columns added to item_responses.csv. */
export const ITEM_ADMINISTRATION_V4_COLUMNS = [
  "item_admin_tutor_versions",
  "item_admin_v4_decision_count",
  "item_admin_v4_accept_count",
  "item_admin_v4_clarify_count",
  "item_admin_v4_deferred_question_count",
  "item_admin_v4_procedural_help_count",
  "item_admin_v4_redirect_count",
  "item_admin_v4_model_decision_count",
  "item_admin_v4_fallback_count",
  "item_admin_v4_application_override_count",
  "item_admin_v4_saved_question_count"
] as const;

/**
 * Conversation-update columns (profile transitions recommended during the conversation). A v8
 * conversation never updates the profile (section 8), so they are legacy for v8 attempts.
 */
const CONVERSATION_UPDATE_LEGACY_COLUMNS = [
  "conversation_profile_update", "conversation_profile_update_count", "conversation_updated_understanding_label",
  "conversation_updated_profile_record_id"
] as const;
const CONVERSATION_TRANSITION_LEGACY_COLUMNS = [
  "profile_reassessment_status", "profile_transition_count", "latest_profile_transition_public_id",
  "validated_formative_outcome", "semantic_teacher_assistance_recommended"
] as const;

/**
 * Legacy columns left blank for v8 profiles, by table: the label columns hold fixed
 * placeholders in v8 profiles (profile.ts: studentProfileDataV8), and the conversation-update
 * columns describe profile updates a v8 conversation never makes.
 */
export const V8_BLANKED_LEGACY_COLUMNS: Record<string, readonly string[]> = {
  agent_activity_records: [
    "understanding_category", "engagement_category", "response_profile", "initial_profile_transfer_rule", "evidence_sufficiency",
    "profile_native_confidence_alignment", "misconception_indicator_count", "misconception_claim_count",
    "item_level_evidence_count", "item_level_evidence_available", "item_level_evidence_format"
  ],
  sessions: [
    "assessment_specific_understanding_category", "engagement_review_category", "evidence_sufficiency",
    "profile_native_confidence_alignment", "misconception_indicator_count", "misconception_claim_count",
    "item_level_evidence_count", "item_level_evidence_available", "item_level_evidence_format",
    ...CONVERSATION_UPDATE_LEGACY_COLUMNS
  ],
  assessment_summary: [
    "assessment_specific_understanding_category", "engagement_review_category", "evidence_sufficiency",
    ...CONVERSATION_UPDATE_LEGACY_COLUMNS
  ],
  formative_conversation_sessions: [
    "initial_learning_profile", "initial_profile_evidence_sufficiency", "current_learning_profile",
    "current_profile_evidence_sufficiency", "profile_native_confidence_alignment",
    ...CONVERSATION_TRANSITION_LEGACY_COLUMNS
  ]
};

export const V8_CONVERSATION_LEGACY_NOTE =
  "Blank for attempts whose mini-test profile comes from interpretation v8: a v8 conversation never updates the profile (section 8 of the redesign); its turn records and instructor-review flags are in feedback_turn_records.csv. Earlier conversations are unchanged.";

export const V8_LEGACY_BLANK_NOTE =
  `Blank for interpretation v8 profiles (item_level_evidence.profile_schema ${INTERPRETATION_V8_PROFILE_SCHEMA}): the legacy profile columns hold fixed placeholder values that v8 does not produce (section 4.5 of the redesign). Use interpretation_summary_label, interpretation_summaries.csv and interpretation_item_ratings.csv for v8 profiles; earlier profiles are unchanged.`;

/** Notes appended to existing item_responses definitions for item administration v4 records. */
export const ITEM_ADMINISTRATION_V4_EXISTING_COLUMN_NOTES: Record<string, string> = {
  insufficient_knowledge_selected: "Item administration v4 (item-administration-tutor-v4) never classifies a reply as insufficient knowledge, so for v4 items this is true only when the student chose \"I don't know yet\".",
  ai_flagged_insufficient_knowledge: "Blank (not false) for items whose item-administration records are all v4: v4 accepts honest uncertainty as the student's response and records no insufficient-knowledge judgment.",
  insufficient_knowledge_count: "For v4 items this counts only \"I don't know yet\" choices: v4 never records insufficient_knowledge_marked.",
  response_quality_check_count: "For v4 items each check is one collection decision (accept, clarify once, defer a question, procedural help or redirect), not a quality judgment; v4 records response_quality not_judged and shared quality collected for accepted replies. See item_admin_v4_decision_count.",
  response_quality_rejection_count: "For v4 items this counts replies that were not accepted at that step (one clarification, a deferred content question, procedural help or a redirect of off-task or unreadable text), not low-quality reasoning. See the item_admin_v4_* counts.",
  procedural_clarification_count: "For v4 items this includes procedural_help decisions (recorded as clarification_answered).",
  content_question_count: "For v4 items this counts defer_question decisions (the question is saved for after the mini-test)."
};

const RULE_TEXT = {
  ratings:
    "Explanation quality (section 4.2), judged against the item's essential elements (the one to three points under \"Strong reasoning should mention\"): adequate = every essential element is stated or clearly implied, in any wording, including wording taken from an option; brevity, grammar and low confidence do not lower it; needs a quote. limited = relevant and not contradicted, but at least one essential element is missing; needs a quote and missing_elements; a reading that could be limited or incorrect is rated limited with error source unclear. incorrect = the most plausible reading contradicts the specification, including use of the wrong rule; paraphrasing a chosen incorrect option is incorrect; an incorrect side remark outside the essential elements goes to side_remark and does not change the rating; needs a quote and the reference it contradicts. no_usable_explanation = the text makes no claim about the item's content (no_usable_reason not_provided, off_task or stated_guess); a guess followed by reasoning is rated on that reasoning; no quote.",
  status:
    "Item status (section 4.3, rules version " + INTERPRETATION_RULES_VERSION + ", applied in this order): no option selected or correctness unknown -> not_interpretable; no_usable_explanation -> not_interpretable when the answer is correct or the first choice was a rapid selection (under " + RAPID_SELECTION_THRESHOLD_MS / 1000 + " s), otherwise not_supported; incorrect explanation -> not_supported whatever the answer; adequate -> supported with a correct answer, partly_supported with an incorrect answer; limited -> partly_supported with a correct answer, not_supported with an incorrect answer. The error source plays no part, and a possible item issue never changes the status.",
  summary:
    "Topic summary (section 4.4, applied in order to counted items = administered items minus items the instructor excluded; interpretable = counted items that are not not_interpretable): no counted items -> Unavailable / insufficient evidence (no_counted_items); fewer than 2 interpretable -> Unavailable (fewer_than_two_interpretable); interpretable fewer than half of counted (2 x interpretable < counted) -> Unavailable (fewer_than_half_interpretable); not_supported at least half of interpretable (2 x not_supported >= interpretable) -> Need more work (half_or_more_not_supported); no not_supported, at most one partly_supported and supported more than half of counted (2 x supported > counted) -> Mostly understood (supported_majority_none_unsupported); otherwise Still developing (mixed). A fallback profile (no validated output) is Unavailable (no_valid_profile). Boundaries: a one-item mini-test never gets a label; a two-item mini-test needs both items interpretable; exactly half interpretable is enough; supported items exactly half of the counted items is not Mostly understood; every item excluded gives no counted items.",
  pending:
    "Items pending review: an item the model flagged as a possible item issue stays counted. The rule is also applied without the flagged items that have no instructor decision; when the two labels differ the label is withheld as \"" + PENDING_ITEM_REVIEW_LABEL + "\" (reason flagged_items_change_label), otherwise the rule label is kept and label_without_pending records the agreeing label. A kept decision clears the flag; an excluded decision removes the item from the counted items for every student who took it. The stored profile is never changed: labels with decisions are recomputed at export time from the stored item statuses and the current decisions.",
  attempts:
    "Attempts (section 4.6): every submission has its own profile, created once and never overwritten. attempt_role initial_diagnosis marks the student's first submitted attempt (a later attempt number with no earlier submission is still the initial diagnosis); after_feedback marks an attempt started after an earlier attempt in the same assessment family (the original mini-test and its corrected versions) was submitted. feedback_seen_before lists each earlier attempt with its submission time, the first time its answer review and its feedback were recorded on screen before this attempt started (attempt-context-v2: package_results_shown and formative_feedback_shown, compared by server receipt time), the creation time of its opening message, and the student and tutor conversation turns created before this attempt started. Records of attempt-context-v1 (pre-release test data only) matched the revision family on one field and counted a review as seen once the attempt was submitted. First and later attempts are analysed separately, never merged.",
  audit:
    "Audit-only process records (section 6): the application computes " + Object.keys(PROCESS_INDICATOR_DEFINITIONS).length + " process indicators per item (" + PROCESS_INDICATORS_VERSION + ") from the item's own events up to submission and sends them, each with a fixed role, to the profiling model; the model may return one bounded process interpretation per item. These records serve the profiling and feedback models only: they were never shown to instructors or students, never support a possible misconception, never change a rating and never establish independence or tool use. Only the rapid selection enters an application rule (item status). They are exported for audit, in restricted exports only."
} as const;

export const INTERPRETATION_V8_RULE_TEXT = RULE_TEXT;

export function interpretationV8NotesText() {
  return [
    `Interpretation v8 research files (${INTERPRETATION_V8_EXPORT_VERSION}); profiles with item_level_evidence.profile_schema ${INTERPRETATION_V8_PROFILE_SCHEMA}, prompt ${INTERPRETATION_V8_PROMPT_VERSION}, output schema ${INTERPRETATION_V8_SCHEMA_VERSION}, rules ${INTERPRETATION_RULES_VERSION}. Every column is defined in research_data_dictionary.csv.`,
    "interpretation_item_ratings.csv: one row per student, attempt (session) and administered item of a v8 profile. Fallback profiles keep their items with blank ratings and statuses. answer_correct is a restricted column (present only in restricted exports, like item_responses.correctness).",
    "interpretation_claims.csv: one row per possible misconception or idea considered but not endorsed. Considered ideas never enter the summary or the misconception list.",
    "interpretation_summaries.csv: one row per student and attempt: the label stored at submission and the label recomputed with the instructor's current item decisions, with counts, pending and excluded items, and the feedback seen before the attempt.",
    "interpretation_process_audit.csv (restricted exports only): one row per student, attempt and item with the process indicators sent to the profiling model and the model's process interpretation. Audit only: never shown to instructors or students.",
    "feedback_turn_records.csv: one row per validated feedback v8 output (opening message or conversation reply). The tutor message text is not repeated: join conversation_public_id and turn_sequence_index to formative_conversation_turns.csv. Turn records describe what the student wrote with support; they are not learning outcomes (RQ3 conversations are coded by people).",
    "item_review_decisions.csv: one row per instructor decision on an item, including superseded decisions; research_instructor_id is pseudonymous.",
    "Legacy profile columns (ability, engagement, integrated profile, evidence sufficiency, confidence alignment, misconception catalog counts) are blank for v8 profiles in sessions.csv, assessment_summary.csv, agent_activity_records.csv (profile_result) and formative_conversation_sessions.csv, and so are the conversation-update columns (profile updates, transitions, reassessment status), because a v8 conversation never updates the profile; earlier profiles and conversations are unchanged.",
    `Item administration v4 (item-administration-tutor-v4) records collection, not quality: insufficient-knowledge flags and quality levels are never recorded for v4 replies. See the item_admin_v4_* columns in item_responses.csv.`,
    RULE_TEXT.ratings,
    "Beyond the option text (adds_beyond_option_text): true when the explanation adds any content beyond the wording of the options; false when it only repeats or paraphrases option text; blank for no_usable_explanation. It does not change the rating. Error source: conceptual, execution_slip (only when the explanation states the correct rule and the error lies in carrying it out), possible_item_issue (a flag for the instructor), or unclear; an adequate explanation cannot have a conceptual error source.",
    "Possible misconception (section 5): reported only when the student states a specific idea that contradicts the item specification or the topic's objective and description, and the student's own words show they currently hold it; tentative only when a hedge attaches to that idea. A wrong answer, a chosen distractor, a tempting-option reason, a quoted or rejected idea, low confidence or any process indicator never supports one alone. Quotes are exact excerpts (at least four words unless the response is shorter) of the same item's explanation, its first version or its tempting-option reason.",
    RULE_TEXT.status,
    RULE_TEXT.summary,
    RULE_TEXT.pending,
    RULE_TEXT.attempts,
    RULE_TEXT.audit
  ].join("\n") + "\n";
}

export type V8ColumnDoc = {
  definition: string;
  method: string;
  source_nature: string;
  data_type?: string;
  unit?: string;
  allowed_values?: string;
  formula?: string;
  caution?: string;
  guidance?: string;
  category?: string;
  research_category_id?: string;
  tier?: "core_research" | "supplementary_research";
  privacy?: string;
  audience?: string;
  export_policy?: string;
  generating_agent?: string;
  generating_schema_version?: string;
  applicable?: string;
  timing?: { construct: string; start: string; end: string; formula: string; idle: string; hidden: string };
};

const MODEL_CAUTION =
  "Model judgment checked by the application (quotes, references, rules); an assessment-specific interpretation for human review, not a directly observed fact, not a stable trait, and not ground truth.";
const RULE_CAUTION = "Computed by fixed published rules from stored values; reproducible, but no more valid than the item ratings it rests on.";
const AUDIT_CAUTION =
  "Audit only: never shown to instructors or students. Process data are context with alternative explanations; not evidence of misconduct, GenAI use, effort, motivation or independence, not a stable trait, and not ground truth.";
const PROFILING_AGENT = "student_profiling_agent (interpretation v8)";
const FEEDBACK_AGENT = "formative_conversation_agent (feedback v8)";
const POINT_TIMESTAMP = (what: string) => ({
  construct: "point_in_time_record_timestamp",
  start: "not applicable: point-in-time timestamp",
  end: "not applicable: point-in-time timestamp",
  formula: `Copy the stored ${what} timestamp; not a duration.`,
  idle: "Not applicable: a point-in-time timestamp has no interval.",
  hidden: "Not applicable: a point-in-time timestamp has no interval."
});
const list = (values: readonly string[]) => values.join("; ");
const STORED = "Copied by interpretation-v8-export.ts from the v8 profile stored once at submission (StudentProfile.item_level_evidence, read with readStoredInterpretationV8)";

const model = (definition: string, method: string, extra: Partial<V8ColumnDoc> = {}): V8ColumnDoc => ({
  definition, method, source_nature: "persisted_llm_interpretation", caution: MODEL_CAUTION,
  generating_agent: PROFILING_AGENT, generating_schema_version: INTERPRETATION_V8_SCHEMA_VERSION,
  category: "Diagnostic and interpretation outputs", research_category_id: "diagnostic_interpretations", ...extra
});
const rule = (definition: string, method: string, extra: Partial<V8ColumnDoc> = {}): V8ColumnDoc => ({
  definition, method, source_nature: "deterministic_derived", caution: RULE_CAUTION,
  category: "Diagnostic and interpretation outputs", research_category_id: "diagnostic_interpretations", ...extra
});
const recorded = (definition: string, method: string, extra: Partial<V8ColumnDoc> = {}): V8ColumnDoc => ({
  definition, method, source_nature: "directly_recorded", ...extra
});
const version = (definition: string, method: string): V8ColumnDoc => ({
  definition, method, source_nature: "system_configuration", category: "Export, provenance, and versioning data",
  research_category_id: "data_quality_research_provenance", tier: "supplementary_research"
});

/** Documentation shared by every v8 table, keyed by column. Table-specific entries override it. */
const SHARED: Record<string, V8ColumnDoc> = {
  interpretation_export_version: version(
    `Layout version of the interpretation v8 research files (${INTERPRETATION_V8_EXPORT_VERSION}); not a version of the stored records.`,
    "Written by interpretation-v8-export.ts as a constant on every row of the v8 research files."
  ),
  assessment_public_id: recorded(
    "Public identifier of the mini-test (assessment version); join key to sessions.csv and assessment_content.csv.",
    "Copied from Assessment.assessment_public_id of the attempt, or of the decided item's mini-test for item_review_decisions.csv.",
    { research_category_id: "research_identifiers_and_joins", category: "Session and participation variables" }
  ),
  session_public_id: recorded(
    "Public identifier of the attempt (assessment session); join key to sessions.csv and the other attempt-level files.",
    "Copied from AssessmentSession.session_public_id of the attempt whose submission the record belongs to.",
    { research_category_id: "research_identifiers_and_joins", category: "Session and participation variables" }
  ),
  attempt_number: recorded(
    "Attempt number within one assessment version, as in sessions.attempt_number; use family_attempt_number for the order across corrected versions and attempt_role for initial diagnosis versus after feedback.",
    "Copied from AssessmentSession.attempt_number of the attempt whose submission the record belongs to.",
    { data_type: "integer", research_category_id: "research_identifiers_and_joins", category: "Session and participation variables" }
  ),
  item_public_id: recorded(
    "Public identifier of the item; join with session_public_id to item_responses.csv and with assessment_public_id to assessment_content.csv.",
    "Copied from the stored v8 item record (items[].item_id holds the item_public_id) or from the decided item.",
    { research_category_id: "research_identifiers_and_joins", category: "Assessment design and content" }
  ),
  family_attempt_number: recorded(
    "Order of this attempt among all of the student's attempts in the assessment family (every version), by attempt creation time, starting at 1; same as sessions.family_attempt_number.",
    "Copied from the family attempt identity resolved for sessions.csv (resolveFamilyAttemptIdentity) so v8 rows carry the attempt order directly.",
    { source_nature: "deterministic_derived", data_type: "integer", category: "Session and participation variables" }
  ),
  attempt_role: rule(
    "initial_diagnosis or after_feedback: the attempt's role in the stored attempt context (section 4.6). initial_diagnosis is the student's first submitted attempt; after_feedback is an attempt started after an earlier attempt in the same revision family was submitted. Blank when the profile stored no attempt context.",
    `${STORED}: attempt.role, computed by attemptContextForSession when the profile was saved.`,
    { allowed_values: "initial_diagnosis; after_feedback" }
  ),
  concept_unit_public_id: recorded(
    "Public identifier of the topic (concept unit) whose submitted mini-test the profile interprets.",
    "Copied by interpretation-v8-export.ts from the concept unit of the profile's concept-unit session.", { category: "Assessment design and content" }),
  profile_record_id: {
    definition: "Stable profile_record_id of the v8 profile (profile_ prefix plus 24 hexadecimal SHA-256 characters of the stored profile ID); joins agent_activity_records.csv profile_result rows and sessions.understanding_profile_record_id without exporting database UUIDs.",
    method: "Computed by profileRecordIdentity() from the stored StudentProfile ID; a one-way hash, not the database ID.",
    source_nature: "deterministic_derived", category: "Export, provenance, and versioning data", research_category_id: "research_identifiers_and_joins"
  },
  item_snapshot_public_id: recorded(
    "Deterministic identifier of the item version as administered in this session (item_public_id plus :v and the item version), as in item_responses.csv.",
    "Built by interpretation-v8-export.ts from the session's item response snapshot (itemSnapshotId); blank when the item has no response row in the session.", { category: "Assessment design and content" }),
  item_version: recorded("Item version administered in this session, from the item response snapshot.", "Copied from ItemResponse.item_version_snapshot for the same session and item_public_id; blank when no response row exists.", { data_type: "integer", category: "Assessment design and content" }),
  item_order: recorded("Content-library order of the item (authoring order), as in item_responses.item_order; not the administered position.", "Copied from Item.item_order for the same item_public_id.", { data_type: "integer", category: "Assessment design and content" }),
  item_position: recorded("Administered position of the item stored with the v8 profile (the initial item position used when the profile was built).", `${STORED}: items[].position.`, { data_type: "integer", category: "Assessment design and content" }),
  item_number: rule(
    "Question number of the item as the feedback models and dashboards refer to it: rank of item_position among the profile's items, starting at 1. feedback_turn_records.focus_item_numbers uses these numbers.",
    "Computed by interpretation-v8-export.ts by sorting the stored items by position and numbering them from 1 (the same numbering as feedback-v8/context.ts).",
    { data_type: "integer" }
  ),
  generation_mode: recorded(
    "How the v8 interpretation was produced: live_model (validated output of the approved model), local_test (labelled local stand-in from the mock provider, never live model evidence) or fallback (no validated output: the model could not be reached, was not allowed, or its output failed the checks twice; no ratings or claims).",
    `${STORED}: generation_mode.`,
    { source_nature: "system_configuration", allowed_values: "live_model; local_test; fallback", category: "Export, provenance, and versioning data", research_category_id: "data_quality_research_provenance" }
  ),
  fallback_reason: recorded(
    "Why a fallback profile was saved: validation_failed (rejected twice), a provider failure category, or a reason no model call was allowed (for example interpretation_v8_not_approved or operational_agent_mode_disabled). Blank for live_model and local_test profiles.",
    `${STORED}: fallback_reason.`,
    { source_nature: "system_configuration", category: "Export, provenance, and versioning data", research_category_id: "data_quality_research_provenance" }
  ),
  prompt_version: version(`Profiling prompt version stored with the profile (${INTERPRETATION_V8_PROMPT_VERSION}).`, `${STORED}: prompt_version.`),
  schema_version: version(`Profiling output schema version stored with the profile (${INTERPRETATION_V8_SCHEMA_VERSION}).`, `${STORED}: schema_version.`),
  rules_version: version(
    `Version of the application rules for item status and the topic summary stored with the profile (${INTERPRETATION_RULES_VERSION}).`,
    `${STORED}: rules_version. Labels with decisions are recomputed with the rules of this application build.`
  ),
  indicators_version: version(`Version of the process indicator computation stored with the profile (${PROCESS_INDICATORS_VERSION}).`, `${STORED}: indicators_version.`),
  profile_created_at: {
    definition: "Time the v8 profile was saved (once, at submission); not the export time.",
    method: "Copied from StudentProfile.created_at of the stored v8 profile.",
    source_nature: "timestamp_derived", data_type: "datetime", unit: "ISO 8601 UTC timestamp", timing: POINT_TIMESTAMP("profile creation")
  }
};

const TABLE_DOCS: Record<InterpretationV8Table, Record<string, V8ColumnDoc>> = {
  interpretation_item_ratings: {
    selected_option: recorded("Option the student selected for the item, as stored with the v8 profile (final answer in the sealed response package); blank when no option was selected (its own state, never counted as incorrect).", `${STORED}: items[].selected_option.`, { source_nature: "student_reported", category: "Item response data", research_category_id: "item_responses_metacognitive_reports" }),
    answer_correct: rule(
      "Restricted. true when the selected option matches the key, false when it does not; blank when no option was selected or correctness could not be determined. Computed by the application, never by the model.",
      `${STORED}: items[].answer_correct (the application's comparison with the session-bound key). Omitted from default exports, like item_responses.correctness.`,
      { data_type: "boolean", allowed_values: "true; false", category: "Outcome and scoring data", research_category_id: "item_responses_metacognitive_reports", caution: "Restricted scoring context; with selected_option it reveals the key." }
    ),
    reported_confidence: recorded("Confidence the student reported for the item, copied exactly (low, medium or high); blank when not rated.", `${STORED}: items[].reported_confidence.`, { source_nature: "student_reported", allowed_values: "low; medium; high", category: "Item response data", research_category_id: "item_responses_metacognitive_reports" }),
    rapid_selection: rule(
      "true when the student's first answer to the item came less than " + RAPID_SELECTION_THRESHOLD_MS / 1000 + " seconds after the item appeared (the application's rapid-selection indicator), false when it came later; blank when the time could not be computed or the profile was saved before 2026-10-20. This is the value the item-status rule used: a rapid selection with no usable explanation is not_interpretable. A process indicator, not evidence of guessing or effort.",
      `${STORED}: items[].rapid_selection, the rapid_selection process indicator computed by interpretation-v8/indicators.ts at submission (time to first option selection, falling back to the sealed package's response_time_answer_ms).`,
      { data_type: "boolean", allowed_values: "true; false", category: "Process event data", research_category_id: "timing_and_interaction" }
    ),
    explanation_quality: model(
      "The model's rating of the item's explanation against its essential elements (section 4.2). " + RULE_TEXT.ratings.replace(/^Explanation quality \(section 4\.2\), judged against the item's essential elements \(the one to three points under "Strong reasoning should mention"\): /, "") + " Blank for fallback profiles.",
      `${STORED}: items[].explanation_quality, from the validated profiling output.`,
      { allowed_values: list(EXPLANATION_QUALITIES) }
    ),
    no_usable_reason: model("Reason code when explanation_quality is no_usable_explanation: not_provided, off_task, or stated_guess (a guess with no reasoning). Blank otherwise.", `${STORED}: items[].no_usable_reason.`, { allowed_values: list(NO_USABLE_REASONS) }),
    adds_beyond_option_text: model("true when the explanation adds any content beyond the wording of the options; false when it only repeats or paraphrases option text. Blank for no_usable_explanation and fallback profiles. A separate question from adequacy: it does not change the rating.", `${STORED}: items[].adds_beyond_option_text.`, { data_type: "boolean", allowed_values: "true; false" }),
    evidence_quote: model("The student's exact words supporting the rating (at least four words unless the response is shorter), checked by the application as an exact excerpt of the source named in evidence_source. Blank for no_usable_explanation.", `${STORED}: items[].evidence_quote.`, { privacy: "research_sensitive_text" }),
    evidence_source: model("Which of this item's student texts the quote comes from: explanation (final), explanation_first_version, or tempting_option_reason.", `${STORED}: items[].evidence_source.`, { allowed_values: list(QUOTE_SOURCES) }),
    reference_id: model("Reference the explanation is judged against (item_public_id:target, item_public_id:elements, item_public_id:option:LABEL for a distractor rationale, topic:objective or topic:description); required for an incorrect rating and checked to exist.", `${STORED}: items[].reference_id.`),
    missing_elements: model("For a limited rating: the essential element or elements not stated.", `${STORED}: items[].missing_elements.`),
    rationale: model("One or two sentences for the instructor: what the quote shows, judged against the reference. Contains no process indicators.", `${STORED}: items[].rationale.`),
    error_source: model("Source of an error in the answer or explanation: conceptual, execution_slip (only when the explanation states the correct rule and the error lies in carrying it out), possible_item_issue (a flag for the instructor that never changes the status) or unclear. An adequate explanation cannot have a conceptual error source.", `${STORED}: items[].error_source.`, { allowed_values: list(ERROR_SOURCES) }),
    side_remark: model("An incorrect remark outside the essential elements, recorded without changing the rating.", `${STORED}: items[].side_remark.`),
    uncertainty_note: model("What remains uncertain about this item, according to the model.", `${STORED}: items[].uncertainty_note.`),
    item_status: rule(
      "Application status of the item. " + RULE_TEXT.status + " Blank for fallback profiles and for items left without a rating by salvage (rating_unavailable true; those items are not counted).",
      `${STORED}: items[].status, computed at submission by rules.itemStatus from answer_correct, explanation_quality and the rapid-selection indicator.`,
      { allowed_values: list(ITEM_STATUSES) }
    ),
    rating_unavailable: rule(
      "true when the model's output was salvaged and this item's rating failed the application's checks: the item has no rating and no status, and it is not counted in the summary label (a failed model check is not evidence about the student). Blank for fallback profiles.",
      `${STORED}: items[].rating_unavailable (set by interpretation-v8/repair.ts salvage).`,
      { data_type: "boolean", allowed_values: "true; false" }
    ),
    item_review_flag: rule("true when the model gave error_source possible_item_issue: the item awaits the instructor's review. The flag never changes the item's status; only an instructor decision to exclude removes the item from the count.", `${STORED}: items[].item_review_flag (error_source = possible_item_issue).`, { data_type: "boolean", allowed_values: "true; false" }),
    instructor_item_decision: {
      definition: "The instructor's current decision on this item at export time (kept or excluded), applying to every student who took it; blank when no decision exists. Superseded decisions are in item_review_decisions.csv.",
      method: "Looked up by interpretation-v8-export.ts in item_review_decisions (rows with no superseded_at) by item_public_id.",
      source_nature: "teacher_authored", allowed_values: "kept; excluded", category: "Diagnostic and interpretation outputs", research_category_id: "diagnostic_interpretations"
    },
    instructor_item_decision_at: {
      definition: "When the current instructor decision on this item was recorded; blank without a decision.",
      method: "Copied from item_review_decisions.decided_at of the current decision.",
      source_nature: "timestamp_derived", data_type: "datetime", unit: "ISO 8601 UTC timestamp", timing: POINT_TIMESTAMP("decision")
    },
    item_counted_with_decisions: rule("true when the item counts in the topic summary with the instructor's current decisions (section 4.4): it has a status and is not excluded. false for excluded items, items left unrated by salvage and items of fallback profiles.", "Computed by interpretation-v8-export.ts as item_status is present and instructor_item_decision is not excluded.", { data_type: "boolean", allowed_values: "true; false" })
  },
  interpretation_claims: {
    claim_id: rule("Stable claim identifier: profile_record_id, the claim type and claim_index, joined by colons. Use it to link human coding of claims (RQ2).", "Built by interpretation-v8-export.ts from profile_record_id, claim_type and claim_index."),
    claim_type: rule("possible_misconception (both conditions of section 5 hold) or considered_idea (an idea the student considered, usually as a tempting-option reason, but did not endorse; never in the summary or the misconception list).", "Set by interpretation-v8-export.ts from the stored list the claim comes from.", { allowed_values: "possible_misconception; considered_idea" }),
    claim_index: rule("One-based order of the claim within its type in the stored profile.", "Position of the claim in possible_misconceptions or considered_ideas of the stored profile.", { data_type: "integer" }),
    claim_item_public_ids: model("Pipe-separated item_public_ids the claim concerns (one item for a considered idea).", `${STORED}: possible_misconceptions[].item_ids or considered_ideas[].item_id.`),
    claim_item_numbers: rule("Pipe-separated question numbers (item_number) of claim_item_public_ids.", "Mapped by interpretation-v8-export.ts with the item numbering of interpretation_item_ratings.csv."),
    quote_item_public_id: model("Item whose student text contains student_quote.", `${STORED}: possible_misconceptions[].quote_item_id or considered_ideas[].item_id.`),
    idea: model("The incorrect idea in plain words, as written by the model.", `${STORED}: idea.`),
    student_quote: model("The student's exact words showing the idea, checked by the application as an exact excerpt of quote_source for quote_item_public_id.", `${STORED}: student_quote.`, { privacy: "research_sensitive_text" }),
    quote_source: model("Which student text the quote comes from: explanation, explanation_first_version or tempting_option_reason.", `${STORED}: quote_source.`, { allowed_values: list(QUOTE_SOURCES) }),
    endorsement: model("For a possible misconception: endorsed, or tentative when a hedge attaches to that specific idea. Blank for considered ideas.", `${STORED}: possible_misconceptions[].endorsement.`, { allowed_values: list(ENDORSEMENTS) }),
    contradicts_reference_id: model("Reference the idea contradicts (item specification or topic objective and description), checked to exist.", `${STORED}: contradicts_reference_id.`),
    matching_distractor_reference_id: model("For a possible misconception: the distractor rationale (item_public_id:option:LABEL) the quoted idea matches, if any. A match never replaces the two conditions.", `${STORED}: possible_misconceptions[].matching_distractor_reference_id.`),
    alternative_explanation: model("For a possible misconception: a plausible alternative explanation of the student's words, if any.", `${STORED}: possible_misconceptions[].alternative_explanation.`)
  },
  interpretation_summaries: {
    stored_label: rule(`Label stored at submission, with no instructor decisions: one of ${list(TOPIC_SUMMARY_LABELS)} or ${PENDING_ITEM_REVIEW_LABEL}. ` + RULE_TEXT.summary, `${STORED}: topic_summary.label.`, { allowed_values: list([...TOPIC_SUMMARY_LABELS, PENDING_ITEM_REVIEW_LABEL]), formula: "summary rules applied to the stored item statuses with every administered item counted" }),
    stored_reason: rule("Reason code of stored_label: the rule that decided it, flagged_items_change_label for a withheld label, or no_valid_profile for a fallback.", `${STORED}: topic_summary.reason.`, { allowed_values: "no_valid_profile; no_counted_items; fewer_than_two_interpretable; fewer_than_half_interpretable; half_or_more_not_supported; supported_majority_none_unsupported; mixed; flagged_items_change_label" }),
    stored_rule_label: rule("The rule label at submission with every counted item, flagged items included (equals stored_label unless the label was withheld as Pending item review).", `${STORED}: topic_summary.rule_label.`, { allowed_values: list(TOPIC_SUMMARY_LABELS) }),
    stored_rule_reason: rule("Reason code of stored_rule_label.", `${STORED}: topic_summary.rule_reason.`),
    stored_label_without_pending: rule("At submission: the rule label without the items awaiting review; blank when no item was flagged. " + RULE_TEXT.pending, `${STORED}: topic_summary.label_without_pending.`, { allowed_values: list(TOPIC_SUMMARY_LABELS) }),
    stored_pending_review_item_ids: rule("Pipe-separated items flagged as a possible item issue at submission (all flags, before any decision).", `${STORED}: topic_summary.pending_review_item_ids.`),
    label_with_decisions: rule("Label with the instructor's current item decisions at export time, as the dashboard shows it (section 4.4); recomputed from the stored item statuses, the stored profile unchanged. Equals stored_label when no decision applies.", "Computed by decisionAdjustedTopicSummary(stored profile, current decisions) in interpretation-v8/profile.ts; a fallback keeps its stored summary.", { allowed_values: list([...TOPIC_SUMMARY_LABELS, PENDING_ITEM_REVIEW_LABEL]), formula: "summary rules applied to the stored item statuses minus excluded items, with kept items no longer pending" }),
    reason_with_decisions: rule("Reason code of label_with_decisions.", "Computed by decisionAdjustedTopicSummary(stored profile, current decisions); its reason field."),
    rule_label_with_decisions: rule("Rule label with the current decisions and every counted item (flagged items without a decision included).", "Computed by decisionAdjustedTopicSummary(stored profile, current decisions); its rule_label field.", { allowed_values: list(TOPIC_SUMMARY_LABELS) }),
    label_without_pending_with_decisions: rule("Rule label with the current decisions, leaving out items still awaiting review; blank when none await review.", "Computed by decisionAdjustedTopicSummary(stored profile, current decisions); its label_without_pending field.", { allowed_values: list(TOPIC_SUMMARY_LABELS) }),
    pending_review_item_ids_with_decisions: rule("Pipe-separated flagged items still without an instructor decision at export time.", "Computed by decisionAdjustedTopicSummary(stored profile, current decisions); its pending_review_item_ids field."),
    excluded_item_ids_with_decisions: rule("Pipe-separated items the instructor has excluded (current decisions), removed from the counted items.", "Computed by decisionAdjustedTopicSummary(stored profile, current decisions); its excluded_item_ids field."),
    administered_item_count: rule("Items administered in the attempt and stored with the profile (n in \"based on k of n items\").", `${STORED}: topic_summary.administered_items.`, { data_type: "integer", unit: "count" }),
    counted_item_count: rule("Counted items at submission (administered items; no decisions existed).", `${STORED}: topic_summary.counted_items.`, { data_type: "integer", unit: "count" }),
    interpretable_item_count: rule("Interpretable counted items at submission (k in \"based on k of n items\").", `${STORED}: topic_summary.interpretable_items.`, { data_type: "integer", unit: "count" }),
    supported_item_count: rule("Counted items with status supported, at submission.", `${STORED}: topic_summary.supported.`, { data_type: "integer", unit: "count" }),
    partly_supported_item_count: rule("Counted items with status partly_supported, at submission.", `${STORED}: topic_summary.partly_supported.`, { data_type: "integer", unit: "count" }),
    not_supported_item_count: rule("Counted items with status not_supported, at submission.", `${STORED}: topic_summary.not_supported.`, { data_type: "integer", unit: "count" }),
    not_interpretable_item_count: rule("Counted items with status not_interpretable, at submission.", `${STORED}: topic_summary.not_interpretable.`, { data_type: "integer", unit: "count" }),
    counted_item_count_with_decisions: rule("Counted items with the current decisions (administered minus excluded).", "Computed by decisionAdjustedTopicSummary(stored profile, current decisions); its counted_items field.", { data_type: "integer", unit: "count" }),
    interpretable_item_count_with_decisions: rule("Interpretable counted items with the current decisions.", "Computed by decisionAdjustedTopicSummary(stored profile, current decisions); its interpretable_items field.", { data_type: "integer", unit: "count" }),
    possible_misconception_count: model("Number of possible misconceptions in the profile (rows of claim_type possible_misconception in interpretation_claims.csv).", "Length of the stored possible_misconceptions list.", { data_type: "integer", unit: "count" }),
    considered_idea_count: model("Number of ideas considered but not endorsed in the profile.", "Length of the stored considered_ideas list.", { data_type: "integer", unit: "count" }),
    answer_patterns: rule("JSON array of answer patterns: two or more chosen incorrect options whose rationales share a misconception tag ({misconception_tag, item_ids}). Answer choices only, never a confirmed misconception.", `${STORED}: answer_patterns, computed by rules.answerPatterns at submission.`, { data_type: "json string" }),
    output_repair_codes: rule("Pipe-separated codes of the mechanical repairs applied to the accepted model output before it was checked (for example evidence_quote_trimmed_to_exact_words, error_source_unclear). Repairs never change what the output claims about the student. Blank when none.", `${STORED}: output_adjustments.repairs[].code (interpretation-v8/repair.ts).`),
    output_salvaged: rule("true when no attempt passed every check and the failing parts of the last checked output were removed (claims dropped, notes cleared, failing items left unrated) instead of saving a fallback profile.", `${STORED}: output_adjustments.salvage is set.`, { data_type: "boolean", allowed_values: "true; false" }),
    salvage_unrated_item_ids: rule("Pipe-separated item IDs left without a rating by salvage (they count as not interpretable). Blank when the output was not salvaged.", `${STORED}: output_adjustments.salvage.unrated_item_ids.`),
    salvage_dropped_claim_count: rule("Number of possible misconceptions and considered ideas dropped by salvage because they failed the checks.", `${STORED}: output_adjustments.salvage.dropped_misconceptions + dropped_considered_ideas.`, { data_type: "integer", unit: "count" }),
    profiling_call_count: recorded("Number of interpretation v8 profiling calls recorded for this attempt: the first call, each regeneration after an output failed the checks, and calls repeated after a provider failure. 0 when no call was allowed (a fallback saved without a call).", "Counted by interpretation-v8-export.ts over the attempt's AgentCall rows of student_profiling_agent with a v8 schema version.", { data_type: "integer", unit: "count", source_nature: "system_configuration", category: "Export, provenance, and versioning data", research_category_id: "data_quality_research_provenance" }),
    profiling_output_rejected_count: rule("Number of model outputs that failed the application's checks for this attempt (Table 3.2: regenerated after failing the checks). A salvaged output counts as rejected.", "Counted by interpretation-v8-export.ts: v8 profiling calls with call_status invalid_output, plus one when output_salvaged is true (salvage stores its call as succeeded).", { data_type: "integer", unit: "count" }),
    profiling_provider_failure_count: rule("Number of profiling calls that failed at the provider (no output to check), for example a timeout.", "Counted by interpretation-v8-export.ts over the attempt's v8 profiling calls with call_status failed.", { data_type: "integer", unit: "count" }),
    first_output_passed: rule("true when the profile rests on model output that passed every check without a regeneration or salvage (profiling_output_rejected_count = 0); false when at least one output was rejected; blank for fallback and local_test profiles.", "Computed by interpretation-v8-export.ts from generation_mode and profiling_output_rejected_count.", { data_type: "boolean", allowed_values: "true; false" }),
    profiling_model_name: version("Model that produced the output the profile rests on (for example gpt-5.6-luna); blank for fallback profiles.", "Copied from AgentCall.model_name of the profile's source call (StudentProfile.based_on_agent_call)."),
    profiling_prompt_hash: version("SHA-256 hash of the profiling prompt sent in the source call; equals INTERPRETATION_V8_APPROVED_PROMPT_HASH for approved live calls.", "Copied from AgentCall.prompt_hash of the profile's source call."),
    attempt_context_version: version(`Version of the stored attempt context (${ATTEMPT_CONTEXT_VERSION}; attempt-context-v1 only in pre-release test data); blank when none was stored.`, `${STORED}: attempt.attempt_context_version.`),
    earlier_attempt_count: rule("Number of the student's earlier attempts in the same revision family that existed when this attempt started.", `${STORED}: length of attempt.feedback_seen_before.`, { data_type: "integer", unit: "count" }),
    feedback_seen_attempt_numbers: rule("Pipe-separated attempt numbers of earlier attempts whose answer review was recorded on screen before this attempt started.", `${STORED}: attempt.feedback_seen_before[].attempt_number where answer_review_displayed_at is set (attempt-context-v1: where answer_review_shown).`),
    answer_review_seen_before: rule("true when the answer review of at least one earlier attempt was recorded on screen (package_results_shown) before this attempt started. Display, not proof of reading.", `${STORED}: any attempt.feedback_seen_before[].answer_review_displayed_at (attempt-context-v1: answer_review_shown, i.e. submitted).`, { data_type: "boolean", allowed_values: "true; false" }),
    opening_message_seen_before: rule("true when feedback from an earlier attempt (the opening message or a reply) was recorded on screen (formative_feedback_shown) before this attempt started. Display, not proof of reading.", `${STORED}: any attempt.feedback_seen_before[].opening_message_displayed_at (attempt-context-v1: opening_message_at, the creation time).`, { data_type: "boolean", allowed_values: "true; false" }),
    student_turns_seen_before: rule("Student conversation turns of earlier attempts created before this attempt started.", `${STORED}: sum of attempt.feedback_seen_before[].student_turns.`, { data_type: "integer", unit: "count" }),
    tutor_turns_seen_before: rule("Tutor conversation turns (opening included) of earlier attempts created before this attempt started.", `${STORED}: sum of attempt.feedback_seen_before[].tutor_turns.`, { data_type: "integer", unit: "count" }),
    feedback_seen_before_json: rule("JSON array of the earlier attempts as stored (session_public_id, attempt_number, submitted_at, answer_review_shown, answer_review_displayed_at, opening_message_at, opening_message_displayed_at, student_turns, tutor_turns, last_conversation_turn_at). " + RULE_TEXT.attempts, `${STORED}: attempt.feedback_seen_before.`, { data_type: "json string" })
  },
  interpretation_process_audit: {
    audience: rule("Always audit_only_never_shown: these indicators and interpretations served the profiling and feedback models only and were never shown to instructors or students.", "Constant written by interpretation-v8-export.ts.", { allowed_values: "audit_only_never_shown" }),
    profiling_agent_call_public_id: recorded("Public identifier of the profiling call the profile is based on (the validated call, or the last call when validation failed twice); joins ai_call_audit.csv, which also holds rejected attempts.", "Copied from the AgentCall linked to the profile (StudentProfile.based_on_agent_call).", { source_nature: "system_configuration" }),
    profiling_call_status: recorded("Status of that profiling call: succeeded, invalid_output, failed.", "Copied from AgentCall.call_status of the profiling call the profile is based on.", { source_nature: "system_configuration" }),
    profiling_output_validated: recorded("true when the profiling call's output passed the application's checks.", "Copied from AgentCall.output_validated of the profiling call the profile is based on.", { source_nature: "system_configuration", data_type: "boolean", allowed_values: "true; false" }),
    profiling_provider: recorded("Provider of the profiling call: openai for live model output, mock for the local test stand-in.", "Copied from AgentCall.provider of the profiling call the profile is based on.", { source_nature: "system_configuration" }),
    process_indicators_json: rule("JSON array of the indicators sent to the model for this item, each {indicator_id, name, value, unit, role}. " + RULE_TEXT.audit, `Copied by interpretation-v8-export.ts from the profiling call's input (input_payload.items[].process_indicators); computed by computeProcessIndicators (${PROCESS_INDICATORS_VERSION}).`, { data_type: "json string" }),
    process_interpretation_status: rule("present (the validated output gave a process interpretation for the item), none (the validated output gave none) or no_validated_output (the call's output was rejected or missing; rejected drafts are only in ai_call_audit.csv).", "Set by interpretation-v8-export.ts from the profiling call's output_validated and output_payload.", { allowed_values: "present; none; no_validated_output" }),
    process_interpretation_type: model("Type of the model's process interpretation: possible_revision_of_reasoning (an answer, explanation or confidence change with what changed in the student's words), limited_engagement_evidence (a rapid selection) or context_noted (focus loss, pauses, paste attempts or focused time, with alternatives).", "Copied from the validated profiling output (output_payload.items[].process_interpretation.type).", { allowed_values: list(PROCESS_INTERPRETATION_TYPES), caution: AUDIT_CAUTION }),
    process_interpretation_indicator_ids: model("Pipe-separated indicator_ids the interpretation cites (item_public_id:indicator name); the application rejects a citation outside the indicator's role.", "Copied from the validated profiling output (AgentCall.output_payload.items[].process_interpretation.indicator_ids) of the profiling call the profile is based on.", { caution: AUDIT_CAUTION }),
    process_interpretation_content_quote: model("For possible_revision_of_reasoning: the student's exact words showing what changed.", "Copied from the validated profiling output (AgentCall.output_payload.items[].process_interpretation.content_quote) of the profiling call the profile is based on.", { caution: AUDIT_CAUTION, privacy: "research_sensitive_text" }),
    process_interpretation_content_source: model("Source text of the content quote: explanation, explanation_first_version or tempting_option_reason.", "Copied from the validated profiling output (AgentCall.output_payload.items[].process_interpretation.content_source) of the profiling call the profile is based on.", { allowed_values: list(QUOTE_SOURCES), caution: AUDIT_CAUTION }),
    process_interpretation_note: model("One or two sentences for internal use by the feedback models.", "Copied from the validated profiling output (AgentCall.output_payload.items[].process_interpretation.note) of the profiling call the profile is based on.", { caution: AUDIT_CAUTION }),
    process_interpretation_alternatives: model("JSON array of the alternative explanations the model listed.", "Copied from the validated profiling output (AgentCall.output_payload.items[].process_interpretation.alternatives) of the profiling call the profile is based on.", { caution: AUDIT_CAUTION, data_type: "json string" })
  },
  feedback_turn_records: {
    conversation_public_id: recorded("Public identifier of the formative conversation; joins formative_conversation_sessions.csv and formative_conversation_turns.csv.", "Copied from the conversation linked to the feedback AgentCall (formative_conversation_session).", { research_category_id: "research_identifiers_and_joins", category: "Session and participation variables" }),
    agent_call_public_id: recorded("Public identifier of the feedback v8 model call that produced the turn record; joins formative_conversation_llm_calls.csv and ai_call_audit.csv.", "Copied from AgentCall.agent_call_public_id of the validated feedback v8 call.", { research_category_id: "research_identifiers_and_joins" }),
    turn_sequence_index: recorded("Global transcript sequence of the tutor turn that showed this output; join with conversation_public_id to formative_conversation_turns.csv for the message text. Blank when no persisted turn is linked (for example the student ended the conversation before the reply was saved), in which case the student never saw the message.", "Copied from the ConversationTurn linked to the AgentCall through formative_conversation_turn_telemetry.", { data_type: "integer", category: "Process event data" }),
    conversation_local_turn_sequence_index: recorded("One-based turn order within the conversation for the linked tutor turn.", "Copied from FormativeConversationTurnTelemetry.conversation_local_turn_sequence_index of the linked tutor turn.", { data_type: "integer", category: "Process event data" }),
    turn_created_at: { definition: "Time the linked tutor turn was saved.", method: "Copied from ConversationTurn.created_at of the linked tutor turn.", source_nature: "timestamp_derived", data_type: "datetime", unit: "ISO 8601 UTC timestamp", timing: POINT_TIMESTAMP("tutor turn") },
    feedback_mode: rule("opening (the first message after the answer review, section 9.5) or reply (a conversation reply, section 9.6). The application's checks require focus_status to be blank for the opening and set for every reply.", "Set by interpretation-v8-export.ts: opening when the validated output's focus_status is null, reply otherwise.", { allowed_values: "opening; reply" }),
    focus_item_numbers: model("Pipe-separated question numbers the message is about (item_number in interpretation_item_ratings.csv); blank for a general message.", "Copied from the validated feedback v8 output of the call behind this turn record (AgentCall.output_payload.focus.item_numbers).", { generating_agent: FEEDBACK_AGENT, generating_schema_version: FEEDBACK_V8_CONTRACT_VERSION }),
    focus_item_public_ids: rule("Pipe-separated item_public_ids of focus_item_numbers, mapped with the numbering of the conversation's v8 profile.", "Mapped by interpretation-v8-export.ts through the stored item positions of the conversation's initial v8 profile."),
    focus_type: model("Focus chosen by the model's priority (section 7): student_question, possible_misconception, shared_difficulty, single_item, extension or closing.", "Copied from the validated feedback v8 output of the call behind this turn record (AgentCall.output_payload.focus.focus_type).", { allowed_values: list(FOCUS_TYPES), generating_agent: FEEDBACK_AGENT, generating_schema_version: FEEDBACK_V8_CONTRACT_VERSION }),
    focus_concept: model("The concept discussed, in a few words, for the instructor.", "Copied from the validated feedback v8 output of the call behind this turn record (AgentCall.output_payload.focus.concept).", { generating_agent: FEEDBACK_AGENT, generating_schema_version: FEEDBACK_V8_CONTRACT_VERSION }),
    strategy: model("Strategy used: explain, clarify, extend, answer_request, acknowledge_item_issue, invite_explanation or close.", "Copied from the validated feedback v8 output of the call behind this turn record (AgentCall.output_payload.strategy).", { allowed_values: list(STRATEGIES), generating_agent: FEEDBACK_AGENT, generating_schema_version: FEEDBACK_V8_CONTRACT_VERSION }),
    focus_status: model("For replies: corrected_reasoning_expressed (reasoning the student wrote with support, not evidence of independent mastery), difficulty_still_evident or not_discussed_further. Blank for the opening.", "Copied from the validated feedback v8 output of the call behind this turn record (AgentCall.output_payload.focus_status).", { allowed_values: list(FOCUS_STATUSES), generating_agent: FEEDBACK_AGENT, generating_schema_version: FEEDBACK_V8_CONTRACT_VERSION }),
    student_evidence_count: rule("Number of student-evidence entries in the turn record (0 for the opening and when the new message shows nothing about the focus).", "Length of the student_evidence list in the validated feedback v8 output.", { data_type: "integer", unit: "count" }),
    student_evidence_quotes: model("JSON array of exact quotes from the student's new message, checked as exact excerpts; aligned with student_evidence_notes.", "Copied from the validated feedback v8 output of the call behind this turn record (AgentCall.output_payload.student_evidence[].quote).", { data_type: "json string", privacy: "research_sensitive_text", generating_agent: FEEDBACK_AGENT, generating_schema_version: FEEDBACK_V8_CONTRACT_VERSION }),
    student_evidence_notes: model("JSON array of one-line notes on what each quote shows, for the instructor; aligned with student_evidence_quotes.", "Copied from the validated feedback v8 output of the call behind this turn record (AgentCall.output_payload.student_evidence[].note).", { data_type: "json string", generating_agent: FEEDBACK_AGENT, generating_schema_version: FEEDBACK_V8_CONTRACT_VERSION }),
    instructor_review_flag: model("Instructor-review flag of the turn record: none, possible_item_issue, persistent_difficulty or student_requested_instructor.", "Copied from the validated feedback v8 output of the call behind this turn record (AgentCall.output_payload.instructor_review.flag).", { allowed_values: list(REVIEW_FLAGS), generating_agent: FEEDBACK_AGENT, generating_schema_version: FEEDBACK_V8_CONTRACT_VERSION }),
    instructor_review_reason: model("Reason given with a flag other than none.", "Copied from the validated feedback v8 output of the call behind this turn record (AgentCall.output_payload.instructor_review.reason).", { generating_agent: FEEDBACK_AGENT, generating_schema_version: FEEDBACK_V8_CONTRACT_VERSION }),
    review_signal_public_id: recorded("Public identifier of the review signal (signal_type feedback_v8_instructor_review) the flag opened for the instructor; blank when the flag is none.", "Matched by interpretation-v8-export.ts on conversation and source tutor turn (FormativeConversationReviewSignal.source_turn).", { source_nature: "system_configuration", category: "Diagnostic and interpretation outputs" }),
    review_signal_status: recorded("Current status of that review signal at export time (open, acknowledged, resolved or dismissed).", "Copied from FormativeConversationReviewSignal.status of the matched review signal.", { source_nature: "system_configuration", category: "Diagnostic and interpretation outputs", allowed_values: "open; acknowledged; resolved; dismissed" }),
    provider: recorded("Provider of the feedback call: openai for live model output, mock for the local test stand-in.", "Copied from AgentCall.provider of the feedback v8 call behind this turn record.", { source_nature: "system_configuration", tier: "supplementary_research" }),
    model_name: recorded("Model recorded for the feedback call.", "Copied from AgentCall.model_name of the feedback v8 call behind this turn record.", { source_nature: "system_configuration", tier: "supplementary_research" }),
    prompt_version: version(`Prompt version stored on the call (${FEEDBACK_V8_OPENING_PROMPT_VERSION}+${FEEDBACK_V8_CONVERSATION_PROMPT_VERSION}: both prompts are approved together).`, "Copied from AgentCall.prompt_version of the feedback v8 call behind this turn record."),
    mode_prompt_version: version(`Prompt that produced this output (currently ${FEEDBACK_V8_OPENING_PROMPT_VERSION} for the opening, ${FEEDBACK_V8_CONVERSATION_PROMPT_VERSION} for replies).`, "Taken by interpretation-v8-export.ts from the call's stored prompt_version (\"opening+conversation\"), the part matching feedback_mode."),
    schema_version: version(`Output contract of the feedback call (${FEEDBACK_V8_CONTRACT_VERSION}).`, "Copied from AgentCall.schema_version of the feedback v8 call behind this turn record."),
    prompt_hash: version("Hash of both feedback prompts and the output schema; identical hashes mean identical instructions.", "Copied from AgentCall.prompt_hash of the feedback v8 call behind this turn record."),
    call_completed_at: { definition: "Time the feedback call finished (server time).", method: "Copied from AgentCall.completed_at of the feedback v8 call behind this turn record.", source_nature: "timestamp_derived", data_type: "datetime", unit: "ISO 8601 UTC timestamp", timing: POINT_TIMESTAMP("call completion") }
  },
  item_review_decisions: {
    decision_public_id: recorded("Public identifier of the instructor decision.", "Copied from item_review_decisions.decision_public_id of the decision row.", { research_category_id: "research_identifiers_and_joins", category: "Diagnostic and interpretation outputs" }),
    item_version: recorded("Current version of the decided item in the content library.", "Copied from items.version through the decision's item.", { data_type: "integer", category: "Assessment design and content" }),
    decision: { definition: "kept (the flagged item stays counted and is no longer pending) or excluded (removed from the counted items for every student who took it). Decisions are append-only: a new decision supersedes the last.", method: "Copied from item_review_decisions.decision of the decision row.", source_nature: "teacher_authored", allowed_values: "kept; excluded", category: "Diagnostic and interpretation outputs", research_category_id: "diagnostic_interpretations" },
    note: { definition: "The instructor's optional note on the decision; free text that may need review before sharing.", method: "Copied from item_review_decisions.note of the decision row, unedited.", source_nature: "teacher_authored", privacy: "research_sensitive_text", category: "Diagnostic and interpretation outputs", research_category_id: "diagnostic_interpretations" },
    decided_at: { definition: "When the decision was recorded.", method: "Copied from item_review_decisions.decided_at of the decision row.", source_nature: "timestamp_derived", data_type: "datetime", unit: "ISO 8601 UTC timestamp", timing: POINT_TIMESTAMP("decision") },
    superseded_at: { definition: "When a later decision on the same item superseded this one; blank for the current decision.", method: "Copied from item_review_decisions.superseded_at of the decision row.", source_nature: "timestamp_derived", data_type: "datetime", unit: "ISO 8601 UTC timestamp", timing: POINT_TIMESTAMP("supersession") },
    decision_current: rule("true for the decision in force at export time (superseded_at blank).", "Computed by interpretation-v8-export.ts as superseded_at is blank.", { data_type: "boolean", allowed_values: "true; false" }),
    research_instructor_id: { definition: "Pseudonymous identifier of the instructor who recorded the decision (ri_ prefix); not the username or email. Same key and version as research_student_id, separate namespace.", method: "Computed by researchInstructorId() with versioned HMAC-SHA-256 over the instructor's operational user identifier using RESEARCH_PSEUDONYMIZATION_KEY.", source_nature: "deterministic_derived", privacy: "pseudonymous_research_id", category: "Export, provenance, and versioning data", research_category_id: "research_identifiers_and_joins" }
  }
};

/** Documentation for columns added to existing tables. */
const PROFILE_COLUMN_DOCS: Record<string, V8ColumnDoc> = {
  interpretation_profile_schema: version(`${INTERPRETATION_V8_PROFILE_SCHEMA} when the profile on this row comes from interpretation v8; blank for earlier profiles, whose legacy columns are unchanged.`, "Set from StudentProfile.item_level_evidence.profile_schema (readStoredInterpretationV8)."),
  interpretation_generation_mode: { ...SHARED.generation_mode, definition: "For a v8 profile: " + SHARED.generation_mode.definition + " Blank for earlier profiles." },
  interpretation_summary_label: rule(`For a v8 profile: the topic summary label stored at submission (${list([...TOPIC_SUMMARY_LABELS, PENDING_ITEM_REVIEW_LABEL])}), with no instructor decisions; blank for earlier profiles. See interpretation_summaries.csv.`, `${STORED}: topic_summary.label.`, { allowed_values: list([...TOPIC_SUMMARY_LABELS, PENDING_ITEM_REVIEW_LABEL]) }),
  interpretation_summary_label_with_decisions: rule("For a v8 profile: the label recomputed with the instructor's current item decisions at export time (the dashboard label); blank for earlier profiles.", "Computed by decisionAdjustedTopicSummary(stored profile, current decisions).", { allowed_values: list([...TOPIC_SUMMARY_LABELS, PENDING_ITEM_REVIEW_LABEL]) }),
  interpretation_rules_version: version(`For a v8 profile: the rules version stored with it (${INTERPRETATION_RULES_VERSION}); blank for earlier profiles.`, `${STORED}: rules_version.`)
};

const v4Count = (definition: string, action: string): V8ColumnDoc => ({
  definition: `${definition} Blank for items with no item administration v4 record (earlier versions recorded quality levels instead).`,
  method: `Counted by itemResponseRows() over the item's response_quality_checked events whose payload.item_administration_tutor carries collection_action (v4 records): ${action}.`,
  source_nature: "aggregate_derived", data_type: "integer", unit: "count", category: "Item response data",
  research_category_id: "item_responses_metacognitive_reports"
});
const ITEM_ADMIN_V4_DOCS: Record<string, V8ColumnDoc> = {
  item_admin_tutor_versions: {
    definition: "Pipe-separated item administration versions recorded for the item's replies (item-administration-tutor-v4 or earlier). Mixed values mean the attempt continued across an application update.",
    method: "Distinct payload.item_administration_tutor.tutor_version values of the item's response_quality_checked events, in first-seen order.",
    source_nature: "system_configuration", category: "Export, provenance, and versioning data", research_category_id: "data_quality_research_provenance", tier: "supplementary_research"
  },
  item_admin_v4_decision_count: v4Count("Number of v4 collection decisions for the item's typed replies (explanation and tempting-option reason). v4 records collection, not quality: response_quality not_judged, and an accepted reply is accepted_response / collected.", "every v4 record"),
  item_admin_v4_accept_count: v4Count("Number of replies accepted as typed (action accept; message_classification accepted_response).", "collection_action accept"),
  item_admin_v4_clarify_count: v4Count("Number of replies that received the one neutral clarification allowed per response (action clarify_once).", "collection_action clarify_once"),
  item_admin_v4_deferred_question_count: v4Count("Number of replies with a content question or answer request saved for after the mini-test (action defer_question).", "collection_action defer_question"),
  item_admin_v4_procedural_help_count: v4Count("Number of replies that received brief procedural help (action procedural_help).", "collection_action procedural_help"),
  item_admin_v4_redirect_count: v4Count("Number of off-task or unreadable replies the student was asked to replace (action redirect; message_classification off_task_or_unreadable).", "collection_action redirect"),
  item_admin_v4_model_decision_count: v4Count("Number of v4 decisions taken from the model's action (collection_decision_source model).", "collection_decision_source model"),
  item_admin_v4_fallback_count: v4Count("Number of v4 decisions made by the deterministic rules because the model was unavailable or its output failed (fallback_used).", "collection_fallback_used true"),
  item_admin_v4_application_override_count: v4Count("Number of v4 decisions where an application rule replaced the model's action (clarification already used, fallback prompt already given, or empty response).", "collection_application_override other than none"),
  item_admin_v4_saved_question_count: v4Count("Number of v4 decisions that saved a student question for after the mini-test (it feeds the first level of the opening-feedback focus priority).", "a nonempty deferred_concern_summary")
};

function withSharedDefaults(doc: V8ColumnDoc, table: string, variable: string): V8ColumnDoc {
  const restricted = (INTERPRETATION_V8_RESTRICTED_TABLES as readonly string[]).includes(table) ||
    (INTERPRETATION_V8_RESTRICTED_COLUMNS as readonly string[]).includes(variable);
  return {
    ...doc,
    ...(restricted ? { export_policy: "restricted_research_dataset_only", audience: "restricted_researcher" } : {}),
    ...(table === "interpretation_process_audit"
      ? { privacy: doc.privacy ?? "restricted_model_audit", audience: "restricted_researcher; audit only, never shown to instructors or students", tier: "supplementary_research" as const }
      : {})
  };
}

/**
 * The documentation of one v8 export column, or null when the column has none (join keys
 * shared with the other research tables keep their standard dictionary text).
 */
export function interpretationV8ColumnDoc(table: string, variable: string): V8ColumnDoc | null {
  if ((INTERPRETATION_V8_TABLES as readonly string[]).includes(table)) {
    const doc = TABLE_DOCS[table as InterpretationV8Table][variable] ?? SHARED[variable];
    if (doc) return withSharedDefaults(doc, table, variable);
    if (variable.startsWith("indicator_")) {
      const name = (Object.entries(PROCESS_AUDIT_INDICATOR_COLUMNS).find(([, column]) => column === variable)?.[0]) as keyof typeof PROCESS_INDICATOR_DEFINITIONS | undefined;
      if (name) {
        const indicator = PROCESS_INDICATOR_DEFINITIONS[name];
        const pause = name === "longest_pause";
        return withSharedDefaults({
          definition: `Process indicator ${name} sent to the profiling model: ${indicator.computed_as}. Role ${indicator.role}: the model may ${indicator.may.replace(/\.$/, "").toLowerCase()}; it may not ${indicator.may_not.replace(/\.$/, "").toLowerCase()}. Alternatives given to the model: ${indicator.alternatives.join("; ")}.`,
          method: `Copied from the profiling call's input (input_payload.items[].process_indicators, name ${name}); computed by computeProcessIndicators (${PROCESS_INDICATORS_VERSION}) from the item's own events up to submission.`,
          source_nature: "deterministic_derived",
          data_type: indicator.unit ? "integer" : typeof indicator.computed_as === "string" && /^true when/.test(indicator.computed_as) ? "boolean" : "string",
          unit: indicator.unit ?? (pause ? "seconds" : ""),
          caution: AUDIT_CAUTION,
          category: pause ? "Timing and interaction data" : "Diagnostic and interpretation outputs",
          research_category_id: pause ? "timing_and_interaction" : "diagnostic_interpretations",
          ...(pause ? { timing: {
            construct: "longest_recorded_item_pause",
            start: "item display",
            end: "item submission",
            formula: "Longest recorded inactivity while the item was open, in whole seconds; a pause is recorded once it passes two minutes, so the value is a lower bound; 0 when none was recorded.",
            idle: "This value is a recorded idle interval.",
            hidden: "Recorded from inactivity whether or not the page was visible."
          } } : {})
        }, table, variable);
      }
    }
    return null;
  }
  if (table === "item_responses" && ITEM_ADMIN_V4_DOCS[variable]) return ITEM_ADMIN_V4_DOCS[variable];
  if (PROFILE_COLUMN_DOCS[variable] && ["sessions", "assessment_summary", "agent_activity_records", "formative_conversation_sessions"].includes(table)) {
    return {
      ...PROFILE_COLUMN_DOCS[variable],
      ...(table === "agent_activity_records" ? { applicable: "profile_result" } : {})
    };
  }
  return null;
}

/** A note appended to an existing column's definition for v8 profiles or v4 records. */
export function interpretationV8LegacyNote(table: string, variable: string): string | null {
  if (V8_BLANKED_LEGACY_COLUMNS[table]?.includes(variable)) {
    return ([...CONVERSATION_UPDATE_LEGACY_COLUMNS, ...CONVERSATION_TRANSITION_LEGACY_COLUMNS] as readonly string[]).includes(variable)
      ? V8_CONVERSATION_LEGACY_NOTE : V8_LEGACY_BLANK_NOTE;
  }
  if (table === "item_responses" && ITEM_ADMINISTRATION_V4_EXISTING_COLUMN_NOTES[variable]) return ITEM_ADMINISTRATION_V4_EXISTING_COLUMN_NOTES[variable];
  return null;
}

export const INTERPRETATION_V8_MEASUREMENT_LEVELS: Record<InterpretationV8Table, string> = {
  interpretation_item_ratings: "student_attempt_item",
  interpretation_claims: "interpretation_claim",
  interpretation_summaries: "student_attempt",
  interpretation_process_audit: "student_attempt_item_audit",
  feedback_turn_records: "feedback_turn_record",
  item_review_decisions: "item_review_decision"
};

export const INTERPRETATION_V8_ROW_FUNCTIONS: Record<InterpretationV8Table, string> = {
  interpretation_item_ratings: "interpretationItemRatingRows",
  interpretation_claims: "interpretationClaimRows",
  interpretation_summaries: "interpretationSummaryRows",
  interpretation_process_audit: "interpretationProcessAuditRows",
  feedback_turn_records: "feedbackTurnRecordRows",
  item_review_decisions: "itemReviewDecisionRows"
};
