import { strict as assert } from "node:assert";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const ROOT = path.join(
  process.cwd(),
  "config/operational-candidates/formative-conversation-host-v5-executable-v15"
);

async function json(name: string) {
  return JSON.parse(await readFile(path.join(ROOT, name), "utf8")) as Record<
    string,
    unknown
  >;
}

async function main() {
  const originalFetch = globalThis.fetch;
  let networkRequests = 0;
  globalThis.fetch = (async () => {
    networkRequests += 1;
    throw new Error("network_forbidden");
  }) as typeof fetch;

  try {
    const files = (await readdir(ROOT)).sort();
    assert.deepEqual(files, [
      "approval-evidence-placeholder.json",
      "candidate-identity.json",
      "candidate-manifest.json",
      "compiled-execution-plan.json",
      "environment-contract.json",
      "executable-evaluation-protocol.json",
      "fixture-manifest.json",
      "inherited-v14-reference.json",
      "runtime-candidate-manifest.json",
      "source-configuration.json"
    ]);
    const identity = await json("candidate-identity.json");
    const candidate = await json("candidate-manifest.json");
    const protocol = await json("executable-evaluation-protocol.json");
    const plan = await json("compiled-execution-plan.json");
    const approval = await json("approval-evidence-placeholder.json");

    for (const value of [
      identity.runtime_candidate_hash,
      identity.prompt_hash,
      identity.protocol_hash,
      identity.runner_implementation_hash,
      identity.materializer_implementation_hash,
      identity.inherited_v14_reference_hash,
      identity.fixture_manifest_hash,
      identity.compiled_plan_hash,
      identity.environment_contract_hash,
      identity.candidate_manifest_hash
    ]) {
      assert.match(String(value), /^[a-f0-9]{64}$/u);
    }
    assert.equal(candidate.prompt_changed, false);
    assert.equal(candidate.instructional_behavior_changed, false);
    assert.equal(candidate.database_schema_changed, false);
    assert.equal(
      candidate.inherited_v14_reference_hash,
      identity.inherited_v14_reference_hash
    );
    assert.equal(
      protocol.inherited_v14_reference_hash,
      identity.inherited_v14_reference_hash
    );
    assert.equal(protocol.live_execution_prepared, false);
    assert.equal(protocol.dispatch_checkpoint_permitted, false);
    assert.equal(plan.provider_call_count, 0);
    assert.equal(plan.model_auth_request_count, 0);
    assert.equal(plan.dispatch_checkpoint_count, 0);
    assert.equal(approval.approval_evidence_created, false);
    assert.equal(identity.approval_eligible, false);
    assert.equal(identity.activation_permitted, false);
    assert.equal(networkRequests, 0);

    console.log(
      JSON.stringify(
        {
          status: "passed",
          runtime_candidate_hash: identity.runtime_candidate_hash,
          prompt_hash: identity.prompt_hash,
          protocol_hash: identity.protocol_hash,
          runner_implementation_hash: identity.runner_implementation_hash,
          fixture_manifest_hash: identity.fixture_manifest_hash,
          compiled_plan_hash: identity.compiled_plan_hash,
          environment_contract_hash: identity.environment_contract_hash,
          candidate_manifest_hash: identity.candidate_manifest_hash,
          approval_eligible: false,
          activation_permitted: false,
          provider_calls: 0,
          model_auth_requests: 0,
          network_requests: networkRequests,
          dispatch_checkpoints: 0
        },
        null,
        2
      )
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
}

void main();
