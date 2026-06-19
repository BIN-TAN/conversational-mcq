import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { generatePublicId } from "@/lib/services/ids";
import { toPrismaJson } from "@/lib/services/json";
import { serializeAssessment, serializeConceptUnit, serializeItem } from "./serializers";
import { ContentServiceError } from "./errors";
import { assertAssessmentEditable } from "./governance";
import { ConceptUnitImportInputSchema } from "./validation";

function uniqueNumbers(values: number[]): boolean {
  return new Set(values).size === values.length;
}

export async function importConceptBasedItemSets(input: {
  teacher_user_db_id: string;
  data: unknown;
}) {
  const data = ConceptUnitImportInputSchema.parse(input.data);

  try {
    if (data.assessment_public_id) {
      await assertAssessmentEditable({
        teacher_user_db_id: input.teacher_user_db_id,
        assessment_public_id: data.assessment_public_id
      });
    }

    return await prisma.$transaction(async (tx) => {
      const assessment = data.assessment_public_id
        ? await tx.assessment.findFirst({
            where: {
              assessment_public_id: data.assessment_public_id,
              created_by_user_db_id: input.teacher_user_db_id
            }
          })
        : await tx.assessment.create({
            data: {
              assessment_public_id: generatePublicId("assessment"),
              title: data.assessment?.title ?? "Imported assessment",
              description: data.assessment?.description ?? null,
              status: "draft",
              created_by_user_db_id: input.teacher_user_db_id
            }
          });

      if (!assessment) {
        throw new ContentServiceError("not_found", "Assessment was not found.", 404);
      }

      const lastConceptUnit = await tx.conceptUnit.findFirst({
        where: { assessment_db_id: assessment.id },
        orderBy: { order_index: "desc" },
        select: { order_index: true }
      });
      let nextConceptUnitOrder = (lastConceptUnit?.order_index ?? 0) + 1;
      const requestedConceptOrders = data.concept_units
        .map((unit) => unit.order_index)
        .filter((value): value is number => value !== undefined);

      if (!uniqueNumbers(requestedConceptOrders)) {
        throw new ContentServiceError(
          "validation_failed",
          "Imported concept units contain duplicate order_index values.",
          400
        );
      }

      if (requestedConceptOrders.length > 0) {
        const existingOrderCount = await tx.conceptUnit.count({
          where: {
            assessment_db_id: assessment.id,
            order_index: { in: requestedConceptOrders }
          }
        });

        if (existingOrderCount > 0) {
          throw new ContentServiceError(
            "conflict",
            "Imported concept unit order_index conflicts with existing content.",
            409
          );
        }
      }

      const createdConceptUnits = [];

      for (const conceptUnitInput of data.concept_units) {
        const conceptOrder = conceptUnitInput.order_index ?? nextConceptUnitOrder++;
        const itemOrders = conceptUnitInput.items.map((item, index) => item.item_order ?? index + 1);

        if (!uniqueNumbers(itemOrders)) {
          throw new ContentServiceError(
            "validation_failed",
            "Imported items contain duplicate item_order values within a concept unit.",
            400
          );
        }

        const conceptUnit = await tx.conceptUnit.create({
          data: {
            concept_unit_public_id: generatePublicId("concept_unit"),
            assessment_db_id: assessment.id,
            title: conceptUnitInput.title,
            learning_objective: conceptUnitInput.learning_objective,
            related_concept_description: conceptUnitInput.related_concept_description,
            administration_rules: toPrismaJson(conceptUnitInput.administration_rules),
            order_index: conceptOrder,
            status: "draft",
            version: 1
          },
          include: {
            assessment: {
              select: {
                assessment_public_id: true,
                status: true,
                _count: { select: { assessment_sessions: true } }
              }
            },
            items: {
              select: {
                status: true,
                included_in_published_set: true
              }
            },
            _count: { select: { items: true } }
          }
        });

        const createdItems = [];
        for (const [index, itemInput] of conceptUnitInput.items.entries()) {
          const item = await tx.item.create({
            data: {
              item_public_id: generatePublicId("item"),
              concept_unit_db_id: conceptUnit.id,
              item_order: itemOrders[index],
              item_stem: itemInput.item_stem,
              options: toPrismaJson(itemInput.options) ?? [],
              correct_option: itemInput.correct_option,
              distractor_rationales: toPrismaJson(itemInput.distractor_rationales),
              expected_reasoning_patterns: toPrismaJson(
                itemInput.expected_reasoning_patterns
              ),
              possible_misconception_indicators: toPrismaJson(
                itemInput.possible_misconception_indicators
              ),
              administration_rules: toPrismaJson(itemInput.administration_rules),
              included_in_published_set: itemInput.included_in_published_set,
              status: "draft",
              version: 1
            },
            include: {
              concept_unit: {
                select: {
                  concept_unit_public_id: true,
                  status: true,
                  assessment: {
                    select: {
                      assessment_public_id: true,
                      status: true,
                      _count: { select: { assessment_sessions: true } }
                    }
                  }
                }
              }
            }
          });

          createdItems.push(serializeItem(item));
        }

        createdConceptUnits.push({
          ...serializeConceptUnit({
            ...conceptUnit,
            _count: { items: createdItems.length }
          }),
          items: createdItems
        });
      }

      const conceptUnitCount = await tx.conceptUnit.count({
        where: { assessment_db_id: assessment.id }
      });

      return {
        validation: { ok: true, errors: [] },
        assessment: serializeAssessment({
          ...assessment,
          _count: { concept_units: conceptUnitCount }
        }),
        concept_units: createdConceptUnits
      };
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new ContentServiceError(
        "conflict",
        "Imported content conflicts with an existing unique database constraint.",
        409
      );
    }

    throw error;
  }
}
