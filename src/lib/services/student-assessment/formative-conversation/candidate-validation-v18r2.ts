import {
  FORMATIVE_CONVERSATION_V18R2_AGENT_CONTRACT_VERSION,
  FormativeConversationV18R2AgentOutputSchema,
  type FormativeConversationV18R2AgentInput,
  type FormativeConversationV18R2AgentOutput
} from "./agent-contract-v18r2";
import { canonicalEvidenceById } from "@/lib/domain/canonical-evidence-identity";
import { validateFormativeConversationV18Transition } from "./evidence-identity-validator-v18";
import {
  hasFormativeConversationV18R2OpeningAssessmentAcknowledgement,
  validateFormativeConversationOpeningDisclosureScope
} from "./opening-contract";
import { validateFormativeConversationStudentOutputFormat } from "./output-format";
import { validateFormativeConversationSafetyBoundary } from "./safety-boundary";

export const FORMATIVE_CONVERSATION_V18R2_CANDIDATE_ACCEPTANCE_VERSION =
  "formative-conversation-v18r2-candidate-acceptance-v2" as const;

export type FormativeConversationV18R2CandidateValidation = {
  valid: boolean;
  validation_status:
    | "valid"
    | "schema_invalid"
    | "safety_invalid"
    | "opening_contract_invalid"
    | "formatting_invalid"
    | "semantic_contract_invalid";
  validation_issue_paths: string[];
  output: FormativeConversationV18R2AgentOutput | null;
};

function isOpeningContext(context: FormativeConversationV18R2AgentInput) {
  return (
    context.latest_student_message === null &&
    context.visible_transcript.length === 0 &&
    context.formative_lifecycle.student_turn_index === 0
  );
}

function invalid(input: {
  status: Exclude<
    FormativeConversationV18R2CandidateValidation["validation_status"],
    "valid"
  >;
  paths: string[];
  output: FormativeConversationV18R2AgentOutput | null;
}): FormativeConversationV18R2CandidateValidation {
  return {
    valid: false,
    validation_status: input.status,
    validation_issue_paths: [...new Set(input.paths)].filter(Boolean).sort(),
    output: input.output
  };
}

export function validateFormativeConversationV18R2CandidateAcceptance(input: {
  candidate: unknown;
  context: FormativeConversationV18R2AgentInput;
}): FormativeConversationV18R2CandidateValidation {
  const parsed = FormativeConversationV18R2AgentOutputSchema.safeParse(
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
      FORMATIVE_CONVERSATION_V18R2_AGENT_CONTRACT_VERSION ||
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
      !hasFormativeConversationV18R2OpeningAssessmentAcknowledgement(
        parsed.data.student_visible_message
      )
    ) {
      openingIssues.push("opening_assessment_acknowledgement_missing");
    }
    if (parsed.data.outcome !== "continue_conversation") {
      openingIssues.push("opening_must_continue_conversation");
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

  if (
    input.context.formative_lifecycle.final_allowed_turn &&
    parsed.data.outcome === "continue_conversation"
  ) {
    return invalid({
      status: "semantic_contract_invalid",
      paths: [
        "formative_lifecycle.another_student_turn_available:continue_conversation_unavailable_on_final_allowed_turn"
      ],
      output: parsed.data
    });
  }

  const evidenceById = canonicalEvidenceById(
    input.context.allowed_evidence_catalog
  );
  const observationIssues = parsed.data.evidence_observations.flatMap(
    (observation, observationIndex) =>
      observation.evidence_ids.flatMap((evidenceId) => {
        const evidence = evidenceById.get(evidenceId);
        return !evidence
          ? [
              `evidence_observations.${observationIndex}.evidence_ids:observation_evidence_id_unknown`
            ]
          : evidence.source_role !== "student" ||
              evidence.eligibility === "not_eligible" ||
              (evidence.evidence_kind === "formative_student_turn" &&
                evidence.conversation_public_id !==
                  input.context.conversation_public_id)
            ? [
                `evidence_observations.${observationIndex}.evidence_ids:observation_evidence_ineligible`
              ]
            : [];
      })
  );
  if (observationIssues.length > 0) {
    return invalid({
      status: "semantic_contract_invalid",
      paths: observationIssues,
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
