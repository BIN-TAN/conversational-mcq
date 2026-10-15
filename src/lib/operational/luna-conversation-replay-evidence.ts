import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { zodTextFormat } from "openai/helpers/zod";
import { evidenceIdRequestSchema } from "../llm/evidence-id-request-schema";
import { CanonicalEligibleEvidenceCatalogSchema } from "../domain/canonical-evidence-identity";
import { FormativeConversationPlannedProposalOutputSchema, FORMATIVE_PROFILE_UPDATE_WIRE_SCHEMA_VERSION,
  reconstructFormativeProfileProposal } from "../services/student-assessment/formative-conversation/profile-update-proposal";
import { prepareFormativeInterpretationResult, validateFormativeInterpretation } from "../services/student-assessment/formative-conversation/interpretation-policy";
import { APPROVED_OPERATIONAL_ROLE_NAMES, ApprovedCandidateManifestSchema } from "./active-approval-bundle";
import { modelUpgradeCandidateRuntimeHash } from "./model-upgrade-candidate-identity";
import { stableHash } from "./stable-hash";
import { ConversationContinuitySchema, ConversationReviewSchema, ConversationPreReplyPlanSchema, ConversationDeliveryReviewInputV1Schema, ConversationDeliveryReviewInputV4Schema, ConversationDeliveryReviewSchema,
  buildConversationDeliveryDraftBlocks, buildConversationDeliveryReviewInput, buildConversationDeliveryReviewInputV6,
  validateConversationDeliveryReview, CONVERSATION_CURRENT_REPLY_SOURCE_VERSION,
  CONVERSATION_SUPPORT_PREFERENCE_LINK_VERSION, CONVERSATION_PRIOR_TUTOR_SOURCE_VERSION,
  CONVERSATION_STORED_PREFERENCE_TRANSITION_VERSION, CONVERSATION_STORED_PREFERENCE_RETENTION_VERSION,
  CONVERSATION_PRE_REPLY_PLAN_VERSION, CONVERSATION_CURRENT_SOURCE_ACTIVATION_PROJECTION_VERSION,
  conversationCurrentReplySourceHash, projectConversationContinuityWire } from "../services/student-assessment/formative-conversation/conversation-continuity";
import { FormativeConversationDeliveryReviewAuditSchema, FORMATIVE_CONVERSATION_DELIVERY_REVIEW_ACCOUNTING_VERSION, ProviderPhysicalUsageAuditSchema } from "../services/student-assessment/formative-conversation/execution-v18r2";
import { FormativeConversationV18R2AgentInputSchema, FormativeConversationV18R2AgentOutputSchema, type FormativeConversationV18R2AgentInput,
  type FormativeConversationV18R2AgentOutput } from "../services/student-assessment/formative-conversation/agent-contract-v18r2";
import { LUNA_CONVERSATION_DELIVERY_REVIEW_PROMPT_HASH, LUNA_CONVERSATION_DELIVERY_REVIEW_VERSION,
  LUNA_CONVERSATION_DELIVERY_REVIEW_MAX_OUTPUT_TOKENS,
  LUNA_SOL_DELIVERY_REVIEW_MODEL, LUNA_SOL_DELIVERY_REVIEW_POLICY_VERSION,
  LUNA_SOL_DELIVERY_REVIEW_CANDIDATE_VERSION } from "./luna-conversation-repair-identity";

export const CONVERSATION_REPLAY_FIXTURES = ["deferred_topic_reopened", "closing_false_history",
  "pause_return_false_history", "retained_profile_echo"] as const;
export const PRIVATE_LEARNING_REVIEW_PROBES = ["unsupported_assisted_profile_update",
  "recognition_without_profile_update", "new_supported_reasoning_profile_update"] as const;
export const CONVERSATION_DELIVERY_REVIEW_PROBES = ["unsupported_pause_agenda", "respected_deferral", "honest_student_stop",
  "requested_new_explanation", "explicit_deferral_release", "requested_whole_assessment_overview",
  "accurate_closing_recap", "unsolicited_teaching_after_stop", "source_compatible_pause_summary",
  "ready_to_continue_misattributed_as_finish", "constant_score_reliability_error", "valid_constant_score_limitation",
  "clock_analogy_inconsistency", "valid_offset_clock_analogy",
  "repeated_constant_score_reliability_error", "valid_repeated_constant_score_limitation",
  "repeated_offset_clock_inconsistency", "valid_repeated_offset_clock_analogy"] as const;
export const MIXED_DELIVERY_REVIEW_PROBES = [...CONVERSATION_DELIVERY_REVIEW_PROBES.filter(id => id !== "repeated_offset_clock_inconsistency"),
  "explicit_stopped_clock_offset_error", "explicit_moving_clock_offset_control",
  "truthful_initial_reason_attribution", "contradictory_initial_reason_attribution",
  "unsupported_assisted_understanding_summary", "qualified_assisted_recap", "new_reasoning_beyond_supplied_example",
  ...PRIVATE_LEARNING_REVIEW_PROBES] as const;
const allProbeIds = [...CONVERSATION_DELIVERY_REVIEW_PROBES, "explicit_stopped_clock_offset_error", "explicit_moving_clock_offset_control",
  "truthful_initial_reason_attribution", "contradictory_initial_reason_attribution",
  "unsupported_assisted_understanding_summary", "qualified_assisted_recap", "new_reasoning_beyond_supplied_example",
  ...PRIVATE_LEARNING_REVIEW_PROBES] as const;
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const file = z.object({ path: z.string().min(1), sha256: digest }).strict();
const attempt = z.object({
  fixture_id: z.enum(CONVERSATION_REPLAY_FIXTURES), attempt_id: z.string().regex(/^repair-replay-/),
  fixture: file, started: file, request_proof: file, input_original: file, input_effective: file,
  result: file, report: file, transport_usage: file, transport_request_indices: z.array(z.number().int().positive()).min(1)
}).strict();
const probeAttempt = z.object({
  probe_id: z.enum(CONVERSATION_DELIVERY_REVIEW_PROBES), attempt_id: z.string().regex(/^repair-replay-/),
  fixture: file, probe: file, probe_sources: z.array(file), started: file, request_proof: file, input: file,
  result: file, report: file, transport_usage: file, qualitative_review: file,
  transport_request_indices: z.array(z.number().int().positive()).min(1)
}).strict();
export const ConversationReplayValidationSchema = z.object({
  version: z.literal("conversation-reliability-repeated-replay-validation-v1"),
  synthetic_only: z.literal(true), real_student_data_used: z.literal(false),
  runtime_candidate_hash: digest, source_files_sha256: z.record(digest), all_attempts_included: z.literal(true),
  attempts: z.array(attempt.extend({ repeat_index: z.number().int().min(1).max(3), qualitative_review: file,
    semantic_review: z.object({ accepted: z.literal(true), limitations: z.array(z.string().min(1)) }).strict()
  }).strict()).length(12),
  prior_attempts: z.array(attempt.extend({ reason: z.string().min(1) }).strict()),
  // Historical attempts cannot satisfy selected repetitions. Preserve their
  // actual candidate/source identities and rejected review instead of relabeling
  // old paid results as a later prospective candidate.
  historical_prior_attempts: z.array(attempt.extend({
    reason: z.string().min(1), disposition: z.enum(["mechanical_failure", "qualitative_rejection", "superseded"]),
    qualitative_review: file,
    historical_identity: z.object({ runtime_candidate_hash: digest, prompt_hash: digest,
      source_files_sha256: z.record(digest), candidate_manifest: file, candidate_record: file }).strict()
  }).strict()),
  // Reviewer discrimination probes are not tutor deliveries. In particular the
  // preserved bad reply must be rejected, not relabeled as an accepted tutor.
  delivery_review_probes: z.object({
    attempts: z.array(probeAttempt).length(CONVERSATION_DELIVERY_REVIEW_PROBES.length),
    prior_attempts: z.array(probeAttempt.extend({ reason: z.string().min(1),
      disposition: z.enum(["failed", "superseded"]),
      historical_identity: z.object({ runtime_candidate_hash: digest, reviewer_prompt_hash: digest,
        source_files_sha256: z.record(digest), candidate_manifest: file, candidate_record: file }).strict().optional()
    }).strict())
  }).strict()
}).strict();

export const MixedConversationReplayValidationSchema = ConversationReplayValidationSchema.extend({
  version: z.literal("conversation-reliability-sol-review-replay-validation-v1"),
  delivery_review_probes: z.object({
    attempts: z.array(probeAttempt.extend({ probe_id: z.enum(allProbeIds) })).length(MIXED_DELIVERY_REVIEW_PROBES.length),
    prior_attempts: z.array(ConversationReplayValidationSchema.shape.delivery_review_probes.shape.prior_attempts.element.extend({ probe_id: z.enum(allProbeIds) }))
  }).strict(),
  historical_diagnostics: z.array(z.object({
    attempt_id: z.string().regex(/^repair-reviewdiag-sol-v4-/), probe_id: z.enum(allProbeIds),
    diagnostic_only: z.literal(true), candidate_validation_eligible: z.literal(false),
    probe: file, started: file, request_proof: file, input: file, result: file, report: file,
    qualitative_review: file, transport_usage: file,
    transport_request_indices: z.array(z.number().int().positive()).min(1),
    historical_identity: z.object({ runtime_candidate_hash: digest, source_files_sha256: z.record(digest),
      candidate_manifest: file, candidate_record: file, model_extension: file }).strict()
  }).strict()).min(5),
  historical_clarity_adjudication: z.object({ record: file, sources: z.record(file) }).strict()
}).strict();

type TransportRow = { request_index: number; attempt_id?: unknown; category: string; model_name: string;
  agent_name?: string | null; status: string; provider_response_id: string | null; usage?: unknown; execution_policy_version?: unknown; execution_purpose?: unknown;
  diagnostic_only?: unknown; candidate_validation_eligible?: unknown; diagnostic_model_extension_sha256?: unknown;
  request_format_sha256?: unknown };

// Historical sidecars have no format hash. Only selected current tutor calls
// require the actual dispatched format, independently of the canonical request
// hash (which intentionally retains its existing, schema-name-only policy).
export function selectedConversationRequestFormatSha256(inputValue: unknown) {
  const input = z.record(z.unknown()).parse(inputValue);
  const catalog = CanonicalEligibleEvidenceCatalogSchema.parse(input.allowed_evidence_catalog);
  const schema = evidenceIdRequestSchema(FormativeConversationPlannedProposalOutputSchema,
    catalog.evidence.map(entry => entry.evidence_id), FORMATIVE_PROFILE_UPDATE_WIRE_SCHEMA_VERSION);
  return createHash("sha256").update(JSON.stringify(zodTextFormat(schema, FORMATIVE_PROFILE_UPDATE_WIRE_SCHEMA_VERSION))).digest("hex");
}

export function historicalConversationRequiredSources(manifest: z.infer<typeof ApprovedCandidateManifestSchema>,
  sources: Record<string, string>, required: readonly string[]) {
  const fingerprint = manifest.configuration_fingerprint;
  const predatesEnums = fingerprint.role_version_metadata.formative_conversation_agent.evidence_id_request_schema_version === undefined &&
    fingerprint.role_version_metadata.student_profiling_agent.evidence_id_request_schema_version === undefined &&
    fingerprint.deterministic_guard_versions.evidence_id_request_schema === undefined;
  const tutor = fingerprint.role_version_metadata.formative_conversation_agent;
  const predatesPrivateReview = typeof tutor.delivery_review_version === "string" && /^conversation-delivery-review-v[1-6]$/.test(tutor.delivery_review_version) &&
    tutor.private_learning_review_version === undefined && fingerprint.deterministic_guard_versions.formative_private_learning_review === undefined;
  return required.filter(file => !(
    sources[file] === undefined && ((predatesEnums && file === "src/lib/llm/evidence-id-request-schema.ts") ||
      (predatesPrivateReview && file === "src/lib/services/student-assessment/formative-conversation/private-learning-review.ts"))
  ));
}

export function verifyMixedReviewTransport(row: TransportRow) {
  if (row.model_name !== LUNA_SOL_DELIVERY_REVIEW_MODEL || row.agent_name !== "formative_conversation_agent" ||
      row.category !== "application" || row.execution_policy_version !== LUNA_SOL_DELIVERY_REVIEW_POLICY_VERSION ||
      row.execution_purpose !== "conversation_delivery_review" || row.diagnostic_only !== false ||
      row.candidate_validation_eligible !== true) throw new Error("Selected Sol transport is not the approved delivery-review policy.");
}
const nativeObject = z.record(z.unknown());
function readValue(reference: z.infer<typeof file>): unknown {
  if (!path.isAbsolute(reference.path)) throw new Error("Replay evidence paths must be absolute.");
  const bytes = readFileSync(reference.path);
  if (createHash("sha256").update(bytes).digest("hex") !== reference.sha256) throw new Error("Replay evidence integrity mismatch.");
  return JSON.parse(bytes.toString("utf8"));
}
const read = (reference: z.infer<typeof file>) => nativeObject.parse(readValue(reference));
const hashObject = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

export function buildBoundDeliveryProbeInput(probeValue: unknown, preserved: unknown[], reviewerVersion: string) {
  const probe = nativeObject.parse(probeValue);
  const expectedSourceKind = z.enum(["preserved_synthetic_replay", "preserved_synthetic_replay_draft", "preserved_synthetic_native", "authored_synthetic_control"]).parse(probe.source_kind);
  if ((PRIVATE_LEARNING_REVIEW_PROBES as readonly string[]).includes(String(probe.id))) {
    const fixture = nativeObject.parse(preserved[1]);
    const declaredSources = z.array(file).length(2).parse(probe.sources);
    const original = probe.id === "unsupported_assisted_profile_update";
    if (preserved.length !== 2 || !["conversation-delivery-review-v7", "conversation-delivery-review-v8"].includes(reviewerVersion) ||
        stableHash(fixture) !== "4f467cadd9071fa90291b05adbad617bc0c14bba368322726c6391e81373a77e" ||
        fixture.synthetic_only !== true || fixture.real_student_records_used !== false ||
        probe.private_learning_control_id !== probe.id ||
        probe.context_source_agent_call_index_zero_based !== fixture.call_index_zero_based ||
        probe.source_agent_call_index_zero_based !== undefined || probe.source_attempt_index_zero_based !== undefined ||
        expectedSourceKind !== (original ? "preserved_synthetic_native" : "authored_synthetic_control") ||
        file.parse(fixture.source).sha256 !== declaredSources[0].sha256) {
      throw new Error("Private learning probe lacks its exact synthetic fixture and native provenance.");
    }
    const call = z.array(nativeObject).parse(preserved[0])[z.number().int().nonnegative().parse(fixture.call_index_zero_based)];
    if (!call || call.agent_name !== "formative_conversation_agent" || call.provider !== "openai" ||
        call.call_status !== "succeeded" || call.output_validated !== true ||
        !isDeepStrictEqual(call.input_payload, fixture.context) || !isDeepStrictEqual(call.output_payload, fixture.output)) {
      throw new Error("Private learning probe does not bind the original persisted synthetic candidate.");
    }
    const control = z.array(nativeObject).parse(fixture.controls).find(item => item.id === probe.id);
    if (!control || control.authored_synthetic !== !original || control.expected_verdict !== (original ? "reject" : "pass")) {
      throw new Error("Private learning probe has no matching declared control.");
    }
    const context = nativeObject.parse(control.context) as unknown as FormativeConversationV18R2AgentInput;
    const candidate = FormativeConversationV18R2AgentOutputSchema.parse(control.candidate);
    if ((original && (!isDeepStrictEqual(control.context, fixture.context) || !isDeepStrictEqual(control.candidate, fixture.output))) ||
        probe.draft_message !== candidate.student_visible_message ||
        !isDeepStrictEqual(probe.visible_transcript, context.visible_transcript) || probe.latest_student_message !== context.latest_student_message) {
      throw new Error("Private learning probe changes its declared candidate or student evidence.");
    }
    return { input: buildConversationDeliveryReviewInput(context, candidate.student_visible_message, candidate), context, candidate };
  }
  const previouslyAcceptedNative = ["constant_score_reliability_error", "clock_analogy_inconsistency",
    "repeated_constant_score_reliability_error", "repeated_offset_clock_inconsistency",
    "unsupported_assisted_understanding_summary"].includes(String(probe.id));
  const authoredAssistanceControl = ["qualified_assisted_recap", "new_reasoning_beyond_supplied_example"].includes(String(probe.id));
  let baselineContext: Record<string, unknown> = { administered_items: [], assessment_response_evidence: [] };
  if (["preserved_synthetic_replay", "preserved_synthetic_replay_draft"].includes(expectedSourceKind)) {
    baselineContext = nativeObject.parse(preserved[0]);
  } else if (expectedSourceKind === "preserved_synthetic_native") {
    const sourceCall = z.array(nativeObject).parse(preserved[0])[z.number().int().nonnegative().parse(probe.source_agent_call_index_zero_based)];
    baselineContext = nativeObject.parse(sourceCall?.input_payload);
  } else if (authoredAssistanceControl) {
    const fixture = nativeObject.parse(preserved[1]);
    // Pin the declared authored fixture's values, independent of JSON formatting/key order.
    // The original native source still has its own exact byte SHA and is never rewritten.
    if (preserved.length !== 2 || stableHash(fixture) !== "9b0a099e762eacb6a5561dcb873f810c4ad42dcce3baa000ccff8028f0e5a335" ||
        expectedSourceKind !== "authored_synthetic_control" || probe.context_source_kind !== "preserved_synthetic_native" ||
        probe.authored_from_native_control_id !== "unsupported_assisted_understanding_summary" ||
        probe.authored_control_fixture_key !== probe.id || probe.source_attempt_index_zero_based !== undefined ||
        probe.source_agent_call_index_zero_based !== undefined ||
        probe.context_source_agent_call_index_zero_based !== fixture.source_agent_call_index_zero_based ||
        z.array(file).parse(probe.sources).length !== 2 ||
        file.parse(nativeObject.parse(fixture.source)).sha256 !== file.parse(z.array(file).parse(probe.sources)[0]).sha256) {
      throw new Error("Authored assistance control lacks the exact declared fixture and native context provenance.");
    }
    const sourceCall = z.array(nativeObject).parse(preserved[0])[z.number().int().nonnegative().parse(probe.context_source_agent_call_index_zero_based)];
    if (sourceCall?.agent_name !== "formative_conversation_agent" || sourceCall.provider !== "openai" || sourceCall.call_status !== "succeeded" ||
        sourceCall.output_validated !== true || !isDeepStrictEqual(sourceCall.input_payload, fixture.context) ||
        !isDeepStrictEqual(sourceCall.output_payload, fixture.output)) {
      throw new Error("Authored assistance control does not bind its exact originally delivered native context/output.");
    }
    const control = z.array(nativeObject).parse(fixture.controls).find(entry => entry.id === probe.authored_control_fixture_key);
    if (!control || control.authored_synthetic !== true || control.expected_verdict !== "pass" || control.draft_message !== probe.draft_message) {
      throw new Error("Authored assistance control differs from its explicit fixture draft.");
    }
    baselineContext = structuredClone(nativeObject.parse(sourceCall.input_payload));
    if (control.replacement_latest_student_message !== undefined) {
      const replacement = z.string().min(1).parse(control.replacement_latest_student_message);
      const transcript = z.array(nativeObject).parse(baselineContext.visible_transcript);
      const latest = transcript.at(-1);
      if (!latest || latest.actor !== "student" || latest.message_text !== baselineContext.latest_student_message) {
        throw new Error("Authored assistance control has no exact latest student turn to replace.");
      }
      latest.message_text = replacement;
      baselineContext.visible_transcript = transcript;
      baselineContext.latest_student_message = replacement;
    }
  } else if (probe.id === "contradictory_initial_reason_attribution") {
    if (preserved.length !== 1 || probe.context_source_kind !== "preserved_synthetic_native" ||
        probe.authored_from_native_control_id !== "truthful_initial_reason_attribution" || probe.source_attempt_index_zero_based !== undefined) {
      throw new Error("Authored baseline-attribution control lacks explicit native context-only provenance.");
    }
    const sourceCall = z.array(nativeObject).parse(preserved[0])[z.number().int().nonnegative().parse(probe.context_source_agent_call_index_zero_based)];
    if (sourceCall?.agent_name !== "formative_conversation_agent" || sourceCall.provider !== "openai") throw new Error("Authored baseline control selects no native tutor context.");
    baselineContext = nativeObject.parse(sourceCall.input_payload);
    const sourceDraft = nativeObject.parse(nativeObject.parse(z.array(nativeObject).parse(nativeObject.parse(nativeObject.parse(sourceCall.raw_output).provider_execution_audit).attempts)[0].invalid_candidate).candidate_json).student_visible_message;
    if (sourceDraft === probe.draft_message) throw new Error("Authored contradictory control cannot relabel the unchanged truthful draft.");
  }
  const probeContext = { ...baselineContext, visible_transcript: probe.visible_transcript,
    latest_student_message: probe.latest_student_message } as unknown as FormativeConversationV18R2AgentInput;
  const expectedInput = deliveryReviewInputForVersion(probeContext, z.string().min(1).parse(probe.draft_message), reviewerVersion);
  if (expectedSourceKind === "preserved_synthetic_replay") {
    const preservedDraft = preserved.length === 2
      ? nativeObject.parse(nativeObject.parse(nativeObject.parse(preserved[1]).execution).output).student_visible_message : null;
    // Native transcript rows retain timestamps and other audit fields. Compare
    // the same exact source-only projection used by the real review request.
    if (preserved.length !== 2 || preservedDraft !== probe.draft_message ||
        hashObject(deliveryReviewInputForVersion(preserved[0] as unknown as FormativeConversationV18R2AgentInput,
          z.string().parse(preservedDraft), reviewerVersion)) !== hashObject(expectedInput)) {
      throw new Error("Reviewer-probe draft/history differ from the exact preserved synthetic replay.");
    }
  } else if (expectedSourceKind === "preserved_synthetic_native" || expectedSourceKind === "preserved_synthetic_replay_draft") {
    const attemptIndex = z.number().int().nonnegative().parse(probe.source_attempt_index_zero_based);
    let sourceInput: unknown, sourceAudit: unknown, sourceOutput: unknown, sourceCallStatus: unknown;
    if (expectedSourceKind === "preserved_synthetic_native") {
      if (preserved.length !== 1) throw new Error("Native reviewer probe requires the exact original AgentCall file.");
      const callIndex = z.number().int().nonnegative().parse(probe.source_agent_call_index_zero_based);
      const call = z.array(nativeObject).parse(preserved[0])[callIndex];
      if (!call || call.agent_name !== "formative_conversation_agent" || call.provider !== "openai") {
        throw new Error("Native reviewer probe selects no actual formative tutor call.");
      }
      sourceInput = call.input_payload;
      sourceAudit = nativeObject.parse(call.raw_output).provider_execution_audit;
      sourceOutput = call.output_payload;
      sourceCallStatus = call.call_status;
    } else {
      if (preserved.length !== 2) throw new Error("Draft reviewer probe requires exact input and result files.");
      sourceInput = preserved[0];
      sourceAudit = nativeObject.parse(nativeObject.parse(preserved[1]).execution).provider_execution_audit;
    }
    const draftAttempt = z.array(nativeObject).parse(nativeObject.parse(sourceAudit).attempts)[attemptIndex];
    if (!draftAttempt || draftAttempt.accepted !== previouslyAcceptedNative ||
        (previouslyAcceptedNative && sourceCallStatus !== "succeeded")) {
      throw new Error("Reviewer discrimination control differs from its preserved accepted/rejected disposition.");
    }
    // Accuracy controls preserve actually delivered historical replies. V1
    // checked scope, while V2 could miss accuracy errors; neither acceptance
    // establishes that the preserved teaching was correct.
    const originalDraft = z.string().min(1).parse(previouslyAcceptedNative
      ? nativeObject.parse(sourceOutput).student_visible_message
      : nativeObject.parse(nativeObject.parse(draftAttempt.invalid_candidate).candidate_json).student_visible_message);
    const originalReview = nativeObject.parse(draftAttempt.pre_delivery_review);
    const originalReviewInput = nativeObject.parse(originalReview.input);
    if (originalDraft !== probe.draft_message || originalReviewInput.draft_message !== originalDraft ||
        hashObject(deliveryReviewInputForVersion(sourceInput as FormativeConversationV18R2AgentInput, originalDraft, reviewerVersion)) !== hashObject(expectedInput) ||
        !isDeepStrictEqual(originalReviewInput, deliveryReviewInputForVersion(sourceInput as FormativeConversationV18R2AgentInput,
          originalDraft, deliveryReviewVersions.parse(originalReview.version)))) {
      throw new Error("Reviewer discrimination probe differs from its exact prior draft and visible source.");
    }
  } else if (probe.id === "contradictory_initial_reason_attribution" || authoredAssistanceControl) {
    if (hashObject(deliveryReviewInputForVersion(baselineContext as unknown as FormativeConversationV18R2AgentInput,
      z.string().parse(probe.draft_message), reviewerVersion)) !== hashObject(expectedInput)) throw new Error("Authored baseline control changed its exact source conversation.");
  } else if (preserved.length !== 0) throw new Error("Authored reviewer control must be labeled without invented native provenance.");
  return { input: expectedInput, context: probeContext, candidate: null as FormativeConversationV18R2AgentOutput | null };
}

export function historicalConversationDeliveryModel(manifest: z.infer<typeof ApprovedCandidateManifestSchema>, record: Record<string, unknown>) {
  const metadata = manifest.configuration_fingerprint.role_version_metadata.formative_conversation_agent;
  const policyKeys = ["delivery_review_policy_version", "delivery_review_model_name", "delivery_review_reasoning_effort", "delivery_review_execution_purpose"];
  if (record.version === "luna-medium-conversation-reliability-candidate-v1") {
    if (policyKeys.some(key => metadata[key] !== undefined)) throw new Error("Historical all-Luna identity contains an undeclared child policy.");
    return undefined;
  }
  if (record.version !== LUNA_SOL_DELIVERY_REVIEW_CANDIDATE_VERSION ||
      metadata.delivery_review_policy_version !== LUNA_SOL_DELIVERY_REVIEW_POLICY_VERSION ||
      metadata.delivery_review_model_name !== LUNA_SOL_DELIVERY_REVIEW_MODEL ||
      metadata.delivery_review_reasoning_effort !== "medium" || metadata.delivery_review_max_output_tokens !==
        (metadata.delivery_review_version === "conversation-delivery-review-v8" ? 4000 : 2500) ||
      metadata.delivery_review_execution_purpose !== "conversation_delivery_review" ||
      !digest.safeParse(metadata.delivery_review_prompt_hash).success || !deliveryReviewVersions.safeParse(metadata.delivery_review_version).success) {
    throw new Error("Historical mixed child policy differs from its declared candidate identity.");
  }
  return LUNA_SOL_DELIVERY_REVIEW_MODEL;
}

export function verifyHistoricalDeliveryDiagnostics(
  evidence: Pick<z.infer<typeof MixedConversationReplayValidationSchema>, "historical_diagnostics" | "historical_clarity_adjudication">,
  transport: TransportRow[], used = new Set<number>()) {
  const seen = new Set<string>();
  for (const entry of evidence.historical_diagnostics) {
    if (seen.has(entry.attempt_id)) throw new Error("Duplicate historical diagnostic.");
    seen.add(entry.attempt_id);
    const identity = entry.historical_identity;
    const manifest = ApprovedCandidateManifestSchema.parse(read(identity.candidate_manifest));
    const record = read(identity.candidate_record), extension = read(identity.model_extension);
    const started = read(entry.started), proof = read(entry.request_proof), input = read(entry.input);
    const probe = read(entry.probe), result = read(entry.result), report = read(entry.report), quality = read(entry.qualitative_review);
    const tutor = manifest.configuration_fingerprint.role_version_metadata.formative_conversation_agent;
    if (entry.diagnostic_only !== true || entry.candidate_validation_eligible !== false ||
        record.version !== "luna-medium-conversation-reliability-candidate-v1" ||
        record.active_kind !== "local_candidate_evaluation" || record.validation_pending !== true || record.production_activation_permitted !== false ||
        record.runtime_candidate_hash !== identity.runtime_candidate_hash ||
        file.parse(record.candidate_manifest).sha256 !== identity.candidate_manifest.sha256 ||
        modelUpgradeCandidateRuntimeHash(manifest, APPROVED_OPERATIONAL_ROLE_NAMES) !== identity.runtime_candidate_hash ||
        APPROVED_OPERATIONAL_ROLE_NAMES.some(role => manifest.roles[role]?.model_name !== "gpt-5.6-luna" || manifest.roles[role]?.reasoning_effort !== "medium") ||
        tutor.delivery_review_model_name !== undefined || tutor.delivery_review_prompt_hash !== proof.reviewer_prompt_hash ||
        tutor.delivery_review_version !== proof.request_schema_name ||
        started.attempt !== entry.attempt_id || started.runtime_hash !== identity.runtime_candidate_hash ||
        Object.entries(identity.source_files_sha256).some(([key, hash]) => nativeObject.parse(started.source_files_sha256)[key] !== hash) ||
        proof.runtime_hash !== identity.runtime_candidate_hash || proof.probe_id !== entry.probe_id ||
        proof.probe_sha256 !== entry.probe.sha256 || probe.id !== entry.probe_id || probe.synthetic_only !== true ||
        proof.diagnostic_only !== true || proof.candidate_validation_eligible !== false ||
        proof.model_name !== LUNA_SOL_DELIVERY_REVIEW_MODEL || proof.reasoning_effort !== "medium" || proof.max_output_tokens !== 2500 ||
        proof.diagnostic_extension_sha256 !== identity.model_extension.sha256 ||
        extension.version !== "repair-review-diagnostic-model-extension-v1" || extension.diagnostic_only !== true ||
        extension.candidate_validation_eligible !== false || extension.model_name !== LUNA_SOL_DELIVERY_REVIEW_MODEL ||
        extension.budget_usd !== 4 || extension.effective_maximum_dispatches !== 700 ||
        !digest.safeParse(proof.frozen_luna_compiled_request_sha256).success ||
        !digest.safeParse(proof.compiled_request_sha256).success || !digest.safeParse(proof.canonical_request_hash).success ||
        proof.input_sha256 !== hashObject(input) || proof.draft_sha256 !== hashObject(probe.draft_message) ||
        hashObject(proof.model_override) !== hashObject({ original: "gpt-5.6-luna", diagnostic: LUNA_SOL_DELIVERY_REVIEW_MODEL, changed_compiled_fields: ["model"] }) ||
        quality.attempt_id !== entry.attempt_id || quality.probe_id !== entry.probe_id || quality.review_complete !== true ||
        quality.overall_release_accepted !== false || quality.diagnostic_only !== true || quality.candidate_validation_eligible !== false ||
        report.runtime_hash !== identity.runtime_candidate_hash ||
        result.expected_verdict !== probe.expected_verdict || report.expected_verdict !== probe.expected_verdict) {
      throw new Error("Historical diagnostic identity or ineligibility proof mismatch.");
    }
    const expectedInput = deliveryReviewInputForVersion({ visible_transcript: probe.visible_transcript,
      latest_student_message: probe.latest_student_message } as FormativeConversationV18R2AgentInput,
    z.string().min(1).parse(probe.draft_message), z.string().parse(tutor.delivery_review_version));
    if (hashObject(input) !== hashObject(expectedInput)) throw new Error("Historical diagnostic source-only input changed.");
    const reviewed = nativeObject.parse(quality.sources);
    for (const key of ["probe", "started", "request_proof", "input", "result", "report", "transport_usage"] as const) {
      if (file.parse(reviewed[key]).sha256 !== entry[key].sha256) throw new Error("Historical diagnostic review source mismatch.");
    }
    const local = z.array(nativeObject).parse(read(entry.transport_usage).requests);
    if (local.length !== entry.transport_request_indices.length) throw new Error("Historical diagnostic dispatch count mismatch.");
    for (const index of entry.transport_request_indices) {
      const row = transport.find(row => row.request_index === index), retained = local.find(row => row.request_index === index);
      if (!row || !retained || used.has(index) || row.attempt_id !== entry.attempt_id ||
          row.model_name !== LUNA_SOL_DELIVERY_REVIEW_MODEL || row.category !== "application" || row.agent_name !== "formative_conversation_agent" ||
          row.diagnostic_only !== true || row.candidate_validation_eligible !== false ||
          row.diagnostic_model_extension_sha256 !== identity.model_extension.sha256 ||
          hashObject(Object.entries(row).sort(([a], [b]) => a.localeCompare(b))) !==
            hashObject(Object.entries(retained).sort(([a], [b]) => a.localeCompare(b)))) {
        throw new Error("Historical diagnostic transport was omitted, changed or relabeled.");
      }
      used.add(index);
    }
    const execution = nativeObject.parse(result.transport), accepted = nativeObject.parse(execution.accepted_result);
    const observed = nativeObject.parse(accepted.parsed_output).verdict;
    const matched = local.filter(row => row.provider_response_id === accepted.provider_response_id && row.status === "completed");
    const usage = nativeObject.parse(accepted.usage);
    if (execution.canonical_request_hash !== proof.canonical_request_hash || execution.status !== "accepted" ||
        result.status !== "completed" || accepted.provider !== "openai" || accepted.status !== "completed" ||
        accepted.raw_output == null || matched.length !== 1 || observed !== result.observed_verdict || observed !== report.observed_verdict ||
        result.matches_expected !== (observed === probe.expected_verdict) || quality.observed_verdict !== observed ||
        ["input_tokens", "output_tokens", "total_tokens"].some(key => !z.number().int().positive().safeParse(usage[key]).success ||
          nativeObject.parse(matched[0].usage)[key] !== usage[key]) ||
        z.array(nativeObject).parse(execution.attempt_traces).filter(trace => nativeObject.parse(trace.transport_milestones).fetch_invoked === true).length !== local.length) {
      throw new Error("Historical diagnostic provider output or accounting differs from retained transport.");
    }
  }
  const clarity = read(evidence.historical_clarity_adjudication.record);
  if (clarity.version !== "conversation-clarity-adjudication-v1" || clarity.probe_id !== "repeated_offset_clock_inconsistency" ||
      !seen.has(z.string().parse(clarity.attempt_id)) || clarity.original_expected_verdict !== "reject" || clarity.original_observed_verdict !== "pass" ||
      clarity.diagnostic_only !== true || clarity.candidate_validation_eligible !== false || clarity.selected_hard_control !== false ||
      clarity.selected_pass !== false || clarity.new_paid_execution !== false || clarity.original_expected_outcome_mismatch_preserved !== true ||
      !z.string().min(1).safeParse(clarity.rationale).success || !z.array(z.string().min(1)).min(1).safeParse(clarity.limitations).success) {
    throw new Error("Mandatory historical clarity adjudication is missing or relabeled as acceptance.");
  }
  const sources = nativeObject.parse(clarity.sources), relocated = evidence.historical_clarity_adjudication.sources;
  if (Object.keys(sources).length !== Object.keys(relocated).length) throw new Error("Clarity source inventory differs.");
  for (const [key, reference] of Object.entries(relocated)) {
    if (file.parse(sources[key]).sha256 !== reference.sha256) throw new Error("Clarity source hash changed.");
    readValue(reference);
  }
  const original = evidence.historical_diagnostics.find(entry => entry.attempt_id === clarity.attempt_id)!;
  if (file.parse(sources.result).sha256 !== original.result.sha256 || file.parse(sources.probe).sha256 !== original.probe.sha256) {
    throw new Error("Clarity adjudication does not bind the retained mismatch.");
  }
  return { used_indices: [...used] };
}
const deliveryReviewVersions = z.enum(["conversation-delivery-review-v1", "conversation-delivery-review-v2",
  "conversation-delivery-review-v3", "conversation-delivery-review-v4", "conversation-delivery-review-v5", "conversation-delivery-review-v6", "conversation-delivery-review-v7", "conversation-delivery-review-v8"]);
function deliveryReviewInputForVersion(context: FormativeConversationV18R2AgentInput, draft: string, version: string,
  candidate: FormativeConversationV18R2AgentOutput | null = null) {
  const parsedVersion = deliveryReviewVersions.parse(version);
  if (parsedVersion === "conversation-delivery-review-v7" || parsedVersion === "conversation-delivery-review-v8") return buildConversationDeliveryReviewInput(context, draft, candidate);
  if (["conversation-delivery-review-v5", "conversation-delivery-review-v6"].includes(parsedVersion)) return buildConversationDeliveryReviewInputV6(context, draft);
  // Historical requests predate backend draft blocks. Preserve their exact
  // three-field input rather than relabeling them as the current request.
  const historical = ConversationDeliveryReviewInputV1Schema.parse({ visible_transcript: context.visible_transcript.map(turn => ({
    sequence_index: turn.sequence_index, actor: turn.actor, message_text: turn.message_text })),
    latest_student_message: context.latest_student_message, draft_message: draft });
  return version === "conversation-delivery-review-v4" ? ConversationDeliveryReviewInputV4Schema.parse({ ...historical,
    draft_blocks: buildConversationDeliveryDraftBlocks(draft) }) : historical;
}

// This check applies only to selected results of the prospective planned wire.
// A historical accepted/rejected draft remains valid historical evidence without
// being rewritten to claim that a later projection ran on it.
export function verifySelectedConversationPlanAudit(value: unknown, responseId: string, inputValue: unknown, outputValue: unknown, rawOutput: unknown) {
  const preferenceLink = z.object({ preference_id: z.string().min(1),
    relationship: z.enum(["honored_constraint", "topic_of_support"]) }).strict();
  const audit = nativeObject.parse(value);
  const attempts = z.array(nativeObject).min(1).parse(audit.attempts);
  const accepted = attempts.filter(attempt => attempt.accepted === true);
  if (accepted.length !== 1 || accepted[0].provider_response_id !== responseId ||
      accepted[0].result_status !== "completed" || accepted[0].failure_class !== null) {
    throw new Error("Selected tutor result lacks one matching accepted provider attempt.");
  }
  const projection = z.object({
    version: z.literal(CONVERSATION_PRE_REPLY_PLAN_VERSION), status: z.literal("reconstructed"),
    original_output_sha256: digest, reconstructed_output_sha256: digest,
    stored_preference_bindings: z.array(z.object({ preference_id: z.string().min(1), preference_sha256: digest }).strict()),
    stored_preference_transition_version: z.literal(CONVERSATION_STORED_PREFERENCE_TRANSITION_VERSION),
    stored_preference_retention_version: z.literal(CONVERSATION_STORED_PREFERENCE_RETENTION_VERSION),
    current_source_activation_projection_version: z.literal(CONVERSATION_CURRENT_SOURCE_ACTIVATION_PROJECTION_VERSION),
    current_source_activation_bindings: z.array(z.object({ path: z.string().min(1), preference_id: z.string().min(1),
      source_evidence_id: z.string().min(1), source_sequence_index: z.number().int().positive(), source_sha256: digest,
      original_preference_comparison_sha256: digest, projected_preference_comparison_sha256: digest }).strict()).max(12),
    prior_tutor_source_version: z.literal(CONVERSATION_PRIOR_TUTOR_SOURCE_VERSION),
    prior_tutor_bindings: z.array(z.object({ path: z.string().min(1), tutor_sequence_index: z.number().int().positive(), reply_sha256: digest }).strict()).max(116),
    prior_needs_sha256: digest, derived_open_need_ids: z.array(z.string().min(1)).max(372),
    current_reply_source_version: z.literal(CONVERSATION_CURRENT_REPLY_SOURCE_VERSION),
    current_reply_bindings: z.array(z.object({ path: z.string().min(1), reply_sha256: digest }).strict()),
    support_preference_link_version: z.literal(CONVERSATION_SUPPORT_PREFERENCE_LINK_VERSION),
    support_preference_link_bindings: z.array(z.object({ path: z.string().min(1),
      links: z.array(preferenceLink).max(12) }).strict()),
    validation_issue_paths: z.array(z.string()).length(0)
  }).strict().parse(accepted[0].conversation_plan_projection);
  if (new Set(projection.stored_preference_bindings.map(binding => binding.preference_id)).size !==
      projection.stored_preference_bindings.length) throw new Error("Duplicate stored preference projection binding.");
  const state = ConversationContinuitySchema.parse(nativeObject.parse(inputValue).conversation_continuity);
  const review = ConversationReviewSchema.parse(nativeObject.parse(outputValue).conversation_review);
  const reply = z.string().min(1).max(12000).parse(nativeObject.parse(outputValue).student_visible_message);
  const replyHash = conversationCurrentReplySourceHash(reply);
  const expectedReplyBindings: Array<{ path: string; reply_sha256: string }> = [];
  const expectedPriorBindings: Array<{ path: string; tutor_sequence_index: number; reply_sha256: string }> = [];
  const context = nativeObject.parse(inputValue) as unknown as FormativeConversationV18R2AgentInput;
  verifyStoredPreferenceRetentionProjection(projection, context, review, rawOutput);
  verifyCurrentSourceActivationProjection(projection, context, review, rawOutput);
  const latestStudent = Math.max(0, ...context.visible_transcript.filter(turn => turn.actor === "student").map(turn => turn.sequence_index));
  const bindPrior = (source: { quote: string; tutor_sequence_index: number | null; source_binding?: unknown }, field: string) => {
    const binding = z.object({ version: z.literal(CONVERSATION_PRIOR_TUTOR_SOURCE_VERSION), reply_sha256: digest }).strict().parse(source.source_binding);
    const turns = context.visible_transcript.filter(turn => turn.actor === "tutor" && turn.sequence_index === source.tutor_sequence_index && turn.sequence_index < latestStudent);
    if (turns.length !== 1 || source.quote !== turns[0].message_text || binding.reply_sha256 !== conversationCurrentReplySourceHash(turns[0].message_text)) {
      throw new Error("Selected tutor prior-turn receipt differs from its exact earlier visible tutor message.");
    }
    expectedPriorBindings.push({ path: field, tutor_sequence_index: turns[0].sequence_index, reply_sha256: binding.reply_sha256 });
  };
  const bind = (quote: string, sourceBinding: unknown, field: string) => {
    const binding = z.object({ version: z.literal(CONVERSATION_CURRENT_REPLY_SOURCE_VERSION), reply_sha256: digest })
      .strict().parse(sourceBinding);
    if (quote !== reply || binding.reply_sha256 !== replyHash) {
      throw new Error("Selected tutor whole-reply receipt differs from the exact accepted reply.");
    }
    expectedReplyBindings.push({ path: field, reply_sha256: replyHash });
  };
  review.need_updates.forEach((need, index) => need.support.forEach((source, supportIndex) => {
    if (source.tutor_sequence_index === null) bind(source.quote, "source_binding" in source ? source.source_binding : undefined,
      `conversation_review.need_updates[${index}].support[${supportIndex}].quote`);
    else bindPrior(source, `conversation_review.need_updates[${index}].support[${supportIndex}].quote`);
  }));
  review.current_support.forEach((source, index) => bind(source.quote, "source_binding" in source ? source.source_binding : undefined,
    `conversation_review.current_support[${index}].quote`));
  review.recap_claims.forEach((source, index) => bind(source.current_quote, "source_binding" in source ? source.source_binding : undefined,
    `conversation_review.recap_claims[${index}].current_quote`));
  review.recap_claims.forEach((source, index) => source.earlier_support.forEach((prior, supportIndex) =>
    bindPrior(prior, `conversation_review.recap_claims[${index}].earlier_support[${supportIndex}].quote`)));
  review.closure.instructor_support?.prior_support.forEach((source, index) =>
    bindPrior(source, `conversation_review.closure.instructor_support.prior_support[${index}].quote`));
  if (hashObject(expectedPriorBindings) !== hashObject(projection.prior_tutor_bindings)) {
    throw new Error("Selected tutor prior-turn binding inventory differs from exact canonical sources.");
  }
  if (hashObject(expectedReplyBindings) !== hashObject(projection.current_reply_bindings)) {
    throw new Error("Selected tutor whole-reply binding inventory differs from the canonical output.");
  }
  const expectedPreferenceBindings = review.current_support.map((support, index) => {
    const linkage = z.object({ version: z.literal(CONVERSATION_SUPPORT_PREFERENCE_LINK_VERSION),
      links: z.array(preferenceLink).max(12) }).strict().parse(support.preference_linkage);
    const ids = linkage.links.map(link => link.preference_id);
    if (new Set(ids).size !== ids.length || hashObject(ids) !== hashObject(support.preference_ids)) {
      throw new Error("Selected tutor support preference IDs differ from its authored typed relationships.");
    }
    return { path: `conversation_review.current_support[${index}].preference_linkage`, links: linkage.links };
  });
  if (hashObject(expectedPreferenceBindings) !== hashObject(projection.support_preference_link_bindings)) {
    throw new Error("Selected tutor support preference relationship audit differs from canonical output.");
  }
  if (projection.prior_needs_sha256 !== hashObject(state.needs) ||
      new Set(review.need_updates.map(need => need.need_id)).size !== review.need_updates.length) {
    throw new Error("Selected tutor prior-needs provenance or authored update inventory differs.");
  }
  const merged = new Map(state.needs.map(need => [need.need_id, need.status]));
  review.need_updates.forEach(need => merged.set(need.need_id, need.status));
  const openIds = [...merged].filter(([, status]) => status === "open").map(([id]) => id).sort();
  if (hashObject(projection.derived_open_need_ids) !== hashObject(openIds) ||
      hashObject(review.closure.unresolved_need_ids) !== hashObject(openIds)) {
    throw new Error("Selected tutor derived open needs differ from exact input and canonical output.");
  }
  return projection;
}

// Read the original provider JSON text, whose key order survives JSONB storage.
// Wrapper objects retain parsed/canonical copies, but those copies are not the
// original wire and cannot establish an authored projection hash.
function originalTutorWire(rawValue: unknown) {
  let raw = nativeObject.parse(rawValue);
  for (let depth = 0; depth < 6; depth++) {
    const wrappers = ["accepted_output", "provider_raw_output"].filter(key => Object.hasOwn(raw, key));
    if (!wrappers.length) break;
    if (wrappers.length !== 1 || Object.hasOwn(raw, "output")) throw new Error("Ambiguous tutor provider-output wrapper.");
    raw = nativeObject.parse(raw[wrappers[0]]);
  }
  const outputs = z.array(nativeObject).min(1).parse(raw.output);
  const messages = outputs.filter(item => item.type === "message");
  if (raw.status !== "completed" || messages.length !== 1 || messages[0].role !== "assistant" ||
      messages[0].status !== "completed" || outputs.some(item => !["message", "reasoning"].includes(String(item.type)))) {
    throw new Error("Tutor projection lacks one completed original provider message.");
  }
  const content = z.array(nativeObject).length(1).parse(messages[0].content);
  if (content[0].type !== "output_text") throw new Error("Tutor projection lacks original JSON text.");
  return nativeObject.parse(JSON.parse(z.string().min(1).parse(content[0].text)));
}

// A selected retained-ID plan is an explicit no-op, not a new source or intent
// claim. Bind every existing-ID comparison in raw authored order, including
// actual activate/release decisions, so a missing or extra receipt cannot pass.
export function verifyStoredPreferenceRetentionProjection(projection: Record<string, unknown>, context: FormativeConversationV18R2AgentInput,
  review: z.infer<typeof ConversationReviewSchema>, rawOutput: unknown) {
  if (projection.version !== CONVERSATION_PRE_REPLY_PLAN_VERSION ||
      projection.stored_preference_retention_version !== CONVERSATION_STORED_PREFERENCE_RETENTION_VERSION) {
    throw new Error("Selected tutor lacks current stored-preference retention identity.");
  }
  const wire = originalTutorWire(rawOutput);
  if (hashObject(wire) !== projection.original_output_sha256) throw new Error("Tutor original wire differs from its projection hash.");
  const rawPlan = nativeObject.parse(wire.pre_reply_plan);
  if (rawPlan.version !== CONVERSATION_PRE_REPLY_PLAN_VERSION) throw new Error("Selected tutor raw preference plan has a historical version.");
  const comparisons = z.array(nativeObject).max(12).parse(rawPlan.preference_comparisons);
  const preferences = ConversationContinuitySchema.parse(context.conversation_continuity).preferences;
  const strictRetain = z.object({ preference_id: z.string().min(1), decision: z.literal("retain") }).strict();
  const expected: Array<{ preference_id: string; preference_sha256: string }> = [];
  const seen = new Set<string>();
  for (const comparison of comparisons) {
    const authored = ConversationPreReplyPlanSchema.shape.preference_comparisons.element.parse(comparison);
    if (seen.has(authored.preference_id)) throw new Error("Duplicate raw preference comparison.");
    seen.add(authored.preference_id);
    const stored = preferences.filter(item => item.preference_id === authored.preference_id);
    if (stored.length > 1) throw new Error("Ambiguous stored preference identity.");
    if (!stored.length) {
      if (strictRetain.safeParse(comparison).success) throw new Error("Retained stored preference ID is absent from the input.");
      continue;
    }
    expected.push({ preference_id: stored[0].preference_id, preference_sha256: hashObject(stored[0]) });
    if (authored.decision === "retain") {
      strictRetain.parse(comparison);
      const source = stored[0].source;
      const entries = context.allowed_evidence_catalog.evidence.filter(item => item.evidence_id === source.evidence_id);
      const entry = entries[0];
      const turns = context.visible_transcript.filter(turn => turn.sequence_index === entry?.source_sequence_index);
      const cutoff = Math.max(0, ...context.visible_transcript.map(turn => turn.sequence_index)) + 1;
      if (entries.length !== 1 || turns.length !== 1 || turns[0].actor !== "student" ||
          entry.source_role !== "student" || entry.evidence_scope_id !== context.allowed_evidence_catalog.evidence_scope_id ||
          entry.conversation_public_id !== context.conversation_public_id || entry.evidence_kind !== "formative_student_turn" ||
          entry.evidence_stage !== "formative_conversation" || entry.assessment_public_id !== context.assessment_public_id ||
          entry.concept_unit_public_id !== context.concept_unit_public_id || entry.source_sequence_index === null ||
          entry.source_sequence_index >= cutoff || !/[\p{L}\p{N}]/u.test(source.quote) ||
          !entry.content.includes(source.quote) || !turns[0].message_text.includes(source.quote) ||
          entry.content !== turns[0].message_text) {
        throw new Error("Retained stored preference source is not a unique eligible student turn.");
      }
      if (review.preference_updates.some(item => item.preference_id === authored.preference_id) ||
          review.bootstrap_preference_origins?.some(item => item.preference_id === authored.preference_id)) {
        throw new Error("Retained stored preference authored a canonical update or a new origin.");
      }
    } else if (!("prior" in authored) || authored.prior?.origin !== "stored_preference") {
      throw new Error("Existing preference transition lacks its stored identity reference.");
    }
  }
  if (!isDeepStrictEqual(expected, projection.stored_preference_bindings)) {
    throw new Error("Stored preference binding inventory differs from the complete ordered raw wire.");
  }
  return expected;
}

export function verifyCurrentSourceActivationProjection(projection: Record<string, unknown>, context: FormativeConversationV18R2AgentInput,
  review: z.infer<typeof ConversationReviewSchema>, rawOutput: unknown) {
  if (projection.current_source_activation_projection_version !== CONVERSATION_CURRENT_SOURCE_ACTIVATION_PROJECTION_VERSION) {
    throw new Error("Selected tutor lacks current-source activation projection identity.");
  }
  const wire = originalTutorWire(rawOutput);
  if (hashObject(wire) !== projection.original_output_sha256) throw new Error("Tutor original wire differs from its projection hash.");
  const comparisons = z.array(nativeObject).max(12).parse(nativeObject.parse(wire.pre_reply_plan).preference_comparisons);
  const preferences = ConversationContinuitySchema.parse(context.conversation_continuity).preferences;
  const latest = Math.max(0, ...context.visible_transcript.filter(turn => turn.actor === "student").map(turn => turn.sequence_index));
  const sourceSchema = z.object({ evidence_id: z.string().min(1), quote: z.string().min(1) }).strict();
  const expected: Array<Record<string, unknown>> = [];
  comparisons.forEach((comparison, index) => {
    const parsed = ConversationPreReplyPlanSchema.shape.preference_comparisons.element.safeParse(comparison);
    if (!parsed.success) return;
    const authored = parsed.data;
    if (!("current_source" in authored) || !("prior" in authored)) return;
    const prior = comparison.prior && typeof comparison.prior === "object" ? nativeObject.parse(comparison.prior) : null;
    const source = sourceSchema.safeParse(comparison.current_source);
    const priorSource = sourceSchema.safeParse(prior?.source);
    if (comparison.decision !== "activate" || comparison.change_basis !== "explicit_change" || prior?.origin !== "visible_student_history" ||
        !source.success || !priorSource.success || !isDeepStrictEqual(source.data, priorSource.data) ||
        !isDeepStrictEqual(source.data, authored.current_source) || authored.prior?.origin !== "visible_student_history" ||
        !isDeepStrictEqual(priorSource.data, authored.prior.source) || !("kind" in authored) || !authored.kind ||
        !("description" in authored) || !authored.description || comparison.kind !== authored.kind ||
        comparison.description !== authored.description || comparison.preference_id !== authored.preference_id ||
        comparisons.filter(item => item.preference_id === comparison.preference_id).length !== 1 ||
        preferences.some(item => item.preference_id === comparison.preference_id)) return;
    const entries = context.allowed_evidence_catalog.evidence.filter(item => item.evidence_id === source.data.evidence_id);
    const turns = context.visible_transcript.filter(turn => turn.sequence_index === latest);
    if (!latest || entries.length !== 1 || turns.length !== 1 || turns[0].actor !== "student" ||
        turns[0].message_text !== context.latest_student_message || entries[0].content !== turns[0].message_text) return;
    const entry = entries[0];
    if (entry.source_role !== "student" || entry.evidence_kind !== "formative_student_turn" || entry.evidence_stage !== "formative_conversation" ||
        entry.evidence_scope_id !== context.allowed_evidence_catalog.evidence_scope_id || entry.conversation_public_id !== context.conversation_public_id ||
        entry.assessment_public_id !== context.assessment_public_id || entry.concept_unit_public_id !== context.concept_unit_public_id ||
        entry.source_sequence_index !== latest || !/[\p{L}\p{N}]/u.test(source.data.quote) ||
        !entry.content.includes(source.data.quote) || !turns[0].message_text.includes(source.data.quote)) return;
    const updates = review.preference_updates.filter(item => item.preference_id === comparison.preference_id);
    if (updates.length !== 1 || updates[0].status !== "active" || updates[0].kind !== comparison.kind ||
        updates[0].description !== comparison.description || !isDeepStrictEqual(updates[0].source, source.data) ||
        review.bootstrap_preference_origins?.some(item => item.preference_id === comparison.preference_id)) {
      throw new Error("Current-source activation changed the authored preference or invented an earlier origin.");
    }
    expected.push({ path: `pre_reply_plan.preference_comparisons[${index}].prior`, preference_id: comparison.preference_id,
      source_evidence_id: source.data.evidence_id, source_sequence_index: latest, source_sha256: hashObject(source.data),
      original_preference_comparison_sha256: hashObject(comparison), projected_preference_comparison_sha256: hashObject({ ...comparison, prior: null }) });
  });
  if (!isDeepStrictEqual(expected, projection.current_source_activation_bindings)) {
    throw new Error("Current-source activation receipts differ from the exact raw wire and student source.");
  }
  return expected;
}

// Current selected evidence must bind the context-isolated reviewer, including
// rejected drafts and child usage. Historical attempts never pass through this
// check. These are provenance/consistency checks, not proof of reviewer accuracy.
export function verifyDeliveryReviewOriginalParse(rawValue: unknown, parsedValue: unknown, expectedHash: string) {
  const raw = nativeObject.parse(rawValue);
  const outputs = z.array(nativeObject).min(1).parse(raw.output);
  const messages = outputs.filter(item => item.type === "message");
  if (raw.status !== "completed" || messages.length !== 1 || messages[0].role !== "assistant" ||
      messages[0].status !== "completed" || outputs.some(item => !["message", "reasoning"].includes(String(item.type)))) {
    throw new Error("Delivery review lacks one unambiguous completed raw provider message.");
  }
  const content = z.array(nativeObject).length(1).parse(messages[0].content);
  if (content[0].type !== "output_text") throw new Error("Delivery review raw provider message lacks exact JSON text.");
  const original = JSON.parse(z.string().min(1).parse(content[0].text)) as unknown;
  // JSONB changes object-key order. Verify the hash against the original provider
  // parse and separately require every persisted value/array position to match.
  // Neither raw evidence nor its original hash is rewritten or normalized.
  if (hashObject(original) !== expectedHash || !isDeepStrictEqual(original, parsedValue)) {
    throw new Error("Delivery review persisted values or original provider parse hash differ.");
  }
  return original;
}

// A rejected model draft is retained in its original wire representation, not
// as the canonical candidate reviewed by the child. Replay the same ordered
// projections as the live runner and bind every stage before trusting that review.
export function verifyRejectedConversationDeliveryCandidate(attemptValue: unknown, inputValue: unknown) {
  const attempt = nativeObject.parse(attemptValue);
  const invalid = nativeObject.parse(attempt.invalid_candidate);
  const retained = nativeObject.parse(invalid.candidate_json);
  // This is a current selected-evidence check: its transport is bound to the
  // planned provider schema. Removing plan fields/audits cannot opt into a
  // canonical fallback. Historical readers do not invoke this check.
  const context = FormativeConversationV18R2AgentInputSchema.parse(inputValue);
  const schemaOrderedWire = FormativeConversationPlannedProposalOutputSchema.parse(retained);
  if (!isDeepStrictEqual(context, inputValue) || !isDeepStrictEqual(schemaOrderedWire, retained)) {
    throw new Error("Rejected tutor projection would change retained source values.");
  }
  // JSONB can reorder keys, but does not preserve rejected provider text. The
  // strict schema order is usable ONLY when its exact serialization reproduces
  // the recorded original hashes. No arbitrary field removal or fuzzy repair.
  const text = invalid.candidate_text == null ? JSON.stringify(schemaOrderedWire) : z.string().min(1).parse(invalid.candidate_text);
  const wire = nativeObject.parse(JSON.parse(text));
  if (!isDeepStrictEqual(wire, retained) ||
      createHash("sha256").update(text).digest("hex") !== digest.parse(invalid.candidate_hash)) {
    throw new Error("Rejected tutor original candidate hash or values differ.");
  }
  const plan = projectConversationContinuityWire(wire, context);
  if (plan.output === null || plan.audit.status !== "reconstructed" ||
      !isDeepStrictEqual(plan.audit, attempt.conversation_plan_projection)) {
    throw new Error("Rejected tutor plan projection differs from its retained audit.");
  }
  const profile = reconstructFormativeProfileProposal({ candidate: plan.output, context });
  if (!profile.valid || !isDeepStrictEqual(profile.audit, attempt.profile_update_projection)) {
    throw new Error("Rejected tutor profile projection differs from its retained audit.");
  }
  const interpreted = prepareFormativeInterpretationResult({ provider: "openai", status: "completed",
    client_request_id: z.string().min(1).parse(attempt.client_request_id),
    latency_ms: z.number().nonnegative().parse(attempt.latency_ms), parsed_output: profile.output }, context);
  const interpretationAudit = interpreted.raw_output === undefined ? undefined :
    nativeObject.parse(interpreted.raw_output).interpretation_projection;
  if (!isDeepStrictEqual(interpretationAudit, attempt.interpretation_projection)) {
    throw new Error("Rejected tutor interpretation projection differs from its retained audit.");
  }
  const candidate = FormativeConversationV18R2AgentOutputSchema.parse(interpreted.parsed_output);
  if (!validateFormativeInterpretation({ candidate, context }).valid) {
    throw new Error("Rejected tutor candidate was not eligible for delivery review.");
  }
  return candidate;
}

export function verifySelectedConversationDeliveryAudit(value: unknown, responseId: string, inputValue: unknown,
  outputValue: unknown, transport: TransportRow[], deliveryReviewModel?: typeof LUNA_SOL_DELIVERY_REVIEW_MODEL) {
  const audit = nativeObject.parse(value);
  const attempts = z.array(nativeObject).min(1).max(2).parse(audit.attempts);
  const accepted = attempts.filter(item => item.accepted === true);
  if (accepted.length !== 1 || accepted[0].provider_response_id !== responseId ||
      audit.accounting_version !== FORMATIVE_CONVERSATION_DELIVERY_REVIEW_ACCOUNTING_VERSION ||
      audit.dispatch_accounting_complete !== true || audit.usage_accounting_complete !== true) {
    throw new Error("Selected tutor lacks complete delivery-review accounting.");
  }
  const context = nativeObject.parse(inputValue) as unknown as FormativeConversationV18R2AgentInput;
  const expectedTutorFormat = selectedConversationRequestFormatSha256(inputValue);
  const expectedReviewerFormat = createHash("sha256").update(JSON.stringify(
    zodTextFormat(ConversationDeliveryReviewSchema, LUNA_CONVERSATION_DELIVERY_REVIEW_VERSION))).digest("hex");
  const output = nativeObject.parse(outputValue);
  const responseIds = new Set<string>();
  const usage = { input_tokens: 0, output_tokens: 0, total_tokens: 0 };
  const counters = { logical_calls_entered: attempts.length, tutor_logical_calls_entered: attempts.length,
    review_logical_calls_entered: 0, http_requests_dispatched: 0, provider_responses_completed: 0,
    provider_attempts: 0, transport_retries: 0, pre_dispatch_request_rejections: 0 };
  const countKeys = { http_request_count: "http_requests_dispatched", provider_response_completed_count: "provider_responses_completed",
    provider_attempt_count: "provider_attempts", transport_retry_count: "transport_retries",
    pre_dispatch_request_rejection_count: "pre_dispatch_request_rejections" } as const;
  const addCounters = (entry: Record<string, unknown>) => {
    for (const [key, sumKey] of Object.entries(countKeys)) counters[sumKey] += z.number().int().nonnegative().parse(entry[key]);
  };
  const bindPaidResult = (entry: Record<string, unknown>, reviewer = false) => {
    const id = z.string().min(1).parse(entry.provider_response_id);
    const physical = ProviderPhysicalUsageAuditSchema.parse(entry.physical_usage);
    const dispatched = physical.attempts.filter(attempt => attempt.fetch_invoked === true);
    if (!physical.usage_accounting_complete || entry.usage_accounting_complete !== true || entry.dispatch_accounting_complete !== true ||
        physical.attempts.some(attempt => attempt.fetch_invoked === null) || !dispatched.length ||
        entry.provider_attempt_count !== physical.attempts.length || entry.http_request_count !== dispatched.length ||
        entry.transport_retry_count !== physical.attempts.length - 1 ||
        entry.pre_dispatch_request_rejection_count !== physical.attempts.length - dispatched.length ||
        physical.attempts.some(attempt => attempt.fetch_invoked === false && attempt.provider_response_id !== null) ||
        dispatched.at(-1)?.provider_response_id !== id) {
      throw new Error("Selected tutor/reviewer lacks complete physical request usage.");
    }
    const sums = { input_tokens: 0, output_tokens: 0, total_tokens: 0 };
    for (const attempt of dispatched) {
      const physicalId = z.string().min(1).parse(attempt.provider_response_id);
      const rows = transport.filter(row => row.provider_response_id === physicalId);
      if (responseIds.has(physicalId) || rows.length !== 1 ||
          !["completed", "failed"].includes(rows[0].status) || (physicalId === id && rows[0].status !== "completed") ||
          rows[0].category !== "application" || rows[0].agent_name !== "formative_conversation_agent" ||
          rows[0].model_name !== (reviewer && deliveryReviewModel ? deliveryReviewModel : "gpt-5.6-luna")) {
        throw new Error("Tutor/reviewer lacks unique matching physical transport evidence.");
      }
      if (reviewer && deliveryReviewModel) verifyMixedReviewTransport(rows[0]);
      if (rows[0].request_format_sha256 !== (reviewer ? expectedReviewerFormat : expectedTutorFormat)) {
        throw new Error("Selected tutor/reviewer physical request format does not bind the exact current schema.");
      }
      responseIds.add(physicalId);
      const providerUsage = nativeObject.parse(rows[0].usage);
      for (const key of ["input_tokens", "output_tokens", "total_tokens"] as const) {
        const tokens = z.number().int().nonnegative().parse(attempt[key]);
        if (providerUsage[key] !== tokens) throw new Error("Physical tutor/reviewer usage differs from actual transport.");
        sums[key] += tokens;
      }
      for (const [key, detailKey, nestedKey] of [["cached_input_tokens", "input_tokens_details", "cached_tokens"],
        ["reasoning_tokens", "output_tokens_details", "reasoning_tokens"]] as const) {
        const detail = providerUsage[detailKey] == null ? {} : nativeObject.parse(providerUsage[detailKey]);
        const actual = providerUsage[key] ?? detail[nestedKey] ?? null;
        if (attempt[key] !== actual) throw new Error("Physical tutor/reviewer usage details differ from actual transport.");
      }
      if (attempt.total_tokens !== Number(attempt.input_tokens) + Number(attempt.output_tokens)) throw new Error("Physical tutor/reviewer token totals differ.");
    }
    for (const key of ["input_tokens", "output_tokens", "total_tokens"] as const) {
      if (entry[key] !== sums[key]) throw new Error("Tutor/reviewer aggregate omits physical usage.");
      usage[key] += sums[key];
    }
  };
  for (const attempt of attempts) {
    addCounters(attempt);
    bindPaidResult(attempt);
    if (attempt.pre_delivery_review === undefined) {
      if (attempt.accepted === true) throw new Error("Accepted tutor draft lacks pre-delivery review.");
      continue; // Structurally invalid tutor drafts are retained without a reviewer call.
    }
    const review = FormativeConversationDeliveryReviewAuditSchema.parse(attempt.pre_delivery_review);
    const candidate = attempt.accepted === true ? FormativeConversationV18R2AgentOutputSchema.parse(output) :
      verifyRejectedConversationDeliveryCandidate(attempt, inputValue);
    const draft = candidate.student_visible_message;
    const expectedInput = buildConversationDeliveryReviewInput(context, draft, candidate);
    if (hashObject(review.input) !== hashObject(expectedInput) || review.input_sha256 !== hashObject(expectedInput) ||
        review.draft_sha256 !== hashObject(draft) || review.prompt_hash !== LUNA_CONVERSATION_DELIVERY_REVIEW_PROMPT_HASH ||
        review.version !== LUNA_CONVERSATION_DELIVERY_REVIEW_VERSION || review.schema_version !== LUNA_CONVERSATION_DELIVERY_REVIEW_VERSION ||
        review.provider !== "openai" || review.model_name !== (deliveryReviewModel ?? "gpt-5.6-luna") || review.reasoning_effort !== "medium" ||
        review.max_output_tokens !== LUNA_CONVERSATION_DELIVERY_REVIEW_MAX_OUTPUT_TOKENS ||
        review.execution_policy_version !== (deliveryReviewModel ? LUNA_SOL_DELIVERY_REVIEW_POLICY_VERSION : undefined) || !review.dispatch_accounting_complete || !review.usage_accounting_complete) {
      throw new Error("Delivery reviewer input, identity or accounting differs from the selected tutor context.");
    }
    addCounters(review);
    if (review.status === "skipped_opening") {
      if (attempt.accepted !== true || expectedInput.visible_transcript.length || expectedInput.latest_student_message !== null ||
          expectedInput.proposed_learning_claims.candidate_sha256 === null || expectedInput.proposed_learning_claims.claim_count !== 0 ||
          (review.physical_usage !== undefined && (!review.physical_usage.usage_accounting_complete || review.physical_usage.attempts.length !== 0)) ||
          context.formative_lifecycle?.student_turn_index !== 0 || review.logical_call_entered || review.validation_issue_paths.length ||
          review.latency_ms !== 0 || Object.keys(countKeys).some(key => review[key as keyof typeof review] !== 0) ||
          ["review_output_sha256", "parsed_output", "raw_output", "logical_call_id", "canonical_request_hash", "provider_request_id",
            "provider_response_id", "client_request_id", "result_status", "input_tokens", "output_tokens", "total_tokens",
            "cached_input_tokens", "reasoning_tokens"].some(key => review[key as keyof typeof review] !== null)) {
        throw new Error("Delivery review opening exclusion is not an empty, unpaid initial dialogue.");
      }
      continue;
    }
    if (!review.logical_call_entered || review.result_status !== "completed" || !review.logical_call_id ||
        !review.canonical_request_hash || !review.client_request_id || review.raw_output === null ||
        review.http_request_count < 1 || review.provider_response_completed_count < 1 || review.provider_attempt_count < 1 ||
        !review.review_output_sha256) throw new Error("Delivery reviewer receipt is incomplete.");
    verifyDeliveryReviewOriginalParse(review.raw_output, review.parsed_output, review.review_output_sha256);
    const checked = validateConversationDeliveryReview(review.parsed_output, context, draft, candidate);
    if (!checked.valid || (attempt.accepted === true
      ? review.status !== "passed" || !checked.accepted || review.validation_issue_paths.length !== 0
      : review.status !== "rejected" || checked.accepted || review.validation_issue_paths.length !== 1 ||
        review.validation_issue_paths[0] !== "conversation_delivery_review.rejected")) {
      throw new Error("Delivery-review decision does not match the accepted/rejected tutor draft.");
    }
    counters.logical_calls_entered++;
    counters.review_logical_calls_entered++;
    bindPaidResult(review, true);
  }
  if (Object.entries(counters).some(([key, count]) => audit[key] !== count)) throw new Error("Delivery-review aggregate counters omit or miscount child calls.");
  return { ...usage, provider_response_ids: [...responseIds], http_requests_dispatched: counters.http_requests_dispatched };
}

// Hashes establish provenance, not provider attestation or educational validity.
export function verifyConversationReplayValidation(reference: z.infer<typeof file>, runtimeHash: string,
  sourceHashes: Record<string, string>, requiredSources: readonly string[], transport: TransportRow[],
  expectedPromptHash: string, deliveryReviewModel?: typeof LUNA_SOL_DELIVERY_REVIEW_MODEL) {
  const evidence = (deliveryReviewModel ? MixedConversationReplayValidationSchema : ConversationReplayValidationSchema).parse(read(reference));
  const requiredProbes: readonly string[] = deliveryReviewModel ? MIXED_DELIVERY_REVIEW_PROBES : CONVERSATION_DELIVERY_REVIEW_PROBES;
  if (evidence.runtime_candidate_hash !== runtimeHash || requiredSources.some(file => evidence.source_files_sha256[file] !== sourceHashes[file])) {
    throw new Error("Repeated replay runtime/source identity mismatch.");
  }
  const used = new Set<number>();
  const attempts = new Set<string>();
  const repetitions = new Set<string>();
  const inputIdentities = new Map<string, string>();
  const responseIds = new Set<string>();
  for (const entry of [...evidence.attempts, ...evidence.prior_attempts, ...evidence.historical_prior_attempts]) {
    if (attempts.has(entry.attempt_id)) throw new Error("Duplicate replay attempt.");
    attempts.add(entry.attempt_id);
    const accepted = "repeat_index" in entry;
    const historical = "historical_identity" in entry
      ? ConversationReplayValidationSchema.shape.historical_prior_attempts.element.shape.historical_identity.parse(entry.historical_identity)
      : null;
    const entryRuntime = historical?.runtime_candidate_hash ?? runtimeHash;
    const entrySources = historical?.source_files_sha256 ?? sourceHashes;
    const entryPromptHash = historical?.prompt_hash ?? expectedPromptHash;
    let entryPromptVersion = "formative-conversation-host-v7.21";
    let entryRequiredSources = requiredSources;
    let historicalReviewModel: typeof LUNA_SOL_DELIVERY_REVIEW_MODEL | undefined;
    if (historical) {
      const manifest = ApprovedCandidateManifestSchema.parse(read(historical.candidate_manifest));
      const record = read(historical.candidate_record);
      entryRequiredSources = historicalConversationRequiredSources(manifest, entrySources, requiredSources);
      historicalReviewModel = historicalConversationDeliveryModel(manifest, record);
      entryPromptVersion = z.string().min(1).parse(manifest.configuration_fingerprint.role_version_metadata.formative_conversation_agent.prompt_version);
      const manifestRef = file.parse(record.candidate_manifest);
      if (record.active_kind !== "local_candidate_evaluation" ||
          record.validation_pending !== true || record.production_activation_permitted !== false ||
          record.runtime_candidate_hash !== entryRuntime || modelUpgradeCandidateRuntimeHash(manifest, APPROVED_OPERATIONAL_ROLE_NAMES) !== entryRuntime ||
          // The retained record's original absolute path is provenance. A copied
          // artifact may live on another host; exact bytes and recomputed runtime
          // identity, not storage-path equality, bind that manifest.
          manifestRef.sha256 !== historical.candidate_manifest.sha256 ||
          APPROVED_OPERATIONAL_ROLE_NAMES.some(role => manifest.roles[role]?.model_name !== "gpt-5.6-luna" || manifest.roles[role]?.reasoning_effort !== "medium") ||
          manifest.configuration_fingerprint.role_version_metadata.formative_conversation_agent.prompt_hash !== entryPromptHash ||
          entryRequiredSources.some(file => !entrySources[file])) throw new Error("Historical replay candidate provenance mismatch.");
    }
    const fixture = read(entry.fixture), started = read(entry.started), proof = read(entry.request_proof);
    const result = read(entry.result), report = read(entry.report);
    const original = read(entry.input_original), effective = read(entry.input_effective);
    if (fixture.synthetic_only !== true || fixture.version !== "native-synthetic-replay-v1" ||
        started.fixture !== entry.fixture_id || started.attempt !== entry.attempt_id ||
        started.fixture_sha256 !== entry.fixture.sha256 || started.runtime_hash !== entryRuntime ||
        proof.runtime_hash !== entryRuntime || report.runtime_hash !== entryRuntime || proof.source_input_unchanged !== true ||
        proof.original_input_sha256 !== hashObject(original) || proof.effective_input_sha256 !== hashObject(effective) ||
        hashObject(fixture.input) !== hashObject(original)) throw new Error("Replay native fixture/input provenance mismatch.");
    const source = nativeObject.parse(fixture.source);
    if (hashObject(source) !== hashObject(proof.source_fixture) || source.sha256 !== started.native_source_sha256 ||
        ["original_input_sha256", "effective_input_sha256", "compiled_request_sha256"].some(key => report[key] !== proof[key])) {
      throw new Error("Replay report or historical source binding mismatch.");
    }
    const nativeSources = z.record(digest).parse(started.source_files_sha256);
    if (entryRequiredSources.some(file => nativeSources[file] !== entrySources[file]) ||
        (historical && Object.entries(entrySources).some(([file, hash]) => nativeSources[file] !== hash))) throw new Error("Replay started source inventory mismatch.");
    const identity = nativeObject.parse(proof.identity);
    if (identity.model_name !== "gpt-5.6-luna" || identity.reasoning_effort !== "medium" ||
        identity.prompt_hash !== entryPromptHash || identity.prompt_version !== entryPromptVersion ||
        identity.schema_version !== "formative-conversation-profile-proposal-output-v1" ||
        proof.request_input_encoding !== "formative-tutor-input-v1" || !digest.safeParse(proof.compiled_request_sha256).success) {
      throw new Error("Replay actual request identity mismatch.");
    }
    const reviewedTransport = z.array(nativeObject).parse(read(entry.transport_usage).requests);
    if (reviewedTransport.length !== entry.transport_request_indices.length) throw new Error("Replay transport inventory differs.");
    if ("qualitative_review" in entry) {
      const review = read(entry.qualitative_review);
      if (review.fixture_id !== entry.fixture_id || review.attempt_id !== entry.attempt_id || review.review_complete !== true ||
          typeof review.overall_release_accepted !== "boolean" || typeof review.transition_exercised !== "boolean") {
        throw new Error("Replay qualitative review identity or completion mismatch.");
      }
      if (accepted && (
          ["review_complete", "profile_fidelity_accepted", "student_question_coverage_accepted", "conversation_history_accepted",
            "closure_accepted", "overall_release_accepted"].some(key => review[key] !== true) ||
          typeof review.transition_exercised !== "boolean")) throw new Error("Replay qualitative review is incomplete or rejected.");
      if ("disposition" in entry && ((entry.disposition === "qualitative_rejection" && review.overall_release_accepted !== false) ||
          (entry.disposition === "mechanical_failure" && report.status === "mechanically_valid"))) {
        throw new Error("Historical replay disposition contradicts retained native evidence.");
      }
      const reviewedSources = nativeObject.parse(review.sources);
      for (const key of ["started", "request_proof", "result", "report"] as const) {
        const reviewed = file.parse(reviewedSources[key]);
        // Reviews remain byte-exact when their native evidence is relocated.
        // read(entry[key]) already verifies the current absolute path and bytes.
        if (reviewed.sha256 !== entry[key].sha256) {
          throw new Error("Replay review does not bind the exact native evidence.");
        }
      }
      // The raw review retains its original host path. The wrapper supplies the
      // current location, while this exact hash binds the reviewed sidecar bytes.
      if (file.parse(reviewedSources.transport_usage).sha256 !== entry.transport_usage.sha256) {
        throw new Error("Replay review does not bind the exact transport evidence.");
      }
    }
    if (accepted) {
      const repetition = `${entry.fixture_id}:${entry.repeat_index}`;
      if (repetitions.has(repetition)) throw new Error("Duplicate fixture repetition.");
      repetitions.add(repetition);
      const inputIdentity = `${entry.fixture.sha256}:${proof.original_input_sha256}:${proof.effective_input_sha256}`;
      if (inputIdentities.has(entry.fixture_id) && inputIdentities.get(entry.fixture_id) !== inputIdentity) {
        throw new Error("Repeated fixture inputs differ.");
      }
      inputIdentities.set(entry.fixture_id, inputIdentity);
      if (result.status !== "completed" || nativeObject.parse(result.validation).valid !== true || report.status !== "mechanically_valid") {
        throw new Error("Every selected replay must mechanically pass and have explicit accepted semantic review.");
      }
    }
    const rows = entry.transport_request_indices.map(index => {
      const row = transport.find(row => row.request_index === index);
      if (!row || used.has(index) || row.attempt_id !== entry.attempt_id) throw new Error("Replay transport selection mismatch.");
      used.add(index);
      if (reviewedTransport) {
        const reviewed = reviewedTransport.find(value => value.request_index === index);
        if (!reviewed || ["attempt_id", "model_name", "agent_name", "category", "status", "provider_response_id"].some(key =>
          reviewed[key] !== row[key as keyof TransportRow]) || hashObject(reviewed.usage) !== hashObject(row.usage)) {
          throw new Error("Replay qualitative review transport does not match the closed shared ledger.");
        }
        if (accepted && reviewed.request_format_sha256 !== row.request_format_sha256) {
          throw new Error("Selected replay format hash differs between reviewed and shared transport.");
        }
      }
      if ((row.model_name !== "gpt-5.6-luna" && row.model_name !== (historical ? historicalReviewModel : deliveryReviewModel)) || row.category !== "application" || row.agent_name !== "formative_conversation_agent") {
        throw new Error("Replay transport must be the declared Luna tutor.");
      }
      if (row.model_name === LUNA_SOL_DELIVERY_REVIEW_MODEL) verifyMixedReviewTransport(row);
      return row;
    });
    if (accepted) {
      const execution = nativeObject.parse(result.execution);
      const responseId = z.string().min(1).parse(execution.provider_response_id);
      verifySelectedConversationPlanAudit(execution.provider_execution_audit, responseId, effective, execution.output, execution.raw_output);
      const delivery = verifySelectedConversationDeliveryAudit(execution.provider_execution_audit, responseId, effective, execution.output, rows, deliveryReviewModel);
      if (delivery.http_requests_dispatched !== rows.length) throw new Error("Replay transport count omits a tutor/reviewer dispatch.");
      const match = rows.find(row => row.provider_response_id === responseId && row.status === "completed");
      const usage = z.object({ input_tokens: z.number().int().positive(), output_tokens: z.number().int().positive() });
      if (responseIds.has(responseId) || !match || !usage.safeParse(match.usage).success) throw new Error("Accepted replay lacks unique completed provider usage.");
      responseIds.add(responseId);
    }
  }
  for (const fixture of CONVERSATION_REPLAY_FIXTURES) for (const repeat of [1, 2, 3]) {
    if (!repetitions.has(`${fixture}:${repeat}`)) throw new Error("Every fixture requires three distinct accepted repetitions.");
  }
  const probeIds = new Set<string>();
  for (const entry of [...evidence.delivery_review_probes.attempts, ...evidence.delivery_review_probes.prior_attempts]) {
    const priorEntry = "reason" in entry ? (deliveryReviewModel
      ? MixedConversationReplayValidationSchema.shape.delivery_review_probes.shape.prior_attempts.element
      : ConversationReplayValidationSchema.shape.delivery_review_probes.shape.prior_attempts.element).parse(entry) : null;
    const selected = priorEntry === null;
    if (attempts.has(entry.attempt_id)) throw new Error("Duplicate tutor/reviewer attempt identity.");
    attempts.add(entry.attempt_id);
    if (selected && probeIds.has(entry.probe_id)) throw new Error("Duplicate selected delivery-review probe.");
    if (selected) probeIds.add(entry.probe_id);
    const historical = priorEntry?.historical_identity;
    const entryRuntime = historical?.runtime_candidate_hash ?? runtimeHash;
    const entrySources = historical?.source_files_sha256 ?? sourceHashes;
    const reviewerHash = historical?.reviewer_prompt_hash ?? LUNA_CONVERSATION_DELIVERY_REVIEW_PROMPT_HASH;
    let reviewerVersion: string = LUNA_CONVERSATION_DELIVERY_REVIEW_VERSION;
    let reviewerModel: string = deliveryReviewModel ?? "gpt-5.6-luna";
    let entryRequiredSources = requiredSources;
    if (historical) {
      const manifest = ApprovedCandidateManifestSchema.parse(read(historical.candidate_manifest));
      const record = read(historical.candidate_record);
      entryRequiredSources = historicalConversationRequiredSources(manifest, entrySources, requiredSources);
      reviewerModel = historicalConversationDeliveryModel(manifest, record) ?? "gpt-5.6-luna";
      reviewerVersion = deliveryReviewVersions.parse(
        manifest.configuration_fingerprint.role_version_metadata.formative_conversation_agent.delivery_review_version);
      if (record.active_kind !== "local_candidate_evaluation" ||
          record.validation_pending !== true || record.production_activation_permitted !== false ||
          record.runtime_candidate_hash !== entryRuntime || modelUpgradeCandidateRuntimeHash(manifest, APPROVED_OPERATIONAL_ROLE_NAMES) !== entryRuntime ||
          file.parse(record.candidate_manifest).sha256 !== historical.candidate_manifest.sha256 ||
          manifest.configuration_fingerprint.role_version_metadata.formative_conversation_agent.delivery_review_prompt_hash !== reviewerHash ||
          APPROVED_OPERATIONAL_ROLE_NAMES.some(role => manifest.roles[role]?.model_name !== "gpt-5.6-luna" || manifest.roles[role]?.reasoning_effort !== "medium")) {
        throw new Error("Historical reviewer-probe candidate provenance mismatch.");
      }
    }
    const probe = read(entry.probe), fixture = read(entry.fixture), started = read(entry.started), proof = read(entry.request_proof);
    const input = read(entry.input), result = read(entry.result), report = read(entry.report), quality = read(entry.qualitative_review);
    const expectedVerdict = ["unsupported_pause_agenda", "unsolicited_teaching_after_stop", "ready_to_continue_misattributed_as_finish",
      "constant_score_reliability_error", "clock_analogy_inconsistency",
      "repeated_constant_score_reliability_error", "repeated_offset_clock_inconsistency", "explicit_stopped_clock_offset_error",
      "contradictory_initial_reason_attribution", "unsupported_assisted_understanding_summary",
      "unsupported_assisted_profile_update"].includes(entry.probe_id) ? "reject" : "pass";
    const previouslyAcceptedNative = ["constant_score_reliability_error", "clock_analogy_inconsistency",
      "repeated_constant_score_reliability_error", "repeated_offset_clock_inconsistency",
      "unsupported_assisted_understanding_summary", "unsupported_assisted_profile_update"].includes(entry.probe_id);
    const expectedSourceKind = ["accurate_closing_recap", "truthful_initial_reason_attribution"].includes(entry.probe_id) || previouslyAcceptedNative ? "preserved_synthetic_native"
      : ["unsolicited_teaching_after_stop", "source_compatible_pause_summary"].includes(entry.probe_id) ? "preserved_synthetic_replay_draft"
        : ["unsupported_pause_agenda", "respected_deferral", "honest_student_stop"].includes(entry.probe_id) ? "preserved_synthetic_replay" : "authored_synthetic_control";
    if (probe.version !== "conversation-delivery-review-probe-v1" || probe.id !== entry.probe_id || probe.synthetic_only !== true ||
        probe.expected_verdict !== expectedVerdict || probe.source_kind !== expectedSourceKind ||
        probe.base_fixture_sha256 !== entry.fixture.sha256 || fixture.synthetic_only !== true ||
        started.review_probe !== entry.probe_id || started.review_probe_sha256 !== entry.probe.sha256 ||
        started.attempt !== entry.attempt_id || started.runtime_hash !== entryRuntime ||
        proof.version !== "conversation-delivery-review-probe-proof-v1" || proof.probe_id !== entry.probe_id ||
        proof.probe_sha256 !== entry.probe.sha256 || proof.runtime_hash !== entryRuntime ||
        proof.reviewer_prompt_hash !== reviewerHash || proof.model_name !== reviewerModel || proof.reasoning_effort !== "medium" ||
        proof.max_output_tokens !== (reviewerVersion === "conversation-delivery-review-v8" ? 4000 : 2500) || proof.request_schema_name !== reviewerVersion ||
        proof.expected_verdict_sent_to_provider !== false || proof.tutor_generations !== 0 || proof.database_reads !== 0 || proof.database_writes !== 0 ||
        !digest.safeParse(proof.compiled_request_sha256).success || !digest.safeParse(proof.canonical_request_hash).success) {
      throw new Error("Reviewer-only probe source or actual request identity mismatch.");
    }
    if (!historical && deliveryReviewModel && (proof.execution_policy_version !== LUNA_SOL_DELIVERY_REVIEW_POLICY_VERSION ||
        proof.diagnostic_only !== false || proof.candidate_validation_eligible !== true || proof.model_override !== undefined)) {
      throw new Error("Selected reviewer probe is not the exact approved child policy.");
    }
    const nativeSources = z.record(digest).parse(started.source_files_sha256);
    if (entryRequiredSources.some(file => !entrySources[file] || nativeSources[file] !== entrySources[file]) ||
        (historical && Object.entries(entrySources).some(([file, hash]) => nativeSources[file] !== hash))) throw new Error("Reviewer-probe source inventory mismatch.");
    const declaredSources = z.array(file).parse(probe.sources);
    if (declaredSources.length !== entry.probe_sources.length ||
        declaredSources.some((source, index) => source.sha256 !== entry.probe_sources[index].sha256)) {
      throw new Error("Reviewer-probe preserved source inventory differs.");
    }
    const preserved = entry.probe_sources.map(readValue);
    const { input: expectedInput, context: probeContext, candidate: probeCandidate } = buildBoundDeliveryProbeInput(probe, preserved, reviewerVersion);
    if (hashObject(input) !== hashObject(expectedInput) || proof.input_sha256 !== hashObject(input) ||
        proof.draft_sha256 !== hashObject(probe.draft_message)) throw new Error("Reviewer-only probe input contains changed or extra context.");
    const qualitySources = nativeObject.parse(quality.sources);
    if (quality.probe_id !== entry.probe_id || quality.attempt_id !== entry.attempt_id || quality.review_complete !== true ||
        quality.synthetic_only !== true || quality.runtime_hash !== entryRuntime || typeof quality.overall_release_accepted !== "boolean") {
      throw new Error("Reviewer-probe qualitative identity is incomplete.");
    }
    for (const key of ["probe", "started", "request_proof", "input", "result", "report", "transport_usage"] as const) {
      if (file.parse(qualitySources[key]).sha256 !== entry[key].sha256) throw new Error("Reviewer-probe qualitative review does not bind exact native bytes.");
    }
    const reviewedRows = z.array(nativeObject).parse(read(entry.transport_usage).requests);
    if (reviewedRows.length !== entry.transport_request_indices.length) throw new Error("Reviewer-probe transport inventory differs.");
    const rows = entry.transport_request_indices.map(index => {
      const row = transport.find(row => row.request_index === index), local = reviewedRows.find(row => row.request_index === index);
      if (!row || !local || used.has(index) || row.attempt_id !== entry.attempt_id ||
          ["attempt_id", "model_name", "agent_name", "category", "status", "provider_response_id"].some(key => local[key] !== row[key as keyof TransportRow]) ||
          hashObject(local.usage) !== hashObject(row.usage) || row.model_name !== reviewerModel ||
          row.agent_name !== "formative_conversation_agent" || row.category !== "application") {
        throw new Error("Reviewer-probe transport differs from retained shared usage.");
      }
      if (selected && (local.request_format_sha256 !== row.request_format_sha256 ||
          row.request_format_sha256 !== hashObject(zodTextFormat(ConversationDeliveryReviewSchema, LUNA_CONVERSATION_DELIVERY_REVIEW_VERSION)))) {
        throw new Error("Reviewer-probe physical request format differs from the current compiled schema.");
      }
      if (reviewerModel === LUNA_SOL_DELIVERY_REVIEW_MODEL) verifyMixedReviewTransport(row);
      used.add(index); return row;
    });
    if (!selected) {
      if (priorEntry?.disposition === "failed" && quality.overall_release_accepted !== false) throw new Error("Failed reviewer probe cannot be relabeled accepted.");
      continue;
    }
    if (["discrimination_accepted", "source_scope_accepted", "overall_release_accepted"].some(key => quality[key] !== true) ||
        !z.string().trim().min(1).safeParse(quality.reviewer_attestation).success || !z.array(z.string().min(1)).safeParse(quality.limitations).success ||
        result.status !== "completed" || result.matches_expected !== true || result.expected_verdict !== expectedVerdict ||
        result.observed_verdict !== expectedVerdict || report.status !== "probe_expected_verdict_matched" ||
        report.runtime_hash !== entryRuntime || report.matches_expected !== true || report.source_binding_valid !== true ||
        report.expected_verdict !== expectedVerdict || report.observed_verdict !== expectedVerdict ||
        ["input_sha256", "draft_sha256", "compiled_request_sha256", "canonical_request_hash", "reviewer_prompt_hash"].some(key => report[key] !== proof[key])) {
      throw new Error("Selected reviewer discrimination probe did not pass explicit engineering review.");
    }
    const execution = nativeObject.parse(result.transport), acceptedResult = nativeObject.parse(execution.accepted_result);
    const checked = validateConversationDeliveryReview(acceptedResult.parsed_output,
      probeContext,
      z.string().parse(probe.draft_message), probeCandidate);
    if (!checked.valid || checked.review?.verdict !== expectedVerdict || execution.status !== "accepted" ||
        execution.canonical_request_hash !== proof.canonical_request_hash || acceptedResult.provider !== "openai" ||
        acceptedResult.status !== "completed" || acceptedResult.raw_output == null) throw new Error("Reviewer-probe provider output is missing or source-invalid.");
    const traces = z.array(nativeObject).min(1).max(3).parse(execution.attempt_traces);
    if (traces.filter(trace => nativeObject.parse(trace.transport_milestones).fetch_invoked === true).length !== rows.length ||
        traces.some(trace => trace.canonical_request_hash !== proof.canonical_request_hash)) throw new Error("Reviewer-probe transport attempts are omitted.");
    const id = z.string().min(1).parse(acceptedResult.provider_response_id);
    const match = rows.filter(row => row.provider_response_id === id && row.status === "completed");
    const usage = nativeObject.parse(acceptedResult.usage);
    if (responseIds.has(id) || match.length !== 1 || ["input_tokens", "output_tokens", "total_tokens"].some(key =>
      !z.number().int().positive().safeParse(usage[key]).success || nativeObject.parse(match[0].usage)[key] !== usage[key])) {
      throw new Error("Reviewer-probe accepted response lacks unique exact token usage.");
    }
    responseIds.add(id);
  }
  if (requiredProbes.some(id => !probeIds.has(id)) || probeIds.size !== requiredProbes.length) throw new Error("Every required reviewer discrimination probe must pass.");
  if ("historical_diagnostics" in evidence) verifyHistoricalDeliveryDiagnostics(evidence, transport, used);
  for (const row of transport) if (typeof row.attempt_id === "string" && (row.attempt_id.startsWith("repair-replay-") || row.attempt_id.startsWith("repair-reviewdiag-")) && !used.has(row.request_index)) {
    throw new Error("A replay dispatch was omitted from the retained attempt inventory.");
  }
  return { evidence, used_indices: [...used] };
}
