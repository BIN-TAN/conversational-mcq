import { RESPONSE_OBSERVATION_VERSION, ResponseObservationPayloadSchema, type ResponseObservationPayload } from "@/lib/student-assessment-ui/response-observation";

export type ResponseStageEvent = {
  event_type: string; event_source?: string | null; item_public_id?: string | null;
  occurred_at?: Date | string | null; created_at?: Date | string | null; payload?: unknown;
};
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const iso = (value: Date | string | null | undefined) => value && Number.isFinite(new Date(value).getTime()) ? new Date(value).toISOString() : null;
type Observation = ResponseObservationPayload & { at: string | null; browser_tab_id: string; item_public_id: string | null };
const delta = (a?: Observation, b?: Observation) => a && b && b.monotonic_ms >= a.monotonic_ms ? Math.round(b.monotonic_ms - a.monotonic_ms) : null;

export const RESPONSE_STAGE_COLUMNS = ["stage_visit_id", "item_public_id", "browser_tab_id", "response_stage", "response_phase",
  "ready_at", "first_action_at", "first_input_at", "first_submitted_at", "last_accepted_submitted_at", "accepted_at", "closed_at", "close_reason",
  "time_to_first_action_ms", "input_start_latency_ms", "input_elapsed_ms", "response_elapsed_ms", "time_to_accepted_submission_ms", "input_to_accepted_ms", "stage_elapsed_ms",
  "request_wait_ms", "system_wait_ms", "hidden_duration_ms", "hidden_count", "return_count", "focus_loss_count", "offline_count", "offline_duration_ms",
  "submission_count", "accepted_submission_count", "validation_rejection_count", "request_failure_count", "input_change_count",
  "timing_quality_status", "timing_limitations", "observation_version"] as const;

export function deriveResponseStageVisits(events: ResponseStageEvent[]) {
  const groups = new Map<string, Observation[]>();
  const seen = new Set<string>();
  for (const event of events) {
    if (event.event_type !== "response_stage_observation" || event.event_source !== "frontend") continue;
    const raw = record(event.payload);
    const { client_event_id, browser_tab_id, client_occurred_at, server_received_at: _received, clock_source: _clock,
      timing_contract_version: _contract, timing_source_version: _source, timing_quality_status: _quality, ...observation } = raw;
    void _received; void _clock; void _contract; void _source; void _quality;
    if (typeof browser_tab_id !== "string" || typeof client_event_id !== "string" || seen.has(client_event_id)) continue;
    const parsed = ResponseObservationPayloadSchema.safeParse(observation);
    if (!parsed.success) continue;
    seen.add(client_event_id);
    const list = groups.get(parsed.data.stage_visit_id) ?? [];
    list.push({ ...parsed.data, browser_tab_id, item_public_id: event.item_public_id ?? null,
      at: iso(typeof client_occurred_at === "string" ? client_occurred_at : event.occurred_at) });
    groups.set(parsed.data.stage_visit_id, list);
  }
  return [...groups.entries()].map(([id, list]) => {
    list.sort((a, b) => a.observation_sequence - b.observation_sequence);
    const base = list[0];
    const limitations: string[] = [];
    const contextMismatch = list.some(e => e.browser_tab_id !== base.browser_tab_id || e.item_public_id !== base.item_public_id || e.response_stage !== base.response_stage || e.response_phase !== base.response_phase);
    const orderInvalid = list.some((e, i) => i > 0 && (e.monotonic_ms < list[i - 1].monotonic_ms || e.observation_sequence <= list[i - 1].observation_sequence));
    if (contextMismatch) limitations.push("visit_context_conflict");
    if (orderInvalid) limitations.push("invalid_monotonic_order");
    if (list.some((e, i) => e.observation_sequence !== (list[i - 1]?.observation_sequence ?? 0) + 1)) limitations.push("observation_sequence_gap");
    const ready = list.find(e => e.observation_kind === "ready");
    const closed = list.find(e => e.observation_kind === "closed");
    const firstInput = list.find(e => e.observation_kind === "first_input");
    const submissions = list.filter(e => e.observation_kind === "submitted");
    const firstAction = list.find(e => e.observation_kind === "first_input" || e.observation_kind === "submitted");
    if (!ready) limitations.push("ready_event_missing");
    if (!closed) limitations.push("visit_end_missing");
    const outcomes = events.filter(e => e.event_type === "response_stage_outcome" && e.event_source === "backend" && record(e.payload).stage_visit_id === id &&
      (!e.item_public_id || e.item_public_id === base.item_public_id));
    const bySubmission = new Map(outcomes.map(e => [String(record(e.payload).submission_id), e]));
    const accepted = submissions.map(e => bySubmission.get(e.submission_id!)).filter(e => e && record(e.payload).accepted === true);
    const lastAccepted = submissions.filter(e => record(bySubmission.get(e.submission_id!)?.payload).accepted === true).at(-1);
    if (submissions.some(e => !bySubmission.has(e.submission_id!))) limitations.push("server_outcome_missing");
    const wait = (kind: "request_finished" | "controls_ready") => {
      if (!ready) return null;
      const spans = submissions.map(s => delta(s, list.find(e => e.observation_kind === kind && e.submission_id === s.submission_id)));
      if (spans.some(d => d === null)) { limitations.push(`${kind}_missing`); return null; }
      return spans.reduce<number>((sum, d) => sum + (d ?? 0), 0);
    };
    let hidden: Observation | undefined;
    let hiddenMs = 0;
    let returns = 0;
    let visibilityPartial = false;
    for (const e of list) {
      if (e.observation_kind === "hidden") { if (hidden) visibilityPartial = true; hidden = e; }
      if (e.observation_kind === "visible") {
        if (!hidden) { visibilityPartial = true; continue; }
        hiddenMs += delta(hidden, e) ?? 0; returns++; hidden = undefined;
      }
    }
    if (hidden || visibilityPartial) limitations.push("unpaired_visibility_observation");
    let offline: Observation | undefined;
    let offlineMs = 0;
    let offlinePartial = false;
    for (const e of list) {
      if (e.observation_kind === "offline") { if (offline) offlinePartial = true; offline = e; }
      if (e.observation_kind === "online") {
        if (!offline) { offlinePartial = true; continue; }
        offlineMs += delta(offline, e) ?? 0; offline = undefined;
      }
    }
    if (offline || offlinePartial) limitations.push("unpaired_connection_observation");
    const valid = !contextMismatch && !orderInvalid;
    const duration = (a?: Observation, b?: Observation) => valid ? delta(a, b) : null;
    const requestWait = wait("request_finished");
    const systemWait = wait("controls_ready");
    return {
      stage_visit_id: id, item_public_id: base.item_public_id, browser_tab_id: base.browser_tab_id,
      response_stage: base.response_stage, response_phase: base.response_phase,
      ready_at: ready?.at ?? null, first_action_at: firstAction?.at ?? null, first_input_at: firstInput?.at ?? null,
      ready_monotonic_ms: valid ? ready?.monotonic_ms ?? null : null, first_submitted_monotonic_ms: valid ? submissions[0]?.monotonic_ms ?? null : null,
      last_accepted_submitted_monotonic_ms: valid ? lastAccepted?.monotonic_ms ?? null : null,
      last_accepted_submitted_at: lastAccepted?.at ?? null,
      first_submitted_at: submissions[0]?.at ?? null, accepted_at: iso(accepted[0]?.occurred_at), closed_at: closed?.at ?? null,
      close_reason: closed?.reason ?? null,
      time_to_first_action_ms: duration(ready, firstAction), input_start_latency_ms: duration(ready, firstInput),
      input_elapsed_ms: duration(firstInput, submissions[0]), response_elapsed_ms: duration(ready, submissions[0]), stage_elapsed_ms: duration(ready, closed),
      time_to_accepted_submission_ms: duration(ready, lastAccepted), input_to_accepted_ms: duration(firstInput, lastAccepted),
      request_wait_ms: valid ? requestWait : null, system_wait_ms: valid ? systemWait : null,
      hidden_duration_ms: valid && ready && closed && !hidden && !visibilityPartial ? hiddenMs : null,
      hidden_count: list.filter(e => e.observation_kind === "hidden").length, return_count: returns,
      focus_loss_count: list.filter(e => e.observation_kind === "blur").length,
      offline_count: list.filter(e => e.observation_kind === "offline").length,
      offline_duration_ms: valid && ready && closed && !offline && !offlinePartial ? offlineMs : null,
      submission_count: submissions.length, accepted_submission_count: accepted.length,
      validation_rejection_count: [...bySubmission.values()].filter(e => record(e.payload).validation_rejected === true).length,
      request_failure_count: list.filter(e => e.observation_kind === "request_finished" && e.result === "request_failed").length,
      input_change_count: Math.max(0, ...list.map(e => e.input_change_count ?? 0)),
      timing_quality_status: limitations.length ? "partial" : "valid", timing_limitations: [...new Set(limitations)].join("|"),
      observation_version: RESPONSE_OBSERVATION_VERSION
    };
  }).sort((a, b) => (a.ready_at ?? "").localeCompare(b.ready_at ?? ""));
}
export type ResponseStageVisit = ReturnType<typeof deriveResponseStageVisits>[number];

export function browserItemTiming(events: ResponseStageEvent[], complete: boolean) {
  const visits = deriveResponseStageVisits(events).filter(v => v.response_phase === "initial" || v.response_phase === "transfer");
  if (!visits.length) return null;
  const first = (stage: string) => visits.find(v => v.response_stage === stage);
  const answer = first("answer"), reasoning = first("reasoning"), confidence = first("confidence");
  const alternative = first("tempting_option"), alternativeReason = first("tempting_reason");
  const terminalStage = alternativeReason ? "tempting_reason" : alternative ? "tempting_option" : "confidence";
  const last = visits.filter(v => v.response_stage === terminalStage && v.last_accepted_submitted_at).at(-1);
  const sameDocument = new Set(visits.map(v => v.browser_tab_id)).size === 1;
  const start = answer?.ready_monotonic_ms, end = last?.last_accepted_submitted_monotonic_ms;
  const elapsed = sameDocument && complete && start != null && end != null && end >= start ? Math.round(end - start) : null;
  const date = (value?: string | null) => value ? new Date(value) : null;
  return { item_presented_at: date(answer?.ready_at), first_student_action_at: date(answer?.first_action_at),
    first_option_selected_at: date(answer?.first_submitted_at), reasoning_prompted_at: date(reasoning?.ready_at),
    reasoning_started_at: date(reasoning?.first_input_at), reasoning_submitted_at: date(reasoning?.last_accepted_submitted_at),
    confidence_prompted_at: date(confidence?.ready_at), confidence_selected_at: date(confidence?.first_submitted_at),
    tempting_option_prompted_at: date(alternative?.ready_at), tempting_option_submitted_at: date(alternative?.first_submitted_at),
    item_submitted_at: complete ? date(last?.last_accepted_submitted_at) : null, last_student_action_at: date(last?.last_accepted_submitted_at),
    item_elapsed_response_time_ms: elapsed,
    time_to_first_response_action_ms: answer?.time_to_first_action_ms ?? null,
    time_to_first_option_selection_ms: answer?.response_elapsed_ms ?? null,
    post_option_completion_time_ms: elapsed !== null && answer?.response_elapsed_ms != null ? elapsed - answer.response_elapsed_ms : null,
    reasoning_elapsed_time_ms: reasoning?.time_to_accepted_submission_ms ?? null,
    reasoning_start_latency_ms: reasoning?.input_start_latency_ms ?? null,
    reasoning_input_elapsed_time_ms: reasoning?.input_to_accepted_ms ?? null,
    confidence_response_time_ms: confidence?.response_elapsed_ms ?? null,
    tempting_option_response_time_ms: alternative?.response_elapsed_ms ?? null,
    last_action_to_submission_ms: null,
    instrumentation_complete: false,
    timing_contract_version: "timing-contract-v4" as const, timing_source_version: RESPONSE_OBSERVATION_VERSION as "response-stage-observation-v1",
    timing_quality_status: "partial" as const,
    timing_limitations: [...new Set([...visits.flatMap(v => v.timing_limitations.split("|").filter(Boolean)),
      ...(!sameDocument ? ["item_spans_browser_documents"] : []), ...(!complete ? ["item_not_completed"] : []),
      "active_typing_time_unavailable", "client_observation_not_proof_of_attention"])] };
}

export function summarizeItemStageVisits(visits: ResponseStageVisit[]) {
  const initial = visits.filter(v => v.response_phase === "initial" || v.response_phase === "transfer");
  const first = (stage: string) => initial.find(v => v.response_stage === stage);
  const sum = (key: "system_wait_ms" | "hidden_duration_ms") => initial.length && initial.every(v => v[key] !== null)
    ? initial.reduce((n, v) => n + (v[key] ?? 0), 0) : null;
  return { observed_stage_visit_count: visits.length,
    answer_time_ms: first("answer")?.response_elapsed_ms ?? null,
    first_action_ms: first("answer")?.time_to_first_action_ms ?? null,
    reasoning_start_latency_ms: first("reasoning")?.input_start_latency_ms ?? null,
    reasoning_time_ms: first("reasoning")?.response_elapsed_ms ?? null,
    reasoning_input_elapsed_ms: first("reasoning")?.input_elapsed_ms ?? null,
    confidence_time_ms: first("confidence")?.response_elapsed_ms ?? null,
    system_wait_ms: sum("system_wait_ms"), hidden_duration_ms: sum("hidden_duration_ms"),
    submission_count: initial.reduce((n, v) => n + v.submission_count, 0),
    validation_rejection_count: initial.reduce((n, v) => n + v.validation_rejection_count, 0),
    timing_quality_status: !initial.length ? "not_recorded" : initial.every(v => v.timing_quality_status === "valid") ? "valid" : "partial" };
}
