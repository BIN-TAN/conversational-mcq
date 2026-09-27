import { z } from "zod";
import type { AgentModelConfig } from "../llm/config";

export const ScopedFeedbackBudgetSchema = z.object({
  grant_id: z.string().uuid(),
  student_db_id: z.string().uuid(),
  assessment_db_id: z.string().uuid(),
  max_output_tokens: z.literal(30000)
}).strict();
export type ScopedFeedbackBudget = z.infer<typeof ScopedFeedbackBudgetSchema>;

// Identity must come from the persisted session, never request or provider input.
export function selectInitialFeedbackBudget(input: {
  base: AgentModelConfig;
  grants: ScopedFeedbackBudget[];
  globalMaxOutputTokens?: 30000;
  session: { user_db_id: string; assessment_db_id: string };
  approvedRuntimeHash: string;
}) {
  if (input.globalMaxOutputTokens && input.grants.length) throw new Error("Conflicting global and individual feedback approvals.");
  const matches = input.grants.filter(grant => grant.student_db_id === input.session.user_db_id &&
    grant.assessment_db_id === input.session.assessment_db_id);
  if (matches.length > 1) throw new Error("Ambiguous initial feedback budget approval.");
  const grant = matches[0];
  const effectiveLimit = input.globalMaxOutputTokens ?? grant?.max_output_tokens ?? input.base.max_output_tokens;
  return {
    model_config: { ...input.base, max_output_tokens: effectiveLimit },
    audit: {
      policy_version: "initial-feedback-budget-v2",
      approval_scope: input.globalMaxOutputTokens ? "all_students" : grant ? "student_and_assessment" : "role_default",
      approved_runtime_hash: input.approvedRuntimeHash,
      grant_id: grant?.grant_id ?? null,
      base_max_output_tokens: input.base.max_output_tokens,
      effective_max_output_tokens: effectiveLimit
    }
  };
}
