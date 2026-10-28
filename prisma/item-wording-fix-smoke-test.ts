/**
 * Database check for wording fixes (item-wording-fix-v1): after a student has started a mini test,
 * the instructor fixes an item's wording in place. The item keeps its public ID and version, no new
 * mini-test version is created, the answer already given keeps the wording that student saw, and
 * the fix is recorded with its reason. The key and the options stay locked, and the fix is refused
 * for a mini test no student has started. No provider calls.
 * Run with: npx tsx prisma/item-wording-fix-smoke-test.ts
 */
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { normalizeUserId } from "../src/lib/services/student-accounts/validation";
import { createAssessment } from "../src/lib/services/content/assessments";
import { createConceptUnit } from "../src/lib/services/content/concept-units";
import { createItem, updateItem } from "../src/lib/services/content/items";
import { publishAssessment } from "../src/lib/services/content/publishing";
import { ContentServiceError } from "../src/lib/services/content/errors";
import { correctItemWording, listItemWordingCorrections } from "../src/lib/services/content/item-wording-fix";
import { createEditableAssessmentRevision } from "../src/lib/services/content/assessment-revisions";
import { generatePublicId } from "../src/lib/services/ids";

const prisma = new PrismaClient();

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function refused(run: () => Promise<unknown>, code: string, message: string) {
  try {
    await run();
  } catch (error) {
    assert(error instanceof ContentServiceError && error.code === code, `${message} (got ${String((error as Error)?.message ?? error)})`);
    return;
  }
  throw new Error(`${message} (no error)`);
}

function itemInput(order: number) {
  return {
    item_stem: `Wording fix smoke item ${order}: which response best evaluates the TA's claim?`,
    options: [
      { label: "A", text: "Original key" },
      { label: "B", text: "Distractor" },
      { label: "C", text: "Alternative distractor" }
    ],
    correct_option: "A",
    distractor_rationales: {
      B: "A plausible but unsupported choice.",
      C: "A second plausible but unsupported choice."
    },
    expected_reasoning_patterns: ["Uses the relevant course concept."],
    possible_misconception_indicators: ["Treats a distractor as definitive."],
    administration_rules: {
      no_feedback_during_initial_administration: true,
      teacher_diagnostic_context: {
        correct_option_notes: { strong_reasoning_should_mention: "Names the evidence that supports the correct option." }
      }
    },
    included_in_published_set: true,
    item_order: order
  };
}

async function main() {
  const suffix = `${Date.now()}_${randomUUID().slice(0, 8)}`;
  const createdAssessmentPublicIds: string[] = [];
  const teacher = await prisma.user.create({
    data: { user_id: `wording_teacher_${suffix}`, user_id_normalized: normalizeUserId(`wording_teacher_${suffix}`), role: "teacher_researcher" }
  });
  const student = await prisma.user.create({
    data: {
      user_id: `wording_student_${suffix}`,
      user_id_normalized: normalizeUserId(`wording_student_${suffix}`),
      role: "student",
      created_by_teacher_user_id: teacher.id
    }
  });

  try {
    async function miniTest(title: string) {
      const assessment = await createAssessment({
        teacher_user_db_id: teacher.id,
        data: { title: `${title} ${suffix}`, diagnostic_focus: "Wording fix check.", folder_label: "Wording fix smoke" }
      });
      createdAssessmentPublicIds.push(assessment.assessment_public_id);
      const topic = await createConceptUnit({
        teacher_user_db_id: teacher.id,
        assessment_public_id: assessment.assessment_public_id,
        data: { title: "Wording topic", learning_objective: "Identify the supported answer.", related_concept_description: "Temporary topic." }
      });
      const items = [];
      for (const order of [1, 2, 3]) {
        items.push(await createItem({ teacher_user_db_id: teacher.id, concept_unit_public_id: topic.concept_unit_public_id, data: itemInput(order) }));
      }
      return { assessment, items };
    }

    const started = await miniTest("Started mini test");
    const unused = await miniTest("Unused mini test");
    await publishAssessment({ teacher_user_db_id: teacher.id, assessment_public_id: started.assessment.assessment_public_id });

    const row = await prisma.assessment.findUniqueOrThrow({
      where: { assessment_public_id: started.assessment.assessment_public_id },
      include: { concept_units: { include: { items: true } } }
    });
    const topicRow = row.concept_units[0];
    const itemRow = topicRow.items.find((entry) => entry.item_public_id === started.items[0].item_public_id);
    assert(itemRow, "The first item exists.");
    const session = await prisma.assessmentSession.create({
      data: {
        session_public_id: generatePublicId("session"),
        user_db_id: student.id,
        assessment_db_id: row.id,
        status: "active",
        current_phase: "initial_item_administration",
        current_concept_unit_db_id: topicRow.id,
        started_at: new Date(),
        last_activity_at: new Date()
      }
    });
    const topicSession = await prisma.conceptUnitSession.create({
      data: { assessment_session_db_id: session.id, concept_unit_db_id: topicRow.id, status: "initial_in_progress", initial_started_at: new Date() }
    });
    const answered = await prisma.itemResponse.create({
      data: {
        concept_unit_session_db_id: topicSession.id,
        item_db_id: itemRow.id,
        selected_option: "B",
        correct_option_snapshot: "A",
        correctness: "not_scored",
        item_submitted_at: new Date(),
        item_version_snapshot: itemRow.version,
        item_snapshot: { item_public_id: itemRow.item_public_id, item_stem: itemRow.item_stem, options: itemRow.options, version: itemRow.version }
      }
    });

    await refused(
      () => updateItem({ teacher_user_db_id: teacher.id, item_public_id: itemRow.item_public_id, data: { item_stem: "Changed" } }),
      "content_locked_after_student_session",
      "The normal editor stays locked after a student starts"
    );

    const assessmentsBefore = await prisma.assessment.count({ where: { created_by_user_db_id: teacher.id } });
    const fixedStem = "Wording fix smoke item 1: which response best evaluates Lily's claim?";
    const result = await correctItemWording({
      teacher_user_db_id: teacher.id,
      item_public_id: itemRow.item_public_id,
      data: {
        reason: "Use Lily's name in the question.",
        item_stem: fixedStem,
        options: [
          { label: "A", text: "Original key" },
          { label: "B", text: "Distractor, reworded" },
          { label: "C", text: "Alternative distractor" }
        ],
        correct_option: "A"
      }
    });
    assert(result.item.item_stem === fixedStem, "The stem is fixed in place.");
    assert(result.item.version === itemRow.version, "The item version stays the same.");
    assert(result.item.item_public_id === itemRow.item_public_id, "The item keeps its public ID.");
    assert(result.item.correct_option === "A", "The key is unchanged.");
    assert(JSON.stringify(result.correction.changed_fields) === JSON.stringify(["item_stem", "options"]), "Changed fields are recorded.");
    assert(result.correction.responses_before === 1, "The answer already given is counted.");
    assert(
      (await prisma.assessment.count({ where: { created_by_user_db_id: teacher.id } })) === assessmentsBefore,
      "No new mini-test version is created."
    );

    const kept = await prisma.itemResponse.findUniqueOrThrow({ where: { id: answered.id } });
    const snapshot = kept.item_snapshot as Record<string, unknown>;
    assert(snapshot.item_stem === itemRow.item_stem, "The answer already given keeps the wording that student saw.");
    assert(kept.item_version_snapshot === itemRow.version, "The answer keeps its version.");

    const history = await listItemWordingCorrections({ teacher_user_db_id: teacher.id, item_public_id: itemRow.item_public_id });
    assert(history.length === 1, "One fix is recorded.");
    assert(history[0].reason === "Use Lily's name in the question.", "The reason is recorded.");
    assert(history[0].sessions_before === 1 && history[0].item_version === itemRow.version, "Counts and version are recorded.");
    assert(history[0].before.item_stem === itemRow.item_stem && history[0].after.item_stem === fixedStem, "Before and after are recorded.");

    await refused(
      () => correctItemWording({
        teacher_user_db_id: teacher.id,
        item_public_id: itemRow.item_public_id,
        data: { reason: "Change the key.", item_stem: fixedStem, options: itemInput(1).options, correct_option: "B" }
      }),
      "wording_fix_changes_locked_content",
      "The key cannot change in a wording fix"
    );
    await refused(
      () => correctItemWording({
        teacher_user_db_id: teacher.id,
        item_public_id: itemRow.item_public_id,
        data: { reason: "Drop an option.", item_stem: fixedStem, options: itemInput(1).options.slice(0, 2) }
      }),
      "wording_fix_changes_locked_content",
      "Options cannot be removed in a wording fix"
    );
    await refused(
      () => correctItemWording({
        teacher_user_db_id: teacher.id,
        item_public_id: unused.items[0].item_public_id,
        data: { reason: "Fix a typo.", item_stem: "Changed", options: itemInput(1).options }
      }),
      "wording_fix_not_available",
      "A mini test no student has started is edited normally"
    );
    assert(
      (await listItemWordingCorrections({ teacher_user_db_id: teacher.id, item_public_id: itemRow.item_public_id })).length === 1,
      "Refused fixes leave no record."
    );
    await refused(
      () => correctItemWording({
        teacher_user_db_id: student.id,
        item_public_id: itemRow.item_public_id,
        data: { reason: "Not the owner.", item_stem: "x", options: itemInput(1).options }
      }),
      "not_found",
      "Only the owner can fix an item"
    );

    // Once a new version exists ("Correct for future attempts"), the fix belongs in that version:
    // publishing it checks that the original has not changed since it was copied.
    const revision = await createEditableAssessmentRevision({
      teacher_user_db_id: teacher.id,
      assessment_public_id: started.assessment.assessment_public_id,
      data: { revision_reason: "The second item needs a new key.", source_item_public_id: started.items[1].item_public_id }
    });
    createdAssessmentPublicIds.push(revision.revision_assessment_public_id);
    await refused(
      () => correctItemWording({
        teacher_user_db_id: teacher.id,
        item_public_id: itemRow.item_public_id,
        data: { reason: "Another typo.", item_stem: `${fixedStem} Again.`, options: itemInput(1).options }
      }),
      "wording_fix_not_available",
      "A wording fix is refused while a newer version exists"
    );

    console.log(JSON.stringify({
      status: "passed",
      version_unchanged: true,
      no_new_mini_test_version: true,
      answered_snapshot_unchanged: true,
      fix_recorded_with_reason: true,
      key_and_options_locked: true,
      unused_mini_test_refused: true,
      refused_while_newer_version_exists: true,
      provider_calls: 0
    }));
  } finally {
    const assessments = await prisma.assessment.findMany({
      where: { assessment_public_id: { in: createdAssessmentPublicIds } },
      select: { id: true }
    });
    const assessmentIds = assessments.map((assessment) => assessment.id);
    const sessions = await prisma.assessmentSession.findMany({ where: { assessment_db_id: { in: assessmentIds } }, select: { id: true } });
    const sessionIds = sessions.map((entry) => entry.id);
    const topicSessions = await prisma.conceptUnitSession.findMany({ where: { assessment_session_db_id: { in: sessionIds } }, select: { id: true } });
    await prisma.itemResponse.deleteMany({ where: { concept_unit_session_db_id: { in: topicSessions.map((entry) => entry.id) } } });
    await prisma.conceptUnitSession.deleteMany({ where: { id: { in: topicSessions.map((entry) => entry.id) } } });
    await prisma.assessmentSession.deleteMany({ where: { id: { in: sessionIds } } });
    const topics = await prisma.conceptUnit.findMany({ where: { assessment_db_id: { in: assessmentIds } }, select: { id: true } });
    const topicIds = topics.map((entry) => entry.id);
    const items = await prisma.item.findMany({ where: { concept_unit_db_id: { in: topicIds } }, select: { id: true } });
    await prisma.$executeRaw`DELETE FROM item_wording_corrections WHERE item_db_id = ANY(${items.map((entry) => entry.id)}::uuid[])`;
    await prisma.itemMediaAsset.deleteMany({ where: { item_db_id: { in: items.map((entry) => entry.id) } } });
    await prisma.item.deleteMany({ where: { concept_unit_db_id: { in: topicIds } } });
    await prisma.conceptUnit.deleteMany({ where: { id: { in: topicIds } } });
    await prisma.assessment.deleteMany({ where: { id: { in: assessmentIds } } });
    await prisma.user.deleteMany({ where: { id: { in: [teacher.id, student.id] } } });
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
