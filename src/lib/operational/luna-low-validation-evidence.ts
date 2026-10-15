import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { zodTextFormat } from "openai/helpers/zod";
import { studentProfileRequestOutputSchema } from "../agents/student-profiling/output-schema";
import { ProductionStudentProfileOutputV6, StudentProfilingInput } from "../agents/contracts";
import { validateStudentProfileStrongPartialReasoningSupport } from "../agents/student-profiling/semantic-validation";
import { APPROVED_OPERATIONAL_ROLE_NAMES, ApprovedCandidateManifestSchema } from "./active-approval-bundle";
import { modelUpgradeCandidateRuntimeHash } from "./model-upgrade-candidate-identity";
import { CONVERSATIONAL_SUPPORT_NEEDS_SCENARIOS } from "../evaluation/conversational-support-needs-scenarios";
import { CONVERSATIONAL_RELIABILITY_SCENARIOS } from "../evaluation/conversational-reliability-scenarios";
import { verifyConversationReplayValidation, verifySelectedConversationPlanAudit, verifySelectedConversationDeliveryAudit, verifyMixedReviewTransport,
  historicalConversationDeliveryModel, historicalConversationRequiredSources } from "./luna-conversation-replay-evidence";
import { LUNA_MEDIUM_PROFILE_FIDELITY_VALIDATION_VERSION, LUNA_PROFILE_FIDELITY_SOURCE_FILES,
  type LUNA_PROFILE_FIDELITY_CORRECTION } from "./luna-profile-fidelity-identity";
import { MIXED_TUTOR_MODEL, MIXED_TUTOR_ROLE, MIXED_TUTOR_VALIDATION_VERSION, MIXED_TUTOR_SOURCE_FILES,
  lunaCandidateModelForRole } from "./mixed-tutor-identity";
import { LUNA_CONVERSATION_REPAIR, LUNA_CONVERSATION_REPAIR_VALIDATION_VERSION,
  LUNA_CONVERSATION_REPAIR_SOURCE_FILES, LUNA_CONVERSATION_REPAIR_PROMPT_HASH,
  LUNA_CONVERSATION_PROFILE_PROMPT_VERSION, LUNA_CONVERSATION_PROFILE_PROMPT_HASH,
  LUNA_CONVERSATION_PROFILE_SCHEMA_VERSION, LUNA_SOL_DELIVERY_REVIEW_MODEL, LUNA_SOL_DELIVERY_REVIEW_VALIDATION_VERSION } from "./luna-conversation-repair-identity";

export const LUNA_LOW_ALL_ROLES_VALIDATION_VERSION = "luna-low-all-roles-validation-v1";
export const LUNA_MEDIUM_ALL_ROLES_VALIDATION_VERSION = "luna-medium-all-roles-validation-v1";
export type LunaCandidateReasoningEffort = "low" | "medium";
// Selected current profile evidence must carry the exact new provenance field.
// Historical native attempts below retain their original schema and validators.
export function verifySelectedConversationProfileSupport(inputValue: unknown, outputValue: unknown) {
  const input = StudentProfilingInput.parse(inputValue), output = ProductionStudentProfileOutputV6.parse(outputValue);
  if (input.profiling_constraints.fact_binding_version !== "student-profile-fact-binding-v3" ||
      input.profiling_constraints.output_schema_version !== LUNA_CONVERSATION_PROFILE_SCHEMA_VERSION ||
      validateStudentProfileStrongPartialReasoningSupport({ providerInput: input, output }).length > 0) {
    throw new Error("Selected current profile lacks valid source-bound strong-partial-reasoning evidence.");
  }
  return output;
}

export function selectedProfileRequestFormatSha256(inputValue: unknown) {
  const schema = studentProfileRequestOutputSchema(StudentProfilingInput.parse(inputValue));
  return createHash("sha256").update(JSON.stringify(zodTextFormat(schema, "student-profile-output-v6"))).digest("hex");
}

// A semantic repair is a separate persisted AgentCall. Check every original
// profiling call, including rejected drafts, before selecting the final profile.
// Unmatched physical rows cannot borrow another call's catalog or format.
export function verifySelectedProfileRequestFormats(callsValue: unknown, transportValue: unknown) {
  const object = z.record(z.unknown());
  const calls = z.array(object).parse(callsValue).filter(call => call.provider === "openai" && call.agent_name === "student_profiling_agent");
  const rows = z.array(object).parse(transportValue).filter(row => row.category === "application" && row.agent_name === "student_profiling_agent");
  const bound = new Set<string>();
  for (const call of calls) {
    const id = z.string().min(1).parse(call.provider_response_id);
    const matches = rows.filter(row => row.provider_response_id === id);
    if (bound.has(id) || matches.length !== 1 || matches[0].model_name !== "gpt-5.6-luna" ||
        matches[0].request_format_sha256 !== selectedProfileRequestFormatSha256(call.input_payload)) {
      throw new Error("Selected profiling request format does not bind its exact original base or repair context.");
    }
    bound.add(id);
  }
  if (rows.length !== bound.size) throw new Error("Selected profiling physical request lacks an exact persisted input context.");
  return { bound_requests: bound.size };
}
export const LUNA_LOW_REQUIRED_SCENARIOS = [
  "persistent_prerequisite_confusion", "partial_progress_many_difficulties",
  "guessing_agreement_not_understanding", "confident_error_resists_explanation",
  "overwhelmed_pause_return", "brief_language_sound_reasoning", "strong_prior_reasoning_comparison"
] as const;
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const fileReference = z.object({ path: z.string().min(1), sha256: digest }).strict();
const indices = z.array(z.number().int().positive());
export const LunaLowAllRolesValidationSchema = z.object({
  version: z.literal(LUNA_LOW_ALL_ROLES_VALIDATION_VERSION),
  synthetic_only: z.literal(true), real_student_data_used: z.literal(false), provider: z.literal("openai"),
  runtime_candidate_hash: digest, all_role_configs_checked: z.literal(true), regression_passed: z.literal(true),
  results_reviewed: z.literal(true), review_method: z.literal("engineering_contract_and_transcript_review"),
  journey_runs: z.array(z.object({
    report: fileReference,
    agent_calls: z.array(z.object({ case_id: z.enum(LUNA_LOW_REQUIRED_SCENARIOS), artifact: fileReference }).strict()).min(1),
    transport_request_indices: indices.min(1)
  }).strict()).min(1),
  transport_usage: fileReference,
  reviewed_limitations: z.array(z.object({ case_id: z.enum(LUNA_LOW_REQUIRED_SCENARIOS),
    limitation: z.string().trim().min(1) }).strict()),
  // Earlier failed or superseded runs remain hash-bound. They cannot satisfy a required case.
  prior_attempts: z.array(z.object({ report: fileReference, transport_request_indices: indices,
    reason: z.string().trim().min(1) }).strict())
}).strict();

// A separate version prevents historic low evidence from authorizing medium.
export const LunaMediumAllRolesValidationSchema = LunaLowAllRolesValidationSchema.extend({
  version: z.literal(LUNA_MEDIUM_ALL_ROLES_VALIDATION_VERSION)
}).strict();

const LunaMediumProfileFidelityValidationSchema = LunaMediumAllRolesValidationSchema.extend({
  version: z.literal(LUNA_MEDIUM_PROFILE_FIDELITY_VALIDATION_VERSION),
  corrected_source_files_sha256: z.record(digest),
  case_reviews: z.array(z.object({
    case_id: z.enum(LUNA_LOW_REQUIRED_SCENARIOS),
    profile_fidelity_accepted: z.literal(true),
    student_question_coverage_accepted: z.literal(true),
    limitations: z.array(z.string().trim().min(1))
  }).strict()).length(LUNA_LOW_REQUIRED_SCENARIOS.length)
}).strict();

// Mechanical completion and narrow fidelity checks do not imply overall quality.
// This new identity requires an explicit overall decision for every case; the
// preserved all-Luna evidence formats are intentionally unchanged.
export const MixedTutorProfileFidelityValidationSchema = LunaMediumProfileFidelityValidationSchema.extend({
  version: z.literal(MIXED_TUTOR_VALIDATION_VERSION),
  overall_release_accepted: z.literal(true),
  case_reviews: z.array(LunaMediumProfileFidelityValidationSchema.shape.case_reviews.element.extend({
    overall_release_accepted: z.literal(true)
  }).strict()).length(LUNA_LOW_REQUIRED_SCENARIOS.length)
}).strict();

export const CONVERSATION_RELIABILITY_ADDITIONAL_CASES = ["student_understood_ready", "more_help_after_polite_agreement", "maximum_length_unresolved_support"] as const;
const allReliabilityCases = [...LUNA_LOW_REQUIRED_SCENARIOS, ...CONVERSATION_RELIABILITY_ADDITIONAL_CASES] as const;
const conversationQualityReview = MixedTutorProfileFidelityValidationSchema.shape.case_reviews.element.omit({ case_id: true }).extend({
  conversation_continuity_accepted: z.literal(true), grounded_completion_accepted: z.literal(true), student_support_quality_accepted: z.literal(true)
}).strict();
const additionalCaseEvidence = z.object({ report: fileReference, agent_calls: fileReference,
  transport_request_indices: indices.min(1), review: conversationQualityReview }).strict();
export const LunaConversationRepairValidationSchema = MixedTutorProfileFidelityValidationSchema.extend({
  version: z.literal(LUNA_CONVERSATION_REPAIR_VALIDATION_VERSION),
  case_reviews: z.array(MixedTutorProfileFidelityValidationSchema.shape.case_reviews.element.extend({
    conversation_continuity_accepted: z.literal(true),
    grounded_completion_accepted: z.literal(true),
    student_support_quality_accepted: z.literal(true)
  }).strict()).length(LUNA_LOW_REQUIRED_SCENARIOS.length),
  additional_case_evidence: z.object({
    student_understood_ready: additionalCaseEvidence,
    more_help_after_polite_agreement: additionalCaseEvidence,
    maximum_length_unresolved_support: additionalCaseEvidence
  }).strict(),
  repeated_replay_validation: fileReference,
  // Earlier runtimes retain their own exact candidate and source identity. They
  // cannot contribute a selected case or be reinterpreted by current validators.
  historical_native_attempts: z.array(z.object({
    attempt_id: z.string().regex(/^repair-e2e-/), case_id: z.enum(allReliabilityCases),
    report: fileReference, agent_calls: fileReference, started: fileReference,
    transport_usage: fileReference, qualitative_review: fileReference,
    transport_request_indices: indices,
    reason: z.string().trim().min(1),
    disposition: z.enum(["mechanical_failure", "qualitative_rejection", "superseded"]),
    historical_identity: z.object({ runtime_candidate_hash: digest,
      source_files_sha256: z.record(digest), candidate_manifest: fileReference,
      candidate_record: fileReference }).strict()
  }).strict())
}).strict();

export const LunaSolDeliveryReviewValidationSchema = LunaConversationRepairValidationSchema.extend({
  version: z.literal(LUNA_SOL_DELIVERY_REVIEW_VALIDATION_VERSION)
}).strict();

const usageSchema = z.object({ input_tokens: z.number().int().positive(), output_tokens: z.number().int().positive(),
  total_tokens: z.number().int().positive().optional() }).passthrough();
const reportHeaderSchema = z.object({
  version: z.literal("ai-student-journeys-v3"), suite: z.literal("conversational-support-needs"),
  synthetic_only: z.literal(true), real_student_records_used: z.literal(false), runtime_hash: digest,
  source_commit: z.string().regex(/^[a-f0-9]{40}$/), source_files_sha256: z.record(digest),
  student_model: z.object({ model_name: z.literal("gpt-5.6-luna"), reasoning_effort: z.enum(["low", "medium"]) }).passthrough(),
  provider_dispatches: z.number().int().nonnegative(), provider_models: z.record(z.number().int().positive()),
  finished_at: z.string().datetime(), results: z.array(z.object({ case_id: z.enum(LUNA_LOW_REQUIRED_SCENARIOS),
    outcome: z.string().min(1) }).passthrough()).min(1)
}).passthrough();
const passedCaseSchema = z.object({
  case_id: z.enum(LUNA_LOW_REQUIRED_SCENARIOS), session_public_id: z.string().min(1),
  outcome: z.literal("mechanical_checks_passed_manual_pedagogical_review_required"),
  validated_live_initial_profile_calls: z.literal(1),
  preparation: z.object({ status: z.literal("completed") }).passthrough(),
  application_usage: z.object({ calls: z.number().int().positive(), rejected_or_failed_calls: z.array(z.unknown()),
    token_budget_failures: z.number().int().nonnegative(), input_tokens: z.number().int().positive(), output_tokens: z.number().int().positive() }).passthrough(),
  generated_student_replies: z.array(z.object({ source: z.enum(["scripted_edge_case", "adaptive_ai"]),
    usage: usageSchema.nullable() }).passthrough()),
  research_manifest_entries_verified: z.number().int().positive(), exported_turn_count: z.number().int().positive(),
  transcript: z.array(z.object({ actor: z.enum(["student", "tutor"]) }).passthrough())
}).passthrough();
const reliabilityReportHeaderSchema = reportHeaderSchema.extend({
  suite: z.enum(["conversational-support-needs", "conversational-reliability"]),
  results: z.array(reportHeaderSchema.shape.results.element.extend({ case_id: z.enum(allReliabilityCases) })).min(1)
});
const reliabilityPassedCaseSchema = passedCaseSchema.extend({ case_id: z.enum(allReliabilityCases) });
const agentCallSchema = z.object({
  agent_name: z.string().min(1), provider: z.string(), model_name: z.string(),
  reasoning_effort: z.string().nullable(), output_validated: z.boolean(), call_status: z.string(),
  input_tokens: z.number().int().nonnegative().nullable(), output_tokens: z.number().int().nonnegative().nullable(),
  provider_response_id: z.string().nullable(), raw_output: z.unknown().optional(),
  prompt_version: z.string().optional(), prompt_hash: z.string().optional(), schema_version: z.string().optional()
}).passthrough();
const transportSchema = z.object({ version: z.literal("ai-session-transport-usage-v1"), requests: z.array(z.object({
  request_index: z.number().int().positive(), case_id: z.string().nullable(),
  category: z.enum(["application", "simulator_learner", "unknown"]), model_name: z.string(), status: z.string(),
  agent_name: z.string().nullable().optional(),
  usage: z.unknown(), provider_response_id: z.string().nullable()
}).passthrough()) }).passthrough();

function readBoundJson(reference: z.infer<typeof fileReference>) {
  if (!path.isAbsolute(reference.path)) throw new Error("Luna-low evidence paths must be absolute.");
  const bytes = readFileSync(reference.path);
  if (createHash("sha256").update(bytes).digest("hex") !== reference.sha256) {
    throw new Error("Luna-low evidence integrity mismatch.");
  }
  return JSON.parse(bytes.toString("utf8")) as unknown;
}

// This validates retained native engineering evidence, not educational effectiveness.
// File hashes establish integrity/provenance, not independent provider attestation.
export function verifyLunaLowValidation(reference: z.infer<typeof fileReference>, runtimeHash: string) {
  return verifyLunaValidation(reference, runtimeHash, "low");
}

export function verifyLunaValidation(reference: z.infer<typeof fileReference>, runtimeHash: string,
  reasoningEffort: LunaCandidateReasoningEffort, profileCorrection?: typeof LUNA_PROFILE_FIDELITY_CORRECTION,
  tutorModel?: typeof MIXED_TUTOR_MODEL, conversationRepair?: typeof LUNA_CONVERSATION_REPAIR, deliveryReviewModel?: typeof LUNA_SOL_DELIVERY_REVIEW_MODEL) {
  z.enum(["low", "medium"]).parse(reasoningEffort);
  if (profileCorrection && (profileCorrection !== "profile-fidelity-v1" || reasoningEffort !== "medium")) {
    throw new Error("The profile-fidelity correction requires its exact medium-only validation scope.");
  }
  if (tutorModel !== undefined && (tutorModel !== MIXED_TUTOR_MODEL || reasoningEffort !== "medium" ||
      profileCorrection !== "profile-fidelity-v1")) {
    throw new Error("Mixed tutor validation requires the exact medium profile-fidelity scope.");
  }
  if (conversationRepair !== undefined && (conversationRepair !== LUNA_CONVERSATION_REPAIR || reasoningEffort !== "medium" ||
      profileCorrection !== "profile-fidelity-v1" || tutorModel !== undefined)) {
    throw new Error("Conversation-reliability validation requires the exact all-Luna medium scope.");
  }
  if (deliveryReviewModel !== undefined && (deliveryReviewModel !== LUNA_SOL_DELIVERY_REVIEW_MODEL || !conversationRepair || tutorModel !== undefined)) {
    throw new Error("Mixed delivery review requires the exact all-Luna conversation-reliability scope.");
  }
  const schema = deliveryReviewModel ? LunaSolDeliveryReviewValidationSchema : conversationRepair ? LunaConversationRepairValidationSchema : tutorModel ? MixedTutorProfileFidelityValidationSchema : profileCorrection ? LunaMediumProfileFidelityValidationSchema :
    reasoningEffort === "low" ? LunaLowAllRolesValidationSchema : LunaMediumAllRolesValidationSchema;
  const validation = schema.parse(readBoundJson(reference));
  const reliability = (validation.version === LUNA_CONVERSATION_REPAIR_VALIDATION_VERSION || validation.version === LUNA_SOL_DELIVERY_REVIEW_VALIDATION_VERSION) ? validation : null;
  const corrected = validation.version === LUNA_MEDIUM_PROFILE_FIDELITY_VALIDATION_VERSION ||
    validation.version === MIXED_TUTOR_VALIDATION_VERSION || (validation.version === LUNA_CONVERSATION_REPAIR_VALIDATION_VERSION || validation.version === LUNA_SOL_DELIVERY_REVIEW_VALIDATION_VERSION) ? validation : null;
  const requiredSources = conversationRepair ? LUNA_CONVERSATION_REPAIR_SOURCE_FILES : tutorModel ? MIXED_TUTOR_SOURCE_FILES : LUNA_PROFILE_FIDELITY_SOURCE_FILES;
  if (corrected && (new Set(corrected.case_reviews.map(row => row.case_id)).size !== LUNA_LOW_REQUIRED_SCENARIOS.length ||
      requiredSources.some(file => !corrected.corrected_source_files_sha256[file]))) {
    throw new Error("Corrected profile evaluation requires every case review and exact changed-source inventory.");
  }
  if (validation.runtime_candidate_hash !== runtimeHash) throw new Error("Luna-low validation candidate mismatch.");
  const transport = transportSchema.parse(readBoundJson(validation.transport_usage));
  const requests = new Map(transport.requests.map(row => [row.request_index, row]));
  if (requests.size !== transport.requests.length) throw new Error("Duplicate transport request index.");
  const usedIndices = new Set<number>();
  if (reliability) {
    const replay = verifyConversationReplayValidation(reliability.repeated_replay_validation, runtimeHash,
      reliability.corrected_source_files_sha256, requiredSources, transport.requests, LUNA_CONVERSATION_REPAIR_PROMPT_HASH, deliveryReviewModel);
    for (const index of replay.used_indices) usedIndices.add(index);
  }
  const seenReports = new Set<string>();
  const seenCases = new Set<string>();
  const seenSessions = new Set<string>();
  const seenResponses = new Set<string>();
  const limitationReviewed = (caseId: string | null) => validation.reviewed_limitations.some(row => row.case_id === caseId) ||
    Boolean(reliability && caseId && CONVERSATION_RELIABILITY_ADDITIONAL_CASES.some(id => id === caseId) &&
      reliability.additional_case_evidence[caseId as typeof CONVERSATION_RELIABILITY_ADDITIONAL_CASES[number]].review.limitations.length > 0);
  const readRun = (reference: z.infer<typeof fileReference>, selected: number[], accepted = true) => {
    const reportPath = path.resolve(reference.path);
    if (seenReports.has(reportPath)) throw new Error("Duplicate journey report.");
    seenReports.add(reportPath);
    const report = (reliability ? reliabilityReportHeaderSchema : reportHeaderSchema).parse(readBoundJson(reference));
    if (accepted && corrected && requiredSources.some(file =>
      report.source_files_sha256[file] !== corrected.corrected_source_files_sha256[file])) {
      throw new Error("Native corrected-profile source provenance mismatch.");
    }
    if (report.runtime_hash !== runtimeHash || report.student_model.reasoning_effort !== reasoningEffort ||
        Object.keys(report.source_files_sha256).length === 0 ||
        (accepted ? report.provider_dispatches !== selected.length : report.provider_dispatches < selected.length) ||
        Object.entries(report.provider_models).some(([model]) => model !== "gpt-5.6-luna" && model !== tutorModel && model !== deliveryReviewModel) ||
        Object.values(report.provider_models).reduce((sum, count) => sum + count, 0) !== report.provider_dispatches) {
      throw new Error("Native journey runtime/source/dispatch evidence mismatch.");
    }
    const cases = new Set(report.results.map(row => row.case_id));
    if (cases.size !== report.results.length) throw new Error("Duplicate case in native journey report.");
    const selectedRows = selected.map(index => {
      const row = requests.get(index);
      if (!row || usedIndices.has(index) || !cases.has(row.case_id as typeof allReliabilityCases[number])) {
        throw new Error("Journey transport selection missing, duplicated or belongs to another case.");
      }
      usedIndices.add(index);
      return row;
    });
    if ((tutorModel || conversationRepair) && accepted) {
      for (const [model, count] of Object.entries(report.provider_models)) {
        if (selectedRows.filter(row => row.model_name === model).length !== count) {
          throw new Error("Mixed tutor native and transport model counts differ.");
        }
      }
    }
    return { report, selectedRows };
  };
  const selectedRuns = [...validation.journey_runs, ...(reliability ? CONVERSATION_RELIABILITY_ADDITIONAL_CASES.map(case_id => {
    const evidence = reliability.additional_case_evidence[case_id];
    return { report: evidence.report, agent_calls: [{ case_id, artifact: evidence.agent_calls }], transport_request_indices: evidence.transport_request_indices };
  }) : [])];
  for (const run of selectedRuns) {
    const { report, selectedRows } = readRun(run.report, run.transport_request_indices);
    if (run.agent_calls.length !== report.results.length || new Set(run.agent_calls.map(item => item.case_id)).size !== run.agent_calls.length) {
      throw new Error("Native AgentCall inventory mismatch.");
    }
    for (const row of selectedRows) {
      const expectedModel = tutorModel && row.category === "application"
        ? lunaCandidateModelForRole(row.agent_name ?? "", tutorModel) : "gpt-5.6-luna";
      if (deliveryReviewModel && row.model_name === deliveryReviewModel) verifyMixedReviewTransport(row);
      if ((row.model_name !== expectedModel && !(deliveryReviewModel && row.model_name === deliveryReviewModel)) || row.category === "unknown" ||
          (row.provider_response_id !== null && seenResponses.has(row.provider_response_id))) {
        throw new Error("Accepted journey transport model/status/identity evidence mismatch.");
      }
      if (conversationRepair && (!usageSchema.safeParse(row.usage).success || !row.provider_response_id)) {
        throw new Error("Current selected journey requires known usage for every physical request; a limitation cannot replace it.");
      }
      if ((!usageSchema.safeParse(row.usage).success || row.status !== "completed" || !row.provider_response_id) &&
          !limitationReviewed(row.case_id)) throw new Error("Incomplete or failed transport requires a retained reviewed limitation.");
      if (row.provider_response_id) seenResponses.add(row.provider_response_id);
    }
    for (const result of report.results) {
      const passed = (reliability ? reliabilityPassedCaseSchema : passedCaseSchema).parse(result);
      if (seenCases.has(passed.case_id) || seenSessions.has(passed.session_public_id)) throw new Error("Duplicate accepted scenario or session.");
      seenCases.add(passed.case_id); seenSessions.add(passed.session_public_id);
      const bound = run.agent_calls.find(item => item.case_id === passed.case_id);
      const expectedPath = path.join(path.dirname(run.report.path), `${passed.case_id}-agent-calls.json`);
      if (!bound || path.resolve(bound.artifact.path) !== path.resolve(expectedPath)) {
        throw new Error("AgentCall artifact must be the native report sibling for its case.");
      }
      const calls = z.array(agentCallSchema).min(1).parse(readBoundJson(bound.artifact));
      const liveAccepted = calls.filter(call => call.provider === "openai" && call.call_status === "succeeded" && call.output_validated);
      const rejected = calls.filter(call => call.call_status !== "succeeded" || !call.output_validated);
      const expectedReplies = (reliability ? CONVERSATIONAL_RELIABILITY_SCENARIOS : CONVERSATIONAL_SUPPORT_NEEDS_SCENARIOS).find(scenario => scenario.id === passed.case_id)!.followupTurns!;
      if (conversationRepair && liveAccepted.filter(call => call.agent_name === "formative_conversation_agent").length !== expectedReplies + 1) {
        throw new Error("Conversation-reliability requires every saved tutor reply to have a validated live call.");
      }
      if (calls.length !== passed.application_usage.calls ||
          liveAccepted.filter(call => call.agent_name === "student_profiling_agent").length !== 1 ||
          !liveAccepted.some(call => call.agent_name === "formative_conversation_agent") ||
          rejected.length !== passed.application_usage.rejected_or_failed_calls.length ||
          calls.reduce((sum, call) => sum + (call.input_tokens ?? 0), 0) !== passed.application_usage.input_tokens ||
          calls.reduce((sum, call) => sum + (call.output_tokens ?? 0), 0) !== passed.application_usage.output_tokens ||
          passed.generated_student_replies.length !== expectedReplies || passed.exported_turn_count !== expectedReplies * 2 + 1 ||
          passed.transcript.filter(turn => turn.actor === "student").length !== expectedReplies ||
          passed.transcript.filter(turn => turn.actor === "tutor").length !== expectedReplies + 1) {
        throw new Error("Native AgentCall counts/profile/usage do not match journey results.");
      }
      if ((rejected.length > 0 || passed.application_usage.token_budget_failures > 0 || calls.some(call => call.provider !== "openai")) &&
          !limitationReviewed(passed.case_id)) throw new Error("Recovered, deterministic or failed calls require a reviewed limitation.");
      const caseRows = selectedRows.filter(row => row.case_id === passed.case_id);
      if (conversationRepair) verifySelectedProfileRequestFormats(calls, caseRows);
      const callResponseIds = new Set<string>();
      for (const call of calls) {
        if (call.provider !== "openai") {
          if (!["mock", "deterministic"].includes(call.provider) || (call.input_tokens ?? 0) !== 0 ||
              (call.output_tokens ?? 0) !== 0 || call.provider_response_id) {
            throw new Error("Non-OpenAI rows must be unpaid deterministic records.");
          }
          continue;
        }
        if (call.model_name !== lunaCandidateModelForRole(call.agent_name, tutorModel) || call.reasoning_effort !== reasoningEffort) {
          throw new Error("Actual OpenAI call model/reasoning mismatch.");
        }
        if (call.call_status !== "succeeded" || !call.output_validated) continue;
        if (conversationRepair && call.agent_name === "student_profiling_agent" &&
            (call.prompt_version !== LUNA_CONVERSATION_PROFILE_PROMPT_VERSION ||
              call.prompt_hash !== LUNA_CONVERSATION_PROFILE_PROMPT_HASH || call.schema_version !== LUNA_CONVERSATION_PROFILE_SCHEMA_VERSION)) {
          throw new Error("Conversation-reliability native profiling identity does not match the frozen typed-support contract.");
        }
        if (conversationRepair && call.agent_name === "student_profiling_agent") {
          verifySelectedConversationProfileSupport(call.input_payload, call.output_payload);
        }
        if (conversationRepair && call.agent_name === "formative_conversation_agent" &&
            (call.prompt_version !== "formative-conversation-host-v7.21" ||
             call.prompt_hash !== LUNA_CONVERSATION_REPAIR_PROMPT_HASH ||
             call.schema_version !== "formative-conversation-profile-proposal-output-v1")) {
          throw new Error("Conversation-reliability native tutor prompt or wire schema does not match the frozen contract.");
        }
        const matched = caseRows.find(row => row.category === "application" && row.status === "completed" &&
          row.provider_response_id === call.provider_response_id);
        if (!call.provider_response_id || callResponseIds.has(call.provider_response_id) || !matched ||
            ((tutorModel || conversationRepair) && (matched.model_name !== call.model_name ||
              (matched.agent_name && matched.agent_name !== call.agent_name) ||
              (call.agent_name === MIXED_TUTOR_ROLE && matched.agent_name !== MIXED_TUTOR_ROLE))) ||
            !usageSchema.safeParse(matched.usage).success || !call.input_tokens || !call.output_tokens) {
          throw new Error("Accepted AgentCall lacks matching completed application transport evidence.");
        }
        callResponseIds.add(call.provider_response_id);
        if (conversationRepair && call.agent_name === "formative_conversation_agent") {
          verifySelectedConversationPlanAudit(z.record(z.unknown()).parse(call.raw_output).provider_execution_audit,
            call.provider_response_id, call.input_payload, call.output_payload, call.raw_output);
          const delivery = verifySelectedConversationDeliveryAudit(z.record(z.unknown()).parse(call.raw_output).provider_execution_audit,
            call.provider_response_id, call.input_payload, call.output_payload, caseRows, deliveryReviewModel);
          if (delivery.input_tokens !== call.input_tokens || delivery.output_tokens !== call.output_tokens) {
            throw new Error("Native tutor usage omits its drafts or pre-delivery reviewer calls.");
          }
          for (const id of delivery.provider_response_ids) {
            if (id !== call.provider_response_id && callResponseIds.has(id)) throw new Error("Native tutor/reviewer response is reused.");
            callResponseIds.add(id);
          }
        }
        // Bounded schema/semantic repair drafts may remain in raw_output; final acceptance is mandatory.
      }
      if (deliveryReviewModel && caseRows.some(row => row.model_name === deliveryReviewModel &&
          (!row.provider_response_id || !callResponseIds.has(row.provider_response_id)))) {
        throw new Error("Selected native Sol dispatch is not bound to an actual tutor child receipt.");
      }
      const adaptive = passed.generated_student_replies.filter(reply => reply.source === "adaptive_ai");
      if (adaptive.some(reply => !reply.usage) ||
          caseRows.filter(row => row.category === "simulator_learner" && row.status === "completed").length < adaptive.length) {
        throw new Error("Adaptive learner replies lack positive native/transport usage evidence.");
      }
    }
  }
  // The observer records adapter entry before fetch: interrupted or budget-blocked
  // prior attempts can have fewer actual requests, and must remain retainable.
  for (const prior of validation.prior_attempts) readRun(prior.report, prior.transport_request_indices, false);
  if (reliability) for (const prior of reliability.historical_native_attempts) {
    const identity = prior.historical_identity;
    const manifest = ApprovedCandidateManifestSchema.parse(readBoundJson(identity.candidate_manifest));
    const object = z.record(z.unknown());
    const record = object.parse(readBoundJson(identity.candidate_record));
    const historicalReviewModel = historicalConversationDeliveryModel(manifest, record);
    if (identity.runtime_candidate_hash === runtimeHash ||
        record.active_kind !== "local_candidate_evaluation" || record.validation_pending !== true ||
        record.production_activation_permitted !== false || record.runtime_candidate_hash !== identity.runtime_candidate_hash ||
        modelUpgradeCandidateRuntimeHash(manifest, APPROVED_OPERATIONAL_ROLE_NAMES) !== identity.runtime_candidate_hash ||
        fileReference.parse(record.candidate_manifest).sha256 !== identity.candidate_manifest.sha256 ||
        APPROVED_OPERATIONAL_ROLE_NAMES.some(role => manifest.roles[role]?.model_name !== "gpt-5.6-luna" ||
          manifest.roles[role]?.reasoning_effort !== "medium")) {
      throw new Error("Historical native candidate identity mismatch.");
    }
    const reportPath = path.resolve(prior.report.path);
    if (seenReports.has(reportPath)) throw new Error("Historical native report reused.");
    seenReports.add(reportPath);
    const report = reliabilityReportHeaderSchema.parse(readBoundJson(prior.report));
    const started = object.parse(readBoundJson(prior.started));
    const startedSources = z.record(digest).parse(started.source_files_sha256);
    const legacyReportBeforeFinishInventory = ["conversation-delivery-review-v1", "conversation-delivery-review-v2"].some(version =>
      manifest.configuration_fingerprint.role_version_metadata.formative_conversation_agent.delivery_review_version === version);
    const legacyReportBeforePhysicalUsageInventory =
      manifest.configuration_fingerprint.role_version_metadata.formative_conversation_agent.physical_usage_policy_version === undefined;
    const historicalRequiredSources = historicalConversationRequiredSources(manifest, identity.source_files_sha256, requiredSources);
    if (report.runtime_hash !== identity.runtime_candidate_hash || started.runtime_hash !== identity.runtime_candidate_hash ||
        started.attempt_id !== prior.attempt_id || started.case_id !== prior.case_id || started.synthetic_only !== true ||
        started.real_student_records_used !== false || report.student_model.reasoning_effort !== "medium" ||
        report.results.length !== 1 || report.results[0].case_id !== prior.case_id ||
        historicalRequiredSources.some(file => !identity.source_files_sha256[file] ||
          (report.source_files_sha256[file] !== identity.source_files_sha256[file] &&
            !(report.source_files_sha256[file] === undefined && (
              (legacyReportBeforeFinishInventory && file === "src/lib/services/student-assessment/formative-conversation/finish-assessment.ts") ||
              (legacyReportBeforePhysicalUsageInventory && file === "src/lib/llm/provider-transport-retry.ts")))) ||
          startedSources[file] !== identity.source_files_sha256[file]) ||
        Object.entries(report.source_files_sha256).some(([file, hash]) => identity.source_files_sha256[file] !== hash) ||
        Object.keys(report.provider_models).some(model => model !== "gpt-5.6-luna" && model !== historicalReviewModel) ||
        Object.values(report.provider_models).reduce((sum, count) => sum + count, 0) !== report.provider_dispatches ||
        report.provider_dispatches < prior.transport_request_indices.length ||
        (report.results[0].outcome === "mechanical_checks_passed_manual_pedagogical_review_required" &&
          report.provider_dispatches !== prior.transport_request_indices.length)) {
      throw new Error("Historical native source/report provenance mismatch.");
    }
    // Integrity-bound raw records are retained even when their outputs failed;
    // no current prompt, semantic validator or positive quality gate is applied.
    const calls = z.array(agentCallSchema).parse(readBoundJson(prior.agent_calls));
    const tutorIdentity = manifest.configuration_fingerprint.role_version_metadata.formative_conversation_agent;
    if (calls.some(call => call.provider === "openai" &&
        (call.model_name !== "gpt-5.6-luna" || call.reasoning_effort !== "medium" ||
          (call.agent_name === "formative_conversation_agent" &&
            ((call.prompt_hash !== undefined && call.prompt_hash !== tutorIdentity.prompt_hash) ||
              (call.schema_version !== undefined && call.schema_version !== tutorIdentity.schema_version)))))) {
      throw new Error("Historical native calls do not match their original candidate.");
    }
    // Old native exports omitted prompt/schema columns. Their absent values are
    // unknown at row level, not filled from today's runtime; exact old candidate,
    // started/report source hashes and unchanged raw records bind that history.
    const quality = object.parse(readBoundJson(prior.qualitative_review));
    const qualitySources = object.parse(quality.sources);
    if (quality.attempt_id !== prior.attempt_id || quality.case_id !== prior.case_id ||
        quality.runtime_hash !== identity.runtime_candidate_hash || quality.review_complete !== true ||
        quality.synthetic_only !== true || typeof quality.overall_release_accepted !== "boolean" ||
        (prior.disposition === "qualitative_rejection" && quality.overall_release_accepted !== false) ||
        (prior.disposition === "mechanical_failure" &&
          report.results[0].outcome === "mechanical_checks_passed_manual_pedagogical_review_required")) {
      throw new Error("Historical native review or disposition contradicts retained evidence.");
    }
    for (const key of ["report", "agent_calls", "started", "transport_usage"] as const) {
      if (fileReference.parse(qualitySources[key]).sha256 !== prior[key].sha256) {
        throw new Error("Historical native review does not bind exact source bytes.");
      }
    }
    const sidecar = transportSchema.parse(readBoundJson(prior.transport_usage));
    if (sidecar.requests.length !== prior.transport_request_indices.length) throw new Error("Historical native transport omitted.");
    for (const index of prior.transport_request_indices) {
      const row = requests.get(index), local = sidecar.requests.find(entry => entry.request_index === index);
      if (!row || !local || usedIndices.has(index) || row.attempt_id !== prior.attempt_id ||
          row.case_id !== prior.case_id || JSON.stringify(row) !== JSON.stringify(local) ||
          (row.model_name !== "gpt-5.6-luna" && row.model_name !== historicalReviewModel) || row.category === "unknown") {
        throw new Error("Historical native transport differs from the retained shared ledger.");
      }
      if (row.model_name === LUNA_SOL_DELIVERY_REVIEW_MODEL) verifyMixedReviewTransport(row);
      usedIndices.add(index);
    }
  }
  const requiredCases = reliability ? allReliabilityCases : LUNA_LOW_REQUIRED_SCENARIOS;
  if (seenCases.size !== requiredCases.length || requiredCases.some(caseId => !seenCases.has(caseId))) {
    throw new Error("Every required conversational scenario must pass.");
  }
  for (const row of transport.requests) {
    if (requiredCases.some(caseId => row.case_id === caseId) && !usedIndices.has(row.request_index)) {
      throw new Error("Required-case transport from an earlier attempt was omitted from the retained inventory.");
    }
  }
  return validation;
}
