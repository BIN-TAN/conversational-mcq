import type { AgentOutputByName } from "@/lib/agents/contracts";
import { defaultFormativeValueForIntegratedProfile } from "./mapping";

type FormativePlanningOutput = AgentOutputByName["formative_value_and_planning_agent"];

const prohibitedPatterns = [
  /\bcheat(?:ed|ing)?\b/i,
  /\bdishonest(?:y)?\b/i,
  /\bused\s+genai\b/i,
  /\bgenai\s+use\s+(?:confirmed|proven)\b/i,
  /\bmisconduct\b/i,
  /\bprove[sn]?\s+external[-\s]?resource\b/i,
  /\blow[-\s]?motivation\s+trait\b/i,
  /\bclinical\b/i,
  /\bpsychological\s+condition\b/i,
  /\bknown?\s+cause\b/i
];

export class FormativePlanningSemanticValidationError extends Error {
  issues: string[];

  constructor(issues: string[]) {
    super(`Formative planning semantic validation failed: ${issues.join("; ")}`);
    this.name = "FormativePlanningSemanticValidationError";
    this.issues = issues;
  }
}

function nonempty(value: string) {
  return value.trim().length > 0;
}

function nonemptyArray(value: string[]) {
  return value.length > 0 && value.every(nonempty);
}

function collectText(output: FormativePlanningOutput) {
  return [
    output.formative_action_plan,
    ...output.target_evidence,
    ...output.success_criteria,
    ...output.followup_prompt_constraints,
    ...output.profile_update_triggers,
    output.rationale,
    output.mapping_deviation_reason ?? ""
  ].join("\n");
}

export function validateFormativePlanningSemantics(input: {
  output: FormativePlanningOutput;
  integrated_diagnostic_profile: string;
}) {
  const issues: string[] = [];
  const expected = defaultFormativeValueForIntegratedProfile(
    input.integrated_diagnostic_profile
  );
  const output = input.output;

  if (!nonempty(output.formative_action_plan)) {
    issues.push("formative_action_plan must be nonempty");
  }

  if (!nonemptyArray(output.target_evidence)) {
    issues.push("target_evidence must contain at least one nonempty item");
  }

  if (!nonemptyArray(output.success_criteria)) {
    issues.push("success_criteria must contain at least one nonempty item");
  }

  if (!nonemptyArray(output.followup_prompt_constraints)) {
    issues.push("followup_prompt_constraints must contain at least one nonempty item");
  }

  if (!nonemptyArray(output.profile_update_triggers)) {
    issues.push("profile_update_triggers must contain at least one nonempty item");
  }

  if (!nonempty(output.rationale)) {
    issues.push("rationale must be nonempty");
  }

  const deviationReason = output.mapping_deviation_reason?.trim() ?? "";

  if (output.formative_value === expected) {
    if (!output.mapping_followed) {
      issues.push("mapping_followed must be true when selected value matches the default mapping");
    }

    if (deviationReason.length > 0) {
      issues.push("mapping_deviation_reason must be absent or empty when default mapping is followed");
    }
  } else {
    if (output.mapping_followed) {
      issues.push("mapping_followed must be false when selected value differs from the default mapping");
    }

    if (deviationReason.length < 20) {
      issues.push("mapping_deviation_reason must be substantive when default mapping is not followed");
    }
  }

  const text = collectText(output);

  for (const pattern of prohibitedPatterns) {
    if (pattern.test(text)) {
      issues.push("planning output contains prohibited misconduct, certainty, or clinical language");
      break;
    }
  }

  if (issues.length > 0) {
    throw new FormativePlanningSemanticValidationError(issues);
  }

  return {
    default_formative_value: expected,
    mapping_followed: output.formative_value === expected
  };
}
