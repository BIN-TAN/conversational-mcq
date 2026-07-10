import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { parseCourseDateTimeInput } from "@/lib/services/assessment-availability/timezone";
import { generatePublicId } from "@/lib/services/ids";
import { toPrismaJson } from "@/lib/services/json";
import {
  AssessmentDraftInputSchema,
  AssessmentUpdateInputSchema
} from "./validation";
import { ContentServiceError, validationIssue } from "./errors";
import {
  archiveAssessmentSafely,
  assertAssessmentEditable,
  returnAssessmentToDraft as returnAssessmentToDraftSafely,
  restoreArchivedAssessment as restoreArchivedAssessmentSafely
} from "./governance";
import { serializeAssessment, serializeConceptUnit, serializeItem } from "./serializers";
import { mergeTopicDiagnosticNoteIntoRules } from "./teacher-diagnostic-context";

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

function primaryTopicInput(input: {
  title: string;
  diagnostic_focus?: string | null;
  description?: string | null;
}) {
  const focus = input.diagnostic_focus?.trim() || input.description?.trim() || input.title;

  return {
    title: input.title,
    learning_objective: focus,
    related_concept_description: focus,
    administration_rules: mergeTopicDiagnosticNoteIntoRules({
      administration_rules: {
        teacher_authoring_mode: "mini_test_primary_topic",
        hidden_from_standard_teacher_flow: true
      },
      topic_diagnostic_note: focus
    })
  };
}

export async function listAssessments(input: { teacher_user_db_id: string }) {
  const assessments = await prisma.assessment.findMany({
    where: { created_by_user_db_id: input.teacher_user_db_id },
    orderBy: [
      { folder_order_index: "asc" },
      { folder_label: "asc" },
      { assessment_order_index: "asc" },
      { created_at: "desc" }
    ],
    include: {
      _count: { select: { concept_units: true, assessment_sessions: true } },
      concept_units: {
        select: {
          _count: { select: { items: true } }
        }
      }
    }
  });

  return assessments.map((assessment) => ({
    ...serializeAssessment(assessment),
    assessment_session_count: assessment._count.assessment_sessions,
    item_count: assessment.concept_units.reduce(
      (total, conceptUnit) => total + conceptUnit._count.items,
      0
    )
  }));
}

export async function createAssessment(input: {
  teacher_user_db_id: string;
  data: unknown;
}) {
  const data = AssessmentDraftInputSchema.parse(input.data);
  const availability = parseAvailabilityWindow(data);

  try {
    const assessment = await prisma.$transaction(async (tx) => {
      const created = await tx.assessment.create({
        data: {
          assessment_public_id: generatePublicId("assessment"),
          title: data.title,
          description: data.description ?? null,
          diagnostic_focus: data.diagnostic_focus ?? null,
          folder_label: data.folder_label ?? null,
          folder_order_index: data.folder_order_index ?? 0,
          assessment_order_index: data.assessment_order_index ?? 0,
          workflow_mode: data.workflow_mode,
          response_collection_mode: data.response_collection_mode,
          release_at: availability.release_at,
          close_at: availability.close_at,
          status: "draft",
          created_by_user_db_id: input.teacher_user_db_id
        },
        include: { _count: { select: { concept_units: true, assessment_sessions: true } } }
      });

      if (data.auto_create_primary_topic) {
        const topic = primaryTopicInput({
          title: data.title,
          diagnostic_focus: data.diagnostic_focus,
          description: data.description
        });
        await tx.conceptUnit.create({
          data: {
            concept_unit_public_id: generatePublicId("concept_unit"),
            assessment_db_id: created.id,
            title: topic.title,
            learning_objective: topic.learning_objective,
            related_concept_description: topic.related_concept_description,
            administration_rules: toPrismaJson(topic.administration_rules),
            order_index: 1,
            status: "draft",
            version: 1
          }
        });

        return tx.assessment.findUniqueOrThrow({
          where: { id: created.id },
          include: { _count: { select: { concept_units: true, assessment_sessions: true } } }
        });
      }

      return created;
    });

    return serializeAssessment(assessment);
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new ContentServiceError("conflict", "Assessment public ID conflict.", 409);
    }

    throw error;
  }
}

export async function ensureMiniTestPrimaryConceptUnit(input: {
  teacher_user_db_id: string;
  assessment_public_id: string;
}) {
  const assessment = await assertAssessmentEditable(input);
  const existing = await prisma.conceptUnit.findFirst({
    where: {
      assessment_db_id: assessment.id,
      status: { not: "archived" }
    },
    orderBy: [{ order_index: "asc" }, { created_at: "asc" }],
    select: { concept_unit_public_id: true }
  });

  if (existing) {
    return existing;
  }

  const topic = primaryTopicInput({
    title: assessment.title,
    diagnostic_focus: assessment.diagnostic_focus,
    description: assessment.description
  });
  const last = await prisma.conceptUnit.findFirst({
    where: { assessment_db_id: assessment.id },
    orderBy: { order_index: "desc" },
    select: { order_index: true }
  });
  const conceptUnit = await prisma.conceptUnit.create({
    data: {
      concept_unit_public_id: generatePublicId("concept_unit"),
      assessment_db_id: assessment.id,
      title: topic.title,
      learning_objective: topic.learning_objective,
      related_concept_description: topic.related_concept_description,
      administration_rules: toPrismaJson(topic.administration_rules),
      order_index: (last?.order_index ?? 0) + 1,
      status: "draft",
      version: 1
    },
    select: { concept_unit_public_id: true }
  });

  return conceptUnit;
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
              title: true,
              status: true,
              _count: { select: { assessment_sessions: true } }
            }
          },
          items: {
            orderBy: [{ item_order: "asc" }, { created_at: "asc" }],
            include: {
              concept_unit: {
                select: {
                  concept_unit_public_id: true,
                  status: true,
                  assessment: {
                    select: {
                      assessment_public_id: true,
                      title: true,
                      status: true,
                      _count: { select: { assessment_sessions: true } }
                    }
                  }
                }
              }
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
    concept_units: assessment.concept_units.map(serializeConceptUnit),
    mini_test_items: assessment.concept_units
      .flatMap((conceptUnit) => conceptUnit.items)
      .map(serializeItem)
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

  if (hasOwn(data, "response_collection_mode") && assessment._count.assessment_sessions > 0) {
    throw new ContentServiceError(
      "content_locked_after_student_session",
      "Response collection mode cannot be changed because student data collection has started.",
      409,
      {
        assessment_public_id: assessment.assessment_public_id,
        lock_reason: "student_session_exists"
      }
    );
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
        diagnostic_focus: data.diagnostic_focus,
        folder_label: data.folder_label,
        folder_order_index: data.folder_order_index,
        assessment_order_index: data.assessment_order_index,
        workflow_mode: data.workflow_mode,
      response_collection_mode: data.response_collection_mode,
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

export async function restoreAssessment(input: {
  teacher_user_db_id: string;
  assessment_public_id: string;
}) {
  const assessment = await restoreArchivedAssessmentSafely(input);

  return serializeAssessment(assessment);
}
