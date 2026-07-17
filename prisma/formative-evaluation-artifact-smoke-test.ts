import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { loadEnvConfig } from "@next/env";
import { REQUIRED_RUN_ARTIFACT_FILES, RunManifestSchema } from "../src/lib/evaluation/formative/artifact-writer";
import { buildPassingInvariantFixture, evaluateHardInvariants } from "../src/lib/evaluation/formative/hard-invariants";
import { loadFormativeEvaluationScenario } from "../src/lib/evaluation/formative/scenario-loader";
import {
  FormativeEvaluationScenarioSchema,
  HardInvariantResultSchema,
  PedagogicalRubricRecordSchema,
  SimulatedStudentStateSchema,
  type HardInvariantId
} from "../src/lib/evaluation/formative/schemas";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertMajorFaultDetected(
  mutate: (fixture: ReturnType<typeof buildPassingInvariantFixture>) => void,
  invariantId: HardInvariantId
) {
  const fixture = buildPassingInvariantFixture();
  mutate(fixture);
  const result = evaluateHardInvariants(fixture, [invariantId])[0];
  assert(result && !result.passed, `${invariantId} controlled fault should be detected.`);
}

export async function runFormativeEvaluationArtifactSmoke() {
  loadEnvConfig(process.cwd());
  assertMajorFaultDetected((fixture) => { fixture.response_package_stage_audits = []; }, "profile_updated_or_stale_fallback_recorded");
  assertMajorFaultDetected((fixture) => { fixture.response_package_stage_audits = []; }, "plan_updated_or_stale_fallback_recorded");
  assertMajorFaultDetected((fixture) => { fixture.activity_attempts[0]!.distractor_anchor_present = false; }, "distractor_anchor_present");
  assertMajorFaultDetected((fixture) => { fixture.active_activity_count = 2; }, "no_duplicate_active_activity");
  assertMajorFaultDetected((fixture) => { fixture.activity_attempts[0]!.replaced_activity_attempt_public_id = "prior"; fixture.replacement_history_preserved = false; }, "replacement_preserves_prior_activity");
  assertMajorFaultDetected((fixture) => { fixture.duplicate_cycle_extra_count = 1; }, "idempotent_duplicate_creates_no_extra_cycle");
  assertMajorFaultDetected((fixture) => { fixture.idempotent_replay_rejected_count = 1; }, "idempotent_duplicate_creates_no_extra_cycle");

  const { assertAndConfigureE1NoLiveGuard } = await import("../src/lib/evaluation/formative/no-live-guard");
  let liveOptInRejected = false;
  try {
    const liveEnv: NodeJS.ProcessEnv = {
      ...process.env,
      RUN_LIVE_FORMATIVE_EVALUATION: "1"
    };
    assertAndConfigureE1NoLiveGuard(liveEnv);
  } catch {
    liveOptInRejected = true;
  }
  assert(liveOptInRejected, "E1 must reject an attempted live evaluation opt-in.");
  assertAndConfigureE1NoLiveGuard();
  const { prisma } = await import("../src/lib/db");
  const { runFormativeEvaluationScenario } = await import("../src/lib/evaluation/formative/runner");
  const result = await runFormativeEvaluationScenario({
    prisma,
    scenario: loadFormativeEvaluationScenario("correct_answer_robust_reasoning"),
    seed: 3303,
    artifact_dir: ".data/formative-evaluation-smoke/artifact"
  });
  for (const file of REQUIRED_RUN_ARTIFACT_FILES) {
    await access(path.join(result.artifact_directory, file));
  }
  const manifest = RunManifestSchema.parse(JSON.parse(await readFile(path.join(result.artifact_directory, "manifest.json"), "utf8")));
  assert(manifest.provider_access_enabled === false && manifest.provider_call_count === 0, "Artifact manifest must prove no-live execution.");
  assert(manifest.cleanup_result.succeeded, "Artifact manifest should record cleanup success.");
  FormativeEvaluationScenarioSchema.parse(JSON.parse(await readFile(path.join(result.artifact_directory, "scenario.json"), "utf8")));
  SimulatedStudentStateSchema.parse(JSON.parse(await readFile(path.join(result.artifact_directory, "initial-student-state.json"), "utf8")));
  SimulatedStudentStateSchema.parse(JSON.parse(await readFile(path.join(result.artifact_directory, "final-student-state.json"), "utf8")));
  const invariantRecords = JSON.parse(await readFile(path.join(result.artifact_directory, "hard-invariants.json"), "utf8")) as unknown[];
  invariantRecords.forEach((entry) => HardInvariantResultSchema.parse(entry));
  const rubricRecords = JSON.parse(await readFile(path.join(result.artifact_directory, "pedagogical-rubric.json"), "utf8")) as unknown[];
  rubricRecords.forEach((entry) => PedagogicalRubricRecordSchema.parse(entry));
  for (const file of REQUIRED_RUN_ARTIFACT_FILES.filter((name) => name.endsWith(".jsonl"))) {
    const lines = (await readFile(path.join(result.artifact_directory, file), "utf8")).trim().split("\n").filter(Boolean);
    lines.forEach((line) => JSON.parse(line));
  }
  const allText = await Promise.all(REQUIRED_RUN_ARTIFACT_FILES.map((file) => readFile(path.join(result.artifact_directory, file), "utf8")));
  assert(!allText.join("\n").includes("sk-e1-secret-fixture"), "Artifacts must remain redacted.");
  return { status: "passed", required_file_count: REQUIRED_RUN_ARTIFACT_FILES.length, provider_call_count: 0 };
}

if (process.argv[1]?.endsWith("formative-evaluation-artifact-smoke-test.ts")) {
  runFormativeEvaluationArtifactSmoke().then((result) => console.log(JSON.stringify(result, null, 2))).catch((error) => {
    console.error(error instanceof Error ? error.message : "Artifact smoke failed.");
    process.exitCode = 1;
  });
}
