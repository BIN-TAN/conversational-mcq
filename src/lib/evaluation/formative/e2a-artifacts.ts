import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { assertEvaluationArtifactIsRedacted, redactEvaluationArtifactValue } from "./redaction";

function json(value: unknown) {
  const redacted = redactEvaluationArtifactValue(value);
  assertEvaluationArtifactIsRedacted(redacted);
  return `${JSON.stringify(redacted, null, 2)}\n`;
}

function jsonl(values: unknown[]) {
  return values.map((value) => {
    const redacted = redactEvaluationArtifactValue(value);
    assertEvaluationArtifactIsRedacted(redacted);
    return JSON.stringify(redacted);
  }).join("\n") + (values.length ? "\n" : "");
}

function csvCell(value: unknown) {
  const text = value === null || value === undefined
    ? ""
    : typeof value === "string"
      ? value
      : JSON.stringify(value);
  return `"${text.replaceAll('"', '""')}"`;
}

export async function writeE2ASessionArtifacts(input: {
  root: string;
  run_id: string;
  manifest: unknown;
  core_artifacts?: Record<string, unknown> | null;
  simulator_turns: unknown[];
  simulator_validation: unknown[];
  hidden_truth_compatibility: unknown;
  provider_usage: unknown;
  transition_records: unknown[];
  failure?: unknown;
}) {
  const directory = path.join(input.root, "sessions", input.run_id);
  await mkdir(directory, { recursive: true });
  const core = input.core_artifacts ?? {};
  await Promise.all([
    writeFile(path.join(directory, "manifest.json"), json(input.manifest), "utf8"),
    writeFile(path.join(directory, "core-artifacts.json"), json(core), "utf8"),
    writeFile(path.join(directory, "simulator-turns.jsonl"), jsonl(input.simulator_turns), "utf8"),
    writeFile(path.join(directory, "simulator-validation.jsonl"), jsonl(input.simulator_validation), "utf8"),
    writeFile(path.join(directory, "hidden-truth-compatibility.json"), json(input.hidden_truth_compatibility), "utf8"),
    writeFile(path.join(directory, "provider-usage.json"), json(input.provider_usage), "utf8"),
    writeFile(path.join(directory, "hidden-state-transitions.jsonl"), jsonl(input.transition_records), "utf8"),
    writeFile(path.join(directory, "failure.json"), json(input.failure ?? null), "utf8")
  ]);
  return directory;
}

export async function writeE2AAggregates(input: {
  root: string;
  stage: "canary" | "full";
  summary: Record<string, unknown>;
  sessions: Array<Record<string, unknown>>;
  provider_usage: Record<string, unknown>;
  variant_comparison: Record<string, unknown>;
  human_review_queue: Array<Record<string, unknown>>;
}) {
  await mkdir(input.root, { recursive: true });
  const prefix = input.stage === "canary" ? "e2a-canary" : "e2a-full";
  const queueHeaders = [
    "run_id",
    "scenario_id",
    "expression_variant",
    "reason_selected",
    "artifact_path",
    "final_hidden_state",
    "final_operational_profile",
    "final_plan_action",
    "final_platform_state",
    "critical_findings",
    "major_findings",
    "manual_rubric_dimensions",
    "provider_call_count",
    "estimated_cost"
  ];
  const queue = [
    queueHeaders.map(csvCell).join(","),
    ...input.human_review_queue.map((row) =>
      queueHeaders.map((header) => csvCell(row[header])).join(",")
    )
  ].join("\n") + "\n";
  await Promise.all([
    writeFile(path.join(input.root, `${prefix}-summary.json`), json(input.summary), "utf8"),
    writeFile(path.join(input.root, "e2a-scenario-variants.jsonl"), jsonl(input.sessions), "utf8"),
    writeFile(path.join(input.root, "e2a-provider-usage.json"), json(input.provider_usage), "utf8"),
    writeFile(path.join(input.root, "variant-comparison.json"), json(input.variant_comparison), "utf8"),
    writeFile(path.join(input.root, "e2a-human-review-queue.csv"), queue, "utf8")
  ]);
}
