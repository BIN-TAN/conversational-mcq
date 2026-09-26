import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadEnvConfig } from "@next/env";
import { buildCanonicalEvidenceCatalog } from "../src/lib/domain/canonical-evidence-identity";
import { compileProductionStructuredAgentRequest } from "../src/lib/agents/provider-request";
import { OpenAIResponsesProvider } from "../src/lib/llm/providers/openai-responses-provider";
import { FormativeConversationV18R2AgentInputSchema, FormativeConversationV18R2AgentOutputSchema, type FormativeConversationV18R2AgentInput, type FormativeConversationV18R2AgentOutput } from "../src/lib/services/student-assessment/formative-conversation/agent-contract-v18r2";
import { validateFormativeConversationV18R2CandidateAcceptance } from "../src/lib/services/student-assessment/formative-conversation/candidate-validation-v18r2";
import { validateFormativeConversationV18Transition } from "../src/lib/services/student-assessment/formative-conversation/evidence-identity-validator-v18";
import { createSingleAttemptFormativeConversationV18R2Execution, executeFormativeConversationV18R2, FormativeConversationV18R2ExecutionError } from "../src/lib/services/student-assessment/formative-conversation/execution-v18r2";
import { buildFormativeConversationV18R2ProductionRequest, FORMATIVE_CONVERSATION_V18R2_PROMPT_HASH, FORMATIVE_CONVERSATION_V18R2_PROMPT_VERSION } from "../src/lib/services/student-assessment/formative-conversation/live-runner-v18r2";
import { formativeConversationV18R2LifecycleForTurnCount } from "../src/lib/services/student-assessment/formative-conversation/lifecycle-contract-v18r2";
import { v18r2TestContext } from "./formative-conversation-v18r2-test-fixtures";
import { FRESH_DIALOGUE_CASES } from "../src/lib/evaluation/fresh-dialogue-cases";
import { prepareFormativeInterpretationResult, validateFormativeInterpretation } from "../src/lib/services/student-assessment/formative-conversation/interpretation-policy";

const originalCases = [
  {
    id: "false_explanation_then_assent",
    messages: ["I still agree with option B: high reliability proves that the intended interpretation is valid. Its explanation is my reason.", "Okay, yes, I understand now."],
    expected: ["Treat false-explanation adoption as meaningful evidence, not copying; correct reliability versus validity.", "Generic agreement must not resolve either baseline claim or establish mastery."],
    forbid_sound: [true, true], must_retain: [[], [0, 1]], pause: false
  },
  {
    id: "correct_adoption_then_application",
    messages: ["I now accept option A's explanation: consistency alone does not establish validity. I agree with that explanation, rather than B. I have not worked out SEM yet.", "For a hiring test, consistent scores could reflect vocabulary rather than job skill, so I would need evidence about the intended job-performance interpretation. For an observed score of 76 and SEM of 3, 73 to 79 is a range of uncertainty, not proof that the exact true score is 73, 76, or 79."],
    expected: ["Recognize the corrected position without dismissing borrowed wording; no independent-transfer claim; retain untested SEM.", "Acknowledge substantive application of both concepts; do not demand novel wording or ignore either corrected explanation."],
    forbid_sound: [true, false], must_retain: [[1], []], pause: false
  },
  {
    id: "rejected_temptation_then_uncertainty",
    messages: ["B was tempting because repeated scores looked convincing, but I reject its claim that consistency proves validity. I am describing why it tempted me, not saying I still believe it.", "I am unsure about SEM. Does it really tell me one exact true score? I am asking, not claiming that it does."],
    expected: ["Interpret negation and past temptation correctly; do not label the current statement as endorsing B.", "Answer the question and distinguish uncertainty from a newly asserted false belief; prior SEM error is unverified, not confirmed by the question."],
    forbid_sound: [true, true], must_retain: [[1], [1]], pause: false
  },
  {
    id: "compound_agreement_then_disambiguation",
    messages: ["I agree with the explanation that high reliability proves validity and SEM gives an exact true score. I have not separated the two parts in my mind.", "Now I reject the first part: consistent scores still need evidence for the intended use. I still think SEM lets us calculate an exact true score, though."],
    expected: ["Keep the two existing baseline errors distinct; clarify the compound statement without claiming extra independent evidence for every clause.", "Acknowledge only the first correction, address the remaining SEM error, and do not declare global mastery."],
    forbid_sound: [true, true], must_retain: [[0, 1], [1]], pause: false
  },
  {
    id: "one_error_corrected_other_persists",
    messages: ["I changed my view of reliability: stable scores can consistently measure the wrong thing, so they do not by themselves justify the intended interpretation. But SEM still tells us the exact true score.", "If the observed score is 76 and SEM is 3, I still think the exact true score must be 73. Subtracting the error should remove it, right?"],
    expected: ["Credit the reliability correction and focus on the independent SEM misconception; do not repeat the entire reliability lesson.", "Explain why SEM is an uncertainty estimate rather than the signed error for this student; retain the unresolved claim."],
    forbid_sound: [true, true], must_retain: [[1], [1]], pause: false
  },
  {
    id: "direct_help_then_pause",
    messages: ["I am frustrated. Please just explain both ideas in plain language with one example. Do not quiz me right now.", "I am tired and want to pause now. Please do not give me another question."],
    expected: ["Provide helpful direct instruction without a mandatory comprehension question or diagnosis of disengagement.", "Respect stopping intent with a pause recommendation; do not invent improvement or ask another question."],
    forbid_sound: [true, true], must_retain: [[0, 1], [0, 1]], pause: true
  }
] as const;

const cases = process.argv.includes("--fresh") ? FRESH_DIALOGUE_CASES : originalCases;

const items: FormativeConversationV18R2AgentInput["administered_items"] = [
  { item_public_id: "measurement_reliability", item_number: 1,
    item_stem: "A hiring test has highly consistent scores. What does this establish?",
    options: [{ label: "A", text: "Consistency alone does not establish validity for the intended interpretation and use." },
      { label: "B", text: "High reliability automatically proves validity for the intended use." }],
    student_answer: "B", correct_answer: "A", concise_explanation: "Reliability concerns consistency; validity concerns evidence supporting the intended score interpretation and use.", administered: true },
  { item_public_id: "standard_error_measurement", item_number: 2,
    item_stem: "What can a standard error of measurement tell us about an observed score?",
    options: [{ label: "A", text: "It estimates score uncertainty; it does not identify an exact individual true score." },
      { label: "B", text: "It identifies the exact true score by subtracting the error from the observed score." }],
    student_answer: "B", correct_answer: "A", concise_explanation: "SEM is not the signed error in an individual's observed score. It describes measurement uncertainty under the measurement model.", administered: true }
];

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

function refresh(context: FormativeConversationV18R2AgentInput) {
  context.allowed_evidence_catalog = buildCanonicalEvidenceCatalog({
    evidence_namespace_public_id: context.conversation_public_id,
    assessment_public_id: context.assessment_public_id, concept_unit_public_id: context.concept_unit_public_id,
    conversation_public_id: context.conversation_public_id,
    assessment_responses: context.assessment_response_evidence,
    assessment_process: context.assessment_process_evidence.map(event => ({ ...event, source_public_id: "v18r2-test-process-package-submitted" })),
    transcript: context.visible_transcript
  });
  const students = context.visible_transcript.filter(turn => turn.actor === "student");
  context.latest_student_message = students.at(-1)?.message_text ?? null;
  context.formative_lifecycle = formativeConversationV18R2LifecycleForTurnCount(students.length, 30);
  context.telemetry_summary.observable_student_turn_count = students.length;
  context.telemetry_summary.observable_tutor_turn_count = context.visible_transcript.length - students.length;
  context.telemetry_summary.latest_activity_at = context.visible_transcript.at(-1)?.created_at ?? null;
  return FormativeConversationV18R2AgentInputSchema.parse(context);
}

function append(context: FormativeConversationV18R2AgentInput, actor: "student" | "tutor", message: string) {
  const index = (context.visible_transcript.at(-1)?.sequence_index ?? 0) + 1;
  context.visible_transcript.push({ sequence_index: index, actor, message_text: message,
    created_at: new Date(Date.parse(context.visible_transcript.at(-1)?.created_at ?? "2026-09-26T12:00:00.000Z") + 1000).toISOString() });
  return refresh(context);
}

function updateProfile(context: FormativeConversationV18R2AgentInput, output: FormativeConversationV18R2AgentOutput) {
  const transition = validateFormativeConversationV18Transition({ conversation_public_id: context.conversation_public_id,
    prior_profile_evidence_cutoff_sequence_index: context.current_profile.evidence_cutoff_sequence_index,
    recommendation: output.profile_transition_recommendation, prior_profile: context.current_profile.canonical_profile,
    prior_misconception_claim_catalog: context.allowed_misconception_claim_catalog,
    allowed_evidence_catalog: context.allowed_evidence_catalog, evidence_observations: output.evidence_observations });
  assert(transition.valid, "Accepted output must retain a valid transition.");
  if (!transition.terminal || !transition.updated_profile || !transition.updated_misconception_claim_catalog) return;
  assert.notEqual(output.outcome, "continue_conversation");
  if (output.outcome === "continue_conversation") throw new Error("invalid_terminal_outcome");
  const profileVersion = `${context.conversation_public_id}:profile:${context.formative_lifecycle.student_turn_index}`;
  const tutorSequence = context.visible_transcript.at(-1)!.sequence_index + 1;
  const tutorCreatedAt = new Date(Date.parse(context.visible_transcript.at(-1)!.created_at) + 1000).toISOString();
  context.current_profile = { ...context.current_profile, profile_version: profileVersion,
    evidence_cutoff_sequence_index: tutorSequence,
    outcome: output.outcome, canonical_profile: transition.updated_profile,
    misconception_claim_catalog: transition.updated_misconception_claim_catalog,
    evidence_summary: output.evidence_observations.map(observation => observation.observation),
    unresolved_evidence: transition.updated_profile.recommended_next_evidence,
    evidence_limitations: transition.updated_profile.process_interpretation_cautions };
  context.allowed_misconception_claim_catalog = transition.updated_misconception_claim_catalog;
  context.profile_history.push({ profile_version: profileVersion, outcome: output.outcome,
    created_at: tutorCreatedAt, evidence_source: "formative_conversation_agent" });
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  assert(dryRun || process.env.RUN_CLASSROOM_DIALOGUE_CANARY === "true", "Explicit bounded live-test opt-in required.");
  loadEnvConfig(process.cwd(), true);
  const model = process.env.ASSESSMENT_QUALITY_MODEL;
  assert(model, "Specify the evaluation model.");
  const config = { model_name: model, reasoning_effort: "medium" as const, max_output_tokens: 10000 };
  const recheckProfile = process.argv.includes("--recheck-profile");
  const recurrence = process.argv.includes("--recurrence");
  const closeRecurrence = process.argv.includes("--close-recurrence");
  assert(!closeRecurrence || recurrence, "Closure probe requires recurrence mode.");
  assert(!recurrence || recheckProfile, "Recurrence probe requires an actual validated parent profile.");
  const parentIndex = process.argv.indexOf(recheckProfile ? "--recheck-profile" : "--recheck-projection");
  const parentText = parentIndex < 0 ? null : readFileSync(process.argv[parentIndex + 1], "utf8");
  const parent = parentText ? JSON.parse(parentText) as {
    cases_sha256: string; config: unknown; prompt_sha256: string;
    results: Array<{ case_id: string; turn: number; accepted: boolean; context: unknown; output: unknown }>;
  } : null;
  if (parent) {
    assert.equal(parent.cases_sha256, hash(cases));
    assert.deepEqual(parent.config, config);
    if (!recurrence) assert.equal(parent.prompt_sha256, FORMATIVE_CONVERSATION_V18R2_PROMPT_HASH);
  }
  const selectedCases = (parent ? cases.filter(scenario => {
    const first = parent.results.find(row => row.case_id === scenario.id && row.turn === 1 && row.accepted);
    if (!first) return false;
    const output = FormativeConversationV18R2AgentOutputSchema.parse(first.output);
    return recheckProfile ? output.profile_transition_recommendation !== null : output.teaching_artifact !== null;
  }) : cases).filter(scenario => !recurrence || scenario.id === "new_context_boundary_reasoning").map(scenario => recurrence ? {
    ...scenario,
    messages: [scenario.messages[0], closeRecurrence
      ? "SEM is uncertainty, not a known signed error: subtracting it cannot give my exact true score. But I have reversed my view on the other point: I now believe perfectly reliable scores automatically validate any intended use, so no separate validity evidence is needed. That remains my position. Please finish our conversation now."
      : "I have reversed my view again: if reliability is nearly perfect, I now believe separate validity evidence is unnecessary. I also still believe subtracting SEM gives my exact true score. Please address both of these points."],
    expected: [scenario.expected[0], closeRecurrence
      ? "Acknowledge the SEM correction but preserve the explicitly recurring reliability error outside the active catalog. Ending must flag teacher review, not global mastery or silently erase the concern."
      : "Address the explicitly reappearing reliability-validity error after its validated resolution, as well as the still-active SEM error. Record uncatalogued evidence; do not invent canonical IDs or claim global mastery."],
    forbid_sound: [true, true], forbid_robust: [true, true], must_retain: [[1], closeRecurrence ? [] : [1]], pause: false
  } : scenario);
  assert(selectedCases.length > 0);
  const outputDir = mkdtempSync(join(tmpdir(), "cmcq-dialogue-probe-"));
  const sources = ["prisma/classroom-dialogue-canary.ts", "src/lib/evaluation/fresh-dialogue-cases.ts",
    "src/lib/services/student-assessment/formative-conversation/interpretation-policy.ts", "src/lib/services/student-assessment/formative-conversation/live-runner-v18r2.ts",
    "src/lib/services/student-assessment/formative-conversation/candidate-validation-v18r2.ts", "src/lib/services/student-assessment/formative-conversation/evidence-identity-validator-v18.ts",
    "src/lib/services/student-assessment/formative-conversation/execution-v18r2.ts", "src/lib/services/student-assessment/formative-conversation/runtime.ts",
    "prisma/formative-conversation-v18r2-test-fixtures.ts", "prisma/formative-conversation-v18-test-fixtures.ts"];
  const sourceHashes = () => Object.fromEntries(sources.map(path => [path, createHash("sha256").update(readFileSync(path)).digest("hex")]));
  const frozenHashes = sourceHashes();
  const report = { version: "classroom-dialogue-probe-v2", synthetic_only: true, real_student_data_used: false,
    intended_scope: "production tutor request, validators and bounded semantic regeneration; synthetic in-memory context, not full web/database or initial profiling pipeline",
    criteria_frozen_at: new Date().toISOString(), cases, cases_sha256: hash(cases), config,
    executed_cases: selectedCases, executed_cases_sha256: hash(selectedCases),
    prompt_version: FORMATIVE_CONVERSATION_V18R2_PROMPT_VERSION, prompt_sha256: FORMATIVE_CONVERSATION_V18R2_PROMPT_HASH,
    source_hashes: frozenHashes, source_unchanged: true, max_logical_calls: selectedCases.length * (parent ? 2 : 4),
    corrected_projection_parent_sha256: parentText ? createHash("sha256").update(parentText).digest("hex") : null,
    parent_prompt_sha256: parent?.prompt_sha256 ?? null,
    correction_kind: closeRecurrence ? "new_recurrence_at_conversation_closure" : recurrence ? "new_recurrence_after_validated_profile" : recheckProfile ? "persisted_profile_context_projection" : parent ? "visible_message_projection" : null,
    visible_projection: "student_visible_message_only_matching_runtime_persistence",
    provider_adapter_invocations: 0, http_requests_dispatched: 0, provider_responses_completed: 0,
    manual_review_status: "pending_non_independent_review", results: [] as unknown[] };
  const save = () => writeFileSync(join(outputDir, "results.json"), JSON.stringify(report, null, 2));
  save();
  console.log(`Evaluation artifacts: ${outputDir}`);
  const provider = dryRun ? null : new OpenAIResponsesProvider({ isolated_evaluation_runtime: { purpose: "bounded_candidate_evaluation", request_timeout_ms: 120000 } });
  let allValid = true;
  for (const scenario of selectedCases) {
    let context = v18r2TestContext({ student_turn_count: 1, max_student_turns: 30,
      student_messages: [scenario.messages[0]], conversation_public_id: `synthetic-dialogue-${scenario.id}` });
    context.administered_items = structuredClone(items);
    context.safety_boundary.administered_item_public_ids = items.map(item => item.item_public_id);
    const baselineClaimIds = context.allowed_misconception_claim_catalog.indicators.flatMap(entry => entry.claims.map(claim => claim.claim_id));
    context = refresh(context);
    if (parent) {
      const first = parent.results.find(row => row.case_id === scenario.id && row.turn === 1 && row.accepted)!;
      context = FormativeConversationV18R2AgentInputSchema.parse(first.context);
      const priorOutput = FormativeConversationV18R2AgentOutputSchema.parse(first.output);
      assert(validateFormativeConversationV18R2CandidateAcceptance({ candidate: priorOutput, context }).valid);
      updateProfile(context, priorOutput);
      context = append(context, "tutor", priorOutput.student_visible_message);
    }
    for (let turn = parent ? 1 : 0; turn < scenario.messages.length; turn++) {
      if (turn > 0) context = append(context, "student", scenario.messages[turn]);
      const inputSnapshot = structuredClone(context);
      const invocation = `${scenario.id}:${turn}:${randomUUID()}`;
      const request = buildFormativeConversationV18R2ProductionRequest({ context: inputSnapshot, model_config: config,
        client_request_id: invocation, timeout_ms: 120000, invocation_key: invocation });
      const compiled = compileProductionStructuredAgentRequest(request);
      assert.equal(compiled.store, false);
      if (dryRun) {
        report.results.push({ case_id: scenario.id, turn: turn + 1, context_valid: true, request_compiles: true });
        if (!turn) context = append(context, "tutor", "Dry-run placeholder; no semantic judgment.");
        continue;
      }
      const attempts: unknown[] = [];
      try {
        const execution = await executeFormativeConversationV18R2({ base_request: request,
          validate_candidate: candidate => validateFormativeInterpretation({ candidate, context: inputSnapshot }),
          execute_logical_generation: async ({ request: generationRequest, sequence, kind }) => {
            report.provider_adapter_invocations++;
            assert(report.provider_adapter_invocations <= report.max_logical_calls);
            const result = await provider!.executeStructured(generationRequest);
            if (result.transport_telemetry?.fetch_invoked) report.http_requests_dispatched++;
            if (result.transport_telemetry?.response_body_completed || result.transport_telemetry?.response_body_received) report.provider_responses_completed++;
            const prepared = prepareFormativeInterpretationResult(result, inputSnapshot);
            attempts.push({ sequence, kind, status: result.status, output: result.parsed_output ?? null,
              projected_output: prepared.parsed_output ?? null, projection_applied: prepared !== result,
              projection_audit: prepared !== result ? prepared.raw_output : null,
              latency_ms: result.latency_ms, usage: result.usage, error_category: result.error?.category ?? null });
            return createSingleAttemptFormativeConversationV18R2Execution({ logical_call_id: `${invocation}:${sequence}`, request: generationRequest, result: prepared });
          }
        });
        const output = execution.result.parsed_output;
        const checks = [
          { name: "no_premature_sound_understanding", pass: !scenario.forbid_sound[turn] || output.outcome !== "sound_understanding" },
          { name: "unresolved_claims_not_resolved", pass: scenario.must_retain[turn].every(index =>
            !output.profile_transition_recommendation?.misconception_claim_dispositions.some(claim => claim.claim_id === baselineClaimIds[index] && claim.disposition === "resolved")) },
          { name: "pause_intent_respected", pass: !scenario.pause || turn === 0 || output.lifecycle_recommendation === "pause" },
          { name: "no_unsupported_robust_transfer", pass: !("forbid_robust" in scenario && scenario.forbid_robust[turn]) ||
            (output.profile_transition_recommendation?.updated_profile?.ability_profile !== "robust_transfer_ready_understanding" &&
             output.profile_transition_recommendation?.updated_profile?.integrated_diagnostic_profile !== "robust_understanding_ready_for_transfer") },
          { name: "confidence_not_remeasured", pass: !output.profile_transition_recommendation?.updated_profile ||
            output.profile_transition_recommendation.updated_profile.confidence_alignment === inputSnapshot.current_profile.canonical_profile?.confidence_alignment },
          { name: "no_invisible_teaching_artifact", pass: output.teaching_artifact === null },
          ...(recurrence ? [{ name: "uncatalogued_recurrence_preserved", pass: output.evidence_observations.some(entry => entry.evidence_type === "uncatalogued_misconception") }] : []),
          ...(closeRecurrence ? [{ name: "uncatalogued_recurrence_teacher_review", pass: output.outcome === "teacher_assistance_recommended" &&
            output.teacher_assistance_recommendation.reason_code === "uncatalogued_misconception_requires_review" }] : [])
        ];
        report.results.push({ case_id: scenario.id, turn: turn + 1, expected: scenario.expected[turn],
          context: inputSnapshot, input_sha256: hash(inputSnapshot), accepted: true, output, checks,
          attempts, audit: execution.audit, synthetic_timestamp_warning: "Transcript timestamps are fixture values, not student response latencies." });
        allValid &&= checks.every(check => check.pass);
        console.log(JSON.stringify({ case_id: scenario.id, turn: turn + 1, accepted: true, checks, outcome: output.outcome, lifecycle: output.lifecycle_recommendation, calls: attempts.length }));
        updateProfile(context, output);
        // Runtime persists the message only; artifact text is not visible student evidence.
        context = append(context, "tutor", output.student_visible_message);
        if (output.lifecycle_recommendation === "pause" || output.lifecycle_recommendation === "complete") {
          if (turn < scenario.messages.length - 1) allValid = false;
          save();
          break;
        }
      } catch (error) {
        allValid = false;
        report.results.push({ case_id: scenario.id, turn: turn + 1, expected: scenario.expected[turn], context: inputSnapshot,
          input_sha256: hash(inputSnapshot), accepted: false, attempts,
          error_category: error instanceof FormativeConversationV18R2ExecutionError ? error.failure_category : "local_harness_error",
          audit: error instanceof FormativeConversationV18R2ExecutionError ? error.audit : null });
        console.log(JSON.stringify({ case_id: scenario.id, turn: turn + 1, accepted: false, error: error instanceof Error ? error.message : "unknown" }));
        save();
        break;
      }
      save();
    }
  }
  report.source_unchanged = hash(frozenHashes) === hash(sourceHashes());
  save();
  console.log(JSON.stringify({ output_dir: outputDir, provider_adapter_invocations: report.provider_adapter_invocations,
    http_requests_dispatched: report.http_requests_dispatched, provider_responses_completed: report.provider_responses_completed,
    source_unchanged: report.source_unchanged, mechanical_checks_passed: allValid, pedagogical_review: "still_required" }));
  process.exitCode = allValid && report.source_unchanged ? 0 : 1;
}

main().catch(error => { console.error(error instanceof Error ? error.message : "dialogue_probe_failed"); process.exitCode = 1; });
