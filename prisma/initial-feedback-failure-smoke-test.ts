import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { parse } from "csv-parse/sync";
import { prisma } from "../src/lib/db";
import { createResponseCollectionFixture, cleanupResponseCollectionFixture } from "./response-collection-smoke-fixture";
import { cleanupSmokeStudentSessions } from "./student-mvp-smoke-helpers";
import { submitInitialConceptUnitForPreparation, getStudentSessionState, startConceptUnitInitialAdministration, endStudentAssessmentAttempt } from "../src/lib/services/student-assessment/service";
import { processInitialPreparationJob } from "../src/lib/workflow/initial-preparation";
import { getOwnedInitialPreparationStatus } from "../src/lib/workflow/initial-preparation-status";
import { buildAnalysisReadyResearchDataBundle } from "../src/lib/services/teacher-research-data/analysis-ready-export";
import { processEventLabel } from "../src/lib/services/teacher-review/process-data-summary";

const db = new URL(process.env.DATABASE_URL ?? "");
assert(["localhost", "127.0.0.1"].includes(db.hostname) && db.pathname.startsWith("/conversational_mcq_classroom_audit_"));
assert.equal(process.env.LLM_PROVIDER, "mock");
assert.equal(process.env.LLM_LIVE_CALLS_ENABLED, "false");
let networkCalls = 0;
globalThis.fetch = async () => { networkCalls++; throw new Error("network_not_allowed"); };
const prefix = `feedback_failure_${randomUUID().replaceAll("-", "")}`;
const fixtures: Awaited<ReturnType<typeof createResponseCollectionFixture>>[] = [];
let passed = 0;
const pass = (message: string) => { passed++; console.log(`PASS ${message}`); };

async function fixture(label: string) {
  const f = await createResponseCollectionFixture({ prisma, prefix: `${prefix}_${label}`, responseCollectionMode: "deterministic" });
  fixtures.push(f);
  await prisma.itemResponse.createMany({ data: f.items.map(item => ({ concept_unit_session_db_id: f.conceptUnitSession.id,
    item_db_id: item.id, selected_option: "A", correct_option_snapshot: "A", correctness: "correct" as const,
    reasoning_text: "Synthetic preserved reasoning", confidence_rating: "medium" as const, item_submitted_at: new Date(),
    item_version_snapshot: 1, item_snapshot: item as unknown as Prisma.InputJsonValue })) });
  const input = { student_user_db_id: f.student.id, session_public_id: f.session.session_public_id,
    concept_unit_public_id: f.conceptUnit.concept_unit_public_id, execution_mode: "deterministic_e1" as const };
  await submitInitialConceptUnitForPreparation(input);
  const job = await prisma.workflowJob.findFirstOrThrow({ where: { assessment_session_db_id: f.session.id } });
  return { ...f, input, job };
}
async function fail(f: Awaited<ReturnType<typeof fixture>>, tokenLimit: boolean) {
  const job = await prisma.workflowJob.update({ where: { id: f.job.id }, data: {
    status: "running", locked_at: new Date(), locked_by: "synthetic-worker", attempt_count: 1
  } });
  return processInitialPreparationJob(job, { prepare: async () => {
    if (tokenLimit) await prisma.agentCall.create({ data: {
      assessment_session_db_id: f.session.id, concept_unit_session_db_id: f.conceptUnitSession.id,
      agent_name: "formative_value_and_planning_agent", agent_version: "synthetic-failure-v1",
      prompt_version: "synthetic", schema_version: "synthetic",
      model_name: "mock", provider: "mock", input_payload: {}, call_status: "failed",
      max_output_tokens: 3000, output_tokens: 3000, incomplete_reason: "max_output_tokens", completed_at: new Date()
    } });
    throw new Error("synthetic_provider_failure");
  } });
}
async function evidence(id: string) {
  const where = { concept_unit_session: { assessment_session_db_id: id } };
  return { items: await prisma.itemResponse.findMany({ where, orderBy: { id: "asc" } }),
    packages: await prisma.responsePackage.findMany({ where, orderBy: { id: "asc" } }),
    calls: await prisma.agentCall.findMany({ where: { assessment_session_db_id: id }, orderBy: { id: "asc" } }) };
}

async function main() {
try {
  const f = await fixture("single");
  await assert.rejects(endStudentAssessmentAttempt({ ...f.input, student_user_db_id: f.teacher.id }));
  assert.equal(await fail(f, true), "failed");
  const status = (await getOwnedInitialPreparationStatus(f.input)).preparation;
  assert.equal(status?.failure_reason, "output_token_limit");
  assert.equal(status?.can_continue, false);
  assert.equal(status?.can_retry, true);
  const failedJob = await prisma.workflowJob.findUniqueOrThrow({ where: { id: f.job.id } });
  assert.equal(failedJob.attempt_count, 1);
  assert.equal(failedJob.max_attempts, 3);
  pass("token exhaustion stops automatic repeats; explicit retry stays available, continuation is disabled");
  await prisma.assessmentSession.update({ where: { id: f.session.id }, data: { status: "paused" } });
  assert.equal((await getOwnedInitialPreparationStatus(f.input)).preparation?.can_continue, false);
  await prisma.assessmentSession.update({ where: { id: f.session.id }, data: { status: "active" } });
  const before = await evidence(f.session.id);
  await prisma.assessmentSession.update({ where: { id: f.session.id }, data: { needs_review_reason: "Prior review concern" } });
  const results = await Promise.all(Array.from({ length: 4 }, () => endStudentAssessmentAttempt(f.input)));
  assert.equal(results.filter(r => r.end_status === "ended_by_student").length, 1);
  assert.deepEqual(await evidence(f.session.id), before);
  assert.deepEqual(await prisma.workflowJob.findUniqueOrThrow({ where: { id: f.job.id } }), failedJob);
  const state = await getStudentSessionState(f.input);
  assert.equal(state.preparation?.status, "cancelled");
  const persisted = await prisma.assessmentSession.findUniqueOrThrow({ where: { id: f.session.id } });
  assert.equal(persisted.needs_review, true);
  assert(persisted.needs_review_reason?.includes("Prior review concern"));
  assert.equal(persisted.status, "student_exited");
  assert.equal(persisted.completed_at, null);
  const unit = await prisma.conceptUnitSession.findUniqueOrThrow({ where: { id: f.conceptUnitSession.id } });
  assert.equal(unit.followup_status, "incomplete");
  assert.equal(unit.followup_completed_at, null);
  assert.equal(await prisma.studentProfile.count({ where: { concept_unit_session_db_id: unit.id } }), 0);
  assert.equal(await prisma.formativeConversationProfileTransition.count({ where: { formative_conversation_session: { assessment_session_db_id: f.session.id } } }), 0);
  assert.equal(await prisma.processEvent.count({ where: { assessment_session_db_id: f.session.id, event_type: "initial_feedback_terminated" } }), 1);
  assert.equal(await prisma.processEvent.count({ where: { assessment_session_db_id: f.session.id, event_type: { in: ["initial_feedback_skipped", "session_completed"] } } }), 0);
  await assert.rejects(submitInitialConceptUnitForPreparation(f.input));
  pass("one idempotent termination preserves products and failed calls; no completion, profile or learning gain; existing review flags retained");

  const bundle = await buildAnalysisReadyResearchDataBundle({ teacher_user_db_id: f.teacher.id, scope: "selected_session",
    session_public_id: f.session.session_public_id, include_incomplete_sessions: true });
  const events = parse(bundle.files.find(file => file.path === "process_events.csv")!.data, { columns: true, skip_empty_lines: true }) as { event_type: string }[];
  assert.equal(events.filter(row => row.event_type === "initial_feedback_terminated").length, 1);
  const sessions = parse(bundle.files.find(file => file.path === "sessions.csv")!.data, { columns: true, skip_empty_lines: true }) as Record<string, string>[];
  assert.equal(sessions[0].formative_activity_completion_status, "incomplete_technical_failure");
  assert.equal(sessions[0].activity_skip_reason, "");
  assert.equal(sessions[0].assessment_completion_reason, "ended_after_initial_feedback_failure");
  assert.equal(sessions[0].attempt_lifecycle_status, "ended_by_student");
  assert.equal(sessions[0].selected_navigation_destination, "end_attempt");
  assert.equal(sessions[0].session_limitations, "initial_feedback_unavailable");
  assert.equal(processEventLabel("initial_feedback_terminated"), "Student ended the attempt after AI feedback failed");
  pass("research CSV distinguishes technical termination from completion and skipped activities");

  const multi = await fixture("multiple_topics");
  const next = await prisma.conceptUnit.create({ data: {
    assessment_db_id: multi.assessment.id, concept_unit_public_id: `${prefix}_next`, title: "Next synthetic topic",
    learning_objective: "Check progression", related_concept_description: "Synthetic only", order_index: 2, status: "published"
  } });
  for (const item of multi.items) {
    await prisma.item.create({ data: { concept_unit_db_id: next.id, item_public_id: `${prefix}_next_${item.item_order}`,
      item_order: item.item_order, item_stem: item.item_stem, correct_option: item.correct_option,
      status: "published", included_in_published_set: true,
      options: item.options as Prisma.InputJsonValue,
      distractor_rationales: item.distractor_rationales as Prisma.InputJsonValue,
      expected_reasoning_patterns: item.expected_reasoning_patterns as Prisma.InputJsonValue,
      possible_misconception_indicators: item.possible_misconception_indicators as Prisma.InputJsonValue,
      administration_rules: item.administration_rules as Prisma.InputJsonValue } });
  }
  assert.equal(await fail(multi, true), "failed");
  await endStudentAssessmentAttempt(multi.input);
  await assert.rejects(startConceptUnitInitialAdministration({ ...multi.input, concept_unit_public_id: next.concept_unit_public_id }));
  assert.equal(await prisma.conceptUnitSession.count({ where: { assessment_session_db_id: multi.session.id, concept_unit_db_id: next.id } }), 0);
  assert.equal(await prisma.processEvent.count({ where: { assessment_session_db_id: multi.session.id, event_type: "item_presented" } }), 0);
  assert.equal((await endStudentAssessmentAttempt(multi.input)).end_status, "already_ended");
  pass("termination ends the whole attempt, never starts a later topic, and cannot resume on replay");

  const corrupt = await fixture("corrupt");
  await prisma.workflowJob.update({ where: { id: corrupt.job.id }, data: { status: "failed", last_error_category: "preparation_source_conflict" } });
  assert.equal((await getOwnedInitialPreparationStatus(corrupt.input)).preparation?.can_continue, false);
  assert.equal((await getOwnedInitialPreparationStatus(corrupt.input)).preparation?.can_retry, false);
  await endStudentAssessmentAttempt(corrupt.input);
  assert.equal((await prisma.assessmentSession.findUniqueOrThrow({ where: { id: corrupt.session.id } })).status, "student_exited");
  pass("source conflicts require teacher review but do not prevent a student from ending safely");

  const transient = await fixture("transient");
  await prisma.agentCall.create({ data: { assessment_session_db_id: transient.session.id,
    concept_unit_session_db_id: transient.conceptUnitSession.id, agent_name: "formative_value_and_planning_agent",
    agent_version: "old", model_name: "mock", provider: "mock", input_payload: {}, call_status: "failed",
    prompt_version: "synthetic", schema_version: "synthetic",
    incomplete_reason: "max_output_tokens", created_at: new Date(0) } });
  assert.equal(await fail(transient, false), "retryable");
  assert.equal((await getOwnedInitialPreparationStatus(transient.input)).preparation?.can_continue, false);
  pass("old truncation does not misclassify a new transient error; in-flight work cannot be skipped");

  const race = await fixture("race");
  await fail(race, true);
  const raced = await Promise.allSettled([endStudentAssessmentAttempt(race.input), submitInitialConceptUnitForPreparation(race.input)]);
  assert.equal(raced[0].status, "fulfilled");
  const racedJob = await prisma.workflowJob.findUniqueOrThrow({ where: { id: race.job.id } });
  assert(["failed", "cancelled"].includes(racedJob.status));
  assert.equal((await prisma.assessmentSession.findUniqueOrThrow({ where: { id: race.session.id } })).status, "student_exited");
  assert.equal(await prisma.processEvent.count({ where: { assessment_session_db_id: race.session.id, event_type: "initial_feedback_skipped" } }), 0);
  pass("concurrent retry and end leaves no runnable work or next-topic destination");
  assert.equal(networkCalls, 0);
  console.log(JSON.stringify({ passed, external_provider_calls: 0 }));
} finally {
  for (const f of fixtures) await cleanupSmokeStudentSessions({ prisma, userDbId: f.student.id, sessionPublicIds: [f.session.session_public_id] });
  await cleanupResponseCollectionFixture(prisma, prefix);
  await prisma.$disconnect();
}
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
