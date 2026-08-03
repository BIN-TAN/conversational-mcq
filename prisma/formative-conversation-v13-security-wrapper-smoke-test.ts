import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  readdirSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import {
  assertFormativeConversationV13ScanCoverage,
  assertFormativeConversationV13LiveControlEnvironment,
  createFormativeConversationV13ControlChannel,
  createFormativeConversationV13FinalizedManifest,
  FORMATIVE_CONVERSATION_V13_ATTESTATION_FILENAME,
  FORMATIVE_CONVERSATION_V13_CONTROL_SCHEMA_VERSION,
  FORMATIVE_CONVERSATION_V13_DATA_ROOT,
  FORMATIVE_CONVERSATION_V13_FAILURE_ROOT,
  FORMATIVE_CONVERSATION_V13_RELEASE_ROOT,
  FORMATIVE_CONVERSATION_V13_STAGING_ROOT,
  readFormativeConversationV13ControlPayload,
  releaseFormativeConversationV13Artifacts,
  removeFormativeConversationV13ControlChannel,
  type FormativeConversationV13ControlPayload,
  writeFormativeConversationV13ControlPayload
} from "../src/lib/operational/formative-conversation-v5-evaluation-v13/security-release";

const V10_OBSERVED_NON_JSON_PREFIX_CONDITION =
  "jq: parse error: Invalid numeric literal at line 1, column 7";

function sha256(value: Buffer | string) {
  return createHash("sha256").update(value).digest("hex");
}

function mkdirOwnerOnly(directoryPath: string) {
  mkdirSync(directoryPath, { recursive: true, mode: 0o700 });
  chmodSync(directoryPath, 0o700);
}

async function zipBuffer(content = "safe zip entry") {
  const zip = new JSZip();
  zip.file("entries/evidence.txt", content);
  return zip.generateAsync({ type: "nodebuffer" });
}

type Fixture = Awaited<ReturnType<typeof createFixture>>;

async function createFixture(input?: {
  regular_content?: string;
  zip_content?: string;
}) {
  const workspaceRoot = realpathSync(
    mkdtempSync(path.join(os.tmpdir(), "fcv5-v13-security-"))
  );
  const dataRoot = path.join(workspaceRoot, FORMATIVE_CONVERSATION_V13_DATA_ROOT);
  const stagingBoundary = path.join(
    workspaceRoot,
    FORMATIVE_CONVERSATION_V13_STAGING_ROOT
  );
  const releaseBoundary = path.join(
    workspaceRoot,
    FORMATIVE_CONVERSATION_V13_RELEASE_ROOT
  );
  const nonce = randomUUID().replaceAll("-", "");
  const stagingBase = path.join(stagingBoundary, nonce);
  const packageId = `fcv5v13_provider_security_${nonce}`;
  const stagingRoot = path.join(stagingBase, packageId);
  const releaseRoot = path.join(releaseBoundary, packageId);
  mkdirOwnerOnly(dataRoot);
  mkdirOwnerOnly(stagingBoundary);
  mkdirOwnerOnly(stagingBase);
  mkdirOwnerOnly(stagingRoot);
  writeFileSync(
    path.join(stagingRoot, "artifact.json"),
    input?.regular_content ?? '{"status":"safe"}\n',
    { mode: 0o600 }
  );
  writeFileSync(
    path.join(stagingRoot, "research-export.zip"),
    await zipBuffer(input?.zip_content),
    { mode: 0o600 }
  );
  const finalized = await createFormativeConversationV13FinalizedManifest({
    staging_root: stagingRoot,
    package_id: packageId
  });
  const control: FormativeConversationV13ControlPayload = {
    schema_version: FORMATIVE_CONVERSATION_V13_CONTROL_SCHEMA_VERSION,
    record_type: "finalized_artifact_package",
    evaluation_revision: "formative-conversation-host-v5-executable-v13",
    control_nonce: nonce,
    mode: "live",
    staging_root: stagingRoot,
    release_root: releaseRoot,
    artifact_manifest_path: finalized.manifest_path,
    artifact_manifest_sha256: finalized.manifest_sha256,
    artifacts_finalized_at: new Date().toISOString(),
    provider_run_id: packageId,
    derived_evaluation_id: `fcv5v13_derived_security_${nonce}`
  };
  const exactSecret = `v13-exact-secret-${nonce}`;
  return {
    workspaceRoot,
    dataRoot,
    stagingBoundary,
    stagingBase,
    stagingRoot,
    releaseRoot,
    packageId,
    nonce,
    manifestPath: finalized.manifest_path,
    control,
    exactSecret
  };
}

function cleanup(fixture: Fixture) {
  rmSync(fixture.workspaceRoot, { recursive: true, force: true });
}

async function expectReject(
  action: () => Promise<unknown>,
  expectedCode: string
) {
  await assert.rejects(action, (error: unknown) => {
    assert.equal(error instanceof Error, true);
    assert.equal((error as Error).message, expectedCode);
    return true;
  });
}

async function release(
  fixture: Fixture,
  input?: {
    outputs?: string[];
    secrets?: string[];
    hooks?: Parameters<typeof releaseFormativeConversationV13Artifacts>[0]["hooks"];
  }
) {
  const secrets = input?.secrets ?? [fixture.exactSecret];
  return releaseFormativeConversationV13Artifacts({
    workspace_root: fixture.workspaceRoot,
    control: fixture.control,
    exact_secret_values: secrets,
    buffered_outputs: input?.outputs ?? ["ordinary stdout\n", "ordinary stderr\n"],
    clear_exact_secrets: () => {
      for (let index = 0; index < secrets.length; index += 1) {
        secrets[index] = "";
      }
    },
    hooks: input?.hooks
  });
}

function failureRecords(fixture: Fixture) {
  const root = path.join(fixture.workspaceRoot, FORMATIVE_CONVERSATION_V13_FAILURE_ROOT);
  return existsSync(root) ? readdirSync(root) : [];
}

async function testCleanAndMixedStdout() {
  const clean = await createFixture();
  try {
    const report = await release(clean, { outputs: ["clean stdout", ""] });
    assert.equal(report.status, "released");
    assert.equal(report.buffered_outputs_checked, 2);
  } finally {
    cleanup(clean);
  }

  const mixed = await createFixture();
  try {
    const report = await release(mixed, {
      outputs: [
        [
          V10_OBSERVED_NON_JSON_PREFIX_CONDITION,
          "ordinary log before the machine-control file",
          '{"human_readable_result":true}',
          "ordinary multiline log after finalization"
        ].join("\n"),
        "diagnostic line one\ndiagnostic line two"
      ]
    });
    assert.equal(report.status, "released");
    assert.equal(report.atomic_release_completed, true);
  } finally {
    cleanup(mixed);
  }
}

async function testControlChannelValidation() {
  const channel = await createFormativeConversationV13ControlChannel();
  const fixture = await createFixture();
  try {
    await expectReject(
      () =>
        readFormativeConversationV13ControlPayload({
          control_path: channel.control_path,
          expected_nonce: channel.control_nonce
        }),
      "formative_conversation_v13_control_payload_missing"
    );
    writeFileSync(channel.control_path, "not-json\n", { mode: 0o600 });
    await expectReject(
      () =>
        readFormativeConversationV13ControlPayload({
          control_path: channel.control_path,
          expected_nonce: channel.control_nonce
        }),
      "formative_conversation_v13_control_payload_malformed"
    );
    unlinkSync(channel.control_path);
    const payload = {
      ...fixture.control,
      control_nonce: channel.control_nonce
    };
    writeFileSync(
      channel.control_path,
      `${JSON.stringify(payload)}\n${JSON.stringify(payload)}\n`,
      { mode: 0o600 }
    );
    await expectReject(
      () =>
        readFormativeConversationV13ControlPayload({
          control_path: channel.control_path,
          expected_nonce: channel.control_nonce
        }),
      "formative_conversation_v13_control_payload_duplicate"
    );
    unlinkSync(channel.control_path);
    await writeFormativeConversationV13ControlPayload({
      control_path: channel.control_path,
      payload
    });
    const read = await readFormativeConversationV13ControlPayload({
      control_path: channel.control_path,
      expected_nonce: channel.control_nonce
    });
    assert.deepEqual(read, payload);
    await expectReject(
      () =>
        readFormativeConversationV13ControlPayload({
          control_path: channel.control_path,
          expected_nonce: "f".repeat(32)
        }),
      "formative_conversation_v13_control_payload_conflicting"
    );
    await expectReject(
      () =>
        writeFormativeConversationV13ControlPayload({
          control_path: channel.control_path,
          payload
        }),
      "formative_conversation_v13_control_payload_duplicate"
    );
  } finally {
    await removeFormativeConversationV13ControlChannel({
      control_path: channel.control_path,
      control_directory: channel.directory
    });
    assert.equal(existsSync(channel.directory), false);
    cleanup(fixture);
  }
}

async function testLiveControlEnvironmentBoundary() {
  const fixture = await createFixture();
  const controlDirectory = path.join(fixture.workspaceRoot, "owner-control");
  const controlPath = path.join(controlDirectory, "artifact-control.jsonl");
  mkdirOwnerOnly(controlDirectory);
  try {
    await expectReject(
      () =>
        assertFormativeConversationV13LiveControlEnvironment({
          workspace_root: fixture.workspaceRoot,
          env: { NODE_ENV: "test" }
        }),
      "formative_conversation_v13_control_channel_not_configured"
    );
    const env: NodeJS.ProcessEnv = {
      NODE_ENV: "test",
      FORMATIVE_CONVERSATION_V5_V13_CONTROL_PATH: controlPath,
      FORMATIVE_CONVERSATION_V5_V13_CONTROL_NONCE: fixture.nonce,
      FORMATIVE_CONVERSATION_V5_V13_STAGING_BASE_ROOT: fixture.stagingBase
    };
    const validated =
      await assertFormativeConversationV13LiveControlEnvironment({
        workspace_root: fixture.workspaceRoot,
        env
      });
    assert.equal(validated.control_path, controlPath);
    writeFileSync(controlPath, "{}\n", { mode: 0o600 });
    await expectReject(
      () =>
        assertFormativeConversationV13LiveControlEnvironment({
          workspace_root: fixture.workspaceRoot,
          env
        }),
      "formative_conversation_v13_control_payload_duplicate"
    );
  } finally {
    cleanup(fixture);
  }
}

async function testContainmentAndSymlinks() {
  const traversal = await createFixture();
  try {
    traversal.control.staging_root = `${traversal.stagingRoot}/../${traversal.packageId}`;
    await expectReject(
      () => release(traversal),
      "formative_conversation_v13_control_path_not_canonical"
    );
    assert.equal(existsSync(traversal.releaseRoot), false);
  } finally {
    cleanup(traversal);
  }

  const symlink = await createFixture();
  try {
    const artifactPath = path.join(symlink.stagingRoot, "artifact.json");
    const externalPath = path.join(symlink.workspaceRoot, "external.json");
    writeFileSync(externalPath, '{"status":"safe"}\n');
    unlinkSync(artifactPath);
    symlinkSync(externalPath, artifactPath);
    await expectReject(
      () => release(symlink),
      "formative_conversation_v13_symlink_detected"
    );
    assert.equal(existsSync(symlink.releaseRoot), false);
  } finally {
    cleanup(symlink);
  }
}

async function testManifestCoverageFailures() {
  const missing = await createFixture();
  try {
    unlinkSync(path.join(missing.stagingRoot, "artifact.json"));
    await expectReject(
      () => release(missing),
      "formative_conversation_v13_unexpected_or_missing_artifact"
    );
    assert.equal(failureRecords(missing).length, 1);
  } finally {
    cleanup(missing);
  }

  const unexpected = await createFixture();
  try {
    writeFileSync(path.join(unexpected.stagingRoot, "late.json"), "{}\n");
    await expectReject(
      () => release(unexpected),
      "formative_conversation_v13_unexpected_or_missing_artifact"
    );
  } finally {
    cleanup(unexpected);
  }

  assert.throws(
    () =>
      assertFormativeConversationV13ScanCoverage({
        expected_regular_file_count: 2,
        actual_regular_file_count: 0,
        expected_zip_file_count: 1,
        actual_zip_file_count: 0,
        expected_uncompressed_zip_entry_count: 1,
        actual_uncompressed_zip_entry_count: 0
      }),
    /formative_conversation_v13_zero_scan_coverage/
  );

  const zipCoverage = await createFixture();
  try {
    const manifest = JSON.parse(readFileSync(zipCoverage.manifestPath, "utf8")) as {
      artifacts: Array<{ kind: string; zip_entries: unknown[] }>;
      expected_uncompressed_zip_entry_count: number;
    };
    const zip = manifest.artifacts.find((entry) => entry.kind === "zip");
    assert.ok(zip);
    zip.zip_entries = [];
    manifest.expected_uncompressed_zip_entry_count = 0;
    writeFileSync(zipCoverage.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    zipCoverage.control.artifact_manifest_sha256 = sha256(
      readFileSync(zipCoverage.manifestPath)
    );
    await expectReject(
      () => release(zipCoverage),
      "formative_conversation_v13_zip_entry_coverage_mismatch"
    );
  } finally {
    cleanup(zipCoverage);
  }
}

async function testSecretDetection() {
  for (const location of ["regular", "zip"] as const) {
    const secret = `v13-leak-${randomUUID().replaceAll("-", "")}`;
    const fixture = await createFixture(
      location === "regular"
        ? { regular_content: `unsafe ${secret}` }
        : { zip_content: `unsafe ${secret}` }
    );
    try {
      await expectReject(
        () => release(fixture, { secrets: [secret] }),
        "formative_conversation_v13_secret_match_detected"
      );
      assert.equal(existsSync(fixture.releaseRoot), false);
      assert.equal(failureRecords(fixture).length, 1);
    } finally {
      cleanup(fixture);
    }
  }

  for (const location of ["regular", "zip"] as const) {
    const credential = "password=abcdefghijklmnop";
    const fixture = await createFixture(
      location === "regular"
        ? { regular_content: credential }
        : { zip_content: credential }
    );
    try {
      await expectReject(
        () => release(fixture),
        "formative_conversation_v13_secret_match_detected"
      );
      assert.equal(existsSync(fixture.releaseRoot), false);
    } finally {
      cleanup(fixture);
    }
  }
}

async function testMutationAndFinalizationOrdering() {
  const late = await createFixture();
  try {
    await expectReject(
      () =>
        release(late, {
          hooks: {
            after_initial_enumeration: () => {
              writeFileSync(path.join(late.stagingRoot, "after-enumeration.json"), "{}\n");
            }
          }
        }),
      "formative_conversation_v13_artifact_created_after_enumeration"
    );
    assert.equal(existsSync(late.releaseRoot), false);
  } finally {
    cleanup(late);
  }

  const mutated = await createFixture();
  try {
    await expectReject(
      () =>
        release(mutated, {
          hooks: {
            before_manifest_recheck: () => {
              const content = readFileSync(mutated.manifestPath, "utf8");
              writeFileSync(mutated.manifestPath, `${content} `);
            }
          }
        }),
      "formative_conversation_v13_manifest_mutated_during_scan"
    );
  } finally {
    cleanup(mutated);
  }

  const clearedEarly = await createFixture();
  try {
    await expectReject(
      () => release(clearedEarly, { secrets: [""] }),
      "formative_conversation_v13_exact_secrets_unavailable"
    );
  } finally {
    cleanup(clearedEarly);
  }

  const clearedDuringScan = await createFixture();
  try {
    const secrets = [clearedDuringScan.exactSecret];
    await expectReject(
      () =>
        release(clearedDuringScan, {
          secrets,
          hooks: {
            before_attestation: () => {
              secrets[0] = "";
            }
          }
        }),
      "formative_conversation_v13_exact_secrets_unavailable"
    );
    assert.equal(existsSync(clearedDuringScan.releaseRoot), false);
  } finally {
    cleanup(clearedDuringScan);
  }

  const attestationFailure = await createFixture();
  try {
    await expectReject(
      () =>
        release(attestationFailure, {
          hooks: {
            before_attestation: () => {
              throw new Error("simulated_attestation_failure");
            }
          }
        }),
      "formative_conversation_v13_preventive_release_failed"
    );
    assert.equal(existsSync(attestationFailure.releaseRoot), false);
    assert.equal(failureRecords(attestationFailure).length, 1);
  } finally {
    cleanup(attestationFailure);
  }
}

async function testSuccessfulAtomicReleaseAndAttestation() {
  const fixture = await createFixture();
  try {
    const manifest = JSON.parse(readFileSync(fixture.manifestPath, "utf8")) as {
      artifacts: Array<{ path: string; sha256: string }>;
    };
    let releaseBoundaryObserved = false;
    const secretHash = sha256(fixture.exactSecret);
    const report = await release(fixture, {
      hooks: {
        before_release: (state) => {
          assert.equal(state.secrets_cleared, true);
          assert.equal(state.attestation_complete, true);
          assert.equal(existsSync(fixture.releaseRoot), false);
          releaseBoundaryObserved = true;
        }
      }
    });
    assert.equal(releaseBoundaryObserved, true);
    assert.equal(existsSync(fixture.stagingRoot), false);
    assert.equal(existsSync(fixture.releaseRoot), true);
    assert.equal(report.secrets_cleared_before_release, true);
    for (const artifact of manifest.artifacts) {
      assert.equal(
        sha256(readFileSync(path.join(fixture.releaseRoot, artifact.path))),
        artifact.sha256
      );
    }
    const attestationText = readFileSync(
      path.join(fixture.releaseRoot, FORMATIVE_CONVERSATION_V13_ATTESTATION_FILENAME),
      "utf8"
    );
    assert.equal(attestationText.includes(fixture.exactSecret), false);
    assert.equal(attestationText.includes(secretHash), false);
    const attestation = JSON.parse(attestationText) as {
      payload: {
        secret_values_recorded: boolean;
        secret_hashes_or_fingerprints_recorded: boolean;
        exact_secret_count_checked: number;
      };
    };
    assert.equal(attestation.payload.secret_values_recorded, false);
    assert.equal(attestation.payload.secret_hashes_or_fingerprints_recorded, false);
    assert.equal(attestation.payload.exact_secret_count_checked, 1);
  } finally {
    cleanup(fixture);
  }
}

async function main() {
  await testCleanAndMixedStdout();
  await testControlChannelValidation();
  await testLiveControlEnvironmentBoundary();
  await testContainmentAndSymlinks();
  await testManifestCoverageFailures();
  await testSecretDetection();
  await testMutationAndFinalizationOrdering();
  await testSuccessfulAtomicReleaseAndAttestation();
  console.log(
    JSON.stringify(
      {
        status: "passed",
        suite: "formative-conversation-v13-security-wrapper",
        control_channel_cases: 9,
        preventive_release_cases: 18,
        exact_v10_mixed_stdout_condition_covered: true,
        provider_calls: 0,
        model_auth_requests: 0,
        dispatch_checkpoints: 0
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
