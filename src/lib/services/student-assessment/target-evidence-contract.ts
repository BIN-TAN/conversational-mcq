import { z } from "zod";
import type {
  ActivityMisconceptionEvidencePacketV1
} from "@/lib/services/student-assessment/activity-misconception-evidence";
import type {
  TurnEvidenceObservation
} from "@/lib/services/student-assessment/topic-dialogue-evidence-first-routing";

export const TARGET_EVIDENCE_CONTRACT_VERSION =
  "target-evidence-contract-v1" as const;
export const PRODUCTION_TURN_EVIDENCE_EVALUATOR_VERSION =
  "production-turn-evidence-evaluator-v2" as const;
export const TURN_EVIDENCE_PROFILE_MAPPER_VERSION =
  "turn-evidence-profile-mapper-v2" as const;
export const PROFILE_CONSISTENCY_POLICY_VERSION =
  "turn-evidence-profile-consistency-v2" as const;

const CriterionKindSchema = z.enum([
  "conceptual_relationship",
  "required_mechanism",
  "anchor_application",
  "coherent_conclusion",
  "optional_deepening"
]);

const EvidenceCriterionSchema = z.object({
  criterion_id: z.string().min(1).max(120),
  criterion_kind: CriterionKindSchema,
  description: z.string().min(1).max(500),
  essential_for_revision: z.boolean(),
  acceptable_evidence_patterns: z.array(z.string().min(1).max(500)).max(20)
}).strict();

const ContradictionCriterionSchema = z.object({
  contradiction_id: z.string().min(1).max(120),
  description: z.string().min(1).max(500),
  observable_patterns: z.array(z.string().min(1).max(500)).max(20)
}).strict();

export const TargetEvidenceContractSchema = z.object({
  contract_version: z.literal(TARGET_EVIDENCE_CONTRACT_VERSION),
  concept_id: z.string().min(1),
  item_id: z.string().min(1),
  distractor_option: z.string().min(1).max(20),
  distractor_claim: z.string().min(1).max(1000),
  target_conceptual_relationships: z.array(z.string().min(1).max(500)).min(1),
  required_mechanisms: z.array(z.string().min(1).max(500)).min(1),
  acceptable_equivalent_explanations: z.array(
    z.string().min(1).max(500)
  ).max(20),
  required_anchor_application: z.string().min(1).max(500),
  prohibited_contradictions: z.array(z.string().min(1).max(500)).min(1),
  revision_ready_criteria: z.array(z.string().min(1).max(120)).min(1),
  optional_deepening_criteria: z.array(z.string().min(1).max(120)).max(20),
  evidence_limitations: z.array(z.string().min(1).max(500)).max(20),
  criteria: z.array(EvidenceCriterionSchema).min(1).max(30),
  contradiction_criteria: z.array(ContradictionCriterionSchema).max(20)
}).strict();
export type TargetEvidenceContract = z.infer<
  typeof TargetEvidenceContractSchema
>;

const ExactEvidenceSpanSchema = z.object({
  label: z.string().min(1).max(120),
  span: z.string().min(1).max(900)
}).strict();

const CriterionResultSchema = z.object({
  criterion_id: z.string().min(1).max(120),
  satisfied: z.boolean(),
  exact_evidence_spans: z.array(ExactEvidenceSpanSchema).max(12),
  confidence: z.enum(["high", "medium", "low"])
}).strict();

const ContradictionResultSchema = z.object({
  contradiction_id: z.string().min(1).max(120),
  present: z.boolean(),
  exact_evidence_spans: z.array(ExactEvidenceSpanSchema).max(12)
}).strict();

export const TargetEvidenceAdjudicationSchema = z.object({
  evaluator_version: z.literal(PRODUCTION_TURN_EVIDENCE_EVALUATOR_VERSION),
  target_evidence_contract_version: z.literal(
    TARGET_EVIDENCE_CONTRACT_VERSION
  ),
  criterion_results: z.array(CriterionResultSchema).min(1).max(30),
  contradiction_results: z.array(ContradictionResultSchema).max(20),
  evidence_quality: z.enum(["insufficient", "low", "medium", "high"]),
  coherent_conclusion: z.boolean(),
  limitations: z.array(z.string().min(1).max(500)).max(20)
}).strict();
export type TargetEvidenceAdjudication = z.infer<
  typeof TargetEvidenceAdjudicationSchema
>;

function unique(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function exactMessageSpan(label: string, message: string) {
  return [{ label, span: message.trim().slice(0, 900) }];
}

function yes(value: "yes" | "no" | "partial" | "not_applicable") {
  return value === "yes";
}

export function buildActivityTargetEvidenceContract(input: {
  concept_id: string;
  item_id: string;
  distractor_option: string;
  distractor_claim: string;
  packet: ActivityMisconceptionEvidencePacketV1;
}): TargetEvidenceContract {
  const strongEvidence = input.packet.evidence_elicitation_target
    .what_counts_as_strong_evidence;
  const secondary = input.packet.evidence_elicitation_target.secondary_targets;
  return TargetEvidenceContractSchema.parse({
    contract_version: TARGET_EVIDENCE_CONTRACT_VERSION,
    concept_id: input.concept_id,
    item_id: input.item_id,
    distractor_option: input.distractor_option,
    distractor_claim: input.distractor_claim,
    target_conceptual_relationships: strongEvidence,
    required_mechanisms: [
      "Explain the mechanism or reasoning link that supports the target boundary."
    ],
    acceptable_equivalent_explanations: unique(strongEvidence),
    required_anchor_application:
      `Apply the explanation directly to ${input.item_id} ` +
      `option ${input.distractor_option}.`,
    prohibited_contradictions: [input.distractor_claim],
    revision_ready_criteria: [
      "target_conceptual_relationship",
      "required_mechanism",
      "active_anchor_application",
      "coherent_conclusion"
    ],
    optional_deepening_criteria: secondary.map((value) =>
      `optional_${value}`
    ),
    evidence_limitations: [
      "The evaluator packet supplies structured evidence judgments; the mapper does not infer semantic understanding from process data."
    ],
    criteria: [
      {
        criterion_id: "target_conceptual_relationship",
        criterion_kind: "conceptual_relationship",
        description: strongEvidence.join(" "),
        essential_for_revision: true,
        acceptable_evidence_patterns: []
      },
      {
        criterion_id: "required_mechanism",
        criterion_kind: "required_mechanism",
        description:
          "The response explains the essential mechanism or repairs the reasoning link.",
        essential_for_revision: true,
        acceptable_evidence_patterns: []
      },
      {
        criterion_id: "active_anchor_application",
        criterion_kind: "anchor_application",
        description:
          `The response applies the reasoning to ${input.item_id} ` +
          `option ${input.distractor_option}.`,
        essential_for_revision: true,
        acceptable_evidence_patterns: []
      },
      {
        criterion_id: "coherent_conclusion",
        criterion_kind: "coherent_conclusion",
        description:
          "The response reaches a coherent conclusion without retaining the prohibited contradiction.",
        essential_for_revision: true,
        acceptable_evidence_patterns: []
      },
      ...secondary.map((value) => ({
        criterion_id: `optional_${value}`,
        criterion_kind: "optional_deepening" as const,
        description: `Optional deepening evidence: ${value}.`,
        essential_for_revision: false,
        acceptable_evidence_patterns: []
      }))
    ],
    contradiction_criteria: [{
      contradiction_id: "active_distractor_claim_retained",
      description: input.distractor_claim,
      observable_patterns: []
    }]
  });
}

function normalizedAnchorTokens(contract: TargetEvidenceContract) {
  const genericTokens = new Set(["item", "current", "target"]);
  const itemTokens = (contract.item_id.toLowerCase().match(/[a-z0-9]+/gu) ?? [])
    .filter((token) =>
      (token.length > 1 || /^\d+$/u.test(token)) && !genericTokens.has(token)
    );
  const option = contract.distractor_option.toLowerCase();
  return { itemTokens, option };
}

function messageAppliesToAnchor(
  message: string,
  contract: TargetEvidenceContract
) {
  const lower = message.toLowerCase();
  const { itemTokens, option } = normalizedAnchorTokens(contract);
  const itemMentioned = itemTokens.some((token) =>
    new RegExp(`\\b${token.replace(/[^a-z0-9]/gu, "")}\\b`, "iu")
      .test(lower)
  );
  const optionMentioned = new RegExp(
    `\\boption\\s+${option.replace(/[^a-z0-9]/gu, "")}\\b`, "iu"
  ).test(message);
  return itemMentioned && optionMentioned;
}

export function buildTargetEvidenceAdjudicationFromActivityPacket(input: {
  latest_student_message: string;
  packet: ActivityMisconceptionEvidencePacketV1;
  contract: TargetEvidenceContract;
}): TargetEvidenceAdjudication {
  const flags = input.packet.evidence_elicited;
  const update = input.packet.misconception_evidence_update;
  const responseKind = input.packet.student_activity_response.response_kind;
  const relationship = yes(flags.student_explained_target_boundary) ||
    yes(flags.student_reconstructed_concept_independently);
  const mechanism = yes(flags.student_repaired_reasoning_link) ||
    yes(flags.student_identified_hidden_assumption) ||
    (relationship && update.evidence_quality === "high");
  const anchor = messageAppliesToAnchor(
    input.latest_student_message,
    input.contract
  );
  const resolutionStatuses = new Set([
    "misconception_unsupported",
    "boundary_understanding_improved",
    "independent_evidence_supported",
    "no_actionable_misconception_evidence"
  ]);
  const contradictionStatuses = new Set([
    "misconception_persisted",
    "conceptual_entry_gap_remains",
    "reasoning_boundary_still_blurred"
  ]);
  const coherentConclusion = resolutionStatuses.has(update.status) &&
    responseKind === "substantive";
  const criterionTruth = new Map<string, boolean>([
    ["target_conceptual_relationship", relationship],
    ["required_mechanism", mechanism],
    ["active_anchor_application", anchor],
    ["coherent_conclusion", coherentConclusion]
  ]);
  return TargetEvidenceAdjudicationSchema.parse({
    evaluator_version: PRODUCTION_TURN_EVIDENCE_EVALUATOR_VERSION,
    target_evidence_contract_version: input.contract.contract_version,
    criterion_results: input.contract.criteria.map((criterion) => {
      const satisfied = criterion.criterion_kind === "optional_deepening"
        ? false
        : criterionTruth.get(criterion.criterion_id) ?? false;
      return {
        criterion_id: criterion.criterion_id,
        satisfied,
        exact_evidence_spans: satisfied
          ? exactMessageSpan(criterion.criterion_id, input.latest_student_message)
          : [],
        confidence: update.confidence
      };
    }),
    contradiction_results: input.contract.contradiction_criteria.map(
      (criterion) => ({
        contradiction_id: criterion.contradiction_id,
        present: contradictionStatuses.has(update.status),
        exact_evidence_spans: contradictionStatuses.has(update.status)
          ? exactMessageSpan(
              criterion.contradiction_id,
              input.latest_student_message
            )
          : []
      })
    ),
    evidence_quality: update.evidence_quality,
    coherent_conclusion: coherentConclusion,
    limitations: update.limitations
  });
}

export class TargetEvidenceConsistencyError extends Error {
  readonly issue_codes: string[];

  constructor(issueCodes: string[]) {
    super(`target_evidence_profile_inconsistent:${issueCodes.join("|")}`);
    this.name = "TargetEvidenceConsistencyError";
    this.issue_codes = issueCodes;
  }
}

export function mapTargetEvidenceAdjudicationToObservation(input: {
  contract: TargetEvidenceContract;
  adjudication: TargetEvidenceAdjudication;
  interaction_intent: TurnEvidenceObservation["interaction_intent"];
  confidence_evidence?: "high" | "medium" | "low" | null;
}): TurnEvidenceObservation {
  const contract = TargetEvidenceContractSchema.parse(input.contract);
  const adjudication = TargetEvidenceAdjudicationSchema.parse(
    input.adjudication
  );
  const issues: string[] = [];
  const criteriaById = new Map(contract.criteria.map((criterion) => [
    criterion.criterion_id,
    criterion
  ]));
  const resultsById = new Map<string, typeof adjudication.criterion_results[0]>();
  for (const result of adjudication.criterion_results) {
    if (!criteriaById.has(result.criterion_id)) {
      issues.push(`unknown_criterion:${result.criterion_id}`);
    }
    if (resultsById.has(result.criterion_id)) {
      issues.push(`duplicate_criterion:${result.criterion_id}`);
    }
    if (result.satisfied && result.exact_evidence_spans.length === 0) {
      issues.push(`satisfied_criterion_without_span:${result.criterion_id}`);
    }
    resultsById.set(result.criterion_id, result);
  }
  for (const criterion of contract.criteria) {
    if (!resultsById.has(criterion.criterion_id)) {
      issues.push(`criterion_result_missing:${criterion.criterion_id}`);
    }
  }
  const contradictionIds = new Set(
    contract.contradiction_criteria.map((entry) => entry.contradiction_id)
  );
  for (const contradiction of adjudication.contradiction_results) {
    if (!contradictionIds.has(contradiction.contradiction_id)) {
      issues.push(`unknown_contradiction:${contradiction.contradiction_id}`);
    }
    if (contradiction.present &&
        contradiction.exact_evidence_spans.length === 0) {
      issues.push(
        `present_contradiction_without_span:${contradiction.contradiction_id}`
      );
    }
  }
  if (issues.length > 0) throw new TargetEvidenceConsistencyError(issues);

  if (input.interaction_intent !== "ordinary_conceptual_response") {
    return {
      interaction_intent: input.interaction_intent,
      reasoning_quality: "insufficient",
      anchor_application: "absent",
      misconception_status: "uncertain",
      essential_missing_links: ["no_new_conceptual_evidence"],
      contradictions: [],
      observable_evidence_spans: [],
      confidence_evidence: input.confidence_evidence ?? null,
      evidence_limitations: unique([
        ...adjudication.limitations,
        "immediate_intent_route_has_priority"
      ])
    };
  }

  const satisfied = contract.criteria.filter((criterion) =>
    resultsById.get(criterion.criterion_id)?.satisfied
  );
  const essentialMissing = contract.criteria.filter((criterion) =>
    criterion.essential_for_revision &&
    !resultsById.get(criterion.criterion_id)?.satisfied
  );
  const contradictions = adjudication.contradiction_results.filter(
    (entry) => entry.present
  );
  const anchorCriteria = contract.criteria.filter((criterion) =>
    criterion.criterion_kind === "anchor_application"
  );
  const explicitAnchor = anchorCriteria.length > 0 && anchorCriteria.every(
    (criterion) => resultsById.get(criterion.criterion_id)?.satisfied
  );
  const allRevisionCriteriaSatisfied = contract.revision_ready_criteria.every(
    (criterionId) => resultsById.get(criterionId)?.satisfied
  );
  const sound = allRevisionCriteriaSatisfied &&
    essentialMissing.length === 0 &&
    contradictions.length === 0 &&
    adjudication.coherent_conclusion &&
    explicitAnchor;
  const reasoningQuality: TurnEvidenceObservation["reasoning_quality"] = sound
    ? "sound"
    : contradictions.length > 0
      ? "misconception"
      : satisfied.length > 0 ? "partial" : "insufficient";
  const spans = satisfied.flatMap((criterion) =>
    resultsById.get(criterion.criterion_id)?.exact_evidence_spans ?? []
  );
  return {
    interaction_intent: input.interaction_intent,
    reasoning_quality: reasoningQuality,
    anchor_application: explicitAnchor
      ? "explicit"
      : anchorCriteria.some((criterion) =>
          (resultsById.get(criterion.criterion_id)?.exact_evidence_spans.length ?? 0) > 0
        ) ? "implicit" : "absent",
    misconception_status: sound
      ? "resolved_for_current_anchor"
      : contradictions.length > 0 ? "persists" : "uncertain",
    essential_missing_links: essentialMissing.map((entry) =>
      entry.criterion_id
    ),
    contradictions: contradictions.map((entry) => entry.contradiction_id),
    observable_evidence_spans: spans,
    confidence_evidence: input.confidence_evidence ?? null,
    evidence_limitations: unique([
      ...contract.evidence_limitations,
      ...adjudication.limitations,
      ...contract.optional_deepening_criteria.filter((criterionId) =>
        !resultsById.get(criterionId)?.satisfied
      ).map((criterionId) => `optional_deepening_missing:${criterionId}`)
    ])
  };
}

export function assertTargetEvidenceObservationConsistent(input: {
  contract: TargetEvidenceContract;
  adjudication: TargetEvidenceAdjudication;
  observation: TurnEvidenceObservation;
}) {
  const satisfied = new Set(input.adjudication.criterion_results
    .filter((entry) => entry.satisfied)
    .map((entry) => entry.criterion_id));
  const overlap = input.observation.essential_missing_links.filter((entry) =>
    satisfied.has(entry)
  );
  const issues = overlap.map((entry) =>
    `criterion_satisfied_and_missing:${entry}`
  );
  const anchorSatisfied = input.contract.criteria
    .filter((entry) => entry.criterion_kind === "anchor_application")
    .every((entry) => satisfied.has(entry.criterion_id));
  if (anchorSatisfied && input.observation.anchor_application !== "explicit") {
    issues.push("explicit_anchor_evidence_not_mapped_explicit");
  }
  if (input.observation.reasoning_quality === "sound" &&
      (input.observation.essential_missing_links.length > 0 ||
       input.observation.contradictions.length > 0 ||
       input.observation.anchor_application !== "explicit")) {
    issues.push("sound_profile_has_blocking_condition");
  }
  if (issues.length > 0) throw new TargetEvidenceConsistencyError(issues);
  return {
    policy_version: PROFILE_CONSISTENCY_POLICY_VERSION,
    passed: true,
    satisfied_criteria: [...satisfied],
    essential_missing_links: input.observation.essential_missing_links,
    optional_deepening_blocks_revision: false
  };
}
