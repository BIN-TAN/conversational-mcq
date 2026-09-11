import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { parse } from "csv-parse/sync";
import JSZip from "jszip";
import { createResponseCollectionFixture, cleanupResponseCollectionFixture } from "./response-collection-smoke-fixture";

// This diagnostic intentionally exits nonzero when an analysis contract fails.
// Never run it on an operational database; all records are disposable fixtures.
const databaseUrl = new URL(process.env.DATABASE_URL ?? "");
assert(["localhost", "127.0.0.1"].includes(databaseUrl.hostname));
assert(databaseUrl.pathname.startsWith("/conversational_mcq_classroom_audit_"));
assert(process.env.NODE_OPTIONS?.includes("classroom-audit-network-guard.mjs"));
process.env.LLM_PROVIDER = "mock";
process.env.LLM_LIVE_CALLS_ENABLED = "false";
process.env.ITEM_ADMIN_TUTOR_MODE = "mock";
process.env.ALLOW_LOCAL_MOCK_RUNTIME = "true";
process.env.OPERATIONAL_LIVE_CANARY_DATABASE_URL_ACTIVE = "false";
process.env.OPENAI_API_KEY = "";
process.env.OPENAI_API_KEY_FILE = "";
process.env.RESEARCH_PSEUDONYMIZATION_KEY = "research-audit-synthetic-only-key";
let networkAttempts = 0;
globalThis.fetch = async () => {
  networkAttempts += 1;
  throw new Error("research_audit_network_forbidden");
};

type Row = Record<string, string>;
type Result = { name: string; passed: boolean; observed: unknown };
const results: Result[] = [];
function check(name: string, passed: boolean, observed: unknown) {
  results.push({ name, passed, observed });
}
const database = new PrismaClient();
const prefix = `research_audit_${randomUUID().replaceAll("-", "")}`;
const output = path.resolve(process.env.AUDIT_OUTPUT_DIR ?? "/tmp/cmcq-research-data-audit-20260911");
assert(output.startsWith("/tmp/") || output.startsWith("/private/tmp/"));

async function main() {
  const { prisma } = await import("../src/lib/db");
  const service = await import("../src/lib/services/student-assessment/service");
  const { completeInitialItem } = await import("./student-mvp-smoke-helpers");
  const { buildAnalysisReadyResearchDataBundle } = await import("../src/lib/services/teacher-research-data/analysis-ready-export");
  const { deriveSessionTiming, deriveItemTiming } = await import("../src/lib/services/student-assessment/timing-contract");
  let cleanupSucceeded = false;
  let fixtureCounts: Record<string, number> = {};
  try {
    const fixture = await createResponseCollectionFixture({ prisma: database, prefix, responseCollectionMode: "deterministic" });
    await database.item.update({ where: { id: fixture.items[0].id }, data: {
      options: ["A", "B", "C", "D", "E", "F"].map((label) => ({ label, text: `Synthetic option ${label}` }))
    } });
    for (let order = 4; order <= 8; order += 1) {
      const seed = fixture.items[0];
      await database.item.create({ data: {
        item_public_id: `${prefix}_item_${order}`,
        concept_unit_db_id: fixture.conceptUnit.id,
        item_order: order,
        item_stem: `Synthetic item ${order}`,
        options: seed.options!,
        correct_option: seed.correct_option,
        status: "published",
        included_in_published_set: true,
        administration_rules: { item_role: "initial" }
      } });
    }
    const student = { student_user_db_id: fixture.student.id, session_public_id: fixture.session.session_public_id };
    let state = await service.startConceptUnitInitialAdministration({ ...student, concept_unit_public_id: fixture.conceptUnit.concept_unit_public_id });
    for (let index = 1; index <= 8; index += 1) {
      state = await completeInitialItem({ studentDbId: fixture.student.id, sessionPublicId: fixture.session.session_public_id, prefix, state, itemIndex: index, withTemptingReason: index === 1 });
    }
    await service.ingestFrontendProcessEvents({ ...student, data: { event_type: "typing_activity_summary", item_public_id: fixture.items[0].item_public_id, payload: { key_count: 17, backspace_count: 3, enter_key_count: 1, duration_ms: 4500 } } });
    await service.ingestFrontendProcessEvents({ ...student, data: { event_type: "paste_detected", item_public_id: fixture.items[0].item_public_id, payload: { target_kind: "textarea", pasted_text_length_band: "21_100", clipboard_type_count: 1, includes_plain_text: true } } });
    const retriedEvent = { event_type: "window_blur", client_event_id: randomUUID(), browser_tab_id: randomUUID(), client_occurred_at: new Date().toISOString() };
    await Promise.all(Array.from({ length: 8 }, () => service.ingestFrontendProcessEvents({ ...student, data: retriedEvent })));
    const duplicateCount = await database.processEvent.count({ where: { assessment_session_db_id: fixture.session.id, payload: { path: ["client_event_id"], equals: retriedEvent.client_event_id } } });
    check("concurrent ambiguous-delivery retries persist once", duplicateCount === 1, { persisted_count: duplicateCount, submitted_retries: 8 });
    await database.itemResponse.update({ where: { concept_unit_session_db_id_item_db_id: { concept_unit_session_db_id: fixture.conceptUnitSession.id, item_db_id: fixture.items[0].id } }, data: { reasoning_text: '=SYNTHETIC("quoted")\nsecond line, comma' } });
    const exportInput = { teacher_user_db_id: fixture.teacher.id, scope: "selected_assessment" as const, assessment_public_id: fixture.assessment.assessment_public_id };
    const bundle = await buildAnalysisReadyResearchDataBundle(exportInput);
    const archive = await JSZip.loadAsync(bundle.buffer, { checkCRC32: true });
    const archivePaths = Object.keys(archive.files).filter((name) => !archive.files[name].dir);
    let archiveMatches = archivePaths.length === bundle.files.length;
    for (const file of bundle.files) archiveMatches &&= await archive.file(file.path)?.async("string") === file.data;
    check("actual ZIP CRC, entry bytes and coverage match the export", archiveMatches, { entries: archivePaths.length });
    const rows = (filename: string, files = bundle.files): Row[] => parse(files.find((file) => file.path === filename)!.data, { columns: true, skip_empty_lines: true });
    const sessions = rows("sessions.csv");
    const responses = rows("item_responses.csv");
    const events = rows("process_events.csv");
    const content = rows("assessment_content.csv");
    const snapshotKey = (row: Row) => `${row.assessment_snapshot_public_id}|${row.item_snapshot_public_id}`;
    const contentKeys = new Set(content.map(snapshotKey));
    const submitted = await database.itemResponse.count({ where: { concept_unit_session_db_id: fixture.conceptUnitSession.id, item_submitted_at: { not: null } } });
    fixtureCounts = { sessions: sessions.length, submitted_items: submitted, exported_items: responses.length, exported_events: events.length };
    check("all eight completed item rows are retained", responses.length === 8 && submitted === 8, fixtureCounts);
    check("initial package summary counts all eight completed items", sessions[0].actual_initial_item_count === "8" && sessions[0].completed_initial_item_count === "8", { actual: sessions[0].actual_initial_item_count, completed: sessions[0].completed_initial_item_count, expected: 8 });
    check("one accepted confidence action counts once per item", responses.every((row) => row.confidence_selection_count === "1"), responses.map((row) => row.confidence_selection_count));
    check("response snapshot foreign keys resolve to content", responses.every((row) => contentKeys.has(snapshotKey(row))), { resolved: responses.filter((row) => contentKeys.has(snapshotKey(row))).length, total: responses.length });
    const scopedEvents = events.filter((row) => row.item_snapshot_public_id);
    check("process event snapshot foreign keys resolve to content", scopedEvents.every((row) => contentKeys.has(snapshotKey(row))), { resolved: scopedEvents.filter((row) => contentKeys.has(snapshotKey(row))).length, total: scopedEvents.length });
    const firstContent = content.find((row) => row.item_public_id === fixture.items[0].item_public_id)!;
    check("all six supported item options survive content export", Object.values(firstContent).includes("Synthetic option E") && Object.values(firstContent).includes("Synthetic option F"), { option_columns: Object.keys(firstContent).filter((key) => key.startsWith("option_")), administered_options: 6 });
    const unrelated = events.find((row) => row.event_type === "typing_activity_summary")!;
    check("non-applicable tempting-option boolean remains null", unrelated.payload_no_tempting_option === "", { event_type: unrelated.event_type, actual: unrelated.payload_no_tempting_option, expected: "empty" });
    check("captured typing and paste details reach normalized export", unrelated.payload_key_count === "17" && events.some((row) => row.event_type === "paste_detected" && row.payload_pasted_text_length_band === "21_100"), { typing_key_count_column_present: Object.hasOwn(unrelated, "payload_key_count"), paste_length_band_column_present: Object.hasOwn(unrelated, "payload_pasted_text_length_band"), persisted_key_count: 17 });
    check("CSV multiline text round-trips with formula neutralization", responses[0].reasoning_text === '\'=SYNTHETIC("quoted")\nsecond line, comma', { formula_neutralized: responses[0].reasoning_text.startsWith("'="), row_count: responses.length });
    const sessionKeys = new Set(sessions.map((row) => row.session_public_id));
    check("all session foreign keys resolve", bundle.files.filter((file) => file.path.endsWith(".csv")).every((file) => rows(file.path).every((row) => !row.session_public_id || sessionKeys.has(row.session_public_id))), { files: bundle.files.length });
    check("returned CSV row counts equal parsed counts", bundle.files.filter((file) => file.path.endsWith(".csv")).every((file) => rows(file.path).length === bundle.row_counts[file.path]), { files: bundle.files.length });
    check("ordinary export excludes raw account identifiers", !bundle.files.some((file) => file.data.includes(fixture.student.user_id) || file.data.includes(fixture.student.id)), { files_checked: bundle.files.length });
    check("ordinary item content excludes restricted key columns", !Object.hasOwn(responses[0], "correct_option") && !Object.hasOwn(content[0], "correct_option"), { restricted_columns_absent: true });
    check("standard ZIP contains a reproducibility manifest", bundle.files.some((file) => /manifest.*\.json$/.test(file.path)), { files: bundle.files.map((file) => file.path), row_counts_only_returned_to_caller: true });
    const manifestFile = bundle.files.find((file) => file.path === "research_manifest.json");
    if (manifestFile) {
      const manifest = JSON.parse(manifestFile.data);
      check("manifest hashes and coverage match all other ZIP entries", manifest.entries.length === bundle.files.length - 1 && manifest.entries.every((entry: { path: string; sha256: string; rows: number | null }) => {
        const file = bundle.files.find((entryFile) => entryFile.path === entry.path);
        return file && createHash("sha256").update(file.data).digest("hex") === entry.sha256 && (entry.rows === null || bundle.row_counts[entry.path] === entry.rows);
      }), { listed: manifest.entries.length, actual: bundle.files.length - 1 });
    }

    // Back-dated arrival is possible for buffered client events; old event joins must not move.
    const beforeKey = events[0].event_public_id;
    const beforeTimestamp = events[0].occurred_at;
    const beforeType = events[0].event_type;
    await service.ingestFrontendProcessEvents({ ...student, data: { event_type: "window_focus", client_occurred_at: "2026-01-01T00:00:00.000Z" } });
    const later = await buildAnalysisReadyResearchDataBundle(exportInput);
    const laterOriginal = rows("process_events.csv", later.files).find((row) => row.occurred_at === beforeTimestamp && row.event_type === beforeType);
    check("event public identity survives a delayed earlier event", laterOriginal?.event_public_id === beforeKey, { before_suffix: beforeKey.split(":event:")[1], after_suffix: laterOriginal?.event_public_id.split(":event:")[1] });
    const restricted = await buildAnalysisReadyResearchDataBundle({ ...exportInput, include_restricted_fields: true });
    check("explicit restricted export retains scored outcome", rows("item_responses.csv", restricted.files).every((row) => row.correct_option === "A" && row.correctness === "correct"), { rows: responses.length });
    await database.user.update({ where: { id: fixture.student.id }, data: { account_status: "inactive" } });
    const inactive = await buildAnalysisReadyResearchDataBundle(exportInput);
    check("deactivation preserves historical response rows and pseudonym", rows("item_responses.csv", inactive.files).length === 8 && rows("sessions.csv", inactive.files)[0].research_student_id === sessions[0].research_student_id, { rows: rows("item_responses.csv", inactive.files).length });

    const at = (seconds: number) => new Date(Date.UTC(2026, 8, 11) + seconds * 1000);
    const idle = deriveSessionTiming({ session_started_at: at(0), session_completed_at: at(300), events: [
      { event_type: "long_pause", occurred_at: at(120), pause_duration_ms: 120_000 },
      { event_type: "inactivity_detected", occurred_at: at(300), pause_duration_ms: 300_000 }
    ] });
    check("overlapping idle thresholds do not exceed elapsed time", idle.session_idle_time_ms !== null && idle.session_idle_time_ms <= 300_000, { idle_ms: idle.session_idle_time_ms, elapsed_ms: idle.session_wall_clock_elapsed_ms, expected_idle_ms: 300_000 });
    const paused = deriveSessionTiming({ session_started_at: at(0), session_completed_at: at(720), events: [
      { event_type: "attempt_paused", occurred_at: at(60) },
      { event_type: "page_visibility_hidden", occurred_at: at(60) },
      { event_type: "page_visibility_visible", occurred_at: at(660) },
      { event_type: "attempt_resumed", occurred_at: at(660) }
    ] });
    check("hidden time while paused is not subtracted from active windows again", paused.session_visible_window_ms === 120_000, { active_ms: paused.session_resumable_active_window_ms, visible_ms: paused.session_visible_window_ms, expected_visible_ms: 120_000 });
    const noBrowser = deriveSessionTiming({ session_started_at: at(0), session_completed_at: at(60), events: [] });
    check("absent visibility instrumentation is not reported as measured visible time", noBrowser.session_visible_window_ms === null, { visible_ms: noBrowser.session_visible_window_ms, quality: noBrowser.timing_quality_status });
    check("unmeasured active interaction stays null", noBrowser.session_active_interaction_time_ms === null, { active_interaction_ms: noBrowser.session_active_interaction_time_ms });
    const typing = deriveItemTiming({ events: [
      { event_type: "typing_activity_summary", occurred_at: at(10), payload: { active_typing_time_ms: 2000 } },
      { event_type: "typing_activity_summary", occurred_at: at(20), payload: { active_typing_time_ms: 3000 } }
    ] });
    check("documented active typing sum includes all valid summaries", typing.reasoning_active_typing_time_ms === 5000, { actual_ms: typing.reasoning_active_typing_time_ms, expected_ms: 5000 });
    const { sendProcessEvents } = await import("../src/components/student-assessment/api");
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = async () => new Response(null, { status: 500 });
      let rejected = false;
      try {
        await sendProcessEvents("synthetic_session", [{ event_type: "window_focus" }]);
      } catch {
        rejected = true;
      }
      check("rejected telemetry HTTP requests are surfaced as failed delivery", rejected, { simulated_http_status: 500, client_reported_success: !rejected });
    } finally {
      globalThis.fetch = originalFetch;
    }
    const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
    try {
      globalThis.fetch = async () => new Response(null, { status: 500 });
      Object.defineProperty(globalThis, "navigator", { configurable: true, value: { sendBeacon: () => false } });
      let rejected = false;
      try {
        await sendProcessEvents("synthetic_session", [{ event_type: "window_blur" }], true);
      } catch {
        rejected = true;
      }
      check("refused beacon is surfaced as failed delivery", rejected, { simulated_beacon_accepted: false, client_reported_success: !rejected });
    } finally {
      globalThis.fetch = originalFetch;
      if (navigatorDescriptor) Object.defineProperty(globalThis, "navigator", navigatorDescriptor);
      else Reflect.deleteProperty(globalThis, "navigator");
    }
    check("no provider or model-auth request attempted", networkAttempts === 0, { attempted_fetch_requests: networkAttempts });
    await mkdir(output, { recursive: true });
    await writeFile(path.join(output, "synthetic-research-dataset.zip"), bundle.buffer);
    await writeFile(path.join(output, "synthetic-file-hashes.json"), JSON.stringify(bundle.files.map((file) => ({ path: file.path, records: bundle.row_counts[file.path], sha256: createHash("sha256").update(file.data).digest("hex") })), null, 2));
  } finally {
    const assessments = await database.assessment.findMany({ where: { title: { startsWith: prefix } }, select: { id: true } });
    await database.assessmentLifecycleOperation.deleteMany({ where: { assessment_session: { assessment_db_id: { in: assessments.map((row) => row.id) } } } });
    await cleanupResponseCollectionFixture(database, prefix);
    cleanupSucceeded = true;
    await prisma.$disconnect();
    await database.$disconnect();
  }
  const report = { status: results.every((result) => result.passed) ? "passed" : "findings_confirmed", fixture_counts: fixtureCounts, passed: results.filter((result) => result.passed).length, failed: results.filter((result) => !result.passed).length, provider_calls: 0, model_auth_requests: 0, real_dispatch_checkpoints: 0, network_attempts: networkAttempts, cleanup_succeeded: cleanupSucceeded, results };
  await mkdir(output, { recursive: true });
  await writeFile(path.join(output, "results.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.failed ? 1 : 0;
}

main().catch(async (error: unknown) => {
  console.error(error instanceof Error ? error.message : "research_audit_failed");
  await database.$disconnect();
  process.exitCode = 1;
});
