import type { ItemVerificationRun } from "@prisma/client";
import type { AgentOutputByName } from "@/lib/agents/contracts";

export type SerializedItemVerificationRun = ReturnType<typeof serializeItemVerificationRun>;

export function serializeItemVerificationRun(input: {
  run: Pick<
    ItemVerificationRun,
    | "verification_public_id"
    | "content_fingerprint"
    | "concept_unit_version"
    | "status"
    | "verification_status"
    | "deterministic_validation_result"
    | "output_payload"
    | "warning_count"
    | "teacher_review_required"
    | "acknowledged_at"
    | "failure_message"
    | "created_at"
    | "updated_at"
  > & {
    agent_call?: {
      provider: string;
      model_name: string;
      prompt_version: string;
      schema_version: string;
      call_status: string;
      live_call_allowed: boolean;
    } | null;
    acknowledged_by?: { user_id: string; display_name: string | null } | null;
  };
  current_content_fingerprint: string;
}) {
  const output = input.run.output_payload as AgentOutputByName["item_verification_agent"] | null;
  const isCurrent = input.run.content_fingerprint === input.current_content_fingerprint;

  return {
    verification_public_id: input.run.verification_public_id,
    status: input.run.status,
    verification_status: input.run.verification_status,
    is_current: isCurrent,
    is_stale: !isCurrent,
    content_fingerprint: input.run.content_fingerprint,
    concept_unit_version: input.run.concept_unit_version,
    deterministic_validation_result: input.run.deterministic_validation_result,
    warning_count: input.run.warning_count,
    teacher_review_required: input.run.teacher_review_required,
    acknowledged: Boolean(input.run.acknowledged_at) && isCurrent,
    acknowledged_at: input.run.acknowledged_at?.toISOString() ?? null,
    acknowledged_by: input.run.acknowledged_by
      ? {
          user_id: input.run.acknowledged_by.user_id,
          display_name: input.run.acknowledged_by.display_name
        }
      : null,
    agent_call: input.run.agent_call
      ? {
          provider: input.run.agent_call.provider,
          model_name: input.run.agent_call.model_name,
          prompt_version: input.run.agent_call.prompt_version,
          schema_version: input.run.agent_call.schema_version,
          call_status: input.run.agent_call.call_status,
          live_call_allowed: input.run.agent_call.live_call_allowed
        }
      : null,
    output,
    failure_message: input.run.failure_message,
    created_at: input.run.created_at.toISOString(),
    updated_at: input.run.updated_at.toISOString()
  };
}
