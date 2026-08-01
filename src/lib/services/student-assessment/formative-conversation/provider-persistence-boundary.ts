export const FORMATIVE_CONVERSATION_PROVIDER_PERSISTENCE_BOUNDARY_VERSION =
  "formative-conversation-provider-persistence-boundary-v1" as const;

export type FormativeConversationProviderBoundaryEvent =
  | "provider_wait_started"
  | "provider_wait_completed";

export async function executeFormativeConversationProviderOutsidePersistence<
  T
>(input: {
  execute: () => Promise<T>;
  on_boundary_event?: (
    event: FormativeConversationProviderBoundaryEvent
  ) => void;
}) {
  input.on_boundary_event?.("provider_wait_started");
  try {
    return await input.execute();
  } finally {
    input.on_boundary_event?.("provider_wait_completed");
  }
}
