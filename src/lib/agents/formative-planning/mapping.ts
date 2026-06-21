import { z } from "zod";
import {
  FormativeValueSchema,
  IntegratedDiagnosticProfileSchema
} from "@/lib/domain/enums";

export const IntegratedProfileToLikelyFormativeValue = {
  insufficient_evidence_for_formative_decision: "diagnostic_clarification",
  low_engagement_limits_interpretability: "diagnostic_clarification",
  conflicting_evidence_needs_clarification: "diagnostic_clarification",
  developing_understanding_with_productive_engagement: "reasoning_refinement",
  misconception_with_sufficient_engagement: "diagnostic_clarification",
  correct_but_fragile_understanding: "reasoning_refinement",
  correct_but_independence_uncertain: "independent_understanding_verification",
  underconfident_but_reasoning_supported: "confidence_calibration",
  robust_understanding_ready_for_transfer: "consolidation_or_transfer"
} as const satisfies Record<
  z.infer<typeof IntegratedDiagnosticProfileSchema>,
  z.infer<typeof FormativeValueSchema>
>;

export function defaultFormativeValueForIntegratedProfile(
  integratedDiagnosticProfile: string
) {
  const parsed = IntegratedDiagnosticProfileSchema.parse(integratedDiagnosticProfile);

  return IntegratedProfileToLikelyFormativeValue[parsed];
}

export function planningMappingForPrompt() {
  return {
    description:
      "Default guide from integrated diagnostic profile to likely formative value. Deviations require a substantive rationale.",
    mapping: IntegratedProfileToLikelyFormativeValue
  };
}
