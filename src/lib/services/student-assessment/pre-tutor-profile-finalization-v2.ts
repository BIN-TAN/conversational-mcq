import { z } from "zod";
import {
  TURN_EVIDENCE_CROSS_ARTIFACT_CONSISTENCY_VERSION
} from "@/lib/services/student-assessment/turn-evidence-cross-artifact-consistency";

export const PRE_TUTOR_PROFILE_FINALIZATION_VERSION_V2 =
  "pre-tutor-profile-finalization-v2" as const;

export const PreTutorProfileFinalizationAttestationV2Schema = z.object({
  finalization_version: z.literal(PRE_TUTOR_PROFILE_FINALIZATION_VERSION_V2),
  source_student_turn_id: z.string().min(1),
  source_sequence_index: z.number().int().positive(),
  evaluator_schema_valid: z.literal(true),
  target_contract_applied: z.literal(true),
  anchor_aliases_applied: z.literal(true),
  anchor_interpretation_completed: z.literal(true),
  blocking_conflicts_propagated: z.literal(true),
  profile_constructed: z.literal(true),
  cross_artifact_consistency_version: z.literal(
    TURN_EVIDENCE_CROSS_ARTIFACT_CONSISTENCY_VERSION
  ),
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
    z.literal("structured_fields_normalized"),
    z.literal("anchor_aliases_applied"),
    z.literal("anchor_application_and_stance_finalized"),
    z.literal("conflicts_propagated"),
    z.literal("turn_profile_constructed"),
    z.literal("authoritative_views_reconciled"),
    z.literal("profile_consistency_validated"),
    z.literal("cumulative_profile_updated"),
    z.literal("sound_gate_executed"),
    z.literal("platform_mode_finalized"),
    z.literal("profile_freshness_verified")
  ])
}).strict();
export type PreTutorProfileFinalizationAttestationV2 = z.infer<
  typeof PreTutorProfileFinalizationAttestationV2Schema
>;
