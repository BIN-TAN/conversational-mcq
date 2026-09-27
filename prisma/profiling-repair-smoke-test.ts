import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { ApprovedCandidateManifestSchema, LEGACY_GPT54_APPROVED_RUNTIME_HASH, PROFILING_V6_HASH,
  approvedOperationalRoleNamesForManifest, activateOperationalApprovalBundle, prepareProfilingRepairAmendment,
  resolveActiveOperationalApproval, verifyApprovedCandidateArtifacts } from "../src/lib/operational/active-approval-bundle";
import { modelUpgradeCandidateRuntimeHash } from "../src/lib/operational/model-upgrade-candidate-identity";
import { ScopedFeedbackBudgetSchema, selectInitialFeedbackBudget } from "../src/lib/operational/scoped-feedback-budget";
import { getPromptForAgent } from "../src/lib/agents/prompts/registry";
import { stableHash } from "../src/lib/operational/stable-hash";

const root = mkdtempSync(path.join(tmpdir(), "profiling-repair-fixture-"));
const save = (name: string, value: unknown) => { const file = path.join(root, name); writeFileSync(file, JSON.stringify(value)); return file; };
let checks = 0;
const check = (fn: () => void) => { fn(); checks++; };
try {
  const manifest = ApprovedCandidateManifestSchema.parse(JSON.parse(readFileSync("config/candidate-operational-agent-config.gpt-5.6-full-v2.json", "utf8")));
  Object.assign(manifest.configuration_fingerprint.role_version_metadata.student_profiling_agent,
    { prompt_version: "student-profiling-v5", prompt_hash: "c6dcc59c6698b2c9eb8082080bde122b3f29be7e2c7632066b9acbbbbbdaf626", schema_version: "student-profile-output-v4" });
  const parentHash = modelUpgradeCandidateRuntimeHash(manifest, approvedOperationalRoleNamesForManifest(manifest));
  const manifestPath = save("parent.json", manifest);
  const identity = { source_provider_run_id: "synthetic-fixture-only", derived_evaluation_id: "synthetic-fixture-only",
    runtime_candidate_hash: parentHash, source_evaluation_protocol_hash: "a".repeat(64), evaluation_protocol_hash: "b".repeat(64),
    human_review: { decision: "approve", semantic_review_confirmed: true, note: "SYNTHETIC TEST FIXTURE; not real approval evidence" } };
  const evidence = { ...identity, approval_command_version: "synthetic-fixture", approved_at: new Date().toISOString(),
    source_artifact_sha256: "c".repeat(64), approval_evidence_hash: stableHash(identity), exact_operational_approved_config_hash: parentHash,
    rollback_hash: LEGACY_GPT54_APPROVED_RUNTIME_HASH, approved_manifest_artifact_path: manifestPath };
  const activated = activateOperationalApprovalBundle({ approvedManifestPath: manifestPath, approvalEvidencePath: save("parent-evidence.json", evidence),
    expectedRuntimeHash: parentHash, expectedEvaluationProtocolHash: identity.evaluation_protocol_hash,
    expectedApprovalEvidenceHash: evidence.approval_evidence_hash, expectedSourceProviderRunId: identity.source_provider_run_id,
    expectedDerivedEvaluationId: identity.derived_evaluation_id, confirmation: "activate approved gpt-5.6 operational candidate v2",
    outputDirectory: path.join(root, "active") });
  const parent = resolveActiveOperationalApproval({ bundlePath: activated.bundle_path, env: {} });
  assert(parent?.kind === "derived_approval");
  const parentBefore = readFileSync(parent.manifest_path, "utf8");
  const grant = ScopedFeedbackBudgetSchema.parse({ grant_id: randomUUID(), student_db_id: randomUUID(), assessment_db_id: randomUUID(), max_output_tokens: 30000 });
  const base = { model_name: "gpt-5.6-sol", reasoning_effort: "medium" as const, max_output_tokens: 3000 };
  const session = { user_db_id: grant.student_db_id, assessment_db_id: grant.assessment_db_id };
  const choose = (target = session, grants = [grant]) => selectInitialFeedbackBudget({ base, grants, session: target, approvedRuntimeHash: parentHash });
  check(() => assert.equal(choose().model_config.max_output_tokens, 30000));
  check(() => assert.equal(choose({ ...session, user_db_id: randomUUID() }).model_config.max_output_tokens, 3000));
  check(() => assert.equal(choose({ ...session, assessment_db_id: randomUUID() }).model_config.max_output_tokens, 3000));
  check(() => assert.equal(choose(session, []).model_config.max_output_tokens, 3000));
  check(() => assert.throws(() => choose(session, [grant, grant])));
  check(() => assert.equal(base.max_output_tokens, 3000));
  check(() => assert.equal(choose().audit.grant_id, grant.grant_id));
  check(() => assert.equal(choose().audit.approved_runtime_hash, parentHash));
  check(() => assert.equal(getPromptForAgent("student_profiling_agent").prompt_hash, PROFILING_V6_HASH));
  check(() => assert(!ScopedFeedbackBudgetSchema.safeParse({ ...grant, max_output_tokens: 60000 }).success));
  const validation = { version: "profiling-v6-scoped-budget-validation-v1", synthetic_only: true, real_student_data_used: false,
    profiling_prompt_hash: PROFILING_V6_HASH, regression_passed: true, calls: [
      ...[3, 12].map(item_count => ({ role: "formative_value_and_planning_agent", model: "gpt-5.6-sol", reasoning_effort: "medium",
        max_output_tokens: 30000, item_count, status: "completed", checks_passed: true })),
      { role: "student_profiling_agent", model: "gpt-5.6-terra", reasoning_effort: "medium", max_output_tokens: 4000,
        item_count: 3, status: "completed", checks_passed: true }
    ] };
  const validationPath = save("synthetic-validation.json", validation);
  const args = { parent, expectedParentHash: parentHash, validationEvidencePath: validationPath,
    authorizationReference: "SYNTHETIC FIXTURE ONLY", grant };
  const prepared = prepareProfilingRepairAmendment({ ...args, outputDirectory: path.join(root, "amended") });
  const verifyArgs = { approvedManifestPath: prepared.manifestPath, approvalEvidencePath: prepared.evidencePath,
    expectedRuntimeHash: prepared.evidence.runtime_candidate_hash, expectedEvaluationProtocolHash: prepared.evidence.evaluation_protocol_hash,
    expectedApprovalEvidenceHash: prepared.evidence.approval_evidence_hash };
  const verified = verifyApprovedCandidateArtifacts(verifyArgs);
  check(() => assert.equal(verified.manifest.runtime_policy.initial_feedback_budget_grants?.length, 1));
  check(() => assert.deepEqual(verified.manifest.roles, parent.manifest.roles));
  check(() => assert.equal(verified.manifest.configuration_fingerprint.role_version_metadata.student_profiling_agent.prompt_version, "student-profiling-v6"));
  check(() => assert.equal(readFileSync(parent.manifest_path, "utf8"), parentBefore));
  check(() => assert.equal(prepared.evidence.human_review.semantic_review_confirmed, false));
  check(() => assert.notEqual(prepared.evidence.runtime_candidate_hash, parentHash));
  check(() => assert.throws(() => prepareProfilingRepairAmendment({ ...args, expectedParentHash: "x".repeat(64), outputDirectory: path.join(root, "wrong") })));
  const tampered = structuredClone(verified.manifest);
  tampered.roles.formative_value_and_planning_agent!.max_output_tokens = 30000;
  writeFileSync(prepared.manifestPath, JSON.stringify(tampered));
  check(() => assert.throws(() => verifyApprovedCandidateArtifacts(verifyArgs)));
  writeFileSync(prepared.manifestPath, JSON.stringify(verified.manifest));
  writeFileSync(path.join(root, "amended", "validation.json"), "{}");
  check(() => assert.throws(() => verifyApprovedCandidateArtifacts(verifyArgs)));
  save("synthetic-validation.json", { ...validation, calls: validation.calls.slice(0, 1) });
  check(() => assert.throws(() => prepareProfilingRepairAmendment({ ...args, outputDirectory: path.join(root, "incomplete") })));
  console.log(`PASS ${checks} scoped-budget and approval-integrity checks (synthetic fixtures only)`);
} finally { rmSync(root, { recursive: true, force: true }); }
