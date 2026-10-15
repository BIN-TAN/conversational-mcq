import { z } from "zod";
import { ProductionStudentProfileOutputV6, type AgentInputByName } from "@/lib/agents/contracts";
import { AbilityPatternFlagSchema, EngagementPatternFlagSchema } from "@/lib/domain/enums";
import { studentProfileSealedCorrectness } from "./semantic-validation";
import { evidenceIdRequestSchema } from "@/lib/llm/evidence-id-request-schema";
import { CanonicalEligibleEvidenceCatalogSchema } from "@/lib/domain/canonical-evidence-identity";

export const STUDENT_PROFILE_REQUEST_SCHEMA_VERSION = "student-profile-request-schema-v4" as const;

function exclusivePatternFlags<T extends string>(specificValues: T[]) {
  // Nested anyOf is supported by the Responses strict JSON schema. Empty
  // specific arrays remain valid, as in the unchanged canonical V5 contract.
  return z.union([
    z.array(z.literal("no_clear_pattern")).length(1),
    z.array(z.enum(specificValues as [T, ...T[]]))
  ]);
}

// Request-only constraints prevent structurally impossible generations. They
// do not rewrite output, replace semantic validation or change stored schemas.
export function studentProfileRequestOutputSchema(input: AgentInputByName["student_profiling_agent"]) {
  // Match the existing misconception-source eligibility. The narrower
  // same-item reasoning/quote rules remain semantic checks, not enum inference.
  const catalog = CanonicalEligibleEvidenceCatalogSchema.parse(input.allowed_evidence_catalog);
  const evidenceIds = catalog.evidence.filter(evidence => evidence.source_role === "student" &&
    evidence.evidence_stage === "baseline_assessment" && evidence.eligibility === "student_understanding")
    .map(evidence => evidence.evidence_id);
  const correctness = studentProfileSealedCorrectness(input);
  const ability = AbilityPatternFlagSchema.options.filter(flag => flag !== "no_clear_pattern" &&
    !(correctness.all_known_incorrect && flag === "correct_answer_weak_reasoning"));
  const engagement = EngagementPatternFlagSchema.options.filter(flag => flag !== "no_clear_pattern");
  const constrained = ProductionStudentProfileOutputV6.extend({
    ability_pattern_flags: exclusivePatternFlags(ability),
    engagement_pattern_flags: exclusivePatternFlags(engagement)
  }).strict();
  // Generate item judgments and their support before aggregate pattern labels.
  // This changes request property order only; every stored V6 field, value and
  // semantic rejection rule remains intact.
  const {
    agent_name, agent_version, prompt_version, schema_version, output_status,
    warnings, profile_type, item_level_evidence, strong_partial_reasoning_support,
    misconception_indicators, reasoning_quality_summary, engagement_summary,
    process_interpretation_cautions, ...aggregateJudgments
  } = constrained.shape;
  const ordered = z.object({
    agent_name, agent_version, prompt_version, schema_version, output_status,
    warnings, profile_type, item_level_evidence, strong_partial_reasoning_support,
    misconception_indicators, reasoning_quality_summary, engagement_summary,
    process_interpretation_cautions, ...aggregateJudgments
  }).strict();
  // A legitimately fully skipped package can contain only context/process
  // evidence. Both citation-bearing collections must then be empty; ordinary
  // insufficient-evidence judgments remain available without invented sources.
  if (evidenceIds.length === 0) return ordered.extend({
    misconception_indicators: ordered.shape.misconception_indicators.max(0),
    strong_partial_reasoning_support: ordered.shape.strong_partial_reasoning_support.max(0)
  }).strict();
  return evidenceIdRequestSchema(ordered, evidenceIds, "student-profile-output-v6");
}
