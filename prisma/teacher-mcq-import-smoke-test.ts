import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import * as XLSX from "xlsx";
import { hashSecret } from "../src/lib/password";
import { createAssessment } from "../src/lib/services/content/assessments";
import {
  commitMcqItemImport,
  getMcqItemImportBatch,
  saveMcqItemImportReview,
  suggestMcqDiagnosticInformation,
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

function xlsxBase64WithHiddenSheet(rows: Array<Record<string, string>>) {
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.json_to_sheet(rows);
  const hidden = XLSX.utils.json_to_sheet([{ ignored: "hidden row" }]);
  XLSX.utils.book_append_sheet(workbook, hidden, "Hidden");
  XLSX.utils.book_append_sheet(workbook, sheet, "Items");
  workbook.Workbook = { Sheets: [{ name: "Hidden", Hidden: 1 }, { name: "Items", Hidden: 0 }] };
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
    const reviewScope = { teacher_user_db_id: teacher.id, assessment_public_id: assessment.assessment_public_id, batch_public_id: mapped.batch.batch_public_id };
    const saved = await saveMcqItemImportReview({ ...reviewScope, data: {
      expected_updated_at: mapped.batch.updated_at,
      candidate_updates: [{ candidate_public_id: mapped.batch.candidates[0].candidate_public_id, target_reasoning_note: "Teacher-reviewed reasoning", teacher_confirmed_key: "B" }]
    } });
    assert(saved.batch.candidates[0].target_reasoning_note === "Teacher-reviewed reasoning", "Review notes must save before importing.");
    assert(saved.batch.imported_count === 0, "Saving review must not import items.");
    await saveMcqItemImportReview({ ...reviewScope, data: { expected_updated_at: mapped.batch.updated_at } }).then(
      () => { throw new Error("Stale review was accepted"); },
      (error) => assert(error.code === "conflict" && error.details.reason === "review_changed", "Stale saves must fail closed.")
    );
    const concurrent = await Promise.allSettled([1, 2].map(() => commitMcqItemImport({ ...reviewScope, data: { expected_updated_at: saved.batch.updated_at } })));
    assert(concurrent.filter((result) => result.status === "fulfilled").length === 1, "Only one concurrent import can claim a review revision.");
    const importedReview = await getMcqItemImportBatch(reviewScope);
    const repeated = await commitMcqItemImport({ ...reviewScope, data: {} });
    assert(repeated.imported_count === 0 && repeated.batch.imported_count === 1, "Repeated import must not duplicate items or reset cumulative count.");
    const unchanged = await saveMcqItemImportReview({ ...reviewScope, data: { candidate_updates: [{ candidate_public_id: mapped.batch.candidates[0].candidate_public_id, stem: "Must not change added item" }] } });
    assert(unchanged.batch.candidates[0].stem === importedReview.batch.candidates[0].stem, "Added items must be immutable in import review.");
    await suggestMcqDiagnosticInformation({ ...reviewScope, data: { mode: "live", candidate_public_ids: [mapped.batch.candidates[0].candidate_public_id] } }).then(
      () => { throw new Error("Added item reached suggestion provider"); },
      (error) => assert(error.code === "validation_failed", "Added items must be rejected before provider configuration.")
    );

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

    const hiddenSheet = await previewMcqItemImport({
      teacher_user_db_id: teacher.id,
      assessment_public_id: assessment.assessment_public_id,
      data: {
        source_type: "xlsx",
        file_base64: xlsxBase64WithHiddenSheet([
          {
            stem: "Hidden sheet warning item?",
            option_a: "Ability",
            option_b: "Difficulty",
            key: "A"
          }
        ]),
        source_file_name: "../phase31q-hidden.xlsx"
      }
    });
    assert(
      JSON.stringify(hiddenSheet.batch.validation_summary).includes("hidden_sheets_ignored"),
      "XLSX hidden sheet warning should be recorded."
    );
    assert(
      hiddenSheet.batch.source_file_name === "phase31q-hidden.xlsx",
      "Stored source filename should be basename-only."
    );
    assert(hiddenSheet.batch.candidates[0]?.stem === "Hidden sheet warning item?", "The first hidden sheet must not be imported.");

    const batchScope = { assessment: { assessment_public_id: assessment.assessment_public_id } };
    const batchCount = await prisma.mcqItemImportBatch.count({ where: batchScope });
    await previewMcqItemImport({
      teacher_user_db_id: teacher.id,
      assessment_public_id: assessment.assessment_public_id,
      data: {
        source_type: "xlsx",
        source_file_name: "oversized.xlsx",
        file_base64: xlsxBase64(Array.from({ length: 501 }, (_, index) => ({ stem: `Item ${index}`, option_a: "A", option_b: "B", key: "A" })))
      }
    }).then(() => { throw new Error("Oversized sheet was accepted"); }, (error) => {
      assert(error.code === "validation_failed", "Oversized workbook must fail with a typed validation error.");
    });
    assert(await prisma.mcqItemImportBatch.count({ where: batchScope }) === batchCount, "Rejected workbook must not persist a partial batch.");

    await previewMcqItemImport({
      teacher_user_db_id: teacher.id,
      assessment_public_id: assessment.assessment_public_id,
      data: {
        source_type: "csv",
        source_text: [
          "stem,option_a,option_b,key",
          "\"=HYPERLINK(\"\"https://example.com\"\",\"\"x\"\")\",\"=1+1\",\"Plain text\",A"
        ].join("\n")
      }
    }).then((formulaPreview) => {
      assert(
        formulaPreview.batch.candidates[0]?.stem.startsWith("=HYPERLINK"),
        "Formula-like CSV values should be treated as text."
      );
    });

    await previewMcqItemImport({
      teacher_user_db_id: teacher.id,
      assessment_public_id: assessment.assessment_public_id,
      data: {
        source_type: "xlsx",
        file_base64: xlsxBase64([
          {
            stem: "Macro file item?",
            option_a: "Ability",
            option_b: "Difficulty",
            key: "A"
          }
        ]),
        source_file_name: "unsafe.xlsm"
      }
    }).then(
      () => {
        throw new Error("XLSM import should be rejected.");
      },
      (error) => {
        assert(String(error).includes("Macro-enabled"), "XLSM rejection should explain macro workbook unsupported.");
      }
    );

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
        item_public_id: { in: committed.imported_item_public_ids },
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
          file_hardening_checked: true,
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
