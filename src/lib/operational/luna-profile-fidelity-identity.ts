import type { ApprovedCandidateManifest } from "./active-approval-bundle";

export const LUNA_PROFILE_FIDELITY_CORRECTION = "profile-fidelity-v1" as const;
export const LUNA_MEDIUM_PROFILE_FIDELITY_CANDIDATE_VERSION = "luna-medium-profile-fidelity-candidate-v1";
export const LUNA_MEDIUM_PROFILE_FIDELITY_AMENDMENT_VERSION = "luna-medium-profile-fidelity-amendment-v1";
export const LUNA_MEDIUM_PROFILE_FIDELITY_VALIDATION_VERSION = "luna-medium-profile-fidelity-validation-v1";
export const LUNA_PROFILE_FIDELITY_SOURCE_FILES = [
  "src/lib/agents/contracts.ts",
  "src/lib/agents/provider-request.ts",
  "src/lib/agents/prompts/student-profiling/v1.ts",
  "src/lib/agents/student-profiling/input-builder.ts",
  "src/lib/agents/student-profiling/semantic-validation.ts",
  "src/lib/agents/student-profiling/output-schema.ts",
  "src/lib/agents/student-profiling/semantic-repair.ts",
  "src/lib/agents/student-profiling/service.ts",
  "src/lib/agents/followup-updates/service.ts",
  "src/lib/llm/providers/mock-provider.ts",
  "src/lib/agents/operational/approved-config.ts",
  "src/lib/services/student-assessment/activity-runtime-ui.ts",
  "src/lib/services/student-assessment/profile-record.ts",
  "src/lib/services/student-assessment/formative-profile.ts",
  "src/lib/services/student-assessment/formative-profile-quote-repair.ts",
  "src/lib/services/student-assessment/formative-call-attempts.ts",
  "src/lib/services/student-assessment/semantic-item-review.ts",
  "src/lib/operational/luna-profile-fidelity-identity.ts",
  "src/lib/services/student-assessment/formative-conversation/live-runner-v18r2.ts",
  "src/lib/services/student-assessment/formative-conversation/interpretation-policy.ts",
  "src/lib/services/student-assessment/formative-conversation/execution-v18r2.ts",
  "src/lib/services/student-assessment/formative-conversation/question-coverage-policy.ts"
] as const;

// Pinned reviewed identities, never derived from mutable current prompt text.
// Only this known v6/v4 parent can receive the prospective v7/v5 correction.
export function applyLunaProfileFidelityCorrection(manifest: ApprovedCandidateManifest): void {
  const fingerprint = manifest.configuration_fingerprint;
  const profile = fingerprint.role_version_metadata.student_profiling_agent;
  const guards = fingerprint.deterministic_guard_versions;
  if (profile.prompt_version !== "student-profiling-v6" ||
      profile.prompt_hash !== "d9778ba1809c54f84ceb0d91c9f36e22897e8f9a9113768f42a5c728ce1430e8" ||
      profile.schema_version !== "student-profile-output-v4" ||
      guards.student_profile_evidence_consistency !== "student-profile-evidence-consistency-v2" ||
      guards.student_profile_fact_binding !== undefined || guards.student_profile_semantic_repair !== undefined ||
      guards.student_question_source_quote !== undefined || guards.formative_profile_source_quote_repair !== undefined ||
      guards.student_profile_request_schema !== undefined) {
    throw new Error("The profile-fidelity correction requires the exact preserved v6/v4 parent identities.");
  }
  Object.assign(profile, {
    prompt_version: "student-profiling-v7",
    prompt_hash: "bb0f774fc237805eb534cee8afefb181052e272bf624170903b05cc8d4525203",
    schema_version: "student-profile-output-v5"
  });
  guards.student_profile_fact_binding = "student-profile-fact-binding-v2";
  guards.student_profile_semantic_repair = "student-profile-semantic-repair-v1";
  guards.student_question_source_quote = "student-question-source-quote-v1";
  guards.formative_profile_source_quote_repair = "formative-profile-source-quote-repair-v1";
  guards.student_profile_request_schema = "student-profile-request-schema-v1";
}
