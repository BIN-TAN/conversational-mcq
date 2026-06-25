import { parse } from "csv-parse/sync";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  createCanaryRunSkeleton,
  createCanaryPrismaClient,
  createOperationalLiveCanaryDryRun,
  createOperationalLiveCanaryPreflightReport,
  createOperationalLiveCanaryReport,
  exportOperationalLiveCanaryReviewPacket,
  importOperationalLiveCanaryAiReview,
  inspectOperationalLiveCanaryRun,
  loadOperationalLiveCanaryManifest,
  manifestHash,
  operationalLiveCanaryDatabaseResolution,
  operationalLiveCanaryDatabaseName,
  runOperationalLiveCanary,
  validateOperationalLiveCanaryManifest
} from "../src/lib/services/operational-live-canary/service";
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
  databaseName,
  defaultDatabaseUrl,
  liveCanaryEnv,
  liveCanaryDatabaseUrl,
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
  | "actual-step-parity";

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
  "OPERATIONAL_LIVE_CANARY_DATABASE_URL_ACTIVE",
  "OPERATIONAL_LIVE_CANARY_DATABASE_URL",
  "LLM_PROVIDER",
  "LLM_LIVE_CALLS_ENABLED",
  "OPENAI_API_KEY",
  "LLM_DAILY_CLASS_CALL_LIMIT"
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
  await ensureDatabaseReady();
  const run = await createCanaryRunSkeleton({
    status: "completed",
    runPublicId: `olcr_report_smoke_${Date.now()}`,
    markCompletedSteps: true
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
  assert(ready.recommendation === "ready_for_private_staging_deployment", "All-pass review should be ready.");
  assert(ready.review.ai_pass_count === run.steps.length, "AI pass count mismatch.");
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
    OPENAI_API_KEY: valid.OPENAI_API_KEY
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
  } else {
    throw new Error(`Unknown operational live canary smoke suite: ${suite}`);
  }
  console.log(`Operational live canary ${suite} smoke passed. No OpenAI call was made.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
