import { z } from "zod";
import { ProductionStudentProfileOutputV5, type AgentInputByName } from "@/lib/agents/contracts";
import { AbilityPatternFlagSchema, EngagementPatternFlagSchema } from "@/lib/domain/enums";
import { studentProfileSealedCorrectness } from "./semantic-validation";

export const STUDENT_PROFILE_REQUEST_SCHEMA_VERSION = "student-profile-request-schema-v1" as const;

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
  const correctness = studentProfileSealedCorrectness(input);
  const ability = AbilityPatternFlagSchema.options.filter(flag => flag !== "no_clear_pattern" &&
    !(correctness.all_known_incorrect && flag === "correct_answer_weak_reasoning"));
  const engagement = EngagementPatternFlagSchema.options.filter(flag => flag !== "no_clear_pattern");
  return ProductionStudentProfileOutputV5.extend({
    ability_pattern_flags: exclusivePatternFlags(ability),
    engagement_pattern_flags: exclusivePatternFlags(engagement)
  }).strict();
}
