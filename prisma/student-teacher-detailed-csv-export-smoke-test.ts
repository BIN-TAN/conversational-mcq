import { parse } from "csv-parse/sync";
import { PrismaClient } from "@prisma/client";
import { hashSecret } from "../src/lib/password";
import { ContentServiceError } from "../src/lib/services/content/errors";
import { createResponsePackage } from "../src/lib/services/response-packages";
import { buildTeacherDetailedCsvBundle } from "../src/lib/services/teacher-detailed-csv-export/service";
import {
  downloadAssessmentCsv,
  downloadStudentCsv,
  listSimpleCsvExplorerOptions
} from "../src/lib/services/teacher-simple-csv-export/service";
import { normalizeUserId } from "../src/lib/services/student-accounts/validation";
import {
  cleanupTeacherReviewDemoFixture,
  ensureTeacherReviewDemoFixture,
  teacherReviewAssessmentPublicId
} from "./demo-teacher-review-fixture";

const prisma = new PrismaClient();

const noSessionAssessmentPublicId = "assessment_phase31p_no_sessions";
const legacyAssessmentPublicId = "assessment_phase31p_legacy_creator";
const legacyConceptUnitPublicId = "concept_phase31p_legacy";
const legacyItemPublicId = "item_phase31p_legacy_1";
const legacySessionPublicId = "session_phase31p_legacy_selected_student";
const legacyOtherTeacherUserId = "phase31p_other_teacher";
const legacyManagedStudentUserId = "phase31p_managed_student";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function parseCsv<T extends Record<string, string>>(content: string): T[] {
  return parse(content, {
    columns: true,
    skip_empty_lines: true
  }) as T[];
}

function fileData(files: Array<{ path: string; data: string }>, path: string) {
  const file = files.find((entry) => entry.path === path);
  assert(file, `Missing ${path} from detailed bundle.`);
  return file.data;
}

function assertNoProtectedContent(files: Array<{ path: string; data: string }>) {
  const forbidden = [
    "answer_key",
    "correct_option",
    "distractor_rationales",
    "possible_misconception_indicators",
    "raw_output",
    "input_payload",
    "output_payload",
    "process_payload",
    "password_hash",
    "access_code_hash",
    "authorization:",
    "bearer "
  ];

  for (const file of files) {
    const lower = file.data.toLowerCase();
    for (const term of forbidden) {
      assert(!lower.includes(term), `${file.path} leaked protected marker ${term}.`);
    }
  }
}

async function cleanupPhase31pRows() {
  const assessments = await prisma.assessment.findMany({
    where: {
      assessment_public_id: {
        in: [noSessionAssessmentPublicId, legacyAssessmentPublicId]
      }
    },
    select: { id: true }
  });
  const assessmentIds = assessments.map((assessment) => assessment.id);
  const sessions = await prisma.assessmentSession.findMany({
    where: { assessment_db_id: { in: assessmentIds } },
    select: { id: true }
  });
  const sessionIds = sessions.map((session) => session.id);
  const conceptUnitSessions = await prisma.conceptUnitSession.findMany({
    where: { assessment_session_db_id: { in: sessionIds } },
    select: { id: true }
  });
  const conceptUnitSessionIds = conceptUnitSessions.map((session) => session.id);

  await prisma.conceptUnitSession.updateMany({
    where: { id: { in: conceptUnitSessionIds } },
    data: {
      latest_student_profile_db_id: null,
      latest_formative_decision_db_id: null
    }
  });
  await prisma.studentActionIdempotencyKey.deleteMany({
    where: { assessment_session_db_id: { in: sessionIds } }
  });
  await prisma.agentCall.deleteMany({
    where: { assessment_session_db_id: { in: sessionIds } }
  });
  await prisma.conversationTurn.deleteMany({
    where: { assessment_session_db_id: { in: sessionIds } }
  });
  await prisma.followupRound.deleteMany({
    where: { concept_unit_session_db_id: { in: conceptUnitSessionIds } }
  });
  await prisma.formativeDecision.deleteMany({
    where: { concept_unit_session_db_id: { in: conceptUnitSessionIds } }
  });
  await prisma.studentProfile.deleteMany({
    where: { concept_unit_session_db_id: { in: conceptUnitSessionIds } }
  });
  await prisma.responsePackage.deleteMany({
    where: { concept_unit_session_db_id: { in: conceptUnitSessionIds } }
  });
  await prisma.workflowOverride.deleteMany({
    where: { assessment_session_db_id: { in: sessionIds } }
  });
  await prisma.workflowJob.deleteMany({
    where: { assessment_session_db_id: { in: sessionIds } }
  });
  await prisma.processEvent.deleteMany({
    where: { assessment_session_db_id: { in: sessionIds } }
  });
  await prisma.itemResponse.deleteMany({
    where: { concept_unit_session_db_id: { in: conceptUnitSessionIds } }
  });
  await prisma.conceptUnitSession.deleteMany({
    where: { id: { in: conceptUnitSessionIds } }
  });
  await prisma.assessmentSession.deleteMany({
    where: { id: { in: sessionIds } }
  });
  await prisma.item.deleteMany({
    where: { concept_unit: { assessment_db_id: { in: assessmentIds } } }
  });
  await prisma.conceptUnit.deleteMany({
    where: { assessment_db_id: { in: assessmentIds } }
  });
  await prisma.assessment.deleteMany({
    where: { id: { in: assessmentIds } }
  });
  await prisma.user.deleteMany({
    where: { user_id: { in: [legacyOtherTeacherUserId, legacyManagedStudentUserId] } }
  });
}

async function createPhase31pRows(teacherDbId: string) {
  const [otherTeacherPasswordHash, studentPasswordHash] = await Promise.all([
    hashSecret("phase31p_other_teacher_password"),
    hashSecret("phase31p_student_password")
  ]);
  const otherTeacher = await prisma.user.create({
    data: {
      user_id: legacyOtherTeacherUserId,
      user_id_normalized: normalizeUserId(legacyOtherTeacherUserId),
      display_name: "Phase 31p other teacher",
      role: "teacher_researcher",
      password_hash: otherTeacherPasswordHash
    }
  });
  const managedStudent = await prisma.user.create({
    data: {
      user_id: legacyManagedStudentUserId,
      user_id_normalized: normalizeUserId(legacyManagedStudentUserId),
      display_name: "Phase 31p managed student",
      role: "student",
      password_hash: studentPasswordHash,
      created_by_teacher_user_id: teacherDbId
    }
  });
  await prisma.assessment.create({
    data: {
      assessment_public_id: noSessionAssessmentPublicId,
      title: "Phase 31p No Sessions Assessment",
      status: "draft",
      created_by_user_db_id: teacherDbId
    }
  });
  const legacyAssessment = await prisma.assessment.create({
    data: {
      assessment_public_id: legacyAssessmentPublicId,
      title: "Phase 31p Legacy Creator Assessment",
      status: "published",
      created_by_user_db_id: otherTeacher.id
    }
  });
  const conceptUnit = await prisma.conceptUnit.create({
    data: {
      concept_unit_public_id: legacyConceptUnitPublicId,
      assessment_db_id: legacyAssessment.id,
      title: "Phase 31p legacy concept",
      learning_objective: "Verify selected-student export scope.",
      related_concept_description: "Synthetic export smoke concept.",
      administration_rules: { no_feedback_during_initial_administration: true },
      order_index: 1,
      status: "published",
      version: 1
    }
  });
  const item = await prisma.item.create({
    data: {
      item_public_id: legacyItemPublicId,
      concept_unit_db_id: conceptUnit.id,
      item_order: 1,
      item_stem: "Which statement best supports the synthetic export fixture?",
      options: [
        { label: "A", text: "The row belongs to the selected managed student." },
        { label: "B", text: "The row belongs to a deleted account." },
        { label: "C", text: "The row has no session." }
      ],
      correct_option: "A",
      distractor_rationales: { B: "Not the selected scope.", C: "A session exists." },
      expected_reasoning_patterns: ["Mentions the selected managed student scope."],
      possible_misconception_indicators: ["Confuses assessment creator with student scope."],
      administration_rules: { no_feedback_during_initial_administration: true },
      included_in_published_set: true,
      status: "published",
      version: 1
    }
  });
  const base = new Date("2026-07-10T15:00:00.000Z");
  const session = await prisma.assessmentSession.create({
    data: {
      session_public_id: legacySessionPublicId,
      user_db_id: managedStudent.id,
      assessment_db_id: legacyAssessment.id,
      attempt_number: 1,
      status: "completed",
      current_phase: "session_completed",
      current_concept_unit_db_id: conceptUnit.id,
      started_at: base,
      last_activity_at: new Date(base.getTime() + 180_000),
      completed_at: new Date(base.getTime() + 180_000)
    }
  });
  const conceptUnitSession = await prisma.conceptUnitSession.create({
    data: {
      assessment_session_db_id: session.id,
      concept_unit_db_id: conceptUnit.id,
      status: "completed",
      initial_started_at: base,
      initial_completed_at: new Date(base.getTime() + 180_000)
    }
  });
  await prisma.itemResponse.create({
    data: {
      concept_unit_session_db_id: conceptUnitSession.id,
      item_db_id: item.id,
      selected_option: "A",
      correct_option_snapshot: "A",
      correctness: "correct",
      reasoning_text: "The selected managed student has the synthetic export session.",
      confidence_rating: "medium",
      item_response_time_ms: 180_000,
      item_started_at: base,
      item_submitted_at: new Date(base.getTime() + 180_000),
      item_version_snapshot: 1,
      item_snapshot: {
        item_public_id: legacyItemPublicId,
        item_order: 1,
        version: 1
      },
      client_submission_id: "phase31p_legacy_item_response"
    }
  });
  await prisma.conversationTurn.createMany({
    data: [
      {
        assessment_session_db_id: session.id,
        concept_unit_session_db_id: conceptUnitSession.id,
        item_db_id: item.id,
        phase: "initial_item_administration",
        actor_type: "orchestrator",
        message_text: "Please choose an option for the synthetic export item.",
        structured_payload: { prompt_type: "request_answer" },
        created_at: base
      },
      {
        assessment_session_db_id: session.id,
        concept_unit_session_db_id: conceptUnitSession.id,
        item_db_id: item.id,
        phase: "initial_item_administration",
        actor_type: "student",
        message_text: "I choose A because the session belongs to this selected student.",
        structured_payload: { selected_option: "A" },
        created_at: new Date(base.getTime() + 30_000)
      }
    ]
  });
  await prisma.processEvent.createMany({
    data: [
      {
        assessment_session_db_id: session.id,
        concept_unit_session_db_id: conceptUnitSession.id,
        item_db_id: item.id,
        event_type: "item_presented",
        event_category: "student_response",
        event_source: "backend",
        payload: { item_public_id: legacyItemPublicId },
        occurred_at: base
      },
      {
        assessment_session_db_id: session.id,
        concept_unit_session_db_id: conceptUnitSession.id,
        item_db_id: item.id,
        event_type: "option_selected",
        event_category: "student_response",
        event_source: "backend",
        payload: { selected_option: "A" },
        occurred_at: new Date(base.getTime() + 30_000)
      },
      {
        assessment_session_db_id: session.id,
        concept_unit_session_db_id: conceptUnitSession.id,
        item_db_id: item.id,
        event_type: "item_submitted",
        event_category: "student_response",
        event_source: "backend",
        payload: { finalized: true },
        occurred_at: new Date(base.getTime() + 180_000)
      }
    ]
  });
  await createResponsePackage({
    concept_unit_session_db_id: conceptUnitSession.id,
    package_type: "initial_concept_unit_response_package",
    created_at: new Date(base.getTime() + 181_000)
  });
}

async function main() {
  process.env.LLM_PROVIDER = "mock";
  process.env.LLM_LIVE_CALLS_ENABLED = "false";
  process.env.RUN_LIVE_LLM_SMOKE = "";

  await cleanupPhase31pRows();
  await cleanupTeacherReviewDemoFixture(prisma);
  await ensureTeacherReviewDemoFixture(prisma);

  try {
    const teacher = await prisma.user.findUniqueOrThrow({ where: { user_id: "teacher_demo" } });
    await createPhase31pRows(teacher.id);

    const beforeCounts = {
      agent_calls: await prisma.agentCall.count(),
      activity_attempts: await prisma.activityRuntimeAttempt.count()
    };

    const noSessionOptions = await listSimpleCsvExplorerOptions({
      teacher_user_db_id: teacher.id
    });
    const noSessionAssessment = noSessionOptions.assessments.find(
      (assessment) => assessment.assessment_public_id === noSessionAssessmentPublicId
    );
    assert(noSessionAssessment, "No-session assessment should be visible in Data Explorer options.");
    assert(noSessionAssessment.counts.sessions === 0, "No-session assessment should report zero sessions.");
    assert(
      noSessionAssessment.availability === "No sessions",
      "No-session assessment should report a disabled availability state."
    );

    let noSessionRejected = false;
    try {
      await downloadAssessmentCsv({
        teacher_user_db_id: teacher.id,
        assessment_public_id: noSessionAssessmentPublicId
      });
    } catch (error) {
      assert(error instanceof ContentServiceError, "No-session assessment should fail with a typed content error.");
      assert(error.code === "no_session_data", "No-session assessment should use no_session_data.");
      assert(
        error.message === "No student sessions are available for this assessment.",
        "No-session assessment should return the expected teacher-facing message."
      );
      noSessionRejected = true;
    }
    assert(noSessionRejected, "No-session assessment export should be rejected.");

    const selectedStudentCsv = await downloadStudentCsv({
      teacher_user_db_id: teacher.id,
      student_user_id: legacyManagedStudentUserId
    });
    const selectedStudentRows = parseCsv<Record<string, string>>(selectedStudentCsv.content);
    assert(
      selectedStudentRows.some(
        (row) =>
          row.student_id === legacyManagedStudentUserId &&
          row.assessment_public_id === legacyAssessmentPublicId &&
          row.session_public_id === legacySessionPublicId
      ),
      "Selected-student CSV should include the managed student's session even when another teacher created the assessment."
    );

    const assessmentBundle = await buildTeacherDetailedCsvBundle({
      teacher_user_db_id: teacher.id,
      scope: "selected_assessment",
      assessment_public_id: teacherReviewAssessmentPublicId
    });
    assert(
      assessmentBundle.files.map((file) => file.path).join("|") ===
        "analysis_rows.csv|process_events.csv|turn_response_latencies.csv|conversation_turns.csv",
      "Detailed bundle should contain exactly the four analysis-ready CSV files in deterministic order."
    );
    assert(assessmentBundle.no_live_provider_call_made === true, "Detailed export should not make provider calls.");
    assertNoProtectedContent(assessmentBundle.files);

    const analysisRows = parseCsv<Record<string, string>>(fileData(assessmentBundle.files, "analysis_rows.csv"));
    const processRows = parseCsv<Record<string, string>>(fileData(assessmentBundle.files, "process_events.csv"));
    const latencyRows = parseCsv<Record<string, string>>(fileData(assessmentBundle.files, "turn_response_latencies.csv"));
    const conversationRows = parseCsv<Record<string, string>>(fileData(assessmentBundle.files, "conversation_turns.csv"));

    assert(analysisRows.length >= 3, "Detailed analysis rows should include item-level rows.");
    assert(processRows.length > 0, "Detailed process event CSV should include events.");
    assert(latencyRows.length > 0, "Detailed latency CSV should include prompt-to-response rows.");
    assert(conversationRows.length > 0, "Detailed conversation CSV should include readable turns.");
    assert(
      processRows.every((row) => !("payload" in row) && !("raw_payload" in row)),
      "Process event CSV should not include raw payload columns."
    );
    assert(
      latencyRows.every((row) => {
        if (!row.response_latency_ms) return true;
        return Number(row.response_latency_ms) >= 0;
      }),
      "Latency rows should be nonnegative when present."
    );
    assert(
      analysisRows.every((row) => row.export_run_public_id && row.database_instance_fingerprint),
      "Detailed analysis rows should include safe export-source identity."
    );
    assert(
      analysisRows.some((row) => row.interpretation_limitations.includes("contextual")),
      "Detailed analysis rows should carry process interpretation boundary notes."
    );

    const legacyStudentBundle = await buildTeacherDetailedCsvBundle({
      teacher_user_db_id: teacher.id,
      scope: "selected_student",
      student_user_id: legacyManagedStudentUserId
    });
    const legacyAnalysisRows = parseCsv<Record<string, string>>(
      fileData(legacyStudentBundle.files, "analysis_rows.csv")
    );
    assert(
      legacyAnalysisRows.some((row) => row.session_public_id === legacySessionPublicId),
      "Detailed selected-student bundle should include the managed legacy session."
    );

    const afterCounts = {
      agent_calls: await prisma.agentCall.count(),
      activity_attempts: await prisma.activityRuntimeAttempt.count()
    };
    assert(
      beforeCounts.agent_calls === afterCounts.agent_calls &&
        beforeCounts.activity_attempts === afterCounts.activity_attempts,
      "Detailed CSV export should be read-only and should not create agent calls or activity attempts."
    );

    console.log("Teacher detailed CSV export smoke test passed.");
  } finally {
    await cleanupPhase31pRows();
    await cleanupTeacherReviewDemoFixture(prisma);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
