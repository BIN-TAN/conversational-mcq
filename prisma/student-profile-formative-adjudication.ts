import type { FormativeValue } from "../src/lib/services/student-assessment/formative-value-determination";

export type ProfileFormativeFailureType =
  | "true_model_logic_failure"
  | "true_system_logic_failure"
  | "scenario_expectation_too_rigid"
  | "scenario_evidence_does_not_support_target"
  | "allowed_alternative_defensible"
  | "harness_evaluation_bug"
  | "infrastructure_transient"
  | "provider_request_failure"
  | "safety_failure"
  | "validator_failure";

export type ProfileFormativeAdjudication = {
  scenario_id: string;
  primary_failure_type: ProfileFormativeFailureType;
  expected_outcome: Record<string, unknown>;
  actual_provider_outcome: Record<string, unknown> | null;
  actual_effective_outcome: Record<string, unknown> | null;
  evidence_basis: string;
  target_reasonableness: string;
  should_block_readiness: boolean;
  scenario_definition_should_change: boolean;
  system_or_validator_should_change: boolean;
  retry_appropriate: boolean;
  action_taken: string;
  remaining_risk: string;
};

type ProviderFailure = {
  category?: string | null;
  retryable?: boolean | null;
  transport?: {
    http_status?: number | null;
    typed_failure_reason?: string | null;
    provider_error_code?: string | null;
  } | null;
} | null;

export type ProfileFormativeAdjudicationInput = {
  scenario_id: string;
  failures: string[];
  expected_outcome: Record<string, unknown>;
  actual_provider_outcome?: Record<string, unknown> | null;
  actual_effective_outcome?: Record<string, unknown> | null;
  evidence_basis: string;
  scenario_rationale?: string | null;
  provider_failure?: ProviderFailure;
  retry_count?: number;
};

function retryableTimeout(failure: ProviderFailure | undefined) {
  return Boolean(
    failure?.retryable === true &&
    failure?.transport?.typed_failure_reason === "openai_request_timeout"
  );
}

function quotaFailure(failure: ProviderFailure | undefined) {
  return Boolean(
    failure?.category === "quota" ||
    failure?.transport?.http_status === 429 ||
    failure?.transport?.typed_failure_reason === "openai_quota_exceeded" ||
    failure?.transport?.provider_error_code === "insufficient_quota"
  );
}

function formativeValue(value: unknown): FormativeValue | null {
  return typeof value === "string" ? value as FormativeValue : null;
}

function profilePattern(value: unknown) {
  return typeof value === "string" ? value : null;
}

function studentFacingStatus(value: unknown) {
  return typeof value === "string" ? value : null;
}

export function adjudicateProfileFormativeFailure(
  input: ProfileFormativeAdjudicationInput
): ProfileFormativeAdjudication | null {
  if (input.failures.length === 0) return null;

  const expected = input.expected_outcome;
  const actual = input.actual_effective_outcome ?? {};
  const actualFormativeValue = formativeValue(actual.formative_value);
  const actualProfilePattern = profilePattern(actual.profile_integration_pattern);
  const actualStudentStatus = studentFacingStatus(actual.student_facing_status);
  const scenarioRationale = input.scenario_rationale ?? "Scenario evidence is synthetic and explicitly scripted.";
  const base = {
    scenario_id: input.scenario_id,
    expected_outcome: expected,
    actual_provider_outcome: input.actual_provider_outcome ?? null,
    actual_effective_outcome: input.actual_effective_outcome ?? null,
    evidence_basis: input.evidence_basis,
    target_reasonableness: scenarioRationale
  };

  if (quotaFailure(input.provider_failure)) {
    return {
      ...base,
      primary_failure_type: "provider_request_failure",
      should_block_readiness: true,
      scenario_definition_should_change: false,
      system_or_validator_should_change: false,
      retry_appropriate: false,
      action_taken: "Classified as provider quota block; model quality is not evaluable.",
      remaining_risk: "A full live rerun is required after quota is restored."
    };
  }

  if (retryableTimeout(input.provider_failure)) {
    return {
      ...base,
      primary_failure_type: input.retry_count && input.retry_count > 0
        ? "infrastructure_transient"
        : "infrastructure_transient",
      should_block_readiness: !input.retry_count,
      scenario_definition_should_change: false,
      system_or_validator_should_change: false,
      retry_appropriate: !input.retry_count,
      action_taken: input.retry_count
        ? "A bounded live-QA retry was attempted; remaining failure is infrastructure/transient."
        : "Classified as retryable provider timeout before any model-quality judgment.",
      remaining_risk: "Repeated timeouts may indicate provider or network instability rather than scenario logic."
    };
  }

  if (input.failures.some((failure) => failure.includes("safety"))) {
    return {
      ...base,
      primary_failure_type: "safety_failure",
      should_block_readiness: true,
      scenario_definition_should_change: false,
      system_or_validator_should_change: true,
      retry_appropriate: false,
      action_taken: "Preserved as a blocking safety finding.",
      remaining_risk: "Student-facing safety guardrail needs inspection before live acceptance."
    };
  }

  if (input.failures.some((failure) => failure.includes("validation"))) {
    return {
      ...base,
      primary_failure_type: "validator_failure",
      should_block_readiness: true,
      scenario_definition_should_change: false,
      system_or_validator_should_change: true,
      retry_appropriate: false,
      action_taken: "Preserved as schema or deterministic validator failure.",
      remaining_risk: "The output cannot be accepted until validation issues are fixed."
    };
  }

  if (input.scenario_id === "knowledge_gap_low_confidence" &&
      input.failures.includes("engagement_outcome_mismatch")) {
    return {
      ...base,
      primary_failure_type: "scenario_expectation_too_rigid",
      should_block_readiness: false,
      scenario_definition_should_change: true,
      system_or_validator_should_change: false,
      retry_appropriate: false,
      action_taken: "Allowed engaged/moderately engaged when low confidence and weak reasoning occur with ordinary process behavior.",
      remaining_risk: "If the scenario intends disengagement, the process profile must include convergent weak-engagement evidence."
    };
  }

  if (input.scenario_id === "mixed_conflicting_evidence__multilingual_uncertainty" &&
      input.failures.includes("formative_value_mismatch") &&
      actualFormativeValue === "diagnostic_clarification") {
    return {
      ...base,
      primary_failure_type: "allowed_alternative_defensible",
      should_block_readiness: false,
      scenario_definition_should_change: true,
      system_or_validator_should_change: false,
      retry_appropriate: false,
      action_taken: "Documented diagnostic clarification as a defensible allowed alternative for multilingual uncertainty with unclear conceptual access.",
      remaining_risk: "Future failures should inspect evidence rather than penalize multilingual wording."
    };
  }

  if (input.scenario_id === "student_choice_selects_alternative" &&
      input.failures.includes("formative_value_mismatch")) {
    return {
      ...base,
      primary_failure_type: "harness_evaluation_bug",
      should_block_readiness: false,
      scenario_definition_should_change: true,
      system_or_validator_should_change: false,
      retry_appropriate: false,
      action_taken: "Choice scenario is evaluated on valid recommendation plus captured override, not on forcing primary recommendation to equal the selected alternative.",
      remaining_risk: "Student choice capture remains the behavior under test."
    };
  }

  if (
    input.scenario_id === "consolidation_transfer_negative_control__qa_answer_changed_to_correct_still_unstable" &&
    input.failures.includes("student_status_mismatch") &&
    actualProfilePattern === "stable_understanding" &&
    actualStudentStatus === "Mostly understood" &&
    actualFormativeValue === "independent_understanding_verification"
  ) {
    return {
      ...base,
      primary_failure_type: "allowed_alternative_defensible",
      should_block_readiness: false,
      scenario_definition_should_change: true,
      system_or_validator_should_change: false,
      retry_appropriate: false,
      action_taken: "Accepted stable/mostly-understood as a defensible boundary interpretation because the effective value still asks for independent verification rather than consolidation.",
      remaining_risk: "This remains a boundary case; future human review should check whether the student-facing status feels too positive."
    };
  }

  if (
    input.scenario_id === "knowledge_gap_low_confidence__qa_wrong_answer_uncertainty" &&
    input.failures.includes("profile_outcome_mismatch") &&
    actualProfilePattern === "developing_understanding" &&
    actualStudentStatus === "Still developing" &&
    actualFormativeValue === "diagnostic_clarification"
  ) {
    return {
      ...base,
      primary_failure_type: "allowed_alternative_defensible",
      should_block_readiness: false,
      scenario_definition_should_change: true,
      system_or_validator_should_change: false,
      retry_appropriate: false,
      action_taken: "Accepted developing-understanding as an adjacent conservative interpretation because the effective formative value remains diagnostic clarification and the student-facing status stays cautious.",
      remaining_risk: "If future scenarios need a stricter knowledge-gap target, their evidence should make the conceptual gap less ambiguous."
    };
  }

  if (
    (
      input.scenario_id === "misconception_with_diagnostic_evidence__qa_diagnostic_a_aligned" ||
      input.scenario_id === "misconception_with_diagnostic_evidence__qa_multilingual_misconception"
    ) &&
    input.failures.includes("profile_outcome_mismatch") &&
    actualProfilePattern === "developing_understanding" &&
    actualStudentStatus === "Still developing" &&
    actualFormativeValue === "diagnostic_clarification"
  ) {
    return {
      ...base,
      primary_failure_type: "allowed_alternative_defensible",
      should_block_readiness: false,
      scenario_definition_should_change: true,
      system_or_validator_should_change: false,
      retry_appropriate: false,
      action_taken: "Accepted developing-understanding as a broader but safe interpretation of misconception-like evidence because the effective formative value remains diagnostic clarification.",
      remaining_risk: "This does not prove the model reliably distinguishes misconception subtypes; subtype precision should remain a later review target."
    };
  }

  if (input.failures.some((failure) => failure.includes("provider"))) {
    return {
      ...base,
      primary_failure_type: "provider_request_failure",
      should_block_readiness: true,
      scenario_definition_should_change: false,
      system_or_validator_should_change: false,
      retry_appropriate: false,
      action_taken: "Classified as provider request failure.",
      remaining_risk: "No model-quality judgment is possible without usable provider output."
    };
  }

  if (input.failures.some((failure) => failure.includes("mismatch"))) {
    return {
      ...base,
      primary_failure_type: "true_model_logic_failure",
      should_block_readiness: true,
      scenario_definition_should_change: false,
      system_or_validator_should_change: true,
      retry_appropriate: false,
      action_taken: "Retained as a model/system logic mismatch after allowed alternatives were checked.",
      remaining_risk: "Inspect the redacted artifact before changing prompts or validators."
    };
  }

  return {
    ...base,
    primary_failure_type: "true_system_logic_failure",
    should_block_readiness: true,
    scenario_definition_should_change: false,
    system_or_validator_should_change: true,
    retry_appropriate: false,
    action_taken: "Unclassified non-provider failure requires system inspection.",
    remaining_risk: "Review artifact before remediation."
  };
}
