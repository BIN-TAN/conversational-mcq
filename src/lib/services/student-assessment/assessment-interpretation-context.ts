import { createHash } from "node:crypto";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { omitProhibitedProviderInputFields } from "@/lib/agents/redaction";
import { teacherDiagnosticContextForProvider } from "@/lib/services/content/teacher-diagnostic-context";

export const ASSESSMENT_INTERPRETATION_CONTEXT_SCHEMA_VERSION =
  "assessment-interpretation-context-v1" as const;

const StringOrNullSchema = z.string().nullable();

const AssessmentInterpretationContextItemSchema = z.object({
  item_public_id: z.string(),
  item_snapshot_public_id: z.string(),
  item_order: z.number().nullable(),
  initial_item_position: z.number().nullable(),
  initial_item_count: z.number().nullable(),
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
  initial_item_position: z.number().nullable(),
  initial_item_count: z.number().nullable(),
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
    initial_item_count: z.number(),
    completed_initial_item_count: z.number(),
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
    teacher_diagnostic_guidance_available: z.boolean(),
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
  teacher_diagnostic_guidance_available: boolean;
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

function hasTeacherDiagnosticGuidance(input: {
  item_guidance: Array<{
    target_reasoning_note: string | null;
    strong_reasoning_should_mention: string | null;
    plain_language_distractor_diagnostic_notes: string | null;
    interpretation_caution: string | null;
  }>;
}) {
  return input.item_guidance.some((item) =>
      Boolean(
        item.target_reasoning_note ||
        item.strong_reasoning_should_mention ||
        item.plain_language_distractor_diagnostic_notes ||
        item.interpretation_caution
      )
    );
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
    initial_item_position: numberValue(item.initial_item_position ?? response.initial_item_position),
    initial_item_count: numberValue(item.initial_item_count ?? response.initial_item_count),
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
    initial_item_position: numberValue(response.initial_item_position),
    initial_item_count: numberValue(response.initial_item_count),
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
  const initialItemCount =
    numberValue(payload.initial_item_count) ??
    numberValue(record(payload.response_package_evidence).initial_item_count) ??
    arrayValue(payload.included_items).length;
  const completedInitialItemCount =
    numberValue(payload.completed_initial_item_count) ??
    numberValue(record(payload.response_package_evidence).completed_initial_item_count) ??
    responses.filter((response) => Boolean(response.item_completed_at ?? response.item_submitted_at)).length;
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
  const itemGuidance = items.map((item) => ({
    item_public_id: item.item_public_id,
    target_reasoning_note: item.target_reasoning_note,
    strong_reasoning_should_mention: item.strong_reasoning_should_mention,
    plain_language_distractor_diagnostic_notes:
      item.plain_language_distractor_diagnostic_notes,
    interpretation_caution: item.interpretation_caution
  }));
  const assessmentDiagnosticFocus = stringValue(assessment.diagnostic_focus);
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
      initial_item_count: initialItemCount,
      completed_initial_item_count: completedInitialItemCount,
      item_responses: responses.map(evidenceFromResponse),
      cross_item_evidence_summary:
        `${completedInitialItemCount} of ${initialItemCount} initial item response(s) complete; selected options are indirect evidence and must be interpreted with reasoning, confidence, tempting-option evidence, and process context.`,
      prior_activity_evidence_summary: input.prior_activity_evidence_summary ?? null,
      process_context: {
        safe_process_counts: payload.process_counts ?? null,
        process_data_are_reliability_context_only: true,
        timing_alone_is_not_guessing_or_disengagement: true
      }
    },
    teacher_diagnostic_guidance: {
      teacher_diagnostic_guidance_available: hasTeacherDiagnosticGuidance({
        item_guidance: itemGuidance
      }),
      assessment_diagnostic_focus: assessmentDiagnosticFocus,
      guidance_not_ground_truth: true,
      item_guidance: itemGuidance
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
  llm_media_context?: unknown[];
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
    initial_item_position: null,
    initial_item_count: null,
    item_role: input.item_role,
    stem: input.item_stem,
    visible_options: input.options,
    correct_option_internal: input.correct_option,
    target_reasoning_note: teacher.target_reasoning_note,
    strong_reasoning_should_mention: teacher.strong_reasoning_should_mention,
    plain_language_distractor_diagnostic_notes:
      teacher.plain_language_distractor_diagnostic_notes,
    interpretation_caution: teacher.interpretation_caution,
    llm_media_context: input.llm_media_context ?? arrayValue(record(input.administration_rules).llm_media_context)
  };
  const conceptUnitPublicId = input.concept_unit_public_id ?? null;
  const assessmentPublicId = input.assessment_public_id;
  const itemGuidance = [{
    item_public_id: item.item_public_id,
    target_reasoning_note: item.target_reasoning_note,
    strong_reasoning_should_mention: item.strong_reasoning_should_mention,
    plain_language_distractor_diagnostic_notes:
      item.plain_language_distractor_diagnostic_notes,
    interpretation_caution: item.interpretation_caution
  }];

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
      initial_item_count: 1,
      completed_initial_item_count: input.written_reasoning || input.selected_option || input.confidence ? 1 : 0,
      item_responses: [{
        item_public_id: input.item_public_id,
        initial_item_position: null,
        initial_item_count: null,
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
      teacher_diagnostic_guidance_available: hasTeacherDiagnosticGuidance({
        item_guidance: itemGuidance
      }),
      assessment_diagnostic_focus: input.assessment_diagnostic_focus ?? null,
      guidance_not_ground_truth: true,
      item_guidance: itemGuidance
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
      context.teacher_diagnostic_guidance.teacher_diagnostic_guidance_available ||
      Boolean(context.teacher_diagnostic_guidance.assessment_diagnostic_focus),
    teacher_diagnostic_guidance_available:
      context.teacher_diagnostic_guidance.teacher_diagnostic_guidance_available,
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

export const FORMATIVE_TURN_CONTEXT_VERSION = "formative-turn-context-v1" as const;

export type FormativeTurnAgentRole =
  | "response_interpretation"
  | "student_profile_update"
  | "formative_plan_update"
  | "student_facing_dialogue";

export type AuthoritativeFormativeTurnContext = Awaited<
  ReturnType<typeof buildAuthoritativeFormativeTurnContext>
>;

function publicReference(prefix: string, value: string) {
  return `${prefix}_${createHash("sha256").update(value).digest("hex").slice(0, 20)}`;
}

function visibleTurn(payloadValue: unknown) {
  const payload = record(payloadValue);
  return !(
    payload.student_visible === false ||
    payload.shown_to_student === false ||
    ["draft", "internal", "not_shown"].includes(String(payload.visibility_status ?? ""))
  );
}

function safeInternalIssue(value: string | null) {
  if (!value) return null;
  return value
    .replace(/[\r\n]+/g, " ")
    .replace(/(api[_ -]?key|authorization|cookie|password|secret)\s*[:=]\s*\S+/gi, "$1=[redacted]")
    .slice(0, 500);
}

function safeRoutingEventPayload(value: unknown) {
  const payload = record(value);
  const allowedKeys = [
    "post_activity_status",
    "recommended_route",
    "next_runtime_state",
    "response_function",
    "next_action",
    "topic_boundary",
    "fallback_used",
    "reason",
    "blocked_reason"
  ];
  const result: Record<string, string | number | boolean> = {};
  for (const key of allowedKeys) {
    const entry = payload[key];
    if (typeof entry === "boolean" || typeof entry === "number") result[key] = entry;
    if (typeof entry === "string") result[key] = safeInternalIssue(entry) ?? "";
  }
  return result;
}

/**
 * Rebuilds the short assessment's complete formative-turn context from durable
 * records after the latest student message has been persisted. Visible turns
 * and internal evaluation/routing records are deliberately separate.
 */
export async function buildAuthoritativeFormativeTurnContext(input: {
  session_public_id: string;
  concept_unit_session_db_id: string;
  activity_attempt_public_id: string;
  latest_student_message: string;
  client_operation_id: string;
  agent_role: FormativeTurnAgentRole;
  staged_profile_output?: unknown;
  staged_planning_output?: unknown;
  client?: typeof prisma;
}) {
  const client = input.client ?? prisma;
  const [
    session,
    conceptUnitSession,
    initialPackage,
    profiles,
    decisions,
    attempts,
    turns,
    agentCalls,
    processEvents
  ] =
    await Promise.all([
      client.assessmentSession.findUniqueOrThrow({
        where: { session_public_id: input.session_public_id },
        select: {
          session_public_id: true,
          current_phase: true,
          status: true,
          assessment: {
            select: {
              assessment_public_id: true,
              title: true,
              description: true,
              diagnostic_focus: true
            }
          }
        }
      }),
      client.conceptUnitSession.findUniqueOrThrow({
        where: { id: input.concept_unit_session_db_id },
        select: {
          status: true,
          followup_status: true,
          latest_student_profile_db_id: true,
          latest_formative_decision_db_id: true,
          concept_unit: {
            select: {
              concept_unit_public_id: true,
              title: true,
              learning_objective: true,
              related_concept_description: true
            }
          },
          followup_rounds: {
            orderBy: [{ round_index: "asc" }],
            select: {
              round_index: true,
              status: true,
              evidence_trigger_type: true,
              started_at: true,
              completed_at: true
            }
          }
        }
      }),
      client.responsePackage.findFirst({
        where: {
          concept_unit_session_db_id: input.concept_unit_session_db_id,
          package_type: "initial_concept_unit_response_package"
        },
        orderBy: [{ created_at: "desc" }],
        select: { payload: true, created_at: true }
      }),
      client.studentProfile.findMany({
        where: { concept_unit_session_db_id: input.concept_unit_session_db_id },
        orderBy: [{ created_at: "asc" }, { id: "asc" }]
      }),
      client.formativeDecision.findMany({
        where: { concept_unit_session_db_id: input.concept_unit_session_db_id },
        orderBy: [{ created_at: "asc" }, { id: "asc" }]
      }),
      client.activityRuntimeAttempt.findMany({
        where: { session_public_id: input.session_public_id },
        orderBy: [{ created_at: "asc" }, { id: "asc" }]
      }),
      client.conversationTurn.findMany({
        where: { assessment_session: { session_public_id: input.session_public_id } },
        orderBy: [{ sequence_index: "asc" }],
        select: {
          id: true,
          sequence_index: true,
          actor_type: true,
          agent_name: true,
          phase: true,
          message_text: true,
          structured_payload: true,
          created_at: true
        }
      }),
      client.agentCall.findMany({
        where: { concept_unit_session_db_id: input.concept_unit_session_db_id },
        orderBy: [{ created_at: "asc" }, { id: "asc" }],
        select: {
          id: true,
          agent_name: true,
          call_status: true,
          output_validated: true,
          error_category: true,
          blocked_reason: true,
          validation_error: true,
          retry_count: true,
          created_at: true,
          completed_at: true
        }
      }),
      client.processEvent.findMany({
        where: {
          assessment_session: { session_public_id: input.session_public_id },
          event_category: {
            in: ["formative_activity_runtime", "topic_dialogue", "workflow"]
          }
        },
        orderBy: [{ occurred_at: "asc" }, { id: "asc" }],
        select: {
          event_type: true,
          event_category: true,
          event_source: true,
          payload: true,
          occurred_at: true
        }
      })
    ]);

  if (!initialPackage) {
    throw new Error("formative_turn_initial_response_package_missing");
  }

  const assessmentInterpretationContext = buildAssessmentInterpretationContextFromResponsePackage({
    response_package_payload: initialPackage.payload,
    phase: "post_activity_evaluation",
    prior_activity_evidence_summary:
      "The complete formative activity and dialogue history is supplied in formative_turn_context."
  });
  const visibleTurns = turns.filter((turn) => visibleTurn(turn.structured_payload));
  const latestAttempt = attempts.find(
    (attempt) => attempt.activity_attempt_public_id === input.activity_attempt_public_id
  );
  if (!latestAttempt) {
    throw new Error("formative_turn_activity_attempt_missing");
  }
  const activityAttemptPublicIds = attempts.map((attempt) => attempt.activity_attempt_public_id);
  const evidenceRecords = activityAttemptPublicIds.length > 0
    ? await client.activityMisconceptionEvidenceRecord.findMany({
        where: { activity_attempt_id: { in: activityAttemptPublicIds } },
        orderBy: [{ created_at: "asc" }, { id: "asc" }],
        select: {
          activity_attempt_id: true,
          schema_version: true,
          misconception_update_status: true,
          evidence_quality: true,
          recommended_next_diagnostic_purpose: true,
          limitations: true,
          created_at: true
        }
      })
    : [];

  const roleTasks: Record<FormativeTurnAgentRole, Record<string, unknown>> = {
    response_interpretation: {
      stage: "observe_and_interpret_latest_student_response",
      output_visibility: "internal",
      must_produce: "A conservative evidence update grounded in the latest response and full history.",
      must_not_produce: "A student-facing reply or platform transition."
    },
    student_profile_update: {
      stage: "re_profile",
      output_visibility: "internal",
      must_produce: "One updated learning and engagement profile version.",
      must_not_produce: "A student-facing reply or unsupported resolution claim."
    },
    formative_plan_update: {
      stage: "re_plan",
      output_visibility: "internal",
      must_produce: "One updated plan tied to the distractor anchor and remaining evidence need.",
      must_not_produce: "A student-facing reply or authoritative platform transition."
    },
    student_facing_dialogue: {
      stage: "implement_next_dialogue_turn",
      output_visibility: "student_facing",
      must_produce: "Exactly one direct, natural reply to the latest student message.",
      must_not_produce:
        "Protected answers, teacher-only guidance, internal labels, or an unvalidated state transition."
    }
  };

  return omitProhibitedProviderInputFields({
    context_version: FORMATIVE_TURN_CONTEXT_VERSION,
    built_after_student_message_persisted: true as const,
    assessment_purpose_and_workflow: {
      purpose: "Formative diagnostic assessment, not unrestricted tutoring.",
      complete_workflow: [
        "three_initial_mcqs",
        "learning_and_engagement_profiling",
        "distractor_focused_formative_activity",
        "iterative_formative_dialogue",
        "revision_or_transfer",
        "subsequent_evidence_based_profiling_judgment"
      ]
    },
    current_agent_role_and_turn_task: {
      role: input.agent_role,
      ...roleTasks[input.agent_role]
    },
    complete_initial_response_package: {
      created_at: initialPackage.created_at.toISOString(),
      assessment_interpretation_context: assessmentInterpretationContext
    },
    complete_profile_history: {
      current_profile_reference: conceptUnitSession.latest_student_profile_db_id
        ? publicReference("profile", conceptUnitSession.latest_student_profile_db_id)
        : null,
      versions: profiles.map((profile, index) => ({
        profile_reference: publicReference("profile", profile.id),
        version_index: index + 1,
        is_current: profile.id === conceptUnitSession.latest_student_profile_db_id,
        profile_type: profile.profile_type,
        ability_profile: profile.ability_profile,
        ability_pattern_flags: profile.ability_pattern_flags,
        engagement_profile: profile.engagement_profile,
        engagement_pattern_flags: profile.engagement_pattern_flags,
        integrated_diagnostic_profile: profile.integrated_diagnostic_profile,
        integrated_profile_confidence: profile.integrated_profile_confidence,
        integrated_profile_rationale: profile.integrated_profile_rationale,
        evidence_sufficiency: profile.evidence_sufficiency,
        confidence_alignment: profile.confidence_alignment,
        independence_interpretability: profile.independence_interpretability,
        misconception_indicators: profile.misconception_indicators,
        item_level_evidence: profile.item_level_evidence,
        reasoning_quality_summary: profile.reasoning_quality_summary,
        engagement_summary: profile.engagement_summary,
        rationale: profile.rationale,
        recommended_next_evidence: profile.recommended_next_evidence,
        created_at: profile.created_at.toISOString()
      })),
      staged_candidate_for_this_turn: input.staged_profile_output ?? null
    },
    complete_formative_plan_history: {
      current_plan_reference: conceptUnitSession.latest_formative_decision_db_id
        ? publicReference("plan", conceptUnitSession.latest_formative_decision_db_id)
        : null,
      versions: decisions.map((decision, index) => ({
        plan_reference: publicReference("plan", decision.id),
        version_index: index + 1,
        is_current: decision.id === conceptUnitSession.latest_formative_decision_db_id,
        formative_value: decision.formative_value,
        formative_action_plan: decision.formative_action_plan,
        target_evidence: decision.target_evidence,
        success_criteria: decision.success_criteria,
        followup_prompt_constraints: decision.followup_prompt_constraints,
        profile_update_triggers: decision.profile_update_triggers,
        rationale: decision.rationale,
        mapping_followed: decision.mapping_followed,
        mapping_deviation_reason: decision.mapping_deviation_reason,
        created_at: decision.created_at.toISOString()
      })),
      staged_candidate_for_this_turn: input.staged_planning_output ?? null
    },
    complete_activity_runtime_history: {
      current_activity_attempt_public_id: input.activity_attempt_public_id,
      strategies_already_attempted: attempts.flatMap((attempt) => {
        const shownTurn = visibleTurns.find((turn) => {
          const payload = record(turn.structured_payload);
          return payload.activity_attempt_public_id === attempt.activity_attempt_public_id &&
            turn.actor_type === "agent";
        });
        return shownTurn
          ? [{
              activity_attempt_public_id: attempt.activity_attempt_public_id,
              activity_family: attempt.activity_family,
              diagnostic_purpose: attempt.diagnostic_purpose,
              shown_message: shownTurn.message_text ?? ""
            }]
          : [];
      }),
      strategies_not_to_repeat: attempts.flatMap((attempt) => {
        const limitations = Array.isArray(attempt.limitations) ? attempt.limitations : [];
        const shouldAvoid = attempt.status === "choose_alternative_recommended" ||
          limitations.some((limitation) =>
            typeof limitation === "string" && /failed|invalid|alternative/i.test(limitation)
          );
        return shouldAvoid
          ? [{
              activity_attempt_public_id: attempt.activity_attempt_public_id,
              activity_family: attempt.activity_family,
              reason: attempt.status
            }]
          : [];
      }),
      attempts: attempts.map((attempt, index) => {
        const source = record(attempt.source_activity_packet_ref);
        const shownTurn = visibleTurns.find((turn) => {
          const payload = record(turn.structured_payload);
          return payload.activity_attempt_public_id === attempt.activity_attempt_public_id &&
            turn.actor_type === "agent";
        });
        return {
          activity_attempt_public_id: attempt.activity_attempt_public_id,
          version_index: index + 1,
          is_current: attempt.id === latestAttempt.id,
          activity_family: attempt.activity_family,
          diagnostic_purpose: attempt.diagnostic_purpose,
          generation_source: attempt.generation_source,
          status: attempt.status,
          was_actually_shown: Boolean(shownTurn),
          shown_at: shownTurn?.created_at.toISOString() ?? null,
          safe_activity_prompt: shownTurn?.message_text ?? null,
          distractor_anchor: {
            target_item_index: numberValue(source.target_item_index),
            target_item_id: stringValue(source.target_item_id),
            target_option_label: stringValue(source.target_option_label),
            distractor_role: stringValue(source.distractor_role),
            distractor_student_safe_description:
              stringValue(source.distractor_student_safe_description),
            target_construct_or_boundary: stringValue(source.target_construct_or_boundary)
          },
          replacement_of_activity_attempt_public_id:
            stringValue(source.replaced_activity_attempt_public_id),
          student_responses: visibleTurns.flatMap((turn) => {
            const payload = record(turn.structured_payload);
            if (
              turn.actor_type !== "student" ||
              payload.activity_attempt_public_id !== attempt.activity_attempt_public_id
            ) {
              return [];
            }
            return [{
              turn_public_id: publicReference("turn", turn.id),
              message_text: turn.message_text ?? "",
              created_at: turn.created_at.toISOString()
            }];
          }),
          evaluator_results: evidenceRecords
            .filter((evidence) => evidence.activity_attempt_id === attempt.activity_attempt_public_id)
            .map((evidence) => ({
              schema_version: evidence.schema_version,
              misconception_update_status: evidence.misconception_update_status,
              evidence_quality: evidence.evidence_quality,
              recommended_next_diagnostic_purpose:
                evidence.recommended_next_diagnostic_purpose,
              limitations: evidence.limitations,
              created_at: evidence.created_at.toISOString()
            })),
          created_at: attempt.created_at.toISOString(),
          completed_at: attempt.completed_at?.toISOString() ?? null
        };
      })
    },
    complete_visible_transcript: visibleTurns.map((turn) => {
      const payload = record(turn.structured_payload);
      const agentCallId =
        stringValue(payload.agent_call_id) ?? stringValue(payload.source_agent_call_id);
      return {
        turn_public_id: publicReference("turn", turn.id),
        sequence_index: turn.sequence_index,
        created_at: turn.created_at.toISOString(),
        role: turn.actor_type === "student" ? "student" : "agent",
        visibility_status: "shown",
        source_agent: turn.agent_name,
        source_agent_call_reference: agentCallId
          ? publicReference("agent_call", agentCallId)
          : null,
        message_text: turn.message_text ?? ""
      };
    }),
    internal_evaluation_and_routing_history: {
      never_assume_shown_to_student: true as const,
      agent_calls: agentCalls.map((call) => ({
        agent_call_reference: publicReference("agent_call", call.id),
        agent_name: call.agent_name,
        call_status: call.call_status,
        output_validated: call.output_validated,
        error_category: call.error_category,
        blocked_reason: call.blocked_reason,
        validation_issue: safeInternalIssue(call.validation_error),
        retry_count: call.retry_count,
        created_at: call.created_at.toISOString(),
        completed_at: call.completed_at?.toISOString() ?? null
      })),
      routing_events: processEvents.map((event) => ({
        event_type: event.event_type,
        event_category: event.event_category,
        event_source: event.event_source,
        safe_routing_fields: safeRoutingEventPayload(event.payload),
        occurred_at: event.occurred_at.toISOString()
      }))
    },
    current_platform_and_runtime_state: {
      global_assessment_phase: session.current_phase,
      assessment_status: session.status,
      concept_unit_session_status: conceptUnitSession.status,
      followup_status: conceptUnitSession.followup_status,
      current_activity_attempt_public_id: latestAttempt.activity_attempt_public_id,
      current_activity_runtime_status: latestAttempt.status,
      current_rounds: conceptUnitSession.followup_rounds.map((round) => ({
        round_index: round.round_index,
        status: round.status,
        evidence_trigger_type: round.evidence_trigger_type,
        started_at: round.started_at?.toISOString() ?? null,
        completed_at: round.completed_at?.toISOString() ?? null
      })),
      allowed_transitions: [
        "continue_formative_dialogue",
        "platform_validated_revision",
        "platform_validated_transfer",
        "student_selected_completion",
        "save_and_exit"
      ],
      prohibited_transitions: [
        "agent_advances_assessment",
        "agent_completes_assessment",
        "agent_selects_next_concept"
      ],
      revision_available: true,
      transfer_requires_platform_validation: true,
      completion_requires_platform_or_student_action: true
    },
    latest_student_message: {
      client_operation_id: input.client_operation_id,
      message_text: input.latest_student_message,
      instruction: "Respond directly to this message."
    }
  });
}
