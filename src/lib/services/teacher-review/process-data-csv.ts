import { stringify } from "csv-stringify/browser/esm/sync";
import type { ProcessDataSummary } from "./process-data-summary";

export function processDataTimelineCsv(data: ProcessDataSummary, sessionPublicId: string) {
  return stringify(data.timeline.map((event) => ({
    session_public_id: sessionPublicId,
    summary_version: data.version,
    recorded_at_utc: event.at,
    category: event.category,
    activity: event.action,
    context: event.context,
    duration_ms: event.duration_ms,
    event_type: event.event_type, event_source: event.event_source, recorded_at_field: event.recorded_at_field,
    client_occurred_at: event.client_occurred_at, server_received_at: event.server_received_at,
    source_turn_sequence_index: event.source_turn_sequence_index,
    display_event_contract_version: event.display_event_contract_version
  })), {
    header: true,
    columns: ["session_public_id", "summary_version", "recorded_at_utc", "category", "activity", "context", "duration_ms",
      "event_type", "event_source", "recorded_at_field", "client_occurred_at", "server_received_at", "source_turn_sequence_index", "display_event_contract_version"],
    escape_formulas: true,
    bom: true
  });
}
