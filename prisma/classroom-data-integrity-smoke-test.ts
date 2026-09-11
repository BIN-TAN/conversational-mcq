import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaClient, Prisma } from "@prisma/client";
import { parse } from "csv-parse/sync";
import {
  cleanupResponseCollectionFixture,
  createResponseCollectionFixture
} from "./response-collection-smoke-fixture";

// Never point this destructive, synthetic-only test at a classroom database.
const url = new URL(process.env.DATABASE_URL ?? "");
assert(["localhost", "127.0.0.1"].includes(url.hostname));
assert(url.pathname.startsWith("/conversational_mcq_classroom_audit_"));
process.env.LLM_PROVIDER = "mock";
process.env.LLM_LIVE_CALLS_ENABLED = "false";
process.env.ITEM_ADMIN_TUTOR_MODE = "mock";
process.env.ALLOW_LOCAL_MOCK_RUNTIME = "true";
process.env.OPERATIONAL_LIVE_CANARY_DATABASE_URL_ACTIVE = "false";
let networkCalls = 0;
globalThis.fetch = async () => {
  networkCalls += 1;
  throw new Error("classroom_audit_network_forbidden");
};

const database = new PrismaClient();
const prefix = `classroom_audit_${randomUUID().replaceAll("-", "")}`;
const results: Array<{ name: string; passed: boolean }> = [];

async function check(name: string, run: () => Promise<void>) {
  try {
    await run();
    results.push({ name, passed: true });
  } catch {
    results.push({ name, passed: false });
  }
}

async function main() {
  const { prisma } = await import("../src/lib/db");
  const foundation = await import("../src/lib/services/student-assessment/formative-conversation/service");
  const { ingestFrontendProcessEvents } = await import("../src/lib/services/student-assessment/service");
  const { StudentAssessmentServiceError } = await import("../src/lib/services/student-assessment/errors");
  const { updateStudentFormativeConversationLifecycle } = await import("../src/lib/services/student-assessment/formative-conversation/projection");
  const { buildAnalysisReadyResearchDataBundle } = await import("../src/lib/services/teacher-research-data/analysis-ready-export");
  const { getAssessmentItemDesign, saveAssessmentItemDesign } = await import("../src/lib/services/content/item-design");
  const { createAssessment } = await import("../src/lib/services/content/assessments");
  try {
    const fixture = await createResponseCollectionFixture({ prisma: database, prefix, responseCollectionMode: "deterministic" });
    await database.assessmentSession.update({ where: { id: fixture.session.id }, data: { current_phase: "profiling_completed" } });
    const conversation = (await foundation.createOrGetFormativeConversationSession({
      assessment_session_db_id: fixture.session.id,
      concept_unit_session_db_id: fixture.conceptUnitSession.id
    })).session;

    await check("distinct simultaneous messages admit only one unresolved student turn", async () => {
      const submissions = await Promise.allSettled(["tab_a", "tab_b"].map((id) =>
        foundation.reserveAndPersistFormativeConversationStudentMessage({
          conversation_public_id: conversation.conversation_public_id,
          client_message_id: id,
          message_text: `Synthetic reasoning from ${id}`
        })
      ));
      assert.equal(submissions.filter((result) => result.status === "fulfilled").length, 1);
      const rejected = submissions.find((result) => result.status === "rejected");
      assert(rejected?.status === "rejected");
      assert.equal(rejected.reason.code, "assistant_response_pending");
    });
    await check("same message replay creates no extra student turn", async () => {
      const first = await database.formativeConversationMessageReceipt.findFirstOrThrow({ where: { formative_conversation_session_db_id: conversation.id }, include: { student_turn: true } });
      const before = await database.conversationTurn.count({ where: { formative_conversation_session_db_id: conversation.id } });
      const replay = await foundation.reserveAndPersistFormativeConversationStudentMessage({
        conversation_public_id: conversation.conversation_public_id,
        client_message_id: first.client_message_id,
        message_text: first.student_turn!.message_text!
      });
      assert.equal(replay.replayed, true);
      assert.equal(await database.conversationTurn.count({ where: { formative_conversation_session_db_id: conversation.id } }), before);
    });
    await check("failed response blocks a different message without losing the saved turn", async () => {
      const first = await database.formativeConversationMessageReceipt.findFirstOrThrow({ where: { formative_conversation_session_db_id: conversation.id } });
      await foundation.recordFormativeConversationAssistantResponseFailure({ conversation_public_id: conversation.conversation_public_id, client_message_id: first.client_message_id, failure_category: "provider_failure", failed_at: new Date() });
      await assert.rejects(foundation.reserveAndPersistFormativeConversationStudentMessage({ conversation_public_id: conversation.conversation_public_id, client_message_id: "after_failure", message_text: "Another message" }), (error: unknown) => error instanceof foundation.FormativeConversationFoundationError && error.code === "assistant_response_pending");
    });

    const studentInput = { student_user_db_id: fixture.student.id, session_public_id: fixture.session.session_public_id };
    await check("invalid telemetry batch leaves no partially committed events", async () => {
      const before = await database.processEvent.count({ where: { assessment_session_db_id: fixture.session.id } });
      await assert.rejects(ingestFrontendProcessEvents({ ...studentInput, data: { events: [
        { event_type: "window_focus" },
        { event_type: "package_results_shown", payload: {} }
      ] } }), (error: unknown) => error instanceof StudentAssessmentServiceError && error.code === "validation_failed");
      assert.equal(await database.processEvent.count({ where: { assessment_session_db_id: fixture.session.id } }), before);
    });
    await check("foreign concept telemetry is rejected, not reassigned to the current concept", async () => {
      await assert.rejects(ingestFrontendProcessEvents({ ...studentInput, data: { event_type: "window_focus", concept_unit_public_id: "unowned_concept" } }), (error: unknown) => error instanceof StudentAssessmentServiceError && error.code === "validation_failed");
    });
    await check("valid telemetry persists with its original item and topic", async () => {
      const accepted = await ingestFrontendProcessEvents({ ...studentInput, data: { event_type: "window_focus", item_public_id: fixture.items[0].item_public_id, concept_unit_public_id: fixture.conceptUnit.concept_unit_public_id } });
      assert.equal(accepted.accepted_event_count, 1);
      const event = await database.processEvent.findFirstOrThrow({ where: { assessment_session_db_id: fixture.session.id, event_type: "window_focus" }, orderBy: { created_at: "desc" } });
      assert.equal(event.item_db_id, fixture.items[0].id);
      assert.equal(event.concept_unit_session_db_id, fixture.conceptUnitSession.id);
    });
    await check("simultaneous display acknowledgements are recorded exactly once", async () => {
      const data = { event_type: "package_results_shown", payload: { display_event_contract_version: "display-ack-v1", content_id: "audit_package" } };
      const acknowledgements = await Promise.all(Array.from({ length: 8 }, () => ingestFrontendProcessEvents({ ...studentInput, data })));
      assert.equal(acknowledgements.reduce((total, result) => total + result.accepted_event_count, 0), 1);
    });
    await check("lifecycle event failure rolls back the lifecycle change", async () => {
      const original = prisma.$transaction.bind(prisma);
      prisma.$transaction = (async (callback: (tx: Prisma.TransactionClient) => Promise<unknown>) => original(async (tx) => {
        tx.formativeConversationLifecycleEvent.create = (() => { throw new Error("synthetic_event_failure"); }) as typeof tx.formativeConversationLifecycleEvent.create;
        return callback(tx);
      })) as typeof prisma.$transaction;
      try {
        await assert.rejects(updateStudentFormativeConversationLifecycle({ ...studentInput, action: "pause" }), /synthetic_event_failure/);
        assert.equal((await database.formativeConversationSession.findUniqueOrThrow({ where: { id: conversation.id } })).status, "active");
      } finally {
        prisma.$transaction = original;
      }
    });
    await check("stale resume cannot resurrect an ended conversation", async () => {
      await updateStudentFormativeConversationLifecycle({ ...studentInput, action: "pause" });
      const original = prisma.formativeConversationSession.findFirst.bind(prisma.formativeConversationSession);
      let injected = false;
      prisma.formativeConversationSession.findFirst = (async (...args: Parameters<typeof original>) => {
        const snapshot = await original(...args);
        if (!injected) {
          injected = true;
          await database.formativeConversationSession.update({ where: { id: conversation.id }, data: { status: "ended", ended_at: new Date() } });
        }
        return snapshot;
      }) as unknown as typeof prisma.formativeConversationSession.findFirst;
      try {
        await updateStudentFormativeConversationLifecycle({ ...studentInput, action: "resume" });
        assert.equal((await database.formativeConversationSession.findUniqueOrThrow({ where: { id: conversation.id } })).status, "ended");
        assert.equal(await database.formativeConversationLifecycleEvent.count({ where: { formative_conversation_session_db_id: conversation.id, event_type: "resumed" } }), 0);
      } finally {
        prisma.formativeConversationSession.findFirst = original;
      }
    });

    await check("deactivation preserves research rows and excludes other teachers' students", async () => {
      await database.user.update({ where: { id: fixture.student.id }, data: { account_status: "inactive" } });
      const other = await createResponseCollectionFixture({ prisma: database, prefix: `${prefix}_other`, responseCollectionMode: "deterministic" });
      const bundle = await buildAnalysisReadyResearchDataBundle({ teacher_user_db_id: fixture.teacher.id, scope: "all_authorized" });
      const rows = parse(bundle.files.find((file) => file.path === "sessions.csv")!.data, { columns: true }) as Array<Record<string, string>>;
      assert.equal(rows.length, 1);
      assert.equal(rows[0].session_public_id, fixture.session.session_public_id);
      assert(!bundle.files.some((file) => file.data.includes(other.session.session_public_id)));
      assert(!bundle.filename.includes(fixture.student.user_id));
    });

    await check("research export reads primary and supplemental evidence from one snapshot", async () => {
      const activityId = `${prefix}_snapshot_activity`;
      const original = prisma.$transaction.bind(prisma);
      let injected = false;
      prisma.$transaction = (async (
        callback: (tx: Prisma.TransactionClient) => Promise<unknown>,
        options: { isolationLevel?: Prisma.TransactionIsolationLevel; timeout?: number }
      ) => original(async (tx) => {
        const load = tx.assessmentSession.findMany.bind(tx.assessmentSession);
        tx.assessmentSession.findMany = (async (...args: Parameters<typeof load>) => {
          const snapshot = await load(...args);
          if (!injected) {
            injected = true;
            await database.activityRuntimeAttempt.create({ data: {
              activity_attempt_public_id: activityId,
              session_public_id: fixture.session.session_public_id,
              student_public_id: fixture.student.user_id,
              assessment_public_id: fixture.assessment.assessment_public_id,
              concept_unit_id: fixture.conceptUnit.concept_unit_public_id,
              source_activity_packet_ref: {},
              activity_family: "explanation_probe",
              diagnostic_purpose: "clarify_reasoning",
              generation_source: "synthetic_audit",
              status: "active",
              limitations: []
            } });
          }
          return snapshot;
        }) as unknown as typeof tx.assessmentSession.findMany;
        return callback(tx);
      }, options)) as typeof prisma.$transaction;
      try {
        const input = { teacher_user_db_id: fixture.teacher.id, scope: "all_authorized" as const };
        const first = await buildAnalysisReadyResearchDataBundle(input);
        assert(injected);
        assert(!first.files.some((file) => file.data.includes(activityId)));
        prisma.$transaction = original;
        const next = await buildAnalysisReadyResearchDataBundle(input);
        assert(next.files.some((file) => file.data.includes(activityId)));
      } finally {
        prisma.$transaction = original;
        await database.activityRuntimeAttempt.deleteMany({ where: { activity_attempt_public_id: activityId } });
      }
    });

    await check("teacher stale save cannot overwrite a concurrent design update", async () => {
      const assessment = await createAssessment({ teacher_user_db_id: fixture.teacher.id, data: { title: `${prefix} design` } });
      const input = { teacher_user_db_id: fixture.teacher.id, assessment_public_id: assessment.assessment_public_id };
      const design = await getAssessmentItemDesign(input);
      const original = prisma.conceptUnit.findUniqueOrThrow.bind(prisma.conceptUnit);
      let injected = false;
      prisma.conceptUnit.findUniqueOrThrow = (async (...args: Parameters<typeof original>) => {
        if (!injected) {
          injected = true;
          await database.conceptUnit.update({ where: { concept_unit_public_id: design.concept_unit_public_id }, data: { title: "Newer teacher edit", version: { increment: 1 } } });
        }
        return original(...args);
      }) as unknown as typeof prisma.conceptUnit.findUniqueOrThrow;
      try {
        await assert.rejects(saveAssessmentItemDesign({ ...input, data: { blueprint: design.blueprint, expected_concept_unit_version: design.concept_unit_version } }));
        assert.equal((await database.conceptUnit.findUniqueOrThrow({ where: { concept_unit_public_id: design.concept_unit_public_id } })).title, "Newer teacher edit");
      } finally {
        prisma.conceptUnit.findUniqueOrThrow = original;
      }
    });
    await check("a delayed design save cannot change a newly published assessment", async () => {
      const assessment = await createAssessment({ teacher_user_db_id: fixture.teacher.id, data: { title: `${prefix} publication` } });
      const input = { teacher_user_db_id: fixture.teacher.id, assessment_public_id: assessment.assessment_public_id };
      const design = await getAssessmentItemDesign(input);
      const original = prisma.conceptUnit.findUniqueOrThrow.bind(prisma.conceptUnit);
      let injected = false;
      prisma.conceptUnit.findUniqueOrThrow = (async (...args: Parameters<typeof original>) => {
        if (!injected) {
          injected = true;
          await database.assessment.update({ where: { assessment_public_id: assessment.assessment_public_id }, data: { status: "published" } });
        }
        return original(...args);
      }) as unknown as typeof prisma.conceptUnit.findUniqueOrThrow;
      try {
        await assert.rejects(saveAssessmentItemDesign({ ...input, data: {
          blueprint: { ...design.blueprint, section_topic: "This edit must not be applied" },
          expected_concept_unit_version: design.concept_unit_version
        } }));
        assert(injected);
        const unchanged = await database.conceptUnit.findUniqueOrThrow({ where: { concept_unit_public_id: design.concept_unit_public_id } });
        assert.equal(unchanged.title, design.blueprint.section_topic);
        assert.equal(unchanged.version, design.concept_unit_version);
      } finally {
        prisma.conceptUnit.findUniqueOrThrow = original;
      }
    });
    await check("30 simultaneous students keep separate saved messages", async () => {
      const students = await Promise.all(Array.from({ length: 30 }, async (_, index) => {
        const userId = `${prefix}_class_${index}`;
        const user = await database.user.create({ data: { user_id: userId, user_id_normalized: userId, role: "student", created_by_teacher_user_id: fixture.teacher.id } });
        const session = await database.assessmentSession.create({ data: {
          session_public_id: `${prefix}_session_${index}`, user_db_id: user.id, assessment_db_id: fixture.assessment.id,
          status: "active", current_phase: "profiling_completed", current_concept_unit_db_id: fixture.conceptUnit.id
        } });
        const concept = await database.conceptUnitSession.create({ data: { assessment_session_db_id: session.id, concept_unit_db_id: fixture.conceptUnit.id } });
        const created = await foundation.createOrGetFormativeConversationSession({ assessment_session_db_id: session.id, concept_unit_session_db_id: concept.id });
        return { user, session, conversation: created.session, text: `Synthetic classroom explanation ${index}` };
      }));
      const submissions = await Promise.all(students.map((student) => foundation.reserveAndPersistFormativeConversationStudentMessage({ conversation_public_id: student.conversation.conversation_public_id, client_message_id: "same_client_id_across_students", message_text: student.text })));
      for (let index = 0; index < students.length; index += 1) {
        assert.equal(submissions[index].receipt.student_turn?.assessment_session_db_id, students[index].session.id);
        assert.equal(submissions[index].receipt.student_turn?.message_text, students[index].text);
        assert.equal(submissions[index].replayed, false);
      }
      assert.equal(new Set(submissions.map((result) => result.receipt.id)).size, 30);
    });
    assert.equal(networkCalls, 0);
    console.log(JSON.stringify({ results, network_calls: networkCalls, provider_calls: 0, model_auth_requests: 0, real_dispatch_checkpoints: 0 }, null, 2));
    assert(results.every((result) => result.passed), "classroom_data_integrity_regression_failed");
  } finally {
    await database.formativeConversationSession.deleteMany({ where: { assessment_session: { assessment: { title: { startsWith: prefix } } } } });
    await cleanupResponseCollectionFixture(database, prefix);
    await database.$disconnect();
    await prisma.$disconnect();
  }
}

main().catch(() => { process.exitCode = 1; });
