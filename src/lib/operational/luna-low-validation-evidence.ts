import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { CONVERSATIONAL_SUPPORT_NEEDS_SCENARIOS } from "../evaluation/conversational-support-needs-scenarios";
import { LUNA_MEDIUM_PROFILE_FIDELITY_VALIDATION_VERSION, LUNA_PROFILE_FIDELITY_SOURCE_FILES,
  type LUNA_PROFILE_FIDELITY_CORRECTION } from "./luna-profile-fidelity-identity";
import { MIXED_TUTOR_MODEL, MIXED_TUTOR_ROLE, MIXED_TUTOR_VALIDATION_VERSION, MIXED_TUTOR_SOURCE_FILES,
  lunaCandidateModelForRole } from "./mixed-tutor-identity";

export const LUNA_LOW_ALL_ROLES_VALIDATION_VERSION = "luna-low-all-roles-validation-v1";
export const LUNA_MEDIUM_ALL_ROLES_VALIDATION_VERSION = "luna-medium-all-roles-validation-v1";
export type LunaCandidateReasoningEffort = "low" | "medium";
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
  corrected_source_files_sha256: z.record(z.string(), digest),
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

const usageSchema = z.object({ input_tokens: z.number().int().positive(), output_tokens: z.number().int().positive(),
  total_tokens: z.number().int().positive().optional() }).passthrough();
const reportHeaderSchema = z.object({
  version: z.literal("ai-student-journeys-v3"), suite: z.literal("conversational-support-needs"),
  synthetic_only: z.literal(true), real_student_records_used: z.literal(false), runtime_hash: digest,
  source_commit: z.string().regex(/^[a-f0-9]{40}$/), source_files_sha256: z.record(z.string(), digest),
  student_model: z.object({ model_name: z.literal("gpt-5.6-luna"), reasoning_effort: z.enum(["low", "medium"]) }).passthrough(),
  provider_dispatches: z.number().int().nonnegative(), provider_models: z.record(z.string(), z.number().int().positive()),
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
const agentCallSchema = z.object({
  agent_name: z.string().min(1), provider: z.string(), model_name: z.string(),
  reasoning_effort: z.string().nullable(), output_validated: z.boolean(), call_status: z.string(),
  input_tokens: z.number().int().nonnegative().nullable(), output_tokens: z.number().int().nonnegative().nullable(),
  provider_response_id: z.string().nullable(), raw_output: z.unknown().optional()
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
  tutorModel?: typeof MIXED_TUTOR_MODEL) {
  z.enum(["low", "medium"]).parse(reasoningEffort);
  if (profileCorrection && (profileCorrection !== "profile-fidelity-v1" || reasoningEffort !== "medium")) {
    throw new Error("The profile-fidelity correction requires its exact medium-only validation scope.");
  }
  if (tutorModel !== undefined && (tutorModel !== MIXED_TUTOR_MODEL || reasoningEffort !== "medium" ||
      profileCorrection !== "profile-fidelity-v1")) {
    throw new Error("Mixed tutor validation requires the exact medium profile-fidelity scope.");
  }
  const schema = tutorModel ? MixedTutorProfileFidelityValidationSchema : profileCorrection ? LunaMediumProfileFidelityValidationSchema :
    reasoningEffort === "low" ? LunaLowAllRolesValidationSchema : LunaMediumAllRolesValidationSchema;
  const validation = schema.parse(readBoundJson(reference));
  const corrected = validation.version === LUNA_MEDIUM_PROFILE_FIDELITY_VALIDATION_VERSION ||
    validation.version === MIXED_TUTOR_VALIDATION_VERSION ? validation : null;
  const requiredSources = tutorModel ? MIXED_TUTOR_SOURCE_FILES : LUNA_PROFILE_FIDELITY_SOURCE_FILES;
  if (corrected && (new Set(corrected.case_reviews.map(row => row.case_id)).size !== LUNA_LOW_REQUIRED_SCENARIOS.length ||
      requiredSources.some(file => !corrected.corrected_source_files_sha256[file]))) {
    throw new Error("Corrected profile evaluation requires every case review and exact changed-source inventory.");
  }
  if (validation.runtime_candidate_hash !== runtimeHash) throw new Error("Luna-low validation candidate mismatch.");
  const transport = transportSchema.parse(readBoundJson(validation.transport_usage));
  const requests = new Map(transport.requests.map(row => [row.request_index, row]));
  if (requests.size !== transport.requests.length) throw new Error("Duplicate transport request index.");
  const usedIndices = new Set<number>();
  const seenReports = new Set<string>();
  const seenCases = new Set<string>();
  const seenSessions = new Set<string>();
  const seenResponses = new Set<string>();
  const limitationReviewed = (caseId: string | null) => validation.reviewed_limitations.some(row => row.case_id === caseId);
  const readRun = (reference: z.infer<typeof fileReference>, selected: number[], accepted = true) => {
    const reportPath = path.resolve(reference.path);
    if (seenReports.has(reportPath)) throw new Error("Duplicate journey report.");
    seenReports.add(reportPath);
    const report = reportHeaderSchema.parse(readBoundJson(reference));
    if (accepted && corrected && requiredSources.some(file =>
      report.source_files_sha256[file] !== corrected.corrected_source_files_sha256[file])) {
      throw new Error("Native corrected-profile source provenance mismatch.");
    }
    if (report.runtime_hash !== runtimeHash || report.student_model.reasoning_effort !== reasoningEffort ||
        Object.keys(report.source_files_sha256).length === 0 ||
        (accepted ? report.provider_dispatches !== selected.length : report.provider_dispatches < selected.length) ||
        Object.entries(report.provider_models).some(([model]) => model !== "gpt-5.6-luna" && model !== tutorModel) ||
        Object.values(report.provider_models).reduce((sum, count) => sum + count, 0) !== report.provider_dispatches) {
      throw new Error("Native journey runtime/source/dispatch evidence mismatch.");
    }
    const cases = new Set(report.results.map(row => row.case_id));
    if (cases.size !== report.results.length) throw new Error("Duplicate case in native journey report.");
    const selectedRows = selected.map(index => {
      const row = requests.get(index);
      if (!row || usedIndices.has(index) || !cases.has(row.case_id as typeof LUNA_LOW_REQUIRED_SCENARIOS[number])) {
        throw new Error("Journey transport selection missing, duplicated or belongs to another case.");
      }
      usedIndices.add(index);
      return row;
    });
    if (tutorModel && accepted) {
      for (const [model, count] of Object.entries(report.provider_models)) {
        if (selectedRows.filter(row => row.model_name === model).length !== count) {
          throw new Error("Mixed tutor native and transport model counts differ.");
        }
      }
    }
    return { report, selectedRows };
  };
  for (const run of validation.journey_runs) {
    const { report, selectedRows } = readRun(run.report, run.transport_request_indices);
    if (run.agent_calls.length !== report.results.length || new Set(run.agent_calls.map(item => item.case_id)).size !== run.agent_calls.length) {
      throw new Error("Native AgentCall inventory mismatch.");
    }
    for (const row of selectedRows) {
      const expectedModel = tutorModel && row.category === "application"
        ? lunaCandidateModelForRole(row.agent_name ?? "", tutorModel) : "gpt-5.6-luna";
      if (row.model_name !== expectedModel || row.category === "unknown" ||
          (row.provider_response_id !== null && seenResponses.has(row.provider_response_id))) {
        throw new Error("Accepted journey transport model/status/identity evidence mismatch.");
      }
      if ((!usageSchema.safeParse(row.usage).success || row.status !== "completed" || !row.provider_response_id) &&
          !limitationReviewed(row.case_id)) throw new Error("Incomplete or failed transport requires a retained reviewed limitation.");
      if (row.provider_response_id) seenResponses.add(row.provider_response_id);
    }
    for (const result of report.results) {
      const passed = passedCaseSchema.parse(result);
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
      const expectedReplies = CONVERSATIONAL_SUPPORT_NEEDS_SCENARIOS.find(scenario => scenario.id === passed.case_id)!.followupTurns!;
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
        const matched = caseRows.find(row => row.category === "application" && row.status === "completed" &&
          row.provider_response_id === call.provider_response_id);
        if (!call.provider_response_id || callResponseIds.has(call.provider_response_id) || !matched ||
            (tutorModel && (matched.model_name !== call.model_name ||
              (matched.agent_name && matched.agent_name !== call.agent_name) ||
              (call.agent_name === MIXED_TUTOR_ROLE && matched.agent_name !== MIXED_TUTOR_ROLE))) ||
            !usageSchema.safeParse(matched.usage).success || !call.input_tokens || !call.output_tokens) {
          throw new Error("Accepted AgentCall lacks matching completed application transport evidence.");
        }
        callResponseIds.add(call.provider_response_id);
        // Bounded schema/semantic repair drafts may remain in raw_output; final acceptance is mandatory.
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
  if (seenCases.size !== LUNA_LOW_REQUIRED_SCENARIOS.length ||
      LUNA_LOW_REQUIRED_SCENARIOS.some(caseId => !seenCases.has(caseId))) {
    throw new Error("All seven required conversational-support-needs scenarios must pass.");
  }
  for (const row of transport.requests) {
    if (LUNA_LOW_REQUIRED_SCENARIOS.some(caseId => row.case_id === caseId) && !usedIndices.has(row.request_index)) {
      throw new Error("Required-case transport from an earlier attempt was omitted from the retained inventory.");
    }
  }
  return validation;
}
