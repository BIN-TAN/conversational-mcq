/**
 * Database-free checks for the instructor report v8 (docs/AI_MODULE_REDESIGN_2026-10-19.md,
 * section 9.7): counts with first and later attempts kept apart, fallback and earlier-version
 * records left out of the rating counts, the model input (labels only, no process data), the
 * prompt text, the quote, label, number and wording checks, and the counts-only fallback.
 * Run with:
 *
 *   npx tsx prisma/instructor-report-v8-unit-test.ts
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

process.env.DATABASE_URL ??= "postgresql://synthetic:synthetic@127.0.0.1:5432/instructor_report_v8_unit";
process.env.SESSION_SECRET ??= "instructor-report-v8-unit-test-session-secret-000000";
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

const ITEMS = ["itm_alpha_0001", "itm_bravo_0002", "itm_charlie_003"];
const OPTIONS = [{ label: "A", text: "Scores are consistent across forms" }, { label: "B", text: "A longer test is always valid" }, { label: "C", text: "Validity equals reliability" }];
const FIRST_VERSION_TEXT = "a first version that must never reach the model";

type Answer = { selected: string | null; correct: boolean | null; explanation?: string | null; reason?: string | null; tempting?: string | null };

function packagePayload(answers: Answer[]) {
  return {
    assessment: { title: "Reliability mini-test" },
    concept_unit: { title: "Reliability", learning_objective: "Distinguish reliability from validity", related_concept_description: "Consistency of scores" },
    item_responses: answers.map((answer, index) => ({
      item_public_id: ITEMS[index],
      item_order: index + 1,
      item_snapshot: { item_public_id: ITEMS[index], item_stem: `Stem ${index + 1}`, options: OPTIONS, correct_option: "A" },
      correct_option_snapshot: "A",
      selected_answer_final: answer.selected,
      selected_answer_initial: "C",
      answer_changed: true,
      correctness: answer.correct === null ? "not_scored" : answer.correct ? "correct" : "incorrect",
      confidence_final: "high",
      confidence_initial: "low",
      reasoning_text_final: answer.explanation ?? null,
      reasoning_text_initial: FIRST_VERSION_TEXT,
      tempting_option: answer.tempting ?? null,
      tempting_option_reason: answer.reason ?? null,
      response_time_answer_ms: 4242,
      teacher_diagnostic_context: {
        expected_reasoning_patterns: ["Reliability is consistency of scores."],
        distractor_rationales: { B: "Believes test length alone guarantees validity.", C: "Treats validity and reliability as the same." },
        teacher_diagnostic_context: { correct_option_notes: { target_reasoning_note: "Reliability concerns consistency of scores.", strong_reasoning_should_mention: "consistency" } }
      }
    }))
  };
}

type Rating = { quality: "adequate" | "limited" | "incorrect" | "no_usable_explanation"; quote?: string | null; error?: "conceptual" | "unclear" | "possible_item_issue" | null };

async function main() {
  const { buildInterpretationInputV8FromPackage } = await import("../src/lib/services/student-assessment/interpretation-v8/input-builder");
  const { buildStoredInterpretationV8 } = await import("../src/lib/services/student-assessment/interpretation-v8/profile");
  const { FEEDBACK_V8_CONTRACT_VERSION } = await import("../src/lib/services/student-assessment/feedback-v8/contract");
  const assemble = await import("../src/lib/services/instructor-report/assemble");
  const contract = await import("../src/lib/services/instructor-report/contract");
  const validate = await import("../src/lib/services/instructor-report/validate");
  const deterministic = await import("../src/lib/services/instructor-report/deterministic");
  const service = await import("../src/lib/services/instructor-report/service");

  const v8Profile = (input: {
    payload: ReturnType<typeof packagePayload>;
    session: string;
    attempt_number: number;
    role: "initial_diagnosis" | "after_feedback";
    ratings: Rating[] | null;
    misconceptions?: Array<{ quote: string; endorsement: "endorsed" | "tentative" }>;
  }) => {
    const modelInput = buildInterpretationInputV8FromPackage(input.payload, new Map());
    const output = input.ratings
      ? {
          items: modelInput.items.map((item, index) => {
            const rating = input.ratings![index];
            const noUsable = rating.quality === "no_usable_explanation";
            return {
              item_id: item.item_id,
              explanation_quality: rating.quality,
              no_usable_reason: noUsable ? ("not_provided" as const) : null,
              adds_beyond_option_text: noUsable ? null : true,
              evidence_quote: noUsable ? null : rating.quote ?? null,
              evidence_source: noUsable ? null : ("explanation" as const),
              reference_id: rating.quality === "incorrect" ? `${item.item_id}:target` : null,
              missing_elements: rating.quality === "limited" ? "consistency" : null,
              rationale: "The explanation is judged against the target reasoning.",
              error_source: rating.error ?? (item.response.answer_correct === false ? ("conceptual" as const) : null),
              side_remark: null,
              uncertainty_note: null,
              process_interpretation: null
            };
          }),
          possible_misconceptions: (input.misconceptions ?? []).map((entry) => ({
            item_ids: [ITEMS[0]],
            idea: "Test length alone makes scores valid.",
            student_quote: entry.quote,
            quote_item_id: ITEMS[0],
            quote_source: "explanation" as const,
            endorsement: entry.endorsement,
            contradicts_reference_id: `${ITEMS[0]}:target`,
            matching_distractor_reference_id: `${ITEMS[0]}:option:B`,
            alternative_explanation: null
          })),
          considered_ideas: []
        }
      : null;
    const stored = buildStoredInterpretationV8({
      model_input: modelInput,
      output,
      generation_mode: output ? "live_model" : "fallback",
      fallback_reason: output ? null : "validation_failed",
      response_package_id: `pkg_${input.session}`,
      answer_review_v2: null,
      attempt: {
        attempt_context_version: "attempt-context-v1",
        session_public_id: input.session,
        attempt_number: input.attempt_number,
        role: input.role,
        started_at: null,
        feedback_seen_before: []
      }
    });
    return JSON.parse(JSON.stringify(stored)) as unknown;
  };

  const feedback = (fields: { items: number[]; status: "corrected_reasoning_expressed" | "difficulty_still_evident" | "not_discussed_further" | null; evidence?: Array<{ quote: string; note: string }>; flag?: "none" | "possible_item_issue"; reason?: string | null }) => ({
    contract_version: FEEDBACK_V8_CONTRACT_VERSION,
    student_visible_message: "A tutor message.",
    focus: { item_numbers: fields.items, focus_type: "single_item", concept: "validity and test length" },
    strategy: "explain",
    student_evidence: fields.evidence ?? [],
    focus_status: fields.status,
    instructor_review: { flag: fields.flag ?? "none", reason: fields.reason ?? null }
  });

  const S1_EXPLANATION = "Because a longer test is always more valid than a short one.";
  const S1_STUDENT_MESSAGE = "I still think adding more questions always makes the test valid.";
  const TUTOR_REPLY = "Validity is about whether the scores support the intended use, not length alone.";
  const ECHO = "Oh so validity is about whether the scores support the intended use.";

  const s1First = packagePayload([
    { selected: "B", correct: false, explanation: S1_EXPLANATION, tempting: "C", reason: "Reliability and validity sound like they're the same idea." },
    { selected: "A", correct: true, explanation: "Consistent scores across forms show reliability." },
    { selected: "A", correct: true, explanation: "The scores agree when the test is repeated." }
  ]);
  const s1Later = packagePayload([
    { selected: "A", correct: true, explanation: "Consistency of scores is what reliability means here." },
    { selected: "A", correct: true, explanation: "Consistent scores across forms show reliability." },
    { selected: "A", correct: true, explanation: "The scores agree when the test is repeated." }
  ]);
  const s4Explanation = "Maybe a longer test is more valid because it covers more.";
  const s4First = packagePayload([
    { selected: "B", correct: false, explanation: s4Explanation },
    { selected: "C", correct: false, explanation: "Validity and reliability mean the same thing." },
    { selected: null, correct: null, explanation: null }
  ]);
  const s4Second = packagePayload([
    { selected: "B", correct: false, explanation: "Still unsure but a longer test seems more valid." },
    { selected: "A", correct: true, explanation: "Consistent scores across forms show reliability." },
    { selected: "A", correct: true, explanation: "The scores agree when the test is repeated." }
  ]);
  const s4Third = packagePayload([
    { selected: "A", correct: true, explanation: "Consistency of the scores, not the length of the test." },
    { selected: "A", correct: true, explanation: "Consistent scores across forms show reliability." },
    { selected: "A", correct: true, explanation: "The scores agree when the test is repeated." }
  ]);
  const plain = (explanation: string, selected = "A") => packagePayload([
    { selected, correct: selected === "A", explanation },
    { selected: "A", correct: true, explanation: "Consistent scores across forms show reliability." },
    { selected: "A", correct: true, explanation: "The scores agree when the test is repeated." }
  ]);

  const adequate = (quote: string): Rating => ({ quality: "adequate", quote });
  const records: import("../src/lib/services/instructor-report/assemble").LoadedReportRecords = {
    mini_test_title: "Reliability mini-test",
    topic: { title: "Reliability", learning_objective: "Distinguish reliability from validity", description: "Consistency of scores" },
    eligible_student_count: 7,
    items: ITEMS.map((id, index) => ({
      item_public_id: id,
      stem: `Stem ${index + 1}`,
      options: OPTIONS,
      correct_option: "A",
      expected_reasoning: null,
      distractor_rationales: []
    })),
    attempts: [
      {
        student_key: "user_0000_s1", session_public_id: "sess_a_s1_first", attempt_number: 1, created_at: "2026-10-01T00:00:00.000Z",
        finished: true, restored: false, package_payloads: [s1First],
        profile_item_level_evidence: v8Profile({
          payload: s1First, session: "sess_a_s1_first", attempt_number: 1, role: "initial_diagnosis",
          ratings: [{ quality: "incorrect", quote: "a longer test is always more valid" }, adequate("Consistent scores across forms"), adequate("The scores agree when")],
          misconceptions: [{ quote: "a longer test is always more valid", endorsement: "endorsed" }]
        }),
        conversation: {
          status: "ended", lifecycle_reason: "student_ended_conversation",
          turns: [
            { turn_id: "turn_t1", actor: "tutor", text: "Your explanation for Question 1 links length and validity.", agent_call_id: "call_open" },
            { turn_id: "turn_s1", actor: "student", text: S1_STUDENT_MESSAGE, agent_call_id: null },
            { turn_id: "turn_t2", actor: "tutor", text: TUTOR_REPLY, agent_call_id: "call_r1" },
            { turn_id: "turn_s2", actor: "student", text: ECHO, agent_call_id: null },
            { turn_id: "turn_t3", actor: "tutor", text: "Question 1 may be read in two ways; the instructor will look at it.", agent_call_id: "call_r2" }
          ],
          feedback_v8_outputs: [
            { agent_call_id: "call_open", output: feedback({ items: [1], status: null }) },
            { agent_call_id: "call_r1", output: feedback({ items: [1], status: "difficulty_still_evident", evidence: [{ quote: "adding more questions always makes the test valid", note: "Still links length and validity." }] }) },
            { agent_call_id: "call_r2", output: feedback({ items: [1], status: "corrected_reasoning_expressed", evidence: [{ quote: "validity is about whether the scores support", note: "Restates the distinction with support." }], flag: "possible_item_issue", reason: "The stem may allow two readings." }) }
          ],
          review_signals: [{ source_turn_id: "turn_t3", flag: "possible_item_issue" }]
        }
      },
      {
        student_key: "user_0000_s1", session_public_id: "sess_z_s1_later", attempt_number: 2, created_at: "2026-10-03T00:00:00.000Z",
        finished: true, restored: false, package_payloads: [s1Later],
        profile_item_level_evidence: v8Profile({
          payload: s1Later, session: "sess_z_s1_later", attempt_number: 2, role: "after_feedback",
          ratings: [adequate("Consistency of scores is what"), adequate("Consistent scores across forms"), adequate("The scores agree when")]
        }),
        conversation: null
      },
      {
        // Fallback profile: no ratings.
        student_key: "user_0000_s2", session_public_id: "sess_b_s2_first", attempt_number: 1, created_at: "2026-10-01T00:00:00.000Z",
        finished: false, restored: false, package_payloads: [plain("Scores stay the same across forms.")],
        profile_item_level_evidence: v8Profile({ payload: plain("Scores stay the same across forms."), session: "sess_b_s2_first", attempt_number: 1, role: "initial_diagnosis", ratings: null }),
        conversation: null
      },
      {
        // Earlier-version record: a pre-v8 profile and a conversation without turn records.
        student_key: "user_0000_s3", session_public_id: "sess_c_s3_first", attempt_number: 1, created_at: "2026-10-01T00:00:00.000Z",
        finished: true, restored: false, package_payloads: [plain("Longer tests give more valid results overall.", "B")],
        profile_item_level_evidence: [{ item_public_id: ITEMS[0], reasoning_quality: "weak" }],
        conversation: {
          status: "ended", lifecycle_reason: "max_turns_reached",
          turns: [
            { turn_id: "turn_x1", actor: "tutor", text: "Let us look at Question 1 together.", agent_call_id: "legacy_call" },
            { turn_id: "turn_x2", actor: "student", text: "I am not sure why length would not matter here.", agent_call_id: null }
          ],
          feedback_v8_outputs: [],
          review_signals: []
        }
      },
      {
        student_key: "user_0000_s4", session_public_id: "sess_d_s4_first", attempt_number: 1, created_at: "2026-10-01T00:00:00.000Z",
        finished: true, restored: false, package_payloads: [s4First],
        profile_item_level_evidence: v8Profile({
          payload: s4First, session: "sess_d_s4_first", attempt_number: 1, role: "initial_diagnosis",
          ratings: [{ quality: "incorrect", quote: "a longer test is more valid" }, { quality: "incorrect", quote: "Validity and reliability mean" }, { quality: "no_usable_explanation" }],
          misconceptions: [{ quote: "Maybe a longer test is more valid", endorsement: "tentative" }]
        }),
        conversation: null
      },
      {
        student_key: "user_0000_s4", session_public_id: "sess_d_s4_second", attempt_number: 2, created_at: "2026-10-02T00:00:00.000Z",
        finished: true, restored: false, package_payloads: [s4Second],
        profile_item_level_evidence: v8Profile({
          payload: s4Second, session: "sess_d_s4_second", attempt_number: 2, role: "after_feedback",
          ratings: [{ quality: "limited", quote: "a longer test seems more valid", error: "unclear" }, adequate("Consistent scores across forms"), adequate("The scores agree when")]
        }),
        conversation: null
      },
      {
        student_key: "user_0000_s4", session_public_id: "sess_d_s4_third", attempt_number: 3, created_at: "2026-10-04T00:00:00.000Z",
        finished: true, restored: false, package_payloads: [s4Third],
        profile_item_level_evidence: v8Profile({
          payload: s4Third, session: "sess_d_s4_third", attempt_number: 3, role: "after_feedback",
          ratings: [adequate("Consistency of the scores"), adequate("Consistent scores across forms"), adequate("The scores agree when")]
        }),
        conversation: null
      },
      {
        // Restored after a technical problem: left out, but it still makes attempt 2 a later attempt.
        student_key: "user_0000_s5", session_public_id: "sess_e_s5_first", attempt_number: 1, created_at: "2026-10-01T00:00:00.000Z",
        finished: false, restored: true, package_payloads: [plain("Consistent scores across forms show reliability.")],
        profile_item_level_evidence: null, conversation: null
      },
      {
        student_key: "user_0000_s5", session_public_id: "sess_e_s5_second", attempt_number: 2, created_at: "2026-10-02T00:00:00.000Z",
        finished: true, restored: false, package_payloads: [plain("Reliability means the scores are consistent.")],
        profile_item_level_evidence: v8Profile({
          payload: plain("Reliability means the scores are consistent."), session: "sess_e_s5_second", attempt_number: 2, role: "after_feedback",
          ratings: [adequate("Reliability means the scores"), adequate("Consistent scores across forms"), adequate("The scores agree when")]
        }),
        conversation: null
      },
      {
        // Never submitted: not a record.
        student_key: "user_0000_s6", session_public_id: "sess_f_s6_first", attempt_number: 1, created_at: "2026-10-01T00:00:00.000Z",
        finished: false, restored: false, package_payloads: [], profile_item_level_evidence: null, conversation: null
      }
    ]
  };

  const built = assemble.assembleInstructorReportV8(records);
  const { counts, input, index } = built;
  const labelOf = (session: string) => Object.entries(index.students).find(([, entry]) =>
    entry.first_attempts?.session_public_id === session || entry.later_attempts?.session_public_id === session)?.[0] ?? null;
  const S1 = labelOf("sess_a_s1_first")!;
  const S2 = labelOf("sess_b_s2_first")!;
  const S3 = labelOf("sess_c_s3_first")!;
  const S4 = labelOf("sess_d_s4_first")!;
  const S5 = labelOf("sess_e_s5_second")!;

  await check("Participation counts come from the records", () => {
    assert.equal(counts.items, 3);
    assert.equal(counts.eligible_students, 7);
    assert.equal(counts.students_with_submitted_attempt, 5, "The unsubmitted attempt is not a record");
    assert.equal(counts.attempts_submitted, 8, "Restored attempts are left out of the totals (2 + 1 + 1 + 3 + 1)");
    assert.equal(counts.left_out.restored_attempts, 1);
    assert.deepEqual(counts.students_by_submitted_attempts, [{ submitted_attempts: 1, students: 3 }, { submitted_attempts: 2, students: 1 }, { submitted_attempts: 3, students: 1 }]);
    assert.deepEqual([S1, S2, S3, S4, S5].every(Boolean), true);
  });

  await check("First attempts and later attempts are counted separately, never merged", () => {
    assert.equal(counts.students_with_first_attempt, 4);
    assert.equal(counts.students_with_later_attempt, 3, "A student whose first attempt was restored has only a later attempt");
    assert.equal(counts.first_attempts.students, 4);
    assert.equal(counts.later_attempts.students, 3);
    assert.equal(counts.later_attempts.attempts_submitted, 4, "Every later attempt is in the totals");
    assert.deepEqual(counts.later_attempts.attempts_by_number, [{ attempt_number: 2, attempts: 3 }, { attempt_number: 3, attempts: 1 }]);
    const q1 = (section: "first_attempts" | "later_attempts") => counts[section].option_distribution[0];
    assert.deepEqual(q1("first_attempts").options.map((entry) => [entry.option, entry.count, entry.correct]), [["A", 1, true], ["B", 3, false], ["C", 0, false]]);
    // The later section uses each student's most recent later attempt: S4's attempt 2 (option B) is not counted.
    assert.deepEqual(q1("later_attempts").options.map((entry) => [entry.option, entry.count]), [["A", 3], ["B", 0], ["C", 0]]);
    assert.equal(counts.first_attempts.option_distribution[2].no_answer, 1);
    assert.equal(index.students[S4].later_attempts?.session_public_id, "sess_d_s4_third");
    assert.equal(index.students[S5].first_attempts, undefined);
    assert.deepEqual(input.first_attempts.map((student) => student.student_label).sort(), [S1, S2, S3, S4].sort());
    assert.deepEqual(input.later_attempts.map((student) => student.student_label).sort(), [S1, S4, S5].sort());
    assert.ok(built.application_notes.some((note) => /most recent later attempt; 1 other later attempts/.test(note)));
  });

  await check("Possible misconceptions are counted by students, with endorsement, per section", () => {
    assert.deepEqual(counts.first_attempts.possible_misconceptions.map((group) => [group.grouped_by, group.students, group.endorsed_students, group.tentative_students]),
      [["Q1 option B rationale", 2, 1, 1]]);
    assert.deepEqual(counts.later_attempts.possible_misconceptions, []);
  });

  await check("Fallback profiles and earlier-version records are left out of the rating counts", () => {
    const first = counts.first_attempts;
    assert.deepEqual(first.records, { current_version: 2, current_version_fallback: 1, earlier_version: 1 });
    assert.equal(first.item_status[0].rated, 2, "Only the two current-version profiles have ratings");
    assert.equal(first.item_status[0].not_supported, 2);
    assert.equal(first.item_status[2].not_interpretable, 1, "No answer selected is not interpretable");
    assert.equal(first.option_distribution[0].responses, 4, "Responses are counted for every record");
    const label = (name: string) => first.summary_distribution.labels.find((entry) => entry.label === name)?.students;
    assert.equal(first.summary_distribution.fallback_profiles, 1);
    assert.equal(first.summary_distribution.earlier_version_records, 1);
    assert.equal(label("Unavailable / insufficient evidence"), 1, "The fallback profile is Unavailable");
    assert.equal(label("Need more work"), 1);
    assert.equal(label("Still developing"), 1);
    const total = first.summary_distribution.labels.reduce((sum, entry) => sum + entry.students, 0) + first.summary_distribution.earlier_version_records;
    assert.equal(total, first.students);
    const fallbackStudent = input.first_attempts.find((student) => student.student_label === S2)!;
    assert.equal(fallbackStudent.record, "current_version_fallback");
    assert.ok(fallbackStudent.responses.every((response) => response.rating === null));
    const earlier = input.first_attempts.find((student) => student.student_label === S3)!;
    assert.equal(earlier.record, "earlier_version");
    assert.equal(earlier.topic_summary, null);
    assert.ok(earlier.responses.length === 3 && earlier.conversation?.turns.length === 2, "Earlier-version records keep responses and conversations");
    assert.ok(built.application_notes.some((note) => /earlier-version records/.test(note)));
    assert.ok(built.application_notes.some((note) => /fallback profiles/.test(note)));
  });

  await check("Conversation counts use turn records and review flags; item numbers become labels", () => {
    const conversations = counts.first_attempts.conversations;
    assert.equal(conversations.held, 2);
    assert.equal(conversations.ended_by_student, 1);
    assert.equal(conversations.students_with_turn_records, 1);
    assert.equal(conversations.corrected_reasoning_expressed_after_support, 1);
    assert.equal(conversations.difficulty_still_evident, 1);
    assert.deepEqual(conversations.instructor_review_flags.find((entry) => entry.flag === "possible_item_issue"), { flag: "possible_item_issue", students: 1 });
    const turns = input.first_attempts.find((student) => student.student_label === S1)!.conversation!.turns;
    assert.deepEqual(turns[2].turn_record?.focus_items, ["Q1"]);
    assert.equal(turns[4].instructor_review_flag, "possible_item_issue");
  });

  await check("The model input has labels only and no process data", () => {
    assert.deepEqual(assemble.reportInputProblems(input, built.identifiers), []);
    const text = JSON.stringify(input);
    for (const forbidden of [FIRST_VERSION_TEXT, "4242", "sess_a_s1_first", "user_0000_s1", ITEMS[0], "pkg_sess", "response_time", "answer_changed", "confidence_initial", "process_"]) {
      assert.ok(!text.includes(forbidden), `${forbidden} must not reach the model`);
    }
    assert.ok(text.includes("Q1 option B rationale"), "Reference IDs become labels");
    const leaked = { ...input, first_attempts: [{ ...input.first_attempts[0], process_indicators: [{ name: "rapid_selection" }], note: "see sess_a_s1_first" }] };
    const problems = assemble.reportInputProblems(leaked, built.identifiers).map((problem) => problem.code);
    assert.ok(problems.includes("process_data_field"));
    assert.ok(problems.includes("identifier_value"));
  });

  await check("The prompt is the document's section 9.7 text, verbatim, with its own versions and hash", () => {
    // Line endings are normalised: a Windows checkout may turn the document into CRLF.
    const doc = readFileSync(new URL("../docs/AI_MODULE_REDESIGN_2026-10-19.md", import.meta.url), "utf8").replace(/\r\n/g, "\n");
    const section = doc.slice(doc.indexOf("### 9.7 Instructor reporting"));
    const block = /```text\n([\s\S]*?)\n```/.exec(section)![1];
    assert.equal(contract.INSTRUCTOR_REPORT_V8_INSTRUCTIONS, block);
    assert.equal(contract.INSTRUCTOR_REPORT_V8_PROMPT_VERSION, "instructor-report-prompt-v8.2");
    assert.equal(contract.INSTRUCTOR_REPORT_V8_SCHEMA_VERSION, "instructor-report-output-v8");
    assert.equal(contract.INSTRUCTOR_REPORT_V8_PROMPT_HASH, createHash("sha256")
      .update([contract.INSTRUCTOR_REPORT_V8_PROMPT_VERSION, contract.INSTRUCTOR_REPORT_V8_SCHEMA_VERSION, block].join("\n")).digest("hex"));
    assert.deepEqual([...contract.FINDING_TYPES], ["shared_difficulty", "possible_misconception", "sound_understanding", "item_review_needed"], "No engagement pattern type");
  });

  const quote = (student: string, item: string | null, source: "item_response" | "conversation", text: string) => ({ student_label: student, item_label: item, source, quote: text });
  const finding = (overrides: Partial<import("../src/lib/services/instructor-report/contract").InstructorReportV8Finding> = {}) => ({
    title: "Test length taken as validity",
    type: "possible_misconception" as const,
    attempts: "first_attempts" as const,
    item_labels: ["Q1"],
    description: "Two students tie validity to test length; one states it firmly and one tentatively.",
    students_covered: [S1, S4],
    quotes: [quote(S1, "Q1", "item_response", "a longer test is always more valid"), quote(S4, "Q1", "item_response", "Maybe a longer test is more valid")],
    caution: "A possible misconception; the wording of Q1 may also play a part.",
    ...overrides
  });
  const report = (findings: unknown[], extra: Record<string, unknown> = {}) => contract.InstructorReportV8OutputSchema.parse({
    schema_version: contract.INSTRUCTOR_REPORT_V8_SCHEMA_VERSION,
    overview: `In first attempts, ${counts.first_attempts.students} students submitted; later attempts show change after feedback.`,
    findings,
    item_notes: [{ item_label: "Q1", note: "Option B drew most first-attempt choices." }],
    suggested_teaching_actions: [{ action: "Contrast reliability and validity with a worked example.", addresses: "The link between length and validity.", finding_numbers: [1] }],
    limits_of_evidence: ["The report has no process data.", "Earlier-version records have no item ratings."],
    ...extra
  });
  const codes = (output: ReturnType<typeof report>) => validate.validateInstructorReportV8(input, output).map((issue) => issue.code);

  await check("A narrative that follows every rule passes the checks", () => {
    const issues = validate.validateInstructorReportV8(input, report([
      finding(),
      finding({
        title: "Persisting idea in the conversation",
        type: "shared_difficulty",
        description: `${S1} still linked length and validity in the conversation.`,
        students_covered: [S1],
        quotes: [quote(S1, null, "conversation", "adding more questions always makes the test valid")],
        caution: "Agreement with the tutor is not evidence of corrected understanding."
      })
    ]));
    assert.deepEqual(issues, []);
  });

  await check("Quotes: exact excerpts only, at least three words, never the tutor's words", () => {
    const result = codes(report([finding({
      quotes: [
        quote(S1, "Q1", "item_response", "validity depends on length only"),
        quote(S1, "Q1", "item_response", "always valid"),
        quote(S1, null, "conversation", "whether the scores support the intended use")
      ]
    })]));
    assert.ok(result.includes("quote_not_found"), "A fabricated quote");
    assert.ok(result.includes("quote_too_short"), "A two-word quote");
    assert.ok(result.includes("quote_is_tutor_words"), "Student words that echo the tutor are the tutor's words");
    const tutorOnly = codes(report([finding({ quotes: [quote(S1, null, "conversation", "not length alone")] })]));
    assert.ok(tutorOnly.includes("quote_is_tutor_words"), "The tutor's own sentence");
    const wrongStudent = codes(report([finding({ quotes: [quote(S4, "Q1", "item_response", "a longer test is always more valid")] })]));
    assert.ok(wrongStudent.includes("quote_not_found"), "Another student's words");
    const wrongSection = codes(report([finding({ quotes: [quote(S1, "Q1", "item_response", "Consistency of scores is what reliability means")] })]));
    assert.ok(wrongSection.includes("quote_not_found"), "Words from the later attempt do not support a first-attempt finding");
    const normalised = codes(report([finding({ quotes: [
      quote(S1, "Q1", "item_response", "A  LONGER test is always more valid."),
      quote(S1, "Q1", "item_response", "validity sound like they’re the same")
    ] })]));
    assert.ok(!normalised.some((code) => code.startsWith("quote_")), "Spacing, case and quotation marks are normalised");
    const inline = codes(report([finding({ description: `${S1} wrote "length makes every test valid" in Q1.` })]));
    assert.ok(inline.includes("inline_quote_not_found"), "Quotation marks in the narrative follow the same rule");
    const inlineOk = codes(report([finding({ description: `${S1} wrote "a longer test is always more valid" in Q1.` })]));
    assert.ok(!inlineOk.includes("inline_quote_not_found"));
    // A later-attempt finding may cite the student's first-attempt words in its text, but its
    // structured quotes come from the later attempt only.
    const later = {
      type: "sound_understanding" as const, attempts: "later_attempts" as const, students_covered: [S4],
      description: `In the first attempt ${S4} wrote "Maybe a longer test is more valid"; the later attempt ties Q1 to consistency.`,
      quotes: [quote(S4, "Q1", "item_response", "Consistency of the scores, not the length")]
    };
    assert.deepEqual(codes(report([finding(later)])), []);
    assert.ok(codes(report([finding({ ...later, quotes: [quote(S4, "Q1", "item_response", "Maybe a longer test is more valid")] })])).includes("quote_not_found"));
  });

  await check("Student labels must exist, and belong to the finding's attempts section", () => {
    assert.ok(codes(report([finding({ students_covered: [S1, "S99"] })])).includes("unknown_student_label"));
    assert.ok(codes(report([finding({ students_covered: [S1, S4, S5] })])).includes("student_not_in_section"), "S5 has only a later attempt");
    assert.ok(codes(report([finding({ quotes: [quote(S4, "Q1", "item_response", "Maybe a longer test is more valid")], students_covered: [S1] })])).includes("quote_student_not_covered"));
    assert.ok(codes(report([finding({ description: "S42 also tied validity to length." })])).includes("unknown_student_label"));
    assert.ok(codes(report([finding({ item_labels: ["Q9"] })])).includes("unknown_item_label"));
    assert.ok(codes(report([finding({ students_covered: [] })])).includes("no_students_covered"));
  });

  await check("Numbers must be the application's counts; percentages and proportions are refused", () => {
    assert.ok(codes(report([finding({ description: "37 students tie validity to length." })])).includes("number_not_from_counts"));
    assert.ok(codes(report([finding({ description: "Seventeen students tie validity to length." })])).includes("number_not_from_counts"));
    assert.ok(codes(report([finding({ description: "40% of students tie validity to length." })])).includes("percentage_not_from_counts"));
    assert.ok(codes(report([finding({ description: "Half of the students tie validity to length." })])).includes("proportion_not_from_counts"));
    assert.ok(!codes(report([finding({ description: "Two students tie validity to length, in Q1 and attempt 2." })])).includes("number_not_from_counts"),
      "The finding's own count of students and labels such as Q1 or attempt 2 are allowed");
    assert.ok(codes(report([], { overview: "Overall 12 students took part." })).includes("number_not_from_counts"));
    assert.ok(codes(report([finding()], { suggested_teaching_actions: [{ action: "Revisit Q1.", addresses: "Finding.", finding_numbers: [4] }] })).includes("unknown_finding_number"));
  });

  await check("Instructor-facing wording: third person, no misconduct, GenAI, independence or process words", () => {
    assert.ok(codes(report([finding({ description: "You should revisit Q1 with these students." })])).includes("addressed_to_student"));
    assert.ok(codes(report([finding({ caution: "These students may have used ChatGPT." })])).includes("forbidden_wording"));
    assert.ok(codes(report([finding({ caution: "This does not show independent work." })])).includes("forbidden_wording"));
    assert.ok(codes(report([finding({ description: "Both students answered quickly on Q1." })])).includes("process_reference_outside_process_interpretation"));
    assert.ok(!codes(report([finding()])).length, "A limit that only says the report has no process data is allowed");
  });

  await check("Finding counts are the application's: students listed, endorsed and tentative", () => {
    const output = report([finding(), finding({ type: "shared_difficulty", students_covered: [S1, S1, S3], quotes: [quote(S1, "Q1", "item_response", "a longer test is always more valid")] })]);
    const [misconception, shared] = deterministic.findingCounts(input, output);
    assert.equal(misconception.students_covered, 2);
    assert.deepEqual(misconception.profile_misconceptions, { endorsed: 1, tentative: 1, none_recorded: 0 });
    assert.equal(shared.students_covered, 2, "Duplicates are counted once");
    assert.equal(shared.earlier_version_students, 1);
    assert.equal(shared.profile_misconceptions, null);
  });

  await check("Counts-only fallback: the instructor gets the counts and a clear note", () => {
    const record = deterministic.buildReportRecord(built, { generation_mode: "counts_only", reason_code: "validation_failed" });
    assert.equal(record.narrative, null);
    assert.equal(record.generation_mode, "counts_only");
    assert.match(record.narrative_note!, /^The narrative could not be generated: the generated narrative did not pass the application's checks after one regeneration\./);
    assert.deepEqual(record.counts, counts);
    assert.deepEqual(record.finding_counts, []);
    assert.ok(record.application_notes.length > 0);
    for (const code of ["prompt_not_approved", "provider_failure", "live_calls_disabled", "configuration_credential_missing"]) {
      assert.match(deterministic.countsOnlyNote(code), /could not be generated/);
    }
    const stored = service.storedReportFromCall({
      agent_call_public_id: "c1", created_at: new Date("2026-10-19T00:00:00Z"), model_name: "application-counts-only", provider: "application",
      output_payload: JSON.parse(JSON.stringify(record))
    });
    assert.equal(stored?.kind, "v8");
    assert.equal(stored?.kind === "v8" && stored.narrative, null);
  });

  await check("Live narrative needs the approved prompt hash; otherwise reports carry counts only", () => {
    const saved = { ...process.env };
    try {
      delete process.env.INSTRUCTOR_REPORT_V8_APPROVED_PROMPT_HASH;
      assert.equal(service.instructorReportV8ApprovalStatus().approved, false);
      process.env.INSTRUCTOR_REPORT_V8_APPROVED_PROMPT_HASH = "0".repeat(64);
      assert.equal(service.instructorReportV8ApprovalStatus().approved, false, "An outdated hash is not an approval");
      process.env.LLM_PROVIDER = "mock";
      assert.equal(service.instructorReportNarrativePlan().mode, "local_test", "Mock mode gives the labelled local test report");
      Object.assign(process.env, {
        LLM_PROVIDER: "openai", LLM_LIVE_CALLS_ENABLED: "true", OPENAI_API_KEY: `sk-proj-${"a".repeat(64)}`,
        OPENAI_MODEL_MODULE_INSTRUCTOR_REPORTING: "gpt-6.1-sol"
      });
      assert.deepEqual(service.instructorReportNarrativePlan(), { mode: "counts_only", reason_code: "prompt_not_approved" });
      process.env.INSTRUCTOR_REPORT_V8_APPROVED_PROMPT_HASH = contract.INSTRUCTOR_REPORT_V8_PROMPT_HASH;
      assert.equal(service.instructorReportV8ApprovalStatus().approved, true);
      assert.equal(service.instructorReportNarrativePlan().mode, "live_model");
      delete process.env.OPENAI_MODEL_MODULE_INSTRUCTOR_REPORTING;
      assert.deepEqual(service.instructorReportNarrativePlan(), { mode: "counts_only", reason_code: "model_not_configured" });
      process.env.LLM_LIVE_CALLS_ENABLED = "false";
      assert.equal(service.instructorReportNarrativePlan().mode, "counts_only", "Live calls disabled: counts only");
    } finally {
      for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
      Object.assign(process.env, saved);
    }
  });

  await check("Mock mode: the local test narrative is labelled and passes the same checks", () => {
    const narrative = deterministic.buildLocalTestNarrative(input);
    assert.deepEqual(validate.validateInstructorReportV8(input, narrative), []);
    assert.match(narrative.overview, /Local test report generated without an AI model/);
    assert.ok(narrative.findings.length > 0);
    assert.ok(narrative.findings.every((entry) => entry.caution === deterministic.LOCAL_TEST_REPORT_NOTE));
    assert.ok(narrative.findings.every((entry) => entry.attempts === "first_attempts"), "Every most recent later attempt is correct, so later attempts have no entry");
    assert.deepEqual(narrative.findings.find((entry) => entry.item_labels[0] === "Q1")?.students_covered.sort(), [S1, S3, S4].sort());
    const record = deterministic.buildReportRecord(built, { generation_mode: "local_test", narrative });
    assert.equal(record.finding_counts.length, narrative.findings.length);
  });

  await check("Reports saved by the earlier module version stay readable", () => {
    const legacy = service.storedReportFromCall({
      agent_call_public_id: "c0", created_at: new Date("2026-10-18T00:00:00Z"), model_name: "gpt-6.1-sol", provider: "openai",
      output_payload: {
        generation_mode: "live_model", student_count: 2, item_count: 1,
        evidence_index: { students: { S1: { session_public_id: "sess", attempt_number: 1 } }, items: {} },
        report: { schema_version: "instructor-report-output-v1", overview: "o", participation_summary: "p", findings: [], item_notes: [],
          conversation_summary: "c", suggested_instructional_actions: [], limitations: [] }
      }
    });
    assert.equal(legacy?.kind, "legacy_v1");
  });

  console.log(`\n${passed} instructor report v8 checks passed.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
