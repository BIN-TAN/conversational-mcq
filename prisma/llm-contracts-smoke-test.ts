import { PrismaClient } from "@prisma/client";
import { AgentOutputBase, agentInputSchemas, agentOutputSchemas } from "../src/lib/agents/contracts";
import { agentNames } from "../src/lib/agents/names";
import { mockOutputForAgent } from "../src/lib/agents/mock-fixtures";
import { computePromptHash } from "../src/lib/agents/prompt-hash";
import { getPromptForAgent } from "../src/lib/agents/prompts/registry";
import { resolveAgentModelConfig } from "../src/lib/llm/config";
import { fixtureInputForAgent } from "./llm-fixtures";

const prisma = new PrismaClient();

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function main() {
  const beforeProfiles = await prisma.studentProfile.count();
  const beforeDecisions = await prisma.formativeDecision.count();
  const beforeFollowups = await prisma.followupRound.count();
  const phaseSnapshot = await prisma.assessmentSession.findMany({
    select: { id: true, current_phase: true }
  });

  for (const agentName of agentNames) {
    assert(
      agentInputSchemas[agentName].safeParse(fixtureInputForAgent(agentName)).success,
      `${agentName} fixture input should validate.`
    );
    assert(
      agentOutputSchemas[agentName].safeParse(mockOutputForAgent(agentName)).success,
      `${agentName} fixture output should validate.`
    );

    const prompt = getPromptForAgent(agentName);
    assert(prompt.agent_name === agentName, `${agentName} prompt registry mismatch.`);
    assert(prompt.status === "draft", `${agentName} prompt should be draft in Phase 6A.`);
    assert(
      computePromptHash(prompt) === computePromptHash(prompt),
      `${agentName} prompt hash should be deterministic.`
    );
    assert(
      resolveAgentModelConfig(agentName).model_name.startsWith("mock-"),
      `${agentName} should resolve mock model config without an API key.`
    );
  }

  assert(agentNames.includes("item_verification_agent"), "Active agents should include item_verification_agent.");
  assert(
    !agentNames.includes("item_preparation_agent" as never),
    "Active agents should not include retired item_preparation_agent."
  );
  assert(
    agentInputSchemas.item_verification_agent.safeParse(fixtureInputForAgent("item_verification_agent")).success,
    "ItemVerificationInput should validate."
  );
  assert(
    agentOutputSchemas.item_verification_agent.safeParse(mockOutputForAgent("item_verification_agent")).success,
    "ItemVerificationOutput should validate."
  );
  assert(
    !agentOutputSchemas.item_verification_agent.safeParse({
      ...mockOutputForAgent("item_verification_agent"),
      item_results: [
        {
          item_public_id: "mock-item-1",
          findings: [
            {
              issue_code: "generated_replacement_item",
              location: "item_stem",
              brief_explanation: "Bad issue code."
            }
          ],
          teacher_review_required: true
        }
      ]
    }).success,
    "Unknown Item Verification issue codes should fail."
  );
  assert(
    !agentOutputSchemas.item_verification_agent.safeParse({
      ...mockOutputForAgent("item_verification_agent"),
      suggested_stem: "Generated rewrite"
    }).success,
    "Suggested rewrite fields should fail strict ItemVerificationOutput parsing."
  );
  assert(
    !agentOutputSchemas.item_verification_agent.safeParse({
      ...mockOutputForAgent("item_verification_agent"),
      generated_item: {
        item_stem: "Generated replacement item"
      }
    }).success,
    "Generated item fields should fail strict ItemVerificationOutput parsing."
  );

  const badProfile = {
    ...mockOutputForAgent("student_profiling_agent"),
    ability_profile: "high_ability"
  };
  assert(
    !agentOutputSchemas.student_profiling_agent.safeParse(badProfile).success,
    "Unknown ability_profile enum label should be rejected."
  );
  assert(
    !agentInputSchemas.response_collection_agent.safeParse({
      ...fixtureInputForAgent("response_collection_agent"),
      unexpected_field: true
    }).success,
    "Strict input schemas should reject unexpected fields."
  );
  assert(
    AgentOutputBase.safeParse(mockOutputForAgent("followup_agent")).success,
    "AgentOutputBase should validate output_status."
  );
  assert(
    !("status" in mockOutputForAgent("followup_agent")),
    "Agent output fixtures must not use older agent-level status."
  );

  assert((await prisma.studentProfile.count()) === beforeProfiles, "No student profile should be created.");
  assert(
    (await prisma.formativeDecision.count()) === beforeDecisions,
    "No formative decision should be created."
  );
  assert((await prisma.followupRound.count()) === beforeFollowups, "No follow-up round should be created.");

  const afterPhaseSnapshot = await prisma.assessmentSession.findMany({
    select: { id: true, current_phase: true }
  });
  assert(
    JSON.stringify(phaseSnapshot) === JSON.stringify(afterPhaseSnapshot),
    "Contract smoke test should not change student session phases."
  );

  console.log("LLM contract smoke test passed. No OpenAI call was made.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
