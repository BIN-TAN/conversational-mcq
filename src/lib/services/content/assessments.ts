import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
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
import {
  itemSerializerInclude,
  serializeAssessment,
  serializeConceptUnit,
  serializeItem
} from "./serializers";
import { mergeTopicDiagnosticNoteIntoRules } from "./teacher-diagnostic-context";

const assessmentListInclude = Prisma.validator<Prisma.AssessmentInclude>()({
  _count: { select: { concept_units: true, assessment_sessions: true } },
  concept_units: {
    select: {
      _count: { select: { items: true } }
    }
  }
});

const AssessmentOrganizationInputSchema = z
  .object({
    expected_revision: z.string().trim().min(16),
    groups: z
      .array(
        z
          .object({
            folder_label: z.string().trim().max(120).nullable(),
            assessment_public_ids: z.array(z.string().trim().min(1))
          })
          .strict()
      )
      .default([])
  })
  .strict();

type AssessmentOrganizationRevisionEntry = {
  assessment_public_id: string;
  folder_label: string | null;
  folder_order_index: number;
  assessment_order_index: number;
  updated_at: Date | string;
};

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

function normalizeFolderLabel(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function organizationTimestamp(value: Date | string) {
  return value instanceof Date ? value.toISOString() : value;
}

export function computeAssessmentOrganizationRevision(
  entries: AssessmentOrganizationRevisionEntry[]
) {
  const payload = entries
    .map((entry) => ({
      assessment_public_id: entry.assessment_public_id,
      folder_label: normalizeFolderLabel(entry.folder_label),
      folder_order_index: entry.folder_order_index,
      assessment_order_index: entry.assessment_order_index,
      updated_at: organizationTimestamp(entry.updated_at)
    }))
    .sort((left, right) => left.assessment_public_id.localeCompare(right.assessment_public_id));

  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function serializeAssessmentListItem(
  assessment: Prisma.AssessmentGetPayload<{ include: typeof assessmentListInclude }>
) {
  return {
    ...serializeAssessment(assessment),
    assessment_session_count: assessment._count.assessment_sessions,
    item_count: assessment.concept_units.reduce(
      (total, conceptUnit) => total + conceptUnit._count.items,
      0
    )
  };
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
    include: assessmentListInclude
  });

  return assessments.map(serializeAssessmentListItem);
}

export async function saveAssessmentOrganization(input: {
  teacher_user_db_id: string;
  data: unknown;
}) {
  const data = AssessmentOrganizationInputSchema.parse(input.data);

  return prisma.$transaction(
    async (tx) => {
      const assessments = await tx.assessment.findMany({
        where: { created_by_user_db_id: input.teacher_user_db_id },
        orderBy: [
          { folder_order_index: "asc" },
          { folder_label: "asc" },
          { assessment_order_index: "asc" },
          { created_at: "desc" }
        ],
        include: assessmentListInclude
      });
      const currentRevision = computeAssessmentOrganizationRevision(assessments);

      if (currentRevision !== data.expected_revision) {
        throw new ContentServiceError(
          "conflict",
          "The assessment library changed in another session. Refresh and try again.",
          409,
          { reason: "assessment_organization_revision_mismatch" }
        );
      }

      const knownByPublicId = new Map(
        assessments.map((assessment) => [assessment.assessment_public_id, assessment])
      );
      const seenAssessmentIds = new Set<string>();
      const seenFolderLabels = new Set<string>();
      const updates: Array<{
        id: string;
        folder_label: string | null;
        folder_order_index: number;
        assessment_order_index: number;
      }> = [];

      data.groups.forEach((group, groupIndex) => {
        const folder_label = normalizeFolderLabel(group.folder_label);
        const folderKey = folder_label ?? "__unfiled__";

        if (seenFolderLabels.has(folderKey)) {
          throw new ContentServiceError(
            "validation_failed",
            "Assessment organization contains duplicate folder groups.",
            400,
            {
              issues: [
                validationIssue(
                  `groups.${groupIndex}.folder_label`,
                  "duplicate_folder_group",
                  "Each folder/week/module may appear only once."
                )
              ]
            }
          );
        }
        seenFolderLabels.add(folderKey);

        group.assessment_public_ids.forEach((assessmentPublicId, assessmentIndex) => {
          if (seenAssessmentIds.has(assessmentPublicId)) {
            throw new ContentServiceError(
              "validation_failed",
              "Assessment organization contains duplicate mini tests.",
              400,
              {
                issues: [
                  validationIssue(
                    `groups.${groupIndex}.assessment_public_ids.${assessmentIndex}`,
                    "duplicate_assessment_public_id",
                    "Each mini test may appear only once."
                  )
                ]
              }
            );
          }

          const assessment = knownByPublicId.get(assessmentPublicId);
          if (!assessment) {
            seenAssessmentIds.add(assessmentPublicId);
            return;
          }

          seenAssessmentIds.add(assessmentPublicId);
          updates.push({
            id: assessment.id,
            folder_label,
            folder_order_index: groupIndex,
            assessment_order_index: assessmentIndex
          });
        });
      });

      const providedIds = [...seenAssessmentIds];
      const unknownIds = providedIds.filter((assessmentPublicId) => !knownByPublicId.has(assessmentPublicId));

      if (unknownIds.length > 0) {
        const existingUnknownCount = await tx.assessment.count({
          where: { assessment_public_id: { in: unknownIds } }
        });

        if (existingUnknownCount > 0) {
          throw new ContentServiceError(
            "forbidden",
            "One or more mini tests cannot be reorganized by this account.",
            403,
            { reason: "assessment_not_manageable" }
          );
        }

        throw new ContentServiceError(
          "validation_failed",
          "Assessment organization references unknown mini tests.",
          400,
          {
            issues: unknownIds.map((assessmentPublicId) =>
              validationIssue(
                "groups",
                "unknown_assessment_public_id",
                `Unknown mini test: ${assessmentPublicId}`
              )
            )
          }
        );
      }

      const omitted = assessments
        .map((assessment) => assessment.assessment_public_id)
        .filter((assessmentPublicId) => !seenAssessmentIds.has(assessmentPublicId));

      if (omitted.length > 0 || seenAssessmentIds.size !== assessments.length) {
        throw new ContentServiceError(
          "validation_failed",
          "Assessment organization must include every mini test exactly once.",
          400,
          {
            issues: omitted.map((assessmentPublicId) =>
              validationIssue(
                "groups",
                "missing_assessment_public_id",
                `Missing mini test: ${assessmentPublicId}`
              )
            )
          }
        );
      }

      for (const update of updates) {
        await tx.assessment.update({
          where: { id: update.id },
          data: {
            folder_label: update.folder_label,
            folder_order_index: update.folder_order_index,
            assessment_order_index: update.assessment_order_index
          }
        });
      }

      const updatedAssessments = await tx.assessment.findMany({
        where: { created_by_user_db_id: input.teacher_user_db_id },
        orderBy: [
          { folder_order_index: "asc" },
          { folder_label: "asc" },
          { assessment_order_index: "asc" },
          { created_at: "desc" }
        ],
        include: assessmentListInclude
      });

      return {
        assessments: updatedAssessments.map(serializeAssessmentListItem),
        organization_revision: computeAssessmentOrganizationRevision(updatedAssessments)
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
  );
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
            include: itemSerializerInclude
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
