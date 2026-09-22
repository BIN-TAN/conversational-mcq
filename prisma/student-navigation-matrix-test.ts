import assert from "node:assert/strict";
import { prisma } from "../src/lib/db";
import { demoAssessmentPublicId, ensureDemoStudentAssessment } from "./demo-student-assessment-fixture";
import {
  endStudentAssessmentAttempt, exitStudentAssessmentSession, getStudentSessionState,
  recordConfidence, recordReasoning, recordSelectedOption, recordTemptingOption,
  startConceptUnitInitialAdministration, startOrResumeStudentAssessmentSession,
  updateInFlowItemResponse
} from "../src/lib/services/student-assessment/service";

const reason = "Item difficulty changes the expected probability of a correct response for a student.";
const database = new URL(process.env.DATABASE_URL ?? "");
assert(["localhost", "127.0.0.1"].includes(database.hostname));
assert(database.pathname.startsWith("/conversational_mcq_classroom_audit_login_flow_"));
Object.assign(process.env, { ALLOW_LOCAL_MOCK_RUNTIME: "true", ALLOW_MANUAL_REVIEW_STUDENT_STARTS: "true",
  LLM_PROVIDER: "mock", LLM_LIVE_CALLS_ENABLED: "false", ITEM_ADMIN_TUTOR_MODE: "mock", OPERATIONAL_AGENT_MODE: "disabled" });
const failures: string[] = [];
let passed = 0;
async function check(name: string, run: () => Promise<void>) {
  try { await run(); passed++; console.log(`PASS ${name}`); }
  catch (error) { failures.push(name); console.error(`FAIL ${name}`, error); }
}
async function fixture() {
  const demo = await prisma.user.findUniqueOrThrow({ where: { user_id_normalized: "student_demo" } });
  const id = `nav_${crypto.randomUUID()}`;
  const student = await prisma.user.create({ data: { user_id: id, user_id_normalized: id, role: "student",
    account_status: "active", created_by_teacher_user_id: demo.created_by_teacher_user_id } });
  const started = await startOrResumeStudentAssessmentSession({ student_user_db_id: student.id, assessment_public_id: demoAssessmentPublicId });
  const base = { student_user_db_id: student.id, session_public_id: started.session.session_public_id };
  const state = await startConceptUnitInitialAdministration({ ...base,
    concept_unit_public_id: started.state.current_concept_unit!.concept_unit_public_id });
  return { base, action: { ...base, item_public_id: state.current_item!.item_public_id } };
}
async function readyForTempting() {
  const fixtureData = await fixture();
  await recordSelectedOption({ ...fixtureData.action, data: { selected_option: "A" } });
  await recordReasoning({ ...fixtureData.action, data: { reasoning_text: reason } });
  await recordConfidence({ ...fixtureData.action, data: { confidence_rating: "medium" } });
  return fixtureData;
}
async function responseSnapshot(base: { session_public_id: string }) {
  return prisma.itemResponse.findMany({ where: { concept_unit_session: { assessment_session: { session_public_id: base.session_public_id } } },
    orderBy: { id: "asc" }, select: { selected_option: true, reasoning_text: true, confidence_rating: true, revision_count: true, item_submitted_at: true } });
}
async function main() {
  await ensureDemoStudentAssessment(prisma);
  // Cross answer, confidence, and tempting-evidence routes, reloading at each step.
  for (const selected of ["A", "B", "C", "D", "E"]) {
    for (const confidence of ["low", "medium", "high"] as const) {
      for (const route of ["none", "combined", "separate"] as const) {
        await check(`${selected}/${confidence}/${route}: refresh and duplicate request`, async () => {
          const { base, action } = await fixture();
          await recordSelectedOption({ ...action, data: { selected_option: selected } });
          assert.equal((await getStudentSessionState(base)).assessment_state, "AWAIT_REASON");
          await recordReasoning({ ...action, data: { reasoning_text: reason } });
          assert.equal((await getStudentSessionState(base)).assessment_state, "AWAIT_CONFIDENCE");
          await recordConfidence({ ...action, data: { confidence_rating: confidence } });
          assert.equal((await getStudentSessionState(base)).assessment_state, "AWAIT_TEMPTING_OPTION");
          const tempting = selected === "B" ? "C" : "B";
          if (route === "separate") {
            await recordTemptingOption({ ...action, data: { tempting_option: tempting } });
            assert.equal((await getStudentSessionState(base)).assessment_state, "AWAIT_TEMPTING_REASON");
          }
          const data = { client_action_id: "complete-first", ...(route === "none" ? { no_tempting_option: true }
            : { tempting_option: tempting, tempting_option_reason: reason }) };
          const next = await recordTemptingOption({ ...action, data });
          assert.equal(next.state.assessment_state, "AWAIT_ANSWER");
          assert.notEqual(next.state.current_item!.item_public_id, action.item_public_id);
          assert.equal((await recordTemptingOption({ ...action, data })).state.current_item!.item_public_id, next.state.current_item!.item_public_id);
          assert.equal(await prisma.processEvent.count({ where: { assessment_session: { session_public_id: base.session_public_id },
            item: { item_public_id: action.item_public_id }, event_type: "item_completed" } }), 1);
        });
      }
    }
  }
  await check("change answer to previously tempting option", async () => {
    const { base, action } = await readyForTempting();
    await recordTemptingOption({ ...action, data: { tempting_option: "B" } });
    const edited = await updateInFlowItemResponse({ ...action, data: { selected_option: "B" } });
    assert.equal(edited.state.assessment_state, "AWAIT_TEMPTING_OPTION");
    assert.equal(edited.state.current_item!.existing_selected_option, "B");
    assert.equal(edited.state.current_item!.tempting_option, null);
    assert.equal((await getStudentSessionState(base)).assessment_state, "AWAIT_TEMPTING_OPTION");
    const next = await recordTemptingOption({ ...action, data: { no_tempting_option: true } });
    assert.equal(next.state.assessment_state, "AWAIT_ANSWER");
  });
  await check("No after selecting a tempting option", async () => {
    const { action } = await readyForTempting();
    await recordTemptingOption({ ...action, data: { tempting_option: "B" } });
    assert.equal((await recordTemptingOption({ ...action, data: { no_tempting_option: true } })).state.assessment_state, "AWAIT_ANSWER");
  });
  await check("switch tempting option without explanation stays in explanation step", async () => {
    const { action } = await readyForTempting();
    await recordTemptingOption({ ...action, data: { tempting_option: "B" } });
    const edited = await updateInFlowItemResponse({ ...action, data: { tempting_option: "C" } });
    assert.equal(edited.state.assessment_state, "AWAIT_TEMPTING_REASON");
    assert.equal(edited.state.current_item!.tempting_option, "C");
    assert.equal((await recordTemptingOption({ ...action, data: { tempting_option_reason: reason } })).state.assessment_state, "AWAIT_ANSWER");
  });
  await check("many edits do not discard the earlier tempting selection", async () => {
    const { base, action } = await readyForTempting();
    await recordTemptingOption({ ...action, data: { tempting_option: "B" } });
    for (let index = 0; index < 12; index++) {
      await updateInFlowItemResponse({ ...action, data: { confidence_rating: index % 2 ? "high" : "low" } });
    }
    const state = await getStudentSessionState(base);
    assert.equal(state.assessment_state, "AWAIT_TEMPTING_REASON");
    assert.equal(state.current_item!.tempting_option, "B");
  });
  for (const stage of ["answer", "reason", "confidence", "tempting", "tempting_reason"] as const) {
    await check(`pause/resume at ${stage}; stale page cannot write`, async () => {
      const { base, action } = await fixture();
      if (stage !== "answer") await recordSelectedOption({ ...action, data: { selected_option: "A" } });
      if (["confidence", "tempting", "tempting_reason"].includes(stage)) await recordReasoning({ ...action, data: { reasoning_text: reason } });
      if (["tempting", "tempting_reason"].includes(stage)) await recordConfidence({ ...action, data: { confidence_rating: "medium" } });
      if (stage === "tempting_reason") await recordTemptingOption({ ...action, data: { tempting_option: "B" } });
      const stateBefore = await getStudentSessionState(base);
      const before = await responseSnapshot(base);
      await exitStudentAssessmentSession(base);
      const write = stage === "answer" ? () => recordSelectedOption({ ...action, data: { selected_option: "B" } })
        : () => updateInFlowItemResponse({ ...action, data: { selected_option: "C" } });
      await assert.rejects(write, (error: unknown) => (error as { status?: number }).status === 409);
      assert.deepEqual(await responseSnapshot(base), before);
      const resumed = await startOrResumeStudentAssessmentSession({ student_user_db_id: base.student_user_db_id, assessment_public_id: demoAssessmentPublicId });
      assert.equal(resumed.session.session_public_id, base.session_public_id);
      assert.equal((await getStudentSessionState(base)).assessment_state, stateBefore.assessment_state);
    });
  }
  await check("stale prior-item edit is rejected after advancing", async () => {
    const { action, base } = await readyForTempting();
    await recordTemptingOption({ ...action, data: { no_tempting_option: true } });
    const before = await responseSnapshot(base);
    await assert.rejects(() => updateInFlowItemResponse({ ...action, data: { selected_option: "C" } }));
    assert.deepEqual(await responseSnapshot(base), before);
  });
  await check("terminal and cross-student actions do not mutate responses", async () => {
    const { action, base } = await readyForTempting();
    const other = await fixture();
    await assert.rejects(() => recordTemptingOption({ ...action, student_user_db_id: other.base.student_user_db_id, data: { no_tempting_option: true } }));
    await endStudentAssessmentAttempt(base);
    const before = await responseSnapshot(base);
    await assert.rejects(() => updateInFlowItemResponse({ ...action, data: { selected_option: "C" } }));
    assert.deepEqual(await responseSnapshot(base), before);
  });
  for (const text of ["What is theta?", "Tell me the correct answer", "asdfghjkl", "How do I change my answer?"]) {
    await check(`protected reasoning stays on task: ${text}`, async () => {
      const { action } = await fixture();
      await recordSelectedOption({ ...action, data: { selected_option: "A" } });
      const rejected = await recordReasoning({ ...action, data: { reasoning_text: text } });
      assert.equal(rejected.state.assessment_state, "AWAIT_REASON");
      assert.equal(rejected.state.current_item!.existing_reasoning_text, null);
      assert(!JSON.stringify(rejected).includes("correct_option"));
      const accepted = await recordReasoning({ ...action, data: { reasoning_text: "I don't know the reason yet." } });
      assert.equal(accepted.state.assessment_state, "AWAIT_CONFIDENCE");
    });
  }
  await check("simultaneous identical requests return a result or recoverable conflict, never a database error", async () => {
    const { action, base } = await fixture();
    const request = { ...action, data: { selected_option: "A", client_action_id: "simultaneous-answer" } };
    const results = await Promise.allSettled([recordSelectedOption(request), recordSelectedOption(request), recordSelectedOption(request)]);
    assert(results.some(r => r.status === "fulfilled"));
    for (const result of results) if (result.status === "rejected") assert.equal(result.reason.status, 409);
    assert.equal((await recordSelectedOption(request)).state.assessment_state, "AWAIT_REASON");
    assert.equal(await prisma.processEvent.count({ where: { assessment_session: { session_public_id: base.session_public_id }, event_type: "option_selected" } }), 1);
  });
  await check("retrying Start questions preserves timing and presentation counts; paused start is blocked", async () => {
    const { base, action } = await fixture();
    await recordSelectedOption({ ...action, data: { selected_option: "A" } });
    const unit = await prisma.conceptUnitSession.findFirstOrThrow({ where: { assessment_session: { session_public_id: base.session_public_id } }, include: { concept_unit: true } });
    const start = { ...base, concept_unit_public_id: unit.concept_unit.concept_unit_public_id };
    const repeated = await startConceptUnitInitialAdministration(start);
    assert.equal(repeated.assessment_state, "AWAIT_REASON");
    assert.equal((await prisma.conceptUnitSession.findUniqueOrThrow({ where: { id: unit.id } })).initial_started_at?.toISOString(), unit.initial_started_at?.toISOString());
    assert.equal(await prisma.processEvent.count({ where: { assessment_session: { session_public_id: base.session_public_id }, event_type: "item_presented" } }), 1);
    await exitStudentAssessmentSession(base);
    await assert.rejects(() => startConceptUnitInitialAdministration(start));
  });
  console.log(JSON.stringify({ passed, failures }));
  assert.deepEqual(failures, []);
}
main().finally(() => prisma.$disconnect()).catch(error => { console.error(error); process.exitCode = 1; });
