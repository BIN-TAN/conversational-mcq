/**
 * Database-free checks for the 2026-10-17 design-alignment changes
 * (docs/DESIGN_ALIGNMENT_2026-10-17.md). Run with:
 *
 *   npx tsx prisma/design-alignment-unit-test.ts
 *
 * Covers: D1 single-topic content rule, D2 finish after a student stop, D3 profile
 * provenance, D6/D9 module grouping and the five-module model policy, D7
 * pseudonymization key policy, D8 instructor-report evidence validation, D10 typed
 * explanations, D11 one active tab, R1 attempt provenance, and the second-pass
 * follow-ups (F-D2a, F-D1a, F-A3, F-A4), and D13 (no transfer labels in the mini-test profile). Database-backed
 * workflows are covered by the smoke tests listed in the change record.
 */
import assert from "node:assert/strict";

process.env.DATABASE_URL ??= "postgresql://synthetic:synthetic@127.0.0.1:5432/design_alignment_unit";
process.env.SESSION_SECRET ??= "design-alignment-unit-test-session-secret-0000000000";

// Importing service modules constructs the shared Prisma client, which tries to load
// a query engine in the background. These checks never query the database, so an
// engine-initialisation failure (e.g. no engine for this platform) is ignored here;
// every other unhandled rejection still fails the run.
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
  const { assessmentHasValidPublishedContent, MAX_PUBLISHED_TOPICS_PER_MINI_TEST } = await import(
    "../src/lib/services/assessment-availability/availability"
  );
  const items = (count: number) => Array.from({ length: count }, (_, index) => ({ id: `item-${index}` }));
  const fakeContent = (units: Array<{ items: Array<{ id: string }> }>) => ({
    conceptUnit: { findMany: async () => units.map((unit, index) => ({ id: `unit-${index}`, ...unit })) }
  }) as never;

  await check("D1 one published topic with 3 items is offered", async () => {
    assert.equal(MAX_PUBLISHED_TOPICS_PER_MINI_TEST, 1);
    assert.equal(await assessmentHasValidPublishedContent(fakeContent([{ items: items(3) }]), "a"), true);
  });
  await check("D1 a published mini-test with two topics is not offered for new attempts", async () => {
    assert.equal(await assessmentHasValidPublishedContent(fakeContent([{ items: items(3) }, { items: items(4) }]), "a"), false);
  });
  await check("D1 item-count rule unchanged (fewer than 3 items is invalid)", async () => {
    assert.equal(await assessmentHasValidPublishedContent(fakeContent([{ items: items(2) }]), "a"), false);
  });

  const { canFinishConversationAssessment } = await import(
    "../src/lib/services/student-assessment/formative-conversation/finish-assessment"
  );
  const finishDb = (conversation: Record<string, unknown> | null) => ({
    conceptUnit: { findMany: async () => [{ id: "unit-1" }] },
    conceptUnitSession: {
      findMany: async () => [{
        id: "cus-1",
        initial_completed_at: new Date(),
        response_packages: [{ id: "pkg-1" }],
        formative_conversation_session: conversation
      }]
    },
    conversationTurn: { findMany: async () => [] },
    agentCall: { findFirst: async () => null }
  }) as never;

  await check("D2 finish is allowed after a student stop while a tutor reply was still pending", async () => {
    const allowed = await canFinishConversationAssessment("s", "a", finishDb({
      id: "conv-1", status: "ended", lifecycle_reason: "student_ended_conversation",
      conversation_turns: [], message_receipts: [{ id: "r1", status: "student_turn_persisted", student_turn_db_id: "t1",
        assistant_turn_db_id: null, assistant_response_status: "pending" }]
    }));
    assert.equal(allowed, true);
  });
  await check("D2 platform-failure closure with an unanswered message still blocks finish", async () => {
    const allowed = await canFinishConversationAssessment("s", "a", finishDb({
      id: "conv-1", status: "ended", lifecycle_reason: "platform_failure:opening_unavailable",
      conversation_turns: [], message_receipts: [{ id: "r1", status: "failed", student_turn_db_id: null,
        assistant_turn_db_id: null, assistant_response_status: "failed" }]
    }));
    assert.equal(allowed, false);
  });
  await check("D2 an active conversation still blocks finish", async () => {
    const allowed = await canFinishConversationAssessment("s", "a", finishDb({
      id: "conv-1", status: "active", lifecycle_reason: null, conversation_turns: [{ id: "t" }],
      message_receipts: [{ id: "r1", status: "assistant_turn_persisted", student_turn_db_id: null,
        assistant_turn_db_id: "a1", assistant_response_status: "completed" }]
    }));
    assert.equal(allowed, false);
  });

  const { profileRecordProvenance, PROFILE_PROVENANCE_COLUMNS, PROFILE_FIELD_DEFINITIONS } = await import(
    "../src/lib/services/student-assessment/profile-record"
  );
  const baseProfile = { id: "p1", profile_type: "initial", item_level_evidence: [], misconception_indicators: [],
    confidence_alignment: "insufficient_evidence", process_interpretation_cautions: [] as string[] };
  await check("D3 a stored profile whose profiling call failed is a fallback even without caution text", () => {
    const provenance = profileRecordProvenance({ ...baseProfile, based_on_agent_call: {
      agent_name: "student_profiling_agent", call_status: "invalid_output", output_validated: false, provider: "openai" } });
    assert.equal(provenance.profile_validation_status, "fallback");
    assert.equal(provenance.profile_valid_for_learning_analysis, false);
    assert.equal(provenance.profile_unavailable_reason, "profiling_fallback");
  });
  await check("D3 a successful validated live profile stays validated and reports its provider", () => {
    const provenance = profileRecordProvenance({ ...baseProfile, based_on_agent_call: {
      agent_name: "student_profiling_agent", call_status: "succeeded", output_validated: true, provider: "openai" } });
    assert.equal(provenance.profile_validation_status, "validated");
    assert.equal(provenance.profile_source_provider, "openai");
  });
  await check("D3 provider column is exported and defined in the data dictionary", () => {
    assert.ok((PROFILE_PROVENANCE_COLUMNS as readonly string[]).includes("profile_source_provider"));
    assert.ok(PROFILE_FIELD_DEFINITIONS.profile_source_provider);
    for (const column of PROFILE_PROVENANCE_COLUMNS) assert.ok(PROFILE_FIELD_DEFINITIONS[column], `definition for ${column}`);
  });

  const modules = await import("../src/lib/llm/assessment-modules");
  const { LiveModelRole, liveModelRoleEnvSources, liveModelRoleResolutionSources, resolveOpenAIModelConfigForRole } =
    await import("../src/lib/llm/config");
  await check("D6 every live AI role belongs to exactly one dissertation module", () => {
    for (const role of LiveModelRole.options) {
      const matches = modules.ASSESSMENT_ROLE_DEFINITIONS.filter((entry) => entry.role === role);
      assert.equal(matches.length, 1, `${role} must be listed once`);
    }
    for (const assessmentModule of modules.ASSESSMENT_MODULES) {
      assert.ok(modules.rolesForModule(assessmentModule).some((entry) => entry.usage === "current_workflow"), `${assessmentModule} has a current role`);
    }
    assert.equal(modules.moduleForRole("instructor_report_agent"), "instructor_reporting");
  });
  await check("D9 resolution tries the module variable first; the listed order keeps the role variable first", () => {
    const sources = liveModelRoleResolutionSources().student_profiling_agent;
    assert.equal(sources[0].model, "OPENAI_MODEL_MODULE_PROFILING_FEEDBACK");
    assert.equal(sources[0]?.maxTokens, "OPENAI_MAX_OUTPUT_TOKENS_PROFILING", "module source keeps the role token limit");
    assert.equal(sources[1]?.model, "OPENAI_MODEL_PROFILING");
    const tutor = liveModelRoleResolutionSources().item_administration_tutor_agent.map((source) => source.model);
    assert.deepEqual(tutor.slice(0, 3), ["OPENAI_MODEL_MODULE_ITEM_ADMINISTRATION", "OPENAI_MODEL_ITEM_ADMIN", "OPENAI_MODEL_FOLLOWUP"]);
    // Approval tooling reads entry [0] of the listed order as the role's own variable.
    for (const role of LiveModelRole.options) {
      const own = liveModelRoleEnvSources()[role][0].model;
      assert.ok(!own.startsWith("OPENAI_MODEL_MODULE_"), `${role} lists its own variable first`);
    }
    assert.equal(liveModelRoleEnvSources().formative_value_determination_agent[0].model, "OPENAI_MODEL_FORMATIVE_VALUE_DETERMINATION");
    assert.equal(liveModelRoleEnvSources().connectivity_test.at(-1)?.model, "OPENAI_MODEL_CONNECTIVITY_TEST");
  });
  await check("D9 the module setting is authoritative; a role variable applies only when the module is unset", () => {
    const saved = { ...process.env };
    try {
      delete process.env.OPERATIONAL_APPROVAL_BUNDLE_PATH;
      delete process.env.OPENAI_MODEL_MODULE_PROFILING_FEEDBACK;
      process.env.OPENAI_MODEL_PROFILING = "gpt-5.6-luna";
      process.env.OPENAI_REASONING_EFFORT_PROFILING = "low";
      assert.equal(resolveOpenAIModelConfigForRole("student_profiling_agent").model_name, "gpt-5.6-luna", "role fallback");
      process.env.OPENAI_MODEL_MODULE_PROFILING_FEEDBACK = "gpt-5.6-terra";
      process.env.OPENAI_REASONING_EFFORT_MODULE_PROFILING_FEEDBACK = "medium";
      const fromModule = resolveOpenAIModelConfigForRole("student_profiling_agent");
      assert.equal(fromModule.model_name, "gpt-5.6-terra", "module wins over the role variable");
      assert.equal(fromModule.reasoning_effort, "medium");
    } finally {
      for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
      Object.assign(process.env, saved);
    }
  });
  await check("D9 five selections, one per module, and the policy status detects disagreement", () => {
    assert.deepEqual(Object.keys(modules.MODULE_MODEL_POLICY).sort(), [...modules.ASSESSMENT_MODULES].sort());
    const selected = Object.values(modules.MODULE_MODEL_POLICY).map((entry) => `${entry.model}/${entry.reasoning_effort}`);
    assert.deepEqual(selected, ["gpt-5.6-luna/medium", "gpt-5.6-luna/medium", "gpt-5.6-luna/medium",
      "gpt-6.1-sol/medium", "gpt-6.1-sol/medium"]);
    const current = modules.ASSESSMENT_ROLE_DEFINITIONS.filter((entry) => entry.usage === "current_workflow");
    const matching = current.map((entry) => {
      const policy = modules.MODULE_MODEL_POLICY[entry.module as keyof typeof modules.MODULE_MODEL_POLICY];
      return { role: entry.role, model: policy?.model ?? null, reasoning_effort: policy?.reasoning_effort ?? null };
    });
    const status = modules.moduleModelPolicyStatus(matching);
    assert.equal(status.length, 5);
    assert.ok(status.every((entry) => entry.single_configuration && entry.matches_selected));
    const split = modules.moduleModelPolicyStatus(matching.map((entry) =>
      entry.role === "student_profiling_agent" ? { ...entry, model: "gpt-5.6-terra" } : entry));
    const profiling = split.find((entry) => entry.module === "profiling_and_feedback")!;
    assert.equal(profiling.single_configuration, false);
    assert.equal(profiling.matches_selected, false);
  });

  const pseudonymization = await import("../src/lib/services/teacher-research-data/pseudonymization");
  await check("D7 a deployed environment (APP_ENV=staging) without a key refuses to pseudonymize", () => {
    assert.throws(() => pseudonymization.researchStudentId("synthetic_01", { APP_ENV: "staging" } as never),
      (error: unknown) => (error as { code?: string }).code === "research_pseudonymization_key_missing");
  });
  await check("D7 local and test environments keep the documented test key", () => {
    for (const APP_ENV of [undefined, "local", "development", "test"]) {
      const metadata = pseudonymization.researchPseudonymizationMetadata({ APP_ENV } as never);
      assert.equal(metadata.production_ready, false);
    }
  });
  await check("D7 staging with a secret key produces stable pseudonyms", () => {
    const env = { APP_ENV: "staging", RESEARCH_PSEUDONYMIZATION_KEY: "a-long-secret-key-for-staging-1234" } as never;
    assert.equal(pseudonymization.researchStudentId("Synthetic_01", env), pseudonymization.researchStudentId("synthetic_01", env));
    assert.notEqual(pseudonymization.researchStudentId("synthetic_01", env),
      pseudonymization.researchStudentId("synthetic_01", { APP_ENV: "test" } as never));
  });

  // D8, updated for the v8 report (docs/AI_MODULE_REDESIGN_2026-10-19.md, 9.7); the full
  // checks are in prisma/instructor-report-v8-unit-test.ts.
  const { assembleInstructorReportV8 } = await import("../src/lib/services/instructor-report/assemble");
  const { validateInstructorReportV8 } = await import("../src/lib/services/instructor-report/validate");
  const { buildLocalTestNarrative, buildReportRecord, findingCounts } = await import("../src/lib/services/instructor-report/deterministic");
  const { INSTRUCTOR_REPORT_V8_SCHEMA_VERSION, InstructorReportV8OutputSchema } = await import("../src/lib/services/instructor-report/contract");
  const reportItemOptions = [{ label: "A", text: "a" }, { label: "B", text: "b" }];
  const reportPackage = (selected: string, correctness: string, reasoning: string) => ({
    item_responses: [{ item_public_id: "item_q1_public", item_snapshot: { item_public_id: "item_q1_public", options: reportItemOptions, correct_option: "A" },
      selected_answer_final: selected, correctness, reasoning_text_final: reasoning, confidence_final: "high",
      tempting_option: "A", tempting_option_reason: "A mentions consistency" }]
  });
  const assembledReport = assembleInstructorReportV8({
    mini_test_title: "Synthetic mini test", topic: { title: "Reliability", learning_objective: "Distinguish error types", description: null },
    items: [{ item_public_id: "item_q1_public", stem: "Stem", options: reportItemOptions, correct_option: "A", expected_reasoning: null, distractor_rationales: [] }],
    eligible_student_count: 3,
    attempts: [
      { student_key: "user_a_key", session_public_id: "sess_a_public", attempt_number: 1, created_at: "2026-10-17T00:00:00.000Z", finished: true, restored: false,
        package_payloads: [reportPackage("B", "incorrect", "Because more items always make the scores valid.")], profile_item_level_evidence: null,
        conversation: { status: "ended", lifecycle_reason: "student_ended_conversation", feedback_v8_outputs: [], review_signals: [], turns: [
          { turn_id: "t1", actor: "tutor" as const, text: "Reliability is about consistency.", agent_call_id: null },
          { turn_id: "t2", actor: "student" as const, text: "So a longer test is always more valid?", agent_call_id: null }] } },
      { student_key: "user_b_key", session_public_id: "sess_b_public", attempt_number: 1, created_at: "2026-10-17T00:00:00.000Z", finished: false, restored: false,
        package_payloads: [reportPackage("E", "not_scored", "I don't know")], profile_item_level_evidence: null, conversation: null }
    ]
  });
  const reportInput = assembledReport.input;
  const reportQuote = (student_label: string, item_label: string | null, source: "item_response" | "conversation", quote: string) => ({ student_label, item_label, source, quote });
  const finding = (quotes: Array<ReturnType<typeof reportQuote>>, students = ["S1"]) => ({
    title: "Validity conflated with length", type: "possible_misconception" as const, attempts: "first_attempts" as const, item_labels: ["Q1"],
    description: "d", students_covered: students, quotes, caution: "One student."
  });
  const report = (findings: unknown[]) => InstructorReportV8OutputSchema.parse({
    schema_version: INSTRUCTOR_REPORT_V8_SCHEMA_VERSION, overview: "o", findings,
    item_notes: [{ item_label: "Q1", note: "n" }], suggested_teaching_actions: [], limits_of_evidence: []
  });
  const reportCodes = (findings: unknown[]) => validateInstructorReportV8(reportInput, report(findings)).map((issue) => issue.code);
  await check("D8 verbatim quotes from the cited student and item are accepted", () => {
    assert.deepEqual(reportCodes([finding([
      reportQuote("S1", "Q1", "item_response", "more items always make the scores valid"),
      reportQuote("S1", null, "conversation", "So a longer test is always more valid?")
    ])]), []);
  });
  await check("D8 fabricated, tutor-attributed, wrong-student and unknown-item evidence is rejected", () => {
    const codes = reportCodes([
      finding([
        reportQuote("S1", "Q1", "item_response", "validity depends on length only"),
        reportQuote("S1", null, "conversation", "Reliability is about consistency"),
        reportQuote("S2", "Q1", "item_response", "more items always make the scores valid")
      ], ["S1", "S2"]),
      finding([reportQuote("S9", "Q1", "item_response", "x y z")], ["S9"]),
      finding([reportQuote("S1", "Q7", "item_response", "more items always make")])
    ]);
    assert.ok(codes.includes("quote_not_found"), "fabricated or another student's words");
    assert.ok(codes.includes("quote_is_tutor_words"));
    assert.ok(codes.includes("unknown_student_label"));
    assert.ok(codes.includes("unknown_item_label"));
    assert.equal(codes.filter((code) => code === "quote_not_found").length, 2);
  });
  await check("D8 the application counts the students each finding covers; quotes come from covered students", () => {
    const output = report([finding([reportQuote("S1", "Q1", "item_response", "more items always make the scores valid")], ["S1", "S1"])]);
    assert.equal(findingCounts(reportInput, output)[0].students_covered, 1);
    assert.ok(reportCodes([finding([reportQuote("S1", "Q1", "item_response", "more items always make the scores valid")], ["S2"])]).includes("quote_student_not_covered"));
  });
  await check("D8 local test report is labelled as not AI-generated; counts-only reports say why", () => {
    const narrative = buildLocalTestNarrative(reportInput);
    assert.match(narrative.overview, /without an AI model/);
    assert.deepEqual(validateInstructorReportV8(reportInput, narrative), []);
    assert.equal(assembledReport.counts.students_with_submitted_attempt, 2);
    assert.equal(assembledReport.counts.eligible_students, 3);
    assert.equal(assembledReport.counts.first_attempts.option_distribution[0].i_dont_know, 1);
    const countsOnly = buildReportRecord(assembledReport, { generation_mode: "counts_only", reason_code: "prompt_not_approved" });
    assert.equal(countsOnly.narrative, null);
    assert.match(countsOnly.narrative_note!, /could not be generated/);
  });

  const projection = await import("../src/lib/services/student-assessment/formative-conversation/projection");
  await check("F-D2a a reply left pending past the window becomes retryable; recent or opening replies do not", () => {
    const now = new Date("2026-10-17T12:00:00Z");
    const receipt = (minutesAgo: number, extra: Record<string, unknown> = {}) => ({
      id: "r", client_message_id: "student-1", student_turn_db_id: "t1", assistant_turn_db_id: null,
      assistant_response_status: "pending", updated_at: new Date(now.getTime() - minutesAgo * 60_000), ...extra
    });
    assert.equal(projection.isStaleFormativeConversationResponse(receipt(16), now), true);
    assert.equal(projection.isStaleFormativeConversationResponse(receipt(16, { assistant_response_status: "retrying" }), now), true);
    assert.equal(projection.isStaleFormativeConversationResponse(receipt(5), now), false);
    assert.equal(projection.isStaleFormativeConversationResponse(receipt(16, { assistant_turn_db_id: "a1" }), now), false);
    assert.equal(projection.isStaleFormativeConversationResponse(receipt(16, { assistant_response_status: "failed" }), now), false);
    assert.equal(projection.isStaleFormativeConversationResponse(receipt(16, { client_message_id: "assistant-opening:formative-conversation-opening-v3" }), now), false);
  });

  const conceptUnits = await import("../src/lib/services/content/concept-units");
  await check("F-D1a a second topic cannot be created in a draft mini-test", async () => {
    const db = (existing: number) => ({ conceptUnit: { count: async () => existing } }) as never;
    await conceptUnits.assertTopicCapacity(db(0), "a", 1);
    await assert.rejects(conceptUnits.assertTopicCapacity(db(1), "a", 1),
      (error: unknown) => (error as { details?: { reason?: string } }).details?.reason === "assessment_multiple_topics_unsupported");
    await assert.rejects(conceptUnits.assertTopicCapacity(db(0), "a", 2));
  });

  const { readFileSync } = await import("node:fs");
  const source = (file: string) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
  await check("F-A4 the default draft item count follows the 3-5 recommendation", async () => {
    const { ItemDesignGenerationSettingsSchema } = await import("../src/lib/services/content/item-design-contract");
    assert.equal(ItemDesignGenerationSettingsSchema.parse({ difficulty_mix: ["foundational"] }).target_item_count, 4);
    assert.match(source("src/lib/services/content/item-design.ts"), /target_item_count: 4,/);
  });
  await check("D10 written-explanation fields block paste and drop; the conversation input does not", () => {
    const client = source("src/components/student-assessment/assessment-session-client.tsx");
    for (const testId of ["data-testid={`package-review-edit-reasoning-", "data-testid={`package-review-edit-tempting-reason-",
      'data-testid="in-flow-edit-reasoning-input"', 'data-testid="in-flow-edit-tempting-reason-input"']) {
      const at = client.indexOf(testId);
      assert.ok(at > 0, testId);
      assert.ok(client.slice(at, at + 200).includes("{...explanationPasteBlockProps}"), `${testId} blocks paste`);
    }
    assert.equal((client.match(/^\s+blockPaste$/gm) ?? []).length, 2, "reasoning and tempting-reason composers");
    const conversation = client.indexOf('data-testid="formative-conversation-input"');
    assert.ok(!client.slice(conversation, conversation + 600).includes("explanationPasteBlockProps"));
    assert.match(source("src/components/student-assessment/process-event-delivery.ts"), /"paste_blocked"/);
  });
  await check("F-A3 the unused free-text initial/messages route is retired and edits serialize with sealing", () => {
    const middleware = source("src/middleware.ts");
    assert.match(middleware, /status: 410/);
    assert.match(middleware, /\/api\/student\/sessions\/:sessionPublicId\/initial\/messages/);
    const service = source("src/lib/services/student-assessment/service.ts");
    assert.ok((service.match(/F-A3 \(audit F12\)/g) ?? []).length >= 3);
  });

  const attemptTab = await import("../src/lib/services/student-assessment/attempt-tab");
  await check("D11 the attempt-tab header round-trips and rejects malformed values", () => {
    const tab = "0f8fad5b-d9cb-469f-a165-70867728950e";
    const header = attemptTab.formatAttemptTabHeader("sess_20261017_abc", tab);
    assert.deepEqual(attemptTab.parseAttemptTabHeader(header), { session_public_id: "sess_20261017_abc", browser_tab_id: tab });
    for (const bad of [null, "", "sess-only", `sess ${tab} extra`, "sess not-a-uuid"]) {
      assert.equal(attemptTab.parseAttemptTabHeader(bad), null, String(bad));
    }
  });
  await check("D11 saving requests carry the tab claim; the guard refuses a superseded tab", () => {
    const client = source("src/components/student-assessment/api.ts");
    assert.match(client, /"x-cmcq-attempt-tab"/);
    assert.equal(attemptTab.ATTEMPT_TAB_HEADER, "x-cmcq-attempt-tab");
    assert.match(client, /\.\.\.tabHeaders/);
    const guard = source("src/lib/services/student-assessment/api.ts");
    assert.match(guard, /attemptTabHeaderIsCurrent/);
    assert.match(guard, /ATTEMPT_OPEN_ELSEWHERE_CODE, ATTEMPT_OPEN_ELSEWHERE_MESSAGE, 409/);
    const route = source("src/app/api/student/sessions/[sessionPublicId]/tab-claim/route.ts");
    assert.match(route, /checkAttemptTab: false/);
    assert.match(source("src/components/student-assessment/assessment-session-client.tsx"), /attempt-open-elsewhere-dialog/);
  });
  await check("R2 new export variables have specific dictionary definitions", async () => {
    const { buildAnalysisReadyDictionaryEntries } = await import("../src/lib/services/teacher-research-data/dictionary");
    const entries = buildAnalysisReadyDictionaryEntries() as unknown as Array<Record<string, unknown>>;
    for (const variable of ["final_idk_selected", "ever_idk_selected", "ai_flagged_insufficient_knowledge",
      "collecting_application_git_commit", "data_collection_rules_version", "attempt_tab_claim_count", "payload_paste_blocked",
      "initial_package_sealed", "feedback_shown", "conversation_started", "conversation_student_message_count", "finish_chosen", "evidence_stage"]) {
      const entry = entries.find((row) => Object.values(row).includes(variable));
      assert.ok(entry, `${variable} is in the dictionary`);
      const text = JSON.stringify(entry);
      assert.doesNotMatch(text, /describes the canonical session-level|item-response field drawn from|flattened allow-listed process-event attribute|Number of .* records? associated/, `${variable} has a specific definition`);
    }
  });
  await check("R3 the AI audit export is restricted-only and fully documented", async () => {
    const audit = await import("../src/lib/services/teacher-research-data/ai-call-audit-export");
    for (const column of audit.AI_CALL_AUDIT_COLUMNS) assert.ok(audit.AI_CALL_AUDIT_DEFINITIONS[column], column);
    for (const column of ["input_payload_json", "raw_output_json", "validated_output_json", "reasoning_effort", "prompt_hash", "model_name"]) {
      assert.ok(audit.AI_CALL_AUDIT_COLUMNS.includes(column), column);
    }
    const exporter = source("src/lib/services/teacher-research-data/analysis-ready-export.ts");
    const at = exporter.indexOf("await emit({ path: AI_CALL_AUDIT_FILE");
    assert.ok(at > 0 && exporter.lastIndexOf("if (includeRestricted)", at) > exporter.lastIndexOf("for (const file of sessionExportFiles", at),
      "audit rows are emitted only inside an includeRestricted branch");
  });
  await check("R1 each attempt records the build and data-collection rules version", () => {
    const sessionState = source("src/lib/services/session-state.ts");
    assert.match(sessionState, /data_collection_rules_version: DATA_COLLECTION_RULES_VERSION/);
    // The student start path (service.ts) is the one real attempts use.
    assert.match(source("src/lib/services/student-assessment/service.ts"), /event_type: "session_started"[\s\S]{0,400}data_collection_rules_version: DATA_COLLECTION_RULES_VERSION/);
  });

  await check("D8 one-word quotes are rejected", () => {
    assert.ok(reportCodes([finding([reportQuote("S1", "Q1", "item_response", "valid")])]).includes("quote_too_short"));
  });
  await check("Review: blocked pastes are counted apart from pastes that inserted text", async () => {
    const paste = await import("../src/lib/services/student-assessment/blocked-paste");
    const events = [
      { event_type: "paste_detected", payload: { paste_blocked: true } },
      { event_type: "paste_detected", payload: { paste_blocked: false } },
      { event_type: "paste_detected", payload: {} },
      { event_type: "typing_activity_summary", payload: {} }
    ];
    assert.equal(paste.insertedPasteCount(events), 2);
    assert.equal(paste.countedEventType(events[0]!), "paste_blocked_attempt");
    assert.equal(paste.countedEventType(events[1]!), "paste_detected");
    for (const file of ["src/lib/services/student-assessment/engagement-evidence.ts", "src/lib/services/teacher-review/engagement-process-features.ts",
      "src/lib/services/teacher-review/process-data-summary.ts", "src/lib/services/teacher-review/session-data-audit.ts"]) {
      assert.match(source(file), /blocked-paste/, file);
    }
  });
  await check("Review: the stale-reply sweep only touches live conversations and logs each rewrite", () => {
    const projectionSource = source("src/lib/services/student-assessment/formative-conversation/projection.ts");
    assert.match(projectionSource, /if \(attemptActive && \["active", "paused"\]\.includes\(conversation\.status\)\)/);
    assert.match(projectionSource, /formative_reply_marked_interrupted/);
    assert.match(projectionSource, /assistant_response_last_failure_category \?\? FORMATIVE_CONVERSATION_INTERRUPTED_FAILURE/);
  });
  await check("Review: new events have explicit codebook entries and exported payload fields", async () => {
    const dictionaryModule = await import("../src/lib/services/teacher-research-data/dictionary");
    const entries = dictionaryModule.buildProcessEventCodebookEntries();
    for (const eventType of ["attempt_tab_claimed", "attempt_save_refused_other_tab", "formative_conversation_ended_by_student", "formative_reply_marked_interrupted"]) {
      const entry = entries.find((candidate) => candidate.event_type === eventType);
      assert.ok(entry, eventType);
      assert.doesNotMatch(entry!.payload_fields, /^source; action_status/, eventType);
    }
    assert.equal(entries.find((entry) => entry.event_type === "attempt_tab_claimed")!.event_category, "attempt_integrity");
    const exporter = source("src/lib/services/teacher-research-data/analysis-ready-export.ts");
    assert.match(exporter, /payload_unanswered_message_count/);
    assert.match(exporter, /data_collection_rules_changed_during_attempt/);
  });
  await check("Review: an item's own option E cannot be published (E is \"I don't know yet\")", () => {
    assert.match(source("src/lib/services/content/publishing.ts"), /reserved_option_label/);
  });
  await check("Review: a refused save retries once after re-claiming when this tab's own claim had not landed", () => {
    const client = source("src/components/student-assessment/api.ts");
    assert.match(client, /if \(!attemptTabClaimConfirmed && sessionPublicId && !options\?\.keepalive\)/);
    assert.match(client, /pendingAttemptTabClaim && !options\?\.keepalive/);
  });
  await check("Review: opening a finished attempt does not record a tab claim (keeps tab-claim counts per attempt accurate)", () => {
    const tab = source("src/lib/services/student-assessment/attempt-tab.ts");
    assert.match(tab, /resolveCanonicalAttemptLifecycle\(session\)\.terminal/);
    assert.ok(tab.indexOf("attempt_closed: true") < tab.indexOf("event_type: ATTEMPT_TAB_CLAIM_EVENT,"));
  });
  await check("Review: a reply that arrives after the student ended the conversation is not recorded as a system failure", () => {
    const runtime = source("src/lib/services/student-assessment/formative-conversation/runtime.ts");
    assert.match(runtime, /FORMATIVE_CONVERSATION_CLOSED_BEFORE_REPLY = "conversation_closed_before_reply"/);
    assert.match(runtime, /\(await formativeConversationClosedBeforeReply\(input\.conversation_public_id\)\)/);
    // A paused conversation keeps the persistence-failure category so its completed reply is reused on resume.
    assert.doesNotMatch(runtime, /\["ended", "completed", "teacher_assistance_recommended", "paused"\]/);
    assert.match(source("src/lib/services/teacher-research-data/analysis-ready-export.ts"), /conversation_closed_before_reply means/);
  });
  await check("Sign-in: teacher pages send signed-out visitors to /teacher/login, an instructor page outside the teacher layout", async () => {
    const { readdirSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const path = await import("node:path");
    const teacherDir = fileURLToPath(new URL("../src/app/teacher/", import.meta.url));
    const files = (readdirSync(teacherDir, { recursive: true }) as string[])
      .filter((file) => /\.(ts|tsx)$/.test(file));
    assert.ok(files.length > 15);
    const stale = files.filter((file) => readFileSync(path.join(teacherDir, file), "utf8").includes('redirect("/student/login")'));
    assert.deepEqual(stale, []);
    assert.match(source("src/app/teacher/layout.tsx"), /redirect\("\/teacher\/login"\)/);
    assert.match(source("next.config.mjs"), /source: "\/teacher\/login", destination: "\/instructor-login"/);
    const page = source("src/app/instructor-login/page.tsx");
    assert.match(page, /<LoginForm audience="teacher" \/>/);
    assert.match(page, /redirect\("\/teacher\/dashboard"\)/);
    // Students keep their own page, which still accepts every account.
    assert.match(source("src/app/student/login/page.tsx"), /<LoginForm \/>/);
    assert.match(source("src/components/login-form.tsx"), /audience === "teacher"\s*\? \{ user_id: userId\.trim\(\), password: credential \}/);
  });

  await check("R5 review-phase activity events belong to the question being revised", () => {
    const client = source("src/components/student-assessment/assessment-session-client.tsx");
    assert.match(client, /currentItemPublicId: editingReviewItemId \?\? state\?\.current_item\?\.item_public_id/);
    // In-flow edits are limited to the current question, so a later unfinished question
    // never receives activity for an earlier one.
    assert.match(source("src/lib/services/student-assessment/service.ts"), /state\.current_item\?\.item_public_id !== input\.item_public_id/);
  });
  await check("R6 focused response time removes hidden and unfocused time from student intervals", async () => {
    const data = await import("../src/lib/services/student-assessment/response-stage-data");
    const { randomUUID } = await import("node:crypto");
    const tab = randomUUID();
    let n = 0;
    const visit = (stage: string, steps: Array<[string, number, Record<string, unknown>?]>) => {
      const id = randomUUID();
      const submission = randomUUID();
      const events = steps.map(([kind, ms, extra], index) => ({
        event_type: "response_stage_observation", event_source: "frontend", item_public_id: "item-1",
        payload: { observation_version: "response-stage-observation-v1", stage_visit_id: id, response_stage: stage, response_phase: "initial",
          observation_kind: kind, monotonic_ms: ms, observation_sequence: index + 1, client_event_id: randomUUID(), browser_tab_id: tab,
          client_occurred_at: new Date(1_800_000_000_000 + ms + n++).toISOString(),
          ...(["submitted", "request_finished", "controls_ready"].includes(kind) ? { submission_id: submission } : {}),
          ...(kind === "request_finished" ? { result: "response_received" } : {}), ...(extra ?? {}) }
      }));
      events.push({ event_type: "response_stage_outcome", event_source: "backend", item_public_id: "item-1",
        payload: { stage_visit_id: id, submission_id: submission, accepted: true, validation_rejected: false } } as never);
      return events;
    };
    const reasoning = visit("reasoning", [["ready", 0, { document_has_focus: true }], ["first_input", 1000], ["hidden", 2000], ["blur", 2000],
      ["visible", 5000], ["focus", 5000], ["blur", 6000], ["focus", 7000], ["submitted", 10000], ["request_finished", 10500], ["controls_ready", 11000], ["closed", 11001]]);
    const confidence = visit("confidence", [["ready", 20000, { document_has_focus: false }], ["focus", 22000], ["submitted", 25000],
      ["request_finished", 25100], ["controls_ready", 25200], ["closed", 25201]]);
    const submissions = data.deriveResponseSubmissions([...reasoning, ...confidence]);
    const r = submissions.find((row) => row.response_stage === "reasoning")!;
    assert.equal(r.student_response_elapsed_ms, 10000);
    assert.equal(r.student_interval_hidden_ms, 3000);
    assert.equal(r.student_interval_unfocused_ms, 4000);
    assert.equal(r.student_focused_response_ms, 6000);
    const c = submissions.find((row) => row.response_stage === "confidence")!;
    assert.equal(c.student_interval_unfocused_ms, 2000);
    assert.equal(c.student_focused_response_ms, 3000);
    const visits = data.deriveResponseStageVisits([...reasoning, ...confidence]);
    const item = data.summarizeItemStudentTime(submissions, visits);
    assert.equal(item.student_response_time_ms, 15000);
    assert.equal(item.student_unfocused_time_ms, 6000);
    assert.equal(item.student_focused_response_time_ms, 9000);
    assert.equal(item.unsubmitted_visit_count, 0);
    // A hidden span with no recorded return before submission leaves the value blank.
    const open = data.deriveResponseSubmissions(visit("answer", [["ready", 0], ["hidden", 100], ["submitted", 900], ["request_finished", 950], ["controls_ready", 990]]));
    assert.equal(open[0].student_focused_response_ms, null);
    assert.match(String(open[0].timing_limitations), /unpaired_attention_observation/);
    const dictionary = source("src/lib/services/teacher-research-data/response-stage-dictionary.ts");
    for (const column of ["student_focused_response_time_ms", "student_response_time_ms", "student_unfocused_time_ms", "unsubmitted_visit_count", "student_interval_unfocused_ms", "document_has_focus"]) {
      assert.match(dictionary, new RegExp(`${column}: `), column);
    }
    assert.match(source("src/components/student-assessment/use-response-stage-observations.ts"), /hasFocus: \(\) => document\.hasFocus\(\)/);
  });
  await check("R7 attempts carry a family-wide attempt number next to the per-version attempt_number", async () => {
    const exporter = source("src/lib/services/teacher-research-data/analysis-ready-export.ts");
    assert.match(exporter, /family_attempt_number: earlier \+ 1/);
    assert.match(exporter, /revision_family_public_id: family/);
    const { attemptComparisonExportFiles } = await import("../src/lib/services/teacher-research-data/attempt-comparison-export");
    const files = attemptComparisonExportFiles({ attempts: [{ student_key: "s", session_public_id: "sess_b", assessment_public_id: "asmt_v2",
      assessment_title: "t", assessment_family_public_id: "asmt_v1", attempt_number: 1, status: "completed", started_at: "2026-10-18T00:00:00.000Z",
      submitted_at: null, items: [], limitation: null, chance_policy: null, chance_waived_at: null }],
      snapshot_at: "2026-10-18T00:00:00.000Z", pseudonym: (value) => `rs_${value}`, include_restricted: false, scope: "all_authorized",
      family_attempt_numbers: new Map([["sess_b", 2]]) });
    const records = files.find((file) => file.path === "attempt_records.csv")!.data;
    const [header, row] = String(records).trim().split("\n").map((line: string) => line.split(","));
    assert.equal(row[header.indexOf("attempt_number")], "1");
    assert.equal(row[header.indexOf("family_attempt_number")], "2");
    const dictionary = source("src/lib/services/teacher-research-data/dictionary.ts");
    assert.match(dictionary, /"family_attempt_number",/);
    assert.match(dictionary, /family_attempt_number: "Order of this attempt/);
  });

  await check("R8 attempts under the 2026-10-18 rules are distinguishable from the deployed 2026-10-17 rules", () => {
    assert.match(source("src/lib/services/session-state.ts"), /DATA_COLLECTION_RULES_VERSION = "data-collection-rules-2026-10-18"/);
    const exporter = source("src/lib/services/teacher-research-data/analysis-ready-export.ts");
    assert.match(exporter, /version === "data-collection-rules-2026-10-17" && focusRecorded/);
    assert.match(source("src/lib/services/teacher-research-data/dictionary.ts"), /data-collection-rules-2026-10-18 \(the same, plus final-review activity/);
  });

  await check("D13 the profile saved from the mini-test carries no transfer label", async () => {
    const labels = await import("../src/lib/services/student-assessment/initial-profile-transfer-labels");
    const plain = { ability_profile: "mostly_correct_understanding", ability_pattern_flags: ["no_clear_pattern"] };
    assert.equal(labels.blockInitialProfileTransferLabels(plain), plain, "Outputs without a transfer label are returned unchanged");
    assert.deepEqual(
      labels.blockInitialProfileTransferLabels({ ability_profile: "robust_transfer_ready_understanding", ability_pattern_flags: ["transfer_ready"] }),
      { ability_profile: "mostly_correct_understanding", ability_pattern_flags: ["no_clear_pattern"] }
    );
    assert.deepEqual(
      labels.blockInitialProfileTransferLabels({ ability_profile: "partial_understanding", ability_pattern_flags: ["incomplete_reasoning", "transfer_ready"] }),
      { ability_profile: "partial_understanding", ability_pattern_flags: ["incomplete_reasoning"] }
    );

    const { studentProfileCreateData } = await import("../src/lib/agents/student-profiling/persistence");
    const output = {
      profile_type: "initial", ability_profile: "robust_transfer_ready_understanding",
      ability_pattern_flags: ["transfer_ready", "no_clear_pattern"], engagement_profile: "adequate_engagement",
      engagement_pattern_flags: ["no_clear_pattern"], integrated_diagnostic_profile: "robust_understanding_ready_for_transfer",
      integrated_profile_confidence: "medium", integrated_profile_rationale: "r", evidence_sufficiency: "adequate",
      confidence_alignment: "well_calibrated", independence_interpretability: "interpretable", misconception_indicators: [],
      item_level_evidence: [], reasoning_quality_summary: "s", engagement_summary: "e", process_interpretation_cautions: [],
      profile_confidence: "medium", rationale: "r", recommended_next_evidence: []
    };
    const original = JSON.stringify(output);
    const data = studentProfileCreateData({ concept_unit_session_db_id: "cus", based_on_agent_call_db_id: "call", output: output as never });
    assert.equal(data.ability_profile, "mostly_correct_understanding");
    assert.deepEqual(data.ability_pattern_flags, ["no_clear_pattern"]);
    assert.equal(data.integrated_diagnostic_profile, "robust_understanding_ready_for_transfer", "The integrated code is kept (no non-transfer counterpart)");
    assert.equal(JSON.stringify(output), original, "The model output itself is not modified");

    const call = (payload: unknown) => ({ agent_name: "student_profiling_agent", output_payload: payload });
    assert.equal(labels.initialProfileTransferRule({ ...data, based_on_agent_call: call(output) }), "transfer_label_replaced");
    assert.equal(labels.initialProfileTransferRule({ ...data, based_on_agent_call: call({ ...output, ability_profile: "mostly_correct_understanding", ability_pattern_flags: ["no_clear_pattern"] }) }), "no_transfer_label");
    assert.equal(labels.initialProfileTransferRule({ ability_profile: "robust_transfer_ready_understanding", ability_pattern_flags: [], based_on_agent_call: call(output) }), "saved_before_rule");
    assert.equal(labels.initialProfileTransferRule({ ...data, based_on_agent_call: { agent_name: "formative_conversation_agent", output_payload: null } }), null);
    assert.equal(labels.initialProfileTransferRule({ ...data, based_on_agent_call: null }), null);

    assert.equal(labels.profileCodeReadableLabel("robust_understanding_ready_for_transfer", "initial"), "Robust understanding (transfer not assessed)");
    assert.equal(labels.profileCodeReadableLabel("robust_understanding_ready_for_transfer", "updated"), "robust understanding ready for transfer");
    assert.equal(labels.profileCodeReadableLabel("partial_understanding", "initial"), "partial understanding");

    const { learningProfileSummary, UNDERSTANDING_SUMMARY_COLUMNS } = await import("../src/lib/services/student-assessment/learning-profile-summary");
    assert.equal((UNDERSTANDING_SUMMARY_COLUMNS as readonly string[]).includes("transfer_evidence_status"), false);
    assert.equal("transfer_evidence_status" in learningProfileSummary(null), false);
    const exporter = source("src/lib/services/teacher-research-data/analysis-ready-export.ts");
    assert.match(exporter, /initial_profile_transfer_rule: initialProfileTransferRule\(profile\)/);
    assert.match(source("src/lib/services/teacher-research-data/dictionary.ts"), /initial_profile_transfer_rule: "D13 rule/);
    assert.match(source("src/components/teacher-review/session-detail-client.tsx"), /profileCodeReadableLabel\(profile\.integrated_diagnostic_profile, profile\.profile_type\)/);
  });

  console.log(`\n${passed} design-alignment checks passed.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
