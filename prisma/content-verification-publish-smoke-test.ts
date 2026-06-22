import { PrismaClient } from "@prisma/client";
import { runConceptUnitVerification, acknowledgeItemVerificationWarnings } from "../src/lib/agents/item-verification/service";
import { ContentServiceError } from "../src/lib/services/content/errors";
import { publishConceptUnit } from "../src/lib/services/content/publishing";
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

async function expectContentError(code: string, run: () => Promise<unknown>) {
  try {
    await run();
  } catch (error) {
    if (error instanceof ContentServiceError && error.code === code) {
      return;
    }

    throw error;
  }

  throw new Error(`Expected ContentServiceError ${code}.`);
}

async function main() {
  const prefix = `phase7d_verification_publish_${Date.now()}`;
  process.env.LLM_PROVIDER = "mock";
  process.env.LLM_LIVE_CALLS_ENABLED = "false";
  await cleanupItemVerificationFixture(prisma, prefix);

  try {
    const invalid = await createItemVerificationFixture({ prisma, prefix: `${prefix}_invalid`, itemCount: 1 });
    await expectContentError("concept_unit_item_count_invalid", () =>
      publishConceptUnit({
        teacher_user_db_id: invalid.teacher.id,
        concept_unit_public_id: invalid.conceptUnit.concept_unit_public_id,
        confirm_publish_without_current_verification: true
      })
    );

    const noCurrent = await createItemVerificationFixture({ prisma, prefix: `${prefix}_no_current` });
    await expectContentError("current_verification_missing_or_stale", () =>
      publishConceptUnit({
        teacher_user_db_id: noCurrent.teacher.id,
        concept_unit_public_id: noCurrent.conceptUnit.concept_unit_public_id
      })
    );
    const bypass = await publishConceptUnit({
      teacher_user_db_id: noCurrent.teacher.id,
      concept_unit_public_id: noCurrent.conceptUnit.concept_unit_public_id,
      confirm_publish_without_current_verification: true
    });
    assert(
      bypass.verification_policy.reason === "teacher_confirmed_without_current_verification",
      "Explicit confirmation should permit publish without current verification."
    );

    const clean = await createItemVerificationFixture({ prisma, prefix: `${prefix}_clean` });
    await runConceptUnitVerification({
      teacher_user_db_id: clean.teacher.id,
      concept_unit_public_id: clean.conceptUnit.concept_unit_public_id,
      mock_mode: "item_verification_no_warnings"
    });
    const cleanPublished = await publishConceptUnit({
      teacher_user_db_id: clean.teacher.id,
      concept_unit_public_id: clean.conceptUnit.concept_unit_public_id
    });
    assert(
      cleanPublished.verification_policy.reason === "current_no_warnings",
      "Current no-warning verification should permit publication."
    );

    const warning = await createItemVerificationFixture({ prisma, prefix: `${prefix}_warning` });
    const warningRun = await runConceptUnitVerification({
      teacher_user_db_id: warning.teacher.id,
      concept_unit_public_id: warning.conceptUnit.concept_unit_public_id,
      mock_mode: "item_verification_warning"
    });
    await expectContentError("warnings_need_acknowledgement", () =>
      publishConceptUnit({
        teacher_user_db_id: warning.teacher.id,
        concept_unit_public_id: warning.conceptUnit.concept_unit_public_id
      })
    );
    await acknowledgeItemVerificationWarnings({
      teacher_user_db_id: warning.teacher.id,
      concept_unit_public_id: warning.conceptUnit.concept_unit_public_id,
      verification_public_id: warningRun.verification!.verification_public_id
    });
    const warningPublished = await publishConceptUnit({
      teacher_user_db_id: warning.teacher.id,
      concept_unit_public_id: warning.conceptUnit.concept_unit_public_id
    });
    assert(
      warningPublished.verification_policy.reason === "warnings_acknowledged",
      "Acknowledged warnings should permit publication."
    );

    const stale = await createItemVerificationFixture({ prisma, prefix: `${prefix}_stale` });
    const staleRun = await runConceptUnitVerification({
      teacher_user_db_id: stale.teacher.id,
      concept_unit_public_id: stale.conceptUnit.concept_unit_public_id,
      mock_mode: "item_verification_warning"
    });
    await acknowledgeItemVerificationWarnings({
      teacher_user_db_id: stale.teacher.id,
      concept_unit_public_id: stale.conceptUnit.concept_unit_public_id,
      verification_public_id: staleRun.verification!.verification_public_id
    });
    await prisma.item.update({
      where: { id: stale.items[0].id },
      data: { item_stem: `${stale.items[0].item_stem} Content edit.`, version: { increment: 1 } }
    });
    await expectContentError("current_verification_missing_or_stale", () =>
      publishConceptUnit({
        teacher_user_db_id: stale.teacher.id,
        concept_unit_public_id: stale.conceptUnit.concept_unit_public_id
      })
    );
    await publishConceptUnit({
      teacher_user_db_id: stale.teacher.id,
      concept_unit_public_id: stale.conceptUnit.concept_unit_public_id,
      confirm_publish_without_current_verification: true
    });

    const failed = await createItemVerificationFixture({ prisma, prefix: `${prefix}_failed` });
    await runConceptUnitVerification({
      teacher_user_db_id: failed.teacher.id,
      concept_unit_public_id: failed.conceptUnit.concept_unit_public_id,
      mock_mode: "item_verification_invalid_rewrite"
    });
    await publishConceptUnit({
      teacher_user_db_id: failed.teacher.id,
      concept_unit_public_id: failed.conceptUnit.concept_unit_public_id,
      confirm_publish_without_current_verification: true
    });

    console.log("Content verification publication smoke test passed. No OpenAI network call was made.");
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
