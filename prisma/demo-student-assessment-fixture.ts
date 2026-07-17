import { PrismaClient } from "@prisma/client";
import { hashSecret } from "../src/lib/password";
import {
  applyProvisionalItemDiagnosticMetadata,
  mergeProvisionalDiagnosticMetadata
} from "../src/lib/services/student-assessment/provisional-item-diagnostic-metadata";
import { normalizeUserId } from "../src/lib/services/student-accounts/validation";

export const demoAssessmentPublicId = "assessment_mvp_irt_theta_invariance";
export const demoConceptUnitPublicId = "concept_mvp_irt_theta_invariance";
export const demoItemPublicIds = [
  "item_mvp_irt_theta_invariance_anchor",
  "item_mvp_irt_theta_invariance_diagnostic_contrast",
  "item_mvp_irt_theta_invariance_parameter_extension",
  "item_mvp_irt_theta_invariance_transfer"
] as const;

const teacherUserId = "teacher_demo";
const teacherPassword = "teacher_demo_password";
const studentUserId = "student_demo";
const studentAccessCode = "student_demo_access_code";
const demoAssessmentDiagnosticFocus =
  "Distractor-informed diagnosis of whether students distinguish person ability theta from item difficulty/discrimination parameters and treat selected or tempting distractors as indirect evidence rather than proof.";

type DemoItemSeed = {
  item_public_id: string;
  item_order: number;
  item_role: string;
  cognitive_demand: string;
  difficulty: string;
  item_stem: string;
  options: Array<{ label: string; text: string }>;
  correct_option: string;
  distractor_rationales: Record<string, string>;
  expected_reasoning_patterns: string[];
  possible_misconception_indicators: string[];
  included_in_published_set: boolean;
};

const mvpItemSeeds: DemoItemSeed[] = [
  {
    item_public_id: demoItemPublicIds[0],
    item_order: 1,
    item_role: "anchor",
    cognitive_demand: "understanding",
    difficulty: "easy",
    item_stem:
      "A testing program develops two item sets to measure the same mathematics ability. Item Set 2 contains more difficult items than Item Set 1, but both item sets are calibrated under the same IRT model and placed on the same scale. A student takes both item sets on different occasions. If the model fits reasonably well and the forms are properly linked, should the student's estimated ability theta be expected to differ systematically across the two forms?",
    options: [
      { label: "A", text: "Yes, because harder item sets always produce lower theta estimates." },
      { label: "B", text: "Yes, because item difficulty directly determines the student's ability level." },
      { label: "C", text: "No, because theta is intended to represent the same latent ability across properly calibrated forms." },
      { label: "D", text: "No, because item difficulty has no role in IRT scoring." }
    ],
    correct_option: "C",
    distractor_rationales: {
      A: "Harder item sets automatically lower person ability estimates.",
      B: "Item difficulty directly determines the person's ability level.",
      C: "Correct answer.",
      D: "Item difficulty is irrelevant in IRT scoring."
    },
    expected_reasoning_patterns: [
      "When forms are properly linked or calibrated onto the same scale, theta is intended to estimate the same latent ability.",
      "A harder item set may affect response probabilities and precision, but it should not systematically redefine the person's ability estimate."
    ],
    possible_misconception_indicators: [
      "Treats harder items as automatically lowering theta.",
      "Treats item difficulty as directly determining person ability.",
      "Claims item difficulty has no role in IRT scoring."
    ],
    included_in_published_set: true
  },
  {
    item_public_id: demoItemPublicIds[1],
    item_order: 2,
    item_role: "diagnostic_contrast",
    cognitive_demand: "application_and_analysis",
    difficulty: "medium",
    item_stem:
      "John takes two 10-item quizzes in the same content domain. Both quizzes are designed and calibrated under a 2PL model. The average item difficulty on Quiz 1 is -0.5, while the average item difficulty on Quiz 2 is +1. A peer says: \"Quiz 2 is harder because the average difficulty is higher, so John's estimated theta will be lower on Quiz 2 than on Quiz 1.\" What is the main flaw in the peer's reasoning?",
    options: [
      { label: "A", text: "The peer assumes that item difficulty should be invariant across tests." },
      { label: "B", text: "The peer confuses item difficulty b with person ability theta; theta is intended to be comparable across properly calibrated or linked forms." },
      { label: "C", text: "The peer assumes that the discrimination parameter a is always equal to 1, which would make item difficulty irrelevant." },
      { label: "D", text: "The peer assumes that the test with the higher average difficulty must provide less information for all students." }
    ],
    correct_option: "B",
    distractor_rationales: {
      A: "Misunderstands invariance by thinking item difficulty itself must remain the same across forms.",
      B: "Correct answer.",
      C: "Misattributes the issue to discrimination rather than the confusion between item difficulty and ability.",
      D: "Confuses average difficulty with information in a broad, unsupported way."
    },
    expected_reasoning_patterns: [
      "The flaw is confusing item difficulty, which describes item location, with theta, which describes the person's location on the latent trait scale.",
      "Properly calibrated or linked forms are intended to make theta comparable across forms."
    ],
    possible_misconception_indicators: [
      "Says item difficulty itself should be invariant across tests.",
      "Attributes the peer's flaw to discrimination instead of the b/theta distinction.",
      "Overgeneralizes average difficulty into information for every student."
    ],
    included_in_published_set: true
  },
  {
    item_public_id: demoItemPublicIds[2],
    item_order: 3,
    item_role: "parameter_extension",
    cognitive_demand: "higher_order_application",
    difficulty: "hard",
    item_stem:
      "A psychometrician creates two versions of a spatial reasoning test to measure the same latent trait theta. Version 1 contains items with relatively low discrimination parameters, with average a around 0.5. Version 2 contains items with higher discrimination parameters, with average a around 2.0. Both versions are calibrated onto the same scale using a 2PL model, and the model fits the data reasonably well. What should be expected?",
    options: [
      { label: "A", text: "Examinees will receive higher theta estimates on Version 2 because highly discriminating items reward high-ability examinees more." },
      { label: "B", text: "Examinees will receive lower theta estimates on Version 2 because highly discriminating items are harder." },
      { label: "C", text: "Examinees' theta estimates should target the same latent ability across versions, but Version 2 may estimate theta with greater precision for examinees near the items' difficulty levels." },
      { label: "D", text: "The two versions cannot be placed on the same scale because the item discrimination levels differ." }
    ],
    correct_option: "C",
    distractor_rationales: {
      A: "Confuses higher discrimination with systematically higher ability estimates.",
      B: "Confuses discrimination with difficulty.",
      C: "Correct answer.",
      D: "Incorrectly assumes different discrimination levels prevent calibration onto a common scale."
    },
    expected_reasoning_patterns: [
      "Discrimination affects how sharply an item differentiates examinees around its difficulty level and can affect precision or information.",
      "Discrimination should not systematically change the latent trait being estimated when both versions are properly calibrated onto the same scale."
    ],
    possible_misconception_indicators: [
      "Treats high discrimination as rewarding ability with higher theta.",
      "Conflates discrimination and difficulty.",
      "Claims different discrimination prevents common-scale calibration."
    ],
    included_in_published_set: true
  },
  {
    item_public_id: demoItemPublicIds[3],
    item_order: 4,
    item_role: "transfer",
    cognitive_demand: "transfer_application",
    difficulty: "medium",
    item_stem:
      "Two students receive the same estimated theta = 0.5 on a linked IRT scale. Student A was tested with mostly easy items, and Student B was tested with mostly difficult items. Which interpretation is most appropriate?",
    options: [
      { label: "A", text: "Student B must have higher ability because difficult items were used." },
      { label: "B", text: "Student A must have higher ability because easy items allow more correct answers." },
      { label: "C", text: "The two theta estimates are intended to be comparable because they are on the same linked scale, although the precision of each estimate may differ." },
      { label: "D", text: "The two theta estimates cannot be compared unless both students answered the exact same items." }
    ],
    correct_option: "C",
    distractor_rationales: {
      A: "Assumes exposure to difficult items directly implies higher ability.",
      B: "Confuses number correct or ease of items with comparable theta estimates.",
      C: "Correct answer.",
      D: "Incorrectly assumes common items are the only way to compare estimates."
    },
    expected_reasoning_patterns: [
      "The two theta estimates are intended to be comparable because they are on the same linked scale.",
      "Precision may differ depending on item information and where the items are located relative to each student's theta."
    ],
    possible_misconception_indicators: [
      "Infers ability from easy or difficult item exposure rather than linked theta.",
      "Treats exact common items as necessary for comparing linked theta estimates."
    ],
    included_in_published_set: false
  }
];

function demoItem(itemOrder: number) {
  const seed = mvpItemSeeds[itemOrder - 1];

  if (!seed) {
    throw new Error(`Missing IRT MVP item seed for item order ${itemOrder}.`);
  }

  return {
    item_public_id: seed.item_public_id,
    item_order: seed.item_order,
    item_stem: seed.item_stem,
    options: seed.options,
    correct_option: seed.correct_option,
    distractor_rationales: seed.distractor_rationales,
    expected_reasoning_patterns: seed.expected_reasoning_patterns,
    possible_misconception_indicators: seed.possible_misconception_indicators,
    administration_rules: mergeProvisionalDiagnosticMetadata({
      item_public_id: seed.item_public_id,
      administration_rules: {
        item_set_name: "IRT Theta Invariance and Item Parameters",
        domain: "Educational Measurement",
        knowledge_component:
          "Person ability theta is intended to be comparable across properly calibrated or linked forms. Item difficulty and discrimination affect response probabilities and precision, not the definition of the latent trait itself.",
        misconception_cluster:
          "Students may confuse item difficulty b or discrimination a with person ability theta.",
        item_role: seed.item_role,
        cognitive_demand: seed.cognitive_demand,
        difficulty: seed.difficulty,
        no_feedback_during_initial_administration: true,
        fixture: "fixed_irt_mvp"
      }
    }),
    included_in_published_set: seed.included_in_published_set,
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
      user_id_normalized: normalizeUserId(teacherUserId),
      password_hash: teacherPasswordHash,
      access_code_hash: null
    },
    create: {
      user_id: teacherUserId,
      user_id_normalized: normalizeUserId(teacherUserId),
      role: "teacher_researcher",
      password_hash: teacherPasswordHash
    }
  });
  const student = await prisma.user.upsert({
    where: { user_id: studentUserId },
    update: {
      role: "student",
      user_id_normalized: normalizeUserId(studentUserId),
      password_hash: null,
      access_code_hash: studentAccessCodeHash
    },
    create: {
      user_id: studentUserId,
      user_id_normalized: normalizeUserId(studentUserId),
      role: "student",
      access_code_hash: studentAccessCodeHash
    }
  });

  return { teacher, student };
}

export async function ensureDemoStudentAssessment(prisma: PrismaClient) {
  const { teacher } = await ensureDemoUsers(prisma);
  return ensureFixedIrtMvpAssessment(prisma, teacher.id);
}

export async function ensureFixedIrtMvpAssessment(prisma: PrismaClient, createdByUserDbId: string) {
  const existing = await prisma.assessment.findUnique({
    where: { assessment_public_id: demoAssessmentPublicId },
    include: {
      _count: {
        select: { assessment_sessions: true }
      }
    }
  });

  if (existing) {
    if (existing._count.assessment_sessions && existing.status !== "published") {
      throw new Error(
        "The demo assessment has existing sessions but is not published. Run npm run demo:student-assessment:cleanup before recreating it."
      );
    }

    const updatedAssessment = await prisma.assessment.update({
      where: { id: existing.id },
      data: {
        title: "IRT Theta Invariance and Item Parameters",
        description:
          "Fixed MVP assessment for theta invariance, item difficulty, and item discrimination.",
        diagnostic_focus: demoAssessmentDiagnosticFocus,
        status: "published",
        workflow_mode: "automatic",
        release_at: null,
        close_at: null
      }
    });

    await applyProvisionalItemDiagnosticMetadata(prisma);

    return updatedAssessment;
  }

  const assessment = await prisma.assessment.create({
    data: {
      assessment_public_id: demoAssessmentPublicId,
      title: "IRT Theta Invariance and Item Parameters",
      description:
        "Fixed MVP assessment for theta invariance, item difficulty, and item discrimination.",
      diagnostic_focus: demoAssessmentDiagnosticFocus,
      status: "published",
      workflow_mode: "automatic",
      release_at: null,
      close_at: null,
      created_by_user_db_id: createdByUserDbId
    }
  });
  const conceptUnit = await prisma.conceptUnit.upsert({
    where: { concept_unit_public_id: demoConceptUnitPublicId },
    update: {
      assessment_db_id: assessment.id,
      title: "Theta invariance across calibrated IRT forms",
      learning_objective:
        "Explain why theta is intended to represent comparable person ability across properly calibrated or linked forms while item difficulty and discrimination affect response probabilities and precision.",
      related_concept_description:
        "Person ability theta is intended to be comparable across properly calibrated or linked forms. Item difficulty b and discrimination a affect item response behavior and measurement precision, not the definition of the latent trait.",
      administration_rules: {
        fixture: "fixed_irt_mvp",
        item_set_name: "IRT Theta Invariance and Item Parameters",
        initial_item_count: 3,
        transfer_item_count: 1
      },
      order_index: 1,
      status: "published",
      version: 1
    },
    create: {
      concept_unit_public_id: demoConceptUnitPublicId,
      assessment_db_id: assessment.id,
      title: "Theta invariance across calibrated IRT forms",
      learning_objective:
        "Explain why theta is intended to represent comparable person ability across properly calibrated or linked forms while item difficulty and discrimination affect response probabilities and precision.",
      related_concept_description:
        "Person ability theta is intended to be comparable across properly calibrated or linked forms. Item difficulty b and discrimination a affect item response behavior and measurement precision, not the definition of the latent trait.",
      administration_rules: {
        fixture: "fixed_irt_mvp",
        item_set_name: "IRT Theta Invariance and Item Parameters",
        initial_item_count: 3,
        transfer_item_count: 1
      },
      order_index: 1,
      status: "published",
      version: 1
    }
  });

  for (const itemOrder of [1, 2, 3, 4]) {
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
        included_in_published_set: item.included_in_published_set,
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
        included_in_published_set: item.included_in_published_set,
        status: "published",
        version: 1
      }
    });
  }

  await applyProvisionalItemDiagnosticMetadata(prisma);

  return assessment;
}

export async function createIsolatedFixedIrtMvpAssessmentFixture(
  prisma: PrismaClient,
  fixtureKey: string
) {
  const safeKey = fixtureKey.toLowerCase().replace(/[^a-z0-9_]/g, "_");
  const teacherUserId = `teacher_${safeKey}`;
  const teacher = await prisma.user.create({
    data: {
      user_id: teacherUserId,
      user_id_normalized: normalizeUserId(teacherUserId),
      role: "teacher_researcher",
      password_hash: await hashSecret(`password_${safeKey}`)
    }
  });
  const assessmentPublicId = `assessment_${safeKey}`;
  const conceptUnitPublicId = `concept_${safeKey}`;
  const itemPublicIds = mvpItemSeeds.map((_, index) => `item_${safeKey}_${index + 1}`);
  const assessment = await prisma.assessment.create({
    data: {
      assessment_public_id: assessmentPublicId,
      title: "IRT Theta Invariance and Item Parameters",
      description: "Isolated fixed-IRT smoke fixture.",
      diagnostic_focus: demoAssessmentDiagnosticFocus,
      status: "published",
      workflow_mode: "automatic",
      release_at: null,
      close_at: null,
      created_by_user_db_id: teacher.id
    }
  });
  const conceptUnit = await prisma.conceptUnit.create({
    data: {
      concept_unit_public_id: conceptUnitPublicId,
      assessment_db_id: assessment.id,
      title: "Theta invariance across calibrated IRT forms",
      learning_objective:
        "Explain why theta is comparable across linked forms while item parameters affect response probabilities and precision.",
      related_concept_description:
        "Person ability theta is distinct from item difficulty and discrimination on a linked IRT scale.",
      administration_rules: {
        fixture: "isolated_fixed_irt_smoke",
        initial_item_count: 3,
        transfer_item_count: 1
      },
      order_index: 1,
      status: "published",
      version: 1
    }
  });

  for (const [index, seed] of mvpItemSeeds.entries()) {
    const itemPublicId = itemPublicIds[index]!;
    await prisma.item.create({
      data: {
        item_public_id: itemPublicId,
        concept_unit_db_id: conceptUnit.id,
        item_order: seed.item_order,
        item_stem: seed.item_stem,
        options: seed.options,
        correct_option: seed.correct_option,
        distractor_rationales: seed.distractor_rationales,
        expected_reasoning_patterns: seed.expected_reasoning_patterns,
        possible_misconception_indicators: seed.possible_misconception_indicators,
        administration_rules: mergeProvisionalDiagnosticMetadata({
          item_public_id: itemPublicId,
          administration_rules: {
            fixture: "isolated_fixed_irt_smoke",
            item_role: seed.item_role,
            cognitive_demand: seed.cognitive_demand,
            difficulty: seed.difficulty,
            knowledge_component:
              "Person ability theta remains distinct from item difficulty and discrimination on a linked scale.",
            misconception_cluster:
              "Conflation of person ability with item difficulty or discrimination.",
            no_feedback_during_initial_administration: true
          }
        }),
        included_in_published_set: seed.included_in_published_set,
        status: "published",
        version: 1
      }
    });
  }

  return {
    teacher_user_db_id: teacher.id,
    assessment_db_id: assessment.id,
    assessment_public_id: assessmentPublicId,
    concept_unit_public_id: conceptUnitPublicId,
    item_public_ids: itemPublicIds
  };
}

export async function cleanupIsolatedFixedIrtMvpAssessmentFixture(
  prisma: PrismaClient,
  fixture: {
    teacher_user_db_id: string;
    assessment_db_id: string;
  }
) {
  const sessionCount = await prisma.assessmentSession.count({
    where: { assessment_db_id: fixture.assessment_db_id }
  });
  if (sessionCount > 0) {
    throw new Error("Isolated fixed-IRT fixture still has assessment sessions.");
  }
  await prisma.item.deleteMany({
    where: { concept_unit: { assessment_db_id: fixture.assessment_db_id } }
  });
  await prisma.conceptUnit.deleteMany({ where: { assessment_db_id: fixture.assessment_db_id } });
  await prisma.assessment.delete({ where: { id: fixture.assessment_db_id } });
  await prisma.user.delete({ where: { id: fixture.teacher_user_db_id } });
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
