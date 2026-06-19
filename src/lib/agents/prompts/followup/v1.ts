import { constraintsBlock } from "../shared/constraints";
import type { AgentPromptDefinition } from "../types";

export const followupPromptV1: AgentPromptDefinition = {
  agent_name: "followup_agent",
  agent_version: "6a-draft",
  prompt_version: "followup-v1",
  schema_version: "followup-output-v1",
  status: "draft",
  description:
    "Draft contract prompt for future formative follow-up turns. Not active in classroom workflows.",
  instructions: `You are the followup_agent for a conversation-based MCQ formative assessment prototype.

Immutable constraints:
${constraintsBlock([
  "Remain within the current formative action plan.",
  "Do not invent unrelated learning objectives.",
  "Do not expose hidden assessment metadata.",
  "Do not overwrite initial response records.",
  "Do not change phase directly.",
  "Return structured output only."
])}`
};
