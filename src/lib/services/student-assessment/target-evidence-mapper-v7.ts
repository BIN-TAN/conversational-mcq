import { z } from "zod";
import {
  evaluateAnchorConsistentSoundGate
} from "@/lib/services/student-assessment/anchor-conclusion-consistency";
import {
  PROFILE_CONSISTENCY_POLICY_VERSION_V6,
  TargetEvidenceAdjudicationV5Schema,
  TargetEvidenceContractV5Schema,
  assertTargetEvidenceObservationConsistentV6,
  mapTargetEvidenceAdjudicationToObservationV6,
  type TargetEvidenceAdjudicationV5,
  type TargetEvidenceContractV5,
  type TurnEvidenceObservationV5
} from "@/lib/services/student-assessment/target-evidence-contract-v5";
import type {
  TurnEvidenceObservation
} from "@/lib/services/student-assessment/topic-dialogue-evidence-first-routing";

export const TARGET_EVIDENCE_MAPPER_PRESERVATION_VERSION =
  "target-evidence-mapper-preservation-v1" as const;
export const TURN_EVIDENCE_PROFILE_MAPPER_VERSION_V7 =
  "turn-evidence-profile-mapper-v7" as const;
export const PROFILE_CONSISTENCY_POLICY_VERSION_V7 =
  "turn-evidence-profile-consistency-v7" as const;

const EvidenceSpanSchema = z.object({
  label: z.string().min(1),
  span: z.string().min(1)
}).strict();

export const TargetEvidenceMapperPreservationAuditV1Schema = z.object({
  preservation_version: z.literal(
    TARGET_EVIDENCE_MAPPER_PRESERVATION_VERSION
  ),
  mapper_version: z.literal(TURN_EVIDENCE_PROFILE_MAPPER_VERSION_V7),
  source_evaluator_missing_links: z.array(z.string().min(1)),
  mapped_missing_links: z.array(z.string().min(1)),
  source_blocking_contradictions: z.array(z.string().min(1)),
  mapped_contradictions: z.array(z.string().min(1)),
  source_unresolved_limitations: z.array(z.string().min(1)),
  mapped_limitations: z.array(z.string().min(1)),
  source_evidence_spans: z.array(EvidenceSpanSchema),
  mapped_evidence_spans: z.array(EvidenceSpanSchema),
  missing_link_preservation_passed: z.literal(true),
  contradiction_preservation_passed: z.literal(true),
  limitation_preservation_passed: z.literal(true),
  evidence_span_preservation_passed: z.literal(true),
  sound_gate_received_all_evaluator_missing_links: z.literal(true),
  sound_requires_no_essential_missing_links: z.literal(true),
  passed: z.literal(true)
}).strict();
export type TargetEvidenceMapperPreservationAuditV1 = z.infer<
  typeof TargetEvidenceMapperPreservationAuditV1Schema
>;

export class TargetEvidenceMapperPreservationErrorV1 extends Error {
  readonly issue_codes: string[];

  constructor(issueCodes: string[]) {
    super(`target_evidence_mapper_preservation_failed:${
      issueCodes.join("|")
    }`);
    this.name = "TargetEvidenceMapperPreservationErrorV1";
    this.issue_codes = issueCodes;
  }
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function uniqueSpans(values: Array<{ label: string; span: string }>) {
  return [...new Map(values.map((entry) => [
    JSON.stringify({ label: entry.label, span: entry.span }),
    { label: entry.label, span: entry.span }
  ])).values()];
}

function includesEveryString(actual: string[], expected: string[]) {
  const actualSet = new Set(actual);
  return expected.every((entry) => actualSet.has(entry));
}

function includesEverySpan(
  actual: Array<{ label: string; span: string }>,
  expected: Array<{ label: string; span: string }>
) {
  const actualSet = new Set(actual.map((entry) =>
    JSON.stringify({ label: entry.label, span: entry.span })
  ));
  return expected.every((entry) =>
    actualSet.has(JSON.stringify({ label: entry.label, span: entry.span }))
  );
}

function sourceBlockingContradictions(
  adjudication: TargetEvidenceAdjudicationV5
) {
  return uniqueStrings([
    ...adjudication.contradiction_results
      .filter((entry) => entry.present)
      .map((entry) => entry.contradiction_id),
    ...adjudication.anchor_propagation.structured_contradictions
      .map((entry) => entry.contradiction_type)
  ]);
}

function sourceUnresolvedLimitations(input: {
  contract: TargetEvidenceContractV5;
  adjudication: TargetEvidenceAdjudicationV5;
}) {
  return uniqueStrings([
    ...input.contract.evidence_limitations,
    ...input.adjudication.limitations,
    ...input.adjudication.structured_turn_evidence.evidence_limitations
  ]);
}

function sourceEvidenceSpans(adjudication: TargetEvidenceAdjudicationV5) {
  return uniqueSpans([
    ...adjudication.criterion_results.flatMap((entry) =>
      entry.exact_evidence_spans
    ),
    ...adjudication.contradiction_results.flatMap((entry) =>
      entry.exact_evidence_spans
    ),
    ...adjudication.canonical_anchor_evidence.evidence_spans,
    ...adjudication.structured_turn_evidence.exact_anchor_evidence_spans,
    ...adjudication.structured_turn_evidence.exact_conceptual_evidence_spans,
    ...adjudication.anchor_propagation.structured_contradictions.flatMap(
      (entry) => entry.conflicting_evidence_spans
    )
  ]);
}

export function buildEvidencePreservingSoundGateInputV7(input: {
  contract: TargetEvidenceContractV5;
  adjudication: TargetEvidenceAdjudicationV5;
}) {
  const contract = TargetEvidenceContractV5Schema.parse(input.contract);
  const adjudication = TargetEvidenceAdjudicationV5Schema.parse(
    input.adjudication
  );
  const resultById = new Map(adjudication.criterion_results.map((entry) => [
    entry.criterion_id,
    entry
  ]));
  const conceptualCriteria = contract.criteria.filter((criterion) =>
    criterion.criterion_kind === "conceptual_relationship"
  );
  const mechanismCriteria = contract.criteria.filter((criterion) =>
    criterion.criterion_kind === "required_mechanism"
  );
  const essentialMissingLinks = contract.criteria.filter((criterion) =>
    criterion.essential_for_revision &&
    !resultById.get(criterion.criterion_id)?.satisfied
  ).map((criterion) => criterion.criterion_id);
  const interpretation =
    adjudication.anchor_propagation.anchor_interpretation;
  if (interpretation.anchor_stance !== contract.required_anchor_stance) {
    essentialMissingLinks.push("required_anchor_rejection");
  }
  if (interpretation.anchor_consistency !==
      "consistent_with_conceptual_reasoning") {
    essentialMissingLinks.push("anchor_conclusion_consistency");
  }
  if (interpretation.anchor_resolution_status !==
      "resolved_against_distractor") {
    essentialMissingLinks.push("anchor_resolution_against_distractor");
  }
  essentialMissingLinks.push(
    ...adjudication.structured_turn_evidence.essential_missing_links
  );
  return {
    all_essential_conceptual_relationships_satisfied:
      conceptualCriteria.length > 0 &&
      conceptualCriteria.every((criterion) =>
        resultById.get(criterion.criterion_id)?.satisfied === true
      ),
    required_mechanism_demonstrated:
      mechanismCriteria.length > 0 &&
      mechanismCriteria.every((criterion) =>
        resultById.get(criterion.criterion_id)?.satisfied === true
      ),
    coherent_conclusion: adjudication.coherent_conclusion,
    essential_missing_links: uniqueStrings(essentialMissingLinks),
    contradictions: sourceBlockingContradictions(adjudication),
    interpretation
  };
}

export function assertTargetEvidenceMapperPreservationV1(input: {
  contract: TargetEvidenceContractV5;
  adjudication: TargetEvidenceAdjudicationV5;
  observation: TurnEvidenceObservationV5;
  sound_gate_input: ReturnType<
    typeof buildEvidencePreservingSoundGateInputV7
  >;
}): TargetEvidenceMapperPreservationAuditV1 {
  const contract = TargetEvidenceContractV5Schema.parse(input.contract);
  const adjudication = TargetEvidenceAdjudicationV5Schema.parse(
    input.adjudication
  );
  const sourceMissingLinks = uniqueStrings(
    adjudication.structured_turn_evidence.essential_missing_links
  );
  const sourceContradictions = sourceBlockingContradictions(adjudication);
  const sourceLimitations = sourceUnresolvedLimitations({
    contract,
    adjudication
  });
  const sourceSpans = sourceEvidenceSpans(adjudication);
  const missingLinkPreserved = includesEveryString(
    input.observation.essential_missing_links,
    sourceMissingLinks
  );
  const contradictionsPreserved = includesEveryString(
    input.observation.contradictions,
    sourceContradictions
  ) && adjudication.anchor_propagation.structured_contradictions.every(
    (expected) => input.observation.structured_contradictions.some(
      (actual) =>
        actual.contradiction_type === expected.contradiction_type &&
        actual.anchor_id === expected.anchor_id
    )
  );
  const limitationsPreserved = includesEveryString(
    input.observation.evidence_limitations,
    sourceLimitations
  );
  const spansPreserved = includesEverySpan(
    input.observation.observable_evidence_spans,
    sourceSpans
  );
  const gateReceivedMissingLinks = includesEveryString(
    input.sound_gate_input.essential_missing_links,
    sourceMissingLinks
  );
  const soundInvariant = input.observation.reasoning_quality !== "sound" ||
    input.observation.essential_missing_links.length === 0;
  const issues = [
    !missingLinkPreserved ? "essential_missing_link_removed" : "",
    !contradictionsPreserved ? "blocking_contradiction_removed" : "",
    !limitationsPreserved ? "unresolved_limitation_removed" : "",
    !spansPreserved ? "source_evidence_span_removed" : "",
    !gateReceivedMissingLinks
      ? "sound_gate_missing_evaluator_essential_link" : "",
    !soundInvariant ? "sound_with_essential_missing_links" : ""
  ].filter(Boolean);
  if (issues.length > 0) {
    throw new TargetEvidenceMapperPreservationErrorV1(issues);
  }
  return TargetEvidenceMapperPreservationAuditV1Schema.parse({
    preservation_version: TARGET_EVIDENCE_MAPPER_PRESERVATION_VERSION,
    mapper_version: TURN_EVIDENCE_PROFILE_MAPPER_VERSION_V7,
    source_evaluator_missing_links: sourceMissingLinks,
    mapped_missing_links: input.observation.essential_missing_links,
    source_blocking_contradictions: sourceContradictions,
    mapped_contradictions: input.observation.contradictions,
    source_unresolved_limitations: sourceLimitations,
    mapped_limitations: input.observation.evidence_limitations,
    source_evidence_spans: sourceSpans,
    mapped_evidence_spans: input.observation.observable_evidence_spans,
    missing_link_preservation_passed: true,
    contradiction_preservation_passed: true,
    limitation_preservation_passed: true,
    evidence_span_preservation_passed: true,
    sound_gate_received_all_evaluator_missing_links: true,
    sound_requires_no_essential_missing_links: true,
    passed: true
  });
}

export function mapTargetEvidenceAdjudicationToObservationV7(input: {
  contract: TargetEvidenceContractV5;
  adjudication: TargetEvidenceAdjudicationV5;
  interaction_intent: TurnEvidenceObservation["interaction_intent"];
  confidence_evidence?: "high" | "medium" | "low" | null;
}): TurnEvidenceObservationV5 {
  const contract = TargetEvidenceContractV5Schema.parse(input.contract);
  const adjudication = TargetEvidenceAdjudicationV5Schema.parse(
    input.adjudication
  );
  const base = mapTargetEvidenceAdjudicationToObservationV6({
    contract,
    adjudication,
    interaction_intent: input.interaction_intent,
    confidence_evidence: input.confidence_evidence
  });
  const soundGateInput = buildEvidencePreservingSoundGateInputV7({
    contract,
    adjudication
  });
  const soundGate = evaluateAnchorConsistentSoundGate(soundGateInput);
  const essentialMissingLinks = uniqueStrings([
    ...base.essential_missing_links,
    ...soundGateInput.essential_missing_links
  ]);
  const contradictions = uniqueStrings([
    ...base.contradictions,
    ...soundGateInput.contradictions
  ]);
  const evidenceLimitations = uniqueStrings([
    ...base.evidence_limitations,
    ...sourceUnresolvedLimitations({ contract, adjudication })
  ]);
  const observableEvidenceSpans = uniqueSpans([
    ...base.observable_evidence_spans,
    ...sourceEvidenceSpans(adjudication)
  ]);
  const reasoningQuality = !soundGate.passed &&
      base.reasoning_quality === "sound"
    ? "partial"
    : base.reasoning_quality;
  const observation: TurnEvidenceObservationV5 = {
    ...base,
    reasoning_quality: reasoningQuality,
    misconception_status: reasoningQuality === "sound"
      ? base.misconception_status
      : base.misconception_status === "resolved_for_current_anchor"
        ? "uncertain"
        : base.misconception_status,
    essential_missing_links: essentialMissingLinks,
    contradictions,
    observable_evidence_spans: observableEvidenceSpans,
    evidence_limitations: evidenceLimitations
  };
  assertTargetEvidenceMapperPreservationV1({
    contract,
    adjudication,
    observation,
    sound_gate_input: soundGateInput
  });
  return observation;
}

export function assertTargetEvidenceObservationConsistentV7(input: {
  contract: TargetEvidenceContractV5;
  adjudication: TargetEvidenceAdjudicationV5;
  observation: TurnEvidenceObservationV5;
}) {
  const soundGateInput = buildEvidencePreservingSoundGateInputV7({
    contract: input.contract,
    adjudication: input.adjudication
  });
  const preservation = assertTargetEvidenceMapperPreservationV1({
    ...input,
    sound_gate_input: soundGateInput
  });
  const legacyConsistency = assertTargetEvidenceObservationConsistentV6(
    input
  );
  return {
    ...legacyConsistency,
    prior_policy_version: PROFILE_CONSISTENCY_POLICY_VERSION_V6,
    policy_version: PROFILE_CONSISTENCY_POLICY_VERSION_V7,
    mapper_version: TURN_EVIDENCE_PROFILE_MAPPER_VERSION_V7,
    evidence_preservation: preservation
  };
}
