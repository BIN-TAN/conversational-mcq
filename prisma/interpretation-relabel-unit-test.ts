/**
 * Release 27: one-time reinterpretation of earlier attempts under updated interpretation rules.
 * Pure checks (no database or provider calls): which attempts need it, which profile views and
 * exports read, how a reinterpretation is recorded in the research files, and the prompt rule.
 * Run with: npx tsx prisma/interpretation-relabel-unit-test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

async function main() {
  const contract = await import("../src/lib/services/student-assessment/interpretation-v8/contract");
  const profile = await import("../src/lib/services/student-assessment/interpretation-v8/profile");
  const record = await import("../src/lib/services/student-assessment/profile-record");
  const service = await import("../src/lib/services/interpretation-relabel/service");
  const itemReview = await import("../src/lib/services/item-review/service");
  const exportV8 = await import("../src/lib/services/teacher-research-data/interpretation-v8-export");
  const dictionary = await import("../src/lib/services/teacher-research-data/interpretation-v8-dictionary");
  const calls = await import("../src/lib/services/interpretation-relabel/calls");
  const audit = await import("../src/lib/services/teacher-research-data/ai-call-audit-export");
  let passed = 0;
  const check = async (name: string, run: () => void | Promise<void>) => {
    await run();
    passed += 1;
    console.log(`ok - ${name}`);
  };

  const stored = (promptVersion: string, extra: Record<string, unknown> = {}) => ({
    profile_schema: "student-interpretation-profile-v8",
    prompt_version: promptVersion,
    schema_version: "student-interpretation-output-v8",
    rules_version: "interpretation-rules-v8.1",
    indicators_version: "x",
    generation_mode: "live_model",
    fallback_reason: null,
    response_package_id: "pkg-1",
    attempt: null,
    items: [{ item_id: "i1", position: 1, selected_option: "A", answer_correct: true, reported_confidence: "high", explanation_quality: "adequate",
      no_usable_reason: null, adds_beyond_option_text: true, evidence_quote: "the key reason", evidence_source: "explanation", reference_id: null,
      missing_elements: null, rationale: "r", error_source: null, side_remark: null, uncertainty_note: null, status: "supported", item_review_flag: false }],
    possible_misconceptions: [],
    considered_ideas: [],
    answer_patterns: [],
    topic_summary: { label: "Mostly understood", reason: "supported_majority_none_unsupported", rule_label: "Mostly understood",
      rule_reason: "supported_majority_none_unsupported", label_without_pending: null, administered_items: 1, excluded_item_ids: [],
      pending_review_item_ids: [], based_on: { interpretable_items: 1, administered_items: 1 }, counted_items: 1, interpretable_items: 1, supported: 1, partly_supported: 0, not_supported: 0, not_interpretable: 0 },
    answer_review_v2: null,
    ...extra
  });
  const relabelMeta = { relabel_version: "interpretation-relabel-v1", reason: "rules update", reinterpreted_at: "2026-10-30T20:00:00Z",
    previous_profile_record_id: null, previous_label: "Still developing", previous_interpretation_version: "earlier" };

  await check("The rating rule asks for the key reason, not every essential element (student-profiling-v8.4)", () => {
    assert.equal(contract.INTERPRETATION_V8_PROMPT_VERSION, "student-profiling-v8.4");
    assert.match(contract.INTERPRETATION_V8_INSTRUCTIONS, /Judge whether each explanation gives the key reason/);
    assert.match(contract.INTERPRETATION_V8_INSTRUCTIONS, /they describe a strong explanation and are not a checklist/);
    assert.match(contract.INTERPRETATION_V8_INSTRUCTIONS, /- adequate: the key reason is stated or clearly implied/);
    assert.match(contract.INTERPRETATION_V8_INSTRUCTIONS, /An overstatement or extra claim beside a correct key reason is not incorrect: record it as the side remark\./);
    assert.doesNotMatch(contract.INTERPRETATION_V8_INSTRUCTIONS, /every essential element is stated/);
    const doc = readFileSync("docs/AI_MODULE_REDESIGN_2026-10-19.md", "utf8");
    assert.ok(doc.includes(contract.INTERPRETATION_V8_INSTRUCTIONS), "Section 9.4 carries the prompt verbatim");
  });

  await check("Only attempts not yet interpreted under the current rules need it; a ready preview is not redone", () => {
    const current = stored(contract.INTERPRETATION_V8_PROMPT_VERSION);
    assert.equal(service.relabelUnitState({ record_evidence: current, pending_evidence: null }), "current");
    assert.equal(service.relabelUnitState({ record_evidence: stored("student-profiling-v8.3"), pending_evidence: null }), "to_do");
    assert.equal(service.relabelUnitState({ record_evidence: { evidence_integrated_profile_v2: {} }, pending_evidence: null }), "to_do",
      "A profile from before interpretation v8 is interpreted again");
    assert.equal(service.relabelUnitState({ record_evidence: stored(contract.INTERPRETATION_V8_PROMPT_VERSION, { generation_mode: "fallback" }), pending_evidence: null }),
      "to_do", "A fallback under the current rules is tried again");
    assert.equal(service.relabelUnitState({ record_evidence: stored("student-profiling-v8.3"), pending_evidence: current }), "preview_ready");
    assert.equal(service.relabelUnitState({ record_evidence: null, pending_evidence: null }), "not_ready",
      "An attempt whose interpretation is still being prepared is left to the preparation");
    assert.equal(service.relabelUnitState({ record_evidence: undefined, pending_evidence: current }), "not_ready");
  });

  await check("A reinterpretation not applied is never read; an applied one replaces the original in item review", () => {
    const relabeled = { id: "p-relabel", item_level_evidence: stored(contract.INTERPRETATION_V8_PROMPT_VERSION, { relabel: relabelMeta }) };
    const original = { id: "p-original", item_level_evidence: stored("student-profiling-v8.3") };
    assert.equal(profile.isUnappliedReinterpretation(relabeled, null), true);
    assert.equal(profile.isUnappliedReinterpretation(relabeled, "p-relabel"), false);
    assert.equal(profile.isUnappliedReinterpretation(original, null), false, "An original profile is always part of the data");
    const unit = (applied: string | null) => ({ relabeled_student_profile_db_id: applied });
    assert.equal(itemReview.isProfileOfRecord({ ...original, concept_unit_session: unit(null) }), true);
    assert.equal(itemReview.isProfileOfRecord({ ...relabeled, concept_unit_session: unit(null) }), false);
    assert.equal(itemReview.isProfileOfRecord({ ...relabeled, concept_unit_session: unit("p-relabel") }), true);
    assert.equal(itemReview.isProfileOfRecord({ ...original, concept_unit_session: unit("p-relabel") }), false);
  });

  await check("A reinterpretation has its own profile role and still counts as the attempt's initial assessment", () => {
    const base = { profile_type: "initial", misconception_indicators: null, process_interpretation_cautions: [], confidence_alignment: "insufficient_evidence",
      based_on_agent_call: { agent_name: "student_profiling_agent", call_status: "succeeded", output_validated: true } };
    const relabeled = record.profileRecordProvenance({ ...base, id: "p1", item_level_evidence: stored(contract.INTERPRETATION_V8_PROMPT_VERSION, { relabel: relabelMeta }) });
    assert.equal(relabeled.profile_record_role, "reinterpretation");
    assert.equal(relabeled.profile_valid_for_learning_analysis, true);
    assert.equal(relabeled.profile_confidence_alignment_scope, "initial_assessment");
    assert.equal(record.profileRecordProvenance({ ...base, id: "p2", item_level_evidence: stored("student-profiling-v8.3") }).profile_record_role, "baseline");
  });

  await check("Research files mark reinterpretation rows and count only their own profiling calls", () => {
    const session = {
      session_public_id: "sess-1", research_student_id: "rs_1", assessment_public_id: "asmt-1", attempt_number: 1, family_attempt_number: 1,
      items: [{ item_public_id: "i1", item_snapshot_public_id: "i1:v1", item_version: 1, item_order: 1 }],
      profiles: [
        { profile_record_id: "profile_original", concept_unit_public_id: "cu-1", created_at: new Date("2026-10-01T00:00:00Z"),
          item_level_evidence: stored("student-profiling-v8.3"), source_agent_call_public_id: "call-sub" },
        { profile_record_id: "profile_relabel", concept_unit_public_id: "cu-1", created_at: new Date("2026-10-30T20:00:00Z"),
          item_level_evidence: stored(contract.INTERPRETATION_V8_PROMPT_VERSION, { relabel: relabelMeta }), source_agent_call_public_id: "call-re" }
      ],
      profiling_calls: [
        { agent_call_public_id: "call-sub", call_status: "succeeded", output_validated: true, provider: "openai", prompt_version: "student-profiling-v8.3",
          schema_version: "student-interpretation-output-v8", input_payload: {}, output_payload: {}, purpose: "submission" as const },
        { agent_call_public_id: "call-re-1", call_status: "invalid_output", output_validated: false, provider: "openai", prompt_version: contract.INTERPRETATION_V8_PROMPT_VERSION,
          schema_version: "student-interpretation-output-v8", input_payload: {}, output_payload: {}, purpose: "reinterpretation" as const },
        { agent_call_public_id: "call-re", call_status: "succeeded", output_validated: true, provider: "openai", prompt_version: contract.INTERPRETATION_V8_PROMPT_VERSION,
          schema_version: "student-interpretation-output-v8", input_payload: {}, output_payload: {}, purpose: "reinterpretation" as const }
      ],
      conversations: [], tutor_turns: [], feedback_calls: [], review_signals: []
    } as unknown as Parameters<typeof exportV8.interpretationSummaryRows>[0];
    const rows = exportV8.interpretationSummaryRows(session, new Map());
    assert.deepEqual(rows.map((row) => row.interpretation_record), ["submission", "reinterpretation"]);
    assert.deepEqual(rows.map((row) => row.profiling_call_count), [1, 2]);
    assert.deepEqual(rows.map((row) => row.profiling_output_rejected_count), [0, 1]);
    const ratings = exportV8.interpretationItemRatingRows(session, new Map(), { include_restricted: false });
    assert.deepEqual(ratings.map((row) => row.interpretation_record), ["submission", "reinterpretation"]);
    assert.ok(dictionary.INTERPRETATION_SUMMARIES_COLUMNS.includes("interpretation_record" as never));
    assert.ok(dictionary.INTERPRETATION_ITEM_RATINGS_COLUMNS.includes("interpretation_record" as never));
  });

  await check("Reinterpretation calls stay out of the attempt's process data and are marked in the AI call audit", () => {
    const key = `${contract.INTERPRETATION_RELABEL_INVOCATION_PREFIX}unit:package:1:uuid`;
    assert.equal(calls.isReinterpretationCall(key), true);
    assert.equal(calls.isReinterpretationCall("interpretation-v8:unit:package:1:uuid"), false);
    assert.equal(calls.isReinterpretationCall(null), false);
    assert.deepEqual(calls.attemptAgentCallWhere, { OR: [
      { agent_invocation_key: null },
      { NOT: { agent_invocation_key: { startsWith: contract.INTERPRETATION_RELABEL_INVOCATION_PREFIX } } }
    ] }, "Calls without a key are kept");
    assert.ok(audit.AI_CALL_AUDIT_COLUMNS.includes("call_purpose"));
    assert.match(audit.AI_CALL_AUDIT_DEFINITIONS.call_purpose, /reinterpretation/);
    // Every attempt-level reader of model calls filters them out.
    for (const file of [
      "src/lib/services/teacher-research-data/analysis-ready-export.ts",
      "src/lib/services/teacher-detailed-csv-export/service.ts",
      "src/lib/services/teacher-simple-csv-export/service.ts",
      "src/lib/services/master-export/service.ts",
      "src/lib/services/teacher-research-export/service.ts",
      "src/lib/services/teacher-review/session-detail.ts",
      "src/lib/services/student-assessment/assessment-interpretation-context.ts",
      "src/lib/workflow/initial-preparation.ts"
    ]) assert.match(readFileSync(file, "utf8"), /attemptAgentCallWhere/, file);
  });

  console.log(`\n${passed} interpretation relabel checks passed; no database or provider calls.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
