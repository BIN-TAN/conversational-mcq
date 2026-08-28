import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { generatePublicId } from "@/lib/services/ids";
import { toPrismaJson } from "@/lib/services/json";
import { StudentAccountServiceError } from "./errors";
import { normalizeUserId, userIdSchema } from "./validation";

export const STUDENT_DELETION_WARNING =
  "This permanently removes the student account and associated session/activity data from this system. Previously downloaded exports are outside this system and cannot be removed here.";

export const STUDENT_BATCH_DELETION_MAX_ACCOUNTS = 100;

const batchSelectionSchema = z
  .object({
    student_ids: z.array(userIdSchema).min(1).max(STUDENT_BATCH_DELETION_MAX_ACCOUNTS)
  })
  .strict();

const batchConfirmationSchema = batchSelectionSchema
  .extend({
    selection_fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    delete_confirmation: z.string()
  })
  .strict();

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
  students: StudentForDeletion[];
  sessionIds: string[];
  sessionPublicIds: string[];
  conceptUnitSessionIds: string[];
  followupRoundIds: string[];
  agentCallIds: string[];
  formativeConversationSessionIds: string[];
  formativeConversationPublicIds: string[];
  activityAttemptPublicIds: string[];
  activityAttemptIds: string[];
  activityEvidenceIds: string[];
  studentSessionCounts: Record<string, number>;
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
  assessment_lifecycle_operation_count: number;
  student_communication_count: number;
  topic_dialogue_count: number;
  topic_dialogue_turn_count: number;
  formative_conversation_session_count: number;
  formative_conversation_message_receipt_count: number;
  formative_conversation_memory_snapshot_count: number;
  formative_conversation_intervention_count: number;
  formative_conversation_review_signal_count: number;
  formative_conversation_lifecycle_event_count: number;
  formative_conversation_turn_telemetry_count: number;
  formative_conversation_input_telemetry_count: number;
  formative_conversation_profile_transition_count: number;
  formative_conversation_profile_transition_turn_reference_count: number;
  formative_conversation_profile_evidence_reference_count: number;
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

export type StudentBatchDeletionPreview = {
  selected_student_count: number;
  students: Array<{
    student_id: string;
    display_name: string | null;
    active_status: "active" | "inactive";
    assessment_session_count: number;
  }>;
  selection_fingerprint: string;
  required_delete_confirmation: string;
  warning: string;
  counts: StudentDeletionCounts;
  retained_reference_counts: Record<string, number>;
  warnings: string[];
  deletion_limitations: string[];
};

export type StudentBatchDeletionSummary = StudentBatchDeletionPreview & {
  batch_operation_public_id: string;
  deletion_event_public_ids: string[];
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
  const students = await findStudentsForDeletion(client, [userId]);
  return students[0];
}

function normalizeBatchSelection(studentIds: string[]) {
  const requested = studentIds.map((studentId) => ({
    requested: studentId.trim(),
    normalized: normalizeUserId(studentId)
  }));
  const normalizedIds = requested.map((entry) => entry.normalized);

  if (new Set(normalizedIds).size !== normalizedIds.length) {
    throw new StudentAccountServiceError(
      "duplicate_student_selection",
      "Each student account may be selected only once.",
      400
    );
  }

  return requested;
}

async function findStudentsForDeletion(
  client: StudentDeletionClient,
  studentIds: string[]
): Promise<StudentForDeletion[]> {
  const requested = normalizeBatchSelection(studentIds);
  const students = await client.user.findMany({
    where: {
      user_id_normalized: { in: requested.map((entry) => entry.normalized) },
      role: "student"
    },
    select: {
      id: true,
      user_id: true,
      display_name: true,
      role: true,
      account_status: true
    }
  });
  const studentsByNormalizedId = new Map(
    students.map((student) => [normalizeUserId(student.user_id), student])
  );
  const missingStudentIds = requested
    .filter((entry) => !studentsByNormalizedId.has(entry.normalized))
    .map((entry) => entry.requested);

  if (missingStudentIds.length > 0) {
    throw new StudentAccountServiceError(
      "student_selection_not_found",
      "One or more selected student accounts were not found.",
      404,
      { missing_student_ids: missingStudentIds }
    );
  }

  return requested.map((entry) => studentsByNormalizedId.get(entry.normalized)!);
}

function canonicalStudentIds(students: StudentForDeletion[]) {
  return students.map((student) => student.user_id).sort((left, right) => left.localeCompare(right));
}

function studentSelectionFingerprint(students: StudentForDeletion[]) {
  return createHash("sha256").update(JSON.stringify(canonicalStudentIds(students))).digest("hex");
}

function requiredBatchDeleteConfirmation(studentCount: number) {
  return `DELETE ${studentCount} STUDENT ${studentCount === 1 ? "ACCOUNT" : "ACCOUNTS"}`;
}

async function buildStudentDeletionGraph(
  client: StudentDeletionClient,
  students: StudentForDeletion[]
): Promise<DeletionGraph> {
  const studentDbIds = students.map((student) => student.id);
  const studentPublicIds = students.map((student) => student.user_id);
  const sessions = await client.assessmentSession.findMany({
    where: { user_db_id: { in: studentDbIds } },
    select: { id: true, session_public_id: true, user_db_id: true }
  });
  const sessionIds = sessions.map((session) => session.id);
  const sessionPublicIds = sessions.map((session) => session.session_public_id);
  const studentByDbId = new Map(students.map((student) => [student.id, student]));
  const studentSessionCounts = Object.fromEntries(students.map((student) => [student.user_id, 0]));

  for (const session of sessions) {
    const student = studentByDbId.get(session.user_db_id);
    if (student) {
      studentSessionCounts[student.user_id] += 1;
    }
  }

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

  const formativeConversationSessions = await client.formativeConversationSession.findMany({
    where: { assessment_session_db_id: safeIn(sessionIds) },
    select: { id: true, conversation_public_id: true }
  });
  const formativeConversationSessionIds = formativeConversationSessions.map((session) => session.id);
  const formativeConversationPublicIds = formativeConversationSessions.map(
    (session) => session.conversation_public_id
  );

  const activityAttempts = await client.activityRuntimeAttempt.findMany({
    where: {
      OR: [
        { student_public_id: { in: studentPublicIds } },
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
        { student_public_id: { in: studentPublicIds } },
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
        { formative_conversation_session_db_id: safeIn(formativeConversationSessionIds) },
        { id: safeIn(activityAgentCallIds) }
      ]
    },
    select: { id: true }
  });
  const agentCallIds = agentCalls.map((call) => call.id);

  const formativeConversationProfileTransitions =
    await client.formativeConversationProfileTransition.findMany({
      where: { formative_conversation_session_db_id: safeIn(formativeConversationSessionIds) },
      select: { id: true }
    });
  const formativeConversationProfileTransitionIds = formativeConversationProfileTransitions.map(
    (transition) => transition.id
  );

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
    assessmentLifecycleOperationCount,
    studentCommunicationCount,
    topicDialogueCount,
    topicDialogueTurnCount,
    formativeConversationMessageReceiptCount,
    formativeConversationMemorySnapshotCount,
    formativeConversationInterventionCount,
    formativeConversationReviewSignalCount,
    formativeConversationLifecycleEventCount,
    formativeConversationTurnTelemetryCount,
    formativeConversationInputTelemetryCount,
    formativeConversationProfileTransitionTurnReferenceCount,
    formativeConversationProfileEvidenceReferenceCount,
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
          { created_by_user_db_id: { in: studentDbIds } }
        ]
      }
    }),
    client.studentActionIdempotencyKey.count({ where: { assessment_session_db_id: safeIn(sessionIds) } }),
    client.assessmentLifecycleOperation.count({
      where: {
        OR: [
          { assessment_session_db_id: safeIn(sessionIds) },
          { target_session_public_id: { in: sessionPublicIds } },
          { resulting_session_public_id: { in: sessionPublicIds } }
        ]
      }
    }),
    client.studentCommunication.count({ where: { assessment_session_db_id: safeIn(sessionIds) } }),
    client.topicDialogue.count({ where: { assessment_session_db_id: safeIn(sessionIds) } }),
    client.topicDialogueTurn.count({ where: { assessment_session_db_id: safeIn(sessionIds) } }),
    client.formativeConversationMessageReceipt.count({
      where: { formative_conversation_session_db_id: safeIn(formativeConversationSessionIds) }
    }),
    client.formativeConversationMemorySnapshot.count({
      where: { formative_conversation_session_db_id: safeIn(formativeConversationSessionIds) }
    }),
    client.formativeConversationIntervention.count({
      where: { formative_conversation_session_db_id: safeIn(formativeConversationSessionIds) }
    }),
    client.formativeConversationReviewSignal.count({
      where: { formative_conversation_session_db_id: safeIn(formativeConversationSessionIds) }
    }),
    client.formativeConversationLifecycleEvent.count({
      where: { formative_conversation_session_db_id: safeIn(formativeConversationSessionIds) }
    }),
    client.formativeConversationTurnTelemetry.count({
      where: { formative_conversation_session_db_id: safeIn(formativeConversationSessionIds) }
    }),
    client.formativeConversationInputTelemetry.count({
      where: { formative_conversation_session_db_id: safeIn(formativeConversationSessionIds) }
    }),
    client.formativeConversationProfileTransitionTurnReference.count({
      where: { profile_transition_db_id: safeIn(formativeConversationProfileTransitionIds) }
    }),
    client.formativeConversationProfileEvidenceReference.count({
      where: { formative_conversation_session_db_id: safeIn(formativeConversationSessionIds) }
    }),
    client.postActivityDiagnosticSnapshot.count({
      where: {
        OR: [
          { evidence_record_db_id: safeIn(activityEvidenceIds) },
          { student_public_id: { in: studentPublicIds } },
          { session_public_id: { in: sessionPublicIds } },
          { activity_attempt_id: { in: activityAttemptPublicIds } }
        ]
      }
    }),
    client.operationalAgentEffectiveResult.count({
      where: {
        OR: [
          { agent_call_db_id: safeIn(agentCallIds) },
          {
            operational_context_public_id: {
              in: [
                ...sessionPublicIds,
                ...activityAttemptPublicIds,
                ...formativeConversationPublicIds
              ]
            }
          }
        ]
      }
    }),
    client.summativeOutcome.count({ where: { user_db_id: { in: studentDbIds } } }),
    client.studentAccountEvent.count({ where: { student_user_db_id: { in: studentDbIds } } }),
    client.exportJob.count({ where: { requested_by_user_db_id: { in: studentDbIds } } }),
    client.summativeOutcomeImportBatch.count({ where: { uploaded_by_user_db_id: { in: studentDbIds } } }),
    client.rosterImportBatch.count({ where: { uploaded_by_user_db_id: { in: studentDbIds } } }),
    client.operationalLiveCanaryDispatchAttempt.count({ where: { agent_call_db_id: safeIn(agentCallIds) } })
  ]);

  return {
    students,
    sessionIds,
    sessionPublicIds,
    conceptUnitSessionIds,
    followupRoundIds,
    agentCallIds,
    formativeConversationSessionIds,
    formativeConversationPublicIds,
    activityAttemptIds,
    activityAttemptPublicIds,
    activityEvidenceIds,
    studentSessionCounts,
    counts: {
      student_account_count: students.length,
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
      assessment_lifecycle_operation_count: assessmentLifecycleOperationCount,
      student_communication_count: studentCommunicationCount,
      topic_dialogue_count: topicDialogueCount,
      topic_dialogue_turn_count: topicDialogueTurnCount,
      formative_conversation_session_count: formativeConversationSessionIds.length,
      formative_conversation_message_receipt_count: formativeConversationMessageReceiptCount,
      formative_conversation_memory_snapshot_count: formativeConversationMemorySnapshotCount,
      formative_conversation_intervention_count: formativeConversationInterventionCount,
      formative_conversation_review_signal_count: formativeConversationReviewSignalCount,
      formative_conversation_lifecycle_event_count: formativeConversationLifecycleEventCount,
      formative_conversation_turn_telemetry_count: formativeConversationTurnTelemetryCount,
      formative_conversation_input_telemetry_count: formativeConversationInputTelemetryCount,
      formative_conversation_profile_transition_count: formativeConversationProfileTransitionIds.length,
      formative_conversation_profile_transition_turn_reference_count:
        formativeConversationProfileTransitionTurnReferenceCount,
      formative_conversation_profile_evidence_reference_count:
        formativeConversationProfileEvidenceReferenceCount,
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

function deletionWarnings() {
  return [
    STUDENT_DELETION_WARNING,
    "Deletion is irreversible inside this system. Use deactivation if an account may need to be restored."
  ];
}

function deletionLimitations() {
  return [
    "Previously downloaded exports, screenshots, or external copies are outside this system and cannot be removed here.",
    "Teacher-created content, item metadata, answer keys, and other students' records are retained.",
    "If an operational canary dispatch record ever referenced a deleted agent call, that canary audit row is retained and its agent-call foreign key is cleared by the database relation."
  ];
}

function publicPreview(graph: DeletionGraph): StudentDeletionPreview {
  const student = graph.students[0];

  if (!student || graph.students.length !== 1) {
    throw new StudentAccountServiceError(
      "student_deletion_preview_scope_invalid",
      "Single-student deletion preview requires exactly one student account.",
      500
    );
  }

  return {
    student_id: student.user_id,
    display_name: student.display_name,
    active_status: student.account_status,
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
      assessment_lifecycle_operation_count: graph.counts.assessment_lifecycle_operation_count,
      student_communication_count: graph.counts.student_communication_count,
      topic_dialogue_count: graph.counts.topic_dialogue_count,
      topic_dialogue_turn_count: graph.counts.topic_dialogue_turn_count,
      formative_conversation_session_count: graph.counts.formative_conversation_session_count,
      operational_effective_result_count: graph.counts.operational_effective_result_count,
      student_requested_export_job_count: graph.counts.student_requested_export_job_count,
      student_uploaded_summative_import_batch_count:
        graph.counts.student_uploaded_summative_import_batch_count,
      student_uploaded_roster_import_batch_count:
        graph.counts.student_uploaded_roster_import_batch_count
    },
    retained_reference_counts: graph.retained_reference_counts,
    warnings: deletionWarnings(),
    deletion_limitations: deletionLimitations()
  };
}

function publicBatchPreview(graph: DeletionGraph): StudentBatchDeletionPreview {
  return {
    selected_student_count: graph.students.length,
    students: [...graph.students]
      .sort((left, right) => left.user_id.localeCompare(right.user_id))
      .map((student) => ({
        student_id: student.user_id,
        display_name: student.display_name,
        active_status: student.account_status,
        assessment_session_count: graph.studentSessionCounts[student.user_id] ?? 0
      })),
    selection_fingerprint: studentSelectionFingerprint(graph.students),
    required_delete_confirmation: requiredBatchDeleteConfirmation(graph.students.length),
    warning: STUDENT_DELETION_WARNING,
    counts: graph.counts,
    retained_reference_counts: graph.retained_reference_counts,
    warnings: deletionWarnings(),
    deletion_limitations: deletionLimitations()
  };
}

export async function previewStudentDeletion(input: {
  teacher_user_db_id: string;
  user_id: string;
}): Promise<StudentDeletionPreview> {
  await assertTeacherResearcher(prisma, input.teacher_user_db_id);
  const student = await findStudentForDeletion(prisma, input.user_id);
  return publicPreview(await buildStudentDeletionGraph(prisma, [student]));
}

export async function previewStudentBatchDeletion(input: {
  teacher_user_db_id: string;
  data: z.input<typeof batchSelectionSchema>;
}): Promise<StudentBatchDeletionPreview> {
  const parsed = batchSelectionSchema.parse(input.data);
  await assertTeacherResearcher(prisma, input.teacher_user_db_id);
  const students = await findStudentsForDeletion(prisma, parsed.student_ids);
  return publicBatchPreview(await buildStudentDeletionGraph(prisma, students));
}

async function deleteStudentGraph(tx: Prisma.TransactionClient, graph: DeletionGraph) {
  const studentDbIds = graph.students.map((student) => student.id);
  const studentPublicIds = graph.students.map((student) => student.user_id);

  await tx.conceptUnitSession.updateMany({
    where: { id: safeIn(graph.conceptUnitSessionIds) },
    data: { latest_student_profile_db_id: null, latest_formative_decision_db_id: null }
  });

  await tx.postActivityDiagnosticSnapshot.deleteMany({
    where: {
      OR: [
        { evidence_record_db_id: safeIn(graph.activityEvidenceIds) },
        { student_public_id: { in: studentPublicIds } },
        { session_public_id: { in: graph.sessionPublicIds } },
        { activity_attempt_id: { in: graph.activityAttemptPublicIds } }
      ]
    }
  });
  await tx.activityMisconceptionEvidenceRecord.deleteMany({
    where: {
      OR: [
        { id: safeIn(graph.activityEvidenceIds) },
        { student_public_id: { in: studentPublicIds } },
        { session_public_id: { in: graph.sessionPublicIds } },
        { activity_attempt_id: { in: graph.activityAttemptPublicIds } }
      ]
    }
  });
  await tx.activityRuntimeAttempt.deleteMany({
    where: {
      OR: [
        { id: safeIn(graph.activityAttemptIds) },
        { student_public_id: { in: studentPublicIds } },
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
    where: {
      OR: [
        { assessment_session_db_id: safeIn(graph.sessionIds) },
        { created_by_user_db_id: { in: studentDbIds } }
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
  await tx.conceptUnitSession.deleteMany({ where: { id: safeIn(graph.conceptUnitSessionIds) } });
  await tx.assessmentSession.deleteMany({ where: { id: safeIn(graph.sessionIds) } });

  await tx.summativeOutcome.deleteMany({ where: { user_db_id: { in: studentDbIds } } });
  await tx.exportJob.deleteMany({ where: { requested_by_user_db_id: { in: studentDbIds } } });
  await tx.summativeOutcomeImportBatch.deleteMany({
    where: { uploaded_by_user_db_id: { in: studentDbIds } }
  });
  await tx.studentAccountEvent.deleteMany({
    where: { student_user_db_id: { in: studentDbIds } }
  });
  await tx.rosterImportBatch.deleteMany({
    where: { uploaded_by_user_db_id: { in: studentDbIds } }
  });
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

    const graph = await buildStudentDeletionGraph(tx, [student]);
    const preview = publicPreview(graph);
    const deletedAt = new Date();

    await deleteStudentGraph(tx, graph);

    const audit = await tx.studentAccountDeletionEvent.create({
      data: {
        id: randomUUID(),
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

export async function deleteStudentAccountsAndAssociatedData(input: {
  teacher_user_db_id: string;
  confirmation: z.input<typeof batchConfirmationSchema>;
}): Promise<StudentBatchDeletionSummary> {
  const parsed = batchConfirmationSchema.parse(input.confirmation);

  return prisma.$transaction(
    async (tx) => {
      await assertTeacherResearcher(tx, input.teacher_user_db_id);
      const students = await findStudentsForDeletion(tx, parsed.student_ids);
      const selectionFingerprint = studentSelectionFingerprint(students);
      const requiredConfirmation = requiredBatchDeleteConfirmation(students.length);

      if (
        parsed.selection_fingerprint !== selectionFingerprint ||
        parsed.delete_confirmation !== requiredConfirmation
      ) {
        throw new StudentAccountServiceError(
          "batch_delete_confirmation_mismatch",
          "Batch deletion requires the current selection fingerprint and exact confirmation phrase.",
          400,
          {
            required_delete_confirmation: requiredConfirmation,
            selection_changed: parsed.selection_fingerprint !== selectionFingerprint
          }
        );
      }

      const graph = await buildStudentDeletionGraph(tx, students);
      const preview = publicBatchPreview(graph);
      const deletedAt = new Date();
      const batchOperationPublicId = generatePublicId("student_account_batch_deletion");

      await deleteStudentGraph(tx, graph);

      const audits = await Promise.all(
        students.map((student) =>
          tx.studentAccountDeletionEvent.create({
            data: {
              id: randomUUID(),
              event_public_id: generatePublicId("student_account_deletion_event"),
              student_user_id_snapshot: student.user_id,
              performed_by_user_db_id: input.teacher_user_db_id,
              deletion_summary:
                toPrismaJson({
                  deletion_reason_code: "teacher_confirmed_student_account_batch_deletion",
                  batch_operation_public_id: batchOperationPublicId,
                  batch_size: students.length,
                  batch_deleted_counts: graph.counts,
                  retained_reference_counts: graph.retained_reference_counts,
                  warning: STUDENT_DELETION_WARNING,
                  deleted_at: deletedAt.toISOString()
                }) ?? {}
            }
          })
        )
      );

      const deletedUsers = await tx.user.deleteMany({
        where: { id: { in: students.map((student) => student.id) } }
      });

      if (deletedUsers.count !== students.length) {
        throw new StudentAccountServiceError(
          "batch_delete_user_count_mismatch",
          "Batch deletion did not remove the expected number of student accounts.",
          409,
          { expected_count: students.length, deleted_count: deletedUsers.count }
        );
      }

      return {
        ...preview,
        batch_operation_public_id: batchOperationPublicId,
        deletion_event_public_ids: audits.map((audit) => audit.event_public_id),
        deleted_at: deletedAt.toISOString(),
        deleted_counts: graph.counts
      };
    },
    { maxWait: 10_000, timeout: 180_000 }
  );
}
