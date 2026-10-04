import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { Prisma, type WorkflowJob } from "@prisma/client";
import { prisma } from "../src/lib/db";
import { createResponseCollectionFixture, cleanupResponseCollectionFixture } from "./response-collection-smoke-fixture";
import { cleanupSmokeStudentSessions } from "./student-mvp-smoke-helpers";
import { submitInitialConceptUnitForPreparation, getStudentReviewResponses, getStudentSessionState, endStudentAssessmentAttempt } from "../src/lib/services/student-assessment/service";
import { claimInitialPreparationJob, processInitialPreparationJob, renewInitialPreparationLease } from "../src/lib/workflow/initial-preparation";
import { getOwnedInitialPreparationStatus } from "../src/lib/workflow/initial-preparation-status";
import { claimNextWorkflowJob } from "../src/lib/workflow/jobs";
import { latestFormativeCallAttempt, recordUnexpectedFormativeCallFailure, reserveFormativeCallAttempt } from "../src/lib/services/student-assessment/formative-call-attempts";

const database = new URL(process.env.DATABASE_URL ?? "");
assert(["localhost", "127.0.0.1"].includes(database.hostname));
assert(database.pathname.startsWith("/conversational_mcq_classroom_audit_"));
assert.equal(process.env.LLM_PROVIDER, "mock");
assert.equal(process.env.LLM_LIVE_CALLS_ENABLED, "false");
let networkCalls = 0;
globalThis.fetch = async () => { networkCalls++; throw new Error("no_provider_or_network_allowed"); };
const prefix = `initial_preparation_${randomUUID().replaceAll("-", "")}`;
const fixtures: Awaited<ReturnType<typeof createResponseCollectionFixture>>[] = [];
const results: string[] = [];
const pass = (name: string) => { results.push(name); console.log(`PASS ${name}`); };

async function fixture(name: string) {
  const f = await createResponseCollectionFixture({ prisma, prefix: `${prefix}_${name}`, responseCollectionMode: "deterministic" });
  fixtures.push(f);
  await prisma.itemResponse.createMany({ data: f.items.map((item) => ({
    concept_unit_session_db_id: f.conceptUnitSession.id, item_db_id: item.id,
    selected_option: "A", correct_option_snapshot: "A", correctness: "correct" as const,
    reasoning_text: "The option follows the evidence and distinguishes the two quantities.", confidence_rating: "medium" as const,
    item_submitted_at: new Date(), item_version_snapshot: 1, item_snapshot: item as unknown as Prisma.InputJsonValue
  })) });
  return { ...f, input: {
    student_user_db_id: f.student.id, session_public_id: f.session.session_public_id,
    concept_unit_public_id: f.conceptUnit.concept_unit_public_id, execution_mode: "deterministic_e1" as const
  } };
}
async function jobFor(id: string) { return prisma.workflowJob.findFirstOrThrow({ where: { assessment_session_db_id: id, job_type: "prepare_initial_conversation" } }); }
async function claim() {
  // A newly queued run_after can be a few milliseconds ahead of the database clock.
  for (let attempt = 0; attempt < 40; attempt++) {
    const job = await claimInitialPreparationJob(`test-${randomUUID()}`);
    if (job) return job;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.fail("A due preparation job should become claimable within one second.");
}
async function makeDue(job: WorkflowJob) {
  await prisma.workflowJob.update({ where: { id: job.id }, data: { run_after: new Date(0) } });
}

async function main() {
  const first = await fixture("submission");
  await assert.rejects(submitInitialConceptUnitForPreparation({ ...first.input, student_user_db_id: first.teacher.id }));
  await assert.rejects(getOwnedInitialPreparationStatus({ ...first.input, student_user_db_id: first.teacher.id }));
  pass("submission and progress are student-owned");
  const originalTransaction = prisma.$transaction.bind(prisma);
  prisma.$transaction = (async (callback: (tx: Prisma.TransactionClient) => Promise<unknown>, options: object) => originalTransaction(async (tx) => {
    tx.workflowJob.create = (() => { throw new Error("synthetic_enqueue_failure"); }) as typeof tx.workflowJob.create;
    return callback(tx);
  }, options)) as typeof prisma.$transaction;
  try { await assert.rejects(submitInitialConceptUnitForPreparation(first.input), /synthetic_enqueue_failure/); }
  finally { prisma.$transaction = originalTransaction; }
  assert.equal((await prisma.conceptUnitSession.findUniqueOrThrow({ where: { id: first.conceptUnitSession.id } })).initial_completed_at, null);
  assert.equal(await prisma.responsePackage.count({ where: { concept_unit_session_db_id: first.conceptUnitSession.id } }), 0);
  assert.equal(await prisma.processEvent.count({ where: { assessment_session_db_id: first.session.id, event_type: "package_submitted" } }), 0);
  pass("failed enqueue rolls back submission, evidence snapshot, and submission event");

  const started = Date.now();
  const submissions = await Promise.all(Array.from({ length: 4 }, () => submitInitialConceptUnitForPreparation(first.input)));
  console.log(`submission_acknowledgement_ms=${Date.now() - started}`);
  assert(submissions.every((result) => result.completion_status === "accepted" && result.state.preparation?.status === "queued"));
  assert.equal(await prisma.agentCall.count({ where: { assessment_session_db_id: first.session.id } }), 0);
  assert.equal(await prisma.workflowJob.count({ where: { assessment_session_db_id: first.session.id } }), 1);
  assert.equal(await prisma.responsePackage.count({ where: { concept_unit_session_db_id: first.conceptUnitSession.id } }), 1);
  assert.equal(await prisma.processEvent.count({ where: { assessment_session_db_id: first.session.id, event_type: "package_submitted" } }), 1);
  assert.equal((await getStudentReviewResponses(first.input)).locked, true);
  const source = await prisma.responsePackage.findFirstOrThrow({ where: { concept_unit_session_db_id: first.conceptUnitSession.id } });
  pass("concurrent submissions return before AI work with one sealed package and one job");
  assert.equal(await claimNextWorkflowJob("legacy-worker"), null);
  pass("legacy workflow worker cannot consume initial-preparation jobs");
  const claimed = await claim();
  assert.equal(await claimInitialPreparationJob("other-worker"), null);
  pass("two workers cannot claim the same job");
  process.env.WORKFLOW_JOB_LEASE_TIMEOUT_MS = "1000";
  let finish!: () => void;
  let entered!: () => void;
  const active = new Promise<void>((resolve) => { entered = resolve; });
  const gate = new Promise<void>((resolve) => { finish = resolve; });
  const running = processInitialPreparationJob(claimed, { prepare: async (check) => { entered(); await gate; await check(); } });
  await active;
  try {
    await new Promise((resolve) => setTimeout(resolve, 1600));
    assert.equal(await claimInitialPreparationJob("late-worker"), null);
    assert.equal((await getStudentSessionState(first.input)).preparation?.status, "preparing");
    assert.equal((await submitInitialConceptUnitForPreparation(first.input)).state.preparation?.status, "preparing");
    const parallel = await fixture("parallel_student");
    await submitInitialConceptUnitForPreparation(parallel.input);
    const otherJob = await claim();
    assert.equal(otherJob.assessment_session_db_id, parallel.session.id);
    await processInitialPreparationJob(otherJob, { prepare: async () => {} });
    assert.equal((await jobFor(first.session.id)).status, "running");
    pass("another student's preparation can complete while the first job is still running");
  } finally { finish(); await running; }
  pass("heartbeats protect long work; refresh and repeated submission only observe it");

  const crash = await fixture("restart");
  await submitInitialConceptUnitForPreparation(crash.input);
  const stale = await claim();
  await prisma.workflowJob.update({ where: { id: stale.id }, data: { locked_at: new Date(0) } });
  const restarted = await claim();
  assert.equal(restarted.id, stale.id);
  await assert.rejects(renewInitialPreparationLease(stale));
  assert.equal(await processInitialPreparationJob(stale, { prepare: async () => { throw new Error("must_not_run"); } }), "lost_lease");
  assert.equal((await jobFor(crash.session.id)).locked_by, restarted.locked_by);
  pass("restart recovers abandoned work and stale workers cannot finish a newer lease");
  await processInitialPreparationJob(restarted, { prepare: async () => { throw new Error("synthetic_transient_failure"); } });
  await makeDue(restarted);
  const lastTry = await claim();
  await processInitialPreparationJob(lastTry, { prepare: async () => { throw new Error("synthetic_transient_failure"); } });
  assert.equal((await jobFor(crash.session.id)).status, "failed");
  assert.equal((await getOwnedInitialPreparationStatus(crash.input)).preparation?.can_retry, true);
  assert.equal(await claimInitialPreparationJob("exhausted-worker"), null);
  await submitInitialConceptUnitForPreparation(crash.input);
  assert.equal((await jobFor(crash.session.id)).attempt_count, 3);
  assert.equal((await jobFor(crash.session.id)).max_attempts, 6);
  await processInitialPreparationJob(await claim(), { prepare: async () => {} });
  pass("bounded retries stop; explicit retry preserves one job and attempt history");

  const quota = await fixture("quota_recovery");
  await submitInitialConceptUnitForPreparation(quota.input);
  const quotaJob = await claim();
  const responsesBefore = await prisma.itemResponse.findMany({ where: { concept_unit_session_db_id: quota.conceptUnitSession.id } });
  const packageBefore = await prisma.responsePackage.findMany({ where: { concept_unit_session_db_id: quota.conceptUnitSession.id } });
  assert.equal(await processInitialPreparationJob(quotaJob, { prepare: async () => {
    await prisma.agentCall.create({ data: {
      assessment_session_db_id: quota.session.id, concept_unit_session_db_id: quota.conceptUnitSession.id,
      agent_name: "formative_conversation_agent", agent_version: "synthetic-v1", model_name: "mock",
      prompt_version: "synthetic-v1", schema_version: "synthetic-v1", input_payload: { synthetic: true },
      call_status: "failed", error_category: "quota", output_validated: false,
      raw_output: { provider_failure: { provider_error_code: "credit_balance_exhausted" } }
    } });
    throw new Error("synthetic_quota_failure");
  } }), "failed");
  assert.equal((await jobFor(quota.session.id)).last_error_category, "provider_account_unavailable");
  assert.equal(await claimInitialPreparationJob("quota-no-automatic-repeat"), null);
  assert.equal((await getOwnedInitialPreparationStatus(quota.input)).preparation?.can_retry, true);
  assert.equal((await prisma.assessmentSession.findUniqueOrThrow({ where: { id: quota.session.id } })).status, "active");
  assert.deepEqual(await prisma.itemResponse.findMany({ where: { concept_unit_session_db_id: quota.conceptUnitSession.id } }), responsesBefore);
  assert.deepEqual(await prisma.responsePackage.findMany({ where: { concept_unit_session_db_id: quota.conceptUnitSession.id } }), packageBefore);
  await submitInitialConceptUnitForPreparation(quota.input);
  assert.equal(await processInitialPreparationJob(await claim(), { prepare: async () => {} }), "completed");
  assert.equal(await prisma.agentCall.count({ where: { assessment_session_db_id: quota.session.id, error_category: "quota" } }), 1);
  pass("quota stops automatic retries without closing the attempt; explicit recovery retains responses, packages and failure audit");

  const throttled = await fixture("throttle_delay");
  await submitInitialConceptUnitForPreparation(throttled.input);
  const delayedJob = await claim();
  const failureAt = new Date();
  assert.equal(await processInitialPreparationJob(delayedJob, { prepare: async () => {
    await prisma.agentCall.create({ data: {
      assessment_session_db_id: throttled.session.id, concept_unit_session_db_id: throttled.conceptUnitSession.id,
      agent_name: "formative_conversation_agent", agent_version: "synthetic-v1", model_name: "mock",
      prompt_version: "synthetic-v1", schema_version: "synthetic-v1", input_payload: { synthetic: true },
      call_status: "failed", error_category: "rate_limit", output_validated: false, completed_at: failureAt,
      raw_output: { provider_failure: { retry_after_ms: 61_000 } }
    } });
    throw new Error("synthetic_rate_limit");
  } }), "retryable");
  assert((await jobFor(throttled.session.id)).run_after.getTime() >= failureAt.getTime() + 61_000);
  assert.equal(await claimInitialPreparationJob("server-delay-floor"), null);
  await makeDue(delayedJob);
  assert.equal(await processInitialPreparationJob(await claim(), { prepare: async () => {} }), "completed");
  pass("background retry also honors the provider delay without shortening it to the worker backoff");

  const paused = await fixture("paused");
  await submitInitialConceptUnitForPreparation(paused.input);
  await prisma.assessmentSession.update({ where: { id: paused.session.id }, data: { status: "paused", resume_phase: "profiling_pending" } });
  assert.equal(await claimInitialPreparationJob("paused-worker"), null);
  assert.equal((await getOwnedInitialPreparationStatus(paused.input)).preparation?.status, "paused");
  await prisma.assessmentSession.update({ where: { id: paused.session.id }, data: { status: "active", resume_phase: null } });
  const pauseJob = await claim();
  await processInitialPreparationJob(pauseJob, { prepare: async (check) => {
    await prisma.assessmentSession.update({ where: { id: paused.session.id }, data: { status: "paused" } });
    await check();
  } });
  assert.equal((await jobFor(paused.session.id)).attempt_count, 1);
  assert.equal((await jobFor(paused.session.id)).max_attempts, 4);
  await endStudentAssessmentAttempt(paused.input);
  assert.equal(await claimInitialPreparationJob("ended-worker"), null);
  assert.equal((await jobFor(paused.session.id)).status, "cancelled");
  pass("pause defers without spending retries; ending cancels queued preparation");

  const ended = await fixture("end_inflight");
  await submitInitialConceptUnitForPreparation(ended.input);
  await processInitialPreparationJob(await claim(), { prepare: async (check) => {
    await endStudentAssessmentAttempt(ended.input); await check();
  } });
  assert.equal((await jobFor(ended.session.id)).status, "cancelled");
  assert.equal((await getStudentSessionState(ended.input)).attempt_lifecycle.terminal, true);
  pass("an attempt ended during preparation cannot advance to the next stage");

  const invalid = await fixture("source_conflict");
  await submitInitialConceptUnitForPreparation(invalid.input);
  const invalidJob = await jobFor(invalid.session.id);
  await prisma.workflowJob.update({ where: { id: invalidJob.id }, data: { payload: { ...(invalidJob.payload as Prisma.JsonObject), response_package_hash: "changed" } } });
  assert.equal(await processInitialPreparationJob(await claim(), { prepare: async () => { throw new Error("must_not_run"); } }), "failed");
  assert.equal((await getOwnedInitialPreparationStatus(invalid.input)).preparation?.can_retry, false);
  await assert.rejects(submitInitialConceptUnitForPreparation(invalid.input));
  pass("changed source evidence fails closed and cannot be retried by the student");

  const failedProfile = await fixture("failed_profile_retry");
  await submitInitialConceptUnitForPreparation(failedProfile.input);
  const profileJob = await claim();
  const updateAgentCall = prisma.agentCall.update.bind(prisma.agentCall);
  let failedCallId: string | null = null;
  prisma.agentCall.update = (async (args: Prisma.AgentCallUpdateArgs) => {
    const call = await prisma.agentCall.findUniqueOrThrow({ where: args.where });
    if (!failedCallId && call.assessment_session_db_id === failedProfile.session.id &&
        call.agent_name === "formative_value_and_planning_agent" && args.data.call_status === "succeeded") {
      failedCallId = call.id;
      await updateAgentCall({ where: { id: call.id }, data: {
        call_status: "invalid_output", output_validated: false, output_payload: Prisma.JsonNull,
        validation_error: "synthetic_provider_validation_failure", completed_at: new Date()
      } });
      throw new Error("synthetic_provider_validation_failure");
    }
    return updateAgentCall(args);
  }) as unknown as typeof prisma.agentCall.update;
  try { assert.equal(await processInitialPreparationJob(profileJob), "retryable"); }
  finally { prisma.agentCall.update = updateAgentCall; }
  assert(failedCallId);
  const failureRecord = await prisma.agentCall.findUniqueOrThrow({ where: { id: failedCallId } });
  const sealedBeforeRetry = await prisma.responsePackage.findMany({ where: { concept_unit_session_db_id: failedProfile.conceptUnitSession.id } });
  await makeDue(profileJob);
  assert.equal(await processInitialPreparationJob(await claim()), "completed", "A failed profile call must not poison the next preparation attempt's invocation key.");
  assert.deepEqual(await prisma.agentCall.findUniqueOrThrow({ where: { id: failedCallId } }), failureRecord);
  assert.deepEqual(await prisma.responsePackage.findMany({ where: { concept_unit_session_db_id: failedProfile.conceptUnitSession.id } }), sealedBeforeRetry);
  const retriedCalls = await prisma.agentCall.findMany({ where: {
    assessment_session_db_id: failedProfile.session.id, agent_name: "formative_value_and_planning_agent"
  } });
  assert.equal(retriedCalls.length, 2);
  assert.equal(retriedCalls.filter(call => call.call_status === "succeeded" && call.output_validated).length, 1);
  assert.equal((await getStudentSessionState(failedProfile.input)).formative_conversation?.opening_status, "ready");
  await prisma.workflowJob.update({ where: { id: profileJob.id }, data: { status: "retryable", run_after: new Date(0), completed_at: null } });
  assert.equal(await processInitialPreparationJob(await claim()), "completed");
  assert.equal(await prisma.agentCall.count({ where: {
    assessment_session_db_id: failedProfile.session.id, agent_name: "formative_value_and_planning_agent"
  } }), 2);
  pass("failed profile retries retain the failed audit, recover the opening, and replay without duplicating evidence");

  const reservationFixture = await fixture("call_reservation");
  const reservationData = {
    assessment_session_db_id: reservationFixture.session.id, concept_unit_session_db_id: reservationFixture.conceptUnitSession.id,
    agent_invocation_key: `synthetic-retry:${prefix}`, agent_name: "synthetic_formative_retry", agent_version: "test-v1",
    model_name: "mock", prompt_version: "test-v1", schema_version: "test-v1", input_payload: { synthetic: true },
    call_status: "started" as const, started_at: new Date()
  };
  const concurrentReservations = await Promise.all(Array.from({ length: 4 }, () => reserveFormativeCallAttempt(reservationData)));
  assert.equal(concurrentReservations.filter(result => result.created).length, 1);
  assert.equal(new Set(concurrentReservations.map(result => result.call.id)).size, 1);
  let latest = concurrentReservations[0].call;
  for (let index = 1; index <= 12; index++) {
    await recordUnexpectedFormativeCallFailure(latest.id);
    const savedFailure = await prisma.agentCall.findUniqueOrThrow({ where: { id: latest.id } });
    const retries = await Promise.all(Array.from({ length: 3 }, () => reserveFormativeCallAttempt(reservationData)));
    assert.equal(retries.filter(result => result.created).length, 1);
    assert.equal(new Set(retries.map(result => result.call.id)).size, 1);
    assert.deepEqual(await prisma.agentCall.findUniqueOrThrow({ where: { id: latest.id } }), savedFailure);
    latest = retries[0].call;
    assert(latest.agent_invocation_key?.endsWith(`:retry:${String(index).padStart(8, "0")}`));
    assert.equal((await latestFormativeCallAttempt(reservationData.agent_invocation_key))?.id, latest.id);
  }
  await prisma.agentCall.update({ where: { id: latest.id }, data: { call_status: "succeeded", output_validated: true } });
  await recordUnexpectedFormativeCallFailure(latest.id);
  const replay = await reserveFormativeCallAttempt(reservationData);
  assert.equal(replay.created, false);
  assert.equal(replay.call.call_status, "succeeded");
  await assert.rejects(reserveFormativeCallAttempt({ ...reservationData, assessment_session_db_id: first.session.id }),
    (error: unknown) => (error as { code: string }).code === "idempotency_conflict");
  pass("concurrent retries reserve one call, preserve all prior failures, retain successful results, and enforce session scope");

  const full = await fixture("full_pipeline");
  await submitInitialConceptUnitForPreparation(full.input);
  process.env.WORKFLOW_JOB_LEASE_TIMEOUT_MS = "300000";
  // Start the same standalone worker used alongside Next, without a browser or an open request.
  const child = spawn(process.execPath, ["--import", "tsx", "prisma/initial-preparation-worker.ts"], { env: process.env, stdio: ["ignore", "pipe", "pipe"] });
  let logs = "";
  child.stdout.on("data", (data) => { logs += data; }); child.stderr.on("data", (data) => { logs += data; });
  const exited = new Promise((resolve) => child.once("exit", resolve));
  try {
    const deadline = Date.now() + 90_000;
    while (Date.now() < deadline && child.exitCode === null) {
      const job = await jobFor(full.session.id);
      if (["completed", "failed"].includes(job.status)) break;
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    assert.equal((await jobFor(full.session.id)).status, "completed", logs);
  } finally { child.kill("SIGTERM"); await exited; }
  const ready = await getStudentSessionState(full.input);
  assert.equal(ready.preparation?.status, "ready");
  assert.equal(ready.formative_conversation?.opening_status, "ready");
  assert.equal(ready.formative_conversation?.transcript.filter((turn) => turn.actor === "tutor").length, 1);
  const before = await prisma.agentCall.count({ where: { assessment_session_db_id: full.session.id } });
  await submitInitialConceptUnitForPreparation(full.input);
  assert.equal(await claimInitialPreparationJob("replay-worker"), null);
  assert.equal(await prisma.agentCall.count({ where: { assessment_session_db_id: full.session.id } }), before);
  const savedJob = await jobFor(full.session.id);
  await prisma.workflowJob.update({ where: { id: savedJob.id }, data: { status: "retryable", run_after: new Date(0), completed_at: null } });
  assert.equal(await processInitialPreparationJob(await claim()), "completed");
  assert.equal(await prisma.agentCall.count({ where: { assessment_session_db_id: full.session.id } }), before);
  assert.equal((await getStudentSessionState(full.input)).formative_conversation?.transcript.filter((turn) => turn.actor === "tutor").length, 1);
  pass("recovery after successful generation reuses validated results without duplicate calls or opening");
  assert.deepEqual((await prisma.responsePackage.findUniqueOrThrow({ where: { id: source.id } })).payload, source.payload);
  pass("standalone worker completes the validated mock pipeline; replay does not repeat work or rewrite evidence");
  assert.equal(networkCalls, 0);
  assert.equal(await prisma.agentCall.count({ where: { assessment_session_db_id: { in: fixtures.map((f) => f.session.id) }, provider: "openai" } }), 0);
  pass("zero provider calls and zero network requests in the test process");
  console.log(JSON.stringify({ passed: results.length, results }));
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => {
  for (const f of fixtures) {
    await cleanupSmokeStudentSessions({ prisma, userDbId: f.student.id, sessionPublicIds: [f.session.session_public_id] });
  }
  await cleanupResponseCollectionFixture(prisma, prefix);
  await prisma.$disconnect();
});
