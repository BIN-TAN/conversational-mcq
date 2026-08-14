import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { stableHash } from "@/lib/operational/stable-hash";
import { buildFormativeConversationV18R2UxPolishArtifacts } from "@/lib/operational/formative-conversation-v18r2-ux-polish/candidate";
import {
  V18R2_UX_CANARY_ARTIFACT_PATHS,
  V18R2_UX_CANARY_CASE_ORDER,
  V18R2_UX_CANARY_FIXTURE_ROOT,
  V18R2_UX_CANARY_RUNNER_SOURCE_PATHS,
  V18R2_UX_CANARY_SECURITY_SOURCE_PATHS,
  V18R2UxCanaryBudgetSchema,
  V18R2UxCanaryFixtureSchema
} from "./contracts";

type JsonRecord = Record<string, unknown>;

function absolute(relativePath: string) {
  return path.resolve(process.cwd(), relativePath);
}

export function v18r2UxCanaryFileSha256(relativePath: string) {
  return createHash("sha256")
    .update(readFileSync(absolute(relativePath)))
    .digest("hex");
}

function readJson(relativePath: string): JsonRecord {
  return JSON.parse(readFileSync(absolute(relativePath), "utf8")) as JsonRecord;
}

function asRecord(value: unknown): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("v18r2_ux_canary_record_required");
  }
  return value as JsonRecord;
}

function without(value: JsonRecord, key: string) {
  const { [key]: ignored, ...rest } = value;
  void ignored;
  return rest;
}

function assertCondition(condition: unknown, code: string): asserts condition {
  if (!condition) throw new Error(code);
}

function assertEmbeddedHash(value: JsonRecord, field: string, code: string) {
  const expected = value[field];
  assertCondition(
    typeof expected === "string" && stableHash(without(value, field)) === expected,
    code
  );
  return expected;
}

function sourceFileIdentities(paths: readonly string[]) {
  return paths.map((sourcePath) => ({
    path: sourcePath,
    sha256: v18r2UxCanaryFileSha256(sourcePath)
  }));
}

export function v18r2UxCanaryFixtureHash(value: JsonRecord) {
  return stableHash(without(value, "fixture_hash"));
}

export function v18r2UxCanaryRunnerHash() {
  return stableHash({
    runner_version: "formative-conversation-v18r2-ux-polish-canary-runner-v1",
    canonical_loading_mechanism: "node --import tsx",
    plan_live_loader_parity: true,
    source_files: sourceFileIdentities(V18R2_UX_CANARY_RUNNER_SOURCE_PATHS)
  });
}

export function v18r2UxCanarySecurityWrapperHash() {
  return stableHash({
    security_wrapper_version:
      "formative-conversation-v18r2-ux-polish-canary-security-wrapper-v1",
    inherited_attestation_boundary:
      "formative-conversation-v18r2-security-wrapper-v1",
    source_files: sourceFileIdentities(V18R2_UX_CANARY_SECURITY_SOURCE_PATHS)
  });
}

export function loadV18R2UxPolishCanaryPackage() {
  const runtimeManifest = readJson(V18R2_UX_CANARY_ARTIFACT_PATHS.runtime_manifest);
  const baseCandidateReference = readJson(
    V18R2_UX_CANARY_ARTIFACT_PATHS.base_candidate_reference
  );
  const sourceConfiguration = readJson(
    V18R2_UX_CANARY_ARTIFACT_PATHS.source_configuration
  );
  const fixtureManifest = readJson(V18R2_UX_CANARY_ARTIFACT_PATHS.fixture_manifest);
  const environmentContract = readJson(
    V18R2_UX_CANARY_ARTIFACT_PATHS.environment_contract
  );
  const checkpointContract = readJson(
    V18R2_UX_CANARY_ARTIFACT_PATHS.checkpoint_contract
  );
  const securityManifest = readJson(
    V18R2_UX_CANARY_ARTIFACT_PATHS.security_manifest
  );
  const provenanceContract = readJson(
    V18R2_UX_CANARY_ARTIFACT_PATHS.provenance_contract
  );
  const protocol = readJson(V18R2_UX_CANARY_ARTIFACT_PATHS.protocol);
  const compiledPlan = readJson(V18R2_UX_CANARY_ARTIFACT_PATHS.compiled_plan);
  const candidateManifest = readJson(
    V18R2_UX_CANARY_ARTIFACT_PATHS.candidate_manifest
  );
  const candidateIdentity = readJson(
    V18R2_UX_CANARY_ARTIFACT_PATHS.candidate_identity
  );
  const approvalPlaceholder = readJson(
    V18R2_UX_CANARY_ARTIFACT_PATHS.approval_placeholder
  );
  const authorization = readJson(V18R2_UX_CANARY_ARTIFACT_PATHS.authorization);

  const rebuiltUx = buildFormativeConversationV18R2UxPolishArtifacts();
  assertCondition(
    stableHash(runtimeManifest) === stableHash(rebuiltUx.runtimeCandidateManifest) &&
      runtimeManifest.runtime_candidate_hash ===
        "2d458a8578427e4c6ad1ca143f51ecb17b2c5f762a11aebf1f11a01aebe32d90" &&
      runtimeManifest.formative_conversation_role &&
      asRecord(runtimeManifest.formative_conversation_role).prompt_hash ===
        "27488d814b1f3978723a086a05ca22ec31618764f0adb1f64ba83d9f45758b80",
    "v18r2_ux_canary_runtime_identity_mismatch"
  );
  assertCondition(
    baseCandidateReference.base_candidate_identity_hash ===
      "aa26e16c1c560d66e906f4b58516f6eda693d46d90cce7054df30eb623f9010f" &&
      baseCandidateReference.base_no_provider_protocol_hash ===
        "ac6e24d46ab56ca4b66b3a3f8359a0beab9b3aab0ded06e97e98d80adc1a2731" &&
      baseCandidateReference.historical_v18r2_provider_run_id ===
        "fcv5v18r2_provider_20260814042303_c675790a" &&
      baseCandidateReference.historical_evidence_mutated === false,
    "v18r2_ux_canary_base_candidate_reference_mismatch"
  );

  const fixtureReferences = fixtureManifest.fixtures;
  assertCondition(
    Array.isArray(fixtureReferences) && fixtureReferences.length === 4,
    "v18r2_ux_canary_fixture_inventory_invalid"
  );
  const fixtures = fixtureReferences.map((referenceValue, index) => {
    const reference = asRecord(referenceValue);
    const expectedCaseId = V18R2_UX_CANARY_CASE_ORDER[index];
    const fixturePath = String(reference.path ?? "");
    const fixtureRecord = readJson(fixturePath);
    const fixture = V18R2UxCanaryFixtureSchema.parse(fixtureRecord);
    assertCondition(
      fixture.case_id === expectedCaseId &&
        reference.case_id === expectedCaseId &&
        reference.fixture_hash === fixture.fixture_hash &&
        v18r2UxCanaryFixtureHash(fixtureRecord) === fixture.fixture_hash &&
        reference.file_sha256 === v18r2UxCanaryFileSha256(fixturePath) &&
        fixturePath === `${V18R2_UX_CANARY_FIXTURE_ROOT}/${expectedCaseId}.json`,
      `v18r2_ux_canary_fixture_identity_mismatch:${expectedCaseId}`
    );
    return fixture;
  });
  const aggregateFixtureHash = stableHash(
    fixtures.map((fixture) => ({
      case_id: fixture.case_id,
      case_order: fixture.case_order,
      fixture_hash: fixture.fixture_hash
    }))
  );
  const fixtureManifestHash = assertEmbeddedHash(
    fixtureManifest,
    "fixture_manifest_hash",
    "v18r2_ux_canary_fixture_manifest_hash_mismatch"
  );
  assertCondition(
    fixtureManifest.aggregate_fixture_hash === aggregateFixtureHash,
    "v18r2_ux_canary_aggregate_fixture_hash_mismatch"
  );

  const environmentContractHash = assertEmbeddedHash(
    environmentContract,
    "environment_contract_hash",
    "v18r2_ux_canary_environment_contract_hash_mismatch"
  );
  const checkpointContractHash = assertEmbeddedHash(
    checkpointContract,
    "checkpoint_contract_hash",
    "v18r2_ux_canary_checkpoint_contract_hash_mismatch"
  );
  const provenanceContractHash = assertEmbeddedHash(
    provenanceContract,
    "provenance_contract_hash",
    "v18r2_ux_canary_provenance_contract_hash_mismatch"
  );
  const sourceConfigurationHash = assertEmbeddedHash(
    sourceConfiguration,
    "source_configuration_hash",
    "v18r2_ux_canary_source_configuration_hash_mismatch"
  );
  const securityWrapperHash = v18r2UxCanarySecurityWrapperHash();
  assertCondition(
    securityManifest.security_wrapper_hash === securityWrapperHash &&
      assertEmbeddedHash(
        securityManifest,
        "security_wrapper_manifest_hash",
        "v18r2_ux_canary_security_manifest_hash_mismatch"
      ),
    "v18r2_ux_canary_security_wrapper_hash_mismatch"
  );
  const runnerHash = v18r2UxCanaryRunnerHash();
  const protocolHash = assertEmbeddedHash(
    protocol,
    "protocol_hash",
    "v18r2_ux_canary_protocol_hash_mismatch"
  );
  const budget = V18R2UxCanaryBudgetSchema.parse(protocol.budget);
  assertCondition(
    protocol.runtime_candidate_hash === runtimeManifest.runtime_candidate_hash &&
      protocol.formative_prompt_hash ===
        asRecord(runtimeManifest.formative_conversation_role).prompt_hash &&
      protocol.runner_implementation_hash === runnerHash &&
      protocol.fixture_manifest_hash === fixtureManifestHash &&
      protocol.aggregate_fixture_hash === aggregateFixtureHash &&
      protocol.live_environment_contract_hash === environmentContractHash &&
      protocol.dispatch_checkpoint_contract_hash === checkpointContractHash &&
      protocol.provenance_contract_hash === provenanceContractHash &&
      protocol.security_wrapper_hash === securityWrapperHash,
    "v18r2_ux_canary_protocol_binding_mismatch"
  );

  const compiledPlanHash = assertEmbeddedHash(
    compiledPlan,
    "compiled_plan_hash",
    "v18r2_ux_canary_compiled_plan_hash_mismatch"
  );
  assertCondition(
    compiledPlan.evaluation_protocol_hash === protocolHash &&
      compiledPlan.runtime_candidate_hash === runtimeManifest.runtime_candidate_hash &&
      compiledPlan.runner_implementation_hash === runnerHash &&
      stableHash(compiledPlan.budget) === stableHash(budget) &&
      stableHash(compiledPlan.fixed_case_order) === stableHash(V18R2_UX_CANARY_CASE_ORDER),
    "v18r2_ux_canary_compiled_plan_binding_mismatch"
  );
  const candidateManifestHash = assertEmbeddedHash(
    candidateManifest,
    "candidate_manifest_hash",
    "v18r2_ux_canary_candidate_manifest_hash_mismatch"
  );
  const candidateIdentityHash = assertEmbeddedHash(
    candidateIdentity,
    "candidate_identity_hash",
    "v18r2_ux_canary_candidate_identity_hash_mismatch"
  );
  const generatedFiles = candidateIdentity.generated_files;
  assertCondition(
    Array.isArray(generatedFiles) && generatedFiles.length > 0,
    "v18r2_ux_canary_generated_file_inventory_missing"
  );
  const recomputedGeneratedFiles = generatedFiles.map((entryValue) => {
    const entry = asRecord(entryValue);
    const filePath = String(entry.path ?? "");
    const fileHash = v18r2UxCanaryFileSha256(filePath);
    assertCondition(
      entry.sha256 === fileHash,
      `v18r2_ux_canary_generated_file_hash_mismatch:${filePath}`
    );
    return { path: filePath, sha256: fileHash };
  });
  assertCondition(
    candidateIdentity.generated_core_tree_digest ===
      stableHash(recomputedGeneratedFiles),
    "v18r2_ux_canary_generated_core_tree_digest_mismatch"
  );
  assertCondition(
    candidateManifest.protocol_hash === protocolHash &&
      candidateManifest.compiled_plan_hash === compiledPlanHash &&
      candidateManifest.live_execution_prepared === true &&
      asRecord(candidateManifest.approval).eligible === false &&
      asRecord(candidateManifest.activation).permitted === false &&
      candidateIdentity.candidate_manifest_hash === candidateManifestHash &&
      candidateIdentity.protocol_hash === protocolHash &&
      candidateIdentity.compiled_plan_hash === compiledPlanHash &&
      candidateIdentity.live_execution_prepared === true &&
      authorization.live_execution_prepared === true &&
      authorization.exact_future_authorization_text === null &&
      authorization.exact_future_live_command === null &&
      approvalPlaceholder.approval_status === "not_approved" &&
      approvalPlaceholder.activation_status === "not_permitted",
    "v18r2_ux_canary_governance_invalid"
  );

  return {
    runtime_manifest: runtimeManifest,
    base_candidate_reference: baseCandidateReference,
    source_configuration: sourceConfiguration,
    source_configuration_hash: sourceConfigurationHash,
    source_candidate: asRecord(sourceConfiguration.operational_configuration),
    fixture_manifest: fixtureManifest,
    fixture_manifest_hash: fixtureManifestHash,
    aggregate_fixture_hash: aggregateFixtureHash,
    fixtures,
    environment_contract: environmentContract,
    live_environment_contract_hash: environmentContractHash,
    checkpoint_contract: checkpointContract,
    dispatch_checkpoint_contract_hash: checkpointContractHash,
    provenance_contract: provenanceContract,
    provenance_contract_hash: provenanceContractHash,
    security_manifest: securityManifest,
    security_wrapper_hash: securityWrapperHash,
    protocol: { ...protocol, budget },
    protocol_hash: protocolHash,
    runner_implementation_hash: runnerHash,
    compiled_plan: compiledPlan,
    compiled_plan_hash: compiledPlanHash,
    candidate_manifest: candidateManifest,
    candidate_manifest_hash: candidateManifestHash,
    candidate_identity: candidateIdentity,
    candidate_identity_hash: candidateIdentityHash,
    authorization,
    approval_placeholder: approvalPlaceholder,
    runtime_candidate_hash: String(runtimeManifest.runtime_candidate_hash)
  };
}

export type V18R2UxPolishCanaryPackage = ReturnType<
  typeof loadV18R2UxPolishCanaryPackage
>;
