import {
  summarizeFormativeConversationV14EvaluationAccounting
} from "../formative-conversation-v5-evaluation-v14/evaluation-accounting";

export const FORMATIVE_CONVERSATION_V16_EVALUATION_ACCOUNTING_VERSION =
  "formative-conversation-v16-evaluation-accounting-v1";

export function summarizeFormativeConversationV16EvaluationAccounting(
  input: Parameters<
    typeof summarizeFormativeConversationV14EvaluationAccounting
  >[0]
) {
  return {
    ...summarizeFormativeConversationV14EvaluationAccounting(input),
    accounting_version:
      FORMATIVE_CONVERSATION_V16_EVALUATION_ACCOUNTING_VERSION
  };
}
