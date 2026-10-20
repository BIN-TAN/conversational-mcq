/**
 * Database-free checks for the research export of formative conversation openings, endings
 * and engagement (RQ3), and for the dictionary repairs that accompany them: end_reason,
 * opening_status, engaged_duration_ms, message_type, and specific definitions in the
 * formative_conversation_*, sessions.csv, attempt comparison, response-stage and AI call
 * audit dictionaries. Run with:
 *
 *   npx tsx prisma/research-export-conversation-outcome-unit-test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parse } from "csv-parse/sync";

process.env.DATABASE_URL ??= "postgresql://synthetic:synthetic@127.0.0.1:5432/conversation_outcome_unit";
process.env.SESSION_SECRET ??= "conversation-outcome-unit-test-session-secret-0000000";
process.on("unhandledRejection", (error) => {
  if ((error as { name?: string })?.name === "PrismaClientInitializationError") return;
  console.error(error);
  process.exitCode = 1;
});

let passed = 0;
async function check(name: string, run: () => void | Promise<void>) {
  await run();
  passed += 1;
  console.log(`ok - ${name}`);
}
const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

async function main() {
  const outcome = await import("../src/lib/services/teacher-research-data/conversation-outcome");
  const { FORMATIVE_CONVERSATION_OPENING_CLIENT_MESSAGE_ID } = await import("../src/lib/services/student-assessment/formative-conversation/opening-contract");

  await check("end_reason separates student stops, the turn limit, system closes and finished attempts", () => {
    const open = { completed: false, terminal: false };
    const end = (status: string, lifecycle_reason: string | null, attempt = open) => outcome.conversationEndReason({ status, lifecycle_reason }, attempt);
    assert.equal(end("ended", "student_ended_conversation"), "student_ended");
    assert.equal(end("ended", "student_ended_attempt", { completed: false, terminal: true }), "student_ended_attempt");
    assert.equal(end("ended", "llm_terminal_recommendation:final_allowed_turn_terminal_recommendation_recorded"), "turn_limit_reached");
    assert.equal(end("ended", "platform_student_turn_limit_terminal_recommendation_unavailable"), "turn_limit_reached");
    assert.equal(end("ended", "platform_failure:synthetic"), "closed_by_system");
    assert.equal(end("active", null, { completed: true, terminal: true }), "attempt_finished_while_active");
    assert.equal(end("paused", "student_paused", { completed: true, terminal: true }), "attempt_finished_while_active");
    assert.equal(end("active", "student_resumed", { completed: false, terminal: true }), "attempt_ended_while_active");
    assert.equal(end("active", "student_resumed"), "still_active");
    assert.equal(end("completed", "llm_terminal_recommendation:sound"), "other");
    assert.equal(end("ended", null), "other");
    // The reasons end_reason relies on are the ones the runtime stores (feedback v8 included).
    const runtime = source("src/lib/services/student-assessment/formative-conversation/runtime.ts");
    assert.match(runtime, /isFeedbackV8Context\(compiled\.context\) && compiled\.context\.lifecycle\.final_allowed_turn/);
    assert.match(runtime, /source: "llm_terminal_recommendation",\s+reason_code: "final_allowed_turn_terminal_recommendation_recorded"/);
    assert.match(runtime, /"student_turn_limit_terminal_recommendation_unavailable"/);
    const service = source("src/lib/services/student-assessment/formative-conversation/service.ts");
    assert.match(service, /lifecycle_reason: `\$\{input\.source\}:\$\{input\.reason_code\}`/);
    assert.match(service, /lifecycle_reason: `platform_\$\{input\.reason_code\}`/);
    assert.match(source("src/lib/services/student-assessment/formative-conversation/projection.ts"), /lifecycle_reason: "student_ended_conversation"/);
    assert.match(source("src/lib/services/student-assessment/service.ts"), /lifecycle_reason: "student_ended_attempt"/);
  });

  await check("engagement: participation, last turn and engaged duration from display or the opening", () => {
    const t0 = Date.parse("2026-10-20T10:00:00.000Z");
    const at = (seconds: number) => new Date(t0 + seconds * 1000);
    const opening = { actor_type: "agent", created_at: at(0) };
    const turns = [opening, { actor_type: "student", created_at: at(60) }, { actor_type: "agent", created_at: at(90) }];
    assert.deepEqual(outcome.conversationEngagement(turns, at(5).toISOString()), {
      student_participated: true, last_turn_at: at(90).toISOString(), engaged_duration_ms: 85_000
    });
    assert.equal(outcome.conversationEngagement(turns, null).engaged_duration_ms, 90_000, "Without a display receipt the opening starts the span");
    assert.equal(outcome.conversationEngagement(turns, at(70).toISOString()).engaged_duration_ms, 30_000, "A late display receipt never starts after the first student message");
    assert.deepEqual(outcome.conversationEngagement([opening], at(5).toISOString()), {
      student_participated: false, last_turn_at: at(0).toISOString(), engaged_duration_ms: 0
    }, "Reading the opening and stopping is a zero-length turn span, not missing data");
    assert.deepEqual(outcome.conversationEngagement([], null), { student_participated: false, last_turn_at: null, engaged_duration_ms: null });
  });

  await check("opening_status distinguishes delivered, failed, blocked, pending, interrupted and not requested openings", () => {
    const now = new Date("2026-10-20T10:30:00.000Z");
    const receipt = (fields: Record<string, unknown>) => [{
      client_message_id: FORMATIVE_CONVERSATION_OPENING_CLIENT_MESSAGE_ID, status: "reserved", assistant_turn_db_id: null,
      failure_code: null, assistant_response_last_failure_category: null, response_payload: {}, updated_at: now, ...fields
    }];
    const studentReceipt = { ...receipt({})[0], client_message_id: "student-message-1", status: "assistant_turn_persisted", assistant_turn_db_id: "turn-2" };
    assert.deepEqual(outcome.openingOutcome(receipt({ status: "assistant_turn_persisted", assistant_turn_db_id: "turn-1" }), [], now),
      { opening_status: "delivered", opening_failure_code: null });
    assert.deepEqual(outcome.openingOutcome(receipt({ status: "assistant_turn_persisted", assistant_turn_db_id: "turn-1",
      assistant_response_last_failure_category: "formative_conversation_opening_validation_failed" }), [], now),
    { opening_status: "delivered", opening_failure_code: "formative_conversation_opening_validation_failed" }, "A recovered failure stays visible");
    assert.deepEqual(outcome.openingOutcome(receipt({ status: "failed", failure_code: "feedback_v8_not_approved",
      response_payload: { retryable: false } }), [], now), { opening_status: "blocked", opening_failure_code: "feedback_v8_not_approved" });
    assert.deepEqual(outcome.openingOutcome(receipt({ status: "failed", failure_code: "formative_conversation_opening_generation_failed",
      response_payload: { retryable: true } }), [], now), { opening_status: "failed", opening_failure_code: "formative_conversation_opening_generation_failed" });
    assert.equal(outcome.openingOutcome(receipt({ updated_at: new Date(now.getTime() - 60_000) }), [], now).opening_status, "pending");
    assert.equal(outcome.openingOutcome(receipt({ updated_at: new Date(now.getTime() - 7 * 60_000) }), [], now).opening_status, "interrupted");
    assert.equal(outcome.openingOutcome([studentReceipt], [], now).opening_status, "not_requested");
    assert.equal(outcome.openingOutcome([], [{ structured_payload: { message_type: "formative_conversation_opening" } }], now).opening_status, "delivered");
  });

  await check("message_type identifies the opening, replies, student messages and the handoff message", () => {
    assert.equal(outcome.conversationMessageType("agent", { message_type: "formative_conversation_opening" }), "opening");
    assert.equal(outcome.conversationMessageType("agent", { message_type: "formative_conversation_tutor_message" }), "reply");
    assert.equal(outcome.conversationMessageType("student", { message_type: "formative_conversation_student_message" }), "student");
    assert.equal(outcome.conversationMessageType("agent", { message_type: "formative_conversation_lifecycle_handoff" }), "lifecycle_handoff");
    assert.equal(outcome.conversationMessageType("agent", { message_type: "next_interaction" }), "next_interaction");
    assert.equal(outcome.conversationMessageType("student", null), "student");
    assert.equal(outcome.conversationMessageType("agent", {}), null);
  });

  await check("formative_conversation_* dictionary: every column specific, new columns documented, raw end columns explained", async () => {
    const { formativeConversationDataDictionaryRows } = await import("../src/lib/services/teacher-research-data/analysis-ready-export");
    const rows = formativeConversationDataDictionaryRows();
    const entry = (dataset: string, variable: string) => {
      const row = rows.find((candidate) => candidate.dataset === dataset && candidate.variable === variable);
      assert.ok(row, `${dataset}.${variable}`);
      return row!;
    };
    for (const row of rows.filter((candidate) => candidate.dataset.startsWith("formative_conversation_"))) {
      assert.doesNotMatch(row.definition, / for one formative conversation | records linked to the conversation\.|^Timestamp for |^Persisted retry count applicable/,
        `${row.dataset}.${row.variable} has a specific definition`);
    }
    for (const variable of ["end_reason", "opening_status", "opening_failure_code", "student_participated", "last_turn_at", "engaged_duration_ms"]) {
      assert.equal(entry("formative_conversation_sessions", variable).source_nature, variable === "opening_failure_code"
        ? "directly_recorded_observable_or_operational" : "derived_from_persisted_observations", variable);
    }
    assert.match(entry("formative_conversation_sessions", "end_reason").definition, /attempt_finished_while_active/);
    assert.match(entry("formative_conversation_sessions", "opening_status").definition, /feedback_v8_not_approved/);
    assert.match(entry("formative_conversation_sessions", "lifecycle_termination_source").definition, /final_allowed_turn_terminal_recommendation_recorded, including for feedback v8/);
    assert.match(entry("formative_conversation_sessions", "wall_clock_duration_ms").definition, /created the conversation record/);
    assert.match(entry("formative_conversation_sessions", "started_at").definition, /precedes the opening message/);
    assert.equal(entry("formative_conversation_sessions", "engaged_duration_ms").unit, "milliseconds");
    assert.match(entry("formative_conversation_turns", "message_type").definition, /opening/);
    assert.match(entry("formative_conversation_turns", "input_token_count").definition, /Provider-reported input tokens/);
    assert.match(entry("formative_conversation_llm_calls", "retry_count").definition, /formative-feedback-v8/);
    assert.match(entry("formative_conversation_events", "retry_count").definition, /assistant_response_retry_count/);
  });

  await check("sessions.csv dictionary entries are specific", async () => {
    const { buildAnalysisReadyDictionaryEntries } = await import("../src/lib/services/teacher-research-data/dictionary");
    const sessions = buildAnalysisReadyDictionaryEntries().filter((entry) => entry.table_name === "sessions");
    assert.ok(sessions.length > 100);
    for (const entry of sessions) {
      assert.doesNotMatch(entry.definition, /describes the canonical session-level|records or events represented in the|timestamp recorded for the .* row from the|measured value for the .* row, computed by|Number of .* records? associated/,
        `sessions.${entry.variable_name} has a specific definition`);
    }
    const definition = (variable: string) => sessions.find((entry) => entry.variable_name === variable)!.definition;
    assert.match(definition("answer_review_display_acknowledgement"), /package_results_shown/);
    assert.match(definition("folder_week_module"), /folder, week or module label/);
    assert.match(definition("estimated_guessing_risk_max"), /Always blank/);
  });

  await check("attempt comparison dictionary defines every column (missing definitions throw)", async () => {
    const { attemptComparisonExportFiles } = await import("../src/lib/services/teacher-research-data/attempt-comparison-export");
    const exportSource = source("src/lib/services/teacher-research-data/attempt-comparison-export.ts");
    assert.match(exportSource, /throw new Error\(`Undocumented attempt comparison variable/);
    for (const include_restricted of [false, true]) {
      const files = attemptComparisonExportFiles({ attempts: [], snapshot_at: "2026-10-20T00:00:00.000Z", pseudonym: (value) => `rs_${value}`,
        include_restricted, scope: "all_authorized" });
      const rows = parse(files.find((file) => file.path === "attempt_data_dictionary.csv")!.data, { columns: true }) as Array<Record<string, string>>;
      assert.ok(rows.length > 50);
      for (const row of rows) assert.notEqual(row.definition, row.column.replaceAll("_", " "), `${row.dataset}.${row.column}`);
      const responseCount = rows.filter((row) => row.column === "response_count").map((row) => row.definition);
      assert.equal(new Set(responseCount).size, 2, "response_count is defined per file");
    }
  });

  await check("response-stage joins: tutor displays join formative_conversation_turns.turn_sequence_index", async () => {
    const { responseStageDictionaryRows } = await import("../src/lib/services/teacher-research-data/response-stage-dictionary");
    const rows = responseStageDictionaryRows([
      { path: "feedback_exposure_events.csv", columns: ["source_turn_sequence_index"] },
      { path: "response_revision_history.csv", columns: ["source_turn_sequence_index"] }
    ]) as Array<Record<string, unknown>>;
    const text = (path: string) => JSON.stringify(rows.find((row) => row.dataset === path));
    assert.match(text("feedback_exposure_events.csv"), /formative_conversation_turns\.csv turn_sequence_index/);
    assert.match(text("response_revision_history.csv"), /conversation_turns\.csv has no sequence column/);
    assert.doesNotMatch(JSON.stringify(rows), /Join within session_public_id to conversation_turns\.csv/);
  });

  await check("AI call audit retry_count states the v8 attempt semantics", async () => {
    const { AI_CALL_AUDIT_DEFINITIONS } = await import("../src/lib/services/teacher-research-data/ai-call-audit-export");
    assert.match(AI_CALL_AUDIT_DEFINITIONS.retry_count, /attempt number - 1/);
    assert.match(AI_CALL_AUDIT_DEFINITIONS.retry_count, /Feedback v8 \(schema_version formative-feedback-v8\): one row per generation request/);
  });

  console.log(`\n${passed} conversation outcome export checks passed; no database or provider calls.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
