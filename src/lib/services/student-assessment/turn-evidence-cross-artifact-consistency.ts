import { z } from "zod";
import {
  ConceptualEvidenceApplicabilitySchema,
  LEARNING_PROFILE_UPDATE_DISPOSITION_VERSION,
  ProfileUpdateDispositionSchema,
  TURN_EVIDENCE_OBSERVATION_VERSION,
  type LearningProfileUpdateDispositionRecordV1,
  type TurnEvidenceObservationRecordV1
} from "@/lib/services/student-assessment/turn-evidence-profile-update";

export const TURN_EVIDENCE_CROSS_ARTIFACT_CONSISTENCY_VERSION =
  "turn-evidence-cross-artifact-consistency-v1" as const;
export const TURN_EVIDENCE_CROSS_ARTIFACT_CONSISTENCY_VERSION_V2 =
  "turn-evidence-cross-artifact-consistency-v2" as const;

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

const TurnObservationLayerViewV2Schema = z.object({
  artifact_type: z.enum([
    "evaluator_observation",
    "anchor_resolution_observation",
    "contradiction_observation",
    "normalized_turn_observation"
  ]),
  source_student_turn_id: z.string().min(1),
  source_sequence_index: z.number().int().positive(),
  conceptual_evidence_applicability: ConceptualEvidenceApplicabilitySchema,
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
  reasoning_quality: z.enum([
    "insufficient",
    "misconception",
    "partial",
    "sound"
  ]),
  contradictions: z.array(z.string().min(1).max(240)).max(24)
}).strict();
export type TurnObservationLayerViewV2 = z.infer<
  typeof TurnObservationLayerViewV2Schema
>;

const AuthoritativeProfileLayerViewV2Schema = z.object({
  artifact_type: z.enum([
    "resulting_profile",
    "cumulative_profile",
    "sound_gate_input",
    "platform_mode_input",
    "tutor_input_profile"
  ]),
  authoritative_profile_id: z.string().min(1),
  reasoning_quality: z.enum([
    "insufficient",
    "misconception",
    "partial",
    "sound"
  ]),
  anchor_application: z.enum(["absent", "implicit", "explicit"]),
  misconception_status: z.enum([
    "persists",
    "uncertain",
    "resolved_for_current_anchor"
  ]),
  revision_readiness: z.boolean()
}).strict();
export type AuthoritativeProfileLayerViewV2 = z.infer<
  typeof AuthoritativeProfileLayerViewV2Schema
>;

export const TurnEvidenceCrossArtifactConsistencyResultV2Schema = z.object({
  policy_version: z.literal(
    TURN_EVIDENCE_CROSS_ARTIFACT_CONSISTENCY_VERSION_V2
  ),
  passed: z.boolean(),
  turn_observation_version: z.literal(TURN_EVIDENCE_OBSERVATION_VERSION),
  profile_update_contract_version: z.literal(
    LEARNING_PROFILE_UPDATE_DISPOSITION_VERSION
  ),
  source_student_turn_id: z.string().min(1),
  source_sequence_index: z.number().int().positive(),
  turn_observation_artifact_count: z.number().int().positive(),
  authoritative_profile_artifact_count: z.number().int().positive(),
  update_disposition: ProfileUpdateDispositionSchema,
  cross_layer_difference_expected: z.boolean(),
  issue_codes: z.array(z.string().min(1)).max(60)
}).strict();

function compareLayer<T extends Record<string, unknown>>(input: {
  views: T[];
  ignored_fields: Array<keyof T>;
  prefix: string;
}) {
  const first = input.views[0];
  if (!first) return [`${input.prefix}_view_missing`];
  const ignored = new Set<keyof T>(input.ignored_fields);
  const issues: string[] = [];
  for (const field of Object.keys(first) as Array<keyof T>) {
    if (ignored.has(field)) continue;
    const expected = JSON.stringify(first[field]);
    if (input.views.some((view) => JSON.stringify(view[field]) !== expected)) {
      issues.push(`${input.prefix}_${String(field)}_disagreement`);
    }
  }
  return issues;
}

export function reconcileTurnEvidenceLayersV2(input: {
  turn_observation: TurnEvidenceObservationRecordV1;
  update_record: LearningProfileUpdateDispositionRecordV1;
  turn_observation_views: TurnObservationLayerViewV2[];
  authoritative_profile_views: AuthoritativeProfileLayerViewV2[];
}) {
  const turnViews = z.array(TurnObservationLayerViewV2Schema).min(2).parse(
    input.turn_observation_views
  );
  const profileViews = z.array(AuthoritativeProfileLayerViewV2Schema).min(2)
    .parse(input.authoritative_profile_views);
  const issues = [
    ...compareLayer({
      views: turnViews,
      ignored_fields: ["artifact_type"],
      prefix: "turn_observation"
    }),
    ...compareLayer({
      views: profileViews,
      ignored_fields: ["artifact_type"],
      prefix: "authoritative_profile"
    })
  ];
  const update = input.update_record;
  const observation = input.turn_observation;
  if (update.latest_turn_observation_id !== observation.observation_id) {
    issues.push("update_disposition_observation_id_mismatch");
  }
  if (update.source_student_turn_id !== observation.source_student_turn_id ||
      update.source_sequence_index !== observation.source_sequence_index) {
    issues.push("update_disposition_source_turn_mismatch");
  }
  if (update.update_disposition !== observation.profile_update_disposition) {
    issues.push("update_disposition_contract_mismatch");
  }
  const crossLayerDifferenceExpected =
    update.update_disposition === "preserve_prior_profile" &&
    update.resulting_authoritative_profile_id !==
      observation.observation_id;
  if (update.update_disposition === "preserve_prior_profile" &&
      !update.preservation_provenance) {
    issues.push("preservation_provenance_missing");
  }
  if (observation.conceptual_evidence_applicability === "mixed_intent" &&
      update.update_disposition === "preserve_prior_profile") {
    issues.push("mixed_intent_evidence_not_retained");
  }
  const result = TurnEvidenceCrossArtifactConsistencyResultV2Schema.parse({
    policy_version: TURN_EVIDENCE_CROSS_ARTIFACT_CONSISTENCY_VERSION_V2,
    passed: issues.length === 0,
    turn_observation_version: observation.observation_version,
    profile_update_contract_version: update.update_contract_version,
    source_student_turn_id: observation.source_student_turn_id,
    source_sequence_index: observation.source_sequence_index,
    turn_observation_artifact_count: turnViews.length,
    authoritative_profile_artifact_count: profileViews.length,
    update_disposition: update.update_disposition,
    cross_layer_difference_expected: crossLayerDifferenceExpected,
    issue_codes: issues
  });
  if (!result.passed) {
    throw new TurnEvidenceCrossArtifactConsistencyError(result.issue_codes);
  }
  return result;
}
