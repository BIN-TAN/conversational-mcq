import { PrismaClient } from "@prisma/client";
import { stringify } from "csv-stringify/sync";
import {
  importDraftAnnotationsForRun,
  confirmEvalAnnotation
} from "../src/lib/services/evals/annotation-adjudication";
import { generatePublicId } from "../src/lib/services/ids";
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
const agentOrder = [
  "item_verification_agent",
  "response_collection_agent",
  "student_profiling_agent",
  "formative_value_and_planning_agent",
  "followup_agent"
];

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

function allPassRows(rows: Array<Record<string, string>>): Array<Record<string, string>> {
  return rows.map((row) => ({
    ...row,
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
    notes: "Human reviewer marked this case as passing."
  }));
}

async function createSyntheticPilotRun(input: {
  teacherDbId: string;
  itemCount: number;
}) {
  const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const suite = await prisma.evalSuite.create({
    data: {
      suite_public_id: generatePublicId("eval_suite"),
      title: `Phase 7E1 synthetic annotation import pilot smoke ${suffix}`,
      description: "Synthetic future pilot-sized run for annotation import smoke testing.",
      agent_name: "live_canary",
      status: "active",
      created_by_user_db_id: input.teacherDbId
    }
  });
  const run = await prisma.evalRun.create({
    data: {
      run_public_id: generatePublicId("eval_run"),
      suite_db_id: suite.id,
      agent_name: "live_canary",
      provider: "openai",
      model_name: "gpt-5.4-mini-2026-03-17",
      model_config: { mock_provider_smoke: true, annotation_import_pilot_smoke: true },
      prompt_version: "pilot-smoke",
      schema_version: "pilot-smoke",
      prompt_hash: "pilot-smoke",
      run_mode: "live_provider",
      repetition_count: 1,
      status: "completed",
      planned_run_item_count: input.itemCount,
      provider_request_count: input.itemCount,
      model_snapshot: "gpt-5.4-mini-2026-03-17",
      reasoning_effort: "low",
      case_manifest_hash: `pilot-smoke-${suffix}`,
      run_config_hash: `pilot-smoke-${suffix}`,
      reproducibility_manifest: { smoke: true, item_count: input.itemCount },
      pricing_registry_version: "openai-pricing-2026-06-22-v1",
      budget_limit_usd: 50,
      estimated_cost_usd: 1,
      created_by_user_db_id: input.teacherDbId,
      started_at: new Date(),
      completed_at: new Date()
    }
  });
  const references: Array<{ review_item_id: string; original_case_id: string }> = [];
  const rows: Array<Record<string, string>> = [];

  for (let index = 0; index < input.itemCount; index += 1) {
    const caseNumber = index + 1;
    const agentName = agentOrder[index % agentOrder.length];
    const caseId = `pilot_annotation_case_${caseNumber.toString().padStart(3, "0")}`;
    const evalCase = await prisma.evalCase.create({
      data: {
        case_public_id: generatePublicId("eval_case"),
        suite_db_id: suite.id,
        case_id: caseId,
        agent_name: agentName,
        title: `Pilot annotation case ${caseNumber}`,
        description: "Synthetic pilot-sized annotation import case.",
        input_payload: { case_id: caseId, synthetic: true },
        expected_output: { expected: "synthetic output shape" },
        gold_labels: { expected_pass_fail: "not_predetermined" },
        rubric_expectations: { notes: "Any valid human judgment distribution is accepted." },
        safety_expectations: { no_secrets: true },
        case_source: "synthetic",
        status: "active"
      }
    });

    await prisma.evalRunItem.create({
      data: {
        run_item_public_id: generatePublicId("eval_run_item"),
        run_db_id: run.id,
        case_db_id: evalCase.id,
        repetition_index: 1,
        run_order: caseNumber,
        idempotency_key: `${run.run_public_id}:${caseId}:1`,
        input_payload: { case_id: caseId, synthetic: true },
        raw_output: { output_status: "completed", synthetic: true },
        parsed_output: { output_status: "completed", synthetic: true },
        output_validated: true,
        semantic_validation_result: { ok: true, issues: [], warnings: [] },
        safety_validation_result: { ok: true, issues: [], warnings: [], critical_failure_flags: [] },
        execution_status: "completed",
        model_snapshot: "gpt-5.4-mini-2026-03-17",
        reasoning_effort: "low",
        max_output_tokens: 1000,
        prompt_version: "pilot-smoke",
        schema_version: "pilot-smoke",
        prompt_hash: "pilot-smoke",
        token_usage: { mock_token_data_is_not_billing: true },
        input_tokens: 10,
        output_tokens: 5,
        total_tokens: 15,
        estimated_cost_usd: 0
      }
    });

    const reviewItemId = `review_pilot_${caseNumber.toString().padStart(3, "0")}`;
    const failed = caseNumber % 4 === 0;
    references.push({ review_item_id: reviewItemId, original_case_id: caseId });
    rows.push({
      review_item_id: reviewItemId,
      pass_fail: failed ? "fail" : "pass",
      overall_rating: failed ? "1" : "3",
      schema_adherence: "3",
      task_relevance: failed ? "1" : "3",
      policy_compliance: "3",
      safety: "3",
      evidence_use: failed ? "1" : "3",
      calibration_or_uncertainty: failed ? "1" : "3",
      student_facing_appropriateness: "3",
      teacher_review_appropriateness: "3",
      human_critical_failure_flags: "",
      notes: failed ? "Synthetic arbitrary fail judgment." : "Synthetic arbitrary pass judgment."
    });
  }

  return {
    run_public_id: run.run_public_id,
    annotation_csv_text: csvFromRows(rows),
    reference_text: `${references.map((reference) => JSON.stringify(reference)).join("\n")}\n`,
    rows
  };
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

  const allPassCsvRows = allPassRows(fixture.rows);
  const allPassResult = await importDraftAnnotationsForRun({
    runPublicId,
    data: {
      annotation_csv_text: csvFromRows(allPassCsvRows),
      reference_jsonl_text: fixture.reference_text,
      source_file_name: "fresh_25_pass_annotations.csv"
    },
    requestedByUserDbId: run.created_by.id
  });
  assert(allPassResult.row_count === 25, "Fresh 25/0 import should read 25 rows.");
  assert(allPassResult.pass_count === 25, "Fresh 25/0 import should accept 25 pass rows.");
  assert(allPassResult.fail_count === 0, "Fresh 25/0 import should accept zero fail rows.");
  assert(allPassResult.failed_case_ids.length === 0, "Fresh 25/0 import should report no failed cases.");
  assert(allPassResult.human_critical_failure_count === 0, "Fresh 25/0 import should report zero human critical flags.");
  assert(allPassResult.per_agent_pass_rates.item_verification_agent.pass_rate === 1, "25/0 IVA pass rate should be calculated.");

  const rows = allPassCsvRows.map((row) => ({ ...row }));
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
        annotation_csv_text: csvFromRows(rows.map((row, index) => (index === 1 ? { ...row, review_item_id: rows[0]["review_item_id"] } : row))),
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
  await expectReject("Extra review ID", () =>
    importDraftAnnotationsForRun({
      runPublicId,
      data: {
        annotation_csv_text: csvFromRows([
          ...rows,
          { ...rows[0], review_item_id: "extra_review_id" }
        ]),
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
    row["review_item_id"] === confirmedReviewItemId
      ? { ...row, notes: "This changed note should not overwrite confirmed annotations." }
      : row
  );
  const afterConfirmationImport = await importDraftAnnotationsForRun({
    runPublicId,
    data: {
      annotation_csv_text: csvFromRows(changedNotesRows),
      reference_jsonl_text: fixture.reference_text
    },
    requestedByUserDbId: run.created_by.id
  });
  assert(afterConfirmationImport.confirmed_skipped_count === 1, "Import should report confirmed annotations as skipped.");
  const confirmedAfter = await prisma.evalAnnotation.findFirstOrThrow({
    where: { run_item_db_id: firstItem.id, annotated_by_user_db_id: run.created_by.id }
  });
  assert(confirmedAfter.notes === confirmedBefore.notes, "Import should not overwrite a confirmed annotation.");

  const pilot = await createSyntheticPilotRun({
    teacherDbId: run.created_by.id,
    itemCount: 100
  });
  const pilotResult = await importDraftAnnotationsForRun({
    runPublicId: pilot.run_public_id,
    data: {
      annotation_csv_text: pilot.annotation_csv_text,
      reference_jsonl_text: pilot.reference_text,
      source_file_name: "future_pilot_100_annotations.csv"
    },
    requestedByUserDbId: run.created_by.id
  });
  assert(pilotResult.row_count === 100, "Future pilot import should derive 100 expected rows from the run.");
  assert(pilotResult.pass_count === 75, "Future pilot import should calculate arbitrary pass totals.");
  assert(pilotResult.fail_count === 25, "Future pilot import should calculate arbitrary fail totals.");
  assert(pilotResult.draft_created_count === 100, "Future pilot import should create 100 draft annotations.");
  assert(pilotResult.per_agent_pass_rates.item_verification_agent.total === 20, "Future pilot per-agent totals should be derived.");

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
