import { prisma } from "@/lib/db";
import type { AbilityEvidencePacketV1 } from "@/lib/services/student-assessment/ability-evidence";

export const ABILITY_EVIDENCE_REVIEW_ARTIFACT_VERSION = "ability-evidence-review-v1" as const;
export const ITEM_DIAGNOSTIC_METADATA_REVIEW_ARTIFACT_VERSION =
  "item-diagnostic-metadata-review-v1" as const;

export type ItemDiagnosticMetadataStatus =
  | "complete"
  | "usable_with_limitations"
  | "insufficient";

export type ItemDiagnosticMetadataAudit = {
  item_public_id: string;
  concept_id_present: boolean;
  cognitive_level_present: boolean;
  subskills_present: boolean;
  subskill_count: number;
  expected_solution_actions_present: boolean;
  expected_solution_action_count: number;
  correct_option_present_internal: boolean;
  option_misconception_map_present: boolean;
  mapped_option_count: number;
  unmapped_option_count: number;
  distractor_diagnostic_notes_present: boolean;
  difficulty_label_present_optional: boolean;
  discrimination_label_present_optional: boolean;
  numeric_difficulty_present_optional: boolean;
  numeric_discrimination_present_optional: boolean;
  metadata_status: ItemDiagnosticMetadataStatus;
  limitations: string[];
};

export type ItemDiagnosticMetadataReviewArtifact = {
  artifact_type: "item_diagnostic_metadata_review";
  artifact_version: typeof ITEM_DIAGNOSTIC_METADATA_REVIEW_ARTIFACT_VERSION;
  generated_at: string;
  item_count: number;
  complete_count: number;
  usable_with_limitations_count: number;
  insufficient_count: number;
  items: ItemDiagnosticMetadataAudit[];
  review_notes: string[];
};

export type RedactedAbilityEvidenceReviewArtifact = {
  artifact_type: "ability_evidence_review";
  artifact_version: typeof ABILITY_EVIDENCE_REVIEW_ARTIFACT_VERSION;
  redaction_policy: "student_safe_summary_only";
  schema_version: AbilityEvidencePacketV1["schema_version"];
  session_public_id: string;
  assessment_public_id: string;
  concept_unit_id: string;
  generated_at: string;
  item_count: number;
  item_evidence: Array<{
    item_public_id: string;
    concept_id: string;
    cognitive_level: string;
    subskill_count: number;
    expected_solution_action_count: number;
    selected_option_role: AbilityEvidencePacketV1["item_evidence"][number]["selected_option_role"];
    selected_misconception_count: number;
    tempting_option_role: AbilityEvidencePacketV1["item_evidence"][number]["tempting_option_role"];
    tempting_misconception_count: number;
    confidence: AbilityEvidencePacketV1["item_evidence"][number]["confidence"];
    reasoning_quality: AbilityEvidencePacketV1["item_evidence"][number]["reasoning_evidence"]["quality"];
    confidence_calibration_signal: AbilityEvidencePacketV1["item_evidence"][number]["confidence_calibration_signal"];
    ability_signal_category: AbilityEvidencePacketV1["item_evidence"][number]["ability_signal_category"];
    evidence_strength: AbilityEvidencePacketV1["item_evidence"][number]["evidence_strength"];
    evidence_limitations: string[];
  }>;
  concept_level_summary: {
    provisional_category: AbilityEvidencePacketV1["concept_level_summary"]["provisional_category"];
    category_confidence: AbilityEvidencePacketV1["concept_level_summary"]["category_confidence"];
    dominant_misconception_hypothesis_count: number;
    knowledge_gap_hypothesis_count: number;
    reasoning_quality_overall: AbilityEvidencePacketV1["concept_level_summary"]["reasoning_quality_overall"];
    confidence_calibration_overall: AbilityEvidencePacketV1["concept_level_summary"]["confidence_calibration_overall"];
    evidence_limitations: string[];
  };
  student_safe_projection: AbilityEvidencePacketV1["student_safe_projection"];
  safety_check: {
    answer_key_exposed: false;
    correct_option_value_exposed: false;
    distractor_metadata_exposed: false;
    misconception_ids_exposed_to_student_projection: false;
    raw_reasoning_exposed: false;
    raw_item_stem_exposed: false;
    raw_llm_output_exposed: false;
  };
};

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
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

function stringArrayRecord(value: unknown): Record<string, string[]> {
  const input = record(value);
  const output: Record<string, string[]> = {};

  for (const [key, entry] of Object.entries(input)) {
    const values = stringArray(entry);
    if (values.length > 0) {
      output[key.toUpperCase()] = values;
    }
  }

  return output;
}

function stringRecord(value: unknown): Record<string, string> {
  const input = record(value);
  const output: Record<string, string> = {};

  for (const [key, entry] of Object.entries(input)) {
    const value = stringValue(entry);
    if (value) {
      output[key.toUpperCase()] = value;
    }
  }

  return output;
}

function optionRows(value: unknown): Array<{ label: string }> {
  return Array.isArray(value)
    ? value
        .map((entry) => {
          const option = record(entry);
          const label = stringValue(option.label)?.toUpperCase();
          return label ? { label } : null;
        })
        .filter((entry): entry is { label: string } => Boolean(entry))
    : [];
}

function isScoredOption(value: string | null): value is "A" | "B" | "C" | "D" {
  return value === "A" || value === "B" || value === "C" || value === "D";
}

function statusCounts(items: ItemDiagnosticMetadataAudit[]) {
  return items.reduce(
    (counts, item) => {
      counts[item.metadata_status] += 1;
      return counts;
    },
    {
      complete: 0,
      usable_with_limitations: 0,
      insufficient: 0
    } satisfies Record<ItemDiagnosticMetadataStatus, number>
  );
}

export function auditItemDiagnosticMetadata(input: {
  item_public_id: string;
  concept_unit_public_id: string | null;
  options: unknown;
  correct_option: string | null;
  distractor_rationales: unknown;
  expected_reasoning_patterns: unknown;
  administration_rules: unknown;
}): ItemDiagnosticMetadataAudit {
  const rules = record(input.administration_rules);
  const options = optionRows(input.options);
  const correctOption = stringValue(input.correct_option)?.toUpperCase() ?? null;
  const correctOptionPresent = isScoredOption(correctOption) &&
    options.some((option) => option.label === correctOption);
  const distractorRationales = record(input.distractor_rationales);
  const explicitOptionMap = stringArrayRecord(rules.option_misconception_map);
  const explicitOptionNotes = stringRecord(rules.option_diagnostic_notes);
  const expectedActions = stringArray(rules.expected_solution_actions).length
    ? stringArray(rules.expected_solution_actions)
    : stringArray(input.expected_reasoning_patterns);
  const subskills = stringArray(rules.subskills);
  const conceptIdPresent = Boolean(stringValue(rules.concept_id) ?? input.concept_unit_public_id);
  const cognitiveLevelPresent = Boolean(stringValue(rules.cognitive_level) ?? stringValue(rules.cognitive_demand));
  const difficultyLabelPresent = Boolean(stringValue(rules.difficulty_label) ?? stringValue(rules.difficulty));
  const discriminationLabelPresent = Boolean(stringValue(rules.discrimination_label));
  const numericDifficultyPresent = numberValue(rules.empirical_ctt_item_difficulty) !== null;
  const numericDiscriminationPresent = numberValue(rules.empirical_ctt_discrimination) !== null;
  let mappedOptionCount = 0;
  let unmappedOptionCount = 0;
  let distractorNoteCount = 0;

  for (const option of options) {
    const explicitMap = explicitOptionMap[option.label];
    const explicitNote = explicitOptionNotes[option.label];

    if (explicitMap?.length) {
      mappedOptionCount += 1;
      if (option.label !== correctOption && explicitNote) {
        distractorNoteCount += 1;
      }
      continue;
    }

    if (correctOptionPresent && option.label === correctOption) {
      mappedOptionCount += 1;
      continue;
    }

    if (explicitNote || stringValue(distractorRationales[option.label])) {
      mappedOptionCount += 1;
      distractorNoteCount += 1;
      continue;
    }

    unmappedOptionCount += 1;
  }

  const limitations: string[] = [];

  if (!conceptIdPresent) limitations.push("concept_id_missing");
  if (!cognitiveLevelPresent) limitations.push("cognitive_level_missing");
  if (subskills.length === 0) limitations.push("subskills_missing");
  if (expectedActions.length === 0) limitations.push("expected_solution_actions_missing");
  if (!correctOptionPresent) limitations.push("correct_option_missing_internal");
  if (options.length === 0) limitations.push("options_missing");
  if (mappedOptionCount === 0) limitations.push("option_roles_or_diagnostic_mapping_missing");
  if (unmappedOptionCount > 0) limitations.push("some_options_lack_diagnostic_mapping_or_explicit_role");
  if (distractorNoteCount === 0) limitations.push("distractor_diagnostic_notes_missing");
  if (!difficultyLabelPresent) limitations.push("difficulty_label_missing_optional");
  if (!discriminationLabelPresent) limitations.push("discrimination_label_missing_optional");
  if (!numericDifficultyPresent) limitations.push("numeric_difficulty_missing_optional_future_calibration");
  if (!numericDiscriminationPresent) limitations.push("numeric_discrimination_missing_optional_future_calibration");

  const optionMapPresent = mappedOptionCount > 0 && unmappedOptionCount === 0;
  const requiredForInterpretationPresent = conceptIdPresent && correctOptionPresent && mappedOptionCount > 0;
  const substantiveMetadataPresent = subskills.length > 0 && expectedActions.length > 0 && optionMapPresent;
  const metadataStatus: ItemDiagnosticMetadataStatus = !requiredForInterpretationPresent
    ? "insufficient"
    : cognitiveLevelPresent && substantiveMetadataPresent
      ? "complete"
      : "usable_with_limitations";

  return {
    item_public_id: input.item_public_id,
    concept_id_present: conceptIdPresent,
    cognitive_level_present: cognitiveLevelPresent,
    subskills_present: subskills.length > 0,
    subskill_count: subskills.length,
    expected_solution_actions_present: expectedActions.length > 0,
    expected_solution_action_count: expectedActions.length,
    correct_option_present_internal: correctOptionPresent,
    option_misconception_map_present: optionMapPresent,
    mapped_option_count: mappedOptionCount,
    unmapped_option_count: unmappedOptionCount,
    distractor_diagnostic_notes_present: distractorNoteCount > 0,
    difficulty_label_present_optional: difficultyLabelPresent,
    discrimination_label_present_optional: discriminationLabelPresent,
    numeric_difficulty_present_optional: numericDifficultyPresent,
    numeric_discrimination_present_optional: numericDiscriminationPresent,
    metadata_status: metadataStatus,
    limitations
  };
}

export async function auditCurrentItemDiagnosticMetadata(): Promise<ItemDiagnosticMetadataReviewArtifact> {
  const items = await prisma.item.findMany({
    orderBy: [
      { concept_unit: { order_index: "asc" } },
      { item_order: "asc" },
      { created_at: "asc" }
    ],
    select: {
      item_public_id: true,
      options: true,
      correct_option: true,
      distractor_rationales: true,
      expected_reasoning_patterns: true,
      administration_rules: true,
      concept_unit: {
        select: {
          concept_unit_public_id: true
        }
      }
    }
  });
  const audits = items.map((item) =>
    auditItemDiagnosticMetadata({
      item_public_id: item.item_public_id,
      concept_unit_public_id: item.concept_unit.concept_unit_public_id,
      options: item.options,
      correct_option: item.correct_option,
      distractor_rationales: item.distractor_rationales,
      expected_reasoning_patterns: item.expected_reasoning_patterns,
      administration_rules: item.administration_rules
    })
  );
  const counts = statusCounts(audits);

  return {
    artifact_type: "item_diagnostic_metadata_review",
    artifact_version: ITEM_DIAGNOSTIC_METADATA_REVIEW_ARTIFACT_VERSION,
    generated_at: new Date().toISOString(),
    item_count: audits.length,
    complete_count: counts.complete,
    usable_with_limitations_count: counts.usable_with_limitations,
    insufficient_count: counts.insufficient,
    items: audits,
    review_notes: [
      "This artifact is safe to paste for design review. It intentionally omits raw item stems, correct option values, and distractor diagnostic text.",
      "Numeric difficulty and discrimination are optional future calibration fields and do not determine metadata status by themselves."
    ]
  };
}

export function redactAbilityEvidencePacketForReview(
  packet: AbilityEvidencePacketV1
): RedactedAbilityEvidenceReviewArtifact {
  return {
    artifact_type: "ability_evidence_review",
    artifact_version: ABILITY_EVIDENCE_REVIEW_ARTIFACT_VERSION,
    redaction_policy: "student_safe_summary_only",
    schema_version: packet.schema_version,
    session_public_id: packet.session_public_id,
    assessment_public_id: packet.assessment_public_id,
    concept_unit_id: packet.concept_unit_id,
    generated_at: packet.generated_at,
    item_count: packet.item_evidence.length,
    item_evidence: packet.item_evidence.map((item) => ({
      item_public_id: item.item_public_id,
      concept_id: item.concept_id,
      cognitive_level: item.cognitive_level,
      subskill_count: item.subskills.length,
      expected_solution_action_count: item.expected_solution_actions.length,
      selected_option_role: item.selected_option_role,
      selected_misconception_count: item.selected_misconception_ids.length,
      tempting_option_role: item.tempting_option_role,
      tempting_misconception_count: item.tempting_misconception_ids.length,
      confidence: item.confidence,
      reasoning_quality: item.reasoning_evidence.quality,
      confidence_calibration_signal: item.confidence_calibration_signal,
      ability_signal_category: item.ability_signal_category,
      evidence_strength: item.evidence_strength,
      evidence_limitations: item.evidence_limitations
    })),
    concept_level_summary: {
      provisional_category: packet.concept_level_summary.provisional_category,
      category_confidence: packet.concept_level_summary.category_confidence,
      dominant_misconception_hypothesis_count:
        packet.concept_level_summary.dominant_misconception_hypotheses.length,
      knowledge_gap_hypothesis_count: packet.concept_level_summary.knowledge_gap_hypotheses.length,
      reasoning_quality_overall: packet.concept_level_summary.reasoning_quality_overall,
      confidence_calibration_overall: packet.concept_level_summary.confidence_calibration_overall,
      evidence_limitations: packet.concept_level_summary.evidence_limitations
    },
    student_safe_projection: packet.student_safe_projection,
    safety_check: {
      answer_key_exposed: false,
      correct_option_value_exposed: false,
      distractor_metadata_exposed: false,
      misconception_ids_exposed_to_student_projection: false,
      raw_reasoning_exposed: false,
      raw_item_stem_exposed: false,
      raw_llm_output_exposed: false
    }
  };
}

function collectObjectIssues(value: unknown, path = "$"): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => collectObjectIssues(entry, `${path}[${index}]`));
  }

  if (!value || typeof value !== "object") {
    return [];
  }

  const forbiddenExactKeys = new Set([
    "correct_option",
    "correct_option_snapshot",
    "is_correct_internal",
    "option_misconception_map",
    "option_diagnostic_notes",
    "selected_misconception_ids",
    "tempting_misconception_ids",
    "key_ideas_present",
    "key_ideas_missing",
    "misconception_matches",
    "reasoning_text",
    "raw_output",
    "raw_provider_output",
    "item_stem",
    "item_snapshot",
    "process_events",
    "conversation_turns",
    "evidence_trace"
  ]);
  const output: string[] = [];

  for (const [key, entry] of Object.entries(value)) {
    if (forbiddenExactKeys.has(key)) {
      output.push(`${path}.${key}`);
    }
    output.push(...collectObjectIssues(entry, `${path}.${key}`));
  }

  return output;
}

export function validateRedactedAbilityReviewArtifactSafety(
  artifact: RedactedAbilityEvidenceReviewArtifact
): { passed: boolean; issues: string[] } {
  const issues = collectObjectIssues(artifact);
  const safetyFlags = artifact.safety_check;

  for (const [key, value] of Object.entries(safetyFlags)) {
    if (value !== false) {
      issues.push(`safety_check.${key}`);
    }
  }

  const allowedProjectionStatuses = new Set(["Mostly understood", "Still developing", "Needs more work"]);
  if (!allowedProjectionStatuses.has(artifact.student_safe_projection.status)) {
    issues.push("student_safe_projection.status");
  }

  return {
    passed: issues.length === 0,
    issues
  };
}
