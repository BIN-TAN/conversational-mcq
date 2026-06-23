import { readFile } from "node:fs/promises";
import { parse } from "csv-parse/sync";
import { PrismaClient } from "@prisma/client";
import { exportBlindReviewPacket } from "../src/lib/services/evals/blind-review-export";
import { operationalCounts } from "./eval-live-canary-test-utils";

const prisma = new PrismaClient();
const runPublicId = "evr_20260623_1sjeh1q";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function parseJsonl(text: string) {
  return text
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

function walk(value: unknown, visit: (key: string, value: unknown) => void, key = "") {
  visit(key, value);

  if (Array.isArray(value)) {
    value.forEach((entry, index) => walk(entry, visit, String(index)));
    return;
  }

  if (value && typeof value === "object") {
    for (const [entryKey, entryValue] of Object.entries(value)) {
      walk(entryValue, visit, entryKey);
    }
  }
}

function assertBlindRecord(record: Record<string, unknown>) {
  const forbiddenKeys = new Set([
    "case_id",
    "original_case_id",
    "model_name",
    "model_snapshot",
    "provider",
    "provider_response_id",
    "provider_request_id",
    "client_request_id",
    "prompt_version",
    "prompt_hash",
    "automated_semantic_result",
    "automated_safety_result",
    "automated_critical_flags",
    "gold_labels",
    "token_usage",
    "estimated_cost_usd",
    "existing_annotations"
  ]);

  walk(record, (key) => {
    assert(!forbiddenKeys.has(key), `Blind packet leaked forbidden key ${key}.`);
  });

  assert(typeof record.review_item_id === "string", "Blind record missing opaque review_item_id.");
  assert(typeof record.agent_name === "string", "Blind record missing agent_name.");
  assert(typeof record.case_title === "string", "Blind record missing case title.");
  assert(typeof record.case_description === "string", "Blind record missing case description.");
  assert(record.input_payload !== null && typeof record.input_payload === "object", "Blind record missing input payload.");
  assert(
    record.parsed_model_output !== undefined || record.raw_output !== undefined,
    "Blind record missing model output."
  );
  assert(record.agent_specific_rubric_criteria, "Blind record missing rubric criteria.");
  assert(record.rubric_scale, "Blind record missing rubric scale.");
  assert(record.safety_expectations !== undefined, "Blind record missing safety expectations.");
  assert(record.critical_failure_definitions, "Blind record missing critical failure definitions.");
}

async function main() {
  const run = await prisma.evalRun.findUnique({
    where: { run_public_id: runPublicId },
    select: {
      id: true,
      status: true,
      planned_run_item_count: true,
      run_items: {
        select: {
          execution_status: true,
          eval_case: { select: { case_source: true } }
        }
      }
    }
  });

  assert(run, `Required smoke-test run ${runPublicId} was not found.`);
  assert(run.status === "completed", "Required smoke-test run must be completed.");
  assert(run.planned_run_item_count === 25, "Required smoke-test run must have 25 planned items.");
  assert(run.run_items.length === 25, "Required smoke-test run must have 25 run items.");
  assert(run.run_items.every((item) => item.execution_status === "completed"), "All run items must be completed.");
  assert(run.run_items.every((item) => item.eval_case.case_source === "synthetic"), "All run items must be synthetic.");

  const before = await operationalCounts(prisma);
  const annotationCountBefore = await prisma.evalAnnotation.count({
    where: { run_item: { run: { run_public_id: runPublicId } } }
  });
  const result = await exportBlindReviewPacket(runPublicId);
  const after = await operationalCounts(prisma);
  const annotationCountAfter = await prisma.evalAnnotation.count({
    where: { run_item: { run: { run_public_id: runPublicId } } }
  });

  assert(after.agentCalls === before.agentCalls, "Blind review export created operational agent calls.");
  assert(after.studentProfiles === before.studentProfiles, "Blind review export created profiles.");
  assert(after.formativeDecisions === before.formativeDecisions, "Blind review export created decisions.");
  assert(after.followupRounds === before.followupRounds, "Blind review export created follow-up rounds.");
  assert(after.itemVerificationRuns === before.itemVerificationRuns, "Blind review export created item verification runs.");
  assert(after.workflowJobs === before.workflowJobs, "Blind review export created workflow jobs.");
  assert(after.assessmentSessions === before.assessmentSessions, "Blind review export changed assessment sessions.");
  assert(after.itemResponses === before.itemResponses, "Blind review export changed item responses.");
  assert(annotationCountAfter === annotationCountBefore, "Blind review export changed annotations.");

  const [blindText, referenceText, annotationText] = await Promise.all([
    readFile(result.blind_review_packet_path, "utf8"),
    readFile(result.review_reference_path, "utf8"),
    readFile(result.annotation_template_path, "utf8")
  ]);
  const blindRecords = parseJsonl(blindText);
  const referenceRecords = parseJsonl(referenceText);
  const annotationRows = parse(annotationText, {
    columns: true,
    skip_empty_lines: true
  }) as Array<Record<string, string>>;

  assert(blindRecords.length === 25, "Blind review packet should contain 25 records.");
  assert(referenceRecords.length === 25, "Reference packet should contain 25 records.");
  assert(annotationRows.length === 25, "Annotation template should contain 25 data rows.");

  for (const record of blindRecords) {
    assertBlindRecord(record);
  }

  const blindIds = new Set(blindRecords.map((record) => record.review_item_id));
  const referenceIds = new Set(referenceRecords.map((record) => record.review_item_id));
  const annotationIds = new Set(annotationRows.map((row) => row.review_item_id));

  assert(blindIds.size === 25, "Blind review IDs should be unique.");
  assert(referenceIds.size === 25, "Reference review IDs should be unique.");
  assert(annotationIds.size === 25, "Annotation review IDs should be unique.");

  for (const id of blindIds) {
    assert(referenceIds.has(id), `Reference missing ${String(id)}.`);
    assert(annotationIds.has(id as string), `Annotation template missing ${String(id)}.`);
  }

  for (const record of referenceRecords) {
    assert(typeof record.original_case_id === "string", "Reference record missing case ID.");
    assert(record.gold_labels !== undefined, "Reference record missing gold labels.");
    assert(record.expected_behavior !== undefined, "Reference record missing expected behavior.");
    assert(record.automated_semantic_result !== undefined, "Reference record missing semantic result.");
    assert(record.automated_safety_result !== undefined, "Reference record missing safety result.");
    assert(Array.isArray(record.automated_critical_flags), "Reference record missing critical flags.");
    assert(record.model_provider_prompt_metadata !== undefined, "Reference record missing model/provider metadata.");
  }

  for (const row of annotationRows) {
    assert(row.pass_fail === "", "Annotation pass_fail should be blank.");
    assert(row.overall_rating === "", "Annotation overall_rating should be blank.");
    assert(row.notes === "", "Annotation notes should be blank.");
  }

  const allOutput = `${blindText}\n${referenceText}\n${annotationText}`;
  assert(!/sk-[A-Za-z0-9_-]+/.test(allOutput), "Export leaked API-key-like content.");
  assert(!/OPENAI_API_KEY|SESSION_SECRET|DATABASE_URL/i.test(allOutput), "Export leaked secret names.");

  console.log(
    JSON.stringify(
      {
        message: "Blind review export smoke test passed. No OpenAI call was made.",
        output_dir: result.output_dir,
        blind_review_packet_path: result.blind_review_packet_path,
        review_reference_path: result.review_reference_path,
        annotation_template_path: result.annotation_template_path
      },
      null,
      2
    )
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
