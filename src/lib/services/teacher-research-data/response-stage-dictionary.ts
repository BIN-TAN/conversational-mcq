export const RESPONSE_STAGE_CALCULATION_VERSION = "response-stage-derivation-v2";

type Definition = {
  definition: string;
  source: string;
  calculation: string;
  unit: string;
  applicability: string;
  missing_values: string;
};
const observed = "Observed records only; absent events do not prove that an action did not occur.";
const missing = "Blank means unavailable or inapplicable, not zero. Historical observations are not backfilled.";
const field = (definition: string, source: string, calculation = "Directly recorded; no calculation.", unit = "identifier", applicability = "Rows with the named source record.", missing_values = missing): Definition =>
  ({ definition, source, calculation, unit, applicability, missing_values });
const timing = (definition: string, calculation: string, applicability = "One visit with both named browser endpoints.") =>
  field(definition, "response_stage_observation in ProcessEvent", calculation + " Use rounded nonnegative monotonic differences within one browser document; conflicting context/order or absent endpoints yield blank.", "milliseconds", applicability);
const count = (definition: string, calculation: string, source = "response_stage_observation in ProcessEvent") =>
  field(definition, source, calculation, "count", observed, "Zero means no matching event among the captured records, not verified absence of behavior. Check timing_limitations.");

const definitions: Record<string, Definition> = {
  research_student_id: field("Stable pseudonymous student join key; not the login name.", "Research pseudonymization service", "Derived using the configured research pseudonymization key; join only within compatible pseudonym versions."),
  assessment_public_id: field("Administered assessment version identifier; corrected versions have different IDs.", "AssessmentSession.assessment"),
  session_public_id: field("One assessment attempt; the primary join to sessions.csv and attempt_records.csv.", "AssessmentSession.session_public_id"),
  attempt_number: field("Original attempt number within the assessment version, not a renumbered completion rank.", "AssessmentSession.attempt_number", "Directly recorded; waived and incomplete attempts can leave gaps.", "integer"),
  item_public_id: field("Item associated with the event or response; not a cross-version equivalence key.", "ProcessEvent.item or ItemResponse.item"),
  item_snapshot_public_id: field("Snapshot join key for an administered response; pair with its assessment snapshot in item_responses.csv.", "ItemResponse administered snapshot", "Use the existing snapshot identifier; no snapshot is invented for a viewed item without a response."),
  item_version: field("Administered item version, not the current editable item version.", "ItemResponse.item_version_snapshot", "Directly recorded.", "integer"),
  stage_visit_id: field("One visit to one response stage. A return/reload can produce another visit.", "Browser recorder; linked in backend action outcome"),
  browser_tab_id: field("Browser-document capture identifier; changes on reload and is not a device or persistent tab identifier.", "Frontend event envelope"),
  response_stage: field("Answer, reasoning, confidence, tempting_option, tempting_reason, or revision controls being observed.", "Browser stage context", "Directly recorded. package_review is reserved in the schema but has no standalone emitting UI; review edits emit revision.", "category"),
  response_phase: field("Browser context: initial, transfer, review, or revision; not authoritative assessment state.", "Browser stage context", "Directly recorded; use server_phase for the backend state.", "category"),
  observation_kind: field("ready, first_input, submitted, request_finished, controls_ready, hidden, visible, blur, focus, offline, online, or closed.", "Browser recorder", "Directly recorded.", "category", "Frontend observation rows only."),
  observation_sequence: field("Increasing event number within a stage visit; gaps identify lost observations.", "Browser recorder", "Increment by one for each emitted observation, starting at 1.", "integer"),
  monotonic_ms: field("Browser performance.now() reading; not elapsed time since item presentation by itself.", "Browser recorder", "Directly recorded. Subtract only values from the same browser document.", "milliseconds"),
  submission_id: field("Join between a browser submission and its authoritative backend outcome; also links request/UI endpoints.", "Browser submit operation", "New UUID for each observed submission, reused by its linked events.", "identifier", "Submission, request, controls-ready and backend outcome rows."),
  result: field("response_received or request_failed; receiving a response does not mean the answer was accepted.", "Browser request completion", "Directly recorded.", "category", "request_finished observations only."),
  input_length: field("UTF-16 code-unit length of the field at the first observed input event; not final response length.", "Browser input event", "JavaScript field.value.length; includes pasted/IME input without storing draft text.", "UTF-16 code units", "first_input observations only."),
  reason: field("Why the recorder closed a visit: stage_changed, view_left, pause_requested, or end_requested.", "Browser close event", "Directly recorded. A requested pause/end is not proof of successful server completion; use lifecycle records.", "category", "closed observations only."),
  client_event_id: field("Stable delivery identity used to deduplicate a browser event across delivery retries.", "Frontend event envelope", "Directly recorded; delivery retries retain this ID.", "identifier", "Frontend rows only."),
  observation_version: field("Collector schema version, response-stage-observation-v1.", "Browser payload", "Directly recorded on observations; populated from the collector contract on derived visit rows.", "version"),
  calculation_version: field("Version of the derived visit/item calculations, separate from the raw collector version.", "Research derivation code", `Constant ${RESPONSE_STAGE_CALCULATION_VERSION} for this export.`, "version"),
  event_type: field("Stored response-stage observation/outcome or feedback display event type.", "ProcessEvent.event_type", "Directly recorded.", "category"),
  event_source: field("Component recording the event, normally frontend for observations and backend for action outcomes.", "ProcessEvent.event_source", "Directly recorded; client observations cannot create backend acceptance.", "category"),
  action_status: field("Backend action result, such as saved, item_completed, updated, unchanged, or a validation rejection.", "Backend action transaction", "Copied from action_status, edit_status or submission_status; unknown if none exists.", "category", "Backend outcome rows only."),
  accepted: field("Whether the authoritative action returned an accepted status; not item correctness.", "Backend action transaction", "True for saved, item_completed, tempting_option_saved, updated or unchanged; false otherwise.", "boolean", "Backend outcome rows only."),
  validation_rejected: field("Whether the server rejected response quality or a same-option tempting choice.", "Backend action transaction", "True for response_quality_rejected or same_option_tempting_rejected; false otherwise.", "boolean", "Backend outcome rows only."),
  server_phase: field("Backend phase recorded with the action result; do not substitute the browser's response_phase.", "Backend response_stage_outcome.payload.phase", "Directly recorded.", "category", "Backend outcome rows only."),
  client_action_id: field("Action idempotency identifier; retries reuse it to avoid duplicate authoritative writes.", "Backend action transaction", "Directly recorded.", "identifier", "Backend outcome rows only."),
  time_to_first_action_ms: timing("Ready to first observed text input or submitted selection; focus/mouse movement do not count.", "first(first_input or submitted by observation_sequence).monotonic_ms - ready.monotonic_ms."),
  input_start_latency_ms: timing("Ready to first text/input change; not an estimate of mental reading time.", "first_input.monotonic_ms - ready.monotonic_ms.", "Text-entry stages; blank is expected for chip-only selections."),
  input_elapsed_ms: timing("First input to first submission, including pauses, not active typing time.", "first_submitted.monotonic_ms - first_input.monotonic_ms."),
  response_elapsed_ms: timing("Ready to first submitted action, even if that action is rejected.", "first_submitted.monotonic_ms - ready.monotonic_ms."),
  time_to_accepted_submission_ms: timing("Ready to the last submission in the visit with an accepted backend outcome.", "last submitted where linked accepted=true: monotonic_ms - ready.monotonic_ms. Earlier rejected submissions and intervening waits are included."),
  input_to_accepted_ms: timing("First input to the last submission in this visit accepted by the backend.", "last accepted submission.monotonic_ms - first_input.monotonic_ms; includes pauses and any earlier request waits."),
  stage_elapsed_ms: timing("Ready to recorded visit close; includes student and system time.", "closed.monotonic_ms - ready.monotonic_ms."),
  request_wait_ms: timing("Total submit-to-request-finished waiting; a subset of system waiting, not additional time.", "SUM(request_finished.monotonic_ms - submitted.monotonic_ms), paired by submission_id. Blank if ready is absent, any endpoint is missing, or observation_sequence has a gap; 0 for a ready visit with no submissions."),
  system_wait_ms: timing("Total submit-to-controls-ready waiting, including request, refresh and rendering.", "SUM(controls_ready.monotonic_ms - submitted.monotonic_ms), paired by submission_id. Blank if ready is absent, any endpoint is missing, or observation_sequence has a gap; 0 for a ready visit with no submissions."),
  hidden_duration_ms: timing("Duration of captured hidden-to-visible pairs; overlaps other durations and is not additive to them.", "SUM(visible.monotonic_ms - preceding unmatched hidden.monotonic_ms). Require ready, closed, contiguous sequence, and complete unambiguous pairs; otherwise blank. Complete visits with no hidden events yield 0."),
  offline_duration_ms: timing("Duration between captured browser offline/online signals; these do not prove server connectivity.", "SUM(online.monotonic_ms - preceding unmatched offline.monotonic_ms). Require ready, closed, contiguous sequence, and complete unambiguous pairs; otherwise blank. Complete visits with no offline events yield 0."),
  hidden_count: count("Observed document-hidden transitions during a visit.", "COUNT(observation_kind=hidden) after event-ID deduplication."),
  return_count: count("Captured hidden-to-visible pairs, not total returns to the assessment across visits.", "COUNT(visible events that have a preceding unmatched hidden event)."),
  focus_loss_count: count("Window blur events, not proof of leaving the task.", "COUNT(observation_kind=blur)."),
  offline_count: count("Observed browser offline transitions.", "COUNT(observation_kind=offline)."),
  submission_count: count("Observed submitted actions, including rejected attempts and manual retries.", "COUNT(observation_kind=submitted); duplicate event deliveries excluded."),
  accepted_submission_count: count("Observed submissions with an accepted backend outcome.", "COUNT(submissions with matching submission_id and accepted=true); backend outcomes deduplicated by submission_id.", "Browser submissions joined to backend response_stage_outcome"),
  validation_rejection_count: count("Backend validation rejections linked to the visit, not wrong MCQ answers.", "COUNT(unique backend submission_id where validation_rejected=true).", "Backend response_stage_outcome"),
  request_failure_count: count("Observed request failures; not necessarily server rejection or provider failure.", "COUNT(request_finished where result=request_failed)."),
  input_change_count: count("Observed input-change events, not conceptual revisions or physical keystrokes.", "MAX(recorded input_change_count, 0) across visit payloads. Recorder increments on each input event when not awaiting an action; snapshots emitted on submitted/closed. In event rows, direct payload value or blank."),
  timing_quality_status: field("Coverage status: valid, partial, or not_recorded; valid does not validate attention or client truthfulness.", "Response-stage derivation", "Visit: partial if any timing_limitations exist, otherwise valid. Item: not_recorded if no initial/transfer visits; valid only when every such visit is valid, otherwise partial.", "category"),
  timing_limitations: field("Pipe-delimited flags explaining missing endpoints, sequence gaps, context/order conflicts, missing outcomes or unpaired visibility/connectivity.", "Response-stage derivation", "Unique detected flags joined with |. Partial endpoints can still support individual durations; cumulative durations require contiguous capture.", "flag list", "Derived stage visits.", "Empty string means no listed limitation for this visit, not proof of complete real-world behavior capture."),
  observed_stage_visit_count: count("All observed visits for the item, including initial/transfer/review/revision contexts.", "COUNT(derived visits for item_public_id). Zero explicitly means no stage observations, not no student activity."),
  source_turn_sequence_index: field("Persisted transcript order identifying the accepted revision source.", "ConversationTurn.sequence_index", "Directly recorded. Join within session_public_id to conversation_turns.csv.", "integer"),
  changed_field: field("Accepted field changed: selected_option, reasoning_text, confidence_rating, tempting_option, tempting_option_reason, or no_tempting_option.", "Accepted edit transcript payload", "Expand changed_fields using the field mapping; skip a field when recorded previous and new values are equal.", "category"),
  previous_value: field("Previously accepted value, never an unsent draft.", "ConversationTurn.structured_payload.previous_response", "Directly recorded; blank for older revisions without previous_response.", "response value"),
  new_value: field("Accepted replacement value, not a generated answer key.", "Accepted edit transcript payload", "Directly recorded; formula-leading free text is escaped for spreadsheet safety.", "response value"),
  revision_phase: field("Accepted edit's phase relative to assessment submission/feedback, or legacy_unspecified.", "Accepted edit transcript payload.revision_phase", "Use stored revision_phase; legacy_unspecified only when missing.", "category"),
  coverage: field("Whether the revision source retained the previous field, not whether the old answer was nonempty.", "Accepted edit transcript payload", "before_and_after if previous_response contains the field; previous_value_not_recorded otherwise.", "category"),
  content_id: field("Display-content identity used by the emitting feedback presenter; not a unique event or response identifier.", "Feedback event payload.content_id", "Directly recorded; multiple event types can describe the same displayed content.", "identifier", "Only feedback paths emitting this payload; may be blank for legacy/backend events."),
  observation_meaning: field("Interpretation boundary for the feedback display acknowledgement.", "Export annotation", "Constant: Display acknowledgement, not proof of reading or understanding.", "text")
};

const timestamps: Record<string, [string, string]> = {
  occurred_at: ["Event occurrence time on the event's source clock; frontend and backend rows use different clocks.", "ProcessEvent.occurred_at"],
  client_occurred_at: ["Client-reported UTC occurrence time; may be affected by device clock adjustment.", "Frontend event envelope"],
  server_received_at: ["Backend ingestion time for a browser event, not the time the student acted.", "Frontend ingestion envelope"],
  ready_at: ["Client time when controls were visible, in the viewport and usable; not proof the prompt was read.", "ready observation"],
  first_action_at: ["Client time of the first first_input or submitted observation in visit sequence.", "First meaningful response observation"],
  first_input_at: ["Client time of the first observed field input, including paste/IME input.", "first_input observation"],
  first_submitted_at: ["Client time of the first observed submission, whether accepted or rejected.", "First submitted observation"],
  last_accepted_submitted_at: ["Client time of the last submission in this visit joined to an accepted backend result.", "Last accepted submitted observation"],
  accepted_at: ["Server time of the first accepted linked outcome. Deliberately not the last_accepted_submitted_at clock or endpoint.", "First accepted backend response_stage_outcome.occurred_at"],
  closed_at: ["Client time of recorded visit closure; may be unavailable after abrupt shutdown.", "closed observation"],
  changed_at: ["Server persistence time of the accepted revision transcript record.", "ConversationTurn.created_at"]
};
for (const [name, [description, source]] of Object.entries(timestamps)) definitions[name] = field(description, source, "Select the named event and serialize as ISO 8601 UTC; never subtract a client timestamp from a server timestamp.", "UTC timestamp");
definitions.close_reason = { ...definitions.reason, source: "First closed observation.reason" };

const itemAliases: Record<string, string> = {
  answer_time_ms: "answer.response_elapsed_ms", first_action_ms: "answer.time_to_first_action_ms",
  reasoning_start_latency_ms: "reasoning.input_start_latency_ms", reasoning_time_ms: "reasoning.response_elapsed_ms",
  reasoning_input_elapsed_ms: "reasoning.input_elapsed_ms", confidence_time_ms: "confidence.response_elapsed_ms"
};
for (const [name, from] of Object.entries(itemAliases)) definitions[name] = field(
  `First observed initial/transfer ${from.split(".")[0]} stage summary; not necessarily the first real exposure.`,
  "Derived response_stage_visits.csv", `Select the first visit by ready_at client-UTC ordering among initial/transfer visits of the named stage; copy ${from}. Blank if visit/value absent. Do not sum these summaries with their source visits.`, "milliseconds");

export function responseStageDictionaryRows(tables: { path: string; columns: readonly string[] }[]) {
  return tables.flatMap(table => table.columns.map(variable_name => {
    const base = definitions[variable_name];
    if (!base) throw new Error(`Undocumented response-stage variable: ${table.path}.${variable_name}`);
    let entry = base;
    if (table.path === "item_behavior_summary.csv" && ["system_wait_ms", "hidden_duration_ms", "submission_count", "validation_rejection_count"].includes(variable_name)) {
      entry = { ...base, source: "Derived response_stage_visits.csv", calculation: variable_name.endsWith("_ms")
        ? `SUM(${variable_name}) across initial/transfer visits for this item, only if at least one visit exists and all values are nonblank; otherwise blank. Review/revision visits are excluded.`
        : `SUM(${variable_name}) across initial/transfer visits for this item; 0 for no observed visits. Review/revision visits are excluded; inspect observed_stage_visit_count before interpreting zero.` };
    }
    return { dataset: table.path, variable_name, ...entry, calculation_version: RESPONSE_STAGE_CALCULATION_VERSION };
  }));
}
