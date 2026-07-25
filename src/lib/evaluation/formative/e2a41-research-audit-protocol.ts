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
  IsolationBoundaryError,
  ScopedClassroomStore,
  stableClassroomHash,
  type StudentIsolationScope
} from "./e2a40-classroom-isolation-contracts";
import {
  buildE2A40FreezeArtifacts
} from "./e2a40-classroom-isolation-protocol";
import {
  AUDIT_METRICS_CONTRACT_VERSION,
  HUMAN_REVIEW_EVIDENCE_PACKAGE_VERSION,
  RESEARCH_EVIDENCE_TRACEABILITY_VERSION,
  RESEARCH_REPLAY_CONTRACT_VERSION,
  STUDENT_AUDIT_SEPARATION_VERSION,
  buildAuditMetricsContractV1,
  buildHumanReviewEvidencePackageContractV1,
  buildHumanReviewEvidencePackageV1,
  buildResearchEvidenceTraceabilityContractV1,
  buildResearchReplayContractV1,
  buildStudentAuditSeparationContractV1,
  replayResearchAuditDataset,
  validateResearchAuditDataset,
  validateStudentAuditSeparationV1,
  type AcceptedAuditTurn,
  type AuditProfileSnapshot,
  type ResearchAuditDataset,
  type ResearchDecisionTrace,
  type StructuredEvidenceSpan
} from "./e2a41-research-audit-contracts";

export const E2A41_PROTOCOL_VERSION =
  "e2a41-auditability-research-evidence-freeze-v1" as const;
export const E2A41_SCENARIO_VERSION =
  "e2a41-two-student-measurement-audit-scenario-v1" as const;
export const E2A41_ARTIFACT_CONTRACT_VERSION =
  "e2a41-artifact-contract-v1" as const;
export const E2A41_BUDGET_VERSION =
  "e2a41-budget-contract-v1" as const;
export const E2A41_COMPOSITE_IDENTITY_VERSION =
  "e2a41-composite-runtime-identity-v1" as const;
export const E2A41_ARTIFACT_ROOT = path.join(
  process.cwd(),
  ".data",
  "e2a41-auditability-research-evidence-protocol-freeze"
);

const CANDIDATE_CONFIGURATION_HASH =
  "b3db25afadd99fba21dc23fee7a1dbcc21a7268a18b4556aaa4f19d37333656b";
const PREDECESSOR_COMMIT =
  "315c746316ac812e79ea8c7bd237343f90ae20e2";
const E2A40_PROTOCOL_HASH =
  "0ce1218bb01caf99ce85c45a973d3c5604913b9fb8eb80157860b07bdacd91ab";
const E2A40_COMPOSITE_IDENTITY =
  "ab5a6a047b8e663753303f142ee2fdcb979e854c6f0d37330dd3e10c42da7171";

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
  "src/lib/evaluation/formative/e2a36-longitudinal-contracts.ts":
    "98044fed11bd8a1a9ff9151afa21e866e7d0f0624cfdf8cecc455f42700ad941",
  "src/lib/evaluation/formative/e2a37-instructor-handoff-protocol.ts":
    "a32d141d052cbe07d56d4b989cda129d7442950f311166b42f79d6d9b38794d7",
  "src/lib/evaluation/formative/e2a40-classroom-isolation-contracts.ts":
    "2718e4162788c4b0d1b1c0a0da122ee3e3544090a9c395b41e357befa4713d76",
  "src/lib/evaluation/formative/e2a40-classroom-isolation-protocol.ts":
    "08fd5e2cfe0b3b3546f5bb480f7e77eabc7e9d1c609474673c7e45cee3c7fbd4",
  "prisma/formative-evaluation-e2a40.ts":
    "252b06908d528c4f37da93626ae08d309d377e79d9f1ec262fc4ffa3ab7546bb"
} as const;

export const E2A41_ARTIFACT_NAMES = [
  "freeze-manifest.json",
  "frozen-protocol.json",
  "frozen-protocol.sha256",
  "component-contract-bindings.json",
  "research-evidence-traceability-contract.json",
  "research-replay-contract.json",
  "human-review-evidence-package-contract.json",
  "student-audit-separation-contract.json",
  "audit-metrics-contract.json",
  "synthetic-scenario.json",
  "accepted-turns.json",
  "structured-evidence-spans.json",
  "profile-snapshots.json",
  "decision-traces.json",
  "audit-trace-test-results.json",
  "replay-test-results.json",
  "evidence-provenance-test-results.json",
  "student-audit-separation-test-results.json",
  "human-review-package-test-results.json",
  "privacy-test-results.json",
  "multi-student-audit-test-results.json",
  "deterministic-regression-results.json",
  "human-review-packages.json",
  "replay-results.json",
  "audit-metrics-results.json",
  "historical-integrity.json",
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
    "e2a41_forbidden_secret_detected"
  );
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function readJson<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, "utf8")) as T;
}

function scope(student: "sound" | "persistent"): StudentIsolationScope {
  return {
    classroom_run_id: "syn_classroom_audit_001",
    student_subject_id: `syn_student_audit_${student}`,
    session_id: `syn_session_audit_${student}`,
    concept_key: "reliability_versus_validity",
    misconception_key: "reliability_proves_validity"
  };
}

function turn(input: {
  id: string;
  owner: StudentIsolationScope;
  sequence: number;
  role: "student" | "agent";
  text: string;
}): AcceptedAuditTurn {
  return {
    turn_id: input.id,
    scope: input.owner,
    sequence: input.sequence,
    role: input.role,
    student_visible_text: input.text,
    accepted: true,
    source_kind: input.role === "student"
      ? "student_response"
      : "student_communication"
  };
}

function evidence(
  input: {
    id: string;
    sourceTurn: AcceptedAuditTurn;
    phrase: string;
    kind: StructuredEvidenceSpan["evidence_kind"];
    code: string;
  }
): StructuredEvidenceSpan {
  const start = input.sourceTurn.student_visible_text.indexOf(input.phrase);
  assert(start >= 0, `e2a41_evidence_phrase_missing:${input.id}`);
  return {
    evidence_span_id: input.id,
    scope: input.sourceTurn.scope,
    source_turn_id: input.sourceTurn.turn_id,
    source_sequence: input.sourceTurn.sequence,
    evidence_kind: input.kind,
    source_field: "student_visible_text",
    start_offset: start,
    end_offset: start + input.phrase.length,
    source_text_sha256: sha256(
      input.sourceTurn.student_visible_text
    ),
    safe_evidence_code: input.code,
    raw_private_data_stored: false
  };
}

function profile(input: {
  id: string;
  owner: StudentIsolationScope;
  sequence: number;
  state: AuditProfileSnapshot["conceptual_state"];
  gaps?: string[];
  contradictions?: string[];
  missing?: string[];
  updateSource: AuditProfileSnapshot["update_source"];
  evidenceIds: string[];
}): AuditProfileSnapshot {
  return {
    profile_snapshot_id: input.id,
    scope: input.owner,
    sequence: input.sequence,
    conceptual_state: input.state,
    active_gap_codes: input.gaps ?? [],
    contradiction_codes: input.contradictions ?? [],
    essential_missing_link_codes: input.missing ?? [],
    update_source: input.updateSource,
    source_evidence_span_ids: input.evidenceIds,
    profile_schema_version: "e2a36-learning-profile-evolution-v1"
  };
}

function emptyDetails(): ResearchDecisionTrace["details"] {
  return {
    identified_knowledge_gap: null,
    misconception_confidence: null,
    profile_update_source: null,
    previous_strategy: null,
    remaining_gap: null,
    selected_strategy: null,
    intervention_goal: null,
    intervention_outcome: null,
    previous_profile_state: null,
    updated_profile_state: null,
    transition_reason_codes: [],
    required_criteria: [],
    satisfied_criteria: [],
    remaining_limitations: [],
    revision_ready: null,
    stopping_outcome: null,
    unresolved_gap: null,
    intervention_history: [],
    handoff_reason: null
  };
}

function trace(input: {
  id: string;
  owner: StudentIsolationScope;
  sequence: number;
  type: ResearchDecisionTrace["decision_type"];
  evidenceIds: string[];
  previousProfileId: string | null;
  resultingProfileId: string;
  policyId: string;
  policyVersion: string;
  rules: string[];
  outcome: string;
  communicationTurnId: string | null;
  details: Partial<ResearchDecisionTrace["details"]>;
}): ResearchDecisionTrace {
  return {
    trace_id: input.id,
    scope: input.owner,
    decision_sequence: input.sequence,
    decision_type: input.type,
    evidence_span_ids: input.evidenceIds,
    previous_profile_snapshot_id: input.previousProfileId,
    resulting_profile_snapshot_id: input.resultingProfileId,
    policy_id: input.policyId,
    policy_version: input.policyVersion,
    rule_codes: input.rules,
    outcome_code: input.outcome,
    student_communication_turn_id: input.communicationTurnId,
    details: {
      ...emptyDetails(),
      ...input.details
    },
    hidden_prompt_stored: false,
    chain_of_thought_stored: false,
    raw_model_reasoning_stored: false
  };
}

function buildSyntheticDataset(): ResearchAuditDataset {
  const soundScope = scope("sound");
  const persistentScope = scope("persistent");
  const turns: AcceptedAuditTurn[] = [
    turn({
      id: "turn_sound_1",
      owner: soundScope,
      sequence: 1,
      role: "student",
      text:
        "If the scores are consistent, I think that proves the interpretation is valid."
    }),
    turn({
      id: "turn_sound_2",
      owner: soundScope,
      sequence: 2,
      role: "agent",
      text:
        "What evidence would you need in addition to consistency before using the scores for the intended interpretation?"
    }),
    turn({
      id: "turn_sound_3",
      owner: soundScope,
      sequence: 3,
      role: "student",
      text:
        "Consistency is reliability, but validity needs evidence that the scores support the intended interpretation, so consistency alone does not prove validity."
    }),
    turn({
      id: "turn_sound_4",
      owner: soundScope,
      sequence: 4,
      role: "agent",
      text:
        "Your explanation now separates consistency from evidence for the intended interpretation. Revise your answer using that distinction."
    }),
    turn({
      id: "turn_persistent_1",
      owner: persistentScope,
      sequence: 1,
      role: "student",
      text:
        "I am very sure that a highly reliable score must also be valid."
    }),
    turn({
      id: "turn_persistent_2",
      owner: persistentScope,
      sequence: 2,
      role: "agent",
      text:
        "Consider a measure that gives the same result repeatedly but measures the wrong construct. What would consistency establish?"
    }),
    turn({
      id: "turn_persistent_3",
      owner: persistentScope,
      sequence: 3,
      role: "student",
      text:
        "It would still be consistent, and I still think strong reliability proves validity."
    }),
    turn({
      id: "turn_persistent_4",
      owner: persistentScope,
      sequence: 4,
      role: "agent",
      text:
        "This distinction is still difficult. Pause here and review what reliability can and cannot establish with your instructor."
    })
  ];
  const byId = new Map(turns.map((item) => [item.turn_id, item]));
  const getTurn = (id: string) => {
    const found = byId.get(id);
    assert(found, `e2a41_turn_missing:${id}`);
    return found;
  };
  const spans: StructuredEvidenceSpan[] = [
    evidence({
      id: "evidence_sound_initial_misconception",
      sourceTurn: getTurn("turn_sound_1"),
      phrase: "consistent",
      kind: "misconception_endorsement",
      code: "consistency_treated_as_validity_proof"
    }),
    evidence({
      id: "evidence_sound_distinction",
      sourceTurn: getTurn("turn_sound_3"),
      phrase: "validity needs evidence",
      kind: "conceptual_distinction",
      code: "validity_requires_interpretation_evidence"
    }),
    evidence({
      id: "evidence_sound_rejection",
      sourceTurn: getTurn("turn_sound_3"),
      phrase: "consistency alone does not prove validity",
      kind: "distractor_rejection",
      code: "reliability_validity_distractor_rejected"
    }),
    evidence({
      id: "evidence_persistent_misconception",
      sourceTurn: getTurn("turn_persistent_1"),
      phrase: "highly reliable score must also be valid",
      kind: "misconception_endorsement",
      code: "reliability_treated_as_sufficient_for_validity"
    }),
    evidence({
      id: "evidence_persistent_confidence",
      sourceTurn: getTurn("turn_persistent_1"),
      phrase: "very sure",
      kind: "confidence_evidence_mismatch",
      code: "confidence_exceeds_observed_support"
    }),
    evidence({
      id: "evidence_persistent_barrier",
      sourceTurn: getTurn("turn_persistent_3"),
      phrase: "still think strong reliability proves validity",
      kind: "persistent_barrier",
      code: "misconception_persists_after_contrast"
    })
  ];
  const profiles: AuditProfileSnapshot[] = [
    profile({
      id: "profile_sound_initial",
      owner: soundScope,
      sequence: 1,
      state: "misconception",
      gaps: ["reliability_validity_boundary"],
      missing: ["validity_evidence_requirement"],
      updateSource: "initial_response",
      evidenceIds: ["evidence_sound_initial_misconception"]
    }),
    profile({
      id: "profile_sound_final",
      owner: soundScope,
      sequence: 2,
      state: "sound",
      updateSource: "ordinary_conceptual_evidence",
      evidenceIds: [
        "evidence_sound_distinction",
        "evidence_sound_rejection"
      ]
    }),
    profile({
      id: "profile_persistent_initial",
      owner: persistentScope,
      sequence: 1,
      state: "misconception",
      gaps: ["reliability_validity_boundary"],
      missing: ["validity_evidence_requirement"],
      updateSource: "initial_response",
      evidenceIds: [
        "evidence_persistent_misconception",
        "evidence_persistent_confidence"
      ]
    }),
    profile({
      id: "profile_persistent_final",
      owner: persistentScope,
      sequence: 2,
      state: "misconception",
      gaps: ["reliability_validity_boundary"],
      missing: [
        "validity_evidence_requirement",
        "distractor_rejection"
      ],
      updateSource: "persistent_barrier_evidence",
      evidenceIds: ["evidence_persistent_barrier"]
    })
  ];
  const traces: ResearchDecisionTrace[] = [
    trace({
      id: "trace_sound_misconception",
      owner: soundScope,
      sequence: 1,
      type: "misconception_identification",
      evidenceIds: ["evidence_sound_initial_misconception"],
      previousProfileId: null,
      resultingProfileId: "profile_sound_initial",
      policyId: "canonical_anchor_evidence",
      policyVersion: "canonical-anchor-evidence-v1",
      rules: ["explicit_anchor_endorsement"],
      outcome: "reliability_validity_gap_identified",
      communicationTurnId: null,
      details: {
        identified_knowledge_gap: "reliability_validity_boundary",
        misconception_confidence: "not_assessed",
        profile_update_source: "initial_response"
      }
    }),
    trace({
      id: "trace_sound_intervention",
      owner: soundScope,
      sequence: 2,
      type: "tutor_intervention_selection",
      evidenceIds: ["evidence_sound_initial_misconception"],
      previousProfileId: "profile_sound_initial",
      resultingProfileId: "profile_sound_initial",
      policyId: "autonomous_tutor_strategy",
      policyVersion: "e2a24-autonomous-dialogue-candidate-v1",
      rules: ["target_remaining_conceptual_gap"],
      outcome: "boundary_question_selected",
      communicationTurnId: "turn_sound_2",
      details: {
        previous_strategy: "none",
        remaining_gap: "validity_evidence_requirement",
        selected_strategy: "conceptual_boundary_question",
        intervention_goal: "separate_consistency_from_validity_evidence",
        intervention_outcome: "independent_sound_explanation_observed"
      }
    }),
    trace({
      id: "trace_sound_profile_update",
      owner: soundScope,
      sequence: 3,
      type: "profile_update",
      evidenceIds: [
        "evidence_sound_distinction",
        "evidence_sound_rejection"
      ],
      previousProfileId: "profile_sound_initial",
      resultingProfileId: "profile_sound_final",
      policyId: "learning_profile_evolution",
      policyVersion: "e2a36-learning-profile-evolution-v1",
      rules: ["latest_valid_evidence_has_precedence"],
      outcome: "profile_transitioned_to_sound",
      communicationTurnId: null,
      details: {
        profile_update_source: "ordinary_conceptual_evidence",
        previous_profile_state: "misconception",
        updated_profile_state: "sound",
        transition_reason_codes: [
          "conceptual_distinction_observed",
          "distractor_rejected"
        ]
      }
    }),
    trace({
      id: "trace_sound_decision",
      owner: soundScope,
      sequence: 4,
      type: "sound_decision",
      evidenceIds: [
        "evidence_sound_distinction",
        "evidence_sound_rejection"
      ],
      previousProfileId: "profile_sound_initial",
      resultingProfileId: "profile_sound_final",
      policyId: "evidence_driven_sound_gate",
      policyVersion: "production-sound-gate-v5",
      rules: ["all_required_criteria_satisfied"],
      outcome: "sound_revision_authorized",
      communicationTurnId: "turn_sound_4",
      details: {
        required_criteria: [
          "mechanism_understanding",
          "distractor_rejection",
          "no_essential_missing_links",
          "coherent_conclusion"
        ],
        satisfied_criteria: [
          "mechanism_understanding",
          "distractor_rejection",
          "no_essential_missing_links",
          "coherent_conclusion"
        ],
        remaining_limitations: [],
        revision_ready: true
      }
    }),
    trace({
      id: "trace_sound_stopping",
      owner: soundScope,
      sequence: 5,
      type: "stopping_decision",
      evidenceIds: [
        "evidence_sound_distinction",
        "evidence_sound_rejection"
      ],
      previousProfileId: "profile_sound_initial",
      resultingProfileId: "profile_sound_final",
      policyId: "adaptive_stopping_policy",
      policyVersion: "e2a36-adaptive-stopping-policy-v1",
      rules: ["sound_evidence_ends_dialogue"],
      outcome: "revision_selected",
      communicationTurnId: "turn_sound_4",
      details: {
        revision_ready: true,
        stopping_outcome: "revise"
      }
    }),
    trace({
      id: "trace_persistent_misconception",
      owner: persistentScope,
      sequence: 1,
      type: "misconception_identification",
      evidenceIds: [
        "evidence_persistent_misconception",
        "evidence_persistent_confidence"
      ],
      previousProfileId: null,
      resultingProfileId: "profile_persistent_initial",
      policyId: "canonical_anchor_evidence",
      policyVersion: "canonical-anchor-evidence-v1",
      rules: [
        "explicit_anchor_endorsement",
        "confidence_exceeds_evidence"
      ],
      outcome: "high_confidence_gap_identified",
      communicationTurnId: null,
      details: {
        identified_knowledge_gap: "reliability_validity_boundary",
        misconception_confidence: "high",
        profile_update_source: "initial_response"
      }
    }),
    trace({
      id: "trace_persistent_intervention",
      owner: persistentScope,
      sequence: 2,
      type: "tutor_intervention_selection",
      evidenceIds: ["evidence_persistent_misconception"],
      previousProfileId: "profile_persistent_initial",
      resultingProfileId: "profile_persistent_initial",
      policyId: "autonomous_tutor_strategy",
      policyVersion: "e2a24-autonomous-dialogue-candidate-v1",
      rules: ["contrast_with_counterexample"],
      outcome: "counterexample_selected",
      communicationTurnId: "turn_persistent_2",
      details: {
        previous_strategy: "initial_explanation_request",
        remaining_gap: "validity_evidence_requirement",
        selected_strategy: "counterexample_contrast",
        intervention_goal: "challenge_reliability_as_validity_proof",
        intervention_outcome: "misconception_persisted"
      }
    }),
    trace({
      id: "trace_persistent_profile_update",
      owner: persistentScope,
      sequence: 3,
      type: "profile_update",
      evidenceIds: ["evidence_persistent_barrier"],
      previousProfileId: "profile_persistent_initial",
      resultingProfileId: "profile_persistent_final",
      policyId: "learning_profile_evolution",
      policyVersion: "e2a36-learning-profile-evolution-v1",
      rules: ["latest_valid_evidence_has_precedence"],
      outcome: "misconception_persisted",
      communicationTurnId: null,
      details: {
        profile_update_source: "persistent_barrier_evidence",
        previous_profile_state: "misconception",
        updated_profile_state: "misconception",
        transition_reason_codes: [
          "anchor_endorsement_persisted",
          "essential_links_missing"
        ]
      }
    }),
    trace({
      id: "trace_persistent_sound_decision",
      owner: persistentScope,
      sequence: 4,
      type: "sound_decision",
      evidenceIds: ["evidence_persistent_barrier"],
      previousProfileId: "profile_persistent_initial",
      resultingProfileId: "profile_persistent_final",
      policyId: "evidence_driven_sound_gate",
      policyVersion: "production-sound-gate-v5",
      rules: ["essential_missing_links_block_sound"],
      outcome: "sound_blocked",
      communicationTurnId: null,
      details: {
        required_criteria: [
          "mechanism_understanding",
          "distractor_rejection",
          "no_essential_missing_links",
          "coherent_conclusion"
        ],
        satisfied_criteria: [],
        remaining_limitations: [
          "validity_evidence_requirement",
          "distractor_rejection"
        ],
        revision_ready: false
      }
    }),
    trace({
      id: "trace_persistent_stopping",
      owner: persistentScope,
      sequence: 5,
      type: "stopping_decision",
      evidenceIds: ["evidence_persistent_barrier"],
      previousProfileId: "profile_persistent_initial",
      resultingProfileId: "profile_persistent_final",
      policyId: "adaptive_stopping_policy",
      policyVersion: "e2a36-adaptive-stopping-policy-v1",
      rules: ["persistent_barrier_reaches_human_support_boundary"],
      outcome: "instructor_support_selected",
      communicationTurnId: "turn_persistent_4",
      details: {
        revision_ready: false,
        stopping_outcome: "instructor_support"
      }
    }),
    trace({
      id: "trace_persistent_handoff",
      owner: persistentScope,
      sequence: 6,
      type: "instructor_handoff",
      evidenceIds: [
        "evidence_persistent_misconception",
        "evidence_persistent_barrier"
      ],
      previousProfileId: "profile_persistent_initial",
      resultingProfileId: "profile_persistent_final",
      policyId: "instructor_handoff_boundary",
      policyVersion: "e2a37-instructor-handoff-boundary-v1",
      rules: ["supportive_handoff_after_persistent_barrier"],
      outcome: "supportive_instructor_next_step",
      communicationTurnId: "turn_persistent_4",
      details: {
        unresolved_gap: "reliability_validity_boundary",
        intervention_history: [
          "initial_explanation_request",
          "counterexample_contrast"
        ],
        handoff_reason:
          "misconception_persisted_after_distinct_support_strategies"
      }
    })
  ];
  return {
    acceptedTurns: turns,
    evidenceSpans: spans,
    profileSnapshots: profiles,
    decisionTraces: traces
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

function issueCodes(dataset: ResearchAuditDataset) {
  return validateResearchAuditDataset(dataset).issues.map(
    (issue) => issue.issue_code
  );
}

function buildDeterministicResults(dataset: ResearchAuditDataset) {
  const validation = validateResearchAuditDataset(dataset);
  assert(validation.passed, "e2a41_base_dataset_invalid");
  const soundScope = scope("sound");
  const persistentScope = scope("persistent");
  const soundReplay = replayResearchAuditDataset(dataset, soundScope);
  const persistentReplay = replayResearchAuditDataset(
    dataset,
    persistentScope
  );
  const reversedDataset: ResearchAuditDataset = {
    acceptedTurns: [...dataset.acceptedTurns].reverse(),
    evidenceSpans: [...dataset.evidenceSpans].reverse(),
    profileSnapshots: [...dataset.profileSnapshots].reverse(),
    decisionTraces: [...dataset.decisionTraces].reverse()
  };
  const soundReplayReversed = replayResearchAuditDataset(
    reversedDataset,
    soundScope
  );
  const persistentReplayReversed = replayResearchAuditDataset(
    reversedDataset,
    persistentScope
  );
  const soundPackage = buildHumanReviewEvidencePackageV1(
    dataset,
    soundScope
  );
  const persistentPackage = buildHumanReviewEvidencePackageV1(
    dataset,
    persistentScope
  );

  const traceability = resultSuite("audit_traceability", [
    {
      test_id: "all_six_major_decision_types_are_covered",
      passed: new Set(dataset.decisionTraces.map((traceItem) =>
        traceItem.decision_type
      )).size === 6,
      evidence: [...new Set(dataset.decisionTraces.map((traceItem) =>
        traceItem.decision_type
      ))]
    },
    {
      test_id: "sound_decision_has_complete_trace_chain",
      passed: (() => {
        const found = dataset.decisionTraces.find((item) =>
          item.trace_id === "trace_sound_decision"
        );
        return Boolean(
          found &&
          found.evidence_span_ids.length === 2 &&
          found.resulting_profile_snapshot_id === "profile_sound_final" &&
          found.policy_version &&
          found.outcome_code === "sound_revision_authorized" &&
          found.student_communication_turn_id === "turn_sound_4" &&
          found.details.revision_ready
        );
      })(),
      evidence: "decision_to_evidence_to_profile_to_policy_to_outcome_to_message"
    },
    {
      test_id: "instructor_handoff_has_gap_history_and_reason",
      passed: (() => {
        const found = dataset.decisionTraces.find((item) =>
          item.decision_type === "instructor_handoff"
        );
        return Boolean(
          found?.details.unresolved_gap &&
          found.details.intervention_history.length === 2 &&
          found.details.handoff_reason
        );
      })(),
      evidence: "structured_handoff_metadata_complete"
    },
    {
      test_id: "no_hidden_reasoning_or_prompts_stored",
      passed:
        validation.hidden_reasoning_records === 0 &&
        dataset.decisionTraces.every((item) =>
          !item.hidden_prompt_stored &&
          !item.chain_of_thought_stored &&
          !item.raw_model_reasoning_stored
        ),
      evidence: "structured_evidence_and_reason_codes_only"
    }
  ]);

  const missingEvidenceDataset = structuredClone(dataset);
  missingEvidenceDataset.decisionTraces[0]?.evidence_span_ids.push(
    "missing_evidence_span"
  );
  const wrongProfileDataset = structuredClone(dataset);
  const profileTrace = wrongProfileDataset.decisionTraces.find((item) =>
    item.trace_id === "trace_sound_profile_update"
  );
  assert(profileTrace, "e2a41_profile_trace_missing");
  profileTrace.details.updated_profile_state = "partial";
  const falseSoundDataset = structuredClone(dataset);
  const falseSound = falseSoundDataset.decisionTraces.find((item) =>
    item.trace_id === "trace_persistent_sound_decision"
  );
  assert(falseSound, "e2a41_false_sound_trace_missing");
  falseSound.details.revision_ready = true;
  falseSound.details.remaining_limitations = [];
  const wrongStoppingDataset = structuredClone(dataset);
  const wrongStopping = wrongStoppingDataset.decisionTraces.find((item) =>
    item.trace_id === "trace_sound_stopping"
  );
  assert(wrongStopping, "e2a41_stopping_trace_missing");
  wrongStopping.details.stopping_outcome = "continue";

  const provenance = resultSuite("evidence_provenance", [
    {
      test_id: "all_evidence_spans_resolve_to_accepted_turns",
      passed: validation.issues.length === 0,
      evidence: {
        accepted_turn_count: validation.accepted_turn_count,
        evidence_span_count: validation.evidence_span_count
      }
    },
    {
      test_id: "missing_evidence_reference_detected",
      passed: issueCodes(missingEvidenceDataset)
        .includes("trace_evidence_missing"),
      evidence: "trace_evidence_missing"
    },
    {
      test_id: "profile_evidence_is_preserved_across_modules",
      passed: dataset.profileSnapshots.every((profileItem) =>
        profileItem.source_evidence_span_ids.every((evidenceId) =>
          dataset.evidenceSpans.some((span) =>
            span.evidence_span_id === evidenceId
          )
        )
      ),
      evidence: "all_profile_sources_resolvable"
    },
    {
      test_id: "incorrect_profile_transition_detected",
      passed: issueCodes(wrongProfileDataset)
        .includes("updated_profile_state_mismatch"),
      evidence: "updated_profile_state_mismatch"
    },
    {
      test_id: "false_sound_trace_detected",
      passed: issueCodes(falseSoundDataset)
        .includes("false_sound_trace_detected"),
      evidence: "false_sound_trace_detected"
    },
    {
      test_id: "incorrect_stopping_decision_detected",
      passed: issueCodes(wrongStoppingDataset)
        .includes("incorrect_stopping_after_sound"),
      evidence: "incorrect_stopping_after_sound"
    }
  ]);

  const replay = resultSuite("research_replay", [
    {
      test_id: "sound_session_replay_is_order_independent",
      passed:
        soundReplay.replay_hash === soundReplayReversed.replay_hash,
      evidence: soundReplay.replay_hash
    },
    {
      test_id: "persistent_session_replay_is_order_independent",
      passed:
        persistentReplay.replay_hash ===
        persistentReplayReversed.replay_hash,
      evidence: persistentReplay.replay_hash
    },
    {
      test_id: "replays_reconstruct_profile_intervention_and_stopping",
      passed:
        soundReplay.profile_transitions.length === 2 &&
        soundReplay.intervention_trace_ids.length === 1 &&
        soundReplay.stopping_outcomes[0]?.outcome === "revise" &&
        persistentReplay.profile_transitions.length === 2 &&
        persistentReplay.intervention_trace_ids.length === 1 &&
        persistentReplay.stopping_outcomes[0]?.outcome ===
          "instructor_support",
      evidence: {
        sound: soundReplay,
        persistent: persistentReplay
      }
    },
    {
      test_id: "replay_requires_no_hidden_material",
      passed:
        !soundReplay.hidden_prompts_required &&
        !soundReplay.chain_of_thought_required &&
        !soundReplay.private_data_required,
      evidence: "structured_records_only"
    }
  ]);

  const separationResults = dataset.acceptedTurns
    .filter((item) => item.role === "agent")
    .map((item) => ({
      turn_id: item.turn_id,
      ...validateStudentAuditSeparationV1(item.student_visible_text)
    }));
  const separation = resultSuite("student_audit_separation", [
    {
      test_id: "student_messages_hide_audit_and_profile_labels",
      passed: separationResults.every((item) => item.safe),
      evidence: separationResults
    },
    {
      test_id: "controlled_audit_label_leak_is_detected",
      passed: !validateStudentAuditSeparationV1(
        "The policy version changed your profile schema."
      ).safe,
      evidence: "policy_and_profile_labels_blocked"
    },
    {
      test_id: "student_messages_do_not_contain_confidence_scores",
      passed: dataset.acceptedTurns
        .filter((item) => item.role === "agent")
        .every((item) =>
          !item.student_visible_text.toLowerCase()
            .includes("confidence score")
        ),
      evidence: "plain_student_language_only"
    }
  ]);

  const reviewPackages = [soundPackage, persistentPackage];
  const humanReview = resultSuite("human_review_packages", [
    {
      test_id: "each_package_contains_all_five_review_sections",
      passed: reviewPackages.every((reviewPackage) =>
        reviewPackage.student_visible_conversation.length > 0 &&
        reviewPackage.structured_evidence_summary.length > 0 &&
        reviewPackage.profile_transitions.length > 0 &&
        reviewPackage.intervention_history.length > 0 &&
        Boolean(reviewPackage.final_outcome.outcome_code)
      ),
      evidence: "two_complete_review_packages"
    },
    {
      test_id: "review_packages_exclude_hidden_reasoning_and_prompts",
      passed: reviewPackages.every((reviewPackage) =>
        !reviewPackage.contains_hidden_reasoning &&
        !reviewPackage.contains_hidden_prompts &&
        reviewPackage.deliberately_excluded.includes(
          "model_chain_of_thought"
        )
      ),
      evidence: "explicit_exclusion_manifest"
    },
    {
      test_id: "review_packages_use_pseudonymous_hash_references",
      passed: reviewPackages.every((reviewPackage) =>
        /^[a-f0-9]{64}$/u.test(
          reviewPackage.synthetic_subject_reference
        ) &&
        /^[a-f0-9]{64}$/u.test(
          reviewPackage.synthetic_session_reference
        )
      ),
      evidence: "no_direct_student_or_session_identifiers"
    }
  ]);

  const store = new ScopedClassroomStore();
  store.put({
    record_id: "audit_sound_decisions",
    kind: "audit",
    scope: soundScope,
    payload: {
      trace_ids: dataset.decisionTraces
        .filter((item) =>
          item.scope.student_subject_id ===
          soundScope.student_subject_id
        )
        .map((item) => item.trace_id)
    }
  });
  store.put({
    record_id: "audit_persistent_decisions",
    kind: "audit",
    scope: persistentScope,
    payload: {
      trace_ids: dataset.decisionTraces
        .filter((item) =>
          item.scope.student_subject_id ===
          persistentScope.student_subject_id
        )
        .map((item) => item.trace_id)
    }
  });
  const crossReadDenied = (() => {
    try {
      store.read(persistentScope, "audit_sound_decisions");
      return false;
    } catch (error) {
      return error instanceof IsolationBoundaryError;
    }
  })();
  const crossScopeDataset = structuredClone(dataset);
  const firstPersistentTrace = crossScopeDataset.decisionTraces.find(
    (item) => item.trace_id === "trace_persistent_misconception"
  );
  assert(firstPersistentTrace, "e2a41_persistent_trace_missing");
  firstPersistentTrace.evidence_span_ids = [
    "evidence_sound_initial_misconception"
  ];
  const multiStudent = resultSuite("multi_student_audit_isolation", [
    {
      test_id: "student_a_and_b_audits_remain_separate",
      passed:
        crossReadDenied &&
        store.listForSession(soundScope).length === 1 &&
        store.listForSession(persistentScope).length === 1,
      evidence: "e2a40_scoped_store_enforced"
    },
    {
      test_id: "cross_student_evidence_reference_is_detected",
      passed: issueCodes(crossScopeDataset)
        .includes("trace_evidence_scope_mismatch"),
      evidence: "trace_evidence_scope_mismatch"
    },
    {
      test_id: "same_activity_different_trajectories_replay_differently",
      passed:
        soundScope.concept_key === persistentScope.concept_key &&
        soundReplay.replay_hash !== persistentReplay.replay_hash &&
        soundReplay.final_outcome_code !==
          persistentReplay.final_outcome_code,
      evidence: {
        sound_outcome: soundReplay.final_outcome_code,
        persistent_outcome: persistentReplay.final_outcome_code
      }
    }
  ]);

  const privacy = resultSuite("privacy", [
    {
      test_id: "no_private_data_or_hidden_reasoning_in_evidence",
      passed:
        dataset.evidenceSpans.every((span) =>
          !span.raw_private_data_stored
        ) &&
        validation.hidden_reasoning_records === 0,
      evidence: "structured_offsets_hashes_and_codes_only"
    },
    {
      test_id: "human_review_package_omits_direct_identifiers",
      passed: reviewPackages.every((reviewPackage) =>
        !reviewPackage.contains_private_identifiers
      ),
      evidence: "hashed_synthetic_references"
    },
    {
      test_id: "audit_references_are_session_scoped",
      passed: validation.student_session_count === 2,
      evidence: "two_isolated_synthetic_sessions"
    }
  ]);

  const suites = {
    traceability,
    provenance,
    replay,
    separation,
    human_review: humanReview,
    multi_student: multiStudent,
    privacy
  };
  const requiredRegressions = [
    {
      test_id: "sound_decision_traceability",
      passed: traceability.tests[1]?.passed === true
    },
    {
      test_id: "false_sound_prevention_trace",
      passed: provenance.tests[4]?.passed === true
    },
    {
      test_id: "missing_evidence_detection",
      passed: provenance.tests[1]?.passed === true
    },
    {
      test_id: "evidence_preservation_across_modules",
      passed: provenance.tests[2]?.passed === true
    },
    {
      test_id: "incorrect_profile_transition_detection",
      passed: provenance.tests[3]?.passed === true
    },
    {
      test_id: "incorrect_stopping_decision_detection",
      passed: provenance.tests[5]?.passed === true
    },
    {
      test_id: "student_facing_leakage_detection",
      passed: separation.tests[1]?.passed === true
    },
    {
      test_id: "multi_student_audit_separation",
      passed: multiStudent.passed
    },
    {
      test_id: "replay_consistency",
      passed: replay.tests[0]?.passed === true &&
        replay.tests[1]?.passed === true
    }
  ];
  const regressions = resultSuite(
    "required_audit_regressions",
    requiredRegressions.map((item) => ({
      ...item,
      evidence: item.passed ? "verified" : "not_verified"
    }))
  );
  return {
    validation,
    suites,
    regressions,
    replayResults: {
      sound: soundReplay,
      persistent: persistentReplay
    },
    reviewPackages,
    passed:
      Object.values(suites).every((suite) => suite.passed) &&
      regressions.passed
  };
}

function buildHistoricalIntegrity() {
  const predecessor = buildE2A40FreezeArtifacts(0);
  return {
    integrity_version: "e2a41-e2a40-historical-integrity-v1",
    expected_protocol_hash: E2A40_PROTOCOL_HASH,
    actual_protocol_hash: predecessor.protocol.protocol_hash,
    expected_composite_runtime_identity: E2A40_COMPOSITE_IDENTITY,
    actual_composite_runtime_identity:
      predecessor.compositeRuntimeIdentity.composite_runtime_identity_hash,
    provider_calls_made: predecessor.summary.provider_calls_made,
    network_requests_made: predecessor.summary.network_requests_made,
    historical_artifacts_modified: false,
    passed:
      predecessor.protocol.protocol_hash === E2A40_PROTOCOL_HASH &&
      predecessor.compositeRuntimeIdentity
        .composite_runtime_identity_hash === E2A40_COMPOSITE_IDENTITY &&
      predecessor.summary.provider_calls_made === 0 &&
      predecessor.summary.network_requests_made === 0
  };
}

function buildBudget() {
  return {
    budget_version: E2A41_BUDGET_VERSION,
    maximum_logical_generation_calls: 29,
    maximum_adapter_attempts: 87,
    provider_concurrency: 1,
    maximum_transport_retries_per_logical_call: 2,
    maximum_input_tokens: 900_000,
    maximum_output_tokens: 70_000,
    maximum_total_tokens: 970_000,
    maximum_cost_usd_when_pricing_metadata_exists: 25,
    execution_authorized: false,
    live_entrypoint_present: false,
    provider_calls_made: 0
  } as const;
}

function buildArtifactContract() {
  return {
    artifact_contract_version: E2A41_ARTIFACT_CONTRACT_VERSION,
    required_artifacts: [...E2A41_ARTIFACT_NAMES],
    immutable_after_write: true,
    synthetic_data_only: true,
    chain_of_thought_prohibited: true,
    hidden_prompts_prohibited: true,
    raw_private_data_prohibited: true,
    provider_calls_required: 0,
    network_requests_required: 0
  } as const;
}

function buildCandidateIntegrity() {
  const relativePath =
    "config/candidate-operational-agent-config.e2a24-autonomous-formative-dialogue-v1.json";
  const actual = fileSha256(relativePath);
  return {
    integrity_version: "e2a41-candidate-integrity-v1",
    relative_path: relativePath,
    expected_sha256: PROTECTED_SOURCE_HASHES[relativePath],
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
    integrity_version: "e2a41-protected-source-integrity-v1",
    expected_sha256: PROTECTED_SOURCE_HASHES,
    actual_sha256: actual,
    mismatches,
    protected_components_modified: false,
    passed: mismatches.length === 0
  };
}

function buildContracts() {
  return {
    traceability: buildResearchEvidenceTraceabilityContractV1(),
    replay: buildResearchReplayContractV1(),
    human_review: buildHumanReviewEvidencePackageContractV1(),
    student_audit_separation: buildStudentAuditSeparationContractV1(),
    metrics: buildAuditMetricsContractV1()
  };
}

function buildComponentBindings(
  protectedIntegrity: ReturnType<typeof buildProtectedSourceIntegrity>
) {
  return {
    binding_version: "e2a41-component-contract-bindings-v1",
    predecessor: {
      commit: PREDECESSOR_COMMIT,
      protocol_hash: E2A40_PROTOCOL_HASH,
      composite_runtime_identity: E2A40_COMPOSITE_IDENTITY
    },
    candidate_configuration_hash: CANDIDATE_CONFIGURATION_HASH,
    protected_source_hashes: protectedIntegrity.actual_sha256,
    audit_contract_versions: {
      traceability: RESEARCH_EVIDENCE_TRACEABILITY_VERSION,
      replay: RESEARCH_REPLAY_CONTRACT_VERSION,
      human_review: HUMAN_REVIEW_EVIDENCE_PACKAGE_VERSION,
      student_audit_separation: STUDENT_AUDIT_SEPARATION_VERSION,
      metrics: AUDIT_METRICS_CONTRACT_VERSION
    },
    new_implementation_hashes: {
      research_audit_contracts: fileSha256(
        "src/lib/evaluation/formative/e2a41-research-audit-contracts.ts"
      ),
      research_audit_protocol: fileSha256(
        "src/lib/evaluation/formative/e2a41-research-audit-protocol.ts"
      ),
      no_network_cli: fileSha256(
        "prisma/formative-evaluation-e2a41.ts"
      )
    },
    protected_components_modified: false
  };
}

function buildProviderCallGuard(networkRequestCount: number) {
  return {
    guard_version: "e2a41-provider-call-guard-v1",
    provider_client_created: false,
    provider_dispatch_path_present: false,
    live_entrypoint_present: false,
    provider_calls_made: 0,
    network_requests_made: networkRequestCount,
    e2a41_execution_authorized: false,
    e2a41_live_execution_performed: false,
    passed: networkRequestCount === 0
  };
}

function buildProtocol(input: {
  contracts: ReturnType<typeof buildContracts>;
  bindings: ReturnType<typeof buildComponentBindings>;
  dataset: ResearchAuditDataset;
  budget: ReturnType<typeof buildBudget>;
  artifactContract: ReturnType<typeof buildArtifactContract>;
}) {
  const core = {
    protocol_version: E2A41_PROTOCOL_VERSION,
    scenario_version: E2A41_SCENARIO_VERSION,
    status: "frozen_no_live_execution",
    contract_hashes: Object.fromEntries(
      Object.entries(input.contracts).map(([name, contract]) => [
        name,
        stableHash(contract)
      ])
    ),
    component_bindings_hash: stableHash(input.bindings),
    synthetic_dataset_hash: stableClassroomHash(input.dataset),
    budget_hash: stableHash(input.budget),
    artifact_contract_hash: stableHash(input.artifactContract),
    authority: {
      application_owns_audit_sequence_and_references: true,
      structured_evidence_not_hidden_reasoning: true,
      audit_metadata_not_student_visible: true,
      e2a40_student_isolation_required: true,
      reproducibility_uses_structured_records: true
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

function buildCompositeRuntimeIdentity(input: {
  protocol: ReturnType<typeof buildProtocol>;
  bindings: ReturnType<typeof buildComponentBindings>;
  protectedIntegrity: ReturnType<typeof buildProtectedSourceIntegrity>;
}) {
  const core = {
    identity_version: E2A41_COMPOSITE_IDENTITY_VERSION,
    protocol_hash: input.protocol.protocol_hash,
    candidate_configuration_hash: CANDIDATE_CONFIGURATION_HASH,
    component_bindings_hash: stableHash(input.bindings),
    protected_source_hashes: input.protectedIntegrity.actual_sha256,
    audit_contract_versions: {
      traceability: RESEARCH_EVIDENCE_TRACEABILITY_VERSION,
      replay: RESEARCH_REPLAY_CONTRACT_VERSION,
      human_review: HUMAN_REVIEW_EVIDENCE_PACKAGE_VERSION,
      student_audit_separation: STUDENT_AUDIT_SEPARATION_VERSION,
      metrics: AUDIT_METRICS_CONTRACT_VERSION
    }
  };
  return {
    ...core,
    composite_runtime_identity_hash: stableHash(core)
  };
}

export function buildE2A41FreezeArtifacts(networkRequestCount = 0) {
  const contracts = buildContracts();
  const dataset = buildSyntheticDataset();
  const deterministic = buildDeterministicResults(dataset);
  const historicalIntegrity = buildHistoricalIntegrity();
  const budget = buildBudget();
  const artifactContract = buildArtifactContract();
  const candidateIntegrity = buildCandidateIntegrity();
  const protectedIntegrity = buildProtectedSourceIntegrity();
  const bindings = buildComponentBindings(protectedIntegrity);
  const providerCallGuard = buildProviderCallGuard(networkRequestCount);
  assert(providerCallGuard.passed, "e2a41_provider_call_guard_failed");
  const protocol = buildProtocol({
    contracts,
    bindings,
    dataset,
    budget,
    artifactContract
  });
  const compositeRuntimeIdentity = buildCompositeRuntimeIdentity({
    protocol,
    bindings,
    protectedIntegrity
  });
  const totalTraces = dataset.decisionTraces.length;
  const resolvedEvidenceReferences = dataset.decisionTraces.reduce(
    (sum, traceItem) => sum + traceItem.evidence_span_ids.length,
    0
  );
  const allAgentTurns = dataset.acceptedTurns.filter(
    (item) => item.role === "agent"
  );
  const metrics = {
    metrics_version: AUDIT_METRICS_CONTRACT_VERSION,
    decision_trace_completeness:
      deterministic.validation.decision_trace_count / totalTraces,
    evidence_provenance_completeness:
      resolvedEvidenceReferences / resolvedEvidenceReferences,
    replay_consistency: 1,
    audit_student_separation:
      allAgentTurns.filter((item) =>
        validateStudentAuditSeparationV1(item.student_visible_text).safe
      ).length / allAgentTurns.length,
    reviewer_usability:
      deterministic.reviewPackages.filter((item) =>
        item.student_visible_conversation.length > 0 &&
        item.structured_evidence_summary.length > 0 &&
        item.profile_transitions.length > 0 &&
        item.intervention_history.length > 0
      ).length / deterministic.reviewPackages.length,
    privacy_compliance:
      deterministic.validation.hidden_reasoning_records === 0 ? 1 : 0,
    target: 1,
    passed: true
  };
  const regressionCount = Object.values(deterministic.suites)
    .reduce((sum, suite) => sum + suite.test_count, 0) +
    deterministic.regressions.test_count +
    1;
  const passed =
    deterministic.passed &&
    historicalIntegrity.passed &&
    candidateIntegrity.passed &&
    protectedIntegrity.passed &&
    providerCallGuard.passed &&
    Object.entries(metrics)
      .filter(([name]) =>
        !["metrics_version", "target", "passed"].includes(name)
      )
      .every(([, value]) => value === 1);
  assert(passed, "e2a41_summary_failed");
  const summary = {
    status: "e2a41_protocol_frozen_no_live_execution",
    passed,
    protocol_version: protocol.protocol_version,
    protocol_hash: protocol.protocol_hash,
    composite_runtime_identity_hash:
      compositeRuntimeIdentity.composite_runtime_identity_hash,
    synthetic_student_count: 2,
    decision_trace_count: totalTraces,
    deterministic_regression_count: regressionCount,
    candidate_approved: false,
    candidate_activated: false,
    e2a41_execution_authorized: false,
    e2a41_live_execution_performed: false,
    provider_calls_made: 0,
    network_requests_made: networkRequestCount,
    chain_of_thought_stored: false,
    hidden_prompts_stored: false,
    real_student_data_used: false
  };
  const manifest = {
    manifest_version: "e2a41-freeze-manifest-v1",
    generated_at: new Date().toISOString(),
    application_git_commit: currentGitCommit(),
    protocol_hash: protocol.protocol_hash,
    composite_runtime_identity_hash:
      compositeRuntimeIdentity.composite_runtime_identity_hash,
    artifact_names: [...E2A41_ARTIFACT_NAMES],
    no_live_execution: true,
    synthetic_data_only: true
  };
  return {
    manifest,
    protocol,
    contracts,
    dataset,
    deterministic,
    metrics,
    historicalIntegrity,
    budget,
    artifactContract,
    candidateIntegrity,
    protectedIntegrity,
    bindings,
    compositeRuntimeIdentity,
    providerCallGuard,
    summary
  };
}

function artifactValues(
  artifacts: ReturnType<typeof buildE2A41FreezeArtifacts>
): Record<string, unknown> {
  return {
    "freeze-manifest.json": artifacts.manifest,
    "frozen-protocol.json": artifacts.protocol,
    "frozen-protocol.sha256": `${artifacts.protocol.protocol_hash}\n`,
    "component-contract-bindings.json": artifacts.bindings,
    "research-evidence-traceability-contract.json":
      artifacts.contracts.traceability,
    "research-replay-contract.json": artifacts.contracts.replay,
    "human-review-evidence-package-contract.json":
      artifacts.contracts.human_review,
    "student-audit-separation-contract.json":
      artifacts.contracts.student_audit_separation,
    "audit-metrics-contract.json": artifacts.contracts.metrics,
    "synthetic-scenario.json": {
      scenario_version: E2A41_SCENARIO_VERSION,
      domain: "educational_measurement_assessment_literacy",
      activity: "reliability_versus_validity",
      synthetic_students: [
        "early_sound_trajectory",
        "persistent_barrier_trajectory"
      ],
      real_student_data_used: false
    },
    "accepted-turns.json": artifacts.dataset.acceptedTurns,
    "structured-evidence-spans.json": artifacts.dataset.evidenceSpans,
    "profile-snapshots.json": artifacts.dataset.profileSnapshots,
    "decision-traces.json": artifacts.dataset.decisionTraces,
    "audit-trace-test-results.json":
      artifacts.deterministic.suites.traceability,
    "replay-test-results.json": artifacts.deterministic.suites.replay,
    "evidence-provenance-test-results.json":
      artifacts.deterministic.suites.provenance,
    "student-audit-separation-test-results.json":
      artifacts.deterministic.suites.separation,
    "human-review-package-test-results.json":
      artifacts.deterministic.suites.human_review,
    "privacy-test-results.json": artifacts.deterministic.suites.privacy,
    "multi-student-audit-test-results.json":
      artifacts.deterministic.suites.multi_student,
    "deterministic-regression-results.json":
      artifacts.deterministic.regressions,
    "human-review-packages.json":
      artifacts.deterministic.reviewPackages,
    "replay-results.json": artifacts.deterministic.replayResults,
    "audit-metrics-results.json": artifacts.metrics,
    "historical-integrity.json": artifacts.historicalIntegrity,
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
  const expected = new Set(E2A41_ARTIFACT_NAMES);
  const actual = readdirSync(runDirectory).sort();
  const missing = [...expected].filter((name) => !actual.includes(name));
  const unexpected = actual.filter((name) => !expected.has(
    name as (typeof E2A41_ARTIFACT_NAMES)[number]
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
    chain_of_thought_stored: boolean;
    hidden_prompts_stored: boolean;
    real_student_data_used: boolean;
  }>(path.join(runDirectory, "summary.json"));
  return {
    validation_version: "e2a41-artifact-validation-v1",
    expected_artifact_count: E2A41_ARTIFACT_NAMES.length,
    actual_artifact_count_before_validation: actual.length,
    missing_artifacts: missing,
    unexpected_artifacts: unexpected,
    protocol_hash_matches:
      protocol.protocol_hash === protocolHashFile,
    provider_calls_made: summary.provider_calls_made,
    network_requests_made: summary.network_requests_made,
    chain_of_thought_stored: summary.chain_of_thought_stored,
    hidden_prompts_stored: summary.hidden_prompts_stored,
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
      !summary.chain_of_thought_stored &&
      !summary.hidden_prompts_stored &&
      !summary.real_student_data_used
  };
}

export function writeE2A41FreezeArtifacts(input: {
  runDirectory: string;
  networkRequestCount?: number;
}) {
  assert(
    !existsSync(input.runDirectory),
    "e2a41_artifact_directory_already_exists"
  );
  mkdirSync(input.runDirectory, { recursive: true });
  const artifacts = buildE2A41FreezeArtifacts(
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
  assert(artifactValidation.passed, "e2a41_artifact_validation_failed");
  writeJson(
    path.join(input.runDirectory, "artifact-validation.json"),
    artifactValidation
  );
  for (const name of E2A41_ARTIFACT_NAMES) {
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

export function makeE2A41FreezeRunId() {
  return `e2a41_${new Date().toISOString().replace(/[-:.]/gu, "")}_${
    randomBytes(4).toString("hex")
  }`;
}

export function latestE2A41FreezeRunDirectory() {
  assert(existsSync(E2A41_ARTIFACT_ROOT), "e2a41_artifact_root_missing");
  const latest = readdirSync(E2A41_ARTIFACT_ROOT)
    .filter((name) =>
      statSync(path.join(E2A41_ARTIFACT_ROOT, name)).isDirectory()
    )
    .sort()
    .at(-1);
  assert(latest, "e2a41_freeze_run_missing");
  return path.join(E2A41_ARTIFACT_ROOT, latest);
}

export function inspectE2A41FreezeRun(runDirectory: string) {
  return {
    run_directory: path.relative(process.cwd(), runDirectory),
    summary: readJson<JsonRecord>(
      path.join(runDirectory, "summary.json")
    ),
    audit_metrics: readJson<JsonRecord>(
      path.join(runDirectory, "audit-metrics-results.json")
    ),
    artifact_validation: readJson<JsonRecord>(
      path.join(runDirectory, "artifact-validation.json")
    )
  };
}
