import { Prisma, type StudentProfile } from "@prisma/client";
import { prisma } from "@/lib/db";
import { toPrismaJson } from "@/lib/services/json";
import {
  FORMATIVE_CONVERSATION_CANONICAL_PROFILE_FIELDS,
  FORMATIVE_CONVERSATION_CANONICAL_PROFILE_VERSION,
  FormativeConversationProfileEvidenceSchema,
  type FormativeConversationAgentOutput,
  type FormativeConversationCanonicalProfile,
  type FormativeConversationProfileEvidence
} from "./agent-contract";

export const FORMATIVE_CONVERSATION_PROFILE_TRANSITION_VERSION =
  "formative-conversation-profile-transition-v2";

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
      | "profile_transition_evidence_missing"
      | "profile_transition_updated_profile_missing"
      | "profile_transition_field_evidence_invalid"
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

function jsonInput(value: unknown): Prisma.InputJsonValue {
  return (toPrismaJson(value) ?? []) as Prisma.InputJsonValue;
}

function normalizedText(value: string, fallback: string) {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized || fallback;
}

function normalizedProfileTextList(
  value: Prisma.JsonValue,
  limit: number
) {
  const entries: string[] = [];
  const visit = (entry: Prisma.JsonValue, path: string[]) => {
    if (entries.length >= limit || entry === null) {
      return;
    }
    if (typeof entry === "string") {
      const normalized = entry.replace(/\s+/g, " ").trim();
      if (normalized) {
        entries.push(
          path.length > 0
            ? `${path.at(-1)?.replaceAll("_", " ")}: ${normalized}`
            : normalized
        );
      }
      return;
    }
    if (typeof entry === "number" || typeof entry === "boolean") {
      entries.push(
        path.length > 0
          ? `${path.at(-1)?.replaceAll("_", " ")}: ${String(entry)}`
          : String(entry)
      );
      return;
    }
    if (Array.isArray(entry)) {
      entry.forEach((child) => visit(child, path));
      return;
    }
    Object.entries(entry).forEach(([key, child]) => {
      if (child !== undefined) {
        visit(child, [...path, key]);
      }
    });
  };
  visit(value, []);
  return [...new Set(entries)].slice(0, limit);
}

export function canonicalFormativeConversationProfileFromStudentProfile(
  profile: StudentProfile
): FormativeConversationCanonicalProfile {
  return {
    schema_version: FORMATIVE_CONVERSATION_CANONICAL_PROFILE_VERSION,
    ability_profile: profile.ability_profile,
    ability_pattern_flags: normalizedProfileTextList(
      profile.ability_pattern_flags,
      20
    ),
    engagement_profile: profile.engagement_profile,
    engagement_pattern_flags: normalizedProfileTextList(
      profile.engagement_pattern_flags,
      20
    ),
    integrated_diagnostic_profile:
      profile.integrated_diagnostic_profile,
    integrated_profile_confidence:
      profile.integrated_profile_confidence,
    integrated_profile_rationale: normalizedText(
      profile.integrated_profile_rationale,
      "No integrated profile rationale was recorded."
    ),
    evidence_sufficiency: profile.evidence_sufficiency,
    confidence_alignment: profile.confidence_alignment,
    independence_interpretability:
      profile.independence_interpretability,
    misconception_indicators: normalizedProfileTextList(
      profile.misconception_indicators,
      20
    ),
    item_level_evidence: normalizedProfileTextList(
      profile.item_level_evidence,
      50
    ),
    reasoning_quality_summary: normalizedText(
      profile.reasoning_quality_summary,
      "No reasoning-quality summary was recorded."
    ),
    engagement_summary: normalizedText(
      profile.engagement_summary,
      "No engagement summary was recorded."
    ),
    process_interpretation_cautions: normalizedProfileTextList(
      profile.process_interpretation_cautions,
      20
    ),
    profile_confidence: profile.profile_confidence,
    rationale: normalizedText(
      profile.rationale,
      "No profile rationale was recorded."
    ),
    recommended_next_evidence: normalizedProfileTextList(
      profile.recommended_next_evidence,
      20
    )
  };
}

function profileFieldValue(
  profile: FormativeConversationCanonicalProfile,
  field: (typeof FORMATIVE_CONVERSATION_CANONICAL_PROFILE_FIELDS)[number]
) {
  return profile[field];
}

function profileValuesEqual(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
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
  const updatedCanonicalProfile =
    input.recommendation.updated_profile;
  if (!updatedCanonicalProfile) {
    throw new FormativeConversationProfileTransitionError(
      "profile_transition_updated_profile_missing",
      "A terminal profile transition requires the agent's complete updated profile."
    );
  }
  if (input.agent_evidence_observations.length === 0) {
    throw new FormativeConversationProfileTransitionError(
      "profile_transition_evidence_missing",
      "A terminal profile transition requires persisted conversation evidence."
    );
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
        ...new Set([
          ...input.recommendation.source_turn_sequence_indexes,
          ...input.recommendation.field_evidence.flatMap(
            (evidence) => evidence.source_turn_sequence_indexes
          ),
          ...input.agent_evidence_observations.flatMap(
            (observation) => observation.source_turn_sequence_indexes
          )
        ])
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

      const citedTurnsBySequence = new Map(
        citedTurns.map((turn) => [turn.sequence_index, turn])
      );
      const priorCanonicalProfile =
        canonicalFormativeConversationProfileFromStudentProfile(
          priorProfile
        );
      const fieldEvidenceByField = new Map(
        input.recommendation.field_evidence.flatMap((evidence) =>
          evidence.profile_fields.map((field) => [field, evidence] as const)
        )
      );
      for (const field of FORMATIVE_CONVERSATION_CANONICAL_PROFILE_FIELDS) {
        const fieldEvidence = fieldEvidenceByField.get(field);
        if (!fieldEvidence) {
          throw new FormativeConversationProfileTransitionError(
            "profile_transition_field_evidence_invalid",
            `The agent recommendation does not provide evidence provenance for ${field}.`
          );
        }
        const changed = !profileValuesEqual(
          profileFieldValue(priorCanonicalProfile, field),
          profileFieldValue(updatedCanonicalProfile, field)
        );
        if (
          changed &&
          fieldEvidence.disposition !==
            "updated_from_conversation_evidence"
        ) {
          throw new FormativeConversationProfileTransitionError(
            "profile_transition_field_evidence_invalid",
            `The changed ${field} field is not supported as a conversation evidence update.`
          );
        }
        if (
          fieldEvidence.disposition ===
            "updated_from_conversation_evidence" &&
          !fieldEvidence.source_turn_sequence_indexes.some(
            (sequenceIndex) =>
              citedTurnsBySequence.get(sequenceIndex)?.actor_type ===
              "student"
          )
        ) {
          throw new FormativeConversationProfileTransitionError(
            "profile_transition_field_evidence_invalid",
            `The ${field} update does not cite a supporting student turn.`
          );
        }
      }
      const retainedProfileField = (
        field: (typeof FORMATIVE_CONVERSATION_CANONICAL_PROFILE_FIELDS)[number]
      ) =>
        fieldEvidenceByField.get(field)?.disposition ===
        "retained_evidence_remains_valid";
      const learningObservations = input.agent_evidence_observations.map(
        (observation) => ({
          evidence_type: observation.evidence_type,
          observation: observation.observation,
          source_turn_sequence_indexes:
            observation.source_turn_sequence_indexes
        })
      );
      const updatedProfile = await tx.studentProfile.create({
        data: {
          concept_unit_session_db_id: priorProfile.concept_unit_session_db_id,
          profile_type: "updated",
          ability_profile: updatedCanonicalProfile.ability_profile,
          ability_pattern_flags: jsonInput(
            retainedProfileField("ability_pattern_flags")
              ? priorProfile.ability_pattern_flags
              : updatedCanonicalProfile.ability_pattern_flags
          ),
          engagement_profile: updatedCanonicalProfile.engagement_profile,
          engagement_pattern_flags: jsonInput(
            retainedProfileField("engagement_pattern_flags")
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
          misconception_indicators: jsonInput(
            retainedProfileField("misconception_indicators")
              ? priorProfile.misconception_indicators
              : updatedCanonicalProfile.misconception_indicators
          ),
          item_level_evidence: jsonInput(
            retainedProfileField("item_level_evidence")
              ? priorProfile.item_level_evidence
              : updatedCanonicalProfile.item_level_evidence
          ),
          reasoning_quality_summary:
            updatedCanonicalProfile.reasoning_quality_summary,
          engagement_summary:
            updatedCanonicalProfile.engagement_summary,
          process_interpretation_cautions: jsonInput(
            retainedProfileField("process_interpretation_cautions")
              ? priorProfile.process_interpretation_cautions
              : updatedCanonicalProfile.process_interpretation_cautions
          ),
          profile_confidence: updatedCanonicalProfile.profile_confidence,
          rationale: updatedCanonicalProfile.rationale,
          recommended_next_evidence: jsonInput(
            retainedProfileField("recommended_next_evidence")
              ? priorProfile.recommended_next_evidence
              : updatedCanonicalProfile.recommended_next_evidence
          ),
          based_on_agent_call_db_id: agentCall.id
        }
      });
      const profileSnapshot: FormativeConversationProfileEvidence = {
        profile_version: updatedProfile.id,
        outcome: formativeConversationContextOutcome(learningOutcome),
        evidence_summary:
          learningObservations.map(
            (observation) => observation.observation
          ),
        unresolved_evidence:
          updatedCanonicalProfile.recommended_next_evidence,
        evidence_limitations:
          updatedCanonicalProfile.process_interpretation_cautions,
        canonical_profile: updatedCanonicalProfile,
        field_evidence: input.recommendation.field_evidence
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
          "The profile transition has no persisted evidence references."
        );
      }

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
      await tx.conceptUnitSession.update({
        where: { id: session.concept_unit_session_db_id },
        data: {
          latest_student_profile_db_id: updatedProfile.id
        }
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
            recommendation_version:
              input.recommendation.recommendation_version,
            evidence_interpretation: input.recommendation.rationale,
            source_turn_sequence_indexes: citedSequenceIndexes,
            field_evidence: input.recommendation.field_evidence
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
