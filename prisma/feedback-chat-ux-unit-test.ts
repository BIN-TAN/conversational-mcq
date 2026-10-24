/**
 * Release CMCQ-20261024-09, feedback preparation and tutor chat: speed and the student's view.
 * - A failed opening (profile already saved and reused) is retried after about 5 s, not the
 *   full backoff; a provider's retry-after still applies. Attempt counts are unchanged.
 * - Feedback v8 replies and openings skip the legacy context seed (v8 never reads it); the
 *   recorded input_payload is still the compiled v8 context.
 * - A chat message no longer loads the full conversation projection twice.
 * - Initial-preparation jobs use their own 90 s lease, renewed every 30 s while they run.
 * - The student sees their message at once, honest waiting text, a new message id when the
 *   text changes after a failed send, and the preparation step and elapsed time.
 * No database or provider calls. Run with: npx tsx prisma/feedback-chat-ux-unit-test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

process.env.DATABASE_URL ??= "postgresql://unit:unit@localhost:5432/feedback_chat_ux_unit";
process.env.SESSION_SECRET ??= "feedback-chat-ux-unit-test-secret-0123456789abcdef";

let passed = 0;
async function check(name: string, run: () => void | Promise<void>) {
  await run();
  passed += 1;
  console.log(`ok - ${name}`);
}
const source = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");
const between = (text: string, start: string, end: string) => {
  const from = text.indexOf(start);
  assert(from >= 0, start);
  const to = text.indexOf(end, from + start.length);
  assert(to >= 0, end);
  return text.slice(from, to);
};

async function main() {
  const ux = await import("../src/components/student-assessment/formative-chat-ux");
  const preparation = await import("../src/lib/workflow/initial-preparation");
  const selection = await import("../src/lib/services/student-assessment/formative-conversation/runner-selection");

  const client = source("src/components/student-assessment/assessment-session-client.tsx");
  const worker = source("src/lib/workflow/initial-preparation.ts");
  const status = source("src/lib/workflow/initial-preparation-status.ts");
  const messagesRoute = source("src/app/api/student/sessions/[sessionPublicId]/formative-conversation/messages/route.ts");
  const retryRoute = source("src/app/api/student/sessions/[sessionPublicId]/formative-conversation/messages/retry/route.ts");
  const opening = source("src/lib/services/student-assessment/formative-conversation/opening-orchestration.ts");
  const runtime = source("src/lib/services/student-assessment/formative-conversation/runtime.ts");
  const projection = source("src/lib/services/student-assessment/formative-conversation/projection.ts");

  // 1. Opening-only retry
  await check("an opening-only retry waits about 5 s and still honours a provider retry-after", () => {
    assert.equal(preparation.OPENING_ONLY_RETRY_DELAY_MS, 5_000);
    const now = 1_000_000;
    assert.equal(preparation.initialPreparationRetryRunAfterMs({ now, attempt_count: 1, opening_only_retry: true, retry_not_before: 0 }), now + 5_000);
    assert.equal(preparation.initialPreparationRetryRunAfterMs({ now, attempt_count: 2, opening_only_retry: true, retry_not_before: now + 61_000 }), now + 61_000);
    process.env.WORKFLOW_JOB_BASE_RETRY_MS = "30000";
    const full = preparation.initialPreparationRetryRunAfterMs({ now, attempt_count: 1, opening_only_retry: false, retry_not_before: 0 });
    assert(full >= now + 24_000 && full <= now + 36_000, String(full - now));
  });
  await check("the short wait applies only when the conversation (and so the profile) is saved and the opening is not ready", () => {
    assert.match(worker, /openingOnlyRetry = Boolean\(conversation\);\n\s+throw new Error\("preparation_opening_not_ready"\)/);
    assert.match(worker, /if \(!\(error instanceof Error && error\.message === "preparation_opening_not_ready"\)\) openingOnlyRetry = false;/);
    assert.match(worker, /opening_only_retry: openingOnlyRetry && outcome === "retryable" && !paused, retry_not_before: retryNotBefore/);
    // Attempt counting is untouched: the claim still increments it, and max_attempts only grows when paused.
    assert.match(worker, /attempt_count = job\.attempt_count \+ 1/);
    assert.match(worker, /\.\.\.\(paused \? \{ max_attempts: \{ increment: 1 \} \} : \{\}\)/);
    const prepare = source("src/lib/services/student-assessment/interpretation-v8/prepare.ts");
    assert.match(prepare, /let profileId = existingConversation\?\.initial_student_profile_db_id \?\? existingV8\?\.id \?\? null;/);
  });

  // 2. No legacy seed for feedback v8
  await check("feedback v8 replies and openings use the placeholder seed; v8 compiles its context without it", () => {
    const seed = selection.feedbackV8PlaceholderRuntimeSeed();
    assert.equal(seed.assessment_public_id, "feedback-v8");
    assert.deepEqual(seed.administered_items, []);
    assert.notEqual(selection.feedbackV8PlaceholderRuntimeSeed(), seed, "a fresh object per call");
    assert.match(opening, /const context = feedbackV8\n\s+\? feedbackV8PlaceholderRuntimeSeed\(\)\n\s+: await buildFormativeConversationRuntimeContextSeedForInternalOpening/);
    assert.match(runtime, /if \(input\.schema_version === FEEDBACK_V8_CONTRACT_VERSION\) \{\n\s+return compileFeedbackV8Context\(\{ conversation_public_id: input\.conversation_public_id \}\);/);
    // The recorded input_payload is the compiled context, never the seed.
    assert.match(runtime, /input_payload: prismaJson\(redactForAudit\(input\.context\)\)/);
    assert.match(runtime, /context: compiled\.context,\n\s+runner,/);
    const deps = between(source("src/lib/services/student-assessment/formative-conversation/runner-selection.ts"),
      "export async function formativeConversationReplyDependencies", "\n}\n");
    assert.match(deps, /conversationUsesFeedbackV8[\s\S]*feedbackV8PlaceholderRuntimeSeed\(\)[\s\S]*createFeedbackV8Runner/);
    assert.match(deps, /buildFormativeConversationRuntimeContextSeed[\s\S]*createLiveFormativeConversationV18R2AgentRunner/);
    for (const route of [messagesRoute, retryRoute]) {
      assert.match(route, /formativeConversationReplyDependencies\(/);
      assert.doesNotMatch(route, /formativeConversationRuntimeSeed\(/);
    }
  });

  // 3. One full projection per message
  await check("a chat message checks a narrow gate first and loads the full projection only when needed", () => {
    const gate = between(projection, "export async function getStudentFormativeConversationMessageGate", "\nexport async function getStudentFormativeConversationProjection");
    assert.match(gate, /orderBy: \{ started_at: "desc" \}/);
    assert.match(gate, /user_db_id: input\.student_user_db_id/);
    assert.match(gate, /client_message_id: FORMATIVE_CONVERSATION_OPENING_CLIENT_MESSAGE_ID/);
    // Release 09 decision 7: the gate defers from the shorter (v8) window.
    assert.match(gate, /updated_at: \{ lt: new Date\(Date\.now\(\) - FEEDBACK_V8_STALE_RESPONSE_MS\) \}/);
    assert.match(gate, /needs_full_projection: !opening\?\.assistant_turn_db_id \|\| staleReply/);
    assert.match(messagesRoute, /const owned = gate && gate\.needs_full_projection\n\s+\? await getStudentFormativeConversationProjection/);
    assert.equal(messagesRoute.match(/getStudentFormativeConversationProjection\(/g)?.length, 2, "the conditional pre-check and the final projection");
    assert.match(retryRoute, /const owned = gate\?\.stale_reply/);
    // The reservation still re-checks the status under the conversation lock.
    const service = source("src/lib/services/student-assessment/formative-conversation/service.ts");
    assert.match(service, /await lockConversationAttempt\(transaction, conversationPublicId\);/);
    assert.match(service, /if \(lockedSession\.status !== "active"\) \{/);
  });
  await check("the same message ID with different text has a plain explanation", () => {
    assert.match(messagesRoute, /error\.code === "idempotency_hash_mismatch"[\s\S]*"Your earlier message was already sent\. Refresh the page to see it\."/);
  });

  // 4. Initial-preparation lease
  await check("initial-preparation jobs use their own 90 s lease with a heartbeat every third of it", () => {
    delete process.env.INITIAL_PREPARATION_LEASE_TIMEOUT_MS;
    assert.equal(preparation.initialPreparationLeaseTimeoutMs(), 90_000);
    process.env.INITIAL_PREPARATION_LEASE_TIMEOUT_MS = "45000";
    assert.equal(preparation.initialPreparationLeaseTimeoutMs(), 45_000);
    delete process.env.INITIAL_PREPARATION_LEASE_TIMEOUT_MS;
    assert.match(worker, /const cutoff = new Date\(Date\.now\(\) - initialPreparationLeaseTimeoutMs\(\)\);/);
    assert.match(worker, /\}, Math\.max\(100, Math\.floor\(initialPreparationLeaseTimeoutMs\(\) \/ 3\)\)\);/);
    assert.match(source("src/lib/workflow/jobs.ts"), /getWorkflowJobConfig\(\)\.lease_timeout_ms/);
    const render = source("render.yaml");
    assert.match(render, /- key: INITIAL_PREPARATION_LEASE_TIMEOUT_MS\n\s+value: "90000"/);
    assert.match(render, /- key: WORKFLOW_JOB_LEASE_TIMEOUT_MS\n\s+value: "600000"/);
  });

  // 5. Waiting text and the student's own message
  await check("waiting text is plain and never claims the message is saved", () => {
    assert.equal(ux.formativeReplyWaitingMessage(false), "Waiting for the tutor's reply...");
    assert.equal(ux.formativeReplyWaitingMessage(true), "Still waiting. You can read the earlier messages while you wait.");
    const waiting = between(client, "function FormativeResponseWaitingStatus", "\nfunction FormativeConversationControls");
    assert.doesNotMatch(waiting, /"[^"\n]*saved[^"\n]*"/i, "no waiting text says the message is saved");
    assert.match(waiting, /FORMATIVE_RESPONSE_DELAY_NOTICE_MS/);
  });
  await check("the sent text shows as the student's message until the reply arrives or the send fails", () => {
    const send = between(client, "async function handleSendFormativeConversationMessage", "async function handleRetryFormativeConversationOpening");
    assert.match(send, /setPendingFormativeMessage\(message\);/);
    assert.match(send, /finally \{[\s\S]*setPendingFormativeMessage\(null\);/);
    assert.match(client, /data-testid="formative-conversation-pending-student-message"/);
  });

  // 6. Message IDs after a failed send
  await check("resending the same text keeps its ID; changed text gets a new one", () => {
    let next = 0;
    const newId = () => `id-${++next}`;
    const first = ux.formativeOutgoingMessageFor(null, "I think A.", newId);
    assert.deepEqual(first, { client_message_id: "id-1", text: "I think A." });
    assert.equal(ux.formativeOutgoingMessageFor(first, "I think A.", newId), first);
    assert.deepEqual(ux.formativeOutgoingMessageFor(first, "I think B.", newId), { client_message_id: "id-2", text: "I think B." });
  });
  await check("after a failed send the conversation is read again, and a saved message clears the draft", () => {
    const transcript = (texts: string[]) => ({ transcript: texts.map((text, index) => ({ actor: index % 2 ? "student" : "tutor", message_text: text })) });
    assert.equal(ux.sentFormativeMessageWasSaved(0, transcript(["Opening", "I think A."]), "I think A."), true);
    assert.equal(ux.sentFormativeMessageWasSaved(1, transcript(["Opening", "I think A."]), "I think A."), false);
    assert.equal(ux.sentFormativeMessageWasSaved(0, transcript(["Opening", "Something else"]), "I think A."), false);
    assert.equal(ux.sentFormativeMessageWasSaved(0, null, "I think A."), false);
    const send = between(client, "async function handleSendFormativeConversationMessage", "async function handleRetryFormativeConversationOpening");
    assert.match(send, /refreshed = await fetchFormativeConversation\(state\.session_public_id\);/);
    assert.match(send, /if \(saved\) \{\n\s+setFormativeConversationDraft\(""\);\n\s+formativeMessageIdRef\.current = null;/);
  });

  // 7. Preparation step and elapsed time
  await check("the preparation wait shows its step and how long the student has waited", () => {
    assert.equal(ux.preparationStageLabel("reading_answers"), "Step 1 of 2: Reading your answers");
    assert.equal(ux.preparationStageLabel("writing_feedback"), "Step 2 of 2: Writing your feedback");
    assert.equal(ux.preparationStageLabel(null), null);
    assert.equal(ux.preparationWaitingLabel(20_000), "Waiting for less than a minute.");
    assert.equal(ux.preparationWaitingLabel(65_000), "Waiting for about 1 minute.");
    assert.equal(ux.preparationWaitingLabel(4 * 60_000 + 10_000), "Waiting for about 4 minutes.");
    assert.equal(ux.preparationWaitingLabel(-5_000), "Waiting for less than a minute.");
    assert.match(status, /stage: inProgress \? conversationSaved \? "writing_feedback" as const : "reading_answers" as const : null/);
    assert.match(status, /waiting_since: inProgress \? job\.created_at\.toISOString\(\) : null/);
    assert.match(client, /data-testid="initial-preparation-stage"/);
    assert.match(client, /data-testid="initial-preparation-elapsed"/);
    // The wait card itself shows no answer key; from release 09 the answer review card (package
    // results, built from the sealed package) shows it beside the wait card.
    const wait = between(client, 'data-testid="initial-preparation-status"', 'data-testid="submitted-response-review"');
    assert.doesNotMatch(wait, /correct_option|answer_key|is_correct/);
  });

  // 8. Polling
  await check("preparation polling stays fast for 30 s, then slows to 4 s", () => {
    assert.equal(ux.preparationPollDelayMs(0, 0), 2000);
    assert.equal(ux.preparationPollDelayMs(29_999, 0), 2000);
    assert.equal(ux.preparationPollDelayMs(30_000, 0), 4000);
    assert.equal(ux.preparationPollDelayMs(60_000, 1), 8000);
    assert.equal(ux.preparationPollDelayMs(60_000, 5), 15_000);
    assert.match(client, /timer = setTimeout\(poll, preparationPollDelayMs\(Date\.now\(\) - pollStartedAt, failures\)\);/);
    assert.match(client, /timer = setTimeout\(poll, 1000\);/);
  });

  console.log(`feedback-chat-ux-unit-test: ${passed} checks passed`);
}

main().then(() => process.exit(0), (error) => {
  console.error(error);
  process.exit(1);
});
