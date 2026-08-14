import {
  FORMATIVE_CONVERSATION_V18R2_AGENT_CONTRACT_VERSION,
  FORMATIVE_CONVERSATION_V18R2_CONTEXT_VERSION,
  FormativeConversationV18R2AgentInputSchema,
  type FormativeConversationV18R2AgentInput
} from "./agent-contract-v18r2";
import {
  FORMATIVE_CONVERSATION_V18R2_MAX_STUDENT_TURNS,
  formativeConversationV18R2LifecycleForTurnCount
} from "./lifecycle-contract-v18r2";
import {
  compileFormativeConversationV18Context,
  compilePersistedFormativeConversationV18Context
} from "./context-v18";
import type { FormativeConversationRuntimeContextSeed } from "./runtime";
import { validateFormativeConversationSafetyBoundary } from "./safety-boundary";

export function formativeConversationV18R2LifecycleFromTranscript(
  transcript: readonly { actor: "student" | "tutor" }[]
) {
  const studentTurnIndex = transcript.filter(
    (turn) => turn.actor === "student"
  ).length;
  if (studentTurnIndex > FORMATIVE_CONVERSATION_V18R2_MAX_STUDENT_TURNS) {
    throw new Error("formative_conversation_v18r2_student_turn_limit_exceeded");
  }
  return formativeConversationV18R2LifecycleForTurnCount(studentTurnIndex);
}

function v18R2Context(
  source: ReturnType<typeof compileFormativeConversationV18Context>["context"]
) {
  const parsed = FormativeConversationV18R2AgentInputSchema.parse({
    ...source,
    contract_version: FORMATIVE_CONVERSATION_V18R2_AGENT_CONTRACT_VERSION,
    context_version: FORMATIVE_CONVERSATION_V18R2_CONTEXT_VERSION,
    formative_lifecycle: formativeConversationV18R2LifecycleFromTranscript(
      source.visible_transcript
    )
  });
  const safety = validateFormativeConversationSafetyBoundary(parsed);
  if (!safety.valid) {
    throw new Error(
      `formative_conversation_v18r2_context_unsafe:${safety.issue_codes.join(",")}`
    );
  }
  return { context: parsed, safety };
}

export function compileFormativeConversationV18R2Context(
  input: Parameters<typeof compileFormativeConversationV18Context>[0]
) {
  return v18R2Context(compileFormativeConversationV18Context(input).context);
}

export async function compilePersistedFormativeConversationV18R2Context(
  input: FormativeConversationRuntimeContextSeed & {
    conversation_public_id: string;
  }
): Promise<{
  context: FormativeConversationV18R2AgentInput;
  safety: ReturnType<typeof validateFormativeConversationSafetyBoundary>;
}> {
  const v18 = await compilePersistedFormativeConversationV18Context(input);
  return v18R2Context(v18.context);
}
