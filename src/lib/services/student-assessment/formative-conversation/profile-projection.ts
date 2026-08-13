import type { Prisma, StudentProfile } from "@prisma/client";
import {
  canonicalFormativeConversationProfileFromStudentProfile,
  canonicalFormativeConversationProfileStateFromStudentProfile,
  parseFormativeConversationProfileSnapshot
} from "./profile-update";
import { FormativeConversationV18PersistedProfileSnapshotSchema } from "./agent-contract-v18";
import { validatePersistedFormativeConversationV18Transition } from "./evidence-identity-validator-v18";
import { validatePersistedFormativeConversationProfileTransition } from "./profile-transition-validator";

export type PersistedFormativeConversationOutcome =
  | "sound"
  | "largely_improved"
  | "teacher_assistance_recommended";

type PersistedProfileTransition = {
  transition_public_id: string;
  learning_outcome: PersistedFormativeConversationOutcome | null;
  transitioned_at: Date;
};

export type CanonicallyValidatablePersistedProfileTransition =
  PersistedProfileTransition & {
    prior_student_profile: StudentProfile;
    updated_student_profile: StudentProfile;
    profile_snapshot: Prisma.JsonValue;
    learning_observations: Prisma.JsonValue;
    evidence_interpretation: string | null;
    supporting_turn_references: Array<{
      conversation_turn: {
        sequence_index: number;
        actor_type: string;
      };
    }>;
  };

export function canonicalFormativeConversationV18TransitionProvenance(
  transition: CanonicallyValidatablePersistedProfileTransition
) {
  const parsed = FormativeConversationV18PersistedProfileSnapshotSchema.safeParse(
    transition.profile_snapshot
  );
  if (!parsed.success) {
    return null;
  }
  return {
    prior_profile_evidence_cutoff_sequence_index:
      parsed.data.prior_profile_evidence_cutoff_sequence_index,
    updated_profile_evidence_cutoff_sequence_index:
      parsed.data.profile.evidence_cutoff_sequence_index,
    canonical_evidence_ids: [...parsed.data.canonical_evidence_ids],
    canonical_evidence: parsed.data.canonical_evidence_catalog.evidence
      .filter((entry) =>
        parsed.data.canonical_evidence_ids.includes(entry.evidence_id)
      )
      .map((entry) => ({
        evidence_id: entry.evidence_id,
        evidence_scope_id: entry.evidence_scope_id,
        evidence_kind: entry.evidence_kind,
        evidence_stage: entry.evidence_stage,
        source_role: entry.source_role,
        source_sequence_index: entry.source_sequence_index
      })),
    misconception_claim_provenance:
      parsed.data.profile.misconception_claim_catalog?.indicators.flatMap(
        (indicator) =>
          indicator.claims.map((claim) => ({
            indicator_id: indicator.indicator_id,
            claim_id: claim.claim_id,
            source_evidence_refs: [...claim.source_evidence_refs]
          }))
      ) ?? []
  };
}

export function isCanonicalPersistedFormativeConversationProfileTransition(
  transition: CanonicallyValidatablePersistedProfileTransition
) {
  if (transition.learning_outcome === null) {
    return false;
  }
  const v18Snapshot =
    FormativeConversationV18PersistedProfileSnapshotSchema.safeParse(
      transition.profile_snapshot
    );
  if (v18Snapshot.success) {
    try {
      const priorState =
        canonicalFormativeConversationProfileStateFromStudentProfile(
          transition.prior_student_profile
        );
      const updatedState =
        canonicalFormativeConversationProfileStateFromStudentProfile(
          transition.updated_student_profile
        );
      return validatePersistedFormativeConversationV18Transition({
        prior_profile: priorState.canonical_profile,
        prior_misconception_claim_catalog:
          priorState.misconception_claim_catalog,
        updated_profile: updatedState.canonical_profile,
        updated_misconception_claim_catalog:
          updatedState.misconception_claim_catalog,
        profile_snapshot: v18Snapshot.data,
        learning_outcome: transition.learning_outcome,
        evidence_interpretation: transition.evidence_interpretation,
        supporting_turns: transition.supporting_turn_references.map(
          (reference) => ({
            sequence_index: reference.conversation_turn.sequence_index,
            actor:
              reference.conversation_turn.actor_type === "student"
                ? ("student" as const)
                : ("tutor" as const)
          })
        )
      }).valid;
    } catch {
      return false;
    }
  }
  const snapshot = parseFormativeConversationProfileSnapshot(
    transition.profile_snapshot
  );
  try {
    const priorState = snapshot?.misconception_claim_catalog
      ? canonicalFormativeConversationProfileStateFromStudentProfile(
          transition.prior_student_profile
        )
      : null;
    const updatedState = snapshot?.misconception_claim_catalog
      ? canonicalFormativeConversationProfileStateFromStudentProfile(
          transition.updated_student_profile
        )
      : null;
    return validatePersistedFormativeConversationProfileTransition({
      prior_profile:
        priorState?.canonical_profile ??
        canonicalFormativeConversationProfileFromStudentProfile(
          transition.prior_student_profile
        ),
      prior_misconception_claim_catalog:
        priorState?.misconception_claim_catalog,
      updated_profile:
        updatedState?.canonical_profile ??
        canonicalFormativeConversationProfileFromStudentProfile(
          transition.updated_student_profile
        ),
      updated_misconception_claim_catalog:
        updatedState?.misconception_claim_catalog,
      profile_snapshot: transition.profile_snapshot,
      learning_outcome: transition.learning_outcome,
      learning_observations: transition.learning_observations,
      evidence_interpretation: transition.evidence_interpretation,
      supporting_turns: transition.supporting_turn_references.map(
        (reference) => ({
          sequence_index:
            reference.conversation_turn.sequence_index,
          actor:
            reference.conversation_turn.actor_type === "student"
              ? ("student" as const)
              : ("tutor" as const)
        })
      )
    }).valid;
  } catch {
    return false;
  }
}

export function canonicalPersistedFormativeConversationProfileTransitions<
  Transition extends CanonicallyValidatablePersistedProfileTransition
>(transitions: readonly Transition[]) {
  return transitions.filter((transition) =>
    isCanonicalPersistedFormativeConversationProfileTransition(
      transition
    )
  );
}

export function latestPersistedFormativeConversationProfileTransition<
  Transition extends PersistedProfileTransition
>(transitions: readonly Transition[]): Transition | null {
  return (
    [...transitions].sort((left, right) => {
      const timestampDifference =
        left.transitioned_at.getTime() - right.transitioned_at.getTime();
      return timestampDifference !== 0
        ? timestampDifference
        : left.transition_public_id.localeCompare(
            right.transition_public_id
          );
    }).at(-1) ?? null
  );
}

export function persistedFormativeConversationOutcome(
  transitions: readonly PersistedProfileTransition[]
): PersistedFormativeConversationOutcome | null {
  return (
    latestPersistedFormativeConversationProfileTransition(transitions)
      ?.learning_outcome ?? null
  );
}
