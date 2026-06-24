import { readFile } from "node:fs/promises";
import { PrismaClient } from "@prisma/client";
import {
  EFFECTIVE_SYSTEM_RESULT_VERSION_V1,
  EFFECTIVE_SYSTEM_RESULT_VERSION_V2,
  buildEffectiveSystemArtifact
} from "../src/lib/services/evals/effective-system-artifacts";
import { exportBlindReviewPacketForTarget } from "../src/lib/services/evals/blind-review-export";
import { createTargetedRemediationReadinessReport } from "../src/lib/services/evals/targeted-remediation-execution";
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

function jsonl(text: string) {
  return text.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>);
}

async function main() {
  await cleanupTargetedRemediationRecords(prisma);
  const { summary } = await createMockTargetedRemediationRun(prisma, false);
  const beforeOperational = await operationalCounts(prisma);
  const run = await prisma.evalRun.findUniqueOrThrow({
    where: { run_public_id: summary.run_public_id },
    include: {
      run_items: {
        include: { eval_case: true },
        orderBy: [{ run_order: "asc" }, { repetition_index: "asc" }]
      }
    }
  });
  const moveOnItems = run.run_items.filter((item) => item.eval_case.case_id === "fua_move_on_offer_010");
  assert(moveOnItems.length === 2, "Smoke run should include both move-on repetitions.");

  for (const item of moveOnItems) {
    const syntheticItem = {
      ...item,
      parsed_output: {
        ...record(item.parsed_output),
        followup_action_type: "move_on_offer",
        should_offer_move_on: true,
        student_turn_substantive: false,
        evidence_trigger_candidate: true,
        evidence_trigger_reasons: ["move_on_request"],
        off_topic_detected: false,
        events_to_log: [
          {
            event_type: "concept_progression_requested",
            event_category: "workflow",
            event_source: "agent",
            payload: { detail: "Raw agent attempted workflow mutation." }
          }
        ]
      },
      semantic_validation_result: {
        ok: false,
        issues: ["synthetic invalid raw move-on event"],
        warnings: []
      }
    };
    const v1 = buildEffectiveSystemArtifact(syntheticItem, {
      effectiveResultVersion: EFFECTIVE_SYSTEM_RESULT_VERSION_V1
    });
    const v2 = buildEffectiveSystemArtifact(syntheticItem, {
      effectiveResultVersion: EFFECTIVE_SYSTEM_RESULT_VERSION_V2
    });
    const v1Output = record(record(v1.effective_structured_result).effective_output);
    const v2Output = record(record(v2.effective_structured_result).effective_output);
    const v2Actions = record(v2.effective_workflow_actions);

    assert(v1.effective_result_version === EFFECTIVE_SYSTEM_RESULT_VERSION_V1, "V1 artifact should keep v1 version.");
    assert(v2.effective_result_version === EFFECTIVE_SYSTEM_RESULT_VERSION_V2, "V2 artifact should use v2 version.");
    assert(v1Output.should_offer_move_on === false, "V1 fallback should preserve the historical failed behavior.");
    assert(v2Output.should_offer_move_on === true, "V2 fallback should preserve explicit move-on intent.");
    assert(v2Output.student_turn_substantive === false, "Move-on request should remain nonsubstantive.");
    assert(v2Output.evidence_trigger_candidate === true, "Move-on request should trigger the technical final-update path.");
    assert(
      Array.isArray(v2Output.evidence_trigger_reasons) &&
        v2Output.evidence_trigger_reasons.includes("move_on_request"),
      "Move-on request should include move_on_request trigger reason."
    );
    assert(v2Output.off_topic_detected === false, "Move-on request should not be treated as off-topic.");
    assert(v2Output.followup_action_type === "move_on_offer", "V2 fallback should expose move_on_offer.");
    assert(v2Output.evidence_request === null, "Move-on fallback should not assign a new evidence task.");
    assert(!/similar generic situation|transfer/i.test(String(v2Output.assistant_message)), "Move-on fallback should not assign a transfer task.");
    assert(v2Actions.request_final_followup_update === true, "V2 should request final follow-up update.");
    assert(v2Actions.prepare_concept_progression === true, "V2 should prepare concept progression.");
    assert(
      v2Actions.offer_unresolved_evidence_confirmation_if_needed === true,
      "V2 should preserve unresolved-evidence confirmation path."
    );
    assert(v2Actions.direct_concept_completion === false, "V2 should not directly mark concept complete.");
    assert(v2Actions.direct_next_concept_selection === false, "V2 should not directly choose the next concept.");
    assert(v2Actions.saved_formative_value_preserved === true, "V2 should preserve saved formative value.");
    assert(v2Actions.assign_new_transfer_task === false, "V2 should not assign a transfer task.");
    assert(
      Array.isArray(v2.effective_process_events) &&
        v2.effective_process_events.every((event) => record(event).event_source !== "agent"),
      "V2 should not expose agent-authored operational process events."
    );
    assert(v1.effective_result_hash !== v2.effective_result_hash, "Move-on v2 artifact hash should differ from v1.");
  }

  const nonMoveOnChanges = run.run_items.filter((item) => item.eval_case.case_id !== "fua_move_on_offer_010").filter((item) => {
    const v1 = buildEffectiveSystemArtifact(item, { effectiveResultVersion: EFFECTIVE_SYSTEM_RESULT_VERSION_V1 });
    const v2 = buildEffectiveSystemArtifact(item, { effectiveResultVersion: EFFECTIVE_SYSTEM_RESULT_VERSION_V2 });

    return JSON.stringify({
      ...v1,
      effective_result_version: null,
      effective_result_hash: null
    }) !== JSON.stringify({
      ...v2,
      effective_result_version: null,
      effective_result_hash: null
    });
  });
  assert(nonMoveOnChanges.length === 0, "Non-move-on artifacts should remain semantically equivalent across v1 and v2.");

  const v2Export = await exportBlindReviewPacketForTarget({
    runPublicId: summary.run_public_id,
    reviewTarget: "effective_system_output",
    effectiveResultVersion: EFFECTIVE_SYSTEM_RESULT_VERSION_V2
  });
  const blind = jsonl(await readFile(v2Export.blind_review_packet_path, "utf8"));
  const reference = jsonl(await readFile(v2Export.review_reference_path, "utf8"));
  assert(v2Export.output_dir.endsWith("/effective-system-v2"), "V2 export should use the versioned effective-system-v2 directory.");
  assert(blind.length === 22, "V2 blind packet should contain 22 records.");
  assert(reference.length === 22, "V2 reference file should contain 22 records.");
  assert(
    reference.every((entry) => entry.effective_result_version === EFFECTIVE_SYSTEM_RESULT_VERSION_V2),
    "V2 reference records should carry effective-system-eval-v2."
  );

  const report = await createTargetedRemediationReadinessReport(summary.run_public_id);
  assert(report.recommendation === "incomplete_review", "V2 readiness should remain pending without v2 annotations.");
  assert(report.effective_system_v2_review.annotations_pending === true, "V2 annotations should remain pending.");

  const afterOperational = await operationalCounts(prisma);
  assert(JSON.stringify(afterOperational) === JSON.stringify(beforeOperational), "Move-on fallback smoke should not mutate operational records.");

  await cleanupTargetedRemediationRecords(prisma);
  console.log("Effective move-on fallback smoke test passed. No OpenAI call was made.");
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
