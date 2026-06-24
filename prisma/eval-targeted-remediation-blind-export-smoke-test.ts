import { readFile } from "node:fs/promises";
import { parse } from "csv-parse/sync";
import { PrismaClient } from "@prisma/client";
import { exportBlindReviewPacket } from "../src/lib/services/evals/blind-review-export";
import { assert } from "./eval-live-canary-test-utils";
import {
  cleanupTargetedRemediationRecords,
  createMockTargetedRemediationRun
} from "./eval-targeted-remediation-test-utils";

const prisma = new PrismaClient();

function jsonl(text: string) {
  return text.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>);
}

function assertBlindRecordSafe(record: Record<string, unknown>) {
  const forbiddenTopLevelKeys = [
    "case_id",
    "original_case_id",
    "evaluation_stratum",
    "repetition_index",
    "model_snapshot",
    "provider",
    "provider_response_id",
    "provider_request_id",
    "automated_semantic_result",
    "automated_safety_result",
    "automated_critical_flags",
    "gold_labels"
  ];

  for (const key of forbiddenTopLevelKeys) {
    assert(!(key in record), `Blind packet should not expose ${key}.`);
  }
}

async function main() {
  await cleanupTargetedRemediationRecords(prisma);
  const { summary } = await createMockTargetedRemediationRun(prisma);
  const exported = await exportBlindReviewPacket(summary.run_public_id);
  const blind = jsonl(await readFile(exported.blind_review_packet_path, "utf8"));
  const reference = jsonl(await readFile(exported.review_reference_path, "utf8"));
  const rows = parse(await readFile(exported.annotation_template_path, "utf8"), {
    columns: true,
    skip_empty_lines: true
  }) as Array<Record<string, string>>;

  assert(blind.length === 22, "Blind review packet should contain 22 records.");
  assert(reference.length === 22, "Reference packet should contain 22 records.");
  assert(rows.length === 22, "Annotation template should contain 22 rows.");
  assert(new Set(blind.map((record) => record.review_item_id)).size === 22, "Blind review IDs should be unique.");
  assert(new Set(reference.map((record) => record.review_item_id)).size === 22, "Reference review IDs should be unique.");
  assert(
    blind.every((record, index) => index === 0 || record.review_item_id !== blind[index - 1].review_item_id),
    "Blind packet should have deterministic review IDs."
  );
  for (const record of blind) {
    assertBlindRecordSafe(record);
    assert(record.input_payload, "Blind packet should include synthetic input payload.");
    assert(record.parsed_model_output || record.raw_output, "Blind packet should include model output.");
  }
  assert(
    reference.every((record) => record.original_case_id && record.model_provider_prompt_metadata),
    "Reference packet should contain adjudication metadata."
  );

  await cleanupTargetedRemediationRecords(prisma);
  console.log("Targeted remediation blind export smoke test passed. No OpenAI call was made.");
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
