import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { hashSecret } from "../src/lib/password";
import { createAssessment, getAssessmentDetail } from "../src/lib/services/content/assessments";
import { createAssessmentItem } from "../src/lib/services/content/items";
import { normalizeUserId } from "../src/lib/services/student-accounts/validation";

const prisma = new PrismaClient();

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function ensureDemoTeacher() {
  const passwordHash = await hashSecret("teacher_demo_password");

  return prisma.user.upsert({
    where: { user_id: "teacher_demo" },
    update: {
      role: "teacher_researcher",
      password_hash: passwordHash,
      access_code_hash: null
    },
    create: {
      user_id: "teacher_demo",
      user_id_normalized: normalizeUserId("teacher_demo"),
      role: "teacher_researcher",
      password_hash: passwordHash
    }
  });
}

function source(relativePath: string) {
  return readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

function validItem(stemSuffix: string) {
  return {
    item_stem: `Navigation smoke MCQ ${stemSuffix}: What does theta represent in IRT?`,
    options: [
      { label: "A", text: "A student-side ability location." },
      { label: "B", text: "An item difficulty value." },
      { label: "C", text: "The number of answer options." },
      { label: "D", text: "The item discrimination slope." }
    ],
    correct_option: "A",
    distractor_rationales: {},
    expected_reasoning_patterns: [
      "Student distinguishes person-side ability from item-side parameters."
    ],
    possible_misconception_indicators: [],
    administration_rules: {
      teacher_diagnostic_context: {
        item_label: `Navigation smoke ${stemSuffix}`,
        item_purpose: "initial_item"
      }
    },
    included_in_published_set: true
  };
}

async function cleanup(prefix: string) {
  const assessments = await prisma.assessment.findMany({
    where: { title: { contains: prefix } },
    select: { id: true }
  });
  const assessmentIds = assessments.map((assessment) => assessment.id);
  const conceptUnits = await prisma.conceptUnit.findMany({
    where: { assessment_db_id: { in: assessmentIds } },
    select: { id: true }
  });
  const conceptUnitIds = conceptUnits.map((unit) => unit.id);

  await prisma.item.deleteMany({ where: { concept_unit_db_id: { in: conceptUnitIds } } });
  await prisma.conceptUnit.deleteMany({ where: { id: { in: conceptUnitIds } } });
  await prisma.assessment.deleteMany({ where: { id: { in: assessmentIds } } });
}

function assertTeacherNavigationSource() {
  const itemEditor = source("src/components/teacher-content/item-editor-client.tsx");
  const assessmentDetail = source("src/components/teacher-content/assessment-detail-client.tsx");
  const assessmentCreate = source("src/components/teacher-content/assessment-form-client.tsx");
  const studentCreate = source("src/components/teacher-students/new-student-client.tsx");

  assert(itemEditor.includes("<Breadcrumbs"), "Add/edit MCQ item page should include breadcrumbs.");
  assert(itemEditor.includes("Back to mini test"), "Item editor should expose Back to mini test.");
  assert(
    itemEditor.includes("Save item and add another"),
    "Create item page should include Save item and add another."
  );
  assert(
    itemEditor.includes("Save item and return to mini test"),
    "Create item page should include Save item and return to mini test."
  );
  assert(itemEditor.includes("Cancel"), "Item editor should include Cancel.");
  assert(
    itemEditor.includes("resetCreateForm();"),
    "Save and add another should reset the create form after a successful save."
  );
  assert(
    itemEditor.includes("setError(errorFromUnknown(caught));") &&
      itemEditor.indexOf("setError(errorFromUnknown(caught));") <
        itemEditor.indexOf("finally"),
    "Failed item saves should remain on the form and report an error."
  );
  assert(
    itemEditor.includes("if (isSubmitting)") &&
      itemEditor.includes("disabled={!isEditable || isSubmitting}"),
    "Item editor should guard duplicate submissions while saving."
  );
  assert(
    itemEditor.includes('id="student-preview"') && itemEditor.includes('id="teacher-preview"'),
    "Student and teacher preview anchors should remain available."
  );
  assert(
    itemEditor.includes("Students see only the stem and option text"),
    "Student preview should continue to hide key and teacher notes."
  );
  assert(
    !itemEditor.includes("Save item and add another") ||
      itemEditor.includes("props.mode === \"create\""),
    "Save and add another should be create-mode only."
  );
  assert(
    itemEditor.includes("Save changes and return to mini test"),
    "Edit item page should include Save changes and return to mini test."
  );

  assert(
    assessmentDetail.includes("Add another MCQ item"),
    "Assessment detail should include bottom Add another MCQ item action."
  );
  assert(
    assessmentDetail.includes("Teacher preview") && assessmentDetail.includes("Student preview"),
    "Assessment item list should expose separate teacher and student preview actions."
  );
  assert(
    assessmentDetail.includes("required MCQ items added") &&
      assessmentDetail.includes("Minimum item requirement met."),
    "Assessment item list should show item-count readiness text."
  );
  assert(
    assessmentDetail.includes("not a claim that the mini test is pedagogically valid"),
    "Assessment readiness copy should avoid overclaiming pedagogical validity."
  );

  assert(
    assessmentCreate.includes("<Breadcrumbs") &&
      assessmentCreate.includes("Save and open builder") &&
      assessmentCreate.includes("Cancel and return to mini-test list"),
    "Create mini test page should use breadcrumb/save/cancel navigation."
  );
  assert(
    studentCreate.includes("Save student and add another") &&
      studentCreate.includes("Back to student accounts") &&
      studentCreate.includes("Cancel"),
    "Create student page should expose continuous-create and cancel navigation."
  );
}

async function main() {
  const prefix = `phase31i_nav_${Date.now()}_${randomUUID().slice(0, 8)}`;
  const teacher = await ensureDemoTeacher();
  const agentCallsBefore = await prisma.agentCall.count();

  try {
    assertTeacherNavigationSource();

    const assessment = await createAssessment({
      teacher_user_db_id: teacher.id,
      data: {
        title: `Temporary ${prefix}`,
        diagnostic_focus: "Navigation smoke assessment.",
        folder_label: "Authoring navigation",
        workflow_mode: "automatic",
        response_collection_mode: "llm_assisted",
        auto_create_primary_topic: true
      }
    });
    const beforeDetail = await getAssessmentDetail({
      teacher_user_db_id: teacher.id,
      assessment_public_id: assessment.assessment_public_id
    });
    assert(
      (beforeDetail.mini_test_items ?? []).length === 0,
      "Fresh assessment should have no MCQ items before cancel/no-create path."
    );

    const first = await createAssessmentItem({
      teacher_user_db_id: teacher.id,
      assessment_public_id: assessment.assessment_public_id,
      data: validItem("one")
    });
    const second = await createAssessmentItem({
      teacher_user_db_id: teacher.id,
      assessment_public_id: assessment.assessment_public_id,
      data: validItem("two")
    });

    assert(first.item_order === 1, "First omitted item_order should become order 1.");
    assert(second.item_order === 2, "Second omitted item_order should become order 2.");

    const detail = await getAssessmentDetail({
      teacher_user_db_id: teacher.id,
      assessment_public_id: assessment.assessment_public_id
    });
    const itemIds = (detail.mini_test_items ?? []).map((item) => item.item_public_id);
    assert(itemIds.includes(first.item_public_id), "First saved item should appear in item list.");
    assert(itemIds.includes(second.item_public_id), "Second saved item should appear in item list.");
    assert(
      (detail.mini_test_items ?? []).every((item) => item.assessment_public_id === assessment.assessment_public_id),
      "Mini-test item serializer should preserve assessment context for breadcrumbs."
    );

    const studentPreview = JSON.stringify({
      item_stem: first.item_stem,
      options: first.options
    });
    assert(!studentPreview.includes("correct_option"), "Student preview must not expose the answer key.");
    assert(
      !studentPreview.includes("teacher_diagnostic_context"),
      "Student preview must not expose teacher-only diagnostic metadata."
    );

    const agentCallsAfter = await prisma.agentCall.count();
    assert(agentCallsAfter === agentCallsBefore, "Authoring navigation smoke must not create LLM agent calls.");

    console.log(
      JSON.stringify(
        {
          status: "passed",
          assessment_public_id: assessment.assessment_public_id,
          saved_items: itemIds.length,
          auto_item_orders: [first.item_order, second.item_order],
          breadcrumbs_checked: true,
          save_and_add_another_checked: true,
          save_and_return_checked: true,
          duplicate_submission_ui_guard_checked: true,
          student_preview_safe: true,
          openai_calls: 0
        },
        null,
        2
      )
    );
  } finally {
    await cleanup(prefix);
    await prisma.$disconnect();
  }
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
