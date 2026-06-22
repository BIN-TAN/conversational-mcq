import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { hashSecret } from "../src/lib/password";
import { createAssessment } from "../src/lib/services/content/assessments";
import {
  archiveConceptUnit,
  createConceptUnit
} from "../src/lib/services/content/concept-units";
import { archiveItem, createItem, listItems, updateItem } from "../src/lib/services/content/items";
import {
  publishConceptUnit,
  validateConceptUnitPublishable
} from "../src/lib/services/content/publishing";
import { ContentServiceError } from "../src/lib/services/content/errors";
import { normalizeUserId } from "../src/lib/services/student-accounts/validation";

const prisma = new PrismaClient();

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function assertNoInternalIds(value: unknown, path = "response") {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoInternalIds(entry, `${path}.${index}`));
    return;
  }

  if (!value || typeof value !== "object") {
    return;
  }

  for (const [key, entry] of Object.entries(value)) {
    assert(key !== "id", `Internal id leaked at ${path}.${key}`);
    assert(!key.endsWith("_db_id"), `Internal database foreign key leaked at ${path}.${key}`);
    assertNoInternalIds(entry, `${path}.${key}`);
  }
}

async function assertContentError(
  action: () => Promise<unknown>,
  code: string,
  message: string
) {
  try {
    await action();
  } catch (error) {
    assert(error instanceof ContentServiceError, `${message}: expected ContentServiceError.`);
    assert(error.code === code, `${message}: expected ${code}, received ${error.code}.`);
    return;
  }

  throw new Error(`${message}: expected ${code} error.`);
}

async function ensureDemoTeacher() {
  const passwordHash = await hashSecret("teacher_demo_password");

  return prisma.user.upsert({
    where: { user_id: "teacher_demo" },
    update: {
      role: "teacher_researcher",
      password_hash: passwordHash,
      access_code_hash: null
    },
    create: {
      user_id: "teacher_demo",
      user_id_normalized: normalizeUserId("teacher_demo"),
      role: "teacher_researcher",
      password_hash: passwordHash
    }
  });
}

function validItemInput(itemOrder: number, stemSuffix: string) {
  return {
    item_stem: `Phase 3A smoke item ${stemSuffix}`,
    options: [
      { label: "A", text: "Correct option" },
      { label: "B", text: "Distractor B" },
      { label: "C", text: "Distractor C" }
    ],
    correct_option: "A",
    distractor_rationales: {
      B: "B reflects a plausible partial understanding.",
      C: "C reflects a plausible misconception."
    },
    expected_reasoning_patterns: ["Selects A with conceptually supported reasoning."],
    possible_misconception_indicators: ["Selects B or C with aligned misconception reasoning."],
    administration_rules: { no_feedback_during_initial_administration: true },
    item_order: itemOrder
  };
}

async function main() {
  const prefix = `phase3a_smoke_${Date.now()}_${randomUUID().slice(0, 8)}`;
  const teacher = await ensureDemoTeacher();
  const created = {
    assessmentPublicIds: [] as string[],
    conceptUnitPublicIds: [] as string[],
    itemPublicIds: [] as string[]
  };

  try {
    const assessment = await createAssessment({
      teacher_user_db_id: teacher.id,
      data: {
        title: `Temporary ${prefix}`,
        description: "Temporary Phase 3A content smoke assessment."
      }
    });
    created.assessmentPublicIds.push(assessment.assessment_public_id);
    assertNoInternalIds(assessment);

    const conceptUnit = await createConceptUnit({
      teacher_user_db_id: teacher.id,
      assessment_public_id: assessment.assessment_public_id,
      data: {
        title: "Temporary valid concept unit",
        learning_objective: "Verify publish validation for a concept-based item set.",
        related_concept_description: "Temporary content smoke concept.",
        administration_rules: { initial_administration: "no_feedback" }
      }
    });
    created.conceptUnitPublicIds.push(conceptUnit.concept_unit_public_id);
    assertNoInternalIds(conceptUnit);

    const validItems: Array<{ item_public_id: string; version: number }> = [];
    for (const itemOrder of [1, 2, 3]) {
      const item = await createItem({
        teacher_user_db_id: teacher.id,
        concept_unit_public_id: conceptUnit.concept_unit_public_id,
        data: validItemInput(itemOrder, `${itemOrder}`)
      });
      created.itemPublicIds.push(item.item_public_id);
      validItems.push(item);
      assertNoInternalIds(item);
    }

    const beforeVersion = validItems[0].version;
    const updated = await updateItem({
      teacher_user_db_id: teacher.id,
      item_public_id: validItems[0].item_public_id,
      data: {
        expected_reasoning_patterns: [
          "Updated expected reasoning pattern for version smoke testing."
        ]
      }
    });
    assert(updated.version === beforeVersion + 1, "Content update did not increment item version.");

    const publishValidation = await validateConceptUnitPublishable({
      teacher_user_db_id: teacher.id,
      concept_unit_public_id: conceptUnit.concept_unit_public_id
    });
    assert(publishValidation.ok, "Expected valid concept unit publish validation to pass.");

    const published = await publishConceptUnit({
      teacher_user_db_id: teacher.id,
      concept_unit_public_id: conceptUnit.concept_unit_public_id,
      confirm_publish_without_current_verification: true
    });
    assert(published.concept_unit.status === "published", "Concept unit was not published.");
    assertNoInternalIds(published);

    const publishedItems = await listItems({
      teacher_user_db_id: teacher.id,
      concept_unit_public_id: conceptUnit.concept_unit_public_id
    });
    assert(
      publishedItems.every((item) => item.status === "published"),
      "Publishing a concept unit should publish active items."
    );

    await assertContentError(
      () =>
        updateItem({
          teacher_user_db_id: teacher.id,
          item_public_id: validItems[0].item_public_id,
          data: {
            expected_reasoning_patterns: [
              "Attempted direct edit after concept-unit publication."
            ]
          }
        }),
      "published_content_must_return_to_draft_before_editing",
      "Published concept-unit item edit should be rejected"
    );

    await assertContentError(
      () =>
        archiveItem({
          teacher_user_db_id: teacher.id,
          item_public_id: validItems[1].item_public_id
        }),
      "item_archive_would_invalidate_published_concept_unit",
      "Archiving one of exactly three included published items should be rejected"
    );

    const fewItemsConceptUnit = await createConceptUnit({
      teacher_user_db_id: teacher.id,
      assessment_public_id: assessment.assessment_public_id,
      data: {
        title: "Temporary invalid short concept unit",
        learning_objective: "Verify fewer than three active items fails.",
        related_concept_description: "Temporary invalid concept.",
        administration_rules: {}
      }
    });
    created.conceptUnitPublicIds.push(fewItemsConceptUnit.concept_unit_public_id);
    const lonelyItem = await createItem({
      teacher_user_db_id: teacher.id,
      concept_unit_public_id: fewItemsConceptUnit.concept_unit_public_id,
      data: validItemInput(1, "short")
    });
    created.itemPublicIds.push(lonelyItem.item_public_id);
    const fewItemsValidation = await validateConceptUnitPublishable({
      teacher_user_db_id: teacher.id,
      concept_unit_public_id: fewItemsConceptUnit.concept_unit_public_id
    });
    assert(!fewItemsValidation.ok, "Concept unit with fewer than 3 items should fail.");
    assert(
      fewItemsValidation.errors.some((error) => error.code === "concept_unit_item_count_invalid"),
      "Fewer-than-three validation did not return expected error code."
    );

    const missingRationaleConceptUnit = await createConceptUnit({
      teacher_user_db_id: teacher.id,
      assessment_public_id: assessment.assessment_public_id,
      data: {
        title: "Temporary invalid rationale concept unit",
        learning_objective: "Verify missing distractor rationale fails.",
        related_concept_description: "Temporary invalid rationale concept.",
        administration_rules: {}
      }
    });
    created.conceptUnitPublicIds.push(missingRationaleConceptUnit.concept_unit_public_id);

    for (const itemOrder of [1, 2, 3]) {
      const itemInput =
        itemOrder === 2
          ? {
              ...validItemInput(itemOrder, "missing-rationale"),
              distractor_rationales: {
                B: "B has a rationale, but C is intentionally missing."
              }
            }
          : validItemInput(itemOrder, `missing-rationale-${itemOrder}`);
      const item = await createItem({
        teacher_user_db_id: teacher.id,
        concept_unit_public_id: missingRationaleConceptUnit.concept_unit_public_id,
        data: itemInput
      });
      created.itemPublicIds.push(item.item_public_id);
    }
    const missingRationaleValidation = await validateConceptUnitPublishable({
      teacher_user_db_id: teacher.id,
      concept_unit_public_id: missingRationaleConceptUnit.concept_unit_public_id
    });
    assert(!missingRationaleValidation.ok, "Missing rationale should fail publish validation.");
    assert(
      missingRationaleValidation.errors.some(
        (error) => error.code === "missing_distractor_rationale"
      ),
      "Missing rationale validation did not return expected error code."
    );

    const archivedConceptUnit = await archiveConceptUnit({
      teacher_user_db_id: teacher.id,
      concept_unit_public_id: fewItemsConceptUnit.concept_unit_public_id
    });
    assert(
      archivedConceptUnit.status === "archived",
      "Concept unit archive did not set archived status."
    );

    console.log("Phase 3A content smoke test passed. No OpenAI calls are made by this script.");
  } finally {
    if (created.itemPublicIds.length > 0) {
      await prisma.item.deleteMany({
        where: { item_public_id: { in: created.itemPublicIds } }
      });
    }
    if (created.conceptUnitPublicIds.length > 0) {
      await prisma.conceptUnit.deleteMany({
        where: { concept_unit_public_id: { in: created.conceptUnitPublicIds } }
      });
    }
    if (created.assessmentPublicIds.length > 0) {
      await prisma.assessment.deleteMany({
        where: { assessment_public_id: { in: created.assessmentPublicIds } }
      });
    }
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
