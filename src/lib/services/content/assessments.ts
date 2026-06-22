import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { parseCourseDateTimeInput } from "@/lib/services/assessment-availability/timezone";
import { generatePublicId } from "@/lib/services/ids";
import {
  AssessmentDraftInputSchema,
  AssessmentUpdateInputSchema
} from "./validation";
import { ContentServiceError, validationIssue } from "./errors";
import {
  archiveAssessmentSafely,
  assertAssessmentEditable,
  returnAssessmentToDraft as returnAssessmentToDraftSafely
} from "./governance";
import { serializeAssessment, serializeConceptUnit } from "./serializers";

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function hasOwn(value: object, key: string) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function parseCourseDateTimeField(path: string, value: string | null | undefined) {
  try {
    return parseCourseDateTimeInput(value ?? null);
  } catch (error) {
    throw new ContentServiceError(
      "validation_failed",
      "Assessment availability date/time validation failed.",
      400,
      {
        issues: [
          validationIssue(
            path,
            "invalid_course_datetime",
            error instanceof Error ? error.message : "Invalid course date/time."
          )
        ]
      }
    );
  }
}

function parseAvailabilityWindow(input: {
  release_at_course_time?: string | null;
  close_at_course_time?: string | null;
}) {
  const release_at = parseCourseDateTimeField(
    "release_at_course_time",
    input.release_at_course_time
  );
  const close_at = parseCourseDateTimeField("close_at_course_time", input.close_at_course_time);

  if (release_at && close_at && close_at <= release_at) {
    throw new ContentServiceError(
      "validation_failed",
      "Assessment close time must be after release time.",
      400,
      {
        issues: [
          validationIssue(
            "close_at_course_time",
            "invalid_assessment_availability_window",
            "Closing date/time must be after release date/time."
          )
        ]
      }
    );
  }

  return { release_at, close_at };
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
  const availability = parseAvailabilityWindow(data);

  try {
    const assessment = await prisma.assessment.create({
      data: {
        assessment_public_id: generatePublicId("assessment"),
        title: data.title,
        description: data.description ?? null,
        workflow_mode: data.workflow_mode,
        release_at: availability.release_at,
        close_at: availability.close_at,
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
  const assessment = await prisma.assessment.findFirst({
    where: {
      assessment_public_id: input.assessment_public_id,
      created_by_user_db_id: input.teacher_user_db_id
    },
    include: { _count: { select: { concept_units: true, assessment_sessions: true } } }
  });

  if (!assessment) {
    throw new ContentServiceError("not_found", "Assessment was not found.", 404);
  }

  if (hasOwn(data, "title") || hasOwn(data, "description")) {
    await assertAssessmentEditable(input);
  }

  const release_at = hasOwn(data, "release_at_course_time")
    ? parseCourseDateTimeField("release_at_course_time", data.release_at_course_time ?? null)
    : assessment.release_at;
  const close_at = hasOwn(data, "close_at_course_time")
    ? parseCourseDateTimeField("close_at_course_time", data.close_at_course_time ?? null)
    : assessment.close_at;

  if (release_at && close_at && close_at <= release_at) {
    throw new ContentServiceError(
      "validation_failed",
      "Assessment close time must be after release time.",
      400,
      {
        issues: [
          validationIssue(
            "close_at_course_time",
            "invalid_assessment_availability_window",
            "Closing date/time must be after release date/time."
          )
        ]
      }
    );
  }

  const updated = await prisma.assessment.update({
    where: { id: assessment.id },
    data: {
      title: data.title,
      description: data.description,
      workflow_mode: data.workflow_mode,
      release_at,
      close_at
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
