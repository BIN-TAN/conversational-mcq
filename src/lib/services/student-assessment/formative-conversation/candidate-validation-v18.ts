import {
  FORMATIVE_CONVERSATION_V18_AGENT_CONTRACT_VERSION,
  FormativeConversationV18AgentOutputSchema,
  type FormativeConversationV18AgentInput,
  type FormativeConversationV18AgentOutput
} from "./agent-contract-v18";
import { validateFormativeConversationV18Transition } from "./evidence-identity-validator-v18";
import {
  hasFormativeConversationOpeningAssessmentAcknowledgement,
  validateFormativeConversationOpeningDisclosureScope
} from "./opening-contract";
import { validateFormativeConversationStudentOutputFormat } from "./output-format";
import { validateFormativeConversationSafetyBoundary } from "./safety-boundary";

export const FORMATIVE_CONVERSATION_V18_CANDIDATE_ACCEPTANCE_VERSION =
  "formative-conversation-v18-candidate-acceptance-v1" as const;

export type FormativeConversationV18CandidateValidation = {
  valid: boolean;
  validation_status:
    | "valid"
    | "schema_invalid"
    | "safety_invalid"
    | "opening_contract_invalid"
    | "formatting_invalid"
    | "semantic_contract_invalid";
  validation_issue_paths: string[];
  output: FormativeConversationV18AgentOutput | null;
};

function isOpeningContext(context: FormativeConversationV18AgentInput) {
  return (
    context.latest_student_message === null &&
    context.visible_transcript.length === 0
  );
}

function invalid(input: {
  status: Exclude<
    FormativeConversationV18CandidateValidation["validation_status"],
    "valid"
  >;
  paths: string[];
  output: FormativeConversationV18AgentOutput | null;
}): FormativeConversationV18CandidateValidation {
  return {
    valid: false,
    validation_status: input.status,
    validation_issue_paths: [...new Set(input.paths)].filter(Boolean).sort(),
    output: input.output
  };
}

export function validateFormativeConversationV18CandidateAcceptance(input: {
  candidate: unknown;
  context: FormativeConversationV18AgentInput;
}): FormativeConversationV18CandidateValidation {
  const parsed = FormativeConversationV18AgentOutputSchema.safeParse(
    input.candidate
  );
  if (!parsed.success) {
    return invalid({
      status: "schema_invalid",
      paths: parsed.error.issues.map((entry) => entry.path.join(".")),
      output: null
    });
  }
  if (
    input.context.contract_version !==
      FORMATIVE_CONVERSATION_V18_AGENT_CONTRACT_VERSION ||
    parsed.data.contract_version !== input.context.contract_version
  ) {
    return invalid({
      status: "schema_invalid",
      paths: ["contract_version"],
      output: parsed.data
    });
  }

  const safety = validateFormativeConversationSafetyBoundary(input.context);
  if (!safety.valid) {
    return invalid({
      status: "safety_invalid",
      paths: safety.issue_codes.map(
        (code) => `context.safety_boundary.${code}`
      ),
      output: parsed.data
    });
  }

  if (isOpeningContext(input.context)) {
    const openingIssues = [
      ...validateFormativeConversationOpeningDisclosureScope(
        parsed.data.student_visible_message
      )
    ];
    if (
      !hasFormativeConversationOpeningAssessmentAcknowledgement(
        parsed.data.student_visible_message
      )
    ) {
      openingIssues.push("opening_assessment_acknowledgement_missing");
    }
    if (parsed.data.evidence_observations.length > 0) {
      openingIssues.push("opening_must_not_create_student_evidence");
    }
    if (parsed.data.profile_transition_recommendation !== null) {
      openingIssues.push("opening_must_not_recommend_profile_transition");
    }
    if (parsed.data.teacher_assistance_recommendation.recommended) {
      openingIssues.push("opening_must_not_recommend_teacher_assistance");
    }
    if (parsed.data.lifecycle_recommendation !== "continue") {
      openingIssues.push("opening_must_continue_conversation");
    }
    if (openingIssues.length > 0) {
      return invalid({
        status: "opening_contract_invalid",
        paths: openingIssues.map(
          (code) => `student_visible_message:${code}`
        ),
        output: parsed.data
      });
    }
  }

  const formatIssues = [
    ...validateFormativeConversationStudentOutputFormat(
      parsed.data.student_visible_message
    ),
    ...(parsed.data.teaching_artifact
      ? validateFormativeConversationStudentOutputFormat(
          parsed.data.teaching_artifact.student_visible_content,
          "teaching_artifact.student_visible_content"
        )
      : [])
  ];
  if (formatIssues.length > 0) {
    return invalid({
      status: "formatting_invalid",
      paths: formatIssues.map(
        (entry) => `${entry.field_path}:${entry.code}`
      ),
      output: parsed.data
    });
  }

  const transition = validateFormativeConversationV18Transition({
    conversation_public_id: input.context.conversation_public_id,
    prior_profile_evidence_cutoff_sequence_index:
      input.context.current_profile.evidence_cutoff_sequence_index,
    recommendation: parsed.data.profile_transition_recommendation,
    prior_profile: input.context.current_profile.canonical_profile,
    prior_misconception_claim_catalog:
      input.context.allowed_misconception_claim_catalog,
    allowed_evidence_catalog: input.context.allowed_evidence_catalog,
    evidence_observations: parsed.data.evidence_observations
  });
  if (!transition.valid) {
    return invalid({
      status: "semantic_contract_invalid",
      paths: transition.issues.map(
        (entry) => `${entry.field_path}:${entry.code}`
      ),
      output: parsed.data
    });
  }

  return {
    valid: true,
    validation_status: "valid",
    validation_issue_paths: [],
    output:
      transition.terminal && parsed.data.profile_transition_recommendation
        ? {
            ...parsed.data,
            profile_transition_recommendation: {
              ...parsed.data.profile_transition_recommendation,
              updated_profile: transition.updated_profile
            }
          }
        : parsed.data
  };
}
