import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import {
  assertLlmFirstCbaAuditArtifactIsSafe,
  buildLlmFirstCbaSystemAuditArtifact,
  writeLlmFirstCbaSystemAuditArtifact,
  type LlmFirstCbaAuditArtifact
} from "../src/lib/services/llm-first-cba-system-audit";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function assertNoProtectedContent(value: unknown) {
  const serialized = JSON.stringify(value);
  const forbidden = [
    /sk-(?:proj|svcacct)-[A-Za-z0-9_-]{20,}/u,
    /DATABASE_URL\s*=/iu,
    /SESSION_SECRET\s*=/iu,
    /OPENAI_API_KEY\s*=/iu,
    /"correct_option_snapshot"\s*:/u,
    /"raw_output"\s*:/u,
    /"input_payload"\s*:/u,
    /raw provider output/iu,
    /"raw_student_response"\s*:/iu
  ];

  for (const pattern of forbidden) {
    assert(!pattern.test(serialized), `Audit artifact leaked protected content matching ${pattern.source}.`);
  }
}

async function main() {
  process.env.LLM_PROVIDER = "mock";
  process.env.LLM_LIVE_CALLS_ENABLED = "false";

  const beforeProviderFlag = process.env.LLM_PROVIDER;
  const artifact = buildLlmFirstCbaSystemAuditArtifact("2026-07-10T00:00:00.000Z");
  assert(artifact.openai_calls_made === 0, "Audit artifact should record zero OpenAI calls.");
  assert(artifact.production_rows_modified === false, "Audit should not modify production rows.");
  assert(artifact.agent_inventory.length >= 6, "Required agent inventory is missing.");
  assert(
    Object.keys(artifact.assessment_context_inventory).includes("assessment_diagnostic_focus"),
    "Assessment context inventory should include diagnostic focus."
  );
  assert(
    Object.keys(artifact.boundary_inventory).includes("answer_key_protection"),
    "Boundary inventory should include answer-key protection."
  );
  assert(artifact.findings.length >= 5, "Audit findings should be present.");
  assert(
    artifact.findings.every((finding) => finding.severity && finding.code_evidence.length > 0),
    "Every finding should include severity and evidence."
  );
  assert(artifact.p1_finding_ids.length >= 1, "Audit should identify P1 findings.");
  assertLlmFirstCbaAuditArtifactIsSafe(artifact);
  assertNoProtectedContent(artifact);

  const outputDir = path.join(process.cwd(), ".data", "llm-first-cba-system-audit-smoke");
  await rm(outputDir, { recursive: true, force: true });
  const written = await writeLlmFirstCbaSystemAuditArtifact({
    outputDir,
    generatedAt: "2026-07-10T00:00:01.000Z"
  });
  const parsed = JSON.parse(await readFile(written.file_path, "utf8")) as LlmFirstCbaAuditArtifact;
  assert(parsed.artifact_hash === written.artifact.artifact_hash, "Written artifact hash mismatch.");
  assertNoProtectedContent(parsed);
  assert(process.env.LLM_PROVIDER === beforeProviderFlag, "Audit smoke should not alter provider configuration.");

  console.log(JSON.stringify({
    status: "passed",
    audit_version: artifact.audit_version,
    agent_inventory_count: artifact.agent_inventory.length,
    finding_count: artifact.findings.length,
    p0_finding_ids: artifact.p0_finding_ids,
    p1_finding_ids: artifact.p1_finding_ids,
    artifact_path: written.file_path,
    openai_calls_made: 0
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
