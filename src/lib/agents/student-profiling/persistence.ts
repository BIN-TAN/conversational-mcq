import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { AgentOutputByName } from "@/lib/agents/contracts";
import { createCanonicalMisconceptionClaimCatalog } from "@/lib/domain/misconception-claim-identity";
import { toPrismaJson } from "@/lib/services/json";
import {
  bindCanonicalProfileToEmptyFormativeConversationInTransaction,
  createOrGetTrustedFormativeConversationSessionInTransaction
} from "@/lib/services/student-assessment/formative-conversation/service";
import {
  FORMATIVE_CONVERSATION_WRITE_TRANSACTION_OPTIONS,
  formativeConversationPersistenceError
} from "@/lib/services/student-assessment/formative-conversation/persistence-errors";

type StudentProfileOutput = AgentOutputByName["student_profiling_agent"];

function json(value: unknown): Prisma.InputJsonValue {
  return (toPrismaJson(value) ?? []) as Prisma.InputJsonValue;
}

export function studentProfileCreateData(input: {
  concept_unit_session_db_id: string;
  based_on_agent_call_db_id: string | null;
  output: StudentProfileOutput;
}) {
  const misconceptionClaimCatalog =
    createCanonicalMisconceptionClaimCatalog({
      identity_scope: [
        input.concept_unit_session_db_id,
        input.based_on_agent_call_db_id ?? "deterministic-fallback",
        input.output.profile_type
      ].join(":"),
      indicators: input.output.misconception_indicators.map((indicator) => ({
        ...indicator,
        atomic_claims: indicator.atomic_claims ?? []
      }))
    });
  return {
    concept_unit_session_db_id: input.concept_unit_session_db_id,
    profile_type: input.output.profile_type,
    ability_profile: input.output.ability_profile,
    ability_pattern_flags: json(input.output.ability_pattern_flags),
    engagement_profile: input.output.engagement_profile,
    engagement_pattern_flags: json(input.output.engagement_pattern_flags),
    integrated_diagnostic_profile: input.output.integrated_diagnostic_profile,
    integrated_profile_confidence: input.output.integrated_profile_confidence,
    integrated_profile_rationale: input.output.integrated_profile_rationale,
    evidence_sufficiency: input.output.evidence_sufficiency,
    confidence_alignment: input.output.confidence_alignment,
    independence_interpretability: input.output.independence_interpretability,
    misconception_indicators: json(misconceptionClaimCatalog),
    item_level_evidence: json(input.output.item_level_evidence),
    reasoning_quality_summary: input.output.reasoning_quality_summary,
    engagement_summary: input.output.engagement_summary,
    process_interpretation_cautions: json(input.output.process_interpretation_cautions),
    profile_confidence: input.output.profile_confidence,
    rationale: input.output.rationale,
    recommended_next_evidence: json(input.output.recommended_next_evidence),
    based_on_agent_call_db_id: input.based_on_agent_call_db_id
  } satisfies Prisma.StudentProfileUncheckedCreateInput;
}

export async function persistInitialStudentProfile(input: {
  concept_unit_session_db_id: string;
  based_on_agent_call_db_id: string | null;
  output: StudentProfileOutput;
  repair_empty_formative_conversation?: boolean;
}) {
  const conceptUnitSession =
    await prisma.conceptUnitSession.findUniqueOrThrow({
      where: { id: input.concept_unit_session_db_id },
      select: { assessment_session_db_id: true }
    });
  try {
    return await prisma.$transaction(
      async (tx) => {
        const profile = await tx.studentProfile.create({
          data: studentProfileCreateData(input),
          include: {
            based_on_agent_call: {
              select: {
                agent_name: true,
                provider: true,
                model_name: true,
                agent_version: true,
                prompt_version: true,
                schema_version: true,
                prompt_hash: true,
                retry_count: true,
                call_status: true,
                output_validated: true,
                live_call_allowed: true,
                blocked_reason: true,
                created_at: true,
                completed_at: true
              }
            }
          }
        });

        await tx.conceptUnitSession.update({
          where: { id: input.concept_unit_session_db_id },
          data: {
            latest_student_profile_db_id: profile.id
          }
        });
        if (input.repair_empty_formative_conversation) {
          await bindCanonicalProfileToEmptyFormativeConversationInTransaction(
            tx,
            {
              assessment_session_db_id:
                conceptUnitSession.assessment_session_db_id,
              concept_unit_session_db_id:
                input.concept_unit_session_db_id,
              canonical_student_profile_db_id: profile.id
            }
          );
        } else {
          await createOrGetTrustedFormativeConversationSessionInTransaction(
            tx,
            {
              assessment_session_db_id:
                conceptUnitSession.assessment_session_db_id,
              concept_unit_session_db_id:
                input.concept_unit_session_db_id,
              initial_student_profile_db_id: profile.id,
              current_student_profile_db_id: profile.id
            }
          );
        }

        return profile;
      },
      FORMATIVE_CONVERSATION_WRITE_TRANSACTION_OPTIONS
    );
  } catch (error) {
    throw formativeConversationPersistenceError(
      error,
      "conversation_creation"
    );
  }
}

export async function bindExistingInitialStudentProfileForEmptyConversation(
  input: {
    concept_unit_session_db_id: string;
    student_profile_db_id: string;
  }
) {
  const conceptUnitSession =
    await prisma.conceptUnitSession.findUniqueOrThrow({
      where: { id: input.concept_unit_session_db_id },
      select: { assessment_session_db_id: true }
    });

  return prisma.$transaction(
    async (tx) => {
      await tx.conceptUnitSession.update({
        where: { id: input.concept_unit_session_db_id },
        data: { latest_student_profile_db_id: input.student_profile_db_id }
      });
      return bindCanonicalProfileToEmptyFormativeConversationInTransaction(
        tx,
        {
          assessment_session_db_id:
            conceptUnitSession.assessment_session_db_id,
          concept_unit_session_db_id: input.concept_unit_session_db_id,
          canonical_student_profile_db_id: input.student_profile_db_id
        }
      );
    },
    FORMATIVE_CONVERSATION_WRITE_TRANSACTION_OPTIONS
  );
}
