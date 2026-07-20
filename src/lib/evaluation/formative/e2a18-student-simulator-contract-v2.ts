import type {
  E2ASimulatorValidationIssue,
  LlmStudentSimulatorInput,
  LlmStudentSimulatorOutput,
  SimulatorEvidenceLevel
} from "./e2a-schemas";
import { validateLlmStudentSimulatorOutput } from
  "./llm-student-simulator-validation";
import { LLM_STUDENT_SIMULATOR_INSTRUCTIONS } from
  "./llm-student-simulator-prompt";

export const E2A18_SIMULATOR_CONTRACT_VERSION =
  "e2a18-student-simulator-contract-v2" as const;
export const E2A18_SIMULATOR_EVIDENCE_CLASSIFIER_VERSION =
  "student-simulator-evidence-classifier-v2" as const;
export const E2A18_SIMULATOR_PROMPT_VERSION =
  "llm-student-surface-realization-v1" as const;
export const E2A18_SIMULATOR_SCHEMA_VERSION =
  "llm-student-simulator-output-v1" as const;
export const E2A18_SIMULATOR_INSTRUCTIONS =
  LLM_STUDENT_SIMULATOR_INSTRUCTIONS;

export const E2A18_EVIDENCE_LEVELS = [
  {
    name: "none",
    observable_student_language_characteristics:
      "No observable content about the active item, concept, or task.",
    allowed_conceptual_content: "No conceptual claim is required.",
    prohibited_conceptual_content:
      "No level-specific prohibition; other safety and scope rules still apply.",
    relationship_to_hidden_misconception:
      "The message neither preserves nor resolves the misconception in observable language.",
    uncertainty_required: false,
    anchor_specific_evidence_allowed: false,
    correct_reasoning_allowed: false,
    revision_readiness_allowed: false,
    transition_to_higher_level:
      "A topical term, choice, question, or claim becomes observable."
  },
  {
    name: "minimal",
    observable_student_language_characteristics:
      "A topical choice, term, short question, or unsupported claim is present without a reason.",
    allowed_conceptual_content:
      "Topic recognition, option reference, uncertainty, or an unsupported conclusion.",
    prohibited_conceptual_content:
      "No anchor-specific distinction or causal relationship that demonstrates reasoning.",
    relationship_to_hidden_misconception:
      "The misconception may be named or implied but is not explained or repaired.",
    uncertainty_required: false,
    anchor_specific_evidence_allowed: false,
    correct_reasoning_allowed: false,
    revision_readiness_allowed: false,
    transition_to_higher_level:
      "A relevant reason, misconception rationale, or incomplete conceptual distinction becomes observable."
  },
  {
    name: "partial",
    observable_student_language_characteristics:
      "A relevant reason, misconception rationale, tentative distinction, or incomplete conceptual link is present.",
    allowed_conceptual_content:
      "Incorrect reasoning, incomplete correct reasoning, tentative boundaries, and repeated tutor wording without independent application.",
    prohibited_conceptual_content:
      "A complete correct causal boundary independently applied to the active anchor.",
    relationship_to_hidden_misconception:
      "The misconception can persist explicitly or can be weakened without being fully resolved.",
    uncertainty_required: false,
    anchor_specific_evidence_allowed: true,
    correct_reasoning_allowed: true,
    revision_readiness_allowed: false,
    transition_to_higher_level:
      "A complete correct relationship, causal explanation, or independent application becomes observable."
  },
  {
    name: "substantive",
    observable_student_language_characteristics:
      "A complete correct conceptual relationship or independent application is stated with an observable supporting span.",
    allowed_conceptual_content:
      "Complete causal or boundary reasoning and revision-ready application to the active anchor.",
    prohibited_conceptual_content:
      "Unsupported mastery claims remain prohibited by separate contract rules.",
    relationship_to_hidden_misconception:
      "The observable reasoning resolves or materially repairs the active misconception.",
    uncertainty_required: false,
    anchor_specific_evidence_allowed: true,
    correct_reasoning_allowed: true,
    revision_readiness_allowed: true,
    transition_to_higher_level:
      "This is the highest simulator evidence level; progression remains platform-owned."
  }
] as const;

export type E2A18ConceptualAnchor =
  | "theta_information"
  | "reliability_validity"
  | "correlation_causation"
  | "p_value_interpretation"
  | "measurement_invariance"
  | "standard_error_information";

type Pattern = {
  label: string;
  expression: RegExp;
};

type AnchorContract = {
  topic_patterns: RegExp[];
  misconception_patterns: Pattern[];
  substantive_patterns: Pattern[];
};

const anchorContracts: Record<E2A18ConceptualAnchor, AnchorContract> = {
  theta_information: {
    topic_patterns: [
      /\btheta\b/iu,
      /\bitem (?:difficulty|information)\b/iu,
      /\b(?:difficult|hard|hardest) item\b/iu,
      /\bability range\b/iu,
      /\boption a\b/iu
    ],
    misconception_patterns: [
      {
        label: "difficulty_implies_information_everywhere",
        expression:
          /(?:difficult|hard)[^.!?]{0,100}(?:information|informative)[^.!?]{0,60}(?:every|all|any)\s+(?:theta|ability)/iu
      },
      {
        label: "hardest_item_always_most_informative",
        expression:
          /(?:hardest|most difficult)[^.!?]{0,80}(?:most|maximum|a lot of)\s+(?:information|informative)/iu
      }
    ],
    substantive_patterns: [
      {
        label: "information_peaks_near_item_location",
        expression:
          /information[^.!?]{0,80}(?:highest|greatest|most)[^.!?]{0,80}(?:near|around|when)[^.!?]{0,80}(?:theta|ability)[^.!?]{0,80}(?:difficulty|item location)|(?:theta|ability)[^.!?]{0,80}(?:near|matches)[^.!?]{0,80}(?:item difficulty|difficulty)[^.!?]{0,80}(?:information|precision)/iu
      },
      {
        label: "information_depends_on_theta_difficulty_distance",
        expression:
          /(?:information|precision)[^.!?]{0,100}depends on[^.!?]{0,80}(?:distance|match|close)[^.!?]{0,80}(?:theta|ability)[^.!?]{0,80}(?:difficulty|item)/iu
      },
      {
        label: "difficulty_condition_applied_independently",
        expression:
          /(?:very difficult|hard) item[^.!?]{0,100}(?:more informative|more precision)[^.!?]{0,80}(?:high|higher)[ -]?theta[^.!?]{0,80}(?:than|rather than)[^.!?]{0,80}(?:low|lower)[ -]?theta/iu
      },
      {
        label: "information_useful_near_ability_range",
        expression:
          /item[^.!?]{0,100}(?:most useful|most informative|most precise)[^.!?]{0,80}(?:around|near)[^.!?]{0,80}(?:ability|theta)[^.!?]{0,160}(?:distinguish|differentiat)[^.!?]{0,100}(?:not just|rather than|instead of)[^.!?]{0,80}(?:hard|difficult)/iu
      }
    ]
  },
  reliability_validity: {
    topic_patterns: [
      /\breliab/iu,
      /\bvalidity\b/iu,
      /\binternal consistency\b/iu
    ],
    misconception_patterns: [
      {
        label: "reliability_proves_validity",
        expression:
          /(?:high|strong)[^.!?]{0,40}(?:reliability|internal consistency)[^.!?]{0,80}(?:proves|establishes|guarantees)[^.!?]{0,40}validity/iu
      }
    ],
    substantive_patterns: [
      {
        label: "reliability_validity_boundary",
        expression:
          /reliab[^.!?]{0,100}(?:consistency|precision)[^.!?]{0,120}(?:does not|cannot|is not enough to)[^.!?]{0,100}(?:validity|intended interpretation)/iu
      },
      {
        label: "reliability_necessary_not_sufficient",
        expression:
          /reliab[^.!?]{0,80}(?:necessary|useful)[^.!?]{0,80}(?:not sufficient|not enough)[^.!?]{0,80}valid/iu
      }
    ]
  },
  correlation_causation: {
    topic_patterns: [/\bcorrelat/iu, /\bcaus/iu, /\bassociation\b/iu],
    misconception_patterns: [
      {
        label: "correlation_proves_causation",
        expression:
          /(?:correlation|association)[^.!?]{0,80}(?:proves|shows|means)[^.!?]{0,40}caus/iu
      }
    ],
    substantive_patterns: [
      {
        label: "causal_alternative_explanation",
        expression:
          /(?:correlation|association)[^.!?]{0,100}(?:does not|cannot)[^.!?]{0,50}caus[^.!?]{0,120}(?:confound|third variable|reverse caus|direction|random assign)/iu
      }
    ]
  },
  p_value_interpretation: {
    topic_patterns: [/\bp[ -]?value\b/iu, /\bnull hypothesis\b/iu],
    misconception_patterns: [
      {
        label: "p_value_probability_null_true",
        expression:
          /p[ -]?value[^.!?]{0,100}(?:probability|chance)[^.!?]{0,80}(?:null|hypothesis)[^.!?]{0,30}(?:true|correct)/iu
      }
    ],
    substantive_patterns: [
      {
        label: "p_value_conditional_boundary",
        expression:
          /p[ -]?value[^.!?]{0,180}(?:assuming|if)[^.!?]{0,50}(?:null|hypothesis)[^.!?]{0,140}(?:not|rather than)[^.!?]{0,100}(?:probability|chance)[^.!?]{0,60}(?:null|hypothesis)|p[ -]?value[^.!?]{0,100}(?:data|result)[^.!?]{0,80}(?:assuming|under)[^.!?]{0,50}(?:null|hypothesis)[^.!?]{0,100}(?:rather than|not)[^.!?]{0,80}(?:probability|chance)[^.!?]{0,60}(?:null|hypothesis)/iu
      }
    ]
  },
  measurement_invariance: {
    topic_patterns: [/\binvariance\b/iu, /\bitem parameters?\b/iu, /\bgroups?\b/iu],
    misconception_patterns: [
      {
        label: "same_mean_proves_invariance",
        expression:
          /same[^.!?]{0,40}(?:mean|average)[^.!?]{0,80}(?:proves|means|guarantees)[^.!?]{0,50}invariance/iu
      }
    ],
    substantive_patterns: [
      {
        label: "invariance_item_parameter_boundary",
        expression:
          /invariance[^.!?]{0,120}(?:same|equivalent)[^.!?]{0,60}(?:item parameters?|item functioning)[^.!?]{0,80}(?:across|between)[^.!?]{0,30}groups?[^.!?]{0,100}(?:compare|meaning|comparable)|invariance[^.!?]{0,120}(?:item parameters?|item functioning)[^.!?]{0,100}(?:same|equivalent|comparable)[^.!?]{0,80}groups?|item parameters?[^.!?]{0,100}(?:same|equivalent)[^.!?]{0,80}groups?[^.!?]{0,100}(?:compare|meaning|scale)/iu
      }
    ]
  },
  standard_error_information: {
    topic_patterns: [/\bstandard error\b/iu, /\binformation\b/iu, /\bprecision\b/iu],
    misconception_patterns: [
      {
        label: "more_information_more_error",
        expression:
          /more information[^.!?]{0,80}(?:more|larger|higher)[^.!?]{0,30}standard error/iu
      }
    ],
    substantive_patterns: [
      {
        label: "information_standard_error_inverse_relation",
        expression:
          /(?:more|greater|higher) information[^.!?]{0,100}(?:smaller|lower|decreases?)[^.!?]{0,50}standard error|standard error[^.!?]{0,100}(?:inverse|one over|decreases?)[^.!?]{0,80}information/iu
      }
    ]
  }
};

const evidenceRank: Record<SimulatorEvidenceLevel, number> = {
  none: 0,
  minimal: 1,
  partial: 2,
  substantive: 3
};

function exactMatch(message: string, pattern: Pattern) {
  const match = message.match(pattern.expression);
  return match?.[0]?.trim()
    ? { label: pattern.label, span: match[0].trim() }
    : null;
}

function containsTopic(message: string, contract: AnchorContract) {
  return contract.topic_patterns.some((pattern) => pattern.test(message));
}

function sentenceWithReason(message: string) {
  return message.split(/(?<=[.!?])\s+/u).find((sentence) =>
    /\b(?:because|but|although|since|so|therefore|means)\b/iu.test(sentence)
  )?.trim() ?? null;
}

export function classifyStudentEvidenceV2(input: {
  message: string;
  conceptual_anchor: E2A18ConceptualAnchor;
}) {
  const message = input.message.trim();
  const contract = anchorContracts[input.conceptual_anchor];
  if (!message) {
    return {
      classifier_version: E2A18_SIMULATOR_EVIDENCE_CLASSIFIER_VERSION,
      observed_level: "none" as const,
      exact_evidence_spans: [],
      rationale_codes: ["empty_or_no_observable_evidence"],
      ambiguous: false
    };
  }
  const topical = containsTopic(message, contract);
  if (!topical) {
    return {
      classifier_version: E2A18_SIMULATOR_EVIDENCE_CLASSIFIER_VERSION,
      observed_level: "none" as const,
      exact_evidence_spans: [],
      rationale_codes: ["active_anchor_not_observable"],
      ambiguous: false
    };
  }
  const substantive = contract.substantive_patterns
    .map((pattern) => exactMatch(message, pattern))
    .find((match) => match !== null) ?? null;
  const repetitionCue =
    /\b(?:you said|the tutor said|i am repeating|that sentence says)\b/iu.test(
      message
    );
  const hedgeCue =
    /\b(?:maybe|might|i think|i guess|perhaps|not sure|could be)\b/iu.test(
      message
    );
  const independentApplication =
    /\b(?:so for|which means for|in this item|for option|therefore option|applied here)\b/iu.test(
      message
    );
  if (substantive && !repetitionCue && (!hedgeCue || independentApplication)) {
    return {
      classifier_version: E2A18_SIMULATOR_EVIDENCE_CLASSIFIER_VERSION,
      observed_level: "substantive" as const,
      exact_evidence_spans: [substantive],
      rationale_codes: ["complete_correct_relationship_observed"],
      ambiguous: false
    };
  }
  if (substantive && (repetitionCue || hedgeCue)) {
    return {
      classifier_version: E2A18_SIMULATOR_EVIDENCE_CLASSIFIER_VERSION,
      observed_level: "partial" as const,
      exact_evidence_spans: [substantive],
      rationale_codes: [
        repetitionCue
          ? "repeated_language_without_independent_application"
          : "tentative_relationship_without_independent_application"
      ],
      ambiguous: true
    };
  }
  const misconception = contract.misconception_patterns
    .map((pattern) => exactMatch(message, pattern))
    .find((match) => match !== null) ?? null;
  const reasonSpan = sentenceWithReason(message);
  if (misconception || reasonSpan) {
    return {
      classifier_version: E2A18_SIMULATOR_EVIDENCE_CLASSIFIER_VERSION,
      observed_level: "partial" as const,
      exact_evidence_spans: misconception
        ? [misconception]
        : [{ label: "incomplete_or_incorrect_reason", span: reasonSpan! }],
      rationale_codes: [
        misconception
          ? "misconception_reasoning_observed"
          : "relevant_reason_without_complete_boundary"
      ],
      ambiguous: hedgeCue
    };
  }
  return {
    classifier_version: E2A18_SIMULATOR_EVIDENCE_CLASSIFIER_VERSION,
    observed_level: "minimal" as const,
    exact_evidence_spans: [{ label: "topical_reference", span: message }],
    rationale_codes: ["topical_reference_without_reason"],
    ambiguous: hedgeCue
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

export function validateLlmStudentSimulatorOutputV2(input: {
  simulator_input: LlmStudentSimulatorInput;
  output: LlmStudentSimulatorOutput;
  conceptual_anchor: E2A18ConceptualAnchor;
  previous_student_messages?: string[];
}) {
  const original = validateLlmStudentSimulatorOutput({
    simulator_input: input.simulator_input,
    output: input.output,
    previous_student_messages: input.previous_student_messages
  });
  const nonEvidenceIssues = original.issues.filter((finding) =>
    finding.rule_code !== "evidence_level_exceeded"
  );
  const classification = classifyStudentEvidenceV2({
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
    output: original.output,
    evidence_adjudication: {
      contract_version: E2A18_SIMULATOR_CONTRACT_VERSION,
      classifier_version: E2A18_SIMULATOR_EVIDENCE_CLASSIFIER_VERSION,
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
