import { PrismaClient } from "@prisma/client";
import { parse } from "csv-parse/sync";
import {
  MASTER_EXPORT_COLUMNS,
  MASTER_EXPORT_SCHEMA_VERSION
} from "../src/lib/services/master-export/csv";
import {
  createMasterCsvExport,
  getExportDownload
} from "../src/lib/services/master-export/service";
import {
  commitSummativeOutcomeImport,
  previewSummativeOutcomeImport
} from "../src/lib/services/summative-outcomes/import";
import {
  cleanupDataExportDemoFixture,
  dataExportAssessmentPublicId,
  dataExportCompleteSessionPublicId,
  dataExportConceptUnitPublicId,
  dataExportInactiveSessionPublicId,
  dataExportInactiveStudentUserId,
  dataExportIncompleteSessionPublicId,
  dataExportOutcomeNames,
  dataExportSecondConceptUnitPublicId,
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

function parseRows(contents: Buffer) {
  return parse(contents, {
    bom: true,
    columns: true,
    skip_empty_lines: false
  }) as Array<Record<string, string>>;
}

function jsonColumn<T = unknown>(row: Record<string, string>, column: string): T {
  const value = row[column];
  assert(value, `${column} should be populated.`);
  return JSON.parse(value) as T;
}

function outcomeCsv(rows: string[]) {
  return [
    "user_id,outcome_name,outcome_score,max_score,assessment_date,notes",
    ...rows
  ].join("\n");
}

async function seedOutcomes(teacherUserDbId: string) {
  const preview = await previewSummativeOutcomeImport({
    teacher_user_db_id: teacherUserDbId,
    data: {
      source_file_name: "data-export-demo-complete-outcomes.csv",
      csv_text: outcomeCsv([
        `${dataExportSecondStudentUserId},final_exam,88,100,2026-06-19,Supervised final exam`,
        `${dataExportSecondStudentUserId},final_course_score,91,100,2026-06-19,Supervised final course score`,
        "student_demo,final_exam,79,100,2026-06-19,Supervised final exam"
      ])
    }
  });

  assert(preview.valid_rows === 3, "Outcome preview should have three valid rows.");
  await commitSummativeOutcomeImport({
    teacher_user_db_id: teacherUserDbId,
    batch_public_id: preview.batch_public_id
  });
}

async function exportRows(input: {
  teacherUserDbId: string;
  includeRawJson: boolean;
  spreadsheetSafe: boolean;
}) {
  const job = await createMasterCsvExport({
    teacher_user_db_id: input.teacherUserDbId,
    data: {
      assessment_public_id: dataExportAssessmentPublicId,
      include_incomplete_sessions: true,
      include_raw_json_columns: input.includeRawJson,
      spreadsheet_safe_text: input.spreadsheetSafe,
      primary_outcome_name: dataExportOutcomeNames[0]
    }
  });
  assert(job.status === "completed", "Export job should complete.");
  assert(job.export_schema_version === MASTER_EXPORT_SCHEMA_VERSION, "Schema version mismatch.");
  const download = await getExportDownload(job.export_public_id);
  const rows = parseRows(download.bytes);
  assert(rows.length === job.row_count, "Parsed row count should match export job row count.");

  return { job, download, rows };
}

async function main() {
  await ensureDataExportDemoFixture(prisma);

  try {
    const teacher = await prisma.user.findUniqueOrThrow({ where: { user_id: "teacher_demo" } });
    await seedOutcomes(teacher.id);

    const { job, download, rows } = await exportRows({
      teacherUserDbId: teacher.id,
      includeRawJson: true,
      spreadsheetSafe: true
    });
    const headerLine = download.bytes.toString("utf8").replace(/^\uFEFF/, "").split(/\r?\n/)[0];
    assert(headerLine.split(",").join("|") === MASTER_EXPORT_COLUMNS.join("|"), "Header order changed.");
    assert(job.row_count === 11, "Phase 7B fixture should export eleven rows.");

    const typeCounts = rows.reduce<Record<string, number>>((counts, row) => {
      counts[row.row_type] = (counts[row.row_type] ?? 0) + 1;
      return counts;
    }, {});
    assert(typeCounts.item_response === 9, "Expected nine item-response rows.");
    assert(typeCounts.session_without_item_response === 1, "Expected one session placeholder.");
    assert(typeCounts.concept_unit_without_item_response === 1, "Expected one concept placeholder.");

    const csvText = download.bytes.toString("utf8");
    assert(!uuidPattern.test(csvText), "Internal UUID values should be absent.");
    assert(
      !/(password|access_code|cookie|auth-token|SESSION_SECRET|OPENAI_API_KEY|DATABASE_URL)/i.test(csvText),
      "Secret or auth material leaked into export."
    );

    const secondStudentRows = rows.filter((row) => row.user_id === dataExportSecondStudentUserId);
    assert(secondStudentRows.length === 7, "Multiple summative outcomes should not multiply rows.");
    const primaryOutcomeRows = secondStudentRows.filter(
      (row) => row.primary_summative_outcome_name === "final_exam"
    );
    assert(primaryOutcomeRows.length === secondStudentRows.length, "Primary outcome should repeat by student.");
    const outcomes = jsonColumn<Array<Record<string, unknown>>>(secondStudentRows[0], "summative_outcomes_json");
    assert(outcomes.length === 2, "All active outcomes should be present in summative_outcomes_json.");
    assert(secondStudentRows[0].primary_summative_outcome_percent === "88.0000", "Primary percent mismatch.");

    const profiledRows = rows.filter(
      (row) =>
        row.session_id === dataExportCompleteSessionPublicId &&
        row.concept_unit_id === dataExportConceptUnitPublicId
    );
    assert(profiledRows.length === 3, "Profiled concept should have three item rows.");
    for (const row of profiledRows) {
      assert(row.initial_ability_profile === "fragile_correct_understanding", "Initial profile missing.");
      assert(row.latest_ability_profile === "mostly_correct_understanding", "Latest active profile mismatch.");
      assert(row.profile_count === "2", "Profile count mismatch.");
      assert(row.latest_formative_value === "consolidation_or_transfer", "Latest decision mismatch.");
      assert(row.formative_decision_count === "2", "Decision count mismatch.");
      assert(row.followup_round_count === "2", "Concept follow-up round count mismatch.");
      assert(row.followup_student_turn_count === "2", "Student follow-up turn count mismatch.");
      assert(row.followup_agent_turn_count === "2", "Agent follow-up turn count mismatch.");
      assert(row.followup_update_cycle_count === "2", "Update cycle count mismatch.");
      assert(row.followup_update_completed_count === "1", "Completed update cycle count mismatch.");
      assert(row.followup_update_failed_count === "1", "Failed update cycle count mismatch.");
      assert(row.latest_followup_update_cycle_status === "failed", "Latest update cycle status mismatch.");
      assert(row.progression_record_count === "1", "Concept progression count mismatch.");
      assert(row.latest_progression_resolution_status === "resolved", "Progression resolution mismatch.");
      assert(row.workflow_job_count === "2", "Workflow job count mismatch.");
      assert(row.workflow_job_failed_count === "1", "Workflow failed count mismatch.");
      assert(row.workflow_job_retry_count === "2", "Workflow retry count mismatch.");
      assert(row.workflow_override_count === "1", "Workflow override count mismatch.");
      assert(row.agent_providers === "mock", "Only mock provider should be present.");
      assert(Number(row.agent_call_count) >= 4, "Agent calls should be audited.");
      assert(Number(row.agent_failed_call_count) >= 1, "Failed mock audit call should be counted.");
      assert(row.followup_update_trigger_count === "2", "Update trigger event count mismatch.");
      assert(row.concept_progression_request_count === "1", "Progression request event count mismatch.");
      assert(row.assessment_completed === "true", "Completed session should be marked completed.");
      assert(
        row.final_concept_unit_id === dataExportSecondConceptUnitPublicId,
        "Final concept unit ID mismatch."
      );
      assert(row.final_concept_resolution_status === "unresolved", "Final resolution status mismatch.");

      const profileHistory = jsonColumn<Array<Record<string, unknown>>>(row, "profile_history_json");
      assert(profileHistory.length === 2, "Profile history should include initial and updated profiles.");
      assert(
        profileHistory[0].profile_type === "initial" && profileHistory[1].profile_type === "updated",
        "Profile history should be chronological."
      );
      const cycles = jsonColumn<Array<Record<string, unknown>>>(row, "followup_update_cycles_json");
      assert(cycles.length === 2, "Update cycle history should include success and failure.");
      assert(
        JSON.stringify(cycles).includes("robust_transfer_ready_understanding"),
        "Failed staged update output should remain audit-visible in cycle history."
      );
    }

    const transferRows = rows.filter(
      (row) =>
        row.session_id === dataExportCompleteSessionPublicId &&
        row.concept_unit_id === dataExportSecondConceptUnitPublicId
    );
    assert(transferRows.length === 3, "Second concept should have three item rows.");
    assert(
      transferRows.every(
        (row) =>
          row.latest_ability_profile === "" &&
          row.profile_history_json === "[]" &&
          row.latest_formative_value === "" &&
          row.followup_update_cycle_count === "0" &&
          row.progression_record_count === "1" &&
          row.completed_with_unresolved_evidence === "true"
      ),
      "Concept-specific histories should not repeat the prior concept's latest profile."
    );

    assert(
      rows.some(
        (row) =>
          row.session_id === dataExportIncompleteSessionPublicId &&
          row.row_type === "session_without_item_response" &&
          row.concept_unit_id === ""
      ),
      "Session placeholder row should preserve interrupted sessions."
    );
    const inactivePlaceholder = rows.find(
      (row) => row.session_id === dataExportInactiveSessionPublicId
    );
    assert(inactivePlaceholder, "Inactive account concept placeholder should be exported.");
    assert(inactivePlaceholder.row_type === "concept_unit_without_item_response", "Inactive row type mismatch.");
    assert(inactivePlaceholder.user_id === dataExportInactiveStudentUserId, "Inactive user ID mismatch.");
    assert(inactivePlaceholder.student_account_status === "inactive", "Inactive status should export.");
    assert(inactivePlaceholder.item_id === "", "Concept placeholder should keep item fields blank.");

    const skippedRow = rows.find(
      (row) => row.session_id === dataExportSkippedSessionPublicId && row.skipped_item === "true"
    );
    assert(skippedRow, "Skipped row should be present.");
    assert(skippedRow.correctness === "unanswered", "Skipped evidence should remain distinct from incorrect.");

    const formulaRow = rows.find((row) => row.reasoning_text.startsWith("'=This formula-like"));
    assert(formulaRow, "Formula-like text should be sanitized when enabled.");
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
        "recommended_next_evidence_latest",
        "target_evidence_latest",
        "success_criteria_latest",
        "followup_prompt_constraints_latest",
        "profile_update_triggers_latest",
        "formative_value_history_json",
        "formative_decision_history_json",
        "followup_rounds_json",
        "followup_update_cycles_json",
        "concept_progression_history_json",
        "workflow_jobs_json",
        "workflow_overrides_json",
        "agent_calls_json",
        "summative_outcomes_json"
      ]) {
        if (row[column]) {
          JSON.parse(row[column]);
        }
      }
    }

    const rawDisabled = await exportRows({
      teacherUserDbId: teacher.id,
      includeRawJson: false,
      spreadsheetSafe: true
    });
    assert(
      rawDisabled.rows.every(
        (row) =>
          row.conversation_turns_json === "" &&
          row.process_events_json === "" &&
          row.response_packages_json === "" &&
          row.workflow_jobs_json === "" &&
          row.workflow_overrides_json === "" &&
          row.agent_calls_json === ""
      ),
      "Raw JSON columns should be blank when include_raw_json_columns=false."
    );
    assert(
      rawDisabled.rows.some((row) => row.profile_history_json !== "[]"),
      "Analytical history columns should remain available when raw JSON is disabled."
    );

    const unsafe = await exportRows({
      teacherUserDbId: teacher.id,
      includeRawJson: true,
      spreadsheetSafe: false
    });
    assert(
      unsafe.rows.some((row) => row.reasoning_text.startsWith("=This formula-like")),
      "Spreadsheet-safe disabled export should preserve exact formula-like text."
    );
    assert(
      unsafe.rows.every((row) => row.export_schema_version === MASTER_EXPORT_SCHEMA_VERSION),
      "Every row should include the current schema version."
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

    console.log("Complete master export smoke test passed.");
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
