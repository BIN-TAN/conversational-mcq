import { PrismaClient } from "@prisma/client";
import { runConceptUnitVerification } from "../src/lib/agents/item-verification/service";
import {
  cleanupItemVerificationFixture,
  createItemVerificationFixture
} from "./item-verification-smoke-fixture";

const prisma = new PrismaClient();

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function main() {
  const prefix = `phase7d_item_verification_ui_${Date.now()}`;
  process.env.LLM_PROVIDER = "mock";
  process.env.LLM_LIVE_CALLS_ENABLED = "false";
  await cleanupItemVerificationFixture(prisma, prefix);

  try {
    const fixture = await createItemVerificationFixture({ prisma, prefix });
    const result = await runConceptUnitVerification({
      teacher_user_db_id: fixture.teacher.id,
      concept_unit_public_id: fixture.conceptUnit.concept_unit_public_id,
      mock_mode: "item_verification_warning"
    });
    const serialized = JSON.stringify(result).toLowerCase();

    assert(serialized.includes("possible_ambiguity"), "Warning issue code should be serializable.");
    assert(serialized.includes("mock"), "Mock provider label should be serializable.");
    assert(!serialized.includes("apply ai revision"), "UI payload must not include apply revision controls.");
    assert(!serialized.includes("generate alternative"), "UI payload must not include generation controls.");
    assert(!serialized.includes("password_hash"), "UI payload must not expose password hashes.");
    assert(!serialized.includes("access_code_hash"), "UI payload must not expose access-code hashes.");
    assert(!serialized.includes(fixture.teacher.id), "UI payload must not expose internal teacher UUID.");

    console.log("Item verification UI smoke test passed. No OpenAI network call was made.");
  } finally {
    await cleanupItemVerificationFixture(prisma, prefix);
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
