import type { Assessment, ConceptUnit, Item } from "@prisma/client";
import {
  serializeAssessmentContentState,
  serializeContentState,
  type SerializedContentState
} from "./governance";
import {
  formatCourseDateTime,
  getCourseTimezone,
  toCourseDateTimeInputValue
} from "@/lib/services/assessment-availability/timezone";

function serializeDate(value: Date): string {
  return value.toISOString();
}

export function serializeAssessment(
  assessment: Pick<
    Assessment,
    | "assessment_public_id"
    | "title"
    | "description"
    | "diagnostic_focus"
    | "folder_label"
    | "folder_order_index"
    | "assessment_order_index"
    | "status"
    | "workflow_mode"
    | "response_collection_mode"
    | "release_at"
    | "close_at"
    | "created_at"
    | "updated_at"
  > & {
    _count?: { concept_units?: number; assessment_sessions?: number };
  }
) {
  const contentState = serializeAssessmentContentState(assessment);

  return {
    assessment_public_id: assessment.assessment_public_id,
    title: assessment.title,
    description: assessment.description,
    diagnostic_focus: assessment.diagnostic_focus,
    folder_label: assessment.folder_label,
    folder_order_index: assessment.folder_order_index,
    assessment_order_index: assessment.assessment_order_index,
    status: assessment.status,
    workflow_mode: assessment.workflow_mode,
    response_collection_mode: assessment.response_collection_mode,
    release_at: assessment.release_at?.toISOString() ?? null,
    close_at: assessment.close_at?.toISOString() ?? null,
    release_at_course_time: formatCourseDateTime(assessment.release_at),
    close_at_course_time: formatCourseDateTime(assessment.close_at),
    release_at_course_time_input: toCourseDateTimeInputValue(assessment.release_at),
    close_at_course_time_input: toCourseDateTimeInputValue(assessment.close_at),
    course_timezone: getCourseTimezone(),
    ...contentState,
    concept_unit_count: assessment._count?.concept_units,
    created_at: serializeDate(assessment.created_at),
    updated_at: serializeDate(assessment.updated_at)
  };
}

export function serializeConceptUnit(
  conceptUnit: Pick<
    ConceptUnit,
    | "concept_unit_public_id"
    | "title"
    | "learning_objective"
    | "related_concept_description"
    | "administration_rules"
    | "order_index"
    | "status"
    | "version"
    | "created_at"
    | "updated_at"
  > & {
    assessment?: Pick<Assessment, "assessment_public_id" | "status"> & {
      _count?: { assessment_sessions?: number };
    };
    _count?: { items?: number };
    items?: Array<Pick<Item, "status" | "included_in_published_set">>;
    candidate_item_count?: number;
    included_active_item_count?: number;
  }
) {
  const contentState = conceptUnit.assessment
    ? serializeAssessmentContentState({
        assessment_public_id: conceptUnit.assessment.assessment_public_id,
        status: conceptUnit.assessment.status,
        _count: conceptUnit.assessment._count
      })
    : serializeContentState({
        status: conceptUnit.status,
        assessment_session_count: 0
      });

  return {
    concept_unit_public_id: conceptUnit.concept_unit_public_id,
    assessment_public_id: conceptUnit.assessment?.assessment_public_id,
    title: conceptUnit.title,
    learning_objective: conceptUnit.learning_objective,
    related_concept_description: conceptUnit.related_concept_description,
    administration_rules: conceptUnit.administration_rules,
    order_index: conceptUnit.order_index,
    status: conceptUnit.status,
    ...contentState,
    version: conceptUnit.version,
    item_count: conceptUnit._count?.items,
    candidate_item_count:
      conceptUnit.candidate_item_count ?? conceptUnit.items?.length ?? conceptUnit._count?.items,
    included_active_item_count:
      conceptUnit.included_active_item_count ??
      conceptUnit.items?.filter(
        (item) => item.status !== "archived" && item.included_in_published_set
      ).length,
    created_at: serializeDate(conceptUnit.created_at),
    updated_at: serializeDate(conceptUnit.updated_at)
  };
}

export function serializeItem(
  item: Pick<
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
    | "included_in_published_set"
    | "status"
    | "version"
    | "created_at"
    | "updated_at"
  > & {
    concept_unit?: Pick<ConceptUnit, "concept_unit_public_id" | "status"> & {
      assessment?: Pick<Assessment, "assessment_public_id" | "status"> & {
        _count?: { assessment_sessions?: number };
      };
    };
  }
) {
  const contentState: SerializedContentState | null = item.concept_unit?.assessment
    ? serializeAssessmentContentState({
        assessment_public_id: item.concept_unit.assessment.assessment_public_id,
        status: item.concept_unit.assessment.status,
        _count: item.concept_unit.assessment._count
      })
    : null;

  return {
    item_public_id: item.item_public_id,
    concept_unit_public_id: item.concept_unit?.concept_unit_public_id,
    item_order: item.item_order,
    item_stem: item.item_stem,
    options: item.options,
    correct_option: item.correct_option,
    distractor_rationales: item.distractor_rationales,
    expected_reasoning_patterns: item.expected_reasoning_patterns,
    possible_misconception_indicators: item.possible_misconception_indicators,
    administration_rules: item.administration_rules,
    included_in_published_set: item.included_in_published_set,
    status: item.status,
    concept_unit_status: item.concept_unit?.status,
    ...(contentState ?? {}),
    version: item.version,
    created_at: serializeDate(item.created_at),
    updated_at: serializeDate(item.updated_at)
  };
}
