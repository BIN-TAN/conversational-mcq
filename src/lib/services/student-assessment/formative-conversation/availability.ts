import { LlmConfigurationError } from "@/lib/llm/config";

export const FORMATIVE_CONVERSATION_UNAVAILABLE_CODE =
  "formative_conversation_unavailable" as const;
export const FORMATIVE_CONVERSATION_UNAVAILABLE_MESSAGE =
  "The learning conversation is temporarily unavailable. Please try again.";

export class FormativeConversationUnavailableError extends Error {
  readonly code = FORMATIVE_CONVERSATION_UNAVAILABLE_CODE;

  constructor(
    public readonly reason_code: string,
    public readonly retryable = true
  ) {
    super(FORMATIVE_CONVERSATION_UNAVAILABLE_MESSAGE);
    this.name = "FormativeConversationUnavailableError";
  }
}

export function formativeConversationUnavailableFromConfiguration(
  error: unknown
) {
  if (error instanceof FormativeConversationUnavailableError) {
    return error;
  }
  if (error instanceof LlmConfigurationError) {
    return new FormativeConversationUnavailableError(error.code);
  }
  return null;
}
