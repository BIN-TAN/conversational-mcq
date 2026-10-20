/**
 * Database-free checks for the study-design files of the research dataset (mini-test catalog,
 * student roster, participation summary, summative outcomes), the study-code participant filter,
 * the cohort worksheet's study codes and the restricted-file safety scan. Run with:
 *
 *   npx tsx prisma/study-participation-export-unit-test.ts
 *
 * The database-backed export is covered by prisma/student-analysis-ready-export-smoke-test.ts.
 */
import assert from "node:assert/strict";
import { parse } from "csv-parse/sync";

process.env.DATABASE_URL ??= "postgresql://synthetic:synthetic@127.0.0.1:5432/study_participation_unit";
process.env.SESSION_SECRET ??= "study-participation-unit-test-session-secret-00000000";
process.on("unhandledRejection", (error) => {
  if ((error as { name?: string })?.name === "PrismaClientInitializationError") return;
  console.error(error);
  process.exitCode = 1;
});

let passed = 0;
async function check(name: string, run: () => void | Promise<void>) {
  await run();
  passed += 1;
  console.log(`ok - ${name}`);
}

type Attempt = import("../src/lib/services/teacher-dashboard/attempt-comparison").AttemptObservation;
type Item = import("../src/lib/services/teacher-dashboard/attempt-comparison").SubmittedItem;
type Student = import("../src/lib/services/teacher-research-data/study-participation-export").StudyScopeStudent;
type Catalog = import("../src/lib/services/teacher-research-data/study-participation-export").CatalogAssessment;

async function main() {
  const code = await import("../src/lib/services/teacher-research-data/study-code");
  const study = await import("../src/lib/services/teacher-research-data/study-participation-export");
  const studyDictionary = await import("../src/lib/services/teacher-research-data/study-participation-dictionary");
  const dictionary = await import("../src/lib/services/teacher-research-data/dictionary");
  const { researchStudentId, studyCodeFromResearchStudentId } = await import("../src/lib/services/teacher-research-data/pseudonymization");
  const { researchStudyTemplateFiles } = await import("../src/lib/services/teacher-research-data/study-templates");
  const rows = (data: string) => parse(data, { columns: true }) as Record<string, string>[];

  const snapshot = new Date("2026-11-01T00:00:00.000Z");
  const student = (userId: string, extra: Partial<Student> = {}): Student => {
    const research = researchStudentId(userId);
    return { user_db_id: `db-${userId}`, user_id: userId, research_student_id: research, study_code: studyCodeFromResearchStudentId(research),
      account_status: "active", created_at: new Date("2026-09-03T17:45:00.000Z"), created_by_teacher_user_id: "teacher-db",
      creator_user_id: "teacher_login", ...extra };
  };
  const item = (id: string, selected: string | null, correctness: string | null): Item => ({
    item_key: `${id}:v1:x`, item_public_id: id, item_version: 1, item_order: 1, stem: "PRIVATE_STEM",
    options: ["A", "B", "C", "D"].map((label) => ({ label, text: label })), objective: "o", selected_option: selected,
    confidence: "high", correctness, reasoning: "PRIVATE_REASONING", first_option: selected, first_confidence: "high",
    first_reasoning: "PRIVATE_REASONING", scoring_key: "B", submitted_at: "", evidence_source: "sealed_initial_package"
  });
  const attempt = (userId: string, session: string, assessment: string, family: string, submitted: string | null, items: Item[] = []): Attempt => ({
    student_key: userId, session_public_id: session, assessment_public_id: assessment, assessment_title: "t",
    assessment_family_public_id: family, attempt_number: 1, status: "active", started_at: "2026-10-01T00:00:00.000Z",
    submitted_at: submitted, items, limitation: submitted ? null : "incomplete_or_missing_sealed_initial_package",
    chance_policy: null, chance_waived_at: null
  });
  const assessment = (id: string, extra: Partial<Catalog> = {}): Catalog => ({
    assessment_public_id: id, revision_family_public_id: null, revision_number: 1, supersedes_assessment_public_id: null,
    title: `Mini-test ${id}`, folder_label: "Week 1", status: "published", published_at: null, release_at: null, close_at: null,
    creator_user_id: "teacher_login", topic_count: 1, published_item_count: 4, ...extra
  });

  await check("Study codes: trimmed, upper-cased, hyphen optional; malformed entries are reported", () => {
    assert.equal(code.normalizeStudyCode(" 3f9a0c12 "), "3F9A-0C12");
    assert.equal(code.normalizeStudyCode("3F9A-0C12"), "3F9A-0C12");
    for (const bad of ["3F9A 0C12", "3F9A-0C1", "GGGG-0000", "3F9A--0C12", ""]) assert.equal(code.normalizeStudyCode(bad), null, bad);
    assert.deepEqual(code.splitStudyCodeText("3f9a-0c12\r\n\n7B21D4E8, 3F9A0C12;oops"), ["3f9a-0c12", "7B21D4E8", "3F9A0C12", "oops"]);
    assert.deepEqual(code.parseStudyCodeList(["7b21d4e8", "3F9A-0C12", "3f9a0c12", "oops", " "]),
      { codes: ["3F9A-0C12", "7B21-D4E8"], invalid: ["oops"] });
    assert.equal(studyCodeFromResearchStudentId("rs_0123456789abcdef0123"), "0123-4567");
  });

  const alice = student("alice"), bob = student("bob"), carol = student("carol", { account_status: "inactive", created_by_teacher_user_id: "other-teacher", creator_user_id: null });

  await check("Participant filter: counts and a list hash, never the codes", () => {
    const filter = study.participantFilterSummary([alice.study_code, "FFFF-FFFF"], [alice, bob, carol]);
    assert.deepEqual({ ...filter, list_sha256: undefined }, { mode: "include_list", requested_count: 2, matched_count: 1, unmatched_count: 1,
      matched_student_count: 1, list_sha256: undefined });
    assert.match(filter.list_sha256!, /^[0-9a-f]{64}$/);
    assert.equal(study.participantFilterSummary(["FFFF-FFFF", alice.study_code], []).list_sha256, filter.list_sha256, "order-independent");
    assert.ok(!JSON.stringify(filter).includes(alice.study_code));
    assert.deepEqual(study.participantFilterSummary(null, [alice]), { mode: "none", requested_count: 0, matched_count: 0, unmatched_count: 0,
      matched_student_count: null, list_sha256: null });
  });

  const assessments = [
    // Family F1: original archived (published 2026-10-02, superseded), corrected version published later.
    assessment("F1", { status: "archived", published_at: new Date("2026-10-02T00:00:00.000Z"), release_at: new Date("2026-10-01T00:00:00.000Z") }),
    assessment("F1v2", { revision_family_public_id: "F1", revision_number: 2, supersedes_assessment_public_id: "F1",
      published_at: new Date("2026-10-05T00:00:00.000Z") }),
    // F2: published before 2026-10-20 (no published_at) with no release time: released, no known release time.
    assessment("F2"),
    // F3: published, release scheduled after the snapshot: not yet released.
    assessment("F3", { published_at: new Date("2026-10-25T00:00:00.000Z"), release_at: new Date("2026-11-10T00:00:00.000Z") }),
    // F4: draft with a scheduled release: never released.
    assessment("F4", { status: "draft", release_at: new Date("2026-10-10T00:00:00.000Z"), topic_count: 0, published_item_count: 0 }),
    // F5: archived with no recorded release time: not counted as released.
    assessment("F5", { status: "archived" })
  ];
  const catalog = study.miniTestCatalog({ assessments, in_scope: null, snapshot_at: snapshot, instructor: (id) => `ri_${id}` });

  await check("Catalog: effective release, family release, released by snapshot, instructor pseudonym", () => {
    const byId = new Map(catalog.rows.map((row) => [row.assessment_public_id, row]));
    assert.equal(catalog.rows.length, 6, "whole-class scope keeps archived and superseded versions");
    assert.equal(byId.get("F1")!.effective_release_at, "2026-10-02T00:00:00.000Z", "the later of published_at and release_at");
    assert.equal(byId.get("F1v2")!.assessment_family_id, "F1");
    assert.equal(byId.get("F1v2")!.family_effective_release_at, "2026-10-02T00:00:00.000Z", "earliest version of the family");
    assert.equal(byId.get("F2")!.effective_release_at, null);
    assert.equal(byId.get("F2")!.released_by_snapshot, true);
    assert.equal(byId.get("F3")!.effective_release_at, "2026-11-10T00:00:00.000Z");
    assert.equal(byId.get("F3")!.released_by_snapshot, false);
    assert.equal(byId.get("F4")!.effective_release_at, "2026-10-10T00:00:00.000Z");
    assert.equal(byId.get("F4")!.released_by_snapshot, false, "a draft is never released");
    assert.equal(byId.get("F5")!.released_by_snapshot, false);
    assert.equal(byId.get("F1")!.research_instructor_id, "ri_teacher_login");
    assert.deepEqual([...catalog.released_families].sort(), ["F1", "F2"]);
    assert.deepEqual(Object.keys(catalog.rows[0]), [...studyDictionary.MINI_TEST_CATALOG_COLUMNS]);
    const scoped = study.miniTestCatalog({ assessments, in_scope: new Set(["F1v2"]), snapshot_at: snapshot, instructor: (id) => id });
    assert.deepEqual(scoped.rows.map((row) => row.assessment_public_id), ["F1v2"]);
    assert.equal(scoped.rows[0].family_effective_release_at, "2026-10-02T00:00:00.000Z", "family release looks at every version, in or out of scope");
  });

  const attempts = [
    // Alice, F1: an unsubmitted attempt, then the first submission on the original version, then a later one on v2.
    { attempt: attempt("alice", "s1", "F1", "F1", null), conversations: [] },
    { attempt: attempt("alice", "s2", "F1", "F1", "2026-10-03T12:00:00.000Z",
      [item("i1", "B", "correct"), item("i2", "E", "not_scored"), item("i3", null, "unanswered"), item("i4", "A", "incorrect")]),
      conversations: [{ student_turns: 3, tutor_turns: 4 }, { student_turns: 0, tutor_turns: 1 }] },
    { attempt: attempt("alice", "s3", "F1v2", "F1", "2026-10-09T00:00:00.000Z", [item("i1", "B", "correct")]), conversations: [] },
    // Alice, F2: submitted (F2 has no known release time).
    { attempt: attempt("alice", "s4", "F2", "F2", "2026-10-04T00:00:00.000Z", [item("j1", "C", "incorrect")]), conversations: [] },
    // Carol, F3 (not released): one unsubmitted attempt.
    { attempt: attempt("carol", "s5", "F3", "F3", null), conversations: [{ student_turns: 0, tutor_turns: 0 }] }
  ];

  await check("Roster: every student in scope, zero-activity students included, shared codes flagged", () => {
    const twin = { ...student("dave"), study_code: alice.study_code };
    const roster = study.studentRosterRows({ students: [carol, bob, alice], shared_codes: study.sharedStudyCodes([alice, bob, carol, twin]),
      teacher_user_db_id: "teacher-db", attempts, instructor: (id) => `ri_${id}`, pseudonym_version: "hmac_sha256_v1" });
    assert.deepEqual(roster.map((row) => row.research_student_id), [alice, bob, carol].map((s) => s.research_student_id).sort());
    const byId = new Map(roster.map((row) => [row.research_student_id, row]));
    assert.deepEqual(byId.get(bob.research_student_id), { research_student_id: bob.research_student_id, study_code: bob.study_code,
      study_code_shared: false, account_status: "active", account_created_date: "2026-09-03", created_by_exporting_teacher: true,
      research_instructor_id: "ri_teacher_login", has_any_attempt: false, has_submitted_attempt: false, research_pseudonym_version: "hmac_sha256_v1" });
    assert.equal(byId.get(alice.research_student_id)!.study_code_shared, true);
    assert.equal(byId.get(alice.research_student_id)!.has_submitted_attempt, true);
    assert.equal(byId.get(carol.research_student_id)!.has_any_attempt, true);
    assert.equal(byId.get(carol.research_student_id)!.has_submitted_attempt, false);
    assert.equal(byId.get(carol.research_student_id)!.created_by_exporting_teacher, false);
    assert.equal(byId.get(carol.research_student_id)!.research_instructor_id, null);
    assert.ok(!JSON.stringify(roster).includes("alice") && !JSON.stringify(roster).includes("db-"), "no login or database IDs");
    assert.deepEqual(Object.keys(roster[0]), [...studyDictionary.STUDENT_ROSTER_COLUMNS]);
  });

  await check("Summary: released denominator, families, attempts, first submitted attempt per family, conversation turns", () => {
    const summary = study.studentParticipationSummaryRows({ students: [alice, bob, carol], attempts, catalog, include_restricted: true });
    const byId = new Map(summary.map((row) => [row.research_student_id, row]));
    const a = byId.get(alice.research_student_id)!;
    assert.deepEqual({ ...a, research_student_id: undefined, study_code: undefined }, {
      research_student_id: undefined, study_code: undefined,
      mini_tests_released: 2, families_started: 2, families_submitted: 2, released_families_submitted: 2, released_completion_proportion: 1,
      attempts_total: 4, attempts_submitted: 3, first_submission_at: "2026-10-03T12:00:00.000Z", last_submission_at: "2026-10-09T00:00:00.000Z",
      // F1: first submission 2026-10-03T12:00 minus family release 2026-10-02T00:00; F2 has no known release time.
      release_to_first_submission_median_ms: 36 * 3600 * 1000, release_to_first_submission_family_count: 1,
      conversations_with_student_turns: 1, student_conversation_turns: 3, tutor_conversation_turns: 5,
      // First submitted attempts: s2 (4 items: B correct, E = "I don't know yet", none, A incorrect) and s4 (1 item, incorrect); s3 is a later attempt.
      first_attempt_items_administered: 5, first_attempt_items_answered: 3, first_attempt_items_correct: 1, first_attempt_proportion_correct: 0.2
    });
    assert.deepEqual(Object.keys(a), [...studyDictionary.STUDENT_PARTICIPATION_SUMMARY_COLUMNS]);
    const b = byId.get(bob.research_student_id)!;
    assert.equal(b.attempts_total, 0);
    assert.equal(b.families_started, 0);
    assert.equal(b.released_completion_proportion, 0);
    assert.equal(b.first_submission_at, null);
    assert.equal(b.release_to_first_submission_median_ms, null);
    assert.equal(b.first_attempt_proportion_correct, null);
    const c = byId.get(carol.research_student_id)!;
    assert.equal(c.families_started, 1);
    assert.equal(c.families_submitted, 0);
    assert.equal(c.conversations_with_student_turns, 0);
    const standard = study.studentParticipationSummaryRows({ students: [alice], attempts, catalog, include_restricted: false });
    assert.ok(!("first_attempt_items_correct" in standard[0]) && !("first_attempt_proportion_correct" in standard[0]), "scores only in restricted exports");
    const none = study.studentParticipationSummaryRows({ students: [alice], attempts, catalog: { released_families: new Set(), family_release: new Map() }, include_restricted: false });
    assert.equal(none[0].released_completion_proportion, null, "blank when nothing was released");
  });

  await check("Summary: a submission before an edited release time is left out of the release interval", () => {
    const early = [{ attempt: attempt("alice", "e1", "F1", "F1", "2026-10-01T00:00:00.000Z"), conversations: [] }];
    const [row] = study.studentParticipationSummaryRows({ students: [alice], attempts: early, catalog, include_restricted: false });
    assert.equal(row.release_to_first_submission_median_ms, null);
    assert.equal(row.release_to_first_submission_family_count, 0);
  });

  await check("Summative outcomes: pseudonymized rows, proportion, date only, no names or note text", () => {
    const records = [
      { user_db_id: alice.user_db_id, outcome_public_id: "o2", outcome_name: "Final exam", assessment_date: new Date("2026-12-10T00:00:00.000Z"),
        outcome_score: "42.5", max_score: "50", record_status: "active", revision_number: 2, supersedes_outcome_public_id: "o1",
        notes: "PRIVATE note naming Alice", created_at: new Date("2026-12-12T09:00:00.000Z") },
      { user_db_id: alice.user_db_id, outcome_public_id: "o1", outcome_name: "Final exam", assessment_date: new Date("2026-12-10T00:00:00.000Z"),
        outcome_score: "40", max_score: "0", record_status: "superseded", revision_number: 1, supersedes_outcome_public_id: null,
        notes: null, created_at: new Date("2026-12-11T09:00:00.000Z") },
      { user_db_id: "db-outsider", outcome_public_id: "o9", outcome_name: "Final exam", assessment_date: new Date("2026-12-10T00:00:00.000Z"),
        outcome_score: "1", max_score: "1", record_status: "active", revision_number: 1, supersedes_outcome_public_id: null, notes: null, created_at: new Date() }
    ];
    const outcomes = study.summativeOutcomeRows(records, [alice, bob]);
    assert.deepEqual(outcomes.map((row) => row.outcome_public_id), ["o1", "o2"], "students outside the roster are dropped; revisions in order");
    assert.deepEqual(outcomes[1], { research_student_id: alice.research_student_id, study_code: alice.study_code, outcome_public_id: "o2",
      outcome_name: "Final exam", assessment_date: "2026-12-10", outcome_score: "42.5", max_score: "50", outcome_proportion: 0.85,
      record_status: "active", revision_number: 2, supersedes_outcome_public_id: "o1", has_notes: true, recorded_at: "2026-12-12T09:00:00.000Z" });
    assert.equal(outcomes[0].outcome_proportion, null, "blank when the maximum is 0");
    assert.ok(!JSON.stringify(outcomes).includes("PRIVATE") && !JSON.stringify(outcomes).includes("db-"));
    assert.deepEqual(Object.keys(outcomes[0]), [...studyDictionary.SUMMATIVE_OUTCOMES_COLUMNS]);
  });

  await check("Cohort worksheet: roster students first with prefilled study codes, including students with no attempts", () => {
    const files = researchStudyTemplateFiles({ attempts: attempts.map((entry) => entry.attempt), snapshot_at: snapshot.toISOString(),
      pseudonym: researchStudentId, roster: [bob, alice] });
    const cohort = rows(files.find((file) => file.path === "research_cohort_template.csv")!.data);
    assert.deepEqual(cohort.map((row) => [row.research_student_id, row.study_code]), [
      [bob.research_student_id, bob.study_code], [alice.research_student_id, alice.study_code], [carol.research_student_id, carol.study_code]
    ]);
    assert.ok(cohort.every((row) => row.consent_status === "" && row.include_in_analysis === ""), "no consent decision is inferred");
    const definitions = rows(files.find((file) => file.path === "study_template_dictionary.csv")!.data);
    assert.ok(definitions.some((row) => row.dataset === "research_cohort_template.csv" && row.variable_name === "study_code" && row.definition.length > 30));
  });

  await check("Every study-design column has a specific dictionary entry; restricted ones are marked", () => {
    const entries = dictionary.buildAnalysisReadyDictionaryEntries();
    const byName = new Map(entries.map((entry) => [entry.qualified_name, entry]));
    for (const [table, columns] of Object.entries(studyDictionary.STUDY_PARTICIPATION_TABLE_COLUMNS)) {
      assert.ok((dictionary.RESEARCH_DATASET_TABLES as readonly string[]).includes(table), `${table} is a documented dataset`);
      for (const column of columns) {
        const entry = byName.get(`${table}.${column}`);
        assert.ok(entry, `${table}.${column} lacks a dictionary entry`);
        assert.equal(entry.definition, studyDictionary.studyParticipationColumnDoc(table, column)?.definition, `${table}.${column} uses its own definition`);
        assert.ok(entry.definition.length > 40, `${table}.${column} needs a substantive definition`);
        assert.ok(entry.collection_or_generation_method.length > 25, `${table}.${column} needs a method`);
        assert.ok(entry.data_type && entry.measurement_level !== "not_applicable", `${table}.${column} needs a type and row grain`);
        assert.ok(entry.missing_value_meaning && entry.zero_value_meaning && entry.not_applicable_condition);
        assert.match(entry.source_code_reference, /study-participation-export\.ts|pseudonymization\.ts/, `${table}.${column}`);
        if (/^(integer|decimal)$/.test(entry.data_type)) assert.ok(entry.unit, `${table}.${column} needs a unit`);
      }
    }
    assert.equal(byName.get("student_roster.account_created_date")!.data_type, "date");
    assert.equal(byName.get("mini_test_catalog.released_by_snapshot")!.data_type, "boolean");
    assert.equal(byName.get("student_participation_summary.release_to_first_submission_median_ms")!.unit, "milliseconds");
    assert.match(byName.get("mini_test_catalog.effective_release_at")!.calculation_formula, /later of published_at and release_at/);
    for (const entry of entries.filter((row) => row.table_name === "summative_outcomes")) {
      assert.equal(entry.export_policy, "restricted_research_dataset_only", entry.qualified_name);
    }
    for (const column of studyDictionary.STUDY_PARTICIPATION_RESTRICTED_COLUMNS) {
      assert.equal(byName.get(`student_participation_summary.${column}`)!.export_policy, "restricted_research_dataset_only");
    }
    assert.equal(byName.get("student_participation_summary.first_attempt_items_answered")!.export_policy, "research_dataset");
    assert.match(byName.get("sessions.initial_package_sealed")!.definition, /include_incomplete_sessions false drops only/);
    const report = dictionary.researchDataDictionarySemanticReport();
    assert.deepEqual(report.undocumented_exported_columns, []);
    assert.deepEqual(report.documented_but_absent_columns, []);
    assert.deepEqual(report.formula_reference_issues, []);
    assert.equal(report.placeholder_research_definitions, 0);
    assert.equal(report.timing_variables_missing_formula, 0);
    assert.equal(report.pii_fields_in_ordinary_research_export, 0);
  });

  await check("Safety scan: restricted-only files and columns are refused in a default export", async () => {
    const { assertAnalysisReadySafety } = await import("../src/lib/services/teacher-research-data/analysis-ready-export");
    const outcomes = { path: "summative_outcomes.csv", data: "research_student_id,outcome_score\nrs_x,1\n" };
    assert.throws(() => assertAnalysisReadySafety([outcomes], false), /restricted-only file summative_outcomes\.csv/);
    assert.doesNotThrow(() => assertAnalysisReadySafety([outcomes], true));
    const scores = { path: "student_participation_summary.csv", data: "research_student_id,first_attempt_items_correct\nrs_x,1\n" };
    assert.throws(() => assertAnalysisReadySafety([scores], false), /restricted column first_attempt_items_correct/);
    assert.doesNotThrow(() => assertAnalysisReadySafety([{ path: "student_roster.csv", data: "research_student_id,study_code\nrs_x,ABCD-0123\n" }], false));
    for (const path of ["ai_call_audit.csv", "interpretation_process_audit.csv"]) {
      assert.throws(() => assertAnalysisReadySafety([{ path, data: "a\n1\n" }], false), /restricted-only file/);
    }
  });

  await check("Export wiring: the participant filter is applied where sessions and students are loaded", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync(new URL("../src/lib/services/teacher-research-data/analysis-ready-export.ts", import.meta.url), "utf8");
    assert.match(source, /if \(input\.student_user_ids\) conditions\.push\(\{ user: \{ user_id: \{ in: input\.student_user_ids \} \} \}\)/);
    assert.match(source, /where: sessionWhere\(scoped\)/);
    assert.match(source, /loadSessions\(\{ \.\.\.scoped, session_public_id/);
    assert.doesNotMatch(source, /loadSessions\(\{ \.\.\.input,/);
    assert.match(source, /!includeStudyCodes &&\s*\n\s*\(input\.scope === "all_authorized"/, "instructor-report audit rows are omitted with a participant filter");
    assert.match(source, /status: "completed" \},\s*\n\s*\{ concept_unit_sessions: \{ some: \{ response_packages: \{ some: \{ package_type: INITIAL_PACKAGE_TYPE/,
      "include_incomplete_sessions false keeps submitted attempts");
    assert.match(source, /participant_filter: study\.participant_filter/);
  });

  console.log(`\n${passed} study participation export checks passed.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
