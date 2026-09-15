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
    duration_ms: event.duration_ms
  })), {
    header: true,
    columns: ["session_public_id", "summary_version", "recorded_at_utc", "category", "activity", "context", "duration_ms"],
    escape_formulas: true,
    bom: true
  });
}
