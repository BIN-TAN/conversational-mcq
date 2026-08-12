import type { Prisma, StudentProfile } from "@prisma/client";
import {
  canonicalFormativeConversationProfileFromStudentProfile,
  canonicalFormativeConversationProfileStateFromStudentProfile,
  parseFormativeConversationProfileSnapshot
} from "./profile-update";
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

export function isCanonicalPersistedFormativeConversationProfileTransition(
  transition: CanonicallyValidatablePersistedProfileTransition
) {
  if (transition.learning_outcome === null) {
    return false;
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
