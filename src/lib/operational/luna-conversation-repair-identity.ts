import type { ApprovedCandidateManifest } from "./active-approval-bundle";
import { MIXED_TUTOR_SOURCE_FILES } from "./mixed-tutor-identity";

export const LUNA_CONVERSATION_REPAIR = "conversation-reliability-v1" as const;
export const LUNA_CONVERSATION_REPAIR_CANDIDATE_VERSION = "luna-medium-conversation-reliability-candidate-v1";
export const LUNA_CONVERSATION_REPAIR_AMENDMENT_VERSION = "luna-medium-conversation-reliability-amendment-v1";
export const LUNA_CONVERSATION_REPAIR_VALIDATION_VERSION = "luna-medium-conversation-reliability-validation-v1";
export const LUNA_SOL_DELIVERY_REVIEW_POLICY_VERSION = "formative-conversation-sol-review-policy-v1" as const;
export const LUNA_SOL_DELIVERY_REVIEW_MODEL = "gpt-6.1-sol" as const;
export const LUNA_SOL_DELIVERY_REVIEW_CANDIDATE_VERSION = "luna-medium-sol-delivery-review-candidate-v1" as const;
export const LUNA_SOL_DELIVERY_REVIEW_AMENDMENT_VERSION = "luna-medium-sol-delivery-review-amendment-v1" as const;
export const LUNA_SOL_DELIVERY_REVIEW_VALIDATION_VERSION = "luna-medium-sol-delivery-review-validation-v1" as const;
export const LUNA_SOL_DELIVERY_REVIEW_AMENDMENT_KEY = "luna_sol_delivery_review_amendment" as const;
// Filled only after the reviewed prompt is frozen; never derive approval identity
// automatically from mutable runtime instructions.
export const LUNA_CONVERSATION_REPAIR_PROMPT_HASH = "d564444fa3e5ab1d5dc0c705c237a8f2d2740023ad94ce89e7f3872adcbeaa25";
export const LUNA_CONVERSATION_DELIVERY_REVIEW_PROMPT_HASH = "7625a8594a614073b17ce4df24f9f8e36c5f6bfa6af6654cd9b9acd03f41d77e";
export const LUNA_CONVERSATION_DELIVERY_REVIEW_VERSION = "conversation-delivery-review-v8";
export const LUNA_CONVERSATION_DELIVERY_REVIEW_MAX_OUTPUT_TOKENS = 4000;
export const LUNA_CONVERSATION_PROFILE_PROMPT_VERSION = "student-profiling-v10";
export const LUNA_CONVERSATION_PROFILE_PROMPT_HASH = "7949e5b553e2d013c673e90b4afae4171fe98db9be5cfb1be8721704c30328b5";
export const LUNA_CONVERSATION_PROFILE_SCHEMA_VERSION = "student-profile-output-v6";
export const LUNA_CONVERSATION_REPAIR_SOURCE_FILES = [...MIXED_TUTOR_SOURCE_FILES,
  "src/lib/operational/luna-conversation-repair-identity.ts",
  "src/lib/llm/formative-tutor-input.ts",
  "src/lib/llm/evidence-id-request-schema.ts",
  "src/lib/llm/provider-transport-retry.ts",
  "src/lib/llm/providers/openai-responses-provider.ts",
  "src/lib/llm/providers/types.ts",
  "src/lib/services/student-assessment/formative-conversation/profile-update-proposal.ts",
  "src/lib/services/student-assessment/formative-conversation/conversation-continuity.ts",
  "src/lib/services/student-assessment/formative-conversation/private-learning-review.ts",
  "src/lib/services/student-assessment/formative-conversation/agent-contract-v18r2.ts",
  "src/lib/services/student-assessment/formative-conversation/context.ts",
  "src/lib/services/student-assessment/formative-conversation/context-v18r2.ts",
  "src/lib/services/student-assessment/formative-conversation/runtime-context.ts",
  "src/lib/services/student-assessment/formative-conversation/runtime.ts",
  "src/lib/services/student-assessment/formative-conversation/finish-assessment.ts",
  "src/lib/services/student-assessment/formative-conversation/lifecycle-contract-v18r2.ts",
  "src/lib/services/student-assessment/formative-conversation/candidate-validation-v18r2.ts",
  "src/lib/services/student-assessment/formative-conversation/learning-summary-policy.ts",
  "src/lib/services/student-assessment/formative-conversation/assistance-history.ts",
  "src/lib/evaluation/conversational-reliability-scenarios.ts",
  "prisma/ai-student-journey-evaluation.ts",
  "src/lib/student-visible-safety.ts",
  "src/lib/operational/luna-conversation-replay-evidence.ts",
  "src/lib/services/teacher-review/session-detail.ts",
  "src/lib/services/teacher-research-data/analysis-ready-export.ts"
] as const;

export const LUNA_CONVERSATION_REPAIR_PARENT_TUTOR = {
  prompt_version: "formative-conversation-host-v7.2",
  prompt_hash: "27488d814b1f3978723a086a05ca22ec31618764f0adb1f64ba83d9f45758b80",
  schema_version: "formative-conversation-agent-contract-v4",
  context_version: "formative-conversation-context-v4",
  validator_version: "formative-conversation-v18r2-candidate-acceptance-v3",
  safety_validator_version: "eval-safety-v5",
  evidence_reference_version: "canonical-evidence-identity-v2",
  profile_transition_version: "formative-conversation-profile-transition-v7",
  lifecycle_version: "formative-conversation-lifecycle-v1",
  fallback_version: "formative-conversation-fail-closed-v18r2"
} as const;

export function applyLunaConversationRepair(manifest: ApprovedCandidateManifest) {
  if (!/^[a-f0-9]{64}$/.test(LUNA_CONVERSATION_REPAIR_PROMPT_HASH)) {
    throw new Error("The conversation-reliability prompt identity is not frozen.");
  }
  const fingerprint = manifest.configuration_fingerprint;
  const tutor = fingerprint.role_version_metadata.formative_conversation_agent;
  const profile = fingerprint.role_version_metadata.student_profiling_agent;
  const guards = fingerprint.deterministic_guard_versions;
  if (profile.prompt_version !== "student-profiling-v7" ||
      profile.prompt_hash !== "bb0f774fc237805eb534cee8afefb181052e272bf624170903b05cc8d4525203" ||
      profile.schema_version !== "student-profile-output-v5" ||
      guards.student_profile_fact_binding !== "student-profile-fact-binding-v2" ||
      guards.student_profile_request_schema !== "student-profile-request-schema-v1" ||
      guards.student_profile_semantic_repair !== "student-profile-semantic-repair-v1" ||
      !tutor || Object.keys(tutor).length !== Object.keys(LUNA_CONVERSATION_REPAIR_PARENT_TUTOR).length ||
      Object.entries(LUNA_CONVERSATION_REPAIR_PARENT_TUTOR).some(([key, value]) => tutor[key] !== value) ||
      guards.formative_conversation_acceptance !== "formative-conversation-v18r2-candidate-acceptance-v3" ||
      guards.formative_conversation_opening !== "formative-conversation-opening-v3" ||
      guards.formative_conversation_lifecycle !== "formative-conversation-lifecycle-v1" ||
      ["formative_input_projection", "formative_profile_update_proposal", "formative_conversation_continuity",
        "formative_conversation_review", "formative_conversation_pre_reply_plan", "formative_conversation_current_reply_source",
        "formative_conversation_prior_tutor_source", "formative_conversation_stored_preference_transition",
        "formative_conversation_support_preference_links", "formative_conversation_delivery_review", "formative_interpretation_policy",
        "formative_learning_summary", "provider_physical_usage", "formative_current_source_activation_projection",
        "formative_deferred_need_link", "formative_stored_preference_retention", "evidence_id_request_schema",
        "formative_private_learning_review"].some(key => guards[key] !== undefined)) {
    throw new Error("The conversation-reliability amendment requires the exact preserved tutor parent identities.");
  }
  // The unchanged profile-fidelity amendment first verifies the original v6/v4
  // parent and projects v7/v5. Only this prospective conversation scope adds the
  // exact typed-support contract; historical v7/v5 candidates stay immutable.
  Object.assign(profile, { prompt_version: LUNA_CONVERSATION_PROFILE_PROMPT_VERSION,
    prompt_hash: LUNA_CONVERSATION_PROFILE_PROMPT_HASH, schema_version: LUNA_CONVERSATION_PROFILE_SCHEMA_VERSION,
    evidence_id_request_schema_version: "evidence-id-request-enum-v1" });
  guards.student_profile_fact_binding = "student-profile-fact-binding-v3";
  guards.student_profile_request_schema = "student-profile-request-schema-v4";
  guards.student_profile_semantic_repair = "student-profile-semantic-repair-v2";
  Object.assign(tutor, {
    prompt_version: "formative-conversation-host-v7.21",
    prompt_hash: LUNA_CONVERSATION_REPAIR_PROMPT_HASH,
    schema_version: "formative-conversation-profile-proposal-output-v1",
    canonical_schema_version: "formative-conversation-agent-contract-v4",
    validator_version: "formative-conversation-v18r2-candidate-acceptance-v5",
    input_encoding: "formative-tutor-input-v1",
    profile_proposal_version: "formative-profile-update-proposal-v1",
    interpretation_policy_version: "formative-interpretation-policy-v6",
    learning_summary_policy_version: "learning-summary-evidence-v2",
    physical_usage_policy_version: "provider-physical-usage-v1",
    current_source_activation_projection_version: "conversation-current-source-activation-projection-v1",
    deferred_need_link_version: "conversation-deferred-need-link-v1",
    stored_preference_retention_version: "conversation-stored-preference-retention-v1",
    evidence_id_request_schema_version: "evidence-id-request-enum-v1",
    private_learning_review_version: "conversation-private-learning-review-v1",
    conversation_continuity_version: "conversation-continuity-v1",
    conversation_review_version: "conversation-review-v1",
    conversation_pre_reply_plan_version: "conversation-pre-reply-plan-v2",
    conversation_current_reply_source_version: "conversation-current-reply-source-v1",
    conversation_prior_tutor_source_version: "conversation-prior-tutor-source-v1",
    conversation_stored_preference_transition_version: "conversation-stored-preference-transition-v1",
    conversation_support_preference_link_version: "conversation-support-preference-links-v1",
    delivery_review_version: LUNA_CONVERSATION_DELIVERY_REVIEW_VERSION,
    delivery_review_prompt_hash: LUNA_CONVERSATION_DELIVERY_REVIEW_PROMPT_HASH,
    delivery_review_max_output_tokens: LUNA_CONVERSATION_DELIVERY_REVIEW_MAX_OUTPUT_TOKENS,
    execution_accounting_version: "formative-conversation-v18r2-evaluation-accounting-v2",
    formative_max_student_turns: 30
  });
  Object.assign(guards, {
    formative_conversation_acceptance: "formative-conversation-v18r2-candidate-acceptance-v5",
    formative_input_projection: "formative-tutor-input-v1",
    formative_profile_update_proposal: "formative-profile-update-proposal-v1",
    formative_conversation_continuity: "conversation-continuity-v1",
    formative_conversation_review: "conversation-review-v1",
    formative_conversation_pre_reply_plan: "conversation-pre-reply-plan-v2",
    formative_conversation_current_reply_source: "conversation-current-reply-source-v1",
    formative_conversation_prior_tutor_source: "conversation-prior-tutor-source-v1",
    formative_conversation_stored_preference_transition: "conversation-stored-preference-transition-v1",
    formative_conversation_support_preference_links: "conversation-support-preference-links-v1",
    formative_conversation_delivery_review: LUNA_CONVERSATION_DELIVERY_REVIEW_VERSION,
    formative_interpretation_policy: "formative-interpretation-policy-v6",
    formative_learning_summary: "learning-summary-evidence-v2",
    provider_physical_usage: "provider-physical-usage-v1",
    formative_current_source_activation_projection: "conversation-current-source-activation-projection-v1",
    formative_deferred_need_link: "conversation-deferred-need-link-v1",
    formative_stored_preference_retention: "conversation-stored-preference-retention-v1",
    evidence_id_request_schema: "evidence-id-request-enum-v1",
    formative_private_learning_review: "conversation-private-learning-review-v1"
  });
}

export function applyLunaSolDeliveryReviewPolicy(manifest: ApprovedCandidateManifest) {
  const tutor = manifest.configuration_fingerprint.role_version_metadata.formative_conversation_agent;
  if (!tutor || tutor.prompt_hash !== LUNA_CONVERSATION_REPAIR_PROMPT_HASH ||
      tutor.delivery_review_version !== LUNA_CONVERSATION_DELIVERY_REVIEW_VERSION ||
      tutor.delivery_review_prompt_hash !== LUNA_CONVERSATION_DELIVERY_REVIEW_PROMPT_HASH ||
      tutor.delivery_review_max_output_tokens !== LUNA_CONVERSATION_DELIVERY_REVIEW_MAX_OUTPUT_TOKENS ||
      ["delivery_review_policy_version", "delivery_review_model_name", "delivery_review_reasoning_effort",
        "delivery_review_execution_purpose"].some(key => tutor[key] !== undefined) ||
      Object.values(manifest.roles).some(role => role.model_name !== "gpt-5.6-luna" || role.reasoning_effort !== "medium")) {
    throw new Error("The Sol delivery-review policy requires the exact all-Luna conversation-reliability projection.");
  }
  Object.assign(tutor, {
    delivery_review_policy_version: LUNA_SOL_DELIVERY_REVIEW_POLICY_VERSION,
    delivery_review_model_name: LUNA_SOL_DELIVERY_REVIEW_MODEL,
    delivery_review_reasoning_effort: "medium",
    delivery_review_execution_purpose: "conversation_delivery_review"
  });
}
