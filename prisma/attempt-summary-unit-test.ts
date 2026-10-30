/**
 * Release 29: the instructor-facing attempt summary that replaces the understanding label in
 * instructor views (interpretation-v8/attempt-summary.ts). Pure checks, no database.
 * Run with: npx tsx prisma/attempt-summary-unit-test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

async function main() {
  const { attemptSummary, FOLLOW_UP_CATEGORIES } = await import("../src/lib/services/student-assessment/interpretation-v8/attempt-summary");
  let passed = 0;
  const check = async (name: string, run: () => void | Promise<void>) => {
    await run();
    passed += 1;
    console.log(`ok - ${name}`);
  };

  type Item = { quality: string; correct: boolean | null; status: string; flag?: boolean; unrated?: boolean };
  const stored = (items: Item[], misconceptionItems: string[][] = [], mode = "live_model") => ({
    generation_mode: mode,
    items: items.map((item, index) => ({
      item_id: `q${index + 1}`, position: index + 1, answer_correct: item.correct, explanation_quality: item.unrated ? null : item.quality,
      status: item.unrated ? null : item.status, item_review_flag: Boolean(item.flag), rating_unavailable: item.unrated ?? false
    })),
    possible_misconceptions: misconceptionItems.map((ids) => ({ item_ids: ids })),
    topic_summary: { label: "Still developing" }
  }) as unknown as Parameters<typeof attemptSummary>[0];
  const shown: Item = { quality: "adequate", correct: true, status: "supported" };
  const brief: Item = { quality: "limited", correct: true, status: "partly_supported" };
  const none: Item = { quality: "no_usable_explanation", correct: true, status: "not_interpretable" };
  const wrong: Item = { quality: "incorrect", correct: false, status: "not_supported" };

  await check("All correct with brief reasoning on half the items: check reasoning, not a deficit label", () => {
    const summary = attemptSummary(stored([shown, shown, brief, brief]));
    assert.equal(summary.follow_up, "Check reasoning");
    assert.equal(summary.follow_up_reason, "reasoning_shown_on_half_or_fewer");
    assert.equal(summary.text, "4 of 4 correct · reasoning shown on 2, brief on 2");
  });

  await check("All correct with reasoning shown on most items: no follow-up needed (the earlier label allowed only one brief item)", () => {
    const summary = attemptSummary(stored([shown, shown, shown, brief]));
    assert.equal(summary.follow_up, "No follow-up needed");
    assert.equal(attemptSummary(stored([shown, shown, brief])).follow_up, "No follow-up needed", "2 of 3 shown is more than half");
    assert.equal(attemptSummary(stored([shown, brief, brief])).follow_up, "Check reasoning");
  });

  await check("A wrong answer, contradicting reasoning or a possible misconception: address errors or misconceptions", () => {
    assert.equal(attemptSummary(stored([shown, shown, shown, wrong])).follow_up, "Address errors or misconceptions");
    const sideRemark = attemptSummary(stored([shown, shown, shown, shown], [["q2"]]));
    assert.equal(sideRemark.follow_up, "Address errors or misconceptions", "An endorsed idea beside correct answers still needs attention");
    assert.equal(sideRemark.text, "4 of 4 correct · reasoning shown on 4 · possible misconception on Item 2");
    assert.deepEqual(sideRemark.misconception_item_positions, [2]);
  });

  await check("Too little to interpret: not enough evidence; a fallback profile is not enough evidence", () => {
    assert.equal(attemptSummary(stored([shown, none, none])).follow_up, "Not enough evidence");
    assert.equal(attemptSummary(stored([shown, shown, none, none, none])).follow_up_reason, "fewer_than_half_interpretable");
    const fallback = attemptSummary(stored([], [], "fallback"));
    assert.equal(fallback.follow_up, "Not enough evidence");
    assert.equal(fallback.follow_up_reason, "no_valid_profile");
    assert.equal(attemptSummary(null).text, "No interpretation saved");
  });

  await check("Instructor decisions: an excluded item is not counted; a pending flag that changes the follow-up withholds it", () => {
    const excluded = attemptSummary(stored([shown, shown, shown, wrong]), new Map([["q4", "excluded" as const]]));
    assert.equal(excluded.follow_up, "No follow-up needed");
    assert.equal(excluded.counted_items, 3);
    assert.equal(excluded.text, "3 of 3 correct · reasoning shown on 3 · 1 item not counted");
    const pending = attemptSummary(stored([shown, shown, shown, { ...wrong, flag: true }]));
    assert.equal(pending.follow_up, "Pending item review");
    assert.equal(pending.follow_up_without_pending, "No follow-up needed");
    const kept = attemptSummary(stored([shown, shown, shown, { ...wrong, flag: true }]), new Map([["q4", "kept" as const]]));
    assert.equal(kept.follow_up, "Address errors or misconceptions");
    const unrated = attemptSummary(stored([shown, shown, shown, { ...brief, unrated: true }]));
    assert.equal(unrated.counted_items, 3, "An item left without a rating is administered but not counted");
  });

  await check("Instructor views use the summary; the dashboard overview no longer shows labels; students never see it", () => {
    assert.equal(FOLLOW_UP_CATEGORIES.length, 5);
    const detail = readFileSync("src/components/teacher-review/session-detail-client.tsx", "utf8");
    assert.match(detail, /attemptSummary\(stored as unknown as StoredInterpretationV8\)/);
    assert.doesNotMatch(detail, /Summary \(rules over item ratings\)/);
    const dashboard = readFileSync("src/components/teacher-dashboard/assessment-dashboard-client.tsx", "utf8");
    for (const absent of ["understanding overview", "Students to follow up", "Candidate misconception patterns"]) assert.ok(!dashboard.includes(absent), absent);
    const report = readFileSync("src/lib/services/instructor-report/assemble.ts", "utf8");
    assert.match(report, /attemptSummary\(v8, decisions\)/);
    for (const file of ["src/components/student-assessment/assessment-session-client.tsx"]) {
      assert.ok(!readFileSync(file, "utf8").includes("follow_up"), `${file} does not show the instructor summary`);
    }
  });

  console.log(`\n${passed} attempt summary checks passed; no database or provider calls.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
