import { readFile } from "node:fs/promises";
import { PrismaClient } from "@prisma/client";
import { stringify } from "csv-stringify/sync";
import { exportBlindReviewPacket } from "../src/lib/services/evals/blind-review-export";
import { importDraftAnnotationsForRun } from "../src/lib/services/evals/annotation-adjudication";
import { assert, cleanupLiveCanaryRecords, operationalCounts } from "./eval-live-canary-test-utils";
import { createMockPilotRun } from "./eval-live-pilot-test-utils";

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

function parseJsonl(text: string) {
  return text
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { review_item_id: string; original_case_id: string });
}

async function main() {
  await cleanupLiveCanaryRecords(prisma);
  const before = await operationalCounts(prisma);
  const { pilotRunPublicId } = await createMockPilotRun(prisma);
  const run = await prisma.evalRun.findUniqueOrThrow({
    where: { run_public_id: pilotRunPublicId },
    select: { id: true, created_by_user_db_id: true }
  });

  await prisma.evalAnnotation.deleteMany({ where: { run_item: { run_db_id: run.id } } });
  const exportResult = await exportBlindReviewPacket(pilotRunPublicId);
  const references = parseJsonl(await readFile(exportResult.review_reference_path, "utf8"));
  const rows = references.map((reference) => ({
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
    notes: "Synthetic all-pass pilot import smoke row."
  }));
  const csv = stringify(rows, { header: true, columns: annotationColumns });

  const result = await importDraftAnnotationsForRun({
    runPublicId: pilotRunPublicId,
    data: {
      annotation_csv_text: csv,
      reference_jsonl_text: await readFile(exportResult.review_reference_path, "utf8"),
      source_file_name: "pilot_100_all_pass_annotations.csv"
    },
    requestedByUserDbId: run.created_by_user_db_id
  });
  const after = await operationalCounts(prisma);

  assert(result.row_count === 100, "Pilot annotation import should derive 100 expected rows from the run.");
  assert(result.pass_count === 100, "Pilot annotation import should accept arbitrary all-pass distribution.");
  assert(result.fail_count === 0, "Pilot annotation import should calculate zero failures.");
  assert(result.draft_created_count === 100, "Pilot annotation import should create 100 draft rows.");
  assert(Object.values(result.per_agent_pass_rates).every((entry) => entry.total === 20), "Each agent should have 20 imported pilot annotations.");
  assert(after.agentCalls === before.agentCalls, "Annotation import created operational agent calls.");
  assert(after.workflowJobs === before.workflowJobs, "Annotation import created workflow jobs.");

  await cleanupLiveCanaryRecords(prisma);
  console.log("Pilot annotation smoke test passed. No OpenAI call was made.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanupLiveCanaryRecords(prisma).catch(() => undefined);
    await prisma.$disconnect();
  });
