import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { generatePublicId } from "@/lib/services/ids";
import {
  AssessmentDraftInputSchema,
  AssessmentUpdateInputSchema
} from "./validation";
import { ContentServiceError } from "./errors";
import {
  archiveAssessmentSafely,
  assertAssessmentEditable,
  returnAssessmentToDraft as returnAssessmentToDraftSafely
} from "./governance";
import { serializeAssessment, serializeConceptUnit } from "./serializers";

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

export async function listAssessments(input: { teacher_user_db_id: string }) {
  const assessments = await prisma.assessment.findMany({
    where: { created_by_user_db_id: input.teacher_user_db_id },
    orderBy: [{ created_at: "desc" }],
    include: { _count: { select: { concept_units: true, assessment_sessions: true } } }
  });

  return assessments.map(serializeAssessment);
}

export async function createAssessment(input: {
  teacher_user_db_id: string;
  data: unknown;
}) {
  const data = AssessmentDraftInputSchema.parse(input.data);

  try {
    const assessment = await prisma.assessment.create({
      data: {
        assessment_public_id: generatePublicId("assessment"),
        title: data.title,
        description: data.description ?? null,
        status: "draft",
        created_by_user_db_id: input.teacher_user_db_id
      },
      include: { _count: { select: { concept_units: true, assessment_sessions: true } } }
    });

    return serializeAssessment(assessment);
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new ContentServiceError("conflict", "Assessment public ID conflict.", 409);
    }

    throw error;
  }
}

export async function getAssessmentDetail(input: {
  teacher_user_db_id: string;
  assessment_public_id: string;
}) {
  const assessment = await prisma.assessment.findFirst({
    where: {
      assessment_public_id: input.assessment_public_id,
      created_by_user_db_id: input.teacher_user_db_id
    },
    include: {
      _count: { select: { concept_units: true, assessment_sessions: true } },
      concept_units: {
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
      }
    }
  });

  if (!assessment) {
    throw new ContentServiceError("not_found", "Assessment was not found.", 404);
  }

  return {
    ...serializeAssessment(assessment),
    concept_units: assessment.concept_units.map(serializeConceptUnit)
  };
}

export async function updateAssessment(input: {
  teacher_user_db_id: string;
  assessment_public_id: string;
  data: unknown;
}) {
  const data = AssessmentUpdateInputSchema.parse(input.data);
  const assessment = await assertAssessmentEditable(input);

  const updated = await prisma.assessment.update({
    where: { id: assessment.id },
    data: {
      title: data.title,
      description: data.description
    },
    include: { _count: { select: { concept_units: true, assessment_sessions: true } } }
  });

  return serializeAssessment(updated);
}

export async function archiveAssessment(input: {
  teacher_user_db_id: string;
  assessment_public_id: string;
}) {
  const archived = await archiveAssessmentSafely(input);

  return serializeAssessment(archived);
}

export async function returnAssessmentToDraft(input: {
  teacher_user_db_id: string;
  assessment_public_id: string;
}) {
  const assessment = await returnAssessmentToDraftSafely(input);

  return serializeAssessment(assessment);
}
