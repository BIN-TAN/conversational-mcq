import {
  createFormativeConversationV5CandidateRunner as createV14CandidateRunner
} from "../formative-conversation-v5-evaluation-v14/candidate-runner";
import type { FormativeConversationV5Package as V14Package } from "../formative-conversation-v5-evaluation-v14/package";
import type { FormativeConversationV5Package } from "./package";

export function createFormativeConversationV5CandidateRunner(input: {
  loaded: FormativeConversationV5Package;
  evaluation_id: string;
  provider?: Parameters<typeof createV14CandidateRunner>[0]["provider"];
  before_first_generation_request: () => Promise<void>;
}) {
  return createV14CandidateRunner({
    ...input,
    loaded: input.loaded as unknown as V14Package
  });
}
