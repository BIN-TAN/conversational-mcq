import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  FORMATIVE_EVALUATION_ARTIFACT_SCHEMA_VERSION,
  HardInvariantResultSchema,
  PedagogicalRubricRecordSchema
} from "./schemas";
import { assertEvaluationArtifactIsRedacted, redactEvaluationArtifactValue } from "./redaction";
import type { FormativeEvaluationRunArtifacts } from "./types";

export const REQUIRED_RUN_ARTIFACT_FILES = [
  "manifest.json",
  "scenario.json",
  "initial-student-state.json",
  "final-student-state.json",
  "student-turns.jsonl",
  "visible-assistant-turns.jsonl",
  "profile-history.jsonl",
  "plan-history.jsonl",
  "activity-attempts.jsonl",
  "internal-evaluations.jsonl",
  "state-transitions.jsonl",
  "hard-invariants.json",
  "pedagogical-rubric.json",
  "branch-decisions.jsonl",
  "safety-findings.json",
  "run-summary.json"
] as const;

export const RunManifestSchema = z.object({
  artifact_schema_version: z.literal(FORMATIVE_EVALUATION_ARTIFACT_SCHEMA_VERSION),
  run_id: z.string().min(1),
  scenario_id: z.string().min(1),
  scenario_version: z.string().min(1),
  seed: z.number().int(),
  simulator_mode: z.enum(["scripted", "branching"]),
  git_commit: z.string().regex(/^[a-f0-9]{40}$/),
  operational_runtime_hash: z.string().length(64),
  model_mode: z.literal("mock_safe"),
  provider_access_enabled: z.literal(false),
  provider_call_count: z.literal(0),
  live_student_simulator_enabled: z.literal(false),
  live_rubric_evaluator_enabled: z.literal(false),
  started_at: z.string().datetime(),
  completed_at: z.string().datetime(),
  fixture_public_ids: z.object({
    assessment_public_id: z.string().min(1),
    concept_unit_public_id: z.string().min(1),
    item_public_ids: z.array(z.string().min(1)).length(4),
    session_public_id: z.string().min(1)
  }).strict(),
  cleanup_result: z.object({
    attempted: z.boolean(),
    succeeded: z.boolean(),
    retained_on_failure: z.boolean(),
    detail: z.string().min(1)
  }).strict()
}).strict();
export type RunManifest = z.infer<typeof RunManifestSchema>;

function safeJson(value: unknown) {
  const redacted = redactEvaluationArtifactValue(value);
  assertEvaluationArtifactIsRedacted(redacted);
  return `${JSON.stringify(redacted, null, 2)}\n`;
}

function safeJsonl(values: unknown[]) {
  return values.map((value) => {
    const redacted = redactEvaluationArtifactValue(value);
    assertEvaluationArtifactIsRedacted(redacted);
    return JSON.stringify(redacted);
  }).join("\n") + (values.length > 0 ? "\n" : "");
}

export async function writeFormativeEvaluationRunArtifacts(input: {
  artifact_root: string;
  manifest: RunManifest;
  artifacts: FormativeEvaluationRunArtifacts;
}) {
  const manifest = RunManifestSchema.parse(input.manifest);
  const directory = path.resolve(input.artifact_root, manifest.run_id);
  await rm(directory, { recursive: true, force: true });
  await mkdir(directory, { recursive: true });
  const jsonFiles: Array<[string, unknown]> = [
    ["manifest.json", manifest],
    ["scenario.json", input.artifacts.scenario],
    ["initial-student-state.json", input.artifacts.initial_student_state],
    ["final-student-state.json", input.artifacts.final_student_state],
    ["hard-invariants.json", input.artifacts.hard_invariants.map((entry) => HardInvariantResultSchema.parse(entry))],
    ["pedagogical-rubric.json", input.artifacts.pedagogical_rubric.map((entry) => PedagogicalRubricRecordSchema.parse(entry))],
    ["safety-findings.json", input.artifacts.safety_findings],
    ["run-summary.json", input.artifacts.run_summary]
  ];
  const jsonlFiles: Array<[string, unknown[]]> = [
    ["student-turns.jsonl", input.artifacts.student_turns],
    ["visible-assistant-turns.jsonl", input.artifacts.visible_assistant_turns],
    ["profile-history.jsonl", input.artifacts.profile_history],
    ["plan-history.jsonl", input.artifacts.plan_history],
    ["activity-attempts.jsonl", input.artifacts.activity_attempts],
    ["internal-evaluations.jsonl", input.artifacts.internal_evaluations],
    ["state-transitions.jsonl", input.artifacts.state_transitions],
    ["branch-decisions.jsonl", input.artifacts.branch_decisions]
  ];
  await Promise.all([
    ...jsonFiles.map(([name, value]) => writeFile(path.join(directory, name), safeJson(value), "utf8")),
    ...jsonlFiles.map(([name, values]) => writeFile(path.join(directory, name), safeJsonl(values), "utf8"))
  ]);
  return directory;
}
