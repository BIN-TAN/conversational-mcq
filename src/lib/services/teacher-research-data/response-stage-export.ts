import { stringify } from "csv-stringify/sync";
import { RESPONSE_STAGE_CALCULATION_VERSION, responseStageDictionaryRows } from "./response-stage-dictionary";
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
  for (const table of tables.filter(t => ["response_stage_visits.csv", "item_behavior_summary.csv"].includes(t.path))) {
    table.columns.push("calculation_version");
    table.rows.forEach(row => { row.calculation_version = RESPONSE_STAGE_CALCULATION_VERSION; });
  }
  const csv = (rows: Row[], columns?: readonly string[]) => stringify(rows, { header: true, columns: columns ? [...columns] : undefined, cast: { date: d => d.toISOString() }, escape_formulas: true });
  return [...tables.map(t => ({ path: t.path, data: csv(t.rows, t.columns) })),
    { path: "response_stage_data_dictionary.csv", data: csv(responseStageDictionaryRows(tables)) },
    { path: "response_stage_notes.txt", data: "Stage observations use response-stage-observation-v1. Browser data are observations, not authoritative response acceptance.\nDurations use monotonic time within one browser document. Backend outcome timestamps use a separate clock.\nFirst-observed visit summaries must be interpreted with all visit rows; a resumed visit is not necessarily first exposure.\nWaiting, hidden time and elapsed time overlap and must not be added. Abrupt closure/offline delivery may lose events.\nExplicit pause/end requests are recorded as visit close reasons; time between visits is not imputed as thinking or absence.\nRevisions reuse existing accepted transcript records; initial immutable packages and all prior exports remain available.\nFeedback acknowledgements show display, not reading. Before/after values are available only for newly recorded edits.\n" }
  ];
}
