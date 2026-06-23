import { PrismaClient } from "@prisma/client";
import { MockLlmProvider } from "../src/lib/llm/providers/mock-provider";
import { structuredOutputCompatibilitySummary } from "../src/lib/agents/provider-schema-compat";
import {
  createLiveCanaryDryRunReport,
  inspectLiveCanaryRun,
  __liveCanaryTestInternals,
  runLiveCanary
} from "../src/lib/services/evals/live-execution";
import { validateEvalCanaryConfig } from "../src/lib/services/evals/canary-config";
import { loadLiveCanaryManifest } from "../src/lib/services/evals/canary-manifest";
import { cleanupEvalFixtures } from "../src/lib/services/evals/service";
import { ensureTeacherReviewDemoUsers } from "./demo-teacher-review-fixture";
import {
  assert,
  cleanupLiveCanaryRecords,
  liveCanarySmokeEnv,
  operationalCounts,
  withCanaryEnv
} from "./eval-live-canary-test-utils";

const prisma = new PrismaClient();

async function expectReject(label: string, fn: () => Promise<unknown>) {
  let rejected = false;

  try {
    await fn();
  } catch {
    rejected = true;
  }

  assert(rejected, `${label} should have been rejected.`);
}

async function main() {
  await ensureTeacherReviewDemoUsers(prisma);
  await cleanupLiveCanaryRecords(prisma);
  await cleanupEvalFixtures();

  await withCanaryEnv(liveCanarySmokeEnv, async () => {
    const exact = validateEvalCanaryConfig({ requireLiveEnabled: true, requireApiKey: true });
    assert(exact.ready, "Exact snapshot configuration should validate.");

    await withCanaryEnv({ EVAL_TARGET_MODEL: "gpt-5.4-mini" }, async () => {
      const alias = validateEvalCanaryConfig({ requireLiveEnabled: true, requireApiKey: true });
      assert(!alias.ready, "Alias model should be rejected.");
      assert(alias.issues.some((issue) => issue.code === "alias_model_rejected"), "Alias rejection missing.");
    });

    await withCanaryEnv({ EVAL_TARGET_MODEL: "gpt-5.5" }, async () => {
      const wrong = validateEvalCanaryConfig({ requireLiveEnabled: true, requireApiKey: true });
      assert(!wrong.ready, "Wrong model should be rejected.");
      assert(wrong.issues.some((issue) => issue.code === "gpt_5_5_rejected"), "GPT-5.5 rejection missing.");
    });

    const manifest = await loadLiveCanaryManifest();
    assert(manifest.valid, "Canary manifest should be valid.");
    assert(manifest.ordered_cases.length === 25, "Manifest should contain 25 items.");
    assert(new Set(manifest.ordered_cases.map((entry) => `${entry.agent_name}:${entry.case_id}`)).size === 25, "Manifest case IDs should be unique per agent.");

    const countsByAgent = new Map<string, number>();
    for (const entry of manifest.ordered_cases) {
      countsByAgent.set(entry.agent_name, (countsByAgent.get(entry.agent_name) ?? 0) + 1);
    }
    for (const count of countsByAgent.values()) {
      assert(count === 5, "Each agent should have five manifest cases.");
    }

    const dryRun = await createLiveCanaryDryRunReport();
    assert(dryRun.ready, "Dry run should validate provider payloads.");
    assert(dryRun.openai_call_made === false, "Dry run must not make provider calls.");
    assert(dryRun.provider_payload_count === 25, "Dry run should build 25 provider payloads.");
    assert(dryRun.structured_output_compatibility.ok, "Dry run should include Structured Outputs compatibility.");
    assert(
      dryRun.quality_patch_prompt_versions.ok,
      "Dry run should verify quality-patch prompt versions."
    );
    assert(
      dryRun.new_run_would_create_new_run_instance,
      "Dry run should report that --new-run creates a new run instance."
    );

    const plan = await __liveCanaryTestInternals.buildLiveCanaryPlan();
    const unchangedFingerprint = __liveCanaryTestInternals.runConfigFingerprintForPlan(plan);
    const unchangedFingerprintAgain = __liveCanaryTestInternals.runConfigFingerprintForPlan(plan);
    assert(
      unchangedFingerprint.hash === unchangedFingerprintAgain.hash,
      "Unchanged canary configuration should produce a stable fingerprint."
    );
    const promptChangedCases = plan.cases.map((canaryCase, index) =>
      index === 0 ? { ...canaryCase, prompt_hash: "changed-prompt-hash-for-smoke" } : canaryCase
    );
    const promptChangedFingerprint = __liveCanaryTestInternals.runConfigFingerprintForPlan(plan, {
      cases: promptChangedCases
    });
    assert(
      promptChangedFingerprint.hash !== unchangedFingerprint.hash,
      "Changed prompt hash should change the run config fingerprint."
    );
    const evaluatorChangedFingerprint = __liveCanaryTestInternals.runConfigFingerprintForPlan(plan, {
      semantic_validator_version: "eval-semantic-smoke-change"
    });
    assert(
      evaluatorChangedFingerprint.hash !== unchangedFingerprint.hash,
      "Changed evaluator version should change the run config fingerprint."
    );

    const compatibility = structuredOutputCompatibilitySummary();
    assert(compatibility.ok, "All five provider-facing schemas should compile for Structured Outputs.");
    const compatibilityByAgent = new Map(
      compatibility.results.map((result) => [result.agent_name, result])
    );

    await expectReject("missing confirmation", () =>
      runLiveCanary({
        confirmPaidApi: false,
        runInstanceMode: "new_run",
        provider: new MockLlmProvider(),
        allowMockProvider: true
      })
    );

    await expectReject("missing explicit run mode", () =>
      runLiveCanary({
        confirmPaidApi: true,
        provider: new MockLlmProvider(),
        allowMockProvider: true
      })
    );

    await withCanaryEnv({ OPENAI_API_KEY: "" }, async () => {
      await expectReject("missing API key", () =>
        runLiveCanary({
          confirmPaidApi: true,
          runInstanceMode: "new_run",
          provider: new MockLlmProvider()
        })
      );
    });

    await withCanaryEnv({ EVAL_LIVE_CALLS_ENABLED: "false" }, async () => {
      await expectReject("live eval disabled", () =>
        runLiveCanary({
          confirmPaidApi: true,
          runInstanceMode: "new_run",
          provider: new MockLlmProvider()
        })
      );
    });

    const teacher = await prisma.user.findUniqueOrThrow({
      where: { user_id: "teacher_demo" },
      select: { id: true }
    });
    await prisma.evalCase.updateMany({
      where: { case_id: "iva_clean_item_set_001" },
      data: { case_source: "teacher_authored" }
    });
    const nonsynthetic = await __liveCanaryTestInternals.buildLiveCanaryPlan({
      ensureFixtures: false
    });
    assert(!nonsynthetic.valid, "Nonsynthetic case should invalidate the canary plan.");
    assert(
      nonsynthetic.issues.some((issue) => issue.code === "nonsynthetic_case_rejected"),
      "Nonsynthetic rejection should be reported."
    );
    await prisma.evalCase.updateMany({
      where: { case_id: "iva_clean_item_set_001" },
      data: { case_source: "synthetic" }
    });

    const before = await operationalCounts(prisma);
    const incompatible = await runLiveCanary({
      confirmPaidApi: true,
      runInstanceMode: "new_run",
      provider: new MockLlmProvider(),
      allowMockProvider: true,
      compatibilityCheck: (agentName) => {
        if (agentName === "item_verification_agent") {
          return {
            agent_name: agentName,
            prompt_version: "test-incompatible",
            schema_version: "test-incompatible",
            prompt_hash: "test-incompatible",
            compatible: false,
            schema_compiled: false,
            issues: [
              {
                code: "structured_output_schema_incompatible",
                path: "#/properties/item_public_id",
                message: "Synthetic optional-field compatibility failure."
              }
            ]
          };
        }

        const result = compatibilityByAgent.get(agentName);
        assert(result, `Compatibility result missing for ${agentName}.`);

        return result;
      }
    });
    assert(incompatible.status === "failed", "Incompatible Structured Outputs schema should fail the run.");
    assert(
      incompatible.provider_request_count === 0,
      "Structured Outputs compatibility failure should not increment provider requests."
    );
    const incompatibleRun = await prisma.evalRun.findUniqueOrThrow({
      where: { run_public_id: incompatible.run_public_id },
      include: { run_items: true }
    });
    assert(
      incompatibleRun.run_items.some(
        (item) => item.error_category === "structured_output_schema_incompatible"
      ),
      "Incompatible schema item should store structured_output_schema_incompatible."
    );
    const incompatibleInspection = await inspectLiveCanaryRun(incompatible.run_public_id);
    assert(!incompatibleInspection.safe_to_resume, "Incompatible schema run should not be resumable.");
    assert(
      incompatibleInspection.fresh_run_recommended,
      "Incompatible schema run should recommend a fresh run."
    );
    assert(
      incompatibleInspection.recommendation === "fix_schema_then_create_fresh_run",
      "Incompatible schema inspection should recommend fixing schema and creating a fresh run."
    );
    await expectReject("resume incompatible schema run", () =>
      runLiveCanary({
        runPublicId: incompatible.run_public_id,
        runInstanceMode: "resume",
        confirmPaidApi: true,
        provider: new MockLlmProvider(),
        allowMockProvider: true
      })
    );

    const summary = await runLiveCanary({
      confirmPaidApi: true,
      runInstanceMode: "new_run",
      provider: new MockLlmProvider(),
      allowMockProvider: true
    });
    assert(summary.run_item_count === 25, "Live canary runner should create 25 run items.");
    assert(summary.status === "completed", "Mock-backed canary run should complete.");
    assert(summary.provider_request_count === 25, "One repetition should make 25 provider requests.");

    const run = await prisma.evalRun.findUniqueOrThrow({
      where: { run_public_id: summary.run_public_id },
      include: { run_items: true }
    });
    assert(run.model_snapshot === "gpt-5.4-mini-2026-03-17", "Run should store exact snapshot.");
    assert(run.reasoning_effort === "low", "Run should store low reasoning effort.");
    assert(run.run_items.length === 25, "Run should have exactly 25 items.");
    assert(run.run_items.every((item) => item.idempotency_key), "Run items should have idempotency keys.");
    const runManifest = run.reproducibility_manifest as Record<string, unknown>;
    assert(runManifest.application_git_commit, "New run should freeze the current Git commit.");
    assert(
      (runManifest.prompt_versions as Record<string, unknown>)?.item_verification_agent === "item-verification-v3",
      "New run should freeze current prompt metadata."
    );
    assert(
      runManifest.semantic_validator_version === "eval-semantic-v2" &&
        runManifest.safety_validator_version === "eval-safety-v2",
      "New run should freeze evaluator versions."
    );

    const oldBaseline = await prisma.evalRun.create({
      data: {
        run_public_id: `evr_smoke_old_${Date.now()}`,
        suite_db_id: run.suite_db_id,
        agent_name: "live_canary",
        provider: "openai",
        model_name: "gpt-5.4-mini-2026-03-17",
        model_config: {
          mock_provider_smoke: true,
          same_manifest_old_prompt_hashes: true
        },
        prompt_version: "multi-agent-canary",
        schema_version: "multi-agent-canary",
        prompt_hash: run.case_manifest_hash ?? "manifest",
        run_mode: "live_provider",
        repetition_count: 1,
        status: "completed",
        planned_run_item_count: 25,
        model_snapshot: "gpt-5.4-mini-2026-03-17",
        reasoning_effort: "low",
        case_manifest_hash: run.case_manifest_hash,
        run_config_hash: "old-prompt-config-hash-for-smoke",
        reproducibility_manifest: {
          application_git_commit: "78c6c6b",
          prompt_versions: {
            item_verification_agent: "item-verification-v2",
            response_collection_agent: "response-collection-v3",
            student_profiling_agent: "student-profiling-v2",
            formative_value_and_planning_agent: "formative-planning-v1",
            followup_agent: "followup-v4"
          },
          prompt_hashes: {
            item_verification_agent: "old-item-verification-hash"
          },
          semantic_validator_version: "eval-semantic-v1",
          safety_validator_version: "eval-safety-v1"
        },
        pricing_registry_version: run.pricing_registry_version,
        budget_limit_usd: 50,
        estimated_cost_usd: 0,
        provider_request_count: 25,
        created_by_user_db_id: teacher.id,
        started_at: new Date(),
        completed_at: new Date()
      }
    });

    await expectReject("resume completed run", () =>
      runLiveCanary({
        runPublicId: run.run_public_id,
        runInstanceMode: "resume",
        confirmPaidApi: true,
        provider: new MockLlmProvider(),
        allowMockProvider: true
      })
    );

    const secondFresh = await runLiveCanary({
      confirmPaidApi: true,
      runInstanceMode: "new_run",
      provider: new MockLlmProvider(),
      allowMockProvider: true
    });
    assert(secondFresh.run_public_id !== run.run_public_id, "--new-run should create a distinct run ID.");
    assert(
      secondFresh.run_public_id !== oldBaseline.run_public_id,
      "Fresh run must not reuse a completed same-manifest run with old prompt hashes."
    );
    assert(
      secondFresh.run_config_hash === summary.run_config_hash,
      "Two fresh runs with unchanged config may share the same config fingerprint."
    );

    const resumable = await runLiveCanary({
      confirmPaidApi: true,
      runInstanceMode: "new_run",
      provider: new MockLlmProvider(),
      allowMockProvider: true,
      compatibilityCheck: (agentName) => {
        if (agentName === "item_verification_agent") {
          return {
            agent_name: agentName,
            prompt_version: "test-incompatible",
            schema_version: "test-incompatible",
            prompt_hash: "test-incompatible",
            compatible: false,
            schema_compiled: false,
            issues: [
              {
                code: "structured_output_schema_incompatible",
                path: "#",
                message: "Synthetic failure before provider dispatch to leave pending resume items."
              }
            ]
          };
        }

        const result = compatibilityByAgent.get(agentName);
        assert(result, `Compatibility result missing for ${agentName}.`);

        return result;
      }
    });
    await prisma.evalRun.update({
      where: { run_public_id: resumable.run_public_id },
      data: { status: "paused", error_message: null }
    });
    await prisma.evalRunItem.updateMany({
      where: {
        run: { run_public_id: resumable.run_public_id },
        execution_status: "failed_permanent",
        error_category: "structured_output_schema_incompatible"
      },
      data: {
        execution_status: "pending",
        error_category: null,
        schema_validation_error: null
      }
    });
    const resumableBefore = await prisma.evalRun.findUniqueOrThrow({
      where: { run_public_id: resumable.run_public_id },
      select: { provider_request_count: true }
    });
    const resumed = await runLiveCanary({
      runPublicId: resumable.run_public_id,
      runInstanceMode: "resume",
      confirmPaidApi: true,
      provider: new MockLlmProvider(),
      allowMockProvider: true
    });
    assert(resumed.status === "completed", "Explicit resume should complete the matching nonterminal run.");
    assert(
      resumed.provider_request_count > resumableBefore.provider_request_count,
      "Explicit resume should process pending items on the specified run."
    );

    const mismatch = await runLiveCanary({
      confirmPaidApi: true,
      runInstanceMode: "new_run",
      provider: new MockLlmProvider(),
      allowMockProvider: true,
      compatibilityCheck: (agentName) => {
        if (agentName === "item_verification_agent") {
          return {
            agent_name: agentName,
            prompt_version: "test-incompatible",
            schema_version: "test-incompatible",
            prompt_hash: "test-incompatible",
            compatible: false,
            schema_compiled: false,
            issues: [
              {
                code: "structured_output_schema_incompatible",
                path: "#",
                message: "Synthetic failure before provider dispatch to test config mismatch."
              }
            ]
          };
        }

        const result = compatibilityByAgent.get(agentName);
        assert(result, `Compatibility result missing for ${agentName}.`);

        return result;
      }
    });
    await prisma.evalRun.update({
      where: { run_public_id: mismatch.run_public_id },
      data: { status: "paused", run_config_hash: "mismatched-config-hash-for-smoke" }
    });
    await expectReject("resume config mismatch", () =>
      runLiveCanary({
        runPublicId: mismatch.run_public_id,
        runInstanceMode: "resume",
        confirmPaidApi: true,
        provider: new MockLlmProvider(),
        allowMockProvider: true
      })
    );

    await withCanaryEnv({ EVAL_MAX_PROVIDER_REQUESTS: "1" }, async () => {
      const blocked = await runLiveCanary({
        confirmPaidApi: true,
        runInstanceMode: "new_run",
        provider: new MockLlmProvider(),
        allowMockProvider: true
      });
      assert(blocked.status === "failed", "Request-count limit should block execution.");
      assert(blocked.provider_request_count === 0, "Budget/request guard should block before provider calls.");
    });

    const after = await operationalCounts(prisma);
    assert(after.agentCalls === before.agentCalls, "Eval runner created operational agent calls.");
    assert(after.studentProfiles === before.studentProfiles, "Eval runner created profiles.");
    assert(after.formativeDecisions === before.formativeDecisions, "Eval runner created decisions.");
    assert(after.followupRounds === before.followupRounds, "Eval runner created follow-up rounds.");
    assert(after.itemVerificationRuns === before.itemVerificationRuns, "Eval runner created item verification runs.");
    assert(after.workflowJobs === before.workflowJobs, "Eval runner created workflow jobs.");
    assert(after.assessmentSessions === before.assessmentSessions, "Eval runner changed assessment sessions.");
    assert(after.itemResponses === before.itemResponses, "Eval runner changed item responses.");

    assert(teacher.id, "Teacher fixture should remain available.");
  });

  await cleanupLiveCanaryRecords(prisma);
  await cleanupEvalFixtures();

  console.log("Live canary runner smoke test passed.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanupLiveCanaryRecords(prisma).catch(() => undefined);
    await cleanupEvalFixtures().catch(() => undefined);
    await prisma.$disconnect();
  });
