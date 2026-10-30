/**
 * Database-free checks for the research export of interpretation v8, feedback v8 turn
 * records, instructor item decisions and item administration v4
 * (docs/AI_MODULE_REDESIGN_2026-10-19.md, sections 4, 5, 6, 8 and 10). Every new file's rows
 * are built from synthetic records, and every new column must have a dictionary entry.
 * Run with:
 *
 *   npx tsx prisma/research-export-v8-unit-test.ts
 */
import assert from "node:assert/strict";
import { parse } from "csv-parse/sync";

process.env.DATABASE_URL ??= "postgresql://synthetic:synthetic@127.0.0.1:5432/research_export_v8_unit";
process.env.SESSION_SECRET ??= "research-export-v8-unit-test-session-secret-000000000";
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

type Output = import("../src/lib/services/student-assessment/interpretation-v8/contract").InterpretationOutputV8;
type FeedbackOutput = import("../src/lib/services/student-assessment/feedback-v8/contract").FeedbackV8Output;

async function main() {
  const { buildInterpretationInputV8FromPackage } = await import("../src/lib/services/student-assessment/interpretation-v8/input-builder");
  const { validateInterpretationOutputV8 } = await import("../src/lib/services/student-assessment/interpretation-v8/validate");
  const { buildStoredInterpretationV8, studentProfileDataV8 } = await import("../src/lib/services/student-assessment/interpretation-v8/profile");
  const { buildLocalTestInterpretationV8 } = await import("../src/lib/services/student-assessment/interpretation-v8/local-test");
  const { FEEDBACK_V8_CONTRACT_VERSION } = await import("../src/lib/services/student-assessment/feedback-v8/contract");
  const v8export = await import("../src/lib/services/teacher-research-data/interpretation-v8-export");
  const v8dictionary = await import("../src/lib/services/teacher-research-data/interpretation-v8-dictionary");
  const dictionary = await import("../src/lib/services/teacher-research-data/dictionary");
  const { researchInstructorId, researchStudentId, researchStudyCode, studyCodeFromResearchStudentId } = await import("../src/lib/services/teacher-research-data/pseudonymization");

  // Four items on one topic; the same items for every student (one mini-test).
  const spec = (id: string, key: string, distractors: Record<string, string>) => ({
    item_snapshot: {
      item_stem: `Question ${id} about the standard deviation`,
      options: [{ label: "A", text: "Set 1 varies more" }, { label: "B", text: "Both vary equally" }, { label: "C", text: "Set 2 varies more" }]
    },
    correct_option_snapshot: key,
    teacher_diagnostic_context: {
      teacher_diagnostic_context: { correct_option_notes: { target_reasoning_note: "Values further from the mean give a larger SD.", strong_reasoning_should_mention: "distance of values from the mean" } },
      distractor_rationales: distractors
    }
  });
  const response = (id: string, position: number, key: string, answer: string, reasoning: string, extra: Record<string, unknown> = {}) => ({
    item_public_id: id,
    initial_item_position: position,
    ...spec(id, key, key === "C" ? { A: "Confuses a larger mean with larger spread.", B: "Thinks equal ranges imply equal SD." } : { A: "Confuses a larger mean with larger spread.", C: "Thinks equal ranges imply equal SD." }),
    correctness: answer === key ? "correct" : "incorrect",
    selected_answer_initial: answer,
    selected_answer_final: answer,
    answer_changed: false,
    reasoning_text_initial: reasoning,
    reasoning_text_final: reasoning,
    confidence_initial: "medium",
    confidence_final: "medium",
    response_time_answer_ms: 25_000,
    ...extra
  });
  const packagePayload = (responses: unknown[]) => ({
    assessment: { title: "Variability", diagnostic_focus: "Spread versus centre" },
    concept_unit: { title: "Standard deviation", learning_objective: "Interpret the standard deviation as spread.", related_concept_description: "SD measures typical distance from the mean." },
    item_responses: responses
  });

  // Student A, first attempt: the reviewer's four items (supported; correct but limited; a
  // misconception; an execution slip with sound reasoning), plus a revised first item.
  const inputA = buildInterpretationInputV8FromPackage(packagePayload([
    response("q1", 1, "C", "C", "The values in set 2 are further from the mean so the spread is bigger", {
      selected_answer_initial: "B", answer_changed: true, reasoning_text_initial: "Both sets look about the same to me",
      confidence_initial: "low", response_time_answer_ms: 6_000
    }),
    response("q2", 2, "C", "C", "Because set 2 has more spread overall", { tempting_option: "B", tempting_option_reason: "I thought maybe the same range means the same SD" }),
    response("q3", 3, "C", "A", "A larger mean means the data are more spread out"),
    response("q4", 4, "B", "C", "Both sets sit the same distance from their means but I picked the wrong letter")
  ]), new Map());
  const outputA: Output = {
    items: [
      { item_id: "q1", explanation_quality: "adequate", no_usable_reason: null, adds_beyond_option_text: true,
        evidence_quote: "further from the mean so the spread is bigger", evidence_source: "explanation", reference_id: "q1:elements",
        missing_elements: null, rationale: "States that values further from the mean give more spread.", error_source: null,
        side_remark: null, uncertainty_note: null,
        process_interpretation: { type: "possible_revision_of_reasoning", indicator_ids: ["q1:answer_change"], content_quote: "further from the mean",
          content_source: "explanation", note: "The final explanation names distance from the mean after the answer moved to the key.", alternatives: ["reconsidering after more thought"] } },
      { item_id: "q2", explanation_quality: "limited", no_usable_reason: null, adds_beyond_option_text: true,
        evidence_quote: "set 2 has more spread overall", evidence_source: "explanation", reference_id: "q2:elements",
        missing_elements: "distance of values from the mean", rationale: "Names spread without distance from the mean.", error_source: null,
        side_remark: null, uncertainty_note: "Whether the idea of distance is implied is unclear.", process_interpretation: null },
      { item_id: "q3", explanation_quality: "incorrect", no_usable_reason: null, adds_beyond_option_text: true,
        evidence_quote: "A larger mean means the data are more spread out", evidence_source: "explanation", reference_id: "q3:target",
        missing_elements: null, rationale: "Treats a larger mean as larger spread.", error_source: "conceptual",
        side_remark: null, uncertainty_note: null, process_interpretation: null },
      { item_id: "q4", explanation_quality: "adequate", no_usable_reason: null, adds_beyond_option_text: true,
        evidence_quote: "Both sets sit the same distance from their means", evidence_source: "explanation", reference_id: "q4:elements",
        missing_elements: null, rationale: "States the correct rule; the chosen letter does not match it.", error_source: "execution_slip",
        side_remark: null, uncertainty_note: null, process_interpretation: null }
    ],
    possible_misconceptions: [{ item_ids: ["q3"], idea: "A larger mean means larger spread.", student_quote: "A larger mean means the data are more spread out",
      quote_item_id: "q3", quote_source: "explanation", endorsement: "endorsed", contradicts_reference_id: "q3:target",
      matching_distractor_reference_id: "q3:option:A", alternative_explanation: null }],
    considered_ideas: [{ item_id: "q2", idea: "Equal ranges imply equal SD.", student_quote: "the same range means the same SD",
      quote_source: "tempting_option_reason", contradicts_reference_id: "q2:option:B" }]
  };

  // Student B: the same items; q3's reading may be defensible (a possible item issue), and
  // leaving q3 out changes the label, so it is withheld as Pending item review.
  const inputB = buildInterpretationInputV8FromPackage(packagePayload([
    response("q1", 1, "C", "C", "Set 2 values are further from the mean"),
    response("q2", 2, "C", "C", "The values of set 2 lie further from the mean"),
    response("q3", 3, "C", "B", "The question says range so both sets look equally spread"),
    response("q4", 4, "B", "B", "They vary about the same so the spread is equal")
  ]), new Map());
  const outputB: Output = {
    items: [
      { item_id: "q1", explanation_quality: "adequate", no_usable_reason: null, adds_beyond_option_text: true, evidence_quote: "values are further from the mean",
        evidence_source: "explanation", reference_id: "q1:elements", missing_elements: null, rationale: "Names distance from the mean.", error_source: null,
        side_remark: null, uncertainty_note: null, process_interpretation: null },
      { item_id: "q2", explanation_quality: "adequate", no_usable_reason: null, adds_beyond_option_text: true, evidence_quote: "lie further from the mean",
        evidence_source: "explanation", reference_id: "q2:elements", missing_elements: null, rationale: "Names distance from the mean.", error_source: null,
        side_remark: null, uncertainty_note: null, process_interpretation: null },
      { item_id: "q3", explanation_quality: "incorrect", no_usable_reason: null, adds_beyond_option_text: true, evidence_quote: "The question says range so both",
        evidence_source: "explanation", reference_id: "q3:target", missing_elements: null, rationale: "Reads the stem's wording about range as the criterion.",
        error_source: "possible_item_issue", side_remark: null, uncertainty_note: "The stem's wording may support this reading.", process_interpretation: null },
      { item_id: "q4", explanation_quality: "limited", no_usable_reason: null, adds_beyond_option_text: true, evidence_quote: "They vary about the same",
        evidence_source: "explanation", reference_id: "q4:elements", missing_elements: "distance of values from the mean", rationale: "Names equal variation only.",
        error_source: null, side_remark: null, uncertainty_note: null, process_interpretation: null }
    ],
    possible_misconceptions: [],
    considered_ideas: []
  };

  await check("Synthetic outputs pass the application's own v8 checks", () => {
    assert.deepEqual(validateInterpretationOutputV8(inputA, outputA), []);
    assert.deepEqual(validateInterpretationOutputV8(inputB, outputB), []);
  });

  const attemptFirst = (session: string) => ({ attempt_context_version: "attempt-context-v1" as const, session_public_id: session, attempt_number: 1,
    role: "initial_diagnosis" as const, started_at: "2026-10-20T09:00:00.000Z", feedback_seen_before: [] });
  const storedA1 = buildStoredInterpretationV8({ model_input: inputA, output: outputA, generation_mode: "live_model", fallback_reason: null,
    response_package_id: "pkg-a1", answer_review_v2: null, attempt: attemptFirst("sess_a1") });
  const storedA2 = buildStoredInterpretationV8({ model_input: inputA, output: buildLocalTestInterpretationV8(inputA), generation_mode: "local_test",
    fallback_reason: null, response_package_id: "pkg-a2", answer_review_v2: null,
    attempt: { attempt_context_version: "attempt-context-v1", session_public_id: "sess_a2", attempt_number: 2, role: "after_feedback",
      started_at: "2026-10-21T09:00:00.000Z",
      feedback_seen_before: [{ session_public_id: "sess_a1", attempt_number: 1, submitted_at: "2026-10-20T09:20:00.000Z", answer_review_shown: true,
        opening_message_at: "2026-10-20T09:21:00.000Z", student_turns: 3, tutor_turns: 4, last_conversation_turn_at: "2026-10-20T09:40:00.000Z" }] } });
  const storedB = buildStoredInterpretationV8({ model_input: inputB, output: outputB, generation_mode: "live_model", fallback_reason: null,
    response_package_id: "pkg-b1", answer_review_v2: null, attempt: attemptFirst("sess_b1") });
  const storedFallback = buildStoredInterpretationV8({ model_input: inputB, output: null, generation_mode: "fallback",
    fallback_reason: "interpretation_v8_not_approved", response_package_id: "pkg-c1", answer_review_v2: null, attempt: attemptFirst("sess_c1") });

  const t = (iso: string) => new Date(iso);
  const items = ["q1", "q2", "q3", "q4"].map((id, index) => ({
    item_public_id: id, item_snapshot_public_id: `${id}:v2`, item_version: 2, item_order: 10 + index
  }));
  type Session = import("../src/lib/services/teacher-research-data/interpretation-v8-export").V8ExportSession;
  const baseSession = (id: string, student: string, attempt: number, profiles: Session["profiles"], extra: Partial<Session> = {}): Session => ({
    session_public_id: id, research_student_id: student, assessment_public_id: "asm_sd", attempt_number: attempt, family_attempt_number: attempt,
    items, profiles, profiling_calls: [], conversations: [], tutor_turns: [], feedback_calls: [], review_signals: [], ...extra
  });

  const legacyProfile = {
    profile_record_id: "profile_legacy0000000000000000", concept_unit_public_id: "cu_sd", created_at: t("2026-10-19T08:00:00.000Z"),
    item_level_evidence: [{ item_public_id: "q1", reasoning_quality: "partial" }], source_agent_call_public_id: "call_legacy"
  };
  const sessionA1 = baseSession("sess_a1", "rs_student_a", 1, [
    { profile_record_id: "profile_a1", concept_unit_public_id: "cu_sd", created_at: t("2026-10-20T09:20:00.000Z"), item_level_evidence: storedA1, source_agent_call_public_id: "call_profiling_a1" },
    legacyProfile
  ], {
    profiling_calls: [
      { agent_call_public_id: "call_profiling_a1_rejected", call_status: "invalid_output", output_validated: false, provider: "openai",
        prompt_version: "student-profiling-v8", schema_version: "student-interpretation-output-v8", input_payload: inputA, output_payload: { rejected_output: {}, issues: [] } },
      { agent_call_public_id: "call_profiling_a1", call_status: "succeeded", output_validated: true, provider: "openai",
        prompt_version: "student-profiling-v8", schema_version: "student-interpretation-output-v8", input_payload: { ...inputA, previous_attempt_rejected_for: [] }, output_payload: outputA }
    ],
    conversations: [{ conversation_public_id: "conv_a1", initial_item_level_evidence: storedA1 }],
    tutor_turns: [
      { conversation_public_id: "conv_a1", agent_call_public_id: "call_open_a1", turn_sequence_index: 40, conversation_local_turn_sequence_index: 1, created_at: t("2026-10-20T09:21:00.000Z") },
      { conversation_public_id: "conv_a1", agent_call_public_id: "call_reply_a1", turn_sequence_index: 42, conversation_local_turn_sequence_index: 3, created_at: t("2026-10-20T09:25:00.000Z") }
    ],
    feedback_calls: (() => {
      const opening: FeedbackOutput = { contract_version: FEEDBACK_V8_CONTRACT_VERSION, student_visible_message: "Your explanation for Question 3 treats the mean as spread.",
        focus: { item_numbers: [3], focus_type: "possible_misconception", concept: "Mean versus spread" }, strategy: "explain",
        student_evidence: [], focus_status: null, instructor_review: { flag: "none", reason: null } };
      const reply: FeedbackOutput = { contract_version: FEEDBACK_V8_CONTRACT_VERSION, student_visible_message: "Yes, the SD looks at distance from the mean.",
        focus: { item_numbers: [3, 4], focus_type: "single_item", concept: "Distance from the mean" }, strategy: "clarify",
        student_evidence: [{ quote: "so the mean does not tell me the spread", note: "States that the mean does not show spread." }],
        focus_status: "corrected_reasoning_expressed", instructor_review: { flag: "possible_item_issue", reason: "Question 4's options may read as equivalent." } };
      const call = (id: string, output: unknown, extra: Record<string, unknown> = {}) => ({
        agent_call_public_id: id, conversation_public_id: "conv_a1", call_status: "succeeded", output_validated: true, provider: "openai",
        model_name: "gpt-test", prompt_version: "formative-opening-v8+formative-conversation-v8", schema_version: FEEDBACK_V8_CONTRACT_VERSION,
        prompt_hash: "hash-feedback", output_payload: output, created_at: t("2026-10-20T09:21:00.000Z"), completed_at: t("2026-10-20T09:21:05.000Z"), ...extra
      });
      return [
        call("call_reply_a1", reply, { created_at: t("2026-10-20T09:25:00.000Z"), completed_at: t("2026-10-20T09:25:04.000Z") }),
        call("call_open_a1", opening),
        call("call_rejected_a1", reply, { output_validated: false, call_status: "invalid_output" }),
        call("call_legacy_a1", { anything: true }, { schema_version: "formative-conversation-agent-v18r2" })
      ];
    })(),
    review_signals: [{ signal_public_id: "sig_a1", conversation_public_id: "conv_a1", source_turn_sequence_index: 42, reason_code: "possible_item_issue", status: "open" }]
  });
  const sessionA2 = baseSession("sess_a2", "rs_student_a", 2, [
    { profile_record_id: "profile_a2", concept_unit_public_id: "cu_sd", created_at: t("2026-10-21T09:30:00.000Z"), item_level_evidence: storedA2, source_agent_call_public_id: "call_profiling_a2" }
  ], { profiling_calls: [{ agent_call_public_id: "call_profiling_a2", call_status: "succeeded", output_validated: true, provider: "mock",
    prompt_version: "student-profiling-v8", schema_version: "student-interpretation-output-v8", input_payload: inputA, output_payload: buildLocalTestInterpretationV8(inputA) }] });
  const sessionB = baseSession("sess_b1", "rs_student_b", 1, [
    { profile_record_id: "profile_b1", concept_unit_public_id: "cu_sd", created_at: t("2026-10-20T10:00:00.000Z"), item_level_evidence: storedB, source_agent_call_public_id: "call_profiling_b1" }
  ]);
  const sessionFallback = baseSession("sess_c1", "rs_student_c", 1, [
    { profile_record_id: "profile_c1", concept_unit_public_id: "cu_sd", created_at: t("2026-10-20T11:00:00.000Z"), item_level_evidence: storedFallback, source_agent_call_public_id: "call_blocked_c1" }
  ], { profiling_calls: [{ agent_call_public_id: "call_blocked_c1", call_status: "failed", output_validated: false, provider: "openai",
    prompt_version: "student-profiling-v8", schema_version: "student-interpretation-output-v8", input_payload: { blocked_before_provider_call: true }, output_payload: null }] });
  const legacySession = baseSession("sess_legacy", "rs_student_d", 1, [legacyProfile]);

  type DecisionRecord = import("../src/lib/services/teacher-research-data/interpretation-v8-export").ItemReviewDecisionRecord;
  const decisionRecords: DecisionRecord[] = [
    { decision_public_id: "ird_2", assessment_public_id: "asm_sd", item_public_id: "q3", item_version: 2, decision: "excluded", note: "Stem says range; ambiguous.",
      decided_at: t("2026-10-22T08:00:00.000Z"), superseded_at: null, research_instructor_id: "ri_x", research_pseudonym_version: "hmac_sha256_v1" },
    { decision_public_id: "ird_1", assessment_public_id: "asm_sd", item_public_id: "q3", item_version: 2, decision: "kept", note: null,
      decided_at: t("2026-10-21T08:00:00.000Z"), superseded_at: t("2026-10-22T08:00:00.000Z"), research_instructor_id: "ri_x", research_pseudonym_version: "hmac_sha256_v1" }
  ];
  const noDecisions = v8export.currentItemDecisions([]);
  const decisions = v8export.currentItemDecisions(decisionRecords);
  const keptOnly = v8export.currentItemDecisions([{ ...decisionRecords[1], superseded_at: null }]);

  await check("Item ratings: one row per student, attempt and item, with the export's item identity", () => {
    const rows = v8export.interpretationItemRatingRows(sessionA1, noDecisions, { include_restricted: true });
    assert.equal(rows.length, 4, "The legacy profile in the same session adds no rows");
    assert.deepEqual(rows.map((row) => [row.item_public_id, row.item_number, row.item_snapshot_public_id, row.item_order]),
      [["q1", 1, "q1:v2", 10], ["q2", 2, "q2:v2", 11], ["q3", 3, "q3:v2", 12], ["q4", 4, "q4:v2", 13]]);
    assert.deepEqual(rows.map((row) => row.item_status), ["supported", "partly_supported", "not_supported", "partly_supported"]);
    assert.deepEqual(rows.map((row) => row.answer_correct), [true, true, false, false]);
    const q3 = rows[2];
    assert.equal(q3.explanation_quality, "incorrect");
    assert.equal(q3.error_source, "conceptual");
    assert.equal(q3.reference_id, "q3:target");
    assert.equal(q3.evidence_quote, "A larger mean means the data are more spread out");
    assert.equal(rows[1].missing_elements, "distance of values from the mean");
    assert.equal(rows[3].error_source, "execution_slip");
    assert.equal(rows[0].attempt_role, "initial_diagnosis");
    assert.equal(rows[0].generation_mode, "live_model");
    assert.equal(rows[0].rules_version, "interpretation-rules-v8.1");
    assert.equal(rows[0].prompt_version, "student-profiling-v8.5");
    assert.equal(rows[0].schema_version, "student-interpretation-output-v8");
    assert.equal(rows[0].profile_record_id, "profile_a1");
    assert.equal(rows[0].item_counted_with_decisions, true);
    assert.equal(rows[0].instructor_item_decision, null);
    const defaults = v8export.interpretationItemRatingRows(sessionA1, noDecisions, { include_restricted: false });
    assert.ok(defaults.every((row) => !("answer_correct" in row)), "Correctness is restricted, like item_responses.correctness");
  });

  await check("Item ratings carry the instructor's current decision for each item", () => {
    const rows = v8export.interpretationItemRatingRows(sessionB, decisions, { include_restricted: false });
    const q3 = rows.find((row) => row.item_public_id === "q3")!;
    assert.equal(q3.item_review_flag, true);
    assert.equal(q3.item_status, "not_supported", "The model's flag never changes the status");
    assert.equal(q3.instructor_item_decision, "excluded");
    assert.equal(q3.instructor_item_decision_at, "2026-10-22T08:00:00.000Z");
    assert.equal(q3.item_counted_with_decisions, false);
    assert.equal(rows.find((row) => row.item_public_id === "q1")!.item_counted_with_decisions, true);
  });

  await check("A fallback profile keeps its items with blank ratings, statuses and no claims", () => {
    const rows = v8export.interpretationItemRatingRows(sessionFallback, noDecisions, { include_restricted: true });
    assert.equal(rows.length, 4);
    assert.ok(rows.every((row) => row.explanation_quality === null && row.item_status === null && row.evidence_quote === null));
    assert.ok(rows.every((row) => row.generation_mode === "fallback" && row.fallback_reason === "interpretation_v8_not_approved"));
    assert.deepEqual(rows.map((row) => row.answer_correct), [true, true, false, true], "Correctness is still recorded by the application");
    assert.deepEqual(v8export.interpretationClaimRows(sessionFallback), []);
    const [summary] = v8export.interpretationSummaryRows(sessionFallback, decisions);
    assert.equal(summary.stored_label, "Unavailable / insufficient evidence");
    assert.equal(summary.stored_reason, "no_valid_profile");
    assert.equal(summary.label_with_decisions, "Unavailable / insufficient evidence", "Decisions never give a fallback a label");
    assert.deepEqual(v8export.interpretationProcessAuditRows(sessionFallback), [], "A blocked call sent no indicators to any model");
  });

  await check("A legacy profile produces no v8 rows", () => {
    assert.deepEqual(v8export.interpretationItemRatingRows(legacySession, decisions, { include_restricted: true }), []);
    assert.deepEqual(v8export.interpretationClaimRows(legacySession), []);
    assert.deepEqual(v8export.interpretationSummaryRows(legacySession, decisions), []);
    assert.deepEqual(v8export.interpretationProcessAuditRows(legacySession), []);
    assert.deepEqual(v8export.feedbackTurnRecordRows(legacySession), []);
  });

  await check("Claims: one row per possible misconception or considered idea", () => {
    const rows = v8export.interpretationClaimRows(sessionA1);
    assert.equal(rows.length, 2);
    const [misconception, considered] = rows;
    assert.equal(misconception.claim_type, "possible_misconception");
    assert.equal(misconception.claim_id, "profile_a1:possible_misconception:1");
    assert.equal(misconception.claim_item_public_ids, "q3");
    assert.equal(misconception.claim_item_numbers, "3");
    assert.equal(misconception.endorsement, "endorsed");
    assert.equal(misconception.contradicts_reference_id, "q3:target");
    assert.equal(misconception.matching_distractor_reference_id, "q3:option:A");
    assert.equal(misconception.student_quote, "A larger mean means the data are more spread out");
    assert.equal(considered.claim_type, "considered_idea");
    assert.equal(considered.endorsement, null, "A considered idea is not endorsed");
    assert.equal(considered.quote_source, "tempting_option_reason");
    assert.equal(considered.quote_item_public_id, "q2");
    assert.equal(considered.contradicts_reference_id, "q2:option:B");
  });

  await check("Summaries: stored label, rule label, counts and the reviewer's example", () => {
    const [row] = v8export.interpretationSummaryRows(sessionA1, noDecisions);
    assert.equal(row.stored_label, "Still developing");
    assert.equal(row.stored_reason, "mixed");
    assert.equal(row.stored_rule_label, "Still developing");
    assert.equal(row.label_with_decisions, "Still developing");
    assert.deepEqual([row.administered_item_count, row.counted_item_count, row.interpretable_item_count], [4, 4, 4]);
    assert.deepEqual([row.supported_item_count, row.partly_supported_item_count, row.not_supported_item_count, row.not_interpretable_item_count], [1, 2, 1, 0]);
    assert.equal(row.possible_misconception_count, 1);
    assert.equal(row.considered_idea_count, 1);
    assert.equal(row.attempt_role, "initial_diagnosis");
    assert.equal(row.earlier_attempt_count, 0);
    assert.equal(row.answer_review_seen_before, false);
    assert.equal(row.feedback_seen_attempt_numbers, null);
    assert.equal(row.rules_version, "interpretation-rules-v8.1");
    assert.equal(row.indicators_version, "process-indicators-v1");
  });

  await check("Summaries: a flagged item withholds the label until the instructor decides", () => {
    const [stored] = v8export.interpretationSummaryRows(sessionB, noDecisions);
    assert.equal(stored.stored_label, "Pending item review");
    assert.equal(stored.stored_reason, "flagged_items_change_label");
    assert.equal(stored.stored_rule_label, "Still developing");
    assert.equal(stored.stored_label_without_pending, "Mostly understood");
    assert.equal(stored.stored_pending_review_item_ids, "q3");
    assert.equal(stored.label_with_decisions, "Pending item review");
    assert.equal(stored.pending_review_item_ids_with_decisions, "q3");

    const [excluded] = v8export.interpretationSummaryRows(sessionB, decisions);
    assert.equal(excluded.stored_label, "Pending item review", "The stored label never changes");
    assert.equal(excluded.label_with_decisions, "Mostly understood");
    assert.equal(excluded.excluded_item_ids_with_decisions, "q3");
    assert.equal(excluded.pending_review_item_ids_with_decisions, null);
    assert.equal(excluded.counted_item_count_with_decisions, 3);
    assert.equal(excluded.interpretable_item_count_with_decisions, 3);
    assert.equal(excluded.counted_item_count, 4);

    const [kept] = v8export.interpretationSummaryRows(sessionB, keptOnly);
    assert.equal(kept.label_with_decisions, "Still developing");
    assert.equal(kept.excluded_item_ids_with_decisions, null);

    const [otherStudent] = v8export.interpretationSummaryRows(sessionA1, decisions);
    assert.equal(otherStudent.excluded_item_ids_with_decisions, "q3", "A decision applies to every student who took the item");
    assert.equal(otherStudent.counted_item_count_with_decisions, 3);
  });

  await check("A later attempt records the feedback seen before it", () => {
    const [row] = v8export.interpretationSummaryRows(sessionA2, noDecisions);
    assert.equal(row.attempt_role, "after_feedback");
    assert.equal(row.attempt_number, 2);
    assert.equal(row.earlier_attempt_count, 1);
    assert.equal(row.feedback_seen_attempt_numbers, "1");
    assert.equal(row.answer_review_seen_before, true);
    assert.equal(row.opening_message_seen_before, true);
    assert.equal(row.student_turns_seen_before, 3);
    assert.equal(row.tutor_turns_seen_before, 4);
    assert.equal(JSON.parse(String(row.feedback_seen_before_json))[0].session_public_id, "sess_a1");
    assert.equal(row.generation_mode, "local_test");
    const ratings = v8export.interpretationItemRatingRows(sessionA2, noDecisions, { include_restricted: false });
    assert.ok(ratings.every((rating) => rating.attempt_role === "after_feedback" && rating.attempt_number === 2));
  });

  await check("Process audit: indicators sent to the model and its process interpretation, per item", () => {
    const rows = v8export.interpretationProcessAuditRows(sessionA1);
    assert.equal(rows.length, 4);
    const q1 = rows[0];
    assert.equal(q1.audience, "audit_only_never_shown");
    assert.equal(q1.profiling_agent_call_public_id, "call_profiling_a1", "The validated call the profile rests on, not the rejected draft");
    assert.equal(q1.indicator_rapid_selection, true, "6 s from display to first choice");
    assert.equal(q1.indicator_answer_change, "incorrect_to_correct");
    assert.equal(q1.indicator_explanation_revised, true);
    assert.equal(q1.indicator_confidence_change, "higher");
    assert.equal(q1.indicator_blocked_paste_attempts, 0);
    assert.equal(q1.indicator_longest_pause_seconds, 0);
    const indicators = JSON.parse(String(q1.process_indicators_json)) as Array<{ name: string; role: string; unit: string | null }>;
    assert.equal(indicators.length, 8);
    assert.deepEqual(indicators.find((entry) => entry.name === "focus_loss"), { indicator_id: "q1:focus_loss", name: "focus_loss", value: null, unit: "seconds", role: "context" });
    assert.equal(q1.process_interpretation_status, "present");
    assert.equal(q1.process_interpretation_type, "possible_revision_of_reasoning");
    assert.equal(q1.process_interpretation_indicator_ids, "q1:answer_change");
    assert.equal(q1.process_interpretation_content_quote, "further from the mean");
    assert.deepEqual(JSON.parse(String(q1.process_interpretation_alternatives)), ["reconsidering after more thought"]);
    assert.equal(rows[1].process_interpretation_status, "none");
    assert.equal(rows[1].indicator_rapid_selection, false);
    const local = v8export.interpretationProcessAuditRows(sessionA2);
    assert.ok(local.every((row) => row.profiling_provider === "mock" && row.process_interpretation_status === "none"));
    const rejectedOnly = { ...sessionA1, profiles: [{ ...sessionA1.profiles[0], source_agent_call_public_id: "call_profiling_a1_rejected" }] };
    assert.ok(v8export.interpretationProcessAuditRows(rejectedOnly).every((row) => row.process_interpretation_status === "no_validated_output" && row.process_interpretation_type === null),
      "A rejected draft's process interpretation is never presented as the model's interpretation");
  });

  await check("Study code: the short form of the research student ID", () => {
    const id = researchStudentId("Student_07");
    assert.match(researchStudyCode("Student_07"), /^[0-9A-F]{4}-[0-9A-F]{4}$/);
    assert.equal(researchStudyCode("student_07"), studyCodeFromResearchStudentId(id), "Same code as the exported research_student_id, whatever the case of the user ID");
    assert.equal(studyCodeFromResearchStudentId(id), `${id.slice(3, 7).toUpperCase()}-${id.slice(7, 11).toUpperCase()}`);
  });

  await check("Data for the research questions: rapid selection, counted items, generation record, feedback seen before", () => {
    // The rapid-selection value the status rule used is stored and exported with each item.
    const ratings = v8export.interpretationItemRatingRows(sessionA1, noDecisions, { include_restricted: false });
    const expectedRapid = inputA.items.map((item) => {
      const value = item.process_indicators.find((indicator) => indicator.name === "rapid_selection")?.value;
      return typeof value === "boolean" ? value : null;
    });
    assert.deepEqual(ratings.map((row) => row.rapid_selection), expectedRapid);
    // Items left unrated by salvage have no status and are not counted.
    const salvaged = buildStoredInterpretationV8({ model_input: inputA, output: { ...outputA, items: outputA.items.filter((item) => item.item_id !== "q2") },
      generation_mode: "live_model", fallback_reason: null, response_package_id: "pkg-s1", answer_review_v2: null, attempt: attemptFirst("sess_s1") });
    const salvagedRows = v8export.interpretationItemRatingRows(baseSession("sess_s1", "rs_student_s", 1, [
      { profile_record_id: "profile_s1", concept_unit_public_id: "cu_sd", created_at: t("2026-10-20T12:00:00.000Z"), item_level_evidence: salvaged, source_agent_call_public_id: null }
    ]), noDecisions, { include_restricted: false });
    const q2 = salvagedRows.find((row) => row.item_public_id === "q2")!;
    assert.equal(q2.rating_unavailable, true);
    assert.equal(q2.item_counted_with_decisions, false, "An unrated item is not counted in the summary");
    assert.ok(salvagedRows.filter((row) => row.item_public_id !== "q2").every((row) => row.item_counted_with_decisions === true));
    const fallbackRows = v8export.interpretationItemRatingRows(sessionFallback, noDecisions, { include_restricted: false });
    assert.ok(fallbackRows.every((row) => row.item_counted_with_decisions === false), "Fallback items are not counted");
    // Generation record (Table 3.2): one rejected output then a pass; a blocked call is a provider failure.
    const [a1] = v8export.interpretationSummaryRows(sessionA1, noDecisions);
    assert.equal(a1.profiling_call_count, 2);
    assert.equal(a1.profiling_output_rejected_count, 1);
    assert.equal(a1.profiling_provider_failure_count, 0);
    assert.equal(a1.first_output_passed, false);
    const [fallback] = v8export.interpretationSummaryRows(sessionFallback, noDecisions);
    assert.equal(fallback.profiling_provider_failure_count, 1);
    assert.equal(fallback.first_output_passed, null, "No passing output to judge for a fallback profile");
    const [b1] = v8export.interpretationSummaryRows(sessionB, noDecisions);
    assert.equal(b1.first_output_passed, true);
    // attempt-context-v2: feedback counts as seen only when it was recorded on screen.
    const storedV2 = buildStoredInterpretationV8({ model_input: inputA, output: buildLocalTestInterpretationV8(inputA), generation_mode: "local_test",
      fallback_reason: null, response_package_id: "pkg-a3", answer_review_v2: null,
      attempt: { attempt_context_version: "attempt-context-v2", session_public_id: "sess_a3", attempt_number: 3, role: "after_feedback",
        started_at: "2026-10-22T09:00:00.000Z",
        feedback_seen_before: [{ session_public_id: "sess_a1", attempt_number: 1, submitted_at: "2026-10-20T09:20:00.000Z", answer_review_shown: true,
          answer_review_displayed_at: "2026-10-20T09:20:02.000Z", opening_message_at: "2026-10-20T09:21:00.000Z", opening_message_displayed_at: null,
          student_turns: 0, tutor_turns: 1, last_conversation_turn_at: "2026-10-20T09:21:00.000Z" }] } });
    const [v2] = v8export.interpretationSummaryRows(baseSession("sess_a3", "rs_student_a", 3, [
      { profile_record_id: "profile_a3", concept_unit_public_id: "cu_sd", created_at: t("2026-10-22T09:30:00.000Z"), item_level_evidence: storedV2, source_agent_call_public_id: null }
    ]), noDecisions);
    assert.equal(v2.attempt_context_version, "attempt-context-v2");
    assert.equal(v2.answer_review_seen_before, true);
    assert.equal(v2.opening_message_seen_before, false, "An opening that was created but never displayed was not seen");
    assert.equal(v2.feedback_seen_attempt_numbers, "1");
    const [v1] = v8export.interpretationSummaryRows(sessionA2, noDecisions);
    assert.equal(v1.opening_message_seen_before, true, "attempt-context-v1 records keep their availability meaning");
  });

  await check("Feedback turn records: one row per validated opening or reply, linked to its turn", () => {
    const rows = v8export.feedbackTurnRecordRows(sessionA1);
    assert.equal(rows.length, 2, "Rejected and non-v8 calls are not turn records");
    const [opening, reply] = rows;
    assert.equal(opening.feedback_mode, "opening");
    assert.equal(opening.turn_sequence_index, 40);
    assert.equal(opening.focus_item_numbers, "3");
    assert.equal(opening.focus_item_public_ids, "q3");
    assert.equal(opening.focus_type, "possible_misconception");
    assert.equal(opening.strategy, "explain");
    assert.equal(opening.focus_status, null);
    assert.equal(opening.student_evidence_count, 0);
    assert.equal(opening.mode_prompt_version, "formative-opening-v8", "The prompt the call stored, not the current release");
    assert.equal(opening.review_signal_public_id, null);
    assert.equal(reply.feedback_mode, "reply");
    assert.equal(reply.turn_sequence_index, 42);
    assert.equal(reply.conversation_local_turn_sequence_index, 3);
    assert.equal(reply.focus_item_public_ids, "q3|q4");
    assert.equal(reply.focus_status, "corrected_reasoning_expressed");
    assert.deepEqual(JSON.parse(String(reply.student_evidence_quotes)), ["so the mean does not tell me the spread"]);
    assert.deepEqual(JSON.parse(String(reply.student_evidence_notes)), ["States that the mean does not show spread."]);
    assert.equal(reply.instructor_review_flag, "possible_item_issue");
    assert.equal(reply.instructor_review_reason, "Question 4's options may read as equivalent.");
    assert.equal(reply.review_signal_public_id, "sig_a1");
    assert.equal(reply.review_signal_status, "open");
    assert.equal(reply.mode_prompt_version, "formative-conversation-v8", "The prompt the call stored, not the current release");
    assert.equal(reply.prompt_hash, "hash-feedback");
    assert.ok(!("message_text" in reply) && !("student_visible_message" in reply), "The tutor text stays in formative_conversation_turns.csv");
  });

  await check("Item review decisions: one row per decision, superseded ones included", () => {
    const rows = v8export.itemReviewDecisionRows(decisionRecords);
    assert.deepEqual(rows.map((row) => [row.decision_public_id, row.decision, row.decision_current, row.superseded_at]),
      [["ird_1", "kept", false, "2026-10-22T08:00:00.000Z"], ["ird_2", "excluded", true, null]]);
    assert.equal(rows[1].note, "Stem says range; ambiguous.");
    assert.equal(rows[1].research_instructor_id, "ri_x");
    assert.equal(decisions.get("q3")?.decision, "excluded");
    const instructor = researchInstructorId("teacher_demo");
    assert.match(instructor, /^ri_[0-9a-f]{20}$/);
    assert.notEqual(instructor.slice(3), researchStudentId("teacher_demo").slice(3), "Separate namespace from student pseudonyms");
    assert.equal(instructor, researchInstructorId(" Teacher_Demo "), "Canonical identifier, like research_student_id");
  });

  await check("Session files: default exports omit correctness and the audit file; restricted exports include both", () => {
    const header = (data: string) => (parse(data, { to_line: 1 }) as string[][])[0];
    const rows = (data: string) => parse(data, { columns: true }) as Record<string, string>[];
    const defaults = v8export.interpretationV8SessionFiles(sessionA1, decisions, false);
    assert.deepEqual(defaults.map((file) => file.path), ["interpretation_item_ratings.csv", "interpretation_claims.csv", "interpretation_summaries.csv", "feedback_turn_records.csv", "interpretation_v8_notes.txt"]);
    const ratings = defaults[0];
    assert.deepEqual(header(ratings.data), v8dictionary.INTERPRETATION_ITEM_RATINGS_COLUMNS.filter((column) => column !== "answer_correct"));
    assert.equal(rows(ratings.data)[2].item_counted_with_decisions, "false");
    assert.equal(rows(ratings.data)[0].adds_beyond_option_text, "true");
    assert.deepEqual(header(defaults[1].data), [...v8dictionary.INTERPRETATION_CLAIMS_COLUMNS]);
    assert.deepEqual(header(defaults[2].data), [...v8dictionary.INTERPRETATION_SUMMARIES_COLUMNS]);
    assert.deepEqual(header(defaults[3].data), [...v8dictionary.FEEDBACK_TURN_RECORDS_COLUMNS]);
    const restricted = v8export.interpretationV8SessionFiles(sessionA1, decisions, true);
    assert.deepEqual(header(restricted[0].data), [...v8dictionary.INTERPRETATION_ITEM_RATINGS_COLUMNS]);
    const audit = restricted.find((file) => file.path === "interpretation_process_audit.csv")!;
    assert.deepEqual(header(audit.data), [...v8dictionary.INTERPRETATION_PROCESS_AUDIT_COLUMNS]);
    assert.equal(rows(audit.data).length, 4);
    const empty = v8export.interpretationV8SessionFiles(legacySession, decisions, true);
    assert.ok(empty.filter((file) => file.path.endsWith(".csv")).every((file) => rows(file.data).length === 0 && header(file.data).length > 0),
      "Sessions without v8 records still give each file its header");
    const decisionFile = v8export.itemReviewDecisionFile(decisionRecords);
    assert.deepEqual(header(decisionFile.data), [...v8dictionary.ITEM_REVIEW_DECISIONS_COLUMNS]);
    assert.ok(!/teacher_demo|@/.test(decisionFile.data), "No instructor username or email");
  });

  await check("Existing rows: legacy label columns blank for v8 profiles, unchanged for earlier ones; v8 label and rules version added", () => {
    const v8Data = studentProfileDataV8({ concept_unit_session_db_id: "unit", based_on_agent_call_db_id: "call", stored: storedB });
    const profileRow = {
      record_type: "profile_result", understanding_category: v8Data.integrated_diagnostic_profile, engagement_category: v8Data.engagement_profile,
      response_profile: v8Data.ability_profile, initial_profile_transfer_rule: "no_transfer_label", evidence_sufficiency: v8Data.evidence_sufficiency,
      profile_native_confidence_alignment: "insufficient_evidence", misconception_indicator_count: 0, misconception_claim_count: 0,
      item_level_evidence_count: null, item_level_evidence_available: false, item_level_evidence_format: "unavailable",
      profile_record_id: "profile_b1", uncertainty: "initial_profile"
    };
    const v8Row = v8export.withInterpretationV8ProfileColumns("agent_activity_records", profileRow, storedB, decisions);
    for (const column of v8dictionary.V8_BLANKED_LEGACY_COLUMNS.agent_activity_records) assert.equal(v8Row[column as keyof typeof v8Row], null, `${column} is blank for v8`);
    assert.equal(v8Row.profile_record_id, "profile_b1");
    assert.equal(v8Row.uncertainty, "initial_profile");
    assert.equal(v8Row.interpretation_profile_schema, "student-interpretation-profile-v8");
    assert.equal(v8Row.interpretation_summary_label, "Pending item review");
    assert.equal(v8Row.interpretation_summary_label_with_decisions, "Mostly understood");
    assert.equal(v8Row.interpretation_rules_version, "interpretation-rules-v8.1");
    assert.equal(v8Row.interpretation_generation_mode, "live_model");

    const legacyRow = { ...profileRow, understanding_category: "partial_understanding_with_misconception", response_profile: "partial_understanding", misconception_indicator_count: 2 };
    const unchanged = v8export.withInterpretationV8ProfileColumns("agent_activity_records", legacyRow, legacyProfile.item_level_evidence, decisions);
    assert.deepEqual({ ...unchanged }, { ...legacyRow, interpretation_profile_schema: null, interpretation_generation_mode: null,
      interpretation_summary_label: null, interpretation_summary_label_with_decisions: null, interpretation_rules_version: null });

    const session = v8export.withInterpretationV8ProfileColumns("sessions", { assessment_specific_understanding_category: "insufficient_evidence_for_formative_decision",
      engagement_review_category: "insufficient_process_evidence", evidence_sufficiency: "limited", understanding_label: "Pending item review" }, storedB, noDecisions);
    assert.equal(session.assessment_specific_understanding_category, null);
    assert.equal(session.engagement_review_category, null);
    assert.equal(session.evidence_sufficiency, null);
    assert.equal(session.understanding_label, "Pending item review", "The v8 understanding label is kept");
    const withUpdates = v8export.withInterpretationV8ProfileColumns("sessions", { conversation_update_summary_version: "conversation-update-summary-v1",
      conversation_profile_update: "No profile update", conversation_profile_update_count: 0 }, storedB, noDecisions);
    assert.equal(withUpdates.conversation_profile_update, null, "Conversation-update columns are legacy for v8 attempts");
    assert.equal(withUpdates.conversation_profile_update_count, null);
    assert.equal(withUpdates.conversation_update_summary_version, "conversation-update-summary-v1");
    assert.equal(session.interpretation_summary_label_with_decisions, "Pending item review");
    const conversation = v8export.withInterpretationV8ProfileColumns("formative_conversation_sessions",
      { initial_learning_profile: "insufficient_evidence_for_formative_decision", current_learning_profile: "insufficient_evidence_for_formative_decision",
        profile_reassessment_status: "reassessment_incomplete", profile_transition_count: 0, semantic_teacher_assistance_recommended: false, conversation_status: "active" }, storedA1, noDecisions);
    assert.equal(conversation.initial_learning_profile, null);
    assert.equal(conversation.current_learning_profile, null);
    assert.equal(conversation.profile_reassessment_status, null, "A v8 conversation never reassesses the profile");
    assert.equal(conversation.profile_transition_count, null);
    assert.equal(conversation.semantic_teacher_assistance_recommended, null, "Replaced by feedback_turn_records.instructor_review_flag");
    assert.equal(conversation.conversation_status, "active");
    assert.equal(conversation.interpretation_summary_label, "Still developing");
  });

  await check("Item administration v4: collection decisions counted; earlier records not misread", () => {
    const v4 = (action: string, extra: Record<string, unknown> = {}) => ({ event_type: "response_quality_checked", payload: {
      item_administration_tutor: { tutor_version: "item-administration-tutor-v4", message_classification: action === "accept" ? "accepted_response" : action === "redirect" ? "off_task_or_unreadable" : "incomplete",
        response_quality: "not_judged", collection_action: action, collection_model_action: action, collection_decision_source: "model",
        collection_application_override: "none", collection_fallback_used: false, deferred_concern_summary: null, ...extra }, response_quality: action === "accept" ? "collected" : "incomplete" } });
    const fields = v8export.itemAdministrationV4Fields([
      v4("redirect"), v4("clarify_once"), v4("accept", { collection_decision_source: "application_rule", collection_application_override: "clarification_already_used", collection_model_action: "clarify_once" }),
      v4("defer_question", { deferred_concern_summary: "What is variance?" }), v4("accept", { collection_decision_source: "deterministic_rules", collection_fallback_used: true, collection_model_action: null }),
      v4("procedural_help"), { event_type: "reasoning_submitted", payload: { collection_action: "accept" } }
    ]);
    assert.equal(fields.v4_only, true);
    assert.deepEqual(fields.columns, {
      item_admin_tutor_versions: "item-administration-tutor-v4", item_admin_v4_decision_count: 6, item_admin_v4_accept_count: 2,
      item_admin_v4_clarify_count: 1, item_admin_v4_deferred_question_count: 1, item_admin_v4_procedural_help_count: 1, item_admin_v4_redirect_count: 1,
      item_admin_v4_model_decision_count: 4, item_admin_v4_fallback_count: 1, item_admin_v4_application_override_count: 1, item_admin_v4_saved_question_count: 1
    });
    const v3 = v8export.itemAdministrationV4Fields([{ event_type: "response_quality_checked", payload: { item_administration_tutor: { tutor_version: "item-administration-tutor-v3", message_classification: "usable_reasoning", response_quality: "adequate" } } }]);
    assert.equal(v3.v4_only, false);
    assert.equal(v3.columns.item_admin_tutor_versions, "item-administration-tutor-v3");
    assert.equal(v3.columns.item_admin_v4_decision_count, null, "Blank, not zero, for records before v4");
    const mixed = v8export.itemAdministrationV4Fields([v3Event(), v4("accept")]);
    assert.equal(mixed.v4_only, false, "An attempt that continued across the update keeps its v3 judgments");
    assert.equal(mixed.columns.item_admin_tutor_versions, "item-administration-tutor-v3|item-administration-tutor-v4");
    assert.equal(v8export.itemAdministrationV4Fields([]).columns.item_admin_tutor_versions, null);
    function v3Event() { return { event_type: "response_quality_checked", payload: { item_administration_tutor: { tutor_version: "item-administration-tutor-v3" } } }; }
  });

  const entries = dictionary.buildAnalysisReadyDictionaryEntries();
  const byName = new Map(entries.map((entry) => [entry.qualified_name, entry]));
  const placeholders = ["Captured Prisma field", "exported from", "Read from the", "value associated with", "timestamp associated with", "Derived automatically",
    "System generated", "Serialized by", "Derived by the export service", "research-export field documented at", "measured value for the", "aggregate count for the"];

  await check("Every new column has a specific data dictionary definition", () => {
    const tables = Object.entries(v8dictionary.INTERPRETATION_V8_TABLE_COLUMNS);
    assert.equal(tables.length, 6);
    for (const [table, columns] of tables) {
      assert.ok((dictionary.RESEARCH_DATASET_TABLES as readonly string[]).includes(table), `${table} is a documented dataset`);
      for (const column of columns) {
        const entry = byName.get(`${table}.${column}`);
        assert.ok(entry, `${table}.${column} lacks a dictionary entry`);
        assert.ok(entry.definition.length > 30, `${table}.${column} needs a substantive definition`);
        assert.ok(!placeholders.some((fragment) => entry.definition.includes(fragment) || entry.collection_or_generation_method.includes(fragment)), `${table}.${column} uses placeholder text`);
        assert.ok(entry.collection_or_generation_method.length > 40, `${table}.${column} needs a substantive method`);
        assert.notEqual(entry.measurement_level, "not_applicable", `${table}.${column} needs a row grain`);
        assert.match(entry.source_code_reference, /interpretation-v8-export\.ts|pseudonymization\.ts/);
        if (entry.source_nature === "persisted_llm_interpretation") {
          assert.match(entry.interpretation_caution, /not a stable trait/);
          assert.ok(entry.generating_agent, `${table}.${column} names its generating agent`);
        }
      }
    }
    for (const [table, columns] of [["sessions", v8dictionary.INTERPRETATION_V8_PROFILE_COLUMNS], ["assessment_summary", v8dictionary.INTERPRETATION_V8_PROFILE_COLUMNS],
      ["agent_activity_records", v8dictionary.INTERPRETATION_V8_PROFILE_COLUMNS], ["item_responses", v8dictionary.ITEM_ADMINISTRATION_V4_COLUMNS]] as const) {
      for (const column of columns) {
        const entry = byName.get(`${table}.${column}`);
        assert.ok(entry, `${table}.${column} lacks a dictionary entry`);
        assert.equal(entry.definition, v8dictionary.interpretationV8ColumnDoc(table, column)?.definition);
      }
    }
    assert.equal(byName.get("agent_activity_records.interpretation_summary_label")?.applicable_record_types, "profile_result");
    for (const column of v8dictionary.INTERPRETATION_V8_PROFILE_COLUMNS) {
      assert.ok(v8dictionary.interpretationV8ColumnDoc("formative_conversation_sessions", column), `formative_conversation_data_dictionary.csv documents ${column}`);
    }
  });

  await check("The dictionary says which legacy columns are blank for v8 and how v4 records read", () => {
    for (const [table, columns] of Object.entries(v8dictionary.V8_BLANKED_LEGACY_COLUMNS)) {
      for (const column of columns) {
        const note = v8dictionary.interpretationV8LegacyNote(table, column);
        assert.match(note ?? "", /^Blank for (interpretation v8 profiles|attempts whose mini-test profile (at submission )?came from interpretation v8|attempts whose mini-test profile comes from interpretation v8)/);
        if (table !== "formative_conversation_sessions") assert.ok(byName.get(`${table}.${column}`)?.definition.endsWith(note!), `${table}.${column}`);
      }
    }
    assert.match(byName.get("item_responses.ai_flagged_insufficient_knowledge")!.definition, /Blank \(not false\).*v4/);
    assert.match(byName.get("item_responses.insufficient_knowledge_count")!.definition, /v4/);
    assert.match(byName.get("item_responses.response_quality_rejection_count")!.definition, /not low-quality reasoning/);
    assert.equal(byName.get("interpretation_item_ratings.answer_correct")!.export_policy, "restricted_research_dataset_only");
    assert.ok(entries.filter((entry) => entry.table_name === "interpretation_process_audit").every((entry) =>
      entry.export_policy === "restricted_research_dataset_only" && /never shown to instructors or students/.test(entry.audience)));
  });

  await check("The dictionary and notes carry the rating definitions, rules, boundaries, attempts and audit-only records", () => {
    const quality = byName.get("interpretation_item_ratings.explanation_quality")!;
    assert.equal(quality.allowed_values, "adequate; limited; incorrect; no_usable_explanation");
    assert.match(quality.definition, /the key reason is stated or clearly implied/);
    assert.match(quality.definition, /not a checklist/);
    assert.match(quality.definition, /paraphrasing a chosen incorrect option is incorrect/);
    assert.match(byName.get("interpretation_item_ratings.item_status")!.definition, /rapid selection/);
    const label = byName.get("interpretation_summaries.stored_label")!;
    assert.match(label.definition, /exactly half interpretable is enough/);
    assert.match(label.definition, /supported items exactly half of the counted items is not Mostly understood/);
    assert.match(label.definition, /one-item mini-test never gets a label/);
    assert.match(byName.get("interpretation_summaries.feedback_seen_before_json")!.definition, /never merged/);
    assert.match(byName.get("interpretation_process_audit.process_indicators_json")!.definition, /never shown to instructors or students/);
    assert.match(byName.get("interpretation_process_audit.indicator_rapid_selection")!.definition, /Role qualifies_evidence/);
    const pause = byName.get("interpretation_process_audit.indicator_longest_pause_seconds")!;
    assert.equal(pause.substantive_category, "Timing and interaction data");
    assert.ok(pause.timing_start_event && pause.timing_end_event && pause.calculation_formula && pause.idle_time_handling && pause.page_hidden_handling);
    const notes = v8dictionary.interpretationV8NotesText();
    for (const text of Object.values(v8dictionary.INTERPRETATION_V8_RULE_TEXT)) assert.ok(notes.includes(text));
    assert.match(notes, /Possible misconception \(section 5\)/);
    const report = dictionary.researchDataDictionarySemanticReport();
    assert.deepEqual(report.undocumented_exported_columns, []);
    assert.deepEqual(report.formula_reference_issues, []);
    assert.equal(report.placeholder_research_definitions, 0);
    assert.equal(report.timing_variables_missing_formula, 0);
  });

  // Research export fixes (time to first answer, item process columns, answer review text,
  // reference notes, shared page-visibility counts).
  const timing = await import("../src/lib/services/student-assessment/timing-contract");
  const indicators = await import("../src/lib/services/student-assessment/interpretation-v8/indicators");
  const columns = await import("../src/lib/services/teacher-research-data/item-research-columns");
  const { buildEngagementProcessFeatureRows } = await import("../src/lib/services/teacher-review/engagement-process-features");
  const { randomUUID } = await import("node:crypto");
  const tab = randomUUID();
  const answerVisit = (submittedAtMs: number) => {
    const id = randomUUID();
    const submission = randomUUID();
    const steps: Array<[string, number]> = [["ready", 0], ["submitted", submittedAtMs], ["request_finished", submittedAtMs + 200],
      ["controls_ready", submittedAtMs + 300], ["closed", submittedAtMs + 301]];
    return [
      ...steps.map(([kind, ms], index) => ({
        event_type: "response_stage_observation", event_source: "frontend", item_public_id: "q1",
        payload: { observation_version: "response-stage-observation-v1", stage_visit_id: id, response_stage: "answer", response_phase: "initial",
          observation_kind: kind, monotonic_ms: ms, observation_sequence: index + 1, client_event_id: randomUUID(), browser_tab_id: tab,
          client_occurred_at: new Date(1_800_000_000_000 + ms).toISOString(),
          ...(["submitted", "request_finished", "controls_ready"].includes(kind) ? { submission_id: submission } : {}),
          ...(kind === "request_finished" ? { result: "response_received" } : {}) } as Record<string, unknown>
      })),
      { event_type: "response_stage_outcome", event_source: "backend", item_public_id: "q1",
        payload: { stage_visit_id: id, submission_id: submission, accepted: true, validation_rejected: false } as Record<string, unknown> }
    ];
  };
  const indicatorResponse = (ms: number | null) => ({ item_public_id: "q1", selected_answer_initial: "C", selected_answer_final: "C", answer_changed: false,
    correct_option: "C", reasoning_text_initial: null, reasoning_text_final: null, confidence_initial: null, confidence_final: null, response_time_answer_ms: ms });
  const at = (seconds: number) => new Date(Date.UTC(2026, 9, 20, 10, 0, seconds)).toISOString();

  await check("Time to first answer is the value and source interpretation v8's rapid-selection indicator reads", () => {
    const cases: Array<[ReturnType<typeof answerVisit>, number | null, number | null, string]> = [
      [answerVisit(6_000), 25_000, 6_000, "browser"],
      [[], 9_000, 9_000, "server_package"],
      [[], 12_000, 12_000, "server_package"],
      [[], null, null, "none"]
    ];
    for (const [events, packageMs, expected, source] of cases) {
      const result = timing.firstOptionSelectionTiming(events, packageMs);
      assert.deepEqual(result, { time_to_first_option_selection_ms: expected, time_to_first_option_selection_source: source });
      assert.equal(result.time_to_first_option_selection_ms, indicators.timeToFirstChoiceMs(indicatorResponse(packageMs), events));
      const rapid = indicators.computeProcessIndicators(indicatorResponse(packageMs), events).find((entry) => entry.name === "rapid_selection")!.value;
      assert.equal(rapid, expected === null ? null : expected < 10_000, "Below 10 000 ms is rapid selection");
    }
    // Merge: a browser record without an answer stage keeps the server-derived values.
    const serverEvents = [
      { event_type: "item_presented", occurred_at: at(0) },
      { event_type: "option_selected", occurred_at: at(7) },
      ...answerVisit(4_000).map((event) => ({ ...event, payload: { ...event.payload, response_stage: "reasoning" } }))
    ];
    const merged = timing.deriveItemTiming({ events: serverEvents, item_submitted_at: new Date(at(30)) });
    assert.equal(merged.time_to_first_option_selection_ms, 7_000, "A null browser value no longer blanks the server value");
    assert.equal(merged.item_submitted_at?.toISOString(), at(30));
    assert.equal(merged.timing_contract_version, "timing-contract-v4", "Browser values still win where recorded");
  });

  await check("Page visibility: one shared count of page exits, blur apart, paired hidden time", () => {
    // One tab switch: hidden (after 50 s visible), blur, then 10 s later visible and focus.
    const tabSwitch = [
      { event_type: "page_visibility_hidden", occurred_at: at(50), visibility_duration_ms: 50_000 },
      { event_type: "window_blur", occurred_at: at(50) },
      { event_type: "page_visibility_visible", occurred_at: at(60) },
      { event_type: "window_focus", occurred_at: at(60) }
    ];
    assert.deepEqual(timing.summarizePageVisibility(tabSwitch), { hidden_count: 1, blur_count: 1, hidden_time_ms: 10_000 });
    const legacy = [{ event_type: "page_hidden", occurred_at: at(1) }, { event_type: "page_visible", occurred_at: at(4) }];
    assert.deepEqual(timing.summarizePageVisibility(legacy), { hidden_count: 1, blur_count: 0, hidden_time_ms: 3_000 });
    assert.deepEqual(timing.summarizePageVisibility([{ event_type: "page_visibility_hidden", occurred_at: at(1) }]),
      { hidden_count: 1, blur_count: 0, hidden_time_ms: null }, "No recorded return: time away unknown");
    assert.deepEqual(timing.summarizePageVisibility([{ event_type: "window_blur", occurred_at: at(1) }]), { hidden_count: 0, blur_count: 1, hidden_time_ms: 0 });
    // Focus-adjusted time removes the 10 s away, not the 50 s the page was visible before.
    const base = { session_public_id: "s", concept_unit_public_id: null, item_public_id: "q1", item_order: 1, event_category: "student_process",
      event_source: "frontend", pause_duration_ms: null, payload: {}, created_at: null };
    const [row] = buildEngagementProcessFeatureRows({
      itemResponses: [{ session_public_id: "s", student_user_id: "u", assessment_public_id: "a", concept_unit_public_id: null, item_public_id: "q1",
        item_order: 1, item_started_at: at(0), item_submitted_at: at(120), item_response_time_ms: null, revision_count: 0 }],
      processEvents: [{ ...base, event_type: "item_presented", visibility_duration_ms: null, occurred_at: at(0) },
        ...tabSwitch.map((event) => ({ ...base, event_type: event.event_type, occurred_at: event.occurred_at, visibility_duration_ms: event.visibility_duration_ms ?? null })),
        { ...base, event_type: "item_submitted", visibility_duration_ms: null, occurred_at: at(120) }]
    });
    assert.equal(row.focus_adjusted_time_ms, 110_000);
  });

  await check("Item process columns: blocked pastes, longest pause, explanation lengths in Unicode characters", () => {
    const events = [
      { event_type: "paste_detected", payload: { paste_blocked: true } },
      { event_type: "paste_detected", payload: { paste_blocked: false } },
      { event_type: "long_pause", pause_duration_ms: 121_000 },
      { event_type: "inactivity_detected", pause_duration_ms: 301_500 }
    ];
    const chinese = "信度不等于效度，因为分数稳定";
    const result = columns.itemProcessColumns({ events, first_explanation: "  信度不等于效度  ", final_explanation: chinese });
    assert.equal(result.blocked_paste_count, 1);
    assert.equal(result.longest_pause_ms, 301_500);
    assert.equal(result.first_explanation_length_chars, 7);
    assert.equal(result.final_explanation_length_chars, 14);
    assert.ok(result.final_explanation_word_count! > 3, "Chinese text is split into words, not counted as one");
    assert.equal(columns.textWordCount("Values further from the mean, 2 sets."), 7);
    assert.equal(columns.textLengthChars("SD 😀"), 4, "Code points, not UTF-16 units");
    assert.deepEqual(columns.itemProcessColumns({ events: [], first_explanation: null, final_explanation: null }), { blocked_paste_count: 0,
      longest_pause_ms: 0, first_explanation_length_chars: null, final_explanation_length_chars: null, final_explanation_word_count: null });
    const v8 = indicators.computeProcessIndicators(indicatorResponse(null), events);
    assert.equal(v8.find((entry) => entry.name === "blocked_paste_attempts")!.value, result.blocked_paste_count);
    assert.equal(v8.find((entry) => entry.name === "longest_pause")!.value, Math.round(result.longest_pause_ms / 1000));
  });

  await check("Reference notes and answer review text come from the sealed package item, as the model received them", () => {
    const item = {
      ...response("q9", 1, "C", "A", "A larger mean"),
      item_snapshot: { item_stem: "Which set varies more?", options: [{ label: "A", text: "Set 1" }, { label: "B", text: "Both" }, { label: "C", text: "Set 2" }, { label: "D", text: "Neither" }] },
      teacher_diagnostic_context: {
        teacher_diagnostic_context: {
          correct_option_notes: { target_reasoning_note: "Values further from the mean give a larger SD.", strong_reasoning_should_mention: "1) distance from the mean\n2) applies to every value" },
          option_notes: [{ label: "A", idea_label: "mean = spread" }, { label: "B", why_tempting: "Equal ranges look alike." }]
        },
        distractor_rationales: { A: "Confuses a larger mean with larger spread." }
      },
      student_safe_answer_explanation: "Set 2's values lie further from its mean."
    };
    const notes = columns.itemReferenceColumns(item, "q9");
    assert.equal(notes.target_reasoning_note, "Values further from the mean give a larger SD.");
    assert.equal(notes.essential_elements, "distance from the mean|applies to every value");
    const options = JSON.parse(notes.option_rationales_json!) as Array<{ label: string; reference_id: string | null; rationale: string | null; idea_label: string | null }>;
    assert.deepEqual(options, [
      { label: "A", reference_id: "q9:option:A", rationale: "Confuses a larger mean with larger spread.", idea_label: "mean = spread", not_tied_to_an_idea: false, what_rules_it_out: null },
      { label: "B", reference_id: "q9:option:B", rationale: "Equal ranges look alike.", idea_label: null, not_tied_to_an_idea: false, what_rules_it_out: null },
      { label: "D", reference_id: null, rationale: null, idea_label: null, not_tied_to_an_idea: false, what_rules_it_out: null }
    ]);
    const modelInput = buildInterpretationInputV8FromPackage(packagePayload([item]), new Map()).items[0];
    const exported = new Map<string, string | null>([["q9:target", notes.target_reasoning_note],
      ...options.flatMap((entry): Array<[string, string | null]> => entry.reference_id ? [[entry.reference_id, entry.rationale]] : [])]);
    assert.equal(modelInput.essential_elements, "1) distance from the mean\n2) applies to every value");
    for (const reference of modelInput.references.filter((entry) => entry.kind !== "essential_elements")) {
      assert.equal(exported.get(reference.reference_id), reference.text, `${reference.reference_id} resolves to the text the model received`);
    }
    assert.equal(columns.answerReviewExplanation(item), "Set 2's values lie further from its mean.");
    assert.deepEqual(columns.itemReferenceColumns(undefined, "q9"), { target_reasoning_note: null, essential_elements: null, option_rationales_json: null });
  });

  await check("Dictionary: new columns, restricted notes, one page-hidden definition and the 10-second rule", () => {
    for (const column of ["time_to_first_option_selection_source", "blocked_paste_count", "longest_pause_ms", "first_explanation_length_chars",
      "final_explanation_length_chars", "final_explanation_word_count", "answer_review_explanation"]) {
      assert.ok((dictionary.ITEM_RESPONSES_COLUMNS as readonly string[]).includes(column), column);
      assert.ok(byName.get(`item_responses.${column}`)!.definition.length > 60, column);
    }
    for (const column of ["target_reasoning_note", "essential_elements", "option_rationales_json", "topic_learning_objective", "topic_description"]) {
      assert.ok((dictionary.ASSESSMENT_CONTENT_COLUMNS as readonly string[]).includes(column), column);
    }
    assert.ok(!(dictionary.ASSESSMENT_CONTENT_COLUMNS as readonly string[]).includes("strong_reasoning_note"));
    for (const name of ["item_responses.answer_review_explanation", "assessment_content.target_reasoning_note", "assessment_content.essential_elements",
      "assessment_content.option_rationales_json"]) {
      assert.equal(byName.get(name)!.export_policy, "restricted_research_dataset_only", name);
    }
    assert.equal(byName.get("assessment_content.topic_learning_objective")!.export_policy, "research_dataset");
    const first = byName.get("item_responses.time_to_first_option_selection_ms")!;
    assert.match(first.definition, /10 seconds/);
    assert.match(first.calculation_formula, /response_time_answer_ms/);
    assert.equal(byName.get("item_responses.time_to_first_option_selection_source")!.allowed_values, "browser; server_package; none");
    const hidden = byName.get("item_responses.page_hidden_count")!;
    for (const text of [hidden.definition, hidden.calculation_formula, hidden.collection_or_generation_method]) {
      assert.match(text, /window_blur/, text);
      assert.doesNotMatch(text, /window_blur (process )?events? (are|is) counted|page_visibility_hidden, and window_blur/, text);
    }
    assert.match(byName.get("item_responses.longest_pause_ms")!.definition, /cluster just above 120000 and 300000 ms/);
    assert.equal(byName.get("item_responses.final_explanation_length_chars")!.data_type, "integer");
    for (const name of ["interpretation_item_ratings.reference_id", "interpretation_claims.contradicts_reference_id", "interpretation_claims.matching_distractor_reference_id"]) {
      assert.match(byName.get(name)!.definition, /option_rationales_json entry with that reference_id/, name);
    }
  });

  console.log(`\n${passed} research export v8 checks passed.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
