import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { stableHash } from "../src/lib/operational/stable-hash";

const ROOT = path.resolve(
  process.cwd(),
  "config/operational-candidates/formative-conversation-host-v5-executable-v16"
);

function json(filename: string) {
  return JSON.parse(readFileSync(path.join(ROOT, filename), "utf8")) as Record<
    string,
    unknown
  >;
}

function sha256File(filename: string) {
  return createHash("sha256")
    .update(readFileSync(path.join(ROOT, filename)))
    .digest("hex");
}

function hash(value: unknown) {
  assert.match(String(value ?? ""), /^[a-f0-9]{64}$/u);
  return String(value);
}

function main() {
  const identity = json("candidate-identity.json");
  const manifest = json("candidate-manifest.json");
  const runtime = json("runtime-candidate-manifest.json");
  const protocol = json("executable-evaluation-protocol.json");
  const fixtures = json("fixture-manifest.json");
  const plan = json("compiled-execution-plan.json");
  const inherited = json("inherited-v15-reference.json");
  const approval = json("approval-evidence-placeholder.json");
  const fileSha256 = identity.file_sha256 as Record<string, string>;

  assert.equal(
    hash(identity.runtime_candidate_hash),
    hash(runtime.runtime_candidate_hash)
  );
  assert.equal(
    identity.runtime_candidate_hash,
    manifest.runtime_candidate_hash
  );
  assert.notEqual(
    identity.runtime_candidate_hash,
    inherited.base_runtime_candidate_hash,
    "V16 must have a distinct runtime identity because acceptance behavior changed."
  );
  assert.equal(identity.prompt_hash, inherited.prompt_hash);
  assert.equal(manifest.prompt_changed, false);
  assert.equal(manifest.database_schema_changed, false);
  assert.equal(manifest.export_architecture_changed, false);
  assert.equal(identity.protocol_hash, protocol.protocol_hash);
  assert.equal(identity.fixture_manifest_hash, fixtures.fixture_manifest_hash);
  assert.equal(identity.compiled_plan_hash, plan.compiled_plan_hash);
  assert.equal(identity.approval_eligible, false);
  assert.equal(identity.activation_permitted, false);
  assert.equal(identity.live_execution_prepared, true);
  assert.equal(approval.approval_eligible, false);
  assert.equal(approval.activation_permitted, false);
  assert.equal(approval.approval_evidence_created, false);
  assert.equal(identity.provider_calls, 0);
  assert.equal(identity.model_auth_requests, 0);
  assert.equal(identity.dispatch_checkpoints, 0);

  const candidateManifestBase = { ...manifest };
  delete candidateManifestBase.candidate_manifest_hash;
  assert.equal(
    hash(manifest.candidate_manifest_hash),
    stableHash(candidateManifestBase)
  );

  const expectedFiles: Record<string, string> = {
    inherited_v15_reference: "inherited-v15-reference.json",
    immutable_v15_replay_reference:
      "immutable-v15-replay-reference.json",
    runtime_candidate_manifest: "runtime-candidate-manifest.json",
    fixture_manifest: "fixture-manifest.json",
    executable_evaluation_protocol: "executable-evaluation-protocol.json",
    compiled_execution_plan: "compiled-execution-plan.json",
    live_environment_contract: "live-environment-contract.json",
    dispatch_checkpoint_contract: "dispatch-checkpoint-contract.json",
    source_configuration: "source-configuration.json",
    candidate_manifest: "candidate-manifest.json",
    approval_evidence_placeholder: "approval-evidence-placeholder.json",
    live_execution_authorization: "live-execution-authorization.json",
    live_execution_document: "LIVE_EXECUTION.md"
  };
  for (const [key, filename] of Object.entries(expectedFiles)) {
    assert.equal(fileSha256[key], sha256File(filename), `${key}:sha256`);
  }

  console.log(
    JSON.stringify(
      {
        status: "passed",
        runtime_candidate_hash: identity.runtime_candidate_hash,
        prompt_hash: identity.prompt_hash,
        protocol_hash: identity.protocol_hash,
        fixture_manifest_hash: identity.fixture_manifest_hash,
        compiled_plan_hash: identity.compiled_plan_hash,
        candidate_manifest_hash: identity.candidate_manifest_hash,
        live_execution_prepared: true,
        approval_eligible: false,
        activation_permitted: false,
        provider_calls: 0,
        model_auth_requests: 0,
        network_requests: 0,
        dispatch_checkpoints: 0
      },
      null,
      2
    )
  );
}

main();
