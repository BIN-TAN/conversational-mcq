import { createHash } from "node:crypto";
import { Prisma, type AssessmentPhase, type Item, type ItemResponse } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { ConfidenceLevelSchema, ProcessEventTypeSchema } from "@/lib/domain/enums";
import { getServerEnv } from "@/lib/env";
import {
  assessmentHasValidPublishedContent,
  computeAssessmentAvailability
} from "@/lib/services/assessment-availability/availability";
import { toPrismaJson } from "@/lib/services/json";
import { generatePublicId } from "@/lib/services/ids";
import { logConversationTurn } from "@/lib/services/conversation-turns";
import { getFollowupContextConfig } from "@/lib/agents/followup/context";
import { logProcessEvent } from "@/lib/services/process-events";
import { updateAssessmentSessionPhase, markSessionExited } from "@/lib/services/session-state";
import { createResponsePackage } from "@/lib/services/response-packages";
import { INCLUDED_ITEM_RANGE } from "@/lib/services/content/governance";
import { getGuardedOperationalAgentIntegrationReadiness } from "@/lib/operational/guarded-agent-integration";
import { getStudentProgressionStateBySessionDbId } from "@/lib/services/concept-progression/progression";
import {
  ensureChatNativeFormativeActivity,
  submitChatNativeFormativeActivityResponse,
  submitChatNativeNextChoice,
  submitChatNativeRevisionResponse
} from "@/lib/services/student-assessment/formative-profile";
import {
  assertChatNativeActionAllowed,
  type ChatNativeAssessmentAction,
  type ChatNativeAssessmentState
} from "@/lib/student-assessment/state-machine";
import {
  assertStudentPayloadIsSafe,
  serializeStudentAssessment,
  serializeStudentConceptUnit,
  serializeStudentSafeItem,
  serializeStudentSessionSummary
} from "./serializers";
import { StudentAssessmentServiceError } from "./errors";

const DEFAULT_ATTEMPT_NUMBER = 1;
const MAX_REASONING_LENGTH = 5000;
const MAX_EVENT_BATCH_SIZE = 20;
const MAX_EVENT_PAYLOAD_BYTES = 4000;

export const InitialAdministrationStep = z.enum([
  "concept_unit_intro",
  "present_item",
  "request_reasoning",
  "request_confidence",
  "request_tempting_option",
  "request_tempting_reason",
  "missing_evidence_repair",
  "item_complete",
  "package_review",
  "package_analysis",
  "initial_concept_unit_complete",
  "awaiting_profiling",
  "formative_activity",
  "formative_response_saved",
  "revision_requested",
  "transfer_item",
  "automatic_profiling_pending",
  "automatic_planning_pending",
  "automatic_followup_opening_pending",
  "automatic_workflow_failed",
  "followup_active",
  "followup_updating",
  "followup_stopped",
  "session_completed"
]);

type InitialAdministrationStep = z.infer<typeof InitialAdministrationStep>;
type MissingField = "answer" | "reasoning" | "confidence";
type TemptingOptionEvidence = {
  no_tempting_option: boolean;
  tempting_option: string | null;
  tempting_option_reason: string | null;
};

const optionActionSchema = z.object({
  selected_option: z.string().trim().min(1).max(16),
  client_action_id: z.string().trim().min(1).max(120).optional()
}).strict();

const reasoningActionSchema = z.object({
  reasoning_text: z.string().max(MAX_REASONING_LENGTH),
  client_action_id: z.string().trim().min(1).max(120).optional()
}).strict();

const confidenceActionSchema = z.object({
  confidence_rating: ConfidenceLevelSchema,
  client_action_id: z.string().trim().min(1).max(120).optional()
}).strict();

const temptingOptionActionSchema = z.object({
  tempting_option: z.string().trim().min(1).max(16).nullable().optional(),
  tempting_option_reason: z.string().trim().max(MAX_REASONING_LENGTH).nullable().optional(),
  no_tempting_option: z.boolean().default(false),
  client_action_id: z.string().trim().min(1).max(120).optional()
}).strict();

const packageReviewEditActionSchema = z.object({
  selected_option: z.string().trim().min(1).max(16),
  reasoning_text: z.string().trim().min(1).max(MAX_REASONING_LENGTH),
  confidence_rating: ConfidenceLevelSchema,
  tempting_option: z.string().trim().min(1).max(16).nullable().optional(),
  tempting_option_reason: z.string().trim().max(MAX_REASONING_LENGTH).nullable().optional(),
  no_tempting_option: z.boolean().default(false),
  client_action_id: z.string().trim().min(1).max(120).optional()
}).strict();

const submitActionSchema = z.object({
  confirm_skip: z.boolean().default(false),
  skip_item: z.boolean().default(false),
  skip_reasoning: z.boolean().default(false),
  skip_confidence: z.boolean().default(false),
  client_action_id: z.string().trim().min(1).max(120).optional()
}).strict();

const frontendEventTypes = [
  "page_hidden",
  "page_visible",
  "long_pause",
  "inactivity_detected",
  "navigation_event",
  "refresh_recovery"
] as const;
const FrontendEventTypeSchema = z.enum(frontendEventTypes);
const frontendEventSchema = z.object({
  event_type: FrontendEventTypeSchema,
  event_category: z.string().trim().min(1).max(80).default("student_process"),
  concept_unit_public_id: z.string().trim().min(1).optional(),
  item_public_id: z.string().trim().min(1).optional(),
  visibility_duration_ms: z.number().int().nonnegative().max(24 * 60 * 60 * 1000).optional(),
  pause_duration_ms: z.number().int().nonnegative().max(24 * 60 * 60 * 1000).optional(),
  client_occurred_at: z.coerce.date().optional(),
  payload: z.record(z.unknown()).optional()
}).strict();
const frontendEventsInputSchema = z.union([
  frontendEventSchema,
  z.object({ events: z.array(frontendEventSchema).min(1).max(MAX_EVENT_BATCH_SIZE) }).strict()
]);

function publicConflict(message: string, details: Record<string, unknown> = {}) {
  return new StudentAssessmentServiceError("conflict", message, 409, details);
}

function isUniqueOrSerializationConflict(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    (error.code === "P2002" || error.code === "P2034")
  );
}

function stableHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function responseMissingFields(
  response: Pick<
    ItemResponse,
    "selected_option" | "reasoning_text" | "confidence_rating" | "skipped_reasoning" | "skipped_confidence" | "skipped_item"
  > | null
): MissingField[] {
  const missing: MissingField[] = [];

  if (!response || (!response.selected_option && !response.skipped_item)) {
    missing.push("answer");
  }

  if (
    !response?.skipped_item &&
    !response?.skipped_reasoning &&
    (!response?.reasoning_text || response.reasoning_text.trim().length === 0)
  ) {
    missing.push("reasoning");
  }

  if (!response?.skipped_item && !response?.skipped_confidence && !response?.confidence_rating) {
    missing.push("confidence");
  }

  return missing;
}

function correctnessFor(selectedOption: string | null, correctOption: string) {
  if (!selectedOption) {
    return "unanswered" as const;
  }

  return selectedOption === correctOption ? ("correct" as const) : ("incorrect" as const);
}

function optionLabels(item: Pick<Item, "options">): string[] {
  if (!Array.isArray(item.options)) {
    return [];
  }

  return item.options
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }

      const label = (entry as Record<string, unknown>).label;
      return typeof label === "string" ? label : null;
    })
    .filter((label): label is string => Boolean(label));
}

function safeOptionEntries(value: unknown): Array<{ label: string; text: string }> {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }

      const record = entry as Record<string, unknown>;
      const label = typeof record.label === "string" ? record.label : "";
      const text = typeof record.text === "string" ? record.text : "";

      if (!label || !text) {
        return null;
      }

      return { label, text };
    })
    .filter((entry): entry is { label: string; text: string } => Boolean(entry));
}

function itemRoleFromRules(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const role = (value as Record<string, unknown>).item_role;
  return typeof role === "string" && role.trim() ? role.trim() : null;
}

function isTransferItemCandidate(
  item: Pick<Item, "status" | "included_in_published_set" | "administration_rules">
) {
  return (
    item.status !== "archived" &&
    item.included_in_published_set === false &&
    itemRoleFromRules(item.administration_rules) === "transfer"
  );
}

function itemAgentMessage(
  item: Pick<Item, "item_order" | "item_stem" | "options">,
  questionLabel: string
): string {
  const options = safeOptionEntries(item.options)
    .map((option) => `${option.label}. ${option.text}`)
    .join("\n");

  return [
    questionLabel,
    "",
    item.item_stem,
    "",
    options,
    "",
    "What is your answer?"
  ]
    .filter((part) => part !== "")
    .join("\n");
}

function initialItemAgentMessage(item: Pick<Item, "item_order" | "item_stem" | "options">): string {
  return itemAgentMessage(item, `Question ${item.item_order} of 3`);
}

const INITIAL_ADMIN_AGENT_NAME = "deterministic_initial_administration";
const TRANSFER_ITEM_AGENT_NAME = "deterministic_transfer_item";
const PACKAGE_REVIEW_MESSAGE =
  "I have your three responses. You can review or edit them before continuing to feedback.";
const TRANSFER_COMPLETION_MESSAGE =
  "Thanks. Your response to the additional question has been recorded.";

function normalizeTemptingOptionEvidence(value: unknown): TemptingOptionEvidence | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const payload = value as Record<string, unknown>;

  if (
    payload.source !== "initial_tempting_option" &&
    payload.source !== "transfer_tempting_option" &&
    payload.source !== "package_review_tempting_option"
  ) {
    return null;
  }

  const noTemptingOption = payload.no_tempting_option === true;
  const temptingOption =
    typeof payload.tempting_option === "string" && payload.tempting_option.trim()
      ? payload.tempting_option.trim()
      : null;
  const temptingOptionReason =
    typeof payload.tempting_option_reason === "string" && payload.tempting_option_reason.trim()
      ? payload.tempting_option_reason.trim()
      : null;

  if (!noTemptingOption && !temptingOption) {
    return null;
  }

  return {
    no_tempting_option: noTemptingOption,
    tempting_option: noTemptingOption ? null : temptingOption,
    tempting_option_reason: noTemptingOption ? null : temptingOptionReason
  };
}

async function findTransferItemForConceptUnit(conceptUnitDbId: string) {
  const candidates = await prisma.item.findMany({
    where: {
      concept_unit_db_id: conceptUnitDbId,
      included_in_published_set: false,
      status: { not: "archived" }
    },
    orderBy: [{ item_order: "asc" }, { created_at: "asc" }]
  });

  return candidates.find(isTransferItemCandidate) ?? null;
}

async function transferItemWasPresented(input: {
  assessment_session_db_id: string;
  concept_unit_session_db_id: string;
  item_db_id: string;
}) {
  const [eventCount, responseCount] = await Promise.all([
    prisma.processEvent.count({
      where: {
        assessment_session_db_id: input.assessment_session_db_id,
        concept_unit_session_db_id: input.concept_unit_session_db_id,
        item_db_id: input.item_db_id,
        event_type: "transfer_item_presented"
      }
    }),
    prisma.itemResponse.count({
      where: {
        concept_unit_session_db_id: input.concept_unit_session_db_id,
        item_db_id: input.item_db_id
      }
    })
  ]);

  return eventCount > 0 || responseCount > 0;
}

async function getLatestTemptingOptionEvidence(input: {
  concept_unit_session_db_id: string;
  item_db_id: string;
}): Promise<TemptingOptionEvidence | null> {
  const turns = await prisma.conversationTurn.findMany({
    where: {
      concept_unit_session_db_id: input.concept_unit_session_db_id,
      item_db_id: input.item_db_id,
      actor_type: "student"
    },
    orderBy: [{ created_at: "desc" }],
    select: { structured_payload: true },
    take: 10
  });

  for (const turn of turns) {
    const evidence = normalizeTemptingOptionEvidence(turn.structured_payload);

    if (evidence) {
      return evidence;
    }
  }

  return null;
}

function assertActionAllowedForState(input: {
  assessment_state: ChatNativeAssessmentState;
  action: ChatNativeAssessmentAction;
  item_public_id?: string;
}) {
  const allowed = assertChatNativeActionAllowed({
    state: input.assessment_state,
    action: input.action
  });

  if (!allowed.ok) {
    throw new StudentAssessmentServiceError(
      "invalid_phase_for_action",
      "This action is not allowed in the current assessment state.",
      409,
      {
        assessment_state: input.assessment_state,
        attempted_action: input.action,
        allowed_actions: allowed.allowed_actions,
        item_public_id: input.item_public_id
      }
    );
  }
}

function itemSnapshot(item: Item) {
  return {
    item_public_id: item.item_public_id,
    item_order: item.item_order,
    item_stem: item.item_stem,
    options: item.options,
    correct_option: item.correct_option,
    version: item.version
  };
}

async function txLogProcessEvent(
  tx: Prisma.TransactionClient,
  input: {
    assessment_session_db_id: string;
    concept_unit_session_db_id?: string;
    item_db_id?: string;
    event_type: z.infer<typeof ProcessEventTypeSchema>;
    event_category: string;
    event_source: "frontend" | "backend" | "agent" | "system";
    visibility_duration_ms?: number;
    pause_duration_ms?: number;
    payload?: unknown;
    occurred_at?: Date;
  }
) {
  return tx.processEvent.create({
    data: {
      assessment_session_db_id: input.assessment_session_db_id,
      concept_unit_session_db_id: input.concept_unit_session_db_id,
      item_db_id: input.item_db_id,
      event_type: input.event_type,
      event_category: input.event_category,
      event_source: input.event_source,
      visibility_duration_ms: input.visibility_duration_ms,
      pause_duration_ms: input.pause_duration_ms,
      payload: toPrismaJson(input.payload),
      occurred_at: input.occurred_at ?? new Date()
    }
  });
}

async function validPublishedConceptUnits(
  tx: Prisma.TransactionClient,
  assessmentDbId: string
) {
  const conceptUnits = await tx.conceptUnit.findMany({
    where: {
      assessment_db_id: assessmentDbId,
      status: "published"
    },
    orderBy: [{ order_index: "asc" }, { created_at: "asc" }],
    include: {
      items: {
        where: {
          status: "published",
          included_in_published_set: true
        },
        orderBy: [{ item_order: "asc" }, { created_at: "asc" }]
      }
    }
  });

  if (conceptUnits.length === 0) {
    throw new StudentAssessmentServiceError(
      "assessment_has_no_valid_published_concept_unit",
      "Assessment has no valid published concept unit.",
      409,
      { assessment_db_id: assessmentDbId }
    );
  }

  const invalid = conceptUnits
    .map((conceptUnit) => ({
      concept_unit_public_id: conceptUnit.concept_unit_public_id,
      included_active_item_count: conceptUnit.items.length
    }))
    .filter(
      (conceptUnit) =>
        conceptUnit.included_active_item_count < INCLUDED_ITEM_RANGE.min ||
        conceptUnit.included_active_item_count > INCLUDED_ITEM_RANGE.max
    );

  if (invalid.length > 0) {
    throw new StudentAssessmentServiceError(
      "assessment_has_no_valid_published_concept_unit",
      "Published concept units must have exactly 3 to 4 included active items.",
      409,
      { concept_units: invalid }
    );
  }

  return conceptUnits;
}

async function getOwnedSession(input: { student_user_db_id: string; session_public_id: string }) {
  await assertActiveStudentAccount(input.student_user_db_id);
  const session = await prisma.assessmentSession.findFirst({
    where: {
      session_public_id: input.session_public_id,
      user_db_id: input.student_user_db_id
    },
    select: { id: true }
  });

  if (!session) {
    throw new StudentAssessmentServiceError(
      "session_not_owned",
      "Session was not found for this student.",
      403
    );
  }

  return session;
}

async function assertActiveStudentAccount(studentUserDbId: string) {
  const user = await prisma.user.findUnique({
    where: { id: studentUserDbId },
    select: { role: true, account_status: true }
  });

  if (!user || user.role !== "student" || user.account_status !== "active") {
    throw new StudentAssessmentServiceError(
      "account_unavailable",
      "This account is currently unavailable.",
      403
    );
  }
}

async function withActionIdempotency<T extends Record<string, unknown>>(
  input: {
    assessment_session_db_id: string;
    client_action_id?: string;
    action_type: string;
    request_payload: unknown;
    run: () => Promise<T>;
  }
): Promise<T> {
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
      "session_start_conflict",
      "A matching request is already in progress.",
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
      data: { response_payload: toPrismaJson(response) }
    });

    return response;
  } catch (error) {
    await prisma.studentActionIdempotencyKey.delete({ where: { id: created.id } }).catch(() => null);
    throw error;
  }
}

export async function listAvailableAssessments(input: { student_user_db_id: string }) {
  await assertActiveStudentAccount(input.student_user_db_id);
  const assessments = await prisma.assessment.findMany({
    where: { status: { in: ["published", "archived"] } },
    orderBy: [{ created_at: "desc" }],
    select: {
      id: true,
      assessment_public_id: true,
      title: true,
      description: true,
      status: true,
      workflow_mode: true,
      release_at: true,
      close_at: true
    }
  });
  const availability = [];

  for (const assessment of assessments) {
    const hasValidContent = await prisma.$transaction((tx) =>
      assessmentHasValidPublishedContent(tx, assessment.id)
    );

    const existingSession = await prisma.assessmentSession.findUnique({
      where: {
        user_db_id_assessment_db_id_attempt_number: {
          user_db_id: input.student_user_db_id,
          assessment_db_id: assessment.id,
          attempt_number: DEFAULT_ATTEMPT_NUMBER
        }
      },
      select: {
        session_public_id: true,
        status: true,
        current_phase: true,
        completed_at: true
      }
    });
    const completed =
      existingSession?.status === "completed" ||
      existingSession?.current_phase === "session_completed" ||
      Boolean(existingSession?.completed_at);
    const computed = computeAssessmentAvailability({
      assessment,
      has_valid_content: hasValidContent,
      existing_session: existingSession
    });
    const manualReviewNewStartBlocked =
      assessment.workflow_mode === "manual_review" &&
      !existingSession &&
      !getServerEnv().ALLOW_MANUAL_REVIEW_STUDENT_STARTS;
    const studentSafeAvailabilityMessage = manualReviewNewStartBlocked
      ? "This assessment is not available for student starts yet."
      : computed.student_safe_availability_message;

    availability.push({
      ...serializeStudentAssessment(assessment),
      availability_state: computed.availability_state,
      release_at_course_time: computed.release_at_course_time,
      close_at_course_time: computed.close_at_course_time,
      course_timezone: computed.course_timezone,
      student_safe_availability_message: studentSafeAvailabilityMessage,
      availability_status: completed
        ? "completed"
        : existingSession
          ? "resume_available"
          : computed.availability_state,
      existing_session_public_id: existingSession?.session_public_id ?? null,
      existing_session_status: existingSession?.status ?? null,
      can_start: computed.can_start_new_session && !manualReviewNewStartBlocked,
      can_resume: Boolean(existingSession && !completed && computed.can_resume_existing_session)
    });
  }

  const result = { assessments: availability };
  assertStudentPayloadIsSafe(result);

  return result;
}

export async function startOrResumeStudentAssessmentSession(input: {
  student_user_db_id: string;
  assessment_public_id: string;
}) {
  await assertActiveStudentAccount(input.student_user_db_id);
  let lastError: unknown = null;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const result = await prisma.$transaction(
        async (tx) => {
          const assessment = await tx.assessment.findUnique({
            where: { assessment_public_id: input.assessment_public_id },
            select: {
              id: true,
              assessment_public_id: true,
              title: true,
              description: true,
              status: true,
              workflow_mode: true,
              response_collection_mode: true,
              release_at: true,
              close_at: true
            }
          });

          if (!assessment) {
            throw new StudentAssessmentServiceError("not_found", "Assessment was not found.", 404);
          }

          const now = new Date();
          const existing = await tx.assessmentSession.findUnique({
            where: {
              user_db_id_assessment_db_id_attempt_number: {
                user_db_id: input.student_user_db_id,
                assessment_db_id: assessment.id,
                attempt_number: DEFAULT_ATTEMPT_NUMBER
              }
            },
            select: {
              id: true,
              session_public_id: true,
              status: true,
              current_phase: true,
              resume_phase: true,
              completed_at: true,
              current_concept_unit_db_id: true
            }
          });

          if (existing) {
            if (
              existing.status === "completed" ||
              existing.current_phase === "session_completed" ||
              existing.completed_at
            ) {
              throw new StudentAssessmentServiceError(
                "assessment_already_completed",
                "This assessment attempt is already completed.",
                409,
                { session_public_id: existing.session_public_id }
              );
            }

            const conceptUnits = existing.current_concept_unit_db_id
              ? []
              : await validPublishedConceptUnits(tx, assessment.id);
            const fallbackConceptUnitId =
              existing.current_concept_unit_db_id ?? conceptUnits[0]?.id;

            if (!fallbackConceptUnitId) {
              throw new StudentAssessmentServiceError(
                "current_concept_unit_unavailable",
                "The existing session cannot be resumed because its current concept unit is unavailable.",
                409,
                { session_public_id: existing.session_public_id }
              );
            }

            const resumePhase =
              existing.current_phase === "student_exited" && existing.resume_phase
                ? existing.resume_phase
                : existing.current_phase;

            const resumed = await tx.assessmentSession.update({
              where: { id: existing.id },
              data: {
                status: "active",
                current_phase: resumePhase,
                resume_phase: null,
                resume_context: Prisma.JsonNull,
                current_concept_unit_db_id: fallbackConceptUnitId,
                last_activity_at: now
              },
              select: { id: true, session_public_id: true }
            });

            await tx.conceptUnitSession.upsert({
              where: {
                assessment_session_db_id_concept_unit_db_id: {
                  assessment_session_db_id: resumed.id,
                  concept_unit_db_id: fallbackConceptUnitId
                }
              },
              update: {},
              create: {
                assessment_session_db_id: resumed.id,
                concept_unit_db_id: fallbackConceptUnitId,
                status: "initial_in_progress",
                initial_started_at: now
              }
            });

            await txLogProcessEvent(tx, {
              assessment_session_db_id: resumed.id,
              event_type: "session_resumed",
              event_category: "session",
              event_source: "backend",
              payload: {
                current_phase: resumePhase,
                assessment_public_id: assessment.assessment_public_id
              },
              occurred_at: now
            });

            return resumed;
          }

          if (assessment.status === "archived") {
            throw new StudentAssessmentServiceError(
              "assessment_archived",
              "Archived assessments are not available for new starts.",
              409,
              { assessment_public_id: assessment.assessment_public_id }
            );
          }

          if (assessment.status !== "published") {
            throw new StudentAssessmentServiceError(
              "assessment_not_published",
              "Assessment is not published.",
              409,
              { assessment_public_id: assessment.assessment_public_id }
            );
          }

          if (
            assessment.workflow_mode === "manual_review" &&
            !getServerEnv().ALLOW_MANUAL_REVIEW_STUDENT_STARTS
          ) {
            throw new StudentAssessmentServiceError(
              "assessment_manual_review_not_available",
              "This assessment is not available for ordinary student starts.",
              409,
              { assessment_public_id: assessment.assessment_public_id }
            );
          }

          if (
            assessment.release_at &&
            assessment.close_at &&
            assessment.close_at <= assessment.release_at
          ) {
            throw new StudentAssessmentServiceError(
              "invalid_assessment_availability_window",
              "Assessment availability window is invalid.",
              409,
              { assessment_public_id: assessment.assessment_public_id }
            );
          }

          const hasValidContent = await assessmentHasValidPublishedContent(tx, assessment.id);
          const computedAvailability = computeAssessmentAvailability({
            assessment,
            has_valid_content: hasValidContent,
            now
          });

          if (computedAvailability.availability_state === "not_released") {
            throw new StudentAssessmentServiceError(
              "assessment_not_released",
              "Assessment is not released yet.",
              409,
              {
                assessment_public_id: assessment.assessment_public_id,
                release_at_course_time: computedAvailability.release_at_course_time,
                course_timezone: computedAvailability.course_timezone
              }
            );
          }

          if (computedAvailability.availability_state === "closed_to_new_starts") {
            throw new StudentAssessmentServiceError(
              "assessment_closed_to_new_starts",
              "Assessment is closed to new starts.",
              409,
              {
                assessment_public_id: assessment.assessment_public_id,
                close_at_course_time: computedAvailability.close_at_course_time,
                course_timezone: computedAvailability.course_timezone
              }
            );
          }

          if (!computedAvailability.can_start_new_session) {
            throw new StudentAssessmentServiceError(
              "assessment_not_available",
              "Assessment is not available for new starts.",
              409,
              {
                assessment_public_id: assessment.assessment_public_id,
                availability_state: computedAvailability.availability_state
              }
            );
          }

          const conceptUnits = await validPublishedConceptUnits(tx, assessment.id);
          const firstConceptUnit = conceptUnits[0];

          const session = await tx.assessmentSession.create({
            data: {
              session_public_id: generatePublicId("session"),
              user_db_id: input.student_user_db_id,
              assessment_db_id: assessment.id,
              attempt_number: DEFAULT_ATTEMPT_NUMBER,
              status: "active",
              current_phase: "concept_unit_intro",
              workflow_mode_snapshot: assessment.workflow_mode,
              response_collection_mode_snapshot: assessment.response_collection_mode,
              current_concept_unit_db_id: firstConceptUnit.id,
              started_at: now,
              last_activity_at: now
            },
            select: { id: true, session_public_id: true }
          });

          await tx.conceptUnitSession.create({
            data: {
              assessment_session_db_id: session.id,
              concept_unit_db_id: firstConceptUnit.id,
              status: "initial_in_progress",
              initial_started_at: now
            }
          });

          await txLogProcessEvent(tx, {
            assessment_session_db_id: session.id,
            event_type: "session_started",
            event_category: "session",
            event_source: "backend",
            payload: { phase: "session_started", assessment_public_id: assessment.assessment_public_id },
            occurred_at: now
          });
          await txLogProcessEvent(tx, {
            assessment_session_db_id: session.id,
            event_type: "phase_entered",
            event_category: "phase",
            event_source: "backend",
            payload: { phase: "session_started" },
            occurred_at: now
          });
          await txLogProcessEvent(tx, {
            assessment_session_db_id: session.id,
            event_type: "phase_exited",
            event_category: "phase",
            event_source: "backend",
            payload: { phase: "session_started" },
            occurred_at: now
          });
          await txLogProcessEvent(tx, {
            assessment_session_db_id: session.id,
            event_type: "transition_validated",
            event_category: "phase",
            event_source: "backend",
            payload: {
              from_phase: "session_started",
              to_phase: "concept_unit_intro",
              validation_reason: "Transition is allowed by the deterministic phase map."
            },
            occurred_at: now
          });
          await txLogProcessEvent(tx, {
            assessment_session_db_id: session.id,
            event_type: "phase_entered",
            event_category: "phase",
            event_source: "backend",
            payload: { phase: "concept_unit_intro" },
            occurred_at: now
          });

          return session;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
      );

      const state = await getStudentSessionState({
        student_user_db_id: input.student_user_db_id,
        session_public_id: result.session_public_id
      });

      return {
        session: state.session,
        state
      };
    } catch (error) {
      lastError = error;

      if (isUniqueOrSerializationConflict(error)) {
        continue;
      }

      throw error;
    }
  }

  if (isUniqueOrSerializationConflict(lastError)) {
    throw new StudentAssessmentServiceError(
      "session_start_conflict",
      "Could not start or resume the assessment session safely.",
      409
    );
  }

  throw lastError;
}

function conversationPayloadSource(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const source = (value as Record<string, unknown>).source;
  return typeof source === "string" ? source : null;
}

function conversationPayloadMessageType(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const type = (value as Record<string, unknown>).message_type;
  return typeof type === "string" ? type : null;
}

function conversationPromptRequiresStudentResponse(value: unknown) {
  const messageType = conversationPayloadMessageType(value);
  return (
    messageType === "revision_prompt" ||
    messageType === "scaffold_prompt" ||
    messageType === "clarification_prompt"
  );
}

async function getChatNativeRoundState(followupRoundDbId: string) {
  const turns = await prisma.conversationTurn.findMany({
    where: { followup_round_db_id: followupRoundDbId },
    select: {
      actor_type: true,
      structured_payload: true
    }
  });

  return {
    has_activity_response: turns.some(
      (turn) =>
        turn.actor_type === "student" &&
        conversationPayloadSource(turn.structured_payload) === "chat_native_formative_activity_response"
    ),
    has_revision_prompt: turns.some(
      (turn) =>
        turn.actor_type === "agent" &&
        conversationPayloadSource(turn.structured_payload) === "chat_native_targeted_feedback" &&
        conversationPromptRequiresStudentResponse(turn.structured_payload)
    ),
    has_revision_response: turns.some(
      (turn) =>
        turn.actor_type === "student" &&
        conversationPayloadSource(turn.structured_payload) === "chat_native_revision"
    )
  };
}

export async function getStudentSessionState(input: {
  student_user_db_id: string;
  session_public_id: string;
}) {
  await assertActiveStudentAccount(input.student_user_db_id);
  const session = await prisma.assessmentSession.findFirst({
    where: {
      session_public_id: input.session_public_id,
      user_db_id: input.student_user_db_id
    },
    include: {
      assessment: {
        select: {
          id: true,
          assessment_public_id: true,
          title: true,
          description: true
        }
      },
      current_concept_unit: {
        include: {
          items: {
            where: {
              status: "published",
              included_in_published_set: true
            },
            orderBy: [{ item_order: "asc" }, { created_at: "asc" }]
          }
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

  const publishedConceptUnits = await prisma.conceptUnit.findMany({
    where: {
      assessment_db_id: session.assessment_db_id,
      status: "published"
    },
    orderBy: [{ order_index: "asc" }, { created_at: "asc" }],
    select: {
      id: true,
      concept_unit_public_id: true,
      title: true,
      learning_objective: true,
      order_index: true
    }
  });
  const currentConceptUnit = session.current_concept_unit;
  const conceptUnitSession = currentConceptUnit
    ? await prisma.conceptUnitSession.findUnique({
        where: {
          assessment_session_db_id_concept_unit_db_id: {
            assessment_session_db_id: session.id,
            concept_unit_db_id: currentConceptUnit.id
          }
        },
        include: {
          item_responses: true
        }
      })
    : null;
  const responsesByItemId = new Map(
    (conceptUnitSession?.item_responses ?? []).map((response) => [response.item_db_id, response])
  );
  const items = currentConceptUnit?.items ?? [];
  const effectivePhase =
    session.current_phase === "student_exited" && session.resume_phase
      ? session.resume_phase
      : session.current_phase;
  const transferCandidate =
    currentConceptUnit && conceptUnitSession && effectivePhase === "followup_stopped"
      ? await findTransferItemForConceptUnit(currentConceptUnit.id)
      : null;
  const transferStarted =
    transferCandidate && conceptUnitSession
      ? await transferItemWasPresented({
          assessment_session_db_id: session.id,
          concept_unit_session_db_id: conceptUnitSession.id,
          item_db_id: transferCandidate.id
        })
      : false;
  const transferItem = transferStarted ? transferCandidate : null;
  const activeItems = transferItem ? [transferItem] : items;
  const completedItemCount = activeItems.filter((item) =>
    Boolean(responsesByItemId.get(item.id)?.item_submitted_at)
  ).length;
  const firstMissingRepairItem = activeItems.find((item) => {
    const response = responsesByItemId.get(item.id);
    return response?.missing_evidence_repair_offered && !response.item_submitted_at;
  });
  const firstIncompleteItem = activeItems.find((item) => {
    const response = responsesByItemId.get(item.id);
    return !response?.item_submitted_at;
  });
  const currentItem = transferItem
    ? firstIncompleteItem ?? transferItem
    : effectivePhase === "missing_evidence_repair"
      ? firstMissingRepairItem ?? firstIncompleteItem ?? null
      : firstIncompleteItem ?? null;
  const currentResponse = currentItem ? responsesByItemId.get(currentItem.id) ?? null : null;
  const missingEvidence = responseMissingFields(currentResponse);
  const temptingOptionEvidence =
    currentItem && conceptUnitSession
      ? await getLatestTemptingOptionEvidence({
          concept_unit_session_db_id: conceptUnitSession.id,
          item_db_id: currentItem.id
        })
      : null;
  let assessmentState: ChatNativeAssessmentState = "SESSION_START";
  let nextStep: InitialAdministrationStep = "concept_unit_intro";
  const automaticJobs =
    session.workflow_mode_snapshot === "automatic"
      ? await prisma.workflowJob.findMany({
          where: { assessment_session_db_id: session.id },
          select: {
            status: true,
            job_type: true
          }
        })
      : [];
  const automaticWorkflowFailed =
    session.workflow_mode_snapshot === "automatic" &&
    (Boolean(session.automation_exception_reason) ||
      automaticJobs.some((job) => job.status === "failed"));
  const automaticAgentIntegrationReady =
    session.workflow_mode_snapshot === "automatic"
      ? (await getGuardedOperationalAgentIntegrationReadiness({
          checkDatabase: true
        })).allowed
      : false;
  const phaseFiveFormativeRound =
    conceptUnitSession && ["planning_completed", "followup_active", "followup_stopped"].includes(effectivePhase)
      ? await prisma.followupRound.findFirst({
          where: {
            concept_unit_session_db_id: conceptUnitSession.id,
            status: { in: ["active", "completed", "stopped"] }
          },
          orderBy: [{ round_index: "desc" }],
          select: {
            id: true,
            round_index: true,
            status: true,
            started_at: true,
            completed_at: true
          }
        })
      : null;
  const phaseSixRoundState = phaseFiveFormativeRound
    ? await getChatNativeRoundState(phaseFiveFormativeRound.id)
    : null;

  if (effectivePhase === "session_completed") {
    assessmentState = "SESSION_COMPLETE";
    nextStep = "session_completed";
  } else if (effectivePhase === "followup_stopped" && transferItem && currentItem) {
    if (currentResponse?.item_submitted_at) {
      assessmentState = "SESSION_COMPLETE";
      nextStep = "session_completed";
    } else if (!currentResponse || !currentResponse.selected_option) {
      assessmentState = "TRANSFER_ITEM";
      nextStep = "transfer_item";
    } else if (
      !currentResponse.skipped_reasoning &&
      (!currentResponse.reasoning_text || currentResponse.reasoning_text.trim().length === 0)
    ) {
      assessmentState = "AWAIT_REASON";
      nextStep = "request_reasoning";
    } else if (!currentResponse.skipped_confidence && !currentResponse.confidence_rating) {
      assessmentState = "AWAIT_CONFIDENCE";
      nextStep = "request_confidence";
    } else if (!temptingOptionEvidence) {
      assessmentState = "AWAIT_TEMPTING_OPTION";
      nextStep = "request_tempting_option";
    } else if (
      !temptingOptionEvidence.no_tempting_option &&
      temptingOptionEvidence.tempting_option &&
      !temptingOptionEvidence.tempting_option_reason
    ) {
      assessmentState = "AWAIT_TEMPTING_REASON";
      nextStep = "request_tempting_reason";
    } else {
      assessmentState = "ITEM_COMPLETE";
      nextStep = "item_complete";
    }
  } else if (
    phaseFiveFormativeRound?.status === "active" &&
    phaseSixRoundState?.has_revision_prompt &&
    !phaseSixRoundState.has_revision_response
  ) {
    assessmentState = "REVISION";
    nextStep = "revision_requested";
  } else if (effectivePhase === "followup_active") {
    assessmentState = "FOLLOWUP_RESPONSE";
    nextStep = "followup_active";
  } else if (
    effectivePhase === "followup_profile_update_pending" ||
    effectivePhase === "followup_planning_update_pending"
  ) {
    assessmentState = "TARGETED_FEEDBACK";
    nextStep = "followup_updating";
  } else if (effectivePhase === "followup_stopped") {
    assessmentState = "NEXT_CHOICE";
    nextStep = "followup_stopped";
  } else if (automaticWorkflowFailed) {
    assessmentState = "PACKAGE_ANALYSIS";
    nextStep = "automatic_workflow_failed";
  } else if (
    automaticAgentIntegrationReady &&
    (effectivePhase === "profiling_pending" || effectivePhase === "initial_concept_unit_completed")
  ) {
    assessmentState = "PACKAGE_ANALYSIS";
    nextStep = "automatic_profiling_pending";
  } else if (
    automaticAgentIntegrationReady &&
    (effectivePhase === "profiling_completed" || effectivePhase === "planning_pending")
  ) {
    assessmentState = "PACKAGE_ANALYSIS";
    nextStep = "automatic_planning_pending";
  } else if (effectivePhase === "planning_completed" && phaseFiveFormativeRound?.status === "active") {
    assessmentState = "FORMATIVE_ACTIVITY";
    nextStep = "formative_activity";
  } else if (effectivePhase === "planning_completed" && phaseFiveFormativeRound?.status === "completed") {
    assessmentState = "FOLLOWUP_RESPONSE";
    nextStep = "formative_response_saved";
  } else if (
    automaticAgentIntegrationReady &&
    effectivePhase === "planning_completed"
  ) {
    assessmentState = "FORMATIVE_ACTIVITY";
    nextStep = "automatic_followup_opening_pending";
  } else if (
    effectivePhase === "profiling_pending" ||
    effectivePhase === "initial_concept_unit_completed" ||
    conceptUnitSession?.initial_completed_at
  ) {
    assessmentState = "PACKAGE_ANALYSIS";
    nextStep = "awaiting_profiling";
  } else if (effectivePhase === "concept_unit_intro" || !conceptUnitSession) {
    assessmentState = "SESSION_START";
    nextStep = "concept_unit_intro";
  } else if (effectivePhase === "missing_evidence_repair") {
    assessmentState = missingEvidence.includes("answer")
      ? "AWAIT_ANSWER"
      : missingEvidence.includes("reasoning")
        ? "AWAIT_REASON"
        : missingEvidence.includes("confidence")
          ? "AWAIT_CONFIDENCE"
          : "ITEM_COMPLETE";
    nextStep = "missing_evidence_repair";
  } else if (!currentItem && completedItemCount === items.length && items.length > 0) {
    assessmentState = "PACKAGE_REVIEW";
    nextStep = "package_review";
  } else if (!currentResponse || !currentResponse.selected_option) {
    assessmentState = "AWAIT_ANSWER";
    nextStep = "present_item";
  } else if (
    !currentResponse.skipped_reasoning &&
    (!currentResponse.reasoning_text || currentResponse.reasoning_text.trim().length === 0)
  ) {
    assessmentState = "AWAIT_REASON";
    nextStep = "request_reasoning";
  } else if (!currentResponse.skipped_confidence && !currentResponse.confidence_rating) {
    assessmentState = "AWAIT_CONFIDENCE";
    nextStep = "request_confidence";
  } else if (!temptingOptionEvidence) {
    assessmentState = "AWAIT_TEMPTING_OPTION";
    nextStep = "request_tempting_option";
  } else if (
    !temptingOptionEvidence.no_tempting_option &&
    temptingOptionEvidence.tempting_option &&
    !temptingOptionEvidence.tempting_option_reason
  ) {
    assessmentState = "AWAIT_TEMPTING_REASON";
    nextStep = "request_tempting_reason";
  } else {
    assessmentState = "ITEM_COMPLETE";
    nextStep = "item_complete";
  }

  const conceptUnitIndex = currentConceptUnit
    ? publishedConceptUnits.findIndex((unit) => unit.id === currentConceptUnit.id)
    : -1;
  const activeOrLatestFollowupRound =
    conceptUnitSession &&
    ([
      "planning_completed",
      "followup_active",
      "followup_profile_update_pending",
      "followup_planning_update_pending",
      "followup_stopped"
    ].includes(effectivePhase) ||
      nextStep === "formative_activity" ||
      nextStep === "formative_response_saved")
      ? await prisma.followupRound.findFirst({
          where: {
            concept_unit_session_db_id: conceptUnitSession.id,
            status:
              effectivePhase === "followup_stopped"
                ? "stopped"
                : effectivePhase === "planning_completed"
                  ? { in: ["active", "completed"] }
                  : "active"
          },
          orderBy: [{ round_index: "desc" }],
          select: {
            round_index: true,
            status: true,
            started_at: true,
            completed_at: true
          }
        })
      : null;
  const followupConfig = getFollowupContextConfig();
  const progression = await getStudentProgressionStateBySessionDbId({
    assessment_session_db_id: session.id,
    concept_unit_session_db_id: conceptUnitSession?.id ?? null,
    current_phase: effectivePhase,
    assessment_db_id: session.assessment_db_id,
    current_concept_unit_db_id: currentConceptUnit?.id ?? null
  });
  const result = {
    session: serializeStudentSessionSummary(session),
    session_public_id: session.session_public_id,
    session_status: session.status,
    current_phase: session.current_phase,
    effective_phase: effectivePhase,
    assessment_state: assessmentState,
    assessment: serializeStudentAssessment(session.assessment),
    progress: {
      concept_unit_index: conceptUnitIndex >= 0 ? conceptUnitIndex + 1 : 0,
      concept_unit_count: publishedConceptUnits.length,
      completed_item_count: completedItemCount,
      total_item_count: activeItems.length
    },
    current_concept_unit: currentConceptUnit
      ? serializeStudentConceptUnit(currentConceptUnit)
      : null,
    next_step: nextStep,
    current_item: currentItem ? serializeStudentSafeItem(currentItem, currentResponse) : null,
    missing_evidence: nextStep === "missing_evidence_repair" ? missingEvidence : [],
    can_exit: session.status !== "completed",
    can_resume: session.status !== "completed",
    initial_chat: {
      message_max_chars: getServerEnv().INITIAL_CHAT_MESSAGE_MAX_CHARS
    },
    followup: activeOrLatestFollowupRound
      ? {
          round_index: activeOrLatestFollowupRound.round_index,
          status: activeOrLatestFollowupRound.status,
          started_at: activeOrLatestFollowupRound.started_at?.toISOString() ?? null,
          completed_at: activeOrLatestFollowupRound.completed_at?.toISOString() ?? null,
          can_send:
            (effectivePhase === "followup_active" || nextStep === "formative_activity") &&
            activeOrLatestFollowupRound.status === "active",
          can_stop:
            effectivePhase !== "planning_completed" &&
            [
              "followup_active",
              "followup_profile_update_pending",
              "followup_planning_update_pending"
            ].includes(effectivePhase) && activeOrLatestFollowupRound.status === "active",
          can_save_exit: true,
          message_max_chars: followupConfig.message_max_chars
        }
      : null,
    formative_activity:
      effectivePhase === "planning_completed" && activeOrLatestFollowupRound
        ? {
            round_index: activeOrLatestFollowupRound.round_index,
            status: activeOrLatestFollowupRound.status,
            started_at: activeOrLatestFollowupRound.started_at?.toISOString() ?? null,
            completed_at: activeOrLatestFollowupRound.completed_at?.toISOString() ?? null,
            can_send:
              nextStep === "formative_activity" &&
              activeOrLatestFollowupRound.status === "active",
            message_max_chars: followupConfig.message_max_chars
          }
        : null,
    progression
  };

  assertStudentPayloadIsSafe(result);

  return result;
}

export async function startConceptUnitInitialAdministration(input: {
  student_user_db_id: string;
  session_public_id: string;
  concept_unit_public_id: string;
}) {
  const owned = await getOwnedSession(input);
  const session = await prisma.assessmentSession.findUniqueOrThrow({
    where: { id: owned.id },
    include: {
      current_concept_unit: true
    }
  });

  if (!session.current_concept_unit) {
    throw publicConflict("No current concept unit is set for this session.");
  }

  if (session.current_concept_unit.concept_unit_public_id !== input.concept_unit_public_id) {
    throw new StudentAssessmentServiceError(
      "concept_unit_not_current",
      "The requested concept unit is not the current concept unit.",
      409
    );
  }

  if (session.current_concept_unit.status !== "published") {
    throw new StudentAssessmentServiceError(
      "assessment_has_no_valid_published_concept_unit",
      "The current concept unit is not published.",
      409
    );
  }

  const includedItems = await prisma.item.findMany({
    where: {
      concept_unit_db_id: session.current_concept_unit.id,
      status: "published",
      included_in_published_set: true
    },
    orderBy: [{ item_order: "asc" }, { created_at: "asc" }]
  });

  if (
    includedItems.length < INCLUDED_ITEM_RANGE.min ||
    includedItems.length > INCLUDED_ITEM_RANGE.max
  ) {
    throw new StudentAssessmentServiceError(
      "assessment_has_no_valid_published_concept_unit",
      "The current concept unit does not have a valid included item count.",
      409
    );
  }

  if (
    session.current_phase !== "concept_unit_intro" &&
    session.current_phase !== "session_started" &&
    session.current_phase !== "initial_item_administration"
  ) {
    throw new StudentAssessmentServiceError(
      "invalid_phase_for_action",
      "Concept unit initial administration cannot start from the current phase.",
      409,
      { current_phase: session.current_phase }
    );
  }

  const now = new Date();
  const conceptUnitSession = await prisma.conceptUnitSession.upsert({
    where: {
      assessment_session_db_id_concept_unit_db_id: {
        assessment_session_db_id: session.id,
        concept_unit_db_id: session.current_concept_unit.id
      }
    },
    update: {
      status: "initial_in_progress",
      initial_started_at: now
    },
    create: {
      assessment_session_db_id: session.id,
      concept_unit_db_id: session.current_concept_unit.id,
      status: "initial_in_progress",
      initial_started_at: now
    }
  });

  if (session.current_phase !== "initial_item_administration") {
    await updateAssessmentSessionPhase({
      assessment_session_db_id: session.id,
      to_phase: "initial_item_administration"
    });
  } else {
    await prisma.assessmentSession.update({
      where: { id: session.id },
      data: { last_activity_at: now }
    });
  }

  await logProcessEvent({
    assessment_session_db_id: session.id,
    concept_unit_session_db_id: conceptUnitSession.id,
    item_db_id: includedItems[0]?.id,
    event_type: "item_presented",
    event_category: "initial_administration",
    event_source: "backend",
    payload: { item_public_id: includedItems[0]?.item_public_id },
    occurred_at: now
  });
  if (includedItems[0]) {
    await logInitialAgentPrompt({
      session_db_id: session.id,
      concept_unit_session_db_id: conceptUnitSession.id,
      item_db_id: includedItems[0].id,
      phase: "initial_item_administration",
      prompt_type: "item_presented",
      message_text: initialItemAgentMessage(includedItems[0]),
      structured_payload: {
        item_public_id: includedItems[0].item_public_id,
        item_order: includedItems[0].item_order
      },
      occurred_at: now
    });
  }

  return getStudentSessionState(input);
}

async function getActionContext(input: {
  student_user_db_id: string;
  session_public_id: string;
  item_public_id: string;
}) {
  const session = await prisma.assessmentSession.findFirst({
    where: {
      session_public_id: input.session_public_id,
      user_db_id: input.student_user_db_id
    },
    include: {
      current_concept_unit: true
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

  if (!session.current_concept_unit) {
    throw publicConflict("No current concept unit is set for this session.");
  }

  const conceptUnitSession = await prisma.conceptUnitSession.findUnique({
    where: {
      assessment_session_db_id_concept_unit_db_id: {
        assessment_session_db_id: session.id,
        concept_unit_db_id: session.current_concept_unit.id
      }
    }
  });

  if (!conceptUnitSession) {
    throw new StudentAssessmentServiceError(
      "concept_unit_not_current",
      "Current concept-unit session was not found.",
      409
    );
  }

  const item = await prisma.item.findUnique({
    where: { item_public_id: input.item_public_id },
    include: {
      concept_unit: {
        select: {
          assessment_db_id: true
        }
      }
    }
  });

  if (item && item.concept_unit_db_id !== session.current_concept_unit.id) {
    if (item.concept_unit.assessment_db_id === session.assessment_db_id) {
      throw new StudentAssessmentServiceError(
        "concept_no_longer_current",
        "This concept is no longer current for editing.",
        409
      );
    }
  }

  if (!item || item.concept_unit_db_id !== session.current_concept_unit.id) {
    throw new StudentAssessmentServiceError(
      "item_not_in_current_concept_unit",
      "Item is not in the current concept unit.",
      409
    );
  }

  const isTransferItem = isTransferItemCandidate(item);
  const transferPresented = isTransferItem
    ? await transferItemWasPresented({
        assessment_session_db_id: session.id,
        concept_unit_session_db_id: conceptUnitSession.id,
        item_db_id: item.id
      })
    : false;

  if (
    !isTransferItem &&
    (conceptUnitSession.initial_completed_at || conceptUnitSession.status === "initial_completed")
  ) {
    throw new StudentAssessmentServiceError(
      "initial_response_locked_after_concept_completion",
      "Initial responses are locked after concept-unit completion.",
      409
    );
  }

  if (isTransferItem) {
    if (session.current_phase !== "followup_stopped" || !transferPresented) {
      throw new StudentAssessmentServiceError(
        "invalid_phase_for_action",
        "The transfer item is not currently available.",
        409,
        { current_phase: session.current_phase }
      );
    }
  } else if (
    session.current_phase !== "initial_item_administration" &&
    session.current_phase !== "missing_evidence_repair"
  ) {
    throw new StudentAssessmentServiceError(
      "invalid_phase_for_action",
      "Item responses can be changed only during initial item administration.",
      409,
      { current_phase: session.current_phase }
    );
  }

  if (!isTransferItem && (item.status !== "published" || !item.included_in_published_set)) {
    throw new StudentAssessmentServiceError(
      "item_not_included_in_published_set",
      "Item is not part of the published administration set.",
      409
    );
  }

  if (!isTransferItem) {
    const orderedItems = await prisma.item.findMany({
      where: {
        concept_unit_db_id: session.current_concept_unit.id,
        status: "published",
        included_in_published_set: true
      },
      orderBy: [{ item_order: "asc" }, { created_at: "asc" }],
      select: { id: true }
    });
    const responses = await prisma.itemResponse.findMany({
      where: {
        concept_unit_session_db_id: conceptUnitSession.id,
        item_db_id: { in: orderedItems.map((orderedItem) => orderedItem.id) }
      },
      select: { item_db_id: true, item_submitted_at: true }
    });
    const responseByItemId = new Map(
      responses.map((response) => [response.item_db_id, response])
    );
    const existingResponse = responseByItemId.get(item.id);
    const nextIncomplete = orderedItems.find(
      (orderedItem) => !responseByItemId.get(orderedItem.id)?.item_submitted_at
    );

    if (!existingResponse && nextIncomplete?.id !== item.id) {
      throw new StudentAssessmentServiceError(
        "item_not_in_current_concept_unit",
        "The requested item is not the next allowed item.",
        409,
        { item_public_id: input.item_public_id }
      );
    }
  }

  return { session, conceptUnitSession, item, isTransferItem };
}

async function assertCurrentItemActionState(input: {
  student_user_db_id: string;
  session_public_id: string;
  item_public_id: string;
  action: ChatNativeAssessmentAction;
}) {
  const state = await getStudentSessionState({
    student_user_db_id: input.student_user_db_id,
    session_public_id: input.session_public_id
  });

  if (state.current_item?.item_public_id !== input.item_public_id) {
    throw new StudentAssessmentServiceError(
      "invalid_phase_for_action",
      "The requested item is not the current item for this assessment state.",
      409,
      {
        assessment_state: state.assessment_state,
        current_item_public_id: state.current_item?.item_public_id ?? null,
        requested_item_public_id: input.item_public_id
      }
    );
  }

  assertActionAllowedForState({
    assessment_state: state.assessment_state,
    action: input.action,
    item_public_id: input.item_public_id
  });

  return state;
}

async function getOrCreateItemResponse(input: {
  concept_unit_session_db_id: string;
  item: Item;
}) {
  const existing = await prisma.itemResponse.findUnique({
    where: {
      concept_unit_session_db_id_item_db_id: {
        concept_unit_session_db_id: input.concept_unit_session_db_id,
        item_db_id: input.item.id
      }
    }
  });

  if (existing) {
    return existing;
  }

  return prisma.itemResponse.create({
    data: {
      concept_unit_session_db_id: input.concept_unit_session_db_id,
      item_db_id: input.item.id,
      correct_option_snapshot: input.item.correct_option,
      correctness: "not_scored",
      item_started_at: new Date(),
      item_version_snapshot: input.item.version,
      item_snapshot: itemSnapshot(input.item)
    }
  });
}

async function logStudentTurnAndEvent(input: {
  session_db_id: string;
  concept_unit_session_db_id: string;
  item_db_id: string;
  phase: AssessmentPhase;
  event_type: z.infer<typeof ProcessEventTypeSchema>;
  event_category?: string;
  message_text?: string;
  structured_payload?: unknown;
}) {
  const now = new Date();

  await logProcessEvent({
    assessment_session_db_id: input.session_db_id,
    concept_unit_session_db_id: input.concept_unit_session_db_id,
    item_db_id: input.item_db_id,
    event_type: input.event_type,
    event_category: input.event_category ?? "initial_administration",
    event_source: "frontend",
    payload: input.structured_payload,
    occurred_at: now
  });
  await logConversationTurn({
    assessment_session_db_id: input.session_db_id,
    concept_unit_session_db_id: input.concept_unit_session_db_id,
    item_db_id: input.item_db_id,
    phase: input.phase,
    actor_type: "student",
    message_text: input.message_text,
    structured_payload: input.structured_payload,
    created_at: now
  });
}

async function logInitialAgentPrompt(input: {
  session_db_id: string;
  concept_unit_session_db_id: string;
  item_db_id?: string;
  phase: AssessmentPhase;
  prompt_type:
    | "item_presented"
    | "request_reasoning"
    | "request_confidence"
    | "request_tempting_option"
    | "request_tempting_reason"
    | "package_review";
  message_text: string;
  structured_payload?: Record<string, unknown>;
  event_category?: string;
  agent_name?: string;
  occurred_at?: Date;
}) {
  const now = input.occurred_at ?? new Date();
  const agentName = input.agent_name ?? INITIAL_ADMIN_AGENT_NAME;
  const payload = {
    source: agentName,
    prompt_type: input.prompt_type,
    ...(input.structured_payload ?? {})
  };

  await logProcessEvent({
    assessment_session_db_id: input.session_db_id,
    concept_unit_session_db_id: input.concept_unit_session_db_id,
    item_db_id: input.item_db_id,
    event_type: "agent_message_shown",
    event_category: input.event_category ?? "initial_administration",
    event_source: "backend",
    payload,
    occurred_at: now
  });
  await logConversationTurn({
    assessment_session_db_id: input.session_db_id,
    concept_unit_session_db_id: input.concept_unit_session_db_id,
    item_db_id: input.item_db_id,
    phase: input.phase,
    actor_type: "agent",
    agent_name: agentName,
    message_text: input.message_text,
    structured_payload: payload,
    created_at: now
  });
}

export async function recordSelectedOption(input: {
  student_user_db_id: string;
  session_public_id: string;
  item_public_id: string;
  data: unknown;
}) {
  const data = optionActionSchema.parse(input.data);
  const context = await getActionContext(input);

  return withActionIdempotency({
    assessment_session_db_id: context.session.id,
    client_action_id: data.client_action_id,
    action_type: "option",
    request_payload: data,
    run: async () => {
      await assertCurrentItemActionState({
        student_user_db_id: input.student_user_db_id,
        session_public_id: input.session_public_id,
        item_public_id: input.item_public_id,
        action: "record_answer"
      });
      const labels = optionLabels(context.item);

      if (!labels.includes(data.selected_option)) {
        throw new StudentAssessmentServiceError(
          "invalid_option",
          "Selected option does not exist for this item.",
          400,
          { item_public_id: context.item.item_public_id }
        );
      }

      const response = await getOrCreateItemResponse({
        concept_unit_session_db_id: context.conceptUnitSession.id,
        item: context.item
      });
      const selectedChanged =
        response.selected_option !== null && response.selected_option !== data.selected_option;

      await prisma.itemResponse.update({
        where: { id: response.id },
        data: {
          selected_option: data.selected_option,
          correctness: correctnessFor(data.selected_option, response.correct_option_snapshot),
          skipped_item: false,
          revision_count: selectedChanged ? { increment: 1 } : undefined
        }
      });
      await prisma.assessmentSession.update({
        where: { id: context.session.id },
        data: { last_activity_at: new Date() }
      });
      await logStudentTurnAndEvent({
        session_db_id: context.session.id,
        concept_unit_session_db_id: context.conceptUnitSession.id,
        item_db_id: context.item.id,
        phase: context.session.current_phase,
        event_type: context.isTransferItem ? "transfer_answer_selected" : "option_selected",
        event_category: context.isTransferItem ? "transfer_item" : "initial_administration",
        structured_payload: {
          source: context.isTransferItem ? "transfer_answer" : "initial_answer",
          item_public_id: context.item.item_public_id,
          selected_option: data.selected_option,
          revised: selectedChanged,
          item_context: context.isTransferItem ? "transfer" : "initial"
        }
      });
      await logProcessEvent({
        assessment_session_db_id: context.session.id,
        concept_unit_session_db_id: context.conceptUnitSession.id,
        item_db_id: context.item.id,
        event_type: "option_clicked",
        event_category: context.isTransferItem ? "transfer_item" : "initial_administration",
        event_source: "frontend",
        payload: {
          item_public_id: context.item.item_public_id,
          selected_option: data.selected_option,
          revised: selectedChanged,
          item_context: context.isTransferItem ? "transfer" : "initial"
        }
      });
      if (selectedChanged) {
        await logProcessEvent({
        assessment_session_db_id: context.session.id,
        concept_unit_session_db_id: context.conceptUnitSession.id,
        item_db_id: context.item.id,
        event_type: "answer_changed",
          event_category: context.isTransferItem ? "transfer_item" : "initial_administration",
          event_source: "frontend",
          payload: {
            item_public_id: context.item.item_public_id,
            selected_option: data.selected_option,
            item_context: context.isTransferItem ? "transfer" : "initial"
          }
        });
      }
      await logInitialAgentPrompt({
        session_db_id: context.session.id,
        concept_unit_session_db_id: context.conceptUnitSession.id,
        item_db_id: context.item.id,
        phase: context.session.current_phase,
        prompt_type: "request_reasoning",
        message_text: `What is your reason for choosing ${data.selected_option}?`,
        structured_payload: {
          item_public_id: context.item.item_public_id,
          selected_option: data.selected_option,
          item_context: context.isTransferItem ? "transfer" : "initial"
        },
        event_category: context.isTransferItem ? "transfer_item" : "initial_administration",
        agent_name: context.isTransferItem ? TRANSFER_ITEM_AGENT_NAME : INITIAL_ADMIN_AGENT_NAME
      });

      return {
        action_status: "saved",
        state: await getStudentSessionState({
          student_user_db_id: input.student_user_db_id,
          session_public_id: input.session_public_id
        })
      };
    }
  });
}

export async function recordReasoning(input: {
  student_user_db_id: string;
  session_public_id: string;
  item_public_id: string;
  data: unknown;
}) {
  const data = reasoningActionSchema.parse(input.data);
  const context = await getActionContext(input);

  return withActionIdempotency({
    assessment_session_db_id: context.session.id,
    client_action_id: data.client_action_id,
    action_type: "reasoning",
    request_payload: data,
    run: async () => {
      await assertCurrentItemActionState({
        student_user_db_id: input.student_user_db_id,
        session_public_id: input.session_public_id,
        item_public_id: input.item_public_id,
        action: "record_reasoning"
      });
      const response = await getOrCreateItemResponse({
        concept_unit_session_db_id: context.conceptUnitSession.id,
        item: context.item
      });
      const hadReasoning = Boolean(response.reasoning_text && response.reasoning_text.trim());
      const reasoningChanged = response.reasoning_text !== null && response.reasoning_text !== data.reasoning_text;

      await prisma.itemResponse.update({
        where: { id: response.id },
        data: {
          reasoning_text: data.reasoning_text,
          skipped_reasoning: false,
          revision_count: reasoningChanged ? { increment: 1 } : undefined
        }
      });
      await prisma.assessmentSession.update({
        where: { id: context.session.id },
        data: { last_activity_at: new Date() }
      });
      await logStudentTurnAndEvent({
        session_db_id: context.session.id,
        concept_unit_session_db_id: context.conceptUnitSession.id,
        item_db_id: context.item.id,
        phase: context.session.current_phase,
        event_type: context.isTransferItem
          ? "transfer_reasoning_submitted"
          : hadReasoning
            ? "reasoning_revised"
            : "reasoning_entered",
        event_category: context.isTransferItem ? "transfer_item" : "initial_administration",
        message_text: data.reasoning_text,
        structured_payload: {
          source: context.isTransferItem ? "transfer_reasoning" : "initial_reasoning",
          item_public_id: context.item.item_public_id,
          revised: hadReasoning,
          item_context: context.isTransferItem ? "transfer" : "initial"
        }
      });
      await logProcessEvent({
        assessment_session_db_id: context.session.id,
        concept_unit_session_db_id: context.conceptUnitSession.id,
        item_db_id: context.item.id,
        event_type: "reasoning_submitted",
        event_category: context.isTransferItem ? "transfer_item" : "initial_administration",
        event_source: "frontend",
        payload: {
          item_public_id: context.item.item_public_id,
          revised: hadReasoning,
          reasoning_length: data.reasoning_text.trim().length,
          item_context: context.isTransferItem ? "transfer" : "initial"
        }
      });
      await logInitialAgentPrompt({
        session_db_id: context.session.id,
        concept_unit_session_db_id: context.conceptUnitSession.id,
        item_db_id: context.item.id,
        phase: context.session.current_phase,
        prompt_type: "request_confidence",
        message_text: "How confident are you: Low, Medium, or High?",
        structured_payload: {
          item_public_id: context.item.item_public_id,
          item_context: context.isTransferItem ? "transfer" : "initial"
        },
        event_category: context.isTransferItem ? "transfer_item" : "initial_administration",
        agent_name: context.isTransferItem ? TRANSFER_ITEM_AGENT_NAME : INITIAL_ADMIN_AGENT_NAME
      });

      return {
        action_status: "saved",
        state: await getStudentSessionState({
          student_user_db_id: input.student_user_db_id,
          session_public_id: input.session_public_id
        })
      };
    }
  });
}

export async function recordConfidence(input: {
  student_user_db_id: string;
  session_public_id: string;
  item_public_id: string;
  data: unknown;
}) {
  const data = confidenceActionSchema.parse(input.data);
  const context = await getActionContext(input);

  return withActionIdempotency({
    assessment_session_db_id: context.session.id,
    client_action_id: data.client_action_id,
    action_type: "confidence",
    request_payload: data,
    run: async () => {
      await assertCurrentItemActionState({
        student_user_db_id: input.student_user_db_id,
        session_public_id: input.session_public_id,
        item_public_id: input.item_public_id,
        action: "record_confidence"
      });
      const response = await getOrCreateItemResponse({
        concept_unit_session_db_id: context.conceptUnitSession.id,
        item: context.item
      });
      const confidenceChanged =
        response.confidence_rating !== null &&
        response.confidence_rating !== data.confidence_rating;

      await prisma.itemResponse.update({
        where: { id: response.id },
        data: {
          confidence_rating: data.confidence_rating,
          skipped_confidence: false,
          revision_count: confidenceChanged ? { increment: 1 } : undefined
        }
      });
      await prisma.assessmentSession.update({
        where: { id: context.session.id },
        data: { last_activity_at: new Date() }
      });
      await logStudentTurnAndEvent({
        session_db_id: context.session.id,
        concept_unit_session_db_id: context.conceptUnitSession.id,
        item_db_id: context.item.id,
        phase: context.session.current_phase,
        event_type: "confidence_selected",
        event_category: context.isTransferItem ? "transfer_item" : "initial_administration",
        structured_payload: {
          source: context.isTransferItem ? "transfer_confidence" : "initial_confidence",
          item_public_id: context.item.item_public_id,
          confidence_rating: data.confidence_rating,
          revised: confidenceChanged,
          item_context: context.isTransferItem ? "transfer" : "initial"
        }
      });
      if (context.isTransferItem) {
        await logProcessEvent({
          assessment_session_db_id: context.session.id,
          concept_unit_session_db_id: context.conceptUnitSession.id,
          item_db_id: context.item.id,
          event_type: "transfer_confidence_clicked",
          event_category: "transfer_item",
          event_source: "frontend",
          payload: {
            item_public_id: context.item.item_public_id,
            confidence_rating: data.confidence_rating,
            revised: confidenceChanged,
            item_context: "transfer"
          }
        });
      }
      await logProcessEvent({
        assessment_session_db_id: context.session.id,
        concept_unit_session_db_id: context.conceptUnitSession.id,
        item_db_id: context.item.id,
        event_type: "confidence_clicked",
        event_category: context.isTransferItem ? "transfer_item" : "initial_administration",
        event_source: "frontend",
        payload: {
          item_public_id: context.item.item_public_id,
          confidence_rating: data.confidence_rating,
          revised: confidenceChanged,
          item_context: context.isTransferItem ? "transfer" : "initial"
        }
      });
      await logInitialAgentPrompt({
        session_db_id: context.session.id,
        concept_unit_session_db_id: context.conceptUnitSession.id,
        item_db_id: context.item.id,
        phase: context.session.current_phase,
        prompt_type: "request_tempting_option",
        message_text:
          "Was another option tempting? If yes, which one, and what made it tempting? You can also say No.",
        structured_payload: {
          item_public_id: context.item.item_public_id,
          item_context: context.isTransferItem ? "transfer" : "initial"
        },
        event_category: context.isTransferItem ? "transfer_item" : "initial_administration",
        agent_name: context.isTransferItem ? TRANSFER_ITEM_AGENT_NAME : INITIAL_ADMIN_AGENT_NAME
      });

      return {
        action_status: "saved",
        state: await getStudentSessionState({
          student_user_db_id: input.student_user_db_id,
          session_public_id: input.session_public_id
        })
      };
    }
  });
}

export async function recordTemptingOption(input: {
  student_user_db_id: string;
  session_public_id: string;
  item_public_id: string;
  data: unknown;
}) {
  const data = temptingOptionActionSchema.parse(input.data);
  const context = await getActionContext(input);

  return withActionIdempotency({
    assessment_session_db_id: context.session.id,
    client_action_id: data.client_action_id,
    action_type: "tempting_option",
    request_payload: data,
    run: async () => {
      const state = await getStudentSessionState({
        student_user_db_id: input.student_user_db_id,
        session_public_id: input.session_public_id
      });
      const action =
        state.assessment_state === "AWAIT_TEMPTING_REASON"
          ? "record_tempting_reason"
          : "record_tempting_option";

      if (state.current_item?.item_public_id !== input.item_public_id) {
        throw new StudentAssessmentServiceError(
          "invalid_phase_for_action",
          "The requested item is not the current item for this assessment state.",
          409,
          {
            assessment_state: state.assessment_state,
            current_item_public_id: state.current_item?.item_public_id ?? null,
            requested_item_public_id: input.item_public_id
          }
        );
      }
      assertActionAllowedForState({
        assessment_state: state.assessment_state,
        action,
        item_public_id: input.item_public_id
      });

      const previousEvidence = await getLatestTemptingOptionEvidence({
        concept_unit_session_db_id: context.conceptUnitSession.id,
        item_db_id: context.item.id
      });
      const labels = optionLabels(context.item);
      const noTemptingOption = data.no_tempting_option === true;
      const temptingOption = noTemptingOption
        ? null
        : data.tempting_option?.trim() || previousEvidence?.tempting_option || null;
      const temptingOptionReason = noTemptingOption
        ? null
        : data.tempting_option_reason?.trim() || null;

      if (!noTemptingOption && !temptingOption) {
        throw new StudentAssessmentServiceError(
          "validation_failed",
          "Select the tempting option, or choose no tempting option.",
          400
        );
      }

      if (temptingOption && !labels.includes(temptingOption)) {
        throw new StudentAssessmentServiceError(
          "invalid_option",
          "Tempting option does not exist for this item.",
          400,
          { item_public_id: context.item.item_public_id }
        );
      }

      if (state.assessment_state === "AWAIT_TEMPTING_REASON" && !temptingOptionReason) {
        throw new StudentAssessmentServiceError(
          "validation_failed",
          "Explain what made the tempting option seem plausible.",
          400
        );
      }

      const now = new Date();
      const structuredPayload = {
        source: context.isTransferItem ? "transfer_tempting_option" : "initial_tempting_option",
        item_public_id: context.item.item_public_id,
        no_tempting_option: noTemptingOption,
        tempting_option: temptingOption,
        tempting_option_reason: temptingOptionReason,
        item_context: context.isTransferItem ? "transfer" : "initial"
      };
      const messageText = noTemptingOption
        ? "No other option was tempting."
        : temptingOptionReason
          ? `Option ${temptingOption} was tempting because ${temptingOptionReason}`
          : `Option ${temptingOption} was tempting.`;

      await logStudentTurnAndEvent({
        session_db_id: context.session.id,
        concept_unit_session_db_id: context.conceptUnitSession.id,
        item_db_id: context.item.id,
        phase: context.session.current_phase,
        event_type: context.isTransferItem
          ? "transfer_tempting_option_submitted"
          : "tempting_option_submitted",
        event_category: context.isTransferItem ? "transfer_item" : "initial_administration",
        message_text: messageText,
        structured_payload: structuredPayload
      });
      if (temptingOptionReason) {
        await logProcessEvent({
          assessment_session_db_id: context.session.id,
          concept_unit_session_db_id: context.conceptUnitSession.id,
          item_db_id: context.item.id,
          event_type: context.isTransferItem
            ? "transfer_tempting_option_reason_submitted"
            : "tempting_option_reason_submitted",
          event_category: context.isTransferItem ? "transfer_item" : "initial_administration",
          event_source: "frontend",
          payload: {
            item_public_id: context.item.item_public_id,
            tempting_option: temptingOption,
            tempting_option_reason_length: temptingOptionReason.length,
            item_context: context.isTransferItem ? "transfer" : "initial"
          }
        });
      }

      const itemComplete = noTemptingOption || Boolean(temptingOptionReason);
      const response = await getOrCreateItemResponse({
        concept_unit_session_db_id: context.conceptUnitSession.id,
        item: context.item
      });

      if (itemComplete) {
        await prisma.itemResponse.update({
          where: { id: response.id },
          data: {
            item_submitted_at: now,
            item_response_time_ms: response.item_started_at
              ? Math.max(0, now.getTime() - response.item_started_at.getTime())
              : undefined,
            client_submission_id: data.client_action_id ?? response.client_submission_id
          }
        });
        await logProcessEvent({
          assessment_session_db_id: context.session.id,
          concept_unit_session_db_id: context.conceptUnitSession.id,
          item_db_id: context.item.id,
          event_type: context.isTransferItem ? "transfer_item_completed" : "item_completed",
          event_category: context.isTransferItem ? "transfer_item" : "initial_administration",
          event_source: "backend",
          payload: {
            item_public_id: context.item.item_public_id,
            item_context: context.isTransferItem ? "transfer" : "initial"
          },
          occurred_at: now
        });
        await logProcessEvent({
          assessment_session_db_id: context.session.id,
          concept_unit_session_db_id: context.conceptUnitSession.id,
          item_db_id: context.item.id,
          event_type: "item_submitted",
          event_category: context.isTransferItem ? "transfer_item" : "initial_administration",
          event_source: "backend",
          payload: {
            item_public_id: context.item.item_public_id,
            item_context: context.isTransferItem ? "transfer" : "initial"
          },
          occurred_at: now
        });
      }

      await prisma.assessmentSession.update({
        where: { id: context.session.id },
        data: { last_activity_at: now }
      });

      if (context.isTransferItem && itemComplete) {
        await logConversationTurn({
          assessment_session_db_id: context.session.id,
          concept_unit_session_db_id: context.conceptUnitSession.id,
          item_db_id: context.item.id,
          phase: "followup_stopped",
          actor_type: "agent",
          agent_name: TRANSFER_ITEM_AGENT_NAME,
          message_text: TRANSFER_COMPLETION_MESSAGE,
          structured_payload: {
            source: TRANSFER_ITEM_AGENT_NAME,
            message_type: "transfer_item_completion",
            item_public_id: context.item.item_public_id
          },
          created_at: now
        });
        await prisma.conceptUnitSession.update({
          where: { id: context.conceptUnitSession.id },
          data: { status: "completed" }
        });
        await updateAssessmentSessionPhase({
          assessment_session_db_id: context.session.id,
          to_phase: "between_concept_units",
          reason: "chat_native_transfer_item_completed"
        });
        await updateAssessmentSessionPhase({
          assessment_session_db_id: context.session.id,
          to_phase: "session_completed",
          reason: "chat_native_phase7_transfer_completion"
        });
        await logProcessEvent({
          assessment_session_db_id: context.session.id,
          concept_unit_session_db_id: context.conceptUnitSession.id,
          item_db_id: context.item.id,
          event_type: "session_completed",
          event_category: "session",
          event_source: "backend",
          payload: {
            reason: "transfer_item_completed",
            item_public_id: context.item.item_public_id
          },
          occurred_at: now
        });
      }

      const nextState = await getStudentSessionState({
        student_user_db_id: input.student_user_db_id,
        session_public_id: input.session_public_id
      });

      if (!context.isTransferItem && itemComplete && nextState.current_item) {
        const nextItem = await prisma.item.findUnique({
          where: { item_public_id: nextState.current_item.item_public_id },
          select: {
            id: true,
            item_public_id: true,
            item_order: true,
            item_stem: true,
            options: true
          }
        });

        if (nextItem) {
          await logProcessEvent({
            assessment_session_db_id: context.session.id,
            concept_unit_session_db_id: context.conceptUnitSession.id,
            item_db_id: nextItem.id,
            event_type: "item_presented",
            event_category: "initial_administration",
            event_source: "backend",
            payload: { item_public_id: nextItem.item_public_id }
          });
          await logInitialAgentPrompt({
            session_db_id: context.session.id,
            concept_unit_session_db_id: context.conceptUnitSession.id,
            item_db_id: nextItem.id,
            phase: context.session.current_phase,
            prompt_type: "item_presented",
            message_text: initialItemAgentMessage(nextItem),
            structured_payload: {
              item_public_id: nextItem.item_public_id,
              item_order: nextItem.item_order
            }
          });
        }
      } else if (!itemComplete && nextState.assessment_state === "AWAIT_TEMPTING_REASON") {
        await logInitialAgentPrompt({
          session_db_id: context.session.id,
          concept_unit_session_db_id: context.conceptUnitSession.id,
          item_db_id: context.item.id,
          phase: context.session.current_phase,
          prompt_type: "request_tempting_reason",
          message_text: "What made that option seem tempting?",
          structured_payload: {
            item_public_id: context.item.item_public_id,
            tempting_option: temptingOption,
            item_context: context.isTransferItem ? "transfer" : "initial"
          },
          event_category: context.isTransferItem ? "transfer_item" : "initial_administration",
          agent_name: context.isTransferItem ? TRANSFER_ITEM_AGENT_NAME : INITIAL_ADMIN_AGENT_NAME
        });
      } else if (!context.isTransferItem && itemComplete && nextState.assessment_state === "PACKAGE_REVIEW") {
        await logProcessEvent({
          assessment_session_db_id: context.session.id,
          concept_unit_session_db_id: context.conceptUnitSession.id,
          event_type: "package_review_opened",
          event_category: "initial_administration",
          event_source: "backend",
          payload: {
            concept_unit_public_id: nextState.current_concept_unit?.concept_unit_public_id ?? null
          }
        });
        await logInitialAgentPrompt({
          session_db_id: context.session.id,
          concept_unit_session_db_id: context.conceptUnitSession.id,
          phase: context.session.current_phase,
          prompt_type: "package_review",
          message_text: PACKAGE_REVIEW_MESSAGE,
          structured_payload: {
            concept_unit_public_id: nextState.current_concept_unit?.concept_unit_public_id ?? null
          }
        });
      }

      const result = {
        action_status: itemComplete ? "item_completed" : "tempting_option_saved",
        state: nextState
      };
      assertStudentPayloadIsSafe(result);
      return result;
    }
  });
}

export async function updatePackageReviewItemResponse(input: {
  student_user_db_id: string;
  session_public_id: string;
  item_public_id: string;
  data: unknown;
}) {
  const data = packageReviewEditActionSchema.parse(input.data);
  const context = await getActionContext(input);

  return withActionIdempotency({
    assessment_session_db_id: context.session.id,
    client_action_id: data.client_action_id,
    action_type: "package_review_edit",
    request_payload: data,
    run: async () => {
      const state = await getStudentSessionState({
        student_user_db_id: input.student_user_db_id,
        session_public_id: input.session_public_id
      });

      if (state.assessment_state !== "PACKAGE_REVIEW") {
        throw new StudentAssessmentServiceError(
          "invalid_phase_for_action",
          "Responses can be edited only during package review.",
          409,
          { assessment_state: state.assessment_state }
        );
      }

      if (context.isTransferItem || !context.item.included_in_published_set) {
        throw new StudentAssessmentServiceError(
          "item_not_included_in_published_set",
          "Only initial package responses can be edited here.",
          409
        );
      }

      const labels = optionLabels(context.item);
      const noTemptingOption = data.no_tempting_option === true;
      const temptingOption = noTemptingOption ? null : data.tempting_option?.trim() || null;
      const temptingOptionReason = noTemptingOption
        ? null
        : data.tempting_option_reason?.trim() || null;

      if (!labels.includes(data.selected_option)) {
        throw new StudentAssessmentServiceError(
          "invalid_option",
          "Selected option does not exist for this item.",
          400,
          { item_public_id: context.item.item_public_id }
        );
      }

      if (!noTemptingOption && !temptingOption) {
        throw new StudentAssessmentServiceError(
          "validation_failed",
          "Select the tempting option, or choose no tempting option.",
          400
        );
      }

      if (temptingOption && !labels.includes(temptingOption)) {
        throw new StudentAssessmentServiceError(
          "invalid_option",
          "Tempting option does not exist for this item.",
          400,
          { item_public_id: context.item.item_public_id }
        );
      }

      if (!noTemptingOption && !temptingOptionReason) {
        throw new StudentAssessmentServiceError(
          "validation_failed",
          "Explain what made the tempting option seem plausible.",
          400
        );
      }

      const response = await prisma.itemResponse.findUnique({
        where: {
          concept_unit_session_db_id_item_db_id: {
            concept_unit_session_db_id: context.conceptUnitSession.id,
            item_db_id: context.item.id
          }
        }
      });

      if (!response?.item_submitted_at) {
        throw new StudentAssessmentServiceError(
          "invalid_phase_for_action",
          "Only completed initial responses can be edited during package review.",
          409
        );
      }

      const previousTemptingEvidence = await getLatestTemptingOptionEvidence({
        concept_unit_session_db_id: context.conceptUnitSession.id,
        item_db_id: context.item.id
      });
      const changedFields: string[] = [];
      const reasoningText = data.reasoning_text.trim();

      if (response.selected_option !== data.selected_option) {
        changedFields.push("answer");
      }

      if ((response.reasoning_text ?? "") !== reasoningText) {
        changedFields.push("reasoning");
      }

      if (response.confidence_rating !== data.confidence_rating) {
        changedFields.push("confidence");
      }

      if (
        (previousTemptingEvidence?.no_tempting_option ?? false) !== noTemptingOption ||
        (previousTemptingEvidence?.tempting_option ?? null) !== temptingOption ||
        (previousTemptingEvidence?.tempting_option_reason ?? null) !== temptingOptionReason
      ) {
        changedFields.push("tempting_option");
      }

      const now = new Date();
      const structuredPayload = {
        source: "package_review_tempting_option",
        item_public_id: context.item.item_public_id,
        selected_option: data.selected_option,
        reasoning_length: reasoningText.length,
        confidence_rating: data.confidence_rating,
        no_tempting_option: noTemptingOption,
        tempting_option: temptingOption,
        tempting_option_reason: temptingOptionReason,
        changed_fields: changedFields
      };

      await prisma.itemResponse.update({
        where: { id: response.id },
        data: {
          selected_option: data.selected_option,
          correctness: correctnessFor(data.selected_option, response.correct_option_snapshot),
          reasoning_text: reasoningText,
          confidence_rating: data.confidence_rating,
          skipped_item: false,
          skipped_reasoning: false,
          skipped_confidence: false,
          revision_count: changedFields.length > 0 ? { increment: 1 } : undefined,
          client_submission_id: data.client_action_id ?? response.client_submission_id
        }
      });
      await prisma.assessmentSession.update({
        where: { id: context.session.id },
        data: { last_activity_at: now }
      });
      await logConversationTurn({
        assessment_session_db_id: context.session.id,
        concept_unit_session_db_id: context.conceptUnitSession.id,
        item_db_id: context.item.id,
        phase: context.session.current_phase,
        actor_type: "student",
        message_text: `Edited Question ${context.item.item_order} response.`,
        structured_payload: structuredPayload,
        created_at: now
      });

      if (changedFields.includes("answer")) {
        await logProcessEvent({
          assessment_session_db_id: context.session.id,
          concept_unit_session_db_id: context.conceptUnitSession.id,
          item_db_id: context.item.id,
          event_type: "answer_changed",
          event_category: "package_review",
          event_source: "frontend",
          payload: {
            item_public_id: context.item.item_public_id,
            selected_option: data.selected_option
          },
          occurred_at: now
        });
      }

      if (changedFields.includes("reasoning")) {
        await logProcessEvent({
          assessment_session_db_id: context.session.id,
          concept_unit_session_db_id: context.conceptUnitSession.id,
          item_db_id: context.item.id,
          event_type: "reasoning_revised",
          event_category: "package_review",
          event_source: "frontend",
          payload: {
            item_public_id: context.item.item_public_id,
            reasoning_length: reasoningText.length
          },
          occurred_at: now
        });
      }

      if (changedFields.includes("confidence")) {
        await logProcessEvent({
          assessment_session_db_id: context.session.id,
          concept_unit_session_db_id: context.conceptUnitSession.id,
          item_db_id: context.item.id,
          event_type: "confidence_clicked",
          event_category: "package_review",
          event_source: "frontend",
          payload: {
            item_public_id: context.item.item_public_id,
            confidence_rating: data.confidence_rating
          },
          occurred_at: now
        });
      }

      if (changedFields.includes("tempting_option")) {
        await logProcessEvent({
          assessment_session_db_id: context.session.id,
          concept_unit_session_db_id: context.conceptUnitSession.id,
          item_db_id: context.item.id,
          event_type: "tempting_option_submitted",
          event_category: "package_review",
          event_source: "frontend",
          payload: {
            item_public_id: context.item.item_public_id,
            no_tempting_option: noTemptingOption,
            tempting_option: temptingOption
          },
          occurred_at: now
        });

        if (temptingOptionReason) {
          await logProcessEvent({
            assessment_session_db_id: context.session.id,
            concept_unit_session_db_id: context.conceptUnitSession.id,
            item_db_id: context.item.id,
            event_type: "tempting_option_reason_submitted",
            event_category: "package_review",
            event_source: "frontend",
            payload: {
              item_public_id: context.item.item_public_id,
              tempting_option: temptingOption,
              tempting_option_reason_length: temptingOptionReason.length
            },
            occurred_at: now
          });
        }
      }

      const nextState = await getStudentSessionState({
        student_user_db_id: input.student_user_db_id,
        session_public_id: input.session_public_id
      });
      const result = {
        edit_status: changedFields.length > 0 ? "updated" : "unchanged",
        changed_fields: changedFields,
        state: nextState
      };

      assertStudentPayloadIsSafe(result);
      return result;
    }
  });
}

export async function submitItemResponse(input: {
  student_user_db_id: string;
  session_public_id: string;
  item_public_id: string;
  data: unknown;
}) {
  const data = submitActionSchema.parse(input.data);
  const context = await getActionContext(input);

  return withActionIdempotency({
    assessment_session_db_id: context.session.id,
    client_action_id: data.client_action_id,
    action_type: "submit",
    request_payload: data,
    run: async () => {
      await assertCurrentItemActionState({
        student_user_db_id: input.student_user_db_id,
        session_public_id: input.session_public_id,
        item_public_id: input.item_public_id,
        action: "complete_item"
      });
      const response = await getOrCreateItemResponse({
        concept_unit_session_db_id: context.conceptUnitSession.id,
        item: context.item
      });
      const skipItem = data.skip_item;
      const tentative = {
        ...response,
        skipped_item: skipItem || response.skipped_item,
        skipped_reasoning: data.skip_reasoning || skipItem || response.skipped_reasoning,
        skipped_confidence: data.skip_confidence || skipItem || response.skipped_confidence,
        selected_option: skipItem ? null : response.selected_option,
        reasoning_text: response.reasoning_text,
        confidence_rating: response.confidence_rating
      };
      const missingFields = responseMissingFields(tentative);
      const hasExplicitSkip = data.skip_item || data.skip_reasoning || data.skip_confidence;

      if (missingFields.length > 0 && !data.confirm_skip && hasExplicitSkip && !skipItem) {
        await prisma.itemResponse.update({
          where: { id: response.id },
          data: {
            skipped_reasoning: tentative.skipped_reasoning,
            skipped_confidence: tentative.skipped_confidence,
            skipped_item: false
          }
        });
        await prisma.assessmentSession.update({
          where: { id: context.session.id },
          data: { last_activity_at: new Date() }
        });
        await logProcessEvent({
          assessment_session_db_id: context.session.id,
          concept_unit_session_db_id: context.conceptUnitSession.id,
          item_db_id: context.item.id,
          event_type: "missing_evidence_skipped",
          event_category: "initial_administration",
          event_source: "backend",
          payload: {
            item_public_id: context.item.item_public_id,
            skipped_reasoning: data.skip_reasoning,
            skipped_confidence: data.skip_confidence,
            remaining_missing_fields: missingFields
          }
        });

        const result = {
          submission_status: "skip_saved",
          missing_fields: missingFields,
          state: await getStudentSessionState({
            student_user_db_id: input.student_user_db_id,
            session_public_id: input.session_public_id
          })
        };
        assertStudentPayloadIsSafe(result);
        return result;
      }

      if (missingFields.length > 0 && !data.confirm_skip && !hasExplicitSkip) {
        await prisma.itemResponse.update({
          where: { id: response.id },
          data: { missing_evidence_repair_offered: true }
        });
        await updateAssessmentSessionPhase({
          assessment_session_db_id: context.session.id,
          to_phase: "missing_evidence_repair",
          payload: {
            item_public_id: context.item.item_public_id,
            missing_fields: missingFields
          }
        });
        await logProcessEvent({
          assessment_session_db_id: context.session.id,
          concept_unit_session_db_id: context.conceptUnitSession.id,
          item_db_id: context.item.id,
          event_type: "missing_evidence_detected",
          event_category: "initial_administration",
          event_source: "backend",
          payload: { item_public_id: context.item.item_public_id, missing_fields: missingFields }
        });
        await logProcessEvent({
          assessment_session_db_id: context.session.id,
          concept_unit_session_db_id: context.conceptUnitSession.id,
          item_db_id: context.item.id,
          event_type: "missing_evidence_repair_prompted",
          event_category: "initial_administration",
          event_source: "backend",
          payload: { item_public_id: context.item.item_public_id, missing_fields: missingFields }
        });

        const result = {
          submission_status: "missing_evidence_repair_required",
          missing_fields: missingFields,
          state: await getStudentSessionState({
            student_user_db_id: input.student_user_db_id,
            session_public_id: input.session_public_id
          })
        };
        assertStudentPayloadIsSafe(result);
        return result;
      }

      const finalSkippedItem = skipItem || (missingFields.includes("answer") && data.confirm_skip);
      const finalSkippedReasoning =
        finalSkippedItem || data.skip_reasoning || (missingFields.includes("reasoning") && data.confirm_skip);
      const finalSkippedConfidence =
        finalSkippedItem || data.skip_confidence || (missingFields.includes("confidence") && data.confirm_skip);
      const selectedOption = finalSkippedItem ? null : response.selected_option;
      const now = new Date();

      await prisma.itemResponse.update({
        where: { id: response.id },
        data: {
          selected_option: selectedOption,
          correctness: correctnessFor(selectedOption, response.correct_option_snapshot),
          skipped_item: finalSkippedItem,
          skipped_reasoning: finalSkippedReasoning,
          skipped_confidence: finalSkippedConfidence,
          item_submitted_at: now,
          item_response_time_ms: response.item_started_at
            ? Math.max(0, now.getTime() - response.item_started_at.getTime())
            : undefined,
          client_submission_id: data.client_action_id ?? response.client_submission_id
        }
      });
      await prisma.assessmentSession.update({
        where: { id: context.session.id },
        data: { last_activity_at: now }
      });

      if (missingFields.length > 0 || hasExplicitSkip) {
        await logProcessEvent({
          assessment_session_db_id: context.session.id,
          concept_unit_session_db_id: context.conceptUnitSession.id,
          item_db_id: context.item.id,
          event_type: "missing_evidence_skipped",
          event_category: "initial_administration",
          event_source: "backend",
          payload: {
            item_public_id: context.item.item_public_id,
            missing_fields: missingFields,
            skipped_item: finalSkippedItem,
            skipped_reasoning: finalSkippedReasoning,
            skipped_confidence: finalSkippedConfidence
          },
          occurred_at: now
        });
      }

      if (context.session.current_phase === "missing_evidence_repair") {
        await updateAssessmentSessionPhase({
          assessment_session_db_id: context.session.id,
          to_phase: "initial_item_administration"
        });
      }

      await logProcessEvent({
        assessment_session_db_id: context.session.id,
        concept_unit_session_db_id: context.conceptUnitSession.id,
        item_db_id: context.item.id,
        event_type: "item_submitted",
        event_category: "initial_administration",
        event_source: "backend",
        payload: { item_public_id: context.item.item_public_id },
        occurred_at: now
      });

      const state = await getStudentSessionState({
        student_user_db_id: input.student_user_db_id,
        session_public_id: input.session_public_id
      });

      if (state.current_item) {
        const nextItem = await prisma.item.findUnique({
          where: { item_public_id: state.current_item.item_public_id },
          select: { id: true, item_public_id: true }
        });

        if (nextItem) {
          await logProcessEvent({
            assessment_session_db_id: context.session.id,
            concept_unit_session_db_id: context.conceptUnitSession.id,
            item_db_id: nextItem.id,
            event_type: "item_presented",
            event_category: "initial_administration",
            event_source: "backend",
            payload: { item_public_id: nextItem.item_public_id }
          });
        }
      }

      const result = {
        submission_status: "submitted",
        state
      };
      assertStudentPayloadIsSafe(result);
      return result;
    }
  });
}

export async function completeInitialConceptUnitAdministration(input: {
  student_user_db_id: string;
  session_public_id: string;
  concept_unit_public_id: string;
}) {
  const owned = await getOwnedSession(input);
  const session = await prisma.assessmentSession.findUniqueOrThrow({
    where: { id: owned.id },
    include: { current_concept_unit: true }
  });

  if (!session.current_concept_unit) {
    throw publicConflict("No current concept unit is set for this session.");
  }

  if (session.current_concept_unit.concept_unit_public_id !== input.concept_unit_public_id) {
    throw new StudentAssessmentServiceError(
      "concept_unit_not_current",
      "The requested concept unit is not the current concept unit.",
      409
    );
  }

  const conceptUnitSession = await prisma.conceptUnitSession.findUnique({
    where: {
      assessment_session_db_id_concept_unit_db_id: {
        assessment_session_db_id: session.id,
        concept_unit_db_id: session.current_concept_unit.id
      }
    }
  });

  if (!conceptUnitSession) {
    throw new StudentAssessmentServiceError(
      "concept_unit_not_current",
      "Current concept-unit session was not found.",
      409
    );
  }

  if (session.current_phase === "profiling_pending" || conceptUnitSession.initial_completed_at) {
    const existingPackage = await prisma.responsePackage.findFirst({
      where: {
        concept_unit_session_db_id: conceptUnitSession.id,
        package_type: "initial_concept_unit_response_package"
      },
      select: { id: true }
    });

    if (!existingPackage) {
      await createResponsePackage({ concept_unit_session_db_id: conceptUnitSession.id });
    }
    await ensureChatNativeFormativeActivity({
      concept_unit_session_db_id: conceptUnitSession.id,
      invocation_reason: "student_package_review_continue_replay"
    });

    return {
      completion_status: "already_completed",
      state: await getStudentSessionState(input)
    };
  }

  const items = await prisma.item.findMany({
    where: {
      concept_unit_db_id: session.current_concept_unit.id,
      status: "published",
      included_in_published_set: true
    },
    orderBy: [{ item_order: "asc" }, { created_at: "asc" }]
  });
  const responses = await prisma.itemResponse.findMany({
    where: {
      concept_unit_session_db_id: conceptUnitSession.id,
      item_db_id: { in: items.map((item) => item.id) }
    },
    select: { item_db_id: true, item_submitted_at: true }
  });
  const submittedIds = new Set(
    responses.filter((response) => response.item_submitted_at).map((response) => response.item_db_id)
  );
  const incomplete = items
    .filter((item) => !submittedIds.has(item.id))
    .map((item) => item.item_public_id);

  if (incomplete.length > 0) {
    throw new StudentAssessmentServiceError(
      "missing_evidence_confirmation_required",
      "Every included item needs a submitted response or explicit skip before concept-unit completion.",
      409,
      { incomplete_item_public_ids: incomplete }
    );
  }

  const currentState = await getStudentSessionState(input);
  assertActionAllowedForState({
    assessment_state: currentState.assessment_state,
    action: "submit_package"
  });

  const now = new Date();
  await prisma.conceptUnitSession.update({
    where: { id: conceptUnitSession.id },
    data: {
      status: "initial_completed",
      initial_completed_at: now
    }
  });

  if (session.current_phase === "missing_evidence_repair") {
    await updateAssessmentSessionPhase({
      assessment_session_db_id: session.id,
      to_phase: "initial_item_administration"
    });
  }

  await updateAssessmentSessionPhase({
    assessment_session_db_id: session.id,
    to_phase: "initial_concept_unit_completed"
  });
  await logProcessEvent({
    assessment_session_db_id: session.id,
    concept_unit_session_db_id: conceptUnitSession.id,
    event_type: "package_submitted",
    event_category: "initial_administration",
    event_source: "backend",
    payload: {
      concept_unit_public_id: session.current_concept_unit.concept_unit_public_id
    },
    occurred_at: now
  });
  await updateAssessmentSessionPhase({
    assessment_session_db_id: session.id,
    to_phase: "profiling_pending"
  });

  const existingPackage = await prisma.responsePackage.findFirst({
    where: {
      concept_unit_session_db_id: conceptUnitSession.id,
      package_type: "initial_concept_unit_response_package"
    },
    select: { id: true }
  });

  if (!existingPackage) {
    await createResponsePackage({ concept_unit_session_db_id: conceptUnitSession.id });
  }
  await ensureChatNativeFormativeActivity({
    concept_unit_session_db_id: conceptUnitSession.id,
    invocation_reason: "student_package_review_continue"
  });

  return {
    completion_status: "completed",
    next_step: "formative_activity",
    state: await getStudentSessionState(input)
  };
}

export async function submitFormativeActivityResponse(input: {
  student_user_db_id: string;
  session_public_id: string;
  message: string;
  client_message_id: string;
}) {
  const result = await submitChatNativeFormativeActivityResponse(input) as {
    message_status: string;
    targeted_feedback_available: boolean;
  };
  const state = await getStudentSessionState({
    student_user_db_id: input.student_user_db_id,
    session_public_id: input.session_public_id
  });

  const response = {
    ...result,
    state
  };

  assertStudentPayloadIsSafe(response);
  return response;
}

export async function submitRevisionResponse(input: {
  student_user_db_id: string;
  session_public_id: string;
  message: string;
  client_message_id: string;
}) {
  const result = await submitChatNativeRevisionResponse(input) as {
    revision_status: string;
    next_choice_available: boolean;
  };
  const state = await getStudentSessionState({
    student_user_db_id: input.student_user_db_id,
    session_public_id: input.session_public_id
  });
  const response = {
    ...result,
    state
  };

  assertStudentPayloadIsSafe(response);
  return response;
}

export async function submitNextChoice(input: {
  student_user_db_id: string;
  session_public_id: string;
  choice: "move_next" | "try_another";
  client_action_id: string;
}) {
  const result = await submitChatNativeNextChoice(input) as {
    choice_status: string;
    message?: string;
  };
  const state = await getStudentSessionState({
    student_user_db_id: input.student_user_db_id,
    session_public_id: input.session_public_id
  });
  const response = {
    ...result,
    state
  };

  assertStudentPayloadIsSafe(response);
  return response;
}

export async function ingestFrontendProcessEvents(input: {
  student_user_db_id: string;
  session_public_id: string;
  data: unknown;
}) {
  const validation = frontendEventsInputSchema.safeParse(input.data);

  if (!validation.success) {
    throw new StudentAssessmentServiceError(
      "validation_failed",
      "Frontend process event validation failed.",
      400,
      { issues: validation.error.issues }
    );
  }

  const parsed = validation.data;
  const events = "events" in parsed ? parsed.events : [parsed];
  const owned = await getOwnedSession(input);
  const session = await prisma.assessmentSession.findUniqueOrThrow({
    where: { id: owned.id },
    select: {
      id: true,
      assessment_db_id: true,
      current_concept_unit_db_id: true
    }
  });
  const currentConceptUnitSession = session.current_concept_unit_db_id
    ? await prisma.conceptUnitSession.findUnique({
        where: {
          assessment_session_db_id_concept_unit_db_id: {
            assessment_session_db_id: session.id,
            concept_unit_db_id: session.current_concept_unit_db_id
          }
        },
        select: { id: true }
      })
    : null;
  const created = [];

  for (const event of events) {
    const payload = {
      ...(event.payload ?? {}),
      client_occurred_at: event.client_occurred_at?.toISOString()
    };
    const payloadBytes = Buffer.byteLength(JSON.stringify(payload), "utf8");

    if (payloadBytes > MAX_EVENT_PAYLOAD_BYTES) {
      throw new StudentAssessmentServiceError(
        "validation_failed",
        "Process event payload is too large.",
        400
      );
    }

    let itemDbId: string | undefined;

    if (event.item_public_id && session.current_concept_unit_db_id) {
      const item = await prisma.item.findFirst({
        where: {
          item_public_id: event.item_public_id,
          concept_unit_db_id: session.current_concept_unit_db_id
        },
        select: { id: true }
      });
      itemDbId = item?.id;
    }

    created.push(
      await logProcessEvent({
        assessment_session_db_id: session.id,
        concept_unit_session_db_id: currentConceptUnitSession?.id,
        item_db_id: itemDbId,
        event_type: event.event_type,
        event_category: event.event_category,
        event_source: "frontend",
        visibility_duration_ms: event.visibility_duration_ms,
        pause_duration_ms: event.pause_duration_ms,
        payload,
        occurred_at: new Date()
      })
    );
  }

  return {
    accepted_event_count: created.length
  };
}

export async function exitStudentAssessmentSession(input: {
  student_user_db_id: string;
  session_public_id: string;
}) {
  const owned = await getOwnedSession(input);
  const stateBeforeExit = await getStudentSessionState(input);
  const session = await prisma.assessmentSession.findUniqueOrThrow({
    where: { id: owned.id },
    select: {
      id: true,
      current_phase: true,
      current_concept_unit_db_id: true,
      status: true
    }
  });

  if (session.status === "completed") {
    throw new StudentAssessmentServiceError(
      "assessment_already_completed",
      "Completed sessions cannot be exited for resume.",
      409
    );
  }

  await prisma.assessmentSession.update({
    where: { id: session.id },
    data: {
      resume_phase: session.current_phase,
      resume_context: toPrismaJson({
        next_step: stateBeforeExit.next_step,
        current_concept_unit_public_id:
          stateBeforeExit.current_concept_unit?.concept_unit_public_id ?? null,
        current_item_public_id: stateBeforeExit.current_item?.item_public_id ?? null
      })
    }
  });
  await markSessionExited({
    assessment_session_db_id: session.id,
    reason: "student_requested_exit"
  });

  return {
    exit_status: "student_exited",
    can_resume: true
  };
}

export async function getStudentReviewResponses(input: {
  student_user_db_id: string;
  session_public_id: string;
}) {
  const owned = await getOwnedSession(input);
  const session = await prisma.assessmentSession.findUniqueOrThrow({
    where: { id: owned.id },
    include: {
      current_concept_unit: true
    }
  });

  if (!session.current_concept_unit) {
    throw publicConflict("No current concept unit is set for this session.");
  }

  const conceptUnitSession = await prisma.conceptUnitSession.findUnique({
    where: {
      assessment_session_db_id_concept_unit_db_id: {
        assessment_session_db_id: session.id,
        concept_unit_db_id: session.current_concept_unit.id
      }
    },
    include: {
      item_responses: true
    }
  });

  const items = await prisma.item.findMany({
    where: {
      concept_unit_db_id: session.current_concept_unit.id,
      status: "published",
      included_in_published_set: true
    },
    orderBy: [{ item_order: "asc" }, { created_at: "asc" }]
  });
  const responsesByItemId = new Map(
    (conceptUnitSession?.item_responses ?? []).map((response) => [response.item_db_id, response])
  );
  const locked =
    Boolean(conceptUnitSession?.initial_completed_at) ||
    session.current_phase === "initial_concept_unit_completed" ||
    session.current_phase === "profiling_pending" ||
    session.current_phase === "profiling_completed" ||
    session.current_phase === "planning_pending" ||
    session.current_phase === "planning_completed" ||
    session.current_phase === "followup_active" ||
    session.current_phase === "followup_profile_update_pending" ||
    session.current_phase === "followup_planning_update_pending" ||
    session.current_phase === "followup_stopped" ||
    session.current_phase === "session_completed";
  const currentState = await getStudentSessionState(input);
  const reviewItems = await Promise.all(
    items.map(async (item) => {
      const response = responsesByItemId.get(item.id) ?? null;
      const temptingOptionEvidence = conceptUnitSession
        ? await getLatestTemptingOptionEvidence({
            concept_unit_session_db_id: conceptUnitSession.id,
            item_db_id: item.id
          })
        : null;

      return {
        ...serializeStudentSafeItem(item, response),
        missing_fields: responseMissingFields(response),
        can_edit: !locked,
        is_current: currentState.current_item?.item_public_id === item.item_public_id,
        no_tempting_option: temptingOptionEvidence?.no_tempting_option ?? false,
        tempting_option: temptingOptionEvidence?.tempting_option ?? null,
        tempting_option_reason: temptingOptionEvidence?.tempting_option_reason ?? null
      };
    })
  );
  const result = {
    session_public_id: session.session_public_id,
    locked,
    current_concept_unit: serializeStudentConceptUnit(session.current_concept_unit),
    items: reviewItems
  };

  assertStudentPayloadIsSafe(result);
  return result;
}

function studentTranscriptMessage(input: {
  actor_type?: string;
  message_text: string | null;
  structured_payload: unknown;
}) {
  if (input.message_text) {
    return input.message_text;
  }

  if (!input.structured_payload || typeof input.structured_payload !== "object") {
    return "Response saved.";
  }

  const payload = input.structured_payload as Record<string, unknown>;

  if (typeof payload.selected_option === "string") {
    return `Selected option ${payload.selected_option}.`;
  }

  if (typeof payload.confidence_rating === "string") {
    return `Selected ${payload.confidence_rating} confidence.`;
  }

  return "Response saved.";
}

function studentTranscriptInteractionType(input: {
  actor_type?: string;
  phase?: string;
  message_text: string | null;
  structured_payload: unknown;
}) {
  if (input.phase === "planning_completed") {
    return input.actor_type === "agent" ? "formative_activity" : "formative_activity_response";
  }

  const source = conversationPayloadSource(input.structured_payload);
  const messageType = conversationPayloadMessageType(input.structured_payload);

  if (input.phase === "followup_active" && source === "chat_native_targeted_feedback") {
    return conversationPromptRequiresStudentResponse(input.structured_payload)
      ? "revision_prompt"
      : "targeted_feedback";
  }

  if (input.phase === "followup_active" && source === "chat_native_revision") {
    return "revision_response";
  }

  if (source === TRANSFER_ITEM_AGENT_NAME) {
    return messageType === "transfer_item_completion"
      ? "transfer_item_completed"
      : "transfer_item";
  }

  if (source === "transfer_answer") {
    return "transfer_option_selected";
  }

  if (source === "transfer_reasoning") {
    return "transfer_reasoning";
  }

  if (source === "transfer_confidence") {
    return "transfer_confidence_selected";
  }

  if (source === "transfer_tempting_option") {
    return "transfer_tempting_option";
  }

  if (input.phase === "followup_stopped" && source === "chat_native_next_choice") {
    return input.actor_type === "agent" ? "next_choice_placeholder" : "next_choice_selected";
  }

  if (input.phase === "followup_active" || input.phase === "followup_stopped") {
    return input.actor_type === "agent" ? "followup_assistant" : "followup_student";
  }

  if (input.actor_type && input.actor_type !== "student") {
    return "agent_message";
  }

  if (input.message_text) {
    return "reasoning";
  }

  if (!input.structured_payload || typeof input.structured_payload !== "object") {
    return "status";
  }

  const payload = input.structured_payload as Record<string, unknown>;

  if (typeof payload.selected_option === "string") {
    return "option_selected";
  }

  if (typeof payload.confidence_rating === "string") {
    return "confidence_selected";
  }

  return "status";
}

export async function getStudentSafeTranscript(input: {
  student_user_db_id: string;
  session_public_id: string;
}) {
  const owned = await getOwnedSession(input);
  const turns = await prisma.conversationTurn.findMany({
    where: {
      assessment_session_db_id: owned.id,
      OR: [
        { actor_type: "student" },
        {
          actor_type: "agent",
          phase: {
            in: ["followup_active", "followup_stopped"]
          }
        },
        { agent_name: "response_collection_agent" },
        { agent_name: "deterministic_response_collection_fallback" },
        { agent_name: INITIAL_ADMIN_AGENT_NAME },
        { agent_name: "chat_native_formative_activity" },
        {
          actor_type: "student",
          phase: "planning_completed"
        }
      ]
    },
    orderBy: [{ created_at: "asc" }],
    select: {
      actor_type: true,
      phase: true,
      message_text: true,
      structured_payload: true,
      created_at: true,
      item: {
        select: {
          item_public_id: true
        }
      },
      followup_round: {
        select: {
          round_index: true
        }
      }
    }
  });
  const result = {
    session_public_id: input.session_public_id,
    transcript: turns.map((turn) => ({
      actor: turn.actor_type === "student" ? "student" : "assistant",
      message_text: studentTranscriptMessage(turn),
      created_at: turn.created_at.toISOString(),
      interaction_type: studentTranscriptInteractionType(turn),
      phase: turn.phase,
      followup_round_index: turn.followup_round?.round_index ?? null,
      item_public_id: turn.item?.item_public_id ?? null
    }))
  };

  assertStudentPayloadIsSafe(result);
  return result;
}
