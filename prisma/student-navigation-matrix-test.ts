import assert from "node:assert/strict";
import { parse } from "csv-parse/sync";
import { prisma } from "../src/lib/db";
import { buildAnalysisReadyResearchDataBundle } from "../src/lib/services/teacher-research-data/analysis-ready-export";
import { createResponsePackage } from "../src/lib/services/response-packages";
import { demoAssessmentPublicId, ensureDemoStudentAssessment } from "./demo-student-assessment-fixture";
import {
  endStudentAssessmentAttempt, exitStudentAssessmentSession, getStudentSessionState,
  recordConfidence, recordReasoning, recordSelectedOption, recordTemptingOption,
  startConceptUnitInitialAdministration, startOrResumeStudentAssessmentSession,
  updateInFlowItemResponse, updatePackageReviewItemResponse
} from "../src/lib/services/student-assessment/service";

const reason = "Item difficulty changes the expected probability of a correct response for a student.";
const database = new URL(process.env.DATABASE_URL ?? "");
assert(["localhost", "127.0.0.1"].includes(database.hostname));
assert(database.pathname.startsWith("/conversational_mcq_classroom_audit_login_flow_"));
Object.assign(process.env, { ALLOW_LOCAL_MOCK_RUNTIME: "true", ALLOW_MANUAL_REVIEW_STUDENT_STARTS: "true",
  LLM_PROVIDER: "mock", LLM_LIVE_CALLS_ENABLED: "false", ITEM_ADMIN_TUTOR_MODE: "mock", OPERATIONAL_AGENT_MODE: "disabled" });
const failures: string[] = [];
const evidenceChecks: { scenario: string; sessions: string[] }[] = [];
let scenarioSessions: string[] = [];
let passed = 0;
async function check(name: string, run: () => Promise<void>) {
  scenarioSessions = [];
  try {
    await run();
    for (const session of scenarioSessions) await verifyResearchExport(session);
    evidenceChecks.push({ scenario: name, sessions: [...scenarioSessions] });
    passed++; console.log(`PASS ${name} (persisted records and research export)`);
  }
  catch (error) { failures.push(name); console.error(`FAIL ${name}`, error); }
}
async function fixture() {
  const demo = await prisma.user.findUniqueOrThrow({ where: { user_id_normalized: "student_demo" } });
  const id = `nav_${crypto.randomUUID()}`;
  const student = await prisma.user.create({ data: { user_id: id, user_id_normalized: id, role: "student",
    account_status: "active", created_by_teacher_user_id: demo.created_by_teacher_user_id } });
  const started = await startOrResumeStudentAssessmentSession({ student_user_db_id: student.id, assessment_public_id: demoAssessmentPublicId });
  const base = { student_user_db_id: student.id, session_public_id: started.session.session_public_id };
  scenarioSessions.push(base.session_public_id);
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
const record = (value: unknown) => value as Record<string, unknown>;
async function verifyResearchExport(sessionId: string) {
  const session = await prisma.assessmentSession.findUniqueOrThrow({ where: { session_public_id: sessionId },
    include: { user: true, concept_unit_sessions: { include: { item_responses: { include: { item: true } } } },
      conversation_turns: { orderBy: { sequence_index: "asc" } }, process_events: true } });
  const bundle = await buildAnalysisReadyResearchDataBundle({ teacher_user_db_id: session.user.created_by_teacher_user_id!,
    scope: "selected_session", session_public_id: sessionId, include_incomplete_sessions: true });
  const rows = (name: string): Record<string, string>[] => parse(bundle.files.find(f => f.path === name)!.data, { columns: true, skip_empty_lines: true });
  const products = rows("item_responses.csv");
  const turns = rows("conversation_turns.csv");
  assert.equal(turns.length, session.conversation_turns.length, "All persisted transcript turns exported once");
  assert.equal(new Set(session.conversation_turns.map(t => t.sequence_index)).size, turns.length);
  assert.equal(rows("process_events.csv").length, session.process_events.length, "All persisted events exported once");
  assert.equal(rows("sessions.csv").length, 1);
  assert.equal(rows("response_stage_visits.csv").length, 0, "Server-only tests must not invent browser observations");
  for (const behavior of rows("item_behavior_summary.csv")) {
    assert.equal(behavior.observed_stage_visit_count, "0");
    assert.equal(behavior.first_action_ms, "", "Unobserved browser timing must be missing, not zero");
  }
  const responses = session.concept_unit_sessions.flatMap(c => c.item_responses);
  assert.equal(products.length, responses.length);
  for (const response of responses) {
    const row = products.find(r => r.item_public_id === response.item.item_public_id)!;
    for (const key of ["selected_option", "reasoning_text", "confidence_rating", "revision_count"] as const) {
      assert.equal(row[key], String(response[key] ?? ""), `Export parity: ${key}`);
    }
    assert.equal(row.item_version, String(response.item_version_snapshot));
    assert.equal(row.response_finalized, String(Boolean(response.item_submitted_at)));
    assert(!("correct_option" in row), "Ordinary export must not expose restricted keys");
    const itemTurns = session.conversation_turns.filter(t => t.item_db_id === response.item_db_id && t.actor_type === "student");
    const latest = itemTurns.filter(t => ["initial_tempting_option", "transfer_tempting_option", "package_review_tempting_option"].includes(String(record(t.structured_payload).source))).at(-1);
    const evidence = latest ? record(latest.structured_payload) : {};
    assert.equal(row.tempting_option, String(evidence.tempting_option ?? ""), "Latest alternative retained, including partial attempts");
    assert.equal(row.tempting_option_reason, String(evidence.tempting_option_reason ?? ""));
    assert.equal(row.no_tempting_option, String(evidence.no_tempting_option ?? ""), "No alternative must be distinguishable from not answered/reset");
    const events = session.process_events.filter(e => e.item_db_id === response.item_db_id);
    assert.equal(events.filter(e => e.event_type === "item_completed").length, response.item_submitted_at ? 1 : 0);
    assert.equal(events.filter(e => e.event_type === "item_submitted").length, response.item_submitted_at ? 1 : 0);
    const revisions = rows("response_revision_history.csv").filter(r => r.item_public_id === response.item.item_public_id);
    assert.equal(new Set(revisions.map(r => r.source_turn_sequence_index)).size, response.revision_count,
      "Field-change rows must reconstruct accepted revision operations without duplicates");
    assert(revisions.every(r => r.coverage === "before_and_after"));
  }
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
    await verifyResearchExport(base.session_public_id);
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
      const lifecycle = await prisma.processEvent.findMany({ where: { assessment_session: { session_public_id: base.session_public_id },
        event_type: { in: ["attempt_paused", "attempt_resumed"] } }, orderBy: { occurred_at: "asc" } });
      assert.deepEqual(lifecycle.map(e => e.event_type), ["attempt_paused", "attempt_resumed"]);
      assert.equal(await prisma.assessmentSession.count({ where: { user_db_id: base.student_user_db_id } }), 1, "Resume is not a new attempt");
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
  await check("package baseline excludes rejected text; confidence-only edit is not an answer change", async () => {
    const { base, action } = await fixture();
    await recordSelectedOption({ ...action, data: { selected_option: "A" } });
    await recordReasoning({ ...action, data: { reasoning_text: "What is theta?" } });
    await recordReasoning({ ...action, data: { reasoning_text: reason } });
    await recordConfidence({ ...action, data: { confidence_rating: "low" } });
    await updateInFlowItemResponse({ ...action, data: { confidence_rating: "high" } });
    await recordTemptingOption({ ...action, data: { no_tempting_option: true } });
    const unit = await prisma.conceptUnitSession.findFirstOrThrow({ where: { assessment_session: { session_public_id: base.session_public_id } } });
    const pkg = await createResponsePackage({ concept_unit_session_db_id: unit.id });
    const item = (record(pkg.payload).item_responses as Record<string, unknown>[]).find(i => i.item_public_id === action.item_public_id)!;
    assert.equal(item.reasoning_text_initial, reason);
    assert.equal(item.answer_changed, false);
    assert.equal(item.confidence_initial, "low");
    assert.equal(item.confidence_final, "high");
    assert.equal(record(pkg.payload).response_evidence_version, "accepted-response-evidence-v2");
  });
  await check("package review alternatives and immutable earlier package", async () => {
    const { base, action } = await readyForTempting();
    let state = (await recordTemptingOption({ ...action, data: { no_tempting_option: true } })).state;
    for (let i = 0; i < 2; i++) {
      const next = { ...base, item_public_id: state.current_item!.item_public_id };
      await recordSelectedOption({ ...next, data: { selected_option: "A" } });
      await recordReasoning({ ...next, data: { reasoning_text: reason } });
      await recordConfidence({ ...next, data: { confidence_rating: "low" } });
      state = (await recordTemptingOption({ ...next, data: { no_tempting_option: true } })).state;
    }
    assert.equal(state.assessment_state, "PACKAGE_REVIEW");
    const unit = await prisma.conceptUnitSession.findFirstOrThrow({ where: { assessment_session: { session_public_id: base.session_public_id } } });
    const original = await createResponsePackage({ concept_unit_session_db_id: unit.id });
    await updatePackageReviewItemResponse({ ...action, data: { selected_option: "A", reasoning_text: reason,
      confidence_rating: "medium", no_tempting_option: false, tempting_option: "C", tempting_option_reason: reason } });
    const revised = await createResponsePackage({ concept_unit_session_db_id: unit.id });
    const item = (record(revised.payload).item_responses as Record<string, unknown>[]).find(i => i.item_public_id === action.item_public_id)!;
    assert.equal(item.tempting_option, "C");
    assert.equal(item.tempting_option_reason, reason);
    assert.equal(item.no_tempting_option, false);
    assert.equal(item.answer_changed, false);
    assert.deepEqual((await prisma.responsePackage.findUniqueOrThrow({ where: { id: original.id } })).payload, original.payload);
  });
  console.log(JSON.stringify({ passed, failures, evidenceChecks }));
  assert.deepEqual(failures, []);
}
main().finally(() => prisma.$disconnect()).catch(error => { console.error(error); process.exitCode = 1; });
