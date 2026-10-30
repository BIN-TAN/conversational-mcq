import { prisma } from "@/lib/db";
import { buildEvidenceIntegratedProfileBundle } from "@/lib/services/student-assessment/evidence-integrated-profile";
import {
  FORMATIVE_CONVERSATION_WRITE_TRANSACTION_OPTIONS,
  formativeConversationPersistenceError
} from "@/lib/services/student-assessment/formative-conversation/persistence-errors";
import { createOrGetTrustedFormativeConversationSessionInTransaction } from "@/lib/services/student-assessment/formative-conversation/service";
import { ensureFormativeConversationOpeningForConceptUnitSession } from "@/lib/services/student-assessment/formative-conversation/opening-orchestration";
import {
  resolveTopicDialogueExecutionPlan,
  type FormativeExecutionMode
} from "@/lib/services/student-assessment/formative-execution-mode";
import { updateAssessmentSessionPhase } from "@/lib/services/session-state";
import { attemptContextForSession } from "./attempts";
import { callInterpretationV8 } from "./call";
import { chosenOptionTagsFromPackage, loadInterpretationInputV8 } from "./input-builder";
import { buildStoredInterpretationV8, INTERPRETATION_V8_PROFILE_SCHEMA, studentProfileDataV8 } from "./profile";
import { isReinterpretationProfile } from "@/lib/services/interpretation-relabel/calls";

/**
 * Post-submission path of interpretation v8: one profiling call, then the conversation and
 * its opening. It replaces the profile-integration, planning and second profiling calls.
 * It creates exactly what later code needs (dependency map in
 * docs/AI_MODULE_REDESIGN_2026-10-19.md, Implementation): one StudentProfile with a
 * canonical (empty) misconception catalog, the concept-unit profile pointer, the
 * conversation with both profile pointers, the phase walk, and the opening.
 */
/** A transient provider failure left for the preparation job's next attempt (no profile saved). */
export class InterpretationDeferredError extends Error {
  constructor(public readonly reason: string) {
    super(`interpretation_v8_deferred:${reason}`);
    this.name = "InterpretationDeferredError";
  }
}

const PHASE_WALK = ["profiling_pending", "profiling_completed", "planning_pending", "planning_completed"] as const;

async function walkPhasesToPlanningCompleted(assessmentSessionDbId: string) {
  for (;;) {
    const session = await prisma.assessmentSession.findUniqueOrThrow({
      where: { id: assessmentSessionDbId },
      select: { current_phase: true }
    });
    const index = PHASE_WALK.indexOf(session.current_phase as (typeof PHASE_WALK)[number]);
    if (index < 0 || index === PHASE_WALK.length - 1) return;
    const result = await updateAssessmentSessionPhase({
      assessment_session_db_id: assessmentSessionDbId,
      to_phase: PHASE_WALK[index + 1],
      reason: "student_interpretation_v8"
    });
    if (!result.changed) return;
  }
}

export async function prepareInitialInterpretationV8(input: {
  concept_unit_session_db_id: string;
  response_package_id: string;
  execution_mode?: FormativeExecutionMode;
  assert_preparation_active?: () => Promise<void>;
  /**
   * "fallback_only": no model call and no opening. Used after preparation has failed for
   * good, so the student still gets the answer review and the conversation panel (with
   * End and Finish) instead of a dead end. The profile makes no diagnostic claims.
   */
  mode?: "full" | "fallback_only";
  fallback_reason?: string;
  /**
   * Set by the preparation job while it has attempts left: a transient provider failure
   * (rate limit, timeout, network, server error) then defers to the job's next attempt
   * instead of saving the fallback profile. The last attempt always saves a profile, so
   * the student is never held.
   */
  defer_transient_failures?: boolean | (() => boolean);
}) {
  const fallbackOnly = input.mode === "fallback_only";
  await input.assert_preparation_active?.();
  const conceptUnitSession = await prisma.conceptUnitSession.findUniqueOrThrow({
    where: { id: input.concept_unit_session_db_id },
    select: { id: true, assessment_session_db_id: true }
  });
  const executionMode = input.execution_mode ?? "production";

  const existingConversation = await prisma.formativeConversationSession.findUnique({
    where: { concept_unit_session_db_id: conceptUnitSession.id },
    select: { initial_student_profile_db_id: true }
  });
  const existingProfiles = await prisma.studentProfile.findMany({
    where: { concept_unit_session_db_id: conceptUnitSession.id, profile_type: "initial" },
    orderBy: [{ created_at: "desc" }],
    select: { id: true, item_level_evidence: true }
  });
  const existingV8 = existingProfiles.find((profile) => {
    const evidence = profile.item_level_evidence as Record<string, unknown> | null;
    return evidence?.profile_schema === INTERPRETATION_V8_PROFILE_SCHEMA && evidence?.response_package_id === input.response_package_id &&
      !isReinterpretationProfile(evidence);
  });

  let profileId = existingConversation?.initial_student_profile_db_id ?? existingV8?.id ?? null;
  if (!profileId) {
    const loaded = await loadInterpretationInputV8({
      concept_unit_session_db_id: conceptUnitSession.id,
      response_package_id: input.response_package_id
    });
    await input.assert_preparation_active?.();
    const result = fallbackOnly
      ? { status: "failed" as const, reason: input.fallback_reason ?? "preparation_failed", agent_call_id: null }
      : await callInterpretationV8({
          assessment_session_db_id: conceptUnitSession.assessment_session_db_id,
          concept_unit_session_db_id: conceptUnitSession.id,
          response_package_id: input.response_package_id,
          model_input: loaded.input,
          provider_generation_allowed: resolveTopicDialogueExecutionPlan(executionMode).provider_generation_allowed,
          prefer_deferral_on_transient_failure: input.defer_transient_failures
        });
    if (result.status === "failed" && "deferrable" in result && result.deferrable) {
      throw new InterpretationDeferredError(result.reason);
    }
    // Whatever the outcome (validated, rejected twice, model unreachable or not approved), a
    // profile is saved and the student continues. A rejection never blocks the student: the
    // fallback profile carries the deterministic answer review but no ratings or claims, its
    // label is Unavailable, and the rejected outputs stay in the AgentCall records for review.
    const responsePackage = await prisma.responsePackage.findUniqueOrThrow({
      where: { id: input.response_package_id },
      select: { payload: true }
    });
    const answerReview = buildEvidenceIntegratedProfileBundle({ response_package_payload: responsePackage.payload }).profile;
    const attempt = await attemptContextForSession(conceptUnitSession.assessment_session_db_id);
    const stored = buildStoredInterpretationV8({
      attempt,
      model_input: loaded.input,
      output: result.status === "validated" ? result.output : null,
      generation_mode: result.status === "validated" ? result.generation_mode : "fallback",
      fallback_reason: result.status === "validated" ? null : result.reason,
      response_package_id: input.response_package_id,
      answer_review_v2: answerReview,
      chosen_option_tags: chosenOptionTagsFromPackage(responsePackage.payload),
      output_adjustments: result.status === "validated" ? { repairs: result.repairs ?? [], salvage: result.salvage ?? null } : null
    });
    await input.assert_preparation_active?.();
    try {
      profileId = await prisma.$transaction(async (tx) => {
        const profile = await tx.studentProfile.create({
          data: studentProfileDataV8({
            concept_unit_session_db_id: conceptUnitSession.id,
            based_on_agent_call_db_id: result.agent_call_id,
            stored
          }),
          select: { id: true }
        });
        await tx.conceptUnitSession.update({
          where: { id: conceptUnitSession.id },
          data: { latest_student_profile_db_id: profile.id }
        });
        await createOrGetTrustedFormativeConversationSessionInTransaction(tx, {
          assessment_session_db_id: conceptUnitSession.assessment_session_db_id,
          concept_unit_session_db_id: conceptUnitSession.id,
          initial_student_profile_db_id: profile.id,
          current_student_profile_db_id: profile.id
        });
        return profile.id;
      }, FORMATIVE_CONVERSATION_WRITE_TRANSACTION_OPTIONS);
    } catch (error) {
      throw formativeConversationPersistenceError(error, "conversation_creation");
    }
  } else if (!existingConversation) {
    const reusedProfileId = profileId;
    await prisma.$transaction(async (tx) => {
      await createOrGetTrustedFormativeConversationSessionInTransaction(tx, {
        assessment_session_db_id: conceptUnitSession.assessment_session_db_id,
        concept_unit_session_db_id: conceptUnitSession.id,
        initial_student_profile_db_id: reusedProfileId,
        current_student_profile_db_id: reusedProfileId
      });
    }, FORMATIVE_CONVERSATION_WRITE_TRANSACTION_OPTIONS);
  }

  await walkPhasesToPlanningCompleted(conceptUnitSession.assessment_session_db_id);
  if (fallbackOnly) return { profile_db_id: profileId, opening_status: "not_attempted" as const };
  const opening = await ensureFormativeConversationOpeningForConceptUnitSession({
    concept_unit_session_db_id: conceptUnitSession.id,
    execution_mode: executionMode,
    assert_preparation_active: input.assert_preparation_active
  });
  return { profile_db_id: profileId, opening_status: opening.status };
}
