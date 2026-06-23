import { PrismaClient } from "@prisma/client";
import { stringify } from "csv-stringify/sync";
import {
  importDraftAnnotationsForRun,
  confirmEvalAnnotation
} from "../src/lib/services/evals/annotation-adjudication";
import { cleanupEvalFixtures } from "../src/lib/services/evals/service";
import type { PublicUser } from "../src/types/auth";
import {
  assert,
  buildCompletedAnnotationCsv,
  createMockCanaryRunForAnnotationSmoke,
  expectedFailedCaseIds
} from "./eval-annotation-smoke-utils";
import { cleanupLiveCanaryRecords, operationalCounts } from "./eval-live-canary-test-utils";

const prisma = new PrismaClient();

async function expectReject(label: string, fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch {
    return;
  }

  throw new Error(`${label} should have been rejected.`);
}

function csvFromRows(rows: Array<Record<string, string>>) {
  return stringify(rows, {
    header: true,
    columns: Object.keys(rows[0] ?? {})
  });
}

function reviewIdForCase(referenceText: string, caseId: string) {
  const record = referenceText
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { review_item_id: string; original_case_id: string })
    .find((entry) => entry.original_case_id === caseId);

  assert(record, `Missing review ID for ${caseId}.`);

  return record.review_item_id;
}

async function main() {
  await cleanupLiveCanaryRecords(prisma);
  await cleanupEvalFixtures();

  const runPublicId = await createMockCanaryRunForAnnotationSmoke(prisma);
  const run = await prisma.evalRun.findUniqueOrThrow({
    where: { run_public_id: runPublicId },
    include: {
      created_by: { select: { id: true, user_id: true, role: true } },
      run_items: { include: { eval_case: true }, orderBy: [{ run_order: "asc" }] }
    }
  });
  const teacherUser: PublicUser = {
    user_db_id: run.created_by.id,
    user_id: run.created_by.user_id,
    role: "teacher_researcher",
    auth_version: 1
  };
  const fixture = await buildCompletedAnnotationCsv({ runPublicId });
  const before = await operationalCounts(prisma);

  const result = await importDraftAnnotationsForRun({
    runPublicId,
    data: {
      annotation_csv_text: fixture.annotation_csv_text,
      reference_jsonl_text: fixture.reference_text,
      source_file_name: "completed_annotations.csv"
    },
    requestedByUserDbId: run.created_by.id
  });
  const after = await operationalCounts(prisma);

  assert(result.row_count === 25, "Valid import should read 25 rows.");
  assert(result.pass_count === 22, "Valid import should report 22 pass rows.");
  assert(result.fail_count === 3, "Valid import should report 3 fail rows.");
  assert(result.human_critical_failure_count === 0, "Valid import should report zero human critical flags.");
  assert(expectedFailedCaseIds.size === result.failed_case_ids.length, "Valid import should report exactly three failed cases.");
  for (const caseId of expectedFailedCaseIds) {
    assert(result.failed_case_ids.includes(caseId), `Expected failed case ${caseId}.`);
  }
  assert(result.per_agent_pass_rates.item_verification_agent.pass_rate === 0.8, "IVA pass rate should be 0.80.");
  assert(result.per_agent_pass_rates.response_collection_agent.pass_rate === 1, "RCA pass rate should be 1.00.");
  assert(result.per_agent_pass_rates.student_profiling_agent.pass_rate === 0.8, "SPA pass rate should be 0.80.");
  assert(result.per_agent_pass_rates.formative_value_and_planning_agent.pass_rate === 1, "Planning pass rate should be 1.00.");
  assert(result.per_agent_pass_rates.followup_agent.pass_rate === 0.8, "Follow-up pass rate should be 0.80.");
  assert(after.agentCalls === before.agentCalls, "Import created operational agent calls.");
  assert(after.studentProfiles === before.studentProfiles, "Import created operational profiles.");
  assert(after.formativeDecisions === before.formativeDecisions, "Import created operational decisions.");
  assert(after.followupRounds === before.followupRounds, "Import created operational follow-up rounds.");
  assert(after.workflowJobs === before.workflowJobs, "Import created workflow jobs.");

  const draftCount = await prisma.evalAnnotation.count({
    where: { run_item: { run_db_id: run.id }, annotation_status: "draft", annotation_source: "ai_assisted_preliminary" }
  });
  const confirmedCount = await prisma.evalAnnotation.count({
    where: { run_item: { run_db_id: run.id }, annotation_status: "confirmed" }
  });

  assert(draftCount === 25, "Import should create 25 draft AI-assisted annotations.");
  assert(confirmedCount === 0, "Draft imports should not count as confirmed human annotations.");

  const repeated = await importDraftAnnotationsForRun({
    runPublicId,
    data: {
      annotation_csv_text: fixture.annotation_csv_text,
      reference_jsonl_text: fixture.reference_text
    },
    requestedByUserDbId: run.created_by.id
  });
  assert(repeated.draft_created_count === 0, "Repeated import should not create duplicate annotations.");
  assert(repeated.draft_updated_count === 25, "Repeated import should be idempotent over draft rows.");

  const rows = fixture.rows.map((row) => ({ ...row }));
  await expectReject("Unknown review ID", () =>
    importDraftAnnotationsForRun({
      runPublicId,
      data: {
        annotation_csv_text: csvFromRows(rows.map((row, index) => (index === 0 ? { ...row, review_item_id: "unknown_review_id" } : row))),
        reference_jsonl_text: fixture.reference_text
      },
      requestedByUserDbId: run.created_by.id
    })
  );
  await expectReject("Duplicate review ID", () =>
    importDraftAnnotationsForRun({
      runPublicId,
      data: {
        annotation_csv_text: csvFromRows(rows.map((row, index) => (index === 1 ? { ...row, review_item_id: rows[0].review_item_id } : row))),
        reference_jsonl_text: fixture.reference_text
      },
      requestedByUserDbId: run.created_by.id
    })
  );
  await expectReject("Missing review ID", () =>
    importDraftAnnotationsForRun({
      runPublicId,
      data: {
        annotation_csv_text: csvFromRows(rows.slice(1)),
        reference_jsonl_text: fixture.reference_text
      },
      requestedByUserDbId: run.created_by.id
    })
  );
  await expectReject("Invalid rating", () =>
    importDraftAnnotationsForRun({
      runPublicId,
      data: {
        annotation_csv_text: csvFromRows(rows.map((row, index) => (index === 0 ? { ...row, overall_rating: "4" } : row))),
        reference_jsonl_text: fixture.reference_text
      },
      requestedByUserDbId: run.created_by.id
    })
  );
  await expectReject("Invalid pass_fail", () =>
    importDraftAnnotationsForRun({
      runPublicId,
      data: {
        annotation_csv_text: csvFromRows(rows.map((row, index) => (index === 0 ? { ...row, pass_fail: "maybe" } : row))),
        reference_jsonl_text: fixture.reference_text
      },
      requestedByUserDbId: run.created_by.id
    })
  );
  await expectReject("Invalid critical flag", () =>
    importDraftAnnotationsForRun({
      runPublicId,
      data: {
        annotation_csv_text: csvFromRows(
          rows.map((row, index) => (index === 0 ? { ...row, human_critical_failure_flags: "not_a_flag" } : row))
        ),
        reference_jsonl_text: fixture.reference_text
      },
      requestedByUserDbId: run.created_by.id
    })
  );

  const firstItem = run.run_items[0];
  await confirmEvalAnnotation(firstItem.run_item_public_id, teacherUser);
  const confirmedBefore = await prisma.evalAnnotation.findFirstOrThrow({
    where: { run_item_db_id: firstItem.id, annotated_by_user_db_id: run.created_by.id }
  });
  const confirmedReviewItemId = reviewIdForCase(fixture.reference_text, firstItem.eval_case.case_id);
  const changedNotesRows = rows.map((row) =>
    row.review_item_id === confirmedReviewItemId
      ? { ...row, notes: "This changed note should not overwrite confirmed annotations." }
      : row
  );
  await importDraftAnnotationsForRun({
    runPublicId,
    data: {
      annotation_csv_text: csvFromRows(changedNotesRows),
      reference_jsonl_text: fixture.reference_text
    },
    requestedByUserDbId: run.created_by.id
  });
  const confirmedAfter = await prisma.evalAnnotation.findFirstOrThrow({
    where: { run_item_db_id: firstItem.id, annotated_by_user_db_id: run.created_by.id }
  });
  assert(confirmedAfter.notes === confirmedBefore.notes, "Import should not overwrite a confirmed annotation.");

  await cleanupLiveCanaryRecords(prisma);
  await cleanupEvalFixtures();

  console.log("Annotation draft import smoke test passed. No OpenAI call was made.");
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
