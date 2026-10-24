import { z } from "zod";
import {
  type TopicDialogueTurnEvidenceProfile
} from "@/lib/services/student-assessment/topic-dialogue-evidence-first-routing";
import {
  PreTutorProfileFinalizationAttestationV2Schema,
  type PreTutorProfileFinalizationAttestationV2
} from "@/lib/services/student-assessment/pre-tutor-profile-finalization-v2";
import {
  PreTutorProfileFinalizationAttestationV3Schema,
  type PreTutorProfileFinalizationAttestationV3
} from "@/lib/services/student-assessment/pre-tutor-profile-finalization-v3";
import {
  PreTutorProfileFinalizationAttestationV4Schema,
  type PreTutorProfileFinalizationAttestationV4
} from "@/lib/services/student-assessment/pre-tutor-profile-finalization-v4";

export const PRE_TUTOR_PROFILE_FINALIZATION_VERSION =
  "pre-tutor-profile-finalization-v1" as const;

export const PreTutorProfileFinalizationAttestationSchema = z.object({
  finalization_version: z.literal(PRE_TUTOR_PROFILE_FINALIZATION_VERSION),
  source_student_turn_id: z.string().min(1),
  source_sequence_index: z.number().int().positive(),
  evaluator_schema_valid: z.literal(true),
  target_contract_applied: z.literal(true),
  anchor_interpretation_completed: z.literal(true),
  blocking_conflicts_propagated: z.literal(true),
  profile_constructed: z.literal(true),
  profile_consistency_passed: z.literal(true),
  cumulative_profile_updated: z.literal(true),
  sound_gate_executed: z.literal(true),
  platform_mode_finalized: z.literal(true),
  latest_turn_freshness_passed: z.literal(true),
  tutor_dispatch_permitted: z.boolean()
}).strict();
export type PreTutorProfileFinalizationAttestation = z.infer<
  typeof PreTutorProfileFinalizationAttestationSchema
>;

export class PreTutorProfileFinalizationError extends Error {
  readonly issue_codes: string[];

  constructor(issueCodes: string[]) {
    super(`pre_tutor_profile_finalization_failed:${issueCodes.join("|")}`);
    this.name = "PreTutorProfileFinalizationError";
    this.issue_codes = issueCodes;
  }
}

export function assertTutorDispatchUsesFinalizedProfile(input: {
  profile: TopicDialogueTurnEvidenceProfile | null;
  attestation: PreTutorProfileFinalizationAttestation |
    PreTutorProfileFinalizationAttestationV2 |
    PreTutorProfileFinalizationAttestationV3 |
    PreTutorProfileFinalizationAttestationV4 | null;
  latest_accepted_student_turn_id: string;
  latest_accepted_sequence_index: number;
}) {
  const issues: string[] = [];
  let parsedAttestation: PreTutorProfileFinalizationAttestation |
    PreTutorProfileFinalizationAttestationV2 |
    PreTutorProfileFinalizationAttestationV3 |
    PreTutorProfileFinalizationAttestationV4 | null = null;
  if (!input.profile) issues.push("latest_profile_missing");
  if (!input.attestation) issues.push("finalization_attestation_missing");
  if (input.profile && (
    input.profile.source_student_turn_id !==
      input.latest_accepted_student_turn_id ||
    input.profile.source_sequence_index !==
      input.latest_accepted_sequence_index
  )) issues.push("latest_profile_source_stale");
  if (input.attestation) {
    const parsedV1 = PreTutorProfileFinalizationAttestationSchema.safeParse(
      input.attestation
    );
    const parsedV2 = PreTutorProfileFinalizationAttestationV2Schema.safeParse(
      input.attestation
    );
    const parsedV3 = PreTutorProfileFinalizationAttestationV3Schema.safeParse(
      input.attestation
    );
    const parsedV4 = PreTutorProfileFinalizationAttestationV4Schema.safeParse(
      input.attestation
    );
    if (!parsedV1.success && !parsedV2.success && !parsedV3.success &&
        !parsedV4.success) {
      issues.push("finalization_attestation_invalid");
    }
    const parsed = parsedV1.success ? parsedV1.data : parsedV2.success
      ? parsedV2.data : parsedV3.success ? parsedV3.data : parsedV4.success
        ? parsedV4.data : null;
    parsedAttestation = parsed;
    if (!parsed) {
      // The issue above remains the fail-closed reason.
    } else {
      if (!parsed.profile_consistency_passed) {
        issues.push("profile_consistency_not_passed");
      }
      if (!parsed.platform_mode_finalized) {
        issues.push("platform_mode_not_finalized");
      }
      if (!parsed.tutor_dispatch_permitted) {
        issues.push("tutor_dispatch_not_permitted");
      }
    }
  }
  if (issues.length > 0) throw new PreTutorProfileFinalizationError(issues);
  return {
    finalization_version: parsedAttestation?.finalization_version ??
      PRE_TUTOR_PROFILE_FINALIZATION_VERSION,
    tutor_dispatch_permitted: true as const
  };
}
