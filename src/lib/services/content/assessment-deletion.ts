import { createHash, randomUUID } from "node:crypto";
import { Prisma, type AssessmentStatus } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { generatePublicId } from "@/lib/services/ids";
import { toPrismaJson } from "@/lib/services/json";
import { ContentServiceError } from "./errors";

export const ASSESSMENT_UNUSED_DELETE_CONFIRMATION = "DELETE";
export const ASSESSMENT_ALL_DATA_DELETE_CONFIRMATION = "DELETE ALL ASSESSMENT DATA";
const MAX_ARCHIVED_ASSESSMENT_BATCH_DELETION = 50;

const archivedAssessmentSelectionSchema = z.object({
  assessment_public_ids: z
    .array(z.string().trim().min(1))
    .min(1)
    .max(MAX_ARCHIVED_ASSESSMENT_BATCH_DELETION)
}).strict();

const archivedAssessmentDeletionSchema = archivedAssessmentSelectionSchema.extend({
  selection_fingerprint: z.string().length(64),
  delete_confirmation: z.string()
}).strict();

export type AssessmentDeletionMode = "unused_assessment" | "assessment_and_all_data";

type AssessmentDeletionClient = typeof prisma | Prisma.TransactionClient;

type AssessmentForDeletion = {
  id: string;
  assessment_public_id: string;
  title: string;
  status: AssessmentStatus;
  folder_label: string | null;
  created_by_user_db_id: string;
  updated_at: Date;
};

export type AssessmentDeletionCounts = {
  assessment_count: number;
  concept_unit_count: number;
  item_count: number;
  item_media_asset_count: number;
  option_count: number;
  assessment_session_count: number;
  distinct_student_count: number;
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
  item_verification_run_count: number;
  summative_outcome_count: number;
  import_export_reference_count: number;
  mcq_item_import_batch_count: number;
  mcq_diagnostic_authoring_agent_call_count: number;
};

export type AssessmentDeletionPreview = {
  assessment_public_id: string;
  assessment_title: string;
  status: AssessmentStatus;
  folder_label: string | null;
  counts: AssessmentDeletionCounts;
  retained_reference_counts: Record<string, number>;
  deletion_modes: {
    unused_assessment: {
      allowed: boolean;
      required_delete_confirmation: typeof ASSESSMENT_UNUSED_DELETE_CONFIRMATION;
      blocked_reasons: string[];
    };
    assessment_and_all_data: {
      allowed: boolean;
      required_delete_confirmation: typeof ASSESSMENT_ALL_DATA_DELETE_CONFIRMATION;
      blocked_reasons: string[];
    };
  };
  warnings: string[];
  deletion_limitations: string[];
};

export type AssessmentDeletionSummary = AssessmentDeletionPreview & {
  deletion_event_public_id: string;
  deletion_mode: AssessmentDeletionMode;
  deleted_at: string;
  deleted_counts: AssessmentDeletionCounts;
};

export type ArchivedAssessmentBatchDeletionPreview = {
  selected_assessment_count: number;
  assessments: Array<{
    assessment_public_id: string;
    assessment_title: string;
    status: AssessmentStatus;
    folder_label: string | null;
    item_count: number;
    assessment_session_count: number;
    allowed: boolean;
    blocked_reasons: string[];
  }>;
  allowed: boolean;
  blocked_assessments: Array<{
    assessment_public_id: string;
    assessment_title: string;
    blocked_reasons: string[];
  }>;
  selection_fingerprint: string;
  required_delete_confirmation: string;
  counts: AssessmentDeletionCounts;
  warning: string;
  deletion_limitations: string[];
};

export type ArchivedAssessmentBatchDeletionSummary = ArchivedAssessmentBatchDeletionPreview & {
  batch_operation_public_id: string;
  deletion_event_public_ids: string[];
  deleted_at: string;
  deleted_counts: AssessmentDeletionCounts;
};

type AssessmentDeletionGraph = {
  assessment: AssessmentForDeletion;
  conceptUnitIds: string[];
  conceptUnitPublicIds: string[];
  itemIds: string[];
  sessionIds: string[];
  sessionPublicIds: string[];
  studentUserDbIds: string[];
  conceptUnitSessionIds: string[];
  followupRoundIds: string[];
  agentCallIds: string[];
  itemVerificationRunIds: string[];
  itemVerificationAgentCallIds: string[];
  activityAttemptIds: string[];
  activityAttemptPublicIds: string[];
  activityEvidenceIds: string[];
  mcqImportBatchIds: string[];
  mcqAuthoringAgentCallIds: string[];
  counts: AssessmentDeletionCounts;
  retained_reference_counts: Record<string, number>;
};

function unique(values: Array<string | null | undefined>) {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function safeIn(values: string[]) {
  return values.length > 0 ? { in: values } : { in: ["00000000-0000-0000-0000-000000000000"] };
}

function publicHash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function collectAgentCallRefs(value: unknown): string[] {
  const refs = new Set<string>();

  function visit(entry: unknown) {
    if (Array.isArray(entry)) {
      for (const item of entry) visit(item);
      return;
    }

    const object = record(entry);
    if (!object) return;

    for (const key of ["agent_call_public_id", "agent_call_ref"]) {
      if (typeof object[key] === "string" && object[key].trim()) {
        refs.add(object[key].trim());
      }
    }

    const payloadRefs = object.agent_call_public_ids;
    if (Array.isArray(payloadRefs)) {
      for (const ref of payloadRefs) {
        if (typeof ref === "string" && ref.trim()) refs.add(ref.trim());
      }
    }

    for (const child of Object.values(object)) visit(child);
  }

  visit(value);
  return [...refs];
}

async function assertTeacherResearcher(client: AssessmentDeletionClient, teacherUserDbId: string) {
  const teacher = await client.user.findUnique({
    where: { id: teacherUserDbId },
    select: { role: true }
  });

  if (!teacher || teacher.role !== "teacher_researcher") {
    throw new ContentServiceError(
      "forbidden",
      "Only teacher_researcher users can delete assessments.",
      403
    );
  }
}

async function findAssessmentForDeletion(
  client: AssessmentDeletionClient,
  input: { teacher_user_db_id: string; assessment_public_id: string }
) {
  const assessment = await client.assessment.findFirst({
    where: {
      assessment_public_id: input.assessment_public_id,
      created_by_user_db_id: input.teacher_user_db_id
    },
    select: {
      id: true,
      assessment_public_id: true,
      title: true,
      status: true,
      folder_label: true,
      created_by_user_db_id: true,
      updated_at: true
    }
  });

  if (!assessment) {
    throw new ContentServiceError("not_found", "Assessment was not found.", 404);
  }

  return assessment;
}

function normalizedArchivedAssessmentIds(
  value: z.infer<typeof archivedAssessmentSelectionSchema>
) {
  const ids = [...new Set(value.assessment_public_ids)];
  if (ids.length !== value.assessment_public_ids.length) {
    throw new ContentServiceError(
      "validation_failed",
      "Each archived mini test may be selected only once.",
      400
    );
  }
  return ids;
}

const assessmentDeletionCountKeys: Array<keyof AssessmentDeletionCounts> = [
  "assessment_count",
  "concept_unit_count",
  "item_count",
  "item_media_asset_count",
  "option_count",
  "assessment_session_count",
  "distinct_student_count",
  "concept_unit_session_count",
  "item_response_count",
  "conversation_turn_count",
  "process_event_count",
  "response_package_count",
  "student_profile_count",
  "formative_decision_count",
  "followup_round_count",
  "followup_update_cycle_count",
  "concept_progression_record_count",
  "workflow_job_count",
  "workflow_override_count",
  "student_action_idempotency_key_count",
  "activity_runtime_count",
  "post_activity_evidence_count",
  "diagnostic_snapshot_count",
  "agent_call_summary_count",
  "operational_effective_result_count",
  "item_verification_run_count",
  "summative_outcome_count",
  "import_export_reference_count",
  "mcq_item_import_batch_count",
  "mcq_diagnostic_authoring_agent_call_count"
];

function sumAssessmentDeletionCounts(graphs: AssessmentDeletionGraph[]) {
  const counts = Object.fromEntries(
    assessmentDeletionCountKeys.map((key) => [
      key,
      graphs.reduce((total, graph) => total + graph.counts[key], 0)
    ])
  ) as AssessmentDeletionCounts;
  return counts;
}

function archivedAssessmentDeleteConfirmation(count: number) {
  return `DELETE ${count} ARCHIVED MINI ${count === 1 ? "TEST" : "TESTS"}`;
}

function archivedAssessmentSelectionFingerprint(graphs: AssessmentDeletionGraph[]) {
  return createHash("sha256")
    .update(
      JSON.stringify(
        [...graphs]
          .sort((left, right) =>
            left.assessment.assessment_public_id.localeCompare(
              right.assessment.assessment_public_id
            )
          )
          .map((graph) => ({
            assessment_public_id: graph.assessment.assessment_public_id,
            status: graph.assessment.status,
            updated_at: graph.assessment.updated_at.toISOString(),
            counts: graph.counts
          }))
      )
    )
    .digest("hex");
}

function studentDataCount(counts: AssessmentDeletionCounts) {
  return (
    counts.assessment_session_count +
    counts.concept_unit_session_count +
    counts.item_response_count +
    counts.conversation_turn_count +
    counts.process_event_count +
    counts.response_package_count +
    counts.student_profile_count +
    counts.formative_decision_count +
    counts.followup_round_count +
    counts.followup_update_cycle_count +
    counts.concept_progression_record_count +
    counts.workflow_job_count +
    counts.workflow_override_count +
    counts.student_action_idempotency_key_count +
    counts.activity_runtime_count +
    counts.post_activity_evidence_count +
    counts.diagnostic_snapshot_count +
    counts.agent_call_summary_count +
    counts.operational_effective_result_count
  );
}

async function buildAssessmentDeletionGraph(
  client: AssessmentDeletionClient,
  assessment: AssessmentForDeletion
): Promise<AssessmentDeletionGraph> {
  const conceptUnits = await client.conceptUnit.findMany({
    where: { assessment_db_id: assessment.id },
    select: { id: true, concept_unit_public_id: true }
  });
  const conceptUnitIds = conceptUnits.map((conceptUnit) => conceptUnit.id);
  const conceptUnitPublicIds = conceptUnits.map((conceptUnit) => conceptUnit.concept_unit_public_id);

  const items = await client.item.findMany({
    where: { concept_unit_db_id: safeIn(conceptUnitIds) },
    select: { id: true, options: true }
  });
  const itemIds = items.map((item) => item.id);
  const optionCount = items.reduce((total, item) => {
    return total + (Array.isArray(item.options) ? item.options.length : 0);
  }, 0);

  const sessions = await client.assessmentSession.findMany({
    where: { assessment_db_id: assessment.id },
    select: { id: true, session_public_id: true, user_db_id: true }
  });
  const sessionIds = sessions.map((session) => session.id);
  const sessionPublicIds = sessions.map((session) => session.session_public_id);
  const studentUserDbIds = unique(sessions.map((session) => session.user_db_id));

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
        { assessment_public_id: assessment.assessment_public_id },
        { session_public_id: { in: sessionPublicIds } },
        { concept_unit_id: { in: conceptUnitPublicIds } }
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

  const activityEvidence = await client.activityMisconceptionEvidenceRecord.findMany({
    where: {
      OR: [
        { assessment_public_id: assessment.assessment_public_id },
        { session_public_id: { in: sessionPublicIds } },
        { concept_unit_id: { in: conceptUnitPublicIds } },
        { activity_attempt_id: { in: activityAttemptPublicIds } }
      ]
    },
    select: { id: true, source_evaluator_agent_call_db_id: true }
  });
  const activityEvidenceIds = activityEvidence.map((record) => record.id);

  const itemVerificationRuns = await client.itemVerificationRun.findMany({
    where: { concept_unit_db_id: safeIn(conceptUnitIds) },
    select: { id: true, agent_call_db_id: true }
  });
  const itemVerificationRunIds = itemVerificationRuns.map((run) => run.id);
  const itemVerificationAgentCallIds = unique(itemVerificationRuns.map((run) => run.agent_call_db_id));

  const activityAgentCallIds = unique([
    ...activityAttempts.flatMap((attempt) => [
      attempt.first_turn_agent_call_db_id,
      attempt.reviewer_agent_call_db_id,
      attempt.repair_agent_call_db_id
    ]),
    ...activityEvidence.map((record) => record.source_evaluator_agent_call_db_id)
  ]);

  const mcqImportBatches = await client.mcqItemImportBatch.findMany({
    where: { assessment_db_id: assessment.id },
    select: {
      id: true,
      candidates_payload: true,
      suggestion_payload: true
    }
  });
  const mcqImportBatchIds = mcqImportBatches.map((batch) => batch.id);
  const mcqAuthoringAgentCallRefs = unique(
    mcqImportBatches.flatMap((batch) => [
      ...collectAgentCallRefs(batch.candidates_payload),
      ...collectAgentCallRefs(batch.suggestion_payload)
    ])
  );
  const mcqAuthoringAgentCalls = mcqAuthoringAgentCallRefs.length > 0
    ? await client.agentCall.findMany({
        where: {
          OR: [
            { client_request_id: { in: mcqAuthoringAgentCallRefs } },
            { agent_invocation_key: { in: mcqAuthoringAgentCallRefs } }
          ]
        },
        select: { id: true }
      })
    : [];
  const mcqAuthoringAgentCallIds = mcqAuthoringAgentCalls.map((call) => call.id);

  const agentCalls = await client.agentCall.findMany({
    where: {
      OR: [
        { assessment_session_db_id: safeIn(sessionIds) },
        { concept_unit_session_db_id: safeIn(conceptUnitSessionIds) },
        { followup_round_db_id: safeIn(followupRoundIds) },
        { id: safeIn([...activityAgentCallIds, ...itemVerificationAgentCallIds, ...mcqAuthoringAgentCallIds]) }
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
    itemMediaAssetCount,
    retainedDispatchAttemptReferenceCount,
    exportReferenceCount
  ] = await Promise.all([
    client.itemResponse.count({ where: { concept_unit_session_db_id: safeIn(conceptUnitSessionIds) } }),
    client.conversationTurn.count({
      where: {
        OR: [
          { assessment_session_db_id: safeIn(sessionIds) },
          { item_db_id: safeIn(itemIds) }
        ]
      }
    }),
    client.processEvent.count({
      where: {
        OR: [
          { assessment_session_db_id: safeIn(sessionIds) },
          { item_db_id: safeIn(itemIds) }
        ]
      }
    }),
    client.responsePackage.count({ where: { concept_unit_session_db_id: safeIn(conceptUnitSessionIds) } }),
    client.studentProfile.count({ where: { concept_unit_session_db_id: safeIn(conceptUnitSessionIds) } }),
    client.formativeDecision.count({ where: { concept_unit_session_db_id: safeIn(conceptUnitSessionIds) } }),
    client.followupUpdateCycle.count({ where: { assessment_session_db_id: safeIn(sessionIds) } }),
    client.conceptProgressionRecord.count({ where: { assessment_session_db_id: safeIn(sessionIds) } }),
    client.workflowJob.count({ where: { assessment_session_db_id: safeIn(sessionIds) } }),
    client.workflowOverride.count({ where: { assessment_session_db_id: safeIn(sessionIds) } }),
    client.studentActionIdempotencyKey.count({ where: { assessment_session_db_id: safeIn(sessionIds) } }),
    client.postActivityDiagnosticSnapshot.count({
      where: {
        OR: [
          { evidence_record_db_id: safeIn(activityEvidenceIds) },
          { assessment_public_id: assessment.assessment_public_id },
          { session_public_id: { in: sessionPublicIds } },
          { concept_unit_id: { in: conceptUnitPublicIds } },
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
    client.itemMediaAsset.count({ where: { item_db_id: safeIn(itemIds) } }),
    client.operationalLiveCanaryDispatchAttempt.count({ where: { agent_call_db_id: safeIn(agentCallIds) } }),
    client.exportJob.count({
      where: {
        options: {
          path: ["assessment_public_id"],
          equals: assessment.assessment_public_id
        }
      }
    })
  ]);

  return {
    assessment,
    conceptUnitIds,
    conceptUnitPublicIds,
    itemIds,
    sessionIds,
    sessionPublicIds,
    studentUserDbIds,
    conceptUnitSessionIds,
    followupRoundIds,
    agentCallIds,
    itemVerificationRunIds,
    itemVerificationAgentCallIds,
    activityAttemptIds,
    activityAttemptPublicIds,
    activityEvidenceIds,
    mcqImportBatchIds,
    mcqAuthoringAgentCallIds,
    counts: {
      assessment_count: 1,
      concept_unit_count: conceptUnitIds.length,
      item_count: itemIds.length,
      item_media_asset_count: itemMediaAssetCount,
      option_count: optionCount,
      assessment_session_count: sessionIds.length,
      distinct_student_count: studentUserDbIds.length,
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
      item_verification_run_count: itemVerificationRunIds.length,
      summative_outcome_count: 0,
      import_export_reference_count: exportReferenceCount,
      mcq_item_import_batch_count: mcqImportBatchIds.length,
      mcq_diagnostic_authoring_agent_call_count: mcqAuthoringAgentCallIds.length
    },
    retained_reference_counts: {
      operational_live_canary_dispatch_attempt_reference_count: retainedDispatchAttemptReferenceCount,
      export_job_reference_count: exportReferenceCount,
      summative_outcome_reference_count: 0
    }
  };
}

function publicPreview(graph: AssessmentDeletionGraph): AssessmentDeletionPreview {
  const unusedBlockedReasons: string[] = [];
  const studentDataRows = studentDataCount(graph.counts);

  if (graph.assessment.status !== "draft" && graph.assessment.status !== "archived") {
    unusedBlockedReasons.push("unused_delete_requires_draft_or_archived_status");
  }

  if (studentDataRows > 0) {
    unusedBlockedReasons.push("student_or_operational_records_exist");
  }

  return {
    assessment_public_id: graph.assessment.assessment_public_id,
    assessment_title: graph.assessment.title,
    status: graph.assessment.status,
    folder_label: graph.assessment.folder_label,
    counts: graph.counts,
    retained_reference_counts: graph.retained_reference_counts,
    deletion_modes: {
      unused_assessment: {
        allowed: unusedBlockedReasons.length === 0,
        required_delete_confirmation: ASSESSMENT_UNUSED_DELETE_CONFIRMATION,
        blocked_reasons: unusedBlockedReasons
      },
      assessment_and_all_data: {
        allowed: true,
        required_delete_confirmation: ASSESSMENT_ALL_DATA_DELETE_CONFIRMATION,
        blocked_reasons: []
      }
    },
    warnings: [
      "Archive is the normal reversible action. Permanent deletion is irreversible inside this system.",
      "Delete unused assessment removes only assessment authoring records when no student/session data exists.",
      "Delete all assessment data permanently removes associated sessions, responses, events, agent summaries, and activity evidence for this assessment."
    ],
    deletion_limitations: [
      "Assessment deletion removes item media metadata stored in this database. Externally hosted URLs are not objects owned by this system and do not require object deletion.",
      "Uploaded media object cleanup is not part of the database transaction in this local build. When object storage is enabled, cleanup must be handled by a retryable storage-cleanup path keyed by deleted media metadata.",
      "Previously downloaded exports, screenshots, LMS copies, and external files are outside this system and cannot be removed here.",
      "Export and import audit rows without hard assessment foreign keys are retained as safe references when present.",
      "MCQ import preview batches and associated formatting/diagnostic authoring agent audit rows are removed with the deleted assessment; raw imported source text and raw DOCX binaries are not retained in the deletion audit.",
      "The deletion audit stores aggregate counts and safe IDs only; deleted item content and student responses are not retained in the audit."
    ]
  };
}

export async function previewAssessmentDeletion(input: {
  teacher_user_db_id: string;
  assessment_public_id: string;
}): Promise<AssessmentDeletionPreview> {
  await assertTeacherResearcher(prisma, input.teacher_user_db_id);
  const assessment = await findAssessmentForDeletion(prisma, input);
  return publicPreview(await buildAssessmentDeletionGraph(prisma, assessment));
}

function assertDeletionConfirmation(input: {
  graph: AssessmentDeletionGraph;
  deletion_mode: AssessmentDeletionMode;
  assessment_confirmation: string;
  delete_confirmation: string;
  confirm_delete_all_assessment_data?: boolean;
}) {
  const matchesAssessment =
    input.assessment_confirmation === input.graph.assessment.assessment_public_id ||
    input.assessment_confirmation === input.graph.assessment.title;

  if (!matchesAssessment) {
    throw new ContentServiceError(
      "assessment_delete_confirmation_mismatch",
      "Assessment deletion requires the exact assessment title or public ID.",
      400,
      {
        required_assessment_public_id: input.graph.assessment.assessment_public_id
      }
    );
  }

  const preview = publicPreview(input.graph);

  if (input.deletion_mode === "unused_assessment") {
    if (!preview.deletion_modes.unused_assessment.allowed) {
      throw new ContentServiceError(
        "assessment_unused_delete_blocked",
        "Unused assessment deletion is allowed only for draft or archived assessments with no student/session data.",
        409,
        { blocked_reasons: preview.deletion_modes.unused_assessment.blocked_reasons }
      );
    }

    if (input.delete_confirmation !== ASSESSMENT_UNUSED_DELETE_CONFIRMATION) {
      throw new ContentServiceError(
        "assessment_delete_confirmation_mismatch",
        "Unused assessment deletion requires the exact DELETE confirmation.",
        400,
        { required_delete_confirmation: ASSESSMENT_UNUSED_DELETE_CONFIRMATION }
      );
    }

    return;
  }

  if (
    input.delete_confirmation !== ASSESSMENT_ALL_DATA_DELETE_CONFIRMATION ||
    input.confirm_delete_all_assessment_data !== true
  ) {
    throw new ContentServiceError(
      "assessment_delete_all_confirmation_mismatch",
      "Delete all assessment data requires the exact DELETE ALL ASSESSMENT DATA confirmation and a second confirmation.",
      400,
      { required_delete_confirmation: ASSESSMENT_ALL_DATA_DELETE_CONFIRMATION }
    );
  }
}

async function deleteAssessmentGraph(
  tx: Prisma.TransactionClient,
  graph: AssessmentDeletionGraph
) {
  await tx.conceptUnitSession.updateMany({
    where: { id: safeIn(graph.conceptUnitSessionIds) },
    data: { latest_student_profile_db_id: null, latest_formative_decision_db_id: null }
  });

  await tx.conceptUnit.updateMany({
    where: { id: safeIn(graph.conceptUnitIds) },
    data: { latest_item_verification_run_db_id: null }
  });

  await tx.postActivityDiagnosticSnapshot.deleteMany({
    where: {
      OR: [
        { evidence_record_db_id: safeIn(graph.activityEvidenceIds) },
        { assessment_public_id: graph.assessment.assessment_public_id },
        { session_public_id: { in: graph.sessionPublicIds } },
        { concept_unit_id: { in: graph.conceptUnitPublicIds } },
        { activity_attempt_id: { in: graph.activityAttemptPublicIds } }
      ]
    }
  });
  await tx.activityMisconceptionEvidenceRecord.deleteMany({
    where: {
      OR: [
        { id: safeIn(graph.activityEvidenceIds) },
        { assessment_public_id: graph.assessment.assessment_public_id },
        { session_public_id: { in: graph.sessionPublicIds } },
        { concept_unit_id: { in: graph.conceptUnitPublicIds } },
        { activity_attempt_id: { in: graph.activityAttemptPublicIds } }
      ]
    }
  });
  await tx.activityRuntimeAttempt.deleteMany({
    where: {
      OR: [
        { id: safeIn(graph.activityAttemptIds) },
        { assessment_public_id: graph.assessment.assessment_public_id },
        { session_public_id: { in: graph.sessionPublicIds } },
        { concept_unit_id: { in: graph.conceptUnitPublicIds } }
      ]
    }
  });

  await tx.workflowJob.deleteMany({ where: { assessment_session_db_id: safeIn(graph.sessionIds) } });
  await tx.workflowOverride.deleteMany({ where: { assessment_session_db_id: safeIn(graph.sessionIds) } });
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
    where: {
      OR: [
        { assessment_session_db_id: safeIn(graph.sessionIds) },
        { item_db_id: safeIn(graph.itemIds) }
      ]
    }
  });
  await tx.processEvent.deleteMany({
    where: {
      OR: [
        { assessment_session_db_id: safeIn(graph.sessionIds) },
        { item_db_id: safeIn(graph.itemIds) }
      ]
    }
  });
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

  await tx.operationalAgentEffectiveResult.deleteMany({
    where: { agent_call_db_id: safeIn(graph.itemVerificationAgentCallIds) }
  });
  await tx.itemVerificationRun.deleteMany({ where: { id: safeIn(graph.itemVerificationRunIds) } });
  await tx.agentCall.deleteMany({ where: { id: safeIn(graph.itemVerificationAgentCallIds) } });
  await tx.agentCall.deleteMany({ where: { id: safeIn(graph.mcqAuthoringAgentCallIds) } });
  await tx.mcqItemImportBatch.deleteMany({ where: { id: safeIn(graph.mcqImportBatchIds) } });
  await tx.item.deleteMany({ where: { id: safeIn(graph.itemIds) } });
  await tx.conceptUnit.deleteMany({ where: { id: safeIn(graph.conceptUnitIds) } });
  await tx.assessment.delete({ where: { id: graph.assessment.id } });
}

export async function deleteAssessmentAndAssociatedData(input: {
  teacher_user_db_id: string;
  assessment_public_id: string;
  deletion_mode: AssessmentDeletionMode;
  assessment_confirmation: string;
  delete_confirmation: string;
  confirm_delete_all_assessment_data?: boolean;
}): Promise<AssessmentDeletionSummary> {
  return prisma.$transaction(async (tx) => {
    await assertTeacherResearcher(tx, input.teacher_user_db_id);
    const assessment = await findAssessmentForDeletion(tx, input);
    const graph = await buildAssessmentDeletionGraph(tx, assessment);

    assertDeletionConfirmation({
      graph,
      deletion_mode: input.deletion_mode,
      assessment_confirmation: input.assessment_confirmation,
      delete_confirmation: input.delete_confirmation,
      confirm_delete_all_assessment_data: input.confirm_delete_all_assessment_data
    });

    const preview = publicPreview(graph);
    const deletedAt = new Date();

    await deleteAssessmentGraph(tx, graph);

    const audit = await tx.assessmentDeletionEvent.create({
      data: {
        id: randomUUID(),
        deletion_public_id: generatePublicId("assessment_deletion_event"),
        deleted_assessment_public_id: assessment.assessment_public_id,
        deleted_assessment_public_hash: publicHash(assessment.assessment_public_id),
        assessment_title_snapshot: assessment.title,
        performed_by_user_db_id: input.teacher_user_db_id,
        deletion_mode: input.deletion_mode,
        deletion_summary:
          toPrismaJson({
            deletion_mode: input.deletion_mode,
            deleted_counts: graph.counts,
            retained_reference_counts: graph.retained_reference_counts,
            warnings: preview.warnings,
            deletion_limitations: preview.deletion_limitations,
            deleted_at: deletedAt.toISOString()
          }) ?? {}
      }
    });

    return {
      ...preview,
      deletion_event_public_id: audit.deletion_public_id,
      deletion_mode: input.deletion_mode,
      deleted_at: deletedAt.toISOString(),
      deleted_counts: graph.counts
    };
  });
}

async function buildArchivedAssessmentBatchGraphs(
  client: AssessmentDeletionClient,
  input: { teacher_user_db_id: string; assessment_public_ids: string[] }
) {
  const graphs: AssessmentDeletionGraph[] = [];
  for (const assessmentPublicId of input.assessment_public_ids) {
    const assessment = await findAssessmentForDeletion(client, {
      teacher_user_db_id: input.teacher_user_db_id,
      assessment_public_id: assessmentPublicId
    });
    graphs.push(await buildAssessmentDeletionGraph(client, assessment));
  }
  return graphs;
}

function archivedAssessmentBatchPreview(
  graphs: AssessmentDeletionGraph[]
): ArchivedAssessmentBatchDeletionPreview {
  const assessments = graphs.map((graph) => {
    const unusedPreview = publicPreview(graph).deletion_modes.unused_assessment;
    const blockedReasons = [...unusedPreview.blocked_reasons];
    if (graph.assessment.status !== "archived") {
      blockedReasons.unshift("archived_status_required");
    }

    return {
      assessment_public_id: graph.assessment.assessment_public_id,
      assessment_title: graph.assessment.title,
      status: graph.assessment.status,
      folder_label: graph.assessment.folder_label,
      item_count: graph.counts.item_count,
      assessment_session_count: graph.counts.assessment_session_count,
      allowed: blockedReasons.length === 0,
      blocked_reasons: [...new Set(blockedReasons)]
    };
  });
  const blockedAssessments = assessments
    .filter((assessment) => !assessment.allowed)
    .map((assessment) => ({
      assessment_public_id: assessment.assessment_public_id,
      assessment_title: assessment.assessment_title,
      blocked_reasons: assessment.blocked_reasons
    }));

  return {
    selected_assessment_count: assessments.length,
    assessments,
    allowed: blockedAssessments.length === 0,
    blocked_assessments: blockedAssessments,
    selection_fingerprint: archivedAssessmentSelectionFingerprint(graphs),
    required_delete_confirmation: archivedAssessmentDeleteConfirmation(assessments.length),
    counts: sumAssessmentDeletionCounts(graphs),
    warning:
      "Permanent deletion cannot be undone. Only archived mini tests with no student sessions or student evidence are eligible.",
    deletion_limitations: [
      "Delete student sessions first if a trial mini test still has student data.",
      "Student accounts are never removed by archived mini-test deletion.",
      "Previously downloaded exports and external files remain outside this system."
    ]
  };
}

export async function previewArchivedAssessmentBatchDeletion(input: {
  teacher_user_db_id: string;
  data: unknown;
}): Promise<ArchivedAssessmentBatchDeletionPreview> {
  const parsed = archivedAssessmentSelectionSchema.parse(input.data);
  const assessmentPublicIds = normalizedArchivedAssessmentIds(parsed);
  await assertTeacherResearcher(prisma, input.teacher_user_db_id);
  const graphs = await buildArchivedAssessmentBatchGraphs(prisma, {
    teacher_user_db_id: input.teacher_user_db_id,
    assessment_public_ids: assessmentPublicIds
  });
  return archivedAssessmentBatchPreview(graphs);
}

export async function deleteArchivedAssessmentsAndAuthoringData(input: {
  teacher_user_db_id: string;
  data: unknown;
}): Promise<ArchivedAssessmentBatchDeletionSummary> {
  const parsed = archivedAssessmentDeletionSchema.parse(input.data);
  const assessmentPublicIds = normalizedArchivedAssessmentIds(parsed);

  return prisma.$transaction(async (tx) => {
    await assertTeacherResearcher(tx, input.teacher_user_db_id);
    const graphs = await buildArchivedAssessmentBatchGraphs(tx, {
      teacher_user_db_id: input.teacher_user_db_id,
      assessment_public_ids: assessmentPublicIds
    });
    const preview = archivedAssessmentBatchPreview(graphs);

    if (!preview.allowed) {
      throw new ContentServiceError(
        "assessment_unused_delete_blocked",
        "Archived mini tests can be deleted only when they have no student sessions or student evidence.",
        409,
        { blocked_assessments: preview.blocked_assessments }
      );
    }
    if (parsed.selection_fingerprint !== preview.selection_fingerprint) {
      throw new ContentServiceError(
        "assessment_delete_confirmation_mismatch",
        "The selected mini tests changed after the preview. Review the deletion again.",
        409
      );
    }
    if (parsed.delete_confirmation !== preview.required_delete_confirmation) {
      throw new ContentServiceError(
        "assessment_delete_confirmation_mismatch",
        "Archived mini-test deletion requires the exact confirmation shown in the preview.",
        400,
        { required_delete_confirmation: preview.required_delete_confirmation }
      );
    }

    const deletedAt = new Date();
    const batchOperationPublicId = generatePublicId("assessment_batch_deletion");
    const deletionEventPublicIds: string[] = [];

    for (const graph of graphs) {
      await deleteAssessmentGraph(tx, graph);
      const deletionEventPublicId = generatePublicId("assessment_deletion_event");
      await tx.assessmentDeletionEvent.create({
        data: {
          id: randomUUID(),
          deletion_public_id: deletionEventPublicId,
          deleted_assessment_public_id: graph.assessment.assessment_public_id,
          deleted_assessment_public_hash: publicHash(graph.assessment.assessment_public_id),
          assessment_title_snapshot: graph.assessment.title,
          performed_by_user_db_id: input.teacher_user_db_id,
          deletion_mode: "unused_assessment",
          deletion_summary:
            toPrismaJson({
              batch_operation_public_id: batchOperationPublicId,
              deletion_mode: "unused_assessment",
              deleted_counts: graph.counts,
              retained_reference_counts: graph.retained_reference_counts,
              deleted_at: deletedAt.toISOString()
            }) ?? {}
        }
      });
      deletionEventPublicIds.push(deletionEventPublicId);
    }

    return {
      ...preview,
      batch_operation_public_id: batchOperationPublicId,
      deletion_event_public_ids: deletionEventPublicIds,
      deleted_at: deletedAt.toISOString(),
      deleted_counts: preview.counts
    };
  }, { maxWait: 10_000, timeout: 180_000 });
}
