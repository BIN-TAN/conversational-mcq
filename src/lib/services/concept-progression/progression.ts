import { createHash } from "node:crypto";
import { Prisma, type ConceptProgressionRecord } from "@prisma/client";
import { z } from "zod";
import {
  ConceptProgressionStudentChoiceSchema,
  type ConceptProgressionResolutionStatus,
  type ConceptProgressionStatus,
  type ConceptProgressionStudentChoice,
  type ConceptProgressionTriggerType,
  type FollowupUpdatePostCycleAction
} from "@/lib/domain/enums";
import { prisma } from "@/lib/db";
import { requestProgressionFinalUpdate } from "@/lib/agents/followup-updates/service";
import { generatePublicId } from "@/lib/services/ids";
import { toPrismaJson } from "@/lib/services/json";
import { logProcessEvent } from "@/lib/services/process-events";
import { updateAssessmentSessionPhase } from "@/lib/services/session-state";
import { StudentAssessmentServiceError } from "@/lib/services/student-assessment/errors";

const activeProgressionStatuses = [
  "offered",
  "final_update_pending",
  "evaluating_resolution",
  "awaiting_unresolved_confirmation",
  "progressing"
] as const satisfies ConceptProgressionStatus[];

const processingProgressionStatuses = [
  "final_update_pending",
  "evaluating_resolution",
  "progressing"
] as const satisfies ConceptProgressionStatus[];

const choiceInputSchema = z
  .object({
    choice: ConceptProgressionStudentChoiceSchema,
    client_action_id: z.string().trim().min(1).max(120).optional()
  })
  .strict();

const requestInputSchema = z
  .object({
    client_action_id: z.string().trim().min(1).max(120).optional()
  })
  .strict();

export class ConceptProgressionServiceError extends Error {
  code: string;
  status: number;
  details: Record<string, unknown>;

  constructor(
    code: string,
    message: string,
    status = 400,
    details: Record<string, unknown> = {}
  ) {
    super(message);
    this.name = "ConceptProgressionServiceError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function stableHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function json(value: unknown): Prisma.InputJsonValue {
  return (toPrismaJson(value) ?? Prisma.JsonNull) as Prisma.InputJsonValue;
}

function publicConflict(message: string, details: Record<string, unknown> = {}) {
  return new StudentAssessmentServiceError("conflict", message, 409, details);
}

async function withProgressionActionIdempotency<T extends Record<string, unknown>>(input: {
  assessment_session_db_id: string;
  client_action_id?: string;
  action_type: string;
  request_payload: unknown;
  run: () => Promise<T>;
}): Promise<T> {
  if (!input.client_action_id) {
    return input.run();
  }

  const requestHash = stableHash(input.request_payload);
  const where = {
    assessment_session_db_id_client_action_id: {
      assessment_session_db_id: input.assessment_session_db_id,
      client_action_id: input.client_action_id
    }
  };
  const existing = await prisma.studentActionIdempotencyKey.findUnique({ where });

  if (existing) {
    if (existing.action_type !== input.action_type || existing.request_hash !== requestHash) {
      throw new StudentAssessmentServiceError(
        "idempotency_conflict",
        "The same client_action_id was used with different request content.",
        409
      );
    }

    if (existing.response_payload && typeof existing.response_payload === "object") {
      return existing.response_payload as T;
    }

    throw new StudentAssessmentServiceError(
      "progression_request_in_progress",
      "A matching progression request is already in progress.",
      409
    );
  }

  const created = await prisma.studentActionIdempotencyKey.create({
    data: {
      assessment_session_db_id: input.assessment_session_db_id,
      client_action_id: input.client_action_id,
      action_type: input.action_type,
      request_hash: requestHash
    }
  });

  try {
    const response = await input.run();
    await prisma.studentActionIdempotencyKey.update({
      where: { id: created.id },
      data: { response_payload: json(response) }
    });

    return response;
  } catch (error) {
    await prisma.studentActionIdempotencyKey.delete({ where: { id: created.id } }).catch(() => null);
    throw error;
  }
}

async function publishedConceptSequence(assessmentDbId: string) {
  return prisma.conceptUnit.findMany({
    where: {
      assessment_db_id: assessmentDbId,
      status: "published"
    },
    orderBy: [{ order_index: "asc" }, { created_at: "asc" }],
    select: {
      id: true,
      concept_unit_public_id: true,
      title: true,
      order_index: true
    }
  });
}

async function currentContext(input: { student_user_db_id: string; session_public_id: string }) {
  const session = await prisma.assessmentSession.findFirst({
    where: {
      session_public_id: input.session_public_id,
      user_db_id: input.student_user_db_id
    },
    include: {
      current_concept_unit: {
        select: {
          id: true,
          concept_unit_public_id: true,
          title: true,
          order_index: true
        }
      }
    }
  });

  if (!session) {
    throw new StudentAssessmentServiceError(
      "session_not_owned",
      "Session was not found for this student.",
      403
    );
  }

  if (session.status === "completed" || session.current_phase === "session_completed") {
    throw new StudentAssessmentServiceError(
      "assessment_already_completed",
      "This assessment attempt is already completed.",
      409
    );
  }

  if (!session.current_concept_unit_db_id || !session.current_concept_unit) {
    throw publicConflict("No current concept unit is set for this session.");
  }

  const conceptUnitSession = await prisma.conceptUnitSession.findUnique({
    where: {
      assessment_session_db_id_concept_unit_db_id: {
        assessment_session_db_id: session.id,
        concept_unit_db_id: session.current_concept_unit_db_id
      }
    },
    include: {
      latest_student_profile: true,
      latest_formative_decision: true
    }
  });

  if (!conceptUnitSession) {
    throw new StudentAssessmentServiceError(
      "concept_unit_not_current",
      "Current concept-unit session was not found.",
      409
    );
  }

  const conceptUnits = await publishedConceptSequence(session.assessment_db_id);
  const currentIndex = conceptUnits.findIndex((unit) => unit.id === session.current_concept_unit_db_id);

  if (currentIndex < 0) {
    throw new StudentAssessmentServiceError(
      "current_concept_unit_unavailable",
      "The current concept unit is no longer available in the published sequence.",
      409
    );
  }

  return {
    session,
    concept_unit_session: conceptUnitSession,
    current_concept_unit: session.current_concept_unit,
    concept_units: conceptUnits,
    current_index: currentIndex,
    next_concept_unit: conceptUnits[currentIndex + 1] ?? null,
    is_final_concept: currentIndex === conceptUnits.length - 1
  };
}

async function activeProgressionRecord(conceptUnitSessionDbId: string) {
  return prisma.conceptProgressionRecord.findFirst({
    where: {
      source_concept_unit_session_db_id: conceptUnitSessionDbId,
      status: { in: [...activeProgressionStatuses] }
    },
    orderBy: [{ requested_at: "desc" }]
  });
}

function resolutionFromProfile(
  profile: {
    integrated_diagnostic_profile: string;
    evidence_sufficiency: string;
  } | null
): ConceptProgressionResolutionStatus {
  if (!profile) {
    return "unknown";
  }

  if (
    profile.integrated_diagnostic_profile === "robust_understanding_ready_for_transfer" &&
    ["adequate", "strong"].includes(profile.evidence_sufficiency)
  ) {
    return "resolved";
  }

  return "unresolved";
}

async function latestMoveOnSignal(
  conceptUnitSessionDbId: string
): Promise<"agent_move_on_offer" | "student_move_on_request" | null> {
  const turns = await prisma.conversationTurn.findMany({
    where: {
      concept_unit_session_db_id: conceptUnitSessionDbId,
      actor_type: "agent",
      phase: "followup_active"
    },
    orderBy: [{ created_at: "desc" }],
    take: 10,
    select: { structured_payload: true }
  });

  for (const turn of turns) {
    const payload = asRecord(turn.structured_payload);
    const reasons = Array.isArray(payload.evidence_trigger_reasons)
      ? payload.evidence_trigger_reasons
      : [];

    if (reasons.includes("move_on_request")) {
      return "student_move_on_request";
    }

    if (payload.should_offer_move_on === true) {
      return "agent_move_on_offer";
    }
  }

  return null;
}

async function progressionTriggerType(input: {
  concept_unit_session_db_id: string;
  latest_profile: { integrated_diagnostic_profile: string; evidence_sufficiency: string } | null;
}): Promise<ConceptProgressionTriggerType> {
  const signal = await latestMoveOnSignal(input.concept_unit_session_db_id);

  if (signal) {
    return signal;
  }

  if (resolutionFromProfile(input.latest_profile) === "resolved") {
    return "robust_profile";
  }

  return "student_explicit_button";
}

async function activeFollowupRound(conceptUnitSessionDbId: string) {
  return prisma.followupRound.findFirst({
    where: {
      concept_unit_session_db_id: conceptUnitSessionDbId,
      status: "active"
    },
    orderBy: [{ round_index: "desc" }]
  });
}

async function hasUnprocessedSubstantiveEvidence(conceptUnitSessionDbId: string) {
  const round = await activeFollowupRound(conceptUnitSessionDbId);

  if (!round) {
    return false;
  }

  const turns = await prisma.conversationTurn.findMany({
    where: {
      followup_round_db_id: round.id,
      actor_type: "agent"
    },
    select: { structured_payload: true }
  });

  return turns.some((turn) => asRecord(turn.structured_payload).student_turn_substantive === true);
}

function progressionTypeFor(isFinalConcept: boolean) {
  return isFinalConcept ? "complete_assessment" : "next_concept";
}

function postCycleActionFor(isFinalConcept: boolean): FollowupUpdatePostCycleAction {
  return isFinalConcept ? "complete_assessment" : "advance_to_next_concept";
}

function allowedChoicesFor(input: {
  progression: ConceptProgressionRecord | null;
  is_final_concept: boolean;
  followup_active: boolean;
}) {
  if (!input.progression) {
    return input.followup_active ? ["request_progression", "save_exit"] : [];
  }

  if (processingProgressionStatuses.includes(input.progression.status as never)) {
    return ["save_exit"];
  }

  if (input.progression.status === "completed" || input.progression.status === "failed") {
    return ["save_exit"];
  }

  return input.is_final_concept
    ? ["stay_in_final_concept", "complete_assessment", "save_exit"]
    : ["continue_current_concept", "next_concept", "save_exit"];
}

function neutralMessageFor(input: {
  progression: ConceptProgressionRecord | null;
  is_final_concept: boolean;
}) {
  if (!input.progression) {
    return null;
  }

  if (processingProgressionStatuses.includes(input.progression.status as never)) {
    return "Reviewing your latest response before continuing.";
  }

  if (input.progression.status === "awaiting_unresolved_confirmation") {
    return input.is_final_concept
      ? "You can keep working on this concept or complete the assessment now. Some recent evidence may still be incomplete."
      : "You can keep working on this concept or move to the next concept now. Some recent evidence may still be incomplete.";
  }

  if (input.progression.status === "offered") {
    return input.is_final_concept
      ? "You can keep working on this concept or complete the assessment."
      : "You can keep working on this concept or move to the next concept.";
  }

  return null;
}

export function serializeProgressionForStudent(input: {
  progression: ConceptProgressionRecord | null;
  is_final_concept: boolean;
  followup_active: boolean;
}) {
  const allowedChoices = allowedChoicesFor(input);

  if (!input.progression && !input.followup_active) {
    return {
      available: false,
      status: null,
      progression_public_id: null,
      is_final_concept: input.is_final_concept,
      allowed_choices: [],
      neutral_message: null,
      processing: false
    };
  }

  return {
    available: Boolean(input.progression) || input.followup_active,
    status: input.progression?.status ?? null,
    progression_public_id: input.progression?.progression_public_id ?? null,
    is_final_concept: input.is_final_concept,
    allowed_choices: allowedChoices,
    neutral_message: neutralMessageFor(input),
    processing: input.progression
      ? processingProgressionStatuses.includes(input.progression.status as never)
      : false
  };
}

export async function getStudentProgressionState(input: {
  student_user_db_id: string;
  session_public_id: string;
}) {
  const context = await currentContext(input);
  const progression = await activeProgressionRecord(context.concept_unit_session.id);

  return {
    progression: serializeProgressionForStudent({
      progression,
      is_final_concept: context.is_final_concept,
      followup_active: context.session.current_phase === "followup_active"
    })
  };
}

export async function getStudentProgressionStateBySessionDbId(input: {
  assessment_session_db_id: string;
  concept_unit_session_db_id: string | null;
  current_phase: string;
  assessment_db_id: string;
  current_concept_unit_db_id: string | null;
}) {
  if (!input.concept_unit_session_db_id || !input.current_concept_unit_db_id) {
    return null;
  }

  const conceptUnits = await publishedConceptSequence(input.assessment_db_id);
  const currentIndex = conceptUnits.findIndex((unit) => unit.id === input.current_concept_unit_db_id);
  const progression = await activeProgressionRecord(input.concept_unit_session_db_id);

  return serializeProgressionForStudent({
    progression,
    is_final_concept: currentIndex >= 0 && currentIndex === conceptUnits.length - 1,
    followup_active: input.current_phase === "followup_active"
  });
}

async function createProgressionRequest(input: {
  context: Awaited<ReturnType<typeof currentContext>>;
}) {
  const existing = await activeProgressionRecord(input.context.concept_unit_session.id);

  if (existing) {
    return existing;
  }

  if (input.context.session.current_phase !== "followup_active") {
    throw new StudentAssessmentServiceError(
      "invalid_phase_for_action",
      "Progression can be requested only during active follow-up.",
      409,
      { current_phase: input.context.session.current_phase }
    );
  }

  const round = await activeFollowupRound(input.context.concept_unit_session.id);

  if (!round) {
    throw new StudentAssessmentServiceError(
      "active_followup_round_required",
      "An active follow-up round is required before progression can be requested.",
      409
    );
  }

  const latestProfile = input.context.concept_unit_session.latest_student_profile;
  const resolutionStatus = resolutionFromProfile(latestProfile);
  const triggerType = await progressionTriggerType({
    concept_unit_session_db_id: input.context.concept_unit_session.id,
    latest_profile: latestProfile
  });
  const now = new Date();
  const status: ConceptProgressionStatus =
    resolutionStatus === "resolved" ? "offered" : "awaiting_unresolved_confirmation";

  const progression = await prisma.conceptProgressionRecord.create({
    data: {
      progression_public_id: generatePublicId("concept_progression"),
      assessment_session_db_id: input.context.session.id,
      source_concept_unit_session_db_id: input.context.concept_unit_session.id,
      destination_concept_unit_db_id: input.context.next_concept_unit?.id ?? null,
      source_student_profile_db_id: latestProfile?.id ?? null,
      source_formative_decision_db_id:
        input.context.concept_unit_session.latest_formative_decision?.id ?? null,
      progression_type: progressionTypeFor(input.context.is_final_concept),
      trigger_type: triggerType,
      status,
      resolution_status: resolutionStatus,
      idempotency_key: `concept_progression:${input.context.concept_unit_session.id}:${round.id}`,
      requested_at: now
    }
  });

  await logProcessEvent({
    assessment_session_db_id: input.context.session.id,
    concept_unit_session_db_id: input.context.concept_unit_session.id,
    event_type: "concept_progression_requested",
    event_category: "concept_progression",
    event_source: "frontend",
    payload: {
      progression_public_id: progression.progression_public_id,
      trigger_type: progression.trigger_type,
      progression_type: progression.progression_type
    },
    occurred_at: now
  });
  await logProcessEvent({
    assessment_session_db_id: input.context.session.id,
    concept_unit_session_db_id: input.context.concept_unit_session.id,
    event_type:
      status === "awaiting_unresolved_confirmation"
        ? "concept_progression_unresolved_confirmation_requested"
        : "concept_progression_offered",
    event_category: "concept_progression",
    event_source: "backend",
    payload: {
      progression_public_id: progression.progression_public_id,
      progression_type: progression.progression_type
    },
    occurred_at: now
  });

  return progression;
}

export async function requestStudentConceptProgression(input: {
  student_user_db_id: string;
  session_public_id: string;
  data?: unknown;
}) {
  const data = requestInputSchema.parse(input.data ?? {});
  const context = await currentContext(input);

  return withProgressionActionIdempotency({
    assessment_session_db_id: context.session.id,
    client_action_id: data.client_action_id,
    action_type: "progression_request",
    request_payload: data,
    run: async () => {
      const progression = await createProgressionRequest({ context });
      const response = {
        request_status: "progression_available",
        progression: serializeProgressionForStudent({
          progression,
          is_final_concept: context.is_final_concept,
          followup_active: context.session.current_phase === "followup_active"
        })
      };

      return response;
    }
  });
}

async function reopenCurrentRoundIfNeeded(input: {
  assessment_session_db_id: string;
  concept_unit_session_db_id: string;
}) {
  const latestRound = await prisma.followupRound.findFirst({
    where: { concept_unit_session_db_id: input.concept_unit_session_db_id },
    orderBy: [{ round_index: "desc" }]
  });

  if (!latestRound) {
    return;
  }

  await prisma.$transaction([
    prisma.followupRound.update({
      where: { id: latestRound.id },
      data: {
        status: "active",
        completed_at: null
      }
    }),
    prisma.conceptUnitSession.update({
      where: { id: input.concept_unit_session_db_id },
      data: {
        status: "followup_active",
        followup_status: "active",
        followup_completed_at: null
      }
    }),
    prisma.assessmentSession.update({
      where: { id: input.assessment_session_db_id },
      data: {
        current_phase: "followup_active",
        status: "active",
        last_activity_at: new Date()
      }
    })
  ]);
}

async function cancelProgression(input: {
  progression: ConceptProgressionRecord;
  choice: ConceptProgressionStudentChoice;
}) {
  if (processingProgressionStatuses.includes(input.progression.status as never)) {
    throw new StudentAssessmentServiceError(
      "progression_processing",
      "Progression is still processing.",
      409
    );
  }

  const updated = await prisma.conceptProgressionRecord.update({
    where: { id: input.progression.id },
    data: {
      status: "cancelled",
      student_choice: input.choice,
      confirmed_at: new Date()
    }
  });

  await reopenCurrentRoundIfNeeded({
    assessment_session_db_id: updated.assessment_session_db_id,
    concept_unit_session_db_id: updated.source_concept_unit_session_db_id
  });
  await logProcessEvent({
    assessment_session_db_id: updated.assessment_session_db_id,
    concept_unit_session_db_id: updated.source_concept_unit_session_db_id,
    event_type: "concept_progression_cancelled",
    event_category: "concept_progression",
    event_source: "frontend",
    payload: {
      progression_public_id: updated.progression_public_id,
      student_choice: input.choice
    },
    occurred_at: new Date()
  });
  await logProcessEvent({
    assessment_session_db_id: updated.assessment_session_db_id,
    concept_unit_session_db_id: updated.source_concept_unit_session_db_id,
    event_type: "assessment_completion_summary_shown",
    event_category: "assessment_completion",
    event_source: "backend",
    payload: {
      progression_public_id: updated.progression_public_id,
      reason: "assessment_completed"
    },
    occurred_at: new Date()
  });

  return updated;
}

async function activeProgressionByPublicId(input: {
  progression_public_id: string;
  assessment_session_db_id: string;
}) {
  const progression = await prisma.conceptProgressionRecord.findFirst({
    where: {
      progression_public_id: input.progression_public_id,
      assessment_session_db_id: input.assessment_session_db_id
    }
  });

  if (!progression) {
    throw new StudentAssessmentServiceError(
      "progression_not_found",
      "Progression request was not found for this session.",
      404
    );
  }

  return progression;
}

async function requestFinalUpdateForProgression(input: {
  progression: ConceptProgressionRecord;
  is_final_concept: boolean;
}) {
  const postCycleAction = postCycleActionFor(input.is_final_concept);
  const requested = await requestProgressionFinalUpdate({
    concept_unit_session_db_id: input.progression.source_concept_unit_session_db_id,
    progression_record_db_id: input.progression.id,
    progression_public_id: input.progression.progression_public_id,
    post_cycle_action: postCycleAction
  });
  const cycle = requested.cycle_public_id
    ? await prisma.followupUpdateCycle.findUnique({
        where: { cycle_public_id: requested.cycle_public_id },
        select: { id: true }
      })
    : null;

  await prisma.conceptProgressionRecord.update({
    where: { id: input.progression.id },
    data: {
      status: "final_update_pending",
      final_update_cycle_db_id: cycle?.id ?? input.progression.final_update_cycle_db_id
    }
  });
  await logProcessEvent({
    assessment_session_db_id: input.progression.assessment_session_db_id,
    concept_unit_session_db_id: input.progression.source_concept_unit_session_db_id,
    event_type: "concept_progression_final_update_started",
    event_category: "concept_progression",
    event_source: "backend",
    payload: {
      progression_public_id: input.progression.progression_public_id,
      cycle_public_id: requested.cycle_public_id ?? null,
      post_cycle_action: postCycleAction,
      result_status: requested.status
    },
    occurred_at: new Date()
  });
}

async function updateUnresolvedAwaiting(input: {
  progression: ConceptProgressionRecord;
  resolution_status: ConceptProgressionResolutionStatus;
}) {
  const updated = await prisma.conceptProgressionRecord.update({
    where: { id: input.progression.id },
    data: {
      status: "awaiting_unresolved_confirmation",
      resolution_status: input.resolution_status
    }
  });

  await logProcessEvent({
    assessment_session_db_id: updated.assessment_session_db_id,
    concept_unit_session_db_id: updated.source_concept_unit_session_db_id,
    event_type: "concept_progression_unresolved_confirmation_requested",
    event_category: "concept_progression",
    event_source: "backend",
    payload: {
      progression_public_id: updated.progression_public_id,
      progression_type: updated.progression_type
    },
    occurred_at: new Date()
  });

  return updated;
}

async function completeProgressionRecord(input: {
  progression: ConceptProgressionRecord;
  unresolved_confirmed: boolean;
}) {
  const now = new Date();

  return prisma.conceptProgressionRecord.update({
    where: { id: input.progression.id },
    data: {
      status: "completed",
      completed_at: now,
      confirmed_at: input.progression.confirmed_at ?? now,
      moved_on_with_unresolved_evidence:
        input.progression.progression_type === "next_concept" && input.unresolved_confirmed,
      completed_with_unresolved_evidence:
        input.progression.progression_type === "complete_assessment" && input.unresolved_confirmed
    }
  });
}

async function markSourceConceptComplete(input: {
  concept_unit_session_db_id: string;
  assessment_session_db_id: string;
}) {
  const now = new Date();
  const activeOrLatestRound = await prisma.followupRound.findFirst({
    where: { concept_unit_session_db_id: input.concept_unit_session_db_id },
    orderBy: [{ round_index: "desc" }]
  });

  await prisma.$transaction([
    ...(activeOrLatestRound
      ? [
          prisma.followupRound.update({
            where: { id: activeOrLatestRound.id },
            data: {
              status: "completed",
              completed_at: activeOrLatestRound.completed_at ?? now
            }
          })
        ]
      : []),
    prisma.conceptUnitSession.update({
      where: { id: input.concept_unit_session_db_id },
      data: {
        status: "completed",
        followup_status: "completed",
        followup_completed_at: now
      }
    }),
    prisma.assessmentSession.update({
      where: { id: input.assessment_session_db_id },
      data: { last_activity_at: now }
    })
  ]);
}

async function advanceToNextConcept(input: {
  progression: ConceptProgressionRecord;
  unresolved_confirmed: boolean;
}) {
  if (!input.progression.destination_concept_unit_db_id) {
    throw new StudentAssessmentServiceError(
      "next_concept_not_found",
      "No next concept unit is available.",
      409
    );
  }

  await prisma.conceptProgressionRecord.update({
    where: { id: input.progression.id },
    data: { status: "progressing" }
  });
  await markSourceConceptComplete({
    concept_unit_session_db_id: input.progression.source_concept_unit_session_db_id,
    assessment_session_db_id: input.progression.assessment_session_db_id
  });
  await updateAssessmentSessionPhase({
    assessment_session_db_id: input.progression.assessment_session_db_id,
    to_phase: "followup_stopped",
    reason: "student_progression_choice"
  });
  await updateAssessmentSessionPhase({
    assessment_session_db_id: input.progression.assessment_session_db_id,
    to_phase: "between_concept_units",
    reason: "student_progression_choice"
  });
  await prisma.$transaction([
    prisma.conceptUnitSession.upsert({
      where: {
        assessment_session_db_id_concept_unit_db_id: {
          assessment_session_db_id: input.progression.assessment_session_db_id,
          concept_unit_db_id: input.progression.destination_concept_unit_db_id
        }
      },
      update: {},
      create: {
        assessment_session_db_id: input.progression.assessment_session_db_id,
        concept_unit_db_id: input.progression.destination_concept_unit_db_id,
        status: "not_started"
      }
    }),
    prisma.assessmentSession.update({
      where: { id: input.progression.assessment_session_db_id },
      data: {
        current_concept_unit_db_id: input.progression.destination_concept_unit_db_id,
        last_activity_at: new Date()
      }
    })
  ]);
  await updateAssessmentSessionPhase({
    assessment_session_db_id: input.progression.assessment_session_db_id,
    to_phase: "concept_unit_intro",
    reason: "next_concept_ready"
  });
  const updated = await completeProgressionRecord(input);

  await logProcessEvent({
    assessment_session_db_id: updated.assessment_session_db_id,
    concept_unit_session_db_id: updated.source_concept_unit_session_db_id,
    event_type: input.unresolved_confirmed
      ? "concept_progression_moved_on_with_unresolved_evidence"
      : "concept_progression_completed",
    event_category: "concept_progression",
    event_source: "backend",
    payload: {
      progression_public_id: updated.progression_public_id,
      progression_type: updated.progression_type
    },
    occurred_at: new Date()
  });

  return updated;
}

async function completeAssessment(input: {
  progression: ConceptProgressionRecord;
  unresolved_confirmed: boolean;
}) {
  await prisma.conceptProgressionRecord.update({
    where: { id: input.progression.id },
    data: { status: "progressing" }
  });
  await markSourceConceptComplete({
    concept_unit_session_db_id: input.progression.source_concept_unit_session_db_id,
    assessment_session_db_id: input.progression.assessment_session_db_id
  });
  await updateAssessmentSessionPhase({
    assessment_session_db_id: input.progression.assessment_session_db_id,
    to_phase: "followup_stopped",
    reason: "student_assessment_completion_choice"
  });
  await updateAssessmentSessionPhase({
    assessment_session_db_id: input.progression.assessment_session_db_id,
    to_phase: "between_concept_units",
    reason: "student_assessment_completion_choice"
  });
  await logProcessEvent({
    assessment_session_db_id: input.progression.assessment_session_db_id,
    concept_unit_session_db_id: input.progression.source_concept_unit_session_db_id,
    event_type: "assessment_completion_requested",
    event_category: "assessment_completion",
    event_source: "frontend",
    payload: {
      progression_public_id: input.progression.progression_public_id
    },
    occurred_at: new Date()
  });
  await updateAssessmentSessionPhase({
    assessment_session_db_id: input.progression.assessment_session_db_id,
    to_phase: "session_completed",
    reason: "student_completed_final_concept"
  });
  const updated = await completeProgressionRecord(input);

  await logProcessEvent({
    assessment_session_db_id: updated.assessment_session_db_id,
    concept_unit_session_db_id: updated.source_concept_unit_session_db_id,
    event_type: input.unresolved_confirmed
      ? "assessment_completed_with_unresolved_evidence"
      : "assessment_completed",
    event_category: "assessment_completion",
    event_source: "backend",
    payload: {
      progression_public_id: updated.progression_public_id
    },
    occurred_at: new Date()
  });

  return updated;
}

async function proceedAfterChoice(input: {
  progression: ConceptProgressionRecord;
  is_final_concept: boolean;
  unresolved_confirmed: boolean;
}) {
  return input.is_final_concept
    ? completeAssessment(input)
    : advanceToNextConcept(input);
}

export async function chooseStudentConceptProgression(input: {
  student_user_db_id: string;
  session_public_id: string;
  progression_public_id: string;
  data: unknown;
}) {
  const data = choiceInputSchema.parse(input.data);
  const context = await currentContext(input);

  return withProgressionActionIdempotency({
    assessment_session_db_id: context.session.id,
    client_action_id: data.client_action_id,
    action_type: "progression_choice",
    request_payload: {
      progression_public_id: input.progression_public_id,
      choice: data.choice
    },
    run: async () => {
      let progression = await activeProgressionByPublicId({
        progression_public_id: input.progression_public_id,
        assessment_session_db_id: context.session.id
      });

      if (progression.source_concept_unit_session_db_id !== context.concept_unit_session.id) {
        throw new StudentAssessmentServiceError(
          "concept_no_longer_current",
          "This concept is no longer current for editing or progression.",
          409
        );
      }

      if (
        data.choice === "continue_current_concept" ||
        data.choice === "stay_in_final_concept"
      ) {
        progression = await cancelProgression({ progression, choice: data.choice });

        return {
          choice_status: "progression_cancelled",
          progression: serializeProgressionForStudent({
            progression: null,
            is_final_concept: context.is_final_concept,
            followup_active: true
          })
        };
      }

      if (!context.is_final_concept && data.choice !== "next_concept") {
        throw new StudentAssessmentServiceError(
          "invalid_progression_choice",
          "Use next_concept for a non-final concept progression.",
          400
        );
      }

      if (context.is_final_concept && data.choice !== "complete_assessment") {
        throw new StudentAssessmentServiceError(
          "invalid_progression_choice",
          "Use complete_assessment for the final concept.",
          400
        );
      }

      if (processingProgressionStatuses.includes(progression.status as never)) {
        return {
          choice_status: "progression_processing",
          progression: serializeProgressionForStudent({
            progression,
            is_final_concept: context.is_final_concept,
            followup_active: false
          })
        };
      }

      if (!progression.student_choice) {
        progression = await prisma.conceptProgressionRecord.update({
          where: { id: progression.id },
          data: {
            student_choice: data.choice,
            confirmed_at: new Date()
          }
        });
      }

      const finalUpdateNeeded =
        !progression.final_update_cycle_db_id &&
        progression.status !== "awaiting_unresolved_confirmation" &&
        (await hasUnprocessedSubstantiveEvidence(context.concept_unit_session.id));

      if (finalUpdateNeeded) {
        await requestFinalUpdateForProgression({
          progression,
          is_final_concept: context.is_final_concept
        });
        const updated = await prisma.conceptProgressionRecord.findUniqueOrThrow({
          where: { id: progression.id }
        });

        return {
          choice_status: "final_update_pending",
          progression: serializeProgressionForStudent({
            progression: updated,
            is_final_concept: context.is_final_concept,
            followup_active: false
          })
        };
      }

      const latestProfile = await prisma.studentProfile.findUnique({
        where: { id: context.concept_unit_session.latest_student_profile_db_id ?? "" },
        select: {
          integrated_diagnostic_profile: true,
          evidence_sufficiency: true
        }
      });
      const resolutionStatus = resolutionFromProfile(latestProfile);
      const unresolvedConfirmed =
        progression.status === "awaiting_unresolved_confirmation" &&
        resolutionStatus !== "resolved";

      if (resolutionStatus !== "resolved" && !unresolvedConfirmed) {
        const awaiting = await updateUnresolvedAwaiting({
          progression,
          resolution_status: resolutionStatus
        });

        return {
          choice_status: "unresolved_confirmation_required",
          progression: serializeProgressionForStudent({
            progression: awaiting,
            is_final_concept: context.is_final_concept,
            followup_active: context.session.current_phase === "followup_active"
          })
        };
      }

      if (unresolvedConfirmed) {
        await logProcessEvent({
          assessment_session_db_id: progression.assessment_session_db_id,
          concept_unit_session_db_id: progression.source_concept_unit_session_db_id,
          event_type: "concept_progression_unresolved_confirmed",
          event_category: "concept_progression",
          event_source: "frontend",
          payload: {
            progression_public_id: progression.progression_public_id,
            student_choice: data.choice
          },
          occurred_at: new Date()
        });
      }

      const completed = await proceedAfterChoice({
        progression: {
          ...progression,
          resolution_status: resolutionStatus
        },
        is_final_concept: context.is_final_concept,
        unresolved_confirmed: unresolvedConfirmed
      });

      return {
        choice_status:
          completed.progression_type === "complete_assessment"
            ? "assessment_completed"
            : "next_concept_ready",
        progression: serializeProgressionForStudent({
          progression: completed,
          is_final_concept: context.is_final_concept,
          followup_active: false
        })
      };
    }
  });
}

export async function finalizeConceptProgression(progressionPublicId: string) {
  let progression = await prisma.conceptProgressionRecord.findUniqueOrThrow({
    where: { progression_public_id: progressionPublicId },
    include: {
      final_update_cycle: true,
      source_concept_unit_session: {
        select: {
          latest_student_profile: {
            select: {
              integrated_diagnostic_profile: true,
              evidence_sufficiency: true
            }
          }
        }
      }
    }
  });

  if (progression.status === "completed") {
    return { status: "already_completed" as const, progression_public_id: progressionPublicId };
  }

  if (progression.status !== "final_update_pending") {
    return { status: "not_waiting_for_final_update" as const, progression_public_id: progressionPublicId };
  }

  const cycle = progression.final_update_cycle;

  if (!cycle || !["completed", "failed"].includes(cycle.status)) {
    return { status: "final_update_still_processing" as const, progression_public_id: progressionPublicId };
  }

  const latestProfile = progression.source_concept_unit_session.latest_student_profile;
  const resolutionStatus = resolutionFromProfile(latestProfile);
  const isFinalConcept = progression.progression_type === "complete_assessment";

  await logProcessEvent({
    assessment_session_db_id: progression.assessment_session_db_id,
    concept_unit_session_db_id: progression.source_concept_unit_session_db_id,
    event_type:
      cycle.status === "completed"
        ? "concept_progression_final_update_completed"
        : "concept_progression_final_update_failed",
    event_category: "concept_progression",
    event_source: "backend",
    payload: {
      progression_public_id: progression.progression_public_id,
      cycle_public_id: cycle.cycle_public_id,
      resolution_status: resolutionStatus
    },
    occurred_at: new Date()
  });

  progression = await prisma.conceptProgressionRecord.update({
    where: { id: progression.id },
    data: {
      resolution_status: resolutionStatus,
      status: resolutionStatus === "resolved" ? "evaluating_resolution" : "awaiting_unresolved_confirmation"
    },
    include: {
      final_update_cycle: true,
      source_concept_unit_session: {
        select: {
          latest_student_profile: {
            select: {
              integrated_diagnostic_profile: true,
              evidence_sufficiency: true
            }
          }
        }
      }
    }
  });

  if (resolutionStatus !== "resolved") {
    await logProcessEvent({
      assessment_session_db_id: progression.assessment_session_db_id,
      concept_unit_session_db_id: progression.source_concept_unit_session_db_id,
      event_type: "concept_progression_unresolved_confirmation_requested",
      event_category: "concept_progression",
      event_source: "backend",
      payload: {
        progression_public_id: progression.progression_public_id,
        progression_type: progression.progression_type
      },
      occurred_at: new Date()
    });

    return {
      status: "unresolved_confirmation_required" as const,
      progression_public_id: progressionPublicId
    };
  }

  if (!progression.student_choice) {
    const offered = await prisma.conceptProgressionRecord.update({
      where: { id: progression.id },
      data: { status: "offered" }
    });

    return {
      status: "progression_offered" as const,
      progression_public_id: offered.progression_public_id
    };
  }

  const completed = await proceedAfterChoice({
    progression,
    is_final_concept: isFinalConcept,
    unresolved_confirmed: false
  });

  return {
    status:
      completed.progression_type === "complete_assessment"
        ? ("assessment_completed" as const)
        : ("next_concept_ready" as const),
    progression_public_id: progressionPublicId
  };
}

export async function markConceptProgressionFailedFromJob(input: {
  job_payload: unknown;
  error_category: string;
  error_message: string;
}) {
  const payload = asRecord(input.job_payload);
  const progressionPublicId =
    typeof payload.progression_public_id === "string" ? payload.progression_public_id : null;

  if (!progressionPublicId) {
    return null;
  }

  const progression = await prisma.conceptProgressionRecord.findUnique({
    where: { progression_public_id: progressionPublicId }
  });

  if (!progression || progression.status === "completed") {
    return null;
  }

  await prisma.conceptProgressionRecord.update({
    where: { id: progression.id },
    data: {
      status: "failed"
    }
  });
  await logProcessEvent({
    assessment_session_db_id: progression.assessment_session_db_id,
    concept_unit_session_db_id: progression.source_concept_unit_session_db_id,
    event_type: "concept_progression_final_update_failed",
    event_category: "concept_progression",
    event_source: "system",
    payload: {
      progression_public_id: progression.progression_public_id,
      error_category: input.error_category,
      error_message: input.error_message.slice(0, 1200)
    },
    occurred_at: new Date()
  });

  return { status: "progression_failed" as const, progression_public_id: progressionPublicId };
}

export function serializeProgressionForTeacher(input: {
  progression_public_id: string;
  progression_type: string;
  trigger_type: string;
  student_choice: string | null;
  status: string;
  resolution_status: string;
  moved_on_with_unresolved_evidence: boolean;
  completed_with_unresolved_evidence: boolean;
  requested_at: Date;
  confirmed_at: Date | null;
  completed_at: Date | null;
  destination_concept_unit?: {
    concept_unit_public_id: string;
    title: string;
    order_index: number;
  } | null;
  final_update_cycle?: {
    cycle_public_id: string;
    status: string;
    completed_at: Date | null;
  } | null;
}) {
  return {
    progression_public_id: input.progression_public_id,
    progression_type: input.progression_type,
    trigger_type: input.trigger_type,
    student_choice: input.student_choice,
    status: input.status,
    resolution_status: input.resolution_status,
    moved_on_with_unresolved_evidence: input.moved_on_with_unresolved_evidence,
    completed_with_unresolved_evidence: input.completed_with_unresolved_evidence,
    requested_at: input.requested_at.toISOString(),
    confirmed_at: input.confirmed_at?.toISOString() ?? null,
    completed_at: input.completed_at?.toISOString() ?? null,
    destination_concept_unit: input.destination_concept_unit
      ? {
          concept_unit_public_id: input.destination_concept_unit.concept_unit_public_id,
          title: input.destination_concept_unit.title,
          order_index: input.destination_concept_unit.order_index
        }
      : null,
    final_update_cycle: input.final_update_cycle
      ? {
          cycle_public_id: input.final_update_cycle.cycle_public_id,
          status: input.final_update_cycle.status,
          completed_at: input.final_update_cycle.completed_at?.toISOString() ?? null
        }
      : null,
    interpretation_boundary:
      "Progression records describe student-controlled workflow choices and evidence-resolution status, not misconduct or teacher approval."
  };
}
