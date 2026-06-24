import { PrismaClient } from "@prisma/client";
import { rm } from "node:fs/promises";
import path from "node:path";
import { MockLlmProvider } from "../src/lib/llm/providers/mock-provider";
import { runTargetedRemediation } from "../src/lib/services/evals/targeted-remediation-execution";
import { ensureTeacherReviewDemoUsers } from "./demo-teacher-review-fixture";
import { generatePublicId } from "../src/lib/services/ids";
import { operationalCounts, withCanaryEnv } from "./eval-live-canary-test-utils";

export const targetedRemediationSmokeEnv = {
  EVAL_PROVIDER: "openai",
  EVAL_LIVE_CALLS_ENABLED: "true",
  EVAL_TARGET_MODEL: "gpt-5.4-mini-2026-03-17",
  EVAL_REASONING_EFFORT: "low",
  EVAL_TARGETED_REMEDIATION_COST_HARD_LIMIT_USD: "10",
  EVAL_TARGETED_REMEDIATION_MAX_PROVIDER_REQUESTS: "35",
  EVAL_TARGETED_REMEDIATION_MAX_CONCURRENCY: "1",
  EVAL_TARGETED_REMEDIATION_MAX_RETRIES: "1",
  EVAL_TARGETED_REMEDIATION_REQUEST_TIMEOUT_MS: "60000",
  LLM_PROVIDER: "mock",
  LLM_LIVE_CALLS_ENABLED: "false",
  OPENAI_API_KEY: "fake-smoke-key-never-sent"
};

export async function cleanupTargetedRemediationRecords(prisma: PrismaClient) {
  const runs = await prisma.evalRun.findMany({
    where: {
      evaluation_phase: "targeted_remediation",
      model_config: {
        path: ["mock_provider_smoke"],
        equals: true
      }
    },
    select: { id: true, run_public_id: true }
  });
  const runIds = runs.map((run) => run.id);
  const runItemIds = (
    await prisma.evalRunItem.findMany({
      where: { run_db_id: { in: runIds } },
      select: { id: true }
    })
  ).map((item) => item.id);

  await prisma.evalAnnotationRevision.deleteMany({
    where: {
      OR: [
        { run_item_db_id: { in: runItemIds } },
        { annotation: { run_item_db_id: { in: runItemIds } } }
      ]
    }
  });
  await prisma.evalAnnotation.deleteMany({
    where: {
      OR: [
        { run_item_db_id: { in: runItemIds } },
        { run_item: { run_db_id: { in: runIds } } }
      ]
    }
  });
  await prisma.evalRunItem.deleteMany({ where: { run_db_id: { in: runIds } } });
  await prisma.evalRun.deleteMany({ where: { id: { in: runIds } } });
  await prisma.evalSuite.deleteMany({
    where: {
      title: "Phase 7E2C targeted remediation",
      runs: { none: {} }
    }
  });

  for (const run of runs) {
    await rm(path.join(process.cwd(), ".data", "eval-review", run.run_public_id), {
      recursive: true,
      force: true
    });
  }
}

export async function createMockTargetedRemediationRun(prisma: PrismaClient, annotate = false) {
  await ensureTeacherReviewDemoUsers(prisma);

  return withCanaryEnv(targetedRemediationSmokeEnv, async () => {
    const before = await operationalCounts(prisma);
    const summary = await runTargetedRemediation({
      confirmPaidApi: true,
      runInstanceMode: "new_run",
      provider: new MockLlmProvider(),
      allowMockProvider: true
    });
    const after = await operationalCounts(prisma);

    if (annotate) {
      const run = await prisma.evalRun.findUniqueOrThrow({
        where: { run_public_id: summary.run_public_id },
        include: {
          created_by: { select: { id: true } },
          run_items: { select: { id: true } }
        }
      });

      for (const item of run.run_items) {
        await prisma.evalAnnotation.upsert({
          where: {
            run_item_db_id_annotated_by_user_db_id_review_target: {
              run_item_db_id: item.id,
              annotated_by_user_db_id: run.created_by.id,
              review_target: "raw_model_output"
            }
          },
          create: {
            annotation_public_id: generatePublicId("eval_annotation"),
            run_item_db_id: item.id,
            annotated_by_user_db_id: run.created_by.id,
            confirmed_by_user_db_id: run.created_by.id,
            blind_review: true,
            annotation_source: "human_manual",
            annotation_status: "confirmed",
            review_target: "raw_model_output",
            overall_rating: 3,
            pass_fail: "pass",
            rubric_scores: {
              schema_adherence: 3,
              task_relevance: 3,
              policy_compliance: 3,
              safety: 3,
              evidence_use: 3,
              calibration_or_uncertainty: 3,
              student_facing_appropriateness: 3,
              teacher_review_appropriateness: 3
            },
            safety_flags: [],
            notes: "Synthetic targeted-remediation smoke-test confirmed pass.",
            confirmed_at: new Date()
          },
          update: {
            confirmed_by_user_db_id: run.created_by.id,
            annotation_source: "human_manual",
            annotation_status: "confirmed",
            review_target: "raw_model_output",
            overall_rating: 3,
            pass_fail: "pass",
            rubric_scores: {
              schema_adherence: 3,
              task_relevance: 3,
              policy_compliance: 3,
              safety: 3,
              evidence_use: 3,
              calibration_or_uncertainty: 3,
              student_facing_appropriateness: 3,
              teacher_review_appropriateness: 3
            },
            safety_flags: [],
            notes: "Synthetic targeted-remediation smoke-test confirmed pass.",
            confirmed_at: new Date()
          }
        });
      }
    }

    return {
      summary,
      before,
      after
    };
  });
}
