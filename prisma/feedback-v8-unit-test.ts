/**
 * Database-free checks for feedback v8 (docs/AI_MODULE_REDESIGN_2026-10-19.md, sections
 * 3.1, 7, 8, 9.5 and 9.6): student-facing wording checks, turn-record checks, the local
 * test stand-in and the prompt text. Run with:
 *
 *   npx tsx prisma/feedback-v8-unit-test.ts
 */
import assert from "node:assert/strict";

process.env.DATABASE_URL ??= "postgresql://synthetic:synthetic@127.0.0.1:5432/feedback_v8_unit";
process.env.SESSION_SECRET ??= "feedback-v8-unit-test-session-secret-00000000000000";
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

async function main() {
  const contract = await import("../src/lib/services/student-assessment/feedback-v8/contract");
  const { validateFeedbackV8Output, studentFacingTextProblems } = await import("../src/lib/services/student-assessment/feedback-v8/validate");
  const { buildLocalTestFeedbackV8 } = await import("../src/lib/services/student-assessment/feedback-v8/local-test");
  type Input = import("../src/lib/services/student-assessment/feedback-v8/contract").FeedbackV8Input;
  type Output = import("../src/lib/services/student-assessment/feedback-v8/contract").FeedbackV8Output;

  const item = (n: number, status: string | null) => ({
    item_number: n, item_id: `q${n}`, stem: `Stem ${n}`, options: [{ label: "A", text: "Set 1" }, { label: "B", text: "Set 2" }],
    correct_option: "B", instructor_explanation: "Set 2 values are further from the mean.", essential_elements: "distance from the mean",
    distractor_rationales: [{ option_label: "A", rationale: "Confuses a larger mean with larger spread." }],
    student_response: { selected_option: "A", answer_correct: false, reported_confidence: "high", explanation: "the mean is bigger so it spreads more", tempting_option: null, tempting_option_reason: null },
    interpretation: status ? { explanation_quality: "incorrect", adds_beyond_option_text: true, evidence_quote: "the mean is bigger so it spreads more",
      missing_elements: null, rationale: "Treats a larger mean as larger spread.", error_source: "conceptual", uncertainty_note: null, item_status: status, possible_item_issue: false } : null,
    process_interpretation: null
  });
  const opening: Input = {
    contract_version: contract.FEEDBACK_V8_CONTRACT_VERSION, context_version: contract.FEEDBACK_V8_CONTEXT_VERSION, mode: "opening",
    topic: { title: "Variability", learning_objective: "Interpret SD as spread.", description: "SD is typical distance from the mean." },
    profile_available: true, items: [item(1, "not_supported"), item(2, "supported")],
    possible_misconceptions: [{ item_numbers: [1], idea: "A larger mean means larger spread.", student_quote: "the mean is bigger so it spreads more", endorsement: "endorsed" }],
    considered_ideas: [], answer_patterns: [], saved_questions: [], opening_message: null, visible_transcript: [], latest_student_message: null,
    lifecycle: { student_turns_used: 0, max_student_turns: 30, final_allowed_turn: false, another_student_turn_available: true }
  };
  const reply: Input = {
    ...opening, mode: "reply", opening_message: "Your explanation for Question 1 links the mean to spread. Spread is about distance from the mean.",
    latest_student_message: { sequence_index: 5, text: "Oh so spread is how far scores sit from the mean, not how big the mean is." },
    lifecycle: { student_turns_used: 1, max_student_turns: 30, final_allowed_turn: false, another_student_turn_available: true }
  };
  const goodOpening: Output = {
    contract_version: contract.FEEDBACK_V8_CONTRACT_VERSION,
    student_visible_message: "Your explanation for Question 1 links a bigger mean to more spread. Spread describes how far scores sit from the mean, whatever the mean is. Would you like to try that idea on Question 1 again? You can also ask about anything else, or stop here.",
    focus: { item_numbers: [1], focus_type: "possible_misconception", concept: "Spread versus centre" },
    strategy: "explain", student_evidence: [], focus_status: null, instructor_review: { flag: "none", reason: null }
  };
  const goodReply: Output = {
    ...goodOpening,
    student_visible_message: "Yes. Spread is about distance from the mean. A set can have a large mean and little spread.",
    strategy: "extend",
    student_evidence: [{ quote: "spread is how far scores sit from the mean", note: "States distance from the mean in the student's own words." }],
    focus_status: "corrected_reasoning_expressed"
  };

  await check("Well-formed opening and reply pass", () => {
    assert.deepEqual(validateFeedbackV8Output(opening, goodOpening), []);
    assert.deepEqual(validateFeedbackV8Output(reply, goodReply), []);
  });

  await check("Student-facing text: internal labels, process data, authorship and scores are rejected", () => {
    assert.deepEqual(studentFacingTextProblems("You have a misconception about spread."), ["internal_term"]);
    assert.deepEqual(studentFacingTextProblems("Your answer was not supported by your explanation."), ["internal_term"]);
    assert.deepEqual(studentFacingTextProblems("I noticed you changed your answer on Question 2."), ["process_reference"]);
    assert.deepEqual(studentFacingTextProblems("You answered very quickly, so take another look."), ["process_reference"]);
    assert.deepEqual(studentFacingTextProblems("It looks like you left the page during Question 3."), ["process_reference"]);
    assert.deepEqual(studentFacingTextProblems("Did you use ChatGPT? You have used ChatGPT here."), ["authorship_or_character"]);
    assert.deepEqual(studentFacingTextProblems("You got 3 out of 4 questions correct."), ["score_repeated"]);
  });

  await check("Course content in measurement and statistics is not caught", () => {
    for (const text of [
      "A rating scale gives each respondent a score; the observed score includes error.",
      "Response time studies use how long people take, but that is a research topic here.",
      "The claim is not supported by the data, so the validity argument needs another source.",
      "Copy and paste the formula into the spreadsheet cell if that helps you check it.",
      "Don't hesitate to ask about the independent variable or a score profile.",
      "The student wrote \"I think I have a misconception\" and that is a good question to explore."
    ]) assert.deepEqual(studentFacingTextProblems(text), [], text);
  });

  await check("Opening records no student evidence and no focus status", () => {
    const codes = (output: Output) => validateFeedbackV8Output(opening, output).map((issue) => issue.code);
    assert.ok(codes({ ...goodOpening, focus_status: "difficulty_still_evident" }).includes("opening_has_no_focus_status"));
    assert.ok(codes({ ...goodOpening, student_evidence: [{ quote: "x y z", note: "n" }] }).includes("opening_has_no_student_evidence"));
    assert.ok(codes({ ...goodOpening, focus: { ...goodOpening.focus, item_numbers: [3] } }).includes("unknown_item_number"));
  });

  await check("Reply evidence quotes the student's new words; echoes and empty evidence never show corrected reasoning", () => {
    const codes = (output: Output, input: Input = reply) => validateFeedbackV8Output(input, output).map((issue) => issue.code);
    assert.ok(codes({ ...goodReply, focus_status: null }).includes("focus_status_required"));
    assert.ok(codes({ ...goodReply, student_evidence: [{ quote: "spread is the range of scores", note: "n" }] }).includes("quote_not_found"));
    assert.ok(codes({ ...goodReply, student_evidence: [] }).includes("corrected_reasoning_needs_quote"));
    const echo: Input = { ...reply, latest_student_message: { sequence_index: 5, text: "Spread is about distance from the mean." },
      opening_message: "Spread is about distance from the mean. Does that help?" };
    assert.ok(codes({ ...goodReply, student_evidence: [{ quote: "Spread is about distance from the mean", note: "Repeats the tutor." }] }, echo)
      .includes("echo_is_not_evidence"));
    assert.ok(codes({ ...goodReply, student_evidence: [{ quote: "spread is how far scores sit from the mean", note: "You explained it well." }] })
      .includes("addressed_to_student"), "Turn-record notes are instructor-facing");
  });

  await check("An instructor-review flag needs a reason, in neutral wording", () => {
    const codes = (output: Output) => validateFeedbackV8Output(reply, output).map((issue) => issue.code);
    assert.ok(codes({ ...goodReply, instructor_review: { flag: "possible_item_issue", reason: null } }).includes("reason_required"));
    assert.deepEqual(codes({ ...goodReply, instructor_review: { flag: "possible_item_issue", reason: "Option B wording allows a second reading." } }), []);
    assert.ok(codes({ ...goodReply, instructor_review: { flag: "persistent_difficulty", reason: "The student was careless." } }).includes("forbidden_wording"));
  });

  await check("The local stand-in passes the checks for an opening and a reply", () => {
    assert.deepEqual(validateFeedbackV8Output(opening, buildLocalTestFeedbackV8(opening)), []);
    assert.deepEqual(validateFeedbackV8Output(reply, buildLocalTestFeedbackV8(reply)), []);
    assert.equal(buildLocalTestFeedbackV8(opening).focus.focus_type, "possible_misconception");
  });

  await check("Prompts are the documented text and the hash is stable", () => {
    assert.match(contract.FEEDBACK_V8_OPENING_INSTRUCTIONS, /CHOOSING ONE FOCUS \(use the first that applies\)/);
    assert.match(contract.FEEDBACK_V8_OPENING_INSTRUCTIONS, /Never mention process data or anything inferred from them/);
    assert.match(contract.FEEDBACK_V8_CONVERSATION_INSTRUCTIONS, /TURN RECORD \(returned with each reply\)/);
    assert.match(contract.FEEDBACK_V8_CONVERSATION_INSTRUCTIONS, /The mini-test profile is never changed/);
    assert.equal(contract.FEEDBACK_V8_PROMPT_HASH.length, 64);
    assert.equal(contract.FeedbackV8OutputSchema.safeParse(goodReply).success, true);
  });

  console.log(`\n${passed} feedback v8 checks passed.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
