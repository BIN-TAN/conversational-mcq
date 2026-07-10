import { createHash } from "node:crypto";
import { z } from "zod";
import { teacherDiagnosticContextForProvider } from "@/lib/services/content/teacher-diagnostic-context";

export const ASSESSMENT_INTERPRETATION_CONTEXT_SCHEMA_VERSION =
  "assessment-interpretation-context-v1" as const;

const StringOrNullSchema = z.string().nullable();

const AssessmentInterpretationContextItemSchema = z.object({
  item_public_id: z.string(),
  item_snapshot_public_id: z.string(),
  item_order: z.number().nullable(),
  item_role: StringOrNullSchema,
  stem: StringOrNullSchema,
  visible_options: z.unknown(),
  correct_option_internal: StringOrNullSchema,
  target_reasoning_note: StringOrNullSchema,
  strong_reasoning_should_mention: StringOrNullSchema,
  plain_language_distractor_diagnostic_notes: StringOrNullSchema,
  interpretation_caution: StringOrNullSchema,
  llm_media_context: z.array(z.unknown()).default([])
}).strict();

const AssessmentInterpretationContextEvidenceSchema = z.object({
  item_public_id: z.string(),
  selected_option: StringOrNullSchema,
  written_reasoning: StringOrNullSchema,
  confidence: StringOrNullSchema,
  revision_summary: StringOrNullSchema,
  tempting_option: StringOrNullSchema,
  tempting_option_reason: StringOrNullSchema,
  safe_timing_summary: z.object({
    total_item_time_ms: z.number().nullable(),
    response_time_answer_ms: z.number().nullable(),
    response_time_reasoning_ms: z.number().nullable(),
    response_time_confidence_ms: z.number().nullable()
  }).strict()
}).strict();

export const AssessmentInterpretationContextV1Schema = z.object({
  schema_version: z.literal(ASSESSMENT_INTERPRETATION_CONTEXT_SCHEMA_VERSION),
  assessment: z.object({
    assessment_public_id: z.string(),
    assessment_snapshot_public_id: z.string(),
    assessment_title: StringOrNullSchema,
    diagnostic_focus: StringOrNullSchema,
    folder_or_module: StringOrNullSchema,
    phase: z.enum([
      "initial_administration",
      "post_initial_interpretation",
      "formative_value_selection",
      "formative_activity",
      "post_activity_evaluation"
    ])
  }).strict(),
  concept_unit: z.object({
    concept_unit_public_id: StringOrNullSchema,
    concept_unit_snapshot_public_id: StringOrNullSchema,
    title: StringOrNullSchema,
    learning_objective: StringOrNullSchema,
    related_concept_description: StringOrNullSchema
  }).strict(),
  items: z.array(AssessmentInterpretationContextItemSchema),
  observed_student_evidence: z.object({
    item_responses: z.array(AssessmentInterpretationContextEvidenceSchema),
    cross_item_evidence_summary: z.string(),
    prior_activity_evidence_summary: z.string().nullable(),
    process_context: z.object({
      safe_process_counts: z.unknown(),
      process_data_are_reliability_context_only: z.literal(true),
      timing_alone_is_not_guessing_or_disengagement: z.literal(true)
    }).strict()
  }).strict(),
  teacher_diagnostic_guidance: z.object({
    assessment_diagnostic_focus: StringOrNullSchema,
    guidance_not_ground_truth: z.literal(true),
    item_guidance: z.array(z.object({
      item_public_id: z.string(),
      target_reasoning_note: StringOrNullSchema,
      strong_reasoning_should_mention: StringOrNullSchema,
      plain_language_distractor_diagnostic_notes: StringOrNullSchema,
      interpretation_caution: StringOrNullSchema
    }).strict())
  }).strict(),
  interpretation_rules: z.object({
    teacher_notes_are_guidance_not_ground_truth: z.literal(true),
    observed_student_evidence_takes_priority: z.literal(true),
    selected_option_is_indirect_evidence_only: z.literal(true),
    correctness_alone_is_not_understanding: z.literal(true),
    timing_alone_is_not_guessing_or_disengagement: z.literal(true),
    alternative_explanations_required: z.literal(true),
    student_visible_answer_key_prohibited: z.literal(true),
    raw_teacher_notes_must_not_be_quoted_to_student: z.literal(true)
  }).strict(),
  limitations: z.array(z.string())
}).strict();

export type AssessmentInterpretationContextV1 = z.infer<
  typeof AssessmentInterpretationContextV1Schema
>;

export type AssessmentInterpretationContextAuditMetadata = {
  assessment_context_schema_version: typeof ASSESSMENT_INTERPRETATION_CONTEXT_SCHEMA_VERSION;
  assessment_snapshot_public_id: string | null;
  item_snapshot_public_ids: string[];
  assessment_context_hash: string;
  teacher_diagnostic_context_present: boolean;
  target_reasoning_present: boolean;
  strong_reasoning_present: boolean;
  distractor_notes_present: boolean;
  interpretation_caution_present: boolean;
  student_evidence_present: boolean;
  context_version_bound: boolean;
  answer_key_internal_only: true;
  student_visible_protected_content_exposed: false;
};

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && Boolean(entry.trim()))
    : [];
}

function jsonPath(recordValue: JsonRecord, key: string): JsonRecord {
  return record(recordValue[key]);
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }

  const entries = Object.entries(value as JsonRecord)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`);

  return `{${entries.join(",")}}`;
}

export function hashAssessmentInterpretationContext(value: unknown) {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function snapshotId(prefix: string, publicId: string | null, version?: unknown, fallbackHashSource?: unknown) {
  if (publicId && typeof version === "number") {
    return `${prefix}_${publicId}_v${version}`;
  }

  if (publicId) {
    const hash = hashAssessmentInterpretationContext(fallbackHashSource ?? publicId).slice(0, 16);
    return `${prefix}_${publicId}_snapshot_${hash}`;
  }

  return `${prefix}_unknown_snapshot`;
}

function optionNotesSummary(value: unknown): string | null {
  const notes = record(value);
  const entries = Object.entries(notes)
    .filter(([, note]) => typeof note === "string" && Boolean(note.trim()))
    .map(([label, note]) => `Option ${label}: ${String(note).trim()}`);

  return entries.length > 0 ? entries.join("\n") : null;
}

function teacherContext(value: unknown) {
  const providerContext = record(value);
  const context =
    Object.keys(record(providerContext.teacher_diagnostic_context)).length > 0
      ? record(providerContext.teacher_diagnostic_context)
      : providerContext;
  const correctOptionNotes = record(context.correct_option_notes);
  const expectedSolutionActions = stringArray(providerContext.expected_solution_actions);
  const expectedReasoningPatterns = stringArray(providerContext.expected_reasoning_patterns);
  const expectedReasoning = stringValue(context.expected_reasoning_note);
  const targetReasoning =
    stringValue(context.target_reasoning_note) ??
    stringValue(correctOptionNotes.target_reasoning_note) ??
    expectedReasoning ??
    expectedSolutionActions[0] ??
    expectedReasoningPatterns[0] ??
    null;
  const strongReasoning =
    stringValue(context.strong_reasoning_should_mention) ??
    stringValue(correctOptionNotes.strong_reasoning_should_mention) ??
    (expectedSolutionActions.length > 0 ? expectedSolutionActions.join(" ") : null) ??
    (expectedReasoningPatterns.length > 0 ? expectedReasoningPatterns.join(" ") : null);

  return {
    target_reasoning_note: targetReasoning,
    strong_reasoning_should_mention: strongReasoning,
    plain_language_distractor_diagnostic_notes:
      stringValue(context.plain_language_distractor_diagnostic_notes) ??
      optionNotesSummary(providerContext.option_diagnostic_notes) ??
      optionNotesSummary(providerContext.distractor_rationales),
    interpretation_caution: stringValue(context.interpretation_caution)
  };
}

function itemFromResponsePackageEntry(entry: unknown, responseEntry?: JsonRecord) {
  const item = record(entry);
  const response = responseEntry ?? {};
  const itemPublicId = stringValue(item.item_public_id) ?? stringValue(response.item_public_id) ?? "unknown_item";
  const version =
    numberValue(item.version) ??
    numberValue(response.item_version_snapshot) ??
    numberValue(record(response.item_snapshot).version);
  const itemContext = teacherContext(item.teacher_diagnostic_context ?? response.teacher_diagnostic_context);

  return {
    item_public_id: itemPublicId,
    item_snapshot_public_id: snapshotId("item", itemPublicId, version, response.item_snapshot ?? item),
    item_order: numberValue(item.item_order ?? response.item_order),
    item_role: stringValue(item.item_role ?? response.item_role),
    stem: stringValue(item.item_stem ?? record(response.item_snapshot).item_stem),
    visible_options: item.options ?? record(response.item_snapshot).options ?? [],
    correct_option_internal: stringValue(response.correct_option_snapshot),
    target_reasoning_note: itemContext.target_reasoning_note,
    strong_reasoning_should_mention: itemContext.strong_reasoning_should_mention,
    plain_language_distractor_diagnostic_notes:
      itemContext.plain_language_distractor_diagnostic_notes,
    interpretation_caution: itemContext.interpretation_caution,
    llm_media_context: arrayValue(item.llm_media_context ?? record(response.item_snapshot).llm_media_context)
  };
}

function evidenceFromResponse(entry: unknown) {
  const response = record(entry);
  const itemPublicId = stringValue(response.item_public_id) ?? "unknown_item";
  const answerChanged = response.answer_changed === true;
  const revisionCount = numberValue(response.revision_count) ?? 0;

  return {
    item_public_id: itemPublicId,
    selected_option: stringValue(response.selected_answer_final ?? response.selected_option),
    written_reasoning: stringValue(response.reasoning_text_final ?? response.reasoning_text),
    confidence: stringValue(response.confidence_final ?? response.confidence_rating),
    revision_summary:
      answerChanged || revisionCount > 0
        ? `answer_changed=${answerChanged}; revision_count=${revisionCount}`
        : null,
    tempting_option: response.no_tempting_option === true
      ? "No"
      : stringValue(response.tempting_option),
    tempting_option_reason: stringValue(response.tempting_option_reason),
    safe_timing_summary: {
      total_item_time_ms: numberValue(response.total_item_time_ms),
      response_time_answer_ms: numberValue(response.response_time_answer_ms),
      response_time_reasoning_ms: numberValue(response.response_time_reasoning_ms),
      response_time_confidence_ms: numberValue(response.response_time_confidence_ms)
    }
  };
}

export function buildAssessmentInterpretationContextFromResponsePackage(input: {
  response_package_payload: unknown;
  phase:
    | "post_initial_interpretation"
    | "formative_value_selection"
    | "formative_activity"
    | "post_activity_evaluation";
  prior_activity_evidence_summary?: string | null;
}): AssessmentInterpretationContextV1 {
  const payload = record(input.response_package_payload);
  const assessment = jsonPath(payload, "assessment");
  const conceptUnit = jsonPath(payload, "concept_unit");
  const responses = arrayValue(payload.item_responses).map(record);
  const responseByItem = new Map(
    responses
      .map((response) => [stringValue(response.item_public_id), response] as const)
      .filter((entry): entry is [string, JsonRecord] => Boolean(entry[0]))
  );
  const items = arrayValue(payload.included_items).map((entry) => {
    const item = record(entry);
    return itemFromResponsePackageEntry(entry, responseByItem.get(stringValue(item.item_public_id) ?? ""));
  });
  const assessmentPublicId = stringValue(assessment.assessment_public_id) ?? "unknown_assessment";
  const conceptUnitPublicId = stringValue(conceptUnit.concept_unit_public_id);
  const context = {
    schema_version: ASSESSMENT_INTERPRETATION_CONTEXT_SCHEMA_VERSION,
    assessment: {
      assessment_public_id: assessmentPublicId,
      assessment_snapshot_public_id: snapshotId("assessment", assessmentPublicId, null, {
        assessment,
        conceptUnit: {
          concept_unit_public_id: conceptUnitPublicId,
          version: conceptUnit.version
        },
        items: items.map((item) => item.item_snapshot_public_id)
      }),
      assessment_title: stringValue(assessment.title),
      diagnostic_focus: stringValue(assessment.diagnostic_focus),
      folder_or_module: stringValue(conceptUnit.title),
      phase: input.phase
    },
    concept_unit: {
      concept_unit_public_id: conceptUnitPublicId,
      concept_unit_snapshot_public_id: snapshotId(
        "concept_unit",
        conceptUnitPublicId,
        numberValue(conceptUnit.version),
        conceptUnit
      ),
      title: stringValue(conceptUnit.title),
      learning_objective: stringValue(conceptUnit.learning_objective),
      related_concept_description: stringValue(conceptUnit.related_concept_description)
    },
    items,
    observed_student_evidence: {
      item_responses: responses.map(evidenceFromResponse),
      cross_item_evidence_summary:
        `${responses.length} item response(s); selected options are indirect evidence and must be interpreted with reasoning, confidence, tempting-option evidence, and process context.`,
      prior_activity_evidence_summary: input.prior_activity_evidence_summary ?? null,
      process_context: {
        safe_process_counts: payload.process_counts ?? null,
        process_data_are_reliability_context_only: true,
        timing_alone_is_not_guessing_or_disengagement: true
      }
    },
    teacher_diagnostic_guidance: {
      assessment_diagnostic_focus: stringValue(assessment.diagnostic_focus),
      guidance_not_ground_truth: true,
      item_guidance: items.map((item) => ({
        item_public_id: item.item_public_id,
        target_reasoning_note: item.target_reasoning_note,
        strong_reasoning_should_mention: item.strong_reasoning_should_mention,
        plain_language_distractor_diagnostic_notes:
          item.plain_language_distractor_diagnostic_notes,
        interpretation_caution: item.interpretation_caution
      }))
    },
    interpretation_rules: {
      teacher_notes_are_guidance_not_ground_truth: true,
      observed_student_evidence_takes_priority: true,
      selected_option_is_indirect_evidence_only: true,
      correctness_alone_is_not_understanding: true,
      timing_alone_is_not_guessing_or_disengagement: true,
      alternative_explanations_required: true,
      student_visible_answer_key_prohibited: true,
      raw_teacher_notes_must_not_be_quoted_to_student: true
    },
    limitations: [
      ...(responses.length === 0 ? ["no_item_responses_in_context"] : []),
      ...(items.length === 0 ? ["no_administered_items_in_context"] : []),
      "assessment_snapshot_public_id_is_content_hash_until_first_class_assessment_snapshots_exist"
    ]
  };

  return AssessmentInterpretationContextV1Schema.parse(context);
}

export function buildAssessmentInterpretationContextForItemAdministration(input: {
  assessment_public_id: string;
  assessment_title?: string | null;
  assessment_diagnostic_focus?: string | null;
  concept_unit_public_id?: string | null;
  concept_unit_version?: number | null;
  concept_unit_title?: string | null;
  concept_unit_learning_objective?: string | null;
  concept_unit_related_description?: string | null;
  item_public_id: string;
  item_order: number | null;
  item_role: string | null;
  item_stem: string;
  options: unknown;
  correct_option: string;
  item_version: number | null;
  administration_rules?: unknown;
  distractor_rationales?: unknown;
  expected_reasoning_patterns?: unknown;
  possible_misconception_indicators?: unknown;
  selected_option?: string | null;
  written_reasoning?: string | null;
  confidence?: string | null;
  phase?: "initial_administration";
}): AssessmentInterpretationContextV1 {
  const teacherGuidance = teacherDiagnosticContextForProvider({
    administration_rules: input.administration_rules,
    assessment_diagnostic_focus: input.assessment_diagnostic_focus,
    distractor_rationales: input.distractor_rationales,
    expected_reasoning_patterns: input.expected_reasoning_patterns,
    possible_misconception_indicators: input.possible_misconception_indicators
  });
  const teacher = teacherContext(teacherGuidance);
  const item = {
    item_public_id: input.item_public_id,
    item_snapshot_public_id: snapshotId("item", input.item_public_id, input.item_version ?? null, {
      item_stem: input.item_stem,
      options: input.options,
      correct_option: input.correct_option,
      administration_rules: input.administration_rules,
      teacherGuidance
    }),
    item_order: input.item_order,
    item_role: input.item_role,
    stem: input.item_stem,
    visible_options: input.options,
    correct_option_internal: input.correct_option,
    target_reasoning_note: teacher.target_reasoning_note,
    strong_reasoning_should_mention: teacher.strong_reasoning_should_mention,
    plain_language_distractor_diagnostic_notes:
      teacher.plain_language_distractor_diagnostic_notes,
    interpretation_caution: teacher.interpretation_caution,
    llm_media_context: arrayValue(record(input.administration_rules).llm_media_context)
  };
  const conceptUnitPublicId = input.concept_unit_public_id ?? null;
  const assessmentPublicId = input.assessment_public_id;

  return AssessmentInterpretationContextV1Schema.parse({
    schema_version: ASSESSMENT_INTERPRETATION_CONTEXT_SCHEMA_VERSION,
    assessment: {
      assessment_public_id: assessmentPublicId,
      assessment_snapshot_public_id: snapshotId("assessment", assessmentPublicId, null, {
        assessment_title: input.assessment_title,
        diagnostic_focus: input.assessment_diagnostic_focus,
        concept_unit_public_id: conceptUnitPublicId,
        item_snapshot_public_id: item.item_snapshot_public_id
      }),
      assessment_title: input.assessment_title ?? null,
      diagnostic_focus: input.assessment_diagnostic_focus ?? null,
      folder_or_module: input.concept_unit_title ?? null,
      phase: input.phase ?? "initial_administration"
    },
    concept_unit: {
      concept_unit_public_id: conceptUnitPublicId,
      concept_unit_snapshot_public_id: snapshotId(
        "concept_unit",
        conceptUnitPublicId,
        input.concept_unit_version ?? null,
        input
      ),
      title: input.concept_unit_title ?? null,
      learning_objective: input.concept_unit_learning_objective ?? null,
      related_concept_description: input.concept_unit_related_description ?? null
    },
    items: [item],
    observed_student_evidence: {
      item_responses: [{
        item_public_id: input.item_public_id,
        selected_option: input.selected_option ?? null,
        written_reasoning: input.written_reasoning ?? null,
        confidence: input.confidence ?? null,
        revision_summary: null,
        tempting_option: null,
        tempting_option_reason: null,
        safe_timing_summary: {
          total_item_time_ms: null,
          response_time_answer_ms: null,
          response_time_reasoning_ms: null,
          response_time_confidence_ms: null
        }
      }],
      cross_item_evidence_summary:
        "Initial item administration context for procedural response interpretation only.",
      prior_activity_evidence_summary: null,
      process_context: {
        safe_process_counts: null,
        process_data_are_reliability_context_only: true,
        timing_alone_is_not_guessing_or_disengagement: true
      }
    },
    teacher_diagnostic_guidance: {
      assessment_diagnostic_focus: input.assessment_diagnostic_focus ?? null,
      guidance_not_ground_truth: true,
      item_guidance: [{
        item_public_id: item.item_public_id,
        target_reasoning_note: item.target_reasoning_note,
        strong_reasoning_should_mention: item.strong_reasoning_should_mention,
        plain_language_distractor_diagnostic_notes:
          item.plain_language_distractor_diagnostic_notes,
        interpretation_caution: item.interpretation_caution
      }]
    },
    interpretation_rules: {
      teacher_notes_are_guidance_not_ground_truth: true,
      observed_student_evidence_takes_priority: true,
      selected_option_is_indirect_evidence_only: true,
      correctness_alone_is_not_understanding: true,
      timing_alone_is_not_guessing_or_disengagement: true,
      alternative_explanations_required: true,
      student_visible_answer_key_prohibited: true,
      raw_teacher_notes_must_not_be_quoted_to_student: true
    },
    limitations: [
      "protected_initial_administration_all_content_help_deferred",
      "assessment_snapshot_public_id_is_content_hash_until_first_class_assessment_snapshots_exist"
    ]
  });
}

export function assessmentInterpretationContextAuditMetadata(
  context: AssessmentInterpretationContextV1
): AssessmentInterpretationContextAuditMetadata {
  const itemSnapshotIds = context.items.map((item) => item.item_snapshot_public_id);

  return {
    assessment_context_schema_version: context.schema_version,
    assessment_snapshot_public_id: context.assessment.assessment_snapshot_public_id,
    item_snapshot_public_ids: itemSnapshotIds,
    assessment_context_hash: hashAssessmentInterpretationContext(context),
    teacher_diagnostic_context_present:
      Boolean(context.teacher_diagnostic_guidance.assessment_diagnostic_focus) ||
      context.teacher_diagnostic_guidance.item_guidance.length > 0,
    target_reasoning_present: context.teacher_diagnostic_guidance.item_guidance.some((item) =>
      Boolean(item.target_reasoning_note)
    ),
    strong_reasoning_present: context.teacher_diagnostic_guidance.item_guidance.some((item) =>
      Boolean(item.strong_reasoning_should_mention)
    ),
    distractor_notes_present: context.teacher_diagnostic_guidance.item_guidance.some((item) =>
      Boolean(item.plain_language_distractor_diagnostic_notes)
    ),
    interpretation_caution_present: context.teacher_diagnostic_guidance.item_guidance.some((item) =>
      Boolean(item.interpretation_caution)
    ),
    student_evidence_present: context.observed_student_evidence.item_responses.length > 0,
    context_version_bound:
      context.items.length > 0 &&
      itemSnapshotIds.every((id) => !id.includes("unknown")) &&
      Boolean(context.assessment.assessment_snapshot_public_id),
    answer_key_internal_only: true,
    student_visible_protected_content_exposed: false
  };
}

export function attachAssessmentInterpretationContext<T extends JsonRecord>(
  input: T,
  context: AssessmentInterpretationContextV1
) {
  return {
    ...input,
    assessment_interpretation_context: context,
    assessment_context_audit: assessmentInterpretationContextAuditMetadata(context)
  };
}
