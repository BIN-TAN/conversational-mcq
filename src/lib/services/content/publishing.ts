import { Prisma, type Item } from "@prisma/client";
import { prisma } from "@/lib/db";
import { serializeAssessment, serializeConceptUnit } from "./serializers";
import { ContentServiceError, type ContentValidationIssue, validationIssue } from "./errors";
import {
  assertAssessmentCanPublish,
  assertConceptUnitCanPublish,
  INCLUDED_ITEM_RANGE
} from "./governance";
import { getVerificationPublicationPolicy } from "@/lib/agents/item-verification/publication-policy";
import {
  readTeacherItemMetadata,
  readTopicDiagnosticNote
} from "./teacher-diagnostic-context";
import { essentialElementsIssues, optionRationaleWarnings } from "./item-publication-rules";
import { ItemDraftInputSchema, zodIssuesToContentIssues } from "./validation";
import { archiveSupersededAssessmentForRevision } from "./assessment-revisions";
import { preparePublishedAssessmentContext } from "./prepared-assessment-context";
import { MAX_PUBLISHED_TOPICS_PER_MINI_TEST } from "@/lib/services/assessment-availability/availability";

// Design decision D1 (docs/DESIGN_ALIGNMENT_2026-10-17.md): one topic per mini-test.
function multipleTopicsError(details: Record<string, unknown>) {
  return new ContentServiceError(
    "publish_validation_failed",
    "A mini test can contain only one topic. Move the other topic into its own mini test before publishing.",
    422,
    { reason: "assessment_multiple_topics_unsupported", max_topics: MAX_PUBLISHED_TOPICS_PER_MINI_TEST, ...details }
  );
}

export type PublishValidationResult = {
  ok: boolean;
  active_item_count: number;
  included_active_item_count: number;
  candidate_item_count: number;
  errors: ContentValidationIssue[];
  warnings: ContentValidationIssue[];
};

export type PublishableItem = Pick<
  Item,
  | "item_public_id"
  | "item_order"
  | "item_stem"
  | "options"
  | "correct_option"
  | "distractor_rationales"
  | "expected_reasoning_patterns"
  | "possible_misconception_indicators"
  | "administration_rules"
  | "status"
>;

async function lockUnchangedPublicationSource(tx: Prisma.TransactionClient, expected: { id: string; updated_at: Date }) {
  await tx.$queryRaw(Prisma.sql`SELECT id FROM assessments WHERE id = ${expected.id}::uuid FOR UPDATE`);
  const current = await tx.assessment.findUnique({ where: { id: expected.id }, select: { updated_at: true, _count: { select: { assessment_sessions: true } } } });
  if (current && current._count.assessment_sessions > 0) {
    throw new ContentServiceError("content_locked_after_student_session", "Student attempts already exist. Create a corrected version before changing this content.", 409);
  }
  if (!current || current.updated_at.getTime() !== expected.updated_at.getTime()) {
    throw new ContentServiceError("conflict", "The mini test changed during publication. Refresh and review its items before publishing again.", 409);
  }
}

function isBlank(value: string | null | undefined): boolean {
  return !value || value.trim().length === 0;
}

export function validatePublishableItem(item: PublishableItem, itemIndex: number): ContentValidationIssue[] {
  const pathPrefix = `items.${itemIndex}`;
  const parsed = ItemDraftInputSchema.safeParse({
    item_stem: item.item_stem,
    options: item.options,
    correct_option: item.correct_option,
    distractor_rationales: item.distractor_rationales ?? {},
    expected_reasoning_patterns: item.expected_reasoning_patterns ?? [],
    possible_misconception_indicators: item.possible_misconception_indicators ?? [],
    administration_rules: item.administration_rules ?? {},
    item_order: item.item_order
  });

  if (!parsed.success) {
    return zodIssuesToContentIssues(parsed.error, pathPrefix);
  }

  // Students always get an "E. I don't know yet" choice, which is recorded as
  // uncertainty and not scored. An item's own option E would be scored the same way.
  if (parsed.data.options.some((option) => option.label.trim().toUpperCase() === "E")) {
    return [validationIssue(
      `${pathPrefix}.options`,
      "reserved_option_label",
      "Option E is reserved for the student's \"I don't know yet\" choice. Use options A-D (at most four answer options)."
    )];
  }

  // docs/AI_MODULE_REDESIGN_2026-10-19.md 4.2: every published item lists one to three
  // essential elements, so the model and human reviewers judge against the same standard.
  return essentialElementsIssues(item, itemIndex);
}

export function validatePublishableItemWarnings(
  item: PublishableItem,
  itemIndex: number
): ContentValidationIssue[] {
  const pathPrefix = `items.${itemIndex}`;
  const metadata = readTeacherItemMetadata(item.administration_rules);
  const warnings: ContentValidationIssue[] = [];

  // The target reasoning is the explanation students see in their answer review (release 22).
  if (metadata.correct_option_notes.target_reasoning_note === "") {
    warnings.push(
      validationIssue(
        `${pathPrefix}.teacher_diagnostic_context.correct_option_notes.target_reasoning_note`,
        "teacher_expected_reasoning_note_missing",
        `Item ${typeof item.item_order === "number" ? item.item_order : itemIndex + 1}: add the target reasoning. Students see it as the explanation in their answer review; without it they see only the correct option.`
      )
    );
  }

  // One rationale per incorrect option (section 5): a warning, never blocking.
  warnings.push(...optionRationaleWarnings(item, itemIndex));

  return warnings;
}

export async function validateConceptUnitPublishable(input: {
  teacher_user_db_id: string;
  concept_unit_public_id: string;
}): Promise<PublishValidationResult> {
  const conceptUnit = await prisma.conceptUnit.findFirst({
    where: {
      concept_unit_public_id: input.concept_unit_public_id,
      assessment: { created_by_user_db_id: input.teacher_user_db_id }
    },
    include: {
      items: {
        where: {
          status: { not: "archived" },
          included_in_published_set: true
        },
        orderBy: [{ item_order: "asc" }, { created_at: "asc" }]
      },
      _count: { select: { items: true } }
    }
  });

  if (!conceptUnit) {
    throw new ContentServiceError("not_found", "Concept unit was not found.", 404);
  }

  const issues: ContentValidationIssue[] = [];
  const warnings: ContentValidationIssue[] = [];

  if (isBlank(conceptUnit.title)) {
    issues.push(validationIssue("title", "required", "Title is required."));
  }

  if (isBlank(conceptUnit.learning_objective)) {
    issues.push(
      validationIssue("learning_objective", "required", "Learning objective is required.")
    );
  }

  if (isBlank(conceptUnit.related_concept_description)) {
    issues.push(
      validationIssue(
        "related_concept_description",
        "required",
        "Related concept description is required."
      )
    );
  }

  if (!readTopicDiagnosticNote(conceptUnit.administration_rules)) {
    warnings.push(
      validationIssue(
        "teacher_diagnostic_context.topic_diagnostic_note",
        "teacher_topic_diagnostic_note_missing",
        "A teacher diagnostic note for this topic is recommended."
      )
    );
  }

  if (
    conceptUnit.items.length < INCLUDED_ITEM_RANGE.min ||
    conceptUnit.items.length > INCLUDED_ITEM_RANGE.max
  ) {
    issues.push(
      validationIssue(
        "items",
        "concept_unit_item_count_invalid",
        "A publishable concept unit must have at least 3 included active items."
      )
    );
  }

  const itemOrders = conceptUnit.items.map((item) => item.item_order);
  if (new Set(itemOrders).size !== itemOrders.length) {
    issues.push(
      validationIssue(
        "items.item_order",
        "duplicate_item_order",
        "Active item_order values must be unique within a concept unit."
      )
    );
  }

  conceptUnit.items.forEach((item, index) => {
    issues.push(...validatePublishableItem(item, index));
    warnings.push(...validatePublishableItemWarnings(item, index));
  });

  return {
    ok: issues.length === 0,
    active_item_count: conceptUnit.items.length,
    included_active_item_count: conceptUnit.items.length,
    candidate_item_count: conceptUnit._count.items,
    errors: issues,
    warnings
  };
}

export async function publishConceptUnit(input: {
  teacher_user_db_id: string;
  concept_unit_public_id: string;
  confirm_publish_without_current_verification?: boolean;
}) {
  const source = await assertConceptUnitCanPublish(input);
  const validation = await validateConceptUnitPublishable(input);

  if (
    validation.included_active_item_count < INCLUDED_ITEM_RANGE.min ||
    validation.included_active_item_count > INCLUDED_ITEM_RANGE.max
  ) {
    throw new ContentServiceError(
      "concept_unit_item_count_invalid",
      "A published concept unit must contain at least 3 included active items.",
      422,
      { validation }
    );
  }

  if (!validation.ok) {
    throw new ContentServiceError(
      "publish_validation_failed",
      "Concept unit did not pass publishing validation.",
      422,
      { validation }
    );
  }

  const conceptUnit = await prisma.conceptUnit.findFirstOrThrow({
    where: {
      concept_unit_public_id: input.concept_unit_public_id,
      assessment: { created_by_user_db_id: input.teacher_user_db_id }
    },
    select: { id: true, assessment_db_id: true }
  });

  const otherActiveTopicCount = await prisma.conceptUnit.count({
    where: {
      assessment_db_id: conceptUnit.assessment_db_id,
      id: { not: conceptUnit.id },
      status: { not: "archived" }
    }
  });
  if (otherActiveTopicCount + 1 > MAX_PUBLISHED_TOPICS_PER_MINI_TEST) {
    throw multipleTopicsError({
      concept_unit_public_id: input.concept_unit_public_id,
      other_active_topic_count: otherActiveTopicCount
    });
  }

  const verificationPolicy = await getVerificationPublicationPolicy({
    concept_unit_db_id: conceptUnit.id,
    teacher_confirmed_without_current_verification:
      input.confirm_publish_without_current_verification
  });

  if (!verificationPolicy.allowed) {
    throw new ContentServiceError(
      verificationPolicy.reason,
      verificationPolicy.reason === "warnings_need_acknowledgement"
        ? "Current AI verification warnings must be acknowledged before publishing."
        : "Publish without current AI verification requires explicit teacher confirmation.",
      409,
      { verification_policy: verificationPolicy }
    );
  }

  await prisma.$transaction(async (tx) => {
    await lockUnchangedPublicationSource(tx, source.assessment);
    await tx.item.updateMany({
      where: {
        concept_unit_db_id: conceptUnit.id,
        status: { not: "archived" },
        included_in_published_set: true
      },
      data: { status: "published" }
    });
    await tx.item.updateMany({
      where: {
        concept_unit_db_id: conceptUnit.id,
        status: { not: "archived" },
        included_in_published_set: false
      },
      data: { status: "draft" }
    });
    await tx.conceptUnit.update({
      where: { id: conceptUnit.id },
      data: { status: "published" }
    });
    await preparePublishedAssessmentContext(tx, conceptUnit.id);
  });

  const published = await prisma.conceptUnit.findUniqueOrThrow({
    where: { id: conceptUnit.id },
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

  return { concept_unit: serializeConceptUnit(published), validation, verification_policy: verificationPolicy };
}

export async function publishAssessment(input: {
  teacher_user_db_id: string;
  assessment_public_id: string;
}) {
  const assessment = await assertAssessmentCanPublish(input);
  const assessmentWithConceptUnits = await prisma.assessment.findFirst({
    where: {
      id: assessment.id
    },
    include: {
      _count: { select: { concept_units: true, assessment_sessions: true } },
      concept_units: {
        where: { status: { not: "archived" } },
        select: { concept_unit_public_id: true }
      }
    }
  });

  if (!assessmentWithConceptUnits) {
    throw new ContentServiceError("not_found", "Assessment was not found.", 404);
  }

  if (assessmentWithConceptUnits.concept_units.length === 0) {
    throw new ContentServiceError(
      "assessment_has_no_published_concept_units",
      "Add at least three MCQ items before publishing this mini test.",
      422,
      { assessment_public_id: assessment.assessment_public_id }
    );
  }

  if (assessmentWithConceptUnits.concept_units.length > MAX_PUBLISHED_TOPICS_PER_MINI_TEST) {
    throw multipleTopicsError({
      assessment_public_id: assessment.assessment_public_id,
      active_topic_count: assessmentWithConceptUnits.concept_units.length
    });
  }

  const conceptUnitResults: Array<{
    concept_unit_public_id: string;
    validation: PublishValidationResult;
  }> = [];
  for (const conceptUnit of assessmentWithConceptUnits.concept_units) {
    const validation = await validateConceptUnitPublishable({
      teacher_user_db_id: input.teacher_user_db_id,
      concept_unit_public_id: conceptUnit.concept_unit_public_id
    });

    conceptUnitResults.push({
      concept_unit_public_id: conceptUnit.concept_unit_public_id,
      validation
    });
  }

  const invalidConceptUnits = conceptUnitResults.filter((result) => !result.validation.ok);

  if (invalidConceptUnits.length > 0) {
    throw new ContentServiceError(
      "publish_validation_failed",
      "Fix the listed MCQ item issues before publishing this mini test.",
      422,
      { concept_units: conceptUnitResults }
    );
  }

  const published = await prisma.$transaction(async (tx) => {
    await lockUnchangedPublicationSource(tx, assessmentWithConceptUnits);
    for (const result of conceptUnitResults) {
      const conceptUnit = await tx.conceptUnit.findFirstOrThrow({
        where: {
          concept_unit_public_id: result.concept_unit_public_id,
          assessment_db_id: assessmentWithConceptUnits.id
        },
        select: { id: true }
      });
      await tx.item.updateMany({
        where: {
          concept_unit_db_id: conceptUnit.id,
          status: { not: "archived" },
          included_in_published_set: true
        },
        data: { status: "published" }
      });
      await tx.item.updateMany({
        where: {
          concept_unit_db_id: conceptUnit.id,
          status: { not: "archived" },
          included_in_published_set: false
        },
        data: { status: "draft" }
      });
      await tx.conceptUnit.update({
        where: { id: conceptUnit.id },
        data: { status: "published" }
      });
      await preparePublishedAssessmentContext(tx, conceptUnit.id);
    }

    const supersededAssessmentPublicId = await archiveSupersededAssessmentForRevision(
      tx,
      assessmentWithConceptUnits
    );
    // The first publication time is kept for research (release timing); later re-publications keep it.
    await tx.assessment.updateMany({
      where: { id: assessmentWithConceptUnits.id, published_at: null },
      data: { published_at: new Date() }
    });
    const revisedAssessment = await tx.assessment.update({
      where: { id: assessmentWithConceptUnits.id },
      data: { status: "published" },
      include: { _count: { select: { concept_units: true, assessment_sessions: true } } }
    });

    return { revisedAssessment, supersededAssessmentPublicId };
  });

  return {
    assessment: serializeAssessment(published.revisedAssessment),
    superseded_assessment_public_id: published.supersededAssessmentPublicId,
    published_concept_unit_public_ids: conceptUnitResults.map(
      (result) => result.concept_unit_public_id
    ),
    publishable_concept_unit_public_ids: conceptUnitResults.map(
      (result) => result.concept_unit_public_id
    )
  };
}
