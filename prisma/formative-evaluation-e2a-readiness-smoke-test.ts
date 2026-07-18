import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  assertE2AReadinessAttestation,
  E2A_READINESS_REPORT_VERSION,
  E2AReadinessReportSchema
} from "../src/lib/evaluation/formative/e2a-readiness";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function errorCode(callback: () => unknown) {
  try {
    callback();
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : "unknown";
  }
}

const commit = "a".repeat(40);
const runtimeHash = "b".repeat(64);
const simulatorHash = "c".repeat(64);

function report(now: Date, ready = true) {
  return E2AReadinessReportSchema.parse({
    readiness_report_version: E2A_READINESS_REPORT_VERSION,
    generated_at: now.toISOString(),
    application_git_commit: commit,
    requested_runtime_hash: runtimeHash,
    resolved_runtime_hash: runtimeHash,
    resolution_source: "approved_derived_bundle",
    approved_bundle_complete: true,
    role_count: 17,
    simulator_configuration_hash: simulatorHash,
    simulator_model: "no-live-test-model",
    budget_limits: {
      maximum_sessions: 4,
      maximum_simulator_calls: 24,
      maximum_total_provider_calls: 150,
      maximum_total_input_tokens: 500000,
      maximum_total_output_tokens: 100000,
      maximum_cost_usd: 15
    },
    checks: { controlled_no_live_test: ready },
    blocking_reasons: ready ? [] : ["controlled_no_live_test"],
    ready,
    provider_requests: { metadata_only: 0, generation: 0 },
    secrets_printed: false
  });
}

function main() {
  const root = path.join(tmpdir(), `cmcq-e2a-readiness-${process.pid}-${Date.now()}`);
  const artifactPath = path.join(root, "e2a-readiness.json");
  mkdirSync(root, { recursive: true });
  const now = new Date();
  try {
    assert(
      errorCode(() => assertE2AReadinessAttestation({
        artifactPath,
        applicationGitCommit: commit,
        runtimeHash,
        simulatorConfigurationHash: simulatorHash,
        now
      })) === "e2a_readiness_attestation_missing_or_invalid",
      "Canary readiness must fail before an attestation exists."
    );

    writeFileSync(artifactPath, `${JSON.stringify(report(now, false), null, 2)}\n`, "utf8");
    assert(
      errorCode(() => assertE2AReadinessAttestation({
        artifactPath,
        applicationGitCommit: commit,
        runtimeHash,
        simulatorConfigurationHash: simulatorHash,
        now
      })) === "e2a_readiness_not_passed",
      "A failed readiness report must block the canary."
    );

    writeFileSync(artifactPath, `${JSON.stringify(report(now), null, 2)}\n`, "utf8");
    const accepted = assertE2AReadinessAttestation({
      artifactPath,
      applicationGitCommit: commit,
      runtimeHash,
      simulatorConfigurationHash: simulatorHash,
      now
    });
    assert(accepted.report.ready, "A complete fresh readiness report should be accepted.");
    assert(
      errorCode(() => assertE2AReadinessAttestation({
        artifactPath,
        applicationGitCommit: commit,
        runtimeHash,
        simulatorConfigurationHash: "d".repeat(64),
        now
      })) === "e2a_readiness_simulator_configuration_mismatch",
      "A different simulator configuration must block the canary."
    );
    assert(
      errorCode(() => assertE2AReadinessAttestation({
        artifactPath,
        applicationGitCommit: commit,
        runtimeHash,
        simulatorConfigurationHash: simulatorHash,
        now: new Date(now.getTime() + 5 * 60 * 60 * 1000)
      })) === "e2a_readiness_attestation_expired",
      "An expired readiness report must block the canary."
    );

    console.log(JSON.stringify({
      status: "passed",
      missing_attestation_blocks_canary: true,
      failed_readiness_blocks_canary: true,
      simulator_config_mismatch_blocks_canary: true,
      expired_readiness_blocks_canary: true,
      successful_readiness_generation_provider_calls: 0,
      openai_calls: 0
    }, null, 2));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

main();
