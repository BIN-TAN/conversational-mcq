import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { ZodError } from "zod";
import { hashSecret } from "../src/lib/password";
import { createAssessment, getAssessmentDetail } from "../src/lib/services/content/assessments";
import { createConceptUnit } from "../src/lib/services/content/concept-units";
import { createItem, getItemDetail } from "../src/lib/services/content/items";
import { importConceptBasedItemSets } from "../src/lib/services/content/import-json";
import { publishAssessment, validateConceptUnitPublishable } from "../src/lib/services/content/publishing";
import {
  buildDistractorRationalesFromTeacherNotes,
  buildItemAdministrationRulesFromTeacherMetadata,
  readTeacherItemMetadata,
  readTopicDiagnosticNote,
  teacherDiagnosticContextForProvider,
  type TeacherDiagnosticOptionNote
} from "../src/lib/services/content/teacher-diagnostic-context";
import { normalizeUserId } from "../src/lib/services/student-accounts/validation";

const prisma = new PrismaClient();

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function assertZodValidationError(action: () => Promise<unknown>, message: string) {
  try {
    await action();
  } catch (error) {
    assert(error instanceof ZodError, `${message}: expected ZodError.`);
    assert(error.issues.length > 0, `${message}: expected validation issues.`);
    return;
  }

  throw new Error(`${message}: expected validation error.`);
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

function options() {
  return [
    { label: "A", text: "Theta is a student-side ability location." },
    { label: "B", text: "Theta is an item difficulty parameter." },
    { label: "C", text: "Theta is the number of options on an item." },
    { label: "D", text: "Theta is the item discrimination slope." }
  ];
}

function optionNotes(): TeacherDiagnosticOptionNote[] {
  return [
    {
      label: "B",
      distractor_diagnostic_value: "Confuses student ability with item difficulty.",
      why_tempting: "Both theta and difficulty are shown on the same latent scale.",
      misconception_reasoning_pattern: "ability_item_parameter_blending",
      strengthens_hypothesis: "Student treats item-side and person-side quantities as interchangeable.",
      weakens_hypothesis: "Student explains theta as person location while noting item difficulty separately.",
      follow_up_probe_suggestion: "Ask the student to separate person location from item location.",
      student_safe_feedback_hint: "Separate what belongs to the student from what belongs to the item."
    },
    {
      label: "C",
      distractor_diagnostic_value: "Treats theta as a visible test-format feature.",
      why_tempting: "The option count is concrete and easy to inspect.",
      misconception_reasoning_pattern: "surface_feature_substitution",
      strengthens_hypothesis: "Student points to answer format rather than measurement model meaning.",
      weakens_hypothesis: "Student distinguishes visible item format from latent variables.",
      follow_up_probe_suggestion: "Ask what theta estimates that cannot be seen in the option list."
    },
    {
      label: "D",
      distractor_diagnostic_value: "Confuses ability location with discrimination.",
      why_tempting: "Both are parameters discussed in IRT graphs.",
      misconception_reasoning_pattern: "parameter_role_confusion",
      strengthens_hypothesis: "Student describes slope or steepness when asked about theta.",
      weakens_hypothesis: "Student says discrimination is item-side slope and theta is person-side location."
    }
  ];
}

function guidedRules() {
  return buildItemAdministrationRulesFromTeacherMetadata({
    administration_rules: {
      cognitive_demand: "conceptual_boundary",
      difficulty: "moderate",
      knowledge_component: "theta_interpretation",
      misconception_cluster: "person_item_parameter_confusion"
    },
    metadata: {
      item_label: "Theta boundary item",
      item_purpose: "initial_item",
      expected_reasoning_note:
        "A strong response separates person ability location from item-side parameters.",
      item_diagnostic_value_note:
        "This item distinguishes latent ability interpretation from item-parameter substitution.",
      correct_option_notes: {
        target_reasoning_note: "Theta represents a student-side ability estimate on the latent scale.",
        strong_reasoning_should_mention:
          "Theta is not an item difficulty or discrimination value.",
        weak_unsupported_correctness_looks_like:
          "Student selects the right option but gives only a memorized phrase."
      },
      option_notes: optionNotes()
    }
  });
}

function validGuidedItem(itemOrder: number) {
  const itemOptions = options();
  const notes = optionNotes();

  return {
    item_stem: `Phase 31i smoke item ${itemOrder}: What does theta represent in IRT?`,
    options: itemOptions,
    correct_option: "A",
    distractor_rationales: buildDistractorRationalesFromTeacherNotes({
      option_labels: itemOptions.map((option) => option.label),
      correct_option: "A",
      existing_rationales: {},
      option_notes: notes
    }),
    expected_reasoning_patterns: [
      "Student distinguishes person-side ability location from item-side parameters."
    ],
    possible_misconception_indicators: notes.map(
      (note) => note.misconception_reasoning_pattern ?? note.distractor_diagnostic_value ?? ""
    ),
    administration_rules: guidedRules(),
    included_in_published_set: true,
    item_order: itemOrder
  };
}

function assertStudentPreviewSafe(item: Awaited<ReturnType<typeof getItemDetail>>) {
  const preview = {
    item_stem: item.item_stem,
    options: item.options
  };
  const text = JSON.stringify(preview);

  assert(!text.includes("correct_option"), "Student preview should not expose correct option key.");
  assert(!text.includes("teacher_diagnostic_context"), "Student preview leaked teacher context key.");
  assert(!text.includes("distractor_rationales"), "Student preview leaked distractor rationales.");
  assert(!text.includes("ability_item_parameter_blending"), "Student preview leaked misconception IDs.");
}

function assertDashboardCardsAreActionable() {
  const source = readFileSync(path.join(process.cwd(), "src/app/teacher/dashboard/page.tsx"), "utf8");

  assert(source.includes('href="/teacher/sessions"'), "Dashboard sessions card should link to sessions.");
  assert(source.includes('href="/teacher/students"'), "Dashboard student accounts card should link to student management.");
  assert(
    source.includes('href="/teacher/content/assessments"'),
    "Dashboard mini-test card should link to assessment list."
  );
  assert(
    source.includes('href="/teacher/data/explorer"'),
    "Dashboard data card should link to Data Explorer."
  );
  assert(
    source.includes('href="/teacher/system/llm"'),
    "Dashboard LLM status card should remain clickable."
  );
  assert(!source.includes("Agent Metadata"), "Dashboard should not show static Agent Metadata card.");
  assert(!source.includes(">Flags<"), "Dashboard should not show static Flags card.");
  assert(!source.includes("Data Foundation"), "Dashboard should not show static Data Foundation card.");
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

async function main() {
  const prefix = `phase31i_smoke_${Date.now()}_${randomUUID().slice(0, 8)}`;
  const teacher = await ensureDemoTeacher();

  try {
    const assessment = await createAssessment({
      teacher_user_db_id: teacher.id,
      data: {
        title: `Temporary ${prefix}`,
        diagnostic_focus: "Distinguish theta as person-side ability from item-side parameters.",
        folder_label: "Week 31i",
        workflow_mode: "automatic",
        response_collection_mode: "llm_assisted",
        auto_create_primary_topic: true
      }
    });
    assert(assessment.folder_label === "Week 31i", "Folder/week label was not persisted.");
    assert(
      assessment.diagnostic_focus?.includes("person-side ability"),
      "Diagnostic focus was not persisted."
    );
    assert(assessment.workflow_mode === "automatic", "Workflow mode should default to automatic.");
    assert(
      assessment.response_collection_mode === "llm_assisted",
      "Response collection should default to LLM-assisted."
    );

    const assessmentDetail = await getAssessmentDetail({
      teacher_user_db_id: teacher.id,
      assessment_public_id: assessment.assessment_public_id
    });
    assert(assessmentDetail.concept_units.length === 1, "Mini test should auto-create one internal topic.");
    const conceptUnit = assessmentDetail.concept_units[0];

    assert(
      readTopicDiagnosticNote(conceptUnit.administration_rules).includes("person-side ability"),
      "Auto-created topic diagnostic note was not persisted."
    );

    await assertZodValidationError(
      () =>
        createItem({
          teacher_user_db_id: teacher.id,
          concept_unit_public_id: conceptUnit.concept_unit_public_id,
          data: {
            ...validGuidedItem(98),
            correct_option: ""
          }
        }),
      "Item without correct option should be rejected"
    );

    await assertZodValidationError(
      () =>
        createItem({
          teacher_user_db_id: teacher.id,
          concept_unit_public_id: conceptUnit.concept_unit_public_id,
          data: {
            ...validGuidedItem(99),
            options: [{ label: "A", text: "Only one option" }]
          }
        }),
      "Item with too few options should be rejected"
    );

    const items = [];
    for (const itemOrder of [1, 2, 3]) {
      const item = await createItem({
        teacher_user_db_id: teacher.id,
        concept_unit_public_id: conceptUnit.concept_unit_public_id,
        data: validGuidedItem(itemOrder)
      });
      items.push(item);
    }

    const detail = await getItemDetail({
      teacher_user_db_id: teacher.id,
      item_public_id: items[0].item_public_id
    });
    assertStudentPreviewSafe(detail);

    const metadata = readTeacherItemMetadata(detail.administration_rules);
    assert(metadata.item_label === "Theta boundary item", "Item label metadata missing.");
    assert(metadata.option_notes.length === 3, "Distractor diagnostic notes were not stored.");
    assert(
      metadata.correct_option_notes.strong_reasoning_should_mention?.includes("discrimination"),
      "Correct-option reasoning notes were not stored."
    );

    const providerContext = teacherDiagnosticContextForProvider({
      administration_rules: detail.administration_rules,
      distractor_rationales: detail.distractor_rationales,
      expected_reasoning_patterns: detail.expected_reasoning_patterns,
      possible_misconception_indicators: detail.possible_misconception_indicators
    });
    assert(
      JSON.stringify(providerContext).includes("teacher_diagnostic_context"),
      "Internal provider context did not include teacher diagnostic context."
    );
    assert(
      JSON.stringify(providerContext).includes("ability_item_parameter_blending"),
      "Internal provider context did not include distractor diagnostic signal."
    );

    const validation = await validateConceptUnitPublishable({
      teacher_user_db_id: teacher.id,
      concept_unit_public_id: conceptUnit.concept_unit_public_id
    });
    assert(validation.ok, "Guided teacher-created items should pass publish validation.");
    assert(
      validation.warnings.length === 0,
      "Guided item set with diagnostic notes should not have diagnostic-note warnings."
    );

    const warningConceptUnit = await createConceptUnit({
      teacher_user_db_id: teacher.id,
      assessment_public_id: assessment.assessment_public_id,
      data: {
        title: "Topic without notes",
        learning_objective: "Exercise warning path.",
        related_concept_description: "Temporary warning topic.",
        administration_rules: {}
      }
    });
    for (const itemOrder of [1, 2, 3]) {
      await createItem({
        teacher_user_db_id: teacher.id,
        concept_unit_public_id: warningConceptUnit.concept_unit_public_id,
        data: {
          ...validGuidedItem(itemOrder + 10),
          administration_rules: { item_role: "initial" }
        }
      });
    }
    const warningValidation = await validateConceptUnitPublishable({
      teacher_user_db_id: teacher.id,
      concept_unit_public_id: warningConceptUnit.concept_unit_public_id
    });
    assert(warningValidation.ok, "Missing teacher diagnostic notes should warn, not block.");
    assert(
      warningValidation.warnings.some(
        (warning) => warning.code === "teacher_topic_diagnostic_note_missing"
      ),
      "Publish validation did not warn about missing topic diagnostic note."
    );

    const published = await publishAssessment({
      teacher_user_db_id: teacher.id,
      assessment_public_id: assessment.assessment_public_id
    });
    assert(published.assessment.status === "published", "Mini test assessment should publish directly.");
    assert(
      published.publishable_concept_unit_public_ids.includes(conceptUnit.concept_unit_public_id),
      "Direct publish should publish the auto-created internal topic."
    );

    const imported = await importConceptBasedItemSets({
      teacher_user_db_id: teacher.id,
      data: {
        assessment: {
          title: `Temporary ${prefix} imported`,
          description: "Temporary JSON import compatibility assessment.",
          diagnostic_focus: "Imported diagnostic focus.",
          folder_label: "Imported folder"
        },
        concept_units: [
          {
            title: "Imported topic",
            learning_objective: "Verify existing JSON import remains valid.",
            related_concept_description: "Imported concept description.",
            administration_rules: {},
            items: [validGuidedItem(1)]
          }
        ]
      }
    });
    assert(imported.validation.ok, "JSON import compatibility failed.");
    assert(imported.assessment.folder_label === "Imported folder", "JSON import folder metadata failed.");

    assertDashboardCardsAreActionable();

    console.log(
      JSON.stringify(
        {
          status: "passed",
          created_items: items.length,
          folder_week_checked: true,
          auto_topic_checked: true,
          direct_publish_checked: true,
          dashboard_cards_checked: true,
          publish_warnings_checked: true,
          json_import_checked: true,
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
