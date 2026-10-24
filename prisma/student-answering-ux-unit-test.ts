/**
 * Student answering path: performance and usability fixes (release cmcq-20261024-09-m1).
 * - Error notices and Try again sit right above the active step (role="alert" kept).
 * - Written-answer boxes stay focusable (read-only) while saving; focus returns to the step's
 *   first control after an error or a same-step result. Stage observations are unchanged.
 * - Reads (GET) give up after 15 seconds; runAction's order of awaits is unchanged.
 * - Process-event delivery keeps a slow retry, restarts when the page is visible again, drains
 *   on finish after earlier failures, and isolates events a server refuses (counted as a gap).
 * - Event ingestion looks up each question and topic once per batch; the row lock stays.
 * - Starting does not reload the list; the attempt page reads transcript and state together.
 * - Drafts are keyed by question and stage only.
 * - History bubbles say "Question N of M" (display only).
 * - Stale-step conflicts show one plain sentence and reload the state instead of a replay.
 * - Visible focus rings; labelled edit boxes; finishing does not blank the page.
 * No database or provider calls. Run with: npx tsx prisma/student-answering-ux-unit-test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createProcessEventDelivery, isRejection } from "../src/components/student-assessment/process-event-delivery";
import type { FrontendProcessEvent } from "../src/components/student-assessment/api";
import {
  STALE_STEP_NOTICE,
  STALE_STEP_REFRESH_FAILED_NOTICE,
  answeringStageKey,
  displayQuestionPositionLabel,
  isStaleStepError,
  shouldRestoreStageFocus,
  staleStepNotice,
  studentDraftIdentity
} from "../src/lib/student-assessment-ui/answering-ux";

let passed = 0;
async function check(name: string, run: () => void | Promise<void>) {
  await run();
  passed += 1;
  console.log(`ok - ${name}`);
}
const source = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8").replace(/\r\n/g, "\n");
const client = source("src/components/student-assessment/assessment-session-client.tsx");
const list = source("src/components/student-assessment/available-assessments-client.tsx");
const api = source("src/components/student-assessment/api.ts");
const processEvents = source("src/components/student-assessment/process-events.ts");
const service = source("src/lib/services/student-assessment/service.ts");
const between = (text: string, start: string, end: string) => {
  const from = text.indexOf(start);
  assert(from >= 0, start);
  const to = text.indexOf(end, from + start.length);
  assert(to >= 0, end);
  return text.slice(from, to);
};

function fakeTimers() {
  type Timer = { run: () => void; ms: number; cleared: boolean; fired: boolean };
  const all: Timer[] = [];
  return {
    all,
    timers: {
      set: (run: () => void, ms: number) => { const timer = { run, ms, cleared: false, fired: false }; all.push(timer); return timer; },
      clear: (handle: unknown) => { (handle as Timer).cleared = true; }
    },
    pending: () => all.filter((timer) => !timer.cleared && !timer.fired),
    fire() {
      const timer = all.filter((candidate) => !candidate.cleared && !candidate.fired).at(-1);
      assert(timer, "a timer is scheduled");
      timer.fired = true;
      timer.run();
      return timer.ms;
    }
  };
}
const settle = async () => { for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setImmediate(resolve)); };
const memoryStorage = () => {
  const stored = new Map<string, string>();
  return { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => { stored.set(key, value); }, removeItem: (key: string) => { stored.delete(key); } };
};

async function main() {
  await check("History bubbles say Question N of M; the stored text is untouched", () => {
    const stored = "Item 1 of 5\n\nWhich graph shows a constant rate?\n\nA. One\nB. Two";
    assert.equal(displayQuestionPositionLabel(stored), stored.replace("Item 1 of 5", "Question 1 of 5"));
    assert.equal(displayQuestionPositionLabel("Item 12 of 20"), "Question 12 of 20");
    assert.equal(displayQuestionPositionLabel("Item 3 of 5\r\nStem"), "Question 3 of 5\r\nStem");
    for (const unchanged of ["Item 1 of 5 is ready for review.", "For Item 1 of 5, option B says...", "Thanks. Here is the next question."]) {
      assert.equal(displayQuestionPositionLabel(unchanged), unchanged);
    }
    assert.match(between(client, "function displayTranscriptText", "\nfunction formatTranscriptTimestamp"),
      /return displayQuestionPositionLabel\(entry\.message_text\);/);
    // Release 09 decision 4 adds one item_stem use (the reminder in later steps); the others are unchanged.
    assert.equal(client.split("asset.placement").length - 1, 5, "item media placement is unchanged");
  });

  await check("Drafts are keyed by question and stage only, and stay in this tab", () => {
    assert.equal(studentDraftIdentity({ item_public_id: "item_a" }), "item_a");
    assert.equal(studentDraftIdentity(null), null);
    assert(!/itemIdentity = [^\n]*existing_selected_option/.test(client));
    assert(client.includes('useStudentDraft(draftKey("tempting", itemIdentity))'));
    assert(client.includes('useStudentDraft(draftKey("reasoning", itemIdentity))'));
    // Drafts live in sessionStorage only; the drafts module never sends anything.
    const drafts = source("src/components/student-assessment/session-drafts.ts");
    assert(!/fetch\(|sendProcessEvents|enqueue\(/.test(drafts + source("src/components/student-assessment/use-student-draft.ts")));
  });

  await check("Stale-step conflicts get one plain sentence and no replay", () => {
    for (const code of ["invalid_phase_for_action", "item_not_in_current_concept_unit", "concept_unit_not_current",
      "initial_response_locked_after_concept_completion", "item_not_included_in_published_set", "idempotency_conflict"]) {
      assert.equal(isStaleStepError({ code, status: 409 }), true, code);
    }
    assert.equal(isStaleStepError({ code: "conflict", status: 409 }), true);
    assert.equal(isStaleStepError({ code: "conflict", status: 500 }), false, "an unexpected server error keeps Try again");
    for (const code of ["session_start_conflict", "attempt_open_elsewhere", "missing_evidence_confirmation_required",
      "validation_failed", "request_failed", "request_timeout", "service_unavailable"]) {
      assert.equal(isStaleStepError({ code, status: 409 }), false, code);
    }
    assert.equal(staleStepNotice(), STALE_STEP_NOTICE);
    assert.equal(STALE_STEP_NOTICE, "This step was already saved. Here is where you left off.");
    assert.equal(staleStepNotice({ terminal: true }), "This attempt has already ended. Your answers are saved.");
    assert.equal(staleStepNotice({ paused: true }), "This attempt is paused. Select \"Resume attempt\" to continue.");
    assert.equal(staleStepNotice(null), STALE_STEP_REFRESH_FAILED_NOTICE);
    const handleError = between(client, "  function handleError(", "\n  function handleFormativeConversationDraft");
    assert(handleError.includes("options?.answeringStep && isStaleStepError(apiError)"));
    assert(handleError.includes("setFailedAction(null);\n      void showWhereTheStudentLeftOff();"));
    assert(handleError.includes("await fetchSessionState(sessionPublicId)"));
    assert(client.includes("}, { answeringStep: true });"));
    assert(!service.includes("Please retry shortly"), "the duplicated sentence is gone");
    assert.equal(service.split('"session_start_conflict", "We are still saving your last step. Wait a few seconds, then try again.", 409').length - 1, 1,
      "the error code is unchanged");
  });

  await check("runAction keeps its order of awaits", () => {
    const runAction = between(client, "  async function runAction(", "\n  const completingReadyItemRef");
    const order = ["const nextState = await action(tracked?.link, attempt.id);", "tracked?.finish();", "setState(nextState);",
      "await refreshSecondaryData(nextState.session_public_id, nextState.assessment_state);", "} catch (errorValue) {", "tracked?.finish(true);",
      "} finally {", "setIsBusy(false);"];
    let at = -1;
    for (const step of order) {
      const next = runAction.indexOf(step, at + 1);
      assert(next > at, step);
      at = next;
    }
  });

  await check("Reads give up after 15 seconds", () => {
    assert.match(api, /export const STUDENT_GET_TIMEOUT_MS = 15_000;/);
    const get = between(api, "async function get<T>(", "\n/**\n * D11");
    assert(get.includes("signal: read.signal"));
    assert(get.includes("read.timedOut() && !signal?.aborted"));
    assert(get.includes('code: "request_timeout"'));
    assert(get.includes("read.dispose()"));
    for (const reader of ["fetchSessionState", "fetchStudentTranscript", "fetchStudentReview"]) {
      assert.match(between(api, `export function ${reader}(`, "\n}\n"), /return get\(/, reader);
    }
  });

  await check("The notice and Try again sit right above the active step", () => {
    const transcript = between(client, "<ChatTranscript>", "</ChatTranscript>");
    const notice = transcript.indexOf("<ErrorNotice error={error} />");
    const retry = transcript.indexOf('data-testid="retry-save-action"');
    const stage = transcript.indexOf('data-testid="active-response-stage"');
    const lastHistory = transcript.lastIndexOf("<FormativeConversationBubble turn={turn} />");
    assert(lastHistory < notice && notice < retry && retry < stage, "notice, retry, then the active step");
    assert.equal(transcript.split("<ErrorNotice").length - 1, 1);
    assert.match(between(client, "function ErrorNotice(", "\nfunction displayTranscriptText"), /role="alert"/);
  });

  await check("Answer boxes stay focusable while saving; observations are unchanged", () => {
    const composer = between(client, "function TextComposer(", "\nfunction PackageReviewMessage(");
    assert(composer.includes("readOnly={busy}"));
    assert(composer.includes("aria-disabled={busy || undefined}"));
    assert(composer.includes("disabled={disabled || busy || !value.trim()}"), "the send button stays disabled");
    assert(composer.includes("if (!busy && !disabled) onSend();"));
    for (const label of ["Reason for answer", "Tempting option reason"]) {
      assert(client.includes(`busy={isBusy}\n          disabled={false}\n          label="${label}"`), label);
    }
    // Readiness still follows the busy flag, never the DOM disabled state.
    assert(client.includes("enabled: !readOnlyReview && !isLoading && Boolean(state?.session_public_id), busy: isBusy, send: sendObservation"));
    const hook = source("src/components/student-assessment/use-response-stage-observations.ts");
    assert(hook.includes("if (!enabled || busy || document.visibilityState !== \"visible\" || !root.current) return false;"));
    assert(!/disabled|readOnly|activeElement/.test(hook), "readiness does not read control state or focus");
    // Keys and pastes in a read-only box are classified as when the box was disabled.
    assert(processEvents.includes('if (inertWhileSaving(target)) return "other";'));
    assert(processEvents.includes("!inertWhileSaving(event.target) && event.target.closest(\"[data-paste-blocked]\")"));
  });

  await check("Focus returns to the step's first control without scrolling", () => {
    assert.equal(answeringStageKey({ assessment_state: "AWAIT_REASON", current_item: { item_public_id: "i1" } }), "AWAIT_REASON:i1");
    assert.equal(answeringStageKey(null), ":");
    assert.equal(shouldRestoreStageFocus({ activeIsBody: true, activeInsideStage: false, activeUsable: false }), true);
    assert.equal(shouldRestoreStageFocus({ activeIsBody: false, activeInsideStage: true, activeUsable: false }), true);
    assert.equal(shouldRestoreStageFocus({ activeIsBody: false, activeInsideStage: true, activeUsable: true }), false);
    assert.equal(shouldRestoreStageFocus({ activeIsBody: false, activeInsideStage: false, activeUsable: true }), false,
      "focus the student moved elsewhere is left alone");
    assert(client.includes("querySelector<HTMLElement>(STAGE_FIRST_CONTROL_SELECTOR)?.focus({ preventScroll: true })"));
    assert(client.includes("if (answeringStageKey(nextState) === stageBefore) setStageFocusRequest((request) => request + 1);"));
  });

  await check("Visible focus rings and labelled edit boxes", () => {
    for (const [name, text] of [["attempt page", client], ["assessment list", list]] as const) {
      for (const line of text.split("\n")) {
        if (line.includes("focus:ring-accent-soft")) assert(line.includes("resize-none"), `${name}: only text boxes keep the soft ring: ${line.trim().slice(0, 80)}`);
      }
    }
    assert(client.split("focus-visible:ring-2 focus-visible:ring-accent").length - 1 >= 8);
    assert(list.split("focus-visible:ring-2 focus-visible:ring-accent").length - 1 >= 6);
    assert(client.includes('aria-label="Your reason"'));
    assert(client.includes('aria-label="What made the other option tempting"'));
  });

  await check("Starting and opening an attempt send fewer requests", () => {
    const start = between(list, "async function handleStart(", "\n  async function handleEndCurrentAttempt");
    const success = between(start, "const result = await startAssessmentSession", "} catch (caught) {");
    assert(!success.includes("loadAssessments()"), "no list reload while navigating away");
    const load = between(client, "    async function load() {", "\n    void load();");
    assert(load.indexOf("transcriptRead = fetchStudentTranscript(resolvedInitialSessionPublicId);") <
      load.indexOf("nextState = await fetchSessionState(resolvedInitialSessionPublicId);"), "transcript read starts first");
    assert(load.includes("if (nextState.activity_runtime) transcriptRead = undefined;"), "activity state can add a turn: read again");
    for (const route of ["transcript", "state"]) {
      const handler = source(`src/app/api/student/sessions/[sessionPublicId]/${route}/route.ts`);
      assert(handler.includes("export async function GET(") && !handler.includes("export async function POST("), route);
    }
  });

  await check("Finishing on the page does not reload it", () => {
    assert(client.includes("}, [assessmentPublicId, requestedReadOnlyReview, resolvedInitialSessionPublicId]);"));
    assert(!client.includes("}, [assessmentPublicId, readOnlyReview, resolvedInitialSessionPublicId]);"));
    assert(client.includes("const readOnlyReview = requestedReadOnlyReview || state?.attempt_lifecycle?.terminal === true;"));
    const ended = between(client, "const attemptWasOpenHereRef = useRef(false);", "const navigation = useChatNavigation(");
    assert(ended.includes("void refreshSecondaryData(state.session_public_id, state.assessment_state);"));
  });

  await check("Event ingestion: one lookup per question and topic per batch; the row lock stays", () => {
    const ingest = between(service, "export async function ingestFrontendProcessEvents(", "\nexport async function exitStudentAssessmentSession");
    assert(ingest.includes("FOR UPDATE"), "sealing copies process-event counts under the same row lock");
    assert(!ingest.includes("pg_advisory"));
    assert(ingest.includes("itemLookups.get(itemLookupKey)") && ingest.includes("if (item) itemLookups.set(itemLookupKey, item);"));
    assert(ingest.includes("if (eventConceptUnitSession) conceptUnitSessionLookups.set(conceptUnitSessionLookupKey, eventConceptUnitSession);"));
    assert.equal(ingest.split("await tx.item.findFirst(").length - 1, 1);
    assert.equal(ingest.split("await tx.conceptUnitSession.findFirst(").length - 1, 1);
    // The recorded row is built exactly as before.
    for (const field of ["client_event_id: event.client_event_id", "client_occurred_at: event.client_occurred_at?.toISOString()",
      "occurred_at: event.client_occurred_at ?? serverReceivedAt", "item_db_id: item?.id", "concept_unit_session_db_id: eventConceptUnitSession?.id"]) {
      assert(ingest.includes(field), field);
    }
  });

  await check("Delivery: fast backoff, then a slow retry that never stops", async () => {
    const clock = fakeTimers();
    let online = false;
    const sends: string[][] = [];
    const queue = createProcessEventDelivery({ sessionId: "slow", tabId: randomUUID(), storage: memoryStorage(), timers: clock.timers,
      send: async (events) => { sends.push(events.map((event) => event.client_event_id!)); if (!online) throw new Error("offline"); } });
    queue.enqueue({ event_type: "window_focus" });
    await settle();
    const delays: number[] = [];
    for (let i = 0; i < 6; i += 1) { delays.push(clock.fire()); await settle(); }
    assert.deepEqual(delays, [2000, 4000, 8000, 16000, 60000, 60000]);
    assert.equal(sends.length, 7);
    assert.equal(new Set(sends.flat()).size, 1, "every retry reuses the same event id");
    assert.equal(clock.pending().at(-1)?.ms, 60000, "the slow retry is still scheduled");
    queue.enqueue({ event_type: "window_blur" });
    await settle();
    assert.equal(sends.length, 7, "while backing off slowly, new events wait for the next retry");
    online = true;
    await queue.retry();
    await settle();
    assert.equal(queue.pendingCount(), 0);
    queue.dispose();
    assert(processEvents.includes('const retryWhenVisible = () => { if (document.visibilityState === "visible") retry(); };'));
    assert(processEvents.includes('document.addEventListener("visibilitychange", retryWhenVisible);'));
  });

  await check("Delivery: finish drains after earlier failures, once, with keepalive", async () => {
    const clock = fakeTimers();
    let online = false;
    const sends: boolean[] = [];
    const queue = createProcessEventDelivery({ sessionId: "drain", tabId: randomUUID(), storage: memoryStorage(), timers: clock.timers,
      send: async (_events, keepalive) => { sends.push(keepalive); if (!online) throw new Error("offline"); } });
    queue.enqueue({ event_type: "window_focus" });
    await settle();
    for (let i = 0; i < 4; i += 1) { clock.fire(); await settle(); }
    assert.equal(sends.length, 5, "attempts exhausted");
    online = true;
    await queue.finish();
    assert.equal(queue.pendingCount(), 0);
    assert.deepEqual(sends.slice(5), [true]);
    assert.equal(clock.pending().length, 0, "nothing is left scheduled after finish");

    let failures = 0;
    const offline = createProcessEventDelivery({ sessionId: "drain-offline", tabId: randomUUID(), storage: memoryStorage(), timers: clock.timers,
      send: async () => { failures += 1; throw new Error("offline"); } });
    offline.enqueue({ event_type: "window_focus" });
    await settle();
    clock.fire(); await settle();
    assert.equal(failures, 2);
    await offline.finish();
    assert.equal(failures, 3, "one final attempt, no loop");
    assert.equal(offline.pendingCount(), 1, "kept for reload recovery");
  });

  await check("Delivery: a refused batch is resent one by one; only the refused event is left out", async () => {
    assert.equal(isRejection(Object.assign(new Error("process_event_delivery_failed:400"), { status: 400 })), true);
    assert.equal(isRejection(new Error("process_event_delivery_failed:422")), true);
    for (const status of [401, 403, 404, 408, 409, 429, 500, 503]) {
      assert.equal(isRejection(Object.assign(new Error(`process_event_delivery_failed:${status}`), { status })), false, String(status));
    }
    assert.equal(isRejection(new Error("offline")), false);
    assert.match(api, /throw Object\.assign\(new Error\(`process_event_delivery_failed:\$\{response\.status\}`\), \{ status: response\.status \}\)/);

    const clock = fakeTimers();
    const batches: FrontendProcessEvent[][] = [];
    const accepted: FrontendProcessEvent[] = [];
    const queue = createProcessEventDelivery({ sessionId: "refused", tabId: randomUUID(), storage: memoryStorage(), timers: clock.timers,
      send: async (events) => {
        batches.push(structuredClone(events));
        if (events.some((event) => event.payload?.reason === "refused_by_server")) {
          throw Object.assign(new Error("process_event_delivery_failed:400"), { status: 400 });
        }
        accepted.push(...structuredClone(events));
      } });
    queue.enqueue({ event_type: "window_focus", client_occurred_at: "2026-10-24T10:00:00.000Z" });
    queue.enqueue({ event_type: "navigation_event", payload: { reason: "refused_by_server" }, client_occurred_at: "2026-10-24T10:00:01.000Z" });
    queue.enqueue({ event_type: "window_blur", payload: { focus_duration_ms: 1200 }, client_occurred_at: "2026-10-24T10:00:02.000Z" });
    await settle();
    while (clock.pending().length) { clock.fire(); await settle(); }
    assert.equal(queue.pendingCount(), 0);
    const refusedBatch = batches.find((batch) => batch.length === 2)!;
    assert(refusedBatch, "the second and third events travelled together first");
    const blurAlone = batches.find((batch) => batch.length === 1 && batch[0].event_type === "window_blur")!;
    assert.deepEqual(blurAlone[0], refusedBatch[1], "the resent event is byte-for-byte the same (id, time, payload)");
    assert.deepEqual(accepted.map((event) => event.event_type), ["window_focus", "window_blur", "navigation_event"]);
    const marker = accepted.at(-1)!;
    assert.equal(marker.payload?.reason, "process_delivery_gap");
    assert.equal(marker.payload?.delivery_gap_count, 1, "the refused event is counted as a gap");
    assert(!accepted.some((event) => event.payload?.reason === "refused_by_server"));
    queue.dispose();

    // Sign-in and ownership answers are not refusals: the events stay queued.
    const auth = createProcessEventDelivery({ sessionId: "signed-out", tabId: randomUUID(), storage: memoryStorage(), timers: fakeTimers().timers,
      send: async () => { throw Object.assign(new Error("process_event_delivery_failed:401"), { status: 401 }); } });
    auth.enqueue({ event_type: "window_focus" });
    auth.enqueue({ event_type: "window_blur" });
    await settle();
    assert.equal(auth.pendingCount(), 2);
    auth.dispose();
  });

  console.log(`\n${passed} answering-path checks passed; no database or provider calls.`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
