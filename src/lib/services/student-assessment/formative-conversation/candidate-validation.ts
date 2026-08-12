import {
  FORMATIVE_CONVERSATION_AGENT_CONTRACT_VERSION,
  FORMATIVE_CONVERSATION_PROFILE_RECOMMENDATION_VERSION,
  FormativeConversationAgentOutputSchema,
  type FormativeConversationAgentInput,
  type FormativeConversationAgentOutput
} from "./agent-contract";
import { validateFormativeConversationOpeningOutput } from "./opening-contract";
import { validateFormativeConversationAgentOutputForContext } from "./output-format";
import { validateFormativeConversationSafetyBoundary } from "./safety-boundary";

export const FORMATIVE_CONVERSATION_CANDIDATE_ACCEPTANCE_VERSION =
  "formative-conversation-candidate-acceptance-v1";

export type FormativeConversationCandidateValidation = {
  valid: boolean;
  validation_status:
    | "valid"
    | "schema_invalid"
    | "safety_invalid"
    | "opening_contract_invalid"
    | "output_contract_invalid";
  validation_issue_paths: string[];
  output: FormativeConversationAgentOutput | null;
};

function isOpeningContext(context: FormativeConversationAgentInput) {
  return (
    context.latest_student_message === null &&
    context.visible_transcript.length === 0
  );
}

export function validateFormativeConversationCandidateAcceptance(input: {
  candidate: unknown;
  context: FormativeConversationAgentInput;
}): FormativeConversationCandidateValidation {
  const parsed = FormativeConversationAgentOutputSchema.safeParse(
    input.candidate
  );
  if (!parsed.success) {
    return {
      valid: false,
      validation_status: "schema_invalid",
      validation_issue_paths: parsed.error.issues
        .map((issue) => issue.path.join("."))
        .filter(Boolean)
        .sort(),
      output: null
    };
  }
  if (
    input.context.contract_version ===
      FORMATIVE_CONVERSATION_AGENT_CONTRACT_VERSION &&
    parsed.data.contract_version !==
      FORMATIVE_CONVERSATION_AGENT_CONTRACT_VERSION
  ) {
    return {
      valid: false,
      validation_status: "schema_invalid",
      validation_issue_paths: ["contract_version"],
      output: null
    };
  }
  if (
    input.context.contract_version ===
      FORMATIVE_CONVERSATION_AGENT_CONTRACT_VERSION &&
    parsed.data.profile_transition_recommendation &&
    (parsed.data.profile_transition_recommendation.recommendation_version !==
      FORMATIVE_CONVERSATION_PROFILE_RECOMMENDATION_VERSION ||
      (parsed.data.profile_transition_recommendation.proposed_outcome !==
        "continue_conversation" &&
        parsed.data.profile_transition_recommendation
          .misconception_claim_dispositions == null))
  ) {
    return {
      valid: false,
      validation_status: "schema_invalid",
      validation_issue_paths: [
        parsed.data.profile_transition_recommendation.recommendation_version !==
        FORMATIVE_CONVERSATION_PROFILE_RECOMMENDATION_VERSION
          ? "profile_transition_recommendation.recommendation_version"
          : "profile_transition_recommendation.misconception_claim_dispositions"
      ],
      output: parsed.data
    };
  }

  const safety = validateFormativeConversationSafetyBoundary(input.context);
  if (!safety.valid) {
    return {
      valid: false,
      validation_status: "safety_invalid",
      validation_issue_paths: safety.issue_codes.map(
        (code) => `context.safety_boundary.${code}`
      ),
      output: parsed.data
    };
  }

  if (isOpeningContext(input.context)) {
    const opening = validateFormativeConversationOpeningOutput(parsed.data);
    if (!opening.valid) {
      return {
        valid: false,
        validation_status: "opening_contract_invalid",
        validation_issue_paths: opening.issue_codes
          .map((code) => `student_visible_message:${code}`)
          .sort(),
        output: parsed.data
      };
    }
  }

  const outputContract = validateFormativeConversationAgentOutputForContext({
    output: parsed.data,
    context: input.context
  });
  if (!outputContract.valid) {
    return {
      valid: false,
      validation_status: "output_contract_invalid",
      validation_issue_paths: outputContract.issues
        .map((issue) => `${issue.field_path}:${issue.code}`)
        .sort(),
      output: parsed.data
    };
  }

  return {
    valid: true,
    validation_status: "valid",
    validation_issue_paths: [],
    output:
      outputContract.transition.terminal &&
      parsed.data.profile_transition_recommendation
        ? {
            ...parsed.data,
            profile_transition_recommendation: {
              ...parsed.data.profile_transition_recommendation,
              updated_profile:
                outputContract.transition.updated_profile
            }
          }
        : parsed.data
  };
}
