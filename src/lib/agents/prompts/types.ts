import type { AgentName } from "@/lib/agents/names";

export type PromptStatus = "draft" | "approved_for_testing" | "active" | "retired";

export type AgentPromptDefinition = {
  agent_name: AgentName;
  agent_version: string;
  prompt_version: string;
  schema_version: string;
  instructions: string;
  description: string;
  status: PromptStatus;
};
