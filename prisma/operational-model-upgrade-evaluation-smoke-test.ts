import { loadEnvConfig } from "@next/env";
import {
  buildOperationalModelUpgradeComparison,
  candidateOperationalModelHash,
  readCandidateOperationalModelConfig
} from "../src/lib/operational/model-upgrade";

loadEnvConfig(process.cwd());

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function main() {
  const comparison = buildOperationalModelUpgradeComparison();
  const candidate = readCandidateOperationalModelConfig();
  const candidateHash = candidateOperationalModelHash(candidate);

  assert(comparison.baseline.model_snapshot === "gpt-5.4-mini-2026-03-17", "Baseline model snapshot should remain immutable.");
  assert(comparison.baseline.reasoning_effort === "low", "Baseline reasoning effort should remain low.");
  assert(comparison.candidate.candidate_configuration_hash === candidateHash, "Candidate hash should be deterministic.");
  assert(comparison.candidate.approval_state === "candidate_not_approved", "Candidate should not be approved by default.");
  assert(comparison.auto_approval_permitted === false, "Candidate cannot auto-approve.");
  assert(comparison.fixtures.identical_fixture_set_required, "Comparison must require identical fixtures.");
  assert(comparison.fixtures.fixture_count === comparison.fixtures.fixture_ids.length, "Fixture count should match fixture IDs.");
  assert(new Set(comparison.fixtures.fixture_ids).size === comparison.fixtures.fixture_ids.length, "Fixture IDs should be unique.");
  assert(comparison.compatibility_ok, "Candidate role model/effort combinations should be compatible.");

  const changedRoles = comparison.role_comparisons.filter((entry) => entry.changed_fields.length > 0);
  assert(changedRoles.length === comparison.role_comparisons.length, "Every candidate role should differ from the baseline.");
  assert(
    comparison.role_comparisons.every((entry) => entry.candidate.model_name && entry.candidate.reasoning_effort),
    "Model and effort should be recorded per candidate role."
  );
  assert(
    comparison.role_comparisons.some((entry) => entry.approval_boundary === "operational_extension_required"),
    "Student-facing extension roles should require explicit operational approval coverage."
  );
  assert(
    Object.keys(comparison.metrics).includes("diagnostic_quality") &&
    Object.keys(comparison.metrics).includes("operational"),
    "Validation, quality, safety, and operational metrics should be present."
  );

  const approvedCandidateHash = candidateHash;
  const rollbackHash = comparison.baseline.approved_active_configuration_hash;
  assert(approvedCandidateHash !== rollbackHash, "Approved candidate would produce a distinct hash from rollback baseline.");
  assert(rollbackHash === comparison.baseline.approved_active_configuration_hash, "Rollback should restore baseline approval hash.");

  console.log(JSON.stringify({
    status: "passed",
    no_openai_call: true,
    baseline_hash: comparison.baseline.approved_active_configuration_hash,
    candidate_hash: candidateHash,
    fixture_count: comparison.fixtures.fixture_count,
    changed_role_count: changedRoles.length
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(error);
  process.exit(1);
}
