import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { stableHash } from "../src/lib/operational/stable-hash";
import {
  FORMATIVE_CONVERSATION_V18R2_CANDIDATE_ROOT,
  FORMATIVE_CONVERSATION_V18R2_IMMUTABLE_V18R1,
  FORMATIVE_CONVERSATION_V18R2_REQUIRED_NO_PROVIDER_TESTS,
  FORMATIVE_CONVERSATION_V18R2_RUNTIME_SOURCE_PATHS,
  buildFormativeConversationV18R2RuntimeCandidateManifest
} from "../src/lib/operational/formative-conversation-v18r2/candidate";
import {
  FORMATIVE_CONVERSATION_V18R2_PROMPT_HASH,
  FORMATIVE_CONVERSATION_V18R2_PROMPT_VERSION
} from "../src/lib/services/student-assessment/formative-conversation/live-runner-v18r2";

function sha256(bytes: string | Buffer) {
  return createHash("sha256").update(bytes).digest("hex");
}

function readJson(relativePath: string) {
  return JSON.parse(
    readFileSync(path.resolve(process.cwd(), relativePath), "utf8")
  ) as Record<string, unknown>;
}

function fileSha(relativePath: string) {
  return sha256(readFileSync(path.resolve(process.cwd(), relativePath)));
}

function withoutKey(value: Record<string, unknown>, key: string) {
  const copy = { ...value };
  delete copy[key];
  return copy;
}

const artifact = (name: string) =>
  `${FORMATIVE_CONVERSATION_V18R2_CANDIDATE_ROOT}/${name}`;

const runtimeManifest = readJson(artifact("runtime-candidate-manifest.json"));
const candidateManifest = readJson(artifact("candidate-manifest.json"));
const candidateIdentity = readJson(artifact("candidate-identity.json"));
const protocol = readJson(artifact("no-provider-verification-protocol.json"));
const verificationManifest = readJson(artifact("verification-manifest.json"));
const fixtureReference = readJson(artifact("fixture-reference-manifest.json"));
const immutableReference = readJson(artifact("immutable-v18r1-reference.json"));
const forensicReport = readJson(artifact("v18r1-forensic-report.json"));
const sourceConfiguration = readJson(artifact("source-configuration.json"));
const approvalPlaceholder = readJson(artifact("approval-evidence-placeholder.json"));

assert.deepEqual(
  runtimeManifest,
  buildFormativeConversationV18R2RuntimeCandidateManifest()
);
assert.equal(
  runtimeManifest.runtime_candidate_hash,
  candidateIdentity.runtime_candidate_hash
);
assert.equal(candidateIdentity.formative_prompt_hash, FORMATIVE_CONVERSATION_V18R2_PROMPT_HASH);
assert.equal(
  (runtimeManifest.formative_conversation_role as Record<string, unknown>)
    .prompt_version,
  FORMATIVE_CONVERSATION_V18R2_PROMPT_VERSION
);
assert.notEqual(
  runtimeManifest.runtime_candidate_hash,
  FORMATIVE_CONVERSATION_V18R2_IMMUTABLE_V18R1.runtime_candidate_hash
);

assert.equal(
  stableHash(withoutKey(protocol, "protocol_hash")),
  protocol.protocol_hash
);
assert.equal(
  stableHash(withoutKey(candidateManifest, "candidate_manifest_hash")),
  candidateManifest.candidate_manifest_hash
);
assert.equal(
  stableHash(withoutKey(verificationManifest, "verification_manifest_hash")),
  verificationManifest.verification_manifest_hash
);
assert.equal(
  stableHash(
    withoutKey(fixtureReference, "fixture_reference_manifest_hash")
  ),
  fixtureReference.fixture_reference_manifest_hash
);
assert.equal(
  stableHash(withoutKey(immutableReference, "immutable_reference_hash")),
  immutableReference.immutable_reference_hash
);
assert.equal(
  stableHash(withoutKey(forensicReport, "forensic_report_hash")),
  forensicReport.forensic_report_hash
);
assert.equal(
  stableHash(withoutKey(sourceConfiguration, "source_configuration_hash")),
  sourceConfiguration.source_configuration_hash
);

assert.equal(candidateManifest.live_execution_prepared, false);
assert.deepEqual(candidateManifest.approval, {
  eligible: false,
  evidence_created: false
});
assert.deepEqual(candidateManifest.activation, { permitted: false });
assert.equal(candidateIdentity.live_execution_prepared, false);
assert.equal(candidateIdentity.approval_eligible, false);
assert.equal(candidateIdentity.activation_permitted, false);
assert.equal(approvalPlaceholder.approval_eligible, false);
assert.equal(approvalPlaceholder.activation_permitted, false);

const executionScope = protocol.execution_scope as Record<string, unknown>;
assert.deepEqual(executionScope, {
  live_execution_prepared: false,
  live_execution_permitted: false,
  launcher_present: false,
  environment_contract_present: false,
  dispatch_checkpoint_contract_present: false,
  authorization_present: false
});
const lifecycle = protocol.lifecycle as Record<string, unknown>;
assert.equal(lifecycle.formative_counter_initial_value, 0);
assert.equal(lifecycle.maximum_student_authored_formative_turns, 12);
assert.equal(lifecycle.assessment_session_messages_counted, false);
assert.equal(lifecycle.item_responses_counted, false);
assert.equal(lifecycle.assistant_opening_counted, false);
assert.equal(lifecycle.retry_or_replay_counted, false);

const futureProjection = protocol.future_live_evaluation_projection as Record<
  string,
  unknown
>;
assert.equal(futureProjection.substantive_case_set_unchanged, true);
assert.equal(futureProjection.base_call_graph_unchanged, true);
assert.equal(futureProjection.budgets_unchanged, true);
assert.deepEqual(futureProjection.budget, {
  exact_case_count: 12,
  profiling_base_calls: 4,
  formative_base_calls: 24,
  total_base_calls: 28,
  maximum_logical_calls: 56,
  maximum_provider_attempts: 168,
  maximum_input_tokens: 1_800_000,
  maximum_output_tokens: 368_000,
  maximum_total_tokens: 2_168_000,
  maximum_wall_time_ms: 7_200_000,
  provider_concurrency: 1,
  maximum_cost_usd: 60
});
assert.equal(
  fixtureReference.aggregate_fixture_hash,
  FORMATIVE_CONVERSATION_V18R2_IMMUTABLE_V18R1.aggregate_fixture_hash
);
assert.equal(fixtureReference.substantive_case_content_changed, false);
assert.equal(fixtureReference.lifecycle_exhaustion_live_case_added, false);
assert.equal(immutableReference.provider_run_id, FORMATIVE_CONVERSATION_V18R2_IMMUTABLE_V18R1.provider_run_id);
assert.equal(immutableReference.run_artifacts_mutated, false);
assert.equal(forensicReport.all_seven_share_one_prompt_schema_contradiction, true);
assert.equal(forensicReport.independent_p1_issue_found, false);

for (const relativePath of FORMATIVE_CONVERSATION_V18R2_RUNTIME_SOURCE_PATHS) {
  assert(
    (runtimeManifest.runtime_source_files as Array<Record<string, unknown>>).some(
      (entry) => entry.path === relativePath && entry.sha256 === fileSha(relativePath)
    ),
    `Missing runtime source identity: ${relativePath}`
  );
}
const packageJson = readJson("package.json");
const scripts = packageJson.scripts as Record<string, unknown>;
for (const command of FORMATIVE_CONVERSATION_V18R2_REQUIRED_NO_PROVIDER_TESTS) {
  if (
    command.startsWith("npx ") ||
    command === "typecheck" ||
    command === "lint" ||
    command === "build_with_8gb_heap" ||
    command === "git diff --check"
  ) {
    continue;
  }
  assert.equal(typeof scripts[command], "string", `Missing package script: ${command}`);
}

const fileHashes = candidateIdentity.file_sha256 as Record<string, unknown>;
const artifactPaths: Record<string, string> = {
  runtime_candidate_manifest: artifact("runtime-candidate-manifest.json"),
  candidate_manifest: artifact("candidate-manifest.json"),
  verification_manifest: artifact("verification-manifest.json"),
  fixture_reference_manifest: artifact("fixture-reference-manifest.json"),
  no_provider_verification_protocol: artifact(
    "no-provider-verification-protocol.json"
  ),
  source_configuration: artifact("source-configuration.json"),
  immutable_v18r1_reference: artifact("immutable-v18r1-reference.json"),
  v18r1_forensic_report: artifact("v18r1-forensic-report.json"),
  approval_evidence_placeholder: artifact("approval-evidence-placeholder.json"),
  replay_fixture: artifact(
    "fixtures/v18r1-seven-failed-primary-candidates.json"
  )
};
for (const [key, relativePath] of Object.entries(artifactPaths)) {
  assert.equal(fileHashes[key], fileSha(relativePath), `Artifact hash drift: ${key}`);
}

for (const forbiddenArtifact of [
  "LIVE_EXECUTION.md",
  "live-execution-authorization.json",
  "compiled-execution-plan.json",
  "live-environment-contract.json",
  "dispatch-checkpoint-contract.json"
]) {
  assert.throws(
    () => readFileSync(path.resolve(process.cwd(), artifact(forbiddenArtifact))),
    /ENOENT/u
  );
}
assert.equal(
  JSON.stringify({
    runtimeManifest,
    candidateManifest,
    candidateIdentity,
    protocol,
    verificationManifest,
    fixtureReference,
    immutableReference,
    forensicReport,
    sourceConfiguration,
    approvalPlaceholder
  }).includes(".data/"),
  false
);

console.log(
  JSON.stringify(
    {
      status: "passed",
      runtime_candidate_hash: runtimeManifest.runtime_candidate_hash,
      formative_prompt_hash: FORMATIVE_CONVERSATION_V18R2_PROMPT_HASH,
      profiling_prompt_hash: candidateIdentity.profiling_prompt_hash,
      protocol_hash: protocol.protocol_hash,
      candidate_manifest_hash: candidateManifest.candidate_manifest_hash,
      verification_manifest_hash: verificationManifest.verification_manifest_hash,
      fixture_reference_manifest_hash:
        fixtureReference.fixture_reference_manifest_hash,
      aggregate_substantive_fixture_hash:
        fixtureReference.aggregate_fixture_hash,
      immutable_v18r1: true,
      live_execution_prepared: false,
      approval_eligible: false,
      activation_permitted: false,
      provider_calls: 0,
      model_auth_requests: 0,
      generation_network_requests: 0,
      dispatch_checkpoints: 0
    },
    null,
    2
  )
);
