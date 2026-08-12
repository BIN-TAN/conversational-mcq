import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync
} from "node:fs";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import {
  assertFormativeConversationV17IntendedArtifactCoverage,
  FORMATIVE_CONVERSATION_V5_INTENDED_ARTIFACTS
} from "../src/lib/operational/formative-conversation-v5-evaluation-v17/contracts";
import {
  assertFormativeConversationV17ScanCoverage,
  createFormativeConversationV17FinalizedManifest,
  FORMATIVE_CONVERSATION_V17_CONTROL_SCHEMA_VERSION,
  FORMATIVE_CONVERSATION_V17_DATA_ROOT,
  FORMATIVE_CONVERSATION_V17_RELEASE_ROOT,
  FORMATIVE_CONVERSATION_V17_STAGING_ROOT,
  releaseFormativeConversationV17Artifacts,
  scanFormativeConversationV17BufferedOutputs,
  type FormativeConversationV17ControlPayload
} from "../src/lib/operational/formative-conversation-v5-evaluation-v17/security-release";

const secret = "v17-deterministic-secret-value-123456789";
const safe = scanFormativeConversationV17BufferedOutputs({
  exact_secret_values: [secret],
  buffered_outputs: [
    JSON.stringify({
      status: "passed",
      secret_values_recorded: false,
      provider_calls: 0
    })
  ]
});
assert.equal(safe.exact_match_count, 0);
assert.equal(safe.generic_credential_pattern_match_count, 0);
assert.throws(
  () =>
    scanFormativeConversationV17BufferedOutputs({
      exact_secret_values: [secret],
      buffered_outputs: [`unsafe:${secret}`]
    }),
  /formative_conversation_v17_secret_match_detected/
);
assert.throws(
  () =>
    scanFormativeConversationV17BufferedOutputs({
      exact_secret_values: [secret],
      buffered_outputs: ["OPENAI_API_KEY=sk-unsafe-example-1234567890"]
    }),
  /formative_conversation_v17_secret_match_detected/
);
assert.doesNotThrow(() =>
  assertFormativeConversationV17ScanCoverage({
    expected_regular_file_count: 4,
    actual_regular_file_count: 4,
    expected_zip_file_count: 1,
    actual_zip_file_count: 1,
    expected_uncompressed_zip_entry_count: 3,
    actual_uncompressed_zip_entry_count: 3
  })
);
assert.throws(
  () =>
    assertFormativeConversationV17ScanCoverage({
      expected_regular_file_count: 4,
      actual_regular_file_count: 3,
      expected_zip_file_count: 1,
      actual_zip_file_count: 1,
      expected_uncompressed_zip_entry_count: 3,
      actual_uncompressed_zip_entry_count: 3
    }),
  /formative_conversation_v17_scan_coverage_mismatch/
);
assert.doesNotThrow(() =>
  assertFormativeConversationV17IntendedArtifactCoverage({
    generated_artifacts: FORMATIVE_CONVERSATION_V5_INTENDED_ARTIFACTS.filter(
      (artifact) =>
        artifact !== "finalized-artifact-manifest.json" &&
        artifact !== "artifact-scan-attestation.json"
    ),
    deferred_artifacts: [
      "finalized-artifact-manifest.json",
      "artifact-scan-attestation.json"
    ]
  })
);
assert.throws(
  () =>
    assertFormativeConversationV17IntendedArtifactCoverage({
      generated_artifacts: FORMATIVE_CONVERSATION_V5_INTENDED_ARTIFACTS.filter(
        (artifact) =>
          artifact !== "teacher-export-consistency.json" &&
          artifact !== "finalized-artifact-manifest.json" &&
          artifact !== "artifact-scan-attestation.json"
      ),
      deferred_artifacts: [
        "finalized-artifact-manifest.json",
        "artifact-scan-attestation.json"
      ]
    }),
  /formative_conversation_v17_intended_artifact_missing/
);
function ownerOnlyDirectory(directoryPath: string) {
  mkdirSync(directoryPath, { recursive: true, mode: 0o700 });
  chmodSync(directoryPath, 0o700);
}

async function zipBuffer(content: string) {
  const zip = new JSZip();
  zip.file("entries/evidence.txt", content);
  return zip.generateAsync({ type: "nodebuffer" });
}

async function releaseFixture(zipContent: string) {
  const workspaceRoot = realpathSync(
    mkdtempSync(path.join(os.tmpdir(), "fcv5-v17-security-"))
  );
  const nonce = randomUUID().replaceAll("-", "");
  const packageId = `fcv5v17_provider_security_${nonce}`;
  const stagingBase = path.join(
    workspaceRoot,
    FORMATIVE_CONVERSATION_V17_STAGING_ROOT,
    nonce
  );
  const stagingRoot = path.join(stagingBase, packageId);
  const releaseRoot = path.join(
    workspaceRoot,
    FORMATIVE_CONVERSATION_V17_RELEASE_ROOT,
    packageId
  );
  ownerOnlyDirectory(path.join(workspaceRoot, FORMATIVE_CONVERSATION_V17_DATA_ROOT));
  ownerOnlyDirectory(stagingBase);
  ownerOnlyDirectory(stagingRoot);
  writeFileSync(path.join(stagingRoot, "artifact.json"), '{"status":"safe"}\n', {
    mode: 0o600
  });
  writeFileSync(path.join(stagingRoot, "research-export.zip"), await zipBuffer(zipContent), {
    mode: 0o600
  });
  const finalized = await createFormativeConversationV17FinalizedManifest({
    staging_root: stagingRoot,
    package_id: packageId
  });
  const control: FormativeConversationV17ControlPayload = {
    schema_version: FORMATIVE_CONVERSATION_V17_CONTROL_SCHEMA_VERSION,
    record_type: "finalized_artifact_package",
    evaluation_revision: "formative-conversation-host-v5-executable-v17",
    control_nonce: nonce,
    mode: "live",
    staging_root: stagingRoot,
    release_root: releaseRoot,
    artifact_manifest_path: finalized.manifest_path,
    artifact_manifest_sha256: finalized.manifest_sha256,
    artifacts_finalized_at: new Date().toISOString(),
    provider_run_id: packageId,
    derived_evaluation_id: `fcv5v17_derived_security_${nonce}`
  };
  return { workspaceRoot, stagingRoot, releaseRoot, control };
}

async function verifyPreventiveRelease() {
  const clean = await releaseFixture("safe synthetic export entry");
  const cleanSecrets = ["v17-release-secret-clean-123456789"];
  try {
    const report = await releaseFormativeConversationV17Artifacts({
      workspace_root: clean.workspaceRoot,
      control: clean.control,
      exact_secret_values: cleanSecrets,
      buffered_outputs: ["safe stdout", "safe stderr"],
      clear_exact_secrets: () => {
        cleanSecrets.fill("");
      }
    });
    assert.equal(report.status, "released");
    assert.equal(report.atomic_release_completed, true);
    assert.equal(report.secrets_cleared_before_release, true);
    assert.equal(report.expected_uncompressed_zip_entry_count, 1);
    assert.equal(report.actual_uncompressed_zip_entry_count, 1);
    assert.equal(existsSync(clean.releaseRoot), true);
    assert.equal(existsSync(clean.stagingRoot), false);
  } finally {
    rmSync(clean.workspaceRoot, { recursive: true, force: true });
  }

  const zipSecret = "v17-zip-entry-secret-123456789";
  const blocked = await releaseFixture(zipSecret);
  const blockedSecrets = [zipSecret];
  try {
    await assert.rejects(
      () =>
        releaseFormativeConversationV17Artifacts({
          workspace_root: blocked.workspaceRoot,
          control: blocked.control,
          exact_secret_values: blockedSecrets,
          buffered_outputs: ["safe stdout"],
          clear_exact_secrets: () => {
            blockedSecrets.fill("");
          }
        }),
      /formative_conversation_v17_secret_match_detected/
    );
    assert.equal(existsSync(blocked.releaseRoot), false);
    assert.deepEqual(blockedSecrets, [""]);
  } finally {
    rmSync(blocked.workspaceRoot, { recursive: true, force: true });
  }
}

verifyPreventiveRelease()
  .then(() => {
    console.log(
      JSON.stringify({
        status: "passed",
        exact_secret_scan: "passed",
        credential_pattern_scan: "passed",
        artifact_coverage_check: "passed",
        intended_artifact_contract_check: "passed",
        finalized_manifest_release: "passed",
        uncompressed_zip_entry_scan: "passed",
        secret_clear_before_release: "passed",
        provider_calls: 0,
        model_auth_requests: 0,
        dispatch_checkpoints: 0
      })
    );
  })
  .catch((error) => {
    console.error(
      JSON.stringify({
        status: "failed",
        error_code: error instanceof Error ? error.message : String(error),
        provider_calls: 0,
        model_auth_requests: 0,
        dispatch_checkpoints: 0
      })
    );
    process.exitCode = 1;
  });
