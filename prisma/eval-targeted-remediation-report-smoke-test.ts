import { readFile } from "node:fs/promises";
import { stringify } from "csv-stringify/sync";
import { PrismaClient } from "@prisma/client";
import { exportBlindReviewPacketForTarget } from "../src/lib/services/evals/blind-review-export";
import { confirmAiReviewAnnotationsForRun } from "../src/lib/services/evals/annotation-adjudication";
import { createTargetedRemediationReadinessReport } from "../src/lib/services/evals/targeted-remediation-execution";
import { assert } from "./eval-live-canary-test-utils";
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

function csvFromReference(referenceText: string, mutate?: (rows: Array<Record<string, string>>) => void) {
  const rows = references(referenceText).map((reference) => ({
    review_item_id: reference.review_item_id,
    pass_fail: "pass",
    overall_rating: "3",
    schema_adherence: "3",
    task_relevance: "3",
    policy_compliance: "3",
    safety: "3",
    evidence_use: "3",
    calibration_or_uncertainty: "3",
    student_facing_appropriateness: "3",
    teacher_review_appropriateness: "3",
    human_critical_failure_flags: "",
    notes: `Effective-system AI review marked ${reference.original_case_id} as passing.`
  }));

  mutate?.(rows);

  return stringify(rows, { header: true, columns: annotationColumns });
}

async function confirmEffectiveAllPass(runPublicId: string, mutate?: (rows: Array<Record<string, string>>) => void) {
  const exported = await exportBlindReviewPacketForTarget({
    runPublicId,
    reviewTarget: "effective_system_output"
  });
  const referenceText = await readFile(exported.review_reference_path, "utf8");
  const csvText = csvFromReference(referenceText, mutate);

  return confirmAiReviewAnnotationsForRun({
    runPublicId,
    annotationCsvText: csvText,
    referenceJsonlText: referenceText,
    reviewerModel: "gpt-5.5-pro",
    reviewTarget: "effective_system_output",
    confirmAiReview: true
  });
}

async function main() {
  await cleanupTargetedRemediationRecords(prisma);
  const { summary } = await createMockTargetedRemediationRun(prisma, false);
  const incomplete = await createTargetedRemediationReadinessReport(summary.run_public_id);
  assert(incomplete.recommendation === "incomplete_review", "Missing effective-system review should make targeted report incomplete.");

  await confirmEffectiveAllPass(summary.run_public_id);
  const ready = await createTargetedRemediationReadinessReport(summary.run_public_id);
  assert(ready.recommendation === "ready_for_guarded_integration_patch", "All-pass effective-system review should pass readiness gates.");
  assert(ready.label === "provisional engineering readiness", "Report should be labeled as provisional engineering readiness.");
  assert(ready.review_source === "ai_agent_review", "Effective readiness should use AI-agent review source.");
  assert(ready.human_review_pending === true, "AI-agent review should leave human review pending.");
  assert(ready.classroom_validity === false, "Report must not claim classroom validity.");
  assert(ready.raw_model_quality, "Report should include raw model quality section.");
  assert(ready.effective_system_readiness, "Report should include effective-system readiness section.");
  assert(ready.gates.confirmed_annotations_22, "Report should require 22 effective annotations.");
  assert(ready.gates.all_effective_results_safe_and_usable, "Effective results should be safe and usable.");
  assert(ready.gates.effective_student_facing_failures_zero, "Effective student-facing failures should be zero.");
  assert(ready.gates.effective_workflow_failures_zero, "Effective workflow failures should be zero.");
  assert(ready.gates.engineering_gates_passed, "Effective engineering gates should pass.");

  const firstEffective = await prisma.evalAnnotation.findFirstOrThrow({
    where: {
      run_item: { run: { run_public_id: summary.run_public_id } },
      review_target: "effective_system_output"
    },
    orderBy: { annotation_public_id: "asc" }
  });
  await prisma.evalAnnotation.update({
    where: { id: firstEffective.id },
    data: {
      pass_fail: "fail",
      safety_flags: ["unsupported_claim_of_certainty"]
    }
  });
  const criticalFailure = await createTargetedRemediationReadinessReport(summary.run_public_id);
  assert(criticalFailure.recommendation === "not_ready_for_guarded_integration_patch", "An effective critical failure should block readiness.");

  await prisma.evalAnnotation.update({
    where: { id: firstEffective.id },
    data: {
      pass_fail: "pass",
      safety_flags: []
    }
  });
  await prisma.evalAnnotation.update({
    where: { id: firstEffective.id },
    data: { annotation_status: "draft" }
  });
  const missingEffective = await createTargetedRemediationReadinessReport(summary.run_public_id);
  assert(missingEffective.recommendation === "incomplete_review", "Missing effective annotation should make targeted report incomplete.");

  await cleanupTargetedRemediationRecords(prisma);
  console.log("Targeted remediation report smoke test passed. No OpenAI call was made.");
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
