import { z } from "zod";
import {
  PRODUCTION_TURN_EVIDENCE_EVALUATOR_VERSION_V5
} from "@/lib/services/student-assessment/production-turn-evidence-evaluator-v5";
import {
  PROFILE_CONSISTENCY_POLICY_VERSION_V6,
  TURN_EVIDENCE_PROFILE_MAPPER_VERSION_V6
} from "@/lib/services/student-assessment/target-evidence-contract-v5";
import {
  LEARNING_PROFILE_UPDATE_DISPOSITION_VERSION,
  MIXED_INTENT_EVIDENCE_RETENTION_VERSION,
  NONCONCEPTUAL_PROFILE_PRESERVATION_VERSION,
  TURN_EVIDENCE_OBSERVATION_VERSION
} from "@/lib/services/student-assessment/turn-evidence-profile-update";
import {
  TURN_EVIDENCE_CROSS_ARTIFACT_CONSISTENCY_VERSION_V2
} from "@/lib/services/student-assessment/turn-evidence-cross-artifact-consistency";

export const PRE_TUTOR_PROFILE_FINALIZATION_VERSION_V3 =
  "pre-tutor-profile-finalization-v3" as const;

export const PreTutorProfileFinalizationAttestationV3Schema = z.object({
  finalization_version: z.literal(PRE_TUTOR_PROFILE_FINALIZATION_VERSION_V3),
  source_student_turn_id: z.string().min(1),
  source_sequence_index: z.number().int().positive(),
  evaluator_version: z.literal(PRODUCTION_TURN_EVIDENCE_EVALUATOR_VERSION_V5),
  profile_mapper_version: z.literal(TURN_EVIDENCE_PROFILE_MAPPER_VERSION_V6),
  profile_consistency_version: z.literal(
    PROFILE_CONSISTENCY_POLICY_VERSION_V6
  ),
  turn_observation_version: z.literal(TURN_EVIDENCE_OBSERVATION_VERSION),
  profile_update_contract_version: z.literal(
    LEARNING_PROFILE_UPDATE_DISPOSITION_VERSION
  ),
  cross_artifact_consistency_version: z.literal(
    TURN_EVIDENCE_CROSS_ARTIFACT_CONSISTENCY_VERSION_V2
  ),
  nonconceptual_preservation_version: z.literal(
    NONCONCEPTUAL_PROFILE_PRESERVATION_VERSION
  ),
  mixed_intent_retention_version: z.literal(
    MIXED_INTENT_EVIDENCE_RETENTION_VERSION
  ),
  evaluator_schema_valid: z.literal(true),
  target_contract_applied: z.literal(true),
  turn_observation_constructed: z.literal(true),
  profile_update_disposition_applied: z.literal(true),
  cross_artifact_consistency_passed: z.literal(true),
  profile_consistency_passed: z.literal(true),
  cumulative_profile_updated: z.literal(true),
  sound_gate_executed: z.literal(true),
  platform_mode_finalized: z.literal(true),
  latest_turn_freshness_passed: z.literal(true),
  tutor_dispatch_permitted: z.boolean(),
  execution_order: z.tuple([
    z.literal("student_response_persisted"),
    z.literal("visible_history_reconstructed"),
    z.literal("evaluator_request_dispatched"),
    z.literal("evaluator_output_validated"),
    z.literal("conceptual_observation_normalized"),
    z.literal("conceptual_evidence_applicability_classified"),
    z.literal("profile_update_disposition_selected"),
    z.literal("turn_observation_constructed"),
    z.literal("turn_profile_constructed"),
    z.literal("cumulative_profile_updated"),
    z.literal("profile_update_record_constructed"),
    z.literal("semantic_layers_reconciled"),
    z.literal("sound_gate_executed"),
    z.literal("platform_mode_finalized"),
    z.literal("profile_freshness_verified")
  ])
}).strict();
export type PreTutorProfileFinalizationAttestationV3 = z.infer<
  typeof PreTutorProfileFinalizationAttestationV3Schema
>;
