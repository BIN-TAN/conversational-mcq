import { z } from "zod";
import {
  isolationNamespace,
  StudentIsolationScopeSchema,
  stableClassroomHash,
  studentSessionNamespace,
  validateStudentFacingClassroomTextV1,
  type StudentIsolationScope
} from "./e2a40-classroom-isolation-contracts";

export const RESEARCH_EVIDENCE_TRACEABILITY_VERSION =
  "research-evidence-traceability-v1" as const;
export const RESEARCH_REPLAY_CONTRACT_VERSION =
  "research-replay-contract-v1" as const;
export const HUMAN_REVIEW_EVIDENCE_PACKAGE_VERSION =
  "human-review-evidence-package-v1" as const;
export const STUDENT_AUDIT_SEPARATION_VERSION =
  "student-audit-separation-v1" as const;
export const AUDIT_METRICS_CONTRACT_VERSION =
  "audit-metrics-contract-v1" as const;

export const AuditDecisionTypeSchema = z.enum([
  "misconception_identification",
  "tutor_intervention_selection",
  "profile_update",
  "sound_decision",
  "stopping_decision",
  "instructor_handoff"
]);
export type AuditDecisionType = z.infer<typeof AuditDecisionTypeSchema>;

export const AcceptedAuditTurnSchema = z.object({
  turn_id: z.string().min(1),
  scope: StudentIsolationScopeSchema,
  sequence: z.number().int().positive(),
  role: z.enum(["student", "agent"]),
  student_visible_text: z.string().min(1),
  accepted: z.literal(true),
  source_kind: z.enum([
    "student_response",
    "tutor_message",
    "student_communication"
  ])
}).strict();
export type AcceptedAuditTurn = z.infer<typeof AcceptedAuditTurnSchema>;

export const StructuredEvidenceSpanSchema = z.object({
  evidence_span_id: z.string().min(1),
  scope: StudentIsolationScopeSchema,
  source_turn_id: z.string().min(1),
  source_sequence: z.number().int().positive(),
  evidence_kind: z.enum([
    "misconception_endorsement",
    "conceptual_distinction",
    "independent_application",
    "confidence_evidence_mismatch",
    "distractor_rejection",
    "missing_link",
    "contradiction",
    "self_correction",
    "persistent_barrier"
  ]),
  source_field: z.literal("student_visible_text"),
  start_offset: z.number().int().nonnegative(),
  end_offset: z.number().int().positive(),
  source_text_sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  safe_evidence_code: z.string().min(1),
  raw_private_data_stored: z.literal(false)
}).strict().superRefine((value, context) => {
  if (value.end_offset <= value.start_offset) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "evidence_span_end_must_follow_start"
    });
  }
});
export type StructuredEvidenceSpan = z.infer<
  typeof StructuredEvidenceSpanSchema
>;

export const AuditProfileSnapshotSchema = z.object({
  profile_snapshot_id: z.string().min(1),
  scope: StudentIsolationScopeSchema,
  sequence: z.number().int().nonnegative(),
  conceptual_state: z.enum([
    "misconception",
    "copied",
    "partial",
    "sound",
    "regressed"
  ]),
  active_gap_codes: z.array(z.string().min(1)).max(12),
  contradiction_codes: z.array(z.string().min(1)).max(12),
  essential_missing_link_codes: z.array(z.string().min(1)).max(12),
  update_source: z.enum([
    "initial_response",
    "ordinary_conceptual_evidence",
    "self_correction_with_evidence",
    "regression_evidence",
    "persistent_barrier_evidence"
  ]),
  source_evidence_span_ids: z.array(z.string().min(1)).min(1).max(24),
  profile_schema_version: z.string().min(1)
}).strict();
export type AuditProfileSnapshot = z.infer<
  typeof AuditProfileSnapshotSchema
>;

const TraceDetailsSchema = z.object({
  identified_knowledge_gap: z.string().nullable(),
  misconception_confidence: z.enum([
    "not_assessed",
    "low",
    "medium",
    "high"
  ]).nullable(),
  profile_update_source: z.string().nullable(),
  previous_strategy: z.string().nullable(),
  remaining_gap: z.string().nullable(),
  selected_strategy: z.string().nullable(),
  intervention_goal: z.string().nullable(),
  intervention_outcome: z.string().nullable(),
  previous_profile_state: z.string().nullable(),
  updated_profile_state: z.string().nullable(),
  transition_reason_codes: z.array(z.string().min(1)).max(16),
  required_criteria: z.array(z.string().min(1)).max(16),
  satisfied_criteria: z.array(z.string().min(1)).max(16),
  remaining_limitations: z.array(z.string().min(1)).max(16),
  revision_ready: z.boolean().nullable(),
  stopping_outcome: z.enum([
    "continue",
    "revise",
    "close",
    "instructor_support"
  ]).nullable(),
  unresolved_gap: z.string().nullable(),
  intervention_history: z.array(z.string().min(1)).max(16),
  handoff_reason: z.string().nullable()
}).strict();

export const ResearchDecisionTraceSchema = z.object({
  trace_id: z.string().min(1),
  scope: StudentIsolationScopeSchema,
  decision_sequence: z.number().int().positive(),
  decision_type: AuditDecisionTypeSchema,
  evidence_span_ids: z.array(z.string().min(1)).min(1).max(24),
  previous_profile_snapshot_id: z.string().nullable(),
  resulting_profile_snapshot_id: z.string().min(1),
  policy_id: z.string().min(1),
  policy_version: z.string().min(1),
  rule_codes: z.array(z.string().min(1)).min(1).max(16),
  outcome_code: z.string().min(1),
  student_communication_turn_id: z.string().nullable(),
  details: TraceDetailsSchema,
  hidden_prompt_stored: z.literal(false),
  chain_of_thought_stored: z.literal(false),
  raw_model_reasoning_stored: z.literal(false)
}).strict().superRefine((trace, context) => {
  const requireValue = (
    condition: boolean,
    path: (string | number)[],
    message: string
  ) => {
    if (!condition) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path,
        message
      });
    }
  };
  if (trace.decision_type === "misconception_identification") {
    requireValue(
      Boolean(trace.details.identified_knowledge_gap),
      ["details", "identified_knowledge_gap"],
      "misconception_trace_requires_identified_gap"
    );
    requireValue(
      Boolean(trace.details.profile_update_source),
      ["details", "profile_update_source"],
      "misconception_trace_requires_update_source"
    );
  }
  if (trace.decision_type === "tutor_intervention_selection") {
    requireValue(
      Boolean(trace.details.remaining_gap),
      ["details", "remaining_gap"],
      "intervention_trace_requires_remaining_gap"
    );
    requireValue(
      Boolean(trace.details.selected_strategy),
      ["details", "selected_strategy"],
      "intervention_trace_requires_selected_strategy"
    );
    requireValue(
      Boolean(trace.details.intervention_goal),
      ["details", "intervention_goal"],
      "intervention_trace_requires_goal"
    );
  }
  if (trace.decision_type === "profile_update") {
    requireValue(
      Boolean(trace.details.previous_profile_state),
      ["details", "previous_profile_state"],
      "profile_trace_requires_previous_state"
    );
    requireValue(
      Boolean(trace.details.updated_profile_state),
      ["details", "updated_profile_state"],
      "profile_trace_requires_updated_state"
    );
    requireValue(
      trace.details.transition_reason_codes.length > 0,
      ["details", "transition_reason_codes"],
      "profile_trace_requires_transition_reasons"
    );
  }
  if (trace.decision_type === "sound_decision") {
    requireValue(
      trace.details.required_criteria.length > 0,
      ["details", "required_criteria"],
      "sound_trace_requires_criteria"
    );
    requireValue(
      trace.details.revision_ready !== null,
      ["details", "revision_ready"],
      "sound_trace_requires_revision_readiness"
    );
  }
  if (trace.decision_type === "stopping_decision") {
    requireValue(
      trace.details.stopping_outcome !== null,
      ["details", "stopping_outcome"],
      "stopping_trace_requires_outcome"
    );
  }
  if (trace.decision_type === "instructor_handoff") {
    requireValue(
      Boolean(trace.details.unresolved_gap),
      ["details", "unresolved_gap"],
      "handoff_trace_requires_unresolved_gap"
    );
    requireValue(
      trace.details.intervention_history.length > 0,
      ["details", "intervention_history"],
      "handoff_trace_requires_intervention_history"
    );
    requireValue(
      Boolean(trace.details.handoff_reason),
      ["details", "handoff_reason"],
      "handoff_trace_requires_reason"
    );
  }
});
export type ResearchDecisionTrace = z.infer<
  typeof ResearchDecisionTraceSchema
>;

export type ResearchAuditDataset = {
  acceptedTurns: AcceptedAuditTurn[];
  evidenceSpans: StructuredEvidenceSpan[];
  profileSnapshots: AuditProfileSnapshot[];
  decisionTraces: ResearchDecisionTrace[];
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function sameEvidenceScope(
  first: StudentIsolationScope,
  second: StudentIsolationScope
) {
  return isolationNamespace(first) === isolationNamespace(second);
}

export function buildResearchEvidenceTraceabilityContractV1() {
  return {
    contract_version: RESEARCH_EVIDENCE_TRACEABILITY_VERSION,
    trace_chain: [
      "decision",
      "evidence_source",
      "profile_state",
      "rule_or_policy",
      "outcome",
      "student_facing_communication"
    ],
    auditable_decisions: [...AuditDecisionTypeSchema.options],
    required_provenance: [
      "accepted_turn_id",
      "evidence_span_id",
      "profile_snapshot_id",
      "policy_id",
      "policy_version",
      "rule_code",
      "outcome_code"
    ],
    prohibited_storage: [
      "chain_of_thought",
      "hidden_model_reasoning",
      "hidden_prompts",
      "unnecessary_private_data"
    ],
    structured_reason_codes_only: true
  } as const;
}

export function buildResearchReplayContractV1() {
  return {
    contract_version: RESEARCH_REPLAY_CONTRACT_VERSION,
    reconstructs: [
      "accepted_student_turn_sequence",
      "structured_evidence_extraction",
      "profile_transitions",
      "intervention_sequence",
      "stopping_outcome"
    ],
    replay_order: [
      "student_session_namespace",
      "sequence",
      "stable_record_id"
    ],
    excludes: [
      "hidden_prompts",
      "private_data",
      "chain_of_thought",
      "provider_transport_payload"
    ],
    deterministic_from_structured_records: true,
    created_at_not_authoritative: true
  } as const;
}

export function buildHumanReviewEvidencePackageContractV1() {
  return {
    contract_version: HUMAN_REVIEW_EVIDENCE_PACKAGE_VERSION,
    required_sections: [
      "student_visible_conversation",
      "structured_evidence_summary",
      "profile_transitions",
      "intervention_history",
      "final_outcome"
    ],
    excluded_sections: [
      "hidden_reasoning",
      "model_chain_of_thought",
      "hidden_prompts",
      "unnecessary_system_metadata",
      "private_identifiers"
    ],
    student_text_scope: "accepted_student_visible_turns_only",
    reviewer_must_not_infer_unobserved_reasoning: true
  } as const;
}

export function buildStudentAuditSeparationContractV1() {
  return {
    contract_version: STUDENT_AUDIT_SEPARATION_VERSION,
    student_visible_forbidden_labels: [
      "policy version",
      "policy id",
      "profile schema",
      "confidence score",
      "escalation criteria",
      "model decision",
      "rule code",
      "stopping outcome",
      "audit trace",
      "internal label"
    ],
    audit_only_fields: [
      "profile_snapshot_id",
      "policy_id",
      "policy_version",
      "rule_codes",
      "outcome_code",
      "decision_type"
    ],
    student_output_contains_audit_metadata: false,
    audit_output_may_contain_structured_metadata: true
  } as const;
}

export function buildAuditMetricsContractV1() {
  return {
    contract_version: AUDIT_METRICS_CONTRACT_VERSION,
    metrics: {
      decision_trace_completeness: {
        numerator: "complete_decision_traces",
        denominator: "major_decision_traces"
      },
      evidence_provenance_completeness: {
        numerator: "resolvable_evidence_references",
        denominator: "all_evidence_references"
      },
      replay_consistency: {
        numerator: "matching_replay_hashes",
        denominator: "replay_permutations"
      },
      audit_student_separation: {
        numerator: "student_messages_without_audit_labels",
        denominator: "student_visible_messages"
      },
      reviewer_usability: {
        numerator: "review_packages_with_all_required_sections",
        denominator: "review_packages"
      },
      privacy_compliance: {
        numerator: "audit_records_without_prohibited_content",
        denominator: "audit_records"
      }
    },
    target_for_protocol_freeze: 1
  } as const;
}

export function validateStudentAuditSeparationV1(text: string) {
  const base = validateStudentFacingClassroomTextV1(text);
  const normalized = text.toLowerCase();
  const contract = buildStudentAuditSeparationContractV1();
  const auditLabels = contract.student_visible_forbidden_labels.filter(
    (label) => normalized.includes(label)
  );
  return {
    contract_version: STUDENT_AUDIT_SEPARATION_VERSION,
    safe: base.safe && auditLabels.length === 0,
    blocked_labels: [...new Set([
      ...base.blocked_labels,
      ...auditLabels
    ])],
    audit_metadata_exposed: auditLabels.length > 0,
    hidden_reasoning_exposed: false
  };
}

export function validateResearchAuditDataset(
  rawDataset: ResearchAuditDataset
) {
  const acceptedTurns = rawDataset.acceptedTurns.map((value) =>
    AcceptedAuditTurnSchema.parse(value)
  );
  const evidenceSpans = rawDataset.evidenceSpans.map((value) =>
    StructuredEvidenceSpanSchema.parse(value)
  );
  const profileSnapshots = rawDataset.profileSnapshots.map((value) =>
    AuditProfileSnapshotSchema.parse(value)
  );
  const decisionTraces = rawDataset.decisionTraces.map((value) =>
    ResearchDecisionTraceSchema.parse(value)
  );
  const turnById = new Map(acceptedTurns.map((turn) => [turn.turn_id, turn]));
  const evidenceById = new Map(
    evidenceSpans.map((span) => [span.evidence_span_id, span])
  );
  const profileById = new Map(
    profileSnapshots.map((profile) => [
      profile.profile_snapshot_id,
      profile
    ])
  );
  const traceIssues: Array<{
    trace_id: string;
    issue_code: string;
    reference_id: string | null;
  }> = [];

  for (const span of evidenceSpans) {
    const turn = turnById.get(span.source_turn_id);
    if (!turn) {
      traceIssues.push({
        trace_id: "evidence_provenance",
        issue_code: "evidence_source_turn_missing",
        reference_id: span.source_turn_id
      });
    } else if (!sameEvidenceScope(span.scope, turn.scope)) {
      traceIssues.push({
        trace_id: "evidence_provenance",
        issue_code: "evidence_source_scope_mismatch",
        reference_id: span.source_turn_id
      });
    }
  }

  for (const profile of profileSnapshots) {
    for (const evidenceId of profile.source_evidence_span_ids) {
      const evidence = evidenceById.get(evidenceId);
      if (!evidence) {
        traceIssues.push({
          trace_id: profile.profile_snapshot_id,
          issue_code: "profile_evidence_missing",
          reference_id: evidenceId
        });
      } else if (!sameEvidenceScope(profile.scope, evidence.scope)) {
        traceIssues.push({
          trace_id: profile.profile_snapshot_id,
          issue_code: "profile_evidence_scope_mismatch",
          reference_id: evidenceId
        });
      }
    }
  }

  for (const trace of decisionTraces) {
    for (const evidenceId of trace.evidence_span_ids) {
      const evidence = evidenceById.get(evidenceId);
      if (!evidence) {
        traceIssues.push({
          trace_id: trace.trace_id,
          issue_code: "trace_evidence_missing",
          reference_id: evidenceId
        });
      } else if (!sameEvidenceScope(trace.scope, evidence.scope)) {
        traceIssues.push({
          trace_id: trace.trace_id,
          issue_code: "trace_evidence_scope_mismatch",
          reference_id: evidenceId
        });
      }
    }
    const resultingProfile = profileById.get(
      trace.resulting_profile_snapshot_id
    );
    if (!resultingProfile) {
      traceIssues.push({
        trace_id: trace.trace_id,
        issue_code: "resulting_profile_missing",
        reference_id: trace.resulting_profile_snapshot_id
      });
    } else if (!sameEvidenceScope(trace.scope, resultingProfile.scope)) {
      traceIssues.push({
        trace_id: trace.trace_id,
        issue_code: "resulting_profile_scope_mismatch",
        reference_id: trace.resulting_profile_snapshot_id
      });
    }
    if (trace.previous_profile_snapshot_id) {
      const previousProfile = profileById.get(
        trace.previous_profile_snapshot_id
      );
      if (!previousProfile) {
        traceIssues.push({
          trace_id: trace.trace_id,
          issue_code: "previous_profile_missing",
          reference_id: trace.previous_profile_snapshot_id
        });
      } else if (!sameEvidenceScope(trace.scope, previousProfile.scope)) {
        traceIssues.push({
          trace_id: trace.trace_id,
          issue_code: "previous_profile_scope_mismatch",
          reference_id: trace.previous_profile_snapshot_id
        });
      } else if (
        trace.decision_type === "profile_update" &&
        trace.details.previous_profile_state !==
          previousProfile.conceptual_state
      ) {
        traceIssues.push({
          trace_id: trace.trace_id,
          issue_code: "previous_profile_state_mismatch",
          reference_id: trace.previous_profile_snapshot_id
        });
      }
    }
    if (
      resultingProfile &&
      trace.decision_type === "profile_update" &&
      trace.details.updated_profile_state !==
        resultingProfile.conceptual_state
    ) {
      traceIssues.push({
        trace_id: trace.trace_id,
        issue_code: "updated_profile_state_mismatch",
        reference_id: trace.resulting_profile_snapshot_id
      });
    }
    if (
      resultingProfile &&
      trace.decision_type === "sound_decision" &&
      trace.details.revision_ready === true &&
      (
        resultingProfile.conceptual_state !== "sound" ||
        resultingProfile.essential_missing_link_codes.length > 0 ||
        trace.details.remaining_limitations.length > 0
      )
    ) {
      traceIssues.push({
        trace_id: trace.trace_id,
        issue_code: "false_sound_trace_detected",
        reference_id: trace.resulting_profile_snapshot_id
      });
    }
    if (
      resultingProfile &&
      trace.decision_type === "stopping_decision" &&
      resultingProfile.conceptual_state === "sound" &&
      resultingProfile.essential_missing_link_codes.length === 0 &&
      trace.details.stopping_outcome === "continue"
    ) {
      traceIssues.push({
        trace_id: trace.trace_id,
        issue_code: "incorrect_stopping_after_sound",
        reference_id: trace.resulting_profile_snapshot_id
      });
    }
    if (trace.student_communication_turn_id) {
      const communication = turnById.get(
        trace.student_communication_turn_id
      );
      if (!communication) {
        traceIssues.push({
          trace_id: trace.trace_id,
          issue_code: "student_communication_missing",
          reference_id: trace.student_communication_turn_id
        });
      } else if (!sameEvidenceScope(trace.scope, communication.scope)) {
        traceIssues.push({
          trace_id: trace.trace_id,
          issue_code: "student_communication_scope_mismatch",
          reference_id: trace.student_communication_turn_id
        });
      }
    }
  }

  const sessions = new Set([
    ...acceptedTurns.map((value) => studentSessionNamespace(value.scope)),
    ...evidenceSpans.map((value) => studentSessionNamespace(value.scope)),
    ...profileSnapshots.map((value) => studentSessionNamespace(value.scope)),
    ...decisionTraces.map((value) => studentSessionNamespace(value.scope))
  ]);
  return {
    validation_version: "research-audit-dataset-validation-v1",
    accepted_turn_count: acceptedTurns.length,
    evidence_span_count: evidenceSpans.length,
    profile_snapshot_count: profileSnapshots.length,
    decision_trace_count: decisionTraces.length,
    student_session_count: sessions.size,
    issues: traceIssues,
    hidden_reasoning_records: decisionTraces.filter((trace) =>
      trace.chain_of_thought_stored ||
      trace.raw_model_reasoning_stored ||
      trace.hidden_prompt_stored
    ).length,
    passed:
      traceIssues.length === 0 &&
      decisionTraces.every((trace) =>
        !trace.chain_of_thought_stored &&
        !trace.raw_model_reasoning_stored &&
        !trace.hidden_prompt_stored
      )
  };
}

export function replayResearchAuditDataset(
  rawDataset: ResearchAuditDataset,
  scope: StudentIsolationScope
) {
  const validation = validateResearchAuditDataset(rawDataset);
  assert(validation.passed, "research_audit_dataset_invalid");
  const namespace = isolationNamespace(scope);
  const turns = rawDataset.acceptedTurns
    .filter((turn) => isolationNamespace(turn.scope) === namespace)
    .map((turn) => AcceptedAuditTurnSchema.parse(turn))
    .sort((first, second) =>
      first.sequence - second.sequence ||
      first.turn_id.localeCompare(second.turn_id)
    );
  const evidence = rawDataset.evidenceSpans
    .filter((span) => isolationNamespace(span.scope) === namespace)
    .map((span) => StructuredEvidenceSpanSchema.parse(span))
    .sort((first, second) =>
      first.source_sequence - second.source_sequence ||
      first.evidence_span_id.localeCompare(second.evidence_span_id)
    );
  const profiles = rawDataset.profileSnapshots
    .filter((profile) =>
      isolationNamespace(profile.scope) === namespace
    )
    .map((profile) => AuditProfileSnapshotSchema.parse(profile))
    .sort((first, second) =>
      first.sequence - second.sequence ||
      first.profile_snapshot_id.localeCompare(
        second.profile_snapshot_id
      )
    );
  const traces = rawDataset.decisionTraces
    .filter((trace) => isolationNamespace(trace.scope) === namespace)
    .map((trace) => ResearchDecisionTraceSchema.parse(trace))
    .sort((first, second) =>
      first.decision_sequence - second.decision_sequence ||
      first.trace_id.localeCompare(second.trace_id)
    );
  const replayCore = {
    contract_version: RESEARCH_REPLAY_CONTRACT_VERSION,
    student_session_namespace_sha256: stableClassroomHash(namespace),
    accepted_turn_ids: turns.map((turn) => turn.turn_id),
    evidence_span_ids: evidence.map((span) => span.evidence_span_id),
    profile_transitions: profiles.map((profile) => ({
      profile_snapshot_id: profile.profile_snapshot_id,
      sequence: profile.sequence,
      conceptual_state: profile.conceptual_state,
      update_source: profile.update_source,
      source_evidence_span_ids: profile.source_evidence_span_ids
    })),
    intervention_trace_ids: traces
      .filter((trace) =>
        trace.decision_type === "tutor_intervention_selection"
      )
      .map((trace) => trace.trace_id),
    stopping_outcomes: traces
      .filter((trace) => trace.decision_type === "stopping_decision")
      .map((trace) => ({
        trace_id: trace.trace_id,
        outcome: trace.details.stopping_outcome
      })),
    final_outcome_code: traces.at(-1)?.outcome_code ?? "no_outcome",
    hidden_prompts_required: false,
    chain_of_thought_required: false,
    private_data_required: false
  };
  return {
    ...replayCore,
    replay_hash: stableClassroomHash(replayCore)
  };
}

export function buildHumanReviewEvidencePackageV1(
  dataset: ResearchAuditDataset,
  scope: StudentIsolationScope
) {
  const replay = replayResearchAuditDataset(dataset, scope);
  const namespace = isolationNamespace(scope);
  const turns = dataset.acceptedTurns
    .filter((turn) => isolationNamespace(turn.scope) === namespace)
    .sort((first, second) => first.sequence - second.sequence);
  const evidence = dataset.evidenceSpans
    .filter((span) => isolationNamespace(span.scope) === namespace)
    .sort((first, second) =>
      first.source_sequence - second.source_sequence
    );
  const profiles = dataset.profileSnapshots
    .filter((profile) =>
      isolationNamespace(profile.scope) === namespace
    )
    .sort((first, second) => first.sequence - second.sequence);
  const traces = dataset.decisionTraces
    .filter((trace) => isolationNamespace(trace.scope) === namespace)
    .sort((first, second) =>
      first.decision_sequence - second.decision_sequence
    );
  return {
    package_version: HUMAN_REVIEW_EVIDENCE_PACKAGE_VERSION,
    synthetic_subject_reference: stableClassroomHash(
      scope.student_subject_id
    ),
    synthetic_session_reference: stableClassroomHash(scope.session_id),
    student_visible_conversation: turns.map((turn) => ({
      sequence: turn.sequence,
      role: turn.role,
      text: turn.student_visible_text
    })),
    structured_evidence_summary: evidence.map((span) => ({
      source_sequence: span.source_sequence,
      evidence_kind: span.evidence_kind,
      safe_evidence_code: span.safe_evidence_code,
      source_text_sha256: span.source_text_sha256
    })),
    profile_transitions: profiles.map((profile) => ({
      sequence: profile.sequence,
      conceptual_state: profile.conceptual_state,
      active_gap_codes: profile.active_gap_codes,
      contradiction_codes: profile.contradiction_codes,
      essential_missing_link_codes:
        profile.essential_missing_link_codes,
      update_source: profile.update_source
    })),
    intervention_history: traces
      .filter((trace) =>
        trace.decision_type === "tutor_intervention_selection"
      )
      .map((trace) => ({
        decision_sequence: trace.decision_sequence,
        selected_strategy: trace.details.selected_strategy,
        intervention_goal: trace.details.intervention_goal,
        outcome: trace.details.intervention_outcome
      })),
    final_outcome: {
      outcome_code: traces.at(-1)?.outcome_code ?? "no_outcome",
      stopping_outcome: traces
        .filter((trace) => trace.decision_type === "stopping_decision")
        .at(-1)?.details.stopping_outcome ?? null,
      replay_hash: replay.replay_hash
    },
    deliberately_excluded: [
      "hidden_reasoning",
      "model_chain_of_thought",
      "hidden_prompts",
      "provider_transport_payload",
      "private_identifiers",
      "unnecessary_system_metadata"
    ],
    contains_hidden_reasoning: false,
    contains_hidden_prompts: false,
    contains_private_identifiers: false
  };
}
