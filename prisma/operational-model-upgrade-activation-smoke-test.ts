import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadEnvConfig } from "@next/env";
import {
  activateOperationalApprovalBundle,
  APPROVED_OPERATIONAL_ROLE_NAMES,
  LEGACY_GPT54_APPROVED_RUNTIME_HASH,
  materializeApprovedOperationalRuntimeLocally,
  resolveActiveOperationalApproval,
  resolveApprovedOperationalRuntimeRequirement,
  rollbackOperationalApprovalBundle
} from "../src/lib/operational/active-approval-bundle";
import { stableHash } from "../src/lib/operational/stable-hash";
import {
  readActiveApprovedOperationalRuntimeConfig,
  verifyApprovedOperationalAgentConfig
} from "../src/lib/agents/operational/approved-config";
import {
  liveModelRoleEnvSources,
  resolveOpenAIModelConfigForRole
} from "../src/lib/llm/config";
import { getGuardedOperationalAgentIntegrationReadiness } from "../src/lib/operational/guarded-agent-integration";

loadEnvConfig(process.cwd());

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const EXPECTED_RUNTIME_HASH = "8e30e24a3e04a3c2506b1e23c447557fc2fe623012550de557e5240d7c689993";
const EXPECTED_PROTOCOL_HASH = "c2f4ae7cf46cb592dd29ef8bb406de52c2dc7cdf86eddeae476bbf4d8dfecc2d";
const SOURCE_RUN = "omur_20260716_cc847973";
const DERIVED_RUN = "omude_20260717_c8d79302";

const expectedRoles = {
  item_verification_agent: ["gpt-5.6-terra", "medium", 3000],
  item_administration_tutor_agent: ["gpt-5.6-luna", "low", 1200],
  response_collection_agent: ["gpt-5.6-luna", "low", 1500],
  student_profiling_agent: ["gpt-5.6-terra", "medium", 4000],
  profile_integration_agent: ["gpt-5.6-terra", "medium", 3000],
  formative_value_and_planning_agent: ["gpt-5.6-sol", "medium", 3000],
  formative_value_determination_agent: ["gpt-5.6-terra", "medium", 2500],
  followup_agent: ["gpt-5.6-sol", "medium", 2500],
  formative_activity_dialogue_agent: ["gpt-5.6-sol", "medium", 3500],
  formative_activity_quality_reviewer_agent: ["gpt-5.6-sol", "medium", 2500],
  formative_activity_response_evaluator_agent: ["gpt-5.6-sol", "medium", 3000],
  post_activity_evidence_evaluator_agent: ["gpt-5.6-sol", "medium", 3000],
  student_communication_agent: ["gpt-5.6-terra", "medium", 2500],
  topic_dialogue_agent: ["gpt-5.6-sol", "medium", 3500],
  mcq_diagnostic_authoring_assistant_agent: ["gpt-5.6-terra", "medium", 2500],
  mcq_import_formatting_assistant_agent: ["gpt-5.6-luna", "low", 3000],
  connectivity_test: ["gpt-5.6-luna", "none", 200]
} as const;

const touchedEnvKeys = [
  "OPERATIONAL_APPROVAL_BUNDLE_PATH",
  "OPERATIONAL_APPROVED_MANIFEST_PATH",
  "OPERATIONAL_APPROVAL_EVIDENCE_PATH",
  "OPERATIONAL_APPROVED_CONFIG_HASH",
  "OPERATIONAL_AGENT_MODE",
  "OPERATIONAL_AGENT_INTEGRATION_ENABLED",
  "LLM_PROVIDER",
  "LLM_LIVE_CALLS_ENABLED",
  "OPENAI_API_KEY",
  "OPENAI_REQUEST_TIMEOUT_MS",
  "OPENAI_MAX_RETRIES",
  "STUDENT_COMMUNICATION_LIVE_CALLS_ENABLED",
  "TOPIC_DIALOGUE_LIVE_CALLS_ENABLED",
  "TOPIC_DIALOGUE_MAX_STUDENT_TURNS",
  "TOPIC_DIALOGUE_RECENT_TURN_WINDOW",
  "TOPIC_DIALOGUE_MAX_STUDENT_MESSAGE_CHARS",
  "TOPIC_DIALOGUE_ALLOW_ASSESSMENT_SYSTEM_QUESTIONS",
  ...Object.values(liveModelRoleEnvSources()).flatMap((sources) => {
    const source = sources[0];
    return [source.model, source.reasoning, ...("maxTokens" in source ? [source.maxTokens] : [])];
  })
] as string[];

async function main() {
  const original = Object.fromEntries(touchedEnvKeys.map((key) => [key, process.env[key]]));
  const root = path.join(tmpdir(), `cmcq-operational-activation-${process.pid}-${Date.now()}`);
  mkdirSync(root, { recursive: true });
  try {
    for (const key of touchedEnvKeys) delete process.env[key];
    const manifestSource = path.join(process.cwd(), "config", "candidate-operational-agent-config.gpt-5.6-full-v2.json");
    const manifestPath = path.join(root, "approved-candidate-manifest.json");
    copyFileSync(manifestSource, manifestPath);
    const humanReview = {
      decision: "approve",
      semantic_review_confirmed: true,
      reviewed_fixture_ids: ["synthetic-fixed-review-fixture"],
      reviewer_provenance: "human_review"
    };
    const approvalEvidenceHash = stableHash({
      source_provider_run_id: SOURCE_RUN,
      derived_evaluation_id: DERIVED_RUN,
      runtime_candidate_hash: EXPECTED_RUNTIME_HASH,
      source_evaluation_protocol_hash: EXPECTED_PROTOCOL_HASH,
      evaluation_protocol_hash: EXPECTED_PROTOCOL_HASH,
      human_review: humanReview
    });
    const evidencePath = path.join(root, "approval_evidence.json");
    writeFileSync(evidencePath, `${JSON.stringify({
      approval_command_version: "operational-model-upgrade-derived-approval-v1",
      approved_at: new Date().toISOString(),
      source_provider_run_id: SOURCE_RUN,
      derived_evaluation_id: DERIVED_RUN,
      source_evaluation_protocol_hash: EXPECTED_PROTOCOL_HASH,
      evaluation_protocol_hash: EXPECTED_PROTOCOL_HASH,
      runtime_candidate_hash: EXPECTED_RUNTIME_HASH,
      source_artifact_sha256: "a".repeat(64),
      approval_evidence_hash: approvalEvidenceHash,
      exact_operational_approved_config_hash: EXPECTED_RUNTIME_HASH,
      rollback_hash: LEGACY_GPT54_APPROVED_RUNTIME_HASH,
      approved_manifest_artifact_path: manifestPath,
      human_review: humanReview
    }, null, 2)}\n`, "utf8");

    const activated = activateOperationalApprovalBundle({
      approvalEvidencePath: evidencePath,
      approvedManifestPath: manifestPath,
      expectedRuntimeHash: EXPECTED_RUNTIME_HASH,
      expectedEvaluationProtocolHash: EXPECTED_PROTOCOL_HASH,
      expectedApprovalEvidenceHash: approvalEvidenceHash,
      expectedSourceProviderRunId: SOURCE_RUN,
      expectedDerivedEvaluationId: DERIVED_RUN,
      confirmation: "activate approved gpt-5.6 operational candidate v2",
      outputDirectory: path.join(root, "active")
    });
    process.env.OPERATIONAL_APPROVAL_BUNDLE_PATH = activated.bundle_path;
    process.env.OPERATIONAL_APPROVED_MANIFEST_PATH = activated.approved_manifest_path;
    process.env.OPERATIONAL_APPROVAL_EVIDENCE_PATH = activated.approval_evidence_path;
    process.env.OPERATIONAL_APPROVED_CONFIG_HASH = EXPECTED_RUNTIME_HASH;

    const active = resolveActiveOperationalApproval();
    assert(active?.kind === "derived_approval", "New approved bundle should load as derived approval.");
    assert(active.record.source_provider_run_id === SOURCE_RUN, "Source provider run must be bound.");
    assert(active.record.derived_evaluation_id === DERIVED_RUN, "Derived evaluation must be bound.");
    assert(active.record.evaluation_protocol_hash === EXPECTED_PROTOCOL_HASH, "Protocol hash must match.");
    assert(active.record.approval_evidence_hash === approvalEvidenceHash, "Approval evidence hash must match.");
    assert(readActiveApprovedOperationalRuntimeConfig().kind === "derived_approval", "Runtime must not use Phase 8a while derived approval is active.");

    const verification = verifyApprovedOperationalAgentConfig();
    assert(verification.valid, `Active approval should verify: ${JSON.stringify(verification.issues)}`);
    assert(verification.role_inventory.length === 17, "All 17 approved roles must be verified.");
    for (const role of APPROVED_OPERATIONAL_ROLE_NAMES) {
      const resolved = resolveOpenAIModelConfigForRole(role);
      const expected = expectedRoles[role];
      assert(resolved.model_name === expected[0], `${role} model must resolve independently.`);
      assert(resolved.reasoning_effort === expected[1], `${role} effort must resolve independently.`);
      assert(resolved.max_output_tokens === expected[2], `${role} token limit must resolve independently.`);
      assert(!resolved.model_name.includes("gpt-5.4"), `${role} must not resolve to GPT-5.4.`);
    }

    process.env.OPENAI_MODEL_FOLLOWUP = "gpt-5.4-mini";
    assert(
      resolveOpenAIModelConfigForRole("formative_activity_dialogue_agent").model_name === "gpt-5.6-sol",
      "Activity dialogue must not inherit follow-up configuration."
    );
    assert(!verifyApprovedOperationalAgentConfig().valid, "A mismatched role assertion must block the active configuration.");
    delete process.env.OPENAI_MODEL_FOLLOWUP;

    const incompatibleResolution = verifyApprovedOperationalAgentConfig({
      runtimeModelConfigOverridesForTest: {
        item_verification_agent: {
          model_name: "gpt-5.6-luna",
          source: "incompatible_test_resolution"
        }
      }
    });
    assert(!incompatibleResolution.valid, "An incompatible role resolution must block verification.");

    const approvedManifestCopyContents = readFileSync(activated.approved_manifest_path, "utf8");
    writeFileSync(activated.approved_manifest_path, `${approvedManifestCopyContents}\n`, "utf8");
    const corruptedBundle = verifyApprovedOperationalAgentConfig();
    assert(!corruptedBundle.valid, "A configured bundle with changed artifact bytes must fail closed.");
    assert(corruptedBundle.runtime_candidate_hash === "unavailable", "Invalid active bundle must not fall back to the old runtime hash.");
    const corruptedReadiness = await getGuardedOperationalAgentIntegrationReadiness({ checkDatabase: false });
    assert(!corruptedReadiness.allowed, "A corrupted active approval bundle must block operational readiness.");
    assert(
      corruptedReadiness.approved_evaluation.source === "invalid_active_approval_bundle",
      "Readiness diagnostics must identify the invalid active approval bundle."
    );
    writeFileSync(activated.approved_manifest_path, approvedManifestCopyContents, "utf8");
    assert(verifyApprovedOperationalAgentConfig().valid, "Restored immutable artifact must verify again.");

    process.env.OPERATIONAL_AGENT_MODE = "guarded_live";
    process.env.LLM_PROVIDER = "openai";
    process.env.LLM_LIVE_CALLS_ENABLED = "true";
    process.env.OPENAI_API_KEY = "sk-test-placeholder-not-used-by-smoke";
    const readiness = await getGuardedOperationalAgentIntegrationReadiness({ checkDatabase: false });
    assert(readiness.allowed, `Exact active bundle should permit guarded live readiness: ${JSON.stringify(readiness.blocking_reasons)}`);
    assert(readiness.readiness_snapshot.evaluation_evidence_found, "Derived approval evidence must satisfy the production guard.");
    assert(readiness.readiness_snapshot.evaluation_evidence_source === "derived_approval_bundle", "Guard must identify derived approval evidence.");

    const rolledBack = rollbackOperationalApprovalBundle({
      bundlePath: activated.bundle_path,
      expectedCurrentRuntimeHash: EXPECTED_RUNTIME_HASH,
      expectedRollbackHash: LEGACY_GPT54_APPROVED_RUNTIME_HASH,
      confirmation: "rollback to approved gpt-5.4 baseline"
    });
    delete process.env.OPERATIONAL_APPROVED_MANIFEST_PATH;
    delete process.env.OPERATIONAL_APPROVAL_EVIDENCE_PATH;
    process.env.OPERATIONAL_APPROVED_CONFIG_HASH = LEGACY_GPT54_APPROVED_RUNTIME_HASH;
    const rollback = resolveActiveOperationalApproval();
    assert(rollback?.kind === "legacy_gpt54_baseline", "Rollback must activate the preserved GPT-5.4 bundle.");
    assert(rolledBack.gpt56_approval_evidence_preserved, "Rollback must preserve GPT-5.6 evidence.");
    assert(readFileSync(rollback.record.previous_derived_approval.approval_evidence.path, "utf8").length > 0, "GPT-5.6 evidence copy must remain readable.");
    const legacyResolution = resolveApprovedOperationalRuntimeRequirement({
      requestedHash: EXPECTED_RUNTIME_HASH,
      bundlePath: activated.bundle_path,
      env: {}
    });
    assert(legacyResolution.resolution_source === "legacy_fallback", "Legacy source must remain explicit.");
    assert(!legacyResolution.approved_bundle_complete, "Legacy fallback must not satisfy an approved requirement.");

    const missingResolution = resolveApprovedOperationalRuntimeRequirement({
      requestedHash: EXPECTED_RUNTIME_HASH,
      bundlePath: path.join(root, "missing", "active-approval-bundle.json"),
      env: {}
    });
    assert(missingResolution.resolution_source === "none", "Missing local materialization must resolve to none.");
    assert(!missingResolution.approved_bundle_complete, "Missing local materialization must fail closed.");

    const localOutput = path.join(root, "local-materialization");
    const materialized = materializeApprovedOperationalRuntimeLocally({
      approvalEvidencePath: evidencePath,
      approvedManifestPath: manifestPath,
      sourceCandidateManifestPath: manifestSource,
      expectedRuntimeHash: EXPECTED_RUNTIME_HASH,
      expectedEvaluationProtocolHash: EXPECTED_PROTOCOL_HASH,
      expectedApprovalEvidenceHash: approvalEvidenceHash,
      expectedSourceProviderRunId: SOURCE_RUN,
      expectedDerivedEvaluationId: DERIVED_RUN,
      confirmation: "materialize approved operational runtime locally",
      outputDirectory: localOutput,
      allowNonDefaultOutputDirectoryForTest: true
    });
    assert(materialized.status === "materialized_local", "Local materialization should create a verified pointer.");
    assert(materialized.resolution.approved_bundle_complete, "Materialized bundle must be complete.");
    assert(materialized.resolution.role_count === 17, "Materialized bundle must contain all roles.");
    const materializedAgain = materializeApprovedOperationalRuntimeLocally({
      approvalEvidencePath: evidencePath,
      approvedManifestPath: manifestPath,
      sourceCandidateManifestPath: manifestSource,
      expectedRuntimeHash: EXPECTED_RUNTIME_HASH,
      expectedEvaluationProtocolHash: EXPECTED_PROTOCOL_HASH,
      expectedApprovalEvidenceHash: approvalEvidenceHash,
      expectedSourceProviderRunId: SOURCE_RUN,
      expectedDerivedEvaluationId: DERIVED_RUN,
      confirmation: "materialize approved operational runtime locally",
      outputDirectory: localOutput,
      allowNonDefaultOutputDirectoryForTest: true
    });
    assert(materializedAgain.status === "already_materialized", "Repeated local materialization must be idempotent.");
    assert(!materializedAgain.local_state_mutated, "Idempotent materialization must not rewrite local state.");

    const mismatchedSource = path.join(root, "mismatched-source-manifest.json");
    writeFileSync(mismatchedSource, `${readFileSync(manifestSource, "utf8")}\n`, "utf8");
    let mismatchBlocked = false;
    try {
      materializeApprovedOperationalRuntimeLocally({
        approvalEvidencePath: evidencePath,
        approvedManifestPath: manifestPath,
        sourceCandidateManifestPath: mismatchedSource,
        expectedRuntimeHash: EXPECTED_RUNTIME_HASH,
        expectedEvaluationProtocolHash: EXPECTED_PROTOCOL_HASH,
        expectedApprovalEvidenceHash: approvalEvidenceHash,
        expectedSourceProviderRunId: SOURCE_RUN,
        expectedDerivedEvaluationId: DERIVED_RUN,
        confirmation: "materialize approved operational runtime locally",
        outputDirectory: path.join(root, "mismatch-materialization"),
        allowNonDefaultOutputDirectoryForTest: true
      });
    } catch (error) {
      mismatchBlocked = error instanceof Error &&
        "code" in error && error.code === "local_materialization_source_manifest_hash_mismatch";
    }
    assert(mismatchBlocked, "Local materialization must reject a source-manifest hash mismatch.");

    const incompleteManifestPath = path.join(root, "incomplete-approved-manifest.json");
    const incompleteManifest = JSON.parse(readFileSync(manifestSource, "utf8")) as {
      roles: Record<string, unknown>;
      configuration_fingerprint: { role_version_metadata: Record<string, unknown> };
    };
    delete incompleteManifest.roles.topic_dialogue_agent;
    delete incompleteManifest.configuration_fingerprint.role_version_metadata.topic_dialogue_agent;
    writeFileSync(incompleteManifestPath, `${JSON.stringify(incompleteManifest, null, 2)}\n`, "utf8");
    const incompleteEvidencePath = path.join(root, "incomplete-approval-evidence.json");
    const incompleteEvidence = JSON.parse(readFileSync(evidencePath, "utf8")) as Record<string, unknown>;
    incompleteEvidence.approved_manifest_artifact_path = incompleteManifestPath;
    writeFileSync(incompleteEvidencePath, `${JSON.stringify(incompleteEvidence, null, 2)}\n`, "utf8");
    let missingRoleBlocked = false;
    try {
      materializeApprovedOperationalRuntimeLocally({
        approvalEvidencePath: incompleteEvidencePath,
        approvedManifestPath: incompleteManifestPath,
        sourceCandidateManifestPath: incompleteManifestPath,
        expectedRuntimeHash: EXPECTED_RUNTIME_HASH,
        expectedEvaluationProtocolHash: EXPECTED_PROTOCOL_HASH,
        expectedApprovalEvidenceHash: approvalEvidenceHash,
        expectedSourceProviderRunId: SOURCE_RUN,
        expectedDerivedEvaluationId: DERIVED_RUN,
        confirmation: "materialize approved operational runtime locally",
        outputDirectory: path.join(root, "missing-role-materialization"),
        allowNonDefaultOutputDirectoryForTest: true
      });
    } catch (error) {
      missingRoleBlocked = error instanceof Error &&
        "code" in error && error.code === "approved_role_inventory_mismatch";
    }
    assert(missingRoleBlocked, "Local materialization must reject a missing approved role.");

    console.log(JSON.stringify({
      status: "passed",
      runtime_candidate_hash: EXPECTED_RUNTIME_HASH,
      evaluation_protocol_hash: EXPECTED_PROTOCOL_HASH,
      approval_evidence_hash: approvalEvidenceHash,
      role_count: APPROVED_OPERATIONAL_ROLE_NAMES.length,
      derived_evidence_recognized: true,
      extension_role_resolution_independent: true,
      incompatible_role_resolution_blocked: true,
      invalid_bundle_did_not_fall_back: true,
      environment_mismatch_blocked: true,
      missing_materialization_failed_closed: true,
      legacy_fallback_rejected_for_approved_requirement: true,
      exact_seventeen_role_materialization_verified: true,
      local_materialization_idempotent: true,
      local_manifest_mismatch_blocked: true,
      local_missing_role_blocked: true,
      rollback_hash: rolledBack.active_approved_hash,
      no_openai_call: true
    }, null, 2));
  } finally {
    for (const key of touchedEnvKeys) {
      const value = original[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
