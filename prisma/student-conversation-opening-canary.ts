import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadEnvConfig } from "@next/env";
import { buildCanonicalEvidenceCatalog } from "../src/lib/domain/canonical-evidence-identity";
import { createCanonicalMisconceptionClaimCatalog } from "../src/lib/domain/misconception-claim-identity";
import { OpenAIResponsesProvider } from "../src/lib/llm/providers/openai-responses-provider";
import { FormativeConversationV18R2AgentInputSchema } from "../src/lib/services/student-assessment/formative-conversation/agent-contract-v18r2";
import { buildFormativeConversationV18R2ProductionRequest, FORMATIVE_CONVERSATION_V18R2_PROMPT_HASH, FORMATIVE_CONVERSATION_V18R2_PROMPT_VERSION } from "../src/lib/services/student-assessment/formative-conversation/live-runner-v18r2";
import { executeFormativeConversationV18R2, createSingleAttemptFormativeConversationV18R2Execution } from "../src/lib/services/student-assessment/formative-conversation/execution-v18r2";
import { validateFormativeInterpretation, prepareFormativeInterpretationResult } from "../src/lib/services/student-assessment/formative-conversation/interpretation-policy";
import { v18r2TestContext } from "./formative-conversation-v18r2-test-fixtures";

// Synthetic reasoning, not copies of classroom records. Review semantic quality separately.
const cases = [
  { id: "correct_concise", reason: "A blueprint checks whether the questions cover the communication skills we want to assess.",
    tempting: null, explanation: null, criterion: "Acknowledge the specific coverage idea without calling brevity an error or demanding more evidence by default." },
  { id: "label_explanation_mismatch", reason: "The blueprint and expert review can reveal missing parts of communication.",
    tempting: "A", explanation: "I considered checking agreement with an established external communication measure, but coverage seems more relevant here.",
    criterion: "Neutrally clarify external-measure comparison versus option A's between-item correlations; do not diagnose a rejected temptation or change the recorded label." },
  { id: "rejected_temptation", reason: "The blueprint helps identify communication skills missing from these questions.",
    tempting: "A", explanation: "I considered keeping strongly correlated items, but rejected that because they could all test the same narrow skill and miss other skills.",
    criterion: "Recognize the explicit correct rejection; do not teach as though the student still believes correlation guarantees coverage." }
];

function contextFor(scenario: typeof cases[number]) {
  const context = v18r2TestContext({ student_turn_count: 0, max_student_turns: 30, conversation_public_id: `synthetic-opening-${scenario.id}` });
  context.administered_items = [{ item_public_id: "synthetic_communication", item_number: 1,
    item_stem: "An assessment should cover explaining, listening and checking understanding, but its questions cover only explaining. Which review addresses the gap?",
    options: [{ label: "A", text: "Keep items that correlate strongly with the total score." },
      { label: "B", text: "Map questions to a domain blueprint and ask experts to check coverage." },
      { label: "C", text: "Correlate scores with an established external communication measure." }],
    student_answer: "B", correct_answer: "B", concise_explanation: "A blueprint and expert review address domain coverage; strong correlations alone do not establish it.", administered: true }];
  context.assessment_response_evidence = [{ ...context.assessment_response_evidence[0], item_public_id: "synthetic_communication",
    selected_option: "B", correctness: "correct", written_reasoning: scenario.reason, confidence: "medium",
    tempting_option: scenario.tempting, tempting_option_reason: scenario.explanation }];
  context.assessment_process_evidence = [];
  context.allowed_evidence_catalog = buildCanonicalEvidenceCatalog({ evidence_namespace_public_id: context.conversation_public_id,
    assessment_public_id: context.assessment_public_id, concept_unit_public_id: context.concept_unit_public_id,
    conversation_public_id: context.conversation_public_id, assessment_responses: context.assessment_response_evidence, transcript: [] });
  context.allowed_misconception_claim_catalog = createCanonicalMisconceptionClaimCatalog({ identity_scope: context.conversation_public_id, indicators: [] });
  const profile = context.current_profile.canonical_profile!;
  Object.assign(profile, { ability_profile: "mostly_correct_understanding", ability_pattern_flags: [],
    engagement_profile: "insufficient_process_evidence", engagement_pattern_flags: [],
    integrated_diagnostic_profile: "correct_but_independence_uncertain", integrated_profile_confidence: "medium",
    integrated_profile_rationale: "The explanation correctly identifies content coverage. No independent application has been sampled.",
    evidence_sufficiency: "adequate", confidence_alignment: "insufficient_evidence", independence_interpretability: "independent_understanding_uncertain",
    misconception_indicators: [], item_level_evidence: [scenario.reason], reasoning_quality_summary: "A concise supported content-coverage explanation.",
    engagement_summary: "No engagement inference.", profile_confidence: "medium", rationale: "Limited to the administered response.",
    recommended_next_evidence: scenario.id === "label_explanation_mismatch" ? ["Clarify the alternative label and reason without inferring endorsement."] : [] });
  context.current_profile = { ...context.current_profile, canonical_profile: profile,
    misconception_claim_catalog: context.allowed_misconception_claim_catalog,
    evidence_summary: [scenario.reason], unresolved_evidence: profile.recommended_next_evidence, evidence_limitations: ["Single initial response only."] };
  context.initial_profile = structuredClone(context.current_profile);
  context.safety_boundary.administered_item_public_ids = ["synthetic_communication"];
  return FormativeConversationV18R2AgentInputSchema.parse(context);
}

async function main() {
  const dry = process.argv.includes("--dry-run");
  assert(dry || process.env.RUN_CLASSROOM_DIALOGUE_CANARY === "true", "Explicit live evaluation opt-in required.");
  loadEnvConfig(process.cwd(), true);
  const model = process.env.ASSESSMENT_QUALITY_MODEL;
  assert(model, "Specify evaluation model.");
  const dir = mkdtempSync(join(tmpdir(), "cmcq-natural-openings-"));
  const config = { model_name: model, reasoning_effort: "medium" as const, max_output_tokens: 10000 };
  const report = { synthetic_only: true, database_writes: false, criteria: cases,
    prompt_version: FORMATIVE_CONVERSATION_V18R2_PROMPT_VERSION, prompt_sha256: FORMATIVE_CONVERSATION_V18R2_PROMPT_HASH,
    config, manual_review: "pending_non_independent_review", calls: 0, results: [] as unknown[] };
  const save = () => writeFileSync(join(dir, "results.json"), JSON.stringify(report, null, 2));
  const provider = dry ? null : new OpenAIResponsesProvider({ isolated_evaluation_runtime: { purpose: "bounded_candidate_evaluation", request_timeout_ms: 120000 } });
  console.log(`Artifacts: ${dir}`);
  for (const scenario of cases) {
    const context = contextFor(scenario);
    const id = randomUUID();
    const request = buildFormativeConversationV18R2ProductionRequest({ context, model_config: config, client_request_id: id, invocation_key: id, timeout_ms: 120000 });
    if (dry) { report.results.push({ id: scenario.id, context_valid: true }); continue; }
    const attempts: unknown[] = [];
    const execution = await executeFormativeConversationV18R2({ base_request: request,
      validate_candidate: candidate => validateFormativeInterpretation({ candidate, context }),
      execute_logical_generation: async ({ request: generatedRequest, sequence }) => {
        assert(++report.calls <= cases.length * 2, "Live-call ceiling exceeded.");
        const result = await provider!.executeStructured(generatedRequest);
        attempts.push({ sequence, status: result.status, output: result.parsed_output, latency_ms: result.latency_ms,
          usage: result.usage, provider_response_id: result.provider_response_id ?? null });
        save();
        return createSingleAttemptFormativeConversationV18R2Execution({ logical_call_id: `${id}:${sequence}`, request: generatedRequest,
          result: prepareFormativeInterpretationResult(result, context) });
      } });
    const output = execution.result.parsed_output;
    assert.equal(output.outcome, "continue_conversation");
    assert.equal(output.profile_transition_recommendation, null);
    assert.equal(output.evidence_observations.length, 0);
    report.results.push({ id: scenario.id, input_sha256: createHash("sha256").update(JSON.stringify(context)).digest("hex"), context, output, attempts, audit: execution.audit });
    save();
    console.log(JSON.stringify({ id: scenario.id, accepted: true, calls: attempts.length, message: output.student_visible_message }));
  }
  save();
}
main().catch(error => { console.error(error instanceof Error ? error.message : "opening_canary_failed"); process.exitCode = 1; });
