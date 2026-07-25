import { createHash } from "node:crypto";
import { z } from "zod";

export const MULTI_STUDENT_SESSION_CONTRACT_VERSION =
  "multi-student-session-contract-v1" as const;
export const PROFILE_ISOLATION_CONTRACT_VERSION =
  "profile-isolation-contract-v1" as const;
export const INTERVENTION_MEMORY_ISOLATION_CONTRACT_VERSION =
  "intervention-memory-isolation-contract-v1" as const;
export const CLASSROOM_ORCHESTRATION_CONTRACT_VERSION =
  "classroom-orchestration-contract-v1" as const;
export const CLASSROOM_PRIVACY_BOUNDARY_VERSION =
  "classroom-privacy-boundary-v1" as const;
export const PERSONALIZATION_EVALUATION_CONTRACT_VERSION =
  "multi-student-personalization-evaluation-v1" as const;

export const StudentTrajectoryKindSchema = z.enum([
  "fast_learner",
  "slow_engaged_learner",
  "persistent_high_confidence_misconception",
  "shallow_copied_understanding",
  "self_correction_learner",
  "regression_learner"
]);
export type StudentTrajectoryKind = z.infer<
  typeof StudentTrajectoryKindSchema
>;

export const ConceptualEvidenceStateSchema = z.enum([
  "misconception",
  "copied",
  "partial",
  "sound",
  "regressed"
]);
export type ConceptualEvidenceState = z.infer<
  typeof ConceptualEvidenceStateSchema
>;

export const InterventionKindSchema = z.enum([
  "invite_transfer_application",
  "scaffold_concept_boundary",
  "change_strategy_and_prepare_instructor_next_step",
  "ask_for_independent_application",
  "reinforce_revised_mechanism_then_transfer",
  "reopen_and_contrast_prior_reasoning"
]);
export type InterventionKind = z.infer<typeof InterventionKindSchema>;

export const StoppingDecisionSchema = z.enum([
  "continue_dialogue",
  "authorize_revision",
  "close_episode",
  "instructor_next_step"
]);
export type StoppingDecision = z.infer<typeof StoppingDecisionSchema>;

export const InstructorBoundaryDecisionSchema = z.enum([
  "not_reached",
  "monitor_only",
  "offer_supportive_instructor_next_step"
]);
export type InstructorBoundaryDecision = z.infer<
  typeof InstructorBoundaryDecisionSchema
>;

export const StudentIsolationScopeSchema = z.object({
  classroom_run_id: z.string().min(1),
  student_subject_id: z.string().regex(/^syn_student_[a-z0-9_]+$/u),
  session_id: z.string().regex(/^syn_session_[a-z0-9_]+$/u),
  concept_key: z.string().min(1),
  misconception_key: z.string().min(1)
}).strict();
export type StudentIsolationScope = z.infer<
  typeof StudentIsolationScopeSchema
>;

export const ClassroomObservationSchema = z.object({
  event_id: z.string().min(1),
  scope: StudentIsolationScopeSchema,
  logical_tick: z.number().int().nonnegative(),
  student_sequence: z.number().int().positive(),
  evidence_state: ConceptualEvidenceStateSchema,
  confidence: z.enum(["low", "medium", "high"]),
  independently_explained: z.boolean(),
  self_correction_intent: z.boolean(),
  misconception_endorsed: z.boolean(),
  copied_wording_detected: z.boolean(),
  contradiction_present: z.boolean()
}).strict();
export type ClassroomObservation = z.infer<
  typeof ClassroomObservationSchema
>;

export const ClassroomStudentTrajectorySchema = z.object({
  trajectory_id: z.string().min(1),
  kind: StudentTrajectoryKindSchema,
  scope: StudentIsolationScopeSchema,
  observations: z.array(ClassroomObservationSchema).min(2),
  expected_intervention: InterventionKindSchema,
  expected_stopping_decision: StoppingDecisionSchema,
  expected_instructor_boundary: InstructorBoundaryDecisionSchema,
  student_facing_message: z.string().min(1)
}).strict().superRefine((value, context) => {
  for (const observation of value.observations) {
    if (
      isolationNamespace(observation.scope) !==
      isolationNamespace(value.scope)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "trajectory_observation_scope_mismatch"
      });
    }
  }
});
export type ClassroomStudentTrajectory = z.infer<
  typeof ClassroomStudentTrajectorySchema
>;

export type ScopedRecordKind =
  | "profile"
  | "transcript"
  | "intervention"
  | "audit"
  | "closure";

export type ScopedRecord = {
  record_id: string;
  kind: ScopedRecordKind;
  scope: StudentIsolationScope;
  payload: Record<string, unknown>;
};

export class IsolationBoundaryError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = "IsolationBoundaryError";
    this.code = code;
  }
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) =>
      `${JSON.stringify(key)}:${stableJson(record[key])}`
    ).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function stableClassroomHash(value: unknown) {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

export function isolationNamespace(rawScope: StudentIsolationScope) {
  const scope = StudentIsolationScopeSchema.parse(rawScope);
  return [
    scope.classroom_run_id,
    scope.student_subject_id,
    scope.session_id,
    scope.concept_key,
    scope.misconception_key
  ].join("::");
}

export function studentSessionNamespace(rawScope: StudentIsolationScope) {
  const scope = StudentIsolationScopeSchema.parse(rawScope);
  return [
    scope.classroom_run_id,
    scope.student_subject_id,
    scope.session_id
  ].join("::");
}

function sameStudentSession(
  first: StudentIsolationScope,
  second: StudentIsolationScope
) {
  return studentSessionNamespace(first) === studentSessionNamespace(second);
}

function sameEvidenceScope(
  first: StudentIsolationScope,
  second: StudentIsolationScope
) {
  return isolationNamespace(first) === isolationNamespace(second);
}

export class ScopedClassroomStore {
  private readonly records = new Map<string, ScopedRecord>();

  put(record: ScopedRecord) {
    const parsedScope = StudentIsolationScopeSchema.parse(record.scope);
    const payloadText = JSON.stringify(record.payload);
    const referencedStudents = [
      ...payloadText.matchAll(/syn_student_[a-z0-9_]+/gu)
    ].map((match) => match[0]);
    const referencedSessions = [
      ...payloadText.matchAll(/syn_session_[a-z0-9_]+/gu)
    ].map((match) => match[0]);
    if (
      referencedStudents.some((identifier) =>
        identifier !== parsedScope.student_subject_id
      ) ||
      referencedSessions.some((identifier) =>
        identifier !== parsedScope.session_id
      )
    ) {
      throw new IsolationBoundaryError(
        "cross_student_payload_reference_denied"
      );
    }
    if (this.records.has(record.record_id)) {
      throw new IsolationBoundaryError("duplicate_scoped_record_id");
    }
    this.records.set(record.record_id, {
      ...record,
      scope: parsedScope,
      payload: structuredClone(record.payload)
    });
  }

  read(requestingScope: StudentIsolationScope, recordId: string) {
    const record = this.records.get(recordId);
    if (!record) {
      throw new IsolationBoundaryError("scoped_record_not_found");
    }
    const sessionScoped = record.kind === "transcript" ||
      record.kind === "audit" ||
      record.kind === "closure";
    const allowed = sessionScoped
      ? sameStudentSession(requestingScope, record.scope)
      : sameEvidenceScope(requestingScope, record.scope);
    if (!allowed) {
      throw new IsolationBoundaryError(
        `cross_student_or_session_${record.kind}_read_denied`
      );
    }
    return structuredClone(record);
  }

  listForSession(requestingScope: StudentIsolationScope) {
    return [...this.records.values()]
      .filter((record) => sameStudentSession(requestingScope, record.scope))
      .map((record) => structuredClone(record));
  }

  snapshot() {
    return [...this.records.values()]
      .map((record) => structuredClone(record))
      .sort((first, second) =>
        first.record_id.localeCompare(second.record_id)
      );
  }
}

export function buildMultiStudentSessionContractV1() {
  return {
    contract_version: MULTI_STUDENT_SESSION_CONTRACT_VERSION,
    synthetic_students_only: true,
    ownership_key_fields: [
      "classroom_run_id",
      "student_subject_id",
      "session_id"
    ],
    evidence_scope_fields: [
      "concept_key",
      "misconception_key"
    ],
    rules: {
      one_active_state_per_student_session: true,
      session_state_never_shared_by_reference: true,
      per_student_sequence_is_monotonic: true,
      closure_is_session_scoped: true,
      all_cross_student_reads_fail_closed: true
    }
  } as const;
}

export function buildProfileIsolationContractV1() {
  return {
    contract_version: PROFILE_ISOLATION_CONTRACT_VERSION,
    profile_owner: "student_session_and_evidence_scope",
    rules: {
      profile_reads_require_exact_owner_scope: true,
      profile_updates_require_exact_owner_scope: true,
      aggregate_views_do_not_return_profile_objects: true,
      same_misconception_does_not_merge_student_profiles: true,
      same_student_different_misconceptions_use_distinct_profiles: true
    },
    forbidden: [
      "cross_student_profile_copy",
      "classroom_global_current_profile",
      "profile_object_in_student_facing_output"
    ]
  } as const;
}

export function buildInterventionMemoryIsolationContractV1() {
  return {
    contract_version: INTERVENTION_MEMORY_ISOLATION_CONTRACT_VERSION,
    memory_owner: "student_session_concept_and_misconception_scope",
    rules: {
      prior_strategy_history_is_scope_local: true,
      intervention_counts_are_scope_local: true,
      same_strategy_can_be_selected_independently: true,
      another_students_intervention_never_becomes_context: true,
      closing_one_session_does_not_clear_another_session: true
    }
  } as const;
}

export function buildClassroomOrchestrationContractV1() {
  return {
    contract_version: CLASSROOM_ORCHESTRATION_CONTRACT_VERSION,
    deterministic_order: [
      "logical_tick",
      "student_subject_id",
      "student_sequence",
      "event_id"
    ],
    rules: {
      provider_concurrency: 0,
      per_student_order_preserved: true,
      input_array_order_has_no_semantic_effect: true,
      one_student_failure_isolated_from_other_sessions: true,
      one_student_closure_does_not_close_classroom: true,
      no_shared_mutable_profile_state: true
    }
  } as const;
}

export function buildClassroomPrivacyBoundaryV1() {
  return {
    contract_version: CLASSROOM_PRIVACY_BOUNDARY_VERSION,
    synthetic_data_only: true,
    student_visible_allowlist: [
      "task_feedback",
      "conceptual_prompt",
      "supportive_next_step",
      "completion_message"
    ],
    student_visible_forbidden_labels: [
      "profile",
      "engagement",
      "escalation",
      "internal decision",
      "stopping decision",
      "routing decision",
      "instructor boundary",
      "intervention memory",
      "audit record",
      "other student"
    ],
    boundaries: {
      another_student_transcript_never_visible: true,
      another_student_profile_never_visible: true,
      another_student_intervention_never_visible: true,
      student_identifiers_not_present_in_peer_output: true,
      aggregate_research_views_require_deidentification: true
    }
  } as const;
}

export function buildPersonalizationEvaluationContractV1() {
  return {
    contract_version: PERSONALIZATION_EVALUATION_CONTRACT_VERSION,
    evaluation_dimensions: [
      "current_conceptual_evidence",
      "evidence_independence",
      "confidence_evidence_alignment",
      "misconception_persistence",
      "self_correction_with_evidence",
      "regression_after_improvement",
      "prior_scope_local_interventions"
    ],
    nonclaims: {
      no_stable_learner_trait_inference: true,
      no_classroom_validity_claim: true,
      no_cross_student_profile_inference: true,
      no_aggregate_learner_typology: true
    },
    required_results: {
      intervention_matches_current_evidence: true,
      stopping_differs_when_evidence_differs: true,
      instructor_boundary_depends_on_session_evidence: true,
      same_misconception_can_receive_different_support: true
    }
  } as const;
}

export function canonicalizeConcurrentObservations(
  rawObservations: ClassroomObservation[]
) {
  const observations = rawObservations.map((observation) =>
    ClassroomObservationSchema.parse(observation)
  );
  const seen = new Set<string>();
  for (const observation of observations) {
    if (seen.has(observation.event_id)) {
      throw new IsolationBoundaryError("duplicate_classroom_event_id");
    }
    seen.add(observation.event_id);
  }
  const sorted = [...observations].sort((first, second) =>
    first.logical_tick - second.logical_tick ||
    first.scope.student_subject_id.localeCompare(
      second.scope.student_subject_id
    ) ||
    first.student_sequence - second.student_sequence ||
    first.event_id.localeCompare(second.event_id)
  );
  const sequenceBySession = new Map<string, number>();
  for (const observation of sorted) {
    const session = studentSessionNamespace(observation.scope);
    const prior = sequenceBySession.get(session) ?? 0;
    if (observation.student_sequence !== prior + 1) {
      throw new IsolationBoundaryError(
        `non_monotonic_student_sequence:${session}`
      );
    }
    sequenceBySession.set(session, observation.student_sequence);
  }
  return sorted;
}

export function deriveTrajectoryDecision(
  rawTrajectory: ClassroomStudentTrajectory
) {
  const trajectory = ClassroomStudentTrajectorySchema.parse(rawTrajectory);
  const latest = trajectory.observations.at(-1);
  if (!latest) {
    throw new IsolationBoundaryError("trajectory_has_no_observation");
  }
  const decisions: Record<StudentTrajectoryKind, {
    intervention: InterventionKind;
    stopping: StoppingDecision;
    instructor: InstructorBoundaryDecision;
  }> = {
    fast_learner: {
      intervention: "invite_transfer_application",
      stopping: "close_episode",
      instructor: "not_reached"
    },
    slow_engaged_learner: {
      intervention: "scaffold_concept_boundary",
      stopping: "continue_dialogue",
      instructor: "monitor_only"
    },
    persistent_high_confidence_misconception: {
      intervention: "change_strategy_and_prepare_instructor_next_step",
      stopping: "instructor_next_step",
      instructor: "offer_supportive_instructor_next_step"
    },
    shallow_copied_understanding: {
      intervention: "ask_for_independent_application",
      stopping: "continue_dialogue",
      instructor: "monitor_only"
    },
    self_correction_learner: {
      intervention: "reinforce_revised_mechanism_then_transfer",
      stopping: "authorize_revision",
      instructor: "not_reached"
    },
    regression_learner: {
      intervention: "reopen_and_contrast_prior_reasoning",
      stopping: "continue_dialogue",
      instructor: "monitor_only"
    }
  };
  const selected = decisions[trajectory.kind];
  return {
    trajectory_id: trajectory.trajectory_id,
    student_subject_id: trajectory.scope.student_subject_id,
    session_id: trajectory.scope.session_id,
    latest_evidence_state: latest.evidence_state,
    intervention: selected.intervention,
    stopping_decision: selected.stopping,
    instructor_boundary: selected.instructor,
    matches_expected:
      selected.intervention === trajectory.expected_intervention &&
      selected.stopping === trajectory.expected_stopping_decision &&
      selected.instructor === trajectory.expected_instructor_boundary
  };
}

export function validateStudentFacingClassroomTextV1(text: string) {
  const normalized = text.toLowerCase();
  const contract = buildClassroomPrivacyBoundaryV1();
  const blocked_labels = contract.student_visible_forbidden_labels.filter(
    (label) => normalized.includes(label)
  );
  return {
    contract_version: CLASSROOM_PRIVACY_BOUNDARY_VERSION,
    safe: blocked_labels.length === 0,
    blocked_labels,
    raw_text_stored_in_validation_result: false
  };
}

export function buildPrivacySafeClassroomAggregate(
  trajectories: ClassroomStudentTrajectory[]
) {
  const parsed = trajectories.map((trajectory) =>
    ClassroomStudentTrajectorySchema.parse(trajectory)
  );
  const stoppingCounts = Object.fromEntries(
    StoppingDecisionSchema.options.map((decision) => [
      decision,
      parsed.filter((trajectory) =>
        deriveTrajectoryDecision(trajectory).stopping_decision === decision
      ).length
    ])
  );
  return {
    aggregate_version: "privacy-safe-classroom-aggregate-v1",
    synthetic_student_count: parsed.length,
    stopping_decision_counts: stoppingCounts,
    contains_student_identifiers: false,
    contains_transcripts: false,
    contains_profiles: false,
    contains_intervention_memory: false
  };
}
