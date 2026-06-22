import { randomUUID } from "node:crypto";
import { PrismaClient, Prisma } from "@prisma/client";
import { AgentName } from "../src/lib/agents/names";
import { agentModelReadiness } from "../src/lib/llm/config";
import { getPromptForAgent, listAgentPrompts } from "../src/lib/agents/prompts/registry";

const prisma = new PrismaClient();

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function main() {
  const historicalId = randomUUID();

  try {
    assert(AgentName.options.includes("item_verification_agent"), "Active registry missing item_verification_agent.");
    assert(!AgentName.options.includes("item_preparation_agent" as never), "Retired item_preparation_agent remains active.");
    assert(getPromptForAgent("item_verification_agent").prompt_version === "item-verification-v1", "Prompt registry did not resolve item verification.");
    assert(
      listAgentPrompts().some((prompt) => prompt.agent_name === "item_verification_agent"),
      "Prompt list missing item verification."
    );
    assert(
      !listAgentPrompts().some((prompt) => prompt.agent_name === ("item_preparation_agent" as never)),
      "Prompt list still includes retired item preparation."
    );

    const readiness = agentModelReadiness();
    assert("item_verification_agent" in readiness, "Readiness missing item verification.");
    assert(!("item_preparation_agent" in readiness), "Readiness still includes item preparation.");

    await prisma.agentCall.create({
      data: {
        id: historicalId,
        agent_name: "item_preparation_agent",
        agent_version: "historical",
        model_name: "historical-model",
        provider: "mock",
        prompt_version: "item-preparation-v1",
        schema_version: "item-preparation-output-v1",
        input_payload: Prisma.JsonNull,
        call_status: "succeeded",
        output_validated: true
      }
    });
    const historical = await prisma.agentCall.findUniqueOrThrow({
      where: { id: historicalId },
      select: { agent_name: true }
    });
    assert(
      historical.agent_name === "item_preparation_agent",
      "Historical audit row should not be rewritten."
    );

    console.log("Item verification rename smoke test passed. Historical rows remain readable.");
  } finally {
    await prisma.agentCall.deleteMany({ where: { id: historicalId } });
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
