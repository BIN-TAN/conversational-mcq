import { agentNames } from "@/lib/agents/names";
import { listAgentPrompts } from "@/lib/agents/prompts/registry";
import {
  agentModelReadiness,
  getLlmRuntimeConfig,
  LlmConfigurationError
} from "@/lib/llm/config";
import { getTeacherLlmUsageStatus } from "@/lib/llm/usage/usage-serializers";
import { getGuardedOperationalAgentIntegrationReadiness } from "@/lib/operational/guarded-agent-integration";

export async function getLlmReadiness() {
  try {
    const runtime = getLlmRuntimeConfig();
    const prompts = listAgentPrompts();
    const modelReadiness = agentModelReadiness();
    const usage = await getTeacherLlmUsageStatus();
    const operationalIntegration = await getGuardedOperationalAgentIntegrationReadiness({
      checkEvaluationEvidence: false
    });

    return {
      provider: runtime.provider,
      live_calls_enabled: runtime.live_calls_enabled,
      openai_key_configured: runtime.openai_key_configured,
      agent_model_configured: modelReadiness,
      prompt_versions: Object.fromEntries(
        prompts.map((prompt) => [prompt.agent_name, prompt.prompt_version])
      ),
      schema_versions: Object.fromEntries(
        prompts.map((prompt) => [prompt.agent_name, prompt.schema_version])
      ),
      prompt_statuses: Object.fromEntries(prompts.map((prompt) => [prompt.agent_name, prompt.status])),
      mock_provider_available: true,
      agents_connected_to_classroom_workflows: operationalIntegration.allowed,
      prompts_active_in_classroom_workflows: operationalIntegration.allowed,
      guarded_operational_agent_integration: operationalIntegration,
      connectivity_test_uses_synthetic_data_only: true,
      students_use_openai_accounts: false,
      students_provide_api_keys: false,
      server_side_api_key_only: true,
      usage,
      agent_names: agentNames,
      configuration_error: null
    };
  } catch (error) {
    if (error instanceof LlmConfigurationError) {
      return {
        provider: "configuration_error",
        live_calls_enabled: false,
        openai_key_configured: false,
        agent_model_configured: {},
        prompt_versions: {},
        schema_versions: {},
        prompt_statuses: {},
        mock_provider_available: true,
        agents_connected_to_classroom_workflows: false,
        prompts_active_in_classroom_workflows: false,
        guarded_operational_agent_integration: null,
        connectivity_test_uses_synthetic_data_only: true,
        students_use_openai_accounts: false,
        students_provide_api_keys: false,
        server_side_api_key_only: true,
        usage: null,
        agent_names: agentNames,
        configuration_error: {
          code: error.code,
          message: error.message
        }
      };
    }

    throw error;
  }
}
