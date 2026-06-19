import { PrismaClient } from "@prisma/client";
import { parse } from "csv-parse/sync";
import { canAccessMasterExport } from "../src/lib/services/master-export/api";
import { MASTER_EXPORT_COLUMNS } from "../src/lib/services/master-export/csv";
import {
  createMasterCsvExport,
  getExportDownload
} from "../src/lib/services/master-export/service";
import { exportStorageDirectory } from "../src/lib/services/master-export/storage";
import {
  commitSummativeOutcomeImport,
  previewSummativeOutcomeImport
} from "../src/lib/services/summative-outcomes/import";
import {
  cleanupDataExportDemoFixture,
  dataExportAssessmentPublicId,
  dataExportIncompleteSessionPublicId,
  dataExportOutcomeNames,
  dataExportSecondStudentUserId,
  dataExportSkippedSessionPublicId,
  ensureDataExportDemoFixture
} from "./demo-data-export-fixture";

const prisma = new PrismaClient();
const uuidPattern =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function csv(rows: string[]) {
  return [
    "user_id,outcome_name,outcome_score,max_score,assessment_date,notes",
    ...rows
  ].join("\n");
}

function parseRows(contents: Buffer) {
  return parse(contents, {
    bom: true,
    columns: true,
    skip_empty_lines: false
  }) as Array<Record<string, string>>;
}

function jsonColumn(row: Record<string, string>, column: string) {
  const value = row[column];

  if (!value) {
    return null;
  }

  return JSON.parse(value) as unknown;
}

async function seedOutcomes(teacherUserDbId: string) {
  const preview = await previewSummativeOutcomeImport({
    teacher_user_db_id: teacherUserDbId,
    data: {
      source_file_name: "data-export-demo-outcomes.csv",
      csv_text: csv([
        `${dataExportSecondStudentUserId},final_exam,88,100,2026-06-19,Supervised final exam`,
        `${dataExportSecondStudentUserId},final_course_score,91,100,2026-06-19,Supervised final course score`,
        "student_demo,final_exam,79,100,2026-06-19,Supervised final exam"
      ])
    }
  });

  assert(preview.valid_rows === 3, "Outcome seed preview should have three valid rows.");
  await commitSummativeOutcomeImport({
    teacher_user_db_id: teacherUserDbId,
    batch_public_id: preview.batch_public_id
  });
}

async function main() {
  await ensureDataExportDemoFixture(prisma);

  try {
    const teacher = await prisma.user.findUniqueOrThrow({ where: { user_id: "teacher_demo" } });
    const student = await prisma.user.findUniqueOrThrow({ where: { user_id: "student_demo" } });
    await seedOutcomes(teacher.id);

    assert(canAccessMasterExport(teacher.role), "Teacher should be authorized for master export.");
    assert(!canAccessMasterExport(student.role), "Student should not be authorized for master export.");

    const job = await createMasterCsvExport({
      teacher_user_db_id: teacher.id,
      data: {
        assessment_public_id: dataExportAssessmentPublicId,
        include_incomplete_sessions: true,
        include_raw_json_columns: true,
        spreadsheet_safe_text: true,
        primary_outcome_name: dataExportOutcomeNames[0]
      }
    });

    assert(job.export_public_id, "Export job should receive a public export ID.");
    assert(job.status === "completed", "Export job should complete.");
    assert(job.export_schema_version === "1.0.0", "Export schema version mismatch.");
    assert((job.row_count ?? 0) > 0, "Export should include rows.");

    const persistedJob = await prisma.exportJob.findUniqueOrThrow({
      where: { export_public_id: job.export_public_id },
      select: { storage_key: true, file_name: true }
    });

    assert(persistedJob.storage_key?.endsWith(".csv"), "Export should have a CSV storage key.");
    assert(
      exportStorageDirectory().includes(".data") && !exportStorageDirectory().includes("/public/"),
      "Export files should be stored outside public static folders."
    );

    const download = await getExportDownload(job.export_public_id);
    assert(download.file_name === "master_assessment_export.csv", "Download file name mismatch.");
    const rows = parseRows(download.bytes);
    const headerLine = download.bytes.toString("utf8").replace(/^\uFEFF/, "").split(/\r?\n/)[0];
    const headers = headerLine.split(",");

    assert(
      headers.join("|") === MASTER_EXPORT_COLUMNS.join("|"),
      "Header order is not stable."
    );
    assert(rows.length === job.row_count, "Row count should match parsed CSV records.");
    assert(
      rows.some((row) => row.row_type === "item_response"),
      "Item-response rows should be present."
    );
    assert(
      rows.some(
        (row) =>
          row.row_type === "session_without_item_response" &&
          row.session_id === dataExportIncompleteSessionPublicId
      ),
      "Incomplete session placeholder row should be present."
    );

    const skippedRow = rows.find(
      (row) => row.session_id === dataExportSkippedSessionPublicId && row.skipped_item === "true"
    );

    assert(skippedRow, "Skipped evidence row should be present.");
    assert(skippedRow.correctness === "unanswered", "Skipped evidence should remain unanswered.");
    assert(rows.every((row) => row.session_id && row.assessment_id), "Public IDs should be present.");

    const csvText = download.bytes.toString("utf8");
    assert(!uuidPattern.test(csvText), "Internal UUID values should be absent from normal export output.");
    assert(
      !/(password|access_code|cookie|auth-token|SESSION_SECRET|OPENAI_API_KEY)/i.test(csvText),
      "Export should not include auth secret or environment data."
    );

    const studentExportRows = rows.filter((row) => row.user_id === dataExportSecondStudentUserId);
    assert(
      studentExportRows.length === 4,
      "Multiple summative outcomes should not multiply item-response rows."
    );

    for (const row of studentExportRows) {
      assert(row.primary_summative_outcome_name === "final_exam", "Primary outcome name missing.");
      assert(row.primary_summative_outcome_score === "88", "Primary outcome score mismatch.");
      assert(row.primary_summative_outcome_max_score === "100", "Primary outcome max mismatch.");
      assert(row.primary_summative_outcome_percent === "88.0000", "Primary outcome percent mismatch.");
      const outcomes = jsonColumn(row, "summative_outcomes_json") as unknown[];
      assert(Array.isArray(outcomes) && outcomes.length === 2, "All active outcomes should be in JSON.");
    }

    const formulaRow = rows.find((row) => row.reasoning_text.startsWith("'=This formula-like"));
    assert(formulaRow, "Formula-like student text should be sanitized.");
    assert(
      formulaRow.spreadsheet_formula_sanitization_applied === "true",
      "Formula sanitization flag should be true."
    );

    for (const row of rows) {
      for (const column of [
        "options_snapshot_json",
        "conversation_turns_json",
        "process_events_json",
        "response_packages_json",
        "profile_history_json",
        "integrated_profile_history_json",
        "formative_value_history_json",
        "followup_rounds_json",
        "agent_calls_json",
        "summative_outcomes_json"
      ]) {
        if (row[column]) {
          JSON.parse(row[column]);
        }
      }
    }

    assert(
      rows.every(
        (row) =>
          row.initial_ability_profile === "" &&
          row.latest_ability_profile === "" &&
          row.initial_integrated_diagnostic_profile === "" &&
          row.latest_integrated_diagnostic_profile === "" &&
          row.profile_history_json === "[]"
      ),
      "Profile fields should remain blank before agents are implemented."
    );
    assert(
      rows.every(
        (row) =>
          row.initial_formative_value === "" &&
          row.latest_formative_value === "" &&
          row.formative_value_history_json === "[]" &&
          row.followup_rounds_json === "[]"
      ),
      "Formative fields should remain blank before agents are implemented."
    );
    assert(
      rows.every(
        (row) =>
          row.agent_model_names === "" &&
          row.agent_versions === "" &&
          row.prompt_versions === "" &&
          row.schema_versions === "" &&
          row.agent_call_count === "0" &&
          row.agent_validation_failure_count === "0" &&
          row.agent_calls_json === "[]"
      ),
      "Agent fields should remain empty or zero before OpenAI integration."
    );
    assert(
      rows.every((row) => row.export_schema_version === "1.0.0"),
      "Every row should include export schema version."
    );

    await cleanupDataExportDemoFixture(prisma);
    assert(
      await prisma.user.findUnique({ where: { user_id: "teacher_demo" } }),
      "Cleanup should preserve teacher_demo."
    );
    assert(
      await prisma.user.findUnique({ where: { user_id: "student_demo" } }),
      "Cleanup should preserve student_demo."
    );

    console.log("Master export smoke test passed.");
  } finally {
    await cleanupDataExportDemoFixture(prisma);
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
