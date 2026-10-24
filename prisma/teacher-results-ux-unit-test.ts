/**
 * Instructor results pages: loading and presentation (release CMCQ-20261024-09), without a
 * database or provider calls.
 * - plain labels for the codes instructors see, and plain review reasons;
 * - "Students to follow up" ordering;
 * - session list filters kept in the address;
 * - the dashboard loads only the earliest initial response package and gets the same result;
 * - source checks for the rest (instructor report status, background steps, tabs, wording).
 * Run with: npx tsx prisma/teacher-results-ux-unit-test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

let passed = 0;
async function check(name: string, run: () => void | Promise<void>) {
  await run();
  passed += 1;
  console.log(`ok - ${name}`);
}

function source(relativePath: string) {
  return readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

async function main() {
  const { plainLabel, plainReviewReason, TEACHER_PLAIN_LABELS } = await import("../src/lib/teacher-plain-labels");
  const { followUpPriority, sortStudentsToFollowUp } = await import("../src/lib/services/teacher-dashboard/follow-up");
  const { observeAttempts } = await import("../src/lib/services/teacher-dashboard/attempt-comparison");
  const query = await import("../src/components/teacher-review/session-list-query");
  const { teacherPhaseLabel } = await import("../src/lib/teacher-session-labels");
  const enums = await import("../src/lib/domain/enums");

  await check("Plain labels: codes instructors see read as plain English", () => {
    assert.equal(plainLabel("student_exited"), "Ended by the student");
    assert.equal(plainLabel("automatic_failed"), "Automatic preparation failed");
    assert.equal(plainLabel("teacher_assistance_recommended"), "Instructor assistance recommended");
    assert.equal(plainLabel("teacher_support_recommended"), "Instructor assistance recommended");
    assert.equal(plainLabel("needs_review"), "Needs review");
    assert.equal(plainLabel("not_flagged"), "Not flagged");
    assert.equal(plainLabel("deterministic"), "Standard answer form");
    assert.equal(plainLabel("llm_assisted"), "Answers collected in conversation");
    assert.equal(plainLabel("conversation_in_progress"), "Conversation in progress");
    // Unknown codes become words; text that is already plain is unchanged.
    assert.equal(plainLabel("some_new_code"), "Some new code");
    assert.equal(plainLabel("Answering questions"), "Answering questions");
    assert.equal(plainLabel(null), "Not recorded");
    for (const value of Object.values(TEACHER_PLAIN_LABELS)) {
      assert.doesNotMatch(value, /_|\bLLM\b|deterministic|user_id|public ID/i, `Label ${value} uses jargon.`);
    }
  });

  await check("Plain labels: every status, step and mode an instructor sees has a written label", () => {
    for (const code of [...enums.sessionStatuses, ...enums.sessionAutomationStates, ...enums.workflowJobTypes,
      ...enums.workflowJobStatuses, ...enums.workflowOverrideActionTypes, ...enums.assessmentWorkflowModes,
      ...enums.responseCollectionModes, ...enums.conceptUnitSessionStatuses, ...enums.followupStatuses,
      ...enums.responseCorrectnessValues, ...enums.assessmentPhases]) {
      assert.ok(TEACHER_PLAIN_LABELS[code], `No plain label for ${code}.`);
    }
    // Phase labels fall back to the same map.
    assert.equal(teacherPhaseLabel("between_concept_units"), "Between topics");
    assert.equal(teacherPhaseLabel("planning_completed"), "Learning conversation");
  });

  await check("Review reasons: stored codes become sentences; written sentences are kept", () => {
    assert.equal(plainReviewReason("automatic_workflow_failed:run_initial_profiling:timeout"), "Automatic preparation failed.");
    assert.equal(plainReviewReason("followup_update_failed:schema_invalid"), "A profile update during the learning conversation failed.");
    assert.equal(
      plainReviewReason("followup_evidence_ready_for_profile_update\nLearning support could not be prepared; the student finished the assessment without it."),
      "The learning conversation is ready for a profile update. Learning support could not be prepared; the student finished the assessment without it."
    );
    assert.equal(plainReviewReason("unknown_reason_code"), "Unknown reason code.");
    assert.equal(plainReviewReason(null), null);
    assert.equal(plainReviewReason("  "), null);
  });

  await check("Students to follow up: Need more work and instructor assistance first, then review flags, then by name", () => {
    const row = (name: string, latest: string, conversation: string, review = false) => ({
      student_user_id: name.toLowerCase(), student_name: name, session_public_id: `s-${name}`, attempt_number: 1,
      initial_understanding: "Still developing", latest_understanding: latest, conversation_update: conversation,
      needs_review: review, needs_review_reason: null
    });
    const rows = [
      row("Zoe", "Mostly understood", "No profile update"),
      row("Yan", "Mostly understood", "No profile update", true),
      row("Xia", "Still developing", "Instructor assistance recommended"),
      row("Ana", "Mostly understood", "Sound understanding"),
      row("Bo", "Need more work", "No profile update")
    ];
    assert.deepEqual(sortStudentsToFollowUp(rows).map((entry) => entry.student_name), ["Bo", "Xia", "Yan", "Ana", "Zoe"]);
    assert.equal(followUpPriority(rows[4]), 0);
    assert.equal(followUpPriority(rows[1]), 1);
    assert.equal(followUpPriority(rows[0]), 2);
    // Sorting never changes the rows themselves.
    assert.deepEqual(sortStudentsToFollowUp(rows).map((entry) => entry.latest_understanding).sort(), rows.map((entry) => entry.latest_understanding).sort());
  });

  await check("Session list: filters, sort and page round-trip through the address", () => {
    const filters = { ...query.DEFAULT_SESSION_LIST_FILTERS, search: " ana ", status: "completed", sort: "completed_at" as const,
      direction: "asc" as const, page: 3, page_size: 50, needs_review: "true" };
    const serialized = query.serializeSessionListQuery(filters);
    assert.equal(serialized, "search=ana&status=completed&needs_review=true&sort=completed_at&direction=asc&page=3&page_size=50");
    assert.deepEqual(query.parseSessionListQuery(`?${serialized}`), { ...filters, search: "ana" });
    assert.equal(query.serializeSessionListQuery(query.DEFAULT_SESSION_LIST_FILTERS), "");
    assert.deepEqual(query.parseSessionListQuery("?status=bogus&sort=id&page=-2&page_size=7&needs_review=maybe"), query.DEFAULT_SESSION_LIST_FILTERS);
    assert.equal(query.sessionListHref(""), "/teacher/sessions");
    assert.equal(query.sessionListHref("page=2"), "/teacher/sessions?page=2");
    assert.equal(query.hasActiveSessionListFilters(query.DEFAULT_SESSION_LIST_FILTERS), false);
    assert.equal(query.hasActiveSessionListFilters({ ...query.DEFAULT_SESSION_LIST_FILTERS, phase: "followup_active" }), true);
  });

  await check("Dashboard: loading only the earliest initial package gives the same attempt observations", () => {
    const at = (minute: number) => new Date(Date.UTC(2026, 9, 20, 10, minute));
    const item = (id: string, option: string) => ({ item_public_id: id, item_version_snapshot: 1, initial_item_position: 1,
      item_snapshot: { item_stem: `Stem ${id}`, options: [{ label: "A", text: "a" }, { label: "B", text: "b" }] },
      selected_option: option, confidence_rating: "high", correctness: option === "A" ? "correct" : "incorrect",
      reasoning_text: "because", correct_option_snapshot: "A" });
    const initial = (minute: number, option: string) => ({ package_type: "initial_concept_unit_response_package", created_at: at(minute),
      payload: { initial_item_count: 1, completed_initial_item_count: 1, included_items: [{ item_public_id: "i1" }], item_responses: [item("i1", option)] } });
    const other = { package_type: "followup_evidence_package", created_at: at(30), payload: { item_responses: [item("i1", "B")] } };
    const base = {
      session_public_id: "sess_1", attempt_number: 1, status: "completed", started_at: at(0), created_at: at(0),
      user: { user_id: "stu_1" },
      assessment: { assessment_public_id: "asm_1", title: "Mini test", revision_family_public_id: null, concept_units: [{ id: "cu_1" }] }
    };
    // Everything, newest first (the former dashboard query) ...
    const everything = observeAttempts([{ ...base, concept_unit_sessions: [{ concept_unit_db_id: "cu_1",
      response_packages: [other, initial(20, "B"), initial(5, "A")] }] }]);
    // ... and only the earliest initial package (the narrowed query).
    const narrowed = observeAttempts([{ ...base, concept_unit_sessions: [{ concept_unit_db_id: "cu_1",
      response_packages: [initial(5, "A")] }] }]);
    assert.deepEqual(narrowed, everything);
    assert.equal(narrowed[0].items[0].selected_option, "A");
    // No initial package: both read as not submitted.
    const none = observeAttempts([{ ...base, concept_unit_sessions: [{ concept_unit_db_id: "cu_1", response_packages: [other] }] }]);
    const empty = observeAttempts([{ ...base, concept_unit_sessions: [{ concept_unit_db_id: "cu_1", response_packages: [] }] }]);
    assert.deepEqual(empty, none);
  });

  await check("Dashboard service: narrowed package query, follow-up rows from existing values, item key and full wording", () => {
    const service = source("src/lib/services/teacher-dashboard/assessment-dashboard.ts");
    assert.match(service, /response_packages: \{\s*where: \{ package_type: "initial_concept_unit_response_package" \},[\s\S]*?orderBy: \[\{ created_at: "asc" \}\],\s*take: 1/);
    // item_snapshot stays: item order, wording and options of administered snapshots come from it.
    assert.match(service, /item_snapshot: true/);
    assert.match(service, /students_to_follow_up: sortStudentsToFollowUp\(/);
    for (const used of ["initialUnderstandingValues[index]", "understandingValues[index]", "conversationUpdates[index]?.conversation_profile_update"]) {
      assert.ok(service.includes(used), `Follow-up rows should reuse ${used}.`);
    }
    assert.match(service, /correct_option_snapshot \?\? entry\.correct_option/);
    // The candidate-pattern rule stated on the page matches the code.
    assert.match(service, /CANDIDATE_PATTERN_THRESHOLD = 3/);
    assert.match(service, /response\.correctness !== "incorrect"/);
    assert.match(service, /confidence_rating !== "medium" && response\.confidence_rating !== "high"/);
    // The CSV export is unchanged: the new payload fields are not exported.
    const csvColumns = service.slice(service.indexOf("const columns = ["));
    for (const absent of ["students_to_follow_up", "\"item_stem\"", "\"correct_option\""]) assert.ok(!csvColumns.includes(absent));
  });

  await check("Dashboard page: tabs stay mounted, narrow-screen layout, follow-up table, item view wording", () => {
    const client = source("src/components/teacher-dashboard/assessment-dashboard-client.tsx");
    assert.match(client, /visited\.has\("report"\)[\s\S]*hidden=\{view !== "report"\}/);
    assert.match(client, /hidden=\{view !== "overview"\}/);
    assert.match(client, /role="tablist"[^>]*overflow-x-auto/);
    assert.match(client, /w-full text-sm font-semibold text-ink sm:w-auto sm:min-w-\[280px\]/);
    assert.match(client, /Students to follow up/);
    assert.match(client, /href=\{`\/teacher\/sessions\/\$\{encodeURIComponent\(row\.session_public_id\)\}`\}/);
    assert.match(client, /href=\{`\/teacher\/content\/items\/\$\{encodeURIComponent\(item\.item_public_id\)\}`\}/);
    assert.match(client, /Show the full question/);
    assert.match(client, /optionDistributionWithKey\(item\)/);
    assert.match(client, /Shown when at least \$\{threshold\} students chose this wrong answer with medium or high confidence and gave the same reasoning\./);
    for (const jargon of ["not generated by an LLM", "deterministic", "reasoning_grouping_method", "pattern.limitations"]) {
      assert.ok(!client.includes(jargon), `Dashboard client still shows ${jargon}.`);
    }
    assert.ok(source("src/app/teacher/content/items/[itemPublicId]/page.tsx").length > 0, "Item page route exists.");
  });

  await check("Instructor report status: one payload read for the newest validated report", () => {
    const service = source("src/lib/services/instructor-report/service.ts");
    const status = service.slice(service.indexOf("export async function getInstructorReportStatus"), service.indexOf("class DailyLimitReached"));
    const listQuery = status.slice(status.indexOf("prisma.agentCall.findMany"), status.indexOf("let latestReport"));
    assert.ok(listQuery.includes("take: 20"), "Same 20-call window as before.");
    assert.ok(!listQuery.includes("output_payload"), "The list of calls must not load payloads.");
    assert.match(status, /findUnique\(\{[\s\S]*output_payload: true/);
    assert.match(status, /if \(latestReport\) break;/);
  });

  await check("Session list and detail: debounce, cancel stale requests, keep rows, plain wording, small job select", () => {
    const list = source("src/components/teacher-review/session-list-client.tsx");
    assert.match(list, /SEARCH_DEBOUNCE_MS = 300/);
    assert.match(list, /new AbortController\(\)/);
    assert.match(list, /window\.history\.replaceState/);
    assert.match(list, /include_filters: includeFilterOptions \? undefined : false/);
    assert.match(list, /loading && !data \? <LoadingState/);
    assert.ok(!list.includes("useSearchParams"));
    for (const removed of ["npm run", "user_id\n", "Search by user_id", "LLM-assisted", "Deterministic"]) {
      assert.ok(!list.includes(removed), `Session list still includes ${removed}.`);
    }
    assert.match(list, /Search by student ID or name/);
    assert.match(list, /No sessions yet/);
    const sessions = source("src/lib/services/teacher-review/sessions.ts");
    assert.match(sessions, /OR: \[\s*\{ user_id: \{ contains: query\.search, mode: "insensitive" \} \},\s*\{ display_name: \{ contains: query\.search, mode: "insensitive" \} \}/);
    assert.match(sessions, /select: workflowJobSummarySelect/);
    const detailService = source("src/lib/services/teacher-review/session-detail.ts");
    assert.match(detailService, /select: workflowJobSummarySelect/);
    assert.match(detailService, /serializedWorkflowJobs\.slice\(0, DISPLAYED_WORKFLOW_JOB_LIMIT\)/);
    const detail = source("src/components/teacher-review/session-detail-client.tsx");
    assert.ok(!detail.includes("setDetail(null)"), "Refresh must not blank the detail.");
    assert.match(detail, /href=\{backHref\}/);
    assert.ok(!detail.includes("Teacher assistance recommended"));
    assert.ok(!detail.includes("Student user_id"));
    assert.ok(!detail.includes("LLM-assisted conversation"));
    const resource = source("src/components/teacher-review/review-resource.tsx");
    assert.match(resource, /refreshing: loading && stale/);
  });

  await check("Errors and restore: plain message first, technical details behind a disclosure; accurate restore help", () => {
    const ui = source("src/components/teacher-review/ui.tsx");
    assert.match(ui, /<summary[^>]*>Technical details<\/summary>/);
    assert.ok(!ui.includes("uppercase tracking-wide text-red-700\">{error.code}"));
    const restore = source("src/components/teacher-review/restore-attempt-chance.tsx");
    assert.ok(restore.includes("Describe the technical problem (at least 10 characters). The student gets this attempt back. Its answers will no longer count in class results; its records are kept."));
    assert.match(restore, /onRestored\?\.\(\)/);
    // The effect stated in the help text: a waived chance is left out of class results and kept.
    const chances = source("src/lib/services/student-assessment/attempt-chances.ts");
    assert.match(chances, /data: \{ waived_at: new Date\(\)/);
    assert.match(source("src/lib/services/teacher-dashboard/attempt-comparison.ts"), /attempt\.submitted_at && !attempt\.chance_waived_at/);
  });

  console.log(`\n${passed} teacher results UX checks passed; no database or provider calls.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
