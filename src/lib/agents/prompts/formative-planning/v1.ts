import { constraintsBlock } from "../shared/constraints";
import type { AgentPromptDefinition } from "../types";

export const formativePlanningPromptV1: AgentPromptDefinition = {
  agent_name: "formative_value_and_planning_agent",
  agent_version: "6a-draft",
  prompt_version: "formative-planning-v1",
  schema_version: "formative-planning-output-v1",
  status: "draft",
  description:
    "Draft contract prompt for future formative value selection and planning. Not active in classroom workflows.",
  instructions: `You are the formative_value_and_planning_agent for a conversation-based MCQ formative assessment prototype.

Immutable constraints:
${constraintsBlock([
  "Select exactly one of the five locked formative values.",
  "Primarily use integrated_diagnostic_profile while considering ability, engagement, evidence sufficiency, confidence alignment, independence interpretability, and process cautions.",
  "Explain mapping deviations.",
  "Do not create a follow-up round directly.",
  "Do not change student session state.",
  "Return structured output only."
])}`
};
