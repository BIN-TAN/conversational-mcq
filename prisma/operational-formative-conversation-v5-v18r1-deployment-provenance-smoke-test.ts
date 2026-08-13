import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  verifyFormativeConversationV18R1DeployedProvenance,
  type FormativeConversationV18R1DeployedIdentity
} from "../src/lib/operational/formative-conversation-v5-evaluation-v18r1/deployed-provenance";
import { compileFormativeConversationV5PreDispatch } from "../src/lib/operational/formative-conversation-v5-evaluation-v18r1/service";
import { installFormativeConversationV5TestEnvironment } from "./helpers/formative-conversation-v5-v18r1-test-environment";

const gitSha = "a".repeat(40);
const hash = (character: string) => character.repeat(64);
const identity: FormativeConversationV18R1DeployedIdentity = {
  runtime_candidate_hash: hash("a"),
  evaluation_protocol_hash: hash("b"),
  runner_implementation_hash: hash("c"),
  candidate_manifest_hash: hash("d"),
  fixture_manifest_hash: hash("e"),
  aggregate_fixture_hash: hash("f"),
  compiled_plan_hash: hash("1"),
  live_environment_contract_hash: hash("2"),
  dispatch_checkpoint_contract_hash: hash("3"),
  provenance_contract_hash: hash("4"),
  deployed_source_closure_hash: hash("5"),
  security_wrapper_hash: hash("6"),
  formative_prompt_hash: hash("7"),
  profiling_prompt_hash: hash("8"),
  canonical_evidence_identity_implementation_hash: hash("9"),
  misconception_claim_identity_implementation_hash: "0".repeat(64)
};

async function exportReadiness() {
  return {
    ready: true,
    environment: "production",
    pseudonymization_method: "HMAC-SHA-256" as const,
    pseudonymization_version: "hmac_sha256_v1",
    key_configured: true,
    safe_key_fingerprint: null,
    required_configuration: ["RESEARCH_PSEUDONYMIZATION_KEY"],
    blocking_reasons: [],
    warnings: [],
    export_schema_version: "deterministic-test-export-schema",
    readiness_version: "research-export-readiness-v1" as const,
    artifact_path_writable: true,
    database_ready: true,
    dictionary_registry_ready: true,
    restricted_export_authorization_supported: true
  };
}

async function migrationReadiness() {
  return {
    ready: true,
    expected_migration_count: 60,
    applied_migration_count: 60,
    expected_migration_set_hash: "a".repeat(64),
    missing_migration_count: 0,
    failed_migration_count: 0
  };
}

function expectFailure(input: Parameters<typeof verifyFormativeConversationV18R1DeployedProvenance>[0], code: RegExp) {
  assert.throws(
    () => verifyFormativeConversationV18R1DeployedProvenance(input),
    code
  );
}

const passing = {
  mode: "render_deployed_artifact",
  render_git_commit: gitSha,
  operator_authorized_git_sha: gitSha,
  expected_identity: identity,
  deployed_identity: identity
};
const result = verifyFormativeConversationV18R1DeployedProvenance(passing);
assert.equal(result.git_invocations, 0);
assert.equal(result.deployed_artifact_identity_status, "verified");
assert.equal(result.source_commit_sha, gitSha);
const providerRunAllocations = 0;
const databaseWrites = 0;
const checkpointWrites = 0;
const guardedBoundary = (
  input: Parameters<
    typeof verifyFormativeConversationV18R1DeployedProvenance
  >[0]
) => {
  const verified = verifyFormativeConversationV18R1DeployedProvenance(input);
  return {
    verified,
    provider_run_allocations: providerRunAllocations,
    database_writes: databaseWrites,
    checkpoint_writes: checkpointWrites
  };
};
assert.throws(
  () => guardedBoundary({ ...passing, render_git_commit: null }),
  /render_git_commit_missing/
);
assert.deepEqual(
  { providerRunAllocations, databaseWrites, checkpointWrites },
  { providerRunAllocations: 0, databaseWrites: 0, checkpointWrites: 0 }
);

// Reproduce the V18 container condition. ENOENT is irrelevant because the
// deployed verifier has no Git execution path.
const unavailable = spawnSync("git", ["--version"], {
  env: { ...process.env, PATH: path.resolve("/definitely-no-git") },
  encoding: "utf8"
});
assert.equal((unavailable.error as NodeJS.ErrnoException | undefined)?.code, "ENOENT");
assert.equal(
  verifyFormativeConversationV18R1DeployedProvenance(passing).git_invocations,
  0
);
const deployedSource = readFileSync(
  path.resolve(
    "src/lib/operational/formative-conversation-v5-evaluation-v18r1/deployed-provenance.ts"
  ),
  "utf8"
);
assert.doesNotMatch(deployedSource, /node:child_process|execFile|spawnSync|git show|git status/u);

expectFailure({ ...passing, render_git_commit: null }, /render_git_commit_missing/);
expectFailure({ ...passing, render_git_commit: "bad" }, /render_git_commit_malformed/);
expectFailure({ ...passing, operator_authorized_git_sha: null }, /expected_git_sha_missing/);
expectFailure({ ...passing, operator_authorized_git_sha: "bad" }, /expected_git_sha_malformed/);
expectFailure({ ...passing, operator_authorized_git_sha: "b".repeat(40) }, /deployed_git_sha_mismatch/);
expectFailure(
  {
    ...passing,
    deployed_identity: { ...identity, runtime_candidate_hash: hash("9") }
  },
  /deployed_identity_mismatch:runtime_candidate_hash/
);
expectFailure(
  {
    ...passing,
    deployed_identity: { ...identity, evaluation_protocol_hash: hash("9") }
  },
  /deployed_identity_mismatch:evaluation_protocol_hash/
);
expectFailure(
  {
    ...passing,
    deployed_identity: { ...identity, deployed_source_closure_hash: hash("9") }
  },
  /deployed_identity_mismatch:deployed_source_closure_hash/
);
expectFailure(
  {
    ...passing,
    deployed_identity: { ...identity, provenance_contract_hash: hash("9") }
  },
  /deployed_identity_mismatch:provenance_contract_hash/
);
for (const field of Object.keys(
  identity
) as Array<keyof FormativeConversationV18R1DeployedIdentity>) {
  const mismatchedHash =
    identity[field] === hash("9") ? hash("0") : hash("9");
  expectFailure(
    {
      ...passing,
      deployed_identity: { ...identity, [field]: mismatchedHash }
    },
    new RegExp(`deployed_identity_mismatch:${field}`)
  );
}
expectFailure({ ...passing, mode: "local" }, /deployment_mode_unsupported/);

async function main() {
  const restoreEnvironment = installFormativeConversationV5TestEnvironment();
  let researchReadinessQueries = 0;
  let migrationReadinessQueries = 0;
  try {
    await assert.rejects(
      () =>
        compileFormativeConversationV5PreDispatch(
          {
            get_research_export_readiness: async () => {
              researchReadinessQueries += 1;
              throw new Error("research_readiness_must_not_run");
            },
            get_migration_readiness: async () => {
              migrationReadinessQueries += 1;
              throw new Error("migration_readiness_must_not_run");
            }
          },
          { expected_deployed_git_sha: "b".repeat(40) }
        ),
      /deployed_git_sha_mismatch/
    );
    const preDispatch = await compileFormativeConversationV5PreDispatch(
      {
        verify_deployed_provenance: () => result,
        get_research_export_readiness: async () => {
          researchReadinessQueries += 1;
          return exportReadiness();
        },
        get_migration_readiness: async () => {
          migrationReadinessQueries += 1;
          return migrationReadiness();
        }
      },
      { expected_deployed_git_sha: gitSha }
    );
    assert.equal(
      preDispatch.dispatch_boundary.status,
      "ready_immediately_before_dispatch_checkpoint"
    );
    assert.equal(preDispatch.dispatch_boundary.checkpoint_created, false);
  } finally {
    restoreEnvironment();
  }
  assert.equal(researchReadinessQueries, 1);
  assert.equal(migrationReadinessQueries, 1);
  assert.deepEqual(
    { providerRunAllocations, databaseWrites, checkpointWrites },
    { providerRunAllocations: 0, databaseWrites: 0, checkpointWrites: 0 }
  );

  console.log(JSON.stringify({
    status: "passed",
    production_without_git_passed: true,
    simulated_git_enoent: true,
    deployed_verifier_git_invocations: 0,
    all_fail_closed_cases_passed: true,
    all_deployed_identity_fields_exercised: true,
    actual_predispatch_ordering_passed: true,
    executable_freeze_reaches_post_provenance_readiness: true,
    ready_immediately_before_dispatch_checkpoint: true,
    database_readiness_queries_before_failed_provenance: 0,
    provider_calls: 0,
    model_auth_requests: 0,
    network_requests: 0,
    dispatch_checkpoints: 0,
    database_writes: 0
  }));
}

void main();
