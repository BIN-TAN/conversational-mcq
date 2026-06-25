import { parse } from "csv-parse/sync";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  createCanaryRunSkeleton,
  createOperationalLiveCanaryDryRun,
  createOperationalLiveCanaryPreflightReport,
  createOperationalLiveCanaryReport,
  exportOperationalLiveCanaryReviewPacket,
  importOperationalLiveCanaryAiReview,
  inspectOperationalLiveCanaryRun,
  loadOperationalLiveCanaryManifest,
  manifestHash,
  operationalLiveCanaryDatabaseName,
  runOperationalLiveCanary,
  validateOperationalLiveCanaryManifest
} from "../src/lib/services/operational-live-canary/service";
import {
  LIVE_CANARY_DATABASE_SUFFIX,
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
  | "isolation";

function argValue(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
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

async function dryRunSmoke() {
  runCommand("npx", ["tsx", "prisma/operational-live-canary-db.ts", "reset"], {
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
  } else {
    throw new Error(`Unknown operational live canary smoke suite: ${suite}`);
  }
  console.log(`Operational live canary ${suite} smoke passed. No OpenAI call was made.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
