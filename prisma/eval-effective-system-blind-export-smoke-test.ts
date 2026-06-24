import { readFile } from "node:fs/promises";
import { parse } from "csv-parse/sync";
import { PrismaClient } from "@prisma/client";
import { exportBlindReviewPacketForTarget } from "../src/lib/services/evals/blind-review-export";
import { assert, operationalCounts } from "./eval-live-canary-test-utils";
import {
  cleanupTargetedRemediationRecords,
  createMockTargetedRemediationRun
} from "./eval-targeted-remediation-test-utils";

const prisma = new PrismaClient();

function jsonl(text: string) {
  return text.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>);
}

function serialized(value: unknown) {
  return JSON.stringify(value);
}

async function main() {
  await cleanupTargetedRemediationRecords(prisma);
  const { summary, before } = await createMockTargetedRemediationRun(prisma, false);
  const exported = await exportBlindReviewPacketForTarget({
    runPublicId: summary.run_public_id,
    reviewTarget: "effective_system_output"
  });
  const blind = jsonl(await readFile(exported.blind_review_packet_path, "utf8"));
  const reference = jsonl(await readFile(exported.review_reference_path, "utf8"));
  const rows = parse(await readFile(exported.annotation_template_path, "utf8"), {
    columns: true,
    skip_empty_lines: true
  }) as Array<Record<string, string>>;

  assert(exported.output_dir.endsWith("/effective-system-v2"), "Effective export should use a versioned ignored subdirectory.");
  assert(blind.length === 22, "Effective blind packet should contain 22 records.");
  assert(reference.length === 22, "Effective reference packet should contain 22 records.");
  assert(rows.length === 22, "Effective annotation template should contain 22 rows.");

  for (const record of blind) {
    assert(record.review_item_id, "Blind packet should include opaque review item ID.");
    assert(record.input_payload, "Blind packet should include synthetic input.");
    assert(record.effective_student_facing_behavior !== undefined, "Blind packet should show effective student-facing behavior.");
    assert(record.effective_structured_result, "Blind packet should show effective structured result.");
    assert(record.effective_workflow_actions, "Blind packet should show effective workflow actions.");

    const text = serialized(record);
    for (const forbidden of [
      "original_case_id",
      "evaluation_stratum",
      "repetition_index",
      "raw_semantic_status",
      "raw_output_status",
      "fallback_applied",
      "deterministic_guard_applied",
      "automated_semantic_result",
      "automated_safety_result",
      "automated_critical_flags",
      "gold_labels",
      "model_snapshot",
      "provider_response_id",
      "provider_request_id",
      "model_provider_prompt_metadata"
    ]) {
      assert(!text.includes(forbidden), `Effective blind packet should hide ${forbidden}.`);
    }
  }

  assert(
    reference.every((record) =>
      record.review_target === "effective_system_output" &&
      record.effective_result_version === "effective-system-eval-v2" &&
      record.raw_and_effective_comparison
    ),
    "Effective reference file should retain v2 raw/effective comparison data."
  );

  const after = await operationalCounts(prisma);
  assert(JSON.stringify(after) === JSON.stringify(before), "Effective blind export should not mutate operational records.");

  await cleanupTargetedRemediationRecords(prisma);
  console.log("Effective-system blind export smoke test passed. No OpenAI call was made.");
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
