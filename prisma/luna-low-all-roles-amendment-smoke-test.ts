import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  APPROVED_OPERATIONAL_ROLE_NAMES,
  ApprovedCandidateManifestSchema,
  LEGACY_GPT54_APPROVED_RUNTIME_HASH,
  LUNA_LOW_ALL_ROLES_VALIDATION_VERSION,
  activateOperationalApprovalBundle,
  buildLunaLowAllRolesCandidateManifest,
  prepareLunaLowAllRolesAmendment,
  resolveActiveOperationalApproval,
  resolveApprovedOperationalRuntimeRequirement,
  stageLunaLowAllRolesCandidate,
  stageLunaLowAllRolesCandidateFromManifest,
  verifyApprovedCandidateArtifacts
} from "../src/lib/operational/active-approval-bundle";
import { modelUpgradeCandidateRuntimeHash } from "../src/lib/operational/model-upgrade-candidate-identity";
import { stableHash } from "../src/lib/operational/stable-hash";
import { listAgentPrompts } from "../src/lib/agents/prompts/registry";
import { STUDENT_PROFILE_EVIDENCE_CONSISTENCY_VERSION } from "../src/lib/agents/student-profiling/semantic-validation";
import { LUNA_LOW_REQUIRED_SCENARIOS, verifyLunaLowValidation } from "../src/lib/operational/luna-low-validation-evidence";

// These records exercise verification code only. They are not real approval or provider evidence.
globalThis.fetch = async () => { throw new Error("network_not_allowed_in_offline_smoke"); };
const directory = mkdtempSync(path.join(tmpdir(), "luna-low-offline-fixture-"));
const save = (name: string, value: unknown) => {
  const file = path.join(directory, name);
  writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
  return file;
};
const fileHash = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");
let checks = 0;
const check = (action: () => void) => { action(); checks++; };

async function main() {
const originalEnv = { ...process.env };
try {
  const historicalPath = "config/candidate-operational-agent-config.gpt-5.6-full-v2.json";
  const historicalBefore = fileHash(historicalPath);
  const historical = ApprovedCandidateManifestSchema.parse(JSON.parse(readFileSync(historicalPath, "utf8")));
  check(() => assert.throws(() => buildLunaLowAllRolesCandidateManifest(historical), /18 explicit/));
  const manifest = structuredClone(historical);
  manifest.roles.formative_conversation_agent = { ...manifest.roles.topic_dialogue_agent!, max_output_tokens: 7000 };
  manifest.runtime_policy.role_live_toggles.formative_conversation_agent = true;
  manifest.runtime_policy.initial_feedback_max_output_tokens = 30000;
  manifest.roles.connectivity_test!.max_output_tokens = 2000;
  manifest.configuration_fingerprint.role_version_metadata.formative_conversation_agent =
    { ...manifest.configuration_fingerprint.role_version_metadata.topic_dialogue_agent };
  for (const prompt of listAgentPrompts()) {
    Object.assign(manifest.configuration_fingerprint.role_version_metadata[prompt.agent_name], {
      prompt_version: prompt.prompt_version, prompt_hash: prompt.prompt_hash, schema_version: prompt.schema_version
    });
  }
  manifest.configuration_fingerprint.deterministic_guard_versions.student_profile_evidence_consistency =
    STUDENT_PROFILE_EVIDENCE_CONSISTENCY_VERSION;
  const parentHash = modelUpgradeCandidateRuntimeHash(manifest, APPROVED_OPERATIONAL_ROLE_NAMES);
  const parentManifestPath = save("synthetic-parent-manifest.json", manifest);
  const identity = {
    source_provider_run_id: "OFFLINE-SYNTHETIC-TEST-FIXTURE-NO-PROVIDER-CALL",
    derived_evaluation_id: "OFFLINE-SYNTHETIC-TEST-FIXTURE-NOT-REAL-APPROVAL",
    runtime_candidate_hash: parentHash,
    source_evaluation_protocol_hash: "a".repeat(64), evaluation_protocol_hash: "b".repeat(64),
    human_review: { decision: "approve", semantic_review_confirmed: true,
      note: "OFFLINE TEST FIXTURE ONLY: no human educational review was conducted." }
  };
  const evidence = { ...identity, approval_command_version: "offline-fixture-only", approved_at: new Date().toISOString(),
    source_artifact_sha256: "c".repeat(64), approval_evidence_hash: stableHash(identity),
    exact_operational_approved_config_hash: parentHash, rollback_hash: LEGACY_GPT54_APPROVED_RUNTIME_HASH,
    approved_manifest_artifact_path: parentManifestPath };
  const parentEvidencePath = save("synthetic-parent-evidence.json", evidence);
  const parentVerify = { approvedManifestPath: parentManifestPath, approvalEvidencePath: parentEvidencePath,
    expectedRuntimeHash: parentHash, expectedEvaluationProtocolHash: identity.evaluation_protocol_hash,
    expectedApprovalEvidenceHash: evidence.approval_evidence_hash };
  check(() => assert(verifyApprovedCandidateArtifacts({ ...parentVerify, approvalDepth: 5 })));
  check(() => assert.throws(() => verifyApprovedCandidateArtifacts({ ...parentVerify, approvalDepth: 6 }), /ancestry is too deep/));
  const activated = activateOperationalApprovalBundle({ ...parentVerify,
    expectedSourceProviderRunId: identity.source_provider_run_id, expectedDerivedEvaluationId: identity.derived_evaluation_id,
    confirmation: "activate approved gpt-5.6 operational candidate v2", outputDirectory: path.join(directory, "test-parent") });
  const parent = resolveActiveOperationalApproval({ bundlePath: activated.bundle_path, env: {} });
  assert(parent?.kind === "derived_approval");
  const parentFileBefore = fileHash(parent.manifest_path);
  const parentEvidenceBefore = fileHash(parent.approval_evidence_path);
  const parentObjectBefore = stableHash(parent.manifest);
  const candidate = buildLunaLowAllRolesCandidateManifest(parent.manifest);
  check(() => assert.equal(Object.keys(candidate.roles).length, 18));
  for (const role of APPROVED_OPERATIONAL_ROLE_NAMES) {
    check(() => assert.deepEqual(candidate.roles[role], {
      ...parent.manifest.roles[role], model_name: "gpt-5.6-luna", reasoning_effort: "low"
    }));
  }
  check(() => assert.deepEqual(candidate.runtime_policy, parent.manifest.runtime_policy));
  check(() => assert.deepEqual(candidate.configuration_fingerprint, parent.manifest.configuration_fingerprint));
  check(() => assert.equal(stableHash(parent.manifest), parentObjectBefore));
  const common = { parent, expectedParentHash: parentHash, authorizationReference: "OFFLINE FIXTURE ONLY" };
  const staged = stageLunaLowAllRolesCandidate({ ...common, outputDirectory: path.join(directory, "candidate") });
  check(() => assert.equal(staged.status, "candidate_not_approved"));
  check(() => assert.equal(existsSync(path.join(directory, "candidate", "approval-evidence.json")), false));
  check(() => assert.throws(() => stageLunaLowAllRolesCandidate({ ...common,
    outputDirectory: path.join(directory, "candidate") }), /EEXIST/));
  check(() => assert.throws(() => stageLunaLowAllRolesCandidate({ ...common, authorizationReference: " ",
    outputDirectory: path.join(directory, "no-authorization") }), /authorization/));
  check(() => assert.throws(() => stageLunaLowAllRolesCandidate({ ...common, expectedParentHash: "0".repeat(64),
    outputDirectory: path.join(directory, "bad-parent") }), /parent hash/));

  const candidateEnv = {
    LUNA_LOW_LOCAL_CANDIDATE_EVALUATION: "1", APP_ENV: "development", NODE_ENV: "production",
    DATABASE_URL: "postgresql://localhost:54329/cmcq_ai_students_abcdef123456",
    OPERATIONAL_APPROVED_CONFIG_HASH: staged.runtime_candidate_hash,
    OPERATIONAL_APPROVED_MANIFEST_PATH: staged.manifestPath
  };
  const resolveCandidate = (env: Record<string, string | undefined>) =>
    resolveActiveOperationalApproval({ bundlePath: staged.candidatePath, env });
  check(() => assert.equal(resolveCandidate(candidateEnv)?.kind, "local_candidate_evaluation"));
  check(() => assert.equal(resolveApprovedOperationalRuntimeRequirement({ requestedHash: staged.runtime_candidate_hash,
    bundlePath: staged.candidatePath, env: candidateEnv }).approved_bundle_complete, false));
  for (const changed of [
    { LUNA_LOW_LOCAL_CANDIDATE_EVALUATION: undefined }, { APP_ENV: "production" },
    { DATABASE_URL: "postgresql://database.example/cmcq_ai_students_abcdef123456" },
    { DATABASE_URL: "postgresql://localhost/production" },
    { DATABASE_URL: "postgresql://localhost/cmcq_ai_students_abcdef123456?host=database.example" },
    { RENDER: "true" }, { RENDER_SERVICE_ID: "synthetic-render-service" },
    { OPERATIONAL_LIVE_CANARY_DATABASE_URL_ACTIVE: "true" },
    { OPERATIONAL_APPROVAL_EVIDENCE_PATH: parent.approval_evidence_path },
    { OPERATIONAL_APPROVED_CONFIG_HASH: parentHash }
  ]) {
    check(() => assert.throws(() => resolveCandidate({ ...candidateEnv, ...changed })));
  }
  for (const key of Object.keys(process.env)) {
    if (/^(OPENAI_|OPERATIONAL_|LUNA_LOW_|STUDENT_COMMUNICATION_|TOPIC_DIALOGUE_|FORMATIVE_CONVERSATION_)/.test(key) ||
        ["RENDER", "RENDER_SERVICE_ID"].includes(key)) delete process.env[key];
  }
  Object.assign(process.env, candidateEnv, {
    OPERATIONAL_APPROVAL_BUNDLE_PATH: staged.candidatePath,
    OPERATIONAL_AGENT_MODE: "guarded_live", LLM_PROVIDER: "openai", LLM_LIVE_CALLS_ENABLED: "true",
    SESSION_SECRET: "offline-test-session-secret-no-real-credential",
    OPENAI_API_KEY: "offline-test-placeholder-never-dispatched",
    OPERATIONAL_EFFECTIVE_RESULT_VERSION: manifest.configuration_fingerprint.effective_result_version,
    OPERATIONAL_EFFECTIVE_VALIDATOR_VERSION: manifest.configuration_fingerprint.effective_validator_version
  });
  const { resolveOpenAIModelConfigForRole } = await import("../src/lib/llm/config");
  const { verifyApprovedOperationalAgentConfig } = await import("../src/lib/agents/operational/approved-config");
  const { evaluateOperationalExecutionReadiness, getGuardedOperationalAgentIntegrationReadiness } =
    await import("../src/lib/operational/guarded-agent-integration");
  for (const role of APPROVED_OPERATIONAL_ROLE_NAMES) {
    check(() => assert.deepEqual(resolveOpenAIModelConfigForRole(role), candidate.roles[role]));
  }
  const candidateVerification = verifyApprovedOperationalAgentConfig();
  check(() => assert(candidateVerification.valid, JSON.stringify(candidateVerification.issues)));
  check(() => assert.equal(candidateVerification.approval_kind, "local_candidate_evaluation"));
  check(() => assert.equal(candidateVerification.approval_evidence_hash, null));
  const localReadiness = await getGuardedOperationalAgentIntegrationReadiness({ checkDatabase: false });
  check(() => assert(localReadiness.allowed, JSON.stringify(localReadiness.typed_blocking_reasons)));
  check(() => assert.equal(localReadiness.evidence_status, "local_candidate_validation_pending"));
  check(() => assert.equal(localReadiness.readiness_snapshot.approved_manifest_valid, false));
  check(() => assert.equal(localReadiness.readiness_snapshot.evaluation_evidence_found, false));
  check(() => assert.equal(localReadiness.approved_evaluation.source, "local_candidate_validation_pending"));
  check(() => assert.equal(localReadiness.approved_evaluation.approval_evidence_hash, null));
  check(() => assert(Object.values(localReadiness.active_agent_versions).every(agent => !agent.prompt_matches_evaluated)));
  process.env.APP_ENV = "production";
  check(() => assert.throws(() => resolveOpenAIModelConfigForRole("student_profiling_agent")));
  const forbiddenReadiness = await evaluateOperationalExecutionReadiness({ checkDatabase: false, checkUsageGuard: false });
  check(() => assert.equal(forbiddenReadiness.allowed, false));
  process.env.APP_ENV = "development";
  const exported = stageLunaLowAllRolesCandidateFromManifest({ parentManifestPath: parent.manifest_path,
    expectedParentManifestSha256: fileHash(parent.manifest_path), expectedParentRuntimeHash: parentHash,
    authorizationReference: "OFFLINE EXPORTED FIXTURE ONLY", outputDirectory: path.join(directory, "exported") });
  check(() => assert.equal(JSON.parse(readFileSync(exported.candidatePath, "utf8")).parent_approval_verification,
    "not_reverified_locally"));
  check(() => assert.equal(exported.runtime_candidate_hash, staged.runtime_candidate_hash));

  const bound = (file: string) => ({ path: file, sha256: fileHash(file) });
  const requests: Array<Record<string, unknown>> = [];
  const artifacts: Array<{ case_id: typeof LUNA_LOW_REQUIRED_SCENARIOS[number]; artifact: ReturnType<typeof bound> }> = [];
  const results = LUNA_LOW_REQUIRED_SCENARIOS.map((case_id, index) => {
    const calls = ["student_profiling_agent", "formative_conversation_agent"].map((agent_name, callIndex) => ({
      agent_name, provider: "openai", model_name: "gpt-5.6-luna", reasoning_effort: "low",
      output_validated: true, call_status: "succeeded", input_tokens: 10, output_tokens: 5,
      provider_response_id: `OFFLINE-FAKE-response-${index}-${callIndex}`,
      raw_output: { fixture_notice: "OFFLINE UNIT FIXTURE ONLY; no provider call or educational review occurred." }
    }));
    artifacts.push({ case_id, artifact: bound(save(`${case_id}-agent-calls.json`, calls)) });
    for (const [callIndex, category] of ["application", "application", "simulator_learner"].entries()) {
      requests.push({ request_index: requests.length + 1, case_id, category, model_name: "gpt-5.6-luna",
        status: "completed", usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
        provider_response_id: `OFFLINE-FAKE-response-${index}-${callIndex}` });
    }
    return { case_id, session_public_id: `OFFLINE-FAKE-session-${index}`,
      outcome: "mechanical_checks_passed_manual_pedagogical_review_required",
      validated_live_initial_profile_calls: 1, preparation: { status: "completed" },
      application_usage: { calls: 2, rejected_or_failed_calls: [], token_budget_failures: 0, input_tokens: 20, output_tokens: 10 },
      generated_student_replies: Array.from({ length: 6 }, (_, turn) => ({ source: turn === 0 ? "adaptive_ai" : "scripted_edge_case",
        usage: turn === 0 ? { input_tokens: 10, output_tokens: 5, total_tokens: 15 } : null })),
      research_manifest_entries_verified: 43, exported_turn_count: 13,
      transcript: Array.from({ length: 13 }, (_, turn) => ({ actor: turn % 2 === 0 ? "tutor" : "student" })) };
  });
  const report = { version: "ai-student-journeys-v3", suite: "conversational-support-needs", synthetic_only: true,
    real_student_records_used: false, runtime_hash: staged.runtime_candidate_hash, source_commit: "d".repeat(40),
    source_files_sha256: { "OFFLINE-FAKE-SOURCE.ts": "e".repeat(64) },
    student_model: { model_name: "gpt-5.6-luna", reasoning_effort: "low" },
    provider_dispatches: requests.length, provider_models: { "gpt-5.6-luna": requests.length },
    finished_at: new Date().toISOString(), results,
    fixture_notice: "OFFLINE VERIFICATION FIXTURE; no provider call or real simulation occurred." };
  const reportPath = save("offline-native-report.json", report);
  const transport = { version: "ai-session-transport-usage-v1", requests };
  const transportPath = save("offline-transport.json", transport);
  const validation = { version: LUNA_LOW_ALL_ROLES_VALIDATION_VERSION, synthetic_only: true,
    real_student_data_used: false, provider: "openai", runtime_candidate_hash: staged.runtime_candidate_hash,
    all_role_configs_checked: true, regression_passed: true, results_reviewed: true,
    review_method: "engineering_contract_and_transcript_review",
    journey_runs: [{ report: bound(reportPath), agent_calls: artifacts,
      transport_request_indices: requests.map(row => row.request_index as number) }],
    transport_usage: bound(transportPath), reviewed_limitations: [] as Array<{ case_id: typeof LUNA_LOW_REQUIRED_SCENARIOS[number]; limitation: string }>,
    prior_attempts: [] as Array<{ report: ReturnType<typeof bound>; transport_request_indices: number[]; reason: string }> };
  const validationPath = save("offline-validation.json", validation);
  const prepared = prepareLunaLowAllRolesAmendment({ ...common, validationEvidencePath: validationPath,
    outputDirectory: path.join(directory, "offline-final-approval") });
  const verifyArgs = { approvedManifestPath: prepared.manifestPath, approvalEvidencePath: prepared.evidencePath,
    expectedRuntimeHash: prepared.evidence.runtime_candidate_hash,
    expectedEvaluationProtocolHash: prepared.evidence.evaluation_protocol_hash,
    expectedApprovalEvidenceHash: prepared.evidence.approval_evidence_hash };
  check(() => assert.deepEqual(verifyApprovedCandidateArtifacts(verifyArgs).manifest, candidate));
  check(() => assert.equal(prepared.evidence.human_review.semantic_review_confirmed, false));
  check(() => assert.equal(prepared.evidence.human_review.operator_authorized, true));
  check(() => assert.equal(prepared.evidence.rollback_hash, parent.evidence.rollback_hash));
  check(() => assert.equal(existsSync(path.join(directory, "offline-final-approval", "active-approval-bundle.json")), false));
  const invalidValidations = [
    { ...validation, journey_runs: [] },
    { ...validation, provider: "mock" },
    { ...validation, real_student_data_used: true },
    { ...validation, runtime_candidate_hash: parentHash },
    { ...validation, regression_passed: false },
    { ...validation, results_reviewed: false },
    { ...validation, all_role_configs_checked: false },
    { ...validation, journey_runs: [validation.journey_runs[0], validation.journey_runs[0]] },
    { ...validation, journey_runs: [{ ...validation.journey_runs[0], agent_calls: artifacts.slice(0, 6) }] },
    { ...validation, journey_runs: [{ ...validation.journey_runs[0], transport_request_indices: [1, 1, ...validation.journey_runs[0].transport_request_indices.slice(2)] }] },
    { ...validation, journey_runs: [{ ...validation.journey_runs[0], report: { ...bound(reportPath), sha256: "0".repeat(64) } }] },
    { ...validation, transport_usage: { ...bound(transportPath), sha256: "0".repeat(64) } }
  ];
  for (const [index, invalid] of invalidValidations.entries()) {
    const invalidPath = save(`invalid-validation-${index}.json`, invalid);
    const rejectedDirectory = path.join(directory, `rejected-${index}`);
    check(() => assert.throws(() => prepareLunaLowAllRolesAmendment({ ...common,
      validationEvidencePath: invalidPath, outputDirectory: rejectedDirectory })));
    check(() => assert.equal(existsSync(rejectedDirectory), false));
  }
  const resultBefore = readFileSync(reportPath, "utf8");
  writeFileSync(reportPath, resultBefore.replace('"exported_turn_count": 13', '"exported_turn_count": 0'));
  check(() => assert.throws(() => verifyApprovedCandidateArtifacts(verifyArgs), /integrity mismatch/));
  writeFileSync(reportPath, resultBefore);
  const verifyFixture = (fixture: typeof validation) => {
    const file = save("native-fixture-under-test.json", fixture);
    return verifyLunaLowValidation(bound(file), staged.runtime_candidate_hash);
  };
  for (const mutate of [
    (copy: typeof report) => { copy.results.pop(); },
    (copy: typeof report) => { copy.results[0].outcome = "failed"; },
    (copy: typeof report) => { copy.results[0].validated_live_initial_profile_calls = 0; },
    (copy: typeof report) => { copy.results[0].application_usage.token_budget_failures = 1; },
    (copy: typeof report) => { copy.results[0].session_public_id = copy.results[1].session_public_id; },
    (copy: typeof report) => { copy.results[0].case_id = copy.results[1].case_id; },
    (copy: typeof report) => { copy.student_model.reasoning_effort = "medium"; },
    (copy: typeof report) => { copy.runtime_hash = parentHash; },
    (copy: typeof report) => { copy.results[0].generated_student_replies[0].usage!.input_tokens = 0; },
    (copy: typeof report) => { copy.results[0].research_manifest_entries_verified = 0; }
  ]) {
    const copy = structuredClone(report); mutate(copy); save(path.basename(reportPath), copy);
    const wrapper = structuredClone(validation); wrapper.journey_runs[0].report = bound(reportPath);
    check(() => assert.throws(() => verifyFixture(wrapper)));
  }
  save(path.basename(reportPath), report);
  const firstCallsPath = artifacts[0].artifact.path;
  const firstCalls = JSON.parse(readFileSync(firstCallsPath, "utf8")) as Array<Record<string, unknown>>;
  for (const patch of [ { model_name: "gpt-5.6-sol" }, { reasoning_effort: "medium" }, { output_validated: false },
    { call_status: "failed" }, { input_tokens: 0 }, { provider: "mock" }, { provider_response_id: "unrelated" },
    { agent_name: "not_a_profile" } ]) {
    const calls = structuredClone(firstCalls); Object.assign(calls[0], patch); save(path.basename(firstCallsPath), calls);
    const wrapper = structuredClone(validation); wrapper.journey_runs[0].agent_calls[0].artifact = bound(firstCallsPath);
    check(() => assert.throws(() => verifyFixture(wrapper)));
  }
  save(path.basename(firstCallsPath), firstCalls);
  for (const patch of [ { model_name: "gpt-5.6-sol" }, { status: "unknown" }, { usage: null },
    { provider_response_id: "unrelated" }, { category: "unknown" }, { request_index: 2 }, { case_id: "connectivity_probe" } ]) {
    const copy = structuredClone(transport); Object.assign(copy.requests[0], patch); save(path.basename(transportPath), copy);
    const wrapper = structuredClone(validation); wrapper.transport_usage = bound(transportPath);
    check(() => assert.throws(() => verifyFixture(wrapper)));
  }
  save(path.basename(transportPath), transport);
  // Seven separately invoked native reports are allowed without weakening the exact case inventory.
  const separate = structuredClone(validation);
  separate.journey_runs = results.map((result, index) => ({
    report: bound(save(`offline-single-report-${index}.json`, { ...report, results: [result],
      provider_dispatches: 3, provider_models: { "gpt-5.6-luna": 3 } })),
    agent_calls: [artifacts[index]], transport_request_indices: [index * 3 + 1, index * 3 + 2, index * 3 + 3]
  }));
  check(() => assert(verifyFixture(separate)));
  // Keep earlier failed attempts and their dispatches; they never substitute for a passing case.
  const withPrior = structuredClone(validation);
  const extraTransport = structuredClone(transport);
  extraTransport.requests.push({ ...requests[0], request_index: 22, status: "failed", usage: null,
    provider_response_id: null });
  save(path.basename(transportPath), extraTransport); withPrior.transport_usage = bound(transportPath);
  check(() => assert.throws(() => verifyFixture(withPrior), /earlier attempt/));
  withPrior.prior_attempts.push({ report: bound(save("offline-failed-prior-report.json", { ...report,
    results: [{ case_id: results[0].case_id, outcome: "failed" }], provider_dispatches: 1,
    provider_models: { "gpt-5.6-luna": 1 } })), transport_request_indices: [22], reason: "Retained offline fixture failure." });
  check(() => assert(verifyFixture(withPrior)));
  const interruptedPrior = structuredClone(withPrior);
  interruptedPrior.prior_attempts[0].report = bound(save("offline-interrupted-prior-report.json", { ...report,
    results: [{ case_id: results[0].case_id, outcome: "failed" }], provider_dispatches: 2,
    provider_models: { "gpt-5.6-luna": 2 } }));
  interruptedPrior.prior_attempts[0].reason = "Offline fixture: one adapter entry was interrupted before fetch; its failed attempt is retained.";
  check(() => assert(verifyFixture(interruptedPrior)));
  save(path.basename(transportPath), transport);
  // A retained failed draft/call followed by accepted native completion is reviewable,
  // whereas an actually failed required scenario is never an accepted result.
  const recoveredCalls = [...firstCalls, { ...firstCalls[1], call_status: "failed", output_validated: false,
    provider_response_id: "OFFLINE-FAKE-recovered-draft" }];
  save(path.basename(firstCallsPath), recoveredCalls);
  const recoveredReport = structuredClone(report);
  recoveredReport.provider_dispatches++;
  recoveredReport.provider_models["gpt-5.6-luna"]++;
  Object.assign(recoveredReport.results[0].application_usage, { calls: 3, input_tokens: 30, output_tokens: 15,
    rejected_or_failed_calls: [{ agent_name: "formative_conversation_agent", call_status: "failed" }] });
  save(path.basename(reportPath), recoveredReport);
  const recoveredTransport = structuredClone(transport);
  recoveredTransport.requests.push({ ...requests[0], request_index: 22, status: "failed",
    provider_response_id: "OFFLINE-FAKE-recovered-draft" });
  save(path.basename(transportPath), recoveredTransport);
  const recovered = structuredClone(validation);
  recovered.journey_runs[0].report = bound(reportPath);
  recovered.journey_runs[0].agent_calls[0].artifact = bound(firstCallsPath);
  recovered.journey_runs[0].transport_request_indices.push(22);
  recovered.transport_usage = bound(transportPath);
  check(() => assert.throws(() => verifyFixture(recovered), /reviewed limitation/));
  recovered.reviewed_limitations.push({ case_id: results[0].case_id,
    limitation: "Offline fixture: retained failed draft followed by native accepted completion, not an educational validation claim." });
  check(() => assert(verifyFixture(recovered)));
  save(path.basename(firstCallsPath), firstCalls);
  save(path.basename(reportPath), report);
  save(path.basename(transportPath), transport);
  for (const mutate of [
    (copy: typeof candidate) => { copy.roles.formative_conversation_agent!.max_output_tokens++; },
    (copy: typeof candidate) => { copy.configuration_fingerprint.role_version_metadata.student_profiling_agent.prompt_hash = "changed"; },
    (copy: typeof candidate) => { copy.runtime_policy.provider_max_retries++; }
  ]) {
    const altered = structuredClone(candidate);
    mutate(altered);
    const alteredHash = modelUpgradeCandidateRuntimeHash(altered, APPROVED_OPERATIONAL_ROLE_NAMES);
    const alteredEvidence = structuredClone(prepared.evidence);
    alteredEvidence.runtime_candidate_hash = alteredHash;
    alteredEvidence.exact_operational_approved_config_hash = alteredHash;
    alteredEvidence.approval_evidence_hash = stableHash({
      source_provider_run_id: alteredEvidence.source_provider_run_id,
      derived_evaluation_id: alteredEvidence.derived_evaluation_id,
      runtime_candidate_hash: alteredHash,
      source_evaluation_protocol_hash: alteredEvidence.source_evaluation_protocol_hash,
      evaluation_protocol_hash: alteredEvidence.evaluation_protocol_hash,
      human_review: alteredEvidence.human_review
    });
    const alteredManifestPath = save("altered-manifest.json", altered);
    const alteredEvidencePath = save("altered-evidence.json", alteredEvidence);
    check(() => assert.throws(() => verifyApprovedCandidateArtifacts({ ...verifyArgs,
      approvedManifestPath: alteredManifestPath, approvalEvidencePath: alteredEvidencePath,
      expectedRuntimeHash: alteredHash, expectedApprovalEvidenceHash: alteredEvidence.approval_evidence_hash })));
  }
  check(() => assert.equal(fileHash(parent.manifest_path), parentFileBefore));
  check(() => assert.equal(fileHash(parent.approval_evidence_path), parentEvidenceBefore));
  check(() => assert.equal(fileHash(historicalPath), historicalBefore));
  console.log(JSON.stringify({ checks, status: "passed", provider_calls: 0,
    scope: "Offline approval and candidate-boundary verification only; not evidence of live simulation success." }, null, 2));
} finally {
  process.env = originalEnv;
  // Only the exact temporary directory returned by mkdtempSync is removed.
  const resolved = path.resolve(directory);
  assert.equal(path.dirname(resolved), path.resolve(tmpdir()));
  assert(path.basename(resolved).startsWith("luna-low-offline-fixture-"));
  rmSync(resolved, { recursive: true, force: true });
}
}

main().catch(error => { console.error(error); process.exitCode = 1; });
