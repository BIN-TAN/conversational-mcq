import { PrismaClient } from "@prisma/client";
import { buildEffectiveSystemArtifact } from "../src/lib/services/evals/effective-system-artifacts";
import { assert, operationalCounts } from "./eval-live-canary-test-utils";
import {
  cleanupTargetedRemediationRecords,
  createMockTargetedRemediationRun
} from "./eval-targeted-remediation-test-utils";

const prisma = new PrismaClient();

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

async function evalSnapshot(runPublicId: string) {
  const items = await prisma.evalRunItem.findMany({
    where: { run: { run_public_id: runPublicId } },
    orderBy: { run_order: "asc" },
    select: {
      run_item_public_id: true,
      parsed_output: true,
      raw_output: true,
      semantic_validation_result: true,
      safety_validation_result: true
    }
  });

  return JSON.stringify(items);
}

async function main() {
  await cleanupTargetedRemediationRecords(prisma);
  const { summary } = await createMockTargetedRemediationRun(prisma, false);
  const run = await prisma.evalRun.findUniqueOrThrow({
    where: { run_public_id: summary.run_public_id },
    include: {
      run_items: {
        include: { eval_case: true, annotations: true },
        orderBy: { run_order: "asc" }
      }
    }
  });
  const beforeEval = await evalSnapshot(summary.run_public_id);
  const beforeOperational = await operationalCounts(prisma);

  const responseCollection = run.run_items.find((item) => item.eval_case.case_id === "rca_mixed_reasoning_correctness_007");
  const planning = run.run_items.find((item) => item.eval_case.case_id === "fpa_mapping_deviation_with_rationale_007");
  const followup = run.run_items.find((item) => item.eval_case.case_id === "fua_off_topic_redirect_007");
  const itemVerification = run.run_items.find((item) => item.eval_case.case_id === "iva_duplicate_items_010");

  assert(responseCollection && planning && followup && itemVerification, "Smoke run should contain targeted cases.");

  const rcaArtifact = buildEffectiveSystemArtifact({
    ...responseCollection,
    parsed_output: {
      ...record(responseCollection.parsed_output),
      requires_option_button: true,
      requires_confidence_control: true,
      missing_evidence_status: "multiple_missing_fields"
    }
  });
  const rcaResult = record(rcaArtifact.effective_structured_result);
  assert(rcaArtifact.canonicalization_applied, "Response Collection artifact should canonicalize controls from backend state.");
  assert(rcaResult.effective_requires_option_button === false, "Response Collection effective option control should derive from backend state.");
  assert(rcaResult.effective_requires_confidence_control === true, "Response Collection effective confidence control should derive from backend state.");

  const planningArtifact = buildEffectiveSystemArtifact({
    ...planning,
    parsed_output: {
      ...record(planning.parsed_output),
      formative_value: "reasoning_refinement",
      mapping_followed: false,
      mapping_deviation_reason: ""
    },
    semantic_validation_result: { ok: false, issues: ["synthetic invalid deviation"], warnings: [] }
  });
  const planningActions = record(planningArtifact.effective_workflow_actions);
  assert(planningArtifact.fallback_applied, "Invalid Planning deviation should receive deterministic fallback.");
  assert(planningActions.invalid_deviation_reached_workflow === false, "Invalid Planning deviation should not reach workflow.");
  assert(planningActions.plan_available === true, "Planning fallback should provide a safe plan.");

  const followupArtifact = buildEffectiveSystemArtifact({
    ...followup,
    parsed_output: {
      ...record(followup.parsed_output),
      followup_action_type: "move_on_offer",
      off_topic_detected: true,
      should_offer_move_on: true,
      student_turn_substantive: false,
      evidence_trigger_candidate: true,
      evidence_trigger_reasons: ["move_on_request"],
      events_to_log: [{ event_type: "concept_progression_requested", event_source: "agent", event_category: "workflow", payload: null }]
    },
    semantic_validation_result: { ok: false, issues: ["synthetic invalid off-topic output"], warnings: [] }
  });
  const followupOutput = record(record(followupArtifact.effective_structured_result).effective_output);
  const followupActions = record(followupArtifact.effective_workflow_actions);
  assert(followupArtifact.fallback_applied, "Invalid Follow-up output should receive deterministic fallback.");
  assert(followupOutput.followup_action_type === "off_topic_redirect", "Off-topic Follow-up fallback should redirect neutrally.");
  assert(followupOutput.should_offer_move_on === false, "Off-topic fallback should not offer move-on.");
  assert(followupActions.progression_event === false, "Invalid Follow-up events should not enter effective workflow actions.");

  const itemArtifact = buildEffectiveSystemArtifact(itemVerification);
  const itemResult = record(itemArtifact.effective_structured_result);
  assert(itemResult.deterministic_guard_detected_duplicate === true, "Item Verification deterministic duplicate result should be visible.");
  assert(itemResult.effective_result_contains_duplicate_warning === true, "Item Verification effective result should include duplicate warning.");

  const secondItemArtifact = buildEffectiveSystemArtifact(itemVerification);
  assert(
    secondItemArtifact.effective_result_hash === itemArtifact.effective_result_hash,
    "Effective artifacts should be deterministic."
  );

  const afterEval = await evalSnapshot(summary.run_public_id);
  const afterOperational = await operationalCounts(prisma);
  assert(afterEval === beforeEval, "Effective artifact derivation should not mutate raw eval outputs.");
  assert(JSON.stringify(afterOperational) === JSON.stringify(beforeOperational), "Effective artifact derivation should not mutate operational records.");

  await cleanupTargetedRemediationRecords(prisma);
  console.log("Effective-system artifact smoke test passed. No OpenAI call was made.");
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
