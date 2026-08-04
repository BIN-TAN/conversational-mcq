import { strict as assert } from "node:assert";
import { access, readFile, readdir } from "node:fs/promises";
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

async function exists(relativePath: string) {
  try {
    await access(path.join(process.cwd(), relativePath));
    return true;
  } catch {
    return false;
  }
}

function commandSourcePath(command: unknown) {
  const match = String(command ?? "").match(/\b(prisma\/[^\s]+\.ts)\b/u);
  return match?.[1] ?? null;
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
      "LIVE_EXECUTION.md",
      "approval-evidence-placeholder.json",
      "candidate-identity.json",
      "candidate-manifest.json",
      "compiled-execution-plan.json",
      "dispatch-checkpoint-contract.json",
      "executable-evaluation-protocol.json",
      "fixture-manifest.json",
      "fixtures",
      "inherited-v14-reference.json",
      "live-environment-contract.json",
      "live-execution-authorization.json",
      "runtime-candidate-manifest.json",
      "source-configuration.json"
    ]);
    const identity = await json("candidate-identity.json");
    const candidate = await json("candidate-manifest.json");
    const protocol = await json("executable-evaluation-protocol.json");
    const plan = await json("compiled-execution-plan.json");
    const approval = await json("approval-evidence-placeholder.json");
    const inherited = await json("inherited-v14-reference.json");
    const fixture = await json("fixture-manifest.json");
    const authorization = await json("live-execution-authorization.json");
    const liveExecutionDocument = await readFile(
      path.join(ROOT, "LIVE_EXECUTION.md"),
      "utf8"
    );
    const packageJson = JSON.parse(
      await readFile(path.join(process.cwd(), "package.json"), "utf8")
    ) as { scripts?: Record<string, string> };
    const materializerSource = await readFile(
      path.join(
        process.cwd(),
        "prisma/operational-formative-conversation-v5-v15-materialize.ts"
      ),
      "utf8"
    );

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
      identity.dispatch_checkpoint_contract_hash,
      identity.security_wrapper_hash,
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
    assert.equal(
      inherited.historical_replay_gate_policy,
      "hash_reference_only_not_required_for_v15_live_readiness"
    );
    const historicalDependencies = inherited.historical_replay_dependencies;
    assert.ok(Array.isArray(historicalDependencies));
    assert.deepEqual(
      historicalDependencies.map((entry) =>
        String((entry as Record<string, unknown>).dependency_id)
      ),
      [
        "v10_profile_semantics_v8_case8_transcript",
        "opening_v3_v12_case2_transcript",
        "v14_provenance_candidate_snapshot"
      ]
    );
    for (const entry of historicalDependencies) {
      const dependency = entry as Record<string, unknown>;
      assert.equal(
        dependency.classification,
        "historical_evidence_hash_reference_only"
      );
      assert.equal(dependency.required_for_v15_live_readiness, false);
      assert.match(String(dependency.artifact_sha256), /^[a-f0-9]{64}$/u);
      assert.equal("path" in dependency, false);
      assert.equal("artifact_path" in dependency, false);
      assert.equal("local_path" in dependency, false);
    }
    assert.deepEqual(
      protocol.historical_replay_dependencies,
      historicalDependencies
    );
    assert.equal(
      protocol.historical_replay_gate_policy,
      inherited.historical_replay_gate_policy
    );
    assert.equal(
      await exists(
        "config/operational-candidates/formative-conversation-host-v5-executable-v14"
      ),
      false
    );
    assert.doesNotMatch(
      materializerSource,
      /config\/operational-candidates\/formative-conversation-host-v5-executable-v14|\.data\//u
    );
    const fixtureSources = fixture.governance_regression_sources;
    assert.ok(Array.isArray(fixtureSources));
    for (const entry of fixtureSources) {
      const relativePath = String(
        (entry as Record<string, unknown>).path ?? ""
      );
      assert.doesNotMatch(
        relativePath,
        /formative-conversation-host-v5-executable-v14|(^|\/)\.data\//u
      );
      assert.equal(await exists(relativePath), true, relativePath);
    }
    const requiredScripts = [
      "operational:formative-conversation-v5-v15-materialize",
      "operational:formative-conversation-v5-v15-smoke",
      "operational:formative-conversation-v5-v15-compilation-smoke",
      "operational:formative-conversation-v5-v15-launcher-smoke",
      "operational:formative-conversation-v5-v15-environment-parity-smoke",
      "operational:formative-conversation-v5-v15-dispatch-checkpoint-smoke",
      "operational:formative-conversation-v5-v15-security-smoke",
      "operational:formative-conversation-v5-v15-provenance-smoke",
      "operational:pilot-data-governance-v15-smoke",
      "operational:formative-conversation-transition-evidence-closure-v1-smoke"
    ];
    for (const scriptName of requiredScripts) {
      const command = packageJson.scripts?.[scriptName];
      assert.ok(command, scriptName);
      const sourcePath = commandSourcePath(command);
      assert.ok(sourcePath, scriptName);
      assert.equal(await exists(sourcePath), true, `${scriptName}:${sourcePath}`);
    }
    assert.equal(
      commandSourcePath(
        packageJson.scripts?.[
          "operational:formative-conversation-transition-evidence-closure-v1-smoke"
        ]
      ),
      "prisma/formative-conversation-v15-transition-evidence-closure-smoke-test.ts"
    );
    assert.equal(protocol.committed_source_dependency_closure_ready, true);
    assert.deepEqual(protocol.live_execution_preparation_blockers, []);
    assert.equal(candidate.committed_source_dependency_closure_ready, true);
    assert.equal(candidate.live_execution_prepared, true);
    assert.equal(protocol.live_execution_prepared, true);
    assert.equal(protocol.dispatch_checkpoint_permitted, true);
    assert.equal(authorization.live_execution_authorized, false);
    assert.match(
      String(authorization.exact_future_live_command),
      /^node --import tsx scripts\/operational-formative-conversation-v5-v15-process-local-runner\.mjs /
    );
    assert.equal(
      liveExecutionDocument.includes(
        String(authorization.exact_future_authorization_text)
      ),
      true
    );
    assert.equal(
      liveExecutionDocument.includes(
        String(authorization.exact_future_live_command)
      ),
      true
    );
    assert.equal(plan.provider_calls_during_compilation, 0);
    assert.equal(plan.network_requests_to_provider_during_compilation, 0);
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
          clean_checkout_dependency_closure_passed: true,
          v14_candidate_directory_dependency: false,
          local_data_artifact_dependency: false,
          historical_replay_dependencies:
            "hash_reference_only_not_required_for_v15_live_readiness",
          missing_required_test_references: 0,
          live_execution_prepared: true,
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
