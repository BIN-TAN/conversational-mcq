import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { stringify } from "csv-stringify/sync";
import { Prisma, PrismaClient } from "@prisma/client";
import { MockLlmProvider } from "../src/lib/llm/providers/mock-provider";
import { exportBlindReviewPacket } from "../src/lib/services/evals/blind-review-export";
import { runLiveCanary } from "../src/lib/services/evals/live-execution";
import { cleanupEvalFixtures } from "../src/lib/services/evals/service";
import { ensureTeacherReviewDemoUsers } from "./demo-teacher-review-fixture";
import {
  cleanupLiveCanaryRecords,
  liveCanarySmokeEnv,
  withCanaryEnv
} from "./eval-live-canary-test-utils";

export const expectedFailedCaseIds = new Set([
  "iva_duplicate_items_010",
  "spa_conflicting_evidence_010",
  "fua_off_topic_redirect_007"
]);

const annotationColumns = [
  "review_item_id",
  "pass_fail",
  "overall_rating",
  "schema_adherence",
  "task_relevance",
  "policy_compliance",
  "safety",
  "evidence_use",
  "calibration_or_uncertainty",
  "student_facing_appropriateness",
  "teacher_review_appropriateness",
  "human_critical_failure_flags",
  "notes"
];

function parseJsonl(text: string) {
  return text
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { review_item_id: string; original_case_id: string });
}

export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

export async function createMockCanaryRunForAnnotationSmoke(prisma: PrismaClient) {
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
    const run = await prisma.evalRun.findUniqueOrThrow({
      where: { run_public_id: summary.run_public_id },
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

    return summary.run_public_id;
  });
}

export async function buildCompletedAnnotationCsv(input: {
  runPublicId: string;
  mutate?: (rows: Array<Record<string, string>>) => void;
}) {
  const exportResult = await exportBlindReviewPacket(input.runPublicId);
  const referenceText = await readFile(exportResult.review_reference_path, "utf8");
  const references = parseJsonl(referenceText);
  const rows = references.map((reference) => {
    const failed = expectedFailedCaseIds.has(reference.original_case_id);
    const score = failed ? "1" : "3";

    return {
      review_item_id: reference.review_item_id,
      pass_fail: failed ? "fail" : "pass",
      overall_rating: score,
      schema_adherence: "3",
      task_relevance: score,
      policy_compliance: "3",
      safety: "3",
      evidence_use: score,
      calibration_or_uncertainty: score,
      student_facing_appropriateness: "3",
      teacher_review_appropriateness: "3",
      human_critical_failure_flags: "",
      notes: failed
        ? `Human reviewer marked ${reference.original_case_id} as failing without a critical flag.`
        : "Human reviewer marked this case as passing."
    };
  });

  input.mutate?.(rows);

  const csv = stringify(rows, { header: true, columns: annotationColumns });
  const outputPath = path.join(exportResult.output_dir, `completed_annotations_${Date.now()}.csv`);

  await writeFile(outputPath, csv, "utf8");

  return {
    ...exportResult,
    reference_text: referenceText,
    annotation_csv_text: csv,
    annotation_csv_path: outputPath,
    rows
  };
}
