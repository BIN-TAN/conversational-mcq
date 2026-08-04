import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  PROVIDER_INPUT_IDENTITY_MINIMIZATION_VERSION
} from "../src/lib/llm/provider-input-privacy";
import {
  FORMATIVE_CONVERSATION_PROMPT_HASH,
  FORMATIVE_CONVERSATION_PROMPT_VERSION
} from "../src/lib/services/student-assessment/formative-conversation/live-runner";
import {
  FORMATIVE_CONVERSATION_TEACHER_GUIDANCE_BOUNDARY_VERSION
} from "../src/lib/services/student-assessment/formative-conversation/teacher-guidance-boundary";

const ROOT = path.join(
  process.cwd(),
  "config/operational-candidates/formative-conversation-host-v5-executable-v15"
);
const INHERITED_V14_REFERENCE_PATH = path.join(
  ROOT,
  "inherited-v14-reference.json"
);
const EXPECTED_INHERITED_V14_REFERENCE_HASH =
  "2a0ec8a5591dedc46a82e92c0dbc2840d9129dab3705ff2dfd503c5ed9b5b06b";

const runtimeDeltaSourcePaths = [
  "src/lib/agents/student-profiling/input-builder.ts",
  "src/lib/llm/provider-input-privacy.ts",
  "src/lib/services/student-assessment/formative-conversation/live-runner.ts",
  "src/lib/services/student-assessment/formative-conversation/runtime-context.ts",
  "src/lib/services/student-assessment/formative-conversation/teacher-guidance-boundary.ts",
  "src/lib/services/teacher-detailed-csv-export/service.ts",
  "src/lib/services/teacher-research-data/analysis-ready-export.ts",
  "src/lib/services/teacher-research-export/source-identity.ts",
  "src/lib/services/teacher-simple-csv-export/service.ts"
] as const;

const verificationSourcePaths = [
  "prisma/agent-profiling-smoke-test.ts",
  "prisma/operational-formative-conversation-v5-v15-smoke-test.ts",
  "prisma/pilot-data-governance-v15-smoke-test.ts",
  "prisma/student-analysis-ready-export-smoke-test.ts",
  "prisma/student-teacher-detailed-csv-export-smoke-test.ts",
  "prisma/student-teacher-simple-csv-export-smoke-test.ts",
  "docs/V15_PILOT_DATA_GOVERNANCE_HARDENING.md"
] as const;

type JsonRecord = Record<string, unknown>;

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonical).join(",")}]`;
  }
  return `{${Object.entries(value as JsonRecord)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
    .join(",")}}`;
}

function sha256(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalHash(value: unknown) {
  return sha256(canonical(value));
}

async function fileIdentity(relativePath: string) {
  const bytes = await readFile(path.join(process.cwd(), relativePath));
  return { path: relativePath, sha256: sha256(bytes) };
}

function requiredHash(record: JsonRecord, key: string) {
  const value = String(record[key] ?? "");
  if (!/^[a-f0-9]{64}$/u.test(value)) {
    throw new Error(`formative_conversation_v15_inherited_v14_${key}_invalid`);
  }
  return value;
}

async function inheritedV14Reference() {
  const bytes = await readFile(INHERITED_V14_REFERENCE_PATH);
  const reference = JSON.parse(bytes.toString("utf8")) as JsonRecord;
  const referenceHash = canonicalHash(reference);
  if (referenceHash !== EXPECTED_INHERITED_V14_REFERENCE_HASH) {
    throw new Error(
      `formative_conversation_v15_inherited_v14_reference_drift:${referenceHash}`
    );
  }
  if (
    reference.reference_version !==
      "formative-conversation-v15-inherited-v14-reference-v1" ||
    reference.historical_evidence_copied !== false ||
    reference.working_tree_dependency_permitted !== false
  ) {
    throw new Error("formative_conversation_v15_inherited_v14_reference_invalid");
  }
  if (
    !reference.inherited_live_budget ||
    typeof reference.inherited_live_budget !== "object" ||
    Array.isArray(reference.inherited_live_budget)
  ) {
    throw new Error("formative_conversation_v15_inherited_v14_budget_invalid");
  }
  return {
    reference,
    referenceHash,
    referenceFileSha256: sha256(bytes)
  };
}

async function writeJson(name: string, value: unknown) {
  const serialized = `${JSON.stringify(value, null, 2)}\n`;
  await writeFile(path.join(ROOT, name), serialized, "utf8");
  return sha256(serialized);
}

async function main() {
  const inherited = await inheritedV14Reference();
  const immutableV14Hash = requiredHash(
    inherited.reference,
    "v14_immutable_snapshot_hash"
  );
  const baseRuntimeHash = requiredHash(
    inherited.reference,
    "base_runtime_candidate_hash"
  );
  const runnerHash = requiredHash(
    inherited.reference,
    "runner_implementation_hash"
  );
  const activeHash = requiredHash(
    inherited.reference,
    "preserved_active_runtime_hash"
  );
  const rollbackHash = requiredHash(
    inherited.reference,
    "preserved_rollback_runtime_hash"
  );
  const v14PromptHash = requiredHash(inherited.reference, "prompt_hash");
  const inheritedV14FixtureManifestHash = requiredHash(
    inherited.reference,
    "v14_fixture_manifest_hash"
  );
  const inheritedV14AggregateFixtureHash = requiredHash(
    inherited.reference,
    "v14_aggregate_fixture_hash"
  );
  requiredHash(inherited.reference, "v14_protocol_hash");
  if (FORMATIVE_CONVERSATION_PROMPT_HASH !== v14PromptHash) {
    throw new Error("formative_conversation_v15_base_identity_invalid");
  }

  const runtimeSources = await Promise.all(
    runtimeDeltaSourcePaths.map(fileIdentity)
  );
  const verificationSources = await Promise.all(
    verificationSourcePaths.map(fileIdentity)
  );
  const materializerIdentity = await fileIdentity(
    "prisma/operational-formative-conversation-v5-v15-materialize.ts"
  );
  const runtimeMaterial = {
    manifest_version: "formative-conversation-v15-runtime-candidate-v1",
    base_runtime_candidate_hash: baseRuntimeHash,
    target_role: "formative_conversation_agent",
    prompt_version: FORMATIVE_CONVERSATION_PROMPT_VERSION,
    prompt_hash: FORMATIVE_CONVERSATION_PROMPT_HASH,
    identity_minimization_version:
      PROVIDER_INPUT_IDENTITY_MINIMIZATION_VERSION,
    teacher_guidance_boundary_version:
      FORMATIVE_CONVERSATION_TEACHER_GUIDANCE_BOUNDARY_VERSION,
    export_artifact_privacy_version:
      "pilot-export-artifact-identifier-privacy-v1",
    runtime_delta_sources: runtimeSources,
    explicitly_unchanged: [
      "answer_key_boundary",
      "assessment_truth_handling",
      "formative_pedagogy",
      "profile_transition_logic",
      "profile_meanings",
      "semantic_regeneration_philosophy",
      "database_schema"
    ]
  };
  const runtimeCandidateHash = canonicalHash(runtimeMaterial);

  const fixtureMaterial = {
    manifest_version: "formative-conversation-v15-governance-fixture-manifest-v1",
    inherited_v14_fixture_manifest_hash: inheritedV14FixtureManifestHash,
    inherited_v14_aggregate_fixture_hash: inheritedV14AggregateFixtureHash,
    governance_regression_sources: verificationSources,
    provider_calls: 0,
    model_auth_requests: 0
  };
  const fixtureManifestHash = canonicalHash(fixtureMaterial);

  const protocolMaterial = {
    protocol_version:
      "formative-conversation-host-v5-pilot-data-governance-v15",
    status: "no_provider_candidate_only",
    runtime_candidate_hash: runtimeCandidateHash,
    prompt_hash: FORMATIVE_CONVERSATION_PROMPT_HASH,
    runner_implementation_hash: runnerHash,
    materializer_implementation_hash: materializerIdentity.sha256,
    inherited_v14_reference_hash: inherited.referenceHash,
    fixture_manifest_hash: fixtureManifestHash,
    inherited_live_budget: inherited.reference.inherited_live_budget,
    no_provider_gates: [
      "provider_input_boundary",
      "student_identifier_minimization",
      "semantic_regeneration_input_boundary",
      "teacher_guidance_exposure",
      "export_filename_privacy",
      "profile_transition_regressions",
      "export_integrity",
      "teacher_export_parity",
      "provenance",
      "security",
      "typecheck",
      "lint",
      "production_build"
    ],
    live_execution_prepared: false,
    dispatch_checkpoint_permitted: false,
    approval_eligible: false,
    activation_permitted: false
  };
  const protocolHash = canonicalHash(protocolMaterial);

  const environmentMaterial = {
    contract_version:
      "formative-conversation-v15-no-provider-environment-contract-v1",
    provider_calls: 0,
    model_auth_requests: 0,
    dispatch_checkpoints: 0,
    render_access_permitted: false,
    secrets_required: []
  };
  const environmentContractHash = canonicalHash(environmentMaterial);

  const compiledPlanMaterial = {
    compiled_plan_version:
      "formative-conversation-v15-no-provider-compiled-plan-v1",
    runtime_candidate_hash: runtimeCandidateHash,
    protocol_hash: protocolHash,
    runner_implementation_hash: runnerHash,
    materializer_implementation_hash: materializerIdentity.sha256,
    inherited_v14_reference_hash: inherited.referenceHash,
    fixture_manifest_hash: fixtureManifestHash,
    environment_contract_hash: environmentContractHash,
    execution: "no_provider_verification_only",
    dispatch_checkpoint_count: 0,
    provider_call_count: 0,
    model_auth_request_count: 0,
    approval_eligible: false,
    activation_permitted: false
  };
  const compiledPlanHash = canonicalHash(compiledPlanMaterial);

  await mkdir(ROOT, { recursive: true });
  const runtimeManifestSha = await writeJson("runtime-candidate-manifest.json", {
    ...runtimeMaterial,
    runtime_candidate_hash: runtimeCandidateHash
  });
  const fixtureManifestSha = await writeJson("fixture-manifest.json", {
    ...fixtureMaterial,
    fixture_manifest_hash: fixtureManifestHash
  });
  const protocolSha = await writeJson("executable-evaluation-protocol.json", {
    ...protocolMaterial,
    protocol_hash: protocolHash
  });
  const environmentSha = await writeJson("environment-contract.json", {
    ...environmentMaterial,
    environment_contract_hash: environmentContractHash
  });
  const compiledPlanSha = await writeJson("compiled-execution-plan.json", {
    ...compiledPlanMaterial,
    compiled_plan_hash: compiledPlanHash
  });
  const sourceConfiguration = {
    configuration_version:
      "formative-conversation-v15-source-configuration-v1",
    target_role: "formative_conversation_agent",
    prompt_version: FORMATIVE_CONVERSATION_PROMPT_VERSION,
    prompt_hash: FORMATIVE_CONVERSATION_PROMPT_HASH,
    runtime_candidate_hash: runtimeCandidateHash,
    base_runtime_candidate_hash: baseRuntimeHash,
    active_runtime_hash: activeHash,
    rollback_runtime_hash: rollbackHash,
    live_configuration_changed: false,
    render_accessed: false,
    inherited_v14_reference_hash: inherited.referenceHash
  };
  const sourceConfigurationHash = canonicalHash(sourceConfiguration);
  const sourceConfigurationSha = await writeJson("source-configuration.json", {
    ...sourceConfiguration,
    source_configuration_hash: sourceConfigurationHash
  });
  const approvalPlaceholder = {
    placeholder_version:
      "formative-conversation-v15-approval-placeholder-v1",
    runtime_candidate_hash: runtimeCandidateHash,
    protocol_hash: protocolHash,
    approval_evidence_created: false,
    approval_eligible: false,
    activation_permitted: false,
    reason:
      "Uncommitted no-provider pilot-governance candidate; committed-source live evaluation has not been frozen or authorized."
  };
  const approvalPlaceholderSha = await writeJson(
    "approval-evidence-placeholder.json",
    approvalPlaceholder
  );

  const candidateManifest = {
    manifest_version:
      "formative-conversation-host-v5-executable-candidate-revision-v15",
    approval_state: "candidate_not_approved",
    approval_eligible: false,
    activation_permitted: false,
    runtime_behavior_changed: true,
    instructional_behavior_changed: false,
    prompt_changed: false,
    database_schema_changed: false,
    runtime_candidate_hash: runtimeCandidateHash,
    protocol_hash: protocolHash,
    runner_implementation_hash: runnerHash,
    runner_reused_from_v14: true,
    materializer_implementation_hash: materializerIdentity.sha256,
    inherited_v14_reference_hash: inherited.referenceHash,
    fixture_manifest_hash: fixtureManifestHash,
    compiled_plan_hash: compiledPlanHash,
    environment_contract_hash: environmentContractHash,
    active_runtime_hash: activeHash,
    rollback_runtime_hash: rollbackHash,
    v14_immutable_snapshot_hash: immutableV14Hash,
    future_live_evaluation_requires_committed_source_freeze: true
  };
  const candidateManifestHash = canonicalHash(candidateManifest);
  const candidateManifestSha = await writeJson("candidate-manifest.json", {
    ...candidateManifest,
    candidate_manifest_hash: candidateManifestHash
  });
  await writeJson("candidate-identity.json", {
    identity_version: "formative-conversation-v15-candidate-identity-v1",
    runtime_candidate_hash: runtimeCandidateHash,
    prompt_hash: FORMATIVE_CONVERSATION_PROMPT_HASH,
    protocol_hash: protocolHash,
    runner_implementation_hash: runnerHash,
    materializer_implementation_hash: materializerIdentity.sha256,
    inherited_v14_reference_hash: inherited.referenceHash,
    fixture_manifest_hash: fixtureManifestHash,
    compiled_plan_hash: compiledPlanHash,
    environment_contract_hash: environmentContractHash,
    candidate_manifest_hash: candidateManifestHash,
    source_configuration_hash: sourceConfigurationHash,
    file_sha256: {
      runtime_candidate_manifest: runtimeManifestSha,
      candidate_manifest: candidateManifestSha,
      executable_evaluation_protocol: protocolSha,
      fixture_manifest: fixtureManifestSha,
      compiled_execution_plan: compiledPlanSha,
      environment_contract: environmentSha,
      source_configuration: sourceConfigurationSha,
      inherited_v14_reference: inherited.referenceFileSha256,
      approval_evidence_placeholder: approvalPlaceholderSha
    },
    v14_immutable_snapshot_hash: immutableV14Hash,
    approval_eligible: false,
    activation_permitted: false,
    provider_calls: 0,
    model_auth_requests: 0,
    dispatch_checkpoints: 0
  });

  console.log(
    JSON.stringify(
      {
        status: "materialized",
        root: path.relative(process.cwd(), ROOT),
        runtime_candidate_hash: runtimeCandidateHash,
        prompt_hash: FORMATIVE_CONVERSATION_PROMPT_HASH,
        protocol_hash: protocolHash,
        runner_implementation_hash: runnerHash,
        materializer_implementation_hash: materializerIdentity.sha256,
        inherited_v14_reference_hash: inherited.referenceHash,
        fixture_manifest_hash: fixtureManifestHash,
        compiled_plan_hash: compiledPlanHash,
        environment_contract_hash: environmentContractHash,
        candidate_manifest_hash: candidateManifestHash,
        source_configuration_hash: sourceConfigurationHash,
        v14_immutable_snapshot_hash: immutableV14Hash,
        approval_eligible: false,
        activation_permitted: false,
        provider_calls: 0,
        model_auth_requests: 0,
        dispatch_checkpoints: 0
      },
      null,
      2
    )
  );
}

void main();
