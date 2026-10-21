import { LlmConfigurationError } from "@/lib/llm/config";

export const FORMATIVE_CONVERSATION_UNAVAILABLE_CODE =
  "formative_conversation_unavailable" as const;
export const FORMATIVE_CONVERSATION_UNAVAILABLE_MESSAGE =
  "The tutor is not available right now. Your answers are saved. Please try again in a minute.";

export class FormativeConversationUnavailableError extends Error {
  readonly code = FORMATIVE_CONVERSATION_UNAVAILABLE_CODE;

  constructor(
    public readonly reason_code: string,
    public readonly retryable = true
  ) {
    super(reason_code.endsWith("_limit_exceeded")
      ? "The tutor has reached its usage limit for now. Your answers are saved. Please contact your instructor."
      : FORMATIVE_CONVERSATION_UNAVAILABLE_MESSAGE);
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
