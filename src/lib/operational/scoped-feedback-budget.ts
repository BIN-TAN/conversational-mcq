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
  session: { user_db_id: string; assessment_db_id: string };
  approvedRuntimeHash: string;
}) {
  const matches = input.grants.filter(grant => grant.student_db_id === input.session.user_db_id &&
    grant.assessment_db_id === input.session.assessment_db_id);
  if (matches.length > 1) throw new Error("Ambiguous initial feedback budget approval.");
  const grant = matches[0];
  return {
    model_config: { ...input.base, max_output_tokens: grant?.max_output_tokens ?? input.base.max_output_tokens },
    audit: {
      policy_version: "scoped-initial-feedback-budget-v1",
      approved_runtime_hash: input.approvedRuntimeHash,
      grant_id: grant?.grant_id ?? null,
      base_max_output_tokens: input.base.max_output_tokens,
      effective_max_output_tokens: grant?.max_output_tokens ?? input.base.max_output_tokens
    }
  };
}
