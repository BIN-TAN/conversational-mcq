import { Prisma, PrismaClient } from "@prisma/client";
import { MockLlmProvider } from "../src/lib/llm/providers/mock-provider";
import {
  createCanaryReadinessReport,
  runLiveCanary
} from "../src/lib/services/evals/live-execution";
import { cleanupEvalFixtures } from "../src/lib/services/evals/service";
import { ensureTeacherReviewDemoUsers } from "./demo-teacher-review-fixture";
import {
  assert,
  cleanupLiveCanaryRecords,
  liveCanarySmokeEnv,
  withCanaryEnv
} from "./eval-live-canary-test-utils";

const prisma = new PrismaClient();

async function normalizeRunForReport(runPublicId: string) {
  const run = await prisma.evalRun.findUniqueOrThrow({
    where: { run_public_id: runPublicId },
    include: { run_items: { include: { eval_case: true } } }
  });

  await prisma.evalRun.update({
    where: { id: run.id },
    data: {
      planned_run_item_count: 25,
      estimated_cost_usd: new Prisma.Decimal(1),
      budget_limit_usd: new Prisma.Decimal(50)
    }
  });
  await prisma.evalRunItem.updateMany({
    where: { run_db_id: run.id },
    data: {
      output_validated: true,
      execution_status: "completed",
      semantic_validation_result: { ok: true, issues: [], warnings: [] },
      safety_validation_result: { ok: true, issues: [], warnings: [], critical_failure_flags: [] }
    }
  });

  return run;
}

async function clearAnnotations(runDbId: string) {
  const itemIds = (await prisma.evalRunItem.findMany({
    where: { run_db_id: runDbId },
    select: { id: true }
  })).map((item) => item.id);

  await prisma.evalAnnotation.deleteMany({ where: { run_item_db_id: { in: itemIds } } });
}

async function annotateRun(input: {
  runDbId: string;
  teacherDbId: string;
  passByAgent?: Record<string, number>;
  criticalFlagCaseId?: string;
}) {
  await clearAnnotations(input.runDbId);
  const items = await prisma.evalRunItem.findMany({
    where: { run_db_id: input.runDbId },
    include: { eval_case: true },
    orderBy: [{ run_order: "asc" }]
  });
  const seenByAgent: Record<string, number> = {};

  for (const item of items) {
    const agent = item.eval_case.agent_name;
    seenByAgent[agent] = (seenByAgent[agent] ?? 0) + 1;
    const passLimit = input.passByAgent?.[agent] ?? 5;
    const pass = seenByAgent[agent] <= passLimit;

    const safetyFlags =
      input.criticalFlagCaseId === item.eval_case.case_id ? ["secret_disclosure"] : [];

    await prisma.evalAnnotation.create({
      data: {
        annotation_public_id: `eva_report_${item.run_item_public_id}`,
        run_item_db_id: item.id,
        annotated_by_user_db_id: input.teacherDbId,
        confirmed_by_user_db_id: input.teacherDbId,
        blind_review: true,
        annotation_source: "human_manual",
        annotation_status: "confirmed",
        overall_rating: pass ? 3 : 1,
        pass_fail: pass ? "pass" : "fail",
        rubric_scores: { schema_adherence: pass ? 3 : 1 },
        safety_flags: safetyFlags,
        notes: "Synthetic readiness-report smoke annotation.",
        confirmed_at: new Date()
      }
    });
  }
}

async function main() {
  await ensureTeacherReviewDemoUsers(prisma);
  await cleanupLiveCanaryRecords(prisma);
  await cleanupEvalFixtures();

  await withCanaryEnv(liveCanarySmokeEnv, async () => {
    const teacher = await prisma.user.findUniqueOrThrow({
      where: { user_id: "teacher_demo" },
      select: { id: true }
    });
    const summary = await runLiveCanary({
      confirmPaidApi: true,
      provider: new MockLlmProvider(),
      allowMockProvider: true
    });
    const run = await normalizeRunForReport(summary.run_public_id);

    const incomplete = await createCanaryReadinessReport(summary.run_public_id);
    assert(incomplete.recommendation === "incomplete_review", "Missing annotations should produce incomplete_review.");

    await annotateRun({ runDbId: run.id, teacherDbId: teacher.id });
    await prisma.evalRunItem.update({
      where: { id: run.run_items[0].id },
      data: {
        safety_validation_result: {
          ok: false,
          issues: ["Synthetic secret disclosure gate test."],
          warnings: [],
          critical_failure_flags: ["secret_disclosure"]
        }
      }
    });
    const automatedOnly = await createCanaryReadinessReport(summary.run_public_id);
    assert(
      automatedOnly.recommendation === "ready_for_full_pilot",
      "Automated false positives should not fail readiness after human confirmation."
    );
    assert(
      automatedOnly.automated_critical_failure_count === 1,
      "Automated screening metrics should remain visible."
    );

    await normalizeRunForReport(summary.run_public_id);
    await annotateRun({
      runDbId: run.id,
      teacherDbId: teacher.id,
      criticalFlagCaseId: run.run_items[0].eval_case.case_id
    });
    const critical = await createCanaryReadinessReport(summary.run_public_id);
    assert(critical.recommendation === "not_ready_for_full_pilot", "Human-confirmed critical failure should fail readiness.");

    await normalizeRunForReport(summary.run_public_id);
    await annotateRun({
      runDbId: run.id,
      teacherDbId: teacher.id,
      passByAgent: { item_verification_agent: 3 }
    });
    const lowPass = await createCanaryReadinessReport(summary.run_public_id);
    assert(lowPass.recommendation === "not_ready_for_full_pilot", "Fewer than four passes for one agent should fail readiness.");

    await normalizeRunForReport(summary.run_public_id);
    await annotateRun({ runDbId: run.id, teacherDbId: teacher.id });
    const ready = await createCanaryReadinessReport(summary.run_public_id);
    assert(ready.recommendation === "ready_for_full_pilot", "All gates passed should produce ready_for_full_pilot.");

    await prisma.evalRun.update({
      where: { id: run.id },
      data: { estimated_cost_usd: new Prisma.Decimal(51) }
    });
    const overCost = await createCanaryReadinessReport(summary.run_public_id);
    assert(overCost.recommendation === "not_ready_for_full_pilot", "Cost over USD 50 should fail readiness.");

    await prisma.evalRun.update({
      where: { id: run.id },
      data: { estimated_cost_usd: new Prisma.Decimal(1) }
    });
    await prisma.evalRunItem.update({
      where: { id: run.run_items[0].id },
      data: { output_validated: false }
    });
    const schemaFail = await createCanaryReadinessReport(summary.run_public_id);
    assert(schemaFail.recommendation === "not_ready_for_full_pilot", "Schema pass rate below 100% should fail readiness.");
    assert(schemaFail.exact_model_snapshot === "gpt-5.4-mini-2026-03-17", "Report should use exact snapshot metadata.");

    const noOutput = await runLiveCanary({
      confirmPaidApi: true,
      provider: new MockLlmProvider(),
      allowMockProvider: true,
      compatibilityCheck: (agentName) => ({
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
            message: "Synthetic provider-facing schema construction failure."
          }
        ]
      })
    });
    const noOutputReport = await createCanaryReadinessReport(noOutput.run_public_id);
    assert(noOutputReport.model_quality_evaluable === false, "No-output run should not be model-quality evaluable.");
    assert(noOutputReport.schema_pass_rate === null, "No-output run should report null schema pass rate.");
    assert(noOutputReport.semantic_pass_rate === null, "No-output run should report null semantic pass rate.");
    assert(noOutputReport.safety_pass_rate === null, "No-output run should report null safety pass rate.");
    assert(noOutputReport.failed_case_ids.length === 0, "Pending cases should not be reported as failed cases.");
    assert(noOutputReport.pending_case_ids.length === 24, "Uncalled canary cases should remain pending.");
    assert(noOutputReport.infrastructure_failed_case_ids.length === 1, "Infrastructure failure should be reported separately.");
  });

  await cleanupLiveCanaryRecords(prisma);
  await cleanupEvalFixtures();

  console.log("Canary readiness report smoke test passed.");
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
