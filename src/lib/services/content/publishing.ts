import type { Item } from "@prisma/client";
import { prisma } from "@/lib/db";
import { serializeAssessment, serializeConceptUnit } from "./serializers";
import { ContentServiceError, type ContentValidationIssue, validationIssue } from "./errors";
import {
  assertAssessmentCanPublish,
  assertConceptUnitCanPublish,
  INCLUDED_ITEM_RANGE
} from "./governance";
import { ItemDraftInputSchema, zodIssuesToContentIssues } from "./validation";

export type PublishValidationResult = {
  ok: boolean;
  active_item_count: number;
  included_active_item_count: number;
  candidate_item_count: number;
  errors: ContentValidationIssue[];
};

type PublishableItem = Pick<
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

function isBlank(value: string | null | undefined): boolean {
  return !value || value.trim().length === 0;
}

function validatePublishableItem(item: PublishableItem, itemIndex: number): ContentValidationIssue[] {
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

  const issues: ContentValidationIssue[] = [];
  const incorrectLabels = parsed.data.options
    .map((option) => option.label)
    .filter((label) => label !== parsed.data.correct_option);

  for (const label of incorrectLabels) {
    const rationale = parsed.data.distractor_rationales[label];

    if (!rationale || rationale.trim().length === 0) {
      issues.push(
        validationIssue(
          `${pathPrefix}.distractor_rationales.${label}`,
          "missing_distractor_rationale",
          `Incorrect option ${label} requires a distractor rationale.`
        )
      );
    }
  }

  if (parsed.data.expected_reasoning_patterns.length === 0) {
    issues.push(
      validationIssue(
        `${pathPrefix}.expected_reasoning_patterns`,
        "missing_expected_reasoning_patterns",
        "At least one expected reasoning pattern is required."
      )
    );
  }

  if (parsed.data.possible_misconception_indicators.length === 0) {
    issues.push(
      validationIssue(
        `${pathPrefix}.possible_misconception_indicators`,
        "missing_possible_misconception_indicators",
        "At least one possible misconception indicator is required."
      )
    );
  }

  return issues;
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

  if (
    conceptUnit.items.length < INCLUDED_ITEM_RANGE.min ||
    conceptUnit.items.length > INCLUDED_ITEM_RANGE.max
  ) {
    issues.push(
      validationIssue(
        "items",
        "concept_unit_item_count_invalid",
        "A publishable concept unit must have exactly 3 to 4 included active items."
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
  });

  return {
    ok: issues.length === 0,
    active_item_count: conceptUnit.items.length,
    included_active_item_count: conceptUnit.items.length,
    candidate_item_count: conceptUnit._count.items,
    errors: issues
  };
}

export async function publishConceptUnit(input: {
  teacher_user_db_id: string;
  concept_unit_public_id: string;
}) {
  await assertConceptUnitCanPublish(input);
  const validation = await validateConceptUnitPublishable(input);

  if (
    validation.included_active_item_count < INCLUDED_ITEM_RANGE.min ||
    validation.included_active_item_count > INCLUDED_ITEM_RANGE.max
  ) {
    throw new ContentServiceError(
      "concept_unit_item_count_invalid",
      "A published concept unit must contain exactly 3 to 4 included active items.",
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
    select: { id: true }
  });

  await prisma.$transaction([
    prisma.item.updateMany({
      where: {
        concept_unit_db_id: conceptUnit.id,
        status: { not: "archived" },
        included_in_published_set: true
      },
      data: { status: "published" }
    }),
    prisma.item.updateMany({
      where: {
        concept_unit_db_id: conceptUnit.id,
        status: { not: "archived" },
        included_in_published_set: false
      },
      data: { status: "draft" }
    }),
    prisma.conceptUnit.update({
      where: { id: conceptUnit.id },
      data: { status: "published" }
    })
  ]);

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

  return { concept_unit: serializeConceptUnit(published), validation };
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
        where: { status: "published" },
        select: { concept_unit_public_id: true }
      }
    }
  });

  if (!assessmentWithConceptUnits) {
    throw new ContentServiceError("not_found", "Assessment was not found.", 404);
  }

  const conceptUnitResults = [];
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
      "Published concept units must pass publishing validation before the assessment can publish.",
      422,
      { concept_units: conceptUnitResults }
    );
  }

  const published = await prisma.assessment.update({
    where: { id: assessmentWithConceptUnits.id },
    data: { status: "published" },
    include: { _count: { select: { concept_units: true, assessment_sessions: true } } }
  });

  return {
    assessment: serializeAssessment(published),
    published_concept_unit_public_ids: conceptUnitResults.map(
      (result) => result.concept_unit_public_id
    ),
    publishable_concept_unit_public_ids: conceptUnitResults.map(
      (result) => result.concept_unit_public_id
    )
  };
}
