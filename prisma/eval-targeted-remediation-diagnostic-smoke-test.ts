import { PrismaClient } from "@prisma/client";
import { exportBlindReviewPacket } from "../src/lib/services/evals/blind-review-export";
import { diagnoseTargetedRemediationRun } from "../src/lib/services/evals/targeted-remediation-diagnostic";
import { assert, operationalCounts } from "./eval-live-canary-test-utils";
import {
  cleanupTargetedRemediationRecords,
  createMockTargetedRemediationRun
} from "./eval-targeted-remediation-test-utils";

const prisma = new PrismaClient();

async function evalSnapshot(runPublicId: string) {
  const run = await prisma.evalRun.findUniqueOrThrow({
    where: { run_public_id: runPublicId },
    include: {
      run_items: {
        include: { annotations: true },
        orderBy: { run_order: "asc" }
      }
    }
  });

  return JSON.stringify({
    run: {
      run_public_id: run.run_public_id,
      status: run.status,
      canary_gate_status: run.canary_gate_status,
      estimated_cost_usd: run.estimated_cost_usd?.toString() ?? null,
      provider_request_count: run.provider_request_count
    },
    items: run.run_items.map((item) => ({
      run_item_public_id: item.run_item_public_id,
      parsed_output: item.parsed_output,
      semantic_validation_result: item.semantic_validation_result,
      safety_validation_result: item.safety_validation_result,
      annotations: item.annotations.map((annotation) => ({
        annotation_public_id: annotation.annotation_public_id,
        annotation_source: annotation.annotation_source,
        annotation_status: annotation.annotation_status,
        pass_fail: annotation.pass_fail,
        notes: annotation.notes
      }))
    }))
  });
}

async function main() {
  await cleanupTargetedRemediationRecords(prisma);
  const { summary } = await createMockTargetedRemediationRun(prisma, true);
  await exportBlindReviewPacket(summary.run_public_id);
  const beforeOperational = await operationalCounts(prisma);
  const beforeEval = await evalSnapshot(summary.run_public_id);
  const diagnosis = await diagnoseTargetedRemediationRun(summary.run_public_id);
  const afterEval = await evalSnapshot(summary.run_public_id);
  const afterOperational = await operationalCounts(prisma);
  const serialized = JSON.stringify(diagnosis);

  assert(diagnosis.read_only === true, "Diagnosis should report read_only=true.");
  assert(diagnosis.openai_call_made === false, "Diagnosis should report no OpenAI call.");
  assert(diagnosis.operational_records_mutated === false, "Diagnosis should report no operational mutation.");
  assert(diagnosis.all_run_item_count === 22, "Diagnosis should account for all 22 targeted items.");
  assert(diagnosis.all_run_items.length === 22, "Diagnosis should list all 22 targeted items.");
  assert(diagnosis.diagnostic_items.length >= 16, "Diagnosis should include gate-relevant items.");
  assert(diagnosis.blind_review_export_audit.blind_record_count === 22, "Blind packet should have 22 records.");
  assert(diagnosis.blind_review_export_audit.reference_record_count === 22, "Reference file should have 22 records.");
  assert(
    diagnosis.diagnostic_items.some((item) => item.item_verification_diagnosis?.deterministic_guard_result),
    "Deterministic duplicate results should be visible."
  );
  assert(
    diagnosis.diagnostic_items.some((item) => item.planning_diagnosis?.gate_uses_backend_canonical_mapping),
    "Backend-canonical planning results should be visible."
  );
  assert(
    diagnosis.diagnostic_items.some((item) => item.followup_diagnosis?.canonical_fallback_or_correction),
    "Follow-up fallback/rejection behavior should be visible."
  );
  assert(
    Object.keys(diagnosis.report_calculation_audit).includes("response_collection_engineering_gate"),
    "Report gate sources should be identified."
  );
  assert(!serialized.includes("OPENAI_API_KEY"), "Diagnosis should not print OpenAI API key labels.");
  assert(!serialized.includes("DATABASE_URL"), "Diagnosis should not print database URL labels.");
  assert(!serialized.includes("SESSION_SECRET"), "Diagnosis should not print session secret labels.");
  assert(!serialized.includes("fake-smoke-key-never-sent"), "Diagnosis should not print fake smoke key.");
  assert(afterEval === beforeEval, "Diagnosis should not mutate eval run, item, or annotation records.");
  assert(afterOperational.agentCalls === beforeOperational.agentCalls, "Diagnosis created operational agent calls.");
  assert(afterOperational.studentProfiles === beforeOperational.studentProfiles, "Diagnosis created operational profiles.");
  assert(afterOperational.formativeDecisions === beforeOperational.formativeDecisions, "Diagnosis created operational decisions.");
  assert(afterOperational.followupRounds === beforeOperational.followupRounds, "Diagnosis created operational follow-up rounds.");
  assert(afterOperational.workflowJobs === beforeOperational.workflowJobs, "Diagnosis created workflow jobs.");

  await cleanupTargetedRemediationRecords(prisma);
  console.log("Targeted remediation diagnostic smoke test passed. No OpenAI call was made.");
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
