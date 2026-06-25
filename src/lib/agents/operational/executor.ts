import type { AgentName as AgentNameType } from "@/lib/agents/names";
import {
  executeAgent,
  type AgentExecutionResult,
  type ExecuteAgentInput
} from "@/lib/agents/execute-agent";
import type { AgentInputByName, AgentOutputByName } from "@/lib/agents/contracts";
import {
  approvedOperationalModelConfigForAgent,
  getGuardedOperationalAgentIntegrationReadiness,
  type OperationalAgentIntegrationBlockReason
} from "@/lib/operational/guarded-agent-integration";

export type OperationalAgentBlockedResult = {
  status: "blocked_by_operational_guard";
  reason: OperationalAgentIntegrationBlockReason;
  blocking_reasons: OperationalAgentIntegrationBlockReason[];
  retry_count: 0;
};

export type OperationalAgentExecutionResult<TOutput> =
  | AgentExecutionResult<TOutput>
  | OperationalAgentBlockedResult;

export type ExecuteOperationalAgentInput<TAgentName extends AgentNameType> = {
  agentName: TAgentName;
  invocationKey: string;
  allowlistedInput: AgentInputByName[TAgentName];
  operationalContext: {
    assessment_session_db_id?: string | null;
    concept_unit_session_db_id?: string | null;
    followup_round_db_id?: string | null;
  };
  forceNewInvocation?: boolean;
  metadata?: Record<string, string>;
  providerOverrideForTest?: ExecuteAgentInput<TAgentName>["model_config_override"];
};

export async function executeOperationalAgent<TAgentName extends AgentNameType>(
  input: ExecuteOperationalAgentInput<TAgentName>
): Promise<OperationalAgentExecutionResult<AgentOutputByName[TAgentName]>> {
  const readiness = await getGuardedOperationalAgentIntegrationReadiness({
    checkDatabase: true
  });

  if (!readiness.allowed) {
    return {
      status: "blocked_by_operational_guard",
      reason: readiness.block_reason ?? "operational_agent_mode_disabled",
      blocking_reasons: readiness.blocking_reasons,
      retry_count: 0
    };
  }

  return executeAgent({
    agent_name: input.agentName,
    input: input.allowlistedInput,
    assessment_session_db_id: input.operationalContext.assessment_session_db_id,
    concept_unit_session_db_id: input.operationalContext.concept_unit_session_db_id,
    followup_round_db_id: input.operationalContext.followup_round_db_id,
    agent_invocation_key: input.invocationKey,
    force_new_invocation: input.forceNewInvocation,
    metadata: {
      operational_agent_mode: readiness.mode,
      approved_config_hash: readiness.approved_configuration_hash,
      active_config_hash: readiness.active_configuration_hash,
      ...(input.metadata ?? {})
    },
    model_config_override:
      input.providerOverrideForTest ?? approvedOperationalModelConfigForAgent(input.agentName)
  });
}
