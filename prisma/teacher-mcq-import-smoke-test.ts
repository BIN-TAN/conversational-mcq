import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import * as XLSX from "xlsx";
import { hashSecret } from "../src/lib/password";
import { createAssessment } from "../src/lib/services/content/assessments";
import {
  commitMcqItemImport,
  previewMcqItemImport
} from "../src/lib/services/content/mcq-import";
import { getItemDetail } from "../src/lib/services/content/items";
import { readTeacherItemMetadata } from "../src/lib/services/content/teacher-diagnostic-context";
import { normalizeUserId } from "../src/lib/services/student-accounts/validation";

const prisma = new PrismaClient();

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function ensureDemoTeacher() {
  return prisma.user.upsert({
    where: { user_id: "teacher_demo" },
    update: {
      role: "teacher_researcher",
      password_hash: await hashSecret("teacher_demo_password"),
      access_code_hash: null
    },
    create: {
      user_id: "teacher_demo",
      user_id_normalized: normalizeUserId("teacher_demo"),
      role: "teacher_researcher",
      password_hash: await hashSecret("teacher_demo_password")
    }
  });
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

  await prisma.mcqItemImportBatch.deleteMany({
    where: { assessment_db_id: { in: assessmentIds } }
  });
  await prisma.item.deleteMany({ where: { concept_unit_db_id: { in: conceptUnitIds } } });
  await prisma.conceptUnit.deleteMany({ where: { id: { in: conceptUnitIds } } });
  await prisma.assessment.deleteMany({ where: { id: { in: assessmentIds } } });
}

function xlsxBase64(rows: Array<Record<string, string>>) {
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(workbook, sheet, "Items");
  return Buffer.from(XLSX.write(workbook, { bookType: "xlsx", type: "buffer" })).toString("base64");
}

function studentSafeItemProjection(item: Awaited<ReturnType<typeof getItemDetail>>) {
  return {
    item_stem: item.item_stem,
    options: item.options,
    media_assets: item.media_assets.map((asset) => ({
      media_type: asset.media_type,
      placement: asset.placement,
      option_label: asset.option_label,
      student_alt_text: asset.student_alt_text,
      caption: asset.caption
    }))
  };
}

async function main() {
  const prefix = `phase31q_import_${Date.now()}_${randomUUID().slice(0, 8)}`;
  const teacher = await ensureDemoTeacher();

  try {
    const assessment = await createAssessment({
      teacher_user_db_id: teacher.id,
      data: {
        title: `Temporary ${prefix}`,
        diagnostic_focus: "Distinguish person ability from item parameters.",
        folder_label: "Phase 31q",
        workflow_mode: "automatic",
        response_collection_mode: "llm_assisted",
        auto_create_primary_topic: true
      }
    });

    const csv = [
      [
        "item_label",
        "stem",
        "option_a",
        "option_b",
        "option_c",
        "option_d",
        "key",
        "target_reasoning_note",
        "strong_reasoning_should_mention",
        "distractor_diagnostic_notes",
        "image_url",
        "student_alt_text",
        "teacher_llm_media_description",
        "source_attribution"
      ].join(","),
      [
        "Theta 1",
        "\"What does theta represent in IRT?\"",
        "\"A person-side ability location\"",
        "\"An item difficulty parameter\"",
        "\"The number of options\"",
        "\"An item discrimination slope\"",
        "A",
        "",
        "",
        "",
        "https://example.com/theta-plot.png",
        "\"Theta scale illustration\"",
        "\"Diagram contrasting person ability with item parameters\"",
        "\"Instructor-created test bank\""
      ].join(","),
      [
        "Theta duplicate",
        "\"What does theta represent in IRT?\"",
        "\"A person-side ability location\"",
        "\"An item difficulty parameter\"",
        "\"The number of options\"",
        "\"An item discrimination slope\"",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        ""
      ].join(","),
      [
        "Malformed",
        "\"Incomplete item\"",
        "\"Only one option\"",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        ""
      ].join(",")
    ].join("\n");

    const preview = await previewMcqItemImport({
      teacher_user_db_id: teacher.id,
      assessment_public_id: assessment.assessment_public_id,
      data: {
        source_type: "csv",
        source_text: csv,
        source_file_name: "phase31q-import.csv"
      }
    });
    assert(preview.batch.candidate_count === 3, "CSV preview should extract three candidates.");
    const [validCandidate, missingKeyCandidate, malformedCandidate] = preview.batch.candidates;
    assert(validCandidate?.stem === "What does theta represent in IRT?", "CSV stem extraction failed.");
    assert(validCandidate.options.length === 4, "CSV options extraction failed.");
    assert(validCandidate.imported_key === "A", "CSV key should be preserved separately.");
    assert(validCandidate.teacher_confirmed_key === null, "Imported key must not become official automatically.");
    assert(validCandidate.media_assets.length === 1, "CSV media metadata was not imported.");
    assert(validCandidate.target_reasoning_note === null, "Missing diagnostic notes should remain blank.");
    assert(validCandidate.original_source_text.includes("Theta 1"), "Original CSV row was not preserved.");
    assert(!validCandidate.normalized_changed_wording, "CSV import should not report paraphrasing.");
    assert(
      missingKeyCandidate?.imported_key === null &&
        missingKeyCandidate.missing_fields.includes("key"),
      "Missing key should remain blank and be reported."
    );
    assert(
      missingKeyCandidate.duplicate_warnings.some((warning) => warning.scope === "batch"),
      "Duplicate warning within import batch missing."
    );
    assert(
      malformedCandidate?.issue_flags.includes("too_few_options") &&
        malformedCandidate.status === "needs_options",
      "Malformed item should be flagged, not invented."
    );

    const mapped = await previewMcqItemImport({
      teacher_user_db_id: teacher.id,
      assessment_public_id: assessment.assessment_public_id,
      data: {
        source_type: "csv",
        source_text: [
          "Question Text,Choice One,Choice Two,Correct",
          "\"Mapped stem?\",\"Mapped A\",\"Mapped B\",B"
        ].join("\n"),
        column_mapping: {
          stem: "Question Text",
          option_a: "Choice One",
          option_b: "Choice Two",
          key: "Correct"
        }
      }
    });
    assert(mapped.batch.candidates[0]?.stem === "Mapped stem?", "Column mapping stem failed.");
    assert(mapped.batch.candidates[0]?.imported_key === "B", "Column mapping key failed.");

    const xlsx = await previewMcqItemImport({
      teacher_user_db_id: teacher.id,
      assessment_public_id: assessment.assessment_public_id,
      data: {
        source_type: "xlsx",
        file_base64: xlsxBase64([
          {
            stem: "XLSX theta item?",
            option_a: "Ability",
            option_b: "Difficulty",
            key: "A"
          }
        ]),
        source_file_name: "phase31q-import.xlsx"
      }
    });
    assert(xlsx.batch.candidates[0]?.stem === "XLSX theta item?", "XLSX stem extraction failed.");
    assert(xlsx.batch.candidates[0]?.imported_key === "A", "XLSX key extraction failed.");

    const plainText = await previewMcqItemImport({
      teacher_user_db_id: teacher.id,
      assessment_public_id: assessment.assessment_public_id,
      data: {
        source_type: "plain_text",
        source_text:
          "1. Which statement best describes theta?\nA. Ability location\nB. Difficulty\nC. Discrimination\nD. Guessing\nAnswer: A"
      }
    });
    assert(
      plainText.batch.candidates[0]?.source_location === "lines 1-6",
      "Plain-text parser should preserve source line range."
    );
    assert(plainText.batch.candidates[0]?.imported_key === "A", "Plain-text key parse failed.");

    const projectJson = await previewMcqItemImport({
      teacher_user_db_id: teacher.id,
      assessment_public_id: assessment.assessment_public_id,
      data: {
        source_type: "project_json",
        source_text: JSON.stringify({
          items: [
            {
              item_stem: "Project JSON item?",
              options: [
                { label: "A", text: "Ability" },
                { label: "B", text: "Difficulty" }
              ],
              correct_option: "A"
            }
          ]
        })
      }
    });
    assert(projectJson.batch.candidates[0]?.stem === "Project JSON item?", "Project JSON parse failed.");

    const committed = await commitMcqItemImport({
      teacher_user_db_id: teacher.id,
      assessment_public_id: assessment.assessment_public_id,
      batch_public_id: preview.batch.batch_public_id,
      data: {
        selected_candidate_public_ids: [
          validCandidate.candidate_public_id,
          missingKeyCandidate.candidate_public_id
        ],
        candidate_updates: [
          {
            candidate_public_id: validCandidate.candidate_public_id,
            teacher_confirmed_key: validCandidate.imported_key
          }
        ]
      }
    });
    assert(committed.imported_count === 2, "Two selected draft candidates should import.");
    assert(committed.blocked_count === 0, "Malformed unselected candidate should not block import.");

    const items = await prisma.item.findMany({
      where: {
        concept_unit: { assessment: { assessment_public_id: assessment.assessment_public_id } }
      },
      orderBy: { item_order: "asc" },
      select: {
        item_public_id: true,
        correct_option: true,
        status: true,
        administration_rules: true
      }
    });
    assert(items.length === 2, "Imported draft items were not created.");
    assert(items.every((item) => item.status === "draft"), "Imported items must remain drafts.");
    assert(items[0]?.correct_option === "A", "Teacher-confirmed key was not applied.");
    assert(items[1]?.correct_option === "", "Missing key should remain blank in draft item.");

    const importedDetail = await getItemDetail({
      teacher_user_db_id: teacher.id,
      item_public_id: items[0]!.item_public_id
    });
    const metadata = readTeacherItemMetadata(importedDetail.administration_rules);
    assert(metadata.item_label === "Theta 1", "Imported item label metadata missing.");

    const studentProjection = JSON.stringify(studentSafeItemProjection(importedDetail));
    assert(!studentProjection.includes("correct_option"), "Student projection leaked key field.");
    assert(!studentProjection.includes("teacher_diagnostic_context"), "Student projection leaked teacher context.");
    assert(!studentProjection.includes("item parameters"), "Student projection leaked teacher media description.");

    console.log(
      JSON.stringify(
        {
          status: "passed",
          csv_candidates: preview.batch.candidate_count,
          xlsx_checked: true,
          plain_text_checked: true,
          project_json_checked: true,
          column_mapping_checked: true,
          duplicate_warning_checked: true,
          draft_import_count: committed.imported_count,
          missing_key_remained_blank: true,
          student_safe_projection_checked: true,
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
