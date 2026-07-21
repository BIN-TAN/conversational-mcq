import { stableHash } from "@/lib/operational/stable-hash";
import type {
  TopicDialogueTurnEvidenceProfile
} from "@/lib/services/student-assessment/topic-dialogue-evidence-first-routing";

export const E2A26_SEMANTIC_PROFILE_ENVELOPE_VERSION =
  "e2a26-semantic-profile-envelope-v1" as const;
export const E2A26_AUTONOMOUS_CANARY_ORACLE_VERSION =
  "e2a26-autonomous-canary-oracle-v1" as const;
export const E2A26_FAILURE_PATH_ARTIFACT_POLICY_VERSION =
  "e2a26-failure-path-artifact-policy-v1" as const;

export const E2A26_FAILURE_CODES = [
  "genuine_false_sound",
  "genuine_sound_false_negative",
  "premature_revision",
  "profile_semantically_outside_allowed_envelope",
  "profile_label_mismatch_within_allowed_envelope",
  "frozen_oracle_overconstraint",
  "context_integrity_failure",
  "evaluator_omission",
  "tutor_after_sound",
  "strategy_adaptation_failure",
  "failure_path_evidence_incomplete",
  "infrastructure_incomplete"
] as const;

export type E2A26FailureCode = typeof E2A26_FAILURE_CODES[number];
export type ReasoningQuality =
  TopicDialogueTurnEvidenceProfile["reasoning_quality"];
export type RouteMode =
  "remain_in_dialogue" | "request_revision" |
  "present_transfer" | "complete_episode";

export type SemanticProfileExpectation = {
  frozen_label: string;
  evidence_ceiling: "non_sound" | "sound";
  preferred_reasoning_quality: ReasoningQuality;
  acceptable_reasoning_qualities: ReasoningQuality[];
  unacceptable_reasoning_qualities: ReasoningQuality[];
  required_revision_readiness: boolean;
  acceptable_route_modes: RouteMode[];
  review_only_ambiguities: string[];
};

export type SemanticProfileProjection = {
  reasoning_quality: ReasoningQuality;
  anchor_application: "absent" | "implicit" | "explicit";
  misconception_status:
    "persists" | "uncertain" | "resolved_for_current_anchor";
  essential_missing_links: string[];
  contradictions: string[];
  revision_readiness: boolean;
  transfer_readiness: boolean;
  completion_readiness: boolean;
  route_mode: RouteMode;
};

export type SemanticOracleResult = {
  oracle_version: typeof E2A26_AUTONOMOUS_CANARY_ORACLE_VERSION;
  envelope_version: typeof E2A26_SEMANTIC_PROFILE_ENVELOPE_VERSION;
  passed: boolean;
  exact_label_match: boolean;
  inside_semantic_envelope: boolean;
  hard_invariants_passed: boolean;
  failure_code: E2A26FailureCode | null;
  review_flags: E2A26FailureCode[];
  progression_safe: boolean;
  reasons: string[];
};

function complement(
  accepted: ReasoningQuality[]
): ReasoningQuality[] {
  return (["insufficient", "misconception", "partial", "sound"] as const)
    .filter((entry) => !accepted.includes(entry));
}

export function semanticExpectationForFrozenLabel(
  frozenLabel: string
): SemanticProfileExpectation {
  const label = frozenLabel.toLocaleLowerCase("en-CA");
  if (label.includes("sound")) {
    return {
      frozen_label: frozenLabel,
      evidence_ceiling: "sound",
      preferred_reasoning_quality: "sound",
      acceptable_reasoning_qualities: ["sound"],
      unacceptable_reasoning_qualities: [
        "insufficient", "misconception", "partial"
      ],
      required_revision_readiness: true,
      acceptable_route_modes: ["request_revision"],
      review_only_ambiguities: []
    };
  }
  let preferred: ReasoningQuality = "partial";
  let accepted: ReasoningQuality[] = ["partial", "misconception"];
  const ambiguities = [
    "partial_and_misconception_boundary_may_require_human_review"
  ];
  if (label.includes("copied")) {
    preferred = "insufficient";
    accepted = ["insufficient", "misconception"];
    ambiguities.splice(0, ambiguities.length,
      "copied_wording_may_be_insufficient_or_misconception_when_an_incorrect_relationship_is_retained");
  } else if (label.includes("misconception") && !label.includes("mixed")) {
    preferred = "misconception";
    accepted = ["misconception", "partial"];
  } else if (label.includes("insufficient")) {
    preferred = "insufficient";
    accepted = ["insufficient", "misconception"];
  } else if (label.includes("mixed")) {
    preferred = "partial";
    accepted = ["partial", "misconception"];
  }
  return {
    frozen_label: frozenLabel,
    evidence_ceiling: "non_sound",
    preferred_reasoning_quality: preferred,
    acceptable_reasoning_qualities: accepted,
    unacceptable_reasoning_qualities: complement(accepted),
    required_revision_readiness: false,
    acceptable_route_modes: ["remain_in_dialogue"],
    review_only_ambiguities: ambiguities
  };
}

export function evaluateSemanticProfileEnvelope(input: {
  expectation: SemanticProfileExpectation;
  production: SemanticProfileProjection;
}): SemanticOracleResult {
  const { expectation, production } = input;
  const reasons: string[] = [];
  const reviewFlags: E2A26FailureCode[] = [];
  const exactLabelMatch = production.reasoning_quality ===
    expectation.preferred_reasoning_quality;
  const insideEnvelope = expectation.acceptable_reasoning_qualities.includes(
    production.reasoning_quality
  );
  const nonSoundEvidence = expectation.evidence_ceiling === "non_sound";
  const soundProfile = production.reasoning_quality === "sound" ||
    production.misconception_status === "resolved_for_current_anchor";
  const progressionAuthorized = production.revision_readiness ||
    production.transfer_readiness || production.completion_readiness ||
    production.route_mode !== "remain_in_dialogue";
  let failureCode: E2A26FailureCode | null = null;

  if (nonSoundEvidence && production.reasoning_quality === "sound") {
    failureCode = "genuine_false_sound";
    reasons.push("Non-sound observable evidence was classified as sound.");
  } else if (nonSoundEvidence && progressionAuthorized) {
    failureCode = "premature_revision";
    reasons.push("Non-sound evidence authorized progression.");
  } else if (!nonSoundEvidence && !soundProfile) {
    failureCode = "genuine_sound_false_negative";
    reasons.push("Sound observable evidence remained non-sound.");
  } else if (!nonSoundEvidence && !production.revision_readiness) {
    failureCode = "genuine_sound_false_negative";
    reasons.push("Sound evidence did not authorize revision.");
  } else if (!insideEnvelope) {
    failureCode = "profile_semantically_outside_allowed_envelope";
    reasons.push("The production profile falls outside the semantic envelope.");
  } else if (!expectation.acceptable_route_modes.includes(
    production.route_mode
  )) {
    failureCode = "profile_semantically_outside_allowed_envelope";
    reasons.push("The platform route is outside the accepted progression state.");
  } else if (production.revision_readiness !==
    expectation.required_revision_readiness) {
    failureCode = expectation.required_revision_readiness
      ? "genuine_sound_false_negative" : "premature_revision";
    reasons.push("Revision readiness contradicts the evidence ceiling.");
  } else if (!exactLabelMatch) {
    reviewFlags.push("profile_label_mismatch_within_allowed_envelope");
    reasons.push(
      "The exact label differs, but the profile remains inside the allowed non-sound or sound envelope."
    );
  }

  const progressionSafe = nonSoundEvidence
    ? !progressionAuthorized && !soundProfile
    : production.revision_readiness && production.route_mode ===
      "request_revision";
  return {
    oracle_version: E2A26_AUTONOMOUS_CANARY_ORACLE_VERSION,
    envelope_version: E2A26_SEMANTIC_PROFILE_ENVELOPE_VERSION,
    passed: failureCode === null,
    exact_label_match: exactLabelMatch,
    inside_semantic_envelope: insideEnvelope,
    hard_invariants_passed: failureCode === null,
    failure_code: failureCode,
    review_flags: reviewFlags,
    progression_safe: progressionSafe,
    reasons
  };
}

export function projectProfileForSemanticOracle(input: {
  profile: TopicDialogueTurnEvidenceProfile;
  route_mode?: RouteMode;
}): SemanticProfileProjection {
  return {
    reasoning_quality: input.profile.reasoning_quality,
    anchor_application: input.profile.anchor_application,
    misconception_status: input.profile.misconception_status,
    essential_missing_links: input.profile.essential_missing_links,
    contradictions: input.profile.contradictions,
    revision_readiness: input.profile.revision_readiness,
    transfer_readiness: input.profile.transfer_readiness,
    completion_readiness: input.profile.completion_readiness,
    route_mode: input.route_mode ?? (input.profile.revision_readiness
      ? "request_revision" : "remain_in_dialogue")
  };
}

type CalibrationArchetype = {
  id: string;
  expected_label: string;
  production_quality: ReasoningQuality;
  production_revision_ready: boolean;
  production_route: RouteMode;
  expected_pass: boolean;
  expected_failure_code: E2A26FailureCode | null;
  description: string;
};

const CALIBRATION_ARCHETYPES: CalibrationArchetype[] = [
  {
    id: "copied_correct_wording_no_application",
    expected_label: "insufficient_copied_wording",
    production_quality: "insufficient",
    production_revision_ready: false,
    production_route: "remain_in_dialogue",
    expected_pass: true,
    expected_failure_code: null,
    description: "Copied wording contains no independent anchor application."
  },
  {
    id: "copied_misconception_wording",
    expected_label: "insufficient_copied_wording",
    production_quality: "misconception",
    production_revision_ready: false,
    production_route: "remain_in_dialogue",
    expected_pass: true,
    expected_failure_code: null,
    description: "Copied wording retains the active incorrect relationship."
  },
  {
    id: "copied_wording_plus_contradiction",
    expected_label: "mixed_correct_and_contradictory",
    production_quality: "misconception",
    production_revision_ready: false,
    production_route: "remain_in_dialogue",
    expected_pass: true,
    expected_failure_code: null,
    description: "A copied fragment coexists with a prohibited contradiction."
  },
  {
    id: "correct_vocabulary_without_reasoning",
    expected_label: "partial",
    production_quality: "partial",
    production_revision_ready: false,
    production_route: "remain_in_dialogue",
    expected_pass: true,
    expected_failure_code: null,
    description: "Correct vocabulary lacks the required mechanism."
  },
  {
    id: "misconception_with_explicit_anchor",
    expected_label: "misconception",
    production_quality: "misconception",
    production_revision_ready: false,
    production_route: "remain_in_dialogue",
    expected_pass: true,
    expected_failure_code: null,
    description: "Explicit item reference preserves the misconception."
  },
  {
    id: "partial_reasoning_boundary",
    expected_label: "partial",
    production_quality: "misconception",
    production_revision_ready: false,
    production_route: "remain_in_dialogue",
    expected_pass: true,
    expected_failure_code: null,
    description: "A defensible partial-versus-misconception boundary case."
  },
  {
    id: "sound_independent_paraphrase",
    expected_label: "sound_independent_application",
    production_quality: "sound",
    production_revision_ready: true,
    production_route: "request_revision",
    expected_pass: true,
    expected_failure_code: null,
    description: "Independent reasoning satisfies the target relationship."
  },
  {
    id: "low_confidence_sound",
    expected_label: "sound_low_confidence_application",
    production_quality: "sound",
    production_revision_ready: true,
    production_route: "request_revision",
    expected_pass: true,
    expected_failure_code: null,
    description: "Low confidence does not suppress sound reasoning."
  },
  {
    id: "verbose_polished_misconception",
    expected_label: "misconception",
    production_quality: "misconception",
    production_revision_ready: false,
    production_route: "remain_in_dialogue",
    expected_pass: true,
    expected_failure_code: null,
    description: "Polish and length do not produce false sound."
  },
  {
    id: "fragmented_but_sound",
    expected_label: "sound_noncanonical_application",
    production_quality: "sound",
    production_revision_ready: true,
    production_route: "request_revision",
    expected_pass: true,
    expected_failure_code: null,
    description: "Fragmented language still expresses the required mechanism."
  },
  {
    id: "genuine_false_sound_control",
    expected_label: "misconception",
    production_quality: "sound",
    production_revision_ready: true,
    production_route: "request_revision",
    expected_pass: false,
    expected_failure_code: "genuine_false_sound",
    description: "A non-sound example is deliberately misclassified as sound."
  },
  {
    id: "genuine_sound_false_negative_control",
    expected_label: "sound_independent_application",
    production_quality: "partial",
    production_revision_ready: false,
    production_route: "remain_in_dialogue",
    expected_pass: false,
    expected_failure_code: "genuine_sound_false_negative",
    description: "A sound example is deliberately held in dialogue."
  }
];

const CALIBRATION_DOMAINS = [
  "chemistry_equilibrium",
  "linguistics_phonology",
  "economics_decision_theory",
  "computer_science_algorithms",
  "biology_genetics",
  "measurement_theory"
] as const;

export function buildE2A26CalibrationCorpus() {
  return CALIBRATION_DOMAINS.flatMap((domain) =>
    CALIBRATION_ARCHETYPES.map((archetype) => {
      const expectation = semanticExpectationForFrozenLabel(
        archetype.expected_label
      );
      return {
        case_id: `e2a26_${domain}_${archetype.id}`,
        academic_domain: domain,
        non_irt: domain !== "measurement_theory",
        archetype: archetype.id,
        description: archetype.description,
        acceptable_reasoning_quality_set:
          expectation.acceptable_reasoning_qualities,
        unacceptable_reasoning_quality_set:
          expectation.unacceptable_reasoning_qualities,
        required_progression_state:
          expectation.required_revision_readiness
            ? "request_revision" : "remain_in_dialogue",
        prohibited_progression_state:
          expectation.required_revision_readiness
            ? "remain_in_dialogue" : "request_revision",
        acceptable_route_class: expectation.acceptable_route_modes,
        hard_invariants: expectation.evidence_ceiling === "sound"
          ? ["sound_evidence_authorizes_revision", "no_tutor_after_sound"]
          : ["non_sound_evidence_blocks_revision", "copied_wording_alone_is_not_sound"],
        review_only_ambiguities: expectation.review_only_ambiguities,
        frozen_expectation: expectation,
        production_projection: {
          reasoning_quality: archetype.production_quality,
          anchor_application: archetype.production_quality === "sound"
            ? "explicit" : "absent",
          misconception_status: archetype.production_quality === "sound"
            ? "resolved_for_current_anchor" : "persists",
          essential_missing_links: archetype.production_quality === "sound"
            ? [] : ["required_mechanism"],
          contradictions: archetype.production_quality === "misconception"
            ? ["active_distractor_claim_retained"] : [],
          revision_readiness: archetype.production_revision_ready,
          transfer_readiness: false,
          completion_readiness: false,
          route_mode: archetype.production_route
        } satisfies SemanticProfileProjection,
        expected_oracle_pass: archetype.expected_pass,
        expected_failure_code: archetype.expected_failure_code
      };
    })
  );
}

export function runE2A26Calibration() {
  return buildE2A26CalibrationCorpus().map((entry) => {
    const result = evaluateSemanticProfileEnvelope({
      expectation: entry.frozen_expectation,
      production: entry.production_projection
    });
    const passed = result.passed === entry.expected_oracle_pass &&
      result.failure_code === entry.expected_failure_code;
    return {
      case_id: entry.case_id,
      academic_domain: entry.academic_domain,
      non_irt: entry.non_irt,
      oracle_result: result,
      expected_oracle_pass: entry.expected_oracle_pass,
      expected_failure_code: entry.expected_failure_code,
      passed
    };
  });
}

export function buildE2A27ProtocolDraft() {
  const protocol = {
    protocol_version:
      "e2a27-targeted-informal-copied-reasoning-canary-draft-v1",
    execution_authorized: false,
    live_execution_performed: false,
    session_count: 1,
    session: {
      session_id: "E2A27-C",
      design: "informal_copied_contradictory_then_independent_sound",
      academic_domain: "chemistry_equilibrium_kinetics",
      concept: "catalyst_rate_equilibrium_boundary",
      target_evidence_contract: {
        item_id: "chemistry_equilibrium_item_9",
        distractor_option: "C",
        distractor_claim:
          "A catalyst shifts equilibrium toward products because it accelerates the forward reaction.",
        required_relationship:
          "A catalyst changes how quickly equilibrium is reached, not the equilibrium composition.",
        required_mechanism:
          "The catalyst lowers activation barriers for both directions and does not change the equilibrium constant.",
        prohibited_contradiction:
          "Accelerating the forward reaction means the product side remains favored at equilibrium."
      },
      student_profile: {
        language_quality: "informal_typo_heavy_noncanonical",
        confidence: "low",
        engagement: "cooperative_with_echo_then_contradiction",
        trajectory:
          "partial_then_echoed_then_contradictory_then_independent_sound"
      },
      frozen_student_trajectory: [
        {
          turn: 1,
          message:
            "catalyst makes it happen faster but idk if faster means u end up with more product",
          semantic_envelope: ["partial", "misconception"],
          tutor_expected: true
        },
        {
          turn: 2,
          simulator_instruction:
            "Echo one distinctive clause from the immediately preceding tutor message with minimal transformation and no independent application.",
          semantic_envelope: ["insufficient", "misconception"],
          tutor_expected: true
        },
        {
          turn: 3,
          message:
            "it speeds both ways, but i still think the product side wins since the forward reaction gets the head start",
          semantic_envelope: ["misconception", "partial"],
          tutor_expected: true
        },
        {
          turn: 4,
          message:
            "the catalyst cuts the barrier for forward and reverse, so it gets to equilibrium sooner but doesnt change the final ratio or K. option C mixes up speed with where equilibrium sits",
          semantic_envelope: ["sound"],
          tutor_expected: false
        }
      ],
      human_adjudicated_earliest_sound_turn: 4,
      required_endpoint: "passed_required_revision_endpoint",
      maximum_student_turns: 8,
      complete_visible_history_limit: 21,
      raw_history_truncation_allowed: false,
      summary_only_substitution_allowed: false
    },
    required_tests: [
      "copied_wording_accepted_only_inside_non_sound_envelope",
      "exact_categorical_equality_not_required",
      "copied_wording_alone_not_sound",
      "misconception_blocks_revision",
      "tutor_targets_independent_application",
      "complete_visible_history",
      "intervention_history_available",
      "sound_independent_reasoning_immediately_requests_revision",
      "zero_unnecessary_turns_after_sound"
    ],
    prohibited_stages: [
      "four_session_canary",
      "twelve_session_canary",
      "thirty_six_session_matrix",
      "e2b",
      "approval",
      "activation"
    ]
  } as const;
  return {
    ...protocol,
    protocol_hash: stableHash(protocol)
  };
}

export function buildE2A27BudgetDraft() {
  const expected = {
    simulator_calls: 4,
    evidence_evaluator_calls: 4,
    initial_tutor_calls: 3,
    tutor_regenerations: 0,
    logical_generation_calls: 11,
    adapter_attempts_without_transport_retry: 11
  };
  return {
    budget_version: "e2a27-targeted-canary-budget-draft-v1",
    execution_authorized: false,
    provider_concurrency: 1,
    maximum: {
      sessions: 1,
      simulator_calls: 8,
      evidence_evaluator_calls: 8,
      initial_tutor_calls: 8,
      tutor_regenerations: 2,
      logical_generation_calls: 26,
      adapter_attempts: 78,
      input_tokens: 800_000,
      output_tokens: 60_000,
      total_tokens: 860_000,
      cost_usd: 20
    },
    expected_normal_use: expected,
    arithmetic_valid:
      8 + 8 + 8 + 2 === 26 && 26 * 3 === 78 &&
      800_000 + 60_000 === 860_000,
    cost_ceiling_is_future_limit_not_authorization: true,
    early_abort_rules: [
      "first_privacy_or_answer_key_failure",
      "first_unauthorized_progression",
      "first_stale_profile_or_context_failure",
      "first_deterministic_fallback",
      "first_failure_path_artifact_omission",
      "more_than_two_tutor_regenerations",
      "any_tutor_call_after_sound"
    ]
  };
}

export function buildE2A27ArtifactContract() {
  return {
    artifact_contract_version: "e2a27-targeted-canary-artifact-contract-v1",
    execution_authorized: false,
    required_failure_path_statuses: [
      "completed",
      "generated_but_not_persisted",
      "generated_but_not_displayed",
      "not_reached_due_to_harness_abort",
      "expected_empty_after_abort",
      "missing",
      "malformed"
    ],
    every_attempted_provider_call_must_be_recorded: true,
    generated_tutor_output_must_enter_human_review_packet: true,
    human_decisions_initially_null: true,
    raw_provider_output_prohibited: true,
    secrets_and_hidden_prompts_prohibited: true,
    later_stage_execution_prohibited: true
  };
}
