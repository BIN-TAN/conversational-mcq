import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { generatePublicId } from "@/lib/services/ids";
import { toPrismaJson } from "@/lib/services/json";
import { ContentServiceError } from "./errors";

const CreateAssessmentRevisionInputSchema = z
  .object({
    revision_reason: z.string().trim().min(5).max(1000),
    source_item_public_id: z.string().trim().min(1).optional()
  })
  .strict();

const revisionSourceInclude = Prisma.validator<Prisma.AssessmentInclude>()({
  _count: { select: { assessment_sessions: true } },
  concept_units: {
    where: { status: { not: "archived" } },
    orderBy: [{ order_index: "asc" }, { created_at: "asc" }],
    include: {
      items: {
        where: { status: { not: "archived" } },
        orderBy: [{ item_order: "asc" }, { created_at: "asc" }],
        include: {
          media_assets: {
            orderBy: [{ order_index: "asc" }, { created_at: "asc" }]
          }
        }
      }
    }
  }
});

type RevisionSource = Prisma.AssessmentGetPayload<{
  include: typeof revisionSourceInclude;
}>;

function canonicalize(value: unknown): unknown {
  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalize(entry)])
    );
  }

  return value;
}

export function assessmentRevisionSourceContentHash(source: RevisionSource): string {
  const snapshot = {
    assessment: {
      assessment_public_id: source.assessment_public_id,
      title: source.title,
      description: source.description,
      diagnostic_focus: source.diagnostic_focus,
      workflow_mode: source.workflow_mode,
      response_collection_mode: source.response_collection_mode,
      revision_number: source.revision_number
    },
    concept_units: source.concept_units.map((conceptUnit) => ({
      concept_unit_public_id: conceptUnit.concept_unit_public_id,
      title: conceptUnit.title,
      learning_objective: conceptUnit.learning_objective,
      related_concept_description: conceptUnit.related_concept_description,
      administration_rules: conceptUnit.administration_rules,
      order_index: conceptUnit.order_index,
      version: conceptUnit.version,
      items: conceptUnit.items.map((item) => ({
        item_public_id: item.item_public_id,
        item_order: item.item_order,
        item_stem: item.item_stem,
        options: item.options,
        correct_option: item.correct_option,
        distractor_rationales: item.distractor_rationales,
        expected_reasoning_patterns: item.expected_reasoning_patterns,
        possible_misconception_indicators: item.possible_misconception_indicators,
        administration_rules: item.administration_rules,
        included_in_published_set: item.included_in_published_set,
        version: item.version,
        media_assets: item.media_assets.map((asset) => ({
          media_public_id: asset.media_public_id,
          option_label: asset.option_label,
          placement: asset.placement,
          media_type: asset.media_type,
          source_type: asset.source_type,
          storage_key: asset.storage_key,
          public_or_signed_url: asset.public_or_signed_url,
          external_url: asset.external_url,
          title: asset.title,
          alt_text_or_description: asset.alt_text_or_description,
          student_alt_text: asset.student_alt_text,
          teacher_llm_media_description: asset.teacher_llm_media_description,
          caption: asset.caption,
          transcript_or_content_summary: asset.transcript_or_content_summary,
          source_attribution: asset.source_attribution,
          media_context_hash: asset.media_context_hash,
          order_index: asset.order_index,
          active: asset.active,
          media_version: asset.media_version
        }))
      }))
    }))
  };

  return createHash("sha256")
    .update(JSON.stringify(canonicalize(snapshot)))
    .digest("hex");
}

async function findExistingRevision(input: {
  teacher_user_db_id: string;
  source_assessment_public_id: string;
  source_item_public_id?: string;
}) {
  const assessment = await prisma.assessment.findFirst({
    where: {
      created_by_user_db_id: input.teacher_user_db_id,
      supersedes_assessment_public_id: input.source_assessment_public_id
    },
    select: {
      assessment_public_id: true,
      revision_number: true,
      status: true,
      source_content_hash: true
    }
  });

  if (!assessment) {
    return null;
  }

  const item = input.source_item_public_id
    ? await prisma.item.findUnique({
        where: { supersedes_item_public_id: input.source_item_public_id },
        select: { item_public_id: true }
      })
    : null;

  return {
    source_assessment_public_id: input.source_assessment_public_id,
    revision_assessment_public_id: assessment.assessment_public_id,
    revision_number: assessment.revision_number,
    revision_status: assessment.status,
    source_content_hash: assessment.source_content_hash,
    target_item_public_id: item?.item_public_id ?? null,
    created_new_revision: false
  };
}

export async function createEditableAssessmentRevision(input: {
  teacher_user_db_id: string;
  assessment_public_id: string;
  data: unknown;
}) {
  const data = CreateAssessmentRevisionInputSchema.parse(input.data);
  const existingRevision = await findExistingRevision({
    teacher_user_db_id: input.teacher_user_db_id,
    source_assessment_public_id: input.assessment_public_id,
    source_item_public_id: data.source_item_public_id
  });

  if (existingRevision) {
    return existingRevision;
  }

  const source = await prisma.assessment.findFirst({
    where: {
      assessment_public_id: input.assessment_public_id,
      created_by_user_db_id: input.teacher_user_db_id
    },
    include: revisionSourceInclude
  });

  if (!source) {
    throw new ContentServiceError("not_found", "Assessment was not found.", 404);
  }

  if (source._count.assessment_sessions === 0) {
    throw new ContentServiceError(
      "conflict",
      "This mini test has no student attempts. Return it to draft instead of creating a correction.",
      409,
      { assessment_public_id: source.assessment_public_id }
    );
  }

  if (source.status !== "published" && source.status !== "archived") {
    throw new ContentServiceError(
      "conflict",
      "Only a published or archived locked mini test can create a corrected version.",
      409,
      { assessment_public_id: source.assessment_public_id, status: source.status }
    );
  }

  if (source.concept_units.length === 0) {
    throw new ContentServiceError(
      "conflict",
      "The locked mini test has no active content to revise.",
      409,
      { assessment_public_id: source.assessment_public_id }
    );
  }

  const sourceItem = data.source_item_public_id
    ? source.concept_units
        .flatMap((conceptUnit) => conceptUnit.items)
        .find((item) => item.item_public_id === data.source_item_public_id)
    : null;

  if (data.source_item_public_id && !sourceItem) {
    throw new ContentServiceError(
      "not_found",
      "The item to correct was not found in this mini test.",
      404,
      { item_public_id: data.source_item_public_id }
    );
  }

  const sourceContentHash = assessmentRevisionSourceContentHash(source);
  try {
    return await prisma.$transaction(
      async (tx) => {
      const competingRevision = await tx.assessment.findUnique({
        where: { supersedes_assessment_public_id: source.assessment_public_id },
        select: {
          assessment_public_id: true,
          revision_number: true,
          status: true,
          source_content_hash: true
        }
      });

      if (competingRevision) {
        const item = data.source_item_public_id
          ? await tx.item.findUnique({
              where: { supersedes_item_public_id: data.source_item_public_id },
              select: { item_public_id: true }
            })
          : null;
        return {
          source_assessment_public_id: source.assessment_public_id,
          revision_assessment_public_id: competingRevision.assessment_public_id,
          revision_number: competingRevision.revision_number,
          revision_status: competingRevision.status,
          source_content_hash: competingRevision.source_content_hash,
          target_item_public_id: item?.item_public_id ?? null,
          created_new_revision: false
        };
      }

      const revisionAssessment = await tx.assessment.create({
        data: {
          assessment_public_id: generatePublicId("assessment"),
          title: source.title,
          description: source.description,
          diagnostic_focus: source.diagnostic_focus,
          folder_label: source.folder_label,
          folder_order_index: source.folder_order_index,
          assessment_order_index: source.assessment_order_index,
          workflow_mode: source.workflow_mode,
          response_collection_mode: source.response_collection_mode,
          release_at: source.release_at,
          close_at: source.close_at,
          revision_family_public_id:
            source.revision_family_public_id ?? source.assessment_public_id,
          revision_number: source.revision_number + 1,
          supersedes_assessment_public_id: source.assessment_public_id,
          revision_reason: data.revision_reason,
          source_content_hash: sourceContentHash,
          status: "draft",
          created_by_user_db_id: input.teacher_user_db_id
        },
        select: { id: true, assessment_public_id: true, revision_number: true, status: true }
      });

      let targetItemPublicId: string | null = null;
      for (const conceptUnit of source.concept_units) {
        const revisedConceptUnit = await tx.conceptUnit.create({
          data: {
            concept_unit_public_id: generatePublicId("concept_unit"),
            assessment_db_id: revisionAssessment.id,
            title: conceptUnit.title,
            learning_objective: conceptUnit.learning_objective,
            related_concept_description: conceptUnit.related_concept_description,
            administration_rules: toPrismaJson(conceptUnit.administration_rules),
            order_index: conceptUnit.order_index,
            status: "draft",
            version: conceptUnit.version + 1,
            supersedes_concept_unit_public_id: conceptUnit.concept_unit_public_id
          },
          select: { id: true }
        });

        for (const item of conceptUnit.items) {
          const revisedItem = await tx.item.create({
            data: {
              item_public_id: generatePublicId("item"),
              concept_unit_db_id: revisedConceptUnit.id,
              item_order: item.item_order,
              item_stem: item.item_stem,
              options: toPrismaJson(item.options) ?? [],
              correct_option: item.correct_option,
              distractor_rationales: toPrismaJson(item.distractor_rationales),
              expected_reasoning_patterns: toPrismaJson(item.expected_reasoning_patterns),
              possible_misconception_indicators: toPrismaJson(
                item.possible_misconception_indicators
              ),
              administration_rules: toPrismaJson(item.administration_rules),
              included_in_published_set: item.included_in_published_set,
              status: "draft",
              version: item.version + 1,
              supersedes_item_public_id: item.item_public_id
            },
            select: { id: true, item_public_id: true }
          });

          if (item.item_public_id === data.source_item_public_id) {
            targetItemPublicId = revisedItem.item_public_id;
          }

          if (item.media_assets.length > 0) {
            await tx.itemMediaAsset.createMany({
              data: item.media_assets.map((asset) => ({
                media_public_id: generatePublicId("item_media"),
                item_db_id: revisedItem.id,
                option_label: asset.option_label,
                placement: asset.placement,
                media_type: asset.media_type,
                source_type: asset.source_type,
                storage_key: asset.storage_key,
                public_or_signed_url: asset.public_or_signed_url,
                external_url: asset.external_url,
                title: asset.title,
                alt_text_or_description: asset.alt_text_or_description,
                student_alt_text: asset.student_alt_text,
                teacher_llm_media_description: asset.teacher_llm_media_description,
                caption: asset.caption,
                transcript_or_content_summary: asset.transcript_or_content_summary,
                source_attribution: asset.source_attribution,
                media_context_hash: asset.media_context_hash,
                order_index: asset.order_index,
                active: asset.active,
                media_version: asset.media_version,
                supersedes_media_public_id: asset.media_public_id
              }))
            });
          }
        }
      }

      return {
        source_assessment_public_id: source.assessment_public_id,
        revision_assessment_public_id: revisionAssessment.assessment_public_id,
        revision_number: revisionAssessment.revision_number,
        revision_status: revisionAssessment.status,
        source_content_hash: sourceContentHash,
        target_item_public_id: targetItemPublicId,
        created_new_revision: true
      };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      (error.code === "P2002" || error.code === "P2034")
    ) {
      const competingRevision = await findExistingRevision({
        teacher_user_db_id: input.teacher_user_db_id,
        source_assessment_public_id: input.assessment_public_id,
        source_item_public_id: data.source_item_public_id
      });

      if (competingRevision) {
        return competingRevision;
      }
    }

    throw error;
  }
}

export async function archiveSupersededAssessmentForRevision(
  tx: Prisma.TransactionClient,
  revisedAssessment: {
    assessment_public_id: string;
    created_by_user_db_id: string;
    supersedes_assessment_public_id: string | null;
    source_content_hash: string | null;
  }
) {
  if (!revisedAssessment.supersedes_assessment_public_id) {
    return null;
  }

  const source = await tx.assessment.findFirst({
    where: {
      assessment_public_id: revisedAssessment.supersedes_assessment_public_id,
      created_by_user_db_id: revisedAssessment.created_by_user_db_id
    },
    include: revisionSourceInclude
  });

  if (!source) {
    throw new ContentServiceError(
      "conflict",
      "The source mini test for this correction is no longer available.",
      409,
      { assessment_public_id: revisedAssessment.assessment_public_id }
    );
  }

  if (source._count.assessment_sessions === 0) {
    throw new ContentServiceError(
      "conflict",
      "The correction source no longer has the student-attempt history required by this revision.",
      409,
      { source_assessment_public_id: source.assessment_public_id }
    );
  }

  const currentSourceHash = assessmentRevisionSourceContentHash(source);
  if (!revisedAssessment.source_content_hash || currentSourceHash !== revisedAssessment.source_content_hash) {
    throw new ContentServiceError(
      "conflict",
      "The locked source content no longer matches the correction provenance record.",
      409,
      {
        source_assessment_public_id: source.assessment_public_id,
        reason: "revision_source_content_hash_mismatch"
      }
    );
  }

  if (source.status !== "archived") {
    await tx.assessment.update({
      where: { id: source.id },
      data: { status: "archived" }
    });
  }

  return source.assessment_public_id;
}
