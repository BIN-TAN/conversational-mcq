import { createHash } from "node:crypto";
import { Prisma, type StudentProfile } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  canonicalMisconceptionClaimTexts,
  parseCanonicalMisconceptionClaimCatalog,
  requireCanonicalMisconceptionClaimCatalog,
  type CanonicalMisconceptionClaimCatalog
} from "@/lib/domain/misconception-claim-identity";
import { toPrismaJson } from "@/lib/services/json";
import {
  FORMATIVE_CONVERSATION_CANONICAL_PROFILE_FIELDS,
  FORMATIVE_CONVERSATION_CANONICAL_PROFILE_VERSION,
  FormativeConversationProfileEvidenceSchema,
  type FormativeConversationAgentOutput,
  type FormativeConversationCanonicalProfile,
  type FormativeConversationProfileEvidence
} from "./agent-contract";
import {
  FORMATIVE_CONVERSATION_PROFILE_TRANSITION_VALIDATOR_VERSION,
  validateFormativeConversationProfileTransition,
  type FormativeConversationProfileTransitionValidationIssueCode
} from "./profile-transition-validator";
import {
  FORMATIVE_CONVERSATION_WRITE_TRANSACTION_OPTIONS,
  formativeConversationPersistenceError
} from "./persistence-errors";
import {
  executeFormativeConversationIdempotentWrite,
  measureFormativeConversationPersistencePhase
} from "./persistence-observability";

export const FORMATIVE_CONVERSATION_PROFILE_TRANSITION_VERSION:
  | "formative-conversation-profile-transition-v3"
  | "formative-conversation-profile-transition-v4"
  | "formative-conversation-profile-transition-v5" =
  "formative-conversation-profile-transition-v5";

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
      | "profile_transition_stale"
      | FormativeConversationProfileTransitionValidationIssueCode,
    message: string
  ) {
    super(message);
    this.name = "FormativeConversationProfileTransitionError";
  }
}

export async function recordFormativeConversationProfileTransitionRejection(
  input: {
    conversation_public_id: string;
    source_agent_call_db_id: string;
    source_tutor_turn_db_id: string;
    proposed_outcome: string;
    error: FormativeConversationProfileTransitionError;
  }
) {
  const [session, agentCall] = await Promise.all([
    prisma.formativeConversationSession.findUniqueOrThrow({
      where: {
        conversation_public_id: input.conversation_public_id
      },
      select: {
        id: true,
        initial_student_profile_db_id: true,
        current_student_profile_db_id: true
      }
    }),
    prisma.agentCall.findUniqueOrThrow({
      where: { id: input.source_agent_call_db_id },
      select: { agent_call_public_id: true }
    })
  ]);
  const signalPublicId = `fcptr_${createHash("sha256")
    .update(
      [
        input.conversation_public_id,
        input.source_agent_call_db_id,
        input.error.code
      ].join(":")
    )
    .digest("hex")
    .slice(0, 24)}`;

  return prisma.formativeConversationReviewSignal.upsert({
    where: { signal_public_id: signalPublicId },
    update: {},
    create: {
      signal_public_id: signalPublicId,
      formative_conversation_session_db_id: session.id,
      source_student_profile_db_id:
        session.current_student_profile_db_id ??
        session.initial_student_profile_db_id,
      source_turn_db_id: input.source_tutor_turn_db_id,
      signal_type: "profile_transition_rejected",
      reason_code: input.error.code,
      evidence_summary: jsonInput({
        terminal_result: "rejected",
        transition_version:
          FORMATIVE_CONVERSATION_PROFILE_TRANSITION_VERSION,
        proposed_outcome: input.proposed_outcome,
        source_agent_call_public_id:
          agentCall.agent_call_public_id,
        validation_code: input.error.code
      })
    }
  });
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

export type FormativeConversationCanonicalProfileSource = Pick<
  StudentProfile,
  | "ability_profile"
  | "ability_pattern_flags"
  | "engagement_profile"
  | "engagement_pattern_flags"
  | "integrated_diagnostic_profile"
  | "integrated_profile_confidence"
  | "integrated_profile_rationale"
  | "evidence_sufficiency"
  | "confidence_alignment"
  | "independence_interpretability"
  | "misconception_indicators"
  | "item_level_evidence"
  | "reasoning_quality_summary"
  | "engagement_summary"
  | "process_interpretation_cautions"
  | "profile_confidence"
  | "rationale"
  | "recommended_next_evidence"
> & { id?: string };

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

function misconceptionProfileTextList(value: Prisma.JsonValue) {
  const catalog = parseCanonicalMisconceptionClaimCatalog(value);
  return catalog
    ? canonicalMisconceptionClaimTexts(catalog)
    : normalizedProfileTextList(value, 20);
}

export function canonicalFormativeConversationProfileFromStudentProfile(
  profile: FormativeConversationCanonicalProfileSource
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
    misconception_indicators: misconceptionProfileTextList(
      profile.misconception_indicators
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

export function canonicalFormativeConversationProfileStateFromStudentProfile(
  profile: FormativeConversationCanonicalProfileSource
): {
  canonical_profile: FormativeConversationCanonicalProfile;
  misconception_claim_catalog: CanonicalMisconceptionClaimCatalog;
} {
  const misconceptionClaimCatalog =
    requireCanonicalMisconceptionClaimCatalog({
      value: profile.misconception_indicators,
      legacy_profile_scope: profile.id ?? "profile-source-without-id"
    });
  return {
    canonical_profile: {
      ...canonicalFormativeConversationProfileFromStudentProfile(profile),
      misconception_indicators:
        canonicalMisconceptionClaimTexts(misconceptionClaimCatalog)
    },
    misconception_claim_catalog: misconceptionClaimCatalog
  };
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
  const logicalOperationId = `profile-transition:${createHash("sha256")
    .update(
      `${input.conversation_public_id}:${input.source_agent_call_db_id}`
    )
    .digest("hex")
    .slice(0, 24)}`;
  const learningOutcome = storedLearningOutcome(
    input.recommendation.proposed_outcome
  );
  if (!input.recommendation.recommended || !learningOutcome) {
    return null;
  }
  let updatedCanonicalProfile =
    input.recommendation.updated_profile;
  let updatedMisconceptionClaimCatalog:
    | CanonicalMisconceptionClaimCatalog
    | null = null;
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

  const citedSequenceIndexes = [
    ...new Set([
      ...input.recommendation.source_turn_sequence_indexes,
      ...input.recommendation.field_evidence.flatMap(
        (evidence) => evidence.source_turn_sequence_indexes
      ),
      ...(input.recommendation.misconception_claim_closure ?? []).flatMap(
        (closure) =>
          closure.atomic_claims.flatMap(
            (claim) => claim.source_turn_sequence_indexes
          )
      ),
      ...(input.recommendation.misconception_claim_dispositions ?? []).flatMap(
        (disposition) => disposition.source_turn_sequence_indexes
      ),
      ...input.agent_evidence_observations.flatMap(
        (observation) => observation.source_turn_sequence_indexes
      )
    ])
  ];

  let prepared: {
    session: Awaited<
      ReturnType<
        typeof prisma.formativeConversationSession.findUniqueOrThrow
      >
    > & {
      initial_student_profile: StudentProfile | null;
      current_student_profile: StudentProfile | null;
    };
    priorProfile: StudentProfile;
    agentCall: {
      id: string;
      formative_conversation_session_db_id: string | null;
      agent_name: string;
      call_status: string;
      output_validated: boolean;
    };
    tutorTurn: {
      id: string;
      formative_conversation_session_db_id: string | null;
      actor_type: string;
      agent_name: string | null;
      sequence_index: number;
      created_at: Date;
    };
    citedTurns: Array<{
      id: string;
      sequence_index: number;
      actor_type: string;
    }>;
  };
  try {
    const session =
      await measureFormativeConversationPersistencePhase({
        operation_name: "formative_conversation_profile_transition",
        logical_operation_id: logicalOperationId,
        operation_kind: "read",
        phase: "pre_transaction_read",
        execute: () =>
          prisma.formativeConversationSession.findUniqueOrThrow({
            where: {
              conversation_public_id: input.conversation_public_id
            },
            include: {
              initial_student_profile: true,
              current_student_profile: true
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

    const [agentCall, tutorTurn, citedTurns] =
      await measureFormativeConversationPersistencePhase({
        operation_name: "formative_conversation_profile_transition",
        logical_operation_id: logicalOperationId,
        operation_kind: "read",
        phase: "pre_transaction_read",
        execute: () =>
          Promise.all([
            prisma.agentCall.findUniqueOrThrow({
              where: { id: input.source_agent_call_db_id },
              select: {
                id: true,
                formative_conversation_session_db_id: true,
                agent_name: true,
                call_status: true,
                output_validated: true
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
              select: {
                id: true,
                sequence_index: true,
                actor_type: true
              }
            })
          ])
      });
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

    const priorProfileState =
      canonicalFormativeConversationProfileStateFromStudentProfile(
        priorProfile
      );
    const canonicalValidation =
      await measureFormativeConversationPersistencePhase({
        operation_name: "formative_conversation_profile_transition",
        logical_operation_id: logicalOperationId,
        operation_kind: "read",
        phase: "validation",
        execute: async () =>
          validateFormativeConversationProfileTransition({
            recommendation: input.recommendation,
            prior_profile: priorProfileState.canonical_profile,
            prior_misconception_claim_catalog:
              priorProfileState.misconception_claim_catalog,
            evidence_observations:
              input.agent_evidence_observations,
            available_turns: citedTurns.map((turn) => ({
              sequence_index: turn.sequence_index,
              actor:
                turn.actor_type === "student"
                  ? ("student" as const)
                  : ("tutor" as const)
            }))
          })
      });
    if (!canonicalValidation.valid) {
      const primaryIssue = canonicalValidation.issues[0];
      throw new FormativeConversationProfileTransitionError(
        primaryIssue?.code ?? "profile_transition_field_evidence_invalid",
        primaryIssue?.message ??
          "The profile transition failed canonical validation."
      );
    }
    if (
      !canonicalValidation.updated_profile ||
      !canonicalValidation.updated_misconception_claim_catalog
    ) {
      throw new FormativeConversationProfileTransitionError(
        "profile_transition_updated_profile_missing",
        "The canonical V17 transition did not produce a complete profile and misconception claim catalog."
      );
    }
    updatedCanonicalProfile = canonicalValidation.updated_profile;
    updatedMisconceptionClaimCatalog =
      canonicalValidation.updated_misconception_claim_catalog;
    prepared = {
      session,
      priorProfile,
      agentCall,
      tutorTurn,
      citedTurns
    };
  } catch (error) {
    if (error instanceof FormativeConversationProfileTransitionError) {
      throw error;
    }
    throw formativeConversationPersistenceError(
      error,
      "transition_persistence"
    );
  }

  const fieldEvidenceByField = new Map(
    input.recommendation.field_evidence.flatMap((evidence) =>
      evidence.profile_fields.map((field) => [field, evidence] as const)
    )
  );
  const usePriorStoredField = (
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
  if (!updatedMisconceptionClaimCatalog) {
    throw new FormativeConversationProfileTransitionError(
      "profile_transition_updated_profile_missing",
      "The canonical V17 misconception claim catalog is unavailable before persistence."
    );
  }

  const persistTransition = async () => {
    const updatedProfile =
      await measureFormativeConversationPersistencePhase({
        operation_name: "formative_conversation_profile_transition",
        logical_operation_id: logicalOperationId,
        operation_kind: "write",
        phase: "transaction",
        transaction_timeout_ms:
          FORMATIVE_CONVERSATION_WRITE_TRANSACTION_OPTIONS.timeout,
        mutation_may_have_occurred: true,
        execute: () => prisma.$transaction(async (tx) => {
      const claimed = await tx.formativeConversationSession.updateMany({
        where: {
          id: prepared.session.id,
          current_student_profile_db_id:
            prepared.session.current_student_profile_db_id,
          concurrency_version: prepared.session.concurrency_version
        },
        data: { concurrency_version: { increment: 1 } }
      });
      if (claimed.count !== 1) {
        throw new FormativeConversationProfileTransitionError(
          "profile_transition_stale",
          "The formative conversation profile changed before this transition was recorded."
        );
      }

      const createdProfile = await tx.studentProfile.create({
        data: {
          concept_unit_session_db_id:
            prepared.priorProfile.concept_unit_session_db_id,
          profile_type: "updated",
          ability_profile: updatedCanonicalProfile.ability_profile,
          ability_pattern_flags: jsonInput(
            usePriorStoredField("ability_pattern_flags")
              ? prepared.priorProfile.ability_pattern_flags
              : updatedCanonicalProfile.ability_pattern_flags
          ),
          engagement_profile: updatedCanonicalProfile.engagement_profile,
          engagement_pattern_flags: jsonInput(
            usePriorStoredField("engagement_pattern_flags")
              ? prepared.priorProfile.engagement_pattern_flags
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
            updatedMisconceptionClaimCatalog
          ),
          item_level_evidence: jsonInput(
            usePriorStoredField("item_level_evidence")
              ? prepared.priorProfile.item_level_evidence
              : updatedCanonicalProfile.item_level_evidence
          ),
          reasoning_quality_summary:
            updatedCanonicalProfile.reasoning_quality_summary,
          engagement_summary:
            updatedCanonicalProfile.engagement_summary,
          process_interpretation_cautions: jsonInput(
            usePriorStoredField("process_interpretation_cautions")
              ? prepared.priorProfile.process_interpretation_cautions
              : updatedCanonicalProfile.process_interpretation_cautions
          ),
          profile_confidence: updatedCanonicalProfile.profile_confidence,
          rationale: updatedCanonicalProfile.rationale,
          recommended_next_evidence: jsonInput(
            usePriorStoredField("recommended_next_evidence")
              ? prepared.priorProfile.recommended_next_evidence
              : updatedCanonicalProfile.recommended_next_evidence
          ),
          based_on_agent_call_db_id: prepared.agentCall.id
        }
      });
      const profileSnapshot: FormativeConversationProfileEvidence = {
        profile_version: createdProfile.id,
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
        field_evidence: input.recommendation.field_evidence,
        misconception_claim_closure:
          input.recommendation.misconception_claim_closure ?? [],
        misconception_claim_catalog:
          updatedMisconceptionClaimCatalog,
        misconception_claim_dispositions:
          input.recommendation.misconception_claim_dispositions ?? []
      };
      const transition =
        await tx.formativeConversationProfileTransition.create({
          data: {
            formative_conversation_session_db_id: prepared.session.id,
            prior_student_profile_db_id: prepared.priorProfile.id,
            updated_student_profile_db_id: createdProfile.id,
            assessment_student_profile_db_id:
              prepared.session.initial_student_profile_db_id,
            source_turn_db_id: prepared.tutorTurn.id,
            source_agent_call_db_id: prepared.agentCall.id,
            transition_version:
              FORMATIVE_CONVERSATION_PROFILE_TRANSITION_VERSION,
            learning_outcome: learningOutcome,
            learning_observations: jsonInput(learningObservations),
            evidence_interpretation: input.recommendation.rationale,
            profile_snapshot: jsonInput(profileSnapshot),
            transitioned_at: prepared.tutorTurn.created_at
          }
        });

      const supportingTurns = [
        ...prepared.citedTurns.map((turn) => ({
          profile_transition_db_id: transition.id,
          conversation_turn_db_id: turn.id,
          evidence_role:
            turn.actor_type === "student"
              ? "student_evidence"
              : "conversation_evidence"
        })),
        ...(prepared.citedTurns.some(
          (turn) => turn.id === prepared.tutorTurn.id
        )
          ? []
          : [
              {
                profile_transition_db_id: transition.id,
                conversation_turn_db_id: prepared.tutorTurn.id,
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
            formative_conversation_session_db_id: prepared.session.id,
            source_agent_call_db_id: prepared.agentCall.id
          },
          data: { profile_transition_db_id: transition.id }
        });
      if (linkedEvidence.count === 0) {
        throw new FormativeConversationProfileTransitionError(
          "profile_transition_evidence_missing",
          "The profile transition has no persisted evidence references."
        );
      }

      await tx.formativeConversationSession.update({
        where: { id: prepared.session.id },
        data: {
          current_student_profile_db_id: createdProfile.id,
          last_activity_at: prepared.tutorTurn.created_at
        }
      });
      await tx.conceptUnitSession.update({
        where: { id: prepared.session.concept_unit_session_db_id },
        data: {
          latest_student_profile_db_id: createdProfile.id
        }
      });

      await tx.formativeConversationReviewSignal.create({
        data: {
          formative_conversation_session_db_id: prepared.session.id,
          source_student_profile_db_id: prepared.priorProfile.id,
          source_turn_db_id: prepared.tutorTurn.id,
          signal_type: "profile_transition_recommendation",
          reason_code: learningOutcome,
          evidence_summary: jsonInput({
            transition_public_id: transition.transition_public_id,
            canonical_validator_version:
              FORMATIVE_CONVERSATION_PROFILE_TRANSITION_VALIDATOR_VERSION,
            recommendation_version:
              input.recommendation.recommendation_version,
            evidence_interpretation: input.recommendation.rationale,
            source_turn_sequence_indexes: citedSequenceIndexes,
            field_evidence: input.recommendation.field_evidence,
            misconception_claim_closure:
              input.recommendation.misconception_claim_closure ?? [],
            misconception_claim_catalog:
              updatedMisconceptionClaimCatalog,
            misconception_claim_dispositions:
              input.recommendation.misconception_claim_dispositions ?? []
          })
        }
      });

          return createdProfile;
        }, FORMATIVE_CONVERSATION_WRITE_TRANSACTION_OPTIONS)
      });

    const persisted =
      await measureFormativeConversationPersistencePhase({
        operation_name: "formative_conversation_profile_transition",
        logical_operation_id: logicalOperationId,
        operation_kind: "reconciliation",
        phase: "post_transaction_reconciliation",
        mutation_may_have_occurred: true,
        reconciliation_ran: true,
        execute: () =>
          existingTransitionForAgentCall(
            input.source_agent_call_db_id
          )
      });
    if (!persisted) {
      throw new Error("profile_transition_finalization_missing");
    }
    return {
      transition: persisted,
      updated_profile: updatedProfile,
      replayed: false
    };
  };

  const reconcileTransition = async () => {
    try {
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
    } catch (error) {
      throw formativeConversationPersistenceError(
        error,
        "transition_reconciliation",
        {
          logical_operation_id: logicalOperationId,
          mutation_may_have_occurred: true,
          reconciliation_ran: true,
          retry_permitted: false
        }
      );
    }
  };

  try {
    return await executeFormativeConversationIdempotentWrite({
      operation_name: "formative_conversation_profile_transition",
      logical_operation_id: logicalOperationId,
      execute: persistTransition,
      reconcile: reconcileTransition
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
