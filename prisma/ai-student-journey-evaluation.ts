import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { loadEnvConfig } from "@next/env";
import { PrismaClient, type Item } from "@prisma/client";
import { z } from "zod";
import { parse } from "csv-parse/sync";
import { AI_STUDENT_ITEMS, AI_STUDENT_SCENARIOS } from "../src/lib/evaluation/ai-student-scenarios";
import type { StudentSessionState, StudentFormativeConversation } from "../src/lib/student-assessment-ui/types";
import type { StructuredAgentResult } from "../src/lib/llm/providers/types";

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const option = (name: string) => {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
};

async function main() {
  if (process.argv.includes("--dry-run")) {
    console.log(JSON.stringify({ synthetic_only: true, cases: AI_STUDENT_SCENARIOS, maximum_provider_dispatches: 160 }, null, 2));
    return;
  }
  assert(process.argv.includes("--allow-live-synthetic"), "Explicit opt-in required for paid synthetic AI calls.");
  assert(option("--runtime-env"), "Supply a locally materialized approved runtime environment.");
  loadEnvConfig(process.cwd(), true);
  const originalUrl = new URL(process.env.DATABASE_URL!);
  assert(["localhost", "127.0.0.1"].includes(originalUrl.hostname), "Only a fresh local database is permitted.");
  const runtime = JSON.parse(readFileSync(path.resolve(option("--runtime-env")!), "utf8")) as Record<string, string>;
  // Reuse approved role configuration, never the source environment's database or secrets.
  for (const [key, value] of Object.entries(runtime)) {
    if (/^(OPENAI_(MODEL_|REASONING_EFFORT_|MAX_OUTPUT_TOKENS_|REQUEST_TIMEOUT_MS$|MAX_RETRIES$)|OPERATIONAL_|FORMATIVE_CONVERSATION_LIVE_CALLS_ENABLED$)/.test(key)) process.env[key] = value;
  }
  const database = `cmcq_ai_students_${randomBytes(6).toString("hex")}`;
  const localUrl = new URL(originalUrl);
  localUrl.pathname = `/${database}`;
  const output = path.resolve(".data/ai-student-evaluation", database);
  mkdirSync(output, { recursive: true, mode: 0o700 });
  Object.assign(process.env, {
    DATABASE_URL: localUrl.href, NODE_ENV: "production", APP_ENV: "development",
    LLM_PROVIDER: "openai", LLM_LIVE_CALLS_ENABLED: "true", ITEM_ADMIN_TUTOR_MODE: "live",
    FORMATIVE_CONVERSATION_LIVE_CALLS_ENABLED: "true", ALLOW_MANUAL_REVIEW_STUDENT_STARTS: "true",
    RESEARCH_PSEUDONYMIZATION_KEY: randomBytes(40).toString("hex"),
    LLM_AGENT_CALL_LIMIT_PER_SESSION: "80", LLM_AGENT_CALL_LIMIT_PER_DAY: "180",
    LLM_DAILY_STUDENT_TOKEN_LIMIT: "500000", LLM_SESSION_TOKEN_LIMIT: "500000", LLM_DAILY_CLASS_TOKEN_LIMIT: "2500000"
  });
  const admin = new PrismaClient({ datasourceUrl: originalUrl.href });
  try { await admin.$executeRawUnsafe(`CREATE DATABASE "${database}"`); } finally { await admin.$disconnect(); }
  const migration = spawnSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"], { env: process.env, encoding: "utf8" });
  writeFileSync(path.join(output, "migration.log"), migration.stdout + migration.stderr);
  assert.equal(migration.status, 0, "Fresh database migrations failed.");

  const { prisma: db } = await import("../src/lib/db");
  const service = await import("../src/lib/services/student-assessment/service");
  const lifecycle = await import("../src/lib/services/student-assessment/formative-conversation/projection");
  const { claimInitialPreparationJob, processInitialPreparationJob } = await import("../src/lib/workflow/initial-preparation");
  const { processFormativeConversationStudentMessage } = await import("../src/lib/services/student-assessment/formative-conversation/runtime");
  const { buildFormativeConversationRuntimeContextSeed } = await import("../src/lib/services/student-assessment/formative-conversation/runtime-context");
  const { createLiveFormativeConversationV18R2AgentRunner } = await import("../src/lib/services/student-assessment/formative-conversation/live-runner-v18r2");
  const { buildAnalysisReadyResearchDataBundle } = await import("../src/lib/services/teacher-research-data/analysis-ready-export");
  const { getTeacherAssessmentDashboard } = await import("../src/lib/services/teacher-dashboard/assessment-dashboard");
  const { buildTeacherSessionDataAudit } = await import("../src/lib/services/teacher-review/session-data-audit");
  const { OpenAIResponsesProvider, withOpenAIResponsesTransportBoundaryObserver } = await import("../src/lib/llm/providers/openai-responses-provider");
  const { resolveOpenAIModelConfigForRole } = await import("../src/lib/llm/config");
  const generator = new OpenAIResponsesProvider({ isolated_evaluation_runtime: { purpose: "bounded_candidate_evaluation", request_timeout_ms: 120000 } });
  const studentModel = { ...resolveOpenAIModelConfigForRole("connectivity_test"), max_output_tokens: 3000 };
  const StudentReply = z.object({ message: z.string() }).strict();
  const selected = AI_STUDENT_SCENARIOS.filter(s => !option("--case") || s.id === option("--case"));
  assert(selected.length, "Unknown scenario.");
  const report = {
    version: "ai-student-journeys-v1", synthetic_only: true, real_student_records_used: false,
    scope: "Actual service, database, background preparation, tutor runtime, dashboard and research export; no browser exposure or usability measurement.",
    learner_method: "Fixed edge-case initial responses plus adaptive AI replies from student-visible conversation only; no answer keys or hidden profiles given to learner generator.",
    database, output_directory: output, started_at: new Date().toISOString(),
    source_commit: spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim(),
    scenarios_sha256: hash(AI_STUDENT_SCENARIOS), scenarios: selected,
    source_files_sha256: Object.fromEntries([
      "prisma/ai-student-journey-evaluation.ts", "src/lib/evaluation/ai-student-scenarios.ts",
      "src/lib/services/student-assessment/formative-profile.ts", "src/lib/services/student-assessment/semantic-item-review.ts",
      "src/lib/services/teacher-review/process-data-summary.ts",
      "src/lib/services/student-assessment/learning-profile-summary.ts",
      "src/lib/services/student-assessment/formative-conversation/live-runner-v18r2.ts",
      "src/lib/services/student-assessment/formative-conversation/evidence-identity-validator-v18.ts"
    ].map(file => [file, createHash("sha256").update(readFileSync(file)).digest("hex")])),
    runtime_hash: process.env.OPERATIONAL_APPROVED_CONFIG_HASH, student_model: studentModel,
    maximum_provider_dispatches: 160, provider_dispatches: 0, provider_models: {} as Record<string, number>,
    results: [] as Array<Record<string, unknown>>, finished_at: null as string | null
  };
  const save = () => writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
  save();
  console.log(JSON.stringify({ evaluation_started: true, output_directory: output, cases: selected.map(s => s.id) }));
  try {
    const teacher = await db.user.create({ data: { user_id: `${database}_teacher`, user_id_normalized: `${database}_teacher`, role: "teacher_researcher", display_name: "Synthetic evaluator" } });
    const assessment = await db.assessment.create({ data: {
      assessment_public_id: `asmt_${randomUUID()}`, title: "Synthetic measurement evaluation", status: "published",
      workflow_mode: "manual_review", response_collection_mode: "deterministic", created_by_user_db_id: teacher.id
    } });
    const topic = await db.conceptUnit.create({ data: {
      concept_unit_public_id: `cu_${randomUUID()}`, assessment_db_id: assessment.id, title: "Reliability and score interpretation",
      learning_objective: "Distinguish reliability, validity, SEM and population-specific score evidence.",
      related_concept_description: "Score consistency alone does not establish intended-use validity. SEM represents uncertainty. Reliability is population-specific.",
      administration_rules: { no_feedback_during_initial_administration: true }, order_index: 1, status: "published", version: 1
    } });
    const items: Item[] = [];
    for (const [index, item] of AI_STUDENT_ITEMS.entries()) items.push(await db.item.create({ data: {
      item_public_id: `item_${randomUUID()}`, concept_unit_db_id: topic.id, item_order: index + 1,
      item_stem: item.stem, options: item.options.map((text, i) => ({ label: "ABCD"[i], text })), correct_option: item.key,
      distractor_rationales: item.distractors,
      expected_reasoning_patterns: [item.explanation], possible_misconception_indicators: [item.misconception],
      administration_rules: { no_feedback_during_initial_administration: true }, included_in_published_set: true, status: "published", version: 1
    } }));
    await withOpenAIResponsesTransportBoundaryObserver(event => {
      if (event.event_type !== "transport_adapter_entered") return;
      report.provider_dispatches += 1;
      report.provider_models[event.model_name] = (report.provider_models[event.model_name] ?? 0) + 1;
      save();
      assert(report.provider_dispatches <= report.maximum_provider_dispatches, "Synthetic evaluation call budget exhausted.");
      console.log(JSON.stringify({ provider_dispatch: report.provider_dispatches, model: event.model_name }));
    }, async () => {
      let providerQuotaBlocked = false;
      for (const scenario of selected) {
        if (providerQuotaBlocked) {
          report.results.push({ case_id: scenario.id, outcome: "not_run_provider_quota", error: "Provider quota must be restored before more live scenarios." });
          save();
          continue;
        }
        const result: Record<string, unknown> = { case_id: scenario.id, started_at: new Date().toISOString(), checks: [], generated_student_replies: [], outcome: "running" };
        report.results.push(result);
        const checks = result.checks as string[];
        console.log(JSON.stringify({ case_started: scenario.id }));
        try {
          const student = await db.user.create({ data: { user_id: scenario.id, user_id_normalized: scenario.id, display_name: "Synthetic learner", role: "student", created_by_teacher_user_id: teacher.id } });
          const started = await service.startOrResumeStudentAssessmentSession({ student_user_db_id: student.id, assessment_public_id: assessment.assessment_public_id });
          const input = { student_user_db_id: student.id, session_public_id: started.session.session_public_id };
          result.session_public_id = input.session_public_id;
          let state: StudentSessionState = await service.startConceptUnitInitialAdministration({ ...input, concept_unit_public_id: topic.concept_unit_public_id });
          for (let index = 0; index < items.length; index += 1) {
            const current = { ...input, item_public_id: items[index].item_public_id };
            assert.equal(state.current_item?.item_public_id, current.item_public_id);
            const choice = { selected_option: scenario.choices[index], client_action_id: randomUUID() };
            state = (await service.recordSelectedOption({ ...current, data: choice })).state;
            await service.recordSelectedOption({ ...current, data: choice });
            state = (await service.recordReasoning({ ...current, data: { reasoning_text: scenario.reasons[index], client_action_id: randomUUID() } })).state;
            if (scenario.id === "little_reasoning_then_pause" && index === 1 && state.assessment_state === "AWAIT_REASON") {
              state = (await service.recordReasoning({ ...current, data: { reasoning_text: "I don't know why; I guessed.", client_action_id: randomUUID() } })).state;
            }
            assert.equal(state.assessment_state, "AWAIT_CONFIDENCE", `Reason did not advance for item ${index + 1}`);
            state = (await service.recordConfidence({ ...current, data: { confidence_rating: scenario.confidence, client_action_id: randomUUID() } })).state;
            if (scenario.tempting) {
              state = (await service.recordTemptingOption({ ...current, data: { tempting_option: AI_STUDENT_ITEMS[index].key, client_action_id: randomUUID() } })).state;
              assert.equal(state.assessment_state, "AWAIT_TEMPTING_REASON");
              state = (await service.recordTemptingOption({ ...current, data: { tempting_option_reason: "That explanation also seemed plausible, and I may rethink my current answer before submitting the set.", client_action_id: randomUUID() } })).state;
            } else state = (await service.recordTemptingOption({ ...current, data: { no_tempting_option: true, client_action_id: randomUUID() } })).state;
          }
          assert.equal(state.assessment_state, "PACKAGE_REVIEW");
          checks.push("All three items advanced to package review; answer replay accepted.");
          if (scenario.revise) for (const [index, item] of items.entries()) {
            state = (await service.updatePackageReviewItemResponse({ ...input, item_public_id: item.item_public_id, data: {
              selected_option: AI_STUDENT_ITEMS[index].key, reasoning_text: AI_STUDENT_ITEMS[index].explanation,
              confidence_rating: "medium", no_tempting_option: true, client_action_id: randomUUID()
            } })).state;
          }
          const before = Date.now();
          await service.submitInitialConceptUnitForPreparation({ ...input, concept_unit_public_id: topic.concept_unit_public_id });
          result.submission_ms = Date.now() - before;
          await service.submitInitialConceptUnitForPreparation({ ...input, concept_unit_public_id: topic.concept_unit_public_id });
          const session = await db.assessmentSession.findUniqueOrThrow({ where: { session_public_id: input.session_public_id } });
          const where = { assessment_session_db_id: session.id };
          assert.equal(await db.workflowJob.count({ where: { ...where, job_type: "prepare_initial_conversation" } }), 1);
          checks.push("Submission is asynchronous; duplicate submit creates one background job.");
          const job = await claimInitialPreparationJob(`synthetic-${database}`);
          assert.equal(job?.assessment_session_db_id, session.id);
          await processInitialPreparationJob(job!);
          const finalJob = await db.workflowJob.findUniqueOrThrow({ where: { id: job!.id } });
          result.preparation = { status: finalJob.status, error_category: finalJob.last_error_category, error_message: finalJob.last_error_message };
          assert.equal(finalJob.status, "completed", `Preparation ${finalJob.status}: ${finalJob.last_error_category}`);
          state = await service.getStudentSessionState(input);
          assert.equal(state.formative_conversation?.opening_status, "ready");
          checks.push("Real initial profiling and learning-conversation opening completed.");
          const followupTurns = "followupTurns" in scenario ? scenario.followupTurns : 2;
          for (let turn = 1; turn <= followupTurns; turn += 1) {
            const conversation: StudentFormativeConversation = state.formative_conversation!;
            const response: StructuredAgentResult<{ message: string }> = await generator.executeStructured({
              agent_name: "response_collection_agent", model_config: studentModel,
              instructions: "You are simulating one adult student for a bounded software evaluation, not tutoring or grading. Follow the supplied persona. Respond only to the visible conversation. Use at most 100 words. You have no hidden assessment information. Do not mention the evaluation. Return the student's message.",
              input: { persona: scenario.persona, reply_number: turn, initial_responses: scenario.reasons,
                visible_transcript: conversation.transcript.map(t => ({ actor: t.actor, message: t.message_text })) },
              output_schema: StudentReply, schema_name: "synthetic_student_reply", client_request_id: randomUUID(), timeout_ms: 120000
            });
            assert.equal(response.status, "completed", `Synthetic learner generation ${response.status}`);
            const message = StudentReply.parse(response.parsed_output).message;
            (result.generated_student_replies as unknown[]).push({ turn, message, usage: response.usage });
            const messageInput = { conversation_public_id: conversation.conversation_public_id, client_message_id: randomUUID(), message_text: message,
              context: await buildFormativeConversationRuntimeContextSeed({ conversation_public_id: conversation.conversation_public_id, student_user_db_id: student.id }) };
            await processFormativeConversationStudentMessage(messageInput, { runner_factory: createLiveFormativeConversationV18R2AgentRunner });
            const calls = await db.agentCall.count({ where });
            await processFormativeConversationStudentMessage(messageInput, { runner_factory: createLiveFormativeConversationV18R2AgentRunner });
            assert.equal(await db.agentCall.count({ where }), calls, "Message replay created another AI call.");
            state = await service.getStudentSessionState(input);
            result.transcript = state.formative_conversation!.transcript;
            save();
          }
          checks.push(`${followupTurns} adaptive AI-student messages received saved tutor replies; replays made no new AI calls.`);
          if (scenario.pause) {
            if (state.formative_conversation?.status === "active") await lifecycle.updateStudentFormativeConversationLifecycle({ ...input, action: "pause" });
            state = await service.getStudentSessionState(input);
            assert.equal(state.formative_conversation?.status, "paused");
            const resumed = await service.startOrResumeStudentAssessmentSession({ student_user_db_id: student.id, assessment_public_id: assessment.assessment_public_id });
            assert.equal(resumed.session.session_public_id, input.session_public_id);
            await lifecycle.updateStudentFormativeConversationLifecycle({ ...input, action: "resume" });
            checks.push("Pause and resume preserved the same assessment attempt.");
          }
          state = await service.getStudentSessionState(input);
          if (state.formative_conversation?.status === "active" || state.formative_conversation?.status === "paused") await lifecycle.updateStudentFormativeConversationLifecycle({ ...input, action: "end" });
          await lifecycle.updateStudentFormativeConversationLifecycle({ ...input, action: "finish" });
          await lifecycle.updateStudentFormativeConversationLifecycle({ ...input, action: "finish" });
          const completed = await db.assessmentSession.findUniqueOrThrow({ where: { id: session.id } });
          assert.equal(completed.status, "completed");
          assert.equal(completed.current_phase, "session_completed");
          assert.equal(await db.processEvent.count({ where: { ...where, event_type: "session_completed" } }), 1);
          const unit = await db.conceptUnitSession.findFirstOrThrow({ where });
          const responses = await db.itemResponse.findMany({ where: { concept_unit_session_db_id: unit.id }, orderBy: { item: { item_order: "asc" } } });
          assert.equal(responses.length, 3);
          assert(responses.every(r => r.student_display_acknowledged_at === null), "Service-only test must not fabricate browser exposure.");
          assert.deepEqual(responses.map(r => r.selected_option), scenario.revise ? AI_STUDENT_ITEMS.map(i => i.key) : [...scenario.choices]);
          const dashboardInput = { teacher_user_db_id: teacher.id, assessment_public_id: assessment.assessment_public_id };
          const bundle = await buildAnalysisReadyResearchDataBundle({ ...dashboardInput, scope: "selected_session", session_public_id: input.session_public_id, include_incomplete_sessions: false });
          const bundlePath = path.join(output, scenario.id);
          mkdirSync(bundlePath, { recursive: true });
          for (const file of bundle.files) writeFileSync(path.join(bundlePath, path.basename(file.path)), file.data);
          const manifest = JSON.parse(bundle.files.find(file => file.path === "research_manifest.json")!.data) as { entries: Array<{ path: string; sha256: string; bytes: number }> };
          for (const entry of manifest.entries) {
            const file = bundle.files.find(candidate => candidate.path === entry.path);
            assert(file, `Missing manifest entry ${entry.path}`);
            assert.equal(createHash("sha256").update(file.data).digest("hex"), entry.sha256);
            assert.equal(Buffer.byteLength(file.data, "utf8"), entry.bytes);
          }
          const audit = await buildTeacherSessionDataAudit({ session_public_id: input.session_public_id });
          writeFileSync(path.join(bundlePath, "process-audit.json"), JSON.stringify(audit, null, 2));
          assert.equal(audit.behavior_summary.core.assessment_view_open_count, null);
          for (const conversation of audit.behavior_summary.conversations) {
            assert.equal(conversation.input_telemetry_coverage, "not_recorded");
            assert.equal(conversation.edits, null);
            assert.equal(conversation.backspaces, null);
            assert.equal(conversation.paste_actions, null);
          }
          result.research_manifest_entries_verified = manifest.entries.length;
          if (scenario.revise) {
            const events = await db.processEvent.findMany({ where });
            for (const type of ["answer_changed", "confidence_changed", "tempting_option_changed"]) {
              assert.equal(events.filter(event => event.event_type === type).length, 3, `Incorrect ${type} count`);
            }
            checks.push("All three answer, confidence and tempting-option revisions retained as distinct events.");
          }
          if (scenario.pause) {
            const pauseFile = bundle.files.find(file => file.path === "pause_episodes.csv");
            assert(pauseFile && (parse(pauseFile.data, { columns: true }) as unknown[]).length > 0, "Pause episode missing from research export.");
          }
          const turnFile = bundle.files.find(file => file.path === "formative_conversation_turns.csv");
          assert(turnFile, "Missing research conversation table.");
          const rows = parse(turnFile.data, { columns: true }) as Record<string, string>[];
          result.exported_turn_count = rows.length;
          assert.equal(rows.length, state.formative_conversation!.transcript.length);
          const dashboard = await getTeacherAssessmentDashboard(dashboardInput);
          result.dashboard_summary = dashboard.summary_cards;
          assert.equal(dashboard.summary_cards.completed, await db.assessmentSession.count({
            where: { assessment_db_id: assessment.id, status: "completed" }
          }));
          result.transcript = state.formative_conversation!.transcript;
          const tutorText = state.formative_conversation!.transcript.filter(t => t.actor === "tutor").map(t => t.message_text).join("\n");
          assert(!/\p{Script=Han}/u.test(tutorText), "Generated tutor text contained Han characters.");
          assert(!/correct_option|canonical_profile|evidence_namespace|agent_call_db_id|profile_transition_recommendation/.test(tutorText), "Tutor leaked internal serialization.");
          checks.push("Completed lifecycle, one completion event, three responses, research turn counts, null browser exposure, English output and dashboard read verified.");
          result.outcome = "mechanical_checks_passed_manual_pedagogical_review_required";
        } catch (error) {
          result.outcome = "failed";
          result.error = error instanceof Error ? error.message : String(error);
        } finally {
          result.finished_at = new Date().toISOString();
          if (typeof result.session_public_id === "string") {
            if (result.outcome === "failed") {
              // Only this disposable test database has been opened. Preserve failure
              // evidence while preventing one case's queued work contaminating another.
              result.cancelled_test_jobs = (await db.workflowJob.updateMany({
                where: { assessment_session: { session_public_id: result.session_public_id }, status: { in: ["pending", "retryable", "running"] } },
                data: { status: "cancelled", locked_at: null, locked_by: null }
              })).count;
            }
            const records = await db.agentCall.findMany({ where: { assessment_session: { session_public_id: result.session_public_id } }, select: {
              agent_name: true, model_name: true, output_validated: true, validation_error: true, error_category: true,
              call_status: true, input_tokens: true, output_tokens: true, latency_ms: true,
              input_payload: true, output_payload: true, raw_output: true
            } });
            writeFileSync(path.join(output, `${scenario.id}-agent-calls.json`), JSON.stringify(records, null, 2));
            if (records.some(record => record.error_category === "quota")) {
              providerQuotaBlocked = true;
              result.outcome = "blocked_provider_quota";
              result.failure_category = "provider_quota";
            }
          }
          save();
          console.log(JSON.stringify({ case_finished: scenario.id, outcome: result.outcome, error: result.error, provider_dispatches: report.provider_dispatches }));
        }
      }
    });
  } finally {
    report.finished_at = new Date().toISOString();
    save();
    await db.$disconnect();
  }
  if (report.results.some(row => row.outcome !== "mechanical_checks_passed_manual_pedagogical_review_required")) process.exitCode = 1;
  console.log(JSON.stringify({ report: path.join(output, "report.json"), provider_dispatches: report.provider_dispatches }));
}

main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
