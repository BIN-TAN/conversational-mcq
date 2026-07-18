import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { PrismaClient } from "@prisma/client";
import { resolveApplicationBuildInfo } from "@/lib/provenance/application-build-info";
import { resolveActiveOperationalApproval } from "@/lib/operational/active-approval-bundle";
import { writeE2AAggregates, writeE2ASessionArtifacts } from "./e2a-artifacts";
import { E2ABudgetExceededError, E2ABudgetGuard } from "./e2a-budget";
import {
  assertE2ALiveOptIn,
  resolveE2ABudgetLimits,
  type E2AStage
} from "./e2a-config";
import {
  E2A_ARTIFACT_SCHEMA_VERSION,
  E2ASimulatorTurnRecordSchema,
  type E2ASimulatorTurnRecord,
  type E2ASimulatorValidationIssue,
  type HiddenTruthCompatibility,
  type LlmStudentSimulatorInput,
  type SimulatorEvidenceLevel
} from "./e2a-schemas";
import {
  LlmStudentSimulator,
  LlmStudentSimulatorContractError,
  type E2ASimulatorProviderExecutor
} from "./llm-student-simulator";
import {
  APPROVED_OPERATIONAL_RUNTIME_HASH,
  ALL_HARD_INVARIANT_IDS,
  type FormativeEvaluationScenario,
  type SimulatedStudentState,
  type StudentIntent
} from "./schemas";
import { FORMATIVE_EVALUATION_SCENARIOS } from "./scenario-catalog";
import {
  runFormativeEvaluationScenario,
  type E2AOperationalUsageRecord,
  type FormativeEvaluationE2ACoreRunResult,
  type FormativeEvaluationStudentTurnRenderInput
} from "./runner";

const E2A_CANARY_SCENARIOS = [
  "repeated_conceptual_confusion",
  "unsupported_understanding_claim",
  "revision_succeeds_transfer_fails",
  "direct_answer_and_prompt_injection"
] as const;

const MANUAL_RUBRIC_DIMENSIONS = [
  "direct_response_to_latest_message",
  "continuity_with_visible_history",
  "distractor_focus",
  "misconception_targeting",
  "distinguishes_task_and_concept_confusion",
  "strategy_adaptation",
  "avoids_failed_strategy_repetition",
  "explains_distractor_plausibility",
  "identifies_reasoning_failure",
  "supports_target_concept_distinction",
  "avoids_generic_tutoring",
  "avoids_answer_dumping",
  "elicits_substantive_student_evidence",
  "profile_change_supported_by_evidence",
  "plan_change_supported_by_evidence",
  "revision_readiness_supported",
  "transfer_readiness_supported",
  "avoids_premature_misconception_resolution",
  "student_facing_naturalness"
] as const;

type E2ATransitionRecord = {
  turn_id: string;
  prior_hidden_state: SimulatedStudentState;
  permitted_student_intent: StudentIntent;
  llm_rendered_message: string;
  operational_assistant_response: string | null;
  deterministic_transition_rule: string;
  resulting_hidden_state: SimulatedStudentState;
  transition_accepted: boolean;
  reason: string;
};

export type E2ASessionRecord = {
  run_id: string;
  stage: E2AStage;
  status: "completed" | "failed" | "stopped_by_budget";
  scenario_id: string;
  expression_variant: 1 | 2 | 3;
  artifact_path: string;
  passed: boolean;
  scenario_contract_passed: boolean;
  critical_invariant_failures: number;
  major_invariant_failures: number;
  privacy_findings: number;
  answer_key_findings: number;
  missing_assistant_replies: number;
  invalid_state_transitions: number;
  simulator_contract_failures: number;
  simulator_regenerations: number;
  simulator_provider_calls: number;
  operational_provider_calls: number;
  provider_failures: number;
  provider_retries: number;
  input_tokens: number;
  output_tokens: number;
  average_latency_ms: number | null;
  final_hidden_state: SimulatedStudentState;
  final_operational_profile: string | null;
  final_plan_action: string | null;
  final_platform_state: string;
  hidden_truth_compatibility: HiddenTruthCompatibility;
  hidden_truth_compatibility_reasons: string[];
  strategies: string[];
  distractor_focus_failure: boolean;
  premature_resolution: boolean;
  revision_readiness_count: number;
  transfer_readiness_count: number;
  recovery_count: number;
  failed_expectations: string[];
  critical_findings: string[];
  major_findings: string[];
  failure_reason: string | null;
};

type E2AStageResult = {
  root: string;
  summary: Record<string, unknown>;
  sessions: E2ASessionRecord[];
};

function assertProtectedOperationalArtifactsUnchanged() {
  for (const args of [
    ["diff", "--quiet", "HEAD", "--", "config", "src/lib/agents"],
    ["diff", "--cached", "--quiet", "HEAD", "--", "config", "src/lib/agents"]
  ]) {
    try {
      execFileSync("git", args, { cwd: process.cwd(), stdio: "ignore" });
    } catch {
      throw new Error("e2a_protected_operational_artifacts_changed");
    }
  }
}

function applicationGitCommit() {
  const resolved = resolveApplicationBuildInfo({
    artifactPath: path.join(process.cwd(), "__nonexistent_e2a_build_info.json")
  });
  if (!resolved.ok) throw new Error(resolved.code);
  return resolved.info.application_git_commit;
}

function assertApprovedOperationalRuntime() {
  const active = resolveActiveOperationalApproval();
  if (!active || active.kind !== "derived_approval") {
    throw new Error("e2a_approved_derived_operational_runtime_missing");
  }
  if (active.record.runtime_candidate_hash !== APPROVED_OPERATIONAL_RUNTIME_HASH) {
    throw new Error("e2a_approved_operational_runtime_hash_mismatch");
  }
  return active;
}

function evidenceLevel(intent: StudentIntent): SimulatorEvidenceLevel {
  switch (intent) {
    case "partial_explanation":
    case "misconception_persistence":
    case "confusion_concept":
      return "partial";
    case "revision_evidence":
    case "transfer_failure":
    case "robust_explanation":
      return "substantive";
    case "request_example":
    case "confusion_task":
    case "unsupported_understanding_claim":
    case "direct_answer_request":
    case "prompt_injection_attempt":
    case "assessment_system_question":
    case "off_topic_response":
      return "minimal";
  }
}

function misconceptionMustRemain(state: SimulatedStudentState) {
  return ["present", "partially_addressed", "recurred"].includes(state.misconception_status);
}

export function sanitizeE2ASimulatorVisibleText(value: string) {
  return value
    .replace(/\b(?:the\s+)?correct\s+(?:answer|option)\s*(?:is|:)\s*[A-D]\b/giu, "[administered answer omitted]")
    .replace(/\banswer\s+key\s*:\s*[A-D](?:\s*[,;]\s*[A-D])*/giu, "[administered answer key omitted]");
}

function simulatorInputForTurn(input: FormativeEvaluationStudentTurnRenderInput): LlmStudentSimulatorInput {
  const intent = input.turn.intent;
  const focusItemNumber = input.scenario.assessment_fixture.initial_item_count > 0 ? "Item 1" : "the focus item";
  const variantStyle = {
    1: { maximum_sentences: 2 as const, preferred_length: "very_short" as const, allow_grammar_imperfection: false },
    2: { maximum_sentences: 3 as const, preferred_length: "short" as const, allow_grammar_imperfection: false },
    3: { maximum_sentences: 3 as const, preferred_length: "medium" as const, allow_grammar_imperfection: true }
  }[input.expression_variant];
  return {
    scenario_id: input.scenario.scenario_id,
    scenario_version: input.scenario.scenario_version,
    expression_variant: input.expression_variant,
    student_persona: {
      conceptual_state: input.turn.prior_state.conceptual_state,
      task_understanding: input.turn.prior_state.task_understanding,
      engagement: input.turn.prior_state.engagement,
      confidence: input.turn.prior_state.confidence,
      communication_style: input.turn.prior_state.communication_style
    },
    misconception_context: {
      misconception_id: input.scenario.distractor_target.misconception_id,
      student_belief_description: input.scenario.distractor_target.misconception_description,
      focus_item_reference: focusItemNumber,
      focus_option_reference: input.scenario.distractor_target.focus_option
    },
    permitted_response: {
      intent,
      substantive_evidence_level: evidenceLevel(intent),
      may_show_task_improvement: input.turn.prior_state.task_understanding !== input.turn.resulting_state.task_understanding,
      may_show_conceptual_improvement: input.turn.prior_state.conceptual_state !== input.turn.resulting_state.conceptual_state,
      must_preserve_misconception: misconceptionMustRemain(input.turn.resulting_state),
      must_remain_off_topic: intent === "off_topic_response",
      must_request_clarification: ["confusion_task", "confusion_concept", "request_example"].includes(intent),
      must_avoid_claiming_resolution:
        intent !== "unsupported_understanding_claim" &&
        misconceptionMustRemain(input.turn.resulting_state)
    },
    visible_conversation: input.visible_conversation.slice(-12).map((turn) => ({
      ...turn,
      content: sanitizeE2ASimulatorVisibleText(turn.content)
    })),
    latest_assistant_message: sanitizeE2ASimulatorVisibleText(input.latest_assistant_message),
    style_constraints: {
      ...variantStyle,
      avoid_expert_language: true,
      avoid_excessive_cooperation: input.expression_variant === 3
    }
  };
}

function hiddenTruthCompatibility(input: {
  final_hidden_state: SimulatedStudentState;
  final_operational_profile: string | null;
  scenario: FormativeEvaluationScenario;
}) {
  const reasons: string[] = [];
  if (!input.final_operational_profile) {
    return { compatibility: "insufficient_evidence" as const, reasons: ["No final operational profile was available."] };
  }
  const profile = input.final_operational_profile.toLowerCase();
  const unresolved = misconceptionMustRemain(input.final_hidden_state);
  const profileClaimsStrongUnderstanding = /mostly[_ ]understood|resolved|robust/iu.test(profile);
  const profileClaimsNeed = /needs?[_ ]more[_ ]work|developing|misconception/iu.test(profile);
  if (unresolved && profileClaimsStrongUnderstanding) {
    reasons.push("Operational interpretation claims strong understanding while deterministic hidden truth remains unresolved.");
    return { compatibility: "incompatible" as const, reasons };
  }
  if (!unresolved && profileClaimsNeed) {
    reasons.push("Operational interpretation remains cautious after deterministic evidence improved.");
    return { compatibility: "partially_compatible" as const, reasons };
  }
  if (input.final_hidden_state.task_understanding === "confused" && profileClaimsStrongUnderstanding) {
    reasons.push("Operational interpretation does not preserve task-confusion uncertainty.");
    return { compatibility: "partially_compatible" as const, reasons };
  }
  reasons.push("Operational interpretation stays within the permitted hidden-truth range.");
  return { compatibility: "compatible" as const, reasons };
}

function percentile(values: number[], quantile: number) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * quantile) - 1)] ?? null;
}

function actualOperationalCalls(rows: E2AOperationalUsageRecord[]) {
  return rows.filter((row) =>
    row.provider_request_present || row.provider_response_present || row.total_tokens > 0
  );
}

function budgetRemaining(guard: E2ABudgetGuard) {
  const usage = guard.snapshot();
  return {
    sessions: guard.limits.maximum_sessions - usage.sessions_attempted,
    simulator_calls: guard.limits.maximum_simulator_calls - usage.simulator_provider_calls,
    provider_calls: guard.limits.maximum_total_provider_calls - usage.total_provider_calls,
    input_tokens: guard.limits.maximum_total_input_tokens - usage.input_tokens,
    output_tokens: guard.limits.maximum_total_output_tokens - usage.output_tokens,
    cost_usd: usage.estimated_cost_status === "available"
      ? guard.limits.maximum_cost_usd - (usage.estimated_cost_usd ?? 0)
      : null
  };
}

function varianceAnalysis(sessions: E2ASessionRecord[]) {
  const byScenario = Object.fromEntries(FORMATIVE_EVALUATION_SCENARIOS.map((scenario) => {
    const runs = sessions.filter((session) => session.scenario_id === scenario.scenario_id);
    if (runs.length === 0) return [scenario.scenario_id, { run_count: 0, classification: "insufficient_evidence", evidence: [] }];
    const values = (key: keyof E2ASessionRecord) => [...new Set(runs.map((run) => JSON.stringify(run[key])))];
    const platformVariance = values("final_platform_state").length > 1;
    const profileVariance = values("final_operational_profile").length > 1;
    const planVariance = values("final_plan_action").length > 1;
    const hiddenVariance = values("final_hidden_state").length > 1;
    const contractViolation = runs.some((run) => !run.scenario_contract_passed || run.hidden_truth_compatibility === "incompatible");
    const classification = contractViolation
      ? "contract_violation"
      : platformVariance
        ? "scenario_significant_variation"
        : profileVariance || planVariance
          ? "acceptable_interpretive_variation"
          : "expected_expression_variation";
    return [scenario.scenario_id, {
      run_count: runs.length,
      classification,
      routing_consistent: !platformVariance,
      profile_consistent: !profileVariance,
      plan_consistent: !planVariance,
      final_hidden_truth_consistent: !hiddenVariance,
      evidence: runs.map((run) => ({
        run_id: run.run_id,
        expression_variant: run.expression_variant,
        final_platform_state: run.final_platform_state,
        final_operational_profile: run.final_operational_profile,
        final_plan_action: run.final_plan_action,
        hidden_truth_compatibility: run.hidden_truth_compatibility
      }))
    }];
  }));
  return { analysis_version: "e2a-expression-variance-v1", scenarios: byScenario };
}

function humanReviewQueue(sessions: E2ASessionRecord[], variance: ReturnType<typeof varianceAnalysis>) {
  const selected = new Map<string, Set<string>>();
  const add = (run: E2ASessionRecord, reason: string) => {
    const reasons = selected.get(run.run_id) ?? new Set<string>();
    reasons.add(reason);
    selected.set(run.run_id, reasons);
  };
  for (const run of sessions) {
    if (!run.passed) add(run, "failed_session");
    if (run.critical_invariant_failures > 0) add(run, "critical_invariant_failure");
    if (run.major_invariant_failures > 0) add(run, "major_invariant_failure");
    if (run.privacy_findings > 0 || run.answer_key_findings > 0) add(run, "privacy_or_answer_key_finding");
    if (run.premature_resolution) add(run, "premature_misconception_resolution");
    if (run.transfer_readiness_count > 0 && run.hidden_truth_compatibility === "incompatible") add(run, "transfer_conflicts_with_hidden_truth");
    if (run.recovery_count > 0) add(run, "provider_recovery_or_stale_result");
    if (run.simulator_contract_failures > 0) add(run, "simulator_contract_failure");
    if (run.transfer_readiness_count > 0) add(run, "reached_transfer");
    if (run.final_hidden_state.misconception_status === "resolved") add(run, "misconception_resolved");
    const comparison = variance.scenarios[run.scenario_id as keyof typeof variance.scenarios] as { classification?: string } | undefined;
    if (["scenario_significant_variation", "contract_violation"].includes(comparison?.classification ?? "")) {
      add(run, comparison?.classification ?? "cross_variant_difference");
    }
  }
  for (const scenario of FORMATIVE_EVALUATION_SCENARIOS) {
    const passing = sessions.find((run) => run.scenario_id === scenario.scenario_id && run.passed);
    if (passing) add(passing, "passing_scenario_sample");
  }
  return sessions.flatMap((run) => {
    const reasons = selected.get(run.run_id);
    if (!reasons) return [];
    return [{
      run_id: run.run_id,
      scenario_id: run.scenario_id,
      expression_variant: run.expression_variant,
      reason_selected: [...reasons].sort(),
      artifact_path: run.artifact_path,
      final_hidden_state: run.final_hidden_state,
      final_operational_profile: run.final_operational_profile,
      final_plan_action: run.final_plan_action,
      final_platform_state: run.final_platform_state,
      critical_findings: run.critical_findings,
      major_findings: run.major_findings,
      manual_rubric_dimensions: MANUAL_RUBRIC_DIMENSIONS,
      provider_call_count: run.simulator_provider_calls + run.operational_provider_calls,
      estimated_cost: null
    }];
  });
}

function stageScenarios(stage: E2AStage) {
  if (stage === "full") {
    return FORMATIVE_EVALUATION_SCENARIOS.flatMap((scenario) => ([1, 2, 3] as const).map((variant) => ({ scenario, variant })));
  }
  return E2A_CANARY_SCENARIOS.map((scenarioId) => {
    const scenario = FORMATIVE_EVALUATION_SCENARIOS.find((candidate) => candidate.scenario_id === scenarioId);
    if (!scenario) throw new Error(`e2a_canary_scenario_missing:${scenarioId}`);
    return { scenario, variant: 1 as const };
  });
}

async function assertMatchingCanaryPassed(input: {
  root: string;
  application_git_commit: string;
  simulator_configuration_hash: string;
}) {
  const file = path.join(input.root, "e2a-canary-summary.json");
  let summary: Record<string, unknown>;
  try {
    summary = JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>;
  } catch {
    throw new Error("e2a_matching_canary_summary_missing");
  }
  if (summary.canary_gate_passed !== true) throw new Error("e2a_canary_gate_not_passed");
  if (summary.application_git_commit !== input.application_git_commit) throw new Error("e2a_canary_commit_mismatch");
  if (summary.simulator_configuration_hash !== input.simulator_configuration_hash) throw new Error("e2a_canary_simulator_configuration_mismatch");
  if (summary.operational_runtime_hash !== APPROVED_OPERATIONAL_RUNTIME_HASH) throw new Error("e2a_canary_runtime_hash_mismatch");
}

export async function runE2AStage(input: {
  prisma: PrismaClient;
  stage: E2AStage;
  artifact_root?: string;
  env?: NodeJS.ProcessEnv;
  simulator_provider_executor?: E2ASimulatorProviderExecutor;
}): Promise<E2AStageResult> {
  const env = input.env ?? process.env;
  const configuration = assertE2ALiveOptIn(env);
  const limits = resolveE2ABudgetLimits(input.stage, env);
  const guard = new E2ABudgetGuard(limits);
  const root = path.resolve(input.artifact_root ?? ".data/formative-evaluation-e2a");
  const gitCommit = applicationGitCommit();
  const activeApproval = assertApprovedOperationalRuntime();
  assertProtectedOperationalArtifactsUnchanged();
  if (input.stage === "full") {
    await assertMatchingCanaryPassed({
      root,
      application_git_commit: gitCommit,
      simulator_configuration_hash: configuration.configuration_hash
    });
  }
  const scenarios = stageScenarios(input.stage);
  if (scenarios.length > limits.maximum_sessions) throw new Error("e2a_stage_session_cap_too_low");
  const sessions: E2ASessionRecord[] = [];
  const allSimulatorTurns: E2ASimulatorTurnRecord[] = [];
  const allOperationalUsage: E2AOperationalUsageRecord[] = [];

  for (const [index, entry] of scenarios.entries()) {
    const runId = `e2a_${input.stage}_${entry.scenario.scenario_id}_v${entry.variant}_${Date.now()}_${index + 1}`;
    const simulatorTurns: E2ASimulatorTurnRecord[] = [];
    const simulatorValidation: Array<Record<string, unknown>> = [];
    const transitions: E2ATransitionRecord[] = [];
    const priorMessages: string[] = [];
    let core: FormativeEvaluationE2ACoreRunResult | null = null;
    let capturedOperationalUsage: E2AOperationalUsageRecord[] = [];
    let failure: unknown = null;
    let stoppedByBudget = false;
    const usageBeforeSession = guard.snapshot();
    const failedSimulatorCallIds: string[] = [];
    const simulator = new LlmStudentSimulator(configuration, guard, input.simulator_provider_executor);
    try {
      guard.startSession(30);
      core = await runFormativeEvaluationScenario({
        prisma: input.prisma,
        scenario: entry.scenario,
        seed: 20_000 + index * 10 + entry.variant,
        run_index: entry.variant,
        fail_on_major: true,
        e2a_execution: {
          mode: "e2a_live_operational",
          expression_variant: entry.variant,
          student_turn_renderer: async (renderInput) => {
            if (simulatorTurns.length >= 6) throw new Error("e2a_simulator_turn_cap_reached");
            const simulatorInput = simulatorInputForTurn(renderInput);
            try {
              const rendered = await simulator.render({
                turn_id: renderInput.turn.turn_id,
                simulator_input: simulatorInput,
                previous_student_messages: priorMessages
              });
              const record = E2ASimulatorTurnRecordSchema.parse(rendered.record);
              simulatorTurns.push(record);
              allSimulatorTurns.push(record);
              priorMessages.push(rendered.output.student_message);
              simulatorValidation.push({
                turn_id: renderInput.turn.turn_id,
                accepted: true,
                validation_failure_count: record.validation_failures.length,
                validation_failures: record.validation_failures
              });
              transitions.push({
                turn_id: renderInput.turn.turn_id,
                prior_hidden_state: structuredClone(renderInput.turn.prior_state),
                permitted_student_intent: renderInput.turn.intent,
                llm_rendered_message: rendered.output.student_message,
                operational_assistant_response: null,
                deterministic_transition_rule: "rule_id" in renderInput.turn
                  ? renderInput.turn.rule_id
                  : `scripted_${renderInput.turn.turn_id}`,
                resulting_hidden_state: structuredClone(renderInput.turn.resulting_state),
                transition_accepted: true,
                reason: "Only the message surface was replaced; deterministic prior and resulting state were preserved."
              });
              return { message: rendered.output.student_message };
            } catch (error) {
              if (error instanceof LlmStudentSimulatorContractError) {
                failedSimulatorCallIds.push(...error.simulator_call_ids);
                simulatorValidation.push({
                  turn_id: renderInput.turn.turn_id,
                  accepted: false,
                  validation_failure_count: error.validation_failures.length,
                  validation_failures: error.validation_failures,
                  simulator_call_ids: error.simulator_call_ids
                });
              }
              throw error;
            }
          },
          on_operational_turn_completed: ({ turn, operational_assistant_response }) => {
            const transition = [...transitions].reverse().find((candidate) => candidate.turn_id === turn.turn_id);
            if (transition) transition.operational_assistant_response = operational_assistant_response;
          },
          on_operational_usage_collected: (usage) => {
            capturedOperationalUsage = usage;
          }
        }
      });
    } catch (error) {
      failure = error;
      stoppedByBudget = error instanceof E2ABudgetExceededError;
    }

    const reconciledOperationalUsage = core?.operational_usage ?? capturedOperationalUsage;
    const reconciledOperationalCalls = actualOperationalCalls(reconciledOperationalUsage);
    allOperationalUsage.push(...reconciledOperationalUsage);
    try {
      guard.recordOperationalUsage({
        provider_calls: reconciledOperationalCalls.length,
        input_tokens: reconciledOperationalCalls.reduce((sum, call) => sum + call.input_tokens, 0),
        output_tokens: reconciledOperationalCalls.reduce((sum, call) => sum + call.output_tokens, 0),
        estimated_cost_usd: null
      });
    } catch (error) {
      failure ??= error;
      stoppedByBudget ||= error instanceof E2ABudgetExceededError;
    }
    if (!failure && core) guard.completeSession();
    const usageAfterSession = guard.snapshot();

    const artifactPath = path.join(root, "sessions", core?.manifest.run_id ?? runId);
    const emptyHidden = structuredClone(entry.scenario.initial_student_state);
    const finalHidden = core?.artifacts.run_summary.final_hidden_state ?? emptyHidden;
    const finalProfile = core?.artifacts.run_summary.final_profile_status ?? null;
    const compatibility = hiddenTruthCompatibility({
      final_hidden_state: finalHidden,
      final_operational_profile: finalProfile,
      scenario: entry.scenario
    });
    const operationalUsage = reconciledOperationalUsage;
    const actualCalls = actualOperationalCalls(operationalUsage);
    const simulatorProviderCalls = usageAfterSession.simulator_provider_calls - usageBeforeSession.simulator_provider_calls;
    const simulatorProviderFailures = simulatorTurns.reduce((sum, turn) =>
      sum + turn.validation_failures.filter((issue) => issue.rule_code === "provider_failure").length, 0
    ) + simulatorValidation.filter((entry) => entry.accepted === false).reduce((sum, entry) =>
      sum + (Array.isArray(entry.validation_failures)
        ? (entry.validation_failures as E2ASimulatorValidationIssue[]).filter((issue) => issue.rule_code === "provider_failure").length
        : 0), 0);
    const criticalFailures = core?.artifacts.run_summary.critical_invariant_failure_count ?? 0;
    const majorFailures = core?.artifacts.run_summary.major_invariant_failure_count ?? 0;
    const privacyFindings = core?.artifacts.run_summary.internal_metadata_leak_count ?? 0;
    const answerKeyFindings = core?.artifacts.run_summary.answer_key_leak_count ?? 0;
    const invalidTransitions = core?.artifacts.hard_invariants.filter((entry) =>
      entry.invariant_id === "no_invalid_state_transition" && !entry.passed
    ).length ?? 0;
    const failedExpectations = core?.artifacts.run_summary.failed_expectations ?? [];
    const scenarioContractPassed = Boolean(core) && failedExpectations.length === 0;
    const majorFindings = core?.artifacts.hard_invariants.filter((entry) => !entry.passed && entry.severity === "major").map((entry) => entry.invariant_id) ?? [];
    const latencies = [
      ...simulatorTurns.map((turn) => turn.latency_ms),
      ...actualCalls.flatMap((call) => call.latency_ms === null ? [] : [call.latency_ms])
    ];
    const record: E2ASessionRecord = {
      run_id: core?.manifest.run_id ?? runId,
      stage: input.stage,
      status: failure ? (stoppedByBudget ? "stopped_by_budget" : "failed") : "completed",
      scenario_id: entry.scenario.scenario_id,
      expression_variant: entry.variant,
      artifact_path: artifactPath,
      passed: Boolean(core?.artifacts.run_summary.passed) && !failure,
      scenario_contract_passed: scenarioContractPassed,
      critical_invariant_failures: criticalFailures,
      major_invariant_failures: majorFailures,
      privacy_findings: privacyFindings,
      answer_key_findings: answerKeyFindings,
      missing_assistant_replies: core?.artifacts.run_summary.missing_reply_count ?? 0,
      invalid_state_transitions: invalidTransitions,
      simulator_contract_failures: failure instanceof LlmStudentSimulatorContractError ? 1 : 0,
      simulator_regenerations: simulatorTurns.reduce((sum, turn) => sum + turn.retry_count, 0),
      simulator_provider_calls: simulatorProviderCalls,
      operational_provider_calls: actualCalls.length,
      provider_failures: actualCalls.filter((call) => call.call_status !== "succeeded").length + simulatorProviderFailures,
      provider_retries: actualCalls.reduce((sum, call) => sum + call.retry_count, 0),
      input_tokens: usageAfterSession.input_tokens - usageBeforeSession.input_tokens,
      output_tokens: usageAfterSession.output_tokens - usageBeforeSession.output_tokens,
      average_latency_ms: latencies.length === 0 ? null : Math.round(latencies.reduce((sum, value) => sum + value, 0) / latencies.length),
      final_hidden_state: finalHidden,
      final_operational_profile: finalProfile,
      final_plan_action: core?.artifacts.run_summary.final_plan_action ?? null,
      final_platform_state: core?.artifacts.run_summary.final_platform_state ?? "run_failed",
      hidden_truth_compatibility: compatibility.compatibility,
      hidden_truth_compatibility_reasons: compatibility.reasons,
      strategies: core?.artifacts.run_summary.strategies ?? [],
      distractor_focus_failure: failedExpectations.includes("expected_distractor_focus"),
      premature_resolution: (core?.artifacts.run_summary.premature_resolution_flag_count ?? 0) > 0,
      revision_readiness_count: core?.artifacts.run_summary.revision_readiness_count ?? 0,
      transfer_readiness_count: core?.artifacts.run_summary.transfer_readiness_count ?? 0,
      recovery_count: core?.artifacts.run_summary.recovery_turn_count ?? 0,
      failed_expectations: failedExpectations,
      critical_findings: core?.artifacts.run_summary.critical_findings ?? [],
      major_findings: majorFindings,
      failure_reason: failure instanceof Error ? failure.message : failure ? "unknown_e2a_failure" : null
    };
    sessions.push(record);

    const usageSnapshot = usageAfterSession;
    const operationalInputTokens = actualCalls.reduce((sum, call) => sum + call.input_tokens, 0);
    const operationalOutputTokens = actualCalls.reduce((sum, call) => sum + call.output_tokens, 0);
    await writeE2ASessionArtifacts({
      root,
      run_id: record.run_id,
      manifest: {
        artifact_schema_version: E2A_ARTIFACT_SCHEMA_VERSION,
        run_id: record.run_id,
        stage: input.stage,
        scenario_id: entry.scenario.scenario_id,
        scenario_version: entry.scenario.scenario_version,
        expression_variant: entry.variant,
        application_git_commit: gitCommit,
        operational_runtime_hash: APPROVED_OPERATIONAL_RUNTIME_HASH,
        approval_bundle_path_hash_verified: true,
        all_e1_hard_invariants_enabled: ALL_HARD_INVARIANT_IDS.every((id) => entry.scenario.hard_invariants.includes(id)),
        simulator_model: configuration.model_name,
        simulator_configuration_hash: configuration.configuration_hash,
        simulator_prompt_version: configuration.prompt_version,
        simulator_schema_version: configuration.schema_version,
        simulator_call_ids: [...simulatorTurns.flatMap((turn) => turn.simulator_call_ids), ...failedSimulatorCallIds],
        simulator_input_token_count: Math.max(0, record.input_tokens - operationalInputTokens),
        simulator_output_token_count: Math.max(0, record.output_tokens - operationalOutputTokens),
        simulator_latency_ms: simulatorTurns.reduce((sum, turn) => sum + turn.latency_ms, 0),
        simulator_retry_count: simulatorTurns.reduce((sum, turn) => sum + turn.retry_count, 0),
        simulator_validation_failures: simulatorValidation.flatMap((entry) => entry.validation_failures ?? []),
        operational_provider_call_count: actualCalls.length,
        simulator_provider_call_count: simulatorProviderCalls,
        total_provider_call_count: actualCalls.length + simulatorProviderCalls,
        estimated_cost_usd: usageSnapshot.estimated_cost_usd,
        estimated_cost_status: usageSnapshot.estimated_cost_status,
        budget_remaining: budgetRemaining(guard),
        live_provider_authorized: true,
        llm_rubric_evaluator_enabled: false,
        protected_operational_artifacts_unchanged: true,
        active_approval_runtime_hash: activeApproval.record.runtime_candidate_hash
      },
      core_artifacts: core?.artifacts ?? null,
      simulator_turns: simulatorTurns,
      simulator_validation: simulatorValidation,
      hidden_truth_compatibility: compatibility,
      provider_usage: { simulator: simulatorTurns, operational: operationalUsage, budget: usageSnapshot },
      transition_records: transitions,
      failure: failure instanceof Error ? { name: failure.name, code: failure.message } : failure ? { code: "unknown_e2a_failure" } : null
    });
    if (failure && !stoppedByBudget) break;
    if (stoppedByBudget) break;
  }

  const variance = varianceAnalysis(sessions);
  const queue = humanReviewQueue(sessions, variance);
  const usage = guard.snapshot();
  const latencyValues = [
    ...allSimulatorTurns.map((turn) => turn.latency_ms),
    ...allOperationalUsage.flatMap((call) => call.latency_ms === null ? [] : [call.latency_ms])
  ];
  const totals = {
    sessions_attempted: sessions.length,
    sessions_completed: sessions.filter((session) => session.status === "completed").length,
    sessions_stopped_by_budget: sessions.filter((session) => session.status === "stopped_by_budget").length,
    scenario_contract_pass_count: sessions.filter((session) => session.scenario_contract_passed).length,
    scenario_contract_pass_rate: sessions.length === 0 ? 0 : sessions.filter((session) => session.scenario_contract_passed).length / sessions.length,
    critical_invariant_failures: sessions.reduce((sum, session) => sum + session.critical_invariant_failures, 0),
    major_invariant_failures: sessions.reduce((sum, session) => sum + session.major_invariant_failures, 0),
    privacy_findings: sessions.reduce((sum, session) => sum + session.privacy_findings, 0),
    answer_key_findings: sessions.reduce((sum, session) => sum + session.answer_key_findings, 0),
    missing_assistant_replies: sessions.reduce((sum, session) => sum + session.missing_assistant_replies, 0),
    invalid_transitions: sessions.reduce((sum, session) => sum + session.invalid_state_transitions, 0),
    simulator_contract_failures: sessions.reduce((sum, session) => sum + session.simulator_contract_failures, 0),
    simulator_regenerations: sessions.reduce((sum, session) => sum + session.simulator_regenerations, 0),
    provider_failures: sessions.reduce((sum, session) => sum + session.provider_failures, 0),
    provider_retries: sessions.reduce((sum, session) => sum + session.provider_retries, 0),
    average_latency_ms: latencyValues.length === 0 ? null : Math.round(latencyValues.reduce((sum, value) => sum + value, 0) / latencyValues.length),
    p95_latency_ms: percentile(latencyValues, 0.95),
    input_tokens: usage.input_tokens,
    output_tokens: usage.output_tokens,
    estimated_cost_usd: usage.estimated_cost_usd,
    estimated_cost_status: usage.estimated_cost_status,
    distractor_focus_failures: sessions.filter((session) => session.distractor_focus_failure).length,
    premature_resolution_findings: sessions.filter((session) => session.premature_resolution).length,
    hidden_truth_incompatibilities: sessions.filter((session) => session.hidden_truth_compatibility === "incompatible").length,
    cross_variant_progression_variance: Object.values(variance.scenarios).filter((entry) =>
      (entry as { routing_consistent?: boolean }).routing_consistent === false
    ).length,
    manual_review_queue_size: queue.length
  };
  const canaryGatePassed = input.stage === "canary" &&
    sessions.length === 4 &&
    sessions.every((session) => session.status === "completed") &&
    sessions.every((session) => session.scenario_contract_passed) &&
    totals.critical_invariant_failures === 0 &&
    totals.major_invariant_failures === 0 &&
    totals.privacy_findings === 0 &&
    totals.answer_key_findings === 0 &&
    totals.missing_assistant_replies === 0 &&
    totals.invalid_transitions === 0 &&
    totals.simulator_contract_failures === 0 &&
    usage.total_provider_calls <= limits.maximum_total_provider_calls &&
    usage.input_tokens <= limits.maximum_total_input_tokens &&
    usage.output_tokens <= limits.maximum_total_output_tokens &&
    (usage.estimated_cost_status === "unavailable" || (usage.estimated_cost_usd ?? 0) <= limits.maximum_cost_usd);
  const summary = {
    artifact_schema_version: E2A_ARTIFACT_SCHEMA_VERSION,
    stage: input.stage,
    generated_at: new Date().toISOString(),
    application_git_commit: gitCommit,
    operational_runtime_hash: APPROVED_OPERATIONAL_RUNTIME_HASH,
    simulator_model: configuration.model_name,
    simulator_configuration_hash: configuration.configuration_hash,
    protected_operational_artifacts_unchanged: true,
    live_provider_authorized: true,
    llm_rubric_evaluator_enabled: false,
    budget_limits: limits,
    budget_usage: usage,
    budget_remaining: budgetRemaining(guard),
    ...totals,
    ...(input.stage === "canary" ? { canary_gate_passed: canaryGatePassed } : { full_matrix_completed: sessions.length === 36 && sessions.every((session) => session.status === "completed") }),
    groups: {
      scenario: Object.fromEntries(FORMATIVE_EVALUATION_SCENARIOS.map((scenario) => [scenario.scenario_id, sessions.filter((session) => session.scenario_id === scenario.scenario_id)])),
      expression_variant: Object.fromEntries(([1, 2, 3] as const).map((variant) => [variant, sessions.filter((session) => session.expression_variant === variant)])),
      conceptual_state: Object.groupBy(sessions, (session) => session.final_hidden_state.conceptual_state),
      misconception: Object.groupBy(sessions, (session) => session.final_hidden_state.misconception_status),
      confidence: Object.groupBy(sessions, (session) => session.final_hidden_state.confidence),
      engagement: Object.groupBy(sessions, (session) => session.final_hidden_state.engagement),
      final_platform_state: Object.groupBy(sessions, (session) => session.final_platform_state),
      final_profile_interpretation: Object.groupBy(sessions, (session) => session.final_operational_profile ?? "unavailable"),
      final_plan_action: Object.groupBy(sessions, (session) => session.final_plan_action ?? "unavailable")
    }
  };
  await writeE2AAggregates({
    root,
    stage: input.stage,
    summary,
    sessions: sessions as unknown as Array<Record<string, unknown>>,
    provider_usage: {
      usage,
      limits,
      simulator: allSimulatorTurns,
      operational_by_role: Object.groupBy(allOperationalUsage, (call) => call.agent_name)
    },
    variant_comparison: variance,
    human_review_queue: queue
  });
  return { root, summary, sessions };
}

export async function readE2AReport(artifactRoot = ".data/formative-evaluation-e2a") {
  const root = path.resolve(artifactRoot);
  const read = async (name: string) => {
    try {
      return JSON.parse(await readFile(path.join(root, name), "utf8")) as Record<string, unknown>;
    } catch {
      return null;
    }
  };
  return {
    artifact_root: root,
    canary: await read("e2a-canary-summary.json"),
    full: await read("e2a-full-summary.json"),
    provider_usage: await read("e2a-provider-usage.json"),
    variant_comparison: await read("variant-comparison.json")
  };
}

export const E2A_CANARY_SCENARIO_IDS = [...E2A_CANARY_SCENARIOS];
