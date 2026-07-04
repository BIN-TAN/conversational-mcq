import { readdir, readFile, writeFile, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { adjudicateProfileFormativeFailure } from "./student-profile-formative-adjudication";

const liveReviewRequested = process.env.RUN_LIVE_TRIAL_REVIEWER === "1";
const smokeDir = path.join(process.cwd(), ".data", "profile-formative-scenario-smoke");
const liveDir = path.isAbsolute(process.env.PROFILE_FORMATIVE_TRIAL_LIVE_DIR ?? "")
  ? process.env.PROFILE_FORMATIVE_TRIAL_LIVE_DIR as string
  : path.join(process.cwd(), process.env.PROFILE_FORMATIVE_TRIAL_LIVE_DIR ?? ".data/profile-formative-live-trials");
const outputDir = path.isAbsolute(process.env.PROFILE_FORMATIVE_TRIAL_REVIEW_OUTPUT_DIR ?? "")
  ? process.env.PROFILE_FORMATIVE_TRIAL_REVIEW_OUTPUT_DIR as string
  : path.join(process.cwd(), process.env.PROFILE_FORMATIVE_TRIAL_REVIEW_OUTPUT_DIR ?? ".data/profile-formative-trial-review");

function args() {
  const entries = process.argv.slice(2);
  const runIdIndex = entries.indexOf("--run-id");
  return {
    latestRun: entries.includes("--latest-run"),
    latestFullRun: entries.includes("--latest-full-run"),
    allRuns: entries.includes("--all-runs"),
    runId: runIdIndex >= 0 ? entries[runIdIndex + 1] : null
  };
}

async function collectJsonFiles(
  dir: string,
  includeFile: (fileName: string) => boolean
) {
  try {
    const files: string[] = [];
    async function collect(currentDir: string, relativePrefix = "") {
      const entries = await readdir(currentDir, { withFileTypes: true });
      for (const entry of entries) {
        const relativePath = path.join(relativePrefix, entry.name);
        const absolutePath = path.join(currentDir, entry.name);
        if (entry.isDirectory()) {
          await collect(absolutePath, relativePath);
          continue;
        }
        if (entry.name.endsWith(".json") && includeFile(entry.name)) {
          files.push(relativePath);
        }
      }
    }
    await collect(dir);
    const records = [];
    for (const file of files) {
      const content = await readFile(path.join(dir, file), "utf8");
      records.push({
        file,
        parsed: JSON.parse(content) as Record<string, unknown>
      });
    }
    return records;
  } catch {
    return [];
  }
}

function readScenarioJsonFiles(dir: string) {
  return collectJsonFiles(
    dir,
    (fileName) => !fileName.startsWith("summary-") && !fileName.startsWith("error-analysis-")
  );
}

function readSummaryJsonFiles(dir: string) {
  return collectJsonFiles(dir, (fileName) => fileName.startsWith("summary-"));
}

async function latestLiveRunDir() {
  const candidates = [];
  for (const runDir of await liveRunDirs()) {
    const absoluteRunDir = path.join(liveDir, runDir.name);
    const summaries = await readSummaryJsonFiles(absoluteRunDir);
    const hasLiveSummary = summaries.some((entry) =>
      typeof entry.parsed.live_scenarios_run === "number" &&
      entry.parsed.live_scenarios_run > 0
    );
    if (hasLiveSummary) {
      candidates.push(runDir);
    }
  }
  return candidates.sort((a, b) => b.mtimeMs - a.mtimeMs)[0]?.name ?? null;
}

async function liveRunDirs() {
  try {
    const entries = await readdir(liveDir, { withFileTypes: true });
    return await Promise.all(
      entries
        .filter((entry) => entry.isDirectory() && entry.name.startsWith("run-"))
        .map(async (entry) => ({
          name: entry.name,
          mtimeMs: (await stat(path.join(liveDir, entry.name))).mtimeMs
        }))
    );
  } catch {
    return [];
  }
}

function isFullLiveSummary(parsed: Record<string, unknown>) {
  const scenarioIds = Array.isArray(parsed.scenario_ids_run) ? parsed.scenario_ids_run : [];
  return (
    parsed.scenario_count === 100 &&
    parsed.live_scenarios_run === 100 &&
    scenarioIds.length === 100
  );
}

async function latestFullLiveRunDir() {
  const candidates = [];
  for (const runDir of await liveRunDirs()) {
    const absoluteRunDir = path.join(liveDir, runDir.name);
    const summaries = await readSummaryJsonFiles(absoluteRunDir);
    const hasFullLiveSummary = summaries.some((entry) => isFullLiveSummary(entry.parsed));
    if (hasFullLiveSummary) {
      candidates.push(runDir);
    }
  }
  return candidates.sort((a, b) => b.mtimeMs - a.mtimeMs)[0]?.name ?? null;
}

async function liveReviewSources() {
  const parsedArgs = args();
  if (parsedArgs.allRuns) {
    return {
      mode: "all_runs",
      dirs: [liveDir],
      selected_run_id: null,
      include_smoke_records: false
    };
  }

  const selectedRunId =
    parsedArgs.runId ??
    (parsedArgs.latestFullRun ? await latestFullLiveRunDir() : await latestLiveRunDir());
  if (!selectedRunId) {
    return {
      mode: parsedArgs.latestFullRun ? "latest_full_run_missing" : "latest_run_missing",
      dirs: [],
      selected_run_id: null,
      include_smoke_records: true
    };
  }

  return {
    mode: parsedArgs.runId ? "run_id" : parsedArgs.latestFullRun ? "latest_full_run" : "latest_run",
    dirs: [path.join(liveDir, selectedRunId)],
    selected_run_id: selectedRunId,
    include_smoke_records: false
  };
}

function safeFlags(record: Record<string, unknown>) {
  const serialized = JSON.stringify(record).toLowerCase();
  const flags = [];
  if (serialized.includes("answer key")) flags.push("answer_key_reference");
  if (serialized.includes("correct option")) flags.push("correct_option_reference");
  if (serialized.includes("raw provider output")) flags.push("raw_provider_output_reference");
  if (serialized.includes("api key")) flags.push("api_key_reference");
  if (serialized.includes("activity recommendation")) flags.push("activity_recommendation_reference");
  return flags;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isQuotaFailure(value: unknown): boolean {
  const failure = asRecord(value);
  const transport = asRecord(failure?.transport);
  return (
    stringValue(failure?.category) === "quota" ||
    numberValue(transport?.http_status) === 429 ||
    stringValue(transport?.typed_failure_reason) === "openai_quota_exceeded" ||
    stringValue(transport?.provider_error_code) === "insufficient_quota"
  );
}

function providerFailureFromRecord(record: Record<string, unknown>): unknown[] {
  const failures: unknown[] = [];
  const providerFailure = asRecord(record.provider_failure);
  if (providerFailure) failures.push(providerFailure);

  const diagnostics = asRecord(record.provider_diagnostics);
  for (const diagnostic of Object.values(diagnostics ?? {})) {
    const diagnosticRecord = asRecord(diagnostic);
    if (diagnosticRecord?.provider_failure) failures.push(diagnosticRecord.provider_failure);
  }

  const agentCalls = asRecord(record.agent_calls);
  for (const call of Object.values(agentCalls ?? {})) {
    const callRecord = asRecord(call);
    if (callRecord?.provider_failure) failures.push(callRecord.provider_failure);
  }

  const summaryAgentCalls = Array.isArray(record.agent_call_statuses) ? record.agent_call_statuses : [];
  for (const scenario of summaryAgentCalls) {
    const scenarioRecord = asRecord(scenario);
    const calls = Array.isArray(scenarioRecord?.agent_calls) ? scenarioRecord.agent_calls : [];
    for (const call of calls) {
      const callRecord = asRecord(call);
      if (callRecord?.provider_failure) failures.push(callRecord.provider_failure);
    }
  }

  return failures;
}

function hasQuotaFailure(record: Record<string, unknown>) {
  return (
    record.status === "blocked_provider_quota" ||
    record.provider_blocked === true ||
    providerFailureFromRecord(record).some(isQuotaFailure) ||
    JSON.stringify(record).includes("openai_quota_exceeded") ||
    JSON.stringify(record).includes("insufficient_quota")
  );
}

function resultCategory(record: Record<string, unknown>) {
  const outcome = asRecord(record.provider_vs_effective_outcome);
  return stringValue(outcome?.passed_as) ?? stringValue(record.result_category);
}

function findingKind(input: {
  record: Record<string, unknown>;
  failures: string[];
  safeFlags: string[];
  quotaScenarioIds?: Set<string>;
  scenarioId?: string;
  adjudication?: Record<string, unknown> | null;
}) {
  if (input.safeFlags.length > 0) return "safety";
  if (input.adjudication) {
    const primaryFailureType = stringValue(input.adjudication.primary_failure_type);
    const shouldBlockReadiness = input.adjudication.should_block_readiness === true;
    if (!shouldBlockReadiness) return "accepted_or_retried";
    if (primaryFailureType === "infrastructure_transient" || primaryFailureType === "provider_request_failure") {
      return "infrastructure";
    }
    if (primaryFailureType === "safety_failure") return "safety";
    if (primaryFailureType === "validator_failure") return "validator";
  }
  if (hasQuotaFailure(input.record) || (input.scenarioId && input.quotaScenarioIds?.has(input.scenarioId))) {
    return "provider_quota";
  }
  const category = resultCategory(input.record);
  if (category === "blocked_provider_quota") return "provider_quota";
  if (category === "infrastructure_transient" || category === "failed_provider_request" || providerFailureFromRecord(input.record).length > 0) {
    return "infrastructure";
  }
  if (
    category === "accepted_allowed_alternative" ||
    category === "scenario_expectation_updated_after_adjudication" ||
    category === "passed_after_provider_retry"
  ) {
    return "accepted_or_retried";
  }
  if (category === "failed_validation" || input.failures.some((failure) => failure.includes("validation"))) {
    return "validator";
  }
  return "model_quality";
}

function recomputeAdjudication(
  record: Record<string, unknown>,
  scenarioId: string,
  failures: string[]
) {
  const scenario = asRecord(record.scenario);
  const existingAdjudication = asRecord(record.adjudication);
  const expected =
    asRecord(record.expected) ??
    asRecord(existingAdjudication?.expected_outcome) ??
    {};
  const actualEffective =
    asRecord(record.actual) ??
    asRecord(record.actual_effective_outcome) ??
    asRecord(existingAdjudication?.actual_effective_outcome) ??
    null;
  const actualProvider =
    asRecord(record.actual_provider_outcome) ??
    asRecord(existingAdjudication?.actual_provider_outcome) ??
    (actualEffective
      ? {
        profile_integration_pattern: actualEffective.profile_integration_pattern,
        student_facing_status: actualEffective.student_facing_status,
        formative_value: actualEffective.formative_value
      }
      : null);
  const evidenceBasis =
    stringValue(scenario?.rationale) ??
    stringValue(existingAdjudication?.evidence_basis) ??
    "Scenario evidence is synthetic and redacted.";
  const scenarioRationale =
    stringValue(scenario?.why_target_outcome_is_reasonable) ??
    stringValue(existingAdjudication?.target_reasonableness) ??
    null;
  const providerFailure =
    asRecord(record.provider_failure) ??
    asRecord(existingAdjudication?.provider_failure) ??
    null;
  return adjudicateProfileFormativeFailure({
    scenario_id: scenarioId,
    failures,
    expected_outcome: expected,
    actual_provider_outcome: actualProvider,
    actual_effective_outcome: actualEffective,
    evidence_basis: evidenceBasis,
    scenario_rationale: scenarioRationale,
    provider_failure: providerFailure,
    retry_count: numberValue(record.retry_count) ?? undefined
  });
}

function quotaScenarioIdsFromSummaries(summaryRecords: Array<{ parsed: Record<string, unknown> }>) {
  const ids = new Set<string>();
  for (const entry of summaryRecords) {
    const agentStatuses = Array.isArray(entry.parsed.agent_call_statuses) ? entry.parsed.agent_call_statuses : [];
    for (const status of agentStatuses) {
      const record = asRecord(status);
      const scenarioId = stringValue(record?.scenario_id);
      if (scenarioId && record && hasQuotaFailure(record)) ids.add(scenarioId);
    }
    const failures = Array.isArray(entry.parsed.failures) ? entry.parsed.failures : [];
    for (const failure of failures) {
      const record = asRecord(failure);
      const scenarioId = stringValue(record?.scenario_id);
      if (scenarioId && (record?.result_category === "blocked_provider_quota" || hasQuotaFailure(entry.parsed))) {
        ids.add(scenarioId);
      }
    }
  }
  return ids;
}

async function main() {
  if (liveReviewRequested) {
    console.log(JSON.stringify({
      status: "skipped",
      reason: "RUN_LIVE_TRIAL_REVIEWER=1 was set, but Phase 28a-QA implements only the no-live deterministic artifact reviewer.",
      openai_calls_made: 0
    }, null, 2));
    return;
  }

  const liveSources = await liveReviewSources();
  const liveRecordsNested = await Promise.all(
    liveSources.dirs.map(async (dir) =>
      (await readScenarioJsonFiles(dir)).map((entry) => ({ source: "live_trials", ...entry }))
    )
  );
  const liveSummaryNested = await Promise.all(
    liveSources.dirs.map(async (dir) =>
      (await readSummaryJsonFiles(dir)).map((entry) => ({ source: "live_trial_summary", ...entry }))
    )
  );

  const records = [
    ...(liveSources.include_smoke_records
      ? (await readScenarioJsonFiles(smokeDir)).map((entry) => ({ source: "scenario_smoke", ...entry }))
      : []),
    ...liveRecordsNested.flat()
  ];
  const summaryRecords = [
    ...liveSummaryNested.flat()
  ];
  const quotaScenarioIds = quotaScenarioIdsFromSummaries(summaryRecords);
  const reviewed = records.map((entry) => {
    const parsed = entry.parsed;
    const failures = Array.isArray(parsed.failures) ? parsed.failures : [];
    const failureStrings = failures.map(String);
    const flags = safeFlags(parsed);
    const scenarioId =
      typeof parsed.scenario === "object" && parsed.scenario && "scenario_id" in parsed.scenario
        ? String((parsed.scenario as { scenario_id?: unknown }).scenario_id)
        : "unknown";
    const adjudication = recomputeAdjudication(parsed, scenarioId, failureStrings);
    const kind = findingKind({
      record: parsed,
      failures: failureStrings,
      safeFlags: flags,
      quotaScenarioIds,
      scenarioId,
      adjudication
    });
    const accepted = kind === "accepted_or_retried";
    return {
      source: entry.source,
      file: entry.file,
      scenario_id: scenarioId,
      pass: failures.length === 0 || accepted,
      failure_count: accepted ? 0 : failures.length,
      original_failure_count: failures.length,
      finding_kind: kind,
      safe_flags: flags,
      adjudication
    };
  });
  const reviewedByScenarioId = new Map(reviewed.map((entry) => [entry.scenario_id, entry]));
  const summaryFindings = summaryRecords.flatMap((entry) => {
    const failures = Array.isArray(entry.parsed.failures) ? entry.parsed.failures : [];
    return failures.map((failure) => {
      const scenarioId = typeof failure === "object" && failure && "scenario_id" in failure
        ? String((failure as { scenario_id?: unknown }).scenario_id)
        : "unknown";
      const failureList = typeof failure === "object" && failure && Array.isArray((failure as { failures?: unknown }).failures)
        ? (failure as { failures: unknown[] }).failures.map(String)
        : [];
      const failureRecord = asRecord(failure) ?? {};
      const flags = safeFlags(failureRecord);
      const reviewedScenario = reviewedByScenarioId.get(scenarioId);
      const adjudication = reviewedScenario?.adjudication ?? asRecord(failureRecord.adjudication);
      const kind = findingKind({
        record: failureRecord,
        failures: failureList,
        safeFlags: flags,
        quotaScenarioIds,
        scenarioId,
        adjudication
      });
      const accepted = kind === "accepted_or_retried";
      return {
        source: entry.source,
        file: entry.file,
        scenario_id: scenarioId,
        pass: failureList.length === 0 || accepted,
        failure_count: accepted ? 0 : failureList.length,
        original_failure_count: failureList.length,
        finding_kind: kind,
        safe_flags: flags,
        adjudication
      };
    });
  });
  const allReviewed = [...reviewed, ...summaryFindings];
  const providerBlockingFindings = allReviewed.filter((entry) => entry.finding_kind === "provider_quota");
  const infrastructureFindings = allReviewed.filter((entry) => entry.finding_kind === "infrastructure");
  const validatorFindings = allReviewed.filter((entry) => entry.finding_kind === "validator");
  const modelQualityFindings = allReviewed.filter((entry) => entry.finding_kind === "model_quality" && entry.failure_count > 0);
  const safetyFindings = allReviewed.filter((entry) => entry.safe_flags.length > 0);
  const acceptedOrRetriedFindings = allReviewed.filter((entry) => entry.finding_kind === "accepted_or_retried" && entry.original_failure_count > 0);
  const uniqueAcceptedOrRetriedFindings = Array.from(
    new Map(acceptedOrRetriedFindings.map((entry) => [entry.scenario_id, entry])).values()
  );
  const hasOnlyProviderQuotaFindings =
    providerBlockingFindings.length > 0 &&
    modelQualityFindings.length === 0 &&
    validatorFindings.length === 0 &&
    infrastructureFindings.length === 0 &&
    safetyFindings.length === 0;
  const summary = {
    status: hasOnlyProviderQuotaFindings
      ? "provider_quota_blocked"
      : allReviewed.some((entry) => entry.failure_count > 0 || entry.safe_flags.length > 0)
        ? "review_has_findings"
        : "passed",
    reviewer_mode: "deterministic_no_live",
    live_source_mode: liveSources.mode,
    selected_run_id: liveSources.selected_run_id,
    records_reviewed: allReviewed.length,
    provider_blocking_findings: providerBlockingFindings,
    infrastructure_findings: infrastructureFindings,
    validator_findings: validatorFindings,
    model_quality_findings: modelQualityFindings,
    safety_findings: safetyFindings,
    accepted_or_retried_findings: uniqueAcceptedOrRetriedFindings,
    run_level_message: providerBlockingFindings.length > 0
      ? "This run was blocked by provider quota. It cannot be used as final live QA evidence."
      : null,
    final_live_qa_acceptance: providerBlockingFindings.length === 0 &&
      modelQualityFindings.length === 0 &&
      validatorFindings.length === 0 &&
      infrastructureFindings.length === 0 &&
      safetyFindings.length === 0,
    rerun_required_after_quota_restored: providerBlockingFindings.length > 0,
    findings: allReviewed.filter((entry) => entry.failure_count > 0 || entry.safe_flags.length > 0),
    openai_calls_made: 0
  };

  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, `trial-review-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  await writeFile(outputPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ ...summary, artifact_path: outputPath }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
