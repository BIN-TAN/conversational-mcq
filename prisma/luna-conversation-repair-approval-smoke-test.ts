import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync, rmSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { zodTextFormat } from "openai/helpers/zod";
import {
  APPROVED_OPERATIONAL_ROLE_NAMES, ApprovedCandidateManifestSchema,
  LEGACY_GPT54_APPROVED_RUNTIME_HASH, activateOperationalApprovalBundle,
  buildLunaAllRolesCandidateManifest, prepareLunaAllRolesAmendment,
  approvedCandidateRoleConfig,
  resolveActiveOperationalApproval, stageLunaAllRolesCandidateFromManifest,
  verifyApprovedCandidateArtifacts
} from "../src/lib/operational/active-approval-bundle";
import { modelUpgradeCandidateRuntimeHash } from "../src/lib/operational/model-upgrade-candidate-identity";
import { stableHash } from "../src/lib/operational/stable-hash";
import { EVIDENCE_ID_REQUEST_SCHEMA_VERSION } from "../src/lib/llm/evidence-id-request-schema";
import { buildCanonicalEvidenceCatalog } from "../src/lib/domain/canonical-evidence-identity";
import { approvedRoleEnvironmentAssertions, resolveFormativeConversationDeliveryReviewConfig } from "../src/lib/llm/config";
import { LUNA_LOW_REQUIRED_SCENARIOS, CONVERSATION_RELIABILITY_ADDITIONAL_CASES, verifyLunaValidation,
  verifySelectedConversationProfileSupport, selectedProfileRequestFormatSha256 } from "../src/lib/operational/luna-low-validation-evidence";
import { CONVERSATION_REPLAY_FIXTURES, CONVERSATION_DELIVERY_REVIEW_PROBES, MIXED_DELIVERY_REVIEW_PROBES,
  MixedConversationReplayValidationSchema, verifySelectedConversationPlanAudit as verifySelectedPlanWithRaw, verifyCurrentSourceActivationProjection,
  verifySelectedConversationDeliveryAudit, verifyDeliveryReviewOriginalParse, historicalConversationDeliveryModel, buildBoundDeliveryProbeInput,
  selectedConversationRequestFormatSha256 } from "../src/lib/operational/luna-conversation-replay-evidence";
import { CONVERSATION_DELIVERY_REVIEW_PROMPT_HASH, CONVERSATION_CURRENT_REPLY_SOURCE_VERSION,
  CONVERSATION_SUPPORT_PREFERENCE_LINK_VERSION, CONVERSATION_PRIOR_TUTOR_SOURCE_VERSION,
  CONVERSATION_STORED_PREFERENCE_TRANSITION_VERSION, CONVERSATION_CURRENT_SOURCE_ACTIVATION_PROJECTION_VERSION,
  CONVERSATION_DEFERRED_NEED_LINK_VERSION, CONVERSATION_STORED_PREFERENCE_RETENTION_VERSION, buildConversationDeliveryReviewInput,
  buildConversationDeliveryReviewInputV6, CONVERSATION_DELIVERY_REVIEW_VERSION, ConversationDeliveryReviewSchema,
  conversationCurrentReplySourceHash, projectConversationContinuityWire } from "../src/lib/services/student-assessment/formative-conversation/conversation-continuity";
import { conversationRepairRuntimeFingerprintIssues } from "../src/lib/agents/operational/approved-config";
import {
  LUNA_CONVERSATION_REPAIR, LUNA_CONVERSATION_REPAIR_CANDIDATE_VERSION,
  LUNA_CONVERSATION_REPAIR_AMENDMENT_VERSION, LUNA_CONVERSATION_REPAIR_VALIDATION_VERSION,
  LUNA_CONVERSATION_REPAIR_PARENT_TUTOR, LUNA_CONVERSATION_REPAIR_PROMPT_HASH,
  LUNA_CONVERSATION_REPAIR_SOURCE_FILES, LUNA_CONVERSATION_PROFILE_PROMPT_VERSION, LUNA_CONVERSATION_PROFILE_PROMPT_HASH,
  LUNA_CONVERSATION_PROFILE_SCHEMA_VERSION, LUNA_CONVERSATION_DELIVERY_REVIEW_MAX_OUTPUT_TOKENS
} from "../src/lib/operational/luna-conversation-repair-identity";
import { LUNA_SOL_DELIVERY_REVIEW_MODEL, LUNA_SOL_DELIVERY_REVIEW_POLICY_VERSION,
  LUNA_SOL_DELIVERY_REVIEW_CANDIDATE_VERSION } from "../src/lib/operational/luna-conversation-repair-identity";

function rawReviewOutput(parsed: unknown) { return { status: "completed", output: [{ type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: JSON.stringify(parsed) }] }] }; }
const fakeWire = () => ({ pre_reply_plan: { version: "conversation-pre-reply-plan-v2", preference_comparisons: [] } });
const verifySelectedConversationPlanAudit = (audit: unknown, responseId: string, input: unknown, output: unknown, raw = rawReviewOutput(fakeWire())) =>
  verifySelectedPlanWithRaw(audit, responseId, input, output, raw);

// Test-only evidence below is deliberately labeled. No provider, classroom,
// production database, or genuine deployment approval is created by this test.
globalThis.fetch = async () => { throw new Error("network_forbidden_in_conversation_repair_approval_smoke"); };
const directory = mkdtempSync(path.join(tmpdir(), "luna-conversation-approval-offline-"));
const hashFile = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");
const save = (name: string, value: unknown) => {
  const file = path.join(directory, name);
  writeFileSync(file, JSON.stringify(value, null, 2) + "\n", { flag: "wx" });
  return file;
};
const bound = (file: string) => ({ path: file, sha256: hashFile(file) });
let checks = 0;
const check = (action: () => void) => { action(); checks++; };
const scope = { reasoningEffort: "medium" as const, profileCorrection: "profile-fidelity-v1" as const,
  conversationRepair: LUNA_CONVERSATION_REPAIR };
const hashJson = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
type SupportPreferenceLink = { preference_id: string; relationship: "honored_constraint" | "topic_of_support" };
const fakeCatalog = () => buildCanonicalEvidenceCatalog({ evidence_namespace_public_id: "OFFLINE-approval-enum",
  assessment_public_id: "OFFLINE-assessment", concept_unit_public_id: "OFFLINE-concept",
  assessment_responses: [{ item_public_id: "OFFLINE-item", selected_option: "B", correctness: "incorrect",
    written_reasoning: "OFFLINE synthetic reasoning.", confidence: "low", tempting_option: null, tempting_option_reason: null }] });
const fakeProfileInput = () => ({ concept_unit_metadata: {}, initial_response_package: {}, profile_type: "initial",
  allowed_evidence_catalog: fakeCatalog(),
  profiling_constraints: { fact_binding_version: "student-profile-fact-binding-v3", output_schema_version: LUNA_CONVERSATION_PROFILE_SCHEMA_VERSION } });
const fakeProfileOutput = () => ({ agent_name: "student_profiling_agent", agent_version: "10-draft", prompt_version: LUNA_CONVERSATION_PROFILE_PROMPT_VERSION,
  schema_version: LUNA_CONVERSATION_PROFILE_SCHEMA_VERSION, strong_partial_reasoning_support: [], output_status: "ok", warnings: [], profile_type: "initial",
  ability_profile: "mostly_correct_understanding", ability_pattern_flags: ["no_clear_pattern"],
  engagement_profile: "adequate_engagement", engagement_pattern_flags: ["sustained_engagement"],
  integrated_diagnostic_profile: "underconfident_but_reasoning_supported", integrated_profile_confidence: "medium",
  integrated_profile_rationale: "OFFLINE structural fixture only.", evidence_sufficiency: "adequate", confidence_alignment: "underconfident",
  independence_interpretability: "independent_understanding_likely", misconception_indicators: [], item_level_evidence: [],
  reasoning_quality_summary: "OFFLINE only.", engagement_summary: "OFFLINE only.", process_interpretation_cautions: [],
  profile_confidence: "medium", rationale: "OFFLINE only.", recommended_next_evidence: [] });
const fakeContinuity = () => ({ version: "conversation-continuity-v1", conversation_public_id: "OFFLINE-conversation",
  preferences: [], needs: [], support_history: [], last_student_state: null });
const fakeInput = () => ({ administered_items: [], assessment_response_evidence: [], conversation_continuity: fakeContinuity(), visible_transcript: [], latest_student_message: null,
  allowed_evidence_catalog: fakeCatalog(),
  formative_lifecycle: { student_turn_index: 0 } });
const reviewInputFor = (context: unknown, draft: string) => buildConversationDeliveryReviewInput(
  context as Parameters<typeof buildConversationDeliveryReviewInput>[0], draft,
  { ...fakeCanonical(), student_visible_message: draft } as Parameters<typeof buildConversationDeliveryReviewInput>[2]);
const fakeCanonical = () => ({ contract_version: "formative-conversation-agent-contract-v4", outcome: "continue_conversation",
  teaching_artifact: null, evidence_observations: [], profile_transition_recommendation: null,
  teacher_assistance_recommendation: { recommended: false, reason_code: null }, lifecycle_recommendation: "continue",
  student_visible_message: "OFFLINE opening only.", conversation_review: { version: "conversation-review-v1", preference_updates: [], need_updates: [],
  student_state: { understanding: "not_reported", understanding_source: null, readiness: "not_reported", readiness_source: null },
  current_support: [], recap_claims: [], closure: { reason: "continue_support", rationale: "OFFLINE only.",
    unresolved_need_ids: [], instructor_support: null } } });
const fakeOpeningReview = () => {
  const input = reviewInputFor(fakeInput(), fakeCanonical().student_visible_message);
  return { version: CONVERSATION_DELIVERY_REVIEW_VERSION, prompt_hash: CONVERSATION_DELIVERY_REVIEW_PROMPT_HASH,
    schema_version: CONVERSATION_DELIVERY_REVIEW_VERSION, provider: "openai", status: "skipped_opening",
    input, input_sha256: hashJson(input), draft_sha256: hashJson(input.draft_message),
    review_output_sha256: null, parsed_output: null, raw_output: null, validation_issue_paths: [],
    model_name: "gpt-5.6-luna", reasoning_effort: "medium", max_output_tokens: LUNA_CONVERSATION_DELIVERY_REVIEW_MAX_OUTPUT_TOKENS,
    logical_call_entered: false, dispatch_accounting_complete: true, usage_accounting_complete: true,
    logical_call_id: null, canonical_request_hash: null, provider_request_id: null, provider_response_id: null,
    client_request_id: null, result_status: null, pre_dispatch_request_rejection_count: 0, http_request_count: 0,
    provider_response_completed_count: 0, provider_attempt_count: 0, transport_retry_count: 0,
    input_tokens: null, output_tokens: null, cached_input_tokens: null, reasoning_tokens: null, total_tokens: null, latency_ms: 0 };
};
const fakePhysicalUsage = (responseId: string, input = 10, output = 5) => ({
  version: "provider-physical-usage-v1", usage_accounting_complete: true,
  attempts: [{ adapter_attempt_index: 1, client_request_id: `OFFLINE-${responseId}`, provider_response_id: responseId,
    fetch_invoked: true, input_tokens: input, output_tokens: output, total_tokens: input + output,
    cached_input_tokens: null, reasoning_tokens: null }]
});
const fakePlanAudit = (responseId: string) => ({
  accounting_version: "formative-conversation-v18r2-evaluation-accounting-v2", dispatch_accounting_complete: true,
  usage_accounting_complete: true, logical_calls_entered: 1, tutor_logical_calls_entered: 1, review_logical_calls_entered: 0,
  http_requests_dispatched: 1, provider_responses_completed: 1, provider_attempts: 1, transport_retries: 0,
  pre_dispatch_request_rejections: 0, attempts: [{
  accepted: true, result_status: "completed", failure_class: null, provider_response_id: responseId,
  http_request_count: 1, provider_response_completed_count: 1, provider_attempt_count: 1, transport_retry_count: 0,
  pre_dispatch_request_rejection_count: 0, input_tokens: 10, output_tokens: 5, total_tokens: 15,
  dispatch_accounting_complete: true, usage_accounting_complete: true, physical_usage: fakePhysicalUsage(responseId),
  pre_delivery_review: fakeOpeningReview(),
  conversation_plan_projection: { version: "conversation-pre-reply-plan-v2", status: "reconstructed",
    original_output_sha256: hashJson(fakeWire()), reconstructed_output_sha256: "2".repeat(64),
    prior_needs_sha256: createHash("sha256").update("[]").digest("hex"), derived_open_need_ids: [] as string[],
    stored_preference_transition_version: CONVERSATION_STORED_PREFERENCE_TRANSITION_VERSION,
    stored_preference_retention_version: CONVERSATION_STORED_PREFERENCE_RETENTION_VERSION,
    current_source_activation_projection_version: CONVERSATION_CURRENT_SOURCE_ACTIVATION_PROJECTION_VERSION,
    current_source_activation_bindings: [] as Array<Record<string, unknown>>,
    prior_tutor_source_version: CONVERSATION_PRIOR_TUTOR_SOURCE_VERSION,
    prior_tutor_bindings: [] as Array<{ path: string; tutor_sequence_index: number; reply_sha256: string }>,
    current_reply_source_version: CONVERSATION_CURRENT_REPLY_SOURCE_VERSION,
    current_reply_bindings: [] as Array<{ path: string; reply_sha256: string }>,
    support_preference_link_version: CONVERSATION_SUPPORT_PREFERENCE_LINK_VERSION,
    support_preference_link_bindings: [] as Array<{ path: string; links: SupportPreferenceLink[] }>,
    stored_preference_bindings: [] as Array<{ preference_id: string; preference_sha256: string }>, validation_issue_paths: [] }
}] });
const verifyPlan = (audit: unknown, responseId: string) => verifySelectedConversationPlanAudit(audit, responseId,
  fakeInput(), fakeCanonical());

try {
  const historicalPath = "config/candidate-operational-agent-config.gpt-5.6-full-v2.json";
  const historicalHash = hashFile(historicalPath);
  const manifest = ApprovedCandidateManifestSchema.parse(JSON.parse(readFileSync(historicalPath, "utf8")));
  manifest.roles.formative_conversation_agent = { ...manifest.roles.topic_dialogue_agent!, max_output_tokens: 7000 };
  manifest.runtime_policy.role_live_toggles.formative_conversation_agent = true;
  manifest.configuration_fingerprint.role_version_metadata.formative_conversation_agent = { ...LUNA_CONVERSATION_REPAIR_PARENT_TUTOR };
  Object.assign(manifest.configuration_fingerprint.role_version_metadata.student_profiling_agent, {
    prompt_version: "student-profiling-v6", prompt_hash: "d9778ba1809c54f84ceb0d91c9f36e22897e8f9a9113768f42a5c728ce1430e8",
    schema_version: "student-profile-output-v4"
  });
  Object.assign(manifest.configuration_fingerprint.deterministic_guard_versions, {
    student_profile_evidence_consistency: "student-profile-evidence-consistency-v2",
    formative_conversation_acceptance: "formative-conversation-v18r2-candidate-acceptance-v3",
    formative_conversation_opening: "formative-conversation-opening-v3",
    formative_conversation_lifecycle: "formative-conversation-lifecycle-v1"
  });
  const before = JSON.stringify(manifest);
  const parentHash = modelUpgradeCandidateRuntimeHash(manifest, APPROVED_OPERATIONAL_ROLE_NAMES);
  const parentManifestPath = save("OFFLINE-parent-manifest.json", manifest);
  const preservedParentManifestHash = hashFile(parentManifestPath);
  const parentIdentity = {
    source_provider_run_id: "OFFLINE-NO-PROVIDER-CALLS", derived_evaluation_id: "OFFLINE-NOT-A-REAL-APPROVAL",
    runtime_candidate_hash: parentHash, source_evaluation_protocol_hash: "a".repeat(64), evaluation_protocol_hash: "b".repeat(64),
    human_review: { decision: "approve", semantic_review_confirmed: true, notice: "OFFLINE FIXTURE; no educational review occurred." }
  };
  const parentEvidence = { ...parentIdentity, approval_command_version: "offline-fixture-only", approved_at: new Date().toISOString(),
    source_artifact_sha256: "c".repeat(64), approval_evidence_hash: stableHash(parentIdentity),
    exact_operational_approved_config_hash: parentHash, rollback_hash: LEGACY_GPT54_APPROVED_RUNTIME_HASH,
    approved_manifest_artifact_path: parentManifestPath };
  const parentEvidencePath = save("OFFLINE-parent-evidence.json", parentEvidence);
  const activated = activateOperationalApprovalBundle({ approvedManifestPath: parentManifestPath, approvalEvidencePath: parentEvidencePath,
    expectedRuntimeHash: parentHash, expectedEvaluationProtocolHash: parentIdentity.evaluation_protocol_hash,
    expectedApprovalEvidenceHash: parentEvidence.approval_evidence_hash,
    expectedSourceProviderRunId: parentIdentity.source_provider_run_id, expectedDerivedEvaluationId: parentIdentity.derived_evaluation_id,
    confirmation: "activate approved gpt-5.6 operational candidate v2", outputDirectory: path.join(directory, "offline-parent") });
  const parent = resolveActiveOperationalApproval({ bundlePath: activated.bundle_path, env: {} });
  assert(parent?.kind === "derived_approval");
  const candidate = buildLunaAllRolesCandidateManifest(manifest, "medium", "profile-fidelity-v1", undefined, LUNA_CONVERSATION_REPAIR);
  check(() => assert.equal(JSON.stringify(manifest), before));
  for (const role of APPROVED_OPERATIONAL_ROLE_NAMES) {
    check(() => assert.deepEqual(candidate.roles[role], { ...manifest.roles[role], model_name: "gpt-5.6-luna", reasoning_effort: "medium" }));
  }
  check(() => assert.deepEqual(candidate.runtime_policy, manifest.runtime_policy));
  check(() => assert.equal(candidate.configuration_fingerprint.role_version_metadata.formative_conversation_agent.prompt_hash, LUNA_CONVERSATION_REPAIR_PROMPT_HASH));
  check(() => assert.equal(candidate.configuration_fingerprint.role_version_metadata.student_profiling_agent.prompt_version, LUNA_CONVERSATION_PROFILE_PROMPT_VERSION));
  check(() => assert.equal(candidate.configuration_fingerprint.role_version_metadata.student_profiling_agent.prompt_hash, LUNA_CONVERSATION_PROFILE_PROMPT_HASH));
  check(() => assert.equal(candidate.configuration_fingerprint.role_version_metadata.student_profiling_agent.schema_version, LUNA_CONVERSATION_PROFILE_SCHEMA_VERSION));
  check(() => assert.equal(candidate.configuration_fingerprint.deterministic_guard_versions.student_profile_fact_binding, "student-profile-fact-binding-v3"));
  check(() => assert.equal(candidate.configuration_fingerprint.deterministic_guard_versions.student_profile_request_schema, "student-profile-request-schema-v4"));
  check(() => assert.equal(candidate.configuration_fingerprint.deterministic_guard_versions.student_profile_semantic_repair, "student-profile-semantic-repair-v2"));
  check(() => assert.deepEqual(verifySelectedConversationProfileSupport(fakeProfileInput(), fakeProfileOutput()).strong_partial_reasoning_support, []));
  for (const change of [{ schema_version: "student-profile-output-v5" }, { strong_partial_reasoning_support: undefined },
    { ability_pattern_flags: ["incorrect_answer_strong_partial_reasoning"] },
    { ability_pattern_flags: ["incorrect_answer_strong_partial_reasoning"], strong_partial_reasoning_support: [{
      item_public_id: "invented", source_evidence_id: "invented", source_quote: "invented", correct_component: "invented", remaining_error: "invented" }] }]) {
    check(() => assert.throws(() => verifySelectedConversationProfileSupport(fakeProfileInput(), { ...fakeProfileOutput(), ...change })));
  }
  check(() => assert.throws(() => verifySelectedConversationProfileSupport({ ...fakeProfileInput(),
    profiling_constraints: { ...fakeProfileInput().profiling_constraints, fact_binding_version: "student-profile-fact-binding-v2" } }, fakeProfileOutput())));
  check(() => assert.equal(buildLunaAllRolesCandidateManifest(manifest, "medium", "profile-fidelity-v1")
    .configuration_fingerprint.role_version_metadata.student_profiling_agent.prompt_hash,
    "bb0f774fc237805eb534cee8afefb181052e272bf624170903b05cc8d4525203"));
  check(() => assert.equal(candidate.configuration_fingerprint.role_version_metadata.formative_conversation_agent.formative_max_student_turns, 30));
  check(() => assert.deepEqual(conversationRepairRuntimeFingerprintIssues(candidate), []));
  check(() => assert.deepEqual(conversationRepairRuntimeFingerprintIssues(manifest), []));
  for (const key of ["prompt_hash", "schema_version", "canonical_schema_version", "input_encoding", "profile_proposal_version",
    "interpretation_policy_version", "learning_summary_policy_version", "conversation_continuity_version", "conversation_review_version",
    "conversation_pre_reply_plan_version", "conversation_current_reply_source_version", "conversation_prior_tutor_source_version", "conversation_stored_preference_transition_version", "conversation_support_preference_link_version", "delivery_review_version", "delivery_review_prompt_hash", "delivery_review_max_output_tokens",
    "execution_accounting_version", "physical_usage_policy_version", "current_source_activation_projection_version", "deferred_need_link_version", "stored_preference_retention_version", "evidence_id_request_schema_version", "formative_max_student_turns"]) {
    const changed = structuredClone(candidate);
    changed.configuration_fingerprint.role_version_metadata.formative_conversation_agent[key] = "incorrect";
    check(() => assert(conversationRepairRuntimeFingerprintIssues(changed).includes(`metadata.${key}`)));
  }
  check(() => assert.equal(candidate.configuration_fingerprint.role_version_metadata.formative_conversation_agent.learning_summary_policy_version, "learning-summary-evidence-v2"));
  check(() => assert.equal(candidate.configuration_fingerprint.deterministic_guard_versions.formative_learning_summary, "learning-summary-evidence-v2"));
  const wrongSummaryGuard = structuredClone(candidate);
  wrongSummaryGuard.configuration_fingerprint.deterministic_guard_versions.formative_learning_summary = "learning-summary-evidence-v1";
  check(() => assert(conversationRepairRuntimeFingerprintIssues(wrongSummaryGuard).includes("guard.formative_learning_summary")));
  check(() => assert.equal(candidate.configuration_fingerprint.role_version_metadata.formative_conversation_agent.physical_usage_policy_version, "provider-physical-usage-v1"));
  check(() => assert.equal(candidate.configuration_fingerprint.deterministic_guard_versions.provider_physical_usage, "provider-physical-usage-v1"));
  check(() => assert(LUNA_CONVERSATION_REPAIR_SOURCE_FILES.includes("src/lib/llm/provider-transport-retry.ts")));
  const wrongPhysicalGuard = structuredClone(candidate);
  wrongPhysicalGuard.configuration_fingerprint.deterministic_guard_versions.provider_physical_usage = "wrong";
  check(() => assert(conversationRepairRuntimeFingerprintIssues(wrongPhysicalGuard).includes("guard.provider_physical_usage")));
  check(() => assert.equal(candidate.configuration_fingerprint.role_version_metadata.formative_conversation_agent.current_source_activation_projection_version, CONVERSATION_CURRENT_SOURCE_ACTIVATION_PROJECTION_VERSION));
  check(() => assert.equal(candidate.configuration_fingerprint.deterministic_guard_versions.formative_current_source_activation_projection, CONVERSATION_CURRENT_SOURCE_ACTIVATION_PROJECTION_VERSION));
  const wrongActivationGuard = structuredClone(candidate);
  wrongActivationGuard.configuration_fingerprint.deterministic_guard_versions.formative_current_source_activation_projection = "wrong";
  check(() => assert(conversationRepairRuntimeFingerprintIssues(wrongActivationGuard).includes("guard.formative_current_source_activation_projection")));
  check(() => assert.equal(candidate.configuration_fingerprint.role_version_metadata.formative_conversation_agent.deferred_need_link_version, CONVERSATION_DEFERRED_NEED_LINK_VERSION));
  check(() => assert.equal(candidate.configuration_fingerprint.deterministic_guard_versions.formative_deferred_need_link, CONVERSATION_DEFERRED_NEED_LINK_VERSION));
  const wrongDeferredNeedGuard = structuredClone(candidate);
  wrongDeferredNeedGuard.configuration_fingerprint.deterministic_guard_versions.formative_deferred_need_link = "wrong";
  check(() => assert(conversationRepairRuntimeFingerprintIssues(wrongDeferredNeedGuard).includes("guard.formative_deferred_need_link")));
  check(() => assert.equal(candidate.configuration_fingerprint.role_version_metadata.formative_conversation_agent.stored_preference_retention_version, CONVERSATION_STORED_PREFERENCE_RETENTION_VERSION));
  check(() => assert.equal(candidate.configuration_fingerprint.deterministic_guard_versions.formative_stored_preference_retention, CONVERSATION_STORED_PREFERENCE_RETENTION_VERSION));
  const wrongRetentionGuard = structuredClone(candidate);
  wrongRetentionGuard.configuration_fingerprint.deterministic_guard_versions.formative_stored_preference_retention = "wrong";
  check(() => assert(conversationRepairRuntimeFingerprintIssues(wrongRetentionGuard).includes("guard.formative_stored_preference_retention")));
  check(() => assert.equal(candidate.configuration_fingerprint.deterministic_guard_versions.evidence_id_request_schema, EVIDENCE_ID_REQUEST_SCHEMA_VERSION));
  check(() => assert.equal(candidate.configuration_fingerprint.role_version_metadata.student_profiling_agent.evidence_id_request_schema_version, EVIDENCE_ID_REQUEST_SCHEMA_VERSION));
  check(() => assert(LUNA_CONVERSATION_REPAIR_SOURCE_FILES.includes("src/lib/llm/evidence-id-request-schema.ts")));
  const wrongEvidenceEnumGuard = structuredClone(candidate);
  wrongEvidenceEnumGuard.configuration_fingerprint.deterministic_guard_versions.evidence_id_request_schema = "wrong";
  check(() => assert(conversationRepairRuntimeFingerprintIssues(wrongEvidenceEnumGuard).includes("guard.evidence_id_request_schema")));
  const wrongProfileEnum = structuredClone(candidate);
  delete wrongProfileEnum.configuration_fingerprint.role_version_metadata.student_profiling_agent.evidence_id_request_schema_version;
  check(() => assert(conversationRepairRuntimeFingerprintIssues(wrongProfileEnum).includes("profile_metadata.evidence_id_request_schema_version")));
  // A current-source correction must be reconstructed from original wire text,
  // not trusted because a receipt claims it occurred. These are authored controls.
  const activationSource = { evidence_id: `ev_${"a".repeat(24)}`, quote: "Please leave that topic for later." };
  const activationComparison = { preference_id: "OFFLINE-current-boundary", kind: "defer_topic", description: "A current request.",
    prior: { origin: "visible_student_history", source: activationSource }, decision: "activate", change_basis: "explicit_change", current_source: activationSource };
  const activationWire = { pre_reply_plan: { preference_comparisons: [activationComparison] } };
  const activationContext = { ...fakeInput(), conversation_public_id: "OFFLINE-conversation", assessment_public_id: "OFFLINE-assessment",
    concept_unit_public_id: "OFFLINE-concept", latest_student_message: activationSource.quote,
    visible_transcript: [{ actor: "student", sequence_index: 4, message_text: activationSource.quote }],
    allowed_evidence_catalog: { evidence_scope_id: "OFFLINE-scope", evidence: [{ ...activationSource, content: activationSource.quote,
      source_role: "student", evidence_kind: "formative_student_turn", evidence_stage: "formative_conversation", source_sequence_index: 4,
      evidence_scope_id: "OFFLINE-scope", conversation_public_id: "OFFLINE-conversation", assessment_public_id: "OFFLINE-assessment", concept_unit_public_id: "OFFLINE-concept" }] }
  } as unknown as Parameters<typeof verifyCurrentSourceActivationProjection>[1];
  const activationReview = { ...fakeCanonical().conversation_review, preference_updates: [{ preference_id: activationComparison.preference_id,
    kind: "defer_topic", description: activationComparison.description, status: "active", source: activationSource }] } as Parameters<typeof verifyCurrentSourceActivationProjection>[2];
  const activationReceipt = { path: "pre_reply_plan.preference_comparisons[0].prior", preference_id: activationComparison.preference_id,
    source_evidence_id: activationSource.evidence_id, source_sequence_index: 4, source_sha256: hashJson(activationSource),
    original_preference_comparison_sha256: hashJson(activationComparison), projected_preference_comparison_sha256: hashJson({ ...activationComparison, prior: null }) };
  const activationProjection = { current_source_activation_projection_version: CONVERSATION_CURRENT_SOURCE_ACTIVATION_PROJECTION_VERSION,
    current_source_activation_bindings: [activationReceipt], original_output_sha256: hashJson(activationWire) };
  check(() => assert.equal(verifyCurrentSourceActivationProjection(activationProjection, activationContext, activationReview,
    { accepted_output: { provider_raw_output: rawReviewOutput(activationWire) } }).length, 1));
  for (const change of [{ current_source_activation_projection_version: undefined }, { current_source_activation_projection_version: "wrong" },
    { current_source_activation_bindings: [] }, { current_source_activation_bindings: [activationReceipt, activationReceipt] },
    ...Object.keys(activationReceipt).map(key => ({ current_source_activation_bindings: [{ ...activationReceipt, [key]: key === "source_sequence_index" ? 3 : "wrong" }] }))]) {
    check(() => assert.throws(() => verifyCurrentSourceActivationProjection({ ...activationProjection, ...change }, activationContext, activationReview, rawReviewOutput(activationWire))));
  }
  for (const mutate of [
    (v: typeof activationContext) => { v.allowed_evidence_catalog.evidence.push({ ...v.allowed_evidence_catalog.evidence[0] }); },
    (v: typeof activationContext) => { v.visible_transcript.push({ ...v.visible_transcript[0] }); },
    (v: typeof activationContext) => { v.allowed_evidence_catalog.evidence[0].source_sequence_index = 3; },
    (v: typeof activationContext) => { v.allowed_evidence_catalog.evidence[0].conversation_public_id = "different"; },
    (v: typeof activationContext) => { v.allowed_evidence_catalog.evidence[0].content = "unrelated"; },
    (v: typeof activationContext) => { v.allowed_evidence_catalog.evidence[0].content += " Extra words."; },
    (v: typeof activationContext) => { v.latest_student_message = "Changed latest message."; },
    (v: typeof activationContext) => { v.visible_transcript[0].message_text = "unrelated"; },
    (v: typeof activationContext) => { v.conversation_continuity!.preferences.push({ ...activationReview.preference_updates[0], source_tutor_sequence_index: 3, source_agent_call_public_id: "OFFLINE-call" }); }
  ]) {
    const changed = structuredClone(activationContext); mutate(changed);
    check(() => assert.throws(() => verifyCurrentSourceActivationProjection(activationProjection, changed, activationReview, rawReviewOutput(activationWire))));
  }
  for (const patch of [{ decision: "retain" }, { decision: "release" }, { change_basis: "no_change" },
    { prior: { origin: "visible_student_history", source: { ...activationSource, quote: "Different source." } } }]) {
    const comparison = { ...activationComparison, ...patch }, wire = { pre_reply_plan: { preference_comparisons: [comparison] } };
    const forged = { ...activationProjection, original_output_sha256: hashJson(wire), current_source_activation_bindings: [{ ...activationReceipt,
      original_preference_comparison_sha256: hashJson(comparison), projected_preference_comparison_sha256: hashJson({ ...comparison, prior: null }) }] };
    check(() => assert.throws(() => verifyCurrentSourceActivationProjection(forged, activationContext, activationReview, rawReviewOutput(wire))));
  }
  check(() => assert.throws(() => verifyCurrentSourceActivationProjection(activationProjection, activationContext, activationReview, null)));
  check(() => assert.throws(() => verifyCurrentSourceActivationProjection(activationProjection, activationContext, activationReview,
    { accepted_output: rawReviewOutput(activationWire), provider_raw_output: rawReviewOutput(activationWire) })));
  const ordinaryWire = { pre_reply_plan: { preference_comparisons: [{ ...activationComparison, prior: null }] } };
  check(() => assert.deepEqual(verifyCurrentSourceActivationProjection({ ...activationProjection, original_output_sha256: hashJson(ordinaryWire),
    current_source_activation_bindings: [] }, activationContext, activationReview, rawReviewOutput(ordinaryWire)), []));
  const exactActivationFixture = JSON.parse(readFileSync("prisma/fixtures/conversation-current-source-activation-native-v22.json", "utf8"));
  // An explicit prospective control; the saved historical wire stays unchanged.
  exactActivationFixture.base = structuredClone(exactActivationFixture.base);
  exactActivationFixture.base.pre_reply_plan.version = "conversation-pre-reply-plan-v2";
  const exactActivation = projectConversationContinuityWire(exactActivationFixture.base, exactActivationFixture.projection_context);
  check(() => assert(exactActivation.output));
  const exactActivationAudit = { attempts: [{ accepted: true, provider_response_id: "OFFLINE-EXACT-ACTIVATION", result_status: "completed", failure_class: null,
    conversation_plan_projection: exactActivation.audit }] };
  check(() => assert.equal(verifySelectedConversationPlanAudit(exactActivationAudit, "OFFLINE-EXACT-ACTIVATION", exactActivationFixture.projection_context,
    exactActivation.output, rawReviewOutput(exactActivationFixture.base)).current_source_activation_bindings.length, 1));
  const jsonbProjection = JSON.parse(JSON.stringify(exactActivationAudit), (_key, value) => value && typeof value === "object" && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value).reverse()) : value);
  check(() => assert.equal(verifySelectedConversationPlanAudit(jsonbProjection, "OFFLINE-EXACT-ACTIVATION", exactActivationFixture.projection_context,
    exactActivation.output, rawReviewOutput(exactActivationFixture.base)).current_source_activation_bindings.length, 1));
  const changedActivation = structuredClone(exactActivationFixture.base);
  changedActivation.pre_reply_plan.preference_comparisons[0].description += " Changed.";
  check(() => assert.throws(() => verifySelectedConversationPlanAudit(exactActivationAudit, "OFFLINE-EXACT-ACTIVATION", exactActivationFixture.projection_context,
    exactActivation.output, rawReviewOutput(changedActivation))));
  const wrongPlanGuard = structuredClone(candidate);
  wrongPlanGuard.configuration_fingerprint.deterministic_guard_versions.formative_conversation_pre_reply_plan = "incorrect";
  check(() => assert(conversationRepairRuntimeFingerprintIssues(wrongPlanGuard).includes("guard.formative_conversation_pre_reply_plan")));
  const wrongReplyGuard = structuredClone(candidate);
  wrongReplyGuard.configuration_fingerprint.deterministic_guard_versions.formative_conversation_current_reply_source = "incorrect";
  check(() => assert(conversationRepairRuntimeFingerprintIssues(wrongReplyGuard).includes("guard.formative_conversation_current_reply_source")));
  const wrongPreferenceGuard = structuredClone(candidate);
  wrongPreferenceGuard.configuration_fingerprint.deterministic_guard_versions.formative_conversation_support_preference_links = "incorrect";
  check(() => assert(conversationRepairRuntimeFingerprintIssues(wrongPreferenceGuard).includes("guard.formative_conversation_support_preference_links")));
  const wrongDeliveryGuard = structuredClone(candidate);
  wrongDeliveryGuard.configuration_fingerprint.deterministic_guard_versions.formative_conversation_delivery_review = "incorrect";
  check(() => assert(conversationRepairRuntimeFingerprintIssues(wrongDeliveryGuard).includes("guard.formative_conversation_delivery_review")));
  const wrongPrivateGuard = structuredClone(candidate);
  wrongPrivateGuard.configuration_fingerprint.deterministic_guard_versions.formative_private_learning_review = "incorrect";
  check(() => assert(conversationRepairRuntimeFingerprintIssues(wrongPrivateGuard).includes("guard.formative_private_learning_review")));
  const missingPrivateRole = structuredClone(candidate);
  delete missingPrivateRole.configuration_fingerprint.role_version_metadata.formative_conversation_agent.private_learning_review_version;
  check(() => assert(conversationRepairRuntimeFingerprintIssues(missingPrivateRole).includes("metadata.private_learning_review_version")));
  const transportRow = (id: string) => ({ request_index: 1, category: "application", agent_name: "formative_conversation_agent",
    model_name: "gpt-5.6-luna", status: "completed", provider_response_id: id,
    request_format_sha256: selectedConversationRequestFormatSha256(fakeInput()),
    usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 } });
  const reviewTransportRow = (id: string) => ({ ...transportRow(id), request_format_sha256:
    hashJson(zodTextFormat(ConversationDeliveryReviewSchema, CONVERSATION_DELIVERY_REVIEW_VERSION)) });
  const openingAudit = fakePlanAudit("OFFLINE-OPENING");
  const openingRows = [transportRow("OFFLINE-OPENING")];
  const verifyDelivery = (value: unknown, input: unknown = fakeInput(), rows: Parameters<typeof verifySelectedConversationDeliveryAudit>[4] = openingRows) =>
    verifySelectedConversationDeliveryAudit(value, "OFFLINE-OPENING", input, fakeCanonical(), rows);
  check(() => assert.equal(verifyDelivery(openingAudit).input_tokens, 10));
  for (const request_format_sha256 of [undefined, "0".repeat(64)]) {
    check(() => assert.throws(() => verifyDelivery(openingAudit, fakeInput(), [{ ...openingRows[0], request_format_sha256 }]), /physical request format/));
  }
  const physicalOpening = openingAudit.attempts[0].physical_usage;
  for (const physical of [undefined, { ...physicalOpening, version: "wrong" },
    { ...physicalOpening, attempts: [] },
    ...[{ fetch_invoked: null }, { input_tokens: null }, { total_tokens: 16 },
      { provider_response_id: "invented" }, { cached_input_tokens: 1 }, { adapter_attempt_index: 2 }]
      .map(change => ({ ...physicalOpening, attempts: [{ ...physicalOpening.attempts[0], ...change }] }))]) {
    check(() => assert.throws(() => verifyDelivery({ ...openingAudit, attempts: [{ ...openingAudit.attempts[0], physical_usage: physical }] })));
  }
  const retryPhysical = { ...physicalOpening, attempts: [
    { ...physicalOpening.attempts[0], provider_response_id: "OFFLINE-RETRY", client_request_id: "OFFLINE-RETRY-CLIENT" },
    { ...physicalOpening.attempts[0], adapter_attempt_index: 2 }
  ] };
  const retryAudit = { ...openingAudit, http_requests_dispatched: 2, provider_responses_completed: 2,
    provider_attempts: 2, transport_retries: 1, attempts: [{ ...openingAudit.attempts[0],
      physical_usage: retryPhysical, http_request_count: 2, provider_response_completed_count: 2,
      provider_attempt_count: 2, transport_retry_count: 1, input_tokens: 20, output_tokens: 10, total_tokens: 30 }] };
  const retryRows = [{ ...transportRow("OFFLINE-RETRY"), request_index: 2 }, ...openingRows];
  check(() => assert.equal(verifyDelivery(retryAudit, fakeInput(), retryRows).total_tokens, 30));
  check(() => assert.deepEqual(verifyDelivery(retryAudit, fakeInput(), retryRows).provider_response_ids, ["OFFLINE-RETRY", "OFFLINE-OPENING"]));
  // The failed first physical request is unknown even when a later response has usage.
  const unknownRetry = { ...retryPhysical, attempts: [
    { ...retryPhysical.attempts[0], provider_response_id: null, input_tokens: null, output_tokens: null, total_tokens: null },
    retryPhysical.attempts[1]
  ] };
  for (const complete of [true, false]) {
    check(() => assert.throws(() => verifyDelivery({ ...retryAudit, attempts: [{ ...retryAudit.attempts[0],
      physical_usage: { ...unknownRetry, usage_accounting_complete: complete } }] }, fakeInput(), retryRows)));
  }
  check(() => assert.throws(() => verifyDelivery({ ...retryAudit, attempts: [{ ...retryAudit.attempts[0],
    input_tokens: 10, output_tokens: 5, total_tokens: 15 }] }, fakeInput(), retryRows)));
  check(() => assert.throws(() => verifyDelivery(retryAudit, fakeInput(), openingRows)));
  check(() => assert.throws(() => verifyDelivery({ ...retryAudit, attempts: [{ ...retryAudit.attempts[0],
    physical_usage: { ...retryPhysical, attempts: [retryPhysical.attempts[0], { ...retryPhysical.attempts[1], provider_response_id: "OFFLINE-RETRY" }] }
  }] }, fakeInput(), retryRows)));
  const nativePhysical = JSON.parse(readFileSync(path.resolve("prisma/fixtures/conversation-physical-usage-native-v21.json"), "utf8"));
  check(() => assert.equal(nativePhysical.original_audit.usage_accounting_complete, true));
  check(() => assert.equal(nativePhysical.original_audit.attempt.http_request_count, 2));
  check(() => assert.equal(nativePhysical.transport_requests[0].usage, null));
  check(() => assert.equal(nativePhysical.transport_requests[1].usage.total_tokens, 30694));
  const nativeId = nativePhysical.original_audit.attempt.provider_response_id;
  const nativeAudit = { ...fakePlanAudit(nativeId), ...nativePhysical.original_audit,
    attempts: [{ ...fakePlanAudit(nativeId).attempts[0], ...nativePhysical.original_audit.attempt,
      physical_usage: { version: "provider-physical-usage-v1", usage_accounting_complete: false,
        attempts: nativePhysical.transport_requests.map((row: { provider_response_id: string | null; usage: null | {
          input_tokens: number; output_tokens: number; total_tokens: number;
          input_tokens_details?: { cached_tokens?: number }; output_tokens_details?: { reasoning_tokens?: number } } }, index: number) => ({
          adapter_attempt_index: index + 1, client_request_id: `OFFLINE-CAPTURED-${index + 1}`,
          provider_response_id: row.provider_response_id, fetch_invoked: true,
          input_tokens: row.usage?.input_tokens ?? null, output_tokens: row.usage?.output_tokens ?? null,
          total_tokens: row.usage?.total_tokens ?? null, cached_input_tokens: row.usage?.input_tokens_details?.cached_tokens ?? null,
          reasoning_tokens: row.usage?.output_tokens_details?.reasoning_tokens ?? null
        })) } }] };
  check(() => assert.throws(() => verifySelectedConversationDeliveryAudit(nativeAudit, nativeId,
    fakeInput(), fakeCanonical(), nativePhysical.transport_requests), /complete physical request usage/));
  check(() => assert.throws(() => verifySelectedConversationDeliveryAudit({ ...nativeAudit,
    attempts: [{ ...nativeAudit.attempts[0], physical_usage: { ...nativeAudit.attempts[0].physical_usage, usage_accounting_complete: true } }] },
    nativeId, fakeInput(), fakeCanonical(), nativePhysical.transport_requests)));
  for (const change of [{ accounting_version: "formative-conversation-v18r2-evaluation-accounting-v1" },
    { logical_calls_entered: 2 }, { review_logical_calls_entered: 1 }, { http_requests_dispatched: 2 },
    { dispatch_accounting_complete: false }, { usage_accounting_complete: false },
    { attempts: [{ ...openingAudit.attempts[0], pre_delivery_review: undefined }] }]) {
    check(() => assert.throws(() => verifyDelivery({ ...openingAudit, ...change })));
  }
  for (const change of [{ status: "passed" }, { input_tokens: 0 }, { logical_call_entered: true },
    { provider_response_id: "invented" }, { prompt_hash: "f".repeat(64) }, { max_output_tokens: 7000 },
    { input_sha256: "f".repeat(64) }, { draft_sha256: "f".repeat(64) }]) {
    check(() => assert.throws(() => verifyDelivery({ ...openingAudit, attempts: [{ ...openingAudit.attempts[0],
      pre_delivery_review: { ...openingAudit.attempts[0].pre_delivery_review, ...change } }] })));
  }
  check(() => assert.throws(() => verifyDelivery(openingAudit, { ...fakeInput(), formative_lifecycle: { student_turn_index: 1 } })));
  const reviewInput = { ...fakeInput(), visible_transcript: [{ sequence_index: 1, actor: "student", message_text: "Please remind me." }],
    latest_student_message: "Please remind me.", formative_lifecycle: { student_turn_index: 1 } };
  const sourceReviewInput = reviewInputFor(reviewInput, fakeCanonical().student_visible_message);
  const historicalReviewInput = { visible_transcript: sourceReviewInput.visible_transcript,
    latest_student_message: sourceReviewInput.latest_student_message, draft_message: sourceReviewInput.draft_message };
  const pass = { version: CONVERSATION_DELIVERY_REVIEW_VERSION, private_learning_audit: [], teaching_block_audit: sourceReviewInput.draft_blocks.map(block => ({
    block_id: block.block_id, assessment: "no_teaching_claims", check: "OFFLINE nonteaching control only." })), verdict: "pass", findings: [] };
  const paidReceipt = { ...fakeOpeningReview(), status: "passed", input: sourceReviewInput,
    input_sha256: hashJson(sourceReviewInput), parsed_output: pass, raw_output: rawReviewOutput(pass),
    review_output_sha256: hashJson(pass), logical_call_entered: true, logical_call_id: "OFFLINE-REVIEW-LOGICAL",
    canonical_request_hash: "a".repeat(64), client_request_id: "OFFLINE-REVIEW-CLIENT", provider_response_id: "OFFLINE-REVIEW-RESPONSE",
    result_status: "completed", http_request_count: 1, provider_response_completed_count: 1, provider_attempt_count: 1,
    physical_usage: fakePhysicalUsage("OFFLINE-REVIEW-RESPONSE"),
    input_tokens: 10, output_tokens: 5, total_tokens: 15 };
  const paidAudit = { ...openingAudit, logical_calls_entered: 2, review_logical_calls_entered: 1,
    http_requests_dispatched: 2, provider_responses_completed: 2, provider_attempts: 2,
    attempts: [{ ...openingAudit.attempts[0], pre_delivery_review: paidReceipt }] };
  const paidRows = [...openingRows, { ...reviewTransportRow("OFFLINE-REVIEW-RESPONSE"), request_index: 2 }];
  check(() => assert.equal(verifyDelivery(paidAudit, reviewInput, paidRows).input_tokens, 20));
  const nativeJsonb = JSON.parse(readFileSync(path.resolve("prisma/fixtures/conversation-delivery-review-jsonb-native.json"), "utf8"));
  check(() => assert.notEqual(hashJson(nativeJsonb.parsed_output), nativeJsonb.review_output_sha256));
  check(() => assert.deepEqual(verifyDeliveryReviewOriginalParse(nativeJsonb.raw_output,
    nativeJsonb.parsed_output, nativeJsonb.review_output_sha256), nativeJsonb.parsed_output));
  const reverseKeys = (value: unknown): unknown => Array.isArray(value) ? value.map(reverseKeys) :
    value && typeof value === "object" ? Object.fromEntries(Object.entries(value).reverse().map(([key, child]) => [key, reverseKeys(child)])) : value;
  check(() => assert.deepEqual(verifyDeliveryReviewOriginalParse(nativeJsonb.raw_output,
    reverseKeys(nativeJsonb.parsed_output), nativeJsonb.review_output_sha256), nativeJsonb.parsed_output));
  check(() => assert.equal(verifyDelivery({ ...paidAudit, attempts: [{ ...paidAudit.attempts[0],
    pre_delivery_review: { ...paidReceipt, parsed_output: reverseKeys(pass) } }] }, reviewInput, paidRows).input_tokens, 20));
  for (const changed of [{ ...nativeJsonb.parsed_output, verdict: "reject" },
    { ...nativeJsonb.parsed_output, teaching_block_audit: [...nativeJsonb.parsed_output.teaching_block_audit].reverse() },
    { ...nativeJsonb.parsed_output, extra: true }]) {
    check(() => assert.throws(() => verifyDeliveryReviewOriginalParse(nativeJsonb.raw_output, changed, nativeJsonb.review_output_sha256)));
  }
  for (const raw of [null, {}, { ...nativeJsonb.raw_output, status: "incomplete" },
    { ...nativeJsonb.raw_output, output: [] },
    { ...nativeJsonb.raw_output, output: [...nativeJsonb.raw_output.output, ...nativeJsonb.raw_output.output] },
    { status: "completed", output: [{ type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: "not JSON" }] }] },
    { status: "completed", output: [{ type: "message", role: "assistant", status: "completed", content: [{ type: "refusal", refusal: "OFFLINE" }] }] },
    { ...nativeJsonb.raw_output, output: [{ ...nativeJsonb.raw_output.output[0], content: [...nativeJsonb.raw_output.output[0].content, ...nativeJsonb.raw_output.output[0].content] }] }]) {
    check(() => assert.throws(() => verifyDeliveryReviewOriginalParse(raw, nativeJsonb.parsed_output, nativeJsonb.review_output_sha256)));
  }
  check(() => assert.throws(() => verifyDeliveryReviewOriginalParse(nativeJsonb.raw_output, nativeJsonb.parsed_output, "f".repeat(64))));
  const mixedReceipt = { ...paidReceipt, model_name: LUNA_SOL_DELIVERY_REVIEW_MODEL,
    execution_policy_version: LUNA_SOL_DELIVERY_REVIEW_POLICY_VERSION };
  const mixedAudit = { ...paidAudit, attempts: [{ ...paidAudit.attempts[0], pre_delivery_review: mixedReceipt }] };
  const mixedRow = { ...paidRows[1], model_name: LUNA_SOL_DELIVERY_REVIEW_MODEL,
    execution_policy_version: LUNA_SOL_DELIVERY_REVIEW_POLICY_VERSION, execution_purpose: "conversation_delivery_review",
    diagnostic_only: false, candidate_validation_eligible: true };
  const verifyMixed = (audit: unknown, rows: Parameters<typeof verifySelectedConversationDeliveryAudit>[4]) =>
    verifySelectedConversationDeliveryAudit(audit, "OFFLINE-OPENING", reviewInput, fakeCanonical(), rows, LUNA_SOL_DELIVERY_REVIEW_MODEL);
  check(() => assert.equal(verifyMixed(mixedAudit, [paidRows[0], mixedRow]).input_tokens, 20));
  check(() => assert.throws(() => verifyDelivery(mixedAudit, reviewInput, [paidRows[0], mixedRow])));
  check(() => assert.throws(() => verifyMixed(paidAudit, paidRows)));
  for (const change of [{ model_name: "gpt-5.6-luna" }, { execution_policy_version: undefined },
    { execution_policy_version: "wrong" }, { max_output_tokens: 2501 }, { prompt_hash: "f".repeat(64) }]) {
    check(() => assert.throws(() => verifyMixed({ ...mixedAudit, attempts: [{ ...mixedAudit.attempts[0],
      pre_delivery_review: { ...mixedReceipt, ...change } }] }, [paidRows[0], mixedRow])));
  }
  for (const change of [{ execution_policy_version: undefined }, { execution_purpose: "tutor_generation" },
    { diagnostic_only: true }, { candidate_validation_eligible: false }, { agent_name: "student_profiling_agent" }]) {
    check(() => assert.throws(() => verifyMixed(mixedAudit, [paidRows[0], { ...mixedRow, ...change }])));
  }
  check(() => assert.throws(() => verifyMixed(mixedAudit, [{ ...paidRows[0], model_name: LUNA_SOL_DELIVERY_REVIEW_MODEL }, mixedRow])));
  const blockCheck = { block_id: 1, assessment: "supported", check: "OFFLINE authored premise/conclusion control only." };
  const claimPass = { ...pass, teaching_block_audit: [blockCheck] };
  const withClaimOutput = (value: unknown) => ({ ...paidAudit, attempts: [{ ...paidAudit.attempts[0],
    pre_delivery_review: { ...paidReceipt, parsed_output: value, raw_output: rawReviewOutput(value),
      review_output_sha256: hashJson(value) } }] });
  check(() => assert.equal(verifyDelivery(withClaimOutput(claimPass), reviewInput, paidRows).input_tokens, 20));
  for (const change of [{ block_id: 2 }, { assessment: "material_error" }, { check: "x".repeat(241) }]) {
    check(() => assert.throws(() => verifyDelivery(withClaimOutput({ ...claimPass,
      teaching_block_audit: [{ ...blockCheck, ...change }] }), reviewInput, paidRows)));
  }
  check(() => assert.throws(() => verifyDelivery(withClaimOutput({ ...claimPass, version: "conversation-delivery-review-v2" }), reviewInput, paidRows)));
  check(() => assert.throws(() => verifyDelivery(withClaimOutput({ version: "conversation-delivery-review-v3",
    teaching_claim_audit: { scope: "no_teaching_claims", checks: [] }, verdict: "pass", findings: [] }), reviewInput, paidRows)));
  // Every backend-generated block needs exactly one judgment in source order.
  // Hashes or an older selective claim audit cannot replace block coverage.
  for (const blockAudit of [undefined, [], [blockCheck, blockCheck]]) {
    const changed = { ...pass, teaching_block_audit: blockAudit };
    check(() => assert.throws(() => verifyDelivery({ ...paidAudit, attempts: [{ ...paidAudit.attempts[0],
      pre_delivery_review: { ...paidReceipt, parsed_output: changed, raw_output: rawReviewOutput(changed),
        review_output_sha256: hashJson(changed) } }] }, reviewInput, paidRows)));
  }
  for (const changedInput of [historicalReviewInput, { ...sourceReviewInput, draft_blocks: [] },
    { ...sourceReviewInput, draft_blocks: sourceReviewInput.draft_blocks.map(block => ({ ...block, sha256: "f".repeat(64) })) },
    { ...sourceReviewInput, draft_blocks: sourceReviewInput.draft_blocks.map(block => ({ ...block, text: "Different draft" })) }]) {
    check(() => assert.throws(() => verifyDelivery({ ...paidAudit, attempts: [{ ...paidAudit.attempts[0],
      pre_delivery_review: { ...paidReceipt, input: changedInput, input_sha256: hashJson(changedInput) } }] }, reviewInput, paidRows)));
  }
  const twoBlockOutput = { ...fakeCanonical(), student_visible_message: "OFFLINE first block.\nOFFLINE second block." };
  const twoBlockInput = reviewInputFor(reviewInput, twoBlockOutput.student_visible_message);
  const twoBlockPass = { ...pass, teaching_block_audit: twoBlockInput.draft_blocks.map(block => ({
    block_id: block.block_id, assessment: "no_teaching_claims", check: "OFFLINE only." })) };
  const verifyTwoBlocks = (parsed: unknown) => verifySelectedConversationDeliveryAudit({ ...paidAudit,
    attempts: [{ ...paidAudit.attempts[0], pre_delivery_review: { ...paidReceipt, input: twoBlockInput,
      input_sha256: hashJson(twoBlockInput), draft_sha256: hashJson(twoBlockOutput.student_visible_message),
      parsed_output: parsed, raw_output: rawReviewOutput(parsed), review_output_sha256: hashJson(parsed) } }] },
  "OFFLINE-OPENING", reviewInput, twoBlockOutput, paidRows);
  check(() => assert.equal(verifyTwoBlocks(twoBlockPass).input_tokens, 20));
  for (const checks of [twoBlockPass.teaching_block_audit.slice(1), [...twoBlockPass.teaching_block_audit].reverse(),
    [twoBlockPass.teaching_block_audit[0], twoBlockPass.teaching_block_audit[0]]]) {
    check(() => assert.throws(() => verifyTwoBlocks({ ...twoBlockPass, teaching_block_audit: checks })));
  }
  check(() => assert.throws(() => verifyDelivery(openingAudit, reviewInput)));
  check(() => assert.throws(() => verifyDelivery(paidAudit, reviewInput, openingRows)));
  check(() => assert.throws(() => verifyDelivery(paidAudit, reviewInput, [...paidRows, paidRows[1]])));
  for (const change of [{ status: "rejected" }, { provider: "mock" }, { reasoning_effort: "low" },
    { model_name: "gpt-6.1-sol" }, { input_tokens: 11 }, { total_tokens: 16 }, { raw_output: null },
    { review_output_sha256: "f".repeat(64) }, { logical_call_entered: false }, { dispatch_accounting_complete: false },
    { usage_accounting_complete: false }, { validation_issue_paths: ["rejected"] },
    { input: { ...sourceReviewInput, latest_student_message: "Altered source" } },
    { parsed_output: { ...pass, verdict: "reject" } },
    { input: { ...sourceReviewInput, canonical_profile: "hidden context must never enter review" } }]) {
    check(() => assert.throws(() => verifyDelivery({ ...paidAudit, attempts: [{ ...paidAudit.attempts[0],
      pre_delivery_review: { ...paidReceipt, ...change } }] }, reviewInput, paidRows)));
  }
  const rejectedVerdict = { ...pass, verdict: "reject", findings: [{
    kind: "unsupported_conversation_history", draft_block_id: 1, draft_quote: fakeCanonical().student_visible_message,
    source_refs: [{ sequence_index: 1, actor: "student", quote: "Please remind me." }],
    rationale: "OFFLINE authored control; no model efficacy claim." }] };
  for (const change of [{ draft_block_id: 2 }, { draft_quote: "Different draft" },
    { source_refs: [{ sequence_index: 1, actor: "student", quote: "Different student text" }] }]) {
    check(() => assert.throws(() => verifyDelivery(withClaimOutput({ ...rejectedVerdict,
      findings: [{ ...rejectedVerdict.findings[0], ...change }] }), reviewInput, paidRows)));
  }
  const rejectedReceipt = { ...paidReceipt, status: "rejected", parsed_output: rejectedVerdict,
    raw_output: rawReviewOutput(rejectedVerdict), review_output_sha256: hashJson(rejectedVerdict),
    provider_response_id: "OFFLINE-REJECTED-REVIEW", physical_usage: fakePhysicalUsage("OFFLINE-REJECTED-REVIEW"),
    validation_issue_paths: ["conversation_delivery_review.rejected"] };
  const rejectedAttempt = { ...openingAudit.attempts[0], accepted: false, failure_class: "parsed_semantic_contract_failure",
    // This authored control is already canonical, not a projected planned wire.
    conversation_plan_projection: undefined,
    provider_response_id: "OFFLINE-REJECTED-DRAFT", physical_usage: fakePhysicalUsage("OFFLINE-REJECTED-DRAFT"), pre_delivery_review: rejectedReceipt,
    invalid_candidate: { candidate_json: fakeCanonical() } };
  const repairedAudit = { ...paidAudit, logical_calls_entered: 4, tutor_logical_calls_entered: 2, review_logical_calls_entered: 2,
    http_requests_dispatched: 4, provider_responses_completed: 4, provider_attempts: 4,
    attempts: [rejectedAttempt, paidAudit.attempts[0]] };
  const repairedRows = [...paidRows, { ...transportRow("OFFLINE-REJECTED-DRAFT"), request_index: 3 },
    { ...reviewTransportRow("OFFLINE-REJECTED-REVIEW"), request_index: 4 }];
  // Current paid requests use planned wire. A canonical-only authored draft
  // cannot substitute for its missing original plan/projection provenance.
  // The retained V28 regression separately checks all four physical formats.
  check(() => assert.throws(() => verifyDelivery(repairedAudit, reviewInput, repairedRows)));
  check(() => assert.throws(() => verifyDelivery(repairedAudit, reviewInput, repairedRows.slice(0, 3))));
  check(() => assert.throws(() => verifyDelivery({ ...repairedAudit, attempts: [{ ...rejectedAttempt,
    invalid_candidate: { candidate_json: { student_visible_message: "Changed rejected draft" } } }, paidAudit.attempts[0]] }, reviewInput, repairedRows)));
  check(() => assert.throws(() => verifyDelivery({ ...repairedAudit, review_logical_calls_entered: 1 }, reviewInput, repairedRows)));
  const audit = fakePlanAudit("OFFLINE-PLAN-RESPONSE");
  check(() => assert.equal(verifyPlan(audit, "OFFLINE-PLAN-RESPONSE").status, "reconstructed"));
  const validAttempt = audit.attempts[0];
  const validProjection = validAttempt.conversation_plan_projection;
  for (const bad of [undefined, {}, { attempts: [] }, { attempts: [validAttempt, validAttempt] },
    ...[{ accepted: false }, { provider_response_id: "wrong-response" }, { result_status: "failed" },
      { failure_class: "parsed_semantic_contract_failure" }, { conversation_plan_projection: undefined },
      ...[{ version: "old-plan" }, { status: "rejected" }, { original_output_sha256: "invalid" },
        { reconstructed_output_sha256: null }, { validation_issue_paths: ["some_issue"] },
        { prior_needs_sha256: null }, { prior_needs_sha256: "f".repeat(64) }, { prior_needs_sha256: undefined },
        { derived_open_need_ids: undefined }, { derived_open_need_ids: ["invented"] },
        { stored_preference_transition_version: undefined }, { stored_preference_transition_version: "wrong" },
        { prior_tutor_source_version: undefined }, { prior_tutor_source_version: "wrong" },
        { prior_tutor_bindings: undefined }, { prior_tutor_bindings: [{ path: "invented", tutor_sequence_index: 1, reply_sha256: "a".repeat(64) }] },
        { current_reply_source_version: undefined }, { current_reply_source_version: "wrong" },
        { current_reply_bindings: undefined }, { current_reply_bindings: [{ path: "invented", reply_sha256: "a".repeat(64) }] },
        { support_preference_link_version: undefined }, { support_preference_link_version: "wrong" },
        { support_preference_link_bindings: undefined }, { support_preference_link_bindings: [{ path: "invented", links: [] }] },
        { stored_preference_bindings: [{ preference_id: "duplicate", preference_sha256: "a".repeat(64) },
          { preference_id: "duplicate", preference_sha256: "a".repeat(64) }] }].map(change =>
        ({ conversation_plan_projection: { ...validProjection, ...change } }))
    ].map(change => ({ attempts: [{ ...validAttempt, ...change }] }))]) {
    check(() => assert.throws(() => verifyPlan(bad, "OFFLINE-PLAN-RESPONSE")));
  }
  check(() => assert.equal(verifyPlan({ attempts: [
    { accepted: false, result_status: "completed", failure_class: "parsed_semantic_contract_failure",
      provider_response_id: "OFFLINE-REJECTED-RETAINED", conversation_plan_projection: { ...validProjection, status: "rejected" } },
    validAttempt
  ] }, "OFFLINE-PLAN-RESPONSE").status, "reconstructed"));
  const need = (id: string, status: "open" | "addressed" | "deferred") => ({ need_id: id, kind: "question" as const,
    status, description: "OFFLINE need only.", source: { evidence_id: `ev_${"a".repeat(24)}`, quote: "OFFLINE source only." },
    support: [], deferred_by_preference_id: status === "deferred" ? "boundary" : null });
  const priorNeeds = [need("untouched", "open"), need("changed", "open"), need("previously-deferred", "deferred")]
    .map(item => ({ ...item, source_agent_call_public_id: "OFFLINE-earlier", source_tutor_sequence_index: 1 }));
  const inputWithNeeds = { ...fakeInput(), conversation_continuity: { ...fakeContinuity(), needs: priorNeeds } };
  const outputWithNeeds = { ...fakeCanonical(), conversation_review: { ...fakeCanonical().conversation_review,
    need_updates: [need("changed", "addressed"), need("new-open", "open"), need("new-deferred", "deferred")],
    closure: { ...fakeCanonical().conversation_review.closure, unresolved_need_ids: ["new-open", "untouched"] } } };
  const auditWithNeeds = fakePlanAudit("OFFLINE-NEEDS-RESPONSE");
  auditWithNeeds.attempts[0].conversation_plan_projection.prior_needs_sha256 = createHash("sha256").update(JSON.stringify(priorNeeds)).digest("hex");
  auditWithNeeds.attempts[0].conversation_plan_projection.derived_open_need_ids = ["new-open", "untouched"];
  check(() => assert.deepEqual(verifySelectedConversationPlanAudit(auditWithNeeds, "OFFLINE-NEEDS-RESPONSE", inputWithNeeds,
    outputWithNeeds).derived_open_need_ids, ["new-open", "untouched"]));
  for (const alteredIds of [["new-open"], ["new-open", "untouched", "new-deferred"], ["new-open", "untouched", "untouched"], ["untouched", "new-open"]]) {
    const altered = structuredClone(auditWithNeeds);
    altered.attempts[0].conversation_plan_projection.derived_open_need_ids = alteredIds;
    check(() => assert.throws(() => verifySelectedConversationPlanAudit(altered, "OFFLINE-NEEDS-RESPONSE", inputWithNeeds, outputWithNeeds)));
  }
  check(() => assert.throws(() => verifySelectedConversationPlanAudit(auditWithNeeds, "OFFLINE-NEEDS-RESPONSE", inputWithNeeds,
    { conversation_review: { ...outputWithNeeds.conversation_review,
      closure: { ...outputWithNeeds.conversation_review.closure, unresolved_need_ids: [] } } })));
  check(() => assert.throws(() => verifySelectedConversationPlanAudit(auditWithNeeds, "OFFLINE-NEEDS-RESPONSE", inputWithNeeds,
    { conversation_review: { ...outputWithNeeds.conversation_review,
      need_updates: [...outputWithNeeds.conversation_review.need_updates, need("new-open", "open")] } })));
  const wholeReply = '**Reliability** preserves Markdown and 中文. ' + 'x'.repeat(1250);
  const wholeHash = conversationCurrentReplySourceHash(wholeReply);
  const binding = { version: CONVERSATION_CURRENT_REPLY_SOURCE_VERSION, reply_sha256: wholeHash };
  const priorText = "OFFLINE prior source.";
  const receiptInput = { ...fakeInput(), visible_transcript: [{ sequence_index: 1, actor: "tutor", message_text: priorText },
    { sequence_index: 2, actor: "student", message_text: "Remind me." }], latest_student_message: "Remind me." };
  const receiptOutput = { ...fakeCanonical(), student_visible_message: wholeReply,
    conversation_review: { ...fakeCanonical().conversation_review,
      need_updates: [{ ...need("shown", "addressed"), support: [{ tutor_sequence_index: null, quote: wholeReply, source_binding: binding }] }],
      current_support: [{ topic: "OFFLINE", kind: "explanation", quote: wholeReply, source_binding: binding, need_ids: ["shown"], preference_ids: [] as string[],
        preference_linkage: { version: CONVERSATION_SUPPORT_PREFERENCE_LINK_VERSION, links: [] as SupportPreferenceLink[] } }],
      recap_claims: [{ current_quote: wholeReply, source_binding: binding, earlier_support: [{ tutor_sequence_index: 1, quote: priorText, source_binding: { version: CONVERSATION_PRIOR_TUTOR_SOURCE_VERSION, reply_sha256: conversationCurrentReplySourceHash(priorText) } }] }] } };
  const receiptAudit = fakePlanAudit("OFFLINE-RECEIPTS");
  receiptAudit.attempts[0].conversation_plan_projection.prior_tutor_bindings = [{ path: "conversation_review.recap_claims[0].earlier_support[0].quote", tutor_sequence_index: 1, reply_sha256: conversationCurrentReplySourceHash(priorText) }];
  receiptAudit.attempts[0].conversation_plan_projection.current_reply_bindings = [
    "conversation_review.need_updates[0].support[0].quote", "conversation_review.current_support[0].quote", "conversation_review.recap_claims[0].current_quote"
  ].map(path => ({ path, reply_sha256: wholeHash }));
  receiptAudit.attempts[0].conversation_plan_projection.support_preference_link_bindings = [
    { path: "conversation_review.current_support[0].preference_linkage", links: [] }
  ];
  check(() => assert.equal(verifySelectedConversationPlanAudit(receiptAudit, "OFFLINE-RECEIPTS", receiptInput, receiptOutput).current_reply_bindings.length, 3));
  for (const prior of [[], [{ path: "invented", tutor_sequence_index: 1, reply_sha256: conversationCurrentReplySourceHash(priorText) }],
    [{ path: "conversation_review.recap_claims[0].earlier_support[0].quote", tutor_sequence_index: 2, reply_sha256: conversationCurrentReplySourceHash(priorText) }],
    [{ path: "conversation_review.recap_claims[0].earlier_support[0].quote", tutor_sequence_index: 1, reply_sha256: "f".repeat(64) }]]) {
    const altered = structuredClone(receiptAudit); altered.attempts[0].conversation_plan_projection.prior_tutor_bindings = prior;
    check(() => assert.throws(() => verifySelectedConversationPlanAudit(altered, "OFFLINE-RECEIPTS", receiptInput, receiptOutput)));
  }
  for (const mutate of [
    (v: typeof receiptOutput) => { v.conversation_review.recap_claims[0].earlier_support[0].quote += "changed"; },
    (v: typeof receiptOutput) => { v.conversation_review.recap_claims[0].earlier_support[0].source_binding.reply_sha256 = "f".repeat(64); },
    (v: typeof receiptOutput) => { delete (v.conversation_review.recap_claims[0].earlier_support[0] as { source_binding?: unknown }).source_binding; }
  ]) {
    const altered = structuredClone(receiptOutput); mutate(altered);
    check(() => assert.throws(() => verifySelectedConversationPlanAudit(receiptAudit, "OFFLINE-RECEIPTS", receiptInput, altered)));
  }
  for (const turns of [receiptInput.visible_transcript.slice(1), [...receiptInput.visible_transcript, receiptInput.visible_transcript[0]],
    receiptInput.visible_transcript.map(turn => turn.sequence_index === 1 ? { ...turn, actor: "student" } : turn)]) {
    check(() => assert.throws(() => verifySelectedConversationPlanAudit(receiptAudit, "OFFLINE-RECEIPTS", { ...receiptInput, visible_transcript: turns }, receiptOutput)));
  }
  for (const bindings of [[], receiptAudit.attempts[0].conversation_plan_projection.current_reply_bindings.slice(1),
    [...receiptAudit.attempts[0].conversation_plan_projection.current_reply_bindings].reverse(),
    [...receiptAudit.attempts[0].conversation_plan_projection.current_reply_bindings, receiptAudit.attempts[0].conversation_plan_projection.current_reply_bindings[0]]]) {
    const changed = structuredClone(receiptAudit); changed.attempts[0].conversation_plan_projection.current_reply_bindings = bindings;
    check(() => assert.throws(() => verifySelectedConversationPlanAudit(changed, "OFFLINE-RECEIPTS", receiptInput, receiptOutput)));
  }
  for (const mutate of [
    (v: typeof receiptOutput) => { v.student_visible_message += "changed"; },
    (v: typeof receiptOutput) => { v.conversation_review.current_support[0].quote = "Reliability"; },
    (v: typeof receiptOutput) => { v.conversation_review.recap_claims[0].source_binding.reply_sha256 = "f".repeat(64); },
    (v: typeof receiptOutput) => { delete (v.conversation_review.need_updates[0].support[0] as { source_binding?: unknown }).source_binding; }
  ]) {
    const changed = structuredClone(receiptOutput); mutate(changed);
    check(() => assert.throws(() => verifySelectedConversationPlanAudit(receiptAudit, "OFFLINE-RECEIPTS", receiptInput, changed)));
  }
  const linkedOutput = structuredClone(receiptOutput), linkedAudit = structuredClone(receiptAudit);
  const links: SupportPreferenceLink[] = [{ preference_id: "OFFLINE-boundary", relationship: "honored_constraint" },
    { preference_id: "OFFLINE-released-topic", relationship: "topic_of_support" }];
  linkedOutput.conversation_review.current_support[0].preference_linkage.links = links;
  linkedOutput.conversation_review.current_support[0].preference_ids = links.map(link => link.preference_id);
  linkedAudit.attempts[0].conversation_plan_projection.support_preference_link_bindings[0].links = links;
  check(() => assert.equal(verifySelectedConversationPlanAudit(linkedAudit, "OFFLINE-RECEIPTS", receiptInput, linkedOutput)
    .support_preference_link_bindings[0].links[0].relationship, "honored_constraint"));
  for (const alteredLinks of [[], links.slice(1), [...links].reverse(), [...links, links[0]],
    [{ ...links[0], relationship: "topic_of_support" as const }, links[1]]]) {
    const changed = structuredClone(linkedAudit);
    changed.attempts[0].conversation_plan_projection.support_preference_link_bindings[0].links = alteredLinks;
    check(() => assert.throws(() => verifySelectedConversationPlanAudit(changed, "OFFLINE-RECEIPTS", receiptInput, linkedOutput)));
  }
  for (const alter of [
    (v: typeof linkedOutput) => { v.conversation_review.current_support[0].preference_ids.reverse(); },
    (v: typeof linkedOutput) => { v.conversation_review.current_support[0].preference_linkage.links[0].relationship = "topic_of_support"; },
    (v: typeof linkedOutput) => { delete (v.conversation_review.current_support[0] as { preference_linkage?: unknown }).preference_linkage; }
  ]) {
    const changed = structuredClone(linkedOutput); alter(changed);
    check(() => assert.throws(() => verifySelectedConversationPlanAudit(linkedAudit, "OFFLINE-RECEIPTS", receiptInput, changed)));
  }
  check(() => assert.throws(() => buildLunaAllRolesCandidateManifest(manifest, "low", "profile-fidelity-v1", undefined, LUNA_CONVERSATION_REPAIR)));
  check(() => assert.throws(() => buildLunaAllRolesCandidateManifest(manifest, "medium", "profile-fidelity-v1", "gpt-6.1-sol", LUNA_CONVERSATION_REPAIR)));
  check(() => assert.throws(() => buildLunaAllRolesCandidateManifest(manifest, "medium", undefined, undefined, LUNA_CONVERSATION_REPAIR)));
  const wrongParent = structuredClone(manifest);
  wrongParent.configuration_fingerprint.role_version_metadata.formative_conversation_agent.prompt_hash = "f".repeat(64);
  check(() => assert.throws(() => buildLunaAllRolesCandidateManifest(wrongParent, "medium", "profile-fidelity-v1", undefined, LUNA_CONVERSATION_REPAIR)));

  const stage = stageLunaAllRolesCandidateFromManifest({ ...scope, parentManifestPath,
    expectedParentManifestSha256: hashFile(parentManifestPath), expectedParentRuntimeHash: parentHash,
    outputDirectory: path.join(directory, "candidate"), authorizationReference: "OFFLINE-TEST-ONLY" });
  const candidateRecord = JSON.parse(readFileSync(stage.candidatePath, "utf8"));
  check(() => assert.equal(candidateRecord.version, LUNA_CONVERSATION_REPAIR_CANDIDATE_VERSION));
  check(() => assert.equal(candidateRecord.production_activation_permitted, false));
  const candidateEnv = { APP_ENV: "development", LUNA_LOW_LOCAL_CANDIDATE_EVALUATION: "1",
    DATABASE_URL: "postgresql://127.0.0.1:54329/cmcq_ai_students_abcdef012345",
    OPERATIONAL_APPROVED_CONFIG_HASH: stage.runtime_candidate_hash,
    OPERATIONAL_APPROVED_MANIFEST_PATH: stage.manifestPath };
  check(() => assert.equal(resolveActiveOperationalApproval({ bundlePath: stage.candidatePath, env: candidateEnv })?.kind, "local_candidate_evaluation"));
  const mixedCandidate = buildLunaAllRolesCandidateManifest(manifest, "medium", "profile-fidelity-v1", undefined,
    LUNA_CONVERSATION_REPAIR, LUNA_SOL_DELIVERY_REVIEW_MODEL);
  check(() => assert.deepEqual(mixedCandidate.roles, candidate.roles));
  check(() => assert.deepEqual(mixedCandidate.runtime_policy, candidate.runtime_policy));
  check(() => assert.equal(conversationRepairRuntimeFingerprintIssues(mixedCandidate).length, 0));
  const mixedStage = stageLunaAllRolesCandidateFromManifest({ ...scope, deliveryReviewModel: LUNA_SOL_DELIVERY_REVIEW_MODEL,
    parentManifestPath, expectedParentManifestSha256: hashFile(parentManifestPath), expectedParentRuntimeHash: parentHash,
    outputDirectory: path.join(directory, "mixed-candidate"), authorizationReference: "OFFLINE-TEST-ONLY" });
  const mixedRecord = JSON.parse(readFileSync(mixedStage.candidatePath, "utf8"));
  check(() => assert.equal(mixedRecord.version, LUNA_SOL_DELIVERY_REVIEW_CANDIDATE_VERSION));
  check(() => assert.equal(historicalConversationDeliveryModel(candidate, candidateRecord), undefined));
  check(() => assert.equal(historicalConversationDeliveryModel(mixedCandidate, mixedRecord), LUNA_SOL_DELIVERY_REVIEW_MODEL));
  const historicalMixed = structuredClone(mixedCandidate);
  Object.assign(historicalMixed.configuration_fingerprint.role_version_metadata.formative_conversation_agent, {
    delivery_review_version: "conversation-delivery-review-v4", delivery_review_prompt_hash: "6".repeat(64), delivery_review_max_output_tokens: 2500 });
  check(() => assert.equal(historicalConversationDeliveryModel(historicalMixed, mixedRecord), LUNA_SOL_DELIVERY_REVIEW_MODEL));
  const historicalV7 = structuredClone(historicalMixed);
  historicalV7.configuration_fingerprint.role_version_metadata.formative_conversation_agent.delivery_review_version = "conversation-delivery-review-v7";
  check(() => assert.equal(historicalConversationDeliveryModel(historicalV7, mixedRecord), LUNA_SOL_DELIVERY_REVIEW_MODEL));
  historicalV7.configuration_fingerprint.role_version_metadata.formative_conversation_agent.delivery_review_max_output_tokens = 4000;
  check(() => assert.throws(() => historicalConversationDeliveryModel(historicalV7, mixedRecord)));
  const staleCurrentLimit = structuredClone(mixedCandidate);
  staleCurrentLimit.configuration_fingerprint.role_version_metadata.formative_conversation_agent.delivery_review_max_output_tokens = 2500;
  check(() => assert.throws(() => historicalConversationDeliveryModel(staleCurrentLimit, mixedRecord)));
  check(() => assert(conversationRepairRuntimeFingerprintIssues(staleCurrentLimit).length > 0));
  check(() => assert.throws(() => historicalConversationDeliveryModel(historicalMixed, candidateRecord)));
  check(() => assert.throws(() => historicalConversationDeliveryModel(candidate, mixedRecord)));
  for (const change of [{ delivery_review_model_name: "gpt-5.6-luna" }, { delivery_review_reasoning_effort: "low" },
    { delivery_review_max_output_tokens: 7000 }, { delivery_review_execution_purpose: "tutor" },
    { delivery_review_policy_version: undefined }, { delivery_review_prompt_hash: "invalid" }, { delivery_review_version: "unknown" }]) {
    const altered = structuredClone(historicalMixed);
    Object.assign(altered.configuration_fingerprint.role_version_metadata.formative_conversation_agent, change);
    check(() => assert.throws(() => historicalConversationDeliveryModel(altered, mixedRecord)));
  }
  // The baseline source is the preserved native input, never an unrelated replay
  // bootstrap or an authored expected verdict. Hidden assessment fields are not sent.
  const baselineContext = { ...reviewInput, administered_items: [{ item_public_id: "OFFLINE-item", answer_key: "hidden" }],
    assessment_response_evidence: [{ item_public_id: "OFFLINE-item", written_reasoning: "Subtract three to find the exact score.",
      selected_option: "hidden", is_correct: false }] };
  const baselineDraft = "Your initial reason said subtracting three finds the exact score.";
  const priorReviewInput = buildConversationDeliveryReviewInputV6(
    baselineContext as unknown as Parameters<typeof buildConversationDeliveryReviewInputV6>[0], baselineDraft);
  const { initial_student_reasoning: omittedBaseline, ...priorFourFields } = priorReviewInput;
  const baselineCalls = [{ agent_name: "formative_conversation_agent", provider: "openai", input_payload: baselineContext,
    raw_output: { provider_execution_audit: { attempts: [{ accepted: false,
      invalid_candidate: { candidate_json: { student_visible_message: baselineDraft } },
      pre_delivery_review: { version: "conversation-delivery-review-v4", input: priorFourFields } }] } } }];
  const trueProbe = { id: "truthful_initial_reason_attribution", source_kind: "preserved_synthetic_native",
    source_agent_call_index_zero_based: 0, source_attempt_index_zero_based: 0, ...priorFourFields };
  const falseProbe = { id: "contradictory_initial_reason_attribution", source_kind: "authored_synthetic_control",
    context_source_kind: "preserved_synthetic_native", context_source_agent_call_index_zero_based: 0,
    authored_from_native_control_id: "truthful_initial_reason_attribution", ...priorFourFields,
    draft_message: "Your initial reason said subtracting three cannot find the exact score." };
  const projectedTrue = buildBoundDeliveryProbeInput(trueProbe, [baselineCalls], "conversation-delivery-review-v6").input;
  const projectedFalse = buildBoundDeliveryProbeInput(falseProbe, [baselineCalls], "conversation-delivery-review-v6").input;
  check(() => assert.deepEqual(projectedTrue, priorReviewInput));
  check(() => assert.deepEqual(buildBoundDeliveryProbeInput(trueProbe, [baselineCalls], "conversation-delivery-review-v5").input, projectedTrue));
  const jsonbCalls = structuredClone(baselineCalls);
  jsonbCalls[0].raw_output.provider_execution_audit.attempts[0].pre_delivery_review.input = reverseKeys(priorFourFields) as typeof priorFourFields;
  check(() => assert.deepEqual(buildBoundDeliveryProbeInput(trueProbe, [jsonbCalls], "conversation-delivery-review-v6").input, projectedTrue));
  jsonbCalls[0].raw_output.provider_execution_audit.attempts[0].pre_delivery_review.input.visible_transcript[0].message_text += "changed";
  check(() => assert.throws(() => buildBoundDeliveryProbeInput(trueProbe, [jsonbCalls], "conversation-delivery-review-v6")));
  check(() => assert.deepEqual("initial_student_reasoning" in projectedTrue && projectedTrue.initial_student_reasoning, omittedBaseline));
  check(() => assert.deepEqual("initial_student_reasoning" in projectedFalse && projectedFalse.initial_student_reasoning, omittedBaseline));
  check(() => assert(!JSON.stringify(projectedTrue).includes("hidden")));
  for (const change of [{ source_agent_call_index_zero_based: 9 }, { draft_message: "Changed source draft" },
    { latest_student_message: "Changed source student" }]) {
    check(() => assert.throws(() => buildBoundDeliveryProbeInput({ ...trueProbe, ...change }, [baselineCalls], "conversation-delivery-review-v6")));
  }
  for (const change of [{ context_source_kind: undefined }, { context_source_agent_call_index_zero_based: 9 },
    { authored_from_native_control_id: "unrelated" }, { source_attempt_index_zero_based: 0 },
    { draft_message: baselineDraft }, { latest_student_message: "Changed" }]) {
    check(() => assert.throws(() => buildBoundDeliveryProbeInput({ ...falseProbe, ...change }, [baselineCalls], "conversation-delivery-review-v6")));
  }
  const authoredInput = buildBoundDeliveryProbeInput({ ...falseProbe, id: "requested_new_explanation" }, [], "conversation-delivery-review-v6").input;
  check(() => assert.deepEqual("initial_student_reasoning" in authoredInput && authoredInput.initial_student_reasoning, []));
  check(() => assert.throws(() => buildBoundDeliveryProbeInput({ ...falseProbe, id: "requested_new_explanation" }, [baselineCalls], "conversation-delivery-review-v6")));
  // Exact synthetic native summary and explicitly declared authored controls.
  // The native source is not relabeled as the authored latest-turn substitution.
  const assistanceFixture = JSON.parse(readFileSync(path.join(process.cwd(), "prisma/fixtures/conversation-assisted-summary-native-v20.json"), "utf8"));
  const assistanceCalls: Record<string, unknown>[] = Array.from({ length: 14 }, () => ({}));
  assistanceCalls[13] = { agent_name: "formative_conversation_agent", provider: "openai", call_status: "succeeded", output_validated: true,
    input_payload: assistanceFixture.context, output_payload: assistanceFixture.output, raw_output: { provider_execution_audit: { attempts: [{
      accepted: true, pre_delivery_review: { version: "conversation-delivery-review-v5", input: assistanceFixture.review_input }
    }] } } };
  const originalAssistance = JSON.stringify([assistanceCalls, assistanceFixture]);
  const projectDialogue = (input: typeof assistanceFixture.context) => input.visible_transcript.map((turn: { sequence_index: number; actor: string; message_text: string }) =>
    ({ sequence_index: turn.sequence_index, actor: turn.actor, message_text: turn.message_text }));
  const badSummaryProbe = { id: "unsupported_assisted_understanding_summary", source_kind: "preserved_synthetic_native",
    source_agent_call_index_zero_based: 13, source_attempt_index_zero_based: 0,
    visible_transcript: projectDialogue(assistanceFixture.context), latest_student_message: assistanceFixture.context.latest_student_message,
    draft_message: assistanceFixture.output.student_visible_message };
  check(() => assert.deepEqual(buildBoundDeliveryProbeInput(badSummaryProbe, [assistanceCalls], "conversation-delivery-review-v6").input,
    buildConversationDeliveryReviewInputV6(assistanceFixture.context, assistanceFixture.output.student_visible_message)));
  for (const control of assistanceFixture.controls) {
    const authoredContext = structuredClone(assistanceFixture.context);
    if (control.replacement_latest_student_message) {
      authoredContext.latest_student_message = control.replacement_latest_student_message;
      authoredContext.visible_transcript.at(-1).message_text = control.replacement_latest_student_message;
    }
    const probe = { id: control.id, source_kind: "authored_synthetic_control", context_source_kind: "preserved_synthetic_native",
      context_source_agent_call_index_zero_based: 13, authored_from_native_control_id: "unsupported_assisted_understanding_summary",
      authored_control_fixture_key: control.id, sources: [assistanceFixture.source, { path: "fixture.json", sha256: "a".repeat(64) }],
      visible_transcript: projectDialogue(authoredContext), latest_student_message: authoredContext.latest_student_message, draft_message: control.draft_message };
    check(() => assert.deepEqual(buildBoundDeliveryProbeInput(probe, [assistanceCalls, assistanceFixture], "conversation-delivery-review-v6").input,
      buildConversationDeliveryReviewInputV6(authoredContext, control.draft_message)));
    check(() => assert.deepEqual(buildBoundDeliveryProbeInput(probe, [assistanceCalls, reverseKeys(assistanceFixture)], "conversation-delivery-review-v6").input,
      buildConversationDeliveryReviewInputV6(authoredContext, control.draft_message)));
    for (const change of [{ authored_control_fixture_key: "unlisted" }, { authored_from_native_control_id: "unrelated" },
      { context_source_agent_call_index_zero_based: 12 }, { source_attempt_index_zero_based: 0 }, { source_agent_call_index_zero_based: 13 },
      { sources: [{ ...assistanceFixture.source, sha256: "b".repeat(64) }, probe.sources[1]] },
      { draft_message: "Undeclared draft" }, { latest_student_message: "Undeclared student turn" },
      { visible_transcript: [{ ...probe.visible_transcript[0], message_text: "Changed earlier history" }, ...probe.visible_transcript.slice(1)] }]) {
      check(() => assert.throws(() => buildBoundDeliveryProbeInput({ ...probe, ...change }, [assistanceCalls, assistanceFixture], "conversation-delivery-review-v6")));
    }
    const changedFixture = structuredClone(assistanceFixture);
    changedFixture.controls.find((entry: { id: string }) => entry.id === control.id).draft_message = "Undeclared fixture edit";
    check(() => assert.throws(() => buildBoundDeliveryProbeInput({ ...probe, draft_message: "Undeclared fixture edit" }, [assistanceCalls, changedFixture], "conversation-delivery-review-v6")));
    check(() => assert.throws(() => buildBoundDeliveryProbeInput(probe, [assistanceCalls], "conversation-delivery-review-v6")));
  }
  const rejectedAssistanceCalls = structuredClone(assistanceCalls);
  (rejectedAssistanceCalls[13].raw_output as { provider_execution_audit: { attempts: Array<{ accepted: boolean }> } }).provider_execution_audit.attempts[0].accepted = false;
  check(() => assert.throws(() => buildBoundDeliveryProbeInput(badSummaryProbe, [rejectedAssistanceCalls], "conversation-delivery-review-v6")));
  check(() => assert.equal(JSON.stringify([assistanceCalls, assistanceFixture]), originalAssistance));
  // The negative is the preserved native synthetic candidate; the two positive
  // controls are separately authored and cannot rewrite its source context.
  const privateFixturePath = path.resolve("prisma/fixtures/formative-private-learning-native-v26.json");
  const privateFixture = JSON.parse(readFileSync(privateFixturePath, "utf8"));
  const privateCalls: Record<string, unknown>[] = Array.from({ length: 10 }, () => ({}));
  privateCalls[9] = { agent_name: "formative_conversation_agent", provider: "openai", call_status: "succeeded",
    output_validated: true, input_payload: privateFixture.context, output_payload: privateFixture.output };
  const privateOriginal = JSON.stringify([privateCalls, privateFixture]);
  for (const control of privateFixture.controls) {
    const probe = { id: control.id, private_learning_control_id: control.id,
      source_kind: control.authored_synthetic ? "authored_synthetic_control" : "preserved_synthetic_native",
      context_source_agent_call_index_zero_based: 9, sources: [privateFixture.source, bound(privateFixturePath)],
      visible_transcript: control.context.visible_transcript, latest_student_message: control.context.latest_student_message,
      draft_message: control.candidate.student_visible_message };
    const projected = buildBoundDeliveryProbeInput(probe, [privateCalls, privateFixture], CONVERSATION_DELIVERY_REVIEW_VERSION);
    check(() => assert.deepEqual(projected.candidate, control.candidate));
    check(() => assert.deepEqual(projected.input, buildConversationDeliveryReviewInput(control.context,
      control.candidate.student_visible_message, control.candidate)));
    check(() => assert.deepEqual(buildBoundDeliveryProbeInput(probe, [privateCalls, reverseKeys(privateFixture)],
      CONVERSATION_DELIVERY_REVIEW_VERSION).input, projected.input));
    for (const change of [{ private_learning_control_id: "unlisted" }, { context_source_agent_call_index_zero_based: 8 },
      { source_agent_call_index_zero_based: 9 }, { source_attempt_index_zero_based: 0 },
      { sources: [{ ...privateFixture.source, sha256: "b".repeat(64) }, bound(privateFixturePath)] },
      { source_kind: control.authored_synthetic ? "preserved_synthetic_native" : "authored_synthetic_control" },
      { draft_message: "Changed candidate" }, { latest_student_message: "Changed student evidence" }, { visible_transcript: [] }]) {
      check(() => assert.throws(() => buildBoundDeliveryProbeInput({ ...probe, ...change },
        [privateCalls, privateFixture], CONVERSATION_DELIVERY_REVIEW_VERSION)));
    }
    check(() => assert.throws(() => buildBoundDeliveryProbeInput(probe, [privateCalls, privateFixture], "conversation-delivery-review-v6")));
    const changedFixture = structuredClone(privateFixture);
    changedFixture.controls.find((entry: { id: string }) => entry.id === control.id).candidate.profile_transition_recommendation = null;
    changedFixture.controls.find((entry: { id: string }) => entry.id === control.id).candidate.student_visible_message = "Undeclared edit";
    check(() => assert.throws(() => buildBoundDeliveryProbeInput(probe, [privateCalls, changedFixture], CONVERSATION_DELIVERY_REVIEW_VERSION)));
    check(() => assert.throws(() => buildBoundDeliveryProbeInput(probe, [privateCalls], CONVERSATION_DELIVERY_REVIEW_VERSION)));
  }
  check(() => assert.equal(JSON.stringify([privateCalls, privateFixture]), privateOriginal));
  const withResolver = (target: typeof stage, source: typeof candidate, action: () => void) => {
    const overrides: Record<string, string | undefined> = { ...candidateEnv, ...approvedRoleEnvironmentAssertions(source),
      SESSION_SECRET: "offline-synthetic-approval-resolver-secret-only",
      OPERATIONAL_APPROVED_CONFIG_HASH: target.runtime_candidate_hash, OPERATIONAL_APPROVED_MANIFEST_PATH: target.manifestPath,
      OPERATIONAL_APPROVAL_BUNDLE_PATH: target.candidatePath, OPERATIONAL_APPROVAL_EVIDENCE_PATH: undefined,
      RENDER: undefined, RENDER_SERVICE_ID: undefined, OPERATIONAL_LIVE_CANARY_DATABASE_URL_ACTIVE: undefined };
    const previous = Object.fromEntries(Object.keys(overrides).map(key => [key, process.env[key]]));
    try { for (const [key, value] of Object.entries(overrides)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    } action(); } finally { for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    } }
  };
  const primary = approvedCandidateRoleConfig(candidate, "formative_conversation_agent");
  withResolver(stage, candidate, () => check(() => assert.deepEqual(resolveFormativeConversationDeliveryReviewConfig(primary),
    { model_config: { ...primary, max_output_tokens: LUNA_CONVERSATION_DELIVERY_REVIEW_MAX_OUTPUT_TOKENS }, policy_version: null })));
  withResolver(mixedStage, mixedCandidate, () => {
    check(() => assert.deepEqual(resolveFormativeConversationDeliveryReviewConfig(primary), {
      model_config: { model_name: LUNA_SOL_DELIVERY_REVIEW_MODEL, reasoning_effort: "medium", max_output_tokens: LUNA_CONVERSATION_DELIVERY_REVIEW_MAX_OUTPUT_TOKENS },
      policy_version: LUNA_SOL_DELIVERY_REVIEW_POLICY_VERSION }));
    check(() => assert.throws(() => resolveFormativeConversationDeliveryReviewConfig({ ...primary, model_name: LUNA_SOL_DELIVERY_REVIEW_MODEL })));
    check(() => assert.throws(() => resolveFormativeConversationDeliveryReviewConfig({ ...primary, max_output_tokens: 6000 })));
  });
  for (const change of [{ delivery_review_policy_version: undefined }, { delivery_review_model_name: "gpt-5.6-luna" },
    { delivery_review_execution_purpose: "tutor_generation" }, { delivery_review_max_output_tokens: 2501 }]) {
    const altered = structuredClone(mixedCandidate);
    Object.assign(altered.configuration_fingerprint.role_version_metadata.formative_conversation_agent, change);
    const alteredPath = save(`mixed-altered-${checks}.json`, altered);
    const alteredHash = modelUpgradeCandidateRuntimeHash(altered, APPROVED_OPERATIONAL_ROLE_NAMES);
    const recordPath = save(`mixed-altered-record-${checks}.json`, { ...mixedRecord,
      candidate_manifest: bound(alteredPath), runtime_candidate_hash: alteredHash });
    withResolver({ ...mixedStage, candidatePath: recordPath, manifestPath: alteredPath, runtime_candidate_hash: alteredHash }, altered,
      () => check(() => assert.throws(() => resolveFormativeConversationDeliveryReviewConfig(primary))));
  }
  check(() => assert.throws(() => resolveActiveOperationalApproval({ bundlePath: mixedStage.candidatePath,
    env: { ...candidateEnv, OPERATIONAL_APPROVED_CONFIG_HASH: mixedStage.runtime_candidate_hash,
      OPERATIONAL_APPROVED_MANIFEST_PATH: mixedStage.manifestPath, APP_ENV: "production" } })));
  for (const changes of [{ RENDER: "true" }, { APP_ENV: "production" }, { DATABASE_URL: "postgresql://remote.invalid/student_records" },
    { LUNA_LOW_LOCAL_CANDIDATE_EVALUATION: undefined }, { OPERATIONAL_APPROVAL_EVIDENCE_PATH: parentEvidencePath }]) {
    check(() => assert.throws(() => resolveActiveOperationalApproval({ bundlePath: stage.candidatePath, env: { ...candidateEnv, ...changes } })));
  }

  const sourceHashes = Object.fromEntries(LUNA_CONVERSATION_REPAIR_SOURCE_FILES.map(file => [file, hashFile(file)]));
  const requests: Array<Record<string, unknown>> = [];
  const artifacts = LUNA_LOW_REQUIRED_SCENARIOS.map((case_id, index) => {
    const calls = ["student_profiling_agent", ...Array<string>(7).fill("formative_conversation_agent")].map((agent_name, n) => ({
      agent_name, provider: "openai", model_name: "gpt-5.6-luna", reasoning_effort: "medium", output_validated: true,
      call_status: "succeeded", input_tokens: 10, output_tokens: 5, provider_response_id: `OFFLINE-FAKE-${index}-${n}`,
      prompt_version: agent_name === "formative_conversation_agent" ? "formative-conversation-host-v7.21" : LUNA_CONVERSATION_PROFILE_PROMPT_VERSION,
      prompt_hash: agent_name === "formative_conversation_agent" ? LUNA_CONVERSATION_REPAIR_PROMPT_HASH : LUNA_CONVERSATION_PROFILE_PROMPT_HASH,
      schema_version: agent_name === "formative_conversation_agent" ? "formative-conversation-profile-proposal-output-v1" : LUNA_CONVERSATION_PROFILE_SCHEMA_VERSION,
      input_payload: agent_name === "formative_conversation_agent" ? fakeInput() : fakeProfileInput(),
      output_payload: agent_name === "formative_conversation_agent" ? fakeCanonical() : fakeProfileOutput(),
      raw_output: { notice: "OFFLINE-FAKE-FIXTURE; no provider result.", accepted_output: rawReviewOutput(fakeWire()),
        provider_execution_audit: fakePlanAudit(`OFFLINE-FAKE-${index}-${n}`) }
    }));
    for (const call of calls) requests.push({ request_index: requests.length + 1, case_id, category: "application",
      agent_name: call.agent_name, model_name: call.model_name, status: "completed", provider_response_id: call.provider_response_id,
      request_format_sha256: call.agent_name === "student_profiling_agent" ? selectedProfileRequestFormatSha256(call.input_payload) : selectedConversationRequestFormatSha256(call.input_payload),
      usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 } });
    return { case_id, artifact: bound(save(`${case_id}-agent-calls.json`, calls)) };
  });
  const results = LUNA_LOW_REQUIRED_SCENARIOS.map((case_id, n) => ({ case_id, session_public_id: `OFFLINE-FAKE-SESSION-${n}`,
    outcome: "mechanical_checks_passed_manual_pedagogical_review_required", validated_live_initial_profile_calls: 1,
    preparation: { status: "completed" }, application_usage: { calls: 8, rejected_or_failed_calls: [], token_budget_failures: 0,
      input_tokens: 80, output_tokens: 40 }, generated_student_replies: Array.from({ length: 6 }, () => ({ source: "scripted_edge_case", usage: null })),
    research_manifest_entries_verified: 1, exported_turn_count: 13,
    transcript: Array.from({ length: 13 }, (_, turn) => ({ actor: turn % 2 ? "student" : "tutor" })) }));
  const report = { version: "ai-student-journeys-v3", suite: "conversational-support-needs", synthetic_only: true,
    real_student_records_used: false, runtime_hash: stage.runtime_candidate_hash, source_commit: "d".repeat(40),
    source_files_sha256: sourceHashes, student_model: { model_name: "gpt-5.6-luna", reasoning_effort: "medium" },
    provider_dispatches: requests.length, provider_models: { "gpt-5.6-luna": requests.length }, finished_at: new Date().toISOString(), results,
    notice: "OFFLINE FIXTURE; not evidence of a real simulation." };
  const reportPath = save("OFFLINE-native-report.json", report);
  const quality = { profile_fidelity_accepted: true, student_question_coverage_accepted: true, overall_release_accepted: true,
    conversation_continuity_accepted: true, grounded_completion_accepted: true, student_support_quality_accepted: true,
    limitations: ["OFFLINE FIXTURE; no real educational review."] };
  const additional_case_evidence = Object.fromEntries(CONVERSATION_RELIABILITY_ADDITIONAL_CASES.map((case_id, index) => {
    const replies = [2, 4, 30][index];
    const calls = Array.from({ length: replies + 2 }, (_, n) => ({
      agent_name: n === 0 ? "student_profiling_agent" : "formative_conversation_agent", provider: "openai",
      model_name: "gpt-5.6-luna", reasoning_effort: "medium", output_validated: true, call_status: "succeeded",
      input_tokens: 10, output_tokens: 5, provider_response_id: `OFFLINE-EXTRA-${index}-${n}`,
      prompt_version: n === 0 ? LUNA_CONVERSATION_PROFILE_PROMPT_VERSION : "formative-conversation-host-v7.21",
      prompt_hash: n === 0 ? LUNA_CONVERSATION_PROFILE_PROMPT_HASH : LUNA_CONVERSATION_REPAIR_PROMPT_HASH,
      schema_version: n === 0 ? LUNA_CONVERSATION_PROFILE_SCHEMA_VERSION : "formative-conversation-profile-proposal-output-v1",
      input_payload: n === 0 ? fakeProfileInput() : fakeInput(), output_payload: n === 0 ? fakeProfileOutput() : fakeCanonical(),
      raw_output: { accepted_output: rawReviewOutput(fakeWire()), provider_execution_audit: fakePlanAudit(`OFFLINE-EXTRA-${index}-${n}`) }
    }));
    const selected = calls.map(call => {
      const request_index = requests.length + 1;
      requests.push({ request_index, case_id, category: "application", agent_name: call.agent_name,
        model_name: call.model_name, status: "completed", provider_response_id: call.provider_response_id,
        request_format_sha256: call.agent_name === "student_profiling_agent" ? selectedProfileRequestFormatSha256(call.input_payload) : selectedConversationRequestFormatSha256(call.input_payload),
        usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 } });
      return request_index;
    });
    const extraReport = { ...report, suite: "conversational-reliability", provider_dispatches: calls.length,
      provider_models: { "gpt-5.6-luna": calls.length }, results: [{ ...results[0], case_id,
        session_public_id: `OFFLINE-EXTRA-SESSION-${index}`, application_usage: { ...results[0].application_usage,
          calls: calls.length, input_tokens: calls.length * 10, output_tokens: calls.length * 5 },
        generated_student_replies: Array.from({ length: replies }, () => ({ source: "scripted_edge_case", usage: null })),
        exported_turn_count: replies * 2 + 1, transcript: Array.from({ length: replies * 2 + 1 }, (_, turn) => ({ actor: turn % 2 ? "student" : "tutor" })) }] };
    return [case_id, { report: bound(save(`OFFLINE-extra-report-${index}.json`, extraReport)),
      agent_calls: bound(save(`${case_id}-agent-calls.json`, calls)), transport_request_indices: selected, review: quality }];
  }));
  const hashObject = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
  const replayAttempts = CONVERSATION_REPLAY_FIXTURES.flatMap((fixture_id, fixtureIndex) => {
    const original = { notice: "OFFLINE synthetic fixture", fixture_id };
    const effective = { ...original, ...fakeInput() };
    const source = { path: "OFFLINE-NOT-A-REAL-NATIVE-RECORD", sha256: "e".repeat(64), case_id: LUNA_LOW_REQUIRED_SCENARIOS[0], agent_call_index_zero_based: 0 };
    const fixture = bound(save(`OFFLINE-replay-fixture-${fixtureIndex}.json`, { version: "native-synthetic-replay-v1", synthetic_only: true, input: original, source }));
    const originalFile = bound(save(`OFFLINE-replay-original-${fixtureIndex}.json`, original));
    const effectiveFile = bound(save(`OFFLINE-replay-effective-${fixtureIndex}.json`, effective));
    return [1, 2, 3].map(repeat_index => {
      const attempt_id = `repair-replay-OFFLINE-${fixtureIndex}-${repeat_index}`;
      const responseId = `OFFLINE-REPLAY-RESPONSE-${fixtureIndex}-${repeat_index}`;
      const request_index = requests.length + 1;
      requests.push({ request_index, attempt_id, case_id: LUNA_LOW_REQUIRED_SCENARIOS[0], category: "application",
        agent_name: "formative_conversation_agent", model_name: "gpt-5.6-luna", status: "completed", provider_response_id: responseId,
        request_format_sha256: selectedConversationRequestFormatSha256(effective),
        usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 } });
      const proof = { runtime_hash: stage.runtime_candidate_hash, source_input_unchanged: true, source_fixture: source,
        original_input_sha256: hashObject(original), effective_input_sha256: hashObject(effective),
        identity: { model_name: "gpt-5.6-luna", reasoning_effort: "medium", prompt_version: "formative-conversation-host-v7.21",
          prompt_hash: LUNA_CONVERSATION_REPAIR_PROMPT_HASH, schema_version: "formative-conversation-profile-proposal-output-v1" },
        request_input_encoding: "formative-tutor-input-v1", compiled_request_sha256: "a".repeat(64) };
      const evidence = { fixture_id, attempt_id, repeat_index, fixture, input_original: originalFile, input_effective: effectiveFile,
        started: bound(save(`${attempt_id}-started.json`, { fixture: fixture_id, attempt: attempt_id, fixture_sha256: fixture.sha256,
          runtime_hash: stage.runtime_candidate_hash, source_files_sha256: sourceHashes, native_source_sha256: source.sha256 })),
        request_proof: bound(save(`${attempt_id}-proof.json`, proof)),
        result: bound(save(`${attempt_id}-result.json`, { status: "completed", validation: { valid: true },
          execution: { provider_response_id: responseId, provider_execution_audit: fakePlanAudit(responseId), output: fakeCanonical(), raw_output: rawReviewOutput(fakeWire()) } })),
        report: bound(save(`${attempt_id}-report.json`, { ...proof, status: "mechanically_valid" })),
        transport_request_indices: [request_index], semantic_review: { accepted: true, limitations: ["OFFLINE test only."] } };
      const transport_usage = bound(save(`${attempt_id}-usage.json`, { version: "ai-session-transport-usage-v1", requests: [requests.at(-1)] }));
      const qualitative_review = bound(save(`${attempt_id}-review.json`, { fixture_id, attempt_id, review_complete: true,
        profile_fidelity_accepted: true, student_question_coverage_accepted: true, conversation_history_accepted: true,
        closure_accepted: true, overall_release_accepted: true, transition_exercised: false,
        sources: { started: evidence.started, request_proof: evidence.request_proof, result: evidence.result, report: evidence.report, transport_usage } }));
      return { ...evidence, qualitative_review, transport_usage };
    });
  });
  const probeAttempts = CONVERSATION_DELIVERY_REVIEW_PROBES.map((probe_id, index) => {
    const attempt_id = `repair-replay-OFFLINE-probe-${index}`, responseId = `OFFLINE-PROBE-${index}`;
    const input = buildConversationDeliveryReviewInput(reviewInput as unknown as Parameters<typeof buildConversationDeliveryReviewInput>[0],
      fakeCanonical().student_visible_message, null), expected_verdict = ["unsupported_pause_agenda", "unsolicited_teaching_after_stop", "ready_to_continue_misattributed_as_finish", "constant_score_reliability_error", "clock_analogy_inconsistency", "repeated_constant_score_reliability_error", "repeated_offset_clock_inconsistency"].includes(probe_id) ? "reject" : "pass";
    const parsed_output = expected_verdict === "reject" ? rejectedVerdict : pass;
    const previouslyAcceptedNative = ["constant_score_reliability_error", "clock_analogy_inconsistency", "repeated_constant_score_reliability_error", "repeated_offset_clock_inconsistency"].includes(probe_id);
    const source_kind = probe_id === "accurate_closing_recap" || previouslyAcceptedNative ? "preserved_synthetic_native"
      : ["unsolicited_teaching_after_stop", "source_compatible_pause_summary"].includes(probe_id) ? "preserved_synthetic_replay_draft"
        : index < 3 ? "preserved_synthetic_replay" : "authored_synthetic_control";
    const retainedDraft = { accepted: previouslyAcceptedNative, invalid_candidate: { candidate_json: { student_visible_message: input.draft_message } },
      pre_delivery_review: { version: "conversation-delivery-review-v3", input: historicalReviewInput } };
    const sources = source_kind === "preserved_synthetic_native" ? [bound(save(`OFFLINE-probe-${index}-native-calls.json`, [{
      agent_name: "formative_conversation_agent", provider: "openai", input_payload: reviewInput,
      call_status: "succeeded", output_payload: { student_visible_message: input.draft_message },
      raw_output: { provider_execution_audit: { attempts: [retainedDraft] } }
    }]))] : source_kind === "preserved_synthetic_replay_draft" ? [bound(save(`OFFLINE-probe-${index}-draft-input.json`, reviewInput)),
      bound(save(`OFFLINE-probe-${index}-draft-result.json`, { execution: { provider_execution_audit: { attempts: [retainedDraft] } } }))]
      : index < 3 ? [bound(save(`OFFLINE-probe-${index}-preserved-input.json`, { ...reviewInput,
      visible_transcript: reviewInput.visible_transcript.map(turn => ({ ...turn, created_at: "2026-10-13T00:00:00.000Z" })) })),
      bound(save(`OFFLINE-probe-${index}-preserved-result.json`, { execution: { output: fakeCanonical() } }))] : [];
    const fixture = replayAttempts[0].fixture;
    const probe = bound(save(`OFFLINE-probe-${index}.json`, { version: "conversation-delivery-review-probe-v1",
      id: probe_id, synthetic_only: true, fixture: "deferred_topic_reopened", base_fixture_sha256: fixture.sha256,
      expected_verdict, source_kind, sources,
      ...(source_kind === "preserved_synthetic_native" ? { source_agent_call_index_zero_based: 0, source_attempt_index_zero_based: 0 } : {}),
      ...(source_kind === "preserved_synthetic_replay_draft" ? { source_attempt_index_zero_based: 0 } : {}), ...input }));
    const proof = { version: "conversation-delivery-review-probe-proof-v1", probe_id, probe_sha256: probe.sha256,
      runtime_hash: stage.runtime_candidate_hash, reviewer_prompt_hash: CONVERSATION_DELIVERY_REVIEW_PROMPT_HASH,
      model_name: "gpt-5.6-luna", reasoning_effort: "medium", max_output_tokens: LUNA_CONVERSATION_DELIVERY_REVIEW_MAX_OUTPUT_TOKENS,
      request_schema_name: CONVERSATION_DELIVERY_REVIEW_VERSION, input_sha256: hashJson(input), draft_sha256: hashJson(input.draft_message),
      compiled_request_sha256: "b".repeat(64), canonical_request_hash: "c".repeat(64),
      expected_verdict_sent_to_provider: false, tutor_generations: 0, database_reads: 0, database_writes: 0 };
    const request_index = requests.length + 1;
    const row = { ...reviewTransportRow(responseId), request_index, attempt_id, case_id: `review_probe_${probe_id}` };
    requests.push(row);
    const base = { probe_id, attempt_id, fixture, probe, probe_sources: sources,
      started: bound(save(`${attempt_id}-started.json`, { review_probe: probe_id, review_probe_sha256: probe.sha256,
        attempt: attempt_id, runtime_hash: stage.runtime_candidate_hash, source_files_sha256: sourceHashes })),
      request_proof: bound(save(`${attempt_id}-proof.json`, proof)), input: bound(save(`${attempt_id}-input.json`, input)),
      result: bound(save(`${attempt_id}-result.json`, { status: "completed", matches_expected: true, expected_verdict,
        observed_verdict: expected_verdict, transport: { status: "accepted", canonical_request_hash: proof.canonical_request_hash,
          accepted_result: { provider: "openai", status: "completed", parsed_output, raw_output: { offline: true, parsed_output },
            provider_response_id: responseId, usage: row.usage },
          attempt_traces: [{ canonical_request_hash: proof.canonical_request_hash, transport_milestones: { fetch_invoked: true } }] } })),
      report: bound(save(`${attempt_id}-report.json`, { ...proof, status: "probe_expected_verdict_matched", matches_expected: true,
        source_binding_valid: true, expected_verdict, observed_verdict: expected_verdict })),
      transport_usage: bound(save(`${attempt_id}-usage.json`, { version: "ai-session-transport-usage-v1", requests: [row] })),
      transport_request_indices: [request_index] };
    return { ...base, qualitative_review: bound(save(`${attempt_id}-quality.json`, { probe_id, attempt_id,
      review_complete: true, synthetic_only: true, runtime_hash: stage.runtime_candidate_hash, overall_release_accepted: true,
      discrimination_accepted: true, source_scope_accepted: true, reviewer_attestation: "OFFLINE authored test only.", limitations: ["No provider call."],
      sources: Object.fromEntries(["probe", "started", "request_proof", "input", "result", "report", "transport_usage"].map(key =>
        [key, base[key as keyof typeof base]])) })) };
  });
  const replayEvidence = { version: "conversation-reliability-repeated-replay-validation-v1", synthetic_only: true,
    real_student_data_used: false, runtime_candidate_hash: stage.runtime_candidate_hash, source_files_sha256: sourceHashes,
    all_attempts_included: true, attempts: replayAttempts, prior_attempts: [], historical_prior_attempts: [],
    delivery_review_probes: { attempts: probeAttempts, prior_attempts: [] } };
  const replayFile = save("OFFLINE-replay-validation.json", replayEvidence);
  const transportPath = save("OFFLINE-transport.json", { version: "ai-session-transport-usage-v1", requests });
  const validation = { version: LUNA_CONVERSATION_REPAIR_VALIDATION_VERSION,
    synthetic_only: true, real_student_data_used: false, provider: "openai", runtime_candidate_hash: stage.runtime_candidate_hash,
    all_role_configs_checked: true, regression_passed: true, results_reviewed: true,
    review_method: "engineering_contract_and_transcript_review", overall_release_accepted: true,
    corrected_source_files_sha256: sourceHashes,
    case_reviews: LUNA_LOW_REQUIRED_SCENARIOS.map(case_id => ({ case_id, profile_fidelity_accepted: true,
      student_question_coverage_accepted: true, overall_release_accepted: true, conversation_continuity_accepted: true,
      grounded_completion_accepted: true, student_support_quality_accepted: true,
      limitations: ["OFFLINE FIXTURE; no real educational review."] })),
    journey_runs: [{ report: bound(reportPath), agent_calls: artifacts, transport_request_indices: requests.slice(0, 56).map(row => row.request_index) }],
    additional_case_evidence, repeated_replay_validation: bound(replayFile),
    transport_usage: bound(transportPath), reviewed_limitations: [], prior_attempts: [], historical_native_attempts: [] };
  const validationPath = save("OFFLINE-validation.json", validation);
  const verify = (file: string) => verifyLunaValidation(bound(file), stage.runtime_candidate_hash, "medium", "profile-fidelity-v1", undefined, LUNA_CONVERSATION_REPAIR);
  check(() => assert.equal(verify(validationPath).runtime_candidate_hash, stage.runtime_candidate_hash));
  const selectedUnknownIndex = validation.journey_runs[0].transport_request_indices[0];
  const selectedUnknown = requests.map(row => row.request_index === selectedUnknownIndex ? { ...row, usage: null, provider_response_id: null } : row);
  check(() => assert.throws(() => verify(save("OFFLINE-selected-unknown-with-limitation.json", { ...validation,
    transport_usage: bound(save("OFFLINE-selected-unknown-transport.json", { version: "ai-session-transport-usage-v1", requests: selectedUnknown })),
    reviewed_limitations: [{ case_id: LUNA_LOW_REQUIRED_SCENARIOS[0], limitation: "OFFLINE explicit limitation cannot turn unknown usage into selected known usage." }]
  })), /known usage for every physical request/));
  const verifyReplayChange = (label: string, changed: unknown) => verify(save(`OFFLINE-probe-validation-${label}.json`, {
    ...validation, repeated_replay_validation: bound(save(`OFFLINE-probe-wrapper-${label}.json`, changed)) }));
  for (const [label, section] of Object.entries({ missing: undefined,
    fewer: { attempts: probeAttempts.slice(1), prior_attempts: [] },
    duplicate: { attempts: [probeAttempts[0], ...probeAttempts.slice(0, -1)], prior_attempts: [] } })) {
    check(() => assert.throws(() => verifyReplayChange(label, { ...replayEvidence, delivery_review_probes: section })));
  }
  type ProbeKey = "input" | "probe" | "started" | "request_proof" | "result" | "report" | "transport_usage";
  const alterProbe = (label: string, key: ProbeKey, transform: (value: Record<string, unknown>) => unknown) => {
    const original = probeAttempts[0];
    const ref = bound(save(`OFFLINE-mutated-probe-${label}.json`, transform(JSON.parse(readFileSync(original[key].path, "utf8")))));
    const oldQuality = JSON.parse(readFileSync(original.qualitative_review.path, "utf8"));
    const entry = { ...original, [key]: ref, qualitative_review: bound(save(`OFFLINE-mutated-probe-quality-${label}.json`, {
      ...oldQuality, sources: { ...oldQuality.sources, [key]: ref } })) };
    return { ...replayEvidence, delivery_review_probes: { attempts: [entry, ...probeAttempts.slice(1)], prior_attempts: [] } };
  };
  const probeMutations: Array<[string, ProbeKey, (value: Record<string, unknown>) => unknown]> = [
    ["hidden-profile", "input", value => ({ ...value, profile: "Must not enter reviewer input" })],
    ["changed-history", "input", value => ({ ...value, latest_student_message: "Changed" })],
    ["wrong-runtime", "started", value => ({ ...value, runtime_hash: "f".repeat(64) })],
    ["wrong-review-prompt", "request_proof", value => ({ ...value, reviewer_prompt_hash: "f".repeat(64) })],
    ["old-scope-only-schema", "request_proof", value => ({ ...value, request_schema_name: "conversation-delivery-review-v1" })],
    ["expected-label-leaked", "request_proof", value => ({ ...value, expected_verdict_sent_to_provider: true })],
    ["false-detection", "result", value => ({ ...value, matches_expected: false })],
    ["missing-provider", "result", value => ({ ...value, transport: { accepted_result: null } })],
    ["false-report", "report", value => ({ ...value, observed_verdict: "pass" })],
    ["omitted-transport", "transport_usage", value => ({ ...value, requests: [] })],
    ["missing-physical-review-schema", "transport_usage", value => ({ ...value,
      requests: (value.requests as Array<Record<string, unknown>>).map(row => ({ ...row, request_format_sha256: undefined })) })],
    ["wrong-physical-review-schema", "transport_usage", value => ({ ...value,
      requests: (value.requests as Array<Record<string, unknown>>).map(row => ({ ...row, request_format_sha256: "0".repeat(64) })) })]
  ];
  for (const [label, key, transform] of probeMutations) {
    check(() => assert.throws(() => verifyReplayChange(label, alterProbe(label, key, transform))));
  }
  for (const key of ["review_complete", "discrimination_accepted", "source_scope_accepted", "overall_release_accepted"]) {
    const quality = JSON.parse(readFileSync(probeAttempts[0].qualitative_review.path, "utf8"));
    const entry = { ...probeAttempts[0], qualitative_review: bound(save(`OFFLINE-probe-rejected-${key}.json`, { ...quality, [key]: false })) };
    check(() => assert.throws(() => verifyReplayChange(key, { ...replayEvidence,
      delivery_review_probes: { attempts: [entry, ...probeAttempts.slice(1)], prior_attempts: [] } })));
  }
  for (const probeIndex of [6, 7, 8, 10, 12]) {
    const original = probeAttempts[probeIndex];
    for (const change of [{ source_attempt_index_zero_based: 100 }, { expected_verdict: [7, 10, 12].includes(probeIndex) ? "pass" : "reject" },
      { source_kind: "authored_synthetic_control" }]) {
      const label = `paired-${probeIndex}-${Object.keys(change)[0]}`;
      const probe = bound(save(`OFFLINE-${label}-probe.json`, { ...JSON.parse(readFileSync(original.probe.path, "utf8")), ...change }));
      const started = bound(save(`OFFLINE-${label}-started.json`, { ...JSON.parse(readFileSync(original.started.path, "utf8")), review_probe_sha256: probe.sha256 }));
      const request_proof = bound(save(`OFFLINE-${label}-proof.json`, { ...JSON.parse(readFileSync(original.request_proof.path, "utf8")), probe_sha256: probe.sha256 }));
      const quality = JSON.parse(readFileSync(original.qualitative_review.path, "utf8"));
      const entry = { ...original, probe, started, request_proof, qualitative_review: bound(save(`OFFLINE-${label}-quality.json`, {
        ...quality, sources: { ...quality.sources, probe, started, request_proof }
      })) };
      check(() => assert.throws(() => verifyReplayChange(label, { ...replayEvidence,
        delivery_review_probes: { attempts: probeAttempts.map((item, n) => n === probeIndex ? entry : item), prior_attempts: [] } })));
    }
  }
  for (const change of [{ expected_verdict: "pass" }, { source_kind: "preserved_synthetic_replay" }]) {
    const probeIndex = 9, original = probeAttempts[probeIndex], label = `ready-continuation-${Object.keys(change)[0]}`;
    const probe = bound(save(`OFFLINE-${label}-probe.json`, { ...JSON.parse(readFileSync(original.probe.path, "utf8")), ...change }));
    const started = bound(save(`OFFLINE-${label}-started.json`, { ...JSON.parse(readFileSync(original.started.path, "utf8")), review_probe_sha256: probe.sha256 }));
    const request_proof = bound(save(`OFFLINE-${label}-proof.json`, { ...JSON.parse(readFileSync(original.request_proof.path, "utf8")), probe_sha256: probe.sha256 }));
    const quality = JSON.parse(readFileSync(original.qualitative_review.path, "utf8"));
    const entry = { ...original, probe, started, request_proof, qualitative_review: bound(save(`OFFLINE-${label}-quality.json`, {
      ...quality, sources: { ...quality.sources, probe, started, request_proof }
    })) };
    check(() => assert.throws(() => verifyReplayChange(label, { ...replayEvidence,
      delivery_review_probes: { attempts: probeAttempts.map((item, n) => n === probeIndex ? entry : item), prior_attempts: [] } })));
  }
  for (const probeIndex of [10, 12]) for (const mutation of ["disposition", "accepted-text", "review-input"]) {
    const original = probeAttempts[probeIndex], label = `accuracy-${probeIndex}-${mutation}`;
    const calls = JSON.parse(readFileSync(original.probe_sources[0].path, "utf8"));
    if (mutation === "disposition") calls[0].raw_output.provider_execution_audit.attempts[0].accepted = false;
    if (mutation === "accepted-text") calls[0].output_payload.student_visible_message = "Different accepted reply";
    if (mutation === "review-input") calls[0].raw_output.provider_execution_audit.attempts[0].pre_delivery_review.input.draft_message = "Different reviewed reply";
    const sources = [bound(save(`OFFLINE-${label}-calls.json`, calls))];
    const probe = bound(save(`OFFLINE-${label}-probe.json`, { ...JSON.parse(readFileSync(original.probe.path, "utf8")), sources }));
    const started = bound(save(`OFFLINE-${label}-started.json`, { ...JSON.parse(readFileSync(original.started.path, "utf8")), review_probe_sha256: probe.sha256 }));
    const request_proof = bound(save(`OFFLINE-${label}-proof.json`, { ...JSON.parse(readFileSync(original.request_proof.path, "utf8")), probe_sha256: probe.sha256 }));
    const quality = JSON.parse(readFileSync(original.qualitative_review.path, "utf8"));
    const entry = { ...original, probe_sources: sources, probe, started, request_proof,
      qualitative_review: bound(save(`OFFLINE-${label}-quality.json`, { ...quality,
        sources: { ...quality.sources, probe, started, request_proof } })) };
    check(() => assert.throws(() => verifyReplayChange(label, { ...replayEvidence,
      delivery_review_probes: { attempts: probeAttempts.map((item, index) => index === probeIndex ? entry : item), prior_attempts: [] } })));
  }
  const priorProbeId = "repair-replay-OFFLINE-prior-probe";
  const priorProbeRow = { ...transportRow("OFFLINE-PRIOR-PROBE"), request_index: requests.length + 1,
    attempt_id: priorProbeId, case_id: "review_probe_unsupported_pause_agenda" };
  const priorProbe = { ...probeAttempts[0], attempt_id: priorProbeId, reason: "OFFLINE retained qualitative failure, not a selected pass.",
    disposition: "failed", transport_request_indices: [priorProbeRow.request_index],
    started: bound(save("OFFLINE-prior-probe-started.json", { ...JSON.parse(readFileSync(probeAttempts[0].started.path, "utf8")), attempt: priorProbeId })),
    transport_usage: bound(save("OFFLINE-prior-probe-usage.json", { requests: [priorProbeRow] })) };
  const priorProbeQuality = JSON.parse(readFileSync(probeAttempts[0].qualitative_review.path, "utf8"));
  priorProbe.qualitative_review = bound(save("OFFLINE-prior-probe-quality.json", { ...priorProbeQuality,
    attempt_id: priorProbeId, overall_release_accepted: false, discrimination_accepted: false,
    sources: { ...priorProbeQuality.sources, started: priorProbe.started, transport_usage: priorProbe.transport_usage } }));
  const withPriorProbe = { ...replayEvidence, delivery_review_probes: { attempts: probeAttempts, prior_attempts: [priorProbe] } };
  const withPriorTransport = bound(save("OFFLINE-with-prior-probe-transport.json", { version: "ai-session-transport-usage-v1", requests: [...requests, priorProbeRow] }));
  check(() => assert.equal(verify(save("OFFLINE-with-prior-probe-validation.json", { ...validation,
    transport_usage: withPriorTransport, repeated_replay_validation: bound(save("OFFLINE-with-prior-probe-wrapper.json", withPriorProbe))
  })).runtime_candidate_hash, stage.runtime_candidate_hash));
  check(() => assert.throws(() => verify(save("OFFLINE-omitted-prior-probe-validation.json", { ...validation,
    transport_usage: withPriorTransport }))));
  // A succeeded canonical row alone must not bypass the new wire's plan audit.
  // Change only this temporary offline fixture, restore its bytes afterwards.
  const nativePath = artifacts[0].artifact.path;
  const nativeBytes = readFileSync(nativePath);
  try {
    const oldShapeCalls = JSON.parse(nativeBytes.toString("utf8"));
    delete oldShapeCalls[1].raw_output.provider_execution_audit;
    writeFileSync(nativePath, JSON.stringify(oldShapeCalls));
    const oldShapeValidation = { ...validation, journey_runs: [{ ...validation.journey_runs[0],
      agent_calls: artifacts.map((entry, n) => n === 0 ? { ...entry, artifact: bound(nativePath) } : entry) }] };
    check(() => assert.throws(() => verify(save("OFFLINE-native-plan-omitted.json", oldShapeValidation))));
  } finally { writeFileSync(nativePath, nativeBytes); }
  const replayWithoutPlan = replayAttempts[0];
  const originalReplayResult = JSON.parse(readFileSync(replayWithoutPlan.result.path, "utf8"));
  delete originalReplayResult.execution.provider_execution_audit;
  const noPlanResult = bound(save("OFFLINE-replay-result-without-plan.json", originalReplayResult));
  const noPlanReview = JSON.parse(readFileSync(replayWithoutPlan.qualitative_review.path, "utf8"));
  noPlanReview.sources.result = noPlanResult;
  const noPlanReplay = bound(save("OFFLINE-replay-without-plan.json", { ...replayEvidence,
    attempts: replayAttempts.map((entry, n) => n === 0 ? { ...entry, result: noPlanResult,
      qualitative_review: bound(save("OFFLINE-replay-without-plan-review.json", noPlanReview)) } : entry) }));
  check(() => assert.throws(() => verify(save("OFFLINE-replay-plan-omitted-validation.json", {
    ...validation, repeated_replay_validation: noPlanReplay
  }))));
  const failures = [
    { ...validation, version: "luna-medium-profile-fidelity-validation-v1" },
    { ...validation, version: "luna-medium-gpt61-sol-tutor-profile-fidelity-validation-v1" },
    { ...validation, overall_release_accepted: false },
    { ...validation, corrected_source_files_sha256: {} },
    { ...validation, additional_case_evidence: {} },
    { ...validation, repeated_replay_validation: undefined },
    { ...validation, corrected_source_files_sha256: { ...sourceHashes, [LUNA_CONVERSATION_REPAIR_SOURCE_FILES[0]]: "f".repeat(64) } },
    ...["conversation_continuity_accepted", "grounded_completion_accepted", "student_support_quality_accepted"].map(field => ({
      ...validation, case_reviews: validation.case_reviews.map((row, n) => n === 0 ? { ...row, [field]: false } : row)
    }))
  ];
  failures.forEach((value, n) => check(() => assert.throws(() => verify(save(`OFFLINE-invalid-${n}.json`, value)))));
  for (const [index, invalid] of [
    { ...replayEvidence, attempts: replayAttempts.slice(1) },
    { ...replayEvidence, attempts: replayAttempts.map((row, n) => n === 0 ? { ...row, semantic_review: { accepted: false, limitations: [] } } : row) },
    { ...replayEvidence, attempts: replayAttempts.map((row, n) => n === 1 ? { ...row, repeat_index: 1 } : row) },
    { ...replayEvidence, source_files_sha256: {} },
    { ...replayEvidence, runtime_candidate_hash: "f".repeat(64) }
  ].entries()) {
    const badReplay = save(`OFFLINE-bad-replay-${index}.json`, invalid);
    check(() => assert.throws(() => verify(save(`OFFLINE-invalid-replay-validation-${index}.json`, { ...validation, repeated_replay_validation: bound(badReplay) }))));
  }
  const oldManifest = structuredClone(candidate);
  delete oldManifest.configuration_fingerprint.role_version_metadata.formative_conversation_agent.evidence_id_request_schema_version;
  delete oldManifest.configuration_fingerprint.role_version_metadata.student_profiling_agent.evidence_id_request_schema_version;
  delete oldManifest.configuration_fingerprint.deterministic_guard_versions.evidence_id_request_schema;
  delete oldManifest.configuration_fingerprint.role_version_metadata.formative_conversation_agent.private_learning_review_version;
  delete oldManifest.configuration_fingerprint.deterministic_guard_versions.formative_private_learning_review;
  delete oldManifest.configuration_fingerprint.role_version_metadata.formative_conversation_agent.physical_usage_policy_version;
  delete oldManifest.configuration_fingerprint.deterministic_guard_versions.provider_physical_usage;
  oldManifest.configuration_fingerprint.role_version_metadata.formative_conversation_agent.prompt_version = "formative-conversation-host-v7.18";
  oldManifest.configuration_fingerprint.role_version_metadata.formative_conversation_agent.prompt_hash = "9".repeat(64);
  oldManifest.configuration_fingerprint.role_version_metadata.formative_conversation_agent.delivery_review_version = "conversation-delivery-review-v1";
  oldManifest.configuration_fingerprint.role_version_metadata.formative_conversation_agent.delivery_review_prompt_hash = "7".repeat(64);
  oldManifest.configuration_fingerprint.role_version_metadata.formative_conversation_agent.delivery_review_max_output_tokens = 2500;
  const oldRuntime = modelUpgradeCandidateRuntimeHash(oldManifest, APPROVED_OPERATIONAL_ROLE_NAMES);
  const oldSources: Record<string, string> = { ...sourceHashes, [LUNA_CONVERSATION_REPAIR_SOURCE_FILES[0]]: "8".repeat(64) };
  const enumSourcePath = "src/lib/llm/evidence-id-request-schema.ts";
  delete oldSources[enumSourcePath];
  delete oldSources["src/lib/services/student-assessment/formative-conversation/private-learning-review.ts"];
  check(() => assert(sourceHashes[enumSourcePath] && oldSources[enumSourcePath] === undefined));
  const currentMissingEnumSource = { ...sourceHashes }; delete currentMissingEnumSource[enumSourcePath];
  check(() => assert.throws(() => verify(save("OFFLINE-current-enum-source-omitted.json", {
    ...validation, corrected_source_files_sha256: currentMissingEnumSource
  }))));
  const oldManifestRef = bound(save("OFFLINE-historical-candidate-manifest.json", oldManifest));
  const oldRecordRef = bound(save("OFFLINE-historical-candidate-record.json", { version: LUNA_CONVERSATION_REPAIR_CANDIDATE_VERSION,
    active_kind: "local_candidate_evaluation", validation_pending: true, production_activation_permitted: false,
    runtime_candidate_hash: oldRuntime, candidate_manifest: oldManifestRef }));
  const firstReplay = replayAttempts[0];
  const oldAttempt = "repair-replay-OFFLINE-historical-rejected";
  const oldResponse = "OFFLINE-HISTORICAL-REJECTED-REVIEW";
  const oldRequest = { ...requests.at(-1)!, request_index: requests.length + 1, attempt_id: oldAttempt, provider_response_id: oldResponse };
  const cloneBound = (name: string, originalFile: {path: string}, changes: Record<string, unknown>) =>
    bound(save(name, { ...JSON.parse(readFileSync(originalFile.path, "utf8")), ...changes }));
  const scopeOnlyStarted = cloneBound("OFFLINE-scope-only-started.json", priorProbe.started, { runtime_hash: oldRuntime, source_files_sha256: oldSources });
  const scopeOnlyInput = bound(save("OFFLINE-scope-only-input.json", historicalReviewInput));
  const scopeOnlyProof = cloneBound("OFFLINE-scope-only-proof.json", priorProbe.request_proof, {
    runtime_hash: oldRuntime, reviewer_prompt_hash: "7".repeat(64), request_schema_name: "conversation-delivery-review-v1",
    max_output_tokens: 2500, input_sha256: hashJson(historicalReviewInput) });
  const scopeOnlyReview = cloneBound("OFFLINE-scope-only-quality.json", priorProbe.qualitative_review, {
    runtime_hash: oldRuntime, sources: { ...JSON.parse(readFileSync(priorProbe.qualitative_review.path, "utf8")).sources,
      started: scopeOnlyStarted, request_proof: scopeOnlyProof, input: scopeOnlyInput } });
  const scopeOnlyProbe = { ...priorProbe, input: scopeOnlyInput, started: scopeOnlyStarted, request_proof: scopeOnlyProof, qualitative_review: scopeOnlyReview,
    historical_identity: { runtime_candidate_hash: oldRuntime, reviewer_prompt_hash: "7".repeat(64), source_files_sha256: oldSources,
      candidate_manifest: oldManifestRef, candidate_record: oldRecordRef } };
  const verifyScopeHistory = (label: string, entry: unknown) => verify(save(`OFFLINE-${label}-validation.json`, { ...validation,
    transport_usage: withPriorTransport, repeated_replay_validation: bound(save(`OFFLINE-${label}-wrapper.json`, { ...replayEvidence,
      delivery_review_probes: { attempts: probeAttempts, prior_attempts: [entry] } })) }));
  check(() => assert.equal(verifyScopeHistory("scope-only-retained", scopeOnlyProbe).runtime_candidate_hash, stage.runtime_candidate_hash));
  // A preserved V2 accuracy review retains its own manifest identity and raw
  // receipt; it cannot satisfy the selected V4 block-audit requirement.
  const v2Manifest = structuredClone(oldManifest);
  v2Manifest.configuration_fingerprint.role_version_metadata.formative_conversation_agent.delivery_review_version = "conversation-delivery-review-v2";
  const v2Runtime = modelUpgradeCandidateRuntimeHash(v2Manifest, APPROVED_OPERATIONAL_ROLE_NAMES);
  const v2ManifestRef = bound(save("OFFLINE-historical-v2-manifest.json", v2Manifest));
  const v2RecordRef = bound(save("OFFLINE-historical-v2-record.json", { version: LUNA_CONVERSATION_REPAIR_CANDIDATE_VERSION,
    active_kind: "local_candidate_evaluation", validation_pending: true, production_activation_permitted: false,
    runtime_candidate_hash: v2Runtime, candidate_manifest: v2ManifestRef }));
  const v2Started = cloneBound("OFFLINE-historical-v2-started.json", scopeOnlyStarted, { runtime_hash: v2Runtime });
  const v2Proof = cloneBound("OFFLINE-historical-v2-proof.json", scopeOnlyProof, { runtime_hash: v2Runtime, request_schema_name: "conversation-delivery-review-v2" });
  const v2Quality = cloneBound("OFFLINE-historical-v2-quality.json", scopeOnlyReview, { runtime_hash: v2Runtime,
    sources: { ...JSON.parse(readFileSync(scopeOnlyReview.path, "utf8")).sources, started: v2Started, request_proof: v2Proof } });
  const v2Probe = { ...scopeOnlyProbe, started: v2Started, request_proof: v2Proof, qualitative_review: v2Quality,
    historical_identity: { ...scopeOnlyProbe.historical_identity, runtime_candidate_hash: v2Runtime,
      candidate_manifest: v2ManifestRef, candidate_record: v2RecordRef } };
  check(() => assert.equal(verifyScopeHistory("historical-v2-retained", v2Probe).runtime_candidate_hash, stage.runtime_candidate_hash));
  const v3Manifest = structuredClone(oldManifest);
  v3Manifest.configuration_fingerprint.role_version_metadata.formative_conversation_agent.delivery_review_version = "conversation-delivery-review-v3";
  const v3Runtime = modelUpgradeCandidateRuntimeHash(v3Manifest, APPROVED_OPERATIONAL_ROLE_NAMES);
  const v3ManifestRef = bound(save("OFFLINE-historical-v3-manifest.json", v3Manifest));
  const v3RecordRef = bound(save("OFFLINE-historical-v3-record.json", { version: LUNA_CONVERSATION_REPAIR_CANDIDATE_VERSION,
    active_kind: "local_candidate_evaluation", validation_pending: true, production_activation_permitted: false,
    runtime_candidate_hash: v3Runtime, candidate_manifest: v3ManifestRef }));
  const v3Started = cloneBound("OFFLINE-historical-v3-started.json", scopeOnlyStarted, { runtime_hash: v3Runtime });
  const v3Proof = cloneBound("OFFLINE-historical-v3-proof.json", scopeOnlyProof, { runtime_hash: v3Runtime, request_schema_name: "conversation-delivery-review-v3" });
  const v3Quality = cloneBound("OFFLINE-historical-v3-quality.json", scopeOnlyReview, { runtime_hash: v3Runtime,
    sources: { ...JSON.parse(readFileSync(scopeOnlyReview.path, "utf8")).sources, started: v3Started, request_proof: v3Proof } });
  const v3Probe = { ...scopeOnlyProbe, started: v3Started, request_proof: v3Proof, qualitative_review: v3Quality,
    historical_identity: { ...scopeOnlyProbe.historical_identity, runtime_candidate_hash: v3Runtime,
      candidate_manifest: v3ManifestRef, candidate_record: v3RecordRef } };
  check(() => assert.equal(verifyScopeHistory("historical-v3-retained", v3Probe).runtime_candidate_hash, stage.runtime_candidate_hash));
  check(() => assert.throws(() => verifyScopeHistory("historical-v3-extra-blocks-refused", { ...v3Probe,
    input: bound(save("OFFLINE-historical-v3-wrong-input.json", sourceReviewInput)) })));
  check(() => assert.throws(() => verifyScopeHistory("scope-only-relabel-refused", { ...scopeOnlyProbe,
    request_proof: cloneBound("OFFLINE-scope-only-wrong-schema.json", scopeOnlyProof, { request_schema_name: "conversation-delivery-review-v3" }) })));
  const oldStarted = cloneBound("OFFLINE-historical-started.json", firstReplay.started, {
    attempt: oldAttempt, runtime_hash: oldRuntime, source_files_sha256: oldSources });
  const oldProofValue = JSON.parse(readFileSync(firstReplay.request_proof.path, "utf8"));
  const oldProof = cloneBound("OFFLINE-historical-proof.json", firstReplay.request_proof, {
    runtime_hash: oldRuntime, identity: { ...oldProofValue.identity, prompt_version: "formative-conversation-host-v7.18", prompt_hash: "9".repeat(64) } });
  const oldReport = cloneBound("OFFLINE-historical-report.json", firstReplay.report, { runtime_hash: oldRuntime });
  const oldResult = cloneBound("OFFLINE-historical-result.json", firstReplay.result, { execution: { provider_response_id: oldResponse } });
  const oldUsage = bound(save("OFFLINE-historical-usage.json", { version: "ai-session-transport-usage-v1", requests: [oldRequest] }));
  const oldReview = cloneBound("OFFLINE-historical-review.json", firstReplay.qualitative_review, {
    attempt_id: oldAttempt, overall_release_accepted: false, conversation_history_accepted: false,
    sources: { started: oldStarted, request_proof: oldProof, result: oldResult, report: oldReport, transport_usage: oldUsage } });
  const historicalEntry = { fixture_id: firstReplay.fixture_id, attempt_id: oldAttempt, fixture: firstReplay.fixture,
    input_original: firstReplay.input_original, input_effective: firstReplay.input_effective, started: oldStarted,
    request_proof: oldProof, result: oldResult, report: oldReport, qualitative_review: oldReview, transport_usage: oldUsage,
    transport_request_indices: [oldRequest.request_index], reason: "OFFLINE retained prior qualitative failure; never a selected pass.",
    disposition: "qualitative_rejection", historical_identity: { runtime_candidate_hash: oldRuntime, prompt_hash: "9".repeat(64),
      source_files_sha256: oldSources, candidate_manifest: oldManifestRef, candidate_record: oldRecordRef } };
  const historyTransport = bound(save("OFFLINE-transport-with-history.json", { version: "ai-session-transport-usage-v1", requests: [...requests, oldRequest] }));
  const verifyHistory = (name: string, historical: unknown[]) => {
    const replay = bound(save(`${name}-replay.json`, { ...replayEvidence, historical_prior_attempts: historical }));
    return verify(save(`${name}-validation.json`, { ...validation, transport_usage: historyTransport, repeated_replay_validation: replay }));
  };
  check(() => assert.equal(verifyHistory("OFFLINE-valid-history", [historicalEntry]).runtime_candidate_hash, stage.runtime_candidate_hash));
  check(() => assert.throws(() => verifyHistory("OFFLINE-omitted-history", [])));
  check(() => assert.throws(() => verifyHistory("OFFLINE-relabeled-history", [{ ...historicalEntry,
    historical_identity: { ...historicalEntry.historical_identity, runtime_candidate_hash: stage.runtime_candidate_hash } }])));
  check(() => assert.throws(() => verifyHistory("OFFLINE-rewritten-history-sources", [{ ...historicalEntry,
    historical_identity: { ...historicalEntry.historical_identity, source_files_sha256: sourceHashes } }])));
  check(() => assert.throws(() => verifyHistory("OFFLINE-false-mechanical-failure", [{ ...historicalEntry, disposition: "mechanical_failure" }])));
  const relocatedManifest = bound(save("OFFLINE-relocated-historical-manifest.json", oldManifest));
  const relocatedStarted = cloneBound("OFFLINE-relocated-started.json", oldStarted, {});
  const relocatedProof = cloneBound("OFFLINE-relocated-proof.json", oldProof, {});
  const relocatedResult = cloneBound("OFFLINE-relocated-result.json", oldResult, {});
  const relocatedReport = cloneBound("OFFLINE-relocated-report.json", oldReport, {});
  const relocatedUsage = cloneBound("OFFLINE-relocated-usage.json", oldUsage, {});
  check(() => assert.equal(verifyHistory("OFFLINE-relocated-byte-exact-history", [{ ...historicalEntry,
    started: relocatedStarted, request_proof: relocatedProof, result: relocatedResult, report: relocatedReport, transport_usage: relocatedUsage,
    historical_identity: { ...historicalEntry.historical_identity, candidate_manifest: relocatedManifest }
  }]).runtime_candidate_hash, stage.runtime_candidate_hash));
  const originalUsageBytes = readFileSync(oldUsage.path);
  unlinkSync(oldUsage.path);
  try {
    check(() => assert.equal(verifyHistory("OFFLINE-relocated-transport-original-unavailable", [{ ...historicalEntry,
      transport_usage: relocatedUsage
    }]).runtime_candidate_hash, stage.runtime_candidate_hash));
  } finally { writeFileSync(oldUsage.path, originalUsageBytes, { flag: "wx" }); }
  const alteredUsage = cloneBound("OFFLINE-altered-relocated-usage.json", oldUsage, { altered: true });
  check(() => assert.throws(() => verifyHistory("OFFLINE-relocated-transport-review-sha-mismatch", [{ ...historicalEntry,
    transport_usage: alteredUsage
  }])));
  const corruptRecord = cloneBound("OFFLINE-history-record-wrong-manifest-hash.json", oldRecordRef, {
    candidate_manifest: { ...oldManifestRef, sha256: "0".repeat(64) }
  });
  check(() => assert.throws(() => verifyHistory("OFFLINE-relocated-wrong-manifest-binding", [{ ...historicalEntry,
    historical_identity: { ...historicalEntry.historical_identity, candidate_manifest: relocatedManifest, candidate_record: corruptRecord }
  }])));
  const corruptReview = cloneBound("OFFLINE-history-review-wrong-source-hash.json", oldReview, {
    sources: { started: { ...oldStarted, sha256: "0".repeat(64) }, request_proof: oldProof, result: oldResult, report: oldReport, transport_usage: oldUsage }
  });
  check(() => assert.throws(() => verifyHistory("OFFLINE-relocated-wrong-review-binding", [{ ...historicalEntry,
    started: relocatedStarted, qualitative_review: corruptReview
  }])));
  const nativeCase = "student_understood_ready", nativeAttempt = "repair-e2e-OFFLINE-prior-native";
  const nativeRow = { ...transportRow("OFFLINE-HISTORICAL-NATIVE"), request_index: requests.length + 1,
    attempt_id: nativeAttempt, case_id: nativeCase };
  const nativeReport = bound(save("OFFLINE-historical-native-report.json", {
    version: "ai-student-journeys-v3", suite: "conversational-reliability", synthetic_only: true,
    real_student_records_used: false, runtime_hash: oldRuntime, source_commit: "1".repeat(40), source_files_sha256: oldSources,
    student_model: { model_name: "gpt-5.6-luna", reasoning_effort: "medium" }, provider_dispatches: 1,
    provider_models: { "gpt-5.6-luna": 1 }, finished_at: "2026-10-13T00:00:00.000Z",
    results: [{ case_id: nativeCase, outcome: "historical_mechanical_failure" }]
  }));
  const nativeCalls = bound(save("OFFLINE-historical-native-calls.json", [{ agent_name: "formative_conversation_agent",
    provider: "openai", model_name: "gpt-5.6-luna", reasoning_effort: "medium", output_validated: false, call_status: "failed",
    input_tokens: 10, output_tokens: 10, provider_response_id: nativeRow.provider_response_id,
    prompt_hash: "9".repeat(64), schema_version: "formative-conversation-profile-proposal-output-v1" }]));
  const nativeStarted = bound(save("OFFLINE-historical-native-started.json", { attempt_id: nativeAttempt, case_id: nativeCase,
    synthetic_only: true, real_student_records_used: false, runtime_hash: oldRuntime, source_files_sha256: oldSources }));
  const nativeUsage = bound(save("OFFLINE-historical-native-usage.json", { version: "ai-session-transport-usage-v1", requests: [nativeRow] }));
  const nativeQuality = bound(save("OFFLINE-historical-native-quality.json", { attempt_id: nativeAttempt, case_id: nativeCase,
    runtime_hash: oldRuntime, review_complete: true, synthetic_only: true, overall_release_accepted: false,
    sources: { report: nativeReport, agent_calls: nativeCalls, started: nativeStarted, transport_usage: nativeUsage } }));
  const nativeHistory = { attempt_id: nativeAttempt, case_id: nativeCase, report: nativeReport, agent_calls: nativeCalls,
    started: nativeStarted, transport_usage: nativeUsage, qualitative_review: nativeQuality,
    transport_request_indices: [nativeRow.request_index], reason: "OFFLINE preserved previous candidate failure, not current acceptance.",
    disposition: "mechanical_failure", historical_identity: { runtime_candidate_hash: oldRuntime,
      source_files_sha256: oldSources, candidate_manifest: oldManifestRef, candidate_record: oldRecordRef } };
  const nativeShared = bound(save("OFFLINE-shared-with-native-history.json", { version: "ai-session-transport-usage-v1", requests: [...requests, nativeRow] }));
  const verifyNativeHistory = (name: string, entries: unknown[]) => verify(save(`${name}.json`, {
    ...validation, historical_native_attempts: entries, transport_usage: nativeShared
  }));
  check(() => assert.equal(verifyNativeHistory("OFFLINE-native-history-valid", [nativeHistory]).runtime_candidate_hash, stage.runtime_candidate_hash));
  const physicalInventoryPath = "src/lib/llm/provider-transport-retry.ts";
  const beforePhysicalReport = JSON.parse(readFileSync(nativeReport.path, "utf8"));
  delete beforePhysicalReport.source_files_sha256[physicalInventoryPath];
  const beforePhysicalRef = bound(save("OFFLINE-native-before-physical-inventory.json", beforePhysicalReport));
  const beforePhysicalReview = cloneBound("OFFLINE-native-before-physical-review.json", nativeQuality,
    { sources: { ...JSON.parse(readFileSync(nativeQuality.path, "utf8")).sources, report: beforePhysicalRef } });
  check(() => assert.equal(verifyNativeHistory("OFFLINE-native-old-physical-omission", [{ ...nativeHistory,
    report: beforePhysicalRef, qualitative_review: beforePhysicalReview }]).runtime_candidate_hash, stage.runtime_candidate_hash));
  const missingStartedSources: Record<string, string> = { ...oldSources }; delete missingStartedSources[physicalInventoryPath];
  check(() => assert.throws(() => verifyNativeHistory("OFFLINE-native-old-physical-started-missing", [{ ...nativeHistory,
    report: beforePhysicalRef, qualitative_review: beforePhysicalReview,
    started: cloneBound("OFFLINE-native-old-physical-missing-started.json", nativeStarted, { source_files_sha256: missingStartedSources }) }])));
  const wrongPhysicalReport = bound(save("OFFLINE-native-wrong-physical-inventory.json", { ...beforePhysicalReport,
    source_files_sha256: { ...beforePhysicalReport.source_files_sha256, [physicalInventoryPath]: "f".repeat(64) } }));
  const wrongPhysicalReview = cloneBound("OFFLINE-native-wrong-physical-review.json", nativeQuality,
    { sources: { ...JSON.parse(readFileSync(nativeQuality.path, "utf8")).sources, report: wrongPhysicalReport } });
  check(() => assert.throws(() => verifyNativeHistory("OFFLINE-native-old-physical-wrong-present", [{ ...nativeHistory,
    report: wrongPhysicalReport, qualitative_review: wrongPhysicalReview }])));
  const finishInventoryPath = "src/lib/services/student-assessment/formative-conversation/finish-assessment.ts";
  const oldReportValue = JSON.parse(readFileSync(nativeReport.path, "utf8"));
  delete oldReportValue.source_files_sha256[finishInventoryPath];
  const oldReportWithoutNewInventory = bound(save("OFFLINE-old-native-before-finish-inventory.json", oldReportValue));
  const reviewBeforeInventory = cloneBound("OFFLINE-old-native-before-finish-inventory-review.json", nativeQuality,
    { sources: { ...JSON.parse(readFileSync(nativeQuality.path, "utf8")).sources, report: oldReportWithoutNewInventory } });
  check(() => assert.equal(verifyNativeHistory("OFFLINE-old-native-omitted-new-inventory-accepted", [{ ...nativeHistory,
    report: oldReportWithoutNewInventory, qualitative_review: reviewBeforeInventory }]).runtime_candidate_hash, stage.runtime_candidate_hash));
  const wrongPresentInventory = bound(save("OFFLINE-old-native-wrong-present-inventory.json", { ...oldReportValue,
    source_files_sha256: { ...oldReportValue.source_files_sha256, [finishInventoryPath]: "f".repeat(64) } }));
  const wrongPresentReview = cloneBound("OFFLINE-old-native-wrong-present-review.json", nativeQuality,
    { sources: { ...JSON.parse(readFileSync(nativeQuality.path, "utf8")).sources, report: wrongPresentInventory } });
  check(() => assert.throws(() => verifyNativeHistory("OFFLINE-old-native-wrong-present-rejected", [{ ...nativeHistory,
    report: wrongPresentInventory, qualitative_review: wrongPresentReview }])));
  check(() => assert.throws(() => verifyNativeHistory("OFFLINE-native-history-omitted", [])));
  check(() => assert.throws(() => verifyNativeHistory("OFFLINE-native-history-duplicate", [nativeHistory, nativeHistory])));
  check(() => assert.throws(() => verifyNativeHistory("OFFLINE-native-history-relabeled", [{ ...nativeHistory,
    historical_identity: { ...nativeHistory.historical_identity, runtime_candidate_hash: stage.runtime_candidate_hash } }])));
  check(() => assert.throws(() => verifyNativeHistory("OFFLINE-native-history-source-forged", [{ ...nativeHistory,
    historical_identity: { ...nativeHistory.historical_identity, source_files_sha256: sourceHashes } }])));
  check(() => assert.throws(() => verifyNativeHistory("OFFLINE-native-history-wrong-attempt", [{ ...nativeHistory, attempt_id: "repair-e2e-wrong" }])));
  check(() => assert.throws(() => verifyNativeHistory("OFFLINE-native-history-false-usage", [{ ...nativeHistory, transport_request_indices: [] }])));
  const nativeRelocated = cloneBound("OFFLINE-historical-native-relocated-report.json", nativeReport, {});
  check(() => assert.equal(verifyNativeHistory("OFFLINE-native-history-relocation", [{ ...nativeHistory, report: nativeRelocated,
    historical_identity: { ...nativeHistory.historical_identity, candidate_manifest: relocatedManifest } }]).runtime_candidate_hash, stage.runtime_candidate_hash));
  check(() => assert.throws(() => verifyNativeHistory("OFFLINE-native-history-bad-manifest", [{ ...nativeHistory,
    historical_identity: { ...nativeHistory.historical_identity, candidate_record: corruptRecord } }])));
  const missingIdentityRows = JSON.parse(readFileSync(nativeCalls.path, "utf8"));
  delete missingIdentityRows[0].prompt_hash; delete missingIdentityRows[0].schema_version;
  const missingIdentityCalls = bound(save("OFFLINE-native-history-missing-row-identity.json", missingIdentityRows));
  const nativeQualityValue = JSON.parse(readFileSync(nativeQuality.path, "utf8"));
  const missingIdentityReview = bound(save("OFFLINE-native-history-missing-row-identity-review.json", {
    ...nativeQualityValue, sources: { ...nativeQualityValue.sources, agent_calls: missingIdentityCalls }
  }));
  check(() => assert.equal(verifyNativeHistory("OFFLINE-native-history-honest-absent-fields", [{ ...nativeHistory,
    agent_calls: missingIdentityCalls, qualitative_review: missingIdentityReview }]).runtime_candidate_hash, stage.runtime_candidate_hash));
  const wrongIdentityCalls = bound(save("OFFLINE-native-history-wrong-row-identity.json", [{ ...missingIdentityRows[0], prompt_hash: "0".repeat(64) }]));
  const wrongIdentityReview = bound(save("OFFLINE-native-history-wrong-row-identity-review.json", {
    ...nativeQualityValue, sources: { ...nativeQualityValue.sources, agent_calls: wrongIdentityCalls }
  }));
  check(() => assert.throws(() => verifyNativeHistory("OFFLINE-native-history-reject-present-wrong-identity", [{ ...nativeHistory,
    agent_calls: wrongIdentityCalls, qualitative_review: wrongIdentityReview }])));
  check(() => assert.equal(MIXED_DELIVERY_REVIEW_PROBES.length, 27));
  check(() => assert(!MIXED_DELIVERY_REVIEW_PROBES.some(id => String(id) === "repeated_offset_clock_inconsistency")));
  check(() => assert(MIXED_DELIVERY_REVIEW_PROBES.includes("clock_analogy_inconsistency")));
  for (const id of ["explicit_stopped_clock_offset_error", "explicit_moving_clock_offset_control",
    "truthful_initial_reason_attribution", "contradictory_initial_reason_attribution",
    "unsupported_assisted_understanding_summary", "qualified_assisted_recap", "new_reasoning_beyond_supplied_example",
    "unsupported_assisted_profile_update", "recognition_without_profile_update", "new_supported_reasoning_profile_update"] as const) {
    check(() => assert(MIXED_DELIVERY_REVIEW_PROBES.includes(id)));
  }
  const mixedProbeEntries = MIXED_DELIVERY_REVIEW_PROBES.map(probe_id => ({ ...probeAttempts[0], probe_id }));
  const mixedProbeSchema = MixedConversationReplayValidationSchema.shape.delivery_review_probes;
  check(() => assert(mixedProbeSchema.safeParse({ attempts: mixedProbeEntries, prior_attempts: [] }).success));
  check(() => assert(!mixedProbeSchema.safeParse({ attempts: mixedProbeEntries.slice(1), prior_attempts: [] }).success));
  check(() => assert(!MixedConversationReplayValidationSchema.safeParse({ ...replayEvidence,
    version: "conversation-reliability-sol-review-replay-validation-v1", delivery_review_probes: {
      attempts: mixedProbeEntries, prior_attempts: [] } }).success));
  check(() => assert.throws(() => verifyLunaValidation(bound(validationPath), stage.runtime_candidate_hash, "medium", "profile-fidelity-v1")));
  const prepared = prepareLunaAllRolesAmendment({ ...scope, parent, expectedParentHash: parentHash,
    validationEvidencePath: validationPath, outputDirectory: path.join(directory, "offline-approval"), authorizationReference: "OFFLINE-ONLY" });
  check(() => assert.equal(prepared.evidence.approval_command_version, LUNA_CONVERSATION_REPAIR_AMENDMENT_VERSION));
  check(() => assert.equal(prepared.evidence.human_review.semantic_review_confirmed, false));
  check(() => assert.deepEqual(verifyApprovedCandidateArtifacts({ approvedManifestPath: prepared.manifestPath,
    approvalEvidencePath: prepared.evidencePath, expectedRuntimeHash: stage.runtime_candidate_hash,
    expectedEvaluationProtocolHash: prepared.evidence.evaluation_protocol_hash,
    expectedApprovalEvidenceHash: prepared.evidence.approval_evidence_hash }).manifest, candidate));
  check(() => assert.equal(hashFile(historicalPath), historicalHash));
  check(() => assert.equal(hashFile(parentManifestPath), preservedParentManifestHash));
  console.log(JSON.stringify({ checks, status: "passed", provider_calls: 0,
    scope: "Offline fixtures exercise exact candidate/approval and historical-version isolation only." }, null, 2));
} finally {
  const resolved = path.resolve(directory);
  assert.equal(path.dirname(resolved), path.resolve(tmpdir()));
  assert(path.basename(resolved).startsWith("luna-conversation-approval-offline-"));
  rmSync(resolved, { recursive: true, force: true });
}
