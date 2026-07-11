import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { hashSecret } from "../src/lib/password";
import { createAssessment } from "../src/lib/services/content/assessments";
import {
  commitMcqItemImport,
  previewMcqItemImport,
  suggestMcqDiagnosticInformation
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

function suggestionRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown) {
  return JSON.stringify(value);
}

async function main() {
  const prefix = `phase31q_assistant_${Date.now()}_${randomUUID().slice(0, 8)}`;
  const teacher = await ensureDemoTeacher();

  try {
    const assessment = await createAssessment({
      teacher_user_db_id: teacher.id,
      data: {
        title: `Temporary ${prefix}`,
        diagnostic_focus: "Separate theta as a person-side ability location from item-side parameters.",
        folder_label: "Phase 31q",
        workflow_mode: "automatic",
        response_collection_mode: "llm_assisted",
        auto_create_primary_topic: true
      }
    });

    const preview = await previewMcqItemImport({
      teacher_user_db_id: teacher.id,
      assessment_public_id: assessment.assessment_public_id,
      data: {
        source_type: "csv",
        source_text: [
          "item_label,stem,option_a,option_b,option_c,key,target_reasoning_note",
          "\"Blank diagnostics\",\"Why is theta not the same as item difficulty?\",\"Theta describes the student location\",\"Theta describes item difficulty\",\"Theta describes guessing\",A,",
          "\"Existing target note\",\"Which statement best separates theta from b?\",\"Theta is person ability\",\"b is person ability\",\"They are identical\",A,\"Teacher already wrote a target note\""
        ].join("\n")
      }
    });
    const [blankCandidate, existingFieldCandidate] = preview.batch.candidates;
    assert(blankCandidate, "Expected blank diagnostic candidate.");
    assert(existingFieldCandidate, "Expected existing-field candidate.");

    const missingKeySuggestion = await suggestMcqDiagnosticInformation({
      teacher_user_db_id: teacher.id,
      assessment_public_id: assessment.assessment_public_id,
      batch_public_id: preview.batch.batch_public_id,
      data: {
        mode: "mock",
        candidate_public_ids: [blankCandidate.candidate_public_id]
      }
    });
    const missingKeyCandidate = missingKeySuggestion.batch.candidates.find(
      (candidate) => candidate.candidate_public_id === blankCandidate.candidate_public_id
    );
    assert(
      missingKeyCandidate?.issue_flags.includes("teacher_confirmed_key_required"),
      "Assistant should require or recognize teacher-confirmed key before strong suggestions."
    );
    assert(
      suggestionRecord(missingKeyCandidate?.suggestion).suggested_target_reasoning_note === null,
      "Assistant should not produce keyed target reasoning without a confirmed key."
    );

    const suggested = await suggestMcqDiagnosticInformation({
      teacher_user_db_id: teacher.id,
      assessment_public_id: assessment.assessment_public_id,
      batch_public_id: preview.batch.batch_public_id,
      data: {
        mode: "mock",
        candidate_public_ids: [blankCandidate.candidate_public_id, existingFieldCandidate.candidate_public_id],
        candidate_updates: [
          {
            candidate_public_id: blankCandidate.candidate_public_id,
            teacher_confirmed_key: "A"
          },
          {
            candidate_public_id: existingFieldCandidate.candidate_public_id,
            teacher_confirmed_key: "A"
          }
        ]
      }
    });
    const blankWithSuggestion = suggested.batch.candidates.find(
      (candidate) => candidate.candidate_public_id === blankCandidate.candidate_public_id
    );
    const existingWithSuggestion = suggested.batch.candidates.find(
      (candidate) => candidate.candidate_public_id === existingFieldCandidate.candidate_public_id
    );
    assert(blankWithSuggestion, "Suggestion result missing blank candidate.");
    assert(existingWithSuggestion, "Suggestion result missing existing-field candidate.");
    const suggestion = suggestionRecord(blankWithSuggestion.suggestion);
    assert(
      text(suggestion).includes(assessment.diagnostic_focus ?? ""),
      "Assistant suggestion should receive assessment diagnostic focus."
    );
    assert(
      text(suggestion).includes("Alternative explanations") ||
        text(suggestion).includes("partial guessing"),
      "Assistant suggestion should include alternative explanations."
    );
    assert(
      text(suggestion).includes("tentative clue"),
      "Distractor notes should remain tentative and plain language."
    );
    assert(
      suggestion.recall_only_warning === false || typeof suggestion.recall_only_warning === "boolean",
      "Recall-only warning field should be present."
    );

    const committed = await commitMcqItemImport({
      teacher_user_db_id: teacher.id,
      assessment_public_id: assessment.assessment_public_id,
      batch_public_id: suggested.batch.batch_public_id,
      data: {
        selected_candidate_public_ids: [
          blankCandidate.candidate_public_id,
          existingFieldCandidate.candidate_public_id
        ],
        candidate_updates: [
          {
            candidate_public_id: blankCandidate.candidate_public_id,
            teacher_confirmed_key: "A",
            suggestion_decisions: {
              suggested_target_reasoning_note: { decision: "accept" },
              suggested_strong_reasoning_should_mention: {
                decision: "edit_accept",
                edited_value: "Edited accepted note: distinguish person ability from item difficulty."
              },
              suggested_plain_language_distractor_notes: { decision: "reject" }
            }
          },
          {
            candidate_public_id: existingFieldCandidate.candidate_public_id,
            teacher_confirmed_key: "A",
            suggestion_decisions: {
              suggested_target_reasoning_note: { decision: "accept" },
              suggested_strong_reasoning_should_mention: { decision: "leave_blank" },
              suggested_plain_language_distractor_notes: { decision: "leave_blank" }
            }
          }
        ]
      }
    });
    assert(committed.imported_count === 2, "Both selected candidates should import as drafts.");

    const importedItems = await prisma.item.findMany({
      where: {
        concept_unit: { assessment: { assessment_public_id: assessment.assessment_public_id } }
      },
      orderBy: { item_order: "asc" },
      select: { item_public_id: true, administration_rules: true }
    });
    assert(importedItems.length === 2, "Imported items missing.");

    const blankDetail = await getItemDetail({
      teacher_user_db_id: teacher.id,
      item_public_id: importedItems[0]!.item_public_id
    });
    const blankMetadata = readTeacherItemMetadata(blankDetail.administration_rules);
    assert(
      blankMetadata.correct_option_notes.target_reasoning_note?.includes("assessment focus"),
      "Accepted target reasoning suggestion was not persisted."
    );
    assert(
      blankMetadata.correct_option_notes.strong_reasoning_should_mention?.includes("Edited accepted note"),
      "Edited accepted strong-reasoning suggestion was not persisted."
    );
    assert(
      !blankMetadata.plain_language_distractor_diagnostic_notes,
      "Rejected distractor suggestion should not modify item data."
    );
    assert(
      text(blankDetail.administration_rules).includes("suggested_plain_language_distractor_notes"),
      "Suggestion review provenance should be retained."
    );

    const existingDetail = await getItemDetail({
      teacher_user_db_id: teacher.id,
      item_public_id: importedItems[1]!.item_public_id
    });
    const existingMetadata = readTeacherItemMetadata(existingDetail.administration_rules);
    assert(
      existingMetadata.correct_option_notes.target_reasoning_note === "Teacher already wrote a target note",
      "Non-empty teacher-authored field should not be overwritten by default."
    );

    const studentProjection = JSON.stringify({
      item_stem: blankDetail.item_stem,
      options: blankDetail.options
    });
    assert(!studentProjection.includes("correct_option"), "Student projection leaked answer-key field.");
    assert(!studentProjection.includes("Edited accepted note"), "Student projection leaked teacher notes.");

    console.log(
      JSON.stringify(
        {
          status: "passed",
          mock_provider_used: true,
          suggestion_separate_from_official_item_data: true,
          accepted_suggestion_recorded: true,
          edited_suggestion_recorded: true,
          rejected_suggestion_not_applied: true,
          non_empty_teacher_field_preserved: true,
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
