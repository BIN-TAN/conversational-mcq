import { prisma } from "@/lib/db";
import { buildTeacherSessionDataAudit } from "@/lib/services/teacher-review/session-data-audit";
import {
  getTeacherReadableTranscript,
  type TeacherReadableTranscriptProjection
} from "@/lib/services/teacher-review/readable-transcript";
import { asArray, asRecord, stripInternalKeys } from "@/lib/services/teacher-review/serializers";
import { buildEngagementProcessFeatureRows } from "@/lib/services/teacher-review/engagement-process-features";
import { buildTurnResponseLatencyRows } from "@/lib/services/teacher-review/turn-response-latencies";
import { createStoreOnlyZip, type ZipEntryInput } from "./zip";

export const TEACHER_RESEARCH_EXPORT_VERSION = "teacher-research-export-v1" as const;

type ResearchExportEntry = ZipEntryInput & {
  row_count: number;
};

type BuildTeacherResearchBulkExportInput = {
  session_public_id?: string;
  generated_by_role?: string;
  include_restricted_item_keys?: boolean;
};

type Row = Record<string, unknown>;

function iso(value?: Date | null) {
  return value ? value.toISOString() : null;
}

function stringValue(value: unknown) {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function spreadsheetSafe(value: string) {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

function csvEscape(value: unknown) {
  const text = spreadsheetSafe(stringValue(value));
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function csv(columns: string[], rows: Row[]) {
  return `${[
    columns.join(","),
    ...rows.map((row) => columns.map((column) => csvEscape(row[column])).join(","))
  ].join("\n")}\n`;
}

function jsonl(rows: unknown[]) {
  return `${rows.map((row) => JSON.stringify(row)).join("\n")}${rows.length > 0 ? "\n" : ""}`;
}

function countBy<T extends string>(values: T[]) {
  const counts: Record<string, number> = {};
  for (const value of values) {
    counts[value] = (counts[value] ?? 0) + 1;
  }
  return counts;
}

function safeJson(value: unknown, options: { includeRestrictedItemKeys: boolean } = { includeRestrictedItemKeys: false }): unknown {
  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === "string") {
    if (options.includeRestrictedItemKeys) {
      return value;
    }

    return value
      .replace(/answer[_ -]?keys?/gi, "restricted item keys")
      .replace(/correct[_ -]?options?/gi, "restricted item keys")
      .replace(/distractor[_ -]?rationales?/gi, "restricted item metadata")
      .replace(/possible[_ -]?misconception[_ -]?indicators?/gi, "restricted diagnostic metadata")
      .replace(/expected[_ -]?reasoning[_ -]?patterns?/gi, "restricted item metadata");
  }

  if (Array.isArray(value)) {
    return value.map((entry) => safeJson(entry, options));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    const normalized = key.toLowerCase();
    const isSecret =
      normalized.includes("password") ||
      normalized.includes("access_code") ||
      normalized.includes("authorization") ||
      normalized.includes("cookie") ||
      normalized.includes("token") ||
      normalized.includes("secret") ||
      normalized.includes("api_key") ||
      normalized.includes("database_url") ||
      normalized.includes("header");
    const isInternalId =
      key === "id" ||
      key === "agent_call_id" ||
      key.endsWith("_db_id") ||
      key.endsWith("_db_ids");
    const isRawProvider =
      normalized === "raw_output" ||
      normalized.includes("raw_provider") ||
      normalized.includes("provider_request") ||
      normalized.includes("provider_response_body");
    const isInternalPromptState =
      normalized === "prompt_state_packet" ||
      normalized === "allowed_behavior" ||
      normalized === "disallowed_behavior" ||
      normalized === "system_prompt";
    const isRestrictedItemMetadata =
      !options.includeRestrictedItemKeys &&
      (normalized.includes("correct_option") ||
        normalized.includes("answer_key") ||
        normalized.includes("distractor_rationale") ||
        normalized.includes("possible_misconception_indicator") ||
        normalized.includes("expected_reasoning_pattern"));
    const isRawMisconceptionId =
      normalized.includes("misconception_id") ||
      normalized.includes("misconception_ids");

    if (
      isSecret ||
      isInternalId ||
      isRawProvider ||
      isInternalPromptState ||
      isRestrictedItemMetadata ||
      isRawMisconceptionId
    ) {
      continue;
    }

    output[key] = safeJson(entry, options);
  }

  return output;
}

function responsePackageSummary(payload: unknown) {
  const record = asRecord(payload);
  const itemResponses = asArray(record.item_responses).map(asRecord);
  const includedItems = asArray(record.included_items).map(asRecord);
  const processCounts = asRecord(record.process_counts);

  return {
    item_response_count: itemResponses.length,
    included_item_count: includedItems.length,
    item_public_ids: itemResponses
      .map((response) => response.item_public_id)
      .filter((value): value is string => typeof value === "string"),
    answer_choice_count: itemResponses.filter((response) =>
      typeof response.selected_answer_final === "string" || typeof response.selected_option === "string"
    ).length,
    reasoning_count: itemResponses.filter((response) =>
      typeof response.reasoning_text_final === "string" || typeof response.reasoning_text === "string"
    ).length,
    confidence_count: itemResponses.filter((response) =>
      typeof response.confidence_final === "string" || typeof response.confidence_rating === "string"
    ).length,
    tempting_option_evidence_count: itemResponses.filter((response) =>
      response.no_tempting_option === true || typeof response.tempting_option === "string"
    ).length,
    timing_field_counts: {
      item_started_at: itemResponses.filter((response) => typeof response.item_started_at === "string").length,
      item_completed_at: itemResponses.filter((response) => typeof response.item_completed_at === "string").length,
      reasoning_submitted_at: itemResponses.filter((response) =>
        typeof response.reasoning_submitted_at === "string"
      ).length
    },
    process_counts: safeJson(processCounts)
  };
}

function dataDictionary() {
  return {
    export_version: TEACHER_RESEARCH_EXPORT_VERSION,
    files: {
      "manifest.json": "Machine-readable export manifest with generated time, export version, redaction policy, included sources, row counts, and limitations.",
      "README_EXPORT.md": "Human-readable export boundary, safety, and interpretation notes.",
      "data_dictionary.json": "Machine-readable file, field, timing, process-feature, and interpretation-boundary definitions.",
      "students.csv": "Student accounts represented by public classroom/research user_id values.",
      "sessions.csv": "Assessment-session public identifiers, student linkage, assessment linkage, phase/status, and timestamps.",
      "item_responses.csv": "Student item responses without answer keys, correct options, or correctness labels.",
      "conversation_turns_readable.jsonl": "Conversation-only teacher/research transcript projections with no structured payload.",
      "conversation_turns_structured_redacted.jsonl": "Structured conversation metadata after public-ID and protected-field redaction.",
      "turn_response_latencies.csv": "Prompt-to-next-student-response/action latency rows. These are wall-clock latencies and may include reading, thinking, or idle time.",
      "turn_response_latencies.jsonl": "JSONL mirror of prompt-to-response/action latency rows with per-row limitations.",
      "engagement_process_features.csv": "Derived process-feature rows for teacher/research review. These are evidence-quality and process-context indicators only, not ability, misconduct, cheating, or GenAI-use indicators.",
      "engagement_process_features.jsonl": "JSONL mirror of derived engagement process features. Raw process payloads, browser URLs, clipboard text, typed text, and secrets are excluded.",
      "response_packages.jsonl": "Package-level evidence summaries. Raw response-package JSON and item keys are not exported by default.",
      "process_events_summary.jsonl": "Session-level process-event counts and timing availability. Raw process payloads are excluded.",
      "process_events_redacted.jsonl": "Redacted process-event timeline without payloads, browser URLs, clipboard text, raw keystrokes, or secrets.",
      "process_event_counts.csv": "One row per session and event type.",
      "engagement_evidence_packets.jsonl": "Teacher/research engagement evidence summaries only; process data are contextual evidence.",
      "misconception_diagnosis_or_profile_packets.jsonl": "Profile and diagnostic summaries with raw misconception IDs removed.",
      "formative_purpose_or_value_packets.jsonl": "Persisted formative-purpose/value records and safe mapping summaries.",
      "activity_runtime_attempts.jsonl": "Activity runtime attempt summaries without raw source packet payloads.",
      "activity_misconception_evidence_records.jsonl": "Post-activity evidence record summaries without raw evidence packets.",
      "post_activity_diagnostic_snapshots.jsonl": "Post-activity diagnostic snapshot summaries without raw snapshot payloads.",
      "agent_calls_summary.jsonl": "Agent call audit summaries without raw input/output payloads.",
      "session_data_completeness.jsonl": "Per-session teacher/research data completeness audit summaries.",
      "limitations.jsonl": "Per-session and export-level limitations."
    },
    response_time_definitions: {
      item_response_time_ms:
        "Elapsed wall-clock time from item presentation to item response submission/completion. Includes answer selection, reasoning, confidence, tempting-option response, and idle time. This is not equivalent to prompt-to-response latency.",
      turn_response_latency_ms:
        "Elapsed wall-clock time from an agent/system prompt being shown to the first subsequent student response turn or recorded student action in the same safe session context. This may include reading, thinking, or idle time and is unavailable when no next event exists.",
      prompt_to_next_student_turn_latency_ms:
        "Prompt-to-next-student conversation turn latency when no safe process action timestamp is available.",
      prompt_to_next_student_action_latency_ms:
        "Prompt-to-next-student process action latency when a safe process event is available.",
      item_prompt_to_first_action_latency_ms:
        "Latency from an item-scoped prompt to the first item-scoped student action.",
      reasoning_prompt_to_reasoning_response_latency_ms:
        "Latency from a reasoning prompt to the next reasoning response/action when inferable from safe prompt and event labels.",
      confidence_prompt_to_confidence_action_latency_ms:
        "Latency from a confidence prompt to the next confidence action when inferable from safe prompt and event labels.",
      tempting_option_prompt_to_response_latency_ms:
        "Latency from a tempting-option prompt to the next tempting-option response/action when inferable from safe prompt and event labels.",
      activity_prompt_to_activity_response_latency_ms:
        "Latency from an activity prompt to the next activity response/action when inferable from safe prompt and event labels.",
      package_wall_clock_duration_ms:
        "Elapsed wall-clock time from first item presentation in the package to package completion/submission.",
      package_active_response_duration_ms:
        "Elapsed time from first recorded student response action in the package to package completion/submission.",
      focus_adjusted_duration_ms:
        "Wall-clock time minus safely detected hidden/blur/pause/inactivity intervals when available. If unavailable, marked unavailable.",
      reasoning_input_elapsed_time_ms:
        "Elapsed time from first recorded input/key event in a reasoning field to reasoning summary flush, field submission, or item completion. This is not pure active typing time.",
      active_typing_time_ms:
        "Only available if explicitly instrumented. If not instrumented, marked unavailable; elapsed time is not used as a proxy."
    },
    engagement_process_feature_definitions: {
      time_to_first_action_ms: "Item prompt or presentation to first safe student action.",
      first_action_to_submission_ms: "First safe student action to item completion/submission.",
      last_action_to_submission_ms: "Last substantive safe student action to item completion/submission.",
      prompt_to_final_submission_ms: "Item prompt or presentation to final item submission/completion.",
      active_interaction_time_ms: "Active interaction intervals only when explicitly instrumented. Null when unavailable; elapsed timing is not used as a proxy.",
      idle_time_ms: "Sum of safe pause-duration fields where available.",
      idle_ratio: "idle_time_ms divided by prompt_to_final_submission_ms when both are available.",
      focus_adjusted_time_ms: "Wall-clock item time minus observed pause/hidden durations when safe durations are available.",
      confidence_selection_latency_ms: "Item prompt or presentation to confidence selection when inferable.",
      reasoning_input_elapsed_time_ms: "Safe aggregate input elapsed timing from typing summary events. It is not active typing time and stores no typed text.",
      pre_submit_pause_ms: "Last substantive safe student action to item completion/submission.",
      activity_prompt_to_first_action_ms: "Formative/activity prompt to first safe student activity action when activity events exist.",
      activity_response_elapsed_ms: "Activity prompt to last safe substantive activity response when activity events exist.",
      activity_move_on_latency_ms: "Activity prompt to move-on request when available.",
      choose_another_activity_latency_ms: "Activity prompt to choose-another-activity request when available.",
      student_action_count: "Count of safe student action events in scope.",
      substantive_action_count: "Count of safe substantive action events in scope.",
      action_density_per_minute: "Substantive actions per minute over the prompt-to-submission interval.",
      option_revision_count: "Count of answer/option revision events in scope.",
      option_changed_after_reasoning: "Whether an option revision occurred after a reasoning event when inferable.",
      reasoning_revision_count: "Count of reasoning revision/edit events plus safe item revision count context.",
      confidence_revision_count: "Count of confidence revision events.",
      copy_paste_event_count: "Count of paste-detected events. Pasted content is never exported.",
      typed_vs_paste_indicator: "Coarse presence indicator for typing summaries and paste events; it is not misconduct evidence."
    },
    correctness_inflation_definitions: {
      unsupported_correct_response:
        "Internal/research flag for target-aligned answer selection that is not sufficiently supported by reasoning, confidence, or conceptual-boundary evidence. Not student-facing.",
      correctness_support_level:
        "Internal/research support level for target-aligned answer selection. This is evidence-quality context, not a student-facing label.",
      estimated_guessing_risk:
        "Internal/research uncertainty-risk band derived from weak reasoning, low confidence, uncertainty language, and sparse process context. It is not a misconduct label and is not shown to students.",
      estimated_guessing_risk_basis:
        "Safe basis categories for the internal/research estimated guessing-risk band.",
      answer_selection_evidence_weight:
        "Internal/research weighting for answer selection as evidence of understanding.",
      uncertainty_marker_present:
        "Whether safe uncertainty-language markers were detected in reasoning text summaries.",
      uncertainty_marker_types:
        "Safe categories of uncertainty language; raw reasoning is not included."
    },
    column_definitions: {
      user_id: "Safe classroom/research student identifier. Internal database UUIDs are not exported.",
      display_name: "Teacher-visible display name when available.",
      active: "Whether the student account is currently active.",
      represented_session_count: "Number of exported sessions represented for the student.",
      session_public_id: "Public assessment-session identifier used as the primary join key across session-level export files.",
      student_user_id: "Safe classroom/research student identifier joining sessions to students.user_id.",
      student_display_label: "Display label for teacher/research review.",
      assessment_label: "Readable assessment label in transcript projections.",
      assessment_public_id: "Public assessment identifier.",
      assessment_title: "Assessment title.",
      attempt_number: "Assessment attempt number.",
      status: "Current session status.",
      current_phase: "Current assessment-session phase.",
      current_concept_unit_public_id: "Public concept-unit identifier for the current concept unit when available.",
      started_at: "Start timestamp for a session, activity attempt, or agent call depending on file context.",
      last_activity_at: "Most recent session activity timestamp.",
      completed_at: "Session completion timestamp when available.",
      concept_unit_public_id: "Public concept-unit identifier.",
      concept_unit_title: "Teacher/research concept-unit title.",
      item_public_id: "Public item identifier. This is not an answer key.",
      item_order: "Item order within the concept unit.",
      selected_option: "Student-selected option label. It is not a correctness label.",
      reasoning_text: "Student-provided reasoning text. It is exported for teacher/research analysis and must not include answer keys.",
      confidence_rating: "Student confidence rating.",
      skipped_item: "Whether the item was explicitly skipped.",
      skipped_reasoning: "Whether reasoning evidence was skipped.",
      skipped_confidence: "Whether confidence evidence was skipped.",
      revision_count: "Count of response revisions recorded for the item.",
      missing_evidence_repair_offered: "Whether the system offered a missing-evidence repair path.",
      item_response_time_ms:
        "Elapsed wall-clock time for the item response package. This is not the same as prompt-to-response/action latency.",
      item_started_at: "Item start timestamp.",
      item_submitted_at: "Item submission/completion timestamp.",
      item_version_snapshot: "Administered item version number only; answer keys and raw item metadata are excluded.",
      turn_index: "Conversation turn index within a session.",
      speaker: "Readable transcript speaker label.",
      timestamp: "Readable transcript turn timestamp.",
      phase_label: "Human-readable phase label.",
      safe_context_label: "Safe public context label for concept, item, or activity round.",
      message_text: "Student- or tutor-visible message text after safety redaction.",
      has_structured_payload_available_elsewhere: "Whether a structured payload exists in the separate redacted structured transcript.",
      next_student_response_latency_ms: "Readable transcript next-student-response/action latency in milliseconds when available.",
      next_student_response_latency_seconds: "Readable transcript next-student-response/action latency in seconds when available.",
      next_student_response_latency_source: "Source used for readable transcript latency.",
      actor_type: "Raw conversation actor type after export-safe projection.",
      agent_name: "Agent name for agent/orchestrator turns or agent-call summaries.",
      phase: "Stored conversation phase.",
      created_at: "Record creation timestamp.",
      structured_payload_redacted: "Structured conversation payload after internal ID, secret, prompt, and restricted metadata redaction.",
      prompt_turn_index: "Prompt turn index used for latency calculation.",
      prompt_actor: "Actor type for the prompt turn.",
      prompt_phase: "Phase for the prompt turn.",
      prompt_type: "Safe prompt type inferred from structured labels or text context.",
      prompt_shown_at: "Timestamp when the prompt was shown.",
      next_student_turn_index: "Next student conversation turn index when available.",
      next_student_event_type: "Next safe student process event or conversation-turn marker.",
      next_student_response_at: "Timestamp for the next student response/action when available.",
      response_latency_ms: "Prompt-to-next-student-response/action latency in milliseconds when available.",
      response_latency_seconds: "Prompt-to-next-student-response/action latency in seconds when available.",
      latency_source: "Whether latency came from conversation turns, process events, mixed sources, or is unavailable.",
      latency_scope: "Safe scope for the latency row, such as item, reasoning, confidence, tempting_option, activity, or general_dialogue.",
      student_response_text_present: "Whether the next student turn had non-empty text. The raw text is not duplicated in the latency row.",
      structured_payload_available_elsewhere: "Whether structured payload is available in a separate redacted export file.",
      limitations: "Safe limitation labels for the row or session.",
      feature_scope: "Scope for an engagement process-feature row: initial_item, activity, or session.",
      time_to_first_action_ms: "Item prompt/presentation to first safe student action.",
      first_action_to_submission_ms: "First safe student action to item completion/submission.",
      last_action_to_submission_ms: "Last substantive safe student action to item completion/submission.",
      prompt_to_final_submission_ms: "Item prompt/presentation to final item completion/submission.",
      active_interaction_time_ms: "Active interaction time only when explicitly instrumented. Null means unavailable.",
      idle_time_ms: "Safe aggregate pause/idle duration where available.",
      idle_ratio: "idle_time_ms divided by prompt_to_final_submission_ms when both are available.",
      focus_adjusted_time_ms: "Prompt-to-submission time minus safe hidden/blur/pause intervals when available.",
      confidence_selection_latency_ms: "Prompt/presentation to confidence selection when inferable.",
      reasoning_input_elapsed_time_ms:
        "Elapsed input-field timing from safe typing summaries. This can include idle time and is not active typing time.",
      active_typing_time_ms: "True active typing time. Null unless explicitly instrumented; elapsed timing is not used as a proxy.",
      pre_submit_pause_ms: "Last substantive action to item completion/submission.",
      activity_prompt_to_first_action_ms: "Activity prompt to first safe student activity action when activity events exist.",
      activity_response_elapsed_ms: "Activity prompt to last safe substantive activity response when activity events exist.",
      activity_move_on_latency_ms: "Activity prompt to move-on request when available.",
      choose_another_activity_latency_ms: "Activity prompt to choose-another-activity request when available.",
      student_action_count: "Count of safe student actions in scope.",
      substantive_action_count: "Count of safe substantive student actions in scope.",
      action_density_per_minute: "Substantive actions per minute over the prompt-to-submission interval.",
      option_revision_count: "Count of option/answer revision events.",
      option_changed_after_reasoning: "Whether an option revision occurred after reasoning evidence when inferable.",
      reasoning_revision_count: "Count of reasoning revision/edit events plus safe revision context.",
      confidence_revision_count: "Count of confidence revision events.",
      copy_paste_event_count: "Count of paste-detected events. Pasted content is never exported.",
      typed_vs_paste_indicator: "Coarse typing/paste presence indicator; not a misconduct label.",
      package_type: "Response package type.",
      package_sequence: "Sequence number for response packages within a concept unit.",
      payload_summary: "Response-package evidence summary with raw item keys and restricted metadata removed.",
      event_count: "Count of process events in a session summary row or count for an event type in a count row.",
      event_type_counts: "Safe event-type count map.",
      first_event_at: "First process-event timestamp in a session.",
      last_event_at: "Last process-event timestamp in a session.",
      event_type: "Safe process event type.",
      event_category: "Safe process event category.",
      event_source: "Safe process event source.",
      occurred_at: "Process-event occurrence timestamp.",
      safe_scope: "Safe process event scope label.",
      engagement_evidence_summary: "Teacher/research engagement evidence summary. Process data are evidence-quality context only.",
      correctness_inflation_summary: "Internal/research evidence-quality aggregate for correctness-inflation safeguards.",
      profile_type: "Profile record type.",
      diagnostic_profile: "Teacher/research diagnostic profile category.",
      profile_confidence: "Profile confidence category.",
      evidence_sufficiency: "Evidence sufficiency category.",
      confidence_alignment: "Confidence alignment category.",
      independence_interpretability: "Independent-understanding interpretability category.",
      misconception_indicator_count: "Count of safe misconception-indicator summary entries; raw IDs are excluded.",
      item_level_evidence_available: "Whether item-level evidence summary is available.",
      process_caution_count: "Count of process interpretation cautions.",
      formative_value: "Teacher/research formative-purpose/value category.",
      mapping_followed: "Whether backend mapping was followed after canonicalization.",
      mapping_deviation_recorded: "Whether a mapping-deviation reason was recorded.",
      target_evidence_summary: "Redacted target evidence summary.",
      success_criteria_summary: "Redacted success criteria summary.",
      activity_attempt_public_id: "Public activity runtime attempt identifier.",
      activity_attempt_id: "Compatibility activity-attempt reference. It should match a public activity attempt identifier, not a database UUID.",
      student_public_id: "Safe student public identifier used by activity runtime records.",
      concept_unit_id: "Safe concept-unit identifier used by activity runtime records.",
      activity_family: "Formative activity family.",
      diagnostic_purpose: "Distractor-informed diagnostic purpose.",
      generation_source: "Activity generation source such as live_llm.",
      latest_evidence_record_public_id: "Public latest post-activity evidence record reference.",
      latest_snapshot_public_id: "Public latest post-activity diagnostic snapshot reference.",
      evidence_public_id: "Public post-activity evidence record identifier.",
      schema_version: "Output or packet schema version.",
      artifact_version: "Version of the generated review/audit artifact.",
      artifact_path: "Local ignored artifact path when a review command writes an artifact; null in ZIP exports when not written.",
      generated_at: "Artifact or export generation timestamp.",
      no_live_provider_call_made: "Whether the artifact was produced without a live provider call.",
      interpretation_boundary: "Human-readable interpretation boundary for teacher/research use.",
      data_completeness: "Nested session data-completeness summary.",
      process_data_summary: "Nested process-data availability and count summary.",
      response_evidence_summary: "Nested response-evidence availability summary.",
      activity_runtime_summary: "Nested activity-runtime availability summary.",
      misconception_evidence_summary: "Nested post-activity misconception-evidence summary.",
      diagnostic_snapshot_summary: "Nested post-activity diagnostic snapshot summary.",
      agent_audit_summary: "Nested agent-call audit summary.",
      evaluation_source: "Source of post-activity evidence evaluation.",
      review_only: "Whether the record is review-only.",
      runtime_servable_to_student: "Whether the record is safe for runtime student use where applicable.",
      production_mode: "Production or review mode label.",
      student_response_kind: "Safe category for the student activity response.",
      misconception_update_status: "Internal post-activity misconception evidence update status.",
      evidence_quality: "Evidence quality category.",
      recommended_next_diagnostic_purpose: "Recommended next diagnostic purpose from the evidence packet.",
      student_safe_feedback: "Validated student-safe feedback projection.",
      safety_flags: "Safe validation flag labels.",
      snapshot_public_id: "Public diagnostic snapshot identifier.",
      pre_activity_diagnostic_state: "Pre-activity diagnostic state when available.",
      activity_update_status: "Post-activity update status.",
      post_activity_diagnostic_state: "Post-activity diagnostic state.",
      update_strength: "Strength of the post-activity update.",
      next_diagnostic_purpose: "Next diagnostic purpose after the snapshot.",
      agent_version: "Agent implementation version label.",
      provider: "Provider name used for the agent call.",
      model_name: "Configured model name used for the agent call.",
      prompt_version: "Prompt version label.",
      prompt_hash: "Prompt hash.",
      call_status: "Agent call status.",
      output_validated: "Whether structured output validated.",
      validation_error_present: "Whether a safe validation error exists.",
      blocked_reason: "Sanitized blocked reason when the call was blocked.",
      retry_count: "Agent retry count.",
      live_call_allowed: "Whether a live provider call was allowed by server-side gates.",
      latency_ms: "Agent-call latency in milliseconds.",
      input_tokens: "Provider input token count when available.",
      output_tokens: "Provider output token count when available.",
      total_tokens: "Provider total token count when available.",
      estimated_cost: "Estimated provider cost when available. It is not an exact invoice.",
      limitation: "Safe limitation label."
    },
    process_event_definitions: {
      page_switch_count: "Count of page visibility hidden/visible events; contextual evidence only.",
      long_pause_count: "Count of long pause events; contextual evidence only.",
      inactivity_count: "Count of inactivity-detected events; contextual evidence only.",
      navigation_event_count: "Count of navigation events recorded by frontend instrumentation.",
      invalid_help_request_count: "Count of help requests disallowed during protected administration.",
      prompt_injection_attempt_count: "Count of detected prompt-injection attempts.",
      procedural_clarification_count: "Count of procedural clarification requests.",
      emotional_response_count: "Count of emotional or frustration responses.",
      reasoning_revision_count: "Count of reasoning revision events.",
      option_revision_count: "Count of option revision events.",
      validation_failure_count: "Count of schema or validation failure events.",
      agent_retry_count: "Count of recorded agent retry scheduling events.",
      response_collection_agent_call_count: "Count of response-collection agent invocation events.",
      response_collection_fallback_count: "Count of response-collection fallback events.",
      response_collection_reasoning_extraction_count: "Count of successful reasoning extraction events.",
      response_collection_reasoning_extraction_failure_count: "Count of reasoning extraction failure events.",
      followup_turn_count: "Count of follow-up or activity dialogue turns where available."
    },
    interpretation_limits: [
      "Process data are evidence-quality context only and do not establish misconduct.",
      "Default export omits answer keys, correct options, raw distractor metadata, raw misconception IDs, provider raw outputs, and secrets.",
      "Timing metrics may include idle time unless a field is explicitly marked focus-adjusted or active typing.",
      "Estimated guessing risk is an internal evidence-quality estimate, not a student-facing label and not a misconduct label.",
      "Correctness alone is not evidence of understanding; answer selection must be interpreted with reasoning, confidence, distractor-boundary evidence, and process context."
    ]
  };
}

function readme() {
  return [
    "# Teacher/research export",
    "",
    "This ZIP is a local teacher/research export from the normalized assessment database.",
    "",
    "The default export is research-safe: it omits API keys, headers, secrets, raw provider input/output, raw process payloads, answer keys, correct options, raw distractor metadata, and raw misconception IDs.",
    "",
    "Process data are contextual evidence for engagement and evidence sufficiency. They must not be interpreted as cheating, GenAI use, or misconduct evidence.",
    "",
    "If restricted item-key files are present, they were explicitly requested and are marked in manifest.json.",
    "",
    "Item response time and prompt-to-response latency are different. Item response time summarizes a full item interval; prompt-to-response latency measures the next recorded student response or action after a specific prompt.",
    ""
  ].join("\n");
}

function makeEntry(path: string, data: string, rowCount: number): ResearchExportEntry {
  return { path, data, row_count: rowCount };
}

function assertResearchExportSafety(entries: ResearchExportEntry[], includeRestrictedItemKeys: boolean) {
  const secretPatterns = [
    /sk-[A-Za-z0-9_-]{20,}/,
    /authorization\s*:/i,
    /bearer\s+[A-Za-z0-9._-]{10,}/i,
    /database_url/i,
    /session_secret/i
  ];
  const protectedDataPatterns = [
    /\bcorrect_option\b/i,
    /\bcorrect_option_snapshot\b/i,
    /\banswer_key\b/i,
    /\bdistractor_rationales\b/i,
    /\bpossible_misconception_indicators\b/i,
    /\bexpected_reasoning_patterns\b/i,
    /\braw_output\b/i,
    /\binput_payload\b/i,
    /\boutput_payload\b/i,
    /\bmisconception_ids?\b/i
  ];
  const documentationFiles = new Set(["manifest.json", "README_EXPORT.md", "data_dictionary.json"]);
  const restrictedFiles = new Set(["restricted_item_keys.csv", "restricted_item_metadata_manifest.json"]);

  for (const entry of entries) {
    const data = Buffer.isBuffer(entry.data) ? entry.data.toString("utf8") : entry.data;
    for (const pattern of secretPatterns) {
      if (pattern.test(data)) {
        throw new Error(`Research export safety scan blocked ${entry.path}.`);
      }
    }

    if (
      documentationFiles.has(entry.path) ||
      (includeRestrictedItemKeys && restrictedFiles.has(entry.path))
    ) {
      continue;
    }

    for (const pattern of protectedDataPatterns) {
      if (pattern.test(data)) {
        throw new Error(`Research export safety scan blocked protected data in ${entry.path}.`);
      }
    }
  }
}

function fileRowCounts(entries: ResearchExportEntry[]) {
  return Object.fromEntries(entries.map((entry) => [entry.path, entry.row_count]));
}

function safeTranscriptRows(transcripts: TeacherReadableTranscriptProjection[]) {
  return transcripts.flatMap((transcript) =>
    transcript.turns.map((turn) => ({
      session_public_id: transcript.session_public_id,
      student_display_label: transcript.student_display_label,
      assessment_label: transcript.assessment_label,
      ...turn
    }))
  );
}

export async function buildTeacherResearchBulkExport(input: BuildTeacherResearchBulkExportInput = {}) {
  const includeRestrictedItemKeys = input.include_restricted_item_keys === true;
  const generatedAt = new Date().toISOString();
  const where = input.session_public_id ? { session_public_id: input.session_public_id } : {};

  const sessions = await prisma.assessmentSession.findMany({
    where,
    orderBy: [{ created_at: "asc" }],
    include: {
      user: { select: { user_id: true, display_name: true, role: true, account_status: true } },
      assessment: { select: { assessment_public_id: true, title: true } },
      current_concept_unit: { select: { concept_unit_public_id: true, title: true } },
      concept_unit_sessions: {
        orderBy: [{ created_at: "asc" }],
        include: {
          concept_unit: { select: { concept_unit_public_id: true, title: true, order_index: true } },
          item_responses: {
            orderBy: [{ item: { item_order: "asc" } }],
            include: {
              item: {
                select: {
                  item_public_id: true,
                  item_order: true,
                  item_stem: true,
                  options: true,
                  correct_option: true
                }
              }
            }
          },
          response_packages: { orderBy: [{ created_at: "asc" }] },
          student_profiles: { orderBy: [{ created_at: "asc" }] },
          formative_decisions: { orderBy: [{ created_at: "asc" }] }
        }
      },
      conversation_turns: {
        orderBy: [{ sequence_index: "asc" }],
        include: {
          item: { select: { item_public_id: true, item_order: true } },
          concept_unit_session: {
            select: {
              concept_unit: { select: { concept_unit_public_id: true, title: true } }
            }
          }
        }
      },
      process_events: {
        orderBy: [{ occurred_at: "asc" }],
        include: {
          item: { select: { item_public_id: true, item_order: true } },
          concept_unit_session: {
            select: {
              concept_unit: { select: { concept_unit_public_id: true, title: true } }
            }
          }
        }
      },
      agent_calls: { orderBy: [{ created_at: "asc" }] }
    }
  });

  const sessionPublicIds = sessions.map((session) => session.session_public_id);
  const [activityAttempts, evidenceRecords, diagnosticSnapshots] = await Promise.all([
    prisma.activityRuntimeAttempt.findMany({
      where: { session_public_id: { in: sessionPublicIds } },
      orderBy: [{ created_at: "asc" }]
    }),
    prisma.activityMisconceptionEvidenceRecord.findMany({
      where: { session_public_id: { in: sessionPublicIds } },
      orderBy: [{ created_at: "asc" }]
    }),
    prisma.postActivityDiagnosticSnapshot.findMany({
      where: { session_public_id: { in: sessionPublicIds } },
      orderBy: [{ created_at: "asc" }],
      include: {
        evidence_record: {
          select: { evidence_public_id: true }
        }
      }
    })
  ]);

  const [readableTranscripts, audits] = await Promise.all([
    Promise.all(sessionPublicIds.map((sessionPublicId) => getTeacherReadableTranscript(sessionPublicId))),
    Promise.all(
      sessionPublicIds.map((sessionPublicId) =>
        buildTeacherSessionDataAudit({
          session_public_id: sessionPublicId,
          write_artifact: false
        }).catch((error) => ({
          session_public_id: sessionPublicId,
          audit_unavailable: true,
          limitation: error instanceof Error ? error.message : "audit_unavailable"
        }))
      )
    )
  ]);

  const students = new Map<string, Row>();
  for (const session of sessions) {
    students.set(session.user.user_id, {
      user_id: session.user.user_id,
      display_name: session.user.display_name ?? "",
      active: session.user.account_status === "active",
      represented_session_count:
        (Number(students.get(session.user.user_id)?.represented_session_count ?? 0) || 0) + 1
    });
  }

  const sessionRows = sessions.map((session) => ({
    session_public_id: session.session_public_id,
    student_user_id: session.user.user_id,
    student_display_label: session.user.display_name ?? session.user.user_id,
    assessment_public_id: session.assessment.assessment_public_id,
    assessment_title: session.assessment.title,
    attempt_number: session.attempt_number,
    status: session.status,
    current_phase: session.current_phase,
    current_concept_unit_public_id: session.current_concept_unit?.concept_unit_public_id ?? "",
    started_at: iso(session.started_at),
    last_activity_at: iso(session.last_activity_at),
    completed_at: iso(session.completed_at)
  }));

  const itemResponseRows = sessions.flatMap((session) =>
    session.concept_unit_sessions.flatMap((conceptUnitSession) =>
      conceptUnitSession.item_responses.map((response) => ({
        session_public_id: session.session_public_id,
        student_user_id: session.user.user_id,
        assessment_public_id: session.assessment.assessment_public_id,
        concept_unit_public_id: conceptUnitSession.concept_unit.concept_unit_public_id,
        concept_unit_title: conceptUnitSession.concept_unit.title,
        item_public_id: response.item.item_public_id,
        item_order: response.item.item_order,
        selected_option: response.selected_option ?? "",
        reasoning_text: response.reasoning_text ?? "",
        confidence_rating: response.confidence_rating ?? "",
        skipped_item: response.skipped_item,
        skipped_reasoning: response.skipped_reasoning,
        skipped_confidence: response.skipped_confidence,
        revision_count: response.revision_count,
        missing_evidence_repair_offered: response.missing_evidence_repair_offered,
        item_response_time_ms: response.item_response_time_ms ?? "",
        item_started_at: iso(response.item_started_at),
        item_submitted_at: iso(response.item_submitted_at),
        item_version_snapshot: response.item_version_snapshot
      }))
    )
  );

  const structuredTurnRows = sessions.flatMap((session) =>
    session.conversation_turns.map((turn, index) => ({
      session_public_id: session.session_public_id,
      turn_index: index + 1,
      actor_type: turn.actor_type,
      agent_name: turn.agent_name,
      phase: turn.phase,
      message_text: turn.message_text ?? "",
      created_at: iso(turn.created_at),
      concept_unit_public_id: turn.concept_unit_session?.concept_unit.concept_unit_public_id ?? null,
      item_public_id: turn.item?.item_public_id ?? null,
      item_order: turn.item?.item_order ?? null,
      structured_payload_redacted: safeJson(stripInternalKeys(turn.structured_payload))
    }))
  );
  const turnResponseLatencyRows = sessions.flatMap((session) =>
    buildTurnResponseLatencyRows({
      turns: session.conversation_turns.map((turn, index) => ({
        session_public_id: session.session_public_id,
        student_user_id: session.user.user_id,
        assessment_public_id: session.assessment.assessment_public_id,
        turn_index: index + 1,
        actor_type: turn.actor_type,
        phase: turn.phase,
        agent_name: turn.agent_name,
        message_text: turn.message_text,
        structured_payload: turn.structured_payload,
        created_at: turn.created_at,
        concept_unit_public_id:
          turn.concept_unit_session?.concept_unit.concept_unit_public_id ?? null,
        item_public_id: turn.item?.item_public_id ?? null,
        item_order: turn.item?.item_order ?? null
      })),
      processEvents: session.process_events.map((event) => ({
        session_public_id: session.session_public_id,
        concept_unit_public_id:
          event.concept_unit_session?.concept_unit.concept_unit_public_id ?? null,
        item_public_id: event.item?.item_public_id ?? null,
        item_order: event.item?.item_order ?? null,
        event_type: event.event_type,
        event_category: event.event_category,
        event_source: event.event_source,
        occurred_at: event.occurred_at,
        created_at: event.created_at
      }))
    })
  );
  const engagementProcessFeatureRows = sessions.flatMap((session) => {
    const itemResponses = session.concept_unit_sessions.flatMap((conceptUnitSession) =>
      conceptUnitSession.item_responses.map((response) => ({
        session_public_id: session.session_public_id,
        student_user_id: session.user.user_id,
        assessment_public_id: session.assessment.assessment_public_id,
        concept_unit_public_id: conceptUnitSession.concept_unit.concept_unit_public_id,
        item_public_id: response.item.item_public_id,
        item_order: response.item.item_order,
        item_started_at: response.item_started_at,
        item_submitted_at: response.item_submitted_at,
        item_response_time_ms: response.item_response_time_ms,
        revision_count: response.revision_count
      }))
    );

    return buildEngagementProcessFeatureRows({
      itemResponses,
      processEvents: session.process_events.map((event) => ({
        session_public_id: session.session_public_id,
        concept_unit_public_id:
          event.concept_unit_session?.concept_unit.concept_unit_public_id ?? null,
        item_public_id: event.item?.item_public_id ?? null,
        item_order: event.item?.item_order ?? null,
        event_type: event.event_type,
        event_category: event.event_category,
        event_source: event.event_source,
        visibility_duration_ms: event.visibility_duration_ms,
        pause_duration_ms: event.pause_duration_ms,
        payload: event.payload,
        occurred_at: event.occurred_at,
        created_at: event.created_at
      }))
    });
  });

  const responsePackageRows = sessions.flatMap((session) =>
    session.concept_unit_sessions.flatMap((conceptUnitSession) =>
      conceptUnitSession.response_packages.map((responsePackage, index) => ({
        session_public_id: session.session_public_id,
        concept_unit_public_id: conceptUnitSession.concept_unit.concept_unit_public_id,
        package_type: responsePackage.package_type,
        package_sequence: index + 1,
        created_at: iso(responsePackage.created_at),
        payload_summary: responsePackageSummary(responsePackage.payload)
      }))
    )
  );

  const processSummaryRows = sessions.map((session) => {
    const counts = countBy(session.process_events.map((event) => event.event_type));
    return {
      session_public_id: session.session_public_id,
      event_count: session.process_events.length,
      event_type_counts: counts,
      first_event_at: iso(session.process_events[0]?.occurred_at),
      last_event_at: iso(session.process_events.at(-1)?.occurred_at)
    };
  });
  const processCountRows = sessions.flatMap((session) =>
    Object.entries(countBy(session.process_events.map((event) => event.event_type))).map(([eventType, count]) => ({
      session_public_id: session.session_public_id,
      event_type: eventType,
      event_count: count
    }))
  );
  const processEventRedactedRows = sessions.flatMap((session) =>
    session.process_events.map((event) => ({
      session_public_id: session.session_public_id,
      concept_unit_public_id: event.concept_unit_session?.concept_unit.concept_unit_public_id ?? null,
      item_public_id: event.item?.item_public_id ?? null,
      item_order: event.item?.item_order ?? null,
      event_type: event.event_type,
      event_category: event.event_category,
      event_source: event.event_source,
      occurred_at: iso(event.occurred_at),
      created_at: iso(event.created_at),
      safe_scope: event.item ? "item" : event.concept_unit_session ? "concept_unit" : "session"
    }))
  );

  const profileRows = sessions.flatMap((session) =>
    session.concept_unit_sessions.flatMap((conceptUnitSession) =>
      conceptUnitSession.student_profiles.map((profile) => ({
        session_public_id: session.session_public_id,
        concept_unit_public_id: conceptUnitSession.concept_unit.concept_unit_public_id,
        created_at: iso(profile.created_at),
        profile_type: profile.profile_type,
        diagnostic_profile: profile.integrated_diagnostic_profile,
        profile_confidence: profile.profile_confidence,
        evidence_sufficiency: profile.evidence_sufficiency,
        confidence_alignment: profile.confidence_alignment,
        independence_interpretability: profile.independence_interpretability,
        misconception_indicator_count: asArray(profile.misconception_indicators).length,
        item_level_evidence_available: asArray(profile.item_level_evidence).length > 0,
        process_caution_count: asArray(profile.process_interpretation_cautions).length
      }))
    )
  );

  const formativeRows = sessions.flatMap((session) =>
    session.concept_unit_sessions.flatMap((conceptUnitSession) =>
      conceptUnitSession.formative_decisions.map((decision) => ({
        session_public_id: session.session_public_id,
        concept_unit_public_id: conceptUnitSession.concept_unit.concept_unit_public_id,
        created_at: iso(decision.created_at),
        formative_value: decision.formative_value,
        mapping_followed: decision.mapping_followed,
        mapping_deviation_recorded: Boolean(decision.mapping_deviation_reason),
        target_evidence_summary: safeJson(decision.target_evidence),
        success_criteria_summary: safeJson(decision.success_criteria)
      }))
    )
  );

  const activityRows = activityAttempts.map((attempt) => ({
    activity_attempt_public_id: attempt.activity_attempt_public_id,
    session_public_id: attempt.session_public_id,
    student_public_id: attempt.student_public_id,
    assessment_public_id: attempt.assessment_public_id,
    concept_unit_id: attempt.concept_unit_id,
    activity_family: attempt.activity_family,
    diagnostic_purpose: attempt.diagnostic_purpose,
    generation_source: attempt.generation_source,
    status: attempt.status,
    started_at: iso(attempt.started_at),
    completed_at: iso(attempt.completed_at),
    latest_evidence_record_public_id: attempt.latest_evidence_record_public_id,
    latest_snapshot_public_id: attempt.latest_snapshot_public_id,
    limitations: safeJson(attempt.limitations)
  }));

  const evidenceRows = evidenceRecords.map((record) => ({
    evidence_public_id: record.evidence_public_id,
    session_public_id: record.session_public_id,
    student_public_id: record.student_public_id,
    activity_attempt_id: record.activity_attempt_id,
    activity_attempt_public_id: record.activity_attempt_id,
    schema_version: record.schema_version,
    evaluation_source: record.evaluation_source,
    review_only: record.review_only,
    runtime_servable_to_student: record.runtime_servable_to_student,
    production_mode: record.production_mode,
    diagnostic_purpose: record.diagnostic_purpose,
    activity_family: record.activity_family,
    student_response_kind: record.student_response_kind,
    misconception_update_status: record.misconception_update_status,
    evidence_quality: record.evidence_quality,
    recommended_next_diagnostic_purpose: record.recommended_next_diagnostic_purpose,
    student_safe_feedback: safeJson(record.student_safe_feedback),
    safety_flags: safeJson(record.safety_flags),
    limitations: safeJson(record.limitations),
    created_at: iso(record.created_at)
  }));

  const snapshotRows = diagnosticSnapshots.map((snapshot) => ({
    snapshot_public_id: snapshot.snapshot_public_id,
    evidence_public_id: snapshot.evidence_record.evidence_public_id,
    session_public_id: snapshot.session_public_id,
    student_public_id: snapshot.student_public_id,
    activity_attempt_id: snapshot.activity_attempt_id,
    activity_attempt_public_id: snapshot.activity_attempt_id,
    pre_activity_diagnostic_state: snapshot.pre_activity_diagnostic_state,
    activity_update_status: snapshot.activity_update_status,
    post_activity_diagnostic_state: snapshot.post_activity_diagnostic_state,
    update_strength: snapshot.update_strength,
    evidence_quality: snapshot.evidence_quality,
    next_diagnostic_purpose: snapshot.next_diagnostic_purpose,
    student_safe_feedback: safeJson(snapshot.student_safe_feedback),
    limitations: safeJson(snapshot.limitations),
    created_at: iso(snapshot.created_at)
  }));

  const agentRows = sessions.flatMap((session) =>
    session.agent_calls.map((call) => ({
      session_public_id: session.session_public_id,
      agent_name: call.agent_name,
      agent_version: call.agent_version,
      provider: call.provider,
      model_name: call.model_name,
      prompt_version: call.prompt_version,
      schema_version: call.schema_version,
      prompt_hash: call.prompt_hash,
      call_status: call.call_status,
      output_validated: call.output_validated,
      validation_error_present: Boolean(call.validation_error),
      blocked_reason: call.blocked_reason,
      retry_count: call.retry_count,
      live_call_allowed: call.live_call_allowed,
      latency_ms: call.latency_ms,
      input_tokens: call.input_tokens,
      output_tokens: call.output_tokens,
      total_tokens: call.total_tokens,
      estimated_cost: call.estimated_cost ? String(call.estimated_cost) : null,
      started_at: iso(call.started_at),
      completed_at: iso(call.completed_at),
      created_at: iso(call.created_at)
    }))
  );

  const limitationRows = [
    ...readableTranscripts.flatMap((transcript) =>
      transcript.limitations.map((limitation) => ({
        session_public_id: transcript.session_public_id,
        limitation
      }))
    ),
    ...audits.flatMap((audit) =>
      asArray(asRecord(audit).limitations).map((limitation) => ({
        session_public_id: asRecord(audit).session_public_id,
        limitation
      }))
    ),
    ...(sessions.length === 0
      ? [{ session_public_id: null, limitation: "no_sessions_matched_export_filter" }]
      : [])
  ];

  const readableRows = safeTranscriptRows(readableTranscripts);
  const entries: ResearchExportEntry[] = [
    makeEntry("README_EXPORT.md", readme(), 0),
    makeEntry("data_dictionary.json", `${JSON.stringify(dataDictionary(), null, 2)}\n`, 1),
    makeEntry(
      "students.csv",
      csv(["user_id", "display_name", "active", "represented_session_count"], [...students.values()]),
      students.size
    ),
    makeEntry(
      "sessions.csv",
      csv([
        "session_public_id",
        "student_user_id",
        "student_display_label",
        "assessment_public_id",
        "assessment_title",
        "attempt_number",
        "status",
        "current_phase",
        "current_concept_unit_public_id",
        "started_at",
        "last_activity_at",
        "completed_at"
      ], sessionRows),
      sessionRows.length
    ),
    makeEntry(
      "item_responses.csv",
      csv([
        "session_public_id",
        "student_user_id",
        "assessment_public_id",
        "concept_unit_public_id",
        "concept_unit_title",
        "item_public_id",
        "item_order",
        "selected_option",
        "reasoning_text",
        "confidence_rating",
        "skipped_item",
        "skipped_reasoning",
        "skipped_confidence",
        "revision_count",
        "missing_evidence_repair_offered",
        "item_response_time_ms",
        "item_started_at",
        "item_submitted_at",
        "item_version_snapshot"
      ], itemResponseRows),
      itemResponseRows.length
    ),
    makeEntry("conversation_turns_readable.jsonl", jsonl(readableRows), readableRows.length),
    makeEntry("conversation_turns_structured_redacted.jsonl", jsonl(structuredTurnRows), structuredTurnRows.length),
    makeEntry(
      "turn_response_latencies.csv",
      csv([
        "session_public_id",
        "student_user_id",
        "assessment_public_id",
        "concept_unit_public_id",
        "item_public_id",
        "item_order",
        "prompt_turn_index",
        "prompt_actor",
        "prompt_phase",
        "prompt_type",
        "prompt_shown_at",
        "next_student_turn_index",
        "next_student_event_type",
        "next_student_response_at",
        "response_latency_ms",
        "response_latency_seconds",
        "latency_source",
        "latency_scope",
        "student_response_text_present",
        "structured_payload_available_elsewhere",
        "limitations"
      ], turnResponseLatencyRows),
      turnResponseLatencyRows.length
    ),
    makeEntry("turn_response_latencies.jsonl", jsonl(turnResponseLatencyRows), turnResponseLatencyRows.length),
    makeEntry(
      "engagement_process_features.csv",
      csv([
        "session_public_id",
        "student_user_id",
        "assessment_public_id",
        "concept_unit_public_id",
        "item_public_id",
        "item_order",
        "feature_scope",
        "time_to_first_action_ms",
        "first_action_to_submission_ms",
        "last_action_to_submission_ms",
        "prompt_to_final_submission_ms",
        "active_interaction_time_ms",
        "idle_time_ms",
        "idle_ratio",
        "focus_adjusted_time_ms",
        "confidence_selection_latency_ms",
        "reasoning_input_elapsed_time_ms",
        "active_typing_time_ms",
        "pre_submit_pause_ms",
        "activity_prompt_to_first_action_ms",
        "activity_response_elapsed_ms",
        "activity_move_on_latency_ms",
        "choose_another_activity_latency_ms",
        "student_action_count",
        "substantive_action_count",
        "action_density_per_minute",
        "option_revision_count",
        "option_changed_after_reasoning",
        "reasoning_revision_count",
        "confidence_revision_count",
        "copy_paste_event_count",
        "typed_vs_paste_indicator",
        "limitations"
      ], engagementProcessFeatureRows),
      engagementProcessFeatureRows.length
    ),
    makeEntry(
      "engagement_process_features.jsonl",
      jsonl(engagementProcessFeatureRows),
      engagementProcessFeatureRows.length
    ),
    makeEntry("response_packages.jsonl", jsonl(responsePackageRows), responsePackageRows.length),
    makeEntry("process_events_summary.jsonl", jsonl(processSummaryRows), processSummaryRows.length),
    makeEntry("process_events_redacted.jsonl", jsonl(processEventRedactedRows), processEventRedactedRows.length),
    makeEntry(
      "process_event_counts.csv",
      csv(["session_public_id", "event_type", "event_count"], processCountRows),
      processCountRows.length
    ),
    makeEntry(
      "engagement_evidence_packets.jsonl",
      jsonl(audits.map((audit) => ({
        session_public_id: asRecord(audit).session_public_id,
        engagement_evidence_summary: safeJson(asRecord(audit).engagement_evidence_summary),
        correctness_inflation_summary: safeJson(asRecord(audit).correctness_inflation_summary)
      }))),
      audits.length
    ),
    makeEntry("misconception_diagnosis_or_profile_packets.jsonl", jsonl(profileRows), profileRows.length),
    makeEntry("formative_purpose_or_value_packets.jsonl", jsonl(formativeRows), formativeRows.length),
    makeEntry("activity_runtime_attempts.jsonl", jsonl(activityRows), activityRows.length),
    makeEntry("activity_misconception_evidence_records.jsonl", jsonl(evidenceRows), evidenceRows.length),
    makeEntry("post_activity_diagnostic_snapshots.jsonl", jsonl(snapshotRows), snapshotRows.length),
    makeEntry("agent_calls_summary.jsonl", jsonl(agentRows), agentRows.length),
    makeEntry("session_data_completeness.jsonl", jsonl(audits.map((audit) => safeJson(audit))), audits.length),
    makeEntry("limitations.jsonl", jsonl(limitationRows), limitationRows.length)
  ];

  if (includeRestrictedItemKeys) {
    const restrictedRows = sessions.flatMap((session) =>
      session.concept_unit_sessions.flatMap((conceptUnitSession) =>
        conceptUnitSession.item_responses.map((response) => ({
          session_public_id: session.session_public_id,
          assessment_public_id: session.assessment.assessment_public_id,
          concept_unit_public_id: conceptUnitSession.concept_unit.concept_unit_public_id,
          item_public_id: response.item.item_public_id,
          item_order: response.item.item_order,
          correct_option: response.item.correct_option
        }))
      )
    );
    entries.push(
      makeEntry(
        "restricted_item_keys.csv",
        csv([
          "session_public_id",
          "assessment_public_id",
          "concept_unit_public_id",
          "item_public_id",
          "item_order",
          "correct_option"
        ], restrictedRows),
        restrictedRows.length
      ),
      makeEntry(
        "restricted_item_metadata_manifest.json",
        `${JSON.stringify({
          included: true,
          warning:
            "This restricted file contains item-key data. It is teacher/research-only and must not be shared with students.",
          generated_at: generatedAt
        }, null, 2)}\n`,
        1
      )
    );
  }

  const manifestIncludedSources = ["manifest.json", ...entries.map((entry) => entry.path)];
  const manifestBase = {
    export_version: TEACHER_RESEARCH_EXPORT_VERSION,
    generated_at: generatedAt,
    generated_by_role: input.generated_by_role ?? "teacher_researcher",
    filters: {
      session_public_id: input.session_public_id ?? null
    },
    included_tables_or_sources: manifestIncludedSources,
    included_sources: manifestIncludedSources,
    redaction_policy: {
      public_ids_preferred: true,
      raw_provider_output_excluded: true,
      raw_provider_requests_excluded: true,
      raw_process_payloads_excluded: true,
      raw_misconception_ids_excluded: true,
      raw_distractor_metadata_excluded: true,
      default_answer_keys_excluded: !includeRestrictedItemKeys
    },
    restricted_item_keys_included: includeRestrictedItemKeys,
    safety_exclusions: [
      "API keys",
      "headers",
      "secrets",
      "raw provider output",
      "raw provider requests",
      "raw keystrokes",
      "raw clipboard text",
      "raw browser URLs",
      "raw process payloads unless explicitly summarized",
      "raw internal database UUIDs",
      "student-facing hidden answer keys unless restricted export is selected"
    ],
    limitations: [
      "Synchronous local MVP export; very large datasets may need a background job in a later phase.",
      "Process data are contextual evidence only and cannot infer misconduct.",
      "Default export omits restricted item keys and raw diagnostic metadata."
    ]
  };

  const manifestEntry = makeEntry(
    "manifest.json",
    `${JSON.stringify({ ...manifestBase, row_counts: { "manifest.json": 1, ...fileRowCounts(entries) } }, null, 2)}\n`,
    1
  );
  const entriesWithManifest = [
    manifestEntry,
    ...entries
  ];

  assertResearchExportSafety(entriesWithManifest, includeRestrictedItemKeys);

  const zipBuffer = createStoreOnlyZip(entriesWithManifest);
  const filename = input.session_public_id
    ? `${input.session_public_id}-research-export.zip`
    : `teacher-research-export-${generatedAt.replace(/[:.]/g, "-")}.zip`;

  return {
    filename,
    content_type: "application/zip",
    buffer: zipBuffer,
    files: entriesWithManifest,
    manifest: { ...manifestBase, row_counts: fileRowCounts(entriesWithManifest) },
    no_live_provider_call_made: true
  };
}
