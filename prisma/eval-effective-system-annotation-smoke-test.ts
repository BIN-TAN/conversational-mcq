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
  effective_result_version?: string | null;
};

function references(text: string) {
  return text.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as ReferenceRecord);
}

function annotationCsv(referenceText: string, failFirstTwo: boolean, label: string) {
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
          ? `${label} AI review marked ${reference.original_case_id} as failing without critical flags.`
          : `${label} AI review marked this output as passing.`
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
    reviewTarget: "effective_system_output",
    effectiveResultVersion: "effective-system-eval-v1"
  });
  const effectiveV2Export = await exportBlindReviewPacketForTarget({
    runPublicId: summary.run_public_id,
    reviewTarget: "effective_system_output",
    effectiveResultVersion: "effective-system-eval-v2"
  });
  const rawReference = await readFile(rawExport.review_reference_path, "utf8");
  const effectiveReference = await readFile(effectiveExport.review_reference_path, "utf8");
  const effectiveV2Reference = await readFile(effectiveV2Export.review_reference_path, "utf8");
  const rawCsv = annotationCsv(rawReference, true, "Raw-output");
  const effectiveCsv = annotationCsv(effectiveReference, true, "Effective-system v1");
  const effectiveV2Csv = annotationCsv(effectiveV2Reference, false, "Effective-system v2");

  const rawResult = await confirmAiReviewAnnotationsForRun({
    runPublicId: summary.run_public_id,
    annotationCsvText: rawCsv,
    referenceJsonlText: rawReference,
    reviewerModel: "gpt-5.5-pro",
    reviewTarget: "raw_model_output",
    reviewArtifactVersion: "raw-model-output",
    confirmAiReview: true
  });
  const effectiveResult = await confirmAiReviewAnnotationsForRun({
    runPublicId: summary.run_public_id,
    annotationCsvText: effectiveCsv,
    referenceJsonlText: effectiveReference,
    reviewerModel: "gpt-5.5-pro",
    reviewTarget: "effective_system_output",
    reviewArtifactVersion: "effective-system-eval-v1",
    confirmAiReview: true
  });
  const effectiveV2Result = await confirmAiReviewAnnotationsForRun({
    runPublicId: summary.run_public_id,
    annotationCsvText: effectiveV2Csv,
    referenceJsonlText: effectiveV2Reference,
    reviewerModel: "gpt-5.5-pro",
    reviewTarget: "effective_system_output",
    reviewArtifactVersion: "effective-system-eval-v2",
    confirmAiReview: true
  });

  assert(rawResult.ai_fail_count === 2, "Raw-output AI review should preserve raw failures.");
  assert(effectiveResult.ai_fail_count === 2, "Effective-system v1 AI review should preserve v1 failures.");
  assert(effectiveV2Result.ai_fail_count === 0, "Effective-system v2 AI review should accept independent pass/fail distribution.");
  assert(effectiveResult.imported_as.review_target === "effective_system_output", "Effective review target should be stored.");
  assert(effectiveResult.imported_as.review_artifact_version === "effective-system-eval-v1", "Effective v1 review artifact version should be stored.");
  assert(effectiveV2Result.imported_as.review_artifact_version === "effective-system-eval-v2", "Effective v2 review artifact version should be stored.");

  const annotations = await prisma.evalAnnotation.findMany({
    where: { run_item: { run: { run_public_id: summary.run_public_id } } },
    orderBy: [{ review_target: "asc" }, { review_artifact_version: "asc" }, { annotation_public_id: "asc" }]
  });
  assert(annotations.length === 66, "Raw, effective v1, and effective v2 reviews should coexist as separate annotations.");
  assert(annotations.filter((annotation) => annotation.review_target === "raw_model_output").length === 22, "Raw review should have 22 annotations.");
  assert(annotations.filter((annotation) => annotation.review_target === "effective_system_output").length === 44, "Effective reviews should have 44 annotations across v1 and v2.");
  assert(
    annotations.filter((annotation) => annotation.review_target === "raw_model_output" && annotation.pass_fail === "fail").length === 2,
    "Raw failures should remain visible."
  );
  assert(
    annotations.filter((annotation) =>
      annotation.review_target === "effective_system_output" &&
      annotation.review_artifact_version === "effective-system-eval-v1" &&
      annotation.pass_fail === "fail"
    ).length === 2,
    "Effective v1 failures should remain visible."
  );
  assert(
    annotations.filter((annotation) =>
      annotation.review_target === "effective_system_output" &&
      annotation.review_artifact_version === "effective-system-eval-v2" &&
      annotation.pass_fail === "pass"
    ).length === 22,
    "Effective v2 annotations should all pass independently from v1."
  );

  const repeated = await confirmAiReviewAnnotationsForRun({
    runPublicId: summary.run_public_id,
    annotationCsvText: effectiveV2Csv,
    referenceJsonlText: effectiveV2Reference,
    reviewerModel: "gpt-5.5-pro",
    reviewTarget: "effective_system_output",
    reviewArtifactVersion: "effective-system-eval-v2",
    confirmAiReview: true
  });
  assert(repeated.ai_confirmed_idempotent_count === 22, "Repeated effective confirmation should be idempotent.");
  await confirmAiReviewAnnotationsForRun({
    runPublicId: summary.run_public_id,
    annotationCsvText: effectiveV2Csv,
    referenceJsonlText: effectiveV2Reference,
    reviewerModel: "gpt-5.5-pro",
    reviewTarget: "effective_system_output",
    reviewArtifactVersion: "effective-system-eval-v1",
    confirmAiReview: true
  }).then(
    () => {
      throw new Error("Mismatched requested artifact version should have failed.");
    },
    (error) => {
      assert(
        error instanceof Error && error.message.includes("Reference file artifact version does not match"),
        "Mismatched requested artifact version should be rejected."
      );
    }
  );

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
