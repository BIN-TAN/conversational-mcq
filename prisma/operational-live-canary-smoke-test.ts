import { parse } from "csv-parse/sync";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import http from "node:http";
import { Prisma } from "@prisma/client";
import {
  createCanaryRunSkeleton,
  createCanaryPrismaClient,
  createNoNetworkOperationalLiveCanarySimulation,
  createOperationalLiveCanaryDryRun,
  createOperationalLiveCanaryPreflightReport,
  createOperationalLiveCanaryReport,
  createOperationalLiveCanaryTransportProbeDryRun,
  createOperationalLiveCanaryTransportProbePreflight,
  createOperationalLiveCanaryTransportEnvironmentReport,
  diagnoseOperationalLiveCanaryTransportProbe,
  exportOperationalLiveCanaryReviewPacket,
  forensicsOperationalLiveCanaryRun,
  importOperationalLiveCanaryAiReview,
  inspectOperationalLiveCanaryRun,
  loadOperationalLiveCanaryManifest,
  manifestHash,
  operationalLiveCanaryDatabaseResolution,
  operationalLiveCanaryDatabaseName,
  reconcileOperationalLiveCanaryRun,
  recoverOperationalLiveCanaryRun,
  replayOperationalLiveCanaryResponse,
  runOperationalLiveCanary,
  runOperationalLiveCanaryTransportProbe,
  validateOperationalLiveCanaryManifest
} from "../src/lib/services/operational-live-canary/service";
import { normalizeOpenAITransportError } from "../src/lib/llm/openai-transport-diagnostics";
import { normalizeOpenAIResponsesResult } from "../src/lib/llm/openai-responses-normalizer";
import { OpenAIResponsesProvider } from "../src/lib/llm/providers/openai-responses-provider";
import { agentOutputSchemas } from "../src/lib/agents/contracts";
import { activeOperationalConfigHash } from "../src/lib/agents/operational/approved-config";
import type { AgentInputByName } from "../src/lib/agents/contracts";
import type { AgentName as AgentNameType } from "../src/lib/agents/names";
import { executeOperationalAgent } from "../src/lib/agents/operational/executor";
import { evaluateOperationalExecutionReadiness } from "../src/lib/operational/guarded-agent-integration";
import {
  createOperationalLiveCanaryContext,
  operationalLiveCanaryContextAttestationHash,
  type OperationalLiveCanaryContext
} from "../src/lib/operational/live-canary-context";
import {
  resolveOperationalLiveCanaryDatabaseUrl
} from "../src/lib/services/operational-live-canary/database-url";
import {
  LIVE_CANARY_DATABASE_SUFFIX,
  LIVE_CANARY_SMOKE_DATABASE_SUFFIX,
  databaseName,
  defaultDatabaseUrl,
  liveCanaryEnv,
  liveCanaryDatabaseUrl,
  liveCanarySmokeDatabaseUrl,
  runCommand
} from "./operational-live-canary-shared";

type SuiteName =
  | "manifest"
  | "preflight"
  | "runner"
  | "budget"
  | "resume"
  | "network"
  | "review-export"
  | "report"
  | "isolation"
  | "db-resolution"
  | "guard-parity"
  | "block-reason"
  | "context"
  | "actual-step-parity"
  | "provenance"
  | "dispatch-ledger"
  | "accounting"
  | "reconciliation"
  | "recovery"
  | "signal"
  | "full-simulation"
  | "transport-probe"
  | "transport-probe-diagnostic"
  | "transport-probe-dry-run"
  | "transport-boundary"
  | "transport-stage"
  | "transport-error"
  | "transport-report-consistency"
  | "test-hook-isolation"
  | "openai-error-normalization"
  | "loopback-transport"
  | "request-accounting"
  | "cost-uncertainty"
  | "cli-ledger-consistency"
  | "transport-environment"
  | "response-normalization"
  | "usage-extraction"
  | "provider-effective-separation"
  | "fallback-reason"
  | "response-replay"
  | "agent-call-linkage"
  | "aggregate-reconciliation"
  | "cli-final-state"
  | "report-consistency"
  | "execution-path"
  | "dependency"
  | "cli-progress"
  | "history-preservation";

function argValue(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

const liveCanaryEnvKeys = [
  "OPERATIONAL_AGENT_MODE",
  "OPERATIONAL_AGENT_INTEGRATION_ENABLED",
  "OPERATIONAL_APPROVED_CONFIG_HASH",
  "OPERATIONAL_LIVE_CANARY_APPROVED_CONFIG_HASH",
  "OPERATIONAL_LIVE_CANARY_ENABLED",
  "OPERATIONAL_LIVE_CANARY_TARGET_MODEL",
  "OPERATIONAL_LIVE_CANARY_DATABASE_URL_ACTIVE",
  "OPERATIONAL_LIVE_CANARY_DATABASE_URL",
  "LLM_PROVIDER",
  "LLM_LIVE_CALLS_ENABLED",
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "OPERATIONAL_LIVE_CANARY_LOOPBACK_OPENAI_BASE_URL",
  "OPERATIONAL_LIVE_CANARY_TEST_PROVIDER_OVERRIDE",
  "OPERATIONAL_LIVE_CANARY_TEST_FETCH_ACTIVE",
  "LLM_DAILY_CLASS_CALL_LIMIT",
  "OPERATIONAL_LIVE_CANARY_TEST_ABORT_AT_TRANSPORT_BOUNDARY",
  "OPERATIONAL_LIVE_CANARY_TEST_ALLOW_SMOKE_DATABASE"
] as const;

function setEnv(values: Partial<Record<(typeof liveCanaryEnvKeys)[number], string | undefined>>) {
  for (const key of liveCanaryEnvKeys) {
    if (values[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = values[key];
    }
  }
}

async function withLiveCanaryEnv<T>(
  values: Partial<Record<(typeof liveCanaryEnvKeys)[number], string | undefined>>,
  callback: () => Promise<T>
) {
  const original = Object.fromEntries(liveCanaryEnvKeys.map((key) => [key, process.env[key]]));
  try {
    setEnv(values);
    return await callback();
  } finally {
    setEnv(original);
  }
}

async function ensureDatabaseReady() {
  runCommand("npx", ["tsx", "prisma/operational-live-canary-db.ts", "prepare"], {
    timeoutMs: 120_000
  });
}

async function withSmokeCanaryDatabase<T>(callback: () => Promise<T>) {
  const originalUrl = process.env.OPERATIONAL_LIVE_CANARY_DATABASE_URL;
  const smokeUrl = liveCanarySmokeDatabaseUrl();
  try {
    process.env.OPERATIONAL_LIVE_CANARY_DATABASE_URL = smokeUrl;
    runCommand("npx", ["tsx", "prisma/operational-live-canary-db.ts", "reset"], {
      env: { ...process.env, OPERATIONAL_LIVE_CANARY_DATABASE_URL: smokeUrl },
      timeoutMs: 180_000
    });
    assert(databaseName(smokeUrl).endsWith(LIVE_CANARY_SMOKE_DATABASE_SUFFIX), "Smoke DB must use smoke suffix.");
    return await callback();
  } finally {
    if (originalUrl === undefined) {
      delete process.env.OPERATIONAL_LIVE_CANARY_DATABASE_URL;
    } else {
      process.env.OPERATIONAL_LIVE_CANARY_DATABASE_URL = originalUrl;
    }
  }
}

async function manifestSmoke() {
  const manifest = await loadOperationalLiveCanaryManifest();
  const validation = validateOperationalLiveCanaryManifest(manifest);
  assert(validation.valid, `Manifest should be valid: ${JSON.stringify(validation.issues)}`);
  assert(validation.manifest_hash === manifest.deterministic_manifest_hash, "Manifest hash mismatch.");
  assert(manifest.student_personas.length === 5, "Manifest should define five students.");
  assert(manifest.concept_units.length === 2, "Manifest should define two concept units.");
  assert(manifest.items.length === 8, "Manifest should define eight items.");
  assert(validation.planned_logical_invocations <= 60, "Planned logical invocations should not exceed 60.");
  for (const agentName of [
    "item_verification_agent",
    "response_collection_agent",
    "student_profiling_agent",
    "formative_value_and_planning_agent",
    "followup_agent"
  ]) {
    assert(
      manifest.expected_operational_invocation_points.some((point) => point.agent_name === agentName),
      `${agentName} should be covered.`
    );
  }
}

async function preflightSmoke() {
  const report = await createOperationalLiveCanaryPreflightReport();
  assert(report.isolated_database.guard_passed, "Isolated canary database guard should pass.");
  assert(!report.paid_execution_permitted, "Default local preflight should not permit paid execution.");
  assert(report.blocking_reasons.includes("operational_live_canary_disabled"), "Default disabled reason missing.");
  assert(report.manifest.valid, "Manifest should validate in preflight.");
}

async function runnerSmoke() {
  let blocked = false;
  try {
    await runOperationalLiveCanary({ confirmPaidApi: false, newRun: true });
  } catch (error) {
    blocked = error instanceof Error && error.message.includes("--confirm-paid-api");
  }
  assert(blocked, "Paid runner should reject missing confirmation flag.");

  const result = await runOperationalLiveCanary({ confirmPaidApi: true, newRun: true });
  assert(result.status === "blocked", "Default local paid runner should be blocked by readiness.");
  assert(result.paid_api_request_made === false, "Runner smoke must not make paid API requests.");
}

async function budgetSmoke() {
  const report = await createOperationalLiveCanaryPreflightReport();
  assert(report.manifest.maximum_provider_requests === 80, "Provider request cap should be 80.");
  assert(report.manifest.maximum_budget_usd === 15, "Budget hard limit should be USD 15.");
  assert(report.cost.estimated_upper_bound_usd <= 15, "Estimated upper bound should fit budget.");
  assert(report.manifest.maximum_concurrency === 1, "Concurrency should be one.");
  assert(report.manifest.maximum_retries === 1, "Retry limit should be one.");
}

async function resumeSmoke() {
  await ensureDatabaseReady();
  const run = await createCanaryRunSkeleton({
    status: "created",
    runPublicId: `olcr_resume_smoke_${manifestHash(await loadOperationalLiveCanaryManifest()).slice(0, 8)}`
  });
  const second = await createCanaryRunSkeleton({
    status: "created",
    runPublicId: run.run_public_id
  });
  assert(second.steps.length === run.steps.length, "Resume/idempotency should not duplicate steps.");
  const keys = new Set(second.steps.map((step) => step.logical_invocation_key));
  assert(keys.size === second.steps.length, "Logical invocation keys should remain unique.");
}

async function networkSmoke() {
  const report = await createOperationalLiveCanaryPreflightReport();
  assert(report.network_policy.approved_external_hosts.length === 1, "Only one external host should be approved.");
  assert(report.network_policy.approved_external_hosts[0] === "api.openai.com", "Approved host should be api.openai.com.");
  assert(report.network_policy.store === false, "Provider store flag should be false.");
  assert(report.network_policy.tools_enabled === false, "Tools should be disabled.");
}

async function reviewExportSmoke() {
  await ensureDatabaseReady();
  const run = await createCanaryRunSkeleton({
    status: "completed",
    runPublicId: `olcr_review_smoke_${Date.now()}`,
    markCompletedSteps: true
  });
  const exported = await exportOperationalLiveCanaryReviewPacket(run.run_public_id);
  assert(exported.blind_record_count === run.steps.length, "Blind packet count mismatch.");
  assert(exported.reference_record_count === run.steps.length, "Reference packet count mismatch.");
  assert(exported.annotation_template_row_count === run.steps.length, "Annotation template count mismatch.");

  const blind = (await readFile(exported.blind_review_packet_path, "utf8")).trim().split("\n");
  const reference = (await readFile(exported.review_reference_path, "utf8")).trim().split("\n");
  const annotation = parse(await readFile(exported.annotation_template_path), {
    columns: true,
    skip_empty_lines: true
  }) as Array<Record<string, string>>;
  assert(blind.length === run.steps.length, "Blind JSONL should contain every step.");
  assert(reference.length === run.steps.length, "Reference JSONL should contain every step.");
  assert(annotation.length === run.steps.length, "Annotation CSV should contain every step.");
  assert(!blind.join("\n").includes("gpt-5.4-mini"), "Blind packet should hide model metadata.");
}

async function reportSmoke() {
  await withSmokeCanaryDatabase(async () => {
    const prisma = createCanaryPrismaClient();
    try {
      const summary = await createNoNetworkOperationalLiveCanarySimulation({ prisma });
      const run = await prisma.operationalLiveCanaryRun.findUniqueOrThrow({
        where: { run_public_id: summary.run_public_id },
        include: { steps: { orderBy: { step_order: "asc" } } }
      });
      const incomplete = await createOperationalLiveCanaryReport(run.run_public_id);
      assert(incomplete.recommendation === "incomplete_review", "Report should remain incomplete before review.");

      await importOperationalLiveCanaryAiReview({
        runPublicId: run.run_public_id,
        reviewerModel: "gpt-5.5-pro",
        rows: run.steps.map((step) => ({
          review_item_id: `review_${createHash("sha256").update(`${run.run_public_id}:${step.step_public_id}`).digest("hex").slice(0, 20)}`,
          pass_fail: "pass" as const,
          overall_rating: 3,
          rubric_scores: {
            schema_adherence: 3,
            task_relevance: 3,
            policy_compliance: 3,
            safety: 3
          },
          safety_flags: [],
          notes: "Synthetic smoke review."
        }))
      });

      const ready = await createOperationalLiveCanaryReport(run.run_public_id);
      assert(ready.recommendation === "ready_for_private_staging_deployment", "All-pass verified review should be ready.");
      assert(ready.review.ai_pass_count === run.steps.length, "AI pass count mismatch.");
    } finally {
      await prisma.$disconnect();
    }
  });
}

async function isolationSmoke() {
  assert(
    operationalLiveCanaryDatabaseName().endsWith(LIVE_CANARY_DATABASE_SUFFIX),
    "Canary DB must use live canary suffix."
  );
  assert(!operationalLiveCanaryDatabaseName().endsWith("_e2e") || operationalLiveCanaryDatabaseName().endsWith(LIVE_CANARY_DATABASE_SUFFIX), "Canary DB must not be Phase 8B E2E DB.");
  assert(!liveCanaryDatabaseUrl().includes("conversational_mcq?"), "Canary DB URL must not point at normal DB.");
  const inspect = await inspectOperationalLiveCanaryRun(
    (await createCanaryRunSkeleton({ status: "created", runPublicId: `olcr_isolation_smoke_${Date.now()}` })).run_public_id
  );
  assert(!JSON.stringify(inspect).match(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i), "Inspect output should not expose internal UUIDs.");
}

async function dbResolutionSmoke() {
  const baseUrl = "postgresql://user:pass@localhost:5432/conversational_mcq?schema=public";
  const expectedName = "conversational_mcq_live_canary_e2e";
  const resolved = resolveOperationalLiveCanaryDatabaseUrl(baseUrl);
  assert(resolved.effective_canary_database_name === expectedName, "Base DB should resolve to one live-canary suffix.");
  assert(resolved.database_name_was_already_isolated === false, "Base DB should not be reported as already isolated.");

  const isolatedUrl = resolved.isolated_canary_database_url;
  const alreadyIsolated = resolveOperationalLiveCanaryDatabaseUrl(isolatedUrl);
  assert(alreadyIsolated.isolated_canary_database_url === isolatedUrl, "Already-isolated URL should remain unchanged.");
  assert(alreadyIsolated.database_name_was_already_isolated, "Already-isolated URL should be reported.");

  let iterated = isolatedUrl;
  for (let index = 0; index < 10; index += 1) {
    iterated = resolveOperationalLiveCanaryDatabaseUrl(iterated).isolated_canary_database_url;
  }
  assert(iterated === isolatedUrl, "Resolver should remain idempotent after ten calls.");

  for (const malformedName of [
    "conversational_mcq_live_canary_live_canary_e2e",
    "conversational_mcq_live_canary_live_canary_live_canary_e2e"
  ]) {
    let rejected = false;
    try {
      resolveOperationalLiveCanaryDatabaseUrl(`postgresql://user:pass@localhost:5432/${malformedName}?schema=public`);
    } catch (error) {
      rejected = error instanceof Error && error.message.includes("malformed");
    }
    assert(rejected, `Malformed repeated suffix should be rejected: ${malformedName}`);
  }

  const parentDatabaseUrl = process.env.DATABASE_URL;
  const currentResolution = operationalLiveCanaryDatabaseResolution();
  const currentCanaryName = currentResolution.effective_canary_database_name;
  const preflight = await createOperationalLiveCanaryPreflightReport();
  assert(
    preflight.isolated_database.effective_canary_database_name === currentCanaryName,
    "Preflight should report the canonical canary database name."
  );
  assert(preflight.isolated_database.resolver_idempotency_passed, "Preflight resolver idempotency should pass.");

  await ensureDatabaseReady();
  const dryRun = await createOperationalLiveCanaryDryRun();
  assert(dryRun.isolated_database.effective_canary_database_name === currentCanaryName, "Dry run DB name should match preflight.");
  assert(process.env.DATABASE_URL === parentDatabaseUrl, "Dry run must not mutate parent DATABASE_URL.");

  const blocked = await runOperationalLiveCanary({ confirmPaidApi: true, newRun: true });
  assert(blocked.status === "blocked", "Default paid setup should be blocked before provider execution.");
  assert(process.env.DATABASE_URL === parentDatabaseUrl, "Blocked paid setup must not mutate parent DATABASE_URL.");

  const childEnv = liveCanaryEnv();
  assert(databaseName(childEnv.DATABASE_URL) === currentCanaryName, "App/worker child env should receive canonical canary DB.");
  assert(
    childEnv.OPERATIONAL_LIVE_CANARY_DATABASE_URL &&
      databaseName(childEnv.OPERATIONAL_LIVE_CANARY_DATABASE_URL) === currentCanaryName,
    "Child env should carry canonical OPERATIONAL_LIVE_CANARY_DATABASE_URL."
  );

  const canaryPrisma = createCanaryPrismaClient(currentResolution.isolated_canary_database_url);
  try {
    const manifest = await loadOperationalLiveCanaryManifest();
    const count = await canaryPrisma.assessment.count({
      where: { assessment_public_id: manifest.synthetic_assessment_id }
    });
    assert(count === 1, "Fixture cleanup/seed should use the injected isolated Prisma client.");
  } finally {
    await canaryPrisma.$disconnect();
  }

  assert(!liveCanaryDatabaseUrl().includes("conversational_mcq?"), "Normal development DB must not be used as canary DB.");
  assert(defaultDatabaseUrl() === parentDatabaseUrl || Boolean(parentDatabaseUrl) === false, "Parent default DB URL should remain stable.");
}

function syntheticCanaryInput(): AgentInputByName["response_collection_agent"] {
  return {
    current_phase: "initial_item_administration" as const,
    allowed_interaction_type: "initial_free_text" as const,
    current_item_student_safe: {
      item_public_id: "phase8c_smoke_item",
      item_stem: "Which option best connects a claim to evidence?",
      options: [
        { label: "A", text: "The claim is supported." },
        { label: "B", text: "The claim is unrelated." }
      ]
    },
    student_message: "I chose A because the evidence directly supports the claim.",
    collected_response_state: {
      selected_option: "A" as const,
      confidence_rating: "medium" as const
    },
    missing_evidence_state: {
      missing_reasoning: true
    },
    recent_student_safe_transcript: [],
    orchestration_constraints: {
      no_correctness_feedback: true,
      no_hints_or_explanations: true
    },
    procedural_policy: {
      answer_and_confidence_backend_owned: true
    },
    allowed_student_controls: [
      "option_buttons",
      "confidence_controls",
      "free_text_message",
      "skip_reasoning_button",
      "skip_confidence_button",
      "skip_item_button",
      "save_exit_button",
      "submit_button"
    ]
  };
}

async function validCanaryReadinessEnv() {
  const manifest = await loadOperationalLiveCanaryManifest();
  const approvedHash = activeOperationalConfigHash();
  const isolatedUrl = liveCanaryDatabaseUrl();
  return {
    OPERATIONAL_AGENT_MODE: "guarded_live",
    OPERATIONAL_AGENT_INTEGRATION_ENABLED: undefined,
    OPERATIONAL_APPROVED_CONFIG_HASH: undefined,
    OPERATIONAL_LIVE_CANARY_APPROVED_CONFIG_HASH: approvedHash,
    OPERATIONAL_LIVE_CANARY_ENABLED: "true",
    OPERATIONAL_LIVE_CANARY_DATABASE_URL_ACTIVE: undefined,
    OPERATIONAL_LIVE_CANARY_DATABASE_URL: isolatedUrl,
    LLM_PROVIDER: "openai",
    LLM_LIVE_CALLS_ENABLED: "true",
    OPENAI_API_KEY: "fake-key-never-sent",
    manifest
  };
}

function reattest(context: OperationalLiveCanaryContext): OperationalLiveCanaryContext {
  const rest = {
    contextVersion: context.contextVersion,
    runPublicId: context.runPublicId,
    stepPublicId: context.stepPublicId,
    logicalInvocationKey: context.logicalInvocationKey,
    manifestVersion: context.manifestVersion,
    manifestHash: context.manifestHash,
    approvedConfigHash: context.approvedConfigHash,
    effectiveResultVersion: context.effectiveResultVersion,
    effectiveValidatorVersion: context.effectiveValidatorVersion,
    targetedEvidenceRunPublicId: context.targetedEvidenceRunPublicId,
    databaseName: context.databaseName,
    syntheticOnly: context.syntheticOnly,
    createdThroughPhase8cCli: context.createdThroughPhase8cCli
  };
  return {
    ...rest,
    attestationHash: operationalLiveCanaryContextAttestationHash(rest)
  };
}

async function withCanonicalContextRun<T>(
  callback: (input: {
    prisma: ReturnType<typeof createCanaryPrismaClient>;
    manifest: Awaited<ReturnType<typeof loadOperationalLiveCanaryManifest>>;
    run: Awaited<ReturnType<typeof createCanaryRunSkeleton>>;
    contexts: OperationalLiveCanaryContext[];
  }) => Promise<T>
) {
  await ensureDatabaseReady();
  const manifest = await loadOperationalLiveCanaryManifest();
  const prisma = createCanaryPrismaClient();
  const run = await createCanaryRunSkeleton({ status: "running", prisma });
  const contexts = run.steps.map((step) =>
    createOperationalLiveCanaryContext({
      run,
      step,
      manifest,
      databaseName: operationalLiveCanaryDatabaseName()
    })
  );
  try {
    return await callback({ prisma, manifest, run, contexts });
  } finally {
    await prisma.operationalLiveCanaryStep.deleteMany({ where: { run_db_id: run.id } });
    await prisma.operationalLiveCanaryRun.deleteMany({ where: { id: run.id } });
    await prisma.$disconnect();
  }
}

async function expectContextReason(input: {
  prisma: ReturnType<typeof createCanaryPrismaClient>;
  agentName: string;
  context: OperationalLiveCanaryContext | null;
  reason: string;
  subreason: string | null;
}) {
  const readiness = await evaluateOperationalExecutionReadiness({
    agentName: input.agentName as AgentNameType,
    checkDatabase: false,
    checkUsageGuard: false,
    evidenceContext: {
      operationalLiveCanaryContext: input.context,
      canaryPrisma: input.prisma,
      canaryRunCreatedThroughCli: input.context ? undefined : true
    }
  });
  assert(!readiness.allowed, `Expected ${input.reason} to block.`);
  assert(readiness.reason === input.reason, `Expected ${input.reason}, got ${readiness.reason}.`);
  assert(
    readiness.readinessSnapshot.canary_context_subreason === input.subreason,
    `Expected canary subreason ${input.subreason}, got ${readiness.readinessSnapshot.canary_context_subreason}.`
  );
}

async function guardParitySmoke() {
  await ensureDatabaseReady();
  const valid = await validCanaryReadinessEnv();
  const baseEnv = {
    OPERATIONAL_AGENT_MODE: valid.OPERATIONAL_AGENT_MODE,
    OPERATIONAL_AGENT_INTEGRATION_ENABLED: valid.OPERATIONAL_AGENT_INTEGRATION_ENABLED,
    OPERATIONAL_APPROVED_CONFIG_HASH: valid.OPERATIONAL_APPROVED_CONFIG_HASH,
    OPERATIONAL_LIVE_CANARY_APPROVED_CONFIG_HASH: valid.OPERATIONAL_LIVE_CANARY_APPROVED_CONFIG_HASH,
    OPERATIONAL_LIVE_CANARY_ENABLED: valid.OPERATIONAL_LIVE_CANARY_ENABLED,
    OPERATIONAL_LIVE_CANARY_DATABASE_URL_ACTIVE: valid.OPERATIONAL_LIVE_CANARY_DATABASE_URL_ACTIVE,
    OPERATIONAL_LIVE_CANARY_DATABASE_URL: valid.OPERATIONAL_LIVE_CANARY_DATABASE_URL,
    LLM_PROVIDER: valid.LLM_PROVIDER,
    LLM_LIVE_CALLS_ENABLED: valid.LLM_LIVE_CALLS_ENABLED,
    OPENAI_API_KEY: valid.OPENAI_API_KEY,
    OPERATIONAL_LIVE_CANARY_TEST_ALLOW_SMOKE_DATABASE: "true"
  };

  await withLiveCanaryEnv(baseEnv, async () => {
    const preflight = await createOperationalLiveCanaryPreflightReport();
    assert(preflight.paid_execution_permitted, `Valid preflight should be permitted: ${JSON.stringify(preflight.blocking_reasons)}`);
    assert(preflight.executor_readiness.allowed, "Executor readiness should allow the same valid canary config.");
    assert(preflight.preflight_executor_readiness_match, "Preflight and executor readiness should match.");

    await withCanonicalContextRun(async ({ prisma, run, contexts }) => {
      const responseCollectionIndex = run.steps.findIndex((step) => step.agent_name === "response_collection_agent");
      assert(responseCollectionIndex >= 0, "Smoke run should contain a response collection step.");
      const readiness = await evaluateOperationalExecutionReadiness({
        agentName: "response_collection_agent",
        checkDatabase: true,
        checkUsageGuard: true,
        evidenceContext: {
          operationalLiveCanaryContext: contexts[responseCollectionIndex],
          canaryPrisma: prisma
        }
      });
      assert(readiness.allowed, "Direct executor parity probe should allow valid persisted canary context.");
      assert(readiness.readinessSnapshot.final_canary_context_valid === true, "Persisted canary context should validate.");
    });

    const childEnv = liveCanaryEnv();
    for (const key of [
      "DATABASE_URL",
      "OPERATIONAL_AGENT_MODE",
      "LLM_PROVIDER",
      "LLM_LIVE_CALLS_ENABLED",
      "OPERATIONAL_LIVE_CANARY_ENABLED",
      "OPERATIONAL_APPROVED_CONFIG_HASH",
      "OPERATIONAL_LIVE_CANARY_APPROVED_CONFIG_HASH",
      "OPERATIONAL_EFFECTIVE_RESULT_VERSION",
      "OPERATIONAL_EFFECTIVE_VALIDATOR_VERSION",
      "OPENAI_API_KEY"
    ]) {
      assert(childEnv[key], `Child app/worker env should include ${key}.`);
    }
    assert(databaseName(childEnv.DATABASE_URL) === databaseName(valid.OPERATIONAL_LIVE_CANARY_DATABASE_URL), "Child env DATABASE_URL should be the canonical canary DB.");
    assert(childEnv.OPERATIONAL_AGENT_INTEGRATION_ENABLED === undefined, "Child env should not carry deprecated legacy alias.");
  });

  await withLiveCanaryEnv({ ...baseEnv, OPERATIONAL_AGENT_INTEGRATION_ENABLED: "true" }, async () => {
    const preflight = await createOperationalLiveCanaryPreflightReport();
    assert(!preflight.paid_execution_permitted, "Legacy alias conflict should block preflight.");
    assert(preflight.blocking_reasons.includes("legacy_mode_conflict"), "Legacy alias conflict should be typed.");
    const prisma = createCanaryPrismaClient(valid.OPERATIONAL_LIVE_CANARY_DATABASE_URL);
    const beforeRuns = await prisma.operationalLiveCanaryRun.count();
    const result = await runOperationalLiveCanary({ confirmPaidApi: true, newRun: true });
    try {
      const afterRuns = await prisma.operationalLiveCanaryRun.count();
      assert(afterRuns === beforeRuns, "Parity/blocking failure should create no canary run.");
    } finally {
      await prisma.$disconnect();
    }
    assert(result.status === "blocked", "Blocked parity run should not execute.");
    assert(result.paid_api_request_made === false, "Blocked parity run should make no provider request.");
  });
}

async function blockReasonSmoke() {
  await ensureDatabaseReady();
  const valid = await validCanaryReadinessEnv();
  const common = {
    OPERATIONAL_AGENT_MODE: valid.OPERATIONAL_AGENT_MODE,
    OPERATIONAL_AGENT_INTEGRATION_ENABLED: undefined,
    OPERATIONAL_APPROVED_CONFIG_HASH: undefined,
    OPERATIONAL_LIVE_CANARY_APPROVED_CONFIG_HASH: valid.OPERATIONAL_LIVE_CANARY_APPROVED_CONFIG_HASH,
    OPERATIONAL_LIVE_CANARY_ENABLED: valid.OPERATIONAL_LIVE_CANARY_ENABLED,
    OPERATIONAL_LIVE_CANARY_DATABASE_URL: valid.OPERATIONAL_LIVE_CANARY_DATABASE_URL,
    LLM_PROVIDER: valid.LLM_PROVIDER,
    LLM_LIVE_CALLS_ENABLED: valid.LLM_LIVE_CALLS_ENABLED,
    OPENAI_API_KEY: valid.OPENAI_API_KEY
  };
  const expectReason = async (
    env: Partial<Record<(typeof liveCanaryEnvKeys)[number], string | undefined>>,
    reason: string,
    extra?: Parameters<typeof evaluateOperationalExecutionReadiness>[0]
  ) => {
    await withLiveCanaryEnv({ ...common, ...env }, async () => {
      const readiness = await evaluateOperationalExecutionReadiness({
        agentName: "response_collection_agent",
        checkDatabase: false,
        checkUsageGuard: false,
        ...(extra ?? {})
      });
      assert(!readiness.allowed, `Expected ${reason} to block.`);
      assert(readiness.reason === reason, `Expected ${reason}, got ${readiness.reason}.`);
      assert(!JSON.stringify(readiness).includes("fake-key-never-sent"), "Readiness output must not expose API key.");
    });
  };

  await withCanonicalContextRun(async ({ prisma, run, contexts }) => {
    const responseCollectionIndex = run.steps.findIndex((step) => step.agent_name === "response_collection_agent");
    assert(responseCollectionIndex >= 0, "Smoke run should contain a response collection step.");
    const context = contexts[responseCollectionIndex];
    const evidenceContext = {
      operationalLiveCanaryContext: context,
      canaryPrisma: prisma
    };

    await expectReason({ OPENAI_API_KEY: "" }, "api_key_missing", { evidenceContext });
    await expectReason({ OPERATIONAL_LIVE_CANARY_APPROVED_CONFIG_HASH: "wrong" }, "approved_config_hash_mismatch", { evidenceContext });
    await expectReason({}, "evaluation_evidence_missing", {
      evidenceContext: { ...evidenceContext, forceMissingEvaluationEvidence: true }
    });
    await expectReason({}, "canary_context_invalid", {
      evidenceContext: {
        operationalLiveCanaryContext: reattest({ ...context, databaseName: "conversational_mcq" }),
        canaryPrisma: prisma
      }
    });
    await expectReason({}, "usage_guard_blocked", {
      evidenceContext,
      checkUsageGuard: false,
      usageContext: { forceBlockedReason: "class_daily_call_limit_exceeded" }
    });
    await expectReason({ OPERATIONAL_AGENT_INTEGRATION_ENABLED: "true" }, "legacy_mode_conflict", { evidenceContext });
  });

  await withLiveCanaryEnv({ ...common, OPERATIONAL_AGENT_MODE: "disabled" }, async () => {
    const result = await executeOperationalAgent({
      agentName: "response_collection_agent",
      invocationKey: `phase8c_block_reason_${Date.now()}`,
      allowlistedInput: syntheticCanaryInput(),
      operationalContext: {}
    });
    assert(result.status === "blocked_by_operational_guard", "Blocked executor should not dispatch provider.");
    assert(result.status === "blocked_by_operational_guard" && result.reason === "operational_mode_disabled", "Blocked executor should expose typed reason.");
  });

  const existing = await inspectOperationalLiveCanaryRun("olcr_20260625_fgdjkha");
  assert(existing.run_public_id === "olcr_20260625_fgdjkha", "Existing failed run should be inspectable.");
  assert(existing.status === "failed", "Existing failed run should remain failed.");
  assert(existing.paid_request_occurred === false, "Existing failed run should show no paid request occurred.");
  assert(existing.safe_to_resume === false, "Existing all-failed run should not be resumable.");
  assert(existing.fresh_run_required_after_fix === true, "Existing all-failed run should require a fresh run after fix.");
  assert(
    existing.blocked_reason_count_by_type.legacy_mode_conflict === 30,
    "Existing failed run should recover legacy-mode conflict for all 30 steps."
  );
}

async function contextSmoke() {
  const valid = await validCanaryReadinessEnv();
  const common = {
    OPERATIONAL_AGENT_MODE: valid.OPERATIONAL_AGENT_MODE,
    OPERATIONAL_AGENT_INTEGRATION_ENABLED: undefined,
    OPERATIONAL_APPROVED_CONFIG_HASH: undefined,
    OPERATIONAL_LIVE_CANARY_APPROVED_CONFIG_HASH: valid.OPERATIONAL_LIVE_CANARY_APPROVED_CONFIG_HASH,
    OPERATIONAL_LIVE_CANARY_ENABLED: valid.OPERATIONAL_LIVE_CANARY_ENABLED,
    OPERATIONAL_LIVE_CANARY_DATABASE_URL: valid.OPERATIONAL_LIVE_CANARY_DATABASE_URL,
    LLM_PROVIDER: valid.LLM_PROVIDER,
    LLM_LIVE_CALLS_ENABLED: valid.LLM_LIVE_CALLS_ENABLED,
    OPENAI_API_KEY: valid.OPENAI_API_KEY
  };

  await withLiveCanaryEnv(common, async () => {
    await withCanonicalContextRun(async ({ prisma, run, contexts }) => {
      assert(contexts.length === 30, "Canonical context should be created for all 30 manifest steps.");
      const seenStepIds = new Set(contexts.map((context) => context.stepPublicId));
      assert(seenStepIds.size === 30, "Each context should bind to a distinct step public ID.");

      for (const [index, step] of run.steps.entries()) {
        const readiness = await evaluateOperationalExecutionReadiness({
          agentName: step.agent_name as AgentNameType,
          checkDatabase: false,
          checkUsageGuard: false,
          evidenceContext: {
            operationalLiveCanaryContext: contexts[index],
            canaryPrisma: prisma
          }
        });
        assert(readiness.allowed, `Context should validate for step ${step.step_public_id}.`);
        assert(readiness.readinessSnapshot.final_canary_context_valid === true, "Final canary context should be valid.");
        assert(readiness.readinessSnapshot.canary_attestation_hash_valid === true, "Attestation hash should verify.");
        if (step.student_public_id === null) {
          assert(step.agent_name === "item_verification_agent", "Only teacher item verification steps should omit student public ID.");
        }
      }

      const updatedProfileContexts = contexts.filter((context) => context.logicalInvocationKey.includes(":profiling:updated:"));
      const updatedPlanningContexts = contexts.filter((context) => context.logicalInvocationKey.includes(":planning:updated:"));
      assert(updatedProfileContexts.length === 2, "Updated profiling steps should have their own contexts.");
      assert(updatedPlanningContexts.length === 2, "Updated planning steps should have their own contexts.");

      const first = contexts[0];
      const second = contexts[1];
      await expectContextReason({
        prisma,
        agentName: run.steps[0].agent_name,
        context: null,
        reason: "canary_context_invalid",
        subreason: "canary_context_missing"
      });
      await expectContextReason({
        prisma,
        agentName: run.steps[0].agent_name,
        context: reattest({ ...first, runPublicId: "olcr_preview_not_real" }),
        reason: "canary_context_invalid",
        subreason: "canary_run_not_found"
      });
      await expectContextReason({
        prisma,
        agentName: run.steps[0].agent_name,
        context: reattest({ ...first, runPublicId: "olcr_wrong_not_real" }),
        reason: "canary_context_invalid",
        subreason: "canary_run_not_found"
      });
      await expectContextReason({
        prisma,
        agentName: run.steps[0].agent_name,
        context: reattest({ ...first, stepPublicId: "olcs_wrong_not_real" }),
        reason: "canary_context_invalid",
        subreason: "canary_step_not_in_run"
      });
      await expectContextReason({
        prisma,
        agentName: run.steps[0].agent_name,
        context: reattest({ ...first, logicalInvocationKey: "phase8c:wrong:logical:key" }),
        reason: "canary_context_invalid",
        subreason: "canary_logical_invocation_mismatch"
      });
      await expectContextReason({
        prisma,
        agentName: run.steps[0].agent_name,
        context: reattest({ ...first, manifestHash: "wrong_manifest_hash" }),
        reason: "canary_context_invalid",
        subreason: "canary_manifest_hash_mismatch"
      });
      await expectContextReason({
        prisma,
        agentName: run.steps[0].agent_name,
        context: reattest({ ...first, approvedConfigHash: "wrong_config_hash" }),
        reason: "canary_context_invalid",
        subreason: "canary_config_hash_mismatch"
      });
      await expectContextReason({
        prisma,
        agentName: run.steps[0].agent_name,
        context: reattest({ ...first, databaseName: "conversational_mcq" }),
        reason: "canary_context_invalid",
        subreason: "canary_database_invalid"
      });
      await expectContextReason({
        prisma,
        agentName: run.steps[0].agent_name,
        context: reattest({ ...first, createdThroughPhase8cCli: false } as unknown as OperationalLiveCanaryContext),
        reason: "canary_context_invalid",
        subreason: "canary_fixture_namespace_invalid"
      });
      await expectContextReason({
        prisma,
        agentName: run.steps[0].agent_name,
        context: reattest({ ...first, targetedEvidenceRunPublicId: "evr_wrong" }),
        reason: "canary_context_invalid",
        subreason: "canary_evidence_reference_mismatch"
      });
      await expectContextReason({
        prisma,
        agentName: run.steps[0].agent_name,
        context: { ...first, attestationHash: "tampered" },
        reason: "canary_context_invalid",
        subreason: "canary_attestation_hash_mismatch"
      });
      await expectContextReason({
        prisma,
        agentName: run.steps.find((step) => step.agent_name === "response_collection_agent")?.agent_name ?? "response_collection_agent",
        context: first,
        reason: "canary_context_invalid",
        subreason: "canary_agent_mismatch"
      });
      await expectContextReason({
        prisma,
        agentName: run.steps[0].agent_name,
        context: reattest({ ...first, stepPublicId: second.stepPublicId }),
        reason: "canary_context_invalid",
        subreason: "canary_logical_invocation_mismatch"
      });
    });
  });
}

async function actualStepParitySmoke() {
  const valid = await validCanaryReadinessEnv();
  const common = {
    OPERATIONAL_AGENT_MODE: valid.OPERATIONAL_AGENT_MODE,
    OPERATIONAL_AGENT_INTEGRATION_ENABLED: undefined,
    OPERATIONAL_APPROVED_CONFIG_HASH: undefined,
    OPERATIONAL_LIVE_CANARY_APPROVED_CONFIG_HASH: valid.OPERATIONAL_LIVE_CANARY_APPROVED_CONFIG_HASH,
    OPERATIONAL_LIVE_CANARY_ENABLED: valid.OPERATIONAL_LIVE_CANARY_ENABLED,
    OPERATIONAL_LIVE_CANARY_DATABASE_URL: valid.OPERATIONAL_LIVE_CANARY_DATABASE_URL,
    LLM_PROVIDER: valid.LLM_PROVIDER,
    LLM_LIVE_CALLS_ENABLED: valid.LLM_LIVE_CALLS_ENABLED,
    OPENAI_API_KEY: valid.OPENAI_API_KEY
  };

  await withLiveCanaryEnv(common, async () => {
    const preflight = await createOperationalLiveCanaryPreflightReport();
    assert(preflight.paid_execution_permitted, "Valid global preflight should be permitted.");
    await withCanonicalContextRun(async ({ prisma, run, contexts }) => {
      const first = run.steps[0];
      const readiness = await evaluateOperationalExecutionReadiness({
        agentName: first.agent_name as AgentNameType,
        checkDatabase: false,
        checkUsageGuard: false,
        evidenceContext: {
          operationalLiveCanaryContext: contexts[0],
          canaryPrisma: prisma
        }
      });
      assert(readiness.allowed, "Actual persisted first-step parity probe should be allowed.");
      assert(readiness.readinessSnapshot.final_canary_context_valid === true, "Actual first-step context should validate.");
    });

    const prisma = createCanaryPrismaClient(valid.OPERATIONAL_LIVE_CANARY_DATABASE_URL);
    const result = await runOperationalLiveCanary({
      confirmPaidApi: true,
      newRun: true,
      testOnlyForceInvalidActualContext: true
    });
    try {
      assert(result.status === "blocked", "Forced actual-context mismatch should block before provider dispatch.");
      assert(result.paid_api_request_made === false, "Forced parity failure should not make provider requests.");
      const runPublicId = "run_public_id" in result ? result.run_public_id : null;
      assert(runPublicId, "Forced parity failure should preserve a classified one-step run.");
      const run = await prisma.operationalLiveCanaryRun.findUniqueOrThrow({
        where: { run_public_id: runPublicId },
        include: { steps: true }
      });
      assert(run.steps.length === 1, "Parity failure should not create a 30-step executable run.");
      assert(run.provider_request_count === 0, "Parity failure should not increment provider request count.");
      assert(run.steps[0].blocked_reason === "canary_context_invalid", "Parity failure should store typed blocked reason.");
      await prisma.operationalLiveCanaryStep.deleteMany({ where: { run_db_id: run.id } });
      await prisma.operationalLiveCanaryRun.delete({ where: { id: run.id } });
    } finally {
      await prisma.$disconnect();
    }

    const completed = await createCanaryRunSkeleton({ status: "completed", markCompletedSteps: true });
    try {
      const report = await createOperationalLiveCanaryReport(completed.run_public_id);
      assert(report.recommendation === "incomplete_review", "Completed execution awaiting review should report incomplete_review.");
    } finally {
      const cleanup = createCanaryPrismaClient();
      await cleanup.operationalLiveCanaryStep.deleteMany({ where: { run_db_id: completed.id } });
      await cleanup.operationalLiveCanaryRun.delete({ where: { id: completed.id } });
      await cleanup.$disconnect();
    }

    const historical = await createOperationalLiveCanaryReport("olcr_20260625_yzrceiu");
    assert(
      historical.recommendation === "not_ready_for_private_staging_deployment",
      "Terminal zero-provider execution failure should report not ready."
    );
    assert(
      historical.guard_diagnostics.preflight_executor_readiness_match === false,
      "Historical all-context-failed run should not claim corrected parity."
    );
    assert(
      historical.guard_diagnostics.historical_parity_claim_invalid_under_corrected_definition === true,
      "Historical parity claim should be marked invalid under corrected definition."
    );
  });
}

async function simulatedRun() {
  return withSmokeCanaryDatabase(async () => {
    const prisma = createCanaryPrismaClient();
    try {
      const summary = await createNoNetworkOperationalLiveCanarySimulation({ prisma });
      assert(summary.provider_request_count === 30, "Simulation should create 30 verified provider-shaped dispatches.");
      assert(summary.no_openai_call_made, "Simulation must make no OpenAI call.");
      return summary.run_public_id;
    } finally {
      await prisma.$disconnect();
    }
  });
}

async function provenanceSmoke() {
  const runPublicId = await simulatedRun();
  process.env.OPERATIONAL_LIVE_CANARY_DATABASE_URL = liveCanarySmokeDatabaseUrl();
  const forensics = await forensicsOperationalLiveCanaryRun(runPublicId);
  assert(forensics.classification_counts.live_provider_verified === 30, "All simulated steps should be live-provider verified.");
  assert(!JSON.stringify(forensics).match(/sk-[A-Za-z0-9]/), "Forensics must not expose secret-shaped API keys.");
}

async function dispatchLedgerSmoke() {
  const runPublicId = await simulatedRun();
  process.env.OPERATIONAL_LIVE_CANARY_DATABASE_URL = liveCanarySmokeDatabaseUrl();
  const reconciliation = await reconcileOperationalLiveCanaryRun(runPublicId);
  assert(reconciliation.dispatch_attempt_count === 30, "Dispatch ledger should contain one attempt per step.");
  assert(reconciliation.lifecycle_counts.finalized_success === 30, "All simulated attempts should finalize successfully.");
  assert(reconciliation.duplicate_risks.length === 0, "Simulation should have no duplicate dispatch risk.");
  const ids = new Set(reconciliation.steps.flatMap((step) => step.dispatches.map((dispatch) => dispatch.dispatch_public_id)));
  assert(ids.size === 30, "Dispatch public IDs should be unique.");
}

async function accountingSmoke() {
  const runPublicId = await simulatedRun();
  process.env.OPERATIONAL_LIVE_CANARY_DATABASE_URL = liveCanarySmokeDatabaseUrl();
  const report = await createOperationalLiveCanaryReport(runPublicId);
  assert(report.provider_execution.accounting_verified, "Provider accounting should verify from dispatch ledger.");
  assert(report.provider_execution.verified_provider_request_count === 30, "Verified request count should be 30.");
  assert(report.provider_execution.verified_total_tokens > 0, "Verified token count should be positive.");
  assert(report.provider_execution.verified_estimated_cost_usd > 0, "Verified cost should be positive.");
}

async function reconciliationSmoke() {
  await withSmokeCanaryDatabase(async () => {
    const prisma = createCanaryPrismaClient();
    try {
      const run = await createCanaryRunSkeleton({ status: "paused", prisma });
      const first = run.steps[0];
      await prisma.operationalLiveCanaryStep.update({
        where: { id: first.id },
        data: {
          execution_status: "running",
          lease_expires_at: new Date(Date.now() - 60_000),
          recovery_status: "stale_running"
        }
      });
      const reconciliation = await reconcileOperationalLiveCanaryRun(run.run_public_id);
      assert(!reconciliation.safe_to_resume, "Stale running lease should not be resumable before recovery.");
      assert(reconciliation.safe_to_resume_reasons.includes("stale_active_lease"), "Stale lease reason should be explicit.");
    } finally {
      await prisma.$disconnect();
    }
  });
}

async function recoverySmoke() {
  await withSmokeCanaryDatabase(async () => {
    const prisma = createCanaryPrismaClient();
    try {
      const run = await createCanaryRunSkeleton({ status: "paused", prisma });
      const first = run.steps[0];
      await prisma.operationalLiveCanaryStep.update({
        where: { id: first.id },
        data: { execution_status: "running", recovery_status: "needs_recovery" }
      });
      let refused = false;
      try {
        await recoverOperationalLiveCanaryRun({ runPublicId: run.run_public_id, confirmRecovery: false });
      } catch (error) {
        refused = error instanceof Error && error.message.includes("--confirm-recovery");
      }
      assert(refused, "Recovery should require explicit confirmation.");
      const result = await recoverOperationalLiveCanaryRun({ runPublicId: run.run_public_id, confirmRecovery: true });
      assert(result.status === "recovered", "Recoverable paused run should recover.");
      const recovered = await reconcileOperationalLiveCanaryRun(run.run_public_id);
      assert(recovered.steps.some((step) => step.recovery_status === "recovered_pending"), "Step recovery status should be visible.");
    } finally {
      await prisma.$disconnect();
    }
  });
}

async function signalSmoke() {
  await withSmokeCanaryDatabase(async () => {
    const prisma = createCanaryPrismaClient();
    try {
      const run = await createCanaryRunSkeleton({ status: "running", prisma });
      const runner = `signal_smoke_${Date.now()}`;
      await prisma.operationalLiveCanaryRun.update({
        where: { id: run.id },
        data: {
          runner_instance_id: runner,
          claimed_at: new Date(),
          heartbeat_at: new Date(),
          lease_expires_at: new Date(Date.now() + 60_000),
          recovery_status: "active"
        }
      });
      await prisma.operationalLiveCanaryStep.update({
        where: { id: run.steps[0].id },
        data: {
          execution_status: "running",
          runner_instance_id: runner,
          claimed_at: new Date(),
          heartbeat_at: new Date(),
          lease_expires_at: new Date(Date.now() + 60_000),
          recovery_status: "active"
        }
      });
      const inspect = await inspectOperationalLiveCanaryRun(run.run_public_id);
      assert(inspect.runner_instance_id_present, "Run should expose runner presence without leaking internals.");
      assert(inspect.steps[0].runner_instance_id_present, "Step should expose runner presence.");
    } finally {
      await prisma.$disconnect();
    }
  });
}

async function fullSimulationSmoke() {
  const runPublicId = await simulatedRun();
  process.env.OPERATIONAL_LIVE_CANARY_DATABASE_URL = liveCanarySmokeDatabaseUrl();
  const report = await createOperationalLiveCanaryReport(runPublicId);
  assert(report.run.status === "completed", "No-network full simulation should complete.");
  assert(report.provider_execution.verified_provider_request_count === 30, "Full simulation should verify 30 requests.");
  assert(report.recommendation === "incomplete_review", "Completed unreviewed simulation should await review.");
}

async function transportProbeSmoke() {
  const valid = await validCanaryReadinessEnv();
  await withLiveCanaryEnv({
    OPERATIONAL_AGENT_MODE: "disabled",
    OPERATIONAL_AGENT_INTEGRATION_ENABLED: undefined,
    OPERATIONAL_APPROVED_CONFIG_HASH: undefined,
    OPERATIONAL_LIVE_CANARY_APPROVED_CONFIG_HASH: valid.OPERATIONAL_LIVE_CANARY_APPROVED_CONFIG_HASH,
    OPERATIONAL_LIVE_CANARY_ENABLED: "false",
    OPERATIONAL_LIVE_CANARY_DATABASE_URL: liveCanarySmokeDatabaseUrl(),
    LLM_PROVIDER: "mock",
    LLM_LIVE_CALLS_ENABLED: "false",
    OPENAI_API_KEY: undefined
  }, async () => {
    const preflight = await createOperationalLiveCanaryTransportProbePreflight();
    assert(!preflight.paid_execution_permitted, "Default transport probe preflight should not permit paid execution.");
    assert(preflight.no_provider_call_made, "Transport probe preflight should make no provider call.");
    let missingConfirmBlocked = false;
    try {
      await runOperationalLiveCanaryTransportProbe({ confirmPaidApi: false });
    } catch (error) {
      missingConfirmBlocked = error instanceof Error && error.message.includes("--confirm-paid-api");
    }
    assert(missingConfirmBlocked, "Transport probe should require explicit paid confirmation.");
    const blocked = await runOperationalLiveCanaryTransportProbe({ confirmPaidApi: true });
    assert(blocked.status === "blocked", "Disabled transport probe should block before provider dispatch.");
    assert(blocked.paid_api_request_made === false, "Blocked transport probe should make no provider request.");
  });
}

async function transportProbeDryRunSmoke() {
  const valid = await validCanaryReadinessEnv();
  await withLiveCanaryEnv({
    OPERATIONAL_AGENT_MODE: valid.OPERATIONAL_AGENT_MODE,
    OPERATIONAL_AGENT_INTEGRATION_ENABLED: valid.OPERATIONAL_AGENT_INTEGRATION_ENABLED,
    OPERATIONAL_APPROVED_CONFIG_HASH: valid.OPERATIONAL_APPROVED_CONFIG_HASH,
    OPERATIONAL_LIVE_CANARY_APPROVED_CONFIG_HASH: valid.OPERATIONAL_LIVE_CANARY_APPROVED_CONFIG_HASH,
    OPERATIONAL_LIVE_CANARY_ENABLED: valid.OPERATIONAL_LIVE_CANARY_ENABLED,
    OPERATIONAL_LIVE_CANARY_DATABASE_URL_ACTIVE: valid.OPERATIONAL_LIVE_CANARY_DATABASE_URL_ACTIVE,
    OPERATIONAL_LIVE_CANARY_DATABASE_URL: liveCanarySmokeDatabaseUrl(),
    LLM_PROVIDER: valid.LLM_PROVIDER,
    LLM_LIVE_CALLS_ENABLED: valid.LLM_LIVE_CALLS_ENABLED,
    OPENAI_API_KEY: valid.OPENAI_API_KEY,
    OPERATIONAL_LIVE_CANARY_TEST_ALLOW_SMOKE_DATABASE: "true"
  }, async () => {
    await withSmokeCanaryDatabase(async () => {
      const dryRun = await createOperationalLiveCanaryTransportProbeDryRun();
      assert(dryRun.external_request_made === false, "Transport probe dry run must make no provider request.");
      assert(dryRun.resolved_provider === "openai", "Dry run should resolve the OpenAI provider in valid env.");
      assert(dryRun.resolved_transport === "openai_responses", "Dry run should resolve the Responses transport.");
      assert(dryRun.input_contract_valid, "Dry run should validate the exact input contract.");
      assert(dryRun.redaction_valid, "Dry run should validate redaction.");
      assert(dryRun.output_schema_valid, "Dry run should compile the output schema.");
      assert(dryRun.exact_dispatch_would_be_permitted, "Valid dry run should reach transport-ready stage.");
      assert(dryRun.stage_trace.some((stage) => stage.stage === "transport_adapter_resolved" && stage.ok), "Transport-ready stage should be present.");
    });
  });
}

async function transportBoundarySmoke() {
  const valid = await validCanaryReadinessEnv();
  await withLiveCanaryEnv({
    OPERATIONAL_AGENT_MODE: valid.OPERATIONAL_AGENT_MODE,
    OPERATIONAL_AGENT_INTEGRATION_ENABLED: valid.OPERATIONAL_AGENT_INTEGRATION_ENABLED,
    OPERATIONAL_APPROVED_CONFIG_HASH: valid.OPERATIONAL_APPROVED_CONFIG_HASH,
    OPERATIONAL_LIVE_CANARY_APPROVED_CONFIG_HASH: valid.OPERATIONAL_LIVE_CANARY_APPROVED_CONFIG_HASH,
    OPERATIONAL_LIVE_CANARY_ENABLED: valid.OPERATIONAL_LIVE_CANARY_ENABLED,
    OPERATIONAL_LIVE_CANARY_DATABASE_URL_ACTIVE: valid.OPERATIONAL_LIVE_CANARY_DATABASE_URL_ACTIVE,
    OPERATIONAL_LIVE_CANARY_DATABASE_URL: liveCanarySmokeDatabaseUrl(),
    LLM_PROVIDER: valid.LLM_PROVIDER,
    LLM_LIVE_CALLS_ENABLED: valid.LLM_LIVE_CALLS_ENABLED,
    OPENAI_API_KEY: valid.OPENAI_API_KEY,
    OPERATIONAL_LIVE_CANARY_TEST_ALLOW_SMOKE_DATABASE: "true",
    OPERATIONAL_LIVE_CANARY_TEST_ABORT_AT_TRANSPORT_BOUNDARY: "true"
  }, async () => {
    await withSmokeCanaryDatabase(async () => {
      const result = await runOperationalLiveCanaryTransportProbe({ confirmPaidApi: true });
      assert(result.status === "blocked", "Test transport hook should block before paid probe execution.");
      assert(result.paid_api_request_made === false, "Boundary-aborted smoke must not count a provider request.");
      assert(
        Array.isArray(result.blocking_reasons) &&
          result.blocking_reasons.includes("test_transport_hook_active"),
        "Test transport hook block reason should be preserved."
      );
    });
  });
}

async function transportStageSmoke() {
  const runPublicId = await simulatedRun();
  process.env.OPERATIONAL_LIVE_CANARY_DATABASE_URL = liveCanarySmokeDatabaseUrl();
  const diagnosis = await diagnoseOperationalLiveCanaryTransportProbe(runPublicId);
  const first = diagnosis.steps[0].dispatch_attempts[0];
  assert(first.stage_trace_present, "Simulated transport attempt should expose a stage trace.");
  assert(first.last_completed_stage === "step_finalized", "Successful simulation should finalize the stage machine.");
  assert(first.transport_objective.passed === true, "Successful simulation should satisfy transport objective per step.");
}

async function transportErrorSmoke() {
  await withSmokeCanaryDatabase(async () => {
    const prisma = createCanaryPrismaClient();
    try {
      const manifest = await loadOperationalLiveCanaryManifest();
      const run = await createCanaryRunSkeleton({ status: "running", prisma });
      const step = run.steps.find((entry) => entry.agent_name === "response_collection_agent") ?? run.steps[0];
      const attempt = await prisma.operationalLiveCanaryDispatchAttempt.create({
        data: {
          dispatch_public_id: "olcd_transport_error_smoke",
          run_db_id: run.id,
          step_db_id: step.id,
          logical_invocation_key: step.logical_invocation_key,
          attempt_index: 1,
          dispatch_key: `transport-error-smoke:${run.run_public_id}`,
          provider: "openai",
          transport: "openai_responses",
          adapter_version: "openai-responses-adapter-v2",
          network_dispatch_expected: true,
          network_dispatch_started: false,
          model_snapshot: manifest.model_snapshot,
          reasoning_effort: manifest.reasoning_effort,
          execution_path: "transport_error_smoke",
          provenance_type: "deterministic_fallback",
          lifecycle_status: "pre_dispatch_failed",
          last_completed_stage: "transport_adapter_resolved",
          failure_stage: "input_contract_validated",
          typed_failure_reason: "probe_input_contract_invalid",
          request_reserved_at: new Date(),
          client_dispatch_id: "transport_error_smoke_client_dispatch",
          usage_status: "not_dispatched",
          cost_status: "not_dispatched",
          transport_objective_json: {
            exactly_one_dispatch_required: true,
            dispatch_started: false,
            fetch_invoked: false,
            response_received: false,
            usage_verified: false,
            accounting_complete: true,
            cost_status: "not_dispatched",
            effective_result_usable: false,
            passed: false
          }
        }
      });
      assert(attempt.lifecycle_status === "pre_dispatch_failed", "Pre-boundary failures should not be provider failures.");
      const report = await createOperationalLiveCanaryReport(run.run_public_id);
      assert(report.metrics.fallback_count === 1, "Fallback count should include deterministic fallback provenance.");
      assert(!report.provider_execution.transport_objective.passed, "Fallback must not satisfy transport objective.");
    } finally {
      await prisma.$disconnect();
    }
  });
}

async function transportProbeDiagnosticSmoke() {
  const runPublicId = await simulatedRun();
  process.env.OPERATIONAL_LIVE_CANARY_DATABASE_URL = liveCanarySmokeDatabaseUrl();
  const diagnosis = await diagnoseOperationalLiveCanaryTransportProbe(runPublicId);
  assert(diagnosis.read_only, "Diagnosis should declare read-only behavior.");
  assert(diagnosis.steps.length === 30, "Diagnosis should account for all simulated steps.");
  assert(diagnosis.steps[0].dispatch_attempts[0].selected_transport_implementation === "openai_responses", "Diagnosis should expose transport descriptor.");
  assert(!JSON.stringify(diagnosis).includes("fake-key-never-sent"), "Diagnosis must not expose API keys.");
}

async function transportReportConsistencySmoke() {
  const runPublicId = await simulatedRun();
  process.env.OPERATIONAL_LIVE_CANARY_DATABASE_URL = liveCanarySmokeDatabaseUrl();
  const [inspect, forensics, reconciliation, report] = await Promise.all([
    inspectOperationalLiveCanaryRun(runPublicId),
    forensicsOperationalLiveCanaryRun(runPublicId),
    reconcileOperationalLiveCanaryRun(runPublicId),
    createOperationalLiveCanaryReport(runPublicId)
  ]);
  assert(inspect.lifecycle_counts.finalized_success === 30, "Inspect should agree on finalized successes.");
  assert(forensics.lifecycle_counts.finalized_success === 30, "Forensics should agree on finalized successes.");
  assert(reconciliation.lifecycle_counts.finalized_success === 30, "Reconcile should agree on finalized successes.");
  assert(report.provider_execution.lifecycle_counts.finalized_success === 30, "Report should agree on finalized successes.");
  assert(report.provider_execution.accounting_verified, "Report accounting should verify for simulation.");
}

async function reportConsistencySmoke() {
  const runPublicId = await simulatedRun();
  process.env.OPERATIONAL_LIVE_CANARY_DATABASE_URL = liveCanarySmokeDatabaseUrl();
  const report = await createOperationalLiveCanaryReport(runPublicId);
  assert(report.provider_execution.accounting_verified, "Report should expose verified provider accounting.");
  assert(report.effective_execution.completed_steps === 30, "Report should expose effective completed steps.");
  assert(report.integrity.unknown_legacy_provenance_is_not_verified, "Report should document unknown legacy policy.");
}

async function executionPathSmoke() {
  const runPublicId = await simulatedRun();
  process.env.OPERATIONAL_LIVE_CANARY_DATABASE_URL = liveCanarySmokeDatabaseUrl();
  const inspect = await inspectOperationalLiveCanaryRun(runPublicId);
  assert(inspect.steps.every((step) => step.execution_path), "Every simulated step should have execution path metadata.");
  assert(inspect.steps.every((step) => step.provider_conclusion === "live_provider"), "Every simulated step should carry provider conclusion.");
  assert(inspect.steps.every((step) => step.effective_conclusion === "effective_success"), "Every simulated step should carry effective conclusion.");
}

async function dependencySmoke() {
  const runPublicId = await simulatedRun();
  process.env.OPERATIONAL_LIVE_CANARY_DATABASE_URL = liveCanarySmokeDatabaseUrl();
  const inspect = await inspectOperationalLiveCanaryRun(runPublicId);
  assert(inspect.steps.every((step) => typeof step.dependency_hash === "string" && step.dependency_hash.length === 64), "Every step should store dependency hash.");
}

async function cliProgressSmoke() {
  const preflight = runCommand("npx", ["tsx", "prisma/operational-live-canary-transport-probe-preflight.ts"], {
    env: {
      ...process.env,
      OPERATIONAL_LIVE_CANARY_DATABASE_URL: liveCanarySmokeDatabaseUrl(),
      OPERATIONAL_AGENT_MODE: "disabled",
      LLM_PROVIDER: "mock",
      LLM_LIVE_CALLS_ENABLED: "false"
    },
    timeoutMs: 120_000
  });
  const parsed = JSON.parse(preflight.stdout);
  assert(parsed.no_provider_call_made === true, "CLI preflight should report no provider call.");
  assert(parsed.target.planned_provider_requests === 1, "CLI preflight should describe one-call probe.");
}

async function historyPreservationSmoke() {
  await ensureDatabaseReady();
  const before = await forensicsOperationalLiveCanaryRun("olcr_20260625_fgdjkha");
  const beforeHash = createHash("sha256").update(JSON.stringify(before.steps)).digest("hex");
  const after = await forensicsOperationalLiveCanaryRun("olcr_20260625_fgdjkha");
  const afterHash = createHash("sha256").update(JSON.stringify(after.steps)).digest("hex");
  assert(beforeHash === afterHash, "Historical run forensics must be read-only.");
  assert(after.read_only, "Historical forensics should declare read-only behavior.");
}

function responseCollectionOutput() {
  return {
    agent_name: "response_collection_agent",
    agent_version: "response-collection-agent-v1",
    prompt_version: "response-collection-v5",
    schema_version: "response-collection-output-v3",
    output_status: "ok",
    warnings: [],
    assistant_message: "I recorded your reasoning.",
    intervention_type: "none",
    should_advance: false,
    blocked_content_help: false,
    missing_evidence_status: "complete",
    recognized_intents: ["reasoning_submission"],
    reasoning_capture_status: "new_reasoning",
    reasoning_evidence_segments: ["I chose A because the pattern matches the example."],
    requires_option_button: false,
    requires_confidence_control: false,
    requested_control_action: "none",
    recommended_interaction_outcome: "stay_current_step",
    events_to_log: []
  };
}

function responseCollectionRequest(timeoutMs = 2000) {
  return {
    agent_name: "response_collection_agent" as const,
    model_config: {
      model_name: "gpt-5.4-mini-2026-03-17",
      reasoning_effort: "low" as const,
      max_output_tokens: 1500
    },
    instructions: "Return the required structured output.",
    input: {
      current_phase: "initial_item_administration",
      allowed_interaction_type: "reasoning_text",
      current_item_student_safe: { item_public_id: "item_synth_001", stem: "Synthetic item" },
      student_message: "I chose A because the pattern matches the example.",
      collected_response_state: { selected_option: "A", confidence_rating: "medium" },
      missing_evidence_state: { missing: [] },
      recent_student_safe_transcript: [],
      orchestration_constraints: { no_hints: true },
      procedural_policy: { refuse_correctness_feedback: true },
      allowed_student_controls: ["free_text_message", "submit_button"]
    },
    output_schema: agentOutputSchemas.response_collection_agent,
    schema_name: "response_collection_output_v3",
    client_request_id: `loopback_${Date.now()}`,
    timeout_ms: timeoutMs,
    metadata: { smoke_test: "loopback_transport" }
  };
}

async function withLoopbackServer(
  handler: (req: http.IncomingMessage, body: string, res: http.ServerResponse) => void
) {
  const requests: Array<{ url: string | undefined; method: string | undefined; body: string }> = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      requests.push({ url: req.url, method: req.method, body });
      handler(req, body, res);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Loopback server did not bind to a TCP port.");
  }
  return {
    baseURL: `http://127.0.0.1:${address.port}/v1`,
    requests,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  };
}

async function runLoopbackProvider(
  handler: (req: http.IncomingMessage, body: string, res: http.ServerResponse) => void
) {
  const loopback = await withLoopbackServer(handler);
  try {
    return await withLiveCanaryEnv({
      OPERATIONAL_AGENT_MODE: "guarded_live",
      OPERATIONAL_AGENT_INTEGRATION_ENABLED: "false",
      OPERATIONAL_APPROVED_CONFIG_HASH: activeOperationalConfigHash(),
      OPERATIONAL_LIVE_CANARY_APPROVED_CONFIG_HASH: activeOperationalConfigHash(),
      OPERATIONAL_LIVE_CANARY_ENABLED: "true",
      OPERATIONAL_LIVE_CANARY_DATABASE_URL_ACTIVE: "true",
      OPERATIONAL_LIVE_CANARY_DATABASE_URL: liveCanarySmokeDatabaseUrl(),
      OPERATIONAL_LIVE_CANARY_LOOPBACK_OPENAI_BASE_URL: loopback.baseURL,
      LLM_PROVIDER: "openai",
      LLM_LIVE_CALLS_ENABLED: "true",
      OPENAI_API_KEY: "sk-loopback-fake-key-never-sent",
      LLM_DAILY_CLASS_CALL_LIMIT: "80"
    }, async () => {
      const result = await new OpenAIResponsesProvider().executeStructured(responseCollectionRequest());
      return { result, requests: loopback.requests };
    });
  } finally {
    await loopback.close();
  }
}

async function testHookIsolationSmoke() {
  await withLiveCanaryEnv({
    OPERATIONAL_LIVE_CANARY_TEST_ABORT_AT_TRANSPORT_BOUNDARY: "true",
    OPENAI_API_KEY: "sk-test-hook-fake-key-never-sent"
  }, async () => {
    const report = createOperationalLiveCanaryTransportEnvironmentReport();
    assert(!report.paid_transport_eligible, "Test transport hook should block paid transport eligibility.");
    assert(report.blocking_reasons.includes("test_transport_hook_active"), "Test hook block reason missing.");
    const preflight = await createOperationalLiveCanaryTransportProbePreflight();
    assert(!preflight.paid_execution_permitted, "Transport probe preflight should fail closed with a test hook.");
  });
}

async function openAIErrorNormalizationSmoke() {
  const milestones = {
    transport_adapter_entered: true,
    request_serialization_completed: true,
    fetch_invoked: true,
    response_headers_received: false,
    response_body_received: false
  };
  const auth = normalizeOpenAITransportError({ status: 401, code: "invalid_api_key", message: "bad sk-secret-value" }, milestones);
  assert(auth.typed_failure_reason === "openai_authentication_failed", "401 should normalize to authentication failure.");
  assert(!JSON.stringify(auth).includes("sk-secret-value"), "Normalized errors must redact secret-like values.");
  const model = normalizeOpenAITransportError({ status: 404, code: "model_not_found", message: "model not found" }, milestones);
  assert(model.typed_failure_reason === "openai_model_not_found", "404 model should normalize to model_not_found.");
  const quota = normalizeOpenAITransportError({ status: 429, code: "insufficient_quota", message: "quota" }, milestones);
  assert(quota.typed_failure_reason === "openai_quota_exceeded", "Quota 429 should normalize to quota.");
  const dns = normalizeOpenAITransportError(Object.assign(new Error("fetch failed"), { cause: { code: "ENOTFOUND", name: "Error" } }), milestones);
  assert(dns.typed_failure_reason === "openai_dns_failed", "DNS failures should normalize.");
}

async function loopbackTransportSmoke() {
  const output = responseCollectionOutput();
  const { result, requests } = await runLoopbackProvider((_req, _body, res) => {
    res.statusCode = 200;
    res.setHeader("content-type", "application/json");
    res.setHeader("x-request-id", "req_loopback_123");
    res.end(JSON.stringify({
      id: "resp_loopback_123",
      object: "response",
      created_at: Math.floor(Date.now() / 1000),
      status: "completed",
      model: "gpt-5.4-mini-2026-03-17",
      output: [{
        id: "msg_loopback_123",
        type: "message",
        status: "completed",
        role: "assistant",
        content: [{
          type: "output_text",
          text: JSON.stringify(output),
          annotations: [],
          parsed: output
        }]
      }],
      output_parsed: output,
      usage: {
        input_tokens: 11,
        output_tokens: 22,
        total_tokens: 33,
        input_tokens_details: { cached_tokens: 3 },
        output_tokens_details: { reasoning_tokens: 4 }
      }
    }));
  });
  assert(requests.length === 1, "Loopback should receive exactly one SDK request.");
  const requestBody = JSON.parse(requests[0].body);
  assert(requests[0].method === "POST", "Responses adapter should POST.");
  assert(requestBody.store === false, "Responses request must set store:false.");
  assert(!("tools" in requestBody), "Responses request must not include tools.");
  assert(result.transport_telemetry?.fetch_invoked, "Loopback result should mark fetch invoked.");
  assert(result.transport_telemetry?.response_headers_received, "Loopback result should mark headers received.");
  assert(result.transport_telemetry?.response_body_received, "Loopback result should mark body received.");
  assert(result.status === "completed", `Loopback success should complete, got ${result.status}.`);

  const missingUsage = await runLoopbackProvider((_req, _body, res) => {
    res.statusCode = 200;
    res.setHeader("content-type", "application/json");
    res.setHeader("x-request-id", "req_loopback_missing_usage");
    res.end(JSON.stringify({
      id: "resp_loopback_missing_usage",
      object: "response",
      created_at: Math.floor(Date.now() / 1000),
      status: "completed",
      model: "gpt-5.4-mini-2026-03-17",
      output: [{
        id: "msg_loopback_missing_usage",
        type: "message",
        status: "completed",
        role: "assistant",
        content: [{ type: "output_text", text: JSON.stringify(output), annotations: [], parsed: output }]
      }],
      output_parsed: output
    }));
  });
  assert(missingUsage.result.status === "completed", "Valid response missing usage should still parse.");
  assert(!missingUsage.result.usage, "Missing usage should remain absent for accounting tests.");
}

async function requestAccountingSmoke() {
  await ensureDatabaseReady();
  await withSmokeCanaryDatabase(async () => {
    const prisma = createCanaryPrismaClient();
    try {
      const run = await createCanaryRunSkeleton({ status: "running", runPublicId: `olcr_accounting_${Date.now()}`, prisma });
      const step = run.steps[0];
      const attempt = await prisma.operationalLiveCanaryDispatchAttempt.create({
        data: {
          dispatch_public_id: "olcd_accounting_smoke",
          run_db_id: run.id,
          step_db_id: step.id,
          logical_invocation_key: step.logical_invocation_key,
          attempt_index: 1,
          dispatch_key: `accounting:${run.run_public_id}:${step.step_public_id}`,
          provider: "openai",
          transport: "openai_responses",
          adapter_version: "openai-responses-adapter-v2",
          network_dispatch_expected: true,
          network_dispatch_started: true,
          transport_adapter_entered: true,
          request_serialization_completed: true,
          fetch_invoked: true,
          response_headers_received: true,
          response_body_received: true,
          network_request_attempt_count: 1,
          provider_acknowledged_request_count: 1,
          accounting_complete: true,
          model_snapshot: "gpt-5.4-mini-2026-03-17",
          reasoning_effort: "low",
          execution_path: "smoke",
          provenance_type: "live_provider",
          lifecycle_status: "finalized_success",
          client_dispatch_id: `client_accounting_${Date.now()}`,
          dispatch_started_at: new Date(),
          response_received_at: new Date(),
          usage_verified_at: new Date(),
          finalized_at: new Date(),
          provider_request_id: "req_accounting",
          provider_response_id: "resp_accounting",
          input_tokens: 1,
          output_tokens: 1,
          total_tokens: 2,
          estimated_cost_usd: new Prisma.Decimal(0.000001),
          usage_status: "usage_verified",
          cost_status: "usage_verified"
        }
      });
      assert(attempt.network_request_attempt_count === 1, "Network request count should be one.");
      assert(attempt.provider_acknowledged_request_count === 1, "Provider acknowledged count should be one.");
      await prisma.operationalLiveCanaryRun.update({
        where: { id: run.id },
        data: {
          provider_request_count: 1,
          estimated_cost_usd: new Prisma.Decimal(0.000001)
        }
      });
      const reconciliation = await reconcileOperationalLiveCanaryRun(run.run_public_id);
      assert(reconciliation.network_request_attempt_count === 1, "Reconcile should expose network attempt count.");
      assert(reconciliation.provider_acknowledged_request_count === 1, "Reconcile should expose provider acknowledgement count.");
    } finally {
      await prisma.$disconnect();
    }
  });
}

async function costUncertaintySmoke() {
  await ensureDatabaseReady();
  await withSmokeCanaryDatabase(async () => {
    const prisma = createCanaryPrismaClient();
    try {
      const run = await createCanaryRunSkeleton({ status: "running", runPublicId: `olcr_cost_${Date.now()}`, prisma });
      const step = run.steps[0];
      await prisma.operationalLiveCanaryDispatchAttempt.create({
        data: {
          dispatch_public_id: "olcd_cost_uncertain_smoke",
          run_db_id: run.id,
          step_db_id: step.id,
          logical_invocation_key: step.logical_invocation_key,
          attempt_index: 1,
          dispatch_key: `cost:${run.run_public_id}:${step.step_public_id}`,
          provider: "openai",
          transport: "openai_responses",
          adapter_version: "openai-responses-adapter-v2",
          network_dispatch_expected: true,
          network_dispatch_started: true,
          transport_adapter_entered: true,
          request_serialization_completed: true,
          fetch_invoked: true,
          network_request_attempt_count: 1,
          provider_acknowledged_request_count: 0,
          accounting_complete: false,
          model_snapshot: "gpt-5.4-mini-2026-03-17",
          reasoning_effort: "low",
          execution_path: "smoke",
          provenance_type: "live_provider_failure",
          lifecycle_status: "unknown_after_dispatch",
          client_dispatch_id: `client_cost_${Date.now()}`,
          usage_status: "unknown",
          cost_status: "cost_unverified_after_dispatch"
        }
      });
      const reconciliation = await reconcileOperationalLiveCanaryRun(run.run_public_id);
      assert(!reconciliation.safe_to_resume, "Cost-unverified dispatch should not be safe to resume.");
      assert(reconciliation.safe_to_resume_reasons.includes("usage_unverified"), "Cost uncertainty should produce usage_unverified resume reason.");
    } finally {
      await prisma.$disconnect();
    }
  });
}

async function cliLedgerConsistencySmoke() {
  const runPublicId = await simulatedRun();
  process.env.OPERATIONAL_LIVE_CANARY_DATABASE_URL = liveCanarySmokeDatabaseUrl();
  const [inspect, report, reconciliation] = await Promise.all([
    inspectOperationalLiveCanaryRun(runPublicId),
    createOperationalLiveCanaryReport(runPublicId),
    reconcileOperationalLiveCanaryRun(runPublicId)
  ]);
  assert(inspect.provider_request_count === report.run.provider_request_count, "Inspect/report provider count mismatch.");
  assert(report.provider_execution.network_request_attempt_count === reconciliation.network_request_attempt_count, "Report/reconcile network count mismatch.");
  assert(report.provider_execution.provider_acknowledged_request_count === reconciliation.provider_acknowledged_request_count, "Report/reconcile provider acknowledgement mismatch.");
}

async function transportEnvironmentSmoke() {
  await withLiveCanaryEnv({
    OPENAI_API_KEY: "sk-transport-env-fake-key-never-sent",
    OPERATIONAL_LIVE_CANARY_TARGET_MODEL: "gpt-5.4-mini-2026-03-17"
  }, async () => {
    const report = createOperationalLiveCanaryTransportEnvironmentReport();
    assert(report.base_url_approved, "Default OpenAI host should be approved.");
    assert(report.api_key_configured, "API key configured boolean should be true.");
    assert(!JSON.stringify(report).includes("sk-transport-env"), "Environment report must not expose API key.");
  });
  await withLiveCanaryEnv({
    OPENAI_API_KEY: "sk-transport-env-fake-key-never-sent",
    OPERATIONAL_LIVE_CANARY_LOOPBACK_OPENAI_BASE_URL: "http://127.0.0.1:1/v1"
  }, async () => {
    const report = createOperationalLiveCanaryTransportEnvironmentReport();
    assert(!report.base_url_approved, "Loopback host should not be approved for paid transport.");
    assert(!report.paid_transport_eligible, "Loopback should not satisfy paid transport eligibility.");
  });
}

function sdkResponseFixture(overrides: Record<string, unknown> = {}) {
  const output = responseCollectionOutput();
  return {
    id: "resp_fixture_123",
    object: "response",
    created_at: 1,
    status: "completed",
    model: "gpt-5.4-mini-2026-03-17",
    output: [{
      id: "msg_fixture_123",
      type: "message",
      status: "completed",
      role: "assistant",
      content: [{
        type: "output_text",
        text: JSON.stringify(output),
        annotations: [],
        parsed: output
      }]
    }],
    output_parsed: output,
    usage: {
      input_tokens: 100,
      output_tokens: 40,
      total_tokens: 140,
      input_tokens_details: { cached_tokens: 10 },
      output_tokens_details: { reasoning_tokens: 12 }
    },
    ...overrides
  };
}

async function responseNormalizationSmoke() {
  const normalized = normalizeOpenAIResponsesResult({
    sdkResponse: sdkResponseFixture(),
    providerRequestId: "req_fixture",
    responseBodyReceived: true,
    modelSnapshot: "gpt-5.4-mini-2026-03-17"
  });
  assert(normalized.transport.responseId === "resp_fixture_123", "Response ID should normalize.");
  assert(normalized.transport.requestId === "req_fixture", "Request ID should normalize separately.");
  assert(normalized.transport.acknowledged, "Successful response should be acknowledged.");
  assert(normalized.rawOutput.outputTextPath === "output.0.content.0.text", "Output text path should be captured.");
  assert(normalized.rawOutput.parsedOutputPath === "output_parsed", "Parsed output path should be captured.");
  assert(normalized.rawOutput.outcome === "valid", "Successful structured output should be raw-valid.");
  assert(normalized.usage.status === "usage_verified", "Complete usage should verify.");
  assert(normalized.usage.inputTokens === 100, "Input tokens should extract.");
  assert(normalized.usage.outputTokens === 40, "Output tokens should extract.");
  assert(normalized.usage.totalTokens === 140, "Total tokens should extract.");
  assert(normalized.usage.calculatedCostUsd !== null, "Cost should calculate from pricing registry.");
}

async function usageExtractionSmoke() {
  const normalized = normalizeOpenAIResponsesResult({
    sdkResponse: sdkResponseFixture({
      usage: {
        input_tokens: 200,
        output_tokens: 60,
        total_tokens: 260,
        input_tokens_details: { cached_tokens: 25 },
        output_tokens_details: { reasoning_tokens: 30 }
      }
    }),
    providerRequestId: "req_usage",
    responseBodyReceived: true,
    modelSnapshot: "gpt-5.4-mini-2026-03-17"
  });
  assert(normalized.usage.cachedInputTokens === 25, "Cached input tokens should extract from cached_tokens.");
  assert(normalized.usage.reasoningTokens === 30, "Reasoning tokens should extract from output token details.");
  assert(normalized.usage.sourcePaths.includes("usage.input_tokens_details.cached_tokens"), "Cached token path missing.");
  assert(normalized.usage.sourcePaths.includes("usage.output_tokens_details.reasoning_tokens"), "Reasoning token path missing.");

  const missing = normalizeOpenAIResponsesResult({
    sdkResponse: sdkResponseFixture({ usage: undefined }),
    providerRequestId: "req_missing_usage",
    responseBodyReceived: true,
    modelSnapshot: "gpt-5.4-mini-2026-03-17"
  });
  assert(missing.usage.status === "usage_missing_after_response", "Missing usage should remain missing.");

  const malformed = normalizeOpenAIResponsesResult({
    sdkResponse: sdkResponseFixture({ usage: { input_tokens: 2, output_tokens: 3, total_tokens: 99 } }),
    providerRequestId: "req_malformed_usage",
    responseBodyReceived: true,
    modelSnapshot: "gpt-5.4-mini-2026-03-17"
  });
  assert(malformed.usage.status === "usage_malformed", "Inconsistent total tokens should be malformed.");
}

async function providerEffectiveSeparationSmoke() {
  await ensureDatabaseReady();
  await withSmokeCanaryDatabase(async () => {
    const prisma = createCanaryPrismaClient();
    try {
      const run = await createCanaryRunSkeleton({ status: "running", runPublicId: `olcr_sep_${Date.now()}`, prisma });
      const step = run.steps[0];
      await prisma.operationalLiveCanaryDispatchAttempt.create({
        data: {
          dispatch_public_id: "olcd_sep_smoke",
          run_db_id: run.id,
          step_db_id: step.id,
          logical_invocation_key: step.logical_invocation_key,
          attempt_index: 1,
          dispatch_key: `sep:${run.run_public_id}:${step.step_public_id}`,
          provider: "openai",
          transport: "openai_responses",
          adapter_version: "openai-responses-adapter-v2",
          network_dispatch_expected: true,
          network_dispatch_started: true,
          transport_adapter_entered: true,
          request_serialization_completed: true,
          fetch_invoked: true,
          response_headers_received: true,
          response_body_received: true,
          network_request_attempt_count: 1,
          provider_acknowledged_request_count: 1,
          accounting_complete: true,
          model_snapshot: "gpt-5.4-mini-2026-03-17",
          reasoning_effort: "low",
          execution_path: "smoke",
          provenance_type: "live_provider",
          lifecycle_status: "finalized_success",
          client_dispatch_id: `client_sep_${Date.now()}`,
          dispatch_started_at: new Date(),
          response_received_at: new Date(),
          usage_verified_at: new Date(),
          finalized_at: new Date(),
          provider_request_id: "req_sep",
          provider_response_id: "resp_sep",
          input_tokens: 100,
          output_tokens: 40,
          total_tokens: 140,
          estimated_cost_usd: new Prisma.Decimal(0.000255),
          usage_status: "usage_verified",
          cost_status: "usage_verified",
          transport_outcome: "live_provider_success",
          raw_output_outcome: "schema_invalid",
          effective_system_outcome: "deterministic_fallback_used",
          fallback_reason: "provider_output_schema_invalid"
        }
      });
      const reconciliation = await reconcileOperationalLiveCanaryRun(run.run_public_id);
      const objective = reconciliation.steps[0].dispatches[0].transport_objective;
      assert(objective.transport_outcome === "live_provider_success", "Transport success should remain separate.");
      assert(objective.raw_output_outcome === "schema_invalid", "Raw schema failure should be preserved.");
      assert(objective.effective_system_outcome === "deterministic_fallback_used", "Effective fallback should be separate.");
      assert(objective.passed === false, "Fallback should not pass transport objective.");
    } finally {
      await prisma.$disconnect();
    }
  });
}

async function fallbackReasonSmoke() {
  const cases = [
    [
      "valid",
      sdkResponseFixture(),
      "valid",
      null
    ],
    [
      "missing",
      { id: "resp_missing", status: "completed", usage: sdkResponseFixture().usage },
      "missing",
      "provider_output_missing"
    ],
    [
      "refused",
      sdkResponseFixture({
        output: [{ type: "message", content: [{ type: "refusal", refusal: "I cannot comply." }] }]
      }),
      "refused",
      "provider_output_refused"
    ],
    [
      "incomplete",
      sdkResponseFixture({ status: "incomplete", incomplete_details: { reason: "max_output_tokens" } }),
      "incomplete",
      "provider_output_incomplete"
    ]
  ] as const;
  for (const [label, sdkResponse, expectedOutcome, expectedReason] of cases) {
    const normalized = normalizeOpenAIResponsesResult({
      sdkResponse,
      providerRequestId: "req_fallback",
      responseBodyReceived: true,
      modelSnapshot: "gpt-5.4-mini-2026-03-17"
    });
    const derivedReason = normalized.outcomes.rawOutputOutcome === "valid"
      ? null
      : `provider_output_${normalized.outcomes.rawOutputOutcome}`;
    assert(normalized.transport.acknowledged, `${label} fixture should be acknowledged.`);
    assert(normalized.outcomes.rawOutputOutcome === expectedOutcome, `${label} raw-output outcome mismatch.`);
    assert(derivedReason === expectedReason, `${label} fallback reason should be stable.`);
  }
}

async function responseReplaySmoke() {
  await ensureDatabaseReady();
  await withSmokeCanaryDatabase(async () => {
    const prisma = createCanaryPrismaClient();
    try {
      const run = await createCanaryRunSkeleton({ status: "failed", runPublicId: `olcr_replay_${Date.now()}`, prisma });
      const step = run.steps[0];
      const invocationKey = `operational-live-canary:${run.run_public_id}:${step.logical_invocation_key}`;
      const agent = await prisma.agentCall.create({
        data: {
          id: randomUUID(),
          agent_name: step.agent_name,
          agent_version: "smoke",
          model_name: "gpt-5.4-mini-2026-03-17",
          provider: "openai",
          provider_response_id: "resp_replay",
          provider_request_id: "req_replay",
          client_request_id: "agent_req_replay",
          agent_invocation_key: invocationKey,
          prompt_version: "response-collection-v5",
          schema_version: "response-collection-output-v3",
          input_payload: {},
          raw_output: sdkResponseFixture({ id: "resp_replay" }) as Prisma.InputJsonValue,
          output_payload: responseCollectionOutput() as Prisma.InputJsonValue,
          output_validated: true,
          call_status: "succeeded",
          input_tokens: 100,
          output_tokens: 40,
          total_tokens: 140,
          token_usage: (sdkResponseFixture().usage ?? {}) as Prisma.InputJsonValue,
          live_call_allowed: true
        }
      });
      await prisma.operationalLiveCanaryDispatchAttempt.create({
        data: {
          dispatch_public_id: "olcd_replay_smoke",
          run_db_id: run.id,
          step_db_id: step.id,
          agent_call_db_id: agent.id,
          logical_invocation_key: step.logical_invocation_key,
          attempt_index: 1,
          dispatch_key: `replay:${run.run_public_id}:${step.step_public_id}`,
          provider: "openai",
          transport: "openai_responses",
          adapter_version: "openai-responses-adapter-v2",
          network_dispatch_expected: true,
          network_dispatch_started: true,
          fetch_invoked: true,
          response_headers_received: true,
          response_body_received: true,
          network_request_attempt_count: 1,
          provider_acknowledged_request_count: 1,
          model_snapshot: "gpt-5.4-mini-2026-03-17",
          reasoning_effort: "low",
          execution_path: "smoke",
          provenance_type: "live_provider",
          lifecycle_status: "finalized_success",
          client_dispatch_id: `client_replay_${Date.now()}`,
          provider_request_id: "req_replay",
          provider_response_id: "resp_replay",
          usage_status: "usage_verified",
          cost_status: "usage_verified",
          accounting_complete: true
        }
      });
      await prisma.operationalLiveCanaryStep.update({
        where: { id: step.id },
        data: { agent_call_public_id: "agent_call_replay", effective_result_public_id: null }
      });
      const before = await reconcileOperationalLiveCanaryRun(run.run_public_id);
      const replay = await replayOperationalLiveCanaryResponse(run.run_public_id);
      const after = await reconcileOperationalLiveCanaryRun(run.run_public_id);
      assert(replay.mutated === false, "Replay must not mutate data.");
      assert(replay.expected_accounting.usage_status === "usage_verified", "Replay should recover verified usage.");
      assert(JSON.stringify(before) === JSON.stringify(after), "Replay should be read-only.");
    } finally {
      await prisma.$disconnect();
    }
  });
}

async function dryRunSmoke() {
  runCommand("npx", ["tsx", "prisma/operational-live-canary-db.ts", "prepare"], {
    timeoutMs: 120_000
  });
  const dryRun = await createOperationalLiveCanaryDryRun();
  assert(dryRun.paid_api_request_made === false, "Dry run must not make provider requests.");
  assert(dryRun.manifest.valid, "Dry run should validate manifest.");
  assert(dryRun.invocation_graph.length === dryRun.manifest.planned_logical_invocations, "Dry-run graph count mismatch.");
}

async function main() {
  const suite = (argValue("--suite") ?? "manifest") as SuiteName;
  if (suite === "manifest") {
    await manifestSmoke();
  } else if (suite === "preflight") {
    await preflightSmoke();
  } else if (suite === "runner") {
    await runnerSmoke();
    await dryRunSmoke();
  } else if (suite === "budget") {
    await budgetSmoke();
  } else if (suite === "resume") {
    await resumeSmoke();
  } else if (suite === "network") {
    await networkSmoke();
  } else if (suite === "review-export") {
    await reviewExportSmoke();
  } else if (suite === "report") {
    await reportSmoke();
  } else if (suite === "isolation") {
    await ensureDatabaseReady();
    await isolationSmoke();
  } else if (suite === "db-resolution") {
    await dbResolutionSmoke();
  } else if (suite === "guard-parity") {
    await guardParitySmoke();
  } else if (suite === "block-reason") {
    await blockReasonSmoke();
  } else if (suite === "context") {
    await contextSmoke();
  } else if (suite === "actual-step-parity") {
    await actualStepParitySmoke();
  } else if (suite === "provenance") {
    await provenanceSmoke();
  } else if (suite === "dispatch-ledger") {
    await dispatchLedgerSmoke();
  } else if (suite === "accounting") {
    await accountingSmoke();
  } else if (suite === "reconciliation") {
    await reconciliationSmoke();
  } else if (suite === "recovery") {
    await recoverySmoke();
  } else if (suite === "signal") {
    await signalSmoke();
  } else if (suite === "full-simulation") {
    await fullSimulationSmoke();
  } else if (suite === "transport-probe") {
    await transportProbeSmoke();
  } else if (suite === "transport-probe-dry-run") {
    await transportProbeDryRunSmoke();
  } else if (suite === "transport-boundary") {
    await transportBoundarySmoke();
  } else if (suite === "transport-stage") {
    await transportStageSmoke();
  } else if (suite === "transport-error") {
    await transportErrorSmoke();
  } else if (suite === "transport-probe-diagnostic") {
    await transportProbeDiagnosticSmoke();
  } else if (suite === "transport-report-consistency") {
    await transportReportConsistencySmoke();
  } else if (suite === "test-hook-isolation") {
    await testHookIsolationSmoke();
  } else if (suite === "openai-error-normalization") {
    await openAIErrorNormalizationSmoke();
  } else if (suite === "loopback-transport") {
    await loopbackTransportSmoke();
  } else if (suite === "request-accounting") {
    await requestAccountingSmoke();
  } else if (suite === "cost-uncertainty") {
    await costUncertaintySmoke();
  } else if (suite === "cli-ledger-consistency") {
    await cliLedgerConsistencySmoke();
  } else if (suite === "transport-environment") {
    await transportEnvironmentSmoke();
  } else if (suite === "response-normalization") {
    await responseNormalizationSmoke();
  } else if (suite === "usage-extraction") {
    await usageExtractionSmoke();
  } else if (suite === "provider-effective-separation") {
    await providerEffectiveSeparationSmoke();
  } else if (suite === "fallback-reason") {
    await fallbackReasonSmoke();
  } else if (suite === "response-replay") {
    await responseReplaySmoke();
  } else if (suite === "agent-call-linkage") {
    await responseReplaySmoke();
  } else if (suite === "aggregate-reconciliation") {
    await requestAccountingSmoke();
    await providerEffectiveSeparationSmoke();
  } else if (suite === "cli-final-state") {
    await cliLedgerConsistencySmoke();
    await providerEffectiveSeparationSmoke();
  } else if (suite === "report-consistency") {
    await reportConsistencySmoke();
  } else if (suite === "execution-path") {
    await executionPathSmoke();
  } else if (suite === "dependency") {
    await dependencySmoke();
  } else if (suite === "cli-progress") {
    await cliProgressSmoke();
  } else if (suite === "history-preservation") {
    await historyPreservationSmoke();
  } else {
    throw new Error(`Unknown operational live canary smoke suite: ${suite}`);
  }
  console.log(`Operational live canary ${suite} smoke passed. No OpenAI call was made.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
