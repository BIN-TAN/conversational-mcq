import { PrismaClient } from "@prisma/client";
import { executeAgent } from "../src/lib/agents/execute-agent";
import { agentNames } from "../src/lib/agents/names";
import { fixtureInputForAgent } from "./llm-fixtures";

const prisma = new PrismaClient();

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function cleanup(prefix: string) {
  await prisma.agentCall.deleteMany({
    where: {
      agent_invocation_key: {
        startsWith: prefix
      }
    }
  });
}

async function assertNoWorkflowSideEffects(before: {
  profiles: number;
  decisions: number;
  followups: number;
  phaseSnapshot: Array<{ id: string; current_phase: string }>;
}) {
  assert((await prisma.studentProfile.count()) === before.profiles, "No student profile should be created.");
  assert(
    (await prisma.formativeDecision.count()) === before.decisions,
    "No formative decision should be created."
  );
  assert((await prisma.followupRound.count()) === before.followups, "No follow-up round should be created.");

  const afterPhaseSnapshot = await prisma.assessmentSession.findMany({
    select: { id: true, current_phase: true },
    orderBy: { id: "asc" }
  });

  assert(
    JSON.stringify(afterPhaseSnapshot) === JSON.stringify(before.phaseSnapshot),
    "LLM execution smoke test should not change assessment session phases."
  );
}

async function main() {
  const prefix = `llm_execution_smoke_${Date.now()}`;
  await cleanup(prefix);

  const before = {
    profiles: await prisma.studentProfile.count(),
    decisions: await prisma.formativeDecision.count(),
    followups: await prisma.followupRound.count(),
    phaseSnapshot: await prisma.assessmentSession.findMany({
      select: { id: true, current_phase: true },
      orderBy: { id: "asc" }
    })
  };

  try {
    for (const agentName of agentNames) {
      const result = await executeAgent({
        agent_name: agentName,
        input: fixtureInputForAgent(agentName),
        agent_invocation_key: `${prefix}_${agentName}_success`,
        metadata: {
          smoke_test: "llm_execution",
          data_classification: "synthetic_only"
        }
      });

      assert(result.status === "succeeded", `${agentName} mock execution should succeed.`);
      assert(result.retry_count === 0, `${agentName} success should not require retries.`);

      const saved = await prisma.agentCall.findUniqueOrThrow({
        where: { agent_invocation_key: `${prefix}_${agentName}_success` }
      });
      assert(saved.provider === "mock", `${agentName} should use the mock provider by default.`);
      assert(saved.call_status === "succeeded", `${agentName} should persist succeeded audit status.`);
      assert(saved.output_validated, `${agentName} output should be validated.`);
      assert(saved.prompt_hash && saved.prompt_hash.length === 64, `${agentName} should persist prompt hash.`);
      assert(saved.model_name === `mock-${agentName}`, `${agentName} should persist mock model name.`);
      assert(saved.assessment_session_db_id === null, `${agentName} should not attach to real sessions.`);
    }

    const replay = await executeAgent({
      agent_name: "response_collection_agent",
      input: fixtureInputForAgent("response_collection_agent"),
      agent_invocation_key: `${prefix}_response_collection_agent_success`,
      metadata: {
        smoke_test: "llm_execution",
        data_classification: "synthetic_only"
      }
    });
    assert(replay.status === "succeeded", "Idempotent replay should succeed.");
    assert(replay.idempotent_replay, "Existing successful invocation should replay idempotently.");

    const transient = await executeAgent({
      agent_name: "response_collection_agent",
      input: fixtureInputForAgent("response_collection_agent"),
      agent_invocation_key: `${prefix}_transient`,
      metadata: {
        smoke_test: "llm_execution",
        mock_mode: "transient_error",
        mock_transient_failures_before_success: "1"
      }
    });
    assert(transient.status === "succeeded", "Transient mock error should retry and succeed.");
    assert(transient.retry_count === 1, "Transient retry count should be persisted.");

    const refusal = await executeAgent({
      agent_name: "response_collection_agent",
      input: fixtureInputForAgent("response_collection_agent"),
      agent_invocation_key: `${prefix}_refusal`,
      metadata: {
        smoke_test: "llm_execution",
        mock_mode: "refusal"
      }
    });
    assert(refusal.status === "refused", "Mock refusal should return refused status.");

    const incomplete = await executeAgent({
      agent_name: "response_collection_agent",
      input: fixtureInputForAgent("response_collection_agent"),
      agent_invocation_key: `${prefix}_incomplete`,
      metadata: {
        smoke_test: "llm_execution",
        mock_mode: "incomplete"
      }
    });
    assert(incomplete.status === "incomplete", "Mock incomplete should return incomplete status.");

    const invalidOutput = await executeAgent({
      agent_name: "response_collection_agent",
      input: fixtureInputForAgent("response_collection_agent"),
      agent_invocation_key: `${prefix}_invalid_output`,
      metadata: {
        smoke_test: "llm_execution",
        mock_mode: "invalid_output"
      }
    });
    assert(invalidOutput.status === "invalid_output", "Invalid structured output should be persisted.");

    const failed = await executeAgent({
      agent_name: "response_collection_agent",
      input: fixtureInputForAgent("response_collection_agent"),
      agent_invocation_key: `${prefix}_permanent_error`,
      metadata: {
        smoke_test: "llm_execution",
        mock_mode: "permanent_error"
      }
    });
    assert(failed.status === "failed", "Permanent mock error should fail without profile side effects.");

    const timeout = await executeAgent({
      agent_name: "response_collection_agent",
      input: fixtureInputForAgent("response_collection_agent"),
      agent_invocation_key: `${prefix}_timeout`,
      metadata: {
        smoke_test: "llm_execution",
        mock_mode: "timeout"
      }
    });
    assert(timeout.status === "failed", "Timeout mock error should fail after bounded retries.");
    assert(timeout.retry_count === 2, "Timeout retry count should respect OPENAI_MAX_RETRIES.");
    const timeoutCall = await prisma.agentCall.findUniqueOrThrow({
      where: { agent_invocation_key: `${prefix}_timeout` }
    });
    assert(timeoutCall.error_category === "timeout", "Timeout should persist sanitized timeout category.");

    await assertNoWorkflowSideEffects(before);
    console.log("LLM execution smoke test passed. Mock provider only; no OpenAI call was made.");
  } finally {
    await cleanup(prefix);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
