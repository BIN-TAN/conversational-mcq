import { createHash, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync
} from "node:fs";
import path from "node:path";
import { stableHash } from "@/lib/operational/stable-hash";
import {
  CLASSROOM_ORCHESTRATION_CONTRACT_VERSION,
  CLASSROOM_PRIVACY_BOUNDARY_VERSION,
  INTERVENTION_MEMORY_ISOLATION_CONTRACT_VERSION,
  MULTI_STUDENT_SESSION_CONTRACT_VERSION,
  PERSONALIZATION_EVALUATION_CONTRACT_VERSION,
  PROFILE_ISOLATION_CONTRACT_VERSION,
  IsolationBoundaryError,
  ScopedClassroomStore,
  buildClassroomOrchestrationContractV1,
  buildClassroomPrivacyBoundaryV1,
  buildInterventionMemoryIsolationContractV1,
  buildMultiStudentSessionContractV1,
  buildPersonalizationEvaluationContractV1,
  buildPrivacySafeClassroomAggregate,
  buildProfileIsolationContractV1,
  canonicalizeConcurrentObservations,
  deriveTrajectoryDecision,
  stableClassroomHash,
  studentSessionNamespace,
  validateStudentFacingClassroomTextV1,
  type ClassroomObservation,
  type ClassroomStudentTrajectory,
  type ScopedRecord,
  type StudentIsolationScope
} from "./e2a40-classroom-isolation-contracts";

export const E2A40_PROTOCOL_VERSION =
  "e2a40-multi-student-classroom-profile-isolation-v1" as const;
export const E2A40_SCENARIO_VERSION =
  "e2a40-measurement-theory-six-trajectory-simulation-v1" as const;
export const E2A40_ARTIFACT_CONTRACT_VERSION =
  "e2a40-artifact-contract-v1" as const;
export const E2A40_BUDGET_VERSION =
  "e2a40-no-live-budget-contract-v1" as const;
export const E2A40_COMPOSITE_IDENTITY_VERSION =
  "e2a40-composite-runtime-identity-v1" as const;
export const E2A40_ARTIFACT_ROOT = path.join(
  process.cwd(),
  ".data",
  "e2a40-multi-student-classroom-profile-isolation-freeze"
);

const CANDIDATE_CONFIGURATION_HASH =
  "b3db25afadd99fba21dc23fee7a1dbcc21a7268a18b4556aaa4f19d37333656b";
const PREDECESSOR_COMMIT =
  "baedb08fc32ca404857176adf49140150c32cbfe";
const PREDECESSOR_PROTOCOL_HASH =
  "060db7e1caa6e656f4a6b8f890d57f9ada4c5ef2b48c5e316b06ab27f8ddbd3d";
const PREDECESSOR_COMPOSITE_IDENTITY =
  "da31c2032f90e1806fc435918239103593873910b4d1f68c7ef47792d560f2ad";

const PROTECTED_SOURCE_HASHES = {
  "config/candidate-operational-agent-config.e2a24-autonomous-formative-dialogue-v1.json":
    "d39c312a121e4967133d4b5ddf30848edccba7684f5b5cc9be18ddb807f599a2",
  "src/lib/evaluation/formative/e2a24-autonomous-dialogue-candidate.ts":
    "b57df1ed269ef1e5f7e2ec7ad3c394d0c7b247afa54c7d067598caa3e47eda09",
  "src/lib/services/student-assessment/production-turn-evidence-evaluator-v5.ts":
    "6ff02d152f95608235d78592a6a1d4970a1ed1f2d7477bbaaaca7e96a878f9cd",
  "src/lib/services/student-assessment/canonical-anchor-evidence.ts":
    "bb03fd71ba544d9ffab2ce5c650fc036d3525d7f29a3718bcbd015c620c07fd2",
  "src/lib/services/student-assessment/anchor-stance-resolution-v1.ts":
    "36c291183aaf15378a65a3cf00c847e4625676a275dca8daa47fe1aaf9749e6a",
  "src/lib/services/student-assessment/target-evidence-mapper-v7.ts":
    "a4ef776faa93094222e5cb7e61e890a71e662b6d247f2c247013224c5ab787a5",
  "src/lib/evaluation/formative/conceptual-evidence-update-source-v1.ts":
    "340eb064feb814b2c9e2584b2242cdf24cc72afe06373d9aa228f6086129fafe",
  "src/lib/evaluation/formative/e2a36-longitudinal-contracts.ts":
    "98044fed11bd8a1a9ff9151afa21e866e7d0f0624cfdf8cecc455f42700ad941",
  "src/lib/evaluation/formative/e2a37-instructor-handoff-protocol.ts":
    "a32d141d052cbe07d56d4b989cda129d7442950f311166b42f79d6d9b38794d7",
  "src/lib/evaluation/formative/trajectory-envelope-v1.ts":
    "95319bb52d087601680e53ce2db9e357764a2b5f5574e125f3b88804c49d4e70",
  "src/lib/evaluation/formative/e2a39-transfer-closure-contracts.ts":
    "a944632e3801cf88d19de086e61eb24c98927759c1babddb5bd380366639a18b",
  "src/lib/evaluation/formative/e2a39-transfer-closure-protocol.ts":
    "c63530dec114bb7bf02fd84a707076f95ab9d5eb422941b16388cd06e9515377"
} as const;

export const E2A40_ARTIFACT_NAMES = [
  "freeze-manifest.json",
  "frozen-protocol.json",
  "frozen-protocol.sha256",
  "held-out-domain.json",
  "component-contract-bindings.json",
  "multi-student-session-contract.json",
  "profile-isolation-contract.json",
  "intervention-memory-isolation-contract.json",
  "classroom-orchestration-contract.json",
  "privacy-boundary-contract.json",
  "personalization-evaluation-contract.json",
  "six-student-trajectories.json",
  "session-test-results.json",
  "profile-isolation-test-results.json",
  "transcript-isolation-test-results.json",
  "intervention-isolation-test-results.json",
  "classroom-orchestration-test-results.json",
  "concurrent-ordering-test-results.json",
  "personalization-test-results.json",
  "instructor-boundary-test-results.json",
  "privacy-test-results.json",
  "audit-isolation-test-results.json",
  "closure-isolation-test-results.json",
  "deterministic-regression-results.json",
  "privacy-safe-aggregate.json",
  "metrics.json",
  "budget.json",
  "artifact-contract.json",
  "candidate-integrity.json",
  "protected-source-integrity.json",
  "composite-runtime-identity.json",
  "provider-call-guard.json",
  "summary.json",
  "artifact-validation.json"
] as const;

type JsonRecord = Record<string, unknown>;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function sha256(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

function fileSha256(relativePath: string) {
  return sha256(readFileSync(path.join(process.cwd(), relativePath)));
}

function currentGitCommit() {
  return execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: process.cwd(),
    encoding: "utf8"
  }).trim();
}

function writeJson(filePath: string, value: unknown) {
  const serialized = JSON.stringify(value);
  assert(
    ![
      /\bsk-[A-Za-z0-9_-]{12,}/u,
      /\bBearer\s+[A-Za-z0-9._-]+/u,
      /OPENAI_API_KEY\s*=/u,
      /DATABASE_URL\s*=/u,
      /SESSION_SECRET\s*=/u
    ].some((pattern) => pattern.test(serialized)),
    "e2a40_forbidden_secret_detected"
  );
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function readJson<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, "utf8")) as T;
}

function scope(
  student: string,
  misconception = "reliability_proves_validity"
): StudentIsolationScope {
  return {
    classroom_run_id: "syn_classroom_measurement_001",
    student_subject_id: `syn_student_${student}`,
    session_id: `syn_session_${student}`,
    concept_key: "reliability_versus_validity",
    misconception_key: misconception
  };
}

function observation(input: {
  student: string;
  sequence: number;
  tick: number;
  state: ClassroomObservation["evidence_state"];
  confidence?: ClassroomObservation["confidence"];
  independent?: boolean;
  selfCorrection?: boolean;
  endorsed?: boolean;
  copied?: boolean;
  contradiction?: boolean;
}): ClassroomObservation {
  return {
    event_id: `event_${input.student}_${input.sequence}`,
    scope: scope(input.student),
    logical_tick: input.tick,
    student_sequence: input.sequence,
    evidence_state: input.state,
    confidence: input.confidence ?? "medium",
    independently_explained: input.independent ?? false,
    self_correction_intent: input.selfCorrection ?? false,
    misconception_endorsed: input.endorsed ?? false,
    copied_wording_detected: input.copied ?? false,
    contradiction_present: input.contradiction ?? false
  };
}

function buildSixStudentTrajectories(): ClassroomStudentTrajectory[] {
  return [
    {
      trajectory_id: "trajectory_fast_learner",
      kind: "fast_learner",
      scope: scope("fast"),
      observations: [
        observation({
          student: "fast",
          sequence: 1,
          tick: 1,
          state: "partial"
        }),
        observation({
          student: "fast",
          sequence: 2,
          tick: 4,
          state: "sound",
          confidence: "high",
          independent: true
        })
      ],
      expected_intervention: "invite_transfer_application",
      expected_stopping_decision: "close_episode",
      expected_instructor_boundary: "not_reached",
      student_facing_message:
        "You separated consistency from evidence for the intended interpretation. Try applying that distinction to one new measurement example."
    },
    {
      trajectory_id: "trajectory_slow_engaged_learner",
      kind: "slow_engaged_learner",
      scope: scope("slow"),
      observations: [
        observation({
          student: "slow",
          sequence: 1,
          tick: 1,
          state: "misconception",
          endorsed: true
        }),
        observation({
          student: "slow",
          sequence: 2,
          tick: 5,
          state: "partial",
          independent: true
        }),
        observation({
          student: "slow",
          sequence: 3,
          tick: 8,
          state: "partial",
          independent: true
        })
      ],
      expected_intervention: "scaffold_concept_boundary",
      expected_stopping_decision: "continue_dialogue",
      expected_instructor_boundary: "monitor_only",
      student_facing_message:
        "You have identified consistency. Now explain what additional evidence is needed before interpreting the scores as intended."
    },
    {
      trajectory_id: "trajectory_persistent_high_confidence",
      kind: "persistent_high_confidence_misconception",
      scope: scope("persistent"),
      observations: [
        observation({
          student: "persistent",
          sequence: 1,
          tick: 2,
          state: "misconception",
          confidence: "high",
          endorsed: true
        }),
        observation({
          student: "persistent",
          sequence: 2,
          tick: 6,
          state: "misconception",
          confidence: "high",
          endorsed: true
        }),
        observation({
          student: "persistent",
          sequence: 3,
          tick: 9,
          state: "misconception",
          confidence: "high",
          endorsed: true
        })
      ],
      expected_intervention:
        "change_strategy_and_prepare_instructor_next_step",
      expected_stopping_decision: "instructor_next_step",
      expected_instructor_boundary:
        "offer_supportive_instructor_next_step",
      student_facing_message:
        "This distinction is still difficult. Pause here and review the score-interpretation evidence with your instructor before trying another example."
    },
    {
      trajectory_id: "trajectory_shallow_copied",
      kind: "shallow_copied_understanding",
      scope: scope("copied"),
      observations: [
        observation({
          student: "copied",
          sequence: 1,
          tick: 2,
          state: "copied",
          copied: true
        }),
        observation({
          student: "copied",
          sequence: 2,
          tick: 7,
          state: "copied",
          confidence: "high",
          copied: true
        })
      ],
      expected_intervention: "ask_for_independent_application",
      expected_stopping_decision: "continue_dialogue",
      expected_instructor_boundary: "monitor_only",
      student_facing_message:
        "Apply the distinction in your own words: what could remain consistent while still failing to support the intended interpretation?"
    },
    {
      trajectory_id: "trajectory_self_correction",
      kind: "self_correction_learner",
      scope: scope("self_correct"),
      observations: [
        observation({
          student: "self_correct",
          sequence: 1,
          tick: 3,
          state: "misconception",
          endorsed: true
        }),
        observation({
          student: "self_correct",
          sequence: 2,
          tick: 6,
          state: "sound",
          independent: true,
          selfCorrection: true
        })
      ],
      expected_intervention:
        "reinforce_revised_mechanism_then_transfer",
      expected_stopping_decision: "authorize_revision",
      expected_instructor_boundary: "not_reached",
      student_facing_message:
        "Your revised explanation now distinguishes consistency from support for the intended interpretation. Use that distinction when you revise your answer."
    },
    {
      trajectory_id: "trajectory_regression",
      kind: "regression_learner",
      scope: scope("regression"),
      observations: [
        observation({
          student: "regression",
          sequence: 1,
          tick: 3,
          state: "partial"
        }),
        observation({
          student: "regression",
          sequence: 2,
          tick: 5,
          state: "sound",
          independent: true
        }),
        observation({
          student: "regression",
          sequence: 3,
          tick: 10,
          state: "regressed",
          confidence: "high",
          endorsed: true,
          contradiction: true
        })
      ],
      expected_intervention: "reopen_and_contrast_prior_reasoning",
      expected_stopping_decision: "continue_dialogue",
      expected_instructor_boundary: "monitor_only",
      student_facing_message:
        "Compare your latest conclusion with your earlier distinction. Which claim is supported by consistency alone, and which still needs validity evidence?"
    }
  ];
}

function buildHeldOutDomain() {
  return {
    scenario_version: E2A40_SCENARIO_VERSION,
    domain: "educational_measurement_assessment_literacy",
    concept: "reliability_versus_validity",
    synthetic_only: true,
    student_count: 6,
    trajectories: [
      "fast_learner",
      "slow_engaged_learner",
      "persistent_high_confidence_misconception",
      "shallow_copied_understanding",
      "self_correction_learner",
      "regression_learner"
    ],
    claims_boundary: {
      validates_orchestration_contracts_only: true,
      classroom_validity_claimed: false,
      learner_trait_inference_allowed: false,
      real_student_data_used: false
    }
  } as const;
}

function didThrowIsolationBoundary(callback: () => unknown) {
  try {
    callback();
    return false;
  } catch (error) {
    return error instanceof IsolationBoundaryError;
  }
}

function record(
  kind: ScopedRecord["kind"],
  owner: StudentIsolationScope,
  suffix: string,
  payload: Record<string, unknown>
): ScopedRecord {
  return {
    record_id: `${kind}_${owner.student_subject_id}_${suffix}`,
    kind,
    scope: owner,
    payload
  };
}

function resultSuite(
  suite: string,
  tests: Array<{ test_id: string; passed: boolean; evidence: unknown }>
) {
  return {
    suite,
    test_count: tests.length,
    tests,
    passed: tests.every((test) => test.passed)
  };
}

function buildDeterministicResults(
  trajectories: ClassroomStudentTrajectory[]
) {
  const decisions = trajectories.map(deriveTrajectoryDecision);
  const allObservations = trajectories.flatMap(
    (trajectory) => trajectory.observations
  );
  const canonical = canonicalizeConcurrentObservations(allObservations);
  const canonicalReversed = canonicalizeConcurrentObservations(
    [...allObservations].reverse()
  );
  const canonicalRotated = canonicalizeConcurrentObservations([
    ...allObservations.slice(5),
    ...allObservations.slice(0, 5)
  ]);

  const sessionStore = new ScopedClassroomStore();
  for (const trajectory of trajectories) {
    sessionStore.put(record("profile", trajectory.scope, "current", {
      evidence_state: trajectory.observations.at(-1)?.evidence_state
    }));
    sessionStore.put(record("transcript", trajectory.scope, "turns", {
      synthetic_turn_count: trajectory.observations.length
    }));
    sessionStore.put(record("intervention", trajectory.scope, "memory", {
      selected: trajectory.expected_intervention
    }));
    sessionStore.put(record("audit", trajectory.scope, "events", {
      event_count: trajectory.observations.length,
      raw_student_text_included: false
    }));
  }

  const fast = trajectories[0];
  const slow = trajectories[1];
  assert(fast && slow, "e2a40_expected_trajectories_missing");
  const fastProfile = `profile_${fast.scope.student_subject_id}_current`;
  const fastTranscript =
    `transcript_${fast.scope.student_subject_id}_turns`;
  const fastIntervention =
    `intervention_${fast.scope.student_subject_id}_memory`;
  const fastAudit = `audit_${fast.scope.student_subject_id}_events`;

  const session = resultSuite("multi_student_sessions", [
    {
      test_id: "six_unique_synthetic_students",
      passed:
        trajectories.length === 6 &&
        new Set(trajectories.map((item) =>
          item.scope.student_subject_id
        )).size === 6,
      evidence: trajectories.map((item) => item.scope.student_subject_id)
    },
    {
      test_id: "six_unique_sessions",
      passed:
        new Set(trajectories.map((item) => item.scope.session_id)).size === 6,
      evidence: trajectories.map((item) => item.scope.session_id)
    },
    {
      test_id: "all_sessions_share_only_classroom_identifier",
      passed:
        new Set(trajectories.map((item) =>
          item.scope.classroom_run_id
        )).size === 1 &&
        trajectories.every((item) =>
          item.scope.student_subject_id.startsWith("syn_student_")
        ),
      evidence: "synthetic_scopes_only"
    },
    {
      test_id: "per_student_event_sequence_preserved",
      passed: trajectories.every((trajectory) =>
        trajectory.observations.every((item, index) =>
          item.student_sequence === index + 1
        )
      ),
      evidence: canonical.map((item) => item.event_id)
    }
  ]);

  const profileIsolation = resultSuite("profile_isolation", [
    {
      test_id: "owner_can_read_own_profile",
      passed:
        sessionStore.read(fast.scope, fastProfile).scope.student_subject_id ===
        fast.scope.student_subject_id,
      evidence: "owner_read_allowed"
    },
    {
      test_id: "profile_leakage_denied",
      passed: didThrowIsolationBoundary(() =>
        sessionStore.read(slow.scope, fastProfile)
      ),
      evidence: "cross_student_profile_read_denied"
    },
    {
      test_id: "same_misconception_different_students_remain_isolated",
      passed:
        fast.scope.misconception_key === slow.scope.misconception_key &&
        studentSessionNamespace(fast.scope) !==
          studentSessionNamespace(slow.scope),
      evidence: "distinct_student_session_namespaces"
    },
    {
      test_id: "same_student_different_misconceptions_are_separate",
      passed: (() => {
        const alternate = {
          ...fast.scope,
          misconception_key: "validity_proves_reliability"
        };
        sessionStore.put(record("profile", alternate, "alternate", {
          evidence_state: "misconception"
        }));
        return didThrowIsolationBoundary(() =>
          sessionStore.read(
            fast.scope,
            `profile_${fast.scope.student_subject_id}_alternate`
          )
        );
      })(),
      evidence: "concept_and_misconception_scope_required"
    },
    {
      test_id: "foreign_student_reference_rejected_on_write",
      passed: didThrowIsolationBoundary(() =>
        sessionStore.put(record("profile", fast.scope, "contaminated", {
          copied_from_student: slow.scope.student_subject_id,
          copied_from_session: slow.scope.session_id
        }))
      ),
      evidence: "cross_student_payload_reference_denied"
    }
  ]);

  const transcriptIsolation = resultSuite("transcript_isolation", [
    {
      test_id: "owner_can_read_own_transcript",
      passed:
        sessionStore.read(fast.scope, fastTranscript).kind === "transcript",
      evidence: "owner_session_read_allowed"
    },
    {
      test_id: "transcript_leakage_denied",
      passed: didThrowIsolationBoundary(() =>
        sessionStore.read(slow.scope, fastTranscript)
      ),
      evidence: "cross_student_transcript_read_denied"
    },
    {
      test_id: "session_listing_contains_no_peer_records",
      passed: sessionStore.listForSession(fast.scope).every((item) =>
        item.scope.student_subject_id === fast.scope.student_subject_id &&
        item.scope.session_id === fast.scope.session_id
      ),
      evidence: "exact_student_session_projection"
    }
  ]);

  const interventionIsolation = resultSuite("intervention_isolation", [
    {
      test_id: "owner_can_read_own_intervention_memory",
      passed:
        sessionStore.read(fast.scope, fastIntervention).kind ===
        "intervention",
      evidence: "owner_evidence_scope_read_allowed"
    },
    {
      test_id: "intervention_leakage_denied",
      passed: didThrowIsolationBoundary(() =>
        sessionStore.read(slow.scope, fastIntervention)
      ),
      evidence: "cross_student_intervention_read_denied"
    },
    {
      test_id: "different_trajectories_select_different_interventions",
      passed:
        new Set(decisions.map((item) => item.intervention)).size === 6,
      evidence: decisions.map((item) => item.intervention)
    }
  ]);

  const orchestration = resultSuite("classroom_orchestration", [
    {
      test_id: "input_order_does_not_change_canonical_schedule",
      passed:
        stableClassroomHash(canonical) ===
        stableClassroomHash(canonicalReversed),
      evidence: stableClassroomHash(canonical)
    },
    {
      test_id: "rotated_concurrent_order_is_equivalent",
      passed:
        stableClassroomHash(canonical) ===
        stableClassroomHash(canonicalRotated),
      evidence: stableClassroomHash(canonicalRotated)
    },
    {
      test_id: "all_students_receive_independent_decisions",
      passed:
        decisions.length === 6 &&
        decisions.every((item) => item.matches_expected),
      evidence: decisions
    },
    {
      test_id: "one_failed_cross_read_does_not_mutate_other_sessions",
      passed:
        didThrowIsolationBoundary(() =>
          sessionStore.read(slow.scope, fastProfile)
        ) &&
        sessionStore.listForSession(slow.scope).length === 4,
      evidence: "failure_isolated"
    }
  ]);

  const concurrentOrdering = resultSuite("concurrent_ordering", [
    {
      test_id: "logical_ticks_non_decreasing",
      passed: canonical.every((item, index) =>
        index === 0 ||
        (canonical[index - 1]?.logical_tick ?? 0) <= item.logical_tick
      ),
      evidence: canonical.map((item) => item.logical_tick)
    },
    {
      test_id: "per_session_sequence_monotonic_under_interleaving",
      passed: trajectories.every((trajectory) => {
        const sequence = canonical
          .filter((item) =>
            item.scope.session_id === trajectory.scope.session_id
          )
          .map((item) => item.student_sequence);
        return sequence.every((value, index) => value === index + 1);
      }),
      evidence: "all_six_session_sequences_monotonic"
    },
    {
      test_id: "duplicate_event_ids_fail_closed",
      passed: didThrowIsolationBoundary(() =>
        canonicalizeConcurrentObservations([
          allObservations[0] as ClassroomObservation,
          allObservations[0] as ClassroomObservation
        ])
      ),
      evidence: "duplicate_classroom_event_id"
    }
  ]);

  const personalization = resultSuite("personalization", [
    {
      test_id: "individualized_intervention_matches_each_trajectory",
      passed: decisions.every((item) => item.matches_expected),
      evidence: decisions
    },
    {
      test_id: "stopping_differences_reflect_session_evidence",
      passed:
        new Set(decisions.map((item) => item.stopping_decision)).size === 4,
      evidence: decisions.map((item) => ({
        trajectory_id: item.trajectory_id,
        stopping_decision: item.stopping_decision
      }))
    },
    {
      test_id: "same_misconception_does_not_force_same_support",
      passed:
        fast.scope.misconception_key === slow.scope.misconception_key &&
        decisions[0]?.intervention !== decisions[1]?.intervention,
      evidence: [
        decisions[0]?.intervention,
        decisions[1]?.intervention
      ]
    },
    {
      test_id: "no_stable_trait_or_aggregate_typology_claim",
      passed:
        buildPersonalizationEvaluationContractV1()
          .nonclaims.no_stable_learner_trait_inference &&
        buildPersonalizationEvaluationContractV1()
          .nonclaims.no_aggregate_learner_typology,
      evidence: "assessment_episode_evidence_only"
    }
  ]);

  const instructorBoundary = resultSuite("instructor_boundary", [
    {
      test_id: "persistent_barrier_receives_supportive_next_step",
      passed:
        decisions.find((item) =>
          item.trajectory_id ===
          "trajectory_persistent_high_confidence"
        )?.instructor_boundary ===
        "offer_supportive_instructor_next_step",
      evidence: "persistent_session_boundary"
    },
    {
      test_id: "fast_and_self_correction_sessions_do_not_cross_boundary",
      passed: decisions
        .filter((item) =>
          item.trajectory_id === "trajectory_fast_learner" ||
          item.trajectory_id === "trajectory_self_correction"
        )
        .every((item) => item.instructor_boundary === "not_reached"),
      evidence: "boundary_is_evidence_specific"
    },
    {
      test_id: "instructor_boundary_not_disclosed_as_internal_label",
      passed: trajectories.every((trajectory) =>
        !trajectory.student_facing_message.toLowerCase()
          .includes("instructor boundary")
      ),
      evidence: "student_copy_is_supportive_only"
    }
  ]);

  const privacyValidations = trajectories.map((trajectory) => ({
    trajectory_id: trajectory.trajectory_id,
    ...validateStudentFacingClassroomTextV1(
      trajectory.student_facing_message
    )
  }));
  const privacy = resultSuite("privacy_boundaries", [
    {
      test_id: "all_student_facing_messages_hide_internal_labels",
      passed: privacyValidations.every((item) => item.safe),
      evidence: privacyValidations.map((item) => ({
        trajectory_id: item.trajectory_id,
        safe: item.safe,
        blocked_labels: item.blocked_labels
      }))
    },
    {
      test_id: "unsafe_profile_label_is_rejected",
      passed: !validateStudentFacingClassroomTextV1(
        "Your engagement profile triggered an escalation."
      ).safe,
      evidence: "forbidden_labels_detected"
    },
    {
      test_id: "aggregate_contains_no_student_records",
      passed: (() => {
        const aggregate = buildPrivacySafeClassroomAggregate(trajectories);
        return !aggregate.contains_student_identifiers &&
          !aggregate.contains_transcripts &&
          !aggregate.contains_profiles &&
          !aggregate.contains_intervention_memory;
      })(),
      evidence: "deidentified_counts_only"
    }
  ]);

  const auditIsolation = resultSuite("audit_isolation", [
    {
      test_id: "owner_can_read_own_audit",
      passed: sessionStore.read(fast.scope, fastAudit).kind === "audit",
      evidence: "owner_session_audit_read_allowed"
    },
    {
      test_id: "audit_leakage_denied",
      passed: didThrowIsolationBoundary(() =>
        sessionStore.read(slow.scope, fastAudit)
      ),
      evidence: "cross_student_audit_read_denied"
    },
    {
      test_id: "audit_payload_contains_counts_not_transcripts",
      passed: sessionStore.snapshot()
        .filter((item) => item.kind === "audit")
        .every((item) =>
          item.payload.raw_student_text_included === false &&
          !("message_text" in item.payload)
        ),
      evidence: "no_raw_student_text_in_audit_fixture"
    }
  ]);

  sessionStore.put(record("closure", fast.scope, "episode", {
    closed: true
  }));
  const closureIsolation = resultSuite("closure_isolation", [
    {
      test_id: "closure_record_is_owned_by_one_session",
      passed:
        sessionStore.listForSession(fast.scope)
          .filter((item) => item.kind === "closure").length === 1,
      evidence: "fast_session_closed"
    },
    {
      test_id: "closure_leakage_denied",
      passed: didThrowIsolationBoundary(() =>
        sessionStore.read(
          slow.scope,
          `closure_${fast.scope.student_subject_id}_episode`
        )
      ),
      evidence: "cross_student_closure_read_denied"
    },
    {
      test_id: "closing_one_session_does_not_close_peers",
      passed: trajectories.slice(1).every((trajectory) =>
        sessionStore.listForSession(trajectory.scope)
          .every((item) => item.kind !== "closure")
      ),
      evidence: "five_peer_sessions_unmodified"
    }
  ]);

  const suites = {
    session,
    profile_isolation: profileIsolation,
    transcript_isolation: transcriptIsolation,
    intervention_isolation: interventionIsolation,
    classroom_orchestration: orchestration,
    concurrent_ordering: concurrentOrdering,
    personalization,
    instructor_boundary: instructorBoundary,
    privacy,
    audit_isolation: auditIsolation,
    closure_isolation: closureIsolation
  };

  const requestedRegressionIds = [
    "profile_leakage",
    "transcript_leakage",
    "intervention_leakage",
    "same_misconception_different_students",
    "same_student_different_misconceptions",
    "cross_student_payload_reference",
    "concurrent_ordering",
    "closure_isolation"
  ];
  const regressionEvidence = [
    profileIsolation.tests[1]?.passed,
    transcriptIsolation.tests[1]?.passed,
    interventionIsolation.tests[1]?.passed,
    profileIsolation.tests[2]?.passed,
    profileIsolation.tests[3]?.passed,
    profileIsolation.tests[4]?.passed,
    concurrentOrdering.passed,
    closureIsolation.passed
  ];
  const regressions = resultSuite(
    "required_isolation_regressions",
    requestedRegressionIds.map((test_id, index) => ({
      test_id,
      passed: regressionEvidence[index] === true,
      evidence: "fail_closed_or_scope_preserved"
    }))
  );
  return {
    decisions,
    canonical_schedule: canonical.map((item) => ({
      event_id: item.event_id,
      logical_tick: item.logical_tick,
      student_subject_id: item.scope.student_subject_id,
      session_id: item.scope.session_id,
      student_sequence: item.student_sequence
    })),
    suites,
    regressions,
    passed:
      Object.values(suites).every((suite) => suite.passed) &&
      regressions.passed
  };
}

function buildBudget() {
  return {
    budget_version: E2A40_BUDGET_VERSION,
    synthetic_student_count: 6,
    maximum_concurrent_synthetic_sessions: 6,
    maximum_provider_calls: 0,
    maximum_network_requests: 0,
    maximum_input_tokens: 0,
    maximum_output_tokens: 0,
    maximum_cost_usd: 0,
    provider_concurrency: 0,
    no_live_execution: true
  } as const;
}

function buildArtifactContract() {
  return {
    artifact_contract_version: E2A40_ARTIFACT_CONTRACT_VERSION,
    required_artifacts: [...E2A40_ARTIFACT_NAMES],
    immutable_after_write: true,
    synthetic_data_only: true,
    raw_provider_outputs_required: false,
    raw_student_data_permitted: false,
    provider_calls_required: 0,
    network_requests_required: 0
  } as const;
}

function buildCandidateIntegrity() {
  const relativePath =
    "config/candidate-operational-agent-config.e2a24-autonomous-formative-dialogue-v1.json";
  const actual = fileSha256(relativePath);
  return {
    integrity_version: "e2a40-candidate-integrity-v1",
    relative_path: relativePath,
    expected_sha256:
      PROTECTED_SOURCE_HASHES[relativePath],
    actual_sha256: actual,
    candidate_configuration_hash: CANDIDATE_CONFIGURATION_HASH,
    candidate_modified: false,
    passed: actual === PROTECTED_SOURCE_HASHES[relativePath]
  };
}

function buildProtectedSourceIntegrity() {
  const actual = Object.fromEntries(
    Object.keys(PROTECTED_SOURCE_HASHES).map((relativePath) => [
      relativePath,
      fileSha256(relativePath)
    ])
  );
  const mismatches = Object.entries(PROTECTED_SOURCE_HASHES)
    .filter(([relativePath, expected]) =>
      actual[relativePath] !== expected
    )
    .map(([relativePath, expected]) => ({
      relative_path: relativePath,
      expected_sha256: expected,
      actual_sha256: actual[relativePath] ?? null
    }));
  return {
    integrity_version: "e2a40-protected-source-integrity-v1",
    expected_sha256: PROTECTED_SOURCE_HASHES,
    actual_sha256: actual,
    mismatches,
    protected_components_modified: false,
    passed: mismatches.length === 0
  };
}

function buildComponentBindings(
  protectedIntegrity: ReturnType<typeof buildProtectedSourceIntegrity>
) {
  return {
    binding_version: "e2a40-component-contract-bindings-v1",
    predecessor: {
      commit: PREDECESSOR_COMMIT,
      protocol_hash: PREDECESSOR_PROTOCOL_HASH,
      composite_runtime_identity: PREDECESSOR_COMPOSITE_IDENTITY
    },
    candidate_configuration_hash: CANDIDATE_CONFIGURATION_HASH,
    protected_source_hashes: protectedIntegrity.actual_sha256,
    new_contract_versions: {
      multi_student_session: MULTI_STUDENT_SESSION_CONTRACT_VERSION,
      profile_isolation: PROFILE_ISOLATION_CONTRACT_VERSION,
      intervention_memory_isolation:
        INTERVENTION_MEMORY_ISOLATION_CONTRACT_VERSION,
      classroom_orchestration: CLASSROOM_ORCHESTRATION_CONTRACT_VERSION,
      privacy_boundary: CLASSROOM_PRIVACY_BOUNDARY_VERSION,
      personalization_evaluation:
        PERSONALIZATION_EVALUATION_CONTRACT_VERSION
    },
    new_implementation_hashes: {
      classroom_isolation_contracts: fileSha256(
        "src/lib/evaluation/formative/e2a40-classroom-isolation-contracts.ts"
      ),
      classroom_isolation_protocol: fileSha256(
        "src/lib/evaluation/formative/e2a40-classroom-isolation-protocol.ts"
      ),
      no_network_cli: fileSha256(
        "prisma/formative-evaluation-e2a40.ts"
      )
    },
    protected_components_modified: false
  };
}

function buildProviderCallGuard(networkRequestCount: number) {
  return {
    guard_version: "e2a40-provider-call-guard-v1",
    provider_client_created: false,
    provider_dispatch_path_present: false,
    live_entrypoint_present: false,
    provider_calls_made: 0,
    network_requests_made: networkRequestCount,
    e2a40_execution_authorized: false,
    e2a40_live_execution_performed: false,
    passed: networkRequestCount === 0
  };
}

function buildProtocol(input: {
  heldOutDomain: ReturnType<typeof buildHeldOutDomain>;
  contracts: ReturnType<typeof buildContracts>;
  componentBindings: ReturnType<typeof buildComponentBindings>;
  trajectories: ClassroomStudentTrajectory[];
  budget: ReturnType<typeof buildBudget>;
  artifactContract: ReturnType<typeof buildArtifactContract>;
}) {
  const core = {
    protocol_version: E2A40_PROTOCOL_VERSION,
    status: "frozen_no_live_execution",
    held_out_domain: input.heldOutDomain,
    contract_hashes: Object.fromEntries(
      Object.entries(input.contracts).map(([name, contract]) => [
        name,
        stableHash(contract)
      ])
    ),
    component_bindings_hash: stableHash(input.componentBindings),
    trajectory_definitions_hash: stableClassroomHash(input.trajectories),
    budget_hash: stableHash(input.budget),
    artifact_contract_hash: stableHash(input.artifactContract),
    authority: {
      orchestration_owns_concurrency_and_isolation: true,
      existing_runtime_components_unchanged: true,
      per_student_state_is_authoritative: true,
      synthetic_results_do_not_establish_classroom_validity: true
    },
    execution: {
      authorized: false,
      executable: false,
      live_entrypoint_present: false,
      provider_dispatch_available: false,
      provider_calls_made: 0,
      network_requests_made: 0
    }
  };
  return {
    ...core,
    protocol_hash: stableHash(core)
  };
}

function buildContracts() {
  return {
    multi_student_session: buildMultiStudentSessionContractV1(),
    profile_isolation: buildProfileIsolationContractV1(),
    intervention_memory_isolation:
      buildInterventionMemoryIsolationContractV1(),
    classroom_orchestration: buildClassroomOrchestrationContractV1(),
    privacy_boundary: buildClassroomPrivacyBoundaryV1(),
    personalization_evaluation:
      buildPersonalizationEvaluationContractV1()
  };
}

function buildCompositeRuntimeIdentity(input: {
  protocol: ReturnType<typeof buildProtocol>;
  bindings: ReturnType<typeof buildComponentBindings>;
  protectedIntegrity: ReturnType<typeof buildProtectedSourceIntegrity>;
}) {
  const core = {
    identity_version: E2A40_COMPOSITE_IDENTITY_VERSION,
    protocol_hash: input.protocol.protocol_hash,
    candidate_configuration_hash: CANDIDATE_CONFIGURATION_HASH,
    component_bindings_hash: stableHash(input.bindings),
    protected_source_hashes: input.protectedIntegrity.actual_sha256,
    classroom_contract_versions: {
      multi_student_session: MULTI_STUDENT_SESSION_CONTRACT_VERSION,
      profile_isolation: PROFILE_ISOLATION_CONTRACT_VERSION,
      intervention_memory_isolation:
        INTERVENTION_MEMORY_ISOLATION_CONTRACT_VERSION,
      classroom_orchestration: CLASSROOM_ORCHESTRATION_CONTRACT_VERSION,
      privacy_boundary: CLASSROOM_PRIVACY_BOUNDARY_VERSION,
      personalization_evaluation:
        PERSONALIZATION_EVALUATION_CONTRACT_VERSION
    }
  };
  return {
    ...core,
    composite_runtime_identity_hash: stableHash(core)
  };
}

export function buildE2A40FreezeArtifacts(networkRequestCount = 0) {
  const heldOutDomain = buildHeldOutDomain();
  const contracts = buildContracts();
  const trajectories = buildSixStudentTrajectories();
  const deterministic = buildDeterministicResults(trajectories);
  const aggregate = buildPrivacySafeClassroomAggregate(trajectories);
  const budget = buildBudget();
  const artifactContract = buildArtifactContract();
  const candidateIntegrity = buildCandidateIntegrity();
  const protectedIntegrity = buildProtectedSourceIntegrity();
  const componentBindings = buildComponentBindings(protectedIntegrity);
  const providerCallGuard = buildProviderCallGuard(networkRequestCount);
  assert(providerCallGuard.passed, "e2a40_provider_call_guard_failed");
  const protocol = buildProtocol({
    heldOutDomain,
    contracts,
    componentBindings,
    trajectories,
    budget,
    artifactContract
  });
  const compositeRuntimeIdentity = buildCompositeRuntimeIdentity({
    protocol,
    bindings: componentBindings,
    protectedIntegrity
  });
  const suites = Object.values(deterministic.suites);
  const regressionCount = suites.reduce(
    (sum, suite) => sum + suite.test_count,
    deterministic.regressions.test_count
  );
  const metrics = {
    metrics_version: "e2a40-deterministic-metrics-v1",
    synthetic_students: trajectories.length,
    synthetic_sessions: trajectories.length,
    trajectory_kinds: new Set(trajectories.map((item) => item.kind)).size,
    individualized_interventions:
      new Set(deterministic.decisions.map((item) =>
        item.intervention
      )).size,
    stopping_decisions_observed:
      new Set(deterministic.decisions.map((item) =>
        item.stopping_decision
      )).size,
    deterministic_regression_count: regressionCount,
    isolation_failures: 0,
    student_facing_privacy_failures: 0,
    provider_calls: 0,
    network_requests: networkRequestCount,
    passed:
      trajectories.length === 6 &&
      deterministic.passed &&
      candidateIntegrity.passed &&
      protectedIntegrity.passed &&
      providerCallGuard.passed
  };
  assert(metrics.passed, "e2a40_metrics_failed");
  const summary = {
    status: "e2a40_protocol_frozen_no_live_execution",
    passed: true,
    protocol_version: protocol.protocol_version,
    protocol_hash: protocol.protocol_hash,
    composite_runtime_identity_hash:
      compositeRuntimeIdentity.composite_runtime_identity_hash,
    synthetic_student_count: trajectories.length,
    deterministic_regression_count: regressionCount,
    candidate_approved: false,
    candidate_activated: false,
    e2a40_execution_authorized: false,
    e2a40_live_execution_performed: false,
    provider_calls_made: 0,
    network_requests_made: networkRequestCount,
    classroom_validity_claimed: false,
    real_student_data_used: false
  };
  const manifest = {
    manifest_version: "e2a40-freeze-manifest-v1",
    generated_at: new Date().toISOString(),
    application_git_commit: currentGitCommit(),
    protocol_hash: protocol.protocol_hash,
    composite_runtime_identity_hash:
      compositeRuntimeIdentity.composite_runtime_identity_hash,
    artifact_names: [...E2A40_ARTIFACT_NAMES],
    no_live_execution: true,
    synthetic_data_only: true
  };
  return {
    manifest,
    protocol,
    heldOutDomain,
    contracts,
    trajectories,
    deterministic,
    aggregate,
    metrics,
    budget,
    artifactContract,
    candidateIntegrity,
    protectedIntegrity,
    componentBindings,
    compositeRuntimeIdentity,
    providerCallGuard,
    summary
  };
}

function artifactValues(
  artifacts: ReturnType<typeof buildE2A40FreezeArtifacts>
): Record<string, unknown> {
  return {
    "freeze-manifest.json": artifacts.manifest,
    "frozen-protocol.json": artifacts.protocol,
    "frozen-protocol.sha256": `${artifacts.protocol.protocol_hash}\n`,
    "held-out-domain.json": artifacts.heldOutDomain,
    "component-contract-bindings.json": artifacts.componentBindings,
    "multi-student-session-contract.json":
      artifacts.contracts.multi_student_session,
    "profile-isolation-contract.json":
      artifacts.contracts.profile_isolation,
    "intervention-memory-isolation-contract.json":
      artifacts.contracts.intervention_memory_isolation,
    "classroom-orchestration-contract.json":
      artifacts.contracts.classroom_orchestration,
    "privacy-boundary-contract.json":
      artifacts.contracts.privacy_boundary,
    "personalization-evaluation-contract.json":
      artifacts.contracts.personalization_evaluation,
    "six-student-trajectories.json": artifacts.trajectories,
    "session-test-results.json":
      artifacts.deterministic.suites.session,
    "profile-isolation-test-results.json":
      artifacts.deterministic.suites.profile_isolation,
    "transcript-isolation-test-results.json":
      artifacts.deterministic.suites.transcript_isolation,
    "intervention-isolation-test-results.json":
      artifacts.deterministic.suites.intervention_isolation,
    "classroom-orchestration-test-results.json":
      artifacts.deterministic.suites.classroom_orchestration,
    "concurrent-ordering-test-results.json":
      artifacts.deterministic.suites.concurrent_ordering,
    "personalization-test-results.json":
      artifacts.deterministic.suites.personalization,
    "instructor-boundary-test-results.json":
      artifacts.deterministic.suites.instructor_boundary,
    "privacy-test-results.json":
      artifacts.deterministic.suites.privacy,
    "audit-isolation-test-results.json":
      artifacts.deterministic.suites.audit_isolation,
    "closure-isolation-test-results.json":
      artifacts.deterministic.suites.closure_isolation,
    "deterministic-regression-results.json":
      artifacts.deterministic.regressions,
    "privacy-safe-aggregate.json": artifacts.aggregate,
    "metrics.json": artifacts.metrics,
    "budget.json": artifacts.budget,
    "artifact-contract.json": artifacts.artifactContract,
    "candidate-integrity.json": artifacts.candidateIntegrity,
    "protected-source-integrity.json": artifacts.protectedIntegrity,
    "composite-runtime-identity.json":
      artifacts.compositeRuntimeIdentity,
    "provider-call-guard.json": artifacts.providerCallGuard,
    "summary.json": artifacts.summary
  };
}

function validateArtifactDirectory(runDirectory: string) {
  const expected = new Set(E2A40_ARTIFACT_NAMES);
  const actual = readdirSync(runDirectory).sort();
  const missing = [...expected].filter((name) => !actual.includes(name));
  const unexpected = actual.filter((name) => !expected.has(
    name as (typeof E2A40_ARTIFACT_NAMES)[number]
  ));
  const protocol = readJson<{ protocol_hash: string }>(
    path.join(runDirectory, "frozen-protocol.json")
  );
  const protocolHashFile = readFileSync(
    path.join(runDirectory, "frozen-protocol.sha256"),
    "utf8"
  ).trim();
  const summary = readJson<{
    passed: boolean;
    provider_calls_made: number;
    network_requests_made: number;
    real_student_data_used: boolean;
  }>(path.join(runDirectory, "summary.json"));
  const validation = {
    validation_version: "e2a40-artifact-validation-v1",
    expected_artifact_count: E2A40_ARTIFACT_NAMES.length,
    actual_artifact_count_before_validation: actual.length,
    missing_artifacts: missing,
    unexpected_artifacts: unexpected,
    protocol_hash_matches:
      protocol.protocol_hash === protocolHashFile,
    provider_calls_made: summary.provider_calls_made,
    network_requests_made: summary.network_requests_made,
    real_student_data_used: summary.real_student_data_used,
    artifacts: actual.map((name) => ({
      name,
      sha256: sha256(readFileSync(path.join(runDirectory, name))),
      size_bytes: statSync(path.join(runDirectory, name)).size
    })),
    passed:
      missing.length === 1 &&
      missing[0] === "artifact-validation.json" &&
      unexpected.length === 0 &&
      protocol.protocol_hash === protocolHashFile &&
      summary.passed &&
      summary.provider_calls_made === 0 &&
      summary.network_requests_made === 0 &&
      !summary.real_student_data_used
  };
  return validation;
}

export function writeE2A40FreezeArtifacts(input: {
  runDirectory: string;
  networkRequestCount?: number;
}) {
  assert(
    !existsSync(input.runDirectory),
    "e2a40_artifact_directory_already_exists"
  );
  mkdirSync(input.runDirectory, { recursive: true });
  const artifacts = buildE2A40FreezeArtifacts(
    input.networkRequestCount ?? 0
  );
  for (const [name, value] of Object.entries(artifactValues(artifacts))) {
    if (name === "frozen-protocol.sha256") {
      writeFileSync(path.join(input.runDirectory, name), value as string,
        "utf8");
    } else {
      writeJson(path.join(input.runDirectory, name), value);
    }
  }
  const artifactValidation = validateArtifactDirectory(input.runDirectory);
  assert(artifactValidation.passed, "e2a40_artifact_validation_failed");
  writeJson(
    path.join(input.runDirectory, "artifact-validation.json"),
    artifactValidation
  );
  for (const name of E2A40_ARTIFACT_NAMES) {
    chmodSync(path.join(input.runDirectory, name), 0o444);
  }
  chmodSync(input.runDirectory, 0o555);
  return {
    ...artifacts,
    artifactValidation: {
      ...artifactValidation,
      final_artifact_count: readdirSync(input.runDirectory).length
    }
  };
}

export function makeE2A40FreezeRunId() {
  return `e2a40_${new Date().toISOString().replace(/[-:.]/gu, "")}_${
    randomBytes(4).toString("hex")
  }`;
}

export function latestE2A40FreezeRunDirectory() {
  assert(existsSync(E2A40_ARTIFACT_ROOT), "e2a40_artifact_root_missing");
  const latest = readdirSync(E2A40_ARTIFACT_ROOT)
    .filter((name) =>
      statSync(path.join(E2A40_ARTIFACT_ROOT, name)).isDirectory()
    )
    .sort()
    .at(-1);
  assert(latest, "e2a40_freeze_run_missing");
  return path.join(E2A40_ARTIFACT_ROOT, latest);
}

export function inspectE2A40FreezeRun(runDirectory: string) {
  const summary = readJson<JsonRecord>(
    path.join(runDirectory, "summary.json")
  );
  const validation = readJson<JsonRecord>(
    path.join(runDirectory, "artifact-validation.json")
  );
  return {
    run_directory: path.relative(process.cwd(), runDirectory),
    summary,
    artifact_validation: validation
  };
}
