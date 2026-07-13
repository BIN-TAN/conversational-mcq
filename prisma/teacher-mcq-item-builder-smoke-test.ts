import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { ZodError } from "zod";
import { hashSecret } from "../src/lib/password";
import { createAssessment, getAssessmentDetail } from "../src/lib/services/content/assessments";
import { createConceptUnit } from "../src/lib/services/content/concept-units";
import { createAssessmentItem, createItem, getItemDetail } from "../src/lib/services/content/items";
import { importConceptBasedItemSets } from "../src/lib/services/content/import-json";
import { publishAssessment, validateConceptUnitPublishable } from "../src/lib/services/content/publishing";
import {
  buildDistractorRationalesFromTeacherNotes,
  buildItemAdministrationRulesFromTeacherMetadata,
  readTeacherItemMetadata,
  readTopicDiagnosticNote,
  teacherDiagnosticContextForProvider
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

function plainDistractorNote() {
  return [
    "Option B may suggest confusion between student ability and item difficulty.",
    "Option C may suggest replacing a latent variable with a visible item-format feature.",
    "Option D may suggest confusion between ability location and discrimination.",
    "These are possible interpretations only, not firm misconception conclusions."
  ].join(" ");
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
          "Theta is not an item difficulty or discrimination value."
      },
      plain_language_distractor_diagnostic_notes: plainDistractorNote()
    }
  });
}

function validGuidedItem(itemOrder: number) {
  const itemOptions = options();

  return {
    item_stem: `Phase 31i smoke item ${itemOrder}: What does theta represent in IRT?`,
    options: itemOptions,
    correct_option: "A",
    distractor_rationales: buildDistractorRationalesFromTeacherNotes({
      option_labels: itemOptions.map((option) => option.label),
      correct_option: "A",
      existing_rationales: {},
      option_notes: [],
      plain_language_distractor_diagnostic_notes: plainDistractorNote()
    }),
    expected_reasoning_patterns: [
      "Student distinguishes person-side ability location from item-side parameters."
    ],
    possible_misconception_indicators: [],
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
  assert(!text.includes("possible interpretations"), "Student preview leaked teacher notes.");
}

function assertDashboardCardsAreActionable() {
  const source = readFileSync(path.join(process.cwd(), "src/app/teacher/dashboard/page.tsx"), "utf8");
  const client = readFileSync(
    path.join(process.cwd(), "src/components/teacher-dashboard/assessment-dashboard-client.tsx"),
    "utf8"
  );

  assert(source.includes('href: "/teacher/sessions"'), "Teacher dashboard nav should link to sessions.");
  assert(source.includes('href: "/teacher/students"'), "Teacher dashboard nav should link to student management.");
  assert(
    source.includes('href: "/teacher/content"') && source.includes("Assessment management"),
    "Teacher dashboard nav should expose top-level assessment management."
  );
  assert(
    source.includes('href: "/teacher/data"'),
    "Teacher dashboard nav should link to Data and outcomes."
  );
  assert(
    source.includes('href: "/teacher/system/llm"'),
    "Teacher dashboard nav should link to LLM status."
  );
  assert(source.includes("AssessmentDashboardClient"), "Dashboard should render the assessment-level dashboard client.");
  assert(client.includes("Assessment / mini test"), "Dashboard should expose an assessment selector.");
  assert(client.includes("Item-level diagnostic view"), "Dashboard should expose item-level diagnostics.");
  assert(client.includes("Candidate misconception patterns"), "Dashboard should expose deterministic pattern review.");
  assert(!client.includes("Export and readable data"), "Assessment dashboard should not expose dashboard export links.");
  assert(!source.includes("JSON import"), "Standard dashboard should not show a JSON import card or nav link.");
  assert(!source.includes('href="/teacher/content/import-json"'), "Standard dashboard should not link to JSON import.");
  assert(!source.includes("Model evaluation"), "Standard dashboard should not show a Model evaluation card.");
  assert(!source.includes('href="/teacher/evals"'), "Standard dashboard should not link to Model evaluation.");
  assert(!source.includes("Agent Metadata"), "Dashboard should not show static Agent Metadata card.");
  assert(!source.includes(">Flags<"), "Dashboard should not show static Flags card.");
  assert(!source.includes("Data Foundation"), "Dashboard should not show static Data Foundation card.");
}

function assertAssessmentDetailPageIsMiniTestFocused() {
  const source = readFileSync(
    path.join(process.cwd(), "src/components/teacher-content/assessment-detail-client.tsx"),
    "utf8"
  );

  assert(
    source.includes("const addItemHref = `/teacher/content/assessments/${assessmentPublicId}/items/new`;"),
    "Assessment detail should link Add MCQ item through the assessment-level route."
  );
  assert(
    source.includes("const importItemsHref = `/teacher/content/assessments/${assessmentPublicId}/import-mcq`;") &&
      source.includes("Import MCQ items"),
    "Assessment detail should link Import MCQ items through the selected assessment route."
  );
  assert(
    source.includes("Add the MCQ items students will answer in this mini test."),
    "MCQ helper text should use teacher-facing mini-test wording."
  );
  assert(!source.includes("Advanced topic settings"), "Normal mini-test page should not show advanced topic settings.");
  assert(!source.includes("hidden internal topic"), "Normal mini-test page should not mention hidden internal topics.");
  assert(!source.includes("Fixed automatic"), "Normal mini-test page should not show fixed workflow implementation facts.");
  assert(
    !source.includes("Fixed LLM-assisted conversation"),
    "Normal mini-test page should not show fixed response-mode implementation facts."
  );
}

function assertItemEditorSupportsDynamicOptionsAndSafePreview() {
  const source = readFileSync(
    path.join(process.cwd(), "src/components/teacher-content/item-editor-client.tsx"),
    "utf8"
  );

  assert(source.includes("Add option"), "Item editor should expose an Add option action.");
  assert(source.includes("Mark as key"), "Option rows should expose a mark-as-key control.");
  assert(!source.includes("Item purpose / use"), "Item purpose selector should be hidden in normal mode.");
  assert(!source.includes("diagnostic_contrast_item"), "Normal item editor should not expose diagnostic contrast purpose.");
  assert(!source.includes("transfer_item"), "Normal item editor should not expose transfer purpose.");
  assert(!source.includes("Weak or unsupported correctness looks like"), "Extra correctness note box should be hidden.");
  assert(!source.includes("Why tempting"), "Structured distractor subfields should be hidden.");
  assert(!source.includes("Misconception or reasoning pattern"), "Structured distractor subfields should be hidden.");
  assert(!source.includes("Strengthens hypothesis"), "Structured distractor subfields should be hidden.");
  assert(!source.includes("Weakens hypothesis"), "Structured distractor subfields should be hidden.");
  assert(!source.includes("Follow-up probe suggestion"), "Structured distractor subfields should be hidden.");
  assert(!source.includes("Student-safe feedback hint"), "Structured distractor subfields should be hidden.");
  assert(source.includes("Optional diagnostic guidance"), "Diagnostic guidance should be grouped as optional.");
  assert(source.includes("Target reasoning note (optional)"), "Correct-option notes should mark target reasoning optional.");
  assert(
    source.includes("Strong reasoning should mention (optional)"),
    "Correct-option notes should mark strong-reasoning guidance optional."
  );
  assert(
    source.includes("Selecting a distractor is indirect evidence only"),
    "Distractor note helper should state the indirect-evidence caution."
  );
  assert(source.includes("Student preview"), "Item editor should expose a student preview.");
  assert(source.includes("Teacher preview"), "Item editor should expose a teacher preview.");
  assert(
    source.includes("Students see only the stem and option text"),
    "Student preview should explicitly hide key and diagnostic notes."
  );
  assert(!source.includes("Higher-order item design"), "Normal item editor should not show a higher-order item design card.");
  assert(
    !source.includes("Initial MCQ items should usually ask students to apply, analyze, or evaluate ideas."),
    "Normal item editor should not show static higher-order guidance."
  );
  assert(!source.includes("Cognitive demand"), "Item editor should not expose a cognitive-demand dropdown.");
  assert(source.includes("Item stem"), "Item editor should expose a unified Item stem composer.");
  assert(source.includes("Add image"), "Item stem composer should expose an Add image action.");
  assert(source.includes("Add video"), "Item stem composer should expose an Add video action.");
  assert(source.includes("Add reference link"), "Item stem composer should expose an Add reference link action.");
  assert(!source.includes(">Media<"), "Item editor should not show a separate Media card.");
  assert(
    source.includes("Write the item wording and place images, video links, or reference links in the same ordered stem sequence."),
    "Item stem composer should describe text and media as one sequence."
  );
  assert(
    source.includes("Upload image (storage not configured)"),
    "Media editor should keep browser upload unavailable until storage is configured."
  );
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
        createAssessmentItem({
          teacher_user_db_id: teacher.id,
          assessment_public_id: assessment.assessment_public_id,
          data: {
            ...validGuidedItem(98),
            correct_option: ""
          }
        }),
      "Item without correct option should be rejected"
    );

    await assertZodValidationError(
      () =>
        createAssessmentItem({
          teacher_user_db_id: teacher.id,
          assessment_public_id: assessment.assessment_public_id,
          data: {
            ...validGuidedItem(99),
            options: [{ label: "A", text: "Only one option" }]
          }
        }),
      "Item with too few options should be rejected"
    );

    const directAssessment = await createAssessment({
      teacher_user_db_id: teacher.id,
      data: {
        title: `Temporary ${prefix} direct no-topic`,
        diagnostic_focus: "Direct item creation should create internal structure behind the scenes.",
        folder_label: "Week 31i"
      }
    });
    const directBefore = await getAssessmentDetail({
      teacher_user_db_id: teacher.id,
      assessment_public_id: directAssessment.assessment_public_id
    });
    assert(directBefore.concept_units.length === 0, "Direct-create fixture should begin with no topic.");
    const directItem = await createAssessmentItem({
      teacher_user_db_id: teacher.id,
      assessment_public_id: directAssessment.assessment_public_id,
      data: validGuidedItem(1)
    });
    const directAfter = await getAssessmentDetail({
      teacher_user_db_id: teacher.id,
      assessment_public_id: directAssessment.assessment_public_id
    });
    assert(
      directAfter.concept_units.length === 1,
      "Direct Add MCQ path should create the hidden topic internally."
    );
    assert(
      directAfter.mini_test_items?.some((item) => item.item_public_id === directItem.item_public_id),
      "Directly added item should appear in the MCQ items list."
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
    assert(metadata.item_purpose === "initial_item", "Teacher-created item should default to initial administration.");
    assert(
      metadata.plain_language_distractor_diagnostic_notes.includes("possible interpretations only"),
      "Plain-language distractor diagnostic notes were not stored."
    );
    assert(metadata.option_notes.length === 0, "New normal editor metadata should not require structured option notes.");
    assert(
      metadata.correct_option_notes.strong_reasoning_should_mention?.includes("discrimination"),
      "Correct-option reasoning notes were not stored."
    );

    const providerContext = teacherDiagnosticContextForProvider({
      administration_rules: detail.administration_rules,
      assessment_diagnostic_focus: assessment.diagnostic_focus,
      distractor_rationales: detail.distractor_rationales,
      expected_reasoning_patterns: detail.expected_reasoning_patterns,
      possible_misconception_indicators: detail.possible_misconception_indicators
    });
    assert(
      JSON.stringify(providerContext).includes("teacher_diagnostic_context"),
      "Internal provider context did not include teacher diagnostic context."
    );
    assert(
      JSON.stringify(providerContext).includes("Selected options are indirect evidence only"),
      "Internal provider context did not include interpretation caution."
    );
    assert(
      JSON.stringify(providerContext).includes("student ability and item difficulty"),
      "Internal provider context did not include plain-language distractor notes."
    );
    assert(
      JSON.stringify(providerContext).includes("person-side ability"),
      "Internal provider context did not include assessment diagnostic focus."
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
    assertAssessmentDetailPageIsMiniTestFocused();
    assertItemEditorSupportsDynamicOptionsAndSafePreview();

    console.log(
      JSON.stringify(
        {
          status: "passed",
          created_items: items.length,
          folder_week_checked: true,
          auto_topic_checked: true,
          direct_publish_checked: true,
          direct_add_item_checked: true,
          normal_page_topic_settings_hidden: true,
          dynamic_option_builder_checked: true,
          dashboard_assessment_surface_checked: true,
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
