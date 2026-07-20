import type {
  E2ASimulatorValidationIssue,
  LlmStudentSimulatorInput,
  LlmStudentSimulatorOutput,
  SimulatorEvidenceLevel
} from "./e2a-schemas";
import {
  type E2A18ConceptualAnchor,
  classifyStudentEvidenceV2,
  validateLlmStudentSimulatorOutputV2
} from "./e2a18-student-simulator-contract-v2";

export const E2A20A_SIMULATOR_EVIDENCE_CLASSIFIER_VERSION =
  "student-simulator-evidence-classifier-v3" as const;

type FeatureContract = {
  relationship: RegExp[];
  mechanism: RegExp[];
  application: RegExp[];
};

const featureContracts: Record<E2A18ConceptualAnchor, FeatureContract> = {
  theta_information: {
    relationship: [
      /clos(?:e|er|est)[^.!?]{0,100}\b(?:theta|ability)\b[^.!?]{0,120}\b(?:difficulty|item)\b/iu,
      /\b(?:theta|ability)\b[^.!?]{0,100}\b(?:close|near|match|align|around)\w*\b[^.!?]{0,100}\b(?:difficulty|item)\b/iu,
      /\b(?:difficulty|item location)\b[^.!?]{0,100}\b(?:close|near|match|align|around)\w*\b[^.!?]{0,100}\b(?:theta|ability)\b/iu
    ],
    mechanism: [
      /\b(?:response|answer)[^.!?]{0,80}\b(?:less|more) predictable\b/iu,
      /\b(?:uncertain|uncertainty|predictable|prediction)\b[^.!?]{0,120}\b(?:information|informative|distinguish|differentiat)\w*\b/iu,
      /\b(?:distinguish|differentiat)\w*\b[^.!?]{0,120}\b(?:predictable|uncertain|uncertainty|information)\b/iu,
      /\b(?:far above|far below|far from|away from|outside)\b[^.!?]{0,140}\b(?:less information|less informative|more predictable|distinguish less)\b/iu
    ],
    application: [
      /\boption a\b[^.!?]{0,160}\b(?:every|all|any)\b[^.!?]{0,50}\b(?:ability|theta|examinee|student)\w*\b[^.!?]{0,80}\b(?:broad|wrong|incorrect|overstat|cannot|does not)\w*\b/iu,
      /\b(?:every|all|any)\b[^.!?]{0,60}\b(?:ability|theta|examinee|student)\w*\b[^.!?]{0,100}\b(?:too broad|not true|incorrect|cannot)\b/iu,
      /\b(?:hardest|most difficult|difficulty alone)\b[^.!?]{0,120}\b(?:not|cannot|does not)\b[^.!?]{0,100}\b(?:everyone|every theta|all ability|informative)\b/iu,
      /\b(?:far above|far below|far from|away from)\b[^.!?]{0,160}\b(?:less information|less informative|more predictable|distinguish less)\b/iu
    ]
  },
  reliability_validity: {
    relationship: [
      /\b(?:reliab\w*|internal consistency|dependab\w*)\b[^.!?]{0,120}\b(?:consistent|consistency|repeatable|precision|stable)\w*\b/iu
    ],
    mechanism: [
      /\b(?:validity|interpretation|construct|intended meaning|purpose)\b[^.!?]{0,120}\b(?:separate|different|additional|evidence|question|claim)\w*\b/iu,
      /\b(?:consistent|repeatable|precise)\w*\b[^.!?]{0,120}\b(?:wrong construct|wrong thing|not the intended|misinterpret)\w*\b/iu
    ],
    application: [
      /\b(?:does not|cannot|is not enough|alone cannot|doesn't)\b[^.!?]{0,100}\b(?:prove|establish|guarantee|show)\w*\b[^.!?]{0,80}\b(?:validity|valid|interpretation)\b/iu,
      /\b(?:option|claim)\b[^.!?]{0,100}\b(?:too strong|overstat|incorrect|wrong)\w*\b/iu
    ]
  },
  correlation_causation: {
    relationship: [
      /\b(?:correlat\w*|association|mov(?:e|ing) together|co-vary)\b[^.!?]{0,140}\b(?:caus\w*|cause|produc\w* the other)\b/iu
    ],
    mechanism: [
      /\b(?:third variable|confound\w*|reverse caus\w*|reverse direction|common cause|shared influence|selection)\b/iu
    ],
    application: [
      /\b(?:does not|cannot|doesn't|is not enough to)\b[^.!?]{0,100}\b(?:prove|establish|show|mean)\w*\b[^.!?]{0,60}\b(?:caus\w*|cause)\b/iu,
      /\b(?:option|claim)\b[^.!?]{0,120}\b(?:too strong|overstat|incorrect|wrong|not supported)\w*\b/iu
    ]
  },
  p_value_interpretation: {
    relationship: [
      /\b(?:p[ -]?value|this number)\b[^.!?]{0,180}\b(?:assuming|under|if)\b[^.!?]{0,80}\b(?:null|no-effect model|model)\b/iu
    ],
    mechanism: [
      /\b(?:data|result|statistic|outcome)\w*\b[^.!?]{0,120}\b(?:unusual|extreme|compatible|surprising|likely)\w*\b/iu,
      /\b(?:unusual|extreme|compatible|surprising)\w*\b[^.!?]{0,120}\b(?:data|result|statistic|outcome)\w*\b/iu
    ],
    application: [
      /\b(?:not|does not|cannot|doesn't)\b[^.!?]{0,100}\b(?:probability|chance)\b[^.!?]{0,80}\b(?:null|hypothesis|no-effect claim)\b[^.!?]{0,40}\b(?:true|correct)\b/iu,
      /\b(?:option|claim)\b[^.!?]{0,100}\b(?:too strong|overstat|incorrect|wrong)\w*\b/iu
    ]
  },
  measurement_invariance: {
    relationship: [
      /\b(?:items?|questions?)\b[^.!?]{0,100}\b(?:parameter|function|behav|response|work)\w*\b[^.!?]{0,140}\b(?:group|population)\w*\b/iu,
      /\b(?:group|population)\w*\b[^.!?]{0,140}\b(?:items?|questions?)\b[^.!?]{0,100}\b(?:parameter|function|behav|response|work)\w*\b/iu
    ],
    mechanism: [
      /\b(?:same construct|same trait|same level|comparable|comparison|meaning)\b[^.!?]{0,140}\b(?:item|response|score|group)\w*\b/iu,
      /\b(?:same trait|same construct)\b[^.!?]{0,100}\b(?:across|between)\b[^.!?]{0,40}\bgroups?\b/iu,
      /\b(?:items?|questions?)\b[^.!?]{0,100}\b(?:behave|work)\w*\b[^.!?]{0,100}\b(?:same way|comparably)\b[^.!?]{0,100}\b(?:same trait|same construct|same level)\b/iu,
      /\b(?:item|question)\s+responses?\b[^.!?]{0,100}\b(?:differ|behave differently|work differently)\w*\b[^.!?]{0,100}\bgroups?\b[^.!?]{0,100}\b(?:same trait|same construct|same level)\b/iu
    ],
    application: [
      /\b(?:mean|average)\w*\b[^.!?]{0,120}\b(?:does not|cannot|is not enough|doesn't)\b[^.!?]{0,100}\b(?:prove|establish|guarantee|show|settle)\w*\b[^.!?]{0,60}\b(?:invariance|equivalent|same)\b/iu,
      /\b(?:option|claim)\b[^.!?]{0,100}\b(?:too strong|overstat|incorrect|wrong)\w*\b/iu
    ]
  },
  standard_error_information: {
    relationship: [
      /\b(?:more|greater|higher)\b[^.!?]{0,40}\binformation\b[^.!?]{0,120}\b(?:standard error|uncertainty|precision)\b/iu,
      /\b(?:standard error|uncertainty|precision)\b[^.!?]{0,120}\b(?:more|greater|higher)\b[^.!?]{0,40}\binformation\b/iu,
      /\b(?:test|item|assessment)\b[^.!?]{0,80}\b(?:tells|shows|provides)\b[^.!?]{0,30}\bmore\b[^.!?]{0,120}\b(?:estimate|uncertainty|precision|error)\b/iu
    ],
    mechanism: [
      /\b(?:tighter|narrower|smaller|lower|less|shrinks?)\b[^.!?]{0,80}\b(?:standard error|uncertainty|range)\b|\b(?:standard error|uncertainty|range)\b[^.!?]{0,60}\b(?:shrinks?|narrows?|decreases?)\b/iu,
      /\b(?:more precise|greater precision|estimate more precisely)\b/iu
    ],
    application: [
      /\b(?:does not|cannot|doesn't|rather than)\b[^.!?]{0,100}\b(?:larger|higher|more)\b[^.!?]{0,40}\b(?:standard error|uncertainty)\b/iu,
      /\b(?:option|claim)\b[^.!?]{0,120}\b(?:too strong|overstat|incorrect|wrong|backwards|reversed)\w*\b/iu
    ]
  }
};

function matchesAny(message: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(message));
}

function exactSupportingSentences(message: string, contract: FeatureContract) {
  const patterns = [
    ...contract.relationship,
    ...contract.mechanism,
    ...contract.application
  ];
  return message.split(/(?<=[.!?])\s+/u)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0 && matchesAny(sentence, patterns))
    .map((span, index) => ({
      label: `paraphrased_anchor_specific_reasoning_${index + 1}`,
      span
    }));
}

function evidenceIssue(): E2ASimulatorValidationIssue {
  return {
    rule_code: "evidence_level_exceeded",
    field_path: "student_message",
    safe_detail:
      "Observable student language contains a span above the platform-owned evidence ceiling."
  };
}

const evidenceRank: Record<SimulatorEvidenceLevel, number> = {
  none: 0,
  minimal: 1,
  partial: 2,
  substantive: 3
};

export function classifyStudentEvidenceV3(input: {
  message: string;
  conceptual_anchor: E2A18ConceptualAnchor;
}) {
  const message = input.message.trim();
  const v2 = classifyStudentEvidenceV2(input);
  if (v2.observed_level === "substantive") {
    return {
      ...v2,
      classifier_version: E2A20A_SIMULATOR_EVIDENCE_CLASSIFIER_VERSION,
      rationale_codes: [...v2.rationale_codes, "v2_substantive_preserved"]
    };
  }

  const repetitionCue =
    /\b(?:you said|the tutor said|i am repeating|that sentence says)\b/iu.test(
      message
    );
  const tentativeCue =
    /\b(?:maybe|might|i think|i guess|perhaps|not sure|could be|cannot explain|can't explain|do not know|don't know|unsure)\b/iu.test(
      message
    );
  const contract = featureContracts[input.conceptual_anchor];
  const relationshipObserved = matchesAny(message, contract.relationship);
  const mechanismObserved = matchesAny(message, contract.mechanism);
  const applicationObserved = matchesAny(message, contract.application);
  const completeParaphrasedReasoning = relationshipObserved &&
    mechanismObserved && applicationObserved && !repetitionCue && !tentativeCue;

  if (completeParaphrasedReasoning) {
    const spans = exactSupportingSentences(message, contract);
    return {
      classifier_version: E2A20A_SIMULATOR_EVIDENCE_CLASSIFIER_VERSION,
      observed_level: "substantive" as const,
      exact_evidence_spans: spans.length > 0 ? spans : [{
        label: "paraphrased_anchor_specific_reasoning",
        span: message
      }],
      rationale_codes: [
        "complete_paraphrased_anchor_relationship_observed",
        "explanatory_mechanism_observed",
        "active_boundary_application_observed"
      ],
      ambiguous: false
    };
  }

  return {
    ...v2,
    classifier_version: E2A20A_SIMULATOR_EVIDENCE_CLASSIFIER_VERSION,
    rationale_codes: [
      ...v2.rationale_codes,
      ...(relationshipObserved ? ["paraphrased_relationship_observed"] : []),
      ...(mechanismObserved ? ["paraphrased_mechanism_observed"] : []),
      ...(applicationObserved ? ["paraphrased_application_observed"] : []),
      ...(repetitionCue ? ["explicit_repetition_blocks_promotion"] : []),
      ...(tentativeCue ? ["tentative_or_incomplete_language_blocks_promotion"] : [])
    ]
  };
}

export function validateLlmStudentSimulatorOutputV3(input: {
  simulator_input: LlmStudentSimulatorInput;
  output: LlmStudentSimulatorOutput;
  conceptual_anchor: E2A18ConceptualAnchor;
  previous_student_messages?: string[];
}) {
  const v2Validation = validateLlmStudentSimulatorOutputV2(input);
  const nonEvidenceIssues = v2Validation.issues.filter((finding) =>
    finding.rule_code !== "evidence_level_exceeded"
  );
  const classification = classifyStudentEvidenceV3({
    message: input.output.student_message,
    conceptual_anchor: input.conceptual_anchor
  });
  const ceiling = input.simulator_input.permitted_response
    .substantive_evidence_level;
  const exceeded = evidenceRank[classification.observed_level] >
    evidenceRank[ceiling];
  const groundedExceeded = exceeded &&
    classification.exact_evidence_spans.length > 0;
  const issues = groundedExceeded
    ? [...nonEvidenceIssues, evidenceIssue()]
    : nonEvidenceIssues;
  return {
    valid: issues.length === 0,
    issues,
    output: v2Validation.output,
    evidence_adjudication: {
      contract_version: "e2a20a-student-simulator-contract-v3",
      classifier_version: E2A20A_SIMULATOR_EVIDENCE_CLASSIFIER_VERSION,
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
