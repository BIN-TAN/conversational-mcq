import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { parse } from "csv-parse/sync";
import { demoAssessmentPublicId, ensureDemoStudentAssessment } from "./demo-student-assessment-fixture";
import { cleanupSmokeStudentSessions, completeInitialItem, createSmokeStudent } from "./student-mvp-smoke-helpers";
import { completeInitialConceptUnitAdministration, ingestFrontendProcessEvents, startConceptUnitInitialAdministration, startOrResumeStudentAssessmentSession, getStudentSessionState } from "../src/lib/services/student-assessment/service";
import { updateStudentFormativeConversationLifecycle } from "../src/lib/services/student-assessment/formative-conversation/projection";
import { feedbackContentId, FEEDBACK_DISPLAY_VERSION } from "../src/lib/student-assessment-ui/feedback-display";
import { responseStageExportFiles } from "../src/lib/services/teacher-research-data/response-stage-export";
import { teacherPhaseLabel } from "../src/lib/teacher-session-labels";
import { getTeacherAssessmentDashboard } from "../src/lib/services/teacher-dashboard/assessment-dashboard";
import { listTeacherReviewSessions } from "../src/lib/services/teacher-review/sessions";
import { sessionListQuerySchema } from "../src/lib/services/teacher-review/filters";
import { buildAnalysisReadyResearchDataBundle } from "../src/lib/services/teacher-research-data/analysis-ready-export";

const db = new PrismaClient();
async function main() {
  const database = new URL(process.env.DATABASE_URL!);
  assert(["localhost", "127.0.0.1"].includes(database.hostname));
  const prefix = `feedback_audit_${randomUUID().slice(0, 8)}`;
  const assessment = await ensureDemoStudentAssessment(db);
  const student = await createSmokeStudent({ prisma: db, prefix, accessCode: `${prefix}_access` });
  const ids: string[] = [];
  try {
    await db.user.update({ where: { id: student.id }, data: { created_by_teacher_user_id: assessment.created_by_user_db_id } });
    const started = await startOrResumeStudentAssessmentSession({ student_user_db_id: student.id, assessment_public_id: demoAssessmentPublicId });
    ids.push(started.session.session_public_id);
    const input = { student_user_db_id: student.id, session_public_id: ids[0] };
    const conceptId = started.state.current_concept_unit!.concept_unit_public_id;
    let state = await startConceptUnitInitialAdministration({ ...input, concept_unit_public_id: conceptId });
    for (const itemIndex of [1, 2, 3]) state = await completeInitialItem({ studentDbId: student.id, sessionPublicId: ids[0], prefix, state, itemIndex });
    state = (await completeInitialConceptUnitAdministration({ ...input, concept_unit_public_id: conceptId })).state;
    const session = await db.assessmentSession.findUniqueOrThrow({ where: { session_public_id: ids[0] } });
    const concept = await db.conceptUnitSession.findFirstOrThrow({ where: { assessment_session_db_id: session.id } });
    const responseWhere = { concept_unit_session_db_id: concept.id };
    const unobserved = () => db.itemResponse.count({ where: { ...responseWhere, student_display_acknowledged_at: null } });
    assert.equal(await unobserved(), 3, "Generation does not imply display");
    const envelope = { browser_tab_id: randomUUID(), client_occurred_at: new Date().toISOString(), concept_unit_public_id: conceptId };
    const payload = { display_event_contract_version: FEEDBACK_DISPLAY_VERSION, observation_method: "partial_viewport_500ms", minimum_visible_ms: 500 };
    const summary = { ...envelope, client_event_id: randomUUID(), event_type: "package_results_shown", payload: {
      ...payload, content_kind: "package_summary", content_id: feedbackContentId(ids[0], conceptId, "initial-results")
    } };
    await ingestFrontendProcessEvents({ ...input, data: summary });
    assert.equal(await unobserved(), 3, "Visible summary cannot acknowledge all item explanations");
    const itemId = state.package_results!.items[0].item_public_id;
    const item = { ...envelope, client_event_id: randomUUID(), event_type: "item_correctness_status_shown", item_public_id: itemId,
      payload: { ...payload, content_kind: "item_feedback", content_id: feedbackContentId(ids[0], conceptId, `item:${itemId}`) } };
    await ingestFrontendProcessEvents({ ...input, data: item });
    await ingestFrontendProcessEvents({ ...input, data: { ...item, client_event_id: randomUUID() } });
    assert.equal(await unobserved(), 2, "Only the observed item is acknowledged; reload is idempotent");
    const tutor = state.formative_conversation!.transcript.find(turn => turn.actor === "tutor")!;
    const message = { ...envelope, client_event_id: randomUUID(), event_type: "formative_feedback_shown", payload: {
      ...payload, content_kind: "formative_tutor_message", content_id: feedbackContentId(ids[0], conceptId, `turn:${tutor.turn_id}`),
      conversation_public_id: state.formative_conversation!.conversation_public_id, source_turn_sequence_index: tutor.sequence_index, turn_id: tutor.turn_id
    } };
    await ingestFrontendProcessEvents({ ...input, data: message });
    await ingestFrontendProcessEvents({ ...input, data: message });
    await assert.rejects(ingestFrontendProcessEvents({ ...input, data: { ...message, client_event_id: randomUUID(), payload: { ...message.payload, source_turn_sequence_index: 2147483647 } } }));
    await assert.rejects(ingestFrontendProcessEvents({ ...input, student_user_db_id: assessment.created_by_user_db_id!, data: summary }));
    assert.equal(await unobserved(), 2, "Tutor exposure must not acknowledge item answers");
    const events = await db.processEvent.findMany({ where: { assessment_session_db_id: session.id }, include: { item: true } });
    const files = responseStageExportFiles([{ session_public_id: ids[0], research_student_id: "synthetic", assessment_public_id: demoAssessmentPublicId,
      attempt_number: 1, items: [], turns: [], events: events.map(event => ({ ...event, item_public_id: event.item?.item_public_id ?? null })) }]);
    const exposures = parse(files.find(file => file.path === "feedback_exposure_events.csv")!.data, { columns: true }) as Record<string, string>[];
    assert.equal(exposures.length, 3);
    assert.equal(exposures.find(row => row.event_type === "formative_feedback_shown")!.source_turn_sequence_index, String(tutor.sequence_index));
    assert(files.find(file => file.path === "response_stage_data_dictionary.csv")!.data.includes("minimum_visible_ms"));
    console.log("PASS display: generation/summary/item/tutor separation, ownership, reference validation, deduplication, CSV joins and definitions");

    const lifecycle = (action: "pause" | "resume" | "end" | "finish") => updateStudentFormativeConversationLifecycle({ ...input, action });
    const dashboardInput = { teacher_user_db_id: assessment.created_by_user_db_id!, assessment_public_id: demoAssessmentPublicId };
    const dashboardBefore = await getTeacherAssessmentDashboard(dashboardInput);
    const profilesBefore = await db.studentProfile.count({ where: { concept_unit_session_db_id: concept.id } });
    await assert.rejects(lifecycle("finish"), /Finish is available/);
    await lifecycle("pause");
    assert.equal((await db.assessmentSession.findUniqueOrThrow({ where: { id: session.id } })).completed_at, null);
    await lifecycle("resume");
    const openingReceipt = await db.formativeConversationMessageReceipt.findFirstOrThrow({ where: { formative_conversation_session: { assessment_session_db_id: session.id } } });
    await db.formativeConversationMessageReceipt.update({ where: { id: openingReceipt.id }, data: { assistant_response_status: "failed" } });
    await assert.rejects(lifecycle("end"), /tutor response is not ready/);
    await db.formativeConversationMessageReceipt.update({ where: { id: openingReceipt.id }, data: { assistant_response_status: "completed" } });
    await lifecycle("end");
    assert.equal((await db.assessmentSession.findUniqueOrThrow({ where: { id: session.id } })).status, "active");
    const receipt = await db.formativeConversationMessageReceipt.findFirstOrThrow({ where: { formative_conversation_session: { assessment_session_db_id: session.id } } });
    await db.formativeConversationMessageReceipt.update({ where: { id: receipt.id }, data: { assistant_response_status: "failed" } });
    await assert.rejects(lifecycle("finish"), /Finish is available/);
    await db.formativeConversationMessageReceipt.update({ where: { id: receipt.id }, data: { assistant_response_status: "completed" } });
    await db.conceptUnitSession.update({ where: { id: concept.id }, data: { initial_completed_at: null } });
    await assert.rejects(lifecycle("finish"), /Finish is available/);
    await db.conceptUnitSession.update({ where: { id: concept.id }, data: { initial_completed_at: concept.initial_completed_at } });
    await assert.rejects(updateStudentFormativeConversationLifecycle({ ...input, student_user_db_id: assessment.created_by_user_db_id!, action: "finish" }));
    await Promise.all([lifecycle("finish"), lifecycle("finish")]);
    const completed = await db.assessmentSession.findUniqueOrThrow({ where: { id: session.id } });
    assert.equal(completed.status, "completed"); assert.equal(completed.current_phase, "session_completed"); assert(completed.completed_at);
    assert.equal(await db.processEvent.count({ where: { assessment_session_db_id: session.id, event_type: "session_completed" } }), 1);
    assert.equal(await db.studentProfile.count({ where: { concept_unit_session_db_id: concept.id } }), profilesBefore);
    const final = await getStudentSessionState(input);
    assert.equal(final.assessment_state, "SESSION_COMPLETE"); assert.equal(final.attempt_lifecycle?.terminal, true);
    assert.equal(teacherPhaseLabel("planning_completed"), "Learning conversation");
    assert.equal(teacherPhaseLabel("planning_completed", "ended"), "Conversation ended; assessment not finished");
    assert.equal(teacherPhaseLabel("session_completed", "ended"), "Assessment completed");
    const listed = await listTeacherReviewSessions(sessionListQuerySchema.parse({ search: student.user_id }));
    assert.equal(listed.sessions[0].session_status, "completed");
    assert.equal(listed.sessions[0].current_phase, "session_completed");
    const dashboardAfter = await getTeacherAssessmentDashboard(dashboardInput);
    assert.equal(dashboardAfter.summary_cards.completed, dashboardBefore.summary_cards.completed + 1);
    assert.equal(dashboardAfter.summary_cards.started_not_completed, dashboardBefore.summary_cards.started_not_completed - 1);
    const bundle = await buildAnalysisReadyResearchDataBundle({ ...dashboardInput,
      scope: "selected_session", session_public_id: ids[0], include_incomplete_sessions: false });
    const exportedSessions = parse(bundle.files.find(file => file.path === "sessions.csv")!.data, { columns: true }) as Record<string, string>[];
    assert.equal(exportedSessions.length, 1);
    assert.equal(exportedSessions[0].canonical_runtime_state, "SESSION_COMPLETE");
    console.log("PASS completion: explicit finish, pause/failed-feedback/incomplete/ownership guards, concurrent retry, persisted lifecycle, no invented profile");
    console.log("PASS teacher dashboard/list and research export agree with the completed student attempt");
  } finally {
    await cleanupSmokeStudentSessions({ prisma: db, userDbId: student.id, sessionPublicIds: ids });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => db.$disconnect());
