import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { ApprovedCandidateManifestSchema, LEGACY_GPT54_APPROVED_RUNTIME_HASH, PROFILING_V6_HASH,
  approvedOperationalRoleNamesForManifest, activateOperationalApprovalBundle, prepareProfilingRepairAmendment,
  resolveActiveOperationalApproval, verifyApprovedCandidateArtifacts, prepareGlobalFeedbackBudgetAmendment,
  prepareConnectivityBudgetAmendment, prepareSolLowReasoningAmendment } from "../src/lib/operational/active-approval-bundle";
import { agentModelReadiness, resolveConnectivityModelConfig, resolveOpenAIModelConfigForRole } from "../src/lib/llm/config";
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
  manifest.roles.formative_conversation_agent = { ...manifest.roles.topic_dialogue_agent!, max_output_tokens: 7000 };
  manifest.runtime_policy.role_live_toggles.formative_conversation_agent = true;
  manifest.configuration_fingerprint.role_version_metadata.formative_conversation_agent =
    { ...manifest.configuration_fingerprint.role_version_metadata.topic_dialogue_agent };
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
  const scopedBundle = activateOperationalApprovalBundle({ ...verifyArgs, expectedSourceProviderRunId: prepared.evidence.source_provider_run_id,
    expectedDerivedEvaluationId: prepared.evidence.derived_evaluation_id, confirmation: "activate approved gpt-5.6 operational candidate v2",
    outputDirectory: path.join(root, "scoped-active") });
  const scopedParent = resolveActiveOperationalApproval({ bundlePath: scopedBundle.bundle_path, env: {} });
  assert(scopedParent?.kind === "derived_approval");
  const globalArgs = { parent: scopedParent, expectedParentHash: prepared.evidence.runtime_candidate_hash,
    validationEvidencePath: validationPath, authorizationReference: "SYNTHETIC GLOBAL FIXTURE ONLY" };
  const global = prepareGlobalFeedbackBudgetAmendment({ ...globalArgs, outputDirectory: path.join(root, "global") });
  const globalVerify = { approvedManifestPath: global.manifestPath, approvalEvidencePath: global.evidencePath,
    expectedRuntimeHash: global.evidence.runtime_candidate_hash, expectedEvaluationProtocolHash: global.evidence.evaluation_protocol_hash,
    expectedApprovalEvidenceHash: global.evidence.approval_evidence_hash };
  const globalManifest = verifyApprovedCandidateArtifacts(globalVerify).manifest;
  check(() => assert.equal(globalManifest.runtime_policy.initial_feedback_max_output_tokens, 30000));
  check(() => assert.equal(globalManifest.runtime_policy.initial_feedback_budget_grants, undefined));
  check(() => assert.deepEqual(globalManifest.roles, scopedParent.manifest.roles));
  for (let student = 0; student < 3; student++) for (let assessment = 0; assessment < 2; assessment++) {
    const selection = selectInitialFeedbackBudget({ base, grants: [], globalMaxOutputTokens: 30000,
      session: { user_db_id: randomUUID(), assessment_db_id: randomUUID() }, approvedRuntimeHash: global.evidence.runtime_candidate_hash });
    check(() => assert.equal(selection.model_config.max_output_tokens, 30000));
    check(() => assert.equal(selection.audit.approval_scope, "all_students"));
    check(() => assert.equal(selection.audit.grant_id, null));
  }
  check(() => assert.throws(() => selectInitialFeedbackBudget({ base, grants: [grant], session, globalMaxOutputTokens: 30000, approvedRuntimeHash: parentHash })));
  check(() => assert.equal(global.evidence.human_review.semantic_review_confirmed, false));
  const globalBundle = activateOperationalApprovalBundle({ ...globalVerify,
    expectedSourceProviderRunId: global.evidence.source_provider_run_id, expectedDerivedEvaluationId: global.evidence.derived_evaluation_id,
    confirmation: "activate approved gpt-5.6 operational candidate v2", outputDirectory: path.join(root, "global-active") });
  const diagnosticParent = resolveActiveOperationalApproval({ bundlePath: globalBundle.bundle_path, env: {} });
  assert(diagnosticParent?.kind === "derived_approval");
  const diagnosticArgs = { parent: diagnosticParent, expectedParentHash: global.evidence.runtime_candidate_hash,
    authorizationReference: "SYNTHETIC DIAGNOSTIC FIXTURE ONLY" };
  const diagnostic = prepareConnectivityBudgetAmendment({ ...diagnosticArgs, outputDirectory: path.join(root, "diagnostic") });
  const diagnosticVerify = { approvedManifestPath: diagnostic.manifestPath, approvalEvidencePath: diagnostic.evidencePath,
    expectedRuntimeHash: diagnostic.evidence.runtime_candidate_hash, expectedEvaluationProtocolHash: diagnostic.evidence.evaluation_protocol_hash,
    expectedApprovalEvidenceHash: diagnostic.evidence.approval_evidence_hash };
  const diagnosticManifest = verifyApprovedCandidateArtifacts(diagnosticVerify).manifest;
  const expectedDiagnostic = structuredClone(globalManifest);
  expectedDiagnostic.roles.connectivity_test!.max_output_tokens = 2000;
  check(() => assert.deepEqual(diagnosticManifest, expectedDiagnostic));
  check(() => assert.equal(globalManifest.roles.connectivity_test!.max_output_tokens, 200));
  check(() => assert.equal(diagnosticManifest.runtime_policy.initial_feedback_max_output_tokens, 30000));
  check(() => assert.notEqual(diagnostic.evidence.runtime_candidate_hash, diagnosticParent.record.runtime_candidate_hash));
  check(() => assert.equal(diagnostic.evidence.human_review.semantic_review_confirmed, false));
  check(() => assert.throws(() => prepareConnectivityBudgetAmendment({ ...diagnosticArgs, authorizationReference: "", outputDirectory: path.join(root, "no-auth") })));
  check(() => assert.throws(() => prepareConnectivityBudgetAmendment({ ...diagnosticArgs, expectedParentHash: "f".repeat(64), outputDirectory: path.join(root, "bad-parent") })));
  const diagnosticBundle = activateOperationalApprovalBundle({ ...diagnosticVerify,
    expectedSourceProviderRunId: diagnostic.evidence.source_provider_run_id, expectedDerivedEvaluationId: diagnostic.evidence.derived_evaluation_id,
    confirmation: "activate approved gpt-5.6 operational candidate v2", outputDirectory: path.join(root, "diagnostic-active") });
  const previousEnv = { ...process.env };
  const lowParent = resolveActiveOperationalApproval({ bundlePath: diagnosticBundle.bundle_path, env: {} });
  assert(lowParent?.kind === "derived_approval");
  const lowValidationPath = save("low-validation.json", { version: "sol-low-input-dedup-validation-v1",
    synthetic_only: true, real_student_data_used: false, lossless_roundtrip_passed: true, regression_passed: true,
    live_evaluation_required_before_deployment: true });
  const lowArgs = { parent: lowParent, expectedParentHash: diagnostic.evidence.runtime_candidate_hash,
    validationEvidencePath: lowValidationPath, authorizationReference: "SYNTHETIC FIXTURE ONLY" };
  const low = prepareSolLowReasoningAmendment({ ...lowArgs, outputDirectory: path.join(root, "low") });
  const lowVerify = { approvedManifestPath: low.manifestPath, approvalEvidencePath: low.evidencePath,
    expectedRuntimeHash: low.evidence.runtime_candidate_hash, expectedEvaluationProtocolHash: low.evidence.evaluation_protocol_hash,
    expectedApprovalEvidenceHash: low.evidence.approval_evidence_hash };
  const lowManifest = verifyApprovedCandidateArtifacts(lowVerify).manifest;
  const expectedLow = structuredClone(diagnosticManifest);
  expectedLow.roles.formative_value_and_planning_agent!.reasoning_effort = "low";
  expectedLow.roles.formative_conversation_agent!.reasoning_effort = "low";
  check(() => assert.deepEqual(lowManifest, expectedLow));
  check(() => assert.equal(low.evidence.human_review.semantic_review_confirmed, false));
  check(() => assert.throws(() => prepareSolLowReasoningAmendment({ ...lowArgs, authorizationReference: "", outputDirectory: path.join(root, "low-no-auth") })));
  check(() => assert.throws(() => prepareSolLowReasoningAmendment({ ...lowArgs, expectedParentHash: "0".repeat(64), outputDirectory: path.join(root, "low-wrong-parent") })));
  const invalidLow = structuredClone(lowManifest);
  invalidLow.roles.student_profiling_agent!.reasoning_effort = "low";
  writeFileSync(low.manifestPath, JSON.stringify(invalidLow));
  check(() => assert.throws(() => verifyApprovedCandidateArtifacts(lowVerify)));
  writeFileSync(low.manifestPath, JSON.stringify(lowManifest));
  const validationBefore = readFileSync(lowValidationPath, "utf8");
  writeFileSync(lowValidationPath, validationBefore.replace('"regression_passed":true', '"regression_passed":false'));
  check(() => assert.throws(() => verifyApprovedCandidateArtifacts(lowVerify)));
  writeFileSync(lowValidationPath, validationBefore);
  const lowBundle = activateOperationalApprovalBundle({ ...lowVerify, expectedSourceProviderRunId: low.evidence.source_provider_run_id,
    expectedDerivedEvaluationId: low.evidence.derived_evaluation_id, confirmation: "activate approved gpt-5.6 operational candidate v2",
    outputDirectory: path.join(root, "low-active") });
  const previousCwd = process.cwd();
  try {
    for (const key of Object.keys(process.env)) if (/^(OPENAI_|LLM_|OPERATIONAL_|TOPIC_DIALOGUE_|STUDENT_COMMUNICATION_|FORMATIVE_CONVERSATION_)/u.test(key)) delete process.env[key];
    process.chdir(root);
    Object.assign(process.env, { DATABASE_URL: "postgresql://test:test@localhost:5432/synthetic",
      SESSION_SECRET: "synthetic-diagnostic-secret-at-least-32-characters", LLM_PROVIDER: "openai", LLM_LIVE_CALLS_ENABLED: "true",
      OPENAI_API_KEY: "sk-synthetic-not-a-real-key", OPENAI_MODEL_CONNECTIVITY_TEST: "gpt-5.6-luna",
      OPENAI_REASONING_EFFORT_CONNECTIVITY_TEST: "none" });
    check(() => assert.equal(resolveConnectivityModelConfig().max_output_tokens, 2000));
    check(() => assert.equal(resolveOpenAIModelConfigForRole("connectivity_test").max_output_tokens, 2000));
    check(() => assert.equal(agentModelReadiness().connectivity_test.max_output_tokens, 2000));
    Object.assign(process.env, diagnosticBundle.render_variables);
    check(() => assert.equal(resolveConnectivityModelConfig().max_output_tokens, 2000));
    check(() => assert.equal(agentModelReadiness().connectivity_test.max_output_tokens, 2000));
    for (const [role, config] of Object.entries(globalManifest.roles)) {
      if (role === "connectivity_test") continue;
      check(() => assert.deepEqual(resolveOpenAIModelConfigForRole(role as Parameters<typeof resolveOpenAIModelConfigForRole>[0]), config));
    }
    process.env.OPERATIONAL_APPROVED_CONFIG_HASH = global.evidence.runtime_candidate_hash;
    check(() => assert.throws(() => resolveConnectivityModelConfig(), /does not match/u));
    Object.assign(process.env, globalBundle.render_variables);
    check(() => assert.equal(resolveConnectivityModelConfig().max_output_tokens, 200));
    Object.assign(process.env, lowBundle.render_variables);
    check(() => assert.equal(resolveOpenAIModelConfigForRole("formative_conversation_agent").reasoning_effort, "low"));
    check(() => assert.equal(resolveOpenAIModelConfigForRole("formative_value_and_planning_agent").reasoning_effort, "low"));
    check(() => assert.equal(resolveOpenAIModelConfigForRole("student_profiling_agent").reasoning_effort, "medium"));
    process.env.LLM_LIVE_CALLS_ENABLED = "false";
    check(() => assert.throws(() => resolveConnectivityModelConfig(), /live|enabled/iu));
  } finally {
    process.chdir(previousCwd);
    for (const key of Object.keys(process.env)) if (!(key in previousEnv)) delete process.env[key];
    Object.assign(process.env, previousEnv);
  }
  const invalidDiagnostic = structuredClone(diagnosticManifest);
  invalidDiagnostic.roles.student_profiling_agent!.max_output_tokens = 30000;
  writeFileSync(diagnostic.manifestPath, JSON.stringify(invalidDiagnostic));
  check(() => assert.throws(() => verifyApprovedCandidateArtifacts(diagnosticVerify)));
  writeFileSync(diagnostic.manifestPath, JSON.stringify(diagnosticManifest));
  check(() => assert.throws(() => prepareGlobalFeedbackBudgetAmendment({ ...globalArgs, authorizationReference: "", outputDirectory: path.join(root, "unauthorized") })));
  const invalidGlobal = structuredClone(globalManifest);
  invalidGlobal.roles.student_profiling_agent!.max_output_tokens = 30000;
  writeFileSync(global.manifestPath, JSON.stringify(invalidGlobal));
  check(() => assert.throws(() => verifyApprovedCandidateArtifacts(globalVerify)));
  writeFileSync(global.manifestPath, JSON.stringify(globalManifest));
  writeFileSync(path.join(root, "global", "validation.json"), "{}");
  check(() => assert.throws(() => verifyApprovedCandidateArtifacts(globalVerify)));
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
