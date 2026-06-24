import { Prisma, PrismaClient } from "@prisma/client";
import { MockLlmProvider } from "../src/lib/llm/providers/mock-provider";
import { createCanaryReadinessReport, runLiveCanary } from "../src/lib/services/evals/live-execution";
import { runLivePilot } from "../src/lib/services/evals/pilot-execution";
import { cleanupEvalFixtures } from "../src/lib/services/evals/service";
import { generatePublicId } from "../src/lib/services/ids";
import { ensureTeacherReviewDemoUsers } from "./demo-teacher-review-fixture";
import {
  cleanupLiveCanaryRecords,
  liveCanarySmokeEnv,
  livePilotSmokeEnv,
  withCanaryEnv
} from "./eval-live-canary-test-utils";

export async function addConfirmedPassAnnotations(prisma: PrismaClient, runPublicId: string) {
  const run = await prisma.evalRun.findUniqueOrThrow({
    where: { run_public_id: runPublicId },
    include: {
      created_by: { select: { id: true } },
      run_items: { select: { id: true } }
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
        notes: "Synthetic smoke-test confirmed pass.",
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
        notes: "Synthetic smoke-test confirmed pass.",
        confirmed_at: new Date()
      }
    });
  }
}

export async function createApprovedMockCanaryRun(prisma: PrismaClient) {
  await ensureTeacherReviewDemoUsers(prisma);
  await cleanupLiveCanaryRecords(prisma);
  await cleanupEvalFixtures();

  return withCanaryEnv(liveCanarySmokeEnv, async () => {
    const summary = await runLiveCanary({
      confirmPaidApi: true,
      runInstanceMode: "new_run",
      provider: new MockLlmProvider(),
      allowMockProvider: true
    });

    await prisma.evalRun.update({
      where: { run_public_id: summary.run_public_id },
      data: {
        planned_run_item_count: 25,
        estimated_cost_usd: new Prisma.Decimal(1),
        budget_limit_usd: new Prisma.Decimal(50)
      }
    });
    await addConfirmedPassAnnotations(prisma, summary.run_public_id);
    const report = await createCanaryReadinessReport(summary.run_public_id);

    if (report.recommendation !== "ready_for_full_pilot") {
      throw new Error(`Mock canary fixture was not approved: ${report.recommendation}`);
    }

    return summary.run_public_id;
  });
}

export async function createMockPilotRun(prisma: PrismaClient) {
  const approvedCanaryRunPublicId = await createApprovedMockCanaryRun(prisma);

  return withCanaryEnv(
    {
      ...livePilotSmokeEnv,
      EVAL_PILOT_APPROVED_CANARY_RUN_ID: approvedCanaryRunPublicId
    },
    async () => {
      const summary = await runLivePilot({
        approvedCanaryRunPublicId,
        confirmPaidApi: true,
        runInstanceMode: "new_run",
        provider: new MockLlmProvider(),
        allowMockProvider: true
      });

      await addConfirmedPassAnnotations(prisma, summary.run_public_id);

      return {
        approvedCanaryRunPublicId,
        pilotRunPublicId: summary.run_public_id,
        summary
      };
    }
  );
}
