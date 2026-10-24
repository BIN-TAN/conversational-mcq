import { conversationUsesFeedbackV8 } from "../feedback-v8/context";
import { createFeedbackV8Runner } from "../feedback-v8/runner";
import type { FormativeExecutionMode } from "../formative-execution-mode";
import { createLiveFormativeConversationV18R2AgentRunner } from "./live-runner-v18r2";
import type { AnyFormativeConversationAgentRunner, FormativeConversationRuntimeContextSeed } from "./runtime";
import { buildFormativeConversationRuntimeContextSeed } from "./runtime-context";

/**
 * Conversations whose mini-test profile came from interpretation v8 use feedback v8
 * (sections 7-9.6 of the redesign). Conversations that started before the switch keep the
 * runner they started with, so no conversation changes contract midway.
 */
export async function formativeConversationReplyRunnerFactory(
  conversationPublicId: string,
  executionMode: FormativeExecutionMode = "production"
): Promise<() => AnyFormativeConversationAgentRunner> {
  if (await conversationUsesFeedbackV8({ conversation_public_id: conversationPublicId })) {
    return () => createFeedbackV8Runner(executionMode);
  }
  return createLiveFormativeConversationV18R2AgentRunner;
}

/**
 * The seed passed for feedback v8 conversations. Feedback v8 compiles its own context from
 * stored records (compileFeedbackV8Context) and never reads the seed, so nothing in it reaches
 * a provider request or a recorded agent call.
 */
export function feedbackV8PlaceholderRuntimeSeed(): FormativeConversationRuntimeContextSeed {
  const unavailable = {
    profile_version: "feedback-v8-context",
    outcome: "not_yet_determined" as const,
    evidence_summary: [],
    unresolved_evidence: [],
    evidence_limitations: [],
    canonical_profile: null,
    field_evidence: [],
    misconception_claim_catalog: null,
    misconception_claim_dispositions: []
  };
  return {
    assessment_public_id: "feedback-v8",
    concept_unit_public_id: "feedback-v8",
    administered_items: [],
    initial_profile: unavailable,
    current_profile: unavailable
  };
}

/**
 * The legacy context seed. Feedback v8 compiles its own context from stored records and
 * does not read the seed, so a seed that cannot be built never blocks a v8 conversation.
 */
export async function formativeConversationRuntimeSeed(input: {
  conversation_public_id: string;
  student_user_db_id: string;
}): Promise<FormativeConversationRuntimeContextSeed> {
  try {
    return await buildFormativeConversationRuntimeContextSeed(input);
  } catch (error) {
    if (!(await conversationUsesFeedbackV8({ conversation_public_id: input.conversation_public_id }))) throw error;
    return feedbackV8PlaceholderRuntimeSeed();
  }
}

/**
 * The seed and runner for one student reply, deciding the contract once. A feedback v8
 * conversation skips building the legacy seed (it would be discarded) and gets the
 * placeholder; other conversations build the seed exactly as before.
 */
export async function formativeConversationReplyDependencies(input: {
  conversation_public_id: string;
  student_user_db_id: string;
  execution_mode?: FormativeExecutionMode;
}): Promise<{ seed: FormativeConversationRuntimeContextSeed; runner_factory: () => AnyFormativeConversationAgentRunner }> {
  const executionMode = input.execution_mode ?? "production";
  if (await conversationUsesFeedbackV8({ conversation_public_id: input.conversation_public_id })) {
    return { seed: feedbackV8PlaceholderRuntimeSeed(), runner_factory: () => createFeedbackV8Runner(executionMode) };
  }
  return {
    seed: await buildFormativeConversationRuntimeContextSeed({
      conversation_public_id: input.conversation_public_id,
      student_user_db_id: input.student_user_db_id
    }),
    runner_factory: createLiveFormativeConversationV18R2AgentRunner
  };
}
