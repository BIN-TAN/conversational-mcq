import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  CanonicalEligibleEvidenceCatalogSchema,
  canonicalEvidenceById,
  canonicalEvidenceSequenceIndexes,
  type CanonicalEvidenceCatalog
} from "@/lib/domain/canonical-evidence-identity";
import type { CanonicalMisconceptionClaimCatalog } from "@/lib/domain/misconception-claim-identity";
import { toPrismaJson } from "@/lib/services/json";
import {
  FORMATIVE_CONVERSATION_CANONICAL_PROFILE_FIELDS,
  type FormativeConversationCanonicalProfile
} from "./agent-contract";
import {
  FORMATIVE_CONVERSATION_V18_PROFILE_SNAPSHOT_VERSION,
  FormativeConversationV18PersistedProfileSnapshotSchema,
  type FormativeConversationV18AgentOutput
} from "./agent-contract-v18";
import { validateFormativeConversationV18Transition } from "./evidence-identity-validator-v18";
import {
  FORMATIVE_CONVERSATION_WRITE_TRANSACTION_OPTIONS,
  formativeConversationPersistenceError
} from "./persistence-errors";
import {
  executeFormativeConversationIdempotentWrite,
  measureFormativeConversationPersistencePhase
} from "./persistence-observability";
import {
  FormativeConversationProfileTransitionError,
  canonicalFormativeConversationProfileStateFromStudentProfile,
  formativeConversationContextOutcome
} from "./profile-update";

export const FORMATIVE_CONVERSATION_V18_PROFILE_TRANSITION_VERSION =
  "formative-conversation-profile-transition-v7" as const;

type Recommendation = NonNullable<
  FormativeConversationV18AgentOutput["profile_transition_recommendation"]
>;

type StoredLearningOutcome =
  | "sound"
  | "largely_improved"
  | "teacher_assistance_recommended";

function storedLearningOutcome(
  proposedOutcome: Recommendation["proposed_outcome"]
): StoredLearningOutcome | null {
  if (proposedOutcome === "sound_understanding") return "sound";
  if (proposedOutcome === "largely_improved_understanding") {
    return "largely_improved";
  }
  if (proposedOutcome === "teacher_assistance_recommended") {
    return "teacher_assistance_recommended";
  }
  return null;
}

function jsonInput(value: unknown): Prisma.InputJsonValue {
  return (toPrismaJson(value) ?? []) as Prisma.InputJsonValue;
}

async function existingTransitionForAgentCall(sourceAgentCallDbId: string) {
  return prisma.formativeConversationProfileTransition.findFirst({
    where: { source_agent_call_db_id: sourceAgentCallDbId },
    include: {
      updated_student_profile: true,
      supporting_turn_references: {
        include: {
          conversation_turn: {
            select: { sequence_index: true, actor_type: true }
          }
        },
        orderBy: { conversation_turn: { sequence_index: "asc" } }
      },
      profile_evidence_references: {
        orderBy: { evidence_observation_index: "asc" }
      }
    }
  });
}

export async function recordFormativeConversationV18ProfileTransitionRecommendation(input: {
  conversation_public_id: string;
  source_agent_call_db_id: string;
  source_tutor_turn_db_id: string;
  allowed_evidence_catalog: CanonicalEvidenceCatalog;
  prior_misconception_claim_catalog: CanonicalMisconceptionClaimCatalog;
  prior_profile_evidence_cutoff_sequence_index: number;
  agent_evidence_observations: FormativeConversationV18AgentOutput["evidence_observations"];
  recommendation: Recommendation;
}) {
  const learningOutcome = storedLearningOutcome(
    input.recommendation.proposed_outcome
  );
  if (!input.recommendation.recommended || !learningOutcome) {
    return null;
  }
  const catalog = CanonicalEligibleEvidenceCatalogSchema.parse(
    input.allowed_evidence_catalog
  );
  const logicalOperationId = `profile-transition-v18:${createHash("sha256")
    .update(`${input.conversation_public_id}:${input.source_agent_call_db_id}`)
    .digest("hex")
    .slice(0, 24)}`;
  const existing = await existingTransitionForAgentCall(
    input.source_agent_call_db_id
  );
  if (existing) {
    return {
      transition: existing,
      updated_profile: existing.updated_student_profile,
      replayed: true
    };
  }

  const session = await measureFormativeConversationPersistencePhase({
    operation_name: "formative_conversation_profile_transition_v18",
    logical_operation_id: logicalOperationId,
    operation_kind: "read",
    phase: "pre_transaction_read",
    execute: () =>
      prisma.formativeConversationSession.findUniqueOrThrow({
        where: { conversation_public_id: input.conversation_public_id },
        include: {
          initial_student_profile: true,
          current_student_profile: true,
          profile_transitions: {
            orderBy: { transitioned_at: "desc" },
            take: 1,
            select: {
              source_turn: {
                select: { sequence_index: true }
              }
            }
          }
        }
      })
  });
  const priorProfile =
    session.current_student_profile ?? session.initial_student_profile;
  if (!priorProfile) {
    throw new FormativeConversationProfileTransitionError(
      "conversation_profile_unavailable",
      "The formative conversation does not have a current learning profile."
    );
  }
  const persistedPriorCutoff =
    session.profile_transitions[0]?.source_turn?.sequence_index ?? 0;
  if (
    persistedPriorCutoff !==
    input.prior_profile_evidence_cutoff_sequence_index
  ) {
    throw new FormativeConversationProfileTransitionError(
      "profile_transition_stale",
      "The formative profile evidence boundary changed before this recommendation was persisted."
    );
  }
  const priorState =
    canonicalFormativeConversationProfileStateFromStudentProfile(priorProfile);
  if (
    JSON.stringify(priorState.misconception_claim_catalog) !==
    JSON.stringify(input.prior_misconception_claim_catalog)
  ) {
    throw new FormativeConversationProfileTransitionError(
      "profile_transition_misconception_claim_unknown",
      "The supplied misconception catalog is not the current persisted profile catalog."
    );
  }
  const validation = validateFormativeConversationV18Transition({
    conversation_public_id: input.conversation_public_id,
    prior_profile_evidence_cutoff_sequence_index:
      input.prior_profile_evidence_cutoff_sequence_index,
    recommendation: input.recommendation,
    prior_profile: priorState.canonical_profile,
    prior_misconception_claim_catalog:
      input.prior_misconception_claim_catalog,
    allowed_evidence_catalog: catalog,
    evidence_observations: input.agent_evidence_observations
  });
  if (!validation.valid || !validation.updated_profile) {
    const primaryIssue = validation.issues[0];
    throw new FormativeConversationProfileTransitionError(
      primaryIssue?.code ?? "profile_transition_field_evidence_invalid",
      primaryIssue?.message ??
        "The V18 profile transition failed canonical evidence validation."
    );
  }

  const citedSequenceIndexes = validation.cited_turn_sequence_indexes;
  const [agentCall, tutorTurn, citedTurns] = await Promise.all([
    prisma.agentCall.findUniqueOrThrow({
      where: { id: input.source_agent_call_db_id },
      select: {
        id: true,
        formative_conversation_session_db_id: true,
        agent_name: true,
        call_status: true,
        output_validated: true,
        agent_call_public_id: true
      }
    }),
    prisma.conversationTurn.findUniqueOrThrow({
      where: { id: input.source_tutor_turn_db_id },
      select: {
        id: true,
        formative_conversation_session_db_id: true,
        actor_type: true,
        agent_name: true,
        sequence_index: true,
        created_at: true
      }
    }),
    prisma.conversationTurn.findMany({
      where: {
        formative_conversation_session_db_id: session.id,
        sequence_index: { in: citedSequenceIndexes }
      },
      select: { id: true, sequence_index: true, actor_type: true }
    })
  ]);
  if (
    agentCall.formative_conversation_session_db_id !== session.id ||
    agentCall.agent_name !== "formative_conversation_agent" ||
    agentCall.call_status !== "succeeded" ||
    !agentCall.output_validated
  ) {
    throw new FormativeConversationProfileTransitionError(
      "profile_transition_agent_call_mismatch",
      "The V18 transition agent call is not a validated call for this conversation."
    );
  }
  if (
    tutorTurn.formative_conversation_session_db_id !== session.id ||
    tutorTurn.actor_type !== "agent" ||
    tutorTurn.agent_name !== "formative_conversation_agent"
  ) {
    throw new FormativeConversationProfileTransitionError(
      "profile_transition_tutor_turn_mismatch",
      "The V18 transition tutor turn does not belong to this conversation."
    );
  }
  if (
    citedTurns.length !== citedSequenceIndexes.length ||
    citedTurns.some((turn) => turn.actor_type !== "student")
  ) {
    throw new FormativeConversationProfileTransitionError(
      "profile_transition_evidence_turn_mismatch",
      "Canonical formative evidence does not resolve to student turns in this conversation."
    );
  }

  const updatedCanonicalProfile = validation.updated_profile;
  const updatedClaimCatalog =
    validation.updated_misconception_claim_catalog;
  if (!updatedClaimCatalog) {
    throw new FormativeConversationProfileTransitionError(
      "profile_transition_updated_profile_missing",
      "The V18 transition did not produce a misconception claim catalog."
    );
  }
  const fieldEvidenceByField = new Map(
    input.recommendation.field_evidence.flatMap((entry) =>
      entry.profile_fields.map((field) => [field, entry] as const)
    )
  );
  const usePriorStoredField = (
    field: (typeof FORMATIVE_CONVERSATION_CANONICAL_PROFILE_FIELDS)[number]
  ) =>
    fieldEvidenceByField.get(field)?.disposition ===
    "retained_evidence_remains_valid";
  const evidenceById = canonicalEvidenceById(catalog);
  const learningObservations = input.agent_evidence_observations.map(
    (observation) => ({
      evidence_type: observation.evidence_type,
      observation: observation.observation,
      evidence_ids: observation.evidence_ids,
      source_turn_sequence_indexes: canonicalEvidenceSequenceIndexes(
        catalog,
        observation.evidence_ids
      )
    })
  );
  const citedEvidence = catalog.evidence.filter((entry) =>
    validation.canonical_evidence_ids.includes(entry.evidence_id)
  );
  if (
    citedEvidence.some(
      (entry) =>
        !evidenceById.has(entry.evidence_id) ||
        entry.source_role === "tutor" ||
        entry.source_role === "teacher_private"
    )
  ) {
    throw new FormativeConversationProfileTransitionError(
      "profile_transition_evidence_ineligible",
      "The canonical V18 transition contains ineligible evidence."
    );
  }

  const persistTransition = async () => {
    const createdProfile =
      await measureFormativeConversationPersistencePhase({
        operation_name: "formative_conversation_profile_transition_v18",
        logical_operation_id: logicalOperationId,
        operation_kind: "write",
        phase: "transaction",
        transaction_timeout_ms:
          FORMATIVE_CONVERSATION_WRITE_TRANSACTION_OPTIONS.timeout,
        mutation_may_have_occurred: true,
        execute: () =>
          prisma.$transaction(async (tx) => {
            const claimed = await tx.formativeConversationSession.updateMany({
              where: {
                id: session.id,
                current_student_profile_db_id:
                  session.current_student_profile_db_id,
                concurrency_version: session.concurrency_version
              },
              data: { concurrency_version: { increment: 1 } }
            });
            if (claimed.count !== 1) {
              throw new FormativeConversationProfileTransitionError(
                "profile_transition_stale",
                "The formative conversation profile changed before this transition was recorded."
              );
            }
            const created = await tx.studentProfile.create({
              data: {
                concept_unit_session_db_id:
                  priorProfile.concept_unit_session_db_id,
                profile_type: "updated",
                ability_profile: updatedCanonicalProfile.ability_profile,
                ability_pattern_flags: jsonInput(
                  usePriorStoredField("ability_pattern_flags")
                    ? priorProfile.ability_pattern_flags
                    : updatedCanonicalProfile.ability_pattern_flags
                ),
                engagement_profile:
                  updatedCanonicalProfile.engagement_profile,
                engagement_pattern_flags: jsonInput(
                  usePriorStoredField("engagement_pattern_flags")
                    ? priorProfile.engagement_pattern_flags
                    : updatedCanonicalProfile.engagement_pattern_flags
                ),
                integrated_diagnostic_profile:
                  updatedCanonicalProfile.integrated_diagnostic_profile,
                integrated_profile_confidence:
                  updatedCanonicalProfile.integrated_profile_confidence,
                integrated_profile_rationale:
                  updatedCanonicalProfile.integrated_profile_rationale,
                evidence_sufficiency:
                  updatedCanonicalProfile.evidence_sufficiency,
                confidence_alignment:
                  updatedCanonicalProfile.confidence_alignment,
                independence_interpretability:
                  updatedCanonicalProfile.independence_interpretability,
                misconception_indicators: jsonInput(updatedClaimCatalog),
                item_level_evidence: jsonInput(
                  usePriorStoredField("item_level_evidence")
                    ? priorProfile.item_level_evidence
                    : updatedCanonicalProfile.item_level_evidence
                ),
                reasoning_quality_summary:
                  updatedCanonicalProfile.reasoning_quality_summary,
                engagement_summary:
                  updatedCanonicalProfile.engagement_summary,
                process_interpretation_cautions: jsonInput(
                  usePriorStoredField("process_interpretation_cautions")
                    ? priorProfile.process_interpretation_cautions
                    : updatedCanonicalProfile.process_interpretation_cautions
                ),
                profile_confidence:
                  updatedCanonicalProfile.profile_confidence,
                rationale: updatedCanonicalProfile.rationale,
                recommended_next_evidence: jsonInput(
                  usePriorStoredField("recommended_next_evidence")
                    ? priorProfile.recommended_next_evidence
                    : updatedCanonicalProfile.recommended_next_evidence
                ),
                based_on_agent_call_db_id: agentCall.id
              }
            });
            const profileSnapshot =
              FormativeConversationV18PersistedProfileSnapshotSchema.parse({
                snapshot_version:
                  FORMATIVE_CONVERSATION_V18_PROFILE_SNAPSHOT_VERSION,
                prior_profile_evidence_cutoff_sequence_index:
                  input.prior_profile_evidence_cutoff_sequence_index,
                profile: {
                  profile_version: created.id,
                  evidence_cutoff_sequence_index: tutorTurn.sequence_index,
                  outcome: formativeConversationContextOutcome(learningOutcome),
                  evidence_summary: learningObservations.map(
                    (observation) => observation.observation
                  ),
                  unresolved_evidence:
                    updatedCanonicalProfile.recommended_next_evidence,
                  evidence_limitations:
                    updatedCanonicalProfile.process_interpretation_cautions,
                  canonical_profile: updatedCanonicalProfile,
                  misconception_claim_catalog: updatedClaimCatalog
                },
                field_evidence: input.recommendation.field_evidence,
                misconception_claim_dispositions:
                  input.recommendation.misconception_claim_dispositions,
                canonical_evidence_catalog: catalog,
                canonical_evidence_ids: validation.canonical_evidence_ids,
                evidence_observations: input.agent_evidence_observations,
                rationale: input.recommendation.rationale,
                derived_source_turn_sequence_indexes: citedSequenceIndexes
              });
            const transition =
              await tx.formativeConversationProfileTransition.create({
                data: {
                  formative_conversation_session_db_id: session.id,
                  prior_student_profile_db_id: priorProfile.id,
                  updated_student_profile_db_id: created.id,
                  assessment_student_profile_db_id:
                    session.initial_student_profile_db_id,
                  source_turn_db_id: tutorTurn.id,
                  source_agent_call_db_id: agentCall.id,
                  transition_version:
                    FORMATIVE_CONVERSATION_V18_PROFILE_TRANSITION_VERSION,
                  learning_outcome: learningOutcome,
                  learning_observations: jsonInput(learningObservations),
                  evidence_interpretation: input.recommendation.rationale,
                  profile_snapshot: jsonInput(profileSnapshot),
                  transitioned_at: tutorTurn.created_at
                }
              });
            await tx.formativeConversationProfileTransitionTurnReference.createMany({
              data: [
                ...citedTurns.map((turn) => ({
                  profile_transition_db_id: transition.id,
                  conversation_turn_db_id: turn.id,
                  evidence_role: "student_evidence"
                })),
                ...(citedTurns.some((turn) => turn.id === tutorTurn.id)
                  ? []
                  : [{
                      profile_transition_db_id: transition.id,
                      conversation_turn_db_id: tutorTurn.id,
                      evidence_role: "tutor_interpretation"
                    }])
              ],
              skipDuplicates: true
            });
            const linkedEvidence =
              await tx.formativeConversationProfileEvidenceReference.updateMany({
                where: {
                  formative_conversation_session_db_id: session.id,
                  source_agent_call_db_id: agentCall.id
                },
                data: { profile_transition_db_id: transition.id }
              });
            if (linkedEvidence.count === 0) {
              throw new FormativeConversationProfileTransitionError(
                "profile_transition_evidence_missing",
                "The V18 transition has no persisted evidence references."
              );
            }
            await tx.formativeConversationSession.update({
              where: { id: session.id },
              data: {
                current_student_profile_db_id: created.id,
                last_activity_at: tutorTurn.created_at
              }
            });
            await tx.conceptUnitSession.update({
              where: { id: session.concept_unit_session_db_id },
              data: { latest_student_profile_db_id: created.id }
            });
            await tx.formativeConversationReviewSignal.create({
              data: {
                formative_conversation_session_db_id: session.id,
                source_student_profile_db_id: priorProfile.id,
                source_turn_db_id: tutorTurn.id,
                signal_type: "profile_transition_recommendation",
                reason_code: learningOutcome,
                evidence_summary: jsonInput({
                  transition_public_id: transition.transition_public_id,
                  transition_version:
                    FORMATIVE_CONVERSATION_V18_PROFILE_TRANSITION_VERSION,
                  recommendation_version:
                    input.recommendation.recommendation_version,
                  canonical_evidence_ids:
                    validation.canonical_evidence_ids,
                  derived_source_turn_sequence_indexes: citedSequenceIndexes,
                  field_evidence: input.recommendation.field_evidence,
                  misconception_claim_dispositions:
                    input.recommendation.misconception_claim_dispositions,
                  misconception_claim_catalog: updatedClaimCatalog,
                  source_agent_call_public_id:
                    agentCall.agent_call_public_id
                })
              }
            });
            return created;
          }, FORMATIVE_CONVERSATION_WRITE_TRANSACTION_OPTIONS)
      });
    const persisted = await existingTransitionForAgentCall(
      input.source_agent_call_db_id
    );
    if (!persisted) {
      throw new Error("profile_transition_finalization_missing");
    }
    return {
      transition: persisted,
      updated_profile: createdProfile,
      replayed: false
    };
  };

  try {
    return await executeFormativeConversationIdempotentWrite({
      operation_name: "formative_conversation_profile_transition_v18",
      logical_operation_id: logicalOperationId,
      execute: persistTransition,
      reconcile: async () => {
        const persisted = await existingTransitionForAgentCall(
          input.source_agent_call_db_id
        );
        return persisted
          ? {
              status: "committed" as const,
              value: {
                transition: persisted,
                updated_profile: persisted.updated_student_profile,
                replayed: true
              }
            }
          : { status: "not_committed" as const };
      }
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      const replayed = await existingTransitionForAgentCall(
        input.source_agent_call_db_id
      );
      if (replayed) {
        return {
          transition: replayed,
          updated_profile: replayed.updated_student_profile,
          replayed: true
        };
      }
    }
    if (error instanceof FormativeConversationProfileTransitionError) {
      throw error;
    }
    throw formativeConversationPersistenceError(
      error,
      error instanceof Error &&
        error.message === "profile_transition_finalization_missing"
        ? "finalization"
        : "transition_persistence"
    );
  }
}

export function v18PersistedSnapshotProfile(value: unknown): {
  profile: FormativeConversationCanonicalProfile;
  misconception_claim_catalog: CanonicalMisconceptionClaimCatalog;
} | null {
  const parsed = FormativeConversationV18PersistedProfileSnapshotSchema.safeParse(
    value
  );
  return parsed.success &&
    parsed.data.profile.canonical_profile &&
    parsed.data.profile.misconception_claim_catalog
    ? {
        profile: parsed.data.profile.canonical_profile,
        misconception_claim_catalog:
          parsed.data.profile.misconception_claim_catalog
      }
    : null;
}
