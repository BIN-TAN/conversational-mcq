import { readFile } from "node:fs/promises";
import { stringify } from "csv-stringify/sync";
import { PrismaClient } from "@prisma/client";
import { exportBlindReviewPacketForTarget } from "../src/lib/services/evals/blind-review-export";
import { confirmAiReviewAnnotationsForRun } from "../src/lib/services/evals/annotation-adjudication";
import { assert, operationalCounts } from "./eval-live-canary-test-utils";
import {
  cleanupTargetedRemediationRecords,
  createMockTargetedRemediationRun
} from "./eval-targeted-remediation-test-utils";

const prisma = new PrismaClient();
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

type ReferenceRecord = {
  review_item_id: string;
  original_case_id: string;
};

function references(text: string) {
  return text.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as ReferenceRecord);
}

function annotationCsv(referenceText: string, failFirstTwo: boolean) {
  return stringify(
    references(referenceText).map((reference, index) => {
      const fail = failFirstTwo && index < 2;
      const score = fail ? "1" : "3";

      return {
        review_item_id: reference.review_item_id,
        pass_fail: fail ? "fail" : "pass",
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
        notes: fail
          ? `Raw-output AI review marked ${reference.original_case_id} as failing without critical flags.`
          : "AI review marked this output as passing."
      };
    }),
    { header: true, columns: annotationColumns }
  );
}

async function main() {
  await cleanupTargetedRemediationRecords(prisma);
  const { summary, before } = await createMockTargetedRemediationRun(prisma, false);
  const rawExport = await exportBlindReviewPacketForTarget({
    runPublicId: summary.run_public_id,
    reviewTarget: "raw_model_output"
  });
  const effectiveExport = await exportBlindReviewPacketForTarget({
    runPublicId: summary.run_public_id,
    reviewTarget: "effective_system_output"
  });
  const rawReference = await readFile(rawExport.review_reference_path, "utf8");
  const effectiveReference = await readFile(effectiveExport.review_reference_path, "utf8");
  const rawCsv = annotationCsv(rawReference, true);
  const effectiveCsv = annotationCsv(effectiveReference, false);

  const rawResult = await confirmAiReviewAnnotationsForRun({
    runPublicId: summary.run_public_id,
    annotationCsvText: rawCsv,
    referenceJsonlText: rawReference,
    reviewerModel: "gpt-5.5-pro",
    reviewTarget: "raw_model_output",
    confirmAiReview: true
  });
  const effectiveResult = await confirmAiReviewAnnotationsForRun({
    runPublicId: summary.run_public_id,
    annotationCsvText: effectiveCsv,
    referenceJsonlText: effectiveReference,
    reviewerModel: "gpt-5.5-pro",
    reviewTarget: "effective_system_output",
    confirmAiReview: true
  });

  assert(rawResult.ai_fail_count === 2, "Raw-output AI review should preserve raw failures.");
  assert(effectiveResult.ai_fail_count === 0, "Effective-system AI review should accept independent pass/fail distribution.");
  assert(effectiveResult.imported_as.review_target === "effective_system_output", "Effective review target should be stored.");

  const annotations = await prisma.evalAnnotation.findMany({
    where: { run_item: { run: { run_public_id: summary.run_public_id } } },
    orderBy: [{ review_target: "asc" }, { annotation_public_id: "asc" }]
  });
  assert(annotations.length === 44, "Raw and effective reviews should coexist as separate annotations.");
  assert(annotations.filter((annotation) => annotation.review_target === "raw_model_output").length === 22, "Raw review should have 22 annotations.");
  assert(annotations.filter((annotation) => annotation.review_target === "effective_system_output").length === 22, "Effective review should have 22 annotations.");
  assert(
    annotations.filter((annotation) => annotation.review_target === "raw_model_output" && annotation.pass_fail === "fail").length === 2,
    "Raw failures should remain visible."
  );
  assert(
    annotations.filter((annotation) => annotation.review_target === "effective_system_output" && annotation.pass_fail === "pass").length === 22,
    "Effective annotations should be independent from raw annotations."
  );

  const repeated = await confirmAiReviewAnnotationsForRun({
    runPublicId: summary.run_public_id,
    annotationCsvText: effectiveCsv,
    referenceJsonlText: effectiveReference,
    reviewerModel: "gpt-5.5-pro",
    reviewTarget: "effective_system_output",
    confirmAiReview: true
  });
  assert(repeated.ai_confirmed_idempotent_count === 22, "Repeated effective confirmation should be idempotent.");

  const after = await operationalCounts(prisma);
  assert(after.agentCalls === before.agentCalls, "Effective annotation smoke created operational agent calls.");
  assert(after.studentProfiles === before.studentProfiles, "Effective annotation smoke created operational profiles.");
  assert(after.formativeDecisions === before.formativeDecisions, "Effective annotation smoke created operational decisions.");
  assert(after.followupRounds === before.followupRounds, "Effective annotation smoke created operational follow-up rounds.");
  assert(after.workflowJobs === before.workflowJobs, "Effective annotation smoke created workflow jobs.");

  await cleanupTargetedRemediationRecords(prisma);
  console.log("Effective-system annotation smoke test passed. No OpenAI call was made.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanupTargetedRemediationRecords(prisma).catch(() => undefined);
    await prisma.$disconnect();
  });
