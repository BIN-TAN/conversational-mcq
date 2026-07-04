import { readdir, readFile, writeFile, mkdir, stat } from "node:fs/promises";
import path from "node:path";

const liveReviewRequested = process.env.RUN_LIVE_TRIAL_REVIEWER === "1";
const smokeDir = path.join(process.cwd(), ".data", "profile-formative-scenario-smoke");
const liveDir = path.join(process.cwd(), ".data", "profile-formative-live-trials");
const outputDir = path.join(process.cwd(), ".data", "profile-formative-trial-review");

function args() {
  const entries = process.argv.slice(2);
  const runIdIndex = entries.indexOf("--run-id");
  return {
    latestRun: entries.includes("--latest-run"),
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
  try {
    const entries = await readdir(liveDir, { withFileTypes: true });
    const dirs = await Promise.all(
      entries
        .filter((entry) => entry.isDirectory() && entry.name.startsWith("run-"))
        .map(async (entry) => ({
          name: entry.name,
          mtimeMs: (await stat(path.join(liveDir, entry.name))).mtimeMs
        }))
    );
    return dirs.sort((a, b) => b.mtimeMs - a.mtimeMs)[0]?.name ?? null;
  } catch {
    return null;
  }
}

async function liveReviewSources() {
  const parsedArgs = args();
  if (parsedArgs.allRuns) {
    return {
      mode: "all_runs",
      dirs: [liveDir],
      selected_run_id: null
    };
  }

  const selectedRunId = parsedArgs.runId ?? (parsedArgs.latestRun ? await latestLiveRunDir() : null);
  if (!selectedRunId) {
    return {
      mode: parsedArgs.latestRun ? "latest_run_missing" : "historical_default_all_runs",
      dirs: parsedArgs.latestRun ? [] : [liveDir],
      selected_run_id: null
    };
  }

  return {
    mode: parsedArgs.runId ? "run_id" : "latest_run",
    dirs: [path.join(liveDir, selectedRunId)],
    selected_run_id: selectedRunId
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
    ...(await readScenarioJsonFiles(smokeDir)).map((entry) => ({ source: "scenario_smoke", ...entry })),
    ...liveRecordsNested.flat()
  ];
  const summaryRecords = [
    ...liveSummaryNested.flat()
  ];
  const reviewed = records.map((entry) => {
    const parsed = entry.parsed;
    const failures = Array.isArray(parsed.failures) ? parsed.failures : [];
    return {
      source: entry.source,
      file: entry.file,
      scenario_id:
        typeof parsed.scenario === "object" && parsed.scenario && "scenario_id" in parsed.scenario
          ? String((parsed.scenario as { scenario_id?: unknown }).scenario_id)
          : "unknown",
      pass: failures.length === 0,
      failure_count: failures.length,
      safe_flags: safeFlags(parsed)
    };
  });
  const summaryFindings = summaryRecords.flatMap((entry) => {
    const failures = Array.isArray(entry.parsed.failures) ? entry.parsed.failures : [];
    return failures.map((failure) => {
      const scenarioId = typeof failure === "object" && failure && "scenario_id" in failure
        ? String((failure as { scenario_id?: unknown }).scenario_id)
        : "unknown";
      const failureList = typeof failure === "object" && failure && Array.isArray((failure as { failures?: unknown }).failures)
        ? (failure as { failures: unknown[] }).failures.map(String)
        : [];
      return {
        source: entry.source,
        file: entry.file,
        scenario_id: scenarioId,
        pass: failureList.length === 0,
        failure_count: failureList.length,
        safe_flags: safeFlags(failure as Record<string, unknown>)
      };
    });
  });
  const allReviewed = [...reviewed, ...summaryFindings];
  const summary = {
    status: allReviewed.some((entry) => entry.failure_count > 0 || entry.safe_flags.length > 0)
      ? "review_has_findings"
      : "passed",
    reviewer_mode: "deterministic_no_live",
    live_source_mode: liveSources.mode,
    selected_run_id: liveSources.selected_run_id,
    records_reviewed: allReviewed.length,
    model_quality_findings: allReviewed.filter((entry) => entry.failure_count > 0),
    safety_findings: allReviewed.filter((entry) => entry.safe_flags.length > 0),
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
