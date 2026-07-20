import type {
  E2ASimulatorValidationIssue,
  LlmStudentSimulatorInput,
  LlmStudentSimulatorOutput,
  SimulatorEvidenceLevel
} from "./e2a-schemas";
import type {
  E2A18ConceptualAnchor
} from "./e2a18-student-simulator-contract-v2";
import {
  classifyStudentEvidenceV3,
  validateLlmStudentSimulatorOutputV3
} from "./e2a20a-student-simulator-evidence-classifier-v3";

export const E2A23A_SIMULATOR_EVIDENCE_CLASSIFIER_VERSION =
  "student-simulator-evidence-classifier-v4" as const;

const rank: Record<SimulatorEvidenceLevel, number> = {
  none: 0,
  minimal: 1,
  partial: 2,
  substantive: 3
};

function sentences(message: string) {
  return message.split(/(?<=[.!?])\s+/u)
    .map((value) => value.trim())
    .filter(Boolean);
}

function thetaInformationEvidence(message: string) {
  const relationship = [
    /\b(?:theta|ability)\b[^.!?]{0,100}\b(?:near|close|closer|match|far|above|below)\w*\b[^.!?]{0,120}\bdifficult\w*\b/iu,
    /\bnear\b[^.!?]{0,60}\btheta\b[^.!?]{0,30}\bdifficult\w*\b[^.!?]{0,140}\b(?:information|distinguish)\w*\b/iu,
    /\bdifficult\w*\b[^.!?]{0,120}\b(?:near|close|correspondingly high|far)\b[^.!?]{0,100}\btheta\b/iu,
    /\b(?:highest|most) information\b[^.!?]{0,100}\bnear\b[^.!?]{0,100}\btheta\b/iu
  ].some((pattern) => pattern.test(message));
  const mechanism = [
    /\b(?:chance|probability)\b[^.!?]{0,120}\bchange\w*\b[^.!?]{0,120}\b(?:distinguish|information)\w*\b/iu,
    /\bresponse\w*\b[^.!?]{0,100}\b(?:predictable|certain|uncertain)\w*\b[^.!?]{0,120}\b(?:information|distinguish)\w*\b/iu,
    /\b(?:predictable|certain|uncertain)\w*\b[^.!?]{0,120}\b(?:less information|distinguish|information)\w*\b/iu
  ].some((pattern) => pattern.test(message));
  const application = [
    /\boption\s+a\b[^.!?]{0,100}\b(?:wrong|false|not|isn|claim)\w*\b/iu,
    /\b(?:wrong|false|not equally|does not|isn)\w*\b[^.!?]{0,140}\boption\s+a\b/iu,
    /\b(?:everywhere|every theta|every ability)\b[^.!?]{0,120}\b(?:wrong|false|not|does not|isn)\w*\b/iu
  ].some((pattern) => pattern.test(message));
  const tentative =
    /\b(?:maybe|might|i think|i guess|perhaps|not sure|unsure|cannot explain|can't explain|don't know)\b/iu
      .test(message);
  const copied =
    /\b(?:you said|the tutor said|i am repeating|that sentence says)\b/iu
      .test(message);
  return { relationship, mechanism, application, tentative, copied };
}

export function classifyStudentEvidenceV4(input: {
  message: string;
  conceptual_anchor: E2A18ConceptualAnchor;
}) {
  const prior = classifyStudentEvidenceV3(input);
  if (prior.observed_level === "substantive" ||
      input.conceptual_anchor !== "theta_information") {
    return {
      ...prior,
      classifier_version: E2A23A_SIMULATOR_EVIDENCE_CLASSIFIER_VERSION,
      rationale_codes: [
        ...prior.rationale_codes,
        prior.observed_level === "substantive"
          ? "v3_substantive_preserved"
          : "v3_non_theta_classification_preserved"
      ]
    };
  }
  const features = thetaInformationEvidence(input.message);
  if (features.relationship && features.mechanism && features.application &&
      !features.tentative && !features.copied) {
    return {
      classifier_version: E2A23A_SIMULATOR_EVIDENCE_CLASSIFIER_VERSION,
      observed_level: "substantive" as const,
      exact_evidence_spans: sentences(input.message).map((span, index) => ({
        label: `v4_complete_anchor_reasoning_${index + 1}`,
        span
      })),
      rationale_codes: [
        "complete_paraphrased_anchor_relationship_observed",
        "explanatory_probability_or_predictability_mechanism_observed",
        "direct_active_distractor_application_observed",
        "v4_theta_paraphrase_reconciliation"
      ],
      ambiguous: false
    };
  }
  return {
    ...prior,
    classifier_version: E2A23A_SIMULATOR_EVIDENCE_CLASSIFIER_VERSION,
    rationale_codes: [
      ...prior.rationale_codes,
      ...(features.relationship ? ["v4_relationship_observed"] : []),
      ...(features.mechanism ? ["v4_mechanism_observed"] : []),
      ...(features.application ? ["v4_application_observed"] : []),
      ...(features.tentative ? ["v4_tentative_language_blocks_promotion"] : []),
      ...(features.copied ? ["v4_copied_language_blocks_promotion"] : [])
    ]
  };
}

function evidenceIssue(): E2ASimulatorValidationIssue {
  return {
    rule_code: "evidence_level_exceeded",
    field_path: "student_message",
    safe_detail:
      "Observable student language contains a span above the platform-owned evidence ceiling."
  };
}

export function validateLlmStudentSimulatorOutputV4(input: {
  simulator_input: LlmStudentSimulatorInput;
  output: LlmStudentSimulatorOutput;
  conceptual_anchor: E2A18ConceptualAnchor;
  previous_student_messages?: string[];
}) {
  const prior = validateLlmStudentSimulatorOutputV3(input);
  const nonEvidenceIssues = prior.issues.filter((finding) =>
    finding.rule_code !== "evidence_level_exceeded"
  );
  const classification = classifyStudentEvidenceV4({
    message: input.output.student_message,
    conceptual_anchor: input.conceptual_anchor
  });
  const ceiling = input.simulator_input.permitted_response
    .substantive_evidence_level;
  const exceeded = rank[classification.observed_level] > rank[ceiling];
  const groundedExceeded = exceeded &&
    classification.exact_evidence_spans.length > 0;
  const issues = groundedExceeded
    ? [...nonEvidenceIssues, evidenceIssue()]
    : nonEvidenceIssues;
  return {
    valid: issues.length === 0,
    issues,
    output: prior.output,
    evidence_adjudication: {
      contract_version: "e2a23a-student-simulator-contract-v4",
      classifier_version: E2A23A_SIMULATOR_EVIDENCE_CLASSIFIER_VERSION,
      authorized_ceiling: ceiling,
      provider_self_reported_level: input.output.expressed_evidence_level,
      provider_self_report_controls_decision: false,
      observed_level: classification.observed_level,
      exact_evidence_spans: classification.exact_evidence_spans,
      rationale_codes: classification.rationale_codes,
      ambiguous: classification.ambiguous,
      above_ceiling: exceeded,
      above_ceiling_decision_grounded_by_exact_span: groundedExceeded,
      accepted: !groundedExceeded
    }
  };
}
