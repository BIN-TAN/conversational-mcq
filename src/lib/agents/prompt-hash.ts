import { createHash } from "node:crypto";
import type { AgentPromptDefinition } from "./prompts/types";

export function computePromptHash(prompt: Pick<
  AgentPromptDefinition,
  "instructions" | "prompt_version" | "schema_version"
>) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        instructions: prompt.instructions,
        prompt_version: prompt.prompt_version,
        schema_version: prompt.schema_version
      })
    )
    .digest("hex");
}
