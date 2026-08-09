import { stableHash } from "@/lib/operational/stable-hash";
import {
  compileFormativeConversationV5ExecutionPlan as compileV14ExecutionPlan
} from "../formative-conversation-v5-evaluation-v14/compiler";
import {
  FORMATIVE_CONVERSATION_V5_RUN_OUTPUT_ROOT,
  FormativeConversationV5CompiledPlanSchema,
  type FormativeConversationV5CompiledPlan
} from "./contracts";

type CompilationInput = Parameters<
  typeof compileV14ExecutionPlan
>[0];

export function compileFormativeConversationV5ExecutionPlan(
  input: CompilationInput
) {
  const inherited = compileV14ExecutionPlan(input);
  const hashable = {
    ...inherited,
    intended_output_artifact_locations:
      inherited.intended_output_artifact_locations.map((artifactPath) =>
        artifactPath.replace(
          ".data/operational-formative-conversation-v5-evaluation-v14/runs",
          FORMATIVE_CONVERSATION_V5_RUN_OUTPUT_ROOT
        )
      )
  };
  const { compiled_plan_hash: ignored, ...withoutHash } = hashable;
  void ignored;
  return FormativeConversationV5CompiledPlanSchema.parse({
    ...withoutHash,
    compiled_plan_hash: stableHash(withoutHash)
  });
}

export function assertFormativeConversationV5CompiledPlanHash(
  plan: FormativeConversationV5CompiledPlan
) {
  const { compiled_plan_hash: expected, ...hashable } = plan;
  if (stableHash(hashable) !== expected) {
    throw new Error(
      "formative_conversation_v16_compiled_plan_hash_mismatch"
    );
  }
}

export function assertFormativeConversationV5CompilationParity(input: {
  committed: FormativeConversationV5CompiledPlan;
  compiled: FormativeConversationV5CompiledPlan;
}) {
  assertFormativeConversationV5CompiledPlanHash(input.committed);
  assertFormativeConversationV5CompiledPlanHash(input.compiled);
  if (
    input.committed.compiled_plan_hash !==
      input.compiled.compiled_plan_hash ||
    stableHash(input.committed) !== stableHash(input.compiled)
  ) {
    throw new Error(
      "formative_conversation_v16_plan_live_compilation_mismatch"
    );
  }
}
