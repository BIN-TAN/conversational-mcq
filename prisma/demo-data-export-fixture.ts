import { PrismaClient } from "@prisma/client";
import type { Prisma } from "@prisma/client";
import { hashSecret } from "../src/lib/password";
import { createResponsePackage } from "../src/lib/services/response-packages";
import { deleteExportFile } from "../src/lib/services/master-export/storage";
import { ensureTeacherReviewDemoUsers } from "./demo-teacher-review-fixture";

export const dataExportAssessmentPublicId = "assessment_demo_data_export";
export const dataExportConceptUnitPublicId = "concept_demo_data_export_initial";
export const dataExportItemPublicIds = [
  "item_demo_data_export_1",
  "item_demo_data_export_2",
  "item_demo_data_export_3"
] as const;
export const dataExportCompleteSessionPublicId = "session_demo_data_export_complete";
export const dataExportIncompleteSessionPublicId = "session_demo_data_export_incomplete";
export const dataExportSkippedSessionPublicId = "session_demo_data_export_skipped";
export const dataExportSecondStudentUserId = "student_export_demo";
export const dataExportSecondStudentAccessCode = "student_export_demo_access_code";
export const dataExportOutcomeNames = ["final_exam", "final_course_score"] as const;

function minutesAfter(base: Date, minutes: number) {
  return new Date(base.getTime() + minutes * 60_000);
}

function demoOptions() {
  return [
    { label: "A", text: "The evidence supports the target relationship." },
    { label: "B", text: "The relationship is reversed." },
    { label: "C", text: "The response uses an unrelated detail." }
  ];
}

function itemSnapshot(item: {
  item_public_id: string;
  item_order: number;
  item_stem: string;
  options: Prisma.JsonValue;
  correct_option: string;
  version: number;
}) {
  return {
    item_public_id: item.item_public_id,
    item_order: item.item_order,
    item_stem: item.item_stem,
    options: item.options,
    correct_option: item.correct_option,
    version: item.version
  };
}

async function ensureDataExportUsers(prisma: PrismaClient) {
  const { teacher, student } = await ensureTeacherReviewDemoUsers(prisma);
  const accessCodeHash = await hashSecret(dataExportSecondStudentAccessCode);
  const secondStudent = await prisma.user.upsert({
    where: { user_id: dataExportSecondStudentUserId },
    update: {
      role: "student",
      password_hash: null,
      access_code_hash: accessCodeHash
    },
    create: {
      user_id: dataExportSecondStudentUserId,
      role: "student",
      access_code_hash: accessCodeHash
    }
  });

  return { teacher, student, secondStudent };
}

async function cleanupAssessmentRecords(prisma: PrismaClient) {
  const assessment = await prisma.assessment.findUnique({
    where: { assessment_public_id: dataExportAssessmentPublicId },
    select: { id: true }
  });

  if (!assessment) {
    return false;
  }

  const sessions = await prisma.assessmentSession.findMany({
    where: { assessment_db_id: assessment.id },
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
  await prisma.agentCall.deleteMany({
    where: { assessment_session_db_id: { in: sessionIds } }
  });
  await prisma.processEvent.deleteMany({
    where: { assessment_session_db_id: { in: sessionIds } }
  });
  await prisma.conversationTurn.deleteMany({
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
    where: { concept_unit: { assessment_db_id: assessment.id } }
  });
  await prisma.conceptUnit.deleteMany({
    where: { assessment_db_id: assessment.id }
  });
  await prisma.assessment.delete({
    where: { id: assessment.id }
  });

  return true;
}

async function cleanupOutcomeAndExportRecords(prisma: PrismaClient) {
  const userIds = ["student_demo", dataExportSecondStudentUserId];
  const jobs = await prisma.exportJob.findMany({
    select: { id: true, options: true, storage_key: true }
  });
  const fixtureJobs = jobs.filter((job) => {
    const options = job.options;

    return (
      options &&
      typeof options === "object" &&
      !Array.isArray(options) &&
      (options as Record<string, unknown>).assessment_public_id === dataExportAssessmentPublicId
    );
  });

  for (const job of fixtureJobs) {
    if (job.storage_key) {
      await deleteExportFile(job.storage_key).catch(() => undefined);
    }
  }

  await prisma.exportJob.deleteMany({
    where: { id: { in: fixtureJobs.map((job) => job.id) } }
  });
  await prisma.summativeOutcome.deleteMany({
    where: {
      user_id_snapshot: { in: userIds },
      outcome_name: { in: [...dataExportOutcomeNames] }
    }
  });
  await prisma.summativeOutcomeImportBatch.deleteMany({
    where: {
      OR: [
        { source_file_name: { startsWith: "data-export-demo" } },
        { source_file_name: { startsWith: "summative-import-smoke" } }
      ]
    }
  });
}

async function createFixtureAssessment(prisma: PrismaClient, teacherId: string) {
  const assessment = await prisma.assessment.create({
    data: {
      assessment_public_id: dataExportAssessmentPublicId,
      title: "Development Demo: Data Export",
      description: "Development-only fixture for summative outcomes and master CSV export.",
      status: "published",
      created_by_user_db_id: teacherId
    }
  });
  const conceptUnit = await prisma.conceptUnit.create({
    data: {
      concept_unit_public_id: dataExportConceptUnitPublicId,
      assessment_db_id: assessment.id,
      title: "Data export demo concept",
      learning_objective: "Provide mixed item evidence for CSV export verification.",
      related_concept_description:
        "Fixture concept used to test complete, incomplete, and skipped evidence exports.",
      administration_rules: { no_feedback_during_initial_administration: true },
      order_index: 1,
      status: "published",
      version: 1
    }
  });
  const stems = [
    "Which option best connects the observation to the target concept?",
    "Which claim is best supported by the graph described in the prompt?",
    "Which conclusion follows from the investigation record?"
  ];
  const items = [];

  for (const itemOrder of [1, 2, 3]) {
    items.push(
      await prisma.item.create({
        data: {
          item_public_id: dataExportItemPublicIds[itemOrder - 1],
          concept_unit_db_id: conceptUnit.id,
          item_order: itemOrder,
          item_stem: stems[itemOrder - 1],
          options: demoOptions(),
          correct_option: "A",
          distractor_rationales: {
            B: "This reverses the relationship.",
            C: "This uses an unrelated cue."
          },
          expected_reasoning_patterns: ["Connects the selected option to provided evidence."],
          possible_misconception_indicators: ["Uses a reversed relationship or unrelated cue."],
          administration_rules: { no_feedback_during_initial_administration: true },
          included_in_published_set: true,
          status: "published",
          version: 1
        }
      })
    );
  }

  return { assessment, conceptUnit, items };
}

async function addInitialPackageSession(input: {
  prisma: PrismaClient;
  userDbId: string;
  assessmentDbId: string;
  conceptUnitDbId: string;
  items: Array<{
    id: string;
    item_public_id: string;
    item_order: number;
    item_stem: string;
    options: Prisma.JsonValue;
    correct_option: string;
    version: number;
  }>;
  sessionPublicId: string;
  attemptNumber: number;
  status: "active" | "completed";
  currentPhase: "profiling_pending" | "session_completed";
  base: Date;
  skipped: boolean;
}) {
  const session = await input.prisma.assessmentSession.create({
    data: {
      session_public_id: input.sessionPublicId,
      user_db_id: input.userDbId,
      assessment_db_id: input.assessmentDbId,
      attempt_number: input.attemptNumber,
      status: input.status,
      current_phase: input.currentPhase,
      current_concept_unit_db_id: input.conceptUnitDbId,
      started_at: input.base,
      last_activity_at: minutesAfter(input.base, 20),
      completed_at: input.status === "completed" ? minutesAfter(input.base, 24) : null
    }
  });
  const conceptUnitSession = await input.prisma.conceptUnitSession.create({
    data: {
      assessment_session_db_id: session.id,
      concept_unit_db_id: input.conceptUnitDbId,
      status: input.status === "completed" ? "completed" : "initial_completed",
      initial_started_at: minutesAfter(input.base, 1),
      initial_completed_at: minutesAfter(input.base, 20),
      followup_status: "not_started",
      followup_round_count: 0
    }
  });

  const responses = input.items.map((item, index) => {
    const skipped = input.skipped && index === 2;
    const selected = skipped ? null : index === 1 ? "B" : "A";

    return {
      concept_unit_session_db_id: conceptUnitSession.id,
      item_db_id: item.id,
      selected_option: selected,
      correct_option_snapshot: item.correct_option,
      correctness: skipped ? "unanswered" : selected === item.correct_option ? "correct" : "incorrect",
      reasoning_text: skipped
        ? null
        : index === 0
          ? "=This formula-like reasoning is student text and should be protected in spreadsheets."
          : "I used the evidence in the prompt, but I may have reversed the relationship.",
      confidence_rating: skipped ? null : index === 0 ? "high" : "medium",
      item_response_time_ms: index === 0 ? 78_000 : index === 1 ? 125_000 : 64_000,
      item_started_at: minutesAfter(input.base, 2 + index * 5),
      item_submitted_at: minutesAfter(input.base, 5 + index * 5),
      skipped_reasoning: skipped,
      skipped_confidence: skipped,
      skipped_item: skipped,
      revision_count: index === 1 ? 1 : 0,
      missing_evidence_repair_offered: skipped,
      item_version_snapshot: item.version,
      item_snapshot: itemSnapshot(item),
      client_submission_id: `${input.sessionPublicId}_item_${index + 1}`
    } satisfies Prisma.ItemResponseUncheckedCreateInput;
  });

  await input.prisma.itemResponse.createMany({ data: responses });
  await input.prisma.conversationTurn.createMany({
    data: [
      {
        assessment_session_db_id: session.id,
        concept_unit_session_db_id: conceptUnitSession.id,
        item_db_id: input.items[0].id,
        phase: "initial_item_administration",
        actor_type: "orchestrator",
        message_text: "Please choose an option for item 1.",
        structured_payload: { item_public_id: input.items[0].item_public_id },
        created_at: minutesAfter(input.base, 2)
      },
      {
        assessment_session_db_id: session.id,
        concept_unit_session_db_id: conceptUnitSession.id,
        item_db_id: input.items[0].id,
        phase: "initial_item_administration",
        actor_type: "student",
        message_text:
          "=I choose A because the observation supports that relationship.",
        structured_payload: { selected_option: "A", confidence_rating: "high" },
        created_at: minutesAfter(input.base, 4)
      },
      {
        assessment_session_db_id: session.id,
        concept_unit_session_db_id: conceptUnitSession.id,
        item_db_id: input.items[2].id,
        phase: input.skipped ? "missing_evidence_repair" : "initial_item_administration",
        actor_type: "student",
        message_text: input.skipped ? "I want to skip this item." : "I finished the last item.",
        structured_payload: input.skipped ? { skipped_item: true } : { finalized: true },
        created_at: minutesAfter(input.base, 18)
      }
    ]
  });

  const eventBase = {
    assessment_session_db_id: session.id,
    concept_unit_session_db_id: conceptUnitSession.id
  };
  const events: Prisma.ProcessEventUncheckedCreateInput[] = [
    {
      ...eventBase,
      item_db_id: input.items[0].id,
      event_type: "item_presented",
      event_category: "student_response",
      event_source: "backend",
      payload: { item_public_id: input.items[0].item_public_id },
      occurred_at: minutesAfter(input.base, 2)
    },
    {
      ...eventBase,
      item_db_id: input.items[0].id,
      event_type: "option_selected",
      event_category: "student_response",
      event_source: "backend",
      payload: { selected_option: "A" },
      occurred_at: minutesAfter(input.base, 3)
    },
    {
      ...eventBase,
      item_db_id: input.items[1].id,
      event_type: "option_selected",
      event_category: "student_response",
      event_source: "backend",
      payload: { selected_option: "B", revision: true, revision_count: 1 },
      occurred_at: minutesAfter(input.base, 9)
    },
    {
      ...eventBase,
      item_db_id: input.items[1].id,
      event_type: "reasoning_revised",
      event_category: "student_response",
      event_source: "backend",
      payload: { revision_count: 1 },
      occurred_at: minutesAfter(input.base, 10)
    },
    {
      ...eventBase,
      event_type: "page_hidden",
      event_category: "student_process",
      event_source: "frontend",
      visibility_duration_ms: 9000,
      payload: { fixture: "data_export" },
      occurred_at: minutesAfter(input.base, 7)
    },
    {
      ...eventBase,
      event_type: "page_visible",
      event_category: "student_process",
      event_source: "frontend",
      visibility_duration_ms: 9000,
      payload: { fixture: "data_export" },
      occurred_at: minutesAfter(input.base, 7.2)
    },
    {
      ...eventBase,
      event_type: "long_pause",
      event_category: "student_process",
      event_source: "frontend",
      pause_duration_ms: 42_000,
      payload: { threshold_ms: 30000 },
      occurred_at: minutesAfter(input.base, 13)
    }
  ];

  if (input.skipped) {
    events.push({
      ...eventBase,
      item_db_id: input.items[2].id,
      event_type: "schema_validation_failed",
      event_category: "validation",
      event_source: "backend",
      payload: { missing_fields: ["answer", "reasoning", "confidence"] },
      occurred_at: minutesAfter(input.base, 17)
    });
  }

  for (const event of events) {
    await input.prisma.processEvent.create({ data: event });
  }

  await createResponsePackage({
    concept_unit_session_db_id: conceptUnitSession.id,
    package_type: "initial_concept_unit_response_package"
  });

  return { session, conceptUnitSession };
}

export async function cleanupDataExportDemoFixture(prisma: PrismaClient) {
  await cleanupOutcomeAndExportRecords(prisma);
  const deletedAssessment = await cleanupAssessmentRecords(prisma);

  return { deleted_assessment: deletedAssessment };
}

export async function ensureDataExportDemoFixture(prisma: PrismaClient) {
  await cleanupDataExportDemoFixture(prisma);
  const { teacher, student, secondStudent } = await ensureDataExportUsers(prisma);
  const { assessment, conceptUnit, items } = await createFixtureAssessment(prisma, teacher.id);

  await addInitialPackageSession({
    prisma,
    userDbId: secondStudent.id,
    assessmentDbId: assessment.id,
    conceptUnitDbId: conceptUnit.id,
    items,
    sessionPublicId: dataExportCompleteSessionPublicId,
    attemptNumber: 1,
    status: "completed",
    currentPhase: "session_completed",
    base: new Date("2026-06-19T15:00:00.000Z"),
    skipped: false
  });
  await inputIncompleteSession(prisma, {
    userDbId: secondStudent.id,
    assessmentDbId: assessment.id,
    conceptUnitDbId: conceptUnit.id
  });
  await addInitialPackageSession({
    prisma,
    userDbId: student.id,
    assessmentDbId: assessment.id,
    conceptUnitDbId: conceptUnit.id,
    items,
    sessionPublicId: dataExportSkippedSessionPublicId,
    attemptNumber: 1,
    status: "active",
    currentPhase: "profiling_pending",
    base: new Date("2026-06-19T16:00:00.000Z"),
    skipped: true
  });

  return {
    teacher,
    student,
    secondStudent,
    assessment,
    conceptUnit,
    items
  };
}

async function inputIncompleteSession(
  prisma: PrismaClient,
  input: {
    userDbId: string;
    assessmentDbId: string;
    conceptUnitDbId: string;
  }
) {
  const base = new Date("2026-06-19T17:00:00.000Z");

  return prisma.assessmentSession.create({
    data: {
      session_public_id: dataExportIncompleteSessionPublicId,
      user_db_id: input.userDbId,
      assessment_db_id: input.assessmentDbId,
      attempt_number: 2,
      status: "active",
      current_phase: "concept_unit_intro",
      current_concept_unit_db_id: input.conceptUnitDbId,
      started_at: base,
      last_activity_at: minutesAfter(base, 3),
      completed_at: null,
      needs_review: true,
      needs_review_reason: "Development fixture interrupted before concept-unit responses."
    }
  });
}
