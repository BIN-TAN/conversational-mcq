import { z } from "zod";

export const AgentName = z.enum([
  "item_preparation_agent",
  "response_collection_agent",
  "student_profiling_agent",
  "formative_value_and_planning_agent",
  "followup_agent"
]);

export type AgentName = z.infer<typeof AgentName>;

export const agentNames = AgentName.options;
