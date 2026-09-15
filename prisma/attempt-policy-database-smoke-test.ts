import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PrismaClient } from "@prisma/client";
import { parse } from "csv-parse/sync";
import { prisma } from "../src/lib/db";
import { startOrResumeStudentAssessmentSession, listAvailableAssessments } from "../src/lib/services/student-assessment/service";
import { readAttemptChances, restoreAttemptChance } from "../src/lib/services/student-assessment/attempt-chances";
import { closeAttemptAndAllowAnother } from "../src/lib/services/teacher-review/attempt-controls";
import { loadAttemptObservations, buildAttemptComparison } from "../src/lib/services/teacher-dashboard/attempt-comparison";
import { getTeacherAssessmentDashboard } from "../src/lib/services/teacher-dashboard/assessment-dashboard";
import { buildAnalysisReadyResearchDataBundle } from "../src/lib/services/teacher-research-data/analysis-ready-export";
import { assertLocalAttemptTest, createAttemptPolicyFixture, createRecordedAttempt } from "./attempt-policy-fixture";

const db = new PrismaClient();
assertLocalAttemptTest();
process.env.OPERATIONAL_AGENT_MODE = "disabled";
process.env.ALLOW_MANUAL_REVIEW_STUDENT_STARTS = "false";
const prefix = `attempt_policy_${Date.now()}`;
let passed = 0;
function check(name: string) { passed++; console.log(`PASS ${name}`); }
async function rejectCode(run: Promise<unknown>, code: string) {
  await assert.rejects(run, (error: unknown) => (error as { code: string }).code === code);
}
async function main() {
try {
  const callsBefore = await db.agentCall.count();
  const f = await createAttemptPolicyFixture(db, prefix);
  const start = (index = 0, assessment = f.assessment.assessment_public_id) => startOrResumeStudentAssessmentSession({
    student_user_db_id: f.students[index].id, assessment_public_id: assessment, new_attempt: true
  });
  const chance = () => readAttemptChances(f.students[0].id, f.assessment.assessment_public_id);
  const end = (id: string, teacher = f.teacher.id) => closeAttemptAndAllowAnother({ teacher_user_db_id: teacher, session_public_id: id });
  const firstStarts = await Promise.all([start(), start()]);
  const first = firstStarts[0].session.session_public_id;
  assert.equal(firstStarts[1].session.session_public_id, first);
  assert.equal((await chance()).attempts_used, 1);
  check("simultaneous starts reserve exactly one chance and resume one session");
  await rejectCode(restoreAttemptChance({ teacher_user_db_id: f.teacher.id, session_public_id: first, reason: "Connection interrupted during assessment" }), "attempt_still_open");
  await end(first);
  const second = (await start()).session.session_public_id;
  await end(second);
  const thirds = await Promise.all([start(), start()]);
  const third = thirds[0].session.session_public_id;
  assert.equal(thirds[1].session.session_public_id, third);
  assert.equal((await chance()).remaining_attempts, 0);
  assert.equal((await start()).session.session_public_id, third);
  check("third attempt resumes after allowance is exhausted without consuming another chance");
  await end(third);
  assert.equal(await db.processEvent.count({ where: { assessment_session: { session_public_id: third }, event_type: "new_attempt_available" } }), 0);
  await rejectCode(start(), "assessment_attempt_limit_reached");
  const available = await listAvailableAssessments({ student_user_db_id: f.students[0].id });
  const card = available.assessments.find(row => row.assessment_public_id === f.assessment.assessment_public_id)!;
  assert.equal(card.can_start, false); assert.equal(card.attempt_policy.maximum_attempts, 3);
  check("fourth starts blocked at the server and student catalog; no misleading lifecycle event");
  const other = await createAttemptPolicyFixture(db, `${prefix}_other`);
  await rejectCode(end(third, other.teacher.id), "not_found");
  await rejectCode(restoreAttemptChance({ teacher_user_db_id: other.teacher.id, session_public_id: third, reason: "Unauthorized restoration attempt" }), "not_found");
  await rejectCode(restoreAttemptChance({ teacher_user_db_id: f.teacher.id, session_public_id: third, reason: "short" }), "validation_failed");
  check("teacher ownership and restoration reason enforced");
  const restore = () => restoreAttemptChance({ teacher_user_db_id: f.teacher.id, session_public_id: third, reason: "Connection interrupted during assessment" });
  assert.equal((await restore()).status, "chance_restored");
  assert.equal((await restore()).status, "chance_already_restored");
  assert.equal((await chance()).remaining_attempts, 1);
  const replacement = (await start()).session;
  assert.equal(replacement.attempt_number, 4);
  await end(replacement.session_public_id);
  await rejectCode(start(), "assessment_attempt_limit_reached");
  assert.equal(await db.assessmentSession.count({ where: { user_db_id: f.students[0].id } }), 4);
  check("restoration is idempotent, audited and preserves original attempts and ordinal numbers");
  const revised = await db.assessment.create({ data: { assessment_public_id: `${prefix}_revision`, title: "Corrected test",
    status: "published", created_by_user_db_id: f.teacher.id, revision_family_public_id: f.assessment.assessment_public_id } });
  await rejectCode(start(0, revised.assessment_public_id), "assessment_attempt_limit_reached");
  check("corrected versions cannot reset the allowance");
  const history = await createAttemptPolicyFixture(db, `${prefix}_history`);
  const legacy = [];
  for (let n = 1; n <= 5; n++) legacy.push(await createRecordedAttempt(db, history, 0, n, "A", true));
  const migration = await readFile("prisma/migrations/20260915190000_assessment_attempt_chances/migration.sql", "utf8");
  await db.$executeRawUnsafe(migration.slice(migration.indexOf("INSERT INTO")).trim().replace(/;$/, " ON CONFLICT (session_public_id) DO NOTHING;"));
  const migrated = await db.assessmentAttemptChance.findMany({ where: { student_db_id: history.students[0].id } });
  assert.equal(migrated.length, 5); assert(migrated.every(row => row.policy_version === "legacy_unlimited"));
  assert.equal((await readAttemptChances(history.students[0].id, history.assessment.assessment_public_id)).remaining_attempts, 0);
  check("migration backfills all historical attempts including more than three without erasing evidence");
  const deleteSession = await createRecordedAttempt(db, history, 1, 1, null);
  await db.conceptUnitSession.deleteMany({ where: { assessment_session_db_id: deleteSession.id } });
  await db.assessmentSession.delete({ where: { id: deleteSession.id } });
  assert.equal((await readAttemptChances(history.students[1].id, history.assessment.assessment_public_id)).attempts_used, 1);
  check("deleting session data does not silently grant another chance");
  const results = await createAttemptPolicyFixture(db, `${prefix}_results`);
  await createRecordedAttempt(db, results, 0, 1, "B");
  await createRecordedAttempt(db, results, 0, 2, "A");
  await createRecordedAttempt(db, results, 0, 3, "A");
  await createRecordedAttempt(db, results, 1, 1, "A");
  const s2 = await createRecordedAttempt(db, results, 1, 2, "B");
  await createRecordedAttempt(db, results, 1, 3, null);
  await createRecordedAttempt(db, results, 2, 1, "B");
  const originals = await db.responsePackage.findMany({ where: { concept_unit_session: { assessment_session: { assessment_db_id: results.assessment.id } } }, orderBy: { id: "asc" } });
  // A later mutable response must not replace its sealed pre-feedback submission.
  await db.itemResponse.updateMany({ where: { concept_unit_session: { assessment_session_db_id: s2.id } }, data: { selected_option: "A", correctness: "correct" } });
  const obs = await db.$transaction(tx => loadAttemptObservations(tx, { assessment_db_id: results.assessment.id }));
  const comparison = buildAttemptComparison(obs, { snapshot_at: new Date().toISOString(), eligible_student_count: 4 });
  assert.deepEqual(comparison.columns.map(row => row.student_count), [3, 2, 1, 3]);
  assert.equal(comparison.columns[3].correct_percentage, 33.3);
  assert.equal(comparison.transition_summary.incorrect_to_correct, 3);
  assert.equal(comparison.transition_summary.correct_to_incorrect, 3);
  const dashboard = await getTeacherAssessmentDashboard({ teacher_user_db_id: results.teacher.id, assessment_public_id: results.assessment.assessment_public_id });
  assert.equal(dashboard.item_diagnostics[0].response_count, 3);
  assert.equal(dashboard.item_diagnostics[0].correct_percentage, 33.3);
  check("dashboard and comparison agree on sealed submissions despite a newer unfinished attempt and mutable revisions");
  for (const restricted of [false, true]) {
    const bundle = await buildAnalysisReadyResearchDataBundle({ teacher_user_db_id: results.teacher.id,
      scope: "selected_assessment", assessment_public_id: results.assessment.assessment_public_id,
      include_incomplete_sessions: true, include_restricted_fields: restricted });
    const rows = (path: string) => parse(bundle.files.find(file => file.path === path)!.data, { columns: true }) as Array<Record<string, string>>;
    assert.equal(rows("attempt_records.csv").length, 7);
    assert.equal(rows("attempt_submission_items.csv").length, 18);
    assert.equal(rows("attempt_class_summaries.csv")[3].student_count, "3");
    assert.equal(Object.hasOwn(rows("attempt_submission_items.csv")[0], "correctness"), restricted);
    assert(!bundle.files.find(file => file.path === "attempt_submission_items.csv")!.data.includes(results.students[0].user_id));
    assert(bundle.files.find(file => file.path === "research_manifest.json")!.data.includes("attempt_records.csv"));
    check(`analysis-ready ZIP preserves every attempt with restricted fields ${restricted ? "included" : "excluded"}`);
  }
  assert.deepEqual(await db.responsePackage.findMany({ where: { concept_unit_session: { assessment_session: { assessment_db_id: results.assessment.id } } }, orderBy: { id: "asc" } }), originals);
  await restoreAttemptChance({ teacher_user_db_id: results.teacher.id, session_public_id: s2.session_public_id, reason: "Synthetic technical problem for testing" });
  const after = await getTeacherAssessmentDashboard({ teacher_user_db_id: results.teacher.id, assessment_public_id: results.assessment.assessment_public_id });
  assert.equal(after.item_diagnostics[0].correct_percentage, 66.7);
  assert.equal(await db.agentCall.count(), callsBefore);
  check("technical restoration updates results consistently; source packages unchanged; zero AI calls");
  console.log(JSON.stringify({ passed, synthetic_fixture: results.assessment.assessment_public_id }));
} finally { await db.$disconnect(); await prisma.$disconnect(); }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
