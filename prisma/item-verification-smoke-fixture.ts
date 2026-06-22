import { PrismaClient } from "@prisma/client";
import { hashSecret } from "../src/lib/password";
import { generatePublicId } from "../src/lib/services/ids";
import { normalizeUserId } from "../src/lib/services/student-accounts/validation";

function itemSeed(prefix: string, order: number) {
  return {
    item_public_id: generatePublicId("item"),
    item_order: order,
    item_stem: `${prefix} verification item ${order}: Which option best matches the stated relationship?`,
    options: [
      { label: "A", text: "The relationship is directly paired." },
      { label: "B", text: "The relationship is random." },
      { label: "C", text: "The relationship is unrelated to the concept." }
    ],
    correct_option: "A",
    distractor_rationales: {
      B: "This distractor represents confusing association with randomness.",
      C: "This distractor represents ignoring the teacher-defined relationship."
    },
    expected_reasoning_patterns: [
      "Student identifies the direct relationship in the item context."
    ],
    possible_misconception_indicators: [
      "Student treats a direct relation as random or unrelated."
    ],
    administration_rules: { no_feedback_during_initial_administration: true },
    included_in_published_set: true,
    status: "draft" as const,
    version: 1
  };
}

export async function cleanupItemVerificationFixture(prisma: PrismaClient, prefix: string) {
  const assessments = await prisma.assessment.findMany({
    where: { title: { startsWith: prefix } },
    select: { id: true }
  });
  const assessmentIds = assessments.map((assessment) => assessment.id);
  const conceptUnits = await prisma.conceptUnit.findMany({
    where: { assessment_db_id: { in: assessmentIds } },
    select: { id: true }
  });
  const conceptUnitIds = conceptUnits.map((conceptUnit) => conceptUnit.id);
  const runs = await prisma.itemVerificationRun.findMany({
    where: { concept_unit_db_id: { in: conceptUnitIds } },
    select: { id: true, agent_call_db_id: true }
  });
  const agentCallIds = runs
    .map((run) => run.agent_call_db_id)
    .filter((id): id is string => Boolean(id));

  await prisma.conceptUnit.updateMany({
    where: { id: { in: conceptUnitIds } },
    data: { latest_item_verification_run_db_id: null }
  });
  await prisma.itemVerificationRun.deleteMany({
    where: { concept_unit_db_id: { in: conceptUnitIds } }
  });
  await prisma.agentCall.deleteMany({
    where: { id: { in: agentCallIds } }
  });
  await prisma.item.deleteMany({
    where: { concept_unit_db_id: { in: conceptUnitIds } }
  });
  await prisma.conceptUnit.deleteMany({
    where: { id: { in: conceptUnitIds } }
  });
  await prisma.assessment.deleteMany({
    where: { id: { in: assessmentIds } }
  });
  await prisma.user.deleteMany({
    where: { user_id: { startsWith: prefix } }
  });
}

export async function createItemVerificationFixture(input: {
  prisma: PrismaClient;
  prefix: string;
  itemCount?: number;
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
      title: `${input.prefix} item verification smoke`,
      description: "Temporary Phase 7D item verification fixture.",
      status: "draft",
      workflow_mode: "manual_review",
      response_collection_mode: "deterministic",
      created_by_user_db_id: teacher.id
    }
  });
  const conceptUnit = await input.prisma.conceptUnit.create({
    data: {
      concept_unit_public_id: generatePublicId("concept_unit"),
      assessment_db_id: assessment.id,
      title: `${input.prefix} verification concept`,
      learning_objective: "Verify that students can identify the teacher-defined relationship.",
      related_concept_description:
        "Synthetic concept for checking advisory item verification.",
      administration_rules: { no_feedback_during_initial_administration: true },
      order_index: 1,
      status: "draft",
      version: 1
    }
  });
  const itemCount = input.itemCount ?? 3;
  const items = [];

  for (let order = 1; order <= itemCount; order += 1) {
    items.push(
      await input.prisma.item.create({
        data: {
          ...itemSeed(input.prefix, order),
          concept_unit_db_id: conceptUnit.id
        }
      })
    );
  }

  return { teacher, student, assessment, conceptUnit, items };
}
