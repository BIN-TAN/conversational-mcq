import { z } from "zod";

export const TURN_EVIDENCE_CROSS_ARTIFACT_CONSISTENCY_VERSION =
  "turn-evidence-cross-artifact-consistency-v1" as const;

const AuthoritativeTurnEvidenceViewSchema = z.object({
  artifact_type: z.enum([
    "evaluator",
    "anchor_resolution",
    "mapper",
    "turn_profile",
    "route"
  ]),
  source_student_turn_id: z.string().min(1),
  source_sequence_index: z.number().int().positive(),
  evaluator_version: z.string().min(1),
  anchor_application: z.enum(["absent", "implicit", "explicit"]),
  anchor_stance: z.enum([
    "not_expressed",
    "ambiguous",
    "endorses_distractor",
    "rejects_distractor"
  ]),
  anchor_consistency: z.enum([
    "not_assessable",
    "consistent_with_conceptual_reasoning",
    "contradictory_to_conceptual_reasoning",
    "unresolved"
  ]),
  anchor_resolution_status: z.enum([
    "unresolved",
    "resolved_against_distractor",
    "regressed",
    "contradictory"
  ]),
  contradictions: z.array(z.string().min(1).max(240)).max(12),
  reasoning_quality: z.enum([
    "insufficient",
    "misconception",
    "partial",
    "sound"
  ]),
  revision_readiness: z.boolean(),
  platform_mode: z.enum([
    "remain_in_dialogue",
    "request_revision",
    "present_transfer",
    "complete_episode"
  ])
}).strict();
export type AuthoritativeTurnEvidenceView = z.infer<
  typeof AuthoritativeTurnEvidenceViewSchema
>;

export const TurnEvidenceCrossArtifactConsistencyResultSchema = z.object({
  policy_version: z.literal(
    TURN_EVIDENCE_CROSS_ARTIFACT_CONSISTENCY_VERSION
  ),
  passed: z.boolean(),
  source_student_turn_id: z.string().min(1),
  source_sequence_index: z.number().int().positive(),
  evaluator_version: z.string().min(1),
  authoritative_artifact_count: z.number().int().positive(),
  issue_codes: z.array(z.string().min(1)).max(40)
}).strict();

export class TurnEvidenceCrossArtifactConsistencyError extends Error {
  readonly issue_codes: string[];
  constructor(issueCodes: string[]) {
    super(`cross_artifact_profile_disagreement:${issueCodes.join("|")}`);
    this.name = "TurnEvidenceCrossArtifactConsistencyError";
    this.issue_codes = issueCodes;
  }
}

function normalized(values: string[]) {
  return [...new Set(values)].sort();
}

export function reconcileAuthoritativeTurnEvidenceViews(input: {
  views: AuthoritativeTurnEvidenceView[];
}) {
  const views = z.array(AuthoritativeTurnEvidenceViewSchema).min(2).parse(
    input.views
  );
  const first = views[0]!;
  const issues: string[] = [];
  const equal = <T>(field: keyof AuthoritativeTurnEvidenceView,
    serialize: (value: T) => string = (value) => JSON.stringify(value)) => {
    const expected = serialize(first[field] as T);
    if (views.some((view) => serialize(view[field] as T) !== expected)) {
      issues.push(`authoritative_${String(field)}_disagreement`);
    }
  };
  equal<string>("source_student_turn_id");
  equal<number>("source_sequence_index");
  equal<string>("evaluator_version");
  equal<string>("anchor_application");
  equal<string>("anchor_stance");
  equal<string>("anchor_consistency");
  equal<string>("anchor_resolution_status");
  equal<string[]>("contradictions", (value) =>
    JSON.stringify(normalized(value))
  );
  equal<string>("reasoning_quality");
  equal<boolean>("revision_readiness");
  equal<string>("platform_mode");
  const result = TurnEvidenceCrossArtifactConsistencyResultSchema.parse({
    policy_version: TURN_EVIDENCE_CROSS_ARTIFACT_CONSISTENCY_VERSION,
    passed: issues.length === 0,
    source_student_turn_id: first.source_student_turn_id,
    source_sequence_index: first.source_sequence_index,
    evaluator_version: first.evaluator_version,
    authoritative_artifact_count: views.length,
    issue_codes: issues
  });
  if (!result.passed) {
    throw new TurnEvidenceCrossArtifactConsistencyError(result.issue_codes);
  }
  return result;
}
