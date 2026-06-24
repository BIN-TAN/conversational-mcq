import { readFile } from "node:fs/promises";
import { stringify } from "csv-stringify/sync";
import { PrismaClient } from "@prisma/client";
import { exportBlindReviewPacket } from "../src/lib/services/evals/blind-review-export";
import {
  confirmAiReviewAnnotationsForRun,
  importDraftAnnotationsForRun
} from "../src/lib/services/evals/annotation-adjudication";
import { upsertEvalAnnotation } from "../src/lib/services/evals/service";
import { assert } from "./eval-live-canary-test-utils";
import { operationalCounts } from "./eval-live-canary-test-utils";
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
  run_item_public_id?: string;
};

async function expectReject(label: string, fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch {
    return;
  }

  throw new Error(`${label} should have been rejected.`);
}

function csvFromRows(rows: Array<Record<string, string>>) {
  return stringify(rows, { header: true, columns: annotationColumns });
}

function parseReference(text: string) {
  return text
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as ReferenceRecord);
}

function buildAiReviewRows(referenceText: string) {
  const references = parseReference(referenceText);

  return references.map((reference, index) => {
    const fail = index < 2;
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
        ? `AI-assisted reviewer marked ${reference.original_case_id} as failing without critical flags.`
        : "AI-assisted reviewer marked this output as passing."
    };
  });
}

async function runItemEvidenceHash(runPublicId: string) {
  const items = await prisma.evalRunItem.findMany({
    where: { run: { run_public_id: runPublicId } },
    orderBy: { run_order: "asc" },
    select: {
      run_item_public_id: true,
      raw_output: true,
      parsed_output: true,
      semantic_validation_result: true,
      safety_validation_result: true,
      input_tokens: true,
      output_tokens: true,
      total_tokens: true,
      estimated_cost_usd: true
    }
  });

  return JSON.stringify(items);
}

async function main() {
  await cleanupTargetedRemediationRecords(prisma);
  const { summary, before } = await createMockTargetedRemediationRun(prisma, false);
  const exported = await exportBlindReviewPacket(summary.run_public_id);
  const referenceText = await readFile(exported.review_reference_path, "utf8");
  const rows = buildAiReviewRows(referenceText);
  const annotationCsvText = csvFromRows(rows);
  const beforeEvidence = await runItemEvidenceHash(summary.run_public_id);

  await importDraftAnnotationsForRun({
    runPublicId: summary.run_public_id,
    data: {
      annotation_csv_text: annotationCsvText,
      reference_jsonl_text: referenceText,
      source_file_name: "ai_review_smoke.csv"
    }
  });

  await expectReject("Missing explicit AI confirmation", () =>
    confirmAiReviewAnnotationsForRun({
      runPublicId: summary.run_public_id,
      annotationCsvText,
      referenceJsonlText: referenceText,
      reviewerModel: "gpt-5.5-pro",
      confirmAiReview: false
    })
  );

  const result = await confirmAiReviewAnnotationsForRun({
    runPublicId: summary.run_public_id,
    annotationCsvText,
    referenceJsonlText: referenceText,
    reviewerModel: "gpt-5.5-pro",
    confirmAiReview: true
  });

  assert(result.row_count === 22, "AI confirmation should validate 22 rows.");
  assert(result.ai_pass_count === 20, "AI confirmation should preserve 20 Pass rows.");
  assert(result.ai_fail_count === 2, "AI confirmation should preserve 2 Fail rows.");
  assert(result.ai_critical_failure_count === 0, "AI confirmation should preserve zero critical flags.");
  assert(result.ai_confirmed_updated_count === 22, "AI confirmation should promote 22 imported drafts.");
  assert(result.audit_record_count === 22, "AI confirmation should create audit revisions.");
  assert(result.human_confirmation_fabricated === false, "AI confirmation must not fabricate human confirmation.");

  const annotations = await prisma.evalAnnotation.findMany({
    where: { run_item: { run: { run_public_id: summary.run_public_id } } },
    include: { revisions: true },
    orderBy: { annotation_public_id: "asc" }
  });

  assert(annotations.length === 22, "AI confirmation should leave one annotation per run item.");
  assert(annotations.every((annotation) => annotation.annotation_source === "ai_agent_review"), "Source should be ai_agent_review.");
  assert(annotations.every((annotation) => annotation.annotation_status === "ai_confirmed"), "Status should be ai_confirmed.");
  assert(annotations.every((annotation) => annotation.confirmed_by_user_db_id === null), "No human confirmer should be stored.");
  assert(annotations.every((annotation) => annotation.confirmed_at === null), "No human confirmation timestamp should be stored.");
  assert(annotations.filter((annotation) => annotation.pass_fail === "pass").length === 20, "Twenty Pass annotations should persist.");
  assert(annotations.filter((annotation) => annotation.pass_fail === "fail").length === 2, "Two Fail annotations should persist.");
  assert(annotations.every((annotation) => Array.isArray(annotation.safety_flags) && annotation.safety_flags.length === 0), "Critical flags should remain empty.");
  assert(annotations.every((annotation) => annotation.reviewer_model === "gpt-5.5-pro"), "Reviewer model should be stored.");
  assert(annotations.every((annotation) => annotation.review_method === "blind_review"), "Review method should be stored.");
  assert(annotations.every((annotation) => annotation.annotation_file_hash), "Annotation file hash should be stored.");
  assert(annotations.every((annotation) => annotation.reference_file_hash), "Reference file hash should be stored.");
  assert(annotations.every((annotation) => annotation.source_run_public_id === summary.run_public_id), "Source run ID should be stored.");

  const repeated = await confirmAiReviewAnnotationsForRun({
    runPublicId: summary.run_public_id,
    annotationCsvText,
    referenceJsonlText: referenceText,
    reviewerModel: "gpt-5.5-pro",
    confirmAiReview: true
  });
  assert(repeated.ai_confirmed_idempotent_count === 22, "Repeated AI confirmation should be idempotent.");
  assert(repeated.audit_record_count === 0, "Idempotent AI confirmation should not create duplicate audit records.");

  await expectReject("Unknown review ID", () =>
    confirmAiReviewAnnotationsForRun({
      runPublicId: summary.run_public_id,
      annotationCsvText: csvFromRows(rows.map((row, index) => (index === 0 ? { ...row, review_item_id: "unknown_review_id" } : row))),
      referenceJsonlText: referenceText,
      reviewerModel: "gpt-5.5-pro",
      confirmAiReview: true
    })
  );
  await expectReject("Duplicate review ID", () =>
    confirmAiReviewAnnotationsForRun({
      runPublicId: summary.run_public_id,
      annotationCsvText: csvFromRows(rows.map((row, index) => (index === 1 ? { ...row, review_item_id: rows[0].review_item_id } : row))),
      referenceJsonlText: referenceText,
      reviewerModel: "gpt-5.5-pro",
      confirmAiReview: true
    })
  );

  const firstItem = await prisma.evalRunItem.findFirstOrThrow({
    where: { run: { run_public_id: summary.run_public_id } },
    orderBy: { run_order: "asc" }
  });
  const run = await prisma.evalRun.findUniqueOrThrow({
    where: { run_public_id: summary.run_public_id },
    include: { created_by: { select: { id: true, user_id: true, role: true } } }
  });
  const revisionCountBeforeHuman = await prisma.evalAnnotationRevision.count({
    where: { run_item_db_id: firstItem.id }
  });

  await upsertEvalAnnotation(
    firstItem.run_item_public_id,
    {
      blind_review: true,
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
      notes: "Human reviewer superseded AI-agent review."
    },
    {
      user_db_id: run.created_by.id,
      user_id: run.created_by.user_id,
      role: "teacher_researcher",
      auth_version: 1
    }
  );
  const humanAnnotation = await prisma.evalAnnotation.findUniqueOrThrow({
    where: {
      run_item_db_id_annotated_by_user_db_id: {
        run_item_db_id: firstItem.id,
        annotated_by_user_db_id: run.created_by.id
      }
    }
  });
  const revisionCountAfterHuman = await prisma.evalAnnotationRevision.count({
    where: { run_item_db_id: firstItem.id }
  });

  assert(humanAnnotation.annotation_source === "human_manual", "Human review should be able to replace AI review.");
  assert(humanAnnotation.annotation_status === "confirmed", "Human review should become confirmed.");
  assert(humanAnnotation.confirmed_by_user_db_id === run.created_by.id, "Human confirmer should be stored only for human review.");
  assert(revisionCountAfterHuman === revisionCountBeforeHuman + 1, "Human review after AI review should create an audit revision.");

  const afterEvidence = await runItemEvidenceHash(summary.run_public_id);
  assert(afterEvidence === beforeEvidence, "AI confirmation should not modify run outputs, automated findings, tokens, or costs.");
  const after = await operationalCounts(prisma);
  assert(after.agentCalls === before.agentCalls, "AI confirmation created operational agent calls.");
  assert(after.studentProfiles === before.studentProfiles, "AI confirmation created operational profiles.");
  assert(after.formativeDecisions === before.formativeDecisions, "AI confirmation created operational decisions.");
  assert(after.followupRounds === before.followupRounds, "AI confirmation created operational follow-up rounds.");
  assert(after.workflowJobs === before.workflowJobs, "AI confirmation created workflow jobs.");

  await cleanupTargetedRemediationRecords(prisma);
  console.log("AI review confirmation smoke test passed. No OpenAI call was made.");
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
