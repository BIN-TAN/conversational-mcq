import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/db";
import { assertStudentPayloadIsSafe } from "@/lib/services/student-assessment/serializers";
import { getStudentSessionState } from "@/lib/services/student-assessment/service";
import { buildResearchExportIntegrityReview } from "@/lib/services/teacher-research-export/integrity-review";
import { buildTeacherResearchBulkExport } from "@/lib/services/teacher-research-export/service";
import { getTeacherReadableTranscript } from "@/lib/services/teacher-review/readable-transcript";
import { getTeacherReviewSessionDetail } from "@/lib/services/teacher-review/session-detail";
import { buildTeacherSessionDataAudit } from "@/lib/services/teacher-review/session-data-audit";
import { getTeacherReviewTranscript } from "@/lib/services/teacher-review/transcripts";

export const CLASSROOM_PILOT_WORKFLOW_REVIEW_VERSION =
  "classroom-pilot-workflow-review-v1" as const;

type ReviewStatus = "passed" | "completed_with_limitations" | "failed";

type SessionSummary = {
  session_public_id: string;
  status: string;
  current_phase: string;
  attempt_number: number;
  student_user_id: string;
  assessment_public_id: string;
  assessment_title: string;
  created_at: string;
  last_activity_at: string | null;
  completed_at: string | null;
};

type CheckOutcome = {
  passed: boolean;
  limitation?: string;
};

function iso(value?: Date | null) {
  return value ? value.toISOString() : null;
}

function timestampSlug() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function sessionSummary(session: {
  session_public_id: string;
  status: string;
  current_phase: string;
  attempt_number: number;
  created_at: Date;
  last_activity_at: Date | null;
  completed_at: Date | null;
  user: { user_id: string };
  assessment: { assessment_public_id: string; title: string };
}): SessionSummary {
  return {
    session_public_id: session.session_public_id,
    status: session.status,
    current_phase: session.current_phase,
    attempt_number: session.attempt_number,
    student_user_id: session.user.user_id,
    assessment_public_id: session.assessment.assessment_public_id,
    assessment_title: session.assessment.title,
    created_at: session.created_at.toISOString(),
    last_activity_at: iso(session.last_activity_at),
    completed_at: iso(session.completed_at)
  };
}

function redactedError(error: unknown) {
  return error instanceof Error ? error.message : "unknown_error";
}

function assertNoProtectedContent(value: unknown, label: string) {
  const text = JSON.stringify(value).toLowerCase();
  const blocked = [
    /"password_hash"\s*:/,
    /"access_code_hash"\s*:/,
    /"api_key"\s*:/,
    /authorization\s*:/,
    /bearer\s+[a-z0-9._-]{10,}/,
    /"session_secret"\s*:/,
    /"database_url"\s*:/,
    /"raw_output"\s*:/,
    /"input_payload"\s*:/,
    /"output_payload"\s*:/,
    /"correct_option"\s*:/,
    /"correct_option_snapshot"\s*:/,
    /"answer_key"\s*:/,
    /"distractor_rationales"\s*:/,
    /"possible_misconception_indicators"\s*:/,
    /"expected_reasoning_patterns"\s*:/,
    /"misconception_ids?"\s*:/,
    /\bthe correct answer is\b/,
    /\bthe answer is\b/
  ];

  for (const pattern of blocked) {
    if (pattern.test(text)) {
      throw new Error(`${label} includes protected content matching ${pattern.source}.`);
    }
  }
}

async function safeCheck(
  limitations: string[],
  checkName: string,
  action: () => Promise<void>
): Promise<CheckOutcome> {
  try {
    await action();
    return { passed: true };
  } catch (error) {
    const limitation = `${checkName}:${redactedError(error)}`;
    limitations.push(limitation);
    return { passed: false, limitation };
  }
}

async function latestSessions() {
  const select = {
    session_public_id: true,
    status: true,
    current_phase: true,
    attempt_number: true,
    created_at: true,
    last_activity_at: true,
    completed_at: true,
    user_db_id: true,
    user: { select: { user_id: true } },
    assessment: { select: { assessment_public_id: true, title: true } }
  } as const;

  const [latestCompleted, latestIncomplete] = await Promise.all([
    prisma.assessmentSession.findFirst({
      where: { status: "completed" },
      orderBy: [{ completed_at: "desc" }, { last_activity_at: "desc" }, { created_at: "desc" }],
      select
    }),
    prisma.assessmentSession.findFirst({
      where: { status: { not: "completed" } },
      orderBy: [{ last_activity_at: "desc" }, { created_at: "desc" }],
      select
    })
  ]);

  return { latestCompleted, latestIncomplete };
}

export async function buildClassroomPilotWorkflowReview(input: {
  write_artifact?: boolean;
  output_dir?: string;
} = {}) {
  const generatedAt = new Date().toISOString();
  const limitations: string[] = [];
  const { latestCompleted, latestIncomplete } = await latestSessions();
  const targetSession = latestCompleted ?? latestIncomplete;

  let teacherReviewAvailable = false;
  let sessionEvidenceAuditAvailable = false;
  let readableTranscriptAvailable = false;
  let structuredEventLogAvailable = false;
  let studentSafetyProjectionPassed = false;
  let teacherExportSafetyPassed = false;
  let activityRuntimeAvailable = false;
  let bulkExportAvailable = false;
  let dataIntegrityReviewAvailable = false;
  let activityAttemptCount = 0;
  let postActivityEvidenceCount = 0;
  let postActivitySnapshotCount = 0;
  let readableTurnCount = 0;
  let structuredTurnCount = 0;
  let processEventCount = 0;
  let responsePackageCount = 0;
  let bulkExportFileCount = 0;
  let integrityFindingCount = 0;
  let integrityFailureCount = 0;

  if (!targetSession) {
    limitations.push("no_assessment_sessions_available_for_workflow_review");
  } else {
    await safeCheck(limitations, "teacher_session_detail", async () => {
      const detail = await getTeacherReviewSessionDetail(targetSession.session_public_id);
      teacherReviewAvailable = detail.session.session_public_id === targetSession.session_public_id;
    });

    await safeCheck(limitations, "session_evidence_audit", async () => {
      const audit = await buildTeacherSessionDataAudit({
        session_public_id: targetSession.session_public_id,
        write_artifact: false
      });
      sessionEvidenceAuditAvailable = audit.session_public_id === targetSession.session_public_id;
      processEventCount = audit.process_data_summary.process_event_count;
      responsePackageCount = audit.data_completeness.response_package.package_count;
      activityAttemptCount = audit.activity_runtime_summary.attempt_count;
      postActivityEvidenceCount = audit.misconception_evidence_summary.record_count;
      postActivitySnapshotCount = audit.diagnostic_snapshot_summary.snapshot_count;
      activityRuntimeAvailable = true;
      assertNoProtectedContent(audit, "session evidence audit");
      limitations.push(...audit.limitations.map((entry) => `target_session:${entry}`));
    });

    await safeCheck(limitations, "readable_transcript", async () => {
      const readable = await getTeacherReadableTranscript(targetSession.session_public_id);
      readableTranscriptAvailable = readable.session_public_id === targetSession.session_public_id;
      readableTurnCount = readable.turns.length;
      assertNoProtectedContent(readable, "readable transcript");
    });

    await safeCheck(limitations, "structured_event_log", async () => {
      const structured = await getTeacherReviewTranscript(targetSession.session_public_id);
      structuredEventLogAvailable = structured.session_public_id === targetSession.session_public_id;
      structuredTurnCount = structured.turns.length;
      assertNoProtectedContent(structured, "structured event log");
    });

    await safeCheck(limitations, "student_safe_projection", async () => {
      const state = await getStudentSessionState({
        student_user_db_id: targetSession.user_db_id,
        session_public_id: targetSession.session_public_id
      });
      assertStudentPayloadIsSafe(state);
      assertNoProtectedContent(state, "student-safe session projection");
      studentSafetyProjectionPassed = true;
    });
  }

  await safeCheck(limitations, "bulk_research_export", async () => {
    const exportResult = await buildTeacherResearchBulkExport({
      generated_by_role: "teacher_researcher"
    });
    bulkExportAvailable = exportResult.files.length > 0 && exportResult.buffer.length > 0;
    bulkExportFileCount = exportResult.files.length;
    teacherExportSafetyPassed = true;
  });

  await safeCheck(limitations, "research_export_integrity_review", async () => {
    const review = await buildResearchExportIntegrityReview({
      write_artifact: false
    });
    dataIntegrityReviewAvailable = true;
    integrityFindingCount = review.findings.length;
    integrityFailureCount = review.findings.filter((finding) => finding.severity === "failure").length;
    if (review.summary.status === "failed") {
      throw new Error("research_export_integrity_failed");
    }
    limitations.push(...review.findings.map((finding) => `research_export:${finding.code}`));
  });

  const checks = {
    student_session_flow_available: Boolean(targetSession),
    activity_runtime_available: activityRuntimeAvailable,
    teacher_review_available: teacherReviewAvailable,
    session_evidence_audit_available: sessionEvidenceAuditAvailable,
    readable_transcript_available: readableTranscriptAvailable,
    structured_event_log_available: structuredEventLogAvailable,
    bulk_export_available: bulkExportAvailable,
    data_integrity_review_available: dataIntegrityReviewAvailable,
    student_safety_projection_passed: studentSafetyProjectionPassed,
    teacher_export_safety_passed: teacherExportSafetyPassed
  };

  const failedRequiredCheck = Object.values(checks).some((value) => !value);
  const status: ReviewStatus =
    failedRequiredCheck || integrityFailureCount > 0
      ? "failed"
      : limitations.length > 0
        ? "completed_with_limitations"
        : "passed";

  const review = {
    artifact_version: CLASSROOM_PILOT_WORKFLOW_REVIEW_VERSION,
    generated_at: generatedAt,
    status,
    no_openai_call_made: true,
    classroom_validity: false,
    target_session_public_id: targetSession?.session_public_id ?? null,
    latest_completed_session: latestCompleted ? sessionSummary(latestCompleted) : null,
    latest_incomplete_session: latestIncomplete ? sessionSummary(latestIncomplete) : null,
    ...checks,
    target_session_data_counts: {
      process_event_count: processEventCount,
      response_package_count: responsePackageCount,
      readable_turn_count: readableTurnCount,
      structured_turn_count: structuredTurnCount,
      activity_runtime_attempt_count: activityAttemptCount,
      post_activity_evidence_count: postActivityEvidenceCount,
      post_activity_snapshot_count: postActivitySnapshotCount
    },
    export_summary: {
      bulk_export_file_count: bulkExportFileCount,
      integrity_finding_count: integrityFindingCount,
      integrity_failure_count: integrityFailureCount
    },
    known_limitations: [...new Set(limitations)]
  };

  let artifactPath: string | null = null;
  if (input.write_artifact) {
    const outputDir =
      input.output_dir ?? path.join(process.cwd(), ".data", "classroom-pilot-workflow-review");
    await mkdir(outputDir, { recursive: true });
    artifactPath = path.join(outputDir, `classroom-pilot-workflow-review-${timestampSlug()}.json`);
    await writeFile(artifactPath, `${JSON.stringify(review, null, 2)}\n`, "utf8");
  }

  return {
    ...review,
    artifact_path: artifactPath
  };
}
