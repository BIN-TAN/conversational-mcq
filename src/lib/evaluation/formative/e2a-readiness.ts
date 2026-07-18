import { readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

export const E2A_READINESS_REPORT_VERSION = "formative-evaluation-e2a-readiness-v2";
export const E2A_READINESS_MAX_AGE_MS = 4 * 60 * 60 * 1000;
export const E2A_E1_EXPECTED_RUN_COUNT = 12;

export const E2AE1PrerequisiteSummarySchema = z.object({
  command_completed: z.boolean(),
  result_parsed: z.boolean(),
  expected_run_count: z.literal(E2A_E1_EXPECTED_RUN_COUNT),
  executed_run_count: z.number().int().nonnegative().nullable(),
  pass_count: z.number().int().nonnegative().nullable(),
  fail_count: z.number().int().nonnegative().nullable(),
  provider_call_count: z.number().int().nonnegative().nullable(),
  passed: z.boolean()
}).strict();

export type E2AE1PrerequisiteSummary = z.infer<typeof E2AE1PrerequisiteSummarySchema>;

export function evaluateE2AE1PrerequisiteSummary(input: {
  command_completed: boolean;
  result?: {
    executed_run_count: number;
    pass_count: number;
    fail_count: number;
    provider_call_count: number;
  } | null;
}): E2AE1PrerequisiteSummary {
  const result = input.result ?? null;
  const passed = input.command_completed &&
    result !== null &&
    result.executed_run_count === E2A_E1_EXPECTED_RUN_COUNT &&
    result.pass_count === E2A_E1_EXPECTED_RUN_COUNT &&
    result.fail_count === 0 &&
    result.provider_call_count === 0;
  return E2AE1PrerequisiteSummarySchema.parse({
    command_completed: input.command_completed,
    result_parsed: result !== null,
    expected_run_count: E2A_E1_EXPECTED_RUN_COUNT,
    executed_run_count: result?.executed_run_count ?? null,
    pass_count: result?.pass_count ?? null,
    fail_count: result?.fail_count ?? null,
    provider_call_count: result?.provider_call_count ?? null,
    passed
  });
}

export const E2AReadinessReportSchema = z.object({
  readiness_report_version: z.literal(E2A_READINESS_REPORT_VERSION),
  generated_at: z.string().datetime(),
  application_git_commit: z.string().regex(/^[a-f0-9]{40}$/u),
  requested_runtime_hash: z.string().length(64),
  resolved_runtime_hash: z.string().length(64).nullable(),
  resolution_source: z.enum(["approved_derived_bundle", "legacy_fallback", "none"]),
  approved_bundle_complete: z.boolean(),
  role_count: z.number().int().nonnegative(),
  simulator_configuration_hash: z.string().length(64).nullable(),
  simulator_model: z.string().min(1).nullable(),
  budget_limits: z.record(z.string(), z.number()).nullable(),
  runtime_compatibility: z.object({
    topic_dialogue_maximum_student_turns: z.object({
      approved_value: z.number().int().positive().nullable(),
      input_contract_maximum: z.number().int().positive(),
      compatible: z.boolean()
    }).strict()
  }).strict(),
  prerequisites: z.object({
    e1_matrix: E2AE1PrerequisiteSummarySchema,
    e1_2_privacy_smoke: z.object({
      command_completed: z.boolean(),
      passed: z.boolean()
    }).strict()
  }).strict(),
  checks: z.record(z.string(), z.boolean()),
  blocking_reasons: z.array(z.string()),
  ready: z.boolean(),
  provider_requests: z.object({
    metadata_only: z.literal(0),
    generation: z.literal(0)
  }).strict(),
  secrets_printed: z.literal(false)
}).strict();

export type E2AReadinessReport = z.infer<typeof E2AReadinessReportSchema>;

export function defaultE2AReadinessPath(artifactRoot = ".data/formative-evaluation-e2a") {
  return path.resolve(artifactRoot, "e2a-readiness.json");
}

export function assertE2AReadinessAttestation(input: {
  artifactPath?: string;
  artifactRoot?: string;
  applicationGitCommit: string;
  runtimeHash: string;
  simulatorConfigurationHash: string;
  now?: Date;
}) {
  const artifactPath = path.resolve(
    input.artifactPath ?? defaultE2AReadinessPath(input.artifactRoot)
  );
  let report: E2AReadinessReport;
  try {
    report = E2AReadinessReportSchema.parse(JSON.parse(readFileSync(artifactPath, "utf8")));
  } catch {
    throw new Error("e2a_readiness_attestation_missing_or_invalid");
  }
  if (!report.ready) throw new Error("e2a_readiness_not_passed");
  if (report.application_git_commit !== input.applicationGitCommit) {
    throw new Error("e2a_readiness_commit_mismatch");
  }
  if (
    report.requested_runtime_hash !== input.runtimeHash ||
    report.resolved_runtime_hash !== input.runtimeHash ||
    report.resolution_source !== "approved_derived_bundle" ||
    !report.approved_bundle_complete
  ) {
    throw new Error("e2a_readiness_runtime_mismatch");
  }
  if (report.simulator_configuration_hash !== input.simulatorConfigurationHash) {
    throw new Error("e2a_readiness_simulator_configuration_mismatch");
  }
  const ageMs = (input.now ?? new Date()).getTime() - new Date(report.generated_at).getTime();
  if (ageMs < 0 || ageMs > E2A_READINESS_MAX_AGE_MS) {
    throw new Error("e2a_readiness_attestation_expired");
  }
  if (report.provider_requests.generation !== 0) {
    throw new Error("e2a_readiness_generation_request_detected");
  }
  return { artifact_path: artifactPath, report };
}
