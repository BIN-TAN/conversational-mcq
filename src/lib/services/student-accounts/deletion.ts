import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { generatePublicId } from "@/lib/services/ids";
import { toPrismaJson } from "@/lib/services/json";
import { StudentAccountServiceError } from "./errors";
import { normalizeUserId } from "./validation";

export const STUDENT_DELETION_WARNING =
  "This permanently removes the student account and associated session/activity data from this system. Previously downloaded exports are outside this system and cannot be removed here.";

const confirmationSchema = z
  .object({
    student_id: z.string(),
    delete_confirmation: z.string()
  })
  .strict();

type StudentDeletionClient = typeof prisma | Prisma.TransactionClient;

type StudentForDeletion = {
  id: string;
  user_id: string;
  display_name: string | null;
  account_status: "active" | "inactive";
  role: string;
};

type DeletionGraph = {
  student: StudentForDeletion;
  sessionIds: string[];
  sessionPublicIds: string[];
  conceptUnitSessionIds: string[];
  followupRoundIds: string[];
  agentCallIds: string[];
  activityAttemptPublicIds: string[];
  activityAttemptIds: string[];
  activityEvidenceIds: string[];
  counts: StudentDeletionCounts;
  retained_reference_counts: Record<string, number>;
};

export type StudentDeletionCounts = {
  student_account_count: number;
  assessment_session_count: number;
  concept_unit_session_count: number;
  item_response_count: number;
  conversation_turn_count: number;
  process_event_count: number;
  response_package_count: number;
  student_profile_count: number;
  formative_decision_count: number;
  followup_round_count: number;
  followup_update_cycle_count: number;
  concept_progression_record_count: number;
  workflow_job_count: number;
  workflow_override_count: number;
  student_action_idempotency_key_count: number;
  activity_runtime_count: number;
  post_activity_evidence_count: number;
  diagnostic_snapshot_count: number;
  agent_call_summary_count: number;
  operational_effective_result_count: number;
  summative_outcome_count: number;
  student_account_event_count: number;
  student_requested_export_job_count: number;
  student_uploaded_summative_import_batch_count: number;
  student_uploaded_roster_import_batch_count: number;
};

export type StudentDeletionPreview = {
  student_id: string;
  display_name: string | null;
  active_status: "active" | "inactive";
  warning: string;
  counts: StudentDeletionCounts;
  other_associated_record_counts: Record<string, number>;
  retained_reference_counts: Record<string, number>;
  warnings: string[];
  deletion_limitations: string[];
};

export type StudentDeletionSummary = StudentDeletionPreview & {
  deletion_event_public_id: string;
  deleted_at: string;
  deleted_counts: StudentDeletionCounts;
};

function unique(values: Array<string | null | undefined>) {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function safeIn(values: string[]) {
  return values.length > 0 ? { in: values } : { in: ["00000000-0000-0000-0000-000000000000"] };
}

async function assertTeacherResearcher(client: StudentDeletionClient, teacherUserDbId: string) {
  const teacher = await client.user.findUnique({
    where: { id: teacherUserDbId },
    select: { role: true }
  });

  if (!teacher || teacher.role !== "teacher_researcher") {
    throw new StudentAccountServiceError(
      "forbidden",
      "Only teacher_researcher users can delete student accounts.",
      403
    );
  }
}

async function findStudentForDeletion(client: StudentDeletionClient, userId: string) {
  const student = await client.user.findUnique({
    where: { user_id_normalized: normalizeUserId(userId) },
    select: {
      id: true,
      user_id: true,
      display_name: true,
      role: true,
      account_status: true
    }
  });

  if (!student || student.role !== "student") {
    throw new StudentAccountServiceError("not_found", "Student account was not found.", 404);
  }

  return student;
}

async function buildStudentDeletionGraph(
  client: StudentDeletionClient,
  student: StudentForDeletion
): Promise<DeletionGraph> {
  const sessions = await client.assessmentSession.findMany({
    where: { user_db_id: student.id },
    select: { id: true, session_public_id: true }
  });
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

  const activityAttempts = await client.activityRuntimeAttempt.findMany({
    where: {
      OR: [
        { student_public_id: student.user_id },
        { session_public_id: { in: sessionPublicIds } }
      ]
    },
    select: {
      id: true,
      activity_attempt_public_id: true,
      first_turn_agent_call_db_id: true,
      reviewer_agent_call_db_id: true,
      repair_agent_call_db_id: true
    }
  });
  const activityAttemptIds = activityAttempts.map((attempt) => attempt.id);
  const activityAttemptPublicIds = activityAttempts.map((attempt) => attempt.activity_attempt_public_id);

  const preliminaryActivityEvidence = await client.activityMisconceptionEvidenceRecord.findMany({
    where: {
      OR: [
        { student_public_id: student.user_id },
        { session_public_id: { in: sessionPublicIds } },
        { activity_attempt_id: { in: activityAttemptPublicIds } }
      ]
    },
    select: { id: true, source_evaluator_agent_call_db_id: true }
  });
  const activityEvidenceIds = preliminaryActivityEvidence.map((record) => record.id);

  const activityAgentCallIds = unique([
    ...activityAttempts.flatMap((attempt) => [
      attempt.first_turn_agent_call_db_id,
      attempt.reviewer_agent_call_db_id,
      attempt.repair_agent_call_db_id
    ]),
    ...preliminaryActivityEvidence.map((record) => record.source_evaluator_agent_call_db_id)
  ]);

  const agentCalls = await client.agentCall.findMany({
    where: {
      OR: [
        { assessment_session_db_id: safeIn(sessionIds) },
        { concept_unit_session_db_id: safeIn(conceptUnitSessionIds) },
        { followup_round_db_id: safeIn(followupRoundIds) },
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
    formativeDecisionCount,
    followupUpdateCycleCount,
    conceptProgressionRecordCount,
    workflowJobCount,
    workflowOverrideCount,
    studentActionIdempotencyKeyCount,
    diagnosticSnapshotCount,
    operationalEffectiveResultCount,
    summativeOutcomeCount,
    studentAccountEventCount,
    studentRequestedExportJobCount,
    studentUploadedSummativeImportBatchCount,
    studentUploadedRosterImportBatchCount,
    retainedDispatchAttemptReferenceCount
  ] = await Promise.all([
    client.itemResponse.count({ where: { concept_unit_session_db_id: safeIn(conceptUnitSessionIds) } }),
    client.conversationTurn.count({ where: { assessment_session_db_id: safeIn(sessionIds) } }),
    client.processEvent.count({ where: { assessment_session_db_id: safeIn(sessionIds) } }),
    client.responsePackage.count({ where: { concept_unit_session_db_id: safeIn(conceptUnitSessionIds) } }),
    client.studentProfile.count({ where: { concept_unit_session_db_id: safeIn(conceptUnitSessionIds) } }),
    client.formativeDecision.count({ where: { concept_unit_session_db_id: safeIn(conceptUnitSessionIds) } }),
    client.followupUpdateCycle.count({ where: { assessment_session_db_id: safeIn(sessionIds) } }),
    client.conceptProgressionRecord.count({ where: { assessment_session_db_id: safeIn(sessionIds) } }),
    client.workflowJob.count({ where: { assessment_session_db_id: safeIn(sessionIds) } }),
    client.workflowOverride.count({
      where: {
        OR: [
          { assessment_session_db_id: safeIn(sessionIds) },
          { created_by_user_db_id: student.id }
        ]
      }
    }),
    client.studentActionIdempotencyKey.count({ where: { assessment_session_db_id: safeIn(sessionIds) } }),
    client.postActivityDiagnosticSnapshot.count({
      where: {
        OR: [
          { evidence_record_db_id: safeIn(activityEvidenceIds) },
          { student_public_id: student.user_id },
          { session_public_id: { in: sessionPublicIds } },
          { activity_attempt_id: { in: activityAttemptPublicIds } }
        ]
      }
    }),
    client.operationalAgentEffectiveResult.count({
      where: {
        OR: [
          { agent_call_db_id: safeIn(agentCallIds) },
          { operational_context_public_id: { in: [...sessionPublicIds, ...activityAttemptPublicIds] } }
        ]
      }
    }),
    client.summativeOutcome.count({ where: { user_db_id: student.id } }),
    client.studentAccountEvent.count({ where: { student_user_db_id: student.id } }),
    client.exportJob.count({ where: { requested_by_user_db_id: student.id } }),
    client.summativeOutcomeImportBatch.count({ where: { uploaded_by_user_db_id: student.id } }),
    client.rosterImportBatch.count({ where: { uploaded_by_user_db_id: student.id } }),
    client.operationalLiveCanaryDispatchAttempt.count({ where: { agent_call_db_id: safeIn(agentCallIds) } })
  ]);

  return {
    student,
    sessionIds,
    sessionPublicIds,
    conceptUnitSessionIds,
    followupRoundIds,
    agentCallIds,
    activityAttemptIds,
    activityAttemptPublicIds,
    activityEvidenceIds,
    counts: {
      student_account_count: 1,
      assessment_session_count: sessionIds.length,
      concept_unit_session_count: conceptUnitSessionIds.length,
      item_response_count: itemResponseCount,
      conversation_turn_count: conversationTurnCount,
      process_event_count: processEventCount,
      response_package_count: responsePackageCount,
      student_profile_count: studentProfileCount,
      formative_decision_count: formativeDecisionCount,
      followup_round_count: followupRoundIds.length,
      followup_update_cycle_count: followupUpdateCycleCount,
      concept_progression_record_count: conceptProgressionRecordCount,
      workflow_job_count: workflowJobCount,
      workflow_override_count: workflowOverrideCount,
      student_action_idempotency_key_count: studentActionIdempotencyKeyCount,
      activity_runtime_count: activityAttemptIds.length,
      post_activity_evidence_count: activityEvidenceIds.length,
      diagnostic_snapshot_count: diagnosticSnapshotCount,
      agent_call_summary_count: agentCallIds.length,
      operational_effective_result_count: operationalEffectiveResultCount,
      summative_outcome_count: summativeOutcomeCount,
      student_account_event_count: studentAccountEventCount,
      student_requested_export_job_count: studentRequestedExportJobCount,
      student_uploaded_summative_import_batch_count: studentUploadedSummativeImportBatchCount,
      student_uploaded_roster_import_batch_count: studentUploadedRosterImportBatchCount
    },
    retained_reference_counts: {
      operational_live_canary_dispatch_attempt_reference_count: retainedDispatchAttemptReferenceCount
    }
  };
}

function publicPreview(graph: DeletionGraph): StudentDeletionPreview {
  return {
    student_id: graph.student.user_id,
    display_name: graph.student.display_name,
    active_status: graph.student.account_status,
    warning: STUDENT_DELETION_WARNING,
    counts: graph.counts,
    other_associated_record_counts: {
      concept_unit_session_count: graph.counts.concept_unit_session_count,
      followup_round_count: graph.counts.followup_round_count,
      followup_update_cycle_count: graph.counts.followup_update_cycle_count,
      concept_progression_record_count: graph.counts.concept_progression_record_count,
      workflow_job_count: graph.counts.workflow_job_count,
      workflow_override_count: graph.counts.workflow_override_count,
      student_action_idempotency_key_count: graph.counts.student_action_idempotency_key_count,
      operational_effective_result_count: graph.counts.operational_effective_result_count,
      student_requested_export_job_count: graph.counts.student_requested_export_job_count,
      student_uploaded_summative_import_batch_count:
        graph.counts.student_uploaded_summative_import_batch_count,
      student_uploaded_roster_import_batch_count: graph.counts.student_uploaded_roster_import_batch_count
    },
    retained_reference_counts: graph.retained_reference_counts,
    warnings: [
      STUDENT_DELETION_WARNING,
      "Deletion is irreversible inside this system. Use deactivation if the account may need to be restored."
    ],
    deletion_limitations: [
      "Previously downloaded exports, screenshots, or external copies are outside this system and cannot be removed here.",
      "Teacher-created content, item metadata, answer keys, and other students' records are retained.",
      "If an operational canary dispatch record ever referenced a deleted agent call, that canary audit row is retained and its agent-call foreign key is cleared by the database relation."
    ]
  };
}

export async function previewStudentDeletion(input: {
  teacher_user_db_id: string;
  user_id: string;
}): Promise<StudentDeletionPreview> {
  await assertTeacherResearcher(prisma, input.teacher_user_db_id);
  const student = await findStudentForDeletion(prisma, input.user_id);
  return publicPreview(await buildStudentDeletionGraph(prisma, student));
}

export async function deleteStudentAccountAndAssociatedData(input: {
  teacher_user_db_id: string;
  user_id: string;
  confirmation: z.input<typeof confirmationSchema>;
}): Promise<StudentDeletionSummary> {
  const parsed = confirmationSchema.parse(input.confirmation);

  return prisma.$transaction(async (tx) => {
    await assertTeacherResearcher(tx, input.teacher_user_db_id);
    const student = await findStudentForDeletion(tx, input.user_id);

    if (parsed.student_id !== student.user_id || parsed.delete_confirmation !== "DELETE") {
      throw new StudentAccountServiceError(
        "delete_confirmation_mismatch",
        "Student deletion requires the exact student_id and DELETE confirmation.",
        400,
        { required_student_id: student.user_id, required_delete_confirmation: "DELETE" }
      );
    }

    const graph = await buildStudentDeletionGraph(tx, student);
    const preview = publicPreview(graph);

    await tx.conceptUnitSession.updateMany({
      where: { id: safeIn(graph.conceptUnitSessionIds) },
      data: { latest_student_profile_db_id: null, latest_formative_decision_db_id: null }
    });

    await tx.postActivityDiagnosticSnapshot.deleteMany({
      where: {
        OR: [
          { evidence_record_db_id: safeIn(graph.activityEvidenceIds) },
          { student_public_id: student.user_id },
          { session_public_id: { in: graph.sessionPublicIds } },
          { activity_attempt_id: { in: graph.activityAttemptPublicIds } }
        ]
      }
    });
    await tx.activityMisconceptionEvidenceRecord.deleteMany({
      where: {
        OR: [
          { id: safeIn(graph.activityEvidenceIds) },
          { student_public_id: student.user_id },
          { session_public_id: { in: graph.sessionPublicIds } },
          { activity_attempt_id: { in: graph.activityAttemptPublicIds } }
        ]
      }
    });
    await tx.activityRuntimeAttempt.deleteMany({
      where: {
        OR: [
          { id: safeIn(graph.activityAttemptIds) },
          { student_public_id: student.user_id },
          { session_public_id: { in: graph.sessionPublicIds } }
        ]
      }
    });

    await tx.workflowJob.deleteMany({ where: { assessment_session_db_id: safeIn(graph.sessionIds) } });
    await tx.workflowOverride.deleteMany({
      where: {
        OR: [
          { assessment_session_db_id: safeIn(graph.sessionIds) },
          { created_by_user_db_id: student.id }
        ]
      }
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
    await tx.conversationTurn.deleteMany({ where: { assessment_session_db_id: safeIn(graph.sessionIds) } });
    await tx.processEvent.deleteMany({ where: { assessment_session_db_id: safeIn(graph.sessionIds) } });
    await tx.operationalAgentEffectiveResult.deleteMany({
      where: {
        OR: [
          { agent_call_db_id: safeIn(graph.agentCallIds) },
          { operational_context_public_id: { in: [...graph.sessionPublicIds, ...graph.activityAttemptPublicIds] } }
        ]
      }
    });
    await tx.agentCall.deleteMany({ where: { id: safeIn(graph.agentCallIds) } });
    await tx.followupRound.deleteMany({ where: { concept_unit_session_db_id: safeIn(graph.conceptUnitSessionIds) } });
    await tx.formativeDecision.deleteMany({
      where: { concept_unit_session_db_id: safeIn(graph.conceptUnitSessionIds) }
    });
    await tx.studentProfile.deleteMany({ where: { concept_unit_session_db_id: safeIn(graph.conceptUnitSessionIds) } });
    await tx.responsePackage.deleteMany({
      where: { concept_unit_session_db_id: safeIn(graph.conceptUnitSessionIds) }
    });
    await tx.itemResponse.deleteMany({ where: { concept_unit_session_db_id: safeIn(graph.conceptUnitSessionIds) } });
    await tx.conceptUnitSession.deleteMany({ where: { id: safeIn(graph.conceptUnitSessionIds) } });
    await tx.assessmentSession.deleteMany({ where: { id: safeIn(graph.sessionIds) } });

    await tx.summativeOutcome.deleteMany({ where: { user_db_id: student.id } });
    await tx.exportJob.deleteMany({ where: { requested_by_user_db_id: student.id } });
    await tx.summativeOutcomeImportBatch.deleteMany({ where: { uploaded_by_user_db_id: student.id } });
    await tx.studentAccountEvent.deleteMany({ where: { student_user_db_id: student.id } });
    await tx.rosterImportBatch.deleteMany({ where: { uploaded_by_user_db_id: student.id } });

    const deletedAt = new Date();
    const audit = await tx.studentAccountDeletionEvent.create({
      data: {
        id: crypto.randomUUID(),
        event_public_id: generatePublicId("student_account_deletion_event"),
        student_user_id_snapshot: student.user_id,
        performed_by_user_db_id: input.teacher_user_db_id,
        deletion_summary:
          toPrismaJson({
            deletion_reason_code: "teacher_confirmed_student_account_deletion",
            deleted_counts: graph.counts,
            retained_reference_counts: graph.retained_reference_counts,
            warning: STUDENT_DELETION_WARNING,
            deleted_at: deletedAt.toISOString()
          }) ?? {}
      }
    });

    await tx.user.delete({ where: { id: student.id } });

    return {
      ...preview,
      deletion_event_public_id: audit.event_public_id,
      deleted_at: deletedAt.toISOString(),
      deleted_counts: graph.counts
    };
  });
}
