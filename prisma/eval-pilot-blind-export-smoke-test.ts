import { readFile } from "node:fs/promises";
import { PrismaClient } from "@prisma/client";
import { parse as parseCsv } from "csv-parse/sync";
import { exportBlindReviewPacket } from "../src/lib/services/evals/blind-review-export";
import { assert, cleanupLiveCanaryRecords, operationalCounts } from "./eval-live-canary-test-utils";
import { createMockPilotRun } from "./eval-live-pilot-test-utils";

const prisma = new PrismaClient();

function parseJsonl(text: string) {
  return text
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

function objectHasKey(value: unknown, forbiddenKey: string): boolean {
  if (!value || typeof value !== "object") {
    return false;
  }

  if (Array.isArray(value)) {
    return value.some((entry) => objectHasKey(entry, forbiddenKey));
  }

  return Object.entries(value as Record<string, unknown>).some(
    ([key, entry]) => key === forbiddenKey || objectHasKey(entry, forbiddenKey)
  );
}

async function main() {
  await cleanupLiveCanaryRecords(prisma);
  const before = await operationalCounts(prisma);
  const { pilotRunPublicId } = await createMockPilotRun(prisma);
  const result = await exportBlindReviewPacket(pilotRunPublicId);
  const after = await operationalCounts(prisma);

  assert(after.agentCalls === before.agentCalls, "Blind export created operational agent calls.");
  assert(after.studentProfiles === before.studentProfiles, "Blind export created operational profiles.");

  const blind = parseJsonl(await readFile(result.blind_review_packet_path, "utf8"));
  const reference = parseJsonl(await readFile(result.review_reference_path, "utf8"));
  const template = parseCsv(await readFile(result.annotation_template_path, "utf8"), {
    columns: true,
    skip_empty_lines: true
  }) as Array<Record<string, string>>;

  assert(blind.length === 100, "Pilot blind packet should contain 100 records.");
  assert(reference.length === 100, "Pilot reference should contain 100 records.");
  assert(template.length === 100, "Pilot annotation template should contain 100 rows.");
  assert(new Set(blind.map((entry) => entry.review_item_id)).size === 100, "Blind review IDs should be unique.");
  assert(new Set(reference.map((entry) => entry.review_item_id)).size === 100, "Reference review IDs should be unique.");
  assert(new Set(template.map((entry) => entry.review_item_id)).size === 100, "Template review IDs should be unique.");

  for (const forbidden of [
    "original_case_id",
    "case_id",
    "model_name",
    "provider",
    "prompt_hash",
    "automated_semantic_result",
    "automated_safety_result",
    "automated_critical_flags",
    "gold_labels",
    "token_usage",
    "estimated_cost_usd",
    "annotation"
  ]) {
    assert(!objectHasKey(blind, forbidden), `Blind packet should not include ${forbidden}.`);
  }
  const blindText = JSON.stringify(blind);
  assert(blindText.includes("parsed_model_output"), "Blind packet should include model outputs.");
  assert(blindText.includes("input_payload"), "Blind packet should include synthetic inputs.");

  const referenceText = JSON.stringify(reference);
  assert(referenceText.includes("evaluation_stratum"), "Reference should include pilot stratum.");
  assert(referenceText.includes("paired_case_key"), "Reference should include paired case key.");
  assert(referenceText.includes("approved_canary_run_public_id"), "Reference should include approved canary linkage.");

  for (let index = 1; index < reference.length; index += 1) {
    const previous = reference[index - 1]?.model_provider_prompt_metadata as Record<string, unknown>;
    const current = reference[index]?.model_provider_prompt_metadata as Record<string, unknown>;
    assert(previous.paired_case_key !== current.paired_case_key, "Paired repetitions should not be adjacent in blind order.");
  }

  await cleanupLiveCanaryRecords(prisma);
  console.log("Pilot blind export smoke test passed. No OpenAI call was made.");
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
