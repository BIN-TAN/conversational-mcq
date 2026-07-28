import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { toPrismaJson } from "@/lib/services/json";
import {
  FormativeConversationProfileEvidenceSchema,
  type FormativeConversationAgentOutput,
  type FormativeConversationProfileEvidence
} from "./agent-contract";

export const FORMATIVE_CONVERSATION_PROFILE_TRANSITION_VERSION =
  "formative-conversation-profile-transition-v1";

export type FormativeConversationProfileEvidenceHookInput = {
  conversation_public_id: string;
  source_agent_call_db_id: string;
  source_tutor_turn_db_id: string;
  agent_evidence_observations: FormativeConversationAgentOutput["evidence_observations"];
};

export type FormativeConversationProfileEvidenceHookResult = {
  evidence_reference_public_ids: string[];
  profile_changed: false;
};

export interface FormativeConversationProfileEvidenceHook {
  recordEvidenceReferences(
    input: FormativeConversationProfileEvidenceHookInput
  ): Promise<FormativeConversationProfileEvidenceHookResult>;
}

export class FormativeConversationProfileTransitionError extends Error {
  constructor(
    public readonly code:
      | "conversation_profile_unavailable"
      | "profile_transition_agent_call_mismatch"
      | "profile_transition_tutor_turn_mismatch"
      | "profile_transition_evidence_turn_mismatch"
      | "profile_transition_student_evidence_missing"
      | "profile_transition_stale",
    message: string
  ) {
    super(message);
    this.name = "FormativeConversationProfileTransitionError";
  }
}

type AgentTransitionRecommendation = NonNullable<
  FormativeConversationAgentOutput["profile_transition_recommendation"]
>;

type StoredLearningOutcome =
  | "sound"
  | "largely_improved"
  | "teacher_assistance_recommended";

function storedLearningOutcome(
  proposedOutcome: AgentTransitionRecommendation["proposed_outcome"]
): StoredLearningOutcome | null {
  if (proposedOutcome === "sound_understanding") {
    return "sound";
  }
  if (proposedOutcome === "largely_improved_understanding") {
    return "largely_improved";
  }
  if (proposedOutcome === "teacher_assistance_recommended") {
    return "teacher_assistance_recommended";
  }
  return null;
}

export function formativeConversationContextOutcome(
  outcome: StoredLearningOutcome
): FormativeConversationProfileEvidence["outcome"] {
  if (outcome === "sound") {
    return "sound_understanding";
  }
  if (outcome === "largely_improved") {
    return "largely_improved_understanding";
  }
  return "teacher_assistance_recommended";
}

export function parseFormativeConversationProfileSnapshot(
  value: unknown
): FormativeConversationProfileEvidence | null {
  const parsed = FormativeConversationProfileEvidenceSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function textArray(value: Prisma.JsonValue) {
  return Array.isArray(value)
    ? value.filter(
        (entry): entry is string =>
          typeof entry === "string" && entry.trim().length > 0
      )
    : [];
}

function jsonInput(value: unknown): Prisma.InputJsonValue {
  return (toPrismaJson(value) ?? []) as Prisma.InputJsonValue;
}

async function existingTransitionForAgentCall(
  sourceAgentCallDbId: string
) {
  return prisma.formativeConversationProfileTransition.findFirst({
    where: { source_agent_call_db_id: sourceAgentCallDbId },
    include: {
      updated_student_profile: true,
      supporting_turn_references: {
        include: {
          conversation_turn: {
            select: {
              sequence_index: true,
              actor_type: true
            }
          }
        },
        orderBy: {
          conversation_turn: {
            sequence_index: "asc"
          }
        }
      },
      profile_evidence_references: {
        orderBy: { evidence_observation_index: "asc" }
      }
    }
  });
}

export async function recordFormativeConversationProfileTransitionRecommendation(
  input: {
    conversation_public_id: string;
    source_agent_call_db_id: string;
    source_tutor_turn_db_id: string;
    agent_evidence_observations: FormativeConversationAgentOutput["evidence_observations"];
    recommendation: AgentTransitionRecommendation;
  }
) {
  const learningOutcome = storedLearningOutcome(
    input.recommendation.proposed_outcome
  );
  if (!input.recommendation.recommended || !learningOutcome) {
    return null;
  }

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

  try {
    return await prisma.$transaction(async (tx) => {
      const session =
        await tx.formativeConversationSession.findUniqueOrThrow({
          where: {
            conversation_public_id: input.conversation_public_id
          },
          include: {
            initial_student_profile: true,
            current_student_profile: true
          }
        });
      const priorProfile =
        session.current_student_profile ?? session.initial_student_profile;
      if (!priorProfile) {
        throw new FormativeConversationProfileTransitionError(
          "conversation_profile_unavailable",
          "The formative conversation does not have a current learning profile."
        );
      }

      const [agentCall, tutorTurn] = await Promise.all([
        tx.agentCall.findUniqueOrThrow({
          where: { id: input.source_agent_call_db_id },
          select: {
            id: true,
            formative_conversation_session_db_id: true,
            agent_name: true,
            call_status: true,
            output_validated: true
          }
        }),
        tx.conversationTurn.findUniqueOrThrow({
          where: { id: input.source_tutor_turn_db_id },
          select: {
            id: true,
            formative_conversation_session_db_id: true,
            actor_type: true,
            agent_name: true,
            sequence_index: true,
            created_at: true
          }
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
          "The profile transition agent call is not a validated call for this conversation."
        );
      }
      if (
        tutorTurn.formative_conversation_session_db_id !== session.id ||
        tutorTurn.actor_type !== "agent" ||
        tutorTurn.agent_name !== "formative_conversation_agent"
      ) {
        throw new FormativeConversationProfileTransitionError(
          "profile_transition_tutor_turn_mismatch",
          "The profile transition tutor turn is not a formative conversation turn."
        );
      }

      const citedSequenceIndexes = [
        ...new Set(input.recommendation.source_turn_sequence_indexes)
      ];
      const citedTurns = await tx.conversationTurn.findMany({
        where: {
          formative_conversation_session_db_id: session.id,
          sequence_index: { in: citedSequenceIndexes }
        },
        select: {
          id: true,
          sequence_index: true,
          actor_type: true
        }
      });
      if (citedTurns.length !== citedSequenceIndexes.length) {
        throw new FormativeConversationProfileTransitionError(
          "profile_transition_evidence_turn_mismatch",
          "A profile transition evidence reference points outside this conversation."
        );
      }
      if (!citedTurns.some((turn) => turn.actor_type === "student")) {
        throw new FormativeConversationProfileTransitionError(
          "profile_transition_student_evidence_missing",
          "A profile transition requires at least one supporting student turn."
        );
      }

      const priorTransition =
        await tx.formativeConversationProfileTransition.findFirst({
          where: {
            formative_conversation_session_db_id: session.id,
            updated_student_profile_db_id: priorProfile.id
          },
          orderBy: { transitioned_at: "desc" },
          select: { profile_snapshot: true }
        });
      const priorSnapshot =
        parseFormativeConversationProfileSnapshot(
          priorTransition?.profile_snapshot
        ) ?? {
          profile_version: priorProfile.id,
          outcome:
            priorProfile.integrated_diagnostic_profile ===
            "robust_understanding_ready_for_transfer"
              ? ("sound_understanding" as const)
              : ("not_yet_determined" as const),
          evidence_summary: [
            priorProfile.integrated_profile_rationale,
            priorProfile.reasoning_quality_summary
          ].filter(Boolean),
          unresolved_evidence: textArray(
            priorProfile.recommended_next_evidence
          ),
          evidence_limitations:
            priorProfile.evidence_sufficiency === "strong"
              ? []
              : [
                  `Evidence sufficiency is ${priorProfile.evidence_sufficiency}.`
                ]
        };
      const learningObservations = input.agent_evidence_observations.map(
        (observation) => ({
          evidence_type: observation.evidence_type,
          observation: observation.observation,
          source_turn_sequence_indexes:
            observation.source_turn_sequence_indexes
        })
      );
      const learningObservationText = learningObservations
        .map((observation) => observation.observation)
        .join(" ");

      const updatedProfile = await tx.studentProfile.create({
        data: {
          concept_unit_session_db_id: priorProfile.concept_unit_session_db_id,
          profile_type: "updated",
          ability_profile: priorProfile.ability_profile,
          ability_pattern_flags: jsonInput(priorProfile.ability_pattern_flags),
          engagement_profile: priorProfile.engagement_profile,
          engagement_pattern_flags: jsonInput(
            priorProfile.engagement_pattern_flags
          ),
          integrated_diagnostic_profile:
            priorProfile.integrated_diagnostic_profile,
          integrated_profile_confidence:
            priorProfile.integrated_profile_confidence,
          integrated_profile_rationale: input.recommendation.rationale,
          evidence_sufficiency: priorProfile.evidence_sufficiency,
          confidence_alignment: priorProfile.confidence_alignment,
          independence_interpretability:
            priorProfile.independence_interpretability,
          misconception_indicators: jsonInput(
            priorProfile.misconception_indicators
          ),
          item_level_evidence: jsonInput(priorProfile.item_level_evidence),
          reasoning_quality_summary:
            learningObservationText || priorProfile.reasoning_quality_summary,
          engagement_summary: priorProfile.engagement_summary,
          process_interpretation_cautions: jsonInput(
            priorProfile.process_interpretation_cautions
          ),
          profile_confidence: priorProfile.profile_confidence,
          rationale: input.recommendation.rationale,
          recommended_next_evidence: jsonInput(
            priorProfile.recommended_next_evidence
          ),
          based_on_agent_call_db_id: agentCall.id
        }
      });
      const profileSnapshot: FormativeConversationProfileEvidence = {
        profile_version: updatedProfile.id,
        outcome: formativeConversationContextOutcome(learningOutcome),
        evidence_summary:
          learningObservations.length > 0
            ? learningObservations.map(
                (observation) => observation.observation
              )
            : priorSnapshot.evidence_summary,
        unresolved_evidence: priorSnapshot.unresolved_evidence,
        evidence_limitations: priorSnapshot.evidence_limitations
      };
      const transition =
        await tx.formativeConversationProfileTransition.create({
          data: {
            formative_conversation_session_db_id: session.id,
            prior_student_profile_db_id: priorProfile.id,
            updated_student_profile_db_id: updatedProfile.id,
            assessment_student_profile_db_id:
              session.initial_student_profile_db_id,
            source_turn_db_id: tutorTurn.id,
            source_agent_call_db_id: agentCall.id,
            transition_version:
              FORMATIVE_CONVERSATION_PROFILE_TRANSITION_VERSION,
            learning_outcome: learningOutcome,
            learning_observations: jsonInput(learningObservations),
            evidence_interpretation: input.recommendation.rationale,
            profile_snapshot: jsonInput(profileSnapshot),
            transitioned_at: tutorTurn.created_at
          }
        });

      const supportingTurns = [
        ...citedTurns.map((turn) => ({
          profile_transition_db_id: transition.id,
          conversation_turn_db_id: turn.id,
          evidence_role:
            turn.actor_type === "student"
              ? "student_evidence"
              : "conversation_evidence"
        })),
        ...(citedTurns.some((turn) => turn.id === tutorTurn.id)
          ? []
          : [
              {
                profile_transition_db_id: transition.id,
                conversation_turn_db_id: tutorTurn.id,
                evidence_role: "tutor_interpretation"
              }
            ])
      ];
      await tx.formativeConversationProfileTransitionTurnReference.createMany({
        data: supportingTurns,
        skipDuplicates: true
      });
      await tx.formativeConversationProfileEvidenceReference.updateMany({
        where: {
          formative_conversation_session_db_id: session.id,
          source_agent_call_db_id: agentCall.id
        },
        data: { profile_transition_db_id: transition.id }
      });

      const sessionUpdate =
        await tx.formativeConversationSession.updateMany({
          where: {
            id: session.id,
            current_student_profile_db_id: priorProfile.id
          },
          data: {
            current_student_profile_db_id: updatedProfile.id,
            last_activity_at: tutorTurn.created_at,
            concurrency_version: { increment: 1 }
          }
        });
      if (sessionUpdate.count !== 1) {
        throw new FormativeConversationProfileTransitionError(
          "profile_transition_stale",
          "The formative conversation profile changed before this transition was recorded."
        );
      }

      await tx.formativeConversationReviewSignal.create({
        data: {
          formative_conversation_session_db_id: session.id,
          source_student_profile_db_id: priorProfile.id,
          source_turn_db_id: tutorTurn.id,
          signal_type: "profile_transition_recommendation",
          reason_code: learningOutcome,
          evidence_summary: jsonInput({
            transition_public_id: transition.transition_public_id,
            evidence_interpretation: input.recommendation.rationale,
            source_turn_sequence_indexes: citedSequenceIndexes
          })
        }
      });

      return {
        transition: await tx.formativeConversationProfileTransition.findUniqueOrThrow(
          {
            where: { id: transition.id },
            include: {
              updated_student_profile: true,
              supporting_turn_references: {
                include: {
                  conversation_turn: {
                    select: {
                      sequence_index: true,
                      actor_type: true
                    }
                  }
                },
                orderBy: {
                  conversation_turn: {
                    sequence_index: "asc"
                  }
                }
              },
              profile_evidence_references: {
                orderBy: { evidence_observation_index: "asc" }
              }
            }
          }
        ),
        updated_profile: updatedProfile,
        replayed: false
      };
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
    throw error;
  }
}
