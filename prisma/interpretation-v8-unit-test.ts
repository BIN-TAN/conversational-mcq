/**
 * Database-free checks for interpretation v8 (docs/AI_MODULE_REDESIGN_2026-10-19.md):
 * item status and topic summary rules, process indicators, the input builder, output
 * validation and the local test stand-in. Run with:
 *
 *   npx tsx prisma/interpretation-v8-unit-test.ts
 */
import assert from "node:assert/strict";

process.env.DATABASE_URL ??= "postgresql://synthetic:synthetic@127.0.0.1:5432/interpretation_v8_unit";
process.env.SESSION_SECRET ??= "interpretation-v8-unit-test-session-secret-0000000000";
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
  const rules = await import("../src/lib/services/student-assessment/interpretation-v8/rules");
  const { itemStatus, topicSummary, summaryRule, answerPatterns } = rules;
  type Quality = "adequate" | "limited" | "incorrect" | "no_usable_explanation";
  type Status = "supported" | "partly_supported" | "not_supported" | "not_interpretable";
  const status = (answer_correct: boolean | null, explanation_quality: Quality, rapid_selection: boolean | null = false, skipped = false) =>
    itemStatus({ answer_correct, skipped, explanation_quality, rapid_selection });

  await check("Item status follows the answer x explanation table", () => {
    assert.equal(status(true, "adequate"), "supported");
    assert.equal(status(true, "limited"), "partly_supported");
    assert.equal(status(false, "adequate"), "partly_supported", "An execution slip or unclear source with sound reasoning");
    assert.equal(status(true, "incorrect"), "not_supported");
    assert.equal(status(false, "incorrect"), "not_supported");
    assert.equal(status(false, "limited"), "not_supported");
    assert.equal(status(false, "no_usable_explanation"), "not_supported");
    assert.equal(status(true, "no_usable_explanation"), "not_interpretable");
  });

  await check("No answer selected is its own state: never incorrect, never interpretable", () => {
    assert.equal(status(null, "incorrect", false, true), "not_interpretable");
    assert.equal(status(null, "adequate", false, true), "not_interpretable");
    assert.equal(status(null, "no_usable_explanation", false, false), "not_interpretable", "Correctness unknown");
  });

  await check("A rapid selection with no usable explanation is not interpretable, whatever the answer", () => {
    assert.equal(status(false, "no_usable_explanation", true), "not_interpretable");
    assert.equal(status(true, "no_usable_explanation", true), "not_interpretable");
    assert.equal(status(false, "limited", true), "not_supported", "A rapid selection never changes a rated explanation");
  });

  const label = (...statuses: Status[]) => summaryRule(statuses).label;
  await check("Summary rules, including the reviews' edge cases", () => {
    // The reviewer's four items: supported; correct but limited; a misconception; an execution slip.
    assert.equal(label("supported", "partly_supported", "not_supported", "partly_supported"), "Still developing");
    assert.equal(label("supported", "supported", "not_interpretable", "not_interpretable"), "Still developing", "Two of four is not more than half");
    assert.equal(label("supported", "supported", "not_interpretable"), "Mostly understood", "Two of three is more than half");
    assert.equal(label("not_interpretable", "not_interpretable", "not_interpretable", "not_interpretable"), "Unavailable / insufficient evidence");
    assert.equal(label("not_supported", "not_supported", "not_supported", "not_supported"), "Need more work");
    assert.equal(label("supported", "not_interpretable", "not_interpretable", "not_interpretable"), "Unavailable / insufficient evidence");
    assert.equal(label("supported", "supported", "not_supported", "not_supported"), "Need more work");
    assert.equal(label("supported", "supported", "supported", "not_supported"), "Still developing");
    assert.equal(label("supported", "partly_supported", "partly_supported"), "Still developing");
    assert.equal(label("supported", "supported", "partly_supported"), "Mostly understood");
  });

  await check("Summary boundaries: no items, one item, two items, exactly half", () => {
    assert.equal(summaryRule([]).reason, "no_counted_items");
    assert.equal(summaryRule(["supported"]).reason, "fewer_than_two_interpretable", "A one-item mini-test never gets a label");
    assert.equal(summaryRule(["supported", "not_interpretable"]).reason, "fewer_than_two_interpretable");
    assert.equal(label("supported", "supported"), "Mostly understood", "A two-item mini-test needs both items interpretable");
    assert.equal(label("supported", "partly_supported"), "Still developing", "One of two supported is not more than half");
    assert.equal(label("supported", "not_supported"), "Need more work");
    assert.equal(summaryRule(["supported", "supported", "not_interpretable", "not_interpretable"]).reason, "mixed", "Exactly half interpretable is enough");
    assert.equal(summaryRule(["supported", "supported", "not_interpretable", "not_interpretable", "not_interpretable"]).reason, "fewer_than_half_interpretable");
    assert.equal(topicSummary(null).reason, "no_valid_profile");
  });

  const items = (...entries: Array<[string, Status, boolean?]>) =>
    entries.map(([item_id, entryStatus, flagged]) => ({ item_id, status: entryStatus, flagged_for_review: flagged ?? false }));
  await check("A flagged item stays counted; the label is withheld only when the flag could change it", () => {
    const unaffected = topicSummary(items(["q1", "supported"], ["q2", "supported"], ["q3", "partly_supported", true]));
    assert.equal(unaffected.label, "Mostly understood");
    assert.deepEqual(unaffected.pending_review_item_ids, ["q3"]);
    assert.equal(unaffected.counted_items, 3);

    const affected = items(["q1", "supported"], ["q2", "supported"], ["q3", "not_supported", true], ["q4", "partly_supported"]);
    const pending = topicSummary(affected);
    assert.equal(pending.label, "Pending item review");
    assert.equal(pending.rule_label, "Still developing");
    assert.equal(pending.label_without_pending, "Mostly understood");
    assert.equal(pending.counted_items, 4, "The model's flag never removes an item");

    const kept = topicSummary(affected, new Map([["q3", "kept"]]));
    assert.equal(kept.label, "Still developing");
    assert.deepEqual(kept.pending_review_item_ids, []);

    const excluded = topicSummary(affected, new Map([["q3", "excluded"]]));
    assert.equal(excluded.label, "Mostly understood");
    assert.deepEqual(excluded.excluded_item_ids, ["q3"]);
    assert.deepEqual(excluded.based_on, { interpretable_items: 3, administered_items: 4 });

    const allExcluded = topicSummary(items(["q1", "supported"], ["q2", "supported"]), new Map([["q1", "excluded"], ["q2", "excluded"]]));
    assert.equal(allExcluded.label, "Unavailable / insufficient evidence");
    assert.equal(allExcluded.reason, "no_counted_items");
  });

  await check("Answer patterns need two chosen distractors sharing a tag", () => {
    assert.deepEqual(answerPatterns([
      { item_id: "q1", answer_correct: false, chosen_option_tag: "Mean equals median" },
      { item_id: "q2", answer_correct: false, chosen_option_tag: "mean equals median " },
      { item_id: "q3", answer_correct: true, chosen_option_tag: "mean equals median" },
      { item_id: "q4", answer_correct: false, chosen_option_tag: "other" }
    ]), [{ misconception_tag: "mean equals median", item_ids: ["q1", "q2"] }]);
  });

  const indicators = await import("../src/lib/services/student-assessment/interpretation-v8/indicators");
  const baseResponse = {
    item_public_id: "q1", selected_answer_initial: "B", selected_answer_final: "C", answer_changed: true, correct_option: "C",
    reasoning_text_initial: "Because the scores are spread out", reasoning_text_final: "Because the scores are spread out, the SD is large",
    confidence_initial: "low", confidence_final: "medium", response_time_answer_ms: 6_000
  };

  await check("Process indicators carry fixed roles and the 10-second rapid rule", () => {
    const list = indicators.computeProcessIndicators(baseResponse, [
      { event_type: "paste_detected", event_source: "frontend", item_public_id: "q1", payload: { paste_blocked: true } },
      { event_type: "paste_detected", event_source: "frontend", item_public_id: "q1", payload: { paste_blocked: false } },
      { event_type: "long_pause", event_source: "frontend", item_public_id: "q1", payload: {}, pause_duration_ms: 125_000 }
    ]);
    const value = (name: Parameters<typeof indicators.indicatorValue>[1]) => indicators.indicatorValue(list, name);
    assert.equal(value("rapid_selection"), true, "6 s from display to first choice is under 10 s");
    assert.equal(value("answer_change"), "incorrect_to_correct");
    assert.equal(value("explanation_revised"), true);
    assert.equal(value("confidence_change"), "higher");
    assert.equal(value("blocked_paste_attempts"), 1);
    assert.equal(value("longest_pause"), 125);
    assert.deepEqual(list.map((entry) => [entry.name, entry.role]), [
      ["rapid_selection", "qualifies_evidence"], ["answer_change", "with_content"], ["explanation_revised", "with_content"],
      ["confidence_change", "with_content"], ["focused_time", "context"], ["focus_loss", "context"],
      ["longest_pause", "context"], ["blocked_paste_attempts", "context"]
    ]);
    assert.ok(list.every((entry) => entry.indicator_id.startsWith("q1:") && entry.alternatives.length > 0));
    const slow = indicators.computeProcessIndicators({ ...baseResponse, response_time_answer_ms: 12_000 }, []);
    assert.equal(indicators.indicatorValue(slow, "rapid_selection"), false);
    const unknown = indicators.computeProcessIndicators({ ...baseResponse, response_time_answer_ms: null }, []);
    assert.equal(indicators.indicatorValue(unknown, "rapid_selection"), null);
    assert.equal(indicators.answerChangeValue({ ...baseResponse, selected_answer_initial: "C", selected_answer_final: "C", answer_changed: true }), "changed_and_returned");
    assert.equal(indicators.answerChangeValue({ ...baseResponse, selected_answer_initial: "C", selected_answer_final: "A" }), "correct_to_incorrect");
  });

  const { buildInterpretationInputV8FromPackage } = await import("../src/lib/services/student-assessment/interpretation-v8/input-builder");
  const packagePayload = {
    assessment: { title: "Variability", diagnostic_focus: "Spread versus centre" },
    concept_unit: { title: "Standard deviation", learning_objective: "Interpret the standard deviation as spread.", related_concept_description: "SD measures typical distance from the mean." },
    item_responses: [
      {
        item_public_id: "q1", initial_item_position: 1, correct_option_snapshot: "C", correctness: "correct",
        item_snapshot: { item_stem: "Which set has the larger SD?", options: [{ label: "A", text: "Set 1" }, { label: "B", text: "Same" }, { label: "C", text: "Set 2" }] },
        teacher_diagnostic_context: {
          teacher_diagnostic_context: { correct_option_notes: { target_reasoning_note: "Set 2 values are further from the mean.", strong_reasoning_should_mention: "distance of values from the mean" } },
          distractor_rationales: { A: "Confuses a larger mean with larger spread.", B: "Thinks equal ranges imply equal SD." }
        },
        selected_answer_initial: "B", selected_answer_final: "C", answer_changed: true,
        reasoning_text_initial: "Because the scores are spread out", reasoning_text_final: "Because the scores are spread out, the SD is large",
        confidence_initial: "low", confidence_final: "medium", tempting_option: "B",
        tempting_option_reason: "I thought maybe the same range means the same SD", response_time_answer_ms: 15_000
      }
    ]
  };
  const built = buildInterpretationInputV8FromPackage(packagePayload, new Map());

  await check("The input carries the specification, references, recorded correctness and indicators, and no raw logs", () => {
    assert.equal(built.input_version, "student-interpretation-input-v8");
    const item = built.items[0];
    assert.equal(item.response.answer_correct, true);
    assert.equal(item.response.reported_confidence, "medium");
    assert.equal(item.essential_elements, "distance of values from the mean");
    assert.deepEqual(item.references.map((reference) => reference.reference_id), ["q1:target", "q1:elements", "q1:option:A", "q1:option:B"]);
    assert.deepEqual(built.topic.references.map((reference) => reference.reference_id), ["topic:objective", "topic:description"]);
    assert.equal(item.process_indicators.length, 8);
    assert.equal(JSON.stringify(built).includes("response_stage_observation"), false);
  });

  const { validateInterpretationOutputV8, quoteProblem, interpretationTextProblem, processReferenceProblem } = await import("../src/lib/services/student-assessment/interpretation-v8/validate");
  const good: import("../src/lib/services/student-assessment/interpretation-v8/contract").InterpretationOutputV8 = {
    items: [{
      item_id: "q1", explanation_quality: "limited", no_usable_reason: null, adds_beyond_option_text: true,
      evidence_quote: "the scores are spread out", evidence_source: "explanation", reference_id: "q1:elements",
      missing_elements: "distance of values from the mean", rationale: "Names spread but not distance from the mean.",
      error_source: null, side_remark: null, uncertainty_note: null,
      process_interpretation: {
        type: "possible_revision_of_reasoning", indicator_ids: ["q1:answer_change"],
        content_quote: "the SD is large", content_source: "explanation",
        note: "The answer moved to the key after the explanation added the SD.", alternatives: ["reconsidering after more thought"]
      }
    }],
    possible_misconceptions: [],
    considered_ideas: [{ item_id: "q1", idea: "Equal ranges imply equal SD.", student_quote: "the same range means the same SD", quote_source: "tempting_option_reason", contradicts_reference_id: "q1:option:B" }]
  };

  await check("A well-formed output passes validation", () => {
    assert.deepEqual(validateInterpretationOutputV8(built, good), []);
  });

  await check("Validation rejects invented quotes, short quotes, missing elements and role violations", () => {
    const codes = (output: typeof good) => validateInterpretationOutputV8(built, output).map((issue) => issue.code);
    assert.ok(codes({ ...good, items: [{ ...good.items[0], evidence_quote: "the mean is the middle value" }] }).includes("evidence_quote_not_found"));
    assert.ok(codes({ ...good, items: [{ ...good.items[0], evidence_quote: "spread out" }] }).includes("evidence_quote_too_short"));
    assert.ok(codes({ ...good, items: [{ ...good.items[0], missing_elements: null }] }).includes("missing_elements_required"));
    assert.ok(codes({ ...good, items: [{ ...good.items[0], explanation_quality: "adequate", error_source: "conceptual" }] }).includes("adequate_with_conceptual_error"));
    assert.ok(codes({ ...good, items: [{ ...good.items[0], process_interpretation: { ...good.items[0].process_interpretation!, type: "context_noted" } }] }).includes("role_violation"));
    assert.ok(codes({ ...good, items: [{ ...good.items[0], process_interpretation: { ...good.items[0].process_interpretation!, type: "limited_engagement_evidence" } }] }).includes("role_violation"), "No rapid selection in this record");
    assert.ok(codes({ ...good, items: [{ ...good.items[0], rationale: "The student may have used ChatGPT." }] }).includes("forbidden_wording"));
    assert.ok(codes({ ...good, items: [{ ...good.items[0], rationale: "You named spread." }] }).includes("addressed_to_student"));
    assert.equal(interpretationTextProblem("The student wrote \"you can ask ChatGPT\" as a reason."), null, "Quoted student words are exempt");
    assert.ok(codes({ ...good, items: [] }).includes("missing_item"));
    assert.ok(codes({ ...good, considered_ideas: [{ ...good.considered_ideas[0], contradicts_reference_id: "q9:target" }] }).includes("unknown_reference"));
    assert.equal(quoteProblem(built.items[0], "explanation", "Because the scores are SPREAD out"), null, "Case and spacing are normalised");
  });

  await check("The beyond-option-text flag is required, and contradicted by an exact copy of an option", () => {
    const codes = (input: typeof built, output: typeof good) => validateInterpretationOutputV8(input, output).map((issue) => issue.code);
    assert.ok(codes(built, { ...good, items: [{ ...good.items[0], adds_beyond_option_text: null }] }).includes("option_text_flag_mismatch"));
    const copied = { ...built, items: [{ ...built.items[0], response: { ...built.items[0].response, explanation: "Set 2.", explanation_first_version: null } }] };
    const copiedItem = { ...good.items[0], explanation_quality: "adequate" as const, missing_elements: null, evidence_quote: "Set 2", process_interpretation: null };
    assert.ok(codes(copied, { ...good, considered_ideas: [], items: [copiedItem] }).includes("option_text_flag_contradicted"));
    assert.deepEqual(codes(copied, { ...good, considered_ideas: [], items: [{ ...copiedItem, adds_beyond_option_text: false }] }), [],
      "A complete copied option can be adequate when the flag records the copy");
    const guess = { ...good.items[0], explanation_quality: "no_usable_explanation" as const, no_usable_reason: "stated_guess" as const,
      adds_beyond_option_text: false, evidence_quote: null, evidence_source: null, missing_elements: null, process_interpretation: null };
    assert.ok(codes(built, { ...good, items: [guess] }).includes("option_text_flag_mismatch"));
  });

  await check("Process inferences are rejected outside the process interpretation", () => {
    const codes = (output: typeof good) => validateInterpretationOutputV8(built, output).map((issue) => issue.code);
    assert.ok(codes({ ...good, items: [{ ...good.items[0], rationale: "Names spread; the student changed their answer after a long pause." }] })
      .includes("process_reference_outside_process_interpretation"));
    assert.ok(codes({ ...good, items: [{ ...good.items[0], uncertainty_note: "The rapid selection makes this uncertain." }] })
      .includes("process_reference_outside_process_interpretation"));
    assert.equal(processReferenceProblem("Names a rapid reaction and the seconds elapsed in the experiment."), null, "Subject wording is not caught");
    assert.equal(processReferenceProblem("The student wrote \"I answered quickly\" in the explanation."), null, "Quoted student words are exempt");
    assert.equal(interpretationTextProblem("States that reliability is independent of the group tested."), null, "Course content is not caught");
    assert.equal(interpretationTextProblem("Refers to test-taking motivation as a source of error."), null, "Course content is not caught");
    assert.equal(processReferenceProblem("Explains why student engagement surveys need validity evidence."), null, "Course content is not caught");
    assert.equal(interpretationTextProblem("The student did not work independently."), "forbidden_wording");
    assert.equal(processReferenceProblem("Shows limited engagement with the item."), "process_reference_outside_process_interpretation");
  });

  const { buildLocalTestInterpretationV8 } = await import("../src/lib/services/student-assessment/interpretation-v8/local-test");
  await check("The local test stand-in validates and claims nothing", () => {
    const output = buildLocalTestInterpretationV8(built);
    assert.deepEqual(validateInterpretationOutputV8(built, output), []);
    assert.equal(output.possible_misconceptions.length, 0);
  });

  const { buildStoredInterpretationV8 } = await import("../src/lib/services/student-assessment/interpretation-v8/profile");
  await check("The stored profile flags a possible item issue without changing the item's status", () => {
    const flagged = { ...good, items: [{ ...good.items[0], error_source: "possible_item_issue" as const }] };
    const stored = buildStoredInterpretationV8({
      model_input: built, output: flagged, generation_mode: "local_test", fallback_reason: null,
      response_package_id: "pkg-1", answer_review_v2: null
    });
    assert.equal(stored.items[0].status, "partly_supported");
    assert.equal(stored.items[0].item_review_flag, true);
    assert.equal(stored.items[0].adds_beyond_option_text, true);
    assert.equal(stored.topic_summary.counted_items, 1);
    assert.equal(stored.topic_summary.label, "Unavailable / insufficient evidence", "One item never gets a label");
    assert.equal(stored.attempt, null);
    const fallback = buildStoredInterpretationV8({
      model_input: built, output: null, generation_mode: "fallback", fallback_reason: "blocked", response_package_id: "pkg-1", answer_review_v2: null
    });
    assert.equal(fallback.topic_summary.reason, "no_valid_profile");
    assert.equal(fallback.items[0].status, null);
  });

  const { studentProfileDataV8, fallbackReasonText } = await import("../src/lib/services/student-assessment/interpretation-v8/profile");
  await check("Two rejected outputs save a fallback profile with no claims, so the student continues", () => {
    const stored = buildStoredInterpretationV8({
      model_input: built, output: null, generation_mode: "fallback", fallback_reason: "validation_failed",
      response_package_id: "pkg-1", answer_review_v2: { review: "kept" }
    });
    const data = studentProfileDataV8({ concept_unit_session_db_id: "unit-1", based_on_agent_call_db_id: "call-1", stored });
    assert.deepEqual(data.process_interpretation_cautions, ["Fallback-derived profile"]);
    assert.equal(data.evidence_sufficiency, "insufficient");
    assert.deepEqual(stored.answer_review_v2, { review: "kept" }, "The answer review is still shown to the student");
    assert.equal(stored.possible_misconceptions.length + stored.considered_ideas.length, 0);
    assert.match(data.rationale, /did not pass the application's checks/);
    assert.match(fallbackReasonText("interpretation_v8_not_approved"), /No model call was allowed/);
    assert.match(fallbackReasonText("provider_exception"), /could not be reached/);
  });

  const { repairInterpretationOutputV8, salvageInterpretationOutputV8 } = await import("../src/lib/services/student-assessment/interpretation-v8/repair");
  await check("Mechanical slips are repaired by fixed rules, and every repair is recorded", () => {
    const sloppy = {
      ...good,
      items: [{
        ...good.items[0],
        evidence_quote: "\"Because the scores are spread out ... the SD is large\"",
        missing_elements: null,
        process_interpretation: null
      }],
      considered_ideas: [{ ...good.considered_ideas[0], student_quote: "maybe the same range means the same SD", quote_source: "explanation" as const }]
    };
    assert.ok(validateInterpretationOutputV8(built, sloppy).length > 0);
    const { output, repairs } = repairInterpretationOutputV8(built, sloppy);
    assert.deepEqual(validateInterpretationOutputV8(built, output), []);
    assert.equal(output.items[0].evidence_quote, "Because the scores are spread out", "An ellipsis quote is cut to an exact excerpt");
    assert.equal(output.items[0].missing_elements, "One or more essential elements are not stated.");
    assert.equal(output.considered_ideas[0].quote_source, "tempting_option_reason", "The quote's real source is found");
    const codes = repairs.map((repair) => repair.code);
    assert.ok(codes.includes("evidence_quote_trimmed_to_exact_words"));
    assert.ok(codes.includes("missing_elements_default"));
    assert.ok(codes.includes("claim_quote_trimmed_to_exact_words"));
    const wrongAnswer = { ...built, items: [{ ...built.items[0], response: { ...built.items[0].response, answer_correct: false } }] };
    const noSource = repairInterpretationOutputV8(wrongAnswer, { ...good, items: [{ ...good.items[0], error_source: null }] });
    assert.equal(noSource.output.items[0].error_source, "unclear", "A missing error source becomes the neutral 'unclear'");
    const copied = { ...built, items: [{ ...built.items[0], response: { ...built.items[0].response, explanation: "Set 2.", explanation_first_version: null } }] };
    const copiedRepair = repairInterpretationOutputV8(copied, { ...good, considered_ideas: [], items: [{ ...good.items[0],
      explanation_quality: "adequate", missing_elements: null, evidence_quote: "Set 2", process_interpretation: null,
      rationale: "The student copied option C." }] });
    assert.equal(copiedRepair.output.items[0].adds_beyond_option_text, false, "The flag the application can compute is set");
    assert.equal(copiedRepair.output.items[0].rationale, "The student repeated option C.");
    assert.deepEqual(validateInterpretationOutputV8(copied, copiedRepair.output), []);
    const paraphrase = repairInterpretationOutputV8(built, { ...good, items: [{ ...good.items[0], evidence_quote: "the scores are spread out so the SD is large" }] });
    assert.equal(paraphrase.output.items[0].evidence_quote, built.items[0].response.explanation, "A close paraphrase of a short explanation becomes the explanation itself");
    const invented = repairInterpretationOutputV8(built, { ...good, items: [{ ...good.items[0], evidence_quote: "the median is the middle score" }] });
    assert.equal(invented.output.items[0].evidence_quote, "the median is the middle score", "An invented quote is not repaired");
    assert.ok(validateInterpretationOutputV8(built, invented.output).some((issue) => issue.code === "evidence_quote_not_found"));
  });

  await check("Salvage drops failing claims and leaves only failing items unrated; nothing usable means fallback", () => {
    const twoItems = { ...built, items: [built.items[0], { ...built.items[0], item_id: "q2", position: 2,
      references: built.items[0].references.map((reference) => ({ ...reference, reference_id: reference.reference_id.replace("q1", "q2") })),
      process_indicators: built.items[0].process_indicators.map((indicator) => ({ ...indicator, indicator_id: indicator.indicator_id.replace("q1", "q2") })) }] };
    const second = { ...good.items[0], item_id: "q2", reference_id: "q2:elements", process_interpretation: null,
      rationale: "The student hesitated and changed their answer." };
    const output = {
      items: [{ ...good.items[0], process_interpretation: null }, second],
      possible_misconceptions: [{ item_ids: ["q1"], idea: "Spread means a large mean.", student_quote: "the mean is huge here", quote_item_id: "q1",
        quote_source: "explanation" as const, endorsement: "endorsed" as const, contradicts_reference_id: "q1:target",
        matching_distractor_reference_id: null, alternative_explanation: null }],
      considered_ideas: []
    };
    const issues = validateInterpretationOutputV8(twoItems, output);
    assert.ok(issues.length >= 2);
    const salvaged = salvageInterpretationOutputV8(twoItems, output, issues)!;
    assert.ok(salvaged);
    assert.deepEqual(salvaged.salvage.unrated_item_ids, ["q2"]);
    assert.equal(salvaged.salvage.dropped_misconceptions, 1);
    assert.equal(salvaged.output.possible_misconceptions.length, 0, "A claim that fails is dropped, never kept");
    const stored = buildStoredInterpretationV8({ model_input: twoItems, output: salvaged.output, generation_mode: "live_model",
      fallback_reason: null, response_package_id: "pkg-1", answer_review_v2: null, output_adjustments: { repairs: [], salvage: salvaged.salvage } });
    assert.equal(stored.items[1].status, "not_interpretable");
    assert.equal(stored.items[1].rating_unavailable, true);
    assert.equal(stored.items[0].status, "partly_supported");
    assert.equal(stored.topic_summary.counted_items, 2);
    assert.deepEqual(stored.output_adjustments?.salvage?.unrated_item_ids, ["q2"]);
    const allBad = { ...output, items: [second] };
    assert.equal(salvageInterpretationOutputV8(twoItems, allBad, validateInterpretationOutputV8(twoItems, allBad)), null);
  });

  const { generateInterpretationV8 } = await import("../src/lib/services/student-assessment/interpretation-v8/generate");
  const scripted = (results: Array<unknown>) => {
    let call = 0;
    return {
      calls: () => call,
      provider: {
        async executeStructured() {
          const next = results[call++];
          if (next instanceof Error) throw next;
          return next as never;
        }
      }
    };
  };
  const completed = (parsed_output: unknown) => ({ provider: "openai", client_request_id: "x", status: "completed", parsed_output, latency_ms: 1 });
  const providerFailure = (category: string, retryable = true) => ({ provider: "openai", client_request_id: "x", status: "failed", latency_ms: 1,
    error: { category, message: "failure", retryable } });
  await check("The generation loop repairs, regenerates, salvages, and waits after transient failures", async () => {
    const waits: number[] = [];
    const sleep = async (ms: number) => { waits.push(ms); };
    const repairedFirst = scripted([completed({ ...good, items: [{ ...good.items[0], missing_elements: null }] })]);
    const first = await generateInterpretationV8({ provider: repairedFirst.provider as never, model_config: { model_name: "m" }, model_input: built, sleep });
    assert.equal(first.status, "validated");
    assert.equal(repairedFirst.calls(), 1, "A repairable slip costs no regeneration");
    const badRationale = { ...good, items: [{ ...good.items[0], rationale: "The student paused and pasted text." }] };
    const salvageRun = scripted([completed(badRationale), completed({ ...badRationale, items: [...badRationale.items] })]);
    const salvagedResult = await generateInterpretationV8({ provider: salvageRun.provider as never, model_config: { model_name: "m" }, model_input: built, sleep });
    assert.equal(salvageRun.calls(), 2, "A failing output is regenerated once");
    assert.equal(salvagedResult.status, "failed", "With one item whose rating fails, nothing usable is left");
    const transient = scripted([providerFailure("rate_limit"), providerFailure("timeout")]);
    const transientResult = await generateInterpretationV8({ provider: transient.provider as never, model_config: { model_name: "m" }, model_input: built, sleep });
    assert.equal(transientResult.status, "failed");
    assert.equal(transientResult.status === "failed" && transientResult.transient, true, "The preparation job may retry a transient failure later");
    assert.ok(waits.length === 1 && waits[0] >= 5_000, "A rate limit waits before the next attempt");
    const quota = scripted([providerFailure("quota", false)]);
    const quotaResult = await generateInterpretationV8({ provider: quota.provider as never, model_config: { model_name: "m" }, model_input: built, sleep });
    assert.equal(quotaResult.status === "failed" && quotaResult.transient, false, "A quota failure is not retried later");
    const invented = scripted([completed({ ...good, items: [{ ...good.items[0], evidence_quote: "something the student never wrote" }] }), providerFailure("timeout")]);
    const inventedResult = await generateInterpretationV8({ provider: invented.provider as never, model_config: { model_name: "m" }, model_input: built, sleep });
    assert.equal(inventedResult.status, "failed", "An invented quote is never accepted; its item stays unrated");
  });

  const contract = await import("../src/lib/services/student-assessment/interpretation-v8/contract");
  await check("The prompt matches the documented rules and has a stable hash", () => {
    assert.match(contract.INTERPRETATION_V8_INSTRUCTIONS, /Report a possible misconception only when both conditions hold/);
    assert.match(contract.INTERPRETATION_V8_INSTRUCTIONS, /Use each process indicator only in its stated role/);
    assert.match(contract.INTERPRETATION_V8_INSTRUCTIONS, /including wording taken from an option/);
    assert.match(contract.INTERPRETATION_V8_INSTRUCTIONS, /A guess followed by reasoning/);
    assert.match(contract.INTERPRETATION_V8_INSTRUCTIONS, /does not change how you rate the explanation/);
    assert.match(contract.INTERPRETATION_V8_INSTRUCTIONS, /only in the process interpretation/);
    assert.doesNotMatch(contract.INTERPRETATION_V8_INSTRUCTIONS, /Paraphrasing the chosen correct option without adding an element is limited/);
    assert.equal(contract.INTERPRETATION_V8_PROMPT_HASH.length, 64);
    assert.equal(contract.InterpretationOutputV8Schema.safeParse(good).success, true);
  });

  console.log(`\n${passed} interpretation v8 checks passed.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
