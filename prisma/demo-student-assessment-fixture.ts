import { PrismaClient } from "@prisma/client";
import { hashSecret } from "../src/lib/password";

export const demoAssessmentPublicId = "assessment_demo_phase4b";
export const demoConceptUnitPublicId = "concept_demo_phase4b_initial";
export const demoItemPublicIds = [
  "item_demo_phase4b_1",
  "item_demo_phase4b_2",
  "item_demo_phase4b_3"
] as const;

const teacherUserId = "teacher_demo";
const teacherPassword = "teacher_demo_password";
const studentUserId = "student_demo";
const studentAccessCode = "student_demo_access_code";

function demoItem(itemOrder: number) {
  const labels = ["A", "B", "C"];

  return {
    item_public_id: demoItemPublicIds[itemOrder - 1],
    item_order: itemOrder,
    item_stem:
      itemOrder === 1
        ? "A plant is placed near a sunny window for several days. Which statement best explains why it grows toward the light?"
        : itemOrder === 2
          ? "A student solves 3(x + 2) = 21 and says x = 5. Which step best supports that result?"
          : "A cup of hot tea cools on a table. Which statement best describes the direction of energy transfer?",
    options: labels.map((label) => ({
      label,
      text:
        label === "A"
          ? itemOrder === 1
            ? "The plant responds to light by growing more on the shaded side."
            : itemOrder === 2
              ? "Divide both sides by 3, then subtract 2 from both sides."
              : "Energy transfers from the hotter tea to the cooler surrounding air."
          : label === "B"
            ? itemOrder === 1
              ? "The plant moves because light pulls the stem directly."
              : itemOrder === 2
                ? "Subtract 2 first, then divide both sides by 3."
                : "Energy transfers from the cooler air into the hotter tea."
            : itemOrder === 1
              ? "The plant grows randomly until it happens to face the window."
              : itemOrder === 2
                ? "Multiply both sides by 3, then add 2."
                : "No energy transfers because the tea and air are both matter."
    })),
    correct_option: "A",
    distractor_rationales: {
      B: "This reflects a direct-pull interpretation rather than a growth response.",
      C: "This reflects a random-change interpretation instead of a directional response."
    },
    expected_reasoning_patterns: [
      "Explains the selected option using the relationship described in the item."
    ],
    possible_misconception_indicators: [
      "Chooses a distractor with reasoning that treats the process as direct pulling, reversed operation, or reversed transfer."
    ],
    administration_rules: {
      no_feedback_during_initial_administration: true,
      fixture: "development_only"
    },
    included_in_published_set: true,
    status: "published" as const
  };
}

export async function ensureDemoUsers(prisma: PrismaClient) {
  const [teacherPasswordHash, studentAccessCodeHash] = await Promise.all([
    hashSecret(teacherPassword),
    hashSecret(studentAccessCode)
  ]);
  const teacher = await prisma.user.upsert({
    where: { user_id: teacherUserId },
    update: {
      role: "teacher_researcher",
      password_hash: teacherPasswordHash,
      access_code_hash: null
    },
    create: {
      user_id: teacherUserId,
      role: "teacher_researcher",
      password_hash: teacherPasswordHash
    }
  });
  const student = await prisma.user.upsert({
    where: { user_id: studentUserId },
    update: {
      role: "student",
      password_hash: null,
      access_code_hash: studentAccessCodeHash
    },
    create: {
      user_id: studentUserId,
      role: "student",
      access_code_hash: studentAccessCodeHash
    }
  });

  return { teacher, student };
}

export async function ensureDemoStudentAssessment(prisma: PrismaClient) {
  const { teacher } = await ensureDemoUsers(prisma);
  const existing = await prisma.assessment.findUnique({
    where: { assessment_public_id: demoAssessmentPublicId },
    include: {
      _count: {
        select: { assessment_sessions: true }
      }
    }
  });

  if (existing?._count.assessment_sessions) {
    if (existing.status !== "published") {
      throw new Error(
        "The demo assessment has existing sessions but is not published. Run npm run demo:student-assessment:cleanup before recreating it."
      );
    }

    return existing;
  }

  const assessment = await prisma.assessment.upsert({
    where: { assessment_public_id: demoAssessmentPublicId },
    update: {
      title: "Development Demo: Initial MCQ Conversation",
      description: "Development-only assessment for testing the Phase 4B student interface.",
      status: "published",
      created_by_user_db_id: teacher.id
    },
    create: {
      assessment_public_id: demoAssessmentPublicId,
      title: "Development Demo: Initial MCQ Conversation",
      description: "Development-only assessment for testing the Phase 4B student interface.",
      status: "published",
      created_by_user_db_id: teacher.id
    }
  });
  const conceptUnit = await prisma.conceptUnit.upsert({
    where: { concept_unit_public_id: demoConceptUnitPublicId },
    update: {
      assessment_db_id: assessment.id,
      title: "Demo topic",
      learning_objective: "Development fixture for initial response collection.",
      related_concept_description: "Development-only concept boundary for browser testing.",
      administration_rules: { fixture: "development_only" },
      order_index: 1,
      status: "published",
      version: 1
    },
    create: {
      concept_unit_public_id: demoConceptUnitPublicId,
      assessment_db_id: assessment.id,
      title: "Demo topic",
      learning_objective: "Development fixture for initial response collection.",
      related_concept_description: "Development-only concept boundary for browser testing.",
      administration_rules: { fixture: "development_only" },
      order_index: 1,
      status: "published",
      version: 1
    }
  });

  for (const itemOrder of [1, 2, 3]) {
    const item = demoItem(itemOrder);

    await prisma.item.upsert({
      where: { item_public_id: item.item_public_id },
      update: {
        concept_unit_db_id: conceptUnit.id,
        item_order: item.item_order,
        item_stem: item.item_stem,
        options: item.options,
        correct_option: item.correct_option,
        distractor_rationales: item.distractor_rationales,
        expected_reasoning_patterns: item.expected_reasoning_patterns,
        possible_misconception_indicators: item.possible_misconception_indicators,
        administration_rules: item.administration_rules,
        included_in_published_set: true,
        status: "published",
        version: 1
      },
      create: {
        item_public_id: item.item_public_id,
        concept_unit_db_id: conceptUnit.id,
        item_order: item.item_order,
        item_stem: item.item_stem,
        options: item.options,
        correct_option: item.correct_option,
        distractor_rationales: item.distractor_rationales,
        expected_reasoning_patterns: item.expected_reasoning_patterns,
        possible_misconception_indicators: item.possible_misconception_indicators,
        administration_rules: item.administration_rules,
        included_in_published_set: true,
        status: "published",
        version: 1
      }
    });
  }

  return assessment;
}

export async function cleanupDemoStudentAssessment(prisma: PrismaClient) {
  const assessment = await prisma.assessment.findUnique({
    where: { assessment_public_id: demoAssessmentPublicId },
    select: { id: true }
  });

  if (!assessment) {
    return { deleted: false };
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

  return { deleted: true };
}
