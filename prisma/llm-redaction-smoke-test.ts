import { PrismaClient } from "@prisma/client";
import { executeAgent } from "../src/lib/agents/execute-agent";
import {
  assertNoProhibitedProviderInput,
  ProhibitedProviderInputError,
  redactForAudit
} from "../src/lib/agents/redaction";
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

function containsSecretLikeValue(value: unknown) {
  return /(secret-value|postgresql:\/\/|sk-|session-cookie-value|password-hash-value)/i.test(
    JSON.stringify(value)
  );
}

async function main() {
  const prefix = `llm_redaction_smoke_${Date.now()}`;
  await cleanup(prefix);

  const beforeProfiles = await prisma.studentProfile.count();
  const beforeDecisions = await prisma.formativeDecision.count();
  const beforeFollowups = await prisma.followupRound.count();

  try {
    const prohibitedPayload = {
      safe: "visible",
      nested: {
        password_hash: "password-hash-value",
        OPENAI_API_KEY: "sk-secret-value",
        DATABASE_URL: "postgresql://secret-value"
      },
      session_cookie: "session-cookie-value"
    };

    let rejected = false;
    try {
      assertNoProhibitedProviderInput(prohibitedPayload);
    } catch (error) {
      rejected = error instanceof ProhibitedProviderInputError;
    }
    assert(rejected, "Provider guard should reject prohibited secret/auth fields.");

    const redacted = redactForAudit(prohibitedPayload);
    assert(!containsSecretLikeValue(redacted), "Audit redaction should remove secret-like values.");

    const input = fixtureInputForAgent("response_collection_agent");
    const unsafeInput = {
      ...input,
      orchestration_constraints: {
        ...input.orchestration_constraints,
        access_code_hash: "password-hash-value"
      }
    };

    let executionRejected = false;
    try {
      await executeAgent({
        agent_name: "response_collection_agent",
        input: unsafeInput,
        agent_invocation_key: `${prefix}_should_reject`,
        metadata: {
          smoke_test: "llm_redaction"
        }
      });
    } catch (error) {
      executionRejected = error instanceof ProhibitedProviderInputError;
    }
    assert(executionRejected, "executeAgent should reject prohibited provider input before audit creation.");

    const rejectedCall = await prisma.agentCall.findUnique({
      where: { agent_invocation_key: `${prefix}_should_reject` }
    });
    assert(!rejectedCall, "Rejected prohibited input should not create an agent call audit row.");

    const formulaLikeInput = {
      ...input,
      student_message: "=This is untrusted student-like text, not a secret."
    };
    const safeResult = await executeAgent({
      agent_name: "response_collection_agent",
      input: formulaLikeInput,
      agent_invocation_key: `${prefix}_safe_formula_like_text`,
      metadata: {
        smoke_test: "llm_redaction",
        data_classification: "synthetic_only"
      }
    });
    assert(safeResult.status === "succeeded", "Non-secret untrusted text should pass provider guardrails.");

    const saved = await prisma.agentCall.findUniqueOrThrow({
      where: { agent_invocation_key: `${prefix}_safe_formula_like_text` }
    });
    assert(!containsSecretLikeValue(saved.input_payload), "Persisted input payload should not contain secrets.");
    assert(!containsSecretLikeValue(saved.raw_output), "Persisted raw output should not contain secrets.");
    assert(saved.provider === "mock", "Redaction smoke test should use mock provider only.");

    assert((await prisma.studentProfile.count()) === beforeProfiles, "No student profile should be created.");
    assert(
      (await prisma.formativeDecision.count()) === beforeDecisions,
      "No formative decision should be created."
    );
    assert((await prisma.followupRound.count()) === beforeFollowups, "No follow-up round should be created.");

    console.log("LLM redaction smoke test passed. No OpenAI call was made.");
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
