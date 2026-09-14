import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaClient, Prisma } from "@prisma/client";
import { createResponseCollectionFixture } from "./response-collection-smoke-fixture";
import { cleanupFollowupSmoke } from "./followup-smoke-fixture";

const url = new URL(process.env.DATABASE_URL ?? "");
assert(["localhost", "127.0.0.1"].includes(url.hostname));
assert(url.pathname.startsWith("/conversational_mcq_classroom_audit_"));
assert.equal(process.env.LLM_LIVE_CALLS_ENABLED, "false");
const db = new PrismaClient();
const prefix = `demo_recovery_${randomUUID().replaceAll("-", "")}`;
let networkCalls = 0;
globalThis.fetch = async () => { networkCalls++; throw new Error("no_network_allowed"); };

async function main() {
  const foundation = await import("../src/lib/services/student-assessment/formative-conversation/service");
  const projection = await import("../src/lib/services/student-assessment/formative-conversation/projection");
  const { endStudentAssessmentAttempt, exitStudentAssessmentSession, getStudentSessionState, getStudentSafeTranscript, getStudentReviewResponses, recordSelectedOption } = await import("../src/lib/services/student-assessment/service");
  const { buildTeacherSessionDataAudit, summarizeResponsePackagePayload } = await import("../src/lib/services/teacher-review/session-data-audit");
  const { prisma } = await import("../src/lib/db");
  const { updateAssessmentSessionPhase, markSessionNeedsReview } = await import("../src/lib/services/session-state");
  try {
    const includedItems = Array.from({ length: 6 }, (_, index) => ({ item_public_id: `synthetic-item-${index}` }));
    const responses = includedItems.map((item) => ({ ...item, selected_option: "A", reasoning_text: "Synthetic reasoning", confidence_rating: "medium", no_tempting_option: true }));
    const summary = (itemResponses: unknown[], items: unknown[] = includedItems) => summarizeResponsePackagePayload({ included_items: items, item_responses: itemResponses });
    assert.equal(summary(responses).evidence_complete_for_included_items, true);
    assert.equal(summary(responses.slice(0, 3)).evidence_complete_for_included_items, false);
    assert.equal(summary([...responses.slice(0, 5), responses[0]]).evidence_complete_for_included_items, false);
    assert.equal(summary([...responses, responses[0]]).evidence_complete_for_included_items, false);
    assert.equal(summary(responses.map((response, index) => index === 5 ? { ...response, reasoning_text: "" } : response)).evidence_complete_for_included_items, false);
    assert.equal(summary(responses.map((response, index) => index === 5 ? { ...response, no_tempting_option: false, tempting_option: "B" } : response)).evidence_complete_for_included_items, false);
    assert.equal(summary(responses, []).evidence_complete_for_included_items, null);
    assert.equal(summary(responses, [includedItems[0], includedItems[0]]).evidence_complete_for_included_items, null);
    const fixture = await createResponseCollectionFixture({ prisma: db, prefix, responseCollectionMode: "deterministic" });
    const partial = await createResponseCollectionFixture({ prisma: db, prefix: `${prefix}_partial`, responseCollectionMode: "deterministic" });
    const partialOwner = { student_user_db_id: partial.student.id, session_public_id: partial.session.session_public_id };
    const editableReview = await getStudentReviewResponses(partialOwner);
    assert.equal(editableReview.locked, false);
    assert(editableReview.items.some((item) => item.can_edit));
    await endStudentAssessmentAttempt(partialOwner);
    const endedReview = await getStudentReviewResponses(partialOwner);
    assert.equal(endedReview.locked, true, "Ending before package submission must still lock review.");
    assert(endedReview.items.every((item) => !item.can_edit));
    await assert.rejects(recordSelectedOption({ ...partialOwner, item_public_id: editableReview.items[0].item_public_id, data: { selected_option: "A" } }), { code: "invalid_phase_for_action" });
    const owner = { student_user_db_id: fixture.student.id, session_public_id: fixture.session.session_public_id };
    await db.conceptUnitSession.update({ where: { id: fixture.conceptUnitSession.id }, data: { initial_completed_at: new Date() } });
    await db.assessmentSession.update({ where: { id: fixture.session.id }, data: { current_phase: "profiling_pending" } });
    await db.assessmentSession.update({ where: { id: fixture.session.id }, data: { status: "paused", resume_phase: "profiling_pending" } });
    const pausedUpdate = await updateAssessmentSessionPhase({ assessment_session_db_id: fixture.session.id, to_phase: "profiling_completed" });
    assert.equal(pausedUpdate.transition.allowed, false);
    assert.equal(pausedUpdate.updated.status, "paused");
    await db.assessmentSession.update({ where: { id: fixture.session.id }, data: { status: "active", resume_phase: null } });
    const phaseTransaction = prisma.$transaction.bind(prisma);
    prisma.$transaction = (async (callback: (tx: Prisma.TransactionClient) => Promise<unknown>) => phaseTransaction(async (tx) => {
      tx.processEvent.create = (() => { throw new Error("synthetic_phase_audit_failure"); }) as typeof tx.processEvent.create;
      return callback(tx);
    })) as typeof prisma.$transaction;
    try {
      await assert.rejects(updateAssessmentSessionPhase({ assessment_session_db_id: fixture.session.id, to_phase: "profiling_completed" }), /synthetic_phase_audit_failure/);
    } finally { prisma.$transaction = phaseTransaction; }
    assert.equal((await db.assessmentSession.findUniqueOrThrow({ where: { id: fixture.session.id } })).current_phase, "profiling_pending");
    const { runInitialStudentProfiling, profilingGuardDiagnostics } = await import("../src/lib/agents/student-profiling/service");
    const { executeOperationalAgent } = await import("../src/lib/agents/operational/executor");
    await runInitialStudentProfiling({
      concept_unit_session_db_id: fixture.conceptUnitSession.id,
      invocation_reason: "synthetic_guard_regression",
      no_provider_test_executor: async (input) => {
        const result = await executeOperationalAgent(input);
        assert.equal(result.status, "blocked_by_operational_guard");
        if (result.status !== "blocked_by_operational_guard") throw new Error("expected_guard_block");
        const usageResult = { ...result, reason: "usage_guard_blocked" as const, blocking_reasons: ["usage_guard_blocked" as const], readiness_snapshot: { ...result.readiness_snapshot, usage_guard_reason: "student_daily_call_limit_exceeded" } };
        assert.equal(profilingGuardDiagnostics(usageResult)?.usage_guard_reason, "student_daily_call_limit_exceeded");
        assert.equal(profilingGuardDiagnostics({ ...usageResult, readiness_snapshot: { ...usageResult.readiness_snapshot, usage_guard_reason: "sensitive-invalid-value" } })?.usage_guard_reason, null);
        return result;
      }
    });
    const effective = await db.operationalAgentEffectiveResult.findFirstOrThrow({ where: { operational_context_public_id: { startsWith: fixture.session.session_public_id } } });
    assert.equal(effective.agent_call_db_id, null);
    assert.equal(effective.fallback_applied, true);
    assert(JSON.stringify(effective.warnings_json).includes("operational_mode_disabled"));
    const failed = await db.processEvent.findFirstOrThrow({ where: { assessment_session_db_id: fixture.session.id, event_type: "agent_call_failed" } });
    assert(JSON.stringify(failed.payload).includes("operational_mode_disabled"));
    const conversation = (await foundation.createOrGetFormativeConversationSession({
      assessment_session_db_id: fixture.session.id, concept_unit_session_db_id: fixture.conceptUnitSession.id
    })).session;
    const saved = await foundation.reserveAndPersistFormativeConversationStudentMessage({
      conversation_public_id: conversation.conversation_public_id, client_message_id: "saved-message", message_text: "My saved reasoning."
    });
    const generalTranscript = await getStudentSafeTranscript(owner);
    const formativeTranscript = await projection.getStudentFormativeConversationProjection(owner);
    const generalTurn = generalTranscript.transcript.find((turn) => turn.message_text === "My saved reasoning.");
    const formativeTurn = formativeTranscript?.transcript.find((turn) => turn.message_text === "My saved reasoning.");
    assert(generalTurn && formativeTurn);
    assert.equal(generalTurn.turn_id, formativeTurn.turn_id, "Both student views must deduplicate the same stored message.");
    assert.notEqual(formativeTurn.turn_id, saved.receipt.student_turn_db_id, "Student views must not expose raw database turn IDs.");
    await foundation.reserveFormativeConversationOpening(conversation.conversation_public_id);
    await exitStudentAssessmentSession(owner);
    await foundation.recordFormativeConversationOpeningFailure({ conversation_public_id: conversation.conversation_public_id, failure_code: "synthetic_paused_failure", retryable: true });
    const pausedFailure = await foundation.recordFormativeConversationAssistantResponseFailure({ conversation_public_id: conversation.conversation_public_id, client_message_id: "saved-message", failure_category: "synthetic_paused_failure", failed_at: new Date() });
    assert.equal(pausedFailure.receipt.assistant_response_status, "failed");
    assert.equal((await projection.getStudentFormativeConversationProjection(owner))?.assistant_response?.can_retry, false);
    await db.assessmentSession.update({ where: { id: fixture.session.id }, data: { status: "active" } });
    await assert.rejects(foundation.reserveAndPersistFormativeConversationStudentMessage({ conversation_public_id: conversation.conversation_public_id, client_message_id: "stale-resume-message", message_text: "Must not be saved while lifecycle is inconsistent." }));
    await db.assessmentSession.update({ where: { id: fixture.session.id }, data: { status: "active", resume_phase: null, resume_context: Prisma.DbNull } });
    const resumedAttempt = await foundation.prepareFormativeConversationAssistantResponseAttempt({ conversation_public_id: conversation.conversation_public_id, client_message_id: "saved-message" });
    assert.equal(resumedAttempt.receipt.assistant_response_status, "retrying");
    assert.equal((await foundation.reserveFormativeConversationOpening(conversation.conversation_public_id)).replayed, false);
    await assert.rejects(endStudentAssessmentAttempt({ ...owner, student_user_db_id: fixture.teacher.id }));

    // Inject a child audit failure: parent and child changes must roll back together.
    const transaction = prisma.$transaction.bind(prisma);
    prisma.$transaction = (async (callback: (tx: Prisma.TransactionClient) => Promise<unknown>) => transaction(async (tx) => {
      tx.formativeConversationLifecycleEvent.create = (() => { throw new Error("synthetic_audit_failure"); }) as typeof tx.formativeConversationLifecycleEvent.create;
      return callback(tx);
    })) as typeof prisma.$transaction;
    try {
      await assert.rejects(endStudentAssessmentAttempt(owner), /synthetic_audit_failure/);
    } finally { prisma.$transaction = transaction; }
    assert.equal((await db.assessmentSession.findUniqueOrThrow({ where: { id: fixture.session.id } })).status, "active");
    assert.equal((await db.formativeConversationSession.findUniqueOrThrow({ where: { id: conversation.id } })).status, "active");

    const results = await Promise.all([
      ...Array.from({ length: 4 }, () => endStudentAssessmentAttempt(owner)),
      exitStudentAssessmentSession(owner)
    ]);
    assert.equal((await db.assessmentSession.findUniqueOrThrow({ where: { id: fixture.session.id } })).status, "student_exited");
    assert.equal(results.slice(0, 4).filter((result) => result.command_result.mutation_committed).length, 1);
    assert.equal(await db.processEvent.count({ where: { assessment_session_db_id: fixture.session.id, event_type: "attempt_ended_by_student" } }), 1);
    assert.equal(await db.formativeConversationLifecycleEvent.count({ where: { formative_conversation_session_db_id: conversation.id, event_type: "conversation_ended" } }), 1);
    assert.equal((await db.formativeConversationSession.findUniqueOrThrow({ where: { id: conversation.id } })).status, "ended");
    assert.equal(await db.conversationTurn.count({ where: { formative_conversation_session_db_id: conversation.id } }), 1);
    const latePhaseUpdate = await updateAssessmentSessionPhase({ assessment_session_db_id: fixture.session.id, to_phase: "session_started" });
    assert.equal(latePhaseUpdate.transition.allowed, false);
    const lateReviewUpdate = await markSessionNeedsReview({ assessment_session_db_id: fixture.session.id, reason: "synthetic_late_failure" });
    assert.equal(lateReviewUpdate.transition.allowed, false);
    assert.equal((await db.assessmentSession.findUniqueOrThrow({ where: { id: fixture.session.id } })).status, "student_exited");
    await foundation.recordFormativeConversationAssistantResponseFailure({ conversation_public_id: conversation.conversation_public_id, client_message_id: "saved-message", failure_category: "synthetic_ended_failure", failed_at: new Date() });
    assert.equal((await projection.getStudentFormativeConversationProjection(owner))?.assistant_response?.can_retry, false);

    const terminalState = await getStudentSessionState(owner);
    assert.equal(terminalState.assessment_state, "SESSION_COMPLETE");
    assert.equal(terminalState.attempt_lifecycle.terminal, true);
    const { endAssessmentAttempt } = await import("../src/components/student-assessment/api");
    const blockedFetch = globalThis.fetch;
    const requests: string[] = [];
    globalThis.fetch = async (url, init) => {
      requests.push(`${init?.method ?? "GET"} ${url}`);
      if (init?.method === "POST") throw new TypeError("Synthetic lost end response");
      return Response.json(terminalState);
    };
    try {
      assert.equal((await endAssessmentAttempt(owner.session_public_id)).can_resume, false);
      assert.equal(requests.length, 2);
      assert.equal(requests.filter((request) => request.startsWith("POST")).length, 1);
      globalThis.fetch = async (_url, init) => {
        if (init?.method === "POST") throw new TypeError("Synthetic rejected end");
        return Response.json({ ...terminalState, attempt_lifecycle: { ...terminalState.attempt_lifecycle, terminal: false } });
      };
      await assert.rejects(endAssessmentAttempt(owner.session_public_id), /Synthetic rejected end/);
    } finally { globalThis.fetch = blockedFetch; }

    const assertBlocked = async () => {
      const state = await projection.getStudentFormativeConversationProjection(owner);
      assert.equal(state?.status, "ended");
      for (const field of ["can_send", "can_pause", "can_resume", "can_end", "can_retry_opening", "another_student_turn_available"] as const) assert.equal(state?.[field], false, field);
      assert.equal(state?.assistant_response?.can_retry, false);
      await assert.rejects(foundation.reserveAndPersistFormativeConversationStudentMessage({ conversation_public_id: conversation.conversation_public_id, client_message_id: "late-message", message_text: "Must not be saved" }));
      await assert.rejects(foundation.persistFormativeConversationAssistantMessage({ conversation_public_id: conversation.conversation_public_id, client_message_id: "saved-message", message_text: "Late provider reply", generation_source: "test", validator_status: "accepted" }));
      await assert.rejects(foundation.reserveFormativeConversationOpening(conversation.conversation_public_id));
      await projection.updateStudentFormativeConversationLifecycle({ ...owner, action: "resume" });
      assert.equal((await projection.getStudentFormativeConversationProjection(owner))?.can_send, false);
      const replay = await foundation.reserveAndPersistFormativeConversationStudentMessage({ conversation_public_id: conversation.conversation_public_id, client_message_id: "saved-message", message_text: "My saved reasoning." });
      assert.equal(replay.receipt.student_turn_db_id, saved.receipt.student_turn_db_id);
      assert.equal(await db.conversationTurn.count({ where: { formative_conversation_session_db_id: conversation.id } }), 1);
    };
    await assertBlocked();
    // Reproduce historical inconsistent records, without repairing or rewriting them.
    await db.formativeConversationSession.update({ where: { id: conversation.id }, data: { status: "active" } });
    await assertBlocked();
    await db.formativeConversationSession.update({ where: { id: conversation.id }, data: { status: "paused" } });
    await assertBlocked();
    assert.equal((await db.formativeConversationSession.findUniqueOrThrow({ where: { id: conversation.id } })).status, "paused");
    await db.conceptUnitSession.update({ where: { id: fixture.conceptUnitSession.id }, data: { followup_status: "active" } });
    const { getTeacherReviewSessionDetail } = await import("../src/lib/services/teacher-review/session-detail");
    const teacherDetail = await getTeacherReviewSessionDetail(fixture.session.session_public_id);
    assert(teacherDetail);
    const teacherConcept = teacherDetail.concept_unit_sessions[0];
    assert.equal(teacherConcept.followup_status, "ended");
    for (const key of ["can_run_profiling", "can_run_planning", "can_start_followup", "can_run_followup_update"] as const) assert.equal(teacherConcept[key], false);
    assert.equal((await db.conceptUnitSession.findUniqueOrThrow({ where: { id: fixture.conceptUnitSession.id } })).followup_status, "active", "Teacher presentation must not rewrite historical records.");

    const handoff = await db.conversationTurn.create({ data: {
      assessment_session_db_id: fixture.session.id,
      concept_unit_session_db_id: fixture.conceptUnitSession.id,
      formative_conversation_session_db_id: conversation.id,
      phase: saved.receipt.student_turn!.phase, actor_type: "agent", agent_name: "platform_lifecycle",
      message_text: foundation.FORMATIVE_CONVERSATION_LIFECYCLE_HANDOFF_MESSAGE,
      structured_payload: { message_type: "formative_conversation_lifecycle_handoff" }
    } });
    await db.formativeConversationMessageReceipt.update({ where: { id: saved.receipt.id }, data: { assistant_turn_db_id: handoff.id } });
    const replayedHandoff = await foundation.persistFormativeConversationLifecycleHandoff({
      conversation_public_id: conversation.conversation_public_id, client_message_id: "saved-message",
      agent_call_db_id: randomUUID(), reason_code: "synthetic_replay_only"
    });
    assert(replayedHandoff);
    assert.equal(replayedHandoff.replayed, true);
    assert.equal(replayedHandoff.assistant_turn.id, handoff.id);
    assert.equal(await db.conversationTurn.count({ where: { formative_conversation_session_db_id: conversation.id } }), 2);

    await db.processEvent.create({ data: { assessment_session_db_id: fixture.session.id, event_type: "session_started", event_category: "session", event_source: "backend", occurred_at: new Date() } });
    await db.processEvent.create({ data: { assessment_session_db_id: fixture.session.id, concept_unit_session_db_id: fixture.conceptUnitSession.id, event_type: "item_presented", event_category: "item", event_source: "backend", occurred_at: new Date() } });
    const before = await db.processEvent.count({ where: { assessment_session_db_id: fixture.session.id } });
    const audit = await buildTeacherSessionDataAudit({ session_public_id: fixture.session.session_public_id });
    assert.equal(audit.process_data_summary.process_event_count, before);
    assert.equal(audit.process_data_summary.observed_event_counts.session_started, 1);
    assert(!audit.process_data_summary.missing_expected_initial_event_types.includes("session_started"));
    assert(!audit.limitations.some((text) => /missing_expected_process_events:.*answer_changed/.test(text)));
    assert.equal(await db.processEvent.count({ where: { assessment_session_db_id: fixture.session.id } }), before);
    assert.equal(networkCalls, 0);
    console.log("PASS: owner isolation, atomic end rollback, concurrent end idempotency, terminal controls, late writes, stale-state protection, read-only research event counts; provider calls=0");
  } finally {
    const sessions = await db.assessmentSession.findMany({ where: { assessment: { title: { startsWith: prefix } } }, select: { session_public_id: true } });
    for (const session of sessions) await db.operationalAgentEffectiveResult.deleteMany({ where: { operational_context_public_id: { startsWith: session.session_public_id } } });
    const where = { formative_conversation_session: { assessment_session: { assessment: { title: { startsWith: prefix } } } } };
    await db.formativeConversationMessageReceipt.deleteMany({ where });
    await db.formativeConversationLifecycleEvent.deleteMany({ where });
    await db.formativeConversationSession.deleteMany({ where: { assessment_session: { assessment: { title: { startsWith: prefix } } } } });
    await cleanupFollowupSmoke(db, prefix);
    await db.$disconnect();
    await prisma.$disconnect();
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
