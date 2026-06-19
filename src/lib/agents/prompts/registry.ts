import { AgentName, type AgentName as AgentNameType } from "@/lib/agents/names";
import { computePromptHash } from "@/lib/agents/prompt-hash";
import { formativePlanningPromptV1 } from "./formative-planning/v1";
import { followupPromptV1 } from "./followup/v1";
import { itemPreparationPromptV1 } from "./item-preparation/v1";
import { responseCollectionPromptV1 } from "./response-collection/v1";
import { studentProfilingPromptV1 } from "./student-profiling/v1";
import type { AgentPromptDefinition } from "./types";

const promptDefinitions = [
  itemPreparationPromptV1,
  responseCollectionPromptV1,
  studentProfilingPromptV1,
  formativePlanningPromptV1,
  followupPromptV1
] satisfies AgentPromptDefinition[];

const promptByAgent = new Map<AgentNameType, AgentPromptDefinition>(
  promptDefinitions.map((prompt) => [prompt.agent_name, prompt])
);

export function listAgentPrompts() {
  return promptDefinitions.map((prompt) => ({
    ...prompt,
    prompt_hash: computePromptHash(prompt)
  }));
}

export function getPromptForAgent(agentName: AgentNameType) {
  const parsedAgentName = AgentName.parse(agentName);
  const prompt = promptByAgent.get(parsedAgentName);

  if (!prompt) {
    throw new Error(`No prompt registered for agent ${parsedAgentName}.`);
  }

  return {
    ...prompt,
    prompt_hash: computePromptHash(prompt)
  };
}
