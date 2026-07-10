import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { generatePublicId } from "@/lib/services/ids";
import { toPrismaJson } from "@/lib/services/json";
import {
  ConceptUnitDraftInputSchema,
  ConceptUnitUpdateInputSchema,
  ReorderConceptUnitsInputSchema
} from "./validation";
import { ContentServiceError } from "./errors";
import {
  assertAssessmentEditable,
  assertConceptUnitCanArchive,
  assertConceptUnitEditable,
  returnConceptUnitToDraft as returnConceptUnitToDraftSafely
} from "./governance";
import { itemSerializerInclude, serializeConceptUnit, serializeItem } from "./serializers";

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function jsonChanged(previous: unknown, next: unknown): boolean {
  return JSON.stringify(previous ?? null) !== JSON.stringify(next ?? null);
}

async function getTeacherAssessmentOrThrow(input: {
  teacher_user_db_id: string;
  assessment_public_id: string;
}) {
  const assessment = await prisma.assessment.findFirst({
    where: {
      assessment_public_id: input.assessment_public_id,
      created_by_user_db_id: input.teacher_user_db_id
    },
    select: { id: true, assessment_public_id: true }
  });

  if (!assessment) {
    throw new ContentServiceError("not_found", "Assessment was not found.", 404);
  }

  return assessment;
}

async function getNextConceptUnitOrder(assessmentDbId: string): Promise<number> {
  const last = await prisma.conceptUnit.findFirst({
    where: { assessment_db_id: assessmentDbId },
    orderBy: { order_index: "desc" },
    select: { order_index: true }
  });

  return (last?.order_index ?? 0) + 1;
}

export async function listConceptUnits(input: {
  teacher_user_db_id: string;
  assessment_public_id: string;
}) {
  const assessment = await getTeacherAssessmentOrThrow(input);
  const conceptUnits = await prisma.conceptUnit.findMany({
    where: { assessment_db_id: assessment.id },
    orderBy: [{ order_index: "asc" }, { created_at: "asc" }],
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

  return conceptUnits.map(serializeConceptUnit);
}

export async function createConceptUnit(input: {
  teacher_user_db_id: string;
  assessment_public_id: string;
  data: unknown;
}) {
  const data = ConceptUnitDraftInputSchema.parse(input.data);
  const assessment = await assertAssessmentEditable(input);
  const orderIndex = data.order_index ?? (await getNextConceptUnitOrder(assessment.id));

  try {
    const conceptUnit = await prisma.conceptUnit.create({
      data: {
        concept_unit_public_id: generatePublicId("concept_unit"),
        assessment_db_id: assessment.id,
        title: data.title,
        learning_objective: data.learning_objective,
        related_concept_description: data.related_concept_description,
        administration_rules: toPrismaJson(data.administration_rules),
        order_index: orderIndex,
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

    return serializeConceptUnit(conceptUnit);
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new ContentServiceError(
        "conflict",
        "Concept unit order or public ID conflicts with existing content.",
        409
      );
    }

    throw error;
  }
}

export async function getConceptUnitDetail(input: {
  teacher_user_db_id: string;
  concept_unit_public_id: string;
}) {
  const conceptUnit = await prisma.conceptUnit.findFirst({
    where: {
      concept_unit_public_id: input.concept_unit_public_id,
      assessment: { created_by_user_db_id: input.teacher_user_db_id }
    },
    include: {
      assessment: {
        select: {
          assessment_public_id: true,
          status: true,
          _count: { select: { assessment_sessions: true } }
        }
      },
      _count: { select: { items: true } },
      items: {
        orderBy: [{ item_order: "asc" }, { created_at: "asc" }],
        include: itemSerializerInclude
      }
    }
  });

  if (!conceptUnit) {
    throw new ContentServiceError("not_found", "Concept unit was not found.", 404);
  }

  return {
    ...serializeConceptUnit(conceptUnit),
    items: conceptUnit.items.map(serializeItem)
  };
}

export async function updateConceptUnit(input: {
  teacher_user_db_id: string;
  concept_unit_public_id: string;
  data: unknown;
}) {
  const data = ConceptUnitUpdateInputSchema.parse(input.data);
  const conceptUnit = await assertConceptUnitEditable(input);

  const contentChanged =
    (data.title !== undefined && data.title !== conceptUnit.title) ||
    (data.learning_objective !== undefined &&
      data.learning_objective !== conceptUnit.learning_objective) ||
    (data.related_concept_description !== undefined &&
      data.related_concept_description !== conceptUnit.related_concept_description) ||
    (data.administration_rules !== undefined &&
      jsonChanged(conceptUnit.administration_rules, data.administration_rules));

  const updated = await prisma.conceptUnit.update({
    where: { id: conceptUnit.id },
    data: {
      title: data.title,
      learning_objective: data.learning_objective,
      related_concept_description: data.related_concept_description,
      administration_rules:
        data.administration_rules === undefined
          ? undefined
          : toPrismaJson(data.administration_rules),
      version: contentChanged ? { increment: 1 } : undefined
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

  return serializeConceptUnit(updated);
}

export async function reorderConceptUnits(input: {
  teacher_user_db_id: string;
  assessment_public_id: string;
  data: unknown;
}) {
  const data = ReorderConceptUnitsInputSchema.parse(input.data);
  const requestedIds = data.ordered_concept_unit_public_ids;
  const uniqueIds = new Set(requestedIds);

  if (uniqueIds.size !== requestedIds.length) {
    throw new ContentServiceError(
      "validation_failed",
      "Concept unit reorder list contains duplicate public IDs.",
      400,
      { field: "ordered_concept_unit_public_ids" }
    );
  }

  const assessment = await assertAssessmentEditable(input);
  const conceptUnits = await prisma.conceptUnit.findMany({
    where: { assessment_db_id: assessment.id },
    select: { id: true, concept_unit_public_id: true }
  });
  const currentIds = conceptUnits.map((unit) => unit.concept_unit_public_id).sort();

  if (currentIds.join("|") !== [...requestedIds].sort().join("|")) {
    throw new ContentServiceError(
      "validation_failed",
      "Concept unit reorder must include every concept unit in the assessment exactly once.",
      400,
      { expected_concept_unit_public_ids: currentIds }
    );
  }

  const byPublicId = new Map(conceptUnits.map((unit) => [unit.concept_unit_public_id, unit.id]));

  await prisma.$transaction(async (tx) => {
    await Promise.all(
      requestedIds.map((publicId, index) =>
        tx.conceptUnit.update({
          where: { id: byPublicId.get(publicId) },
          data: { order_index: -100000 - index }
        })
      )
    );
    await Promise.all(
      requestedIds.map((publicId, index) =>
        tx.conceptUnit.update({
          where: { id: byPublicId.get(publicId) },
          data: { order_index: index + 1 }
        })
      )
    );
  });

  return listConceptUnits({
    teacher_user_db_id: input.teacher_user_db_id,
    assessment_public_id: input.assessment_public_id
  });
}

export async function archiveConceptUnit(input: {
  teacher_user_db_id: string;
  concept_unit_public_id: string;
}) {
  const conceptUnit = await assertConceptUnitCanArchive(input);

  const archived = await prisma.conceptUnit.update({
    where: { id: conceptUnit.id },
    data: { status: "archived" },
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

  return serializeConceptUnit(archived);
}

export async function returnConceptUnitToDraft(input: {
  teacher_user_db_id: string;
  concept_unit_public_id: string;
}) {
  const conceptUnit = await returnConceptUnitToDraftSafely(input);

  return serializeConceptUnit(conceptUnit);
}
