import type { LiveModelRole } from "@/lib/llm/config";

export const MODEL_UPGRADE_OUTPUT_CONTRACT_REGISTRY_VERSION =
  "model-upgrade-production-output-contracts-v1";

export type ModelUpgradeOutputKind = "student_facing" | "teacher_tool" | "internal" | "utility";
export type ModelUpgradeWorkflowPhase =
  | "pre_reveal_item_administration"
  | "response_collection"
  | "package_analysis"
  | "formative_planning"
  | "post_reveal_feedback"
  | "formative_activity"
  | "post_activity_evaluation"
  | "teacher_authoring"
  | "connectivity";
export type ModelUpgradeInteractionPurpose =
  | "student_clarification"
  | "response_capture"
  | "analysis"
  | "planning"
  | "student_feedback"
  | "system_question"
  | "elicitation_probe"
  | "feedback_reveal"
  | "evaluation"
  | "topic_dialogue"
  | "teacher_advisory"
  | "utility";
export type ModelUpgradeRevealState =
  | "pre_reveal"
  | "post_reveal_administered"
  | "teacher_only"
  | "not_applicable";
export type ModelUpgradeOutputField =
  | "response_summary"
  | "student_facing_text"
  | "teacher_facing_text"
  | "decision_summary"
  | "evidence_used"
  | "next_action";
export type ModelUpgradeContentRequirement =
  | "actionable_student_prompt"
  | "correctness_summary";

export type ModelUpgradeOutputContract = {
  contract_id: string;
  contract_version: string;
  roles: LiveModelRole[];
  workflow_phase: ModelUpgradeWorkflowPhase;
  output_kind: ModelUpgradeOutputKind;
  interaction_purpose: ModelUpgradeInteractionPurpose;
  reveal_state: ModelUpgradeRevealState;
  required_fields: ModelUpgradeOutputField[];
  optional_fields: ModelUpgradeOutputField[];
  forbidden_fields: ModelUpgradeOutputField[];
  required_content: ModelUpgradeContentRequirement[];
  forbidden_content: ModelUpgradeContentRequirement[];
};

export type ModelUpgradeFixtureOutputContract = Omit<ModelUpgradeOutputContract, "roles"> & {
  expected_role: LiveModelRole;
};

const commonFields: ModelUpgradeOutputField[] = [
  "response_summary",
  "decision_summary",
  "evidence_used"
];

function contract(
  input: Omit<ModelUpgradeOutputContract, "contract_version">
): ModelUpgradeOutputContract {
  return {
    contract_version: MODEL_UPGRADE_OUTPUT_CONTRACT_REGISTRY_VERSION,
    ...input
  };
}

export const MODEL_UPGRADE_OUTPUT_CONTRACTS = [
  contract({
    contract_id: "teacher_advisory",
    roles: [
      "item_verification_agent",
      "mcq_diagnostic_authoring_assistant_agent",
      "mcq_import_formatting_assistant_agent"
    ],
    workflow_phase: "teacher_authoring",
    output_kind: "teacher_tool",
    interaction_purpose: "teacher_advisory",
    reveal_state: "teacher_only",
    required_fields: [...commonFields, "teacher_facing_text"],
    optional_fields: ["next_action"],
    forbidden_fields: ["student_facing_text"],
    required_content: [],
    forbidden_content: []
  }),
  contract({
    contract_id: "student_pre_reveal_clarification",
    roles: ["item_administration_tutor_agent"],
    workflow_phase: "pre_reveal_item_administration",
    output_kind: "student_facing",
    interaction_purpose: "student_clarification",
    reveal_state: "pre_reveal",
    required_fields: [...commonFields, "student_facing_text"],
    optional_fields: ["next_action"],
    forbidden_fields: ["teacher_facing_text"],
    required_content: ["actionable_student_prompt"],
    forbidden_content: ["correctness_summary"]
  }),
  contract({
    contract_id: "student_response_capture",
    roles: ["response_collection_agent"],
    workflow_phase: "response_collection",
    output_kind: "student_facing",
    interaction_purpose: "response_capture",
    reveal_state: "pre_reveal",
    required_fields: [...commonFields, "student_facing_text"],
    optional_fields: ["next_action"],
    forbidden_fields: ["teacher_facing_text"],
    required_content: [],
    forbidden_content: ["correctness_summary"]
  }),
  contract({
    contract_id: "teacher_package_analysis",
    roles: [
      "student_profiling_agent",
      "formative_activity_quality_reviewer_agent"
    ],
    workflow_phase: "package_analysis",
    output_kind: "teacher_tool",
    interaction_purpose: "analysis",
    reveal_state: "teacher_only",
    required_fields: [...commonFields, "teacher_facing_text"],
    optional_fields: ["next_action"],
    forbidden_fields: ["student_facing_text"],
    required_content: [],
    forbidden_content: []
  }),
  contract({
    contract_id: "teacher_post_activity_evaluation",
    roles: [
      "formative_activity_response_evaluator_agent",
      "post_activity_evidence_evaluator_agent"
    ],
    workflow_phase: "post_activity_evaluation",
    output_kind: "teacher_tool",
    interaction_purpose: "evaluation",
    reveal_state: "teacher_only",
    required_fields: [...commonFields, "teacher_facing_text"],
    optional_fields: ["next_action"],
    forbidden_fields: ["student_facing_text"],
    required_content: [],
    forbidden_content: []
  }),
  contract({
    contract_id: "internal_evaluation",
    roles: [
      "student_profiling_agent",
      "formative_value_and_planning_agent",
      "formative_activity_quality_reviewer_agent",
      "formative_activity_response_evaluator_agent",
      "post_activity_evidence_evaluator_agent"
    ],
    workflow_phase: "post_activity_evaluation",
    output_kind: "internal",
    interaction_purpose: "evaluation",
    reveal_state: "teacher_only",
    required_fields: [...commonFields],
    optional_fields: ["next_action"],
    forbidden_fields: ["student_facing_text", "teacher_facing_text"],
    required_content: [],
    forbidden_content: []
  }),
  contract({
    contract_id: "teacher_formative_planning",
    roles: ["formative_value_and_planning_agent"],
    workflow_phase: "formative_planning",
    output_kind: "teacher_tool",
    interaction_purpose: "planning",
    reveal_state: "teacher_only",
    required_fields: [...commonFields, "teacher_facing_text"],
    optional_fields: ["next_action"],
    forbidden_fields: ["student_facing_text"],
    required_content: [],
    forbidden_content: []
  }),
  contract({
    contract_id: "student_post_reveal_feedback",
    roles: ["profile_integration_agent", "formative_value_determination_agent"],
    workflow_phase: "post_reveal_feedback",
    output_kind: "student_facing",
    interaction_purpose: "student_feedback",
    reveal_state: "post_reveal_administered",
    required_fields: [...commonFields, "student_facing_text"],
    optional_fields: ["next_action"],
    forbidden_fields: ["teacher_facing_text"],
    required_content: [],
    forbidden_content: []
  }),
  contract({
    contract_id: "student_system_question",
    roles: ["followup_agent"],
    workflow_phase: "formative_activity",
    output_kind: "student_facing",
    interaction_purpose: "system_question",
    reveal_state: "post_reveal_administered",
    required_fields: [...commonFields, "student_facing_text"],
    optional_fields: ["next_action"],
    forbidden_fields: ["teacher_facing_text"],
    required_content: [],
    forbidden_content: []
  }),
  contract({
    contract_id: "student_activity_elicitation",
    roles: ["formative_activity_dialogue_agent"],
    workflow_phase: "formative_activity",
    output_kind: "student_facing",
    interaction_purpose: "elicitation_probe",
    reveal_state: "post_reveal_administered",
    required_fields: [...commonFields, "student_facing_text"],
    optional_fields: ["next_action"],
    forbidden_fields: ["teacher_facing_text"],
    required_content: ["actionable_student_prompt"],
    forbidden_content: ["correctness_summary"]
  }),
  contract({
    contract_id: "student_package_feedback_reveal",
    roles: ["student_communication_agent"],
    workflow_phase: "post_reveal_feedback",
    output_kind: "student_facing",
    interaction_purpose: "feedback_reveal",
    reveal_state: "post_reveal_administered",
    required_fields: [...commonFields, "student_facing_text"],
    optional_fields: ["next_action"],
    forbidden_fields: ["teacher_facing_text"],
    required_content: ["correctness_summary"],
    forbidden_content: []
  }),
  contract({
    contract_id: "student_topic_dialogue",
    roles: ["topic_dialogue_agent"],
    workflow_phase: "formative_activity",
    output_kind: "student_facing",
    interaction_purpose: "topic_dialogue",
    reveal_state: "post_reveal_administered",
    required_fields: [...commonFields, "student_facing_text"],
    optional_fields: ["next_action"],
    forbidden_fields: ["teacher_facing_text"],
    required_content: [],
    forbidden_content: []
  }),
  contract({
    contract_id: "utility_connectivity",
    roles: ["connectivity_test"],
    workflow_phase: "connectivity",
    output_kind: "utility",
    interaction_purpose: "utility",
    reveal_state: "not_applicable",
    required_fields: [...commonFields],
    optional_fields: ["next_action"],
    forbidden_fields: ["student_facing_text", "teacher_facing_text"],
    required_content: [],
    forbidden_content: []
  })
] as const satisfies readonly ModelUpgradeOutputContract[];

export type ModelUpgradeOutputContractId = typeof MODEL_UPGRADE_OUTPUT_CONTRACTS[number]["contract_id"];

export function modelUpgradeOutputContract(contractId: ModelUpgradeOutputContractId) {
  const found = MODEL_UPGRADE_OUTPUT_CONTRACTS.find((entry) => entry.contract_id === contractId);
  if (!found) throw new Error(`model_upgrade_output_contract_not_found:${contractId}`);
  return found;
}

export function fixtureOutputContract(
  contractId: ModelUpgradeOutputContractId,
  role: LiveModelRole
): ModelUpgradeFixtureOutputContract {
  const source = modelUpgradeOutputContract(contractId);
  if (!source.roles.some((candidateRole) => candidateRole === role)) {
    throw new Error(`model_upgrade_output_contract_role_mismatch:${contractId}:${role}`);
  }
  return {
    contract_id: source.contract_id,
    contract_version: source.contract_version,
    workflow_phase: source.workflow_phase,
    output_kind: source.output_kind,
    interaction_purpose: source.interaction_purpose,
    reveal_state: source.reveal_state,
    required_fields: [...source.required_fields],
    optional_fields: [...source.optional_fields],
    forbidden_fields: [...source.forbidden_fields],
    required_content: [...source.required_content],
    forbidden_content: [...source.forbidden_content],
    expected_role: role
  };
}

function hasOutputField(output: Record<string, unknown> | null, field: ModelUpgradeOutputField) {
  if (!output) return false;
  const value = output[field];
  return value !== undefined && value !== null && value !== "" &&
    (!Array.isArray(value) || value.length > 0);
}

function hasActionablePrompt(text: string) {
  return /\?/u.test(text) ||
    /\b(?:explain|identify|write|describe|compare|rewrite|choose|tell me|what would|what do you)\b/iu.test(text);
}

// A package-level correctness summary is distinct from a reference to a known
// correct option inside an already-revealed activity prompt.
function hasCorrectnessSummary(text: string) {
  return /\b(?:items?|questions?)\s*(?:\d+(?:\s*(?:,|and)\s*\d+)*)\s+(?:were|was|are|is)\s+(?:correct|incorrect)\b/iu.test(text) ||
    /\b(?:\d+|one|two|three)\s+(?:initial\s+)?(?:items?|answers?)\s+(?:were|was|are)\s+correct\b/iu.test(text) ||
    /\b(?:correctness|correct and|incorrect and|correct while|incorrect while)\b/iu.test(text);
}

function hasContentRequirement(text: string, requirement: ModelUpgradeContentRequirement) {
  return requirement === "actionable_student_prompt"
    ? hasActionablePrompt(text)
    : hasCorrectnessSummary(text);
}

export function evaluateModelUpgradeOutputContract(input: {
  contract: ModelUpgradeFixtureOutputContract;
  output: Record<string, unknown> | null;
}) {
  const studentText = typeof input.output?.student_facing_text === "string"
    ? input.output.student_facing_text
    : "";
  const allText = [
    input.output?.student_facing_text,
    input.output?.teacher_facing_text,
    input.output?.response_summary,
    input.output?.decision_summary
  ].filter((value): value is string => typeof value === "string").join(" ");
  const missingRequiredFields = input.contract.required_fields
    .filter((field) => !hasOutputField(input.output, field));
  const forbiddenFieldsPresent = input.contract.forbidden_fields
    .filter((field) => hasOutputField(input.output, field));
  const missingRequiredContent = input.contract.required_content
    .filter((requirement) => !hasContentRequirement(studentText || allText, requirement));
  const forbiddenContentPresent = input.contract.forbidden_content
    .filter((requirement) => hasContentRequirement(studentText || allText, requirement));
  const outputKind = input.output?.output_kind;
  return {
    status: missingRequiredFields.length === 0 && missingRequiredContent.length === 0 &&
      forbiddenFieldsPresent.length === 0 && forbiddenContentPresent.length === 0 &&
      outputKind === input.contract.output_kind
      ? "passed" as const
      : "failed" as const,
    output_kind_matches: outputKind === input.contract.output_kind,
    missing_required_fields: missingRequiredFields,
    forbidden_fields_present: forbiddenFieldsPresent,
    missing_required_content: missingRequiredContent,
    forbidden_content_present: forbiddenContentPresent,
    completeness_issue_codes: [
      ...(outputKind === input.contract.output_kind ? [] : ["expected_output_kind_mismatch"]),
      ...missingRequiredFields.map((field) => `required_${field}_missing`),
      ...missingRequiredContent.map((requirement) => `required_${requirement}_missing`)
    ],
    instruction_issue_codes: [
      ...forbiddenFieldsPresent.map((field) => `forbidden_${field}_present`),
      ...forbiddenContentPresent.map((requirement) => `forbidden_${requirement}_present`)
    ]
  };
}

export function validateFixtureOutputContractDeclaration(input: {
  role: LiveModelRole;
  declaration: ModelUpgradeFixtureOutputContract;
}) {
  let expected: ModelUpgradeFixtureOutputContract;
  try {
    const source = modelUpgradeOutputContract(input.declaration.contract_id as ModelUpgradeOutputContractId);
    expected = fixtureOutputContract(source.contract_id as ModelUpgradeOutputContractId, input.role);
  } catch {
    return {
      valid: false,
      reason_codes: ["output_contract_registry_mismatch"],
      expected: null
    };
  }
  const requiredForbiddenOverlap = input.declaration.required_fields
    .filter((field) => input.declaration.forbidden_fields.includes(field));
  const requiredForbiddenContentOverlap = input.declaration.required_content
    .filter((field) => input.declaration.forbidden_content.includes(field));
  const mismatch = JSON.stringify(input.declaration) !== JSON.stringify(expected);
  return {
    valid: !mismatch && requiredForbiddenOverlap.length === 0 && requiredForbiddenContentOverlap.length === 0,
    reason_codes: [
      ...(mismatch ? ["output_contract_registry_mismatch"] : []),
      ...(requiredForbiddenOverlap.length > 0 ? ["output_contract_field_contradiction"] : []),
      ...(requiredForbiddenContentOverlap.length > 0 ? ["output_contract_content_contradiction"] : [])
    ],
    expected
  };
}
