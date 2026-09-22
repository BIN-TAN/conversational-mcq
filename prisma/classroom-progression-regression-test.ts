import assert from "node:assert/strict";
import { prisma } from "../src/lib/db";
import { demoAssessmentPublicId, ensureDemoStudentAssessment } from "./demo-student-assessment-fixture";
import {
  getStudentSessionState, recordSelectedOption, recordReasoning, recordConfidence,
  recordTemptingOption, startOrResumeStudentAssessmentSession,
  startConceptUnitInitialAdministration, updateInFlowItemResponse, submitItemResponse
} from "../src/lib/services/student-assessment/service";

async function main() {
  const url = new URL(process.env.DATABASE_URL ?? "");
  assert(["localhost", "127.0.0.1"].includes(url.hostname));
  assert(url.pathname.startsWith("/conversational_mcq_classroom_audit_login_flow_"));
  Object.assign(process.env, { ALLOW_MANUAL_REVIEW_STUDENT_STARTS: "true", ALLOW_LOCAL_MOCK_RUNTIME: "true",
    LLM_PROVIDER: "mock", LLM_LIVE_CALLS_ENABLED: "false", ITEM_ADMIN_TUTOR_MODE: "mock", OPERATIONAL_AGENT_MODE: "disabled" });
  await ensureDemoStudentAssessment(prisma);
  const demo = await prisma.user.findUniqueOrThrow({ where: { user_id_normalized: "student_demo" } });
  const userId = `progression_${Date.now()}`;
  const student = await prisma.user.create({ data: { user_id: userId, user_id_normalized: userId,
    role: "student", account_status: "active", access_code_hash: demo.access_code_hash,
    created_by_teacher_user_id: demo.created_by_teacher_user_id } });
  const started = await startOrResumeStudentAssessmentSession({ student_user_db_id: student.id,
    assessment_public_id: demoAssessmentPublicId });
  const base = { student_user_db_id: student.id, session_public_id: started.session.session_public_id };
  const session = await prisma.assessmentSession.findUniqueOrThrow({ where: { session_public_id: base.session_public_id } });
  let state = await startConceptUnitInitialAdministration({ ...base,
    concept_unit_public_id: started.state.current_concept_unit!.concept_unit_public_id });
  for (let index = 0; index < 3; index++) {
    const itemId = state.current_item!.item_public_id;
    const action = { ...base, item_public_id: itemId };
    await recordSelectedOption({ ...action, data: { selected_option: "A" } });
    await recordReasoning({ ...action, data: { reasoning_text: "I think item difficulty changes the ability estimate across different test forms." } });
    await recordConfidence({ ...action, data: { confidence_rating: "medium" } });
    await recordTemptingOption({ ...action, data: { tempting_option: "B" } });

    const incomplete = await updateInFlowItemResponse({ ...action, data: { tempting_option: "C", no_tempting_option: false } });
    assert.equal(incomplete.state.assessment_state, "AWAIT_TEMPTING_REASON", "An unfinished edit must still request reasoning");
    if (index < 2) {
      const data = index === 0 ? { no_tempting_option: true, client_action_id: `edited-${itemId}` }
        : { tempting_option: "D", tempting_option_reason: "The option seemed to explain the role of difficulty.", client_action_id: `edited-${itemId}` };
      const edited = await updateInFlowItemResponse({ ...action, data });
      state = edited.state;
      assert.equal(state.assessment_state, "AWAIT_ANSWER");
      assert.notEqual(state.current_item!.item_public_id, itemId);
      const repeated = await updateInFlowItemResponse({ ...action, data });
      assert.equal(repeated.state.current_item!.item_public_id, state.current_item!.item_public_id);
    } else {
      // Reproduce a record left by the old edit path: complete evidence but no submission time.
      const response = await prisma.itemResponse.findFirstOrThrow({ where: {
        item: { item_public_id: itemId }, concept_unit_session: { assessment_session: { session_public_id: base.session_public_id } }
      } });
      await prisma.conversationTurn.create({ data: { assessment_session_db_id: session.id,
        concept_unit_session_db_id: response.concept_unit_session_db_id, item_db_id: response.item_db_id,
        actor_type: "student", phase: "initial_item_administration", message_text: "No other option was tempting.",
        structured_payload: { source: "initial_tempting_option", no_tempting_option: true, item_public_id: itemId } } });
      const stranded = await getStudentSessionState(base);
      assert.equal(stranded.assessment_state, "ITEM_COMPLETE");
      const data = { client_action_id: `complete-ready:${itemId}` };
      state = (await submitItemResponse({ ...action, data })).state;
      assert.equal(state.assessment_state, "PACKAGE_REVIEW");
      assert.equal((await submitItemResponse({ ...action, data })).state.assessment_state, "PACKAGE_REVIEW");
    }
    const events = await prisma.processEvent.findMany({ where: { assessment_session: { session_public_id: base.session_public_id },
      item: { item_public_id: itemId }, event_type: "item_completed" } });
    assert.equal(events.length, 1, "Completion is recorded exactly once, including retries");
  }
  assert.equal(await prisma.processEvent.count({ where: { assessment_session: { session_public_id: base.session_public_id },
    event_type: "assessment_completion_summary_shown" } }), 0, "Initial items must not claim assessment completion");
  assert.equal(state.progress.completed_initial_item_count, 3);
  console.log("PASS: edited No, edited explanation, incomplete edit, interrupted-state recovery, retries, completion research events");
}
main().finally(() => prisma.$disconnect()).catch(error => { console.error(error); process.exitCode = 1; });
