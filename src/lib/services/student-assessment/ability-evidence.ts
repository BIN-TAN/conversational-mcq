import { z } from "zod";
import { prisma } from "@/lib/db";

export const ABILITY_EVIDENCE_PACKET_SCHEMA_VERSION = "ability-evidence-packet-v1" as const;

const ScoredOptionLabelSchema = z.enum(["A", "B", "C", "D"]);
const OptionLabelSchema = z.enum(["A", "B", "C", "D", "E"]);
const NullableOptionLabelSchema = OptionLabelSchema.nullable();
const ConfidenceLabelSchema = z.enum(["Low", "Medium", "High"]);

const ReasoningQualitySchema = z.enum([
  "adequate",
  "partial",
  "vague",
  "off_track",
  "unknown",
  "not_analyzed"
]);

const AbilitySignalCategorySchema = z.enum([
  "strong_understanding",
  "emerging_understanding",
  "misconception_signal",
  "knowledge_gap",
  "shallow_or_guess",
  "ambiguous_mixed_evidence",
  "insufficient_evidence"
]);

const ConfidenceCalibrationSignalSchema = z.enum([
  "well_calibrated",
  "overconfident",
  "underconfident",
  "uncertain",
  "insufficient_evidence"
]);

const EvidenceStrengthSchema = z.enum(["high", "medium", "low"]);

const EvidenceConfidenceModifierSchema = z.object({
  source: z.literal("process_data"),
  effect: z.enum(["increase_confidence", "lower_confidence", "neutral"]),
  reason_code: z.enum([
    "rapid_response",
    "repeated_repairs",
    "enough_deliberation",
    "interrupted_session",
    "insufficient_data"
  ])
});

const MisconceptionMatchSchema = z.object({
  misconception_id: z.string(),
  support: z.enum(["high", "medium", "low"]),
  source: z.enum(["selected_option", "tempting_option", "reasoning", "combined"])
});

export const AbilityDiagnosticMetadataV1Schema = z.object({
  concept_id: z.string(),
  cognitive_level: z.string(),
  subskills: z.array(z.string()),
  expected_solution_actions: z.array(z.string()),
  correct_option: ScoredOptionLabelSchema,
  option_misconception_map: z.record(z.array(z.string())),
  option_diagnostic_notes: z.record(z.string()),
  optional_future_calibration: z.object({
    difficulty_label: z.string(),
    discrimination_label: z.string(),
    empirical_ctt_item_difficulty: z.number().nullable(),
    empirical_ctt_discrimination: z.number().nullable(),
    calibration_sample_notes: z.string().nullable()
  })
});

export const AbilityItemEvidenceV1Schema = z.object({
  item_public_id: z.string(),
  concept_id: z.string(),
  cognitive_level: z.string(),
  subskills: z.array(z.string()),
  expected_solution_actions: z.array(z.string()),
  selected_option: NullableOptionLabelSchema,
  is_correct_internal: z.boolean().nullable(),
  selected_option_role: z.enum([
    "correct",
    "diagnostic_distractor",
    "unknown_option",
    "unscored",
    "missing"
  ]),
  selected_misconception_ids: z.array(z.string()),
  tempting_option: z.union([ScoredOptionLabelSchema, z.literal("No")]).nullable(),
  tempting_option_role: z.enum(["correct", "diagnostic_distractor", "none", "missing"]),
  tempting_misconception_ids: z.array(z.string()),
  confidence: ConfidenceLabelSchema.nullable(),
  reasoning_evidence: z.object({
    available: z.boolean(),
    quality: ReasoningQualitySchema,
    key_ideas_present: z.array(z.string()),
    key_ideas_missing: z.array(z.string()),
    misconception_matches: z.array(MisconceptionMatchSchema),
    contradiction_detected: z.boolean(),
    analysis_source: z.enum([
      "existing_structured_data",
      "deterministic_v1",
      "llm_future_placeholder",
      "not_available"
    ])
  }),
  confidence_calibration_signal: ConfidenceCalibrationSignalSchema,
  ability_signal_category: AbilitySignalCategorySchema,
  evidence_strength: EvidenceStrengthSchema,
  evidence_confidence_modifier: EvidenceConfidenceModifierSchema,
  evidence_limitations: z.array(z.string()),
  optional_future_calibration: AbilityDiagnosticMetadataV1Schema.shape.optional_future_calibration
});

export const AbilityEvidencePacketV1Schema = z.object({
  schema_version: z.literal(ABILITY_EVIDENCE_PACKET_SCHEMA_VERSION),
  session_public_id: z.string(),
  student_public_id: z.string(),
  assessment_public_id: z.string(),
  concept_unit_id: z.string(),
  generated_at: z.string(),
  source_response_package_ids: z.array(z.string()),
  item_evidence: z.array(AbilityItemEvidenceV1Schema),
  concept_level_summary: z.object({
    provisional_category: z.enum([
      "Mostly understood",
      "Still developing",
      "Needs more work",
      "Ambiguous evidence",
      "Insufficient evidence"
    ]),
    category_confidence: z.enum(["high", "medium", "low"]),
    dominant_misconception_hypotheses: z.array(z.string()),
    knowledge_gap_hypotheses: z.array(z.string()),
    reasoning_quality_overall: z.enum(["adequate", "partial", "vague", "mixed", "insufficient"]),
    confidence_calibration_overall: z.enum([
      "well_calibrated",
      "overconfident",
      "underconfident",
      "mixed",
      "insufficient"
    ]),
    evidence_limitations: z.array(z.string())
  }),
  student_safe_projection: z.object({
    status: z.enum(["Mostly understood", "Still developing", "Needs more work"]),
    short_explanation: z.string(),
    next_focus: z.string()
  }),
  teacher_research_summary: z.object({
    safe_internal_summary: z.string(),
    evidence_trace: z.array(z.string())
  })
});

export type AbilityDiagnosticMetadataV1 = z.infer<typeof AbilityDiagnosticMetadataV1Schema>;
export type AbilityItemEvidenceV1 = z.infer<typeof AbilityItemEvidenceV1Schema>;
export type AbilityEvidencePacketV1 = z.infer<typeof AbilityEvidencePacketV1Schema>;
type ReasoningEvidenceV1 = AbilityItemEvidenceV1["reasoning_evidence"];

type JsonRecord = Record<string, unknown>;

type BuildItemAbilityEvidenceInput = {
  item_public_id: string;
  metadata: AbilityDiagnosticMetadataV1;
  selected_option: string | null;
  correctness?: string | null;
  reasoning_text?: string | null;
  confidence?: string | null;
  tempting_option?: string | null;
  no_tempting_option?: boolean | null;
  tempting_option_reason?: string | null;
  total_item_time_ms?: number | null;
  repair_count?: number;
  interrupted?: boolean;
};

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
    ? value.filter((entry): entry is string => typeof entry === "string" && Boolean(entry.trim())).map((entry) => entry.trim())
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
    const normalized = stringValue(entry);
    if (normalized) {
      output[key.toUpperCase()] = normalized;
    }
  }

  return output;
}

function optionRecord(value: unknown): Array<{ label: string; text: string }> {
  return Array.isArray(value)
    ? value
        .map((entry) => {
          const option = record(entry);
          const label = stringValue(option.label);
          const text = stringValue(option.text);
          return label && text ? { label, text } : null;
        })
        .filter((entry): entry is { label: string; text: string } => Boolean(entry))
    : [];
}

function optionLabel(value: unknown): z.infer<typeof NullableOptionLabelSchema> {
  const normalized = stringValue(value)?.toUpperCase();
  const parsed = OptionLabelSchema.safeParse(normalized);
  return parsed.success ? parsed.data : null;
}

function scoredOptionLabel(value: unknown): z.infer<typeof ScoredOptionLabelSchema> | null {
  const normalized = stringValue(value)?.toUpperCase();
  const parsed = ScoredOptionLabelSchema.safeParse(normalized);
  return parsed.success ? parsed.data : null;
}

function confidenceLabel(value: unknown): z.infer<typeof ConfidenceLabelSchema> | null {
  const normalized = stringValue(value)?.toLowerCase();
  if (normalized === "low") return "Low";
  if (normalized === "medium") return "Medium";
  if (normalized === "high") return "High";
  return null;
}

function slug(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80) || "unknown";
}

function tokenize(value: string) {
  const stopwords = new Set([
    "about",
    "after",
    "again",
    "because",
    "being",
    "between",
    "could",
    "describe",
    "describes",
    "different",
    "estimate",
    "estimates",
    "forms",
    "from",
    "have",
    "into",
    "item",
    "items",
    "more",
    "person",
    "properly",
    "same",
    "should",
    "that",
    "their",
    "there",
    "these",
    "this",
    "trait",
    "when",
    "which",
    "while",
    "with"
  ]);

  return new Set(
    value
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((token) => token.length >= 4 && !stopwords.has(token))
  );
}

function overlapScore(source: string, target: string) {
  const sourceTokens = tokenize(source);
  const targetTokens = [...tokenize(target)];
  if (sourceTokens.size === 0 || targetTokens.length === 0) {
    return 0;
  }
  const matched = targetTokens.filter((token) => sourceTokens.has(token)).length;
  return matched / Math.max(1, targetTokens.length);
}

function misconceptionIdForOption(input: {
  item_public_id: string;
  option_label: string;
  note: string | null;
}) {
  return `${input.item_public_id}_${input.option_label}_${slug(input.note ?? "diagnostic_distractor")}`;
}

export function diagnosticMetadataForItem(input: {
  item_public_id: string;
  concept_id: string;
  options: unknown;
  correct_option: string;
  distractor_rationales?: unknown;
  expected_reasoning_patterns?: unknown;
  possible_misconception_indicators?: unknown;
  administration_rules?: unknown;
}): AbilityDiagnosticMetadataV1 {
  const rules = record(input.administration_rules);
  const distractorRationales = record(input.distractor_rationales);
  const explicitOptionMap = stringArrayRecord(rules.option_misconception_map);
  const explicitOptionNotes = stringRecord(rules.option_diagnostic_notes);
  const correctOption = scoredOptionLabel(input.correct_option) ?? "A";
  const options = optionRecord(input.options);
  const optionMap: Record<string, string[]> = {};
  const optionNotes: Record<string, string> = {};

  for (const option of options) {
    const explicitMap = explicitOptionMap[option.label];
    if (explicitMap?.length) {
      optionMap[option.label] = explicitMap;
      if (explicitOptionNotes[option.label]) {
        optionNotes[option.label] = explicitOptionNotes[option.label];
      }
      continue;
    }

    if (option.label === correctOption) {
      optionMap[option.label] = ["target_understanding"];
      if (explicitOptionNotes[option.label]) {
        optionNotes[option.label] = explicitOptionNotes[option.label];
      }
      continue;
    }

    const note = stringValue(distractorRationales[option.label]);
    const misconceptionId = misconceptionIdForOption({
      item_public_id: input.item_public_id,
      option_label: option.label,
      note
    });
    optionMap[option.label] = [misconceptionId];
    if (note) {
      optionNotes[option.label] = note;
    }
  }

  const expectedPatterns = stringArray(rules.expected_solution_actions).length
    ? stringArray(rules.expected_solution_actions)
    : stringArray(input.expected_reasoning_patterns);
  const subskills = stringArray(rules.subskills);

  return AbilityDiagnosticMetadataV1Schema.parse({
    concept_id: stringValue(rules.concept_id) ?? input.concept_id,
    cognitive_level: stringValue(rules.cognitive_level) ?? stringValue(rules.cognitive_demand) ?? "teacher_defined",
    subskills,
    expected_solution_actions: expectedPatterns,
    correct_option: correctOption,
    option_misconception_map: optionMap,
    option_diagnostic_notes: optionNotes,
    optional_future_calibration: {
      difficulty_label: stringValue(rules.difficulty_label) ?? stringValue(rules.difficulty) ?? "unknown",
      discrimination_label: stringValue(rules.discrimination_label) ?? "unknown",
      empirical_ctt_item_difficulty: numberValue(rules.empirical_ctt_item_difficulty),
      empirical_ctt_discrimination: numberValue(rules.empirical_ctt_discrimination),
      calibration_sample_notes: stringValue(rules.calibration_sample_notes)
    }
  });
}

function optionRole(input: {
  option: string | null;
  correct_option: z.infer<typeof ScoredOptionLabelSchema>;
  option_misconception_map: Record<string, string[]>;
}): AbilityItemEvidenceV1["selected_option_role"] {
  if (!input.option) return "missing";
  if (input.option === "E") return "unscored";
  if (input.option === input.correct_option) return "correct";
  if (input.option_misconception_map[input.option]?.length) return "diagnostic_distractor";
  return "unknown_option";
}

function temptingRole(input: {
  option: string | null;
  no_tempting_option?: boolean | null;
  correct_option: z.infer<typeof ScoredOptionLabelSchema>;
  option_misconception_map: Record<string, string[]>;
}): AbilityItemEvidenceV1["tempting_option_role"] {
  if (input.no_tempting_option || input.option === "No") return "none";
  if (!input.option) return "missing";
  if (input.option === input.correct_option) return "correct";
  if (input.option_misconception_map[input.option]?.length) return "diagnostic_distractor";
  return "missing";
}

export function mapOptionToMisconceptionEvidence(input: {
  option: string | null;
  metadata: AbilityDiagnosticMetadataV1;
  source: "selected_option" | "tempting_option";
}): Array<z.infer<typeof MisconceptionMatchSchema>> {
  const option = input.source === "tempting_option"
    ? scoredOptionLabel(input.option)
    : optionLabel(input.option);

  if (!option || option === input.metadata.correct_option || option === "E") {
    return [];
  }

  return (input.metadata.option_misconception_map[option] ?? [])
    .filter((misconceptionId) => misconceptionId !== "target_understanding")
    .map((misconceptionId) => ({
      misconception_id: misconceptionId,
      support: "medium" as const,
      source: input.source
    }));
}

function analyzeReasoning(input: {
  reasoning_text?: string | null;
  selected_misconception_ids: string[];
  tempting_misconception_ids: string[];
  expected_solution_actions: string[];
  possible_misconception_indicators: string[];
  option_diagnostic_notes: Record<string, string>;
}): ReasoningEvidenceV1 {
  const text = input.reasoning_text?.trim() ?? "";
  if (!text) {
    return {
      available: false,
      quality: "unknown" as const,
      key_ideas_present: [],
      key_ideas_missing: input.expected_solution_actions.slice(0, 4),
      misconception_matches: [],
      contradiction_detected: false,
      analysis_source: "not_available" as const
    };
  }

  const lower = text.toLowerCase();
  const saysUnknown = /\b(i do not know|i don't know|not sure|unsure|no idea)\b/i.test(text);
  const offTrack = /\b(pizza|weather|sports|movie|unrelated)\b/i.test(text);
  const keyIdeasPresent = input.expected_solution_actions
    .filter((action) => overlapScore(lower, action) >= 0.22)
    .slice(0, 6);
  const keyIdeasMissing = input.expected_solution_actions
    .filter((action) => !keyIdeasPresent.includes(action))
    .slice(0, 6);
  const reasoningMisconceptions = input.possible_misconception_indicators
    .filter((indicator) => overlapScore(lower, indicator) >= 0.25)
    .map((indicator) => ({
      misconception_id: `reasoning_${slug(indicator)}`,
      support: "medium" as const,
      source: "reasoning" as const
    }));
  const noteMisconceptions = Object.entries(input.option_diagnostic_notes)
    .filter(([, note]) => overlapScore(lower, note) >= 0.25)
    .map(([option, note]) => ({
      misconception_id: `reasoning_${option}_${slug(note)}`,
      support: "medium" as const,
      source: "reasoning" as const
    }));
  const selectedMatches = input.selected_misconception_ids.map((misconceptionId) => ({
    misconception_id: misconceptionId,
    support: keyIdeasPresent.length === 0 ? "medium" as const : "low" as const,
    source: "selected_option" as const
  }));
  const temptingMatches = input.tempting_misconception_ids.map((misconceptionId) => ({
    misconception_id: misconceptionId,
    support: "low" as const,
    source: "tempting_option" as const
  }));
  const misconception_matches = [
    ...selectedMatches,
    ...temptingMatches,
    ...reasoningMisconceptions,
    ...noteMisconceptions
  ];
  const contradictionDetected = keyIdeasPresent.length > 0 && misconception_matches.length > 0;
  const quality = offTrack
    ? "off_track"
    : saysUnknown
      ? "unknown"
      : keyIdeasPresent.length >= 2 || (keyIdeasPresent.length >= 1 && text.length >= 70)
        ? "adequate"
        : keyIdeasPresent.length >= 1 || text.length >= 45
          ? "partial"
          : "vague";

  return {
    available: true,
    quality,
    key_ideas_present: keyIdeasPresent,
    key_ideas_missing: keyIdeasMissing,
    misconception_matches,
    contradiction_detected: contradictionDetected,
    analysis_source: "deterministic_v1" as const
  };
}

function processModifier(input: {
  total_item_time_ms?: number | null;
  repair_count?: number;
  interrupted?: boolean;
}): z.infer<typeof EvidenceConfidenceModifierSchema> {
  if (input.interrupted) {
    return { source: "process_data", effect: "neutral", reason_code: "interrupted_session" };
  }
  if ((input.repair_count ?? 0) >= 2) {
    return { source: "process_data", effect: "lower_confidence", reason_code: "repeated_repairs" };
  }
  if (typeof input.total_item_time_ms === "number" && input.total_item_time_ms > 0 && input.total_item_time_ms < 3000) {
    return { source: "process_data", effect: "lower_confidence", reason_code: "rapid_response" };
  }
  if (typeof input.total_item_time_ms === "number" && input.total_item_time_ms >= 30000) {
    return { source: "process_data", effect: "increase_confidence", reason_code: "enough_deliberation" };
  }
  return { source: "process_data", effect: "neutral", reason_code: "insufficient_data" };
}

function confidenceCalibration(input: {
  is_correct: boolean | null;
  selected_role: AbilityItemEvidenceV1["selected_option_role"];
  reasoning_quality: z.infer<typeof ReasoningQualitySchema>;
  confidence: z.infer<typeof ConfidenceLabelSchema> | null;
}): z.infer<typeof ConfidenceCalibrationSignalSchema> {
  if (!input.confidence || input.selected_role === "missing") return "insufficient_evidence";
  if (input.confidence === "High" && input.is_correct === false) return "overconfident";
  if (input.confidence === "High" && ["vague", "unknown", "off_track"].includes(input.reasoning_quality)) {
    return "overconfident";
  }
  if (input.confidence === "Low" && input.is_correct === true) return "underconfident";
  if (input.confidence === "Low" && input.is_correct === false) return "uncertain";
  if (input.is_correct === null) return "insufficient_evidence";
  return "well_calibrated";
}

export function classifyAbilitySignal(input: {
  is_correct: boolean | null;
  selected_role: AbilityItemEvidenceV1["selected_option_role"];
  tempting_role: AbilityItemEvidenceV1["tempting_option_role"];
  reasoning_quality: z.infer<typeof ReasoningQualitySchema>;
  confidence: z.infer<typeof ConfidenceLabelSchema> | null;
  misconception_match_count: number;
  contradiction_detected?: boolean;
}): z.infer<typeof AbilitySignalCategorySchema> {
  if (input.selected_role === "missing") return "insufficient_evidence";
  if (input.selected_role === "unscored" && input.confidence === "Low") return "knowledge_gap";
  if (input.selected_role === "unscored") return "insufficient_evidence";

  if (input.is_correct === true) {
    if (input.confidence === "Low") return "emerging_understanding";
    if (input.tempting_role === "diagnostic_distractor") return "emerging_understanding";
    if (["vague", "unknown", "off_track"].includes(input.reasoning_quality) && input.confidence === "High") {
      return "shallow_or_guess";
    }
    if (["adequate", "partial"].includes(input.reasoning_quality)) return "strong_understanding";
    return "ambiguous_mixed_evidence";
  }

  if (input.is_correct === false) {
    if (input.tempting_role === "correct" && ["partial", "adequate"].includes(input.reasoning_quality)) {
      return "emerging_understanding";
    }
    if (input.selected_role === "diagnostic_distractor") {
      if (input.confidence === "High" && input.misconception_match_count > 0) return "misconception_signal";
      if (input.contradiction_detected && ["partial", "adequate"].includes(input.reasoning_quality)) {
        return "ambiguous_mixed_evidence";
      }
      if (input.confidence === "Low") return "knowledge_gap";
      return input.misconception_match_count > 1 ? "misconception_signal" : "ambiguous_mixed_evidence";
    }
    return ["vague", "unknown"].includes(input.reasoning_quality) ? "knowledge_gap" : "ambiguous_mixed_evidence";
  }

  return "ambiguous_mixed_evidence";
}

function evidenceStrength(input: {
  category: z.infer<typeof AbilitySignalCategorySchema>;
  reasoning_quality: z.infer<typeof ReasoningQualitySchema>;
  modifier: z.infer<typeof EvidenceConfidenceModifierSchema>;
}) {
  let strength: z.infer<typeof EvidenceStrengthSchema> =
    input.category === "strong_understanding" || input.category === "misconception_signal"
      ? "high"
      : input.category === "insufficient_evidence"
        ? "low"
        : "medium";

  if (["vague", "unknown", "off_track"].includes(input.reasoning_quality)) {
    strength = strength === "high" ? "medium" : "low";
  }
  if (input.modifier.effect === "lower_confidence") {
    strength = strength === "high" ? "medium" : "low";
  }
  if (input.modifier.effect === "increase_confidence" && strength === "medium") {
    strength = "high";
  }

  return strength;
}

export function buildItemAbilityEvidence(input: BuildItemAbilityEvidenceInput): AbilityItemEvidenceV1 {
  const selectedOption = optionLabel(input.selected_option);
  const confidence = confidenceLabel(input.confidence);
  const temptingOption = input.no_tempting_option ? "No" : scoredOptionLabel(input.tempting_option);
  const selectedRole = optionRole({
    option: selectedOption,
    correct_option: input.metadata.correct_option,
    option_misconception_map: input.metadata.option_misconception_map
  });
  const selectedMisconceptionIds =
    selectedRole === "diagnostic_distractor" && selectedOption
      ? input.metadata.option_misconception_map[selectedOption] ?? []
      : [];
  const temptingRoleValue = temptingRole({
    option: temptingOption === "No" ? "No" : temptingOption,
    no_tempting_option: input.no_tempting_option,
    correct_option: input.metadata.correct_option,
    option_misconception_map: input.metadata.option_misconception_map
  });
  const temptingMisconceptionIds =
    temptingRoleValue === "diagnostic_distractor" && temptingOption && temptingOption !== "No"
      ? input.metadata.option_misconception_map[temptingOption] ?? []
      : [];
  const isCorrect =
    selectedRole === "missing" || selectedRole === "unscored"
      ? null
      : input.correctness === "correct" || selectedOption === input.metadata.correct_option;
  const reasoning = analyzeReasoning({
    reasoning_text: input.reasoning_text,
    selected_misconception_ids: selectedMisconceptionIds,
    tempting_misconception_ids: temptingMisconceptionIds,
    expected_solution_actions: input.metadata.expected_solution_actions,
    possible_misconception_indicators: [
      ...Object.values(input.metadata.option_diagnostic_notes),
      ...selectedMisconceptionIds,
      ...temptingMisconceptionIds
    ],
    option_diagnostic_notes: input.metadata.option_diagnostic_notes
  });
  const calibration = confidenceCalibration({
    is_correct: isCorrect,
    selected_role: selectedRole,
    reasoning_quality: reasoning.quality,
    confidence
  });
  const category = classifyAbilitySignal({
    is_correct: isCorrect,
    selected_role: selectedRole,
    tempting_role: temptingRoleValue,
    reasoning_quality: reasoning.quality,
    confidence,
    misconception_match_count: reasoning.misconception_matches.length,
    contradiction_detected: reasoning.contradiction_detected
  });
  const modifier = processModifier(input);
  const limitations: string[] = [];

  if (input.metadata.expected_solution_actions.length === 0) {
    limitations.push("missing_expected_solution_actions");
  }
  if (input.metadata.subskills.length === 0) {
    limitations.push("missing_subskill_metadata");
  }
  if (input.metadata.optional_future_calibration.difficulty_label === "unknown") {
    limitations.push("difficulty_label_missing_or_unknown_optional_only");
  }
  if (input.metadata.optional_future_calibration.discrimination_label === "unknown") {
    limitations.push("discrimination_label_missing_or_unknown_optional_only");
  }
  if (reasoning.quality === "not_analyzed" || reasoning.quality === "unknown") {
    limitations.push("reasoning_not_sufficiently_analyzed");
  }
  if (modifier.effect === "lower_confidence") {
    limitations.push(`process_data_${modifier.reason_code}_lowers_inference_confidence_only`);
  }

  return AbilityItemEvidenceV1Schema.parse({
    item_public_id: input.item_public_id,
    concept_id: input.metadata.concept_id,
    cognitive_level: input.metadata.cognitive_level,
    subskills: input.metadata.subskills,
    expected_solution_actions: input.metadata.expected_solution_actions,
    selected_option: selectedOption,
    is_correct_internal: isCorrect,
    selected_option_role: selectedRole,
    selected_misconception_ids: selectedMisconceptionIds,
    tempting_option: input.no_tempting_option ? "No" : temptingOption,
    tempting_option_role: temptingRoleValue,
    tempting_misconception_ids: temptingMisconceptionIds,
    confidence,
    reasoning_evidence: reasoning,
    confidence_calibration_signal: calibration,
    ability_signal_category: category,
    evidence_strength: evidenceStrength({
      category,
      reasoning_quality: reasoning.quality,
      modifier
    }),
    evidence_confidence_modifier: modifier,
    evidence_limitations: limitations,
    optional_future_calibration: input.metadata.optional_future_calibration
  });
}

function summarizeReasoningQuality(items: AbilityItemEvidenceV1[]) {
  if (items.length === 0) return "insufficient" as const;
  const qualities = new Set(items.map((item) => item.reasoning_evidence.quality));
  if (qualities.has("adequate") && !qualities.has("vague") && !qualities.has("off_track")) return "adequate" as const;
  if (qualities.has("partial") || qualities.has("adequate")) return qualities.size > 1 ? "mixed" as const : "partial" as const;
  if (qualities.has("vague")) return "vague" as const;
  return "insufficient" as const;
}

function summarizeCalibration(items: AbilityItemEvidenceV1[]) {
  const values = items.map((item) => item.confidence_calibration_signal).filter((value) => value !== "insufficient_evidence");
  if (values.length === 0) return "insufficient" as const;
  const unique = new Set(values);
  if (unique.size > 1) return "mixed" as const;
  const [first] = values;
  return first === "uncertain" ? "mixed" : first;
}

export function summarizeConceptAbilityEvidence(items: AbilityItemEvidenceV1[]): AbilityEvidencePacketV1["concept_level_summary"] {
  const counts = items.reduce<Record<string, number>>((accumulator, item) => {
    accumulator[item.ability_signal_category] = (accumulator[item.ability_signal_category] ?? 0) + 1;
    return accumulator;
  }, {});
  const highStrengthCount = items.filter((item) => item.evidence_strength === "high").length;
  const misconceptionIds = new Map<string, number>();
  const limitations = new Set<string>();

  for (const item of items) {
    for (const match of item.reasoning_evidence.misconception_matches) {
      misconceptionIds.set(match.misconception_id, (misconceptionIds.get(match.misconception_id) ?? 0) + 1);
    }
    item.evidence_limitations.forEach((limitation) => limitations.add(limitation));
  }

  const provisionalCategory =
    items.length === 0 || counts.insufficient_evidence === items.length
      ? "Insufficient evidence"
      : (counts.strong_understanding ?? 0) >= 2 && (counts.misconception_signal ?? 0) === 0
        ? "Mostly understood"
        : (counts.knowledge_gap ?? 0) + (counts.misconception_signal ?? 0) >= 2
          ? "Needs more work"
          : (counts.ambiguous_mixed_evidence ?? 0) >= 2
            ? "Ambiguous evidence"
            : "Still developing";

  return {
    provisional_category: provisionalCategory,
    category_confidence: highStrengthCount >= 2 ? "high" : highStrengthCount === 1 ? "medium" : "low",
    dominant_misconception_hypotheses: [...misconceptionIds.entries()]
      .sort((left, right) => right[1] - left[1])
      .slice(0, 5)
      .map(([id]) => id),
    knowledge_gap_hypotheses: items
      .filter((item) => item.ability_signal_category === "knowledge_gap")
      .map((item) => `${item.item_public_id}:insufficient_or_low_confidence_evidence`)
      .slice(0, 5),
    reasoning_quality_overall: summarizeReasoningQuality(items),
    confidence_calibration_overall: summarizeCalibration(items),
    evidence_limitations: [...limitations]
  };
}

export function projectStudentSafeAbilityStatus(
  summary: AbilityEvidencePacketV1["concept_level_summary"]
): AbilityEvidencePacketV1["student_safe_projection"] {
  if (summary.provisional_category === "Mostly understood") {
    return {
      status: "Mostly understood",
      short_explanation: "Your responses show a generally clear pattern for this idea.",
      next_focus: "Use the next step to make the reasoning precise and transferable."
    };
  }

  if (summary.provisional_category === "Needs more work" || summary.provisional_category === "Insufficient evidence") {
    return {
      status: "Needs more work",
      short_explanation: "The current evidence is not enough to show a stable explanation yet.",
      next_focus: "Focus on explaining the key distinction in your own words."
    };
  }

  return {
    status: "Still developing",
    short_explanation: "Your responses show some useful evidence, but the pattern is not fully settled.",
    next_focus: "Focus on the part of the idea that still feels uncertain."
  };
}

function packageItemPublicIds(payload: unknown) {
  const itemResponses = Array.isArray(record(payload).item_responses)
    ? (record(payload).item_responses as unknown[])
    : [];
  return new Set(
    itemResponses
      .map((entry) => stringValue(record(entry).item_public_id))
      .filter((value): value is string => Boolean(value))
  );
}

function repairCountForItem(events: Array<{ item_db_id: string | null; event_type: string }>, itemDbId: string) {
  return events.filter((event) =>
    event.item_db_id === itemDbId && /repair|validation_failure|quality_rejected/.test(event.event_type)
  ).length;
}

export async function buildAbilityEvidencePacketForSession(sessionPublicId: string): Promise<AbilityEvidencePacketV1> {
  const session = await prisma.assessmentSession.findUniqueOrThrow({
    where: { session_public_id: sessionPublicId },
    include: {
      user: { select: { user_id: true } },
      assessment: { select: { assessment_public_id: true } },
      concept_unit_sessions: {
        orderBy: [{ created_at: "desc" }],
        include: {
          concept_unit: true,
          response_packages: {
            where: { package_type: "initial_concept_unit_response_package" },
            orderBy: [{ created_at: "desc" }]
          },
          item_responses: {
            orderBy: [{ created_at: "asc" }],
            include: { item: true }
          },
          process_events: {
            select: {
              item_db_id: true,
              event_type: true,
              pause_duration_ms: true
            }
          }
        }
      }
    }
  });
  const conceptUnitSession = session.concept_unit_sessions.find((entry) => entry.response_packages.length > 0);

  if (!conceptUnitSession) {
    throw new Error(`No initial response package exists for session ${sessionPublicId}.`);
  }

  const sourcePackages = conceptUnitSession.response_packages;
  const sourcePackage = sourcePackages[0];
  const sourceItemPublicIds = packageItemPublicIds(sourcePackage?.payload);
  const responses = conceptUnitSession.item_responses.filter((response) =>
    sourceItemPublicIds.size === 0 ? response.item.included_in_published_set : sourceItemPublicIds.has(response.item.item_public_id)
  );
  const conceptId = conceptUnitSession.concept_unit.concept_unit_public_id;
  const itemEvidence = responses.map((response) => {
    const metadata = diagnosticMetadataForItem({
      item_public_id: response.item.item_public_id,
      concept_id: conceptId,
      options: response.item.options,
      correct_option: response.correct_option_snapshot || response.item.correct_option,
      distractor_rationales: response.item.distractor_rationales,
      expected_reasoning_patterns: response.item.expected_reasoning_patterns,
      possible_misconception_indicators: response.item.possible_misconception_indicators,
      administration_rules: response.item.administration_rules
    });
    const hasPause = conceptUnitSession.process_events.some((event) =>
      event.item_db_id === response.item_db_id && typeof event.pause_duration_ms === "number" && event.pause_duration_ms > 0
    );
    const packageResponse = Array.isArray(record(sourcePackage?.payload).item_responses)
      ? (record(sourcePackage?.payload).item_responses as unknown[])
          .map((entry) => record(entry))
          .find((entry) => entry.item_public_id === response.item.item_public_id)
      : null;

    return buildItemAbilityEvidence({
      item_public_id: response.item.item_public_id,
      metadata,
      selected_option: response.selected_option,
      correctness: response.correctness,
      reasoning_text: response.reasoning_text,
      confidence: response.confidence_rating,
      tempting_option: stringValue(packageResponse?.tempting_option),
      no_tempting_option: packageResponse?.no_tempting_option === true,
      tempting_option_reason: stringValue(packageResponse?.tempting_option_reason),
      total_item_time_ms: response.item_response_time_ms,
      repair_count: repairCountForItem(conceptUnitSession.process_events, response.item_db_id),
      interrupted: hasPause
    });
  });
  const summary = summarizeConceptAbilityEvidence(itemEvidence);
  const packet = {
    schema_version: ABILITY_EVIDENCE_PACKET_SCHEMA_VERSION,
    session_public_id: session.session_public_id,
    student_public_id: session.user.user_id,
    assessment_public_id: session.assessment.assessment_public_id,
    concept_unit_id: conceptUnitSession.concept_unit.concept_unit_public_id,
    generated_at: new Date().toISOString(),
    source_response_package_ids: sourcePackages.map((pkg) => pkg.id),
    item_evidence: itemEvidence,
    concept_level_summary: summary,
    student_safe_projection: projectStudentSafeAbilityStatus(summary),
    teacher_research_summary: {
      safe_internal_summary:
        "Ability evidence packet generated from response package, item metadata, reasoning, confidence, tempting-option evidence, and process-data confidence modifiers.",
      evidence_trace: itemEvidence.map((item) =>
        `${item.item_public_id}:${item.ability_signal_category}:${item.evidence_strength}`
      )
    }
  };

  return AbilityEvidencePacketV1Schema.parse(packet);
}
