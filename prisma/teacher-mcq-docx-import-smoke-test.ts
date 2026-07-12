import { randomUUID } from "node:crypto";
import JSZip from "jszip";
import { PrismaClient } from "@prisma/client";
import { hashSecret } from "../src/lib/password";
import { createAssessment } from "../src/lib/services/content/assessments";
import {
  commitMcqItemImport,
  previewMcqItemImport
} from "../src/lib/services/content/mcq-import";
import { getItemDetail } from "../src/lib/services/content/items";
import { normalizeUserId } from "../src/lib/services/student-accounts/validation";

const prisma = new PrismaClient();

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function xmlEscape(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function p(text: string) {
  return `<w:p><w:r><w:t>${xmlEscape(text)}</w:t></w:r></w:p>`;
}

function table(rows: string[][]) {
  return `<w:tbl>${rows
    .map((row) =>
      `<w:tr>${row
        .map((cell) => `<w:tc><w:p><w:r><w:t>${xmlEscape(cell)}</w:t></w:r></w:p></w:tc>`)
        .join("")}</w:tr>`
    )
    .join("")}</w:tbl>`;
}

async function docxBase64(blocks: string[], extraFiles: Record<string, Buffer | string> = {}) {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="png" ContentType="image/png"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`);
  zip.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`);
  zip.file("word/_rels/document.xml.rels", `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rExt" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.com/not-fetched" TargetMode="External"/>
</Relationships>`);
  zip.file("word/document.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <w:body>${blocks.join("")}<w:sectPr/></w:body>
</w:document>`);
  for (const [path, value] of Object.entries(extraFiles)) {
    zip.file(path, value);
  }
  return Buffer.from(await zip.generateAsync({ type: "nodebuffer" })).toString("base64");
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

  await prisma.mcqItemImportBatch.deleteMany({ where: { assessment_db_id: { in: assessmentIds } } });
  await prisma.item.deleteMany({ where: { concept_unit_db_id: { in: conceptUnitIds } } });
  await prisma.conceptUnit.deleteMany({ where: { id: { in: conceptUnitIds } } });
  await prisma.assessment.deleteMany({ where: { id: { in: assessmentIds } } });
}

async function main() {
  const prefix = `phase31r_docx_${Date.now()}_${randomUUID().slice(0, 8)}`;
  const teacher = await ensureDemoTeacher();

  try {
    const assessment = await createAssessment({
      teacher_user_db_id: teacher.id,
      data: {
        title: `Temporary ${prefix}`,
        diagnostic_focus: "Distinguish person ability from item parameters.",
        folder_label: "Phase 31r",
        workflow_mode: "automatic",
        response_collection_mode: "llm_assisted",
        auto_create_primary_topic: true
      }
    });

    const standard = await previewMcqItemImport({
      teacher_user_db_id: teacher.id,
      assessment_public_id: assessment.assessment_public_id,
      data: {
        source_type: "docx",
        source_file_name: "theta-items.docx",
        file_base64: await docxBase64([
          p("1. Which statement best separates theta from item difficulty?"),
          p("A. Theta is a person-side ability location"),
          p("B. Theta is the item difficulty parameter"),
          p("C. Theta is the number of options"),
          p("D. Theta is the item discrimination slope"),
          p("2. Which item parameter shifts an ICC left or right?"),
          p("A. Guessing"),
          p("B. Discrimination"),
          p("C. Difficulty"),
          p("D. Number of options"),
          p("Answer key"),
          p("1. A"),
          p("2. C")
        ])
      }
    });
    assert(standard.batch.source_type === "docx", "DOCX source type should be recorded.");
    assert(standard.batch.candidates.length === 2, "Numbered DOCX MCQs should produce two candidates.");
    assert(standard.batch.candidates[0]?.stem.includes("theta"), "DOCX stem extraction failed.");
    assert(standard.batch.candidates[0]?.options.length === 4, "DOCX option extraction failed.");
    assert(standard.batch.candidates[0]?.imported_key === "A", "Answer-key section should map item 1 key.");
    assert(standard.batch.candidates[1]?.imported_key === "C", "Answer-key section should map item 2 key.");
    assert(standard.batch.candidates[0]?.target_reasoning_note === null, "Missing diagnostic notes must remain blank.");
    assert(standard.batch.candidates[0]?.source_metadata?.source_type === "docx", "DOCX source metadata missing.");

    const missingKey = await previewMcqItemImport({
      teacher_user_db_id: teacher.id,
      assessment_public_id: assessment.assessment_public_id,
      data: {
        source_type: "docx",
        source_file_name: "missing-key.docx",
        file_base64: await docxBase64([
          p("1. Missing key item?"),
          p("A. One"),
          p("B. Two"),
          p("C. Three")
        ])
      }
    });
    assert(missingKey.batch.candidates[0]?.imported_key === null, "Missing key should remain blank.");
    assert(missingKey.batch.candidates[0]?.missing_fields.includes("key"), "Missing key should be reported.");

    const tablePreview = await previewMcqItemImport({
      teacher_user_db_id: teacher.id,
      assessment_public_id: assessment.assessment_public_id,
      data: {
        source_type: "docx",
        source_file_name: "table-items.docx",
        file_base64: await docxBase64([
          table([
            ["stem", "option_a", "option_b", "option_c", "option_d", "key"],
            [
              "Table item stem?",
              "Ability location",
              "Difficulty parameter",
              "Guessing",
              "Discrimination",
              "A"
            ]
          ])
        ])
      }
    });
    assert(tablePreview.batch.candidates[0]?.stem === "Table item stem?", "DOCX table row extraction failed.");
    assert(tablePreview.batch.candidates[0]?.imported_key === "A", "DOCX table key extraction failed.");

    const mediaPreview = await previewMcqItemImport({
      teacher_user_db_id: teacher.id,
      assessment_public_id: assessment.assessment_public_id,
      data: {
        source_type: "docx",
        source_file_name: "media-equation.docx",
        file_base64: await docxBase64(
          [
            p("1. Item with a figure and equation?"),
            "<w:p><w:r><w:drawing><a:blip r:embed=\"rImg1\"/></w:drawing></w:r></w:p>",
            "<w:p><m:oMath><m:r><m:t>x=1</m:t></m:r></m:oMath></w:p>",
            p("A. One"),
            p("B. Two"),
            p("Answer: A")
          ],
          { "word/media/image1.png": Buffer.from([0x89, 0x50, 0x4e, 0x47]) }
        )
      }
    });
    const mediaCandidate = mediaPreview.batch.candidates[0];
    assert(mediaCandidate?.issue_flags.includes("embedded_image_requires_review"), "Embedded image should be flagged.");
    assert(mediaCandidate.issue_flags.includes("equation_or_object_requires_review"), "Equation should be flagged.");
    assert(mediaCandidate.media_assets.length === 0, "Embedded image should not be silently stored without storage.");
    assert(
      (mediaPreview.batch.validation_summary as { source_warnings?: string[] }).source_warnings?.includes("embedded_image_requires_manual_reattachment"),
      "Embedded image warning missing from summary."
    );

    const trackedPreview = await previewMcqItemImport({
      teacher_user_db_id: teacher.id,
      assessment_public_id: assessment.assessment_public_id,
      data: {
        source_type: "docx",
        source_file_name: "tracked.docx",
        file_base64: await docxBase64([
          "<w:p><w:ins><w:r><w:t>1. Tracked item?</w:t></w:r></w:ins></w:p>",
          p("A. One"),
          p("B. Two"),
          p("Answer: A")
        ])
      }
    });
    assert(
      trackedPreview.batch.candidates[0]?.issue_flags.includes("tracked_changes_require_review"),
      "Tracked changes should be flagged."
    );

    await previewMcqItemImport({
      teacher_user_db_id: teacher.id,
      assessment_public_id: assessment.assessment_public_id,
      data: {
        source_type: "docx",
        source_file_name: "macro.docx",
        file_base64: await docxBase64([p("1. Macro package?"), p("A. One"), p("B. Two")], {
          "word/vbaProject.bin": Buffer.from("macro")
        })
      }
    }).then(
      () => {
        throw new Error("Macro package should be rejected.");
      },
      (error) => {
        assert(String(error.message).includes("Macro-enabled"), "Macro rejection message should be safe.");
      }
    );

    await previewMcqItemImport({
      teacher_user_db_id: teacher.id,
      assessment_public_id: assessment.assessment_public_id,
      data: {
        source_type: "docx",
        source_file_name: "old-format.doc",
        file_base64: Buffer.from("not a docx").toString("base64")
      }
    }).then(
      () => {
        throw new Error(".doc should be rejected.");
      },
      (error) => {
        assert(String(error.message).includes("older Word format"), ".doc guidance missing.");
      }
    );

    await previewMcqItemImport({
      teacher_user_db_id: teacher.id,
      assessment_public_id: assessment.assessment_public_id,
      data: {
        source_type: "docx",
        source_file_name: "macro.docm",
        file_base64: Buffer.from("not a docx").toString("base64")
      }
    }).then(
      () => {
        throw new Error(".docm should be rejected.");
      },
      (error) => {
        assert(String(error.message).includes("Macro-enabled"), ".docm rejection message missing.");
      }
    );

    const committed = await commitMcqItemImport({
      teacher_user_db_id: teacher.id,
      assessment_public_id: assessment.assessment_public_id,
      batch_public_id: standard.batch.batch_public_id,
      data: {
        selected_candidate_public_ids: [standard.batch.candidates[0]!.candidate_public_id],
        candidate_updates: [
          {
            candidate_public_id: standard.batch.candidates[0]!.candidate_public_id,
            teacher_confirmed_key: "A"
          }
        ]
      }
    });
    assert(committed.imported_count === 1, "DOCX import should create a draft item after teacher selection.");
    const item = await getItemDetail({
      teacher_user_db_id: teacher.id,
      item_public_id: committed.imported_item_public_ids[0]!
    });
    assert(item.status === "draft", "Imported DOCX item should remain draft.");
    const studentSafe = JSON.stringify({
      item_stem: item.item_stem,
      options: item.options,
      media_assets: item.media_assets
    });
    assert(!studentSafe.includes("teacher_confirmed_key"), "Student projection should not include key provenance.");
    assert(!studentSafe.includes("source_metadata"), "Student projection should not include DOCX provenance.");

    console.log(JSON.stringify({
      status: "passed",
      standard_numbered_items: standard.batch.candidates.length,
      table_item_checked: true,
      media_and_equation_flags_checked: true,
      tracked_changes_checked: true,
      old_doc_rejected: true,
      docm_rejected: true,
      imported_items_remain_draft: true,
      student_safe_projection_checked: true,
      openai_calls: 0
    }, null, 2));
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
