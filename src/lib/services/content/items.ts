import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { generatePublicId } from "@/lib/services/ids";
import { toPrismaJson } from "@/lib/services/json";
import {
  ItemDraftInputSchema,
  ItemUpdateInputSchema,
  ReorderItemsInputSchema
} from "./validation";
import { ensureMiniTestPrimaryConceptUnit } from "./assessments";
import { ContentServiceError } from "./errors";
import {
  assertConceptUnitEditable,
  assertItemCanArchive,
  assertItemEditable
} from "./governance";
import { itemSerializerInclude, serializeItem } from "./serializers";
import {
  itemMediaCreateData,
  mediaAssetsForInput,
  normalizeItemMediaAssetInputs
} from "./item-media";

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function jsonChanged(previous: unknown, next: unknown): boolean {
  return JSON.stringify(previous ?? null) !== JSON.stringify(next ?? null);
}

export async function replaceItemMediaAssets(
  tx: Prisma.TransactionClient,
  input: {
    item_db_id: string;
    media_assets: unknown;
  }
) {
  const mediaAssets = normalizeItemMediaAssetInputs(input.media_assets);

  await tx.itemMediaAsset.deleteMany({
    where: { item_db_id: input.item_db_id }
  });

  if (mediaAssets.length > 0) {
    await tx.itemMediaAsset.createMany({
      data: mediaAssets.map((asset) => itemMediaCreateData(input.item_db_id, asset))
    });
  }
}

async function getTeacherConceptUnitOrThrow(input: {
  teacher_user_db_id: string;
  concept_unit_public_id: string;
}) {
  const conceptUnit = await prisma.conceptUnit.findFirst({
    where: {
      concept_unit_public_id: input.concept_unit_public_id,
      assessment: { created_by_user_db_id: input.teacher_user_db_id }
    },
    select: { id: true, concept_unit_public_id: true }
  });

  if (!conceptUnit) {
    throw new ContentServiceError("not_found", "Concept unit was not found.", 404);
  }

  return conceptUnit;
}

async function getNextItemOrder(conceptUnitDbId: string): Promise<number> {
  const last = await prisma.item.findFirst({
    where: { concept_unit_db_id: conceptUnitDbId },
    orderBy: { item_order: "desc" },
    select: { item_order: true }
  });

  return (last?.item_order ?? 0) + 1;
}

export async function listItems(input: {
  teacher_user_db_id: string;
  concept_unit_public_id: string;
}) {
  const conceptUnit = await getTeacherConceptUnitOrThrow(input);
  const items = await prisma.item.findMany({
    where: { concept_unit_db_id: conceptUnit.id },
    orderBy: [{ item_order: "asc" }, { created_at: "asc" }],
    include: itemSerializerInclude
  });

  return items.map(serializeItem);
}

export async function createItem(input: {
  teacher_user_db_id: string;
  concept_unit_public_id: string;
  data: unknown;
}) {
  const data = ItemDraftInputSchema.parse(input.data);
  const conceptUnit = await assertConceptUnitEditable(input);
  const itemOrder = data.item_order ?? (await getNextItemOrder(conceptUnit.id));

  try {
    const item = await prisma.$transaction(async (tx) => {
      const created = await tx.item.create({
        data: {
          item_public_id: generatePublicId("item"),
          concept_unit_db_id: conceptUnit.id,
          item_order: itemOrder,
          item_stem: data.item_stem,
          options: toPrismaJson(data.options) ?? [],
          correct_option: data.correct_option,
          distractor_rationales: toPrismaJson(data.distractor_rationales),
          expected_reasoning_patterns: toPrismaJson(data.expected_reasoning_patterns),
          possible_misconception_indicators: toPrismaJson(
            data.possible_misconception_indicators
          ),
          administration_rules: toPrismaJson(data.administration_rules),
          included_in_published_set: data.included_in_published_set,
          status: "draft",
          version: 1
        }
      });

      await replaceItemMediaAssets(tx, {
        item_db_id: created.id,
        media_assets: data.media_assets
      });

      return tx.item.findUniqueOrThrow({
        where: { id: created.id },
        include: itemSerializerInclude
      });
    });

    return serializeItem(item);
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new ContentServiceError(
        "conflict",
        "Item order or public ID conflicts with existing content.",
        409
      );
    }

    throw error;
  }
}

export async function createAssessmentItem(input: {
  teacher_user_db_id: string;
  assessment_public_id: string;
  data: unknown;
}) {
  const conceptUnit = await ensureMiniTestPrimaryConceptUnit({
    teacher_user_db_id: input.teacher_user_db_id,
    assessment_public_id: input.assessment_public_id
  });

  return createItem({
    teacher_user_db_id: input.teacher_user_db_id,
    concept_unit_public_id: conceptUnit.concept_unit_public_id,
    data: input.data
  });
}

export async function getItemDetail(input: {
  teacher_user_db_id: string;
  item_public_id: string;
}) {
  const item = await prisma.item.findFirst({
    where: {
      item_public_id: input.item_public_id,
      concept_unit: { assessment: { created_by_user_db_id: input.teacher_user_db_id } }
    },
    include: itemSerializerInclude
  });

  if (!item) {
    throw new ContentServiceError("not_found", "Item was not found.", 404);
  }

  return serializeItem(item);
}

export async function updateItem(input: {
  teacher_user_db_id: string;
  item_public_id: string;
  data: unknown;
}) {
  const data = ItemUpdateInputSchema.parse(input.data);
  const item = await assertItemEditable(input);
  const existingMediaAssets = await prisma.itemMediaAsset.findMany({
    where: { item_db_id: item.id, active: true },
    orderBy: [{ order_index: "asc" }, { created_at: "asc" }]
  });

  const merged = ItemDraftInputSchema.parse({
    item_stem: data.item_stem ?? item.item_stem,
    options: data.options ?? item.options,
    correct_option: data.correct_option ?? item.correct_option,
    distractor_rationales: data.distractor_rationales ?? item.distractor_rationales ?? {},
    expected_reasoning_patterns:
      data.expected_reasoning_patterns ?? item.expected_reasoning_patterns ?? [],
    possible_misconception_indicators:
      data.possible_misconception_indicators ?? item.possible_misconception_indicators ?? [],
    administration_rules: data.administration_rules ?? item.administration_rules ?? {},
    media_assets: data.media_assets ?? mediaAssetsForInput(existingMediaAssets),
    included_in_published_set:
      data.included_in_published_set ?? item.included_in_published_set,
    item_order: item.item_order
  });
  const mediaChanged =
    data.media_assets !== undefined &&
    jsonChanged(mediaAssetsForInput(existingMediaAssets), normalizeItemMediaAssetInputs(data.media_assets));

  const destructiveChange =
    (data.item_stem !== undefined && data.item_stem !== item.item_stem) ||
    (data.options !== undefined && jsonChanged(item.options, data.options)) ||
    (data.correct_option !== undefined && data.correct_option !== item.correct_option) ||
    (data.distractor_rationales !== undefined &&
      jsonChanged(item.distractor_rationales, data.distractor_rationales)) ||
    mediaChanged;

  if (destructiveChange) {
    const responseCount = await prisma.itemResponse.count({
      where: { item_db_id: item.id }
    });

    if (responseCount > 0) {
      throw new ContentServiceError(
        "cannot_modify_published_with_responses",
        "Item content already has student responses and cannot be destructively changed.",
        409,
        {
          protected_fields: [
            "item_stem",
            "options",
            "correct_option",
            "distractor_rationales",
            "media_assets"
          ],
          response_count: responseCount
        }
      );
    }
  }

  const contentChanged =
    destructiveChange ||
    (data.expected_reasoning_patterns !== undefined &&
      jsonChanged(item.expected_reasoning_patterns, data.expected_reasoning_patterns)) ||
    (data.possible_misconception_indicators !== undefined &&
      jsonChanged(
        item.possible_misconception_indicators,
        data.possible_misconception_indicators
      )) ||
    (data.administration_rules !== undefined &&
      jsonChanged(item.administration_rules, data.administration_rules)) ||
    mediaChanged ||
    (data.included_in_published_set !== undefined &&
      data.included_in_published_set !== item.included_in_published_set);

  const updated = await prisma.$transaction(async (tx) => {
    const saved = await tx.item.update({
      where: { id: item.id },
      data: {
        item_stem: merged.item_stem,
        options: toPrismaJson(merged.options) ?? [],
        correct_option: merged.correct_option,
        distractor_rationales: toPrismaJson(merged.distractor_rationales),
        expected_reasoning_patterns: toPrismaJson(merged.expected_reasoning_patterns),
        possible_misconception_indicators: toPrismaJson(
          merged.possible_misconception_indicators
        ),
        administration_rules: toPrismaJson(merged.administration_rules),
        included_in_published_set: merged.included_in_published_set,
        version: contentChanged ? { increment: 1 } : undefined
      }
    });

    if (mediaChanged) {
      await replaceItemMediaAssets(tx, {
        item_db_id: item.id,
        media_assets: merged.media_assets
      });
    }

    return tx.item.findUniqueOrThrow({
      where: { id: saved.id },
      include: itemSerializerInclude
    });
  });

  return serializeItem(updated);
}

export async function reorderItems(input: {
  teacher_user_db_id: string;
  concept_unit_public_id: string;
  data: unknown;
}) {
  const data = ReorderItemsInputSchema.parse(input.data);
  const requestedIds = data.ordered_item_public_ids;
  const uniqueIds = new Set(requestedIds);

  if (uniqueIds.size !== requestedIds.length) {
    throw new ContentServiceError(
      "validation_failed",
      "Item reorder list contains duplicate public IDs.",
      400,
      { field: "ordered_item_public_ids" }
    );
  }

  const conceptUnit = await assertConceptUnitEditable(input);
  const items = await prisma.item.findMany({
    where: { concept_unit_db_id: conceptUnit.id },
    select: { id: true, item_public_id: true }
  });
  const currentIds = items.map((item) => item.item_public_id).sort();

  if (currentIds.join("|") !== [...requestedIds].sort().join("|")) {
    throw new ContentServiceError(
      "validation_failed",
      "Item reorder must include every item in the concept unit exactly once.",
      400,
      { expected_item_public_ids: currentIds }
    );
  }

  const byPublicId = new Map(items.map((item) => [item.item_public_id, item.id]));

  await prisma.$transaction(async (tx) => {
    await Promise.all(
      requestedIds.map((publicId, index) =>
        tx.item.update({
          where: { id: byPublicId.get(publicId) },
          data: { item_order: -100000 - index }
        })
      )
    );
    await Promise.all(
      requestedIds.map((publicId, index) =>
        tx.item.update({
          where: { id: byPublicId.get(publicId) },
          data: { item_order: index + 1 }
        })
      )
    );
  });

  return listItems({
    teacher_user_db_id: input.teacher_user_db_id,
    concept_unit_public_id: input.concept_unit_public_id
  });
}

export async function archiveItem(input: {
  teacher_user_db_id: string;
  item_public_id: string;
}) {
  const item = await assertItemCanArchive(input);

  const archived = await prisma.item.update({
    where: { id: item.id },
    data: { status: "archived" },
    include: itemSerializerInclude
  });

  return serializeItem(archived);
}
