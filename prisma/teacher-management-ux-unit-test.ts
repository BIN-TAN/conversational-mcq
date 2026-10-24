/**
 * Database-free checks for the instructor management-page improvements (assessment
 * management, student accounts, data and outcomes, shared layout and sign-in lookup).
 * Run with:
 *
 *   npx tsx prisma/teacher-management-ux-unit-test.ts
 *
 * Pure helpers are called directly; the rest is checked in the source. Database-backed
 * behaviour (identical availability counts against real rows, the student filters) is
 * covered by student-selected-session-export-smoke-test.ts,
 * student-teacher-detailed-csv-export-smoke-test.ts and student-account-smoke-test.ts.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

process.env.DATABASE_URL ??= "postgresql://synthetic:synthetic@127.0.0.1:5432/teacher_management_ux_unit";
process.env.SESSION_SECRET ??= "teacher-management-ux-unit-test-session-secret-000000";

// Importing service modules constructs the shared Prisma client, which may fail to load a
// query engine in the background. These checks never query, so only that failure is ignored.
process.on("unhandledRejection", (error) => {
  if ((error as { name?: string })?.name === "PrismaClientInitializationError") return;
  console.error(error);
  process.exitCode = 1;
});

const root = process.cwd();
function source(relativePath: string) {
  return readFileSync(path.join(root, relativePath), "utf8").replace(/\r\n/g, "\n");
}

let passed = 0;
async function check(name: string, run: () => void | Promise<void>) {
  await run();
  passed += 1;
  console.log(`ok - ${name}`);
}

async function main() {
  const labels = await import("../src/lib/teacher-management-labels");
  const { studentListQuerySchema, hasSessionsQuerySchema } = await import(
    "../src/lib/services/student-accounts/service"
  );
  const { countsForSession } = await import("../src/lib/services/teacher-simple-csv-export/service");

  // 1. "No sessions" filter
  await check("has_sessions=false parses to false (not true)", () => {
    assert.equal(studentListQuerySchema.parse({ has_sessions: "false" }).has_sessions, false);
    assert.equal(studentListQuerySchema.parse({ has_sessions: "true" }).has_sessions, true);
    assert.equal(studentListQuerySchema.parse({}).has_sessions, undefined);
    assert.equal(studentListQuerySchema.parse({ has_sessions: "" }).has_sessions, undefined);
  });
  await check("has_sessions survives the second parse in listStudents", () => {
    const once = studentListQuerySchema.parse({ has_sessions: "false" });
    assert.equal(studentListQuerySchema.parse(once).has_sessions, false);
    assert.equal(hasSessionsQuerySchema.parse(true), true);
  });
  await check("has_sessions rejects other text", () => {
    assert.throws(() => studentListQuerySchema.parse({ has_sessions: "no" }));
    assert.throws(() => studentListQuerySchema.parse({ has_sessions: "0" }));
  });

  // 2. Research-data page counts
  await check("availability counts come from relation counts with the same totals", () => {
    const counts = countsForSession(
      {
        session_public_id: "sess_1",
        user: { user_id: "s1" },
        assessment: { assessment_public_id: "asm_1" },
        concept_unit_sessions: [
          { _count: { item_responses: 3, response_packages: 1 } },
          { _count: { item_responses: 2, response_packages: 2 } }
        ],
        _count: { process_events: 7, conversation_turns: 11, agent_calls: 4, formative_conversation_sessions: 0 }
      },
      { activity_attempts: 2, post_activity_evidence: 1, diagnostic_snapshots: 5 }
    );
    assert.deepEqual(counts, {
      sessions: 1,
      item_responses: 5,
      process_events: 7,
      conversation_turns: 11,
      response_packages: 3,
      agent_calls: 4,
      activity_attempts: 2,
      post_activity_evidence: 1,
      diagnostic_snapshots: 5
    });
    const formative = countsForSession(
      {
        session_public_id: "sess_2",
        user: { user_id: "s1" },
        assessment: { assessment_public_id: "asm_1" },
        concept_unit_sessions: [],
        _count: { process_events: 0, conversation_turns: 0, agent_calls: 0, formative_conversation_sessions: 1 }
      },
      { activity_attempts: 9, post_activity_evidence: 0, diagnostic_snapshots: 0 }
    );
    assert.equal(formative.activity_attempts, 0, "Formative-conversation sessions report no legacy activity attempts.");
  });
  await check("the options query no longer loads full session histories; exports still do", () => {
    const service = source("src/lib/services/teacher-simple-csv-export/service.ts");
    const optionsBody = service.slice(
      service.indexOf("export async function listSimpleCsvExplorerOptions"),
      service.indexOf("// Turn-latency rows are not shown on the page")
    );
    assert.ok(optionsBody.includes("loadSessionCounts(input)"));
    assert.ok(!optionsBody.includes("loadSessions("), "Options must not load full sessions.");
    assert.ok(!optionsBody.includes("data_dictionary"), "The page does not read the data dictionary from options.");
    assert.ok(optionsBody.includes("sessions: countsBySession.map"), "The page reads per-session counts for the session scope.");
    assert.ok(service.includes("process_events: true,\n      conversation_turns: true,\n      agent_calls: true"));
    assert.ok(service.includes("turn_latency_row_count: buildTurnLatencyCount(session)"), "Export columns keep latency counts.");
    assert.match(service, /export async function downloadAssessmentCsv[\s\S]*?loadSessions\(input\)/);
    assert.match(service, /export async function downloadStudentAssessmentMatrixCsv[\s\S]*?loadExplorerAssessmentsAndStudents\(input\),\s*loadSessions\(input\)/);
  });
  await check("the research page reads only what it shows and refreshes only jobs after an export", () => {
    const client = source("src/components/teacher-data/research-data-exports-client.tsx");
    assert.ok(!client.includes("latency_rows"));
    assert.ok(!client.includes("data_dictionary:"));
    assert.ok(client.includes("refreshAfterExport(false)"));
    const generate = client.slice(client.indexOf("async function generateDataset"), client.indexOf("return (\n    <div className=\"min-w-0 space-y-6"));
    assert.ok(!generate.includes("await refresh()"), "An export must not reload the availability counts.");
  });

  // 3. Reorder mode
  await check("reorder mode does not reload or replace the active-only draft", () => {
    const list = source("src/components/teacher-content/assessment-list-client.tsx");
    assert.ok(list.includes("isReorderModeRef.current"));
    assert.ok(!list.includes("}, [isReorderMode]);\n\n  useEffect(() => {\n    void loadAssessments();"));
    assert.ok(list.includes("sortAssessments(activeOrganizationAssessments(data.assessments), \"folder_order\")"));
    assert.ok(!list.includes("setDraftAssessments(data.assessments)"));
    assert.ok(list.includes("organizationSignature(activeOrganizationAssessments(assessments))"));
  });

  // 4. Confirmations
  const future = "2099-01-10T15:00:00.000Z";
  const futureClose = "2099-01-20T15:00:00.000Z";
  await check("publish confirmation states when students can start", () => {
    const scheduled = labels.publishConfirmation({
      status: "draft",
      release_at: future,
      close_at: futureClose,
      release_at_course_time: "Jan 10, 2099, 8:00 AM",
      close_at_course_time: "Jan 20, 2099, 8:00 AM"
    });
    assert.equal(scheduled.question, "Publish this mini test?");
    assert.equal(scheduled.sentences[0], "Students can start this mini test from Jan 10, 2099, 8:00 AM until Jan 20, 2099, 8:00 AM.");
    const immediate = labels.publishConfirmation({ status: "draft" });
    assert.match(immediate.sentences[0], /as soon as it is published\. There is no closing date\./);
    const revision = labels.publishConfirmation({ status: "draft", supersedes_assessment_public_id: "asm_old" });
    assert.equal(revision.question, "Publish this corrected version?");
    assert.ok(revision.sentences.includes("The previous version will be archived; existing attempts stay attached to it."));
  });
  await check("archive, restore and return-to-draft confirmations are real questions with accurate effects", () => {
    const archive = labels.archiveConfirmation({ status: "published", title: "Week 3" });
    assert.ok(archive.question.endsWith("?"));
    assert.ok(archive.sentences.includes("Students will no longer be able to start this mini test."));
    assert.ok(archive.sentences.some((sentence) => sentence.includes("Their past attempts are kept.")));
    const restoreStarted = labels.restoreConfirmation({ status: "archived", has_student_sessions: true });
    assert.match(restoreStarted.sentences[0], /published again/);
    const restoreUnused = labels.restoreConfirmation({ status: "archived", assessment_session_count: 0 });
    assert.match(restoreUnused.sentences[0], /return as a draft/);
    assert.ok(labels.returnToDraftConfirmation().question.endsWith("?"));
    const governance = source("src/lib/services/content/governance.ts");
    assert.ok(governance.includes('const restoredStatus = (assessment._count?.assessment_sessions ?? 0) > 0 ? "published" : "draft";'));
  });
  await check("list and detail ask before archive, restore, publish and return to draft", () => {
    const list = source("src/components/teacher-content/assessment-list-client.tsx");
    const detail = source("src/components/teacher-content/assessment-detail-client.tsx");
    assert.ok(list.includes("<ConfirmDialog") && list.includes("archiveConfirmation(") && list.includes("restoreConfirmation("));
    assert.ok(detail.includes("<ConfirmDialog") && detail.includes("publishConfirmation(assessment)"));
    assert.ok(detail.includes("returnToDraftConfirmation()") && detail.includes("archiveConfirmation(assessment)"));
    assert.ok(!detail.includes("window.confirm("));
    assert.ok(detail.includes('onClick={() => setPendingAction("publish")}'));
    assert.ok(source("src/components/ui/confirm-dialog.tsx").includes("<ModalDialog"));
  });

  // 5. Status wording
  const now = new Date("2026-10-23T12:00:00.000Z");
  await check("status phrases combine status, dates and sessions", () => {
    assert.equal(labels.assessmentStatusPhrase({ status: "draft" }, now).label, "Draft – students cannot see it");
    assert.equal(
      labels.assessmentStatusPhrase({ status: "published", release_at: future, release_at_course_time: "Jan 10, 2099" }, now).label,
      "Scheduled – opens Jan 10, 2099"
    );
    assert.equal(labels.assessmentStatusPhrase({ status: "published" }, now).label, "Open to students");
    assert.equal(
      labels.assessmentStatusPhrase({ status: "published", close_at: "2026-10-01T00:00:00.000Z", has_student_sessions: true }, now).label,
      "Closed to new attempts"
    );
    assert.match(
      labels.assessmentStatusPhrase({ status: "published", close_at: "2026-10-01T00:00:00.000Z", has_student_sessions: true }, now).detail,
      /already started can still finish/
    );
    assert.equal(labels.assessmentStatusPhrase({ status: "archived" }, now).label, "Archived");
  });
  await check("no lock-reason codes or topic IDs on the detail page", () => {
    const detail = source("src/components/teacher-content/assessment-detail-client.tsx");
    assert.ok(!detail.includes("Lock reason"));
    assert.ok(!detail.includes("Publishable topics"));
    assert.ok(labels.contentLockSentence("student_session_exists").startsWith("Locked because students have started"));
    assert.ok(!labels.contentLockSentence("student_session_exists").includes("_"));
    const ui = source("src/components/teacher-content/ui.tsx");
    assert.ok(ui.includes("assessmentStatusPhrase({ ...assessment, status })"));
    assert.ok(source("src/components/teacher-content/assessment-list-client.tsx").includes("<StatusBadge assessment={assessment} status={assessment.status} />"));
  });

  // 6. Labels instead of internal codes
  await check("student status and export history label maps", () => {
    assert.equal(labels.studentStatusLabel("temporary_pending"), "Must change password");
    assert.equal(labels.studentStatusLabel("active"), "Active");
    assert.equal(labels.exportScopeLabel("all_authorized"), "All your data");
    assert.equal(labels.exportScopeLabel(""), "Earlier export");
    assert.equal(labels.exportTypeLabel("research_dataset"), "Research dataset");
    assert.equal(labels.exportStatusLabel("completed"), "Ready");
    assert.ok(!labels.exportFailureLabel("research_pseudonymization_key_missing").includes("_"));
    assert.equal(labels.exportFailureLabel("something_unknown"), "The file could not be generated.");
  });
  await check("on-screen student labels say Student ID; CSV templates keep user_id", () => {
    for (const file of [
      "src/components/teacher-students/student-list-client.tsx",
      "src/components/teacher-students/new-student-client.tsx",
      "src/components/teacher-students/student-detail-client.tsx",
      "src/components/teacher-students/roster-import-client.tsx",
      "src/components/teacher-students/ui.tsx",
      "src/components/teacher-data/summative-outcomes-client.tsx"
    ]) {
      const text = source(file);
      assert.ok(!/>\s*user_id\s*</.test(text), `${file} should not show user_id as a label.`);
      assert.ok(!text.includes('placeholder="user_id'), `${file} should not use user_id as a placeholder.`);
    }
    assert.ok(source("src/components/teacher-students/roster-import-client.tsx").includes('"user_id,display_name,email",'));
    assert.ok(source("src/components/teacher-data/summative-outcomes-client.tsx").includes("const sampleCsv = `user_id,outcome_name"));
    assert.ok(source("src/lib/services/student-accounts/credentials.ts").includes('columns: ["user_id", "display_name", "email", "temporary_access_code", "temporary_password"]'));
  });
  await check("service messages do not name internal fields or roles", () => {
    const service = source("src/lib/services/student-accounts/service.ts");
    const validation = source("src/lib/services/student-accounts/validation.ts");
    assert.ok(!service.includes("belongs to a teacher_researcher account"));
    assert.ok(!service.includes("already exists for this user_id"));
    assert.ok(!validation.includes('"user_id is required."'));
    assert.ok(!source("src/lib/services/student-accounts/deletion.ts").includes("Only teacher_researcher users"));
  });
  await check("error panels show a plain message with technical details folded away", () => {
    for (const file of ["src/components/teacher-students/ui.tsx", "src/components/teacher-data/ui.tsx"]) {
      const text = source(file);
      assert.ok(text.includes('role="alert"'), file);
      assert.ok(text.includes("Technical details"), file);
      assert.ok(!text.includes('<p className="mt-1 text-xs uppercase tracking-wide text-red-700">{error.code}</p>'), file);
    }
  });
  await check("public IDs sit behind Show ID / Copy ID", () => {
    const ui = source("src/components/teacher-content/ui.tsx");
    assert.ok(ui.includes("Show ID") && ui.includes("Copy ID"));
    const list = source("src/components/teacher-content/assessment-list-client.tsx");
    const detail = source("src/components/teacher-content/assessment-detail-client.tsx");
    assert.ok(!list.includes('<p className="mt-1 font-mono text-xs text-muted">{assessment.assessment_public_id}</p>'));
    assert.ok(!detail.includes('<span className="font-mono text-xs text-muted">{assessment.assessment_public_id}</span>'));
    assert.ok(!detail.includes('<p className="mt-2 font-mono text-xs text-muted">{item.item_public_id}</p>'));
    assert.ok(!source("src/components/teacher-data/research-data-exports-client.tsx").includes('placeholder="sess_..."'));
  });

  // 7. Restricted-fields export
  await check("restricted fields need a dialog before confirm_restricted_fields is sent", () => {
    const client = source("src/components/teacher-data/research-data-exports-client.tsx");
    const scopeQuery = client.slice(client.indexOf("function scopeQuery("), client.indexOf("function withRestrictedConfirmation("));
    assert.ok(!scopeQuery.includes('params.set("confirm_restricted_fields", "true")'));
    assert.ok(client.includes("setPendingRestrictedQuery(query)"));
    assert.ok(client.includes("withRestrictedConfirmation(pendingRestrictedQuery)"));
    assert.ok(client.includes('question="Include restricted research fields in this file?"'));
  });
  await check("retry reruns the failed job's own settings when they are recorded", () => {
    assert.deepEqual(
      labels.researchExportRetryQuery({
        export_type: "research_dataset",
        export_scope: "selected_assessment",
        selected_assessment_public_id: "asm_1",
        include_incomplete_sessions: false,
        restricted_fields_included: true,
        participant_filter_mode: "none"
      }),
      { query: "?assessment_public_id=asm_1&include_incomplete_sessions=false&include_restricted_fields=true", restricted: true }
    );
    assert.deepEqual(
      labels.researchExportRetryQuery({ export_type: "research_dataset", export_scope: "all_authorized" }),
      { query: "?include_incomplete_sessions=true", restricted: false }
    );
    assert.equal(
      labels.researchExportRetryQuery({ export_type: "research_dataset", export_scope: "selected_student", selected_student_requested: true }),
      null,
      "A single-student job records only a fingerprint, so it cannot be rerun as-is."
    );
    assert.equal(
      labels.researchExportRetryQuery({ export_type: "research_dataset", export_scope: "all_authorized", participant_filter_mode: "include_list" }),
      null
    );
    const client = source("src/components/teacher-data/research-data-exports-client.tsx");
    assert.ok(client.includes('"Retry with the same settings" : "Generate again with current settings"'));
  });

  // 8. Student search
  await check("student search is debounced, cancels stale requests and keeps rows", () => {
    const list = source("src/components/teacher-students/student-list-client.tsx");
    assert.ok(list.includes("SEARCH_DEBOUNCE_MS = 300"));
    assert.ok(list.includes("new AbortController()") && list.includes("controller.abort()"));
    assert.ok(list.includes("fetchStudents(filters, controller.signal)"));
    assert.ok(list.includes("{data && data.students.length > 0 ? ("), "Rows stay visible while loading.");
    assert.ok(list.includes("Updating the list"));
    assert.ok(source("src/components/teacher-students/api.ts").includes("{ signal }"));
  });

  // 9. One sign-in lookup per request
  await check("getCurrentUser is wrapped in React cache()", () => {
    const auth = source("src/lib/auth.ts");
    assert.ok(auth.includes('import { cache } from "react";'));
    assert.ok(auth.includes("const getCurrentUserForRequest = cache("));
    assert.ok(auth.includes(".catch(() => null);"), "Sign-in failure behaviour is unchanged.");
  });

  // 10. Smaller job and detail queries
  await check("export job history reads a few jobs with a small select", () => {
    const service = source("src/lib/services/master-export/service.ts");
    assert.ok(service.includes("export const EXPORT_JOB_LIST_DEFAULT_LIMIT = 10;"));
    assert.ok(service.includes("take: limit,"));
    const assessments = source("src/lib/services/content/assessments.ts");
    const detail = assessments.slice(assessments.indexOf("export async function getAssessmentDetail"), assessments.indexOf("export async function updateAssessment"));
    assert.ok(!detail.includes("          assessment: {\n            select: {"), "Topics reuse the loaded parent assessment.");
    const client = source("src/components/teacher-content/assessment-detail-client.tsx");
    const handler = client.slice(client.indexOf("function handleItemsDeleted"), client.indexOf("useEffect(() => {\n    void loadAssessment();"));
    assert.ok(!handler.includes("apiRequest"), "Deleting items does not reload the mini test.");
  });

  // 11. Accessibility and narrow layouts
  await check("one h1 per page, disabled download button, single item-action area, scrollable table", () => {
    assert.equal(labels.pageRendersOwnHeading("/teacher/content/assessments"), true);
    assert.equal(labels.pageRendersOwnHeading("/teacher/students/new"), true);
    assert.equal(labels.pageRendersOwnHeading("/teacher/students/student001"), true);
    assert.equal(labels.pageRendersOwnHeading("/teacher/students"), false);
    assert.equal(labels.pageRendersOwnHeading("/teacher/students/invitations"), false);
    assert.equal(labels.pageRendersOwnHeading("/teacher/dashboard"), false);
    assert.equal(labels.pageRendersOwnHeading("/teacher/data/research"), true);
    const header = source("src/components/teacher-workspace-header.tsx");
    assert.ok(header.includes('pageRendersOwnHeading(pathname) ? "p" : "h1"'));
    const research = source("src/components/teacher-data/research-data-exports-client.tsx");
    assert.ok(!research.includes('href={disabled ? "#" : href}'));
    assert.ok(research.includes("<button className={buttonClass(true)} disabled type=\"button\">"));
    const detail = source("src/components/teacher-content/assessment-detail-client.tsx");
    assert.equal((detail.match(/Design and generate\n/g) ?? []).length, 1, "Item actions appear once on the detail page.");
    assert.ok(detail.includes("Add another MCQ item"));
    const list = source("src/components/teacher-content/assessment-list-client.tsx");
    assert.ok(list.includes("Scroll sideways to see every column.") && list.includes('role="region"'));
  });

  console.log(`teacher-management-ux-unit-test: ${passed} checks passed`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
