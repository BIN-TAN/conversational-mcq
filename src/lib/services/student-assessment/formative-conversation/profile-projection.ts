export type PersistedFormativeConversationOutcome =
  | "sound"
  | "largely_improved"
  | "teacher_assistance_recommended";

type PersistedProfileTransition = {
  transition_public_id: string;
  learning_outcome: PersistedFormativeConversationOutcome | null;
  transitioned_at: Date;
};

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
