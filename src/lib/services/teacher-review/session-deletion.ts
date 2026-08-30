import { createHash, randomUUID } from "node:crypto";
import { Prisma, type SessionStatus } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { generatePublicId } from "@/lib/services/ids";
import { toPrismaJson } from "@/lib/services/json";
import { TeacherReviewServiceError } from "./errors";

const MAX_BATCH_SESSION_DELETION = 100;
const DELETABLE_SESSION_STATUSES = new Set<SessionStatus>([
  "completed",
  "student_exited"
]);

const sessionSelectionSchema = z.object({
  session_public_ids: z.array(z.string().trim().min(1)).min(1).max(MAX_BATCH_SESSION_DELETION)
}).strict();

const sessionDeletionConfirmationSchema = sessionSelectionSchema.extend({
  selection_fingerprint: z.string().length(64),
  delete_confirmation: z.string()
}).strict();

type SessionDeletionClient = typeof prisma | Prisma.TransactionClient;

type SessionForDeletion = {
  id: string;
  session_public_id: string;
  status: SessionStatus;
  current_phase: string;
  updated_at: Date;
  user: {
    user_id: string;
    display_name: string | null;
  };
  assessment: {
    assessment_public_id: string;
    title: string;
  };
};

export type SessionBatchDeletionCounts = {
  assessment_session_count: number;
  concept_unit_session_count: number;
  item_response_count: number;
  conversation_turn_count: number;
  process_event_count: number;
  response_package_count: number;
  student_profile_count: number;
  formative_decision_count: number;
  followup_round_count: number;
  formative_conversation_session_count: number;
  activity_runtime_count: number;
  agent_call_count: number;
};

export type SessionBatchDeletionPreview = {
  selected_session_count: number;
  sessions: Array<{
    session_public_id: string;
    student_user_id: string;
    student_display_name: string | null;
    assessment_public_id: string;
    assessment_title: string;
    status: SessionStatus;
    current_phase: string;
  }>;
  selection_fingerprint: string;
  required_delete_confirmation: string;
  counts: SessionBatchDeletionCounts;
  warning: string;
  deletion_limitations: string[];
};

export type SessionBatchDeletionSummary = SessionBatchDeletionPreview & {
  batch_operation_public_id: string;
  deletion_audit_operation_public_ids: string[];
  deleted_at: string;
  deleted_counts: SessionBatchDeletionCounts;
};

type SessionDeletionGraph = {
  sessions: SessionForDeletion[];
  sessionIds: string[];
  sessionPublicIds: string[];
  conceptUnitSessionIds: string[];
  followupRoundIds: string[];
  formativeConversationSessionIds: string[];
  formativeConversationPublicIds: string[];
  activityAttemptIds: string[];
  activityAttemptPublicIds: string[];
  activityEvidenceIds: string[];
  agentCallIds: string[];
  counts: SessionBatchDeletionCounts;
};

function unique(values: Array<string | null | undefined>) {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function safeIn(values: string[]) {
  return values.length > 0
    ? { in: values }
    : { in: ["00000000-0000-0000-0000-000000000000"] };
}

function publicHash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function normalizedSessionIds(value: z.infer<typeof sessionSelectionSchema>) {
  const ids = [...new Set(value.session_public_ids)];
  if (ids.length !== value.session_public_ids.length) {
    throw new TeacherReviewServiceError(
      "duplicate_session_selection",
      "Each student session may be selected only once.",
      400
    );
  }
  return ids;
}

function requiredConfirmation(count: number) {
  return `DELETE ${count} STUDENT ${count === 1 ? "SESSION" : "SESSIONS"}`;
}

function selectionFingerprint(sessions: SessionForDeletion[]) {
  return createHash("sha256")
    .update(JSON.stringify(
      [...sessions]
        .sort((left, right) => left.session_public_id.localeCompare(right.session_public_id))
        .map((session) => ({
          session_public_id: session.session_public_id,
          status: session.status,
          current_phase: session.current_phase,
          updated_at: session.updated_at.toISOString()
        }))
    ))
    .digest("hex");
}

async function assertTeacherResearcher(
  client: SessionDeletionClient,
  teacherUserDbId: string
) {
  const teacher = await client.user.findUnique({
    where: { id: teacherUserDbId },
    select: { role: true }
  });
  if (!teacher || teacher.role !== "teacher_researcher") {
    throw new TeacherReviewServiceError(
      "forbidden",
      "Only teacher_researcher users can delete student sessions.",
      403
    );
  }
}

async function findSessionsForDeletion(
  client: SessionDeletionClient,
  input: { teacher_user_db_id: string; session_public_ids: string[] }
) {
  const sessions = await client.assessmentSession.findMany({
    where: {
      session_public_id: { in: input.session_public_ids },
      assessment: { created_by_user_db_id: input.teacher_user_db_id }
    },
    select: {
      id: true,
      session_public_id: true,
      status: true,
      current_phase: true,
      updated_at: true,
      user: { select: { user_id: true, display_name: true } },
      assessment: { select: { assessment_public_id: true, title: true } }
    }
  });
  if (sessions.length !== input.session_public_ids.length) {
    const found = new Set(sessions.map((session) => session.session_public_id));
    throw new TeacherReviewServiceError(
      "session_selection_not_found",
      "One or more selected sessions were not found or are not owned by this teacher.",
      404,
      {
        missing_session_public_ids: input.session_public_ids.filter((id) => !found.has(id))
      }
    );
  }

  const blocked = sessions.filter((session) => !DELETABLE_SESSION_STATUSES.has(session.status));
  if (blocked.length > 0) {
    throw new TeacherReviewServiceError(
      "session_batch_delete_blocked",
      "Only completed or student-exited sessions can be permanently deleted.",
      409,
      {
        blocked_sessions: blocked.map((session) => ({
          session_public_id: session.session_public_id,
          status: session.status
        }))
      }
    );
  }

  return sessions;
}

async function buildSessionDeletionGraph(
  client: SessionDeletionClient,
  sessions: SessionForDeletion[]
): Promise<SessionDeletionGraph> {
  const sessionIds = sessions.map((session) => session.id);
  const sessionPublicIds = sessions.map((session) => session.session_public_id);
  const conceptUnitSessions = await client.conceptUnitSession.findMany({
    where: { assessment_session_db_id: safeIn(sessionIds) },
    select: { id: true }
  });
  const conceptUnitSessionIds = conceptUnitSessions.map((session) => session.id);
  const followupRounds = await client.followupRound.findMany({
    where: { concept_unit_session_db_id: safeIn(conceptUnitSessionIds) },
    select: { id: true }
  });
  const followupRoundIds = followupRounds.map((round) => round.id);
  const formativeConversations = await client.formativeConversationSession.findMany({
    where: { assessment_session_db_id: safeIn(sessionIds) },
    select: { id: true, conversation_public_id: true }
  });
  const formativeConversationSessionIds = formativeConversations.map((session) => session.id);
  const formativeConversationPublicIds = formativeConversations.map(
    (session) => session.conversation_public_id
  );
  const activityAttempts = await client.activityRuntimeAttempt.findMany({
    where: { session_public_id: { in: sessionPublicIds } },
    select: {
      id: true,
      activity_attempt_public_id: true,
      first_turn_agent_call_db_id: true,
      reviewer_agent_call_db_id: true,
      repair_agent_call_db_id: true
    }
  });
  const activityAttemptIds = activityAttempts.map((attempt) => attempt.id);
  const activityAttemptPublicIds = activityAttempts.map(
    (attempt) => attempt.activity_attempt_public_id
  );
  const activityEvidence = await client.activityMisconceptionEvidenceRecord.findMany({
    where: {
      OR: [
        { session_public_id: { in: sessionPublicIds } },
        { activity_attempt_id: { in: activityAttemptPublicIds } }
      ]
    },
    select: { id: true, source_evaluator_agent_call_db_id: true }
  });
  const activityEvidenceIds = activityEvidence.map((record) => record.id);
  const activityAgentCallIds = unique([
    ...activityAttempts.flatMap((attempt) => [
      attempt.first_turn_agent_call_db_id,
      attempt.reviewer_agent_call_db_id,
      attempt.repair_agent_call_db_id
    ]),
    ...activityEvidence.map((record) => record.source_evaluator_agent_call_db_id)
  ]);
  const agentCalls = await client.agentCall.findMany({
    where: {
      OR: [
        { assessment_session_db_id: safeIn(sessionIds) },
        { concept_unit_session_db_id: safeIn(conceptUnitSessionIds) },
        { followup_round_db_id: safeIn(followupRoundIds) },
        { formative_conversation_session_db_id: safeIn(formativeConversationSessionIds) },
        { id: safeIn(activityAgentCallIds) }
      ]
    },
    select: { id: true }
  });
  const agentCallIds = agentCalls.map((call) => call.id);

  const [
    itemResponseCount,
    conversationTurnCount,
    processEventCount,
    responsePackageCount,
    studentProfileCount,
    formativeDecisionCount
  ] = await Promise.all([
    client.itemResponse.count({
      where: { concept_unit_session_db_id: safeIn(conceptUnitSessionIds) }
    }),
    client.conversationTurn.count({
      where: { assessment_session_db_id: safeIn(sessionIds) }
    }),
    client.processEvent.count({
      where: { assessment_session_db_id: safeIn(sessionIds) }
    }),
    client.responsePackage.count({
      where: { concept_unit_session_db_id: safeIn(conceptUnitSessionIds) }
    }),
    client.studentProfile.count({
      where: { concept_unit_session_db_id: safeIn(conceptUnitSessionIds) }
    }),
    client.formativeDecision.count({
      where: { concept_unit_session_db_id: safeIn(conceptUnitSessionIds) }
    })
  ]);

  return {
    sessions,
    sessionIds,
    sessionPublicIds,
    conceptUnitSessionIds,
    followupRoundIds,
    formativeConversationSessionIds,
    formativeConversationPublicIds,
    activityAttemptIds,
    activityAttemptPublicIds,
    activityEvidenceIds,
    agentCallIds,
    counts: {
      assessment_session_count: sessions.length,
      concept_unit_session_count: conceptUnitSessionIds.length,
      item_response_count: itemResponseCount,
      conversation_turn_count: conversationTurnCount,
      process_event_count: processEventCount,
      response_package_count: responsePackageCount,
      student_profile_count: studentProfileCount,
      formative_decision_count: formativeDecisionCount,
      followup_round_count: followupRoundIds.length,
      formative_conversation_session_count: formativeConversationSessionIds.length,
      activity_runtime_count: activityAttemptIds.length,
      agent_call_count: agentCallIds.length
    }
  };
}

function publicPreview(graph: SessionDeletionGraph): SessionBatchDeletionPreview {
  return {
    selected_session_count: graph.sessions.length,
    sessions: [...graph.sessions]
      .sort((left, right) => left.session_public_id.localeCompare(right.session_public_id))
      .map((session) => ({
        session_public_id: session.session_public_id,
        student_user_id: session.user.user_id,
        student_display_name: session.user.display_name,
        assessment_public_id: session.assessment.assessment_public_id,
        assessment_title: session.assessment.title,
        status: session.status,
        current_phase: session.current_phase
      })),
    selection_fingerprint: selectionFingerprint(graph.sessions),
    required_delete_confirmation: requiredConfirmation(graph.sessions.length),
    counts: graph.counts,
    warning:
      "This permanently deletes the selected attempts and their responses, conversation, telemetry, profiles, and agent-call records. Student accounts and assessment content are retained.",
    deletion_limitations: [
      "Previously downloaded exports, screenshots, or external copies are outside this system and cannot be removed here.",
      "The deletion audit retains safe session identifiers, aggregate counts, and the teacher action; it does not retain response or reasoning text."
    ]
  };
}

export async function previewSessionBatchDeletion(input: {
  teacher_user_db_id: string;
  data: unknown;
}): Promise<SessionBatchDeletionPreview> {
  const parsed = sessionSelectionSchema.parse(input.data);
  const sessionPublicIds = normalizedSessionIds(parsed);
  await assertTeacherResearcher(prisma, input.teacher_user_db_id);
  const sessions = await findSessionsForDeletion(prisma, {
    teacher_user_db_id: input.teacher_user_db_id,
    session_public_ids: sessionPublicIds
  });
  return publicPreview(await buildSessionDeletionGraph(prisma, sessions));
}

async function deleteSessionGraph(
  tx: Prisma.TransactionClient,
  graph: SessionDeletionGraph
) {
  await tx.conceptUnitSession.updateMany({
    where: { id: safeIn(graph.conceptUnitSessionIds) },
    data: {
      latest_student_profile_db_id: null,
      latest_formative_decision_db_id: null
    }
  });
  await tx.postActivityDiagnosticSnapshot.deleteMany({
    where: {
      OR: [
        { evidence_record_db_id: safeIn(graph.activityEvidenceIds) },
        { session_public_id: { in: graph.sessionPublicIds } },
        { activity_attempt_id: { in: graph.activityAttemptPublicIds } }
      ]
    }
  });
  await tx.activityMisconceptionEvidenceRecord.deleteMany({
    where: {
      OR: [
        { id: safeIn(graph.activityEvidenceIds) },
        { session_public_id: { in: graph.sessionPublicIds } },
        { activity_attempt_id: { in: graph.activityAttemptPublicIds } }
      ]
    }
  });
  await tx.activityRuntimeAttempt.deleteMany({
    where: {
      OR: [
        { id: safeIn(graph.activityAttemptIds) },
        { session_public_id: { in: graph.sessionPublicIds } }
      ]
    }
  });
  await tx.topicDialogueTurn.deleteMany({
    where: { assessment_session_db_id: safeIn(graph.sessionIds) }
  });
  await tx.topicDialogue.deleteMany({
    where: { assessment_session_db_id: safeIn(graph.sessionIds) }
  });
  await tx.studentCommunication.deleteMany({
    where: { assessment_session_db_id: safeIn(graph.sessionIds) }
  });
  await tx.assessmentLifecycleOperation.deleteMany({
    where: {
      OR: [
        { assessment_session_db_id: safeIn(graph.sessionIds) },
        { target_session_public_id: { in: graph.sessionPublicIds } },
        { resulting_session_public_id: { in: graph.sessionPublicIds } }
      ]
    }
  });
  await tx.workflowJob.deleteMany({
    where: { assessment_session_db_id: safeIn(graph.sessionIds) }
  });
  await tx.workflowOverride.deleteMany({
    where: { assessment_session_db_id: safeIn(graph.sessionIds) }
  });
  await tx.studentActionIdempotencyKey.deleteMany({
    where: { assessment_session_db_id: safeIn(graph.sessionIds) }
  });
  await tx.conceptProgressionRecord.deleteMany({
    where: { assessment_session_db_id: safeIn(graph.sessionIds) }
  });
  await tx.followupUpdateCycle.deleteMany({
    where: { assessment_session_db_id: safeIn(graph.sessionIds) }
  });
  await tx.conversationTurn.deleteMany({
    where: { assessment_session_db_id: safeIn(graph.sessionIds) }
  });
  await tx.processEvent.deleteMany({
    where: { assessment_session_db_id: safeIn(graph.sessionIds) }
  });
  await tx.operationalAgentEffectiveResult.deleteMany({
    where: {
      OR: [
        { agent_call_db_id: safeIn(graph.agentCallIds) },
        {
          operational_context_public_id: {
            in: [
              ...graph.sessionPublicIds,
              ...graph.activityAttemptPublicIds,
              ...graph.formativeConversationPublicIds
            ]
          }
        }
      ]
    }
  });
  await tx.agentCall.deleteMany({ where: { id: safeIn(graph.agentCallIds) } });
  await tx.formativeConversationSession.deleteMany({
    where: { id: safeIn(graph.formativeConversationSessionIds) }
  });
  await tx.followupRound.deleteMany({
    where: { concept_unit_session_db_id: safeIn(graph.conceptUnitSessionIds) }
  });
  await tx.formativeDecision.deleteMany({
    where: { concept_unit_session_db_id: safeIn(graph.conceptUnitSessionIds) }
  });
  await tx.studentProfile.deleteMany({
    where: { concept_unit_session_db_id: safeIn(graph.conceptUnitSessionIds) }
  });
  await tx.responsePackage.deleteMany({
    where: { concept_unit_session_db_id: safeIn(graph.conceptUnitSessionIds) }
  });
  await tx.itemResponse.deleteMany({
    where: { concept_unit_session_db_id: safeIn(graph.conceptUnitSessionIds) }
  });
  await tx.conceptUnitSession.deleteMany({
    where: { id: safeIn(graph.conceptUnitSessionIds) }
  });
  await tx.assessmentSession.deleteMany({ where: { id: safeIn(graph.sessionIds) } });
}

export async function deleteStudentSessionsAndAssociatedData(input: {
  teacher_user_db_id: string;
  data: unknown;
}): Promise<SessionBatchDeletionSummary> {
  const parsed = sessionDeletionConfirmationSchema.parse(input.data);
  const sessionPublicIds = normalizedSessionIds(parsed);

  return prisma.$transaction(
    async (tx) => {
      await assertTeacherResearcher(tx, input.teacher_user_db_id);
      const sessions = await findSessionsForDeletion(tx, {
        teacher_user_db_id: input.teacher_user_db_id,
        session_public_ids: sessionPublicIds
      });
      const currentFingerprint = selectionFingerprint(sessions);
      const expectedConfirmation = requiredConfirmation(sessions.length);
      if (
        parsed.selection_fingerprint !== currentFingerprint ||
        parsed.delete_confirmation !== expectedConfirmation
      ) {
        throw new TeacherReviewServiceError(
          "session_batch_delete_confirmation_mismatch",
          "Session deletion requires the current selection fingerprint and exact confirmation phrase.",
          400,
          {
            required_delete_confirmation: expectedConfirmation,
            selection_changed: parsed.selection_fingerprint !== currentFingerprint
          }
        );
      }

      const graph = await buildSessionDeletionGraph(tx, sessions);
      const preview = publicPreview(graph);
      const deletedAt = new Date();
      const batchOperationPublicId = generatePublicId("session_batch_deletion");
      await deleteSessionGraph(tx, graph);

      const auditRows = await Promise.all(
        sessions.map((session) => {
          const operationPublicId = generatePublicId("session_deletion_audit");
          return tx.assessmentLifecycleOperation.create({
            data: {
              id: randomUUID(),
              operation_public_id: operationPublicId,
              command_type: "teacher_delete_student_session",
              actor_type: "teacher_researcher",
              target_assessment_public_id: session.assessment.assessment_public_id,
              target_session_public_id: session.session_public_id,
              request_id: batchOperationPublicId,
              requested_at: deletedAt,
              prior_canonical_status: session.status,
              mutation_committed: true,
              resulting_canonical_status: "deleted",
              http_status: 200,
              safe_response_code: "student_session_deleted",
              response_payload: toPrismaJson({
                deletion_reason_code: "teacher_confirmed_student_session_batch_deletion",
                deleted_session_public_hash: publicHash(session.session_public_id),
                batch_operation_public_id: batchOperationPublicId,
                batch_size: sessions.length,
                batch_deleted_counts: graph.counts,
                deleted_at: deletedAt.toISOString()
              }),
              completed_at: deletedAt,
              assessment_session_db_id: null
            }
          });
        })
      );

      return {
        ...preview,
        batch_operation_public_id: batchOperationPublicId,
        deletion_audit_operation_public_ids: auditRows.map(
          (row) => row.operation_public_id
        ),
        deleted_at: deletedAt.toISOString(),
        deleted_counts: graph.counts
      };
    },
    { maxWait: 10_000, timeout: 180_000 }
  );
}
