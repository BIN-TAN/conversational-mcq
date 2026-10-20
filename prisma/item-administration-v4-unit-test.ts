/**
 * Database-free checks for item administration v4 (docs/AI_MODULE_REDESIGN_2026-10-19.md,
 * section 9.3): the verbatim prompt, the output schema, how each action is recorded, the
 * one-clarification rule, what the model may see, and that a model or configuration failure never
 * blocks a student who typed a real response. Run with:
 *
 *   npx tsx prisma/item-administration-v4-unit-test.ts
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

process.env.DATABASE_URL ??= "postgresql://synthetic:synthetic@127.0.0.1:5432/item_admin_v4_unit";
process.env.SESSION_SECRET ??= "item-admin-v4-unit-test-session-secret-000000000000";
process.env.LLM_PROVIDER ??= "mock";
process.env.ALLOW_LOCAL_MOCK_RUNTIME ??= "true";
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

async function withEnv<T>(values: Record<string, string | undefined>, run: () => Promise<T>): Promise<T> {
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  const assign = (entries: Record<string, string | undefined>) => {
    for (const [key, value] of Object.entries(entries)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
  assign(values);
  try {
    return await run();
  } finally {
    assign(previous);
  }
}

const LIVE_ENV = {
  LLM_PROVIDER: "openai",
  LLM_LIVE_CALLS_ENABLED: "true",
  OPENAI_API_KEY: `sk-unit-test-${"a".repeat(40)}`,
  OPENAI_MODEL_ITEM_ADMIN: "gpt-unit-test",
  ITEM_ADMIN_TUTOR_MODE: "live"
};

const TYPED_REASONS = [
  "Because the slope is steeper, so the item separates students better.",
  "I think it's B since a bigger number means harder",
  "the curve looks steeper",
  "bigger slope",
  "B is the correct answer because the slope is larger",
  "Because the probability of a correct answer will change as ability goes up",
  "I don't know why.",
  "I'm confused about this one",
  "honestly not sure",
  "No idea",
  "因为难度参数更高，所以我选B"
];
const NOT_A_RESPONSE = ["asdfghjkl", "zzzzzzzz", "qwrtpsdfghjklm", "what should I have for lunch today"];
const EMPTY = ["", "   ", "\n\t"];

async function main() {
  const tutor = await import("../src/lib/services/student-assessment/item-administration-tutor");
  const responseQuality = await import("../src/lib/services/student-assessment/response-quality");
  const readiness = await import("../src/lib/llm/assessment-tutor-readiness");
  const interpretationContext = await import("../src/lib/services/student-assessment/assessment-interpretation-context");
  const { containsInternalSystemInformation } = await import("../src/lib/student-visible-safety");
  const { zodTextFormat } = await import("openai/helpers/zod");
  type Action = import("../src/lib/services/student-assessment/item-administration-tutor").ItemAdministrationTutorAction;
  type Packet = import("../src/lib/services/student-assessment/item-administration-tutor").ItemAdministrationTutorStatePacket;
  type Result = import("../src/lib/services/student-assessment/item-administration-tutor").ItemAdministrationTutorResult;
  type LlmProvider = import("../src/lib/llm/providers/types").LlmProvider;
  type ProviderResult = import("../src/lib/llm/providers/types").StructuredAgentResult<unknown>;

  const packet = (overrides: Partial<Packet> = {}): Packet => ({
    assessment_state: "AWAIT_REASON",
    item_public_id: "synthetic-item",
    item_order: 1,
    item_role: "initial",
    required_evidence_type: "reasoning",
    selected_option: "B",
    latest_student_message: "Because the slope is steeper.",
    correctness_feedback_prohibited: true,
    prior_uncertainty: false,
    prior_neutral_clarification_count: 0,
    prior_neutral_prompt_count: 0,
    ...overrides
  });
  const fromModel = (action: Action, overrides: Partial<Packet> = {}, text = "Because the slope is steeper.", saved_question: string | null = null) =>
    tutor.itemAdministrationTutorResultFromModelOutput({
      output: { action, saved_question },
      state_packet: packet({ ...overrides, latest_student_message: text }),
      text
    });

  // 1. Prompt and versions --------------------------------------------------------------------
  await check("The prompt is the 9.3 code block verbatim; versions and hash follow it", () => {
    const doc = readFileSync(path.resolve(process.cwd(), "docs/AI_MODULE_REDESIGN_2026-10-19.md"), "utf8");
    const section = doc.split("### 9.3 Item administration")[1].split("### 9.4")[0];
    const block = /```text\n([\s\S]*?)\n```/.exec(section)?.[1];
    assert.ok(block, "9.3 code block not found");
    assert.equal(tutor.ITEM_ADMINISTRATION_TUTOR_INSTRUCTIONS, block);
    assert.equal(tutor.ITEM_ADMINISTRATION_TUTOR_PROMPT_VERSION, "item-admin-tutor-v4");
    assert.equal(tutor.ITEM_ADMINISTRATION_TUTOR_SCHEMA_VERSION, "item-admin-tutor-output-v2");
    assert.equal(tutor.ITEM_ADMINISTRATION_TUTOR_VERSION, "item-administration-tutor-v4");
    assert.equal(
      tutor.ITEM_ADMINISTRATION_TUTOR_PROMPT_HASH,
      createHash("sha256").update(tutor.ITEM_ADMINISTRATION_TUTOR_INSTRUCTIONS).digest("hex")
    );
  });

  // 2. Output schema --------------------------------------------------------------------------
  await check("The output schema is { action, saved_question }, strict", () => {
    const schema = tutor.ItemAdministrationTutorOutputSchema;
    for (const action of ["accept", "clarify_once", "defer_question", "procedural_help", "redirect"]) {
      assert.equal(schema.safeParse({ action, saved_question: null }).success, true, action);
    }
    assert.equal(schema.safeParse({ action: "defer_question", saved_question: "What does theta mean?" }).success, true);
    assert.equal(schema.safeParse({ action: "accept" }).success, false, "saved_question is required (nullable)");
    assert.equal(schema.safeParse({ action: "advance", saved_question: null }).success, false);
    assert.equal(schema.safeParse({ action: "accept", saved_question: null, student_facing_message: "Hi" }).success, false, "No student text from the model");
    assert.equal(schema.safeParse({ action: "accept", saved_question: 3 }).success, false);
    assert.equal(schema.safeParse({ action: "accept", saved_question: "x".repeat(401) }).success, false);
    assert.equal(schema.safeParse({
      message_classification: "usable_reasoning", response_quality: "adequate", should_advance: true,
      should_store_deferred_concern: false, deferred_concern_summary: null,
      student_facing_message: "Thanks.", next_expected_action: "advance"
    }).success, false, "The v3 output shape is rejected");
    assert.doesNotThrow(() => zodTextFormat(schema, "item_admin_tutor_output_v2"), "The provider can build its response format");
    assert.deepEqual(Object.keys(schema.shape).sort(), ["action", "saved_question"]);
    assert.equal(tutor.parseItemAdministrationTutorOutput({ action: "accept", saved_question: null }).ok, true);
    assert.equal(tutor.parseItemAdministrationTutorOutput({ action: "accept" }).ok, false);
  });

  // 3. Mapping --------------------------------------------------------------------------------
  const expected: Record<Action, {
    advance: boolean; classification: string; next: string; shared: string; sharedNext: string;
  }> = {
    accept: { advance: true, classification: "accepted_response", next: "advance", shared: "collected", sharedNext: "continue" },
    clarify_once: { advance: false, classification: "incomplete", next: "ask_repair", shared: "incomplete", sharedNext: "ask_for_more_reasoning" },
    defer_question: { advance: false, classification: "content_question", next: "defer_content_question", shared: "content_question", sharedNext: "defer_content_help" },
    procedural_help: { advance: false, classification: "procedural_question", next: "answer_procedural_question", shared: "clarification_question", sharedNext: "answer_clarification" },
    redirect: { advance: false, classification: "off_task_or_unreadable", next: "continue_current_step", shared: "off_task_or_unreadable", sharedNext: "stay_on_current_step" }
  };

  await check("Each of the five actions maps onto the shared result fields as documented", () => {
    for (const [action, want] of Object.entries(expected) as Array<[Action, (typeof expected)[Action]]>) {
      const saved = action === "defer_question" ? "Asked what theta means." : null;
      const result = fromModel(action, {}, "Some message the student typed.", saved);
      assert.equal(result.collection_action, action);
      assert.equal(result.model_action, action);
      assert.equal(result.collection_decision_source, "model");
      assert.equal(result.application_override, "none");
      assert.equal(result.should_advance, want.advance, action);
      assert.equal(result.message_classification, want.classification, action);
      assert.equal(result.next_expected_action, want.next, action);
      assert.equal(result.response_quality, "not_judged", "v4 never records a quality level");
      assert.equal(result.response_quality_result.output.response_quality, want.shared, action);
      assert.equal(result.response_quality_result.output.next_expected_action, want.sharedNext, action);
      assert.equal(result.response_quality_result.output.should_advance, want.advance);
      assert.equal(result.response_quality_result.output.reasoning_signal, "not_applicable");
      assert.equal(result.response_quality_result.output.engagement_signal, "unclear");
      assert.equal(responseQuality.responseQualityAllowsAdvance(result.response_quality_result.output), want.advance,
        "The service logs a rejection exactly when the reply is not accepted");
      assert.equal(result.student_facing_message, tutor.itemAdministrationStudentMessage(action, "explanation"));
      assert.equal(result.response_quality_result.output.student_facing_message, result.student_facing_message);
      assert.equal(result.deferred_concern_summary, saved);
      assert.equal(result.store_deferred_concern, Boolean(saved));
      assert.equal(result.saved_question, saved);
      assert.equal(result.tutor_version, "item-administration-tutor-v4");
      assert.equal(result.item_admin_tutor_source, "live_llm");
      assert.equal(result.live_status, "validated_live");
      assert.equal(result.fallback_used, false);
      assert.equal(result.safety_validated, true);
      assert.equal(result.response_quality_result.prompt_hash, tutor.ITEM_ADMINISTRATION_TUTOR_PROMPT_HASH);
    }
    const accepted = fromModel("accept");
    assert.ok(!["adequate", "weak_but_usable", "low_information"].includes(accepted.response_quality));
    assert.ok(!["usable_reasoning", "weak_but_usable_reasoning"].includes(accepted.message_classification),
      "Accepting a reply is never recorded as a judgment of its quality");
  });

  await check("A reason with a question is accepted and the question is saved (rule 4)", () => {
    const text = "I picked B because the slope is steeper. What does theta mean?";
    const result = fromModel("accept", {}, text, "  Asked what theta means.  ");
    assert.equal(result.should_advance, true);
    assert.equal(result.deferred_concern_summary, "Asked what theta means.");
    assert.equal(result.store_deferred_concern, true);
    const deferred = fromModel("defer_question", {}, "What does theta mean?", null);
    assert.equal(deferred.should_advance, false);
    assert.ok(deferred.deferred_concern_summary, "A deferred question is always saved");
  });

  await check("Fixed student wording is plain, neutral and free of hints, correctness and internal terms", () => {
    const banned = /\b(correct|incorrect|right|wrong|hint|key|profile|misconception|rating|essential|supported|insufficient|evidence|need more work|label|time|timing|pause|paste|left the page|confidence|great|excellent|good job)\b/i;
    for (const step of ["explanation", "tempting_option_reason"] as const) {
      for (const action of Object.keys(expected) as Action[]) {
        for (const empty_response of [false, true]) {
          const message = tutor.itemAdministrationStudentMessage(action, step, { empty_response });
          assert.doesNotMatch(message, banned, message);
          assert.equal(containsInternalSystemInformation(message), false, message);
          assert.match(message, /\b(you|your)\b/i, "Speaks to the student");
          assert.ok(message.length <= 240, message);
        }
      }
      assert.match(tutor.itemAdministrationStudentMessage("clarify_once", "tempting_option_reason"), /tempting/);
      assert.match(tutor.itemAdministrationStudentMessage("redirect", "tempting_option_reason"), /tempting/);
    }
    const tempting = fromModel("redirect", { required_evidence_type: "tempting_reason", assessment_state: "AWAIT_TEMPTING_REASON" });
    assert.match(tempting.student_facing_message, /tempting/);
  });

  // 4. One clarification per response -------------------------------------------------------
  await check("At most one clarification: after it, the next non-empty reply is accepted as it is", () => {
    assert.equal(fromModel("clarify_once").collection_action, "clarify_once");
    const used = { prior_neutral_clarification_count: 1 };
    for (const action of ["clarify_once", "redirect", "procedural_help", "defer_question"] as Action[]) {
      const result = fromModel(action, used, "because", action === "defer_question" ? "Asked about slopes." : null);
      assert.equal(result.collection_action, "accept", action);
      assert.equal(result.should_advance, true);
      assert.equal(result.model_action, action, "The model's own action stays on the record");
      assert.equal(result.application_override, "clarification_already_used");
      assert.equal(result.collection_decision_source, "application_rule");
      assert.equal(result.message_classification, "accepted_response");
    }
    assert.equal(fromModel("defer_question", used, "what is theta?", "Asked what theta means.").deferred_concern_summary,
      "Asked what theta means.", "The question is still saved");
    for (const text of EMPTY) {
      const empty = fromModel("accept", used, text);
      assert.equal(empty.should_advance, false, "Empty text is never accepted");
      assert.equal(empty.application_override, "empty_response");
    }
    const input = tutor.buildItemAdministrationTutorModelInput({ state_packet: packet(used), item_stem: "Stem" });
    assert.equal(input.clarification_already_used, true);
    assert.equal(tutor.buildItemAdministrationTutorModelInput({ state_packet: packet(), item_stem: "Stem" }).clarification_already_used, false);
  });

  // 5. What the model may see -----------------------------------------------------------------
  const options = [
    { label: "A", text: "Alpha option", is_correct: false, rationale: "SECRET-OPTION-RATIONALE-A" },
    { label: "B", text: "Beta option", is_correct: false, distractor_rationale: "SECRET-OPTION-RATIONALE-B" },
    { label: "C", text: "Gamma option", is_correct: true, explanation: "SECRET-INSTRUCTOR-EXPLANATION" }
  ];
  const context = interpretationContext.buildAssessmentInterpretationContextForItemAdministration({
    assessment_public_id: "synthetic-assessment",
    assessment_title: "Synthetic",
    assessment_diagnostic_focus: "SECRET-DIAGNOSTIC-FOCUS",
    concept_unit_public_id: "synthetic-topic",
    concept_unit_version: 1,
    concept_unit_title: "Topic",
    concept_unit_learning_objective: "SECRET-LEARNING-OBJECTIVE",
    concept_unit_related_description: "SECRET-TOPIC-DESCRIPTION",
    item_public_id: "synthetic-item",
    item_order: 1,
    item_role: "initial",
    item_stem: "Which item discriminates best?",
    options,
    correct_option: "C",
    item_version: 1,
    administration_rules: { target_reasoning_note: "SECRET-TARGET-REASONING" },
    distractor_rationales: { A: "SECRET-DISTRACTOR-A", B: "SECRET-DISTRACTOR-B" },
    expected_reasoning_patterns: ["SECRET-EXPECTED-REASONING"],
    possible_misconception_indicators: ["SECRET-MISCONCEPTION"],
    selected_option: "B",
    written_reasoning: "Because the slope is steeper.",
    confidence: "high"
  });
  const contextPacket = packet({ assessment_interpretation_context: context, selected_option: "B" });

  await check("The model input holds only the stem, options, step, message and clarification flag", () => {
    assert.match(JSON.stringify(context), /correct_option_internal/, "The application context does hold the key");
    for (const modelInput of [
      tutor.buildItemAdministrationTutorModelInput({ state_packet: contextPacket, item_stem: "Which item discriminates best?", item_options: options }),
      tutor.buildItemAdministrationTutorModelInput({ state_packet: contextPacket, item_stem: "Which item discriminates best?" })
    ]) {
      assert.deepEqual(Object.keys(modelInput).sort(), ["clarification_already_used", "item", "step", "student_message"]);
      assert.deepEqual(modelInput.item, {
        stem: "Which item discriminates best?",
        options: [
          { label: "A", text: "Alpha option" },
          { label: "B", text: "Beta option" },
          { label: "C", text: "Gamma option" }
        ]
      });
      assert.equal(modelInput.step, "explanation");
      assert.equal(modelInput.student_message, "Because the slope is steeper.");
      const json = JSON.stringify(modelInput);
      assert.doesNotMatch(json, /SECRET|correct|is_correct|rationale|distractor|misconception|selected|confidence|target|instructor|teacher|answer_key|key/i);
    }
    const tempting = tutor.buildItemAdministrationTutorModelInput({
      state_packet: packet({ required_evidence_type: "tempting_reason", latest_student_message: "It sounded right" }),
      item_stem: "Stem", item_options: options
    });
    assert.equal(tempting.step, "tempting_option_reason");
    assert.equal(tempting.student_message, "It sounded right");
  });

  // 6. Live path: success, provider failure, invalid output, exception --------------------------
  type Store = import("../src/lib/services/student-assessment/item-administration-tutor").ItemAdministrationTutorAgentCallStore;
  const creates: Array<Record<string, unknown>> = [];
  const updates: Array<{ id: string; data: Record<string, unknown> }> = [];
  const store: Store = {
    async create(data) {
      creates.push(data as Record<string, unknown>);
      return { id: `call-${creates.length}`, client_request_id: (data.client_request_id as string | null | undefined) ?? null };
    },
    async update(id, data) {
      updates.push({ id, data: data as Record<string, unknown> });
      return { id };
    }
  };
  const requests: Array<{ instructions: string; input: unknown; schema_name: string }> = [];
  const providerFor = (behaviour: () => Partial<ProviderResult> | Error): LlmProvider => ({
    async executeStructured(request) {
      requests.push({ instructions: request.instructions, input: request.input, schema_name: request.schema_name });
      const outcome = behaviour();
      if (outcome instanceof Error) throw outcome;
      return { provider: "openai", client_request_id: request.client_request_id, latency_ms: 5, raw_output: { id: "resp_unit" }, ...outcome } as never;
    }
  });
  const run = (text: string, overrides: Partial<Packet> = {}, audit = true) =>
    tutor.runItemAdministrationTutor({
      state_packet: { ...contextPacket, ...overrides, latest_student_message: text },
      stage: overrides.required_evidence_type === "tempting_reason" ? "initial_tempting_reason" : "initial_item_reasoning",
      text,
      item_stem: "Which item discriminates best?",
      item_options: options,
      audit_context: audit
        ? { assessment_session_db_id: "session-1", concept_unit_session_db_id: "unit-1", agent_invocation_key: `key-${Math.random()}` }
        : undefined
    });
  const authValid = async () => ({ auth_status: "valid" as const, auth_checked_at: new Date().toISOString(), auth_check_error_code: null });
  const live = <T>(provider: LlmProvider, body: () => Promise<T>) =>
    withEnv(LIVE_ENV, () => readiness.withAssessmentTutorAuthCheckForTest(authValid, () =>
      tutor.withItemAdministrationTutorAgentCallStoreForTest(store, () =>
        tutor.withItemAdministrationTutorProviderForTest(provider, body))));

  await check("A validated model output is used, audited, and the model sees only the 9.3 input", async () => {
    await live(providerFor(() => ({ status: "completed", parsed_output: { action: "accept", saved_question: null } })), async () => {
      const before = { creates: creates.length, updates: updates.length, requests: requests.length };
      const result = await run("Because the slope is steeper.");
      assert.equal(result.item_admin_tutor_source, "live_llm");
      assert.equal(result.collection_action, "accept");
      assert.equal(result.should_advance, true);
      assert.equal(result.agent_call_id, `call-${before.creates + 1}`);
      const request = requests[before.requests];
      assert.equal(request.instructions, tutor.ITEM_ADMINISTRATION_TUTOR_INSTRUCTIONS);
      assert.equal(request.schema_name, "item-admin-tutor-output-v2");
      assert.deepEqual(request.input, tutor.buildItemAdministrationTutorModelInput({
        state_packet: contextPacket, item_stem: "Which item discriminates best?", item_options: options
      }));
      assert.doesNotMatch(JSON.stringify(request.input), /SECRET|correct|rationale/i);
      const created = creates[before.creates];
      assert.equal(created.prompt_version, "item-admin-tutor-v4");
      assert.equal(created.schema_version, "item-admin-tutor-output-v2");
      assert.equal(created.prompt_hash, tutor.ITEM_ADMINISTRATION_TUTOR_PROMPT_HASH);
      assert.equal(created.agent_version, "item-administration-tutor-v4");
      assert.deepEqual(created.input_payload, request.input, "The audit row stores exactly what the model saw");
      const update = updates[before.updates];
      assert.equal(update.data.call_status, "succeeded");
      assert.equal(update.data.output_validated, true);
      assert.equal((update.data.output_payload as Record<string, unknown>).collection_action, "accept");
      assert.doesNotMatch(JSON.stringify(update.data.raw_output), /SECRET-(DISTRACTOR|TARGET|EXPECTED|MISCONCEPTION|OPTION)/,
        "The audit context records flags and hashes, not the protected text");
    });
    await live(providerFor(() => ({ status: "completed", parsed_output: { action: "clarify_once", saved_question: null } })), async () => {
      const first = await run("because the");
      assert.equal(first.collection_action, "clarify_once");
      assert.equal(first.should_advance, false);
      const second = await run("because the", { prior_neutral_clarification_count: 1, prior_neutral_prompt_count: 1 });
      assert.equal(second.collection_action, "accept");
      assert.equal(second.application_override, "clarification_already_used");
      assert.equal((requests.at(-1)?.input as { clarification_already_used: boolean }).clarification_already_used, true);
    });
  });

  const failures: Array<{ name: string; behaviour: () => Partial<ProviderResult> | Error; status: string; live_status: string }> = [
    { name: "timeout", behaviour: () => ({ status: "failed", error: { category: "timeout", message: "timed out", retryable: true } }), status: "failed", live_status: "fallback_after_provider_failure" },
    { name: "quota", behaviour: () => ({ status: "failed", error: { category: "quota", message: "quota exceeded", retryable: false } }), status: "failed", live_status: "fallback_after_provider_failure" },
    { name: "provider error", behaviour: () => ({ status: "failed", error: { category: "provider_5xx", message: "server error", retryable: true } }), status: "failed", live_status: "fallback_after_provider_failure" },
    { name: "refusal", behaviour: () => ({ status: "refused", refusal: "refused" }), status: "failed", live_status: "fallback_after_provider_failure" },
    { name: "incomplete output", behaviour: () => ({ status: "incomplete", incomplete_reason: "max_output_tokens" }), status: "failed", live_status: "fallback_after_provider_failure" },
    { name: "thrown exception", behaviour: () => new Error("socket hang up"), status: "failed", live_status: "fallback_after_provider_failure" },
    { name: "invalid output", behaviour: () => ({ status: "completed", parsed_output: { message_classification: "usable_reasoning", should_advance: true } }), status: "invalid_output", live_status: "fallback_after_validation_failure" },
    { name: "unknown action", behaviour: () => ({ status: "completed", parsed_output: { action: "advance", saved_question: null } }), status: "invalid_output", live_status: "fallback_after_validation_failure" }
  ];

  const assertFallbackBehaviour = async (runText: (text: string, overrides?: Partial<Packet>) => Promise<Result>, source: string) => {
    for (const text of TYPED_REASONS) {
      const result = await runText(text);
      assert.equal(result.should_advance, true, `A typed reason or honest uncertainty is accepted: ${JSON.stringify(text)}`);
      assert.equal(result.collection_action, "accept");
      assert.equal(result.fallback_used, true);
      assert.equal(result.item_admin_tutor_source, source);
      assert.ok(result.fallback_reason, "The fallback reason is recorded");
      assert.ok(result.deterministic_classification, "The deterministic label is recorded");
      assert.equal(result.response_quality, "not_judged");
      assert.equal(responseQuality.responseQualityAllowsAdvance(result.response_quality_result.output), true);
    }
    const tempting = await runText("It sounded familiar from class", { required_evidence_type: "tempting_reason", assessment_state: "AWAIT_TEMPTING_REASON" });
    assert.equal(tempting.should_advance, true, "Tempting-option reasons are accepted too");
    const mixed = await runText("I picked B because the slope is steeper, but what does theta mean?");
    assert.equal(mixed.should_advance, true);
    assert.ok(mixed.deferred_concern_summary, "The question in a mixed reply is saved");
    const question = await runText("What is theta?");
    assert.equal(question.collection_action, "defer_question");
    assert.ok(question.deferred_concern_summary);
    for (const text of NOT_A_RESPONSE) {
      const result = await runText(text);
      assert.equal(result.should_advance, false, `One neutral prompt for ${JSON.stringify(text)}`);
      assert.equal(result.collection_action, "redirect");
      assert.match(result.student_facing_message, /^Let's stay with this question\./);
      const afterPrompt = await runText(text, { prior_neutral_prompt_count: 1 });
      assert.equal(afterPrompt.should_advance, true, "A model failure never holds a student after one prompt");
      assert.equal(afterPrompt.application_override, "fallback_prompt_already_given");
    }
    const fragment = await runText("B");
    assert.equal(fragment.collection_action, "clarify_once");
    for (const text of EMPTY) {
      for (const prompts of [0, 3]) {
        const result = await runText(text, { prior_neutral_prompt_count: prompts, prior_neutral_clarification_count: prompts });
        assert.equal(result.should_advance, false, "Empty text is never accepted");
        assert.equal(result.application_override, "empty_response");
      }
    }
  };

  for (const failure of failures) {
    await check(`Provider ${failure.name}: deterministic fallback accepts typed reasons, prompts once otherwise`, async () => {
      await live(providerFor(failure.behaviour), async () => {
        const before = updates.length;
        await assertFallbackBehaviour((text, overrides = {}) => run(text, overrides), "deterministic_fallback_after_live_failure");
        const result = await run("Because the slope is steeper.");
        assert.equal(result.live_status, failure.live_status);
        assert.equal(result.provider, "openai");
        assert.equal(result.model_action, null);
        assert.ok(result.agent_call_id);
        const update = updates.at(-1)!;
        assert.equal(update.id, result.agent_call_id);
        assert.equal(update.data.call_status, failure.status);
        assert.equal(update.data.output_validated, false);
        const payload = update.data.output_payload as Record<string, unknown>;
        assert.equal(payload.collection_fallback_used, true);
        assert.equal(payload.collection_action, "accept");
        assert.ok(updates.length > before);
      });
    });
  }

  await check("Configuration and readiness failures fall back the same way, without a model call", async () => {
    const callsBefore = requests.length;
    const createsBefore = creates.length;
    // No server-side key: readiness reports configuration_blocked.
    await withEnv({ ...LIVE_ENV, OPENAI_API_KEY: undefined }, async () => {
      await assertFallbackBehaviour((text, overrides = {}) => run(text, overrides), "deterministic_fallback_after_configuration_block");
      const result = await run("Because the slope is steeper.");
      assert.equal(result.live_status, "fallback_after_configuration_block");
      assert.match(result.fallback_reason ?? "", /openai_key_missing/);
    });
    // The readiness check with the provider fails (for example quota or authentication).
    await withEnv(LIVE_ENV, () => readiness.withAssessmentTutorAuthCheckForTest(
      async () => ({ auth_status: "invalid" as const, auth_checked_at: new Date().toISOString(), auth_check_error_code: "openai_quota_exceeded" }),
      async () => {
        await assertFallbackBehaviour((text, overrides = {}) => run(text, overrides), "deterministic_fallback_after_configuration_block");
        assert.match((await run("Because the slope is steeper.")).fallback_reason ?? "", /openai_quota_exceeded/);
      }
    ));
    // Live mode is ready but the call has no audit context.
    await live(providerFor(() => ({ status: "completed", parsed_output: { action: "redirect", saved_question: null } })), async () => {
      const result = await run("Because the slope is steeper.", {}, false);
      assert.equal(result.should_advance, true);
      assert.equal(result.fallback_reason, "audit_context_missing");
    });
    assert.equal(requests.length, callsBefore, "No model call was attempted");
    assert.equal(creates.length, createsBefore, "No audit row is opened when no call is made");
  });

  await check("Mock mode uses the deterministic rules without the fallback allowance", async () => {
    const reason = await run("Because the slope is steeper.");
    assert.equal(reason.item_admin_tutor_source, "deterministic_mock");
    assert.equal(reason.fallback_used, false);
    assert.equal(reason.should_advance, true);
    const gibberish = await run("asdfghjkl", { prior_neutral_prompt_count: 2 });
    assert.equal(gibberish.should_advance, false, "Only a model failure relaxes the redirect");
    const fragment = await run("B");
    assert.equal(fragment.collection_action, "clarify_once");
    const afterClarification = await run("B", { prior_neutral_clarification_count: 1 });
    assert.equal(afterClarification.collection_action, "accept");
    assert.equal(afterClarification.application_override, "clarification_already_used");
    const empty = await run("   ");
    assert.equal(empty.item_admin_tutor_source, "application_rule");
    assert.equal(empty.should_advance, false);
  });

  await check("Research payload keys mark v4 records", () => {
    const fields = tutor.itemAdministrationCollectionAuditFields(fromModel("clarify_once", { prior_neutral_clarification_count: 1 }, "because"));
    assert.deepEqual(fields, {
      collection_action: "accept",
      collection_model_action: "clarify_once",
      collection_decision_source: "application_rule",
      collection_application_override: "clarification_already_used",
      collection_fallback_used: false,
      collection_deterministic_classification: null
    });
    assert.equal(responseQuality.responseQualityAllowsAdvance({
      response_quality: "off_task_or_unreadable", should_advance: true, engagement_signal: "unclear",
      reasoning_signal: "not_applicable", student_facing_message: "x", next_expected_action: "continue"
    }), false);
  });

  console.log(`\n${passed} item administration v4 checks passed.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
