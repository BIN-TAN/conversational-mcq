import { PrismaClient, type ResponseCollectionMode } from "@prisma/client";
import { hashSecret } from "../src/lib/password";
import { generatePublicId } from "../src/lib/services/ids";
import { normalizeUserId } from "../src/lib/services/student-accounts/validation";

export type ResponseCollectionFixture = Awaited<ReturnType<typeof createResponseCollectionFixture>>;

function itemSeed(itemOrder: number) {
  return {
    item_order: itemOrder,
    item_stem: `Response collection smoke item ${itemOrder}`,
    options: [
      { label: "A", text: "Synthetic option A" },
      { label: "B", text: "Synthetic option B" },
      { label: "C", text: "Synthetic option C" }
    ],
    correct_option: "A",
    distractor_rationales: {
      B: "Teacher-only distractor rationale.",
      C: "Teacher-only misconception rationale."
    },
    expected_reasoning_patterns: ["Teacher-only expected reasoning."],
    possible_misconception_indicators: ["Teacher-only misconception indicator."],
    administration_rules: {
      no_feedback_during_initial_administration: true
    }
  };
}

export async function cleanupResponseCollectionFixture(prisma: PrismaClient, prefix: string) {
  const assessments = await prisma.assessment.findMany({
    where: { title: { startsWith: prefix } },
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
  await prisma.agentCall.deleteMany({
    where: { assessment_session_db_id: { in: sessionIds } }
  });
  await prisma.studentActionIdempotencyKey.deleteMany({
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
    where: { concept_unit: { assessment_db_id: { in: assessmentIds } } }
  });
  await prisma.conceptUnit.deleteMany({
    where: { assessment_db_id: { in: assessmentIds } }
  });
  await prisma.assessment.deleteMany({
    where: { id: { in: assessmentIds } }
  });
  await prisma.user.deleteMany({
    where: { user_id: { startsWith: prefix } }
  });
}

export async function createResponseCollectionFixture(input: {
  prisma: PrismaClient;
  prefix: string;
  responseCollectionMode: ResponseCollectionMode;
  sessionModeSnapshot?: ResponseCollectionMode;
}) {
  const teacher = await input.prisma.user.create({
    data: {
      user_id: `${input.prefix}_teacher`,
      user_id_normalized: normalizeUserId(`${input.prefix}_teacher`),
      role: "teacher_researcher",
      password_hash: await hashSecret(`${input.prefix}_teacher_password`)
    }
  });
  const student = await input.prisma.user.create({
    data: {
      user_id: `${input.prefix}_student`,
      user_id_normalized: normalizeUserId(`${input.prefix}_student`),
      role: "student",
      access_code_hash: await hashSecret(`${input.prefix}_student_access`)
    }
  });
  const assessment = await input.prisma.assessment.create({
    data: {
      assessment_public_id: generatePublicId("assessment"),
      title: `${input.prefix} response collection smoke`,
      description: "Temporary Phase 7C response collection smoke fixture.",
      status: "published",
      workflow_mode: "manual_review",
      response_collection_mode: input.responseCollectionMode,
      created_by_user_db_id: teacher.id
    }
  });
  const conceptUnit = await input.prisma.conceptUnit.create({
    data: {
      concept_unit_public_id: generatePublicId("concept_unit"),
      assessment_db_id: assessment.id,
      title: "Response collection smoke concept",
      learning_objective: "Verify initial free-text response collection.",
      related_concept_description: "Synthetic concept for Phase 7C smoke tests.",
      administration_rules: { no_feedback_during_initial_administration: true },
      order_index: 1,
      status: "published",
      version: 1
    }
  });
  const items = [];

  for (const order of [1, 2, 3]) {
    const seed = itemSeed(order);
    const item = await input.prisma.item.create({
      data: {
        item_public_id: generatePublicId("item"),
        concept_unit_db_id: conceptUnit.id,
        item_order: seed.item_order,
        item_stem: seed.item_stem,
        options: seed.options,
        correct_option: seed.correct_option,
        distractor_rationales: seed.distractor_rationales,
        expected_reasoning_patterns: seed.expected_reasoning_patterns,
        possible_misconception_indicators: seed.possible_misconception_indicators,
        administration_rules: seed.administration_rules,
        included_in_published_set: true,
        status: "published",
        version: 1
      }
    });
    items.push(item);
  }

  const now = new Date("2026-06-22T15:00:00.000Z");
  const session = await input.prisma.assessmentSession.create({
    data: {
      session_public_id: generatePublicId("session"),
      user_db_id: student.id,
      assessment_db_id: assessment.id,
      attempt_number: 1,
      status: "active",
      current_phase: "initial_item_administration",
      workflow_mode_snapshot: "manual_review",
      response_collection_mode_snapshot:
        input.sessionModeSnapshot ?? input.responseCollectionMode,
      current_concept_unit_db_id: conceptUnit.id,
      started_at: now,
      last_activity_at: now
    }
  });
  const conceptUnitSession = await input.prisma.conceptUnitSession.create({
    data: {
      assessment_session_db_id: session.id,
      concept_unit_db_id: conceptUnit.id,
      status: "initial_in_progress",
      initial_started_at: now,
      followup_status: "not_started",
      followup_round_count: 0
    }
  });

  return {
    teacher,
    student,
    assessment,
    conceptUnit,
    items,
    session,
    conceptUnitSession
  };
}

