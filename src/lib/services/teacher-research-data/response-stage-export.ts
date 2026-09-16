import { stringify } from "csv-stringify/sync";
import { deriveResponseStageVisits, RESPONSE_STAGE_COLUMNS, summarizeItemStageVisits, type ResponseStageEvent } from "../student-assessment/response-stage-data";

type Source = { session_public_id: string; research_student_id: string; assessment_public_id: string; attempt_number: number;
  events: ResponseStageEvent[]; items: { item_public_id: string; item_snapshot_public_id: string; item_version: number }[];
  turns: { sequence_index: number; created_at: Date; item_public_id: string | null; structured_payload: unknown }[] };
type Row = Record<string, unknown>;
const record = (v: unknown): Row => v && typeof v === "object" && !Array.isArray(v) ? v as Row : {};
const identity = ["research_student_id", "assessment_public_id", "session_public_id", "attempt_number"];
const itemIdentity = ["item_public_id", "item_snapshot_public_id", "item_version"];
const observedColumns = ["stage_visit_id", "browser_tab_id", "response_stage", "response_phase", "observation_kind", "observation_sequence", "monotonic_ms", "submission_id",
  "result", "input_length", "input_change_count", "reason", "client_event_id", "client_occurred_at", "server_received_at", "observation_version"];

export function responseStageExportFiles(sources: Source[]) {
  const stages: Row[] = [], itemRows: Row[] = [], eventRows: Row[] = [], revisions: Row[] = [], exposures: Row[] = [];
  for (const source of sources) {
    const ids = { research_student_id: source.research_student_id, assessment_public_id: source.assessment_public_id,
      session_public_id: source.session_public_id, attempt_number: source.attempt_number };
    const visits = deriveResponseStageVisits(source.events);
    const item = (id?: string | null) => source.items.find(i => i.item_public_id === id) ?? { item_public_id: id ?? null, item_snapshot_public_id: null, item_version: null };
    for (const visit of visits) stages.push({ ...ids, ...item(visit.item_public_id), ...visit });
    for (const i of source.items) itemRows.push({ ...ids, ...i, ...summarizeItemStageVisits(visits.filter(v => v.item_public_id === i.item_public_id)) });
    for (const id of new Set(visits.map(v => v.item_public_id).filter(Boolean))) {
      if (source.items.some(i => i.item_public_id === id)) continue;
      itemRows.push({ ...ids, ...item(id), ...summarizeItemStageVisits(visits.filter(v => v.item_public_id === id)) });
    }
    for (const event of source.events) {
      const payload = record(event.payload);
      if (["response_stage_observation", "response_stage_outcome"].includes(event.event_type)) eventRows.push({ ...ids, ...item(event.item_public_id),
        event_type: event.event_type, event_source: event.event_source, occurred_at: event.occurred_at,
        ...Object.fromEntries(observedColumns.map(key => [key, payload[key] ?? null])),
        action_status: payload.action_status, accepted: payload.accepted, validation_rejected: payload.validation_rejected,
        server_phase: payload.phase, client_action_id: payload.client_action_id });
      if (["package_results_shown", "item_correctness_status_shown", "profile_feedback_shown", "next_interaction_shown", "formative_activity_shown"].includes(event.event_type)) exposures.push({ ...ids,
        ...item(event.item_public_id), event_type: event.event_type, event_source: event.event_source, occurred_at: event.occurred_at,
        content_id: payload.content_id, client_occurred_at: payload.client_occurred_at,
        observation_meaning: "Display acknowledgement, not proof of reading or understanding." });
    }
    // Reuse the accepted transcript record rather than duplicate response text
    // in browser telemetry. Legacy revisions lack previous_response and stay blank.
    for (const turn of source.turns) {
      const p = record(turn.structured_payload);
      if (!["student_response_in_flow_edit", "package_review_tempting_option"].includes(String(p.source))) continue;
      const previous = record(p.previous_response);
      const fields = Array.isArray(p.changed_fields) ? p.changed_fields : [];
      const mapping: Record<string, string[]> = { answer: ["selected_option"], reasoning: ["reasoning_text"], confidence: ["confidence_rating"], tempting_option: ["tempting_option", "tempting_option_reason"] };
      for (const changed of fields) for (const field of mapping[String(changed)] ?? []) {
        if (field in previous && previous[field] === p[field]) continue;
        revisions.push({ ...ids, ...item(turn.item_public_id), source_turn_sequence_index: turn.sequence_index,
          changed_at: turn.created_at, changed_field: field, previous_value: previous[field] ?? null,
          new_value: p[field] ?? null, revision_phase: p.revision_phase ?? "legacy_unspecified",
          coverage: field in previous ? "before_and_after" : "previous_value_not_recorded" });
      }
    }
  }
  const tables = [
    { path: "response_stage_visits.csv", columns: [...identity, ...itemIdentity.filter(k => k !== "item_public_id"), ...RESPONSE_STAGE_COLUMNS], rows: stages },
    { path: "item_behavior_summary.csv", columns: [...identity, ...itemIdentity, "observed_stage_visit_count", "answer_time_ms", "first_action_ms", "reasoning_start_latency_ms", "reasoning_time_ms", "reasoning_input_elapsed_ms", "confidence_time_ms", "system_wait_ms", "hidden_duration_ms", "submission_count", "validation_rejection_count", "timing_quality_status"], rows: itemRows },
    { path: "response_stage_events.csv", columns: [...identity, ...itemIdentity, "event_type", "event_source", "occurred_at", ...observedColumns, "action_status", "accepted", "validation_rejected", "server_phase", "client_action_id"], rows: eventRows },
    { path: "response_revision_history.csv", columns: [...identity, ...itemIdentity, "source_turn_sequence_index", "changed_at", "changed_field", "previous_value", "new_value", "revision_phase", "coverage"], rows: revisions },
    { path: "feedback_exposure_events.csv", columns: [...identity, ...itemIdentity, "event_type", "event_source", "occurred_at", "client_occurred_at", "content_id", "observation_meaning"], rows: exposures }
  ];
  const definitions: Record<string, string> = {
    stage_visit_id: "One browser visit to an item response stage. Reload or return creates a new visit; never combine monotonic clocks across documents.",
    response_phase: "Browser context: initial, transfer, review, or revision. Acceptance and server_phase come from the backend, not the browser.",
    ready_at: "Client UTC time when the active stage was rendered, in the viewport, document-visible, and not blocked by an action.",
    accepted_at: "Server timestamp of a linked accepted action result. Do not subtract from client timestamps for elapsed time.",
    last_accepted_submitted_at: "Client timestamp of the last submission in this visit linked to an accepted server outcome.",
    time_to_first_action_ms: "Monotonic time from ready to first typed/pasted input or submitted selection. Focus and mouse movement do not count.",
    input_start_latency_ms: "Ready to first input. For justification this separates pre-input time from subsequent composition time.",
    input_elapsed_ms: "First input to first submission; includes reading and pauses. Not active typing or thinking time.",
    response_elapsed_ms: "Ready to first submission within this visit. Includes any time hidden before submission.",
    time_to_accepted_submission_ms: "Ready to the last submitted action linked to an accepted server outcome in this visit. Includes clarification and request waiting before that submission.",
    input_to_accepted_ms: "First text input to the last submission accepted in this visit; not active typing time.",
    stage_elapsed_ms: "Ready to recorded visit close. Includes system waiting; not pure student work time.",
    system_wait_ms: "Sum of observed submit-to-controls-ready intervals for this visit; includes network, processing, UI refresh and rendering. Blank if any endpoint is missing.",
    request_wait_ms: "Sum of submit-to-request-finished intervals. A subset of system waiting, not an extra duration to add.",
    hidden_duration_ms: "Sum of complete stage-local hidden/visible pairs. Blank for incomplete visits/pairs. May overlap waiting; do not add durations.",
    offline_duration_ms: "Sum of complete browser offline/online pairs during this visit. Browser connectivity signals do not prove server reachability; blank for incomplete visits/pairs.",
    focus_loss_count: "Browser-window blur observations during this stage, not proof of leaving the assessment or misconduct.",
    submission_count: "Observed submit actions, including clarification attempts and manual retries. Delivery retries reuse event IDs and are deduplicated.",
    validation_rejection_count: "Linked server response-quality or same-option rejection results; not evidence of low ability.",
    input_change_count: "Input-change event count, including additions, deletions and IME edits, not conceptual revision count.",
    observation_sequence: "Increasing within-visit sequence. Gaps indicate incomplete observation capture.",
    monotonic_ms: "Browser performance.now() value, comparable only within the same browser document.",
    observed_stage_visit_count: "Zero means no stage observations, including historical sessions predating instrumentation; it does not mean no activity.",
    timing_quality_status: "valid/partial/not_recorded. Missing data are not zero. No observation implies attention or misconduct.",
    previous_value: "Previously accepted response field, never an unsent draft. Blank for legacy revisions lacking this evidence.",
    new_value: "Accepted changed response field from the existing transcript. No answer key is added.",
    first_action_ms: "First observed initial answer-stage visit ready to meaningful response action; not a mental reading-time estimate.",
    reasoning_start_latency_ms: "First observed initial justification visit ready to first text input.",
    reasoning_time_ms: "First observed initial justification visit ready to first submission.",
    reasoning_input_elapsed_ms: "First input to first submission in the first observed initial justification visit.",
    answer_time_ms: "First observed initial answer visit ready to first submitted selection.",
    confidence_time_ms: "First observed initial confidence visit ready to first submitted confidence choice."
  };
  const csv = (rows: Row[], columns?: readonly string[]) => stringify(rows, { header: true, columns: columns ? [...columns] : undefined, cast: { date: d => d.toISOString() }, escape_formulas: true });
  return [...tables.map(t => ({ path: t.path, data: csv(t.rows, t.columns) })),
    { path: "response_stage_data_dictionary.csv", data: csv(tables.flatMap(t => t.columns.map(name => ({ dataset: t.path,
      variable_name: name, definition: definitions[name] ?? name.replaceAll("_", " "),
      missing_values: "Blank means unavailable/not applicable. Historical timing is not backfilled.",
      unit: name.endsWith("_ms") ? "milliseconds" : name.endsWith("_at") ? "UTC timestamp" : "" })))) },
    { path: "response_stage_notes.txt", data: "Stage observations use response-stage-observation-v1. Browser data are observations, not authoritative response acceptance.\nDurations use monotonic time within one browser document. Backend outcome timestamps use a separate clock.\nFirst-observed visit summaries must be interpreted with all visit rows; a resumed visit is not necessarily first exposure.\nWaiting, hidden time and elapsed time overlap and must not be added. Abrupt closure/offline delivery may lose events.\nExplicit pause/end requests are recorded as visit close reasons; time between visits is not imputed as thinking or absence.\nRevisions reuse existing accepted transcript records; initial immutable packages and all prior exports remain available.\nFeedback acknowledgements show display, not reading. Before/after values are available only for newly recorded edits.\n" }
  ];
}
