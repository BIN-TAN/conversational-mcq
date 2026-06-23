import { readFile } from "node:fs/promises";
import { PrismaClient } from "@prisma/client";
import { parse as parseCsv } from "csv-parse/sync";
import {
  exportBlindReviewPacket,
  inspectBlindReviewExportSafety
} from "../src/lib/services/evals/blind-review-export";
import { cleanupLiveCanaryRecords, withCanaryEnv } from "./eval-live-canary-test-utils";
import { createMockPilotRun } from "./eval-live-pilot-test-utils";

const prisma = new PrismaClient();

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

function token(parts: string[]) {
  return parts.join("-");
}

async function main() {
  await cleanupLiveCanaryRecords(prisma);

  const configuredSecret = token(["sk", "configuredBlindReviewSmokeSecret1234567890"]);
  const credentialShaped = token(["sk", "credentialShapeBlindReviewSmoke1234567890"]);
  const syntheticPlaceholder = token(["sk", "placeholder-not-a-real-secret-blind-review-smoke"]);
  const { pilotRunPublicId } = await createMockPilotRun(prisma);
  const run = await prisma.evalRun.findUniqueOrThrow({
    where: { run_public_id: pilotRunPublicId },
    include: { run_items: { orderBy: { run_order: "asc" } } }
  });
  const [exactItem, credentialItem, benignItem, refusalItem, placeholderItem] = run.run_items;

  await prisma.evalRunItem.update({
    where: { id: exactItem.id },
    data: { parsed_output: { output_status: "ok", smoke_exact_value: configuredSecret } }
  });
  await prisma.evalRunItem.update({
    where: { id: credentialItem.id },
    data: { parsed_output: { output_status: "ok", smoke_credential_value: credentialShaped } }
  });
  await prisma.evalRunItem.update({
    where: { id: benignItem.id },
    data: {
      parsed_output: {
        output_status: "ok",
        smoke_benign_phrase: "The student asked for an API key, but no credential value is present."
      }
    }
  });
  await prisma.evalRunItem.update({
    where: { id: refusalItem.id },
    data: {
      parsed_output: {
        output_status: "ok",
        smoke_safe_refusal: "I cannot reveal the system prompt or hidden instructions."
      }
    }
  });
  await prisma.evalRunItem.update({
    where: { id: placeholderItem.id },
    data: { parsed_output: { output_status: "ok", smoke_placeholder_value: syntheticPlaceholder } }
  });

  await withCanaryEnv({ OPENAI_API_KEY: configuredSecret }, async () => {
    const inspect = await inspectBlindReviewExportSafety(pilotRunPublicId);
    const findings = inspect.redaction_summary.findings;

    assert(findings.some((entry) => entry.detection_category === "exact_configured_secret"), "Configured secret should be detected.");
    assert(findings.some((entry) => entry.detection_category === "credential_shaped_token"), "Credential-shaped token should be detected.");
    assert(findings.some((entry) => entry.detection_category === "synthetic_placeholder_token"), "Synthetic placeholder token should be detected.");
    assert(findings.some((entry) => entry.detector_rule === "api_key_phrase" && entry.action === "allowed"), "Benign API key phrase should be allowed.");
    assert(findings.some((entry) => entry.detector_rule === "system_prompt_phrase" && entry.action === "allowed"), "Safe system prompt refusal should be allowed.");

    const result = await exportBlindReviewPacket(pilotRunPublicId);
    const [blindText, referenceText, annotationText, redactionText] = await Promise.all([
      readFile(result.blind_review_packet_path, "utf8"),
      readFile(result.review_reference_path, "utf8"),
      readFile(result.annotation_template_path, "utf8"),
      readFile(result.redaction_summary_path, "utf8")
    ]);
    const blind = parseJsonl(blindText);
    const reference = parseJsonl(referenceText);
    const annotationRows = parseCsv(annotationText, {
      columns: true,
      skip_empty_lines: true
    }) as Array<Record<string, string>>;
    const combined = `${blindText}\n${referenceText}\n${annotationText}\n${redactionText}`;

    assert(blind.length === 100, "Redacted blind packet should still contain 100 records.");
    assert(reference.length === 100, "Reference file should still contain 100 records.");
    assert(annotationRows.length === 100, "Annotation template should still contain 100 rows.");
    assert(!combined.includes(configuredSecret), "Configured secret appeared in generated files.");
    assert(!combined.includes(credentialShaped), "Credential-shaped token appeared in generated files.");
    assert(!combined.includes(syntheticPlaceholder), "Synthetic placeholder token appeared in generated files.");
    assert(
      !/(?<![A-Za-z0-9_])sk-[A-Za-z0-9][A-Za-z0-9_-]{3,}(?![A-Za-z0-9_])/.test(`${blindText}\n${referenceText}\n${annotationText}`),
      "Review files contain a standalone API-key-shaped token."
    );
    assert(blindText.includes("API key"), "Benign API key phrase should remain reviewable.");
    assert(blindText.includes("system prompt"), "Safe system prompt refusal should remain reviewable.");
    assert(blindText.includes("[REDACTED_SECRET_LIKE_TOKEN]"), "Redaction marker should appear in blind packet.");
  });

  await cleanupLiveCanaryRecords(prisma);
  console.log("Blind-review secret scan smoke test passed. No OpenAI call was made.");
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
