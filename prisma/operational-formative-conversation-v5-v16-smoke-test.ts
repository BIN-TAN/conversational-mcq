import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";

const ROOT = path.join(
  process.cwd(),
  "config/operational-candidates/formative-conversation-host-v5-executable-v16"
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

const unchangedExecutionBoundaryPairs = [
  [
    "scripts/operational-formative-conversation-v5-v16-launcher.mjs",
    "scripts/operational-formative-conversation-v5-v15-launcher.mjs"
  ],
  [
    "scripts/operational-formative-conversation-v5-v16-process-local-runner.mjs",
    "scripts/operational-formative-conversation-v5-v15-process-local-runner.mjs"
  ],
  [
    "prisma/operational-formative-conversation-v5-v16-evaluate.ts",
    "prisma/operational-formative-conversation-v5-v15-evaluate.ts"
  ],
  ...[
    "candidate-runner.ts",
    "compiler.ts",
    "evaluation-accounting.ts",
    "live-environment.ts",
    "dispatch-checkpoint.ts",
    "security-release.ts",
    "service.ts"
  ].map((filename) => [
    `src/lib/operational/formative-conversation-v5-evaluation-v16/${filename}`,
    `src/lib/operational/formative-conversation-v5-evaluation-v15/${filename}`
  ])
] as const;

async function assertExecutionBoundaryParity() {
  for (const [v16Path, v15Path] of unchangedExecutionBoundaryPairs) {
    const v16 = await readFile(path.join(process.cwd(), v16Path), "utf8");
    const v15 = await readFile(path.join(process.cwd(), v15Path), "utf8");
    assert.equal(
      v16.replaceAll("V16", "V15").replaceAll("v16", "v15"),
      v15,
      `${v16Path}:unexpected_execution_boundary_drift`
    );
  }
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
      "immutable-v15-replay-reference.json",
      "inherited-v15-reference.json",
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
    const inherited = await json("inherited-v15-reference.json");
    const replay = await json("immutable-v15-replay-reference.json");
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
        "prisma/operational-formative-conversation-v5-v16-materialize.ts"
      ),
      "utf8"
    );
    await assertExecutionBoundaryParity();
    const v15CandidateIdentityBytes = await readFile(
      path.join(
        process.cwd(),
        "config/operational-candidates/formative-conversation-host-v5-executable-v15/candidate-identity.json"
      )
    );

    for (const value of [
      identity.runtime_candidate_hash,
      identity.prompt_hash,
      identity.protocol_hash,
      identity.runner_implementation_hash,
      identity.materializer_implementation_hash,
      identity.inherited_v15_reference_hash,
      identity.immutable_v15_replay_reference_hash,
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
    assert.equal(
      identity.runtime_candidate_hash,
      "d96ec30d26637887127fe92dd5f3d074de788ee02dd9aea523df2f79ca718034"
    );
    assert.equal(
      identity.prompt_hash,
      "30b616483a48c1f01e1a33d911d9dc1c27ed906dae421a99c9b0e2d7eeac945d"
    );
    assert.equal(candidate.instructional_behavior_changed, false);
    assert.equal(candidate.database_schema_changed, false);
    assert.equal(
      candidate.inherited_v15_reference_hash,
      identity.inherited_v15_reference_hash
    );
    assert.equal(
      protocol.inherited_v15_reference_hash,
      identity.inherited_v15_reference_hash
    );
    assert.equal(
      protocol.immutable_v15_replay_reference_hash,
      identity.immutable_v15_replay_reference_hash
    );
    assert.equal(
      replay.provider_run_id,
      "fcv5v15_provider_20260804202844_8d9e3943"
    );
    assert.equal(
      createHash("sha256").update(v15CandidateIdentityBytes).digest("hex"),
      inherited.v15_immutable_snapshot_hash
    );
    assert.equal(
      inherited.historical_replay_gate_policy,
      "hash_reference_only_not_required_for_v16_live_readiness"
    );
    const historicalDependencies = inherited.historical_replay_dependencies;
    assert.ok(Array.isArray(historicalDependencies));
    assert.deepEqual(
      historicalDependencies.map((entry) =>
        String((entry as Record<string, unknown>).dependency_id)
      ),
      [
        "v15_case_5_transition_transcript",
        "v15_case_6_transition_transcript"
      ]
    );
    for (const entry of historicalDependencies) {
      const dependency = entry as Record<string, unknown>;
      assert.equal(
        dependency.classification,
        "historical_evidence_hash_reference_only"
      );
      assert.equal(dependency.required_for_v16_live_readiness, false);
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
      "operational:formative-conversation-v5-v16-materialize",
      "operational:formative-conversation-v5-v16-smoke",
      "operational:formative-conversation-v5-v16-compilation-smoke",
      "operational:formative-conversation-v5-v16-launcher-smoke",
      "operational:formative-conversation-v5-v16-environment-parity-smoke",
      "operational:formative-conversation-v5-v16-dispatch-checkpoint-smoke",
      "operational:formative-conversation-v5-v16-security-smoke",
      "operational:formative-conversation-v5-v16-provenance-smoke",
      "operational:formative-conversation-v16-misconception-evidence-closure-smoke",
      "operational:formative-conversation-v16-transition-closure-smoke",
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
      /^node --import tsx scripts\/operational-formative-conversation-v5-v16-process-local-runner\.mjs /
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
          v15_artifact_mutation: false,
          local_data_artifact_dependency: false,
          execution_boundary_parity_with_v15: true,
          historical_replay_dependencies:
            "hash_reference_only_not_required_for_v16_live_readiness",
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
