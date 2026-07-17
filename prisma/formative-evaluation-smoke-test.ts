import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadEnvConfig } from "@next/env";
import { REQUIRED_RUN_ARTIFACT_FILES } from "../src/lib/evaluation/formative/artifact-writer";
import { listFormativeEvaluationScenarios } from "../src/lib/evaluation/formative/scenario-loader";
import { writeFormativeEvaluationAggregate } from "../src/lib/evaluation/formative/result-aggregation";
import { runFormativeEvaluationDeterminismSmoke } from "./formative-evaluation-determinism-smoke-test";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main() {
  loadEnvConfig(process.cwd());
  await runFormativeEvaluationDeterminismSmoke();
  const { assertAndConfigureE1NoLiveGuard } = await import("../src/lib/evaluation/formative/no-live-guard");
  assertAndConfigureE1NoLiveGuard();
  const { prisma } = await import("../src/lib/db");
  const { runFormativeEvaluationScenario } = await import("../src/lib/evaluation/formative/runner");
  const smokeArtifactParent = path.resolve(".data/formative-evaluation-smoke");
  await mkdir(smokeArtifactParent, { recursive: true });
  const artifactRoot = await mkdtemp(path.join(smokeArtifactParent, "full-"));
  const scenarios = listFormativeEvaluationScenarios();
  assert(scenarios.length === 12, "Full E1 smoke requires all 12 scenarios.");
  const failureRoot = await mkdtemp(path.join(tmpdir(), "formative-e1-failure-"));
  const blockedArtifactRoot = path.join(failureRoot, "artifact-root-is-a-file");
  await writeFile(blockedArtifactRoot, "controlled artifact failure", "utf8");
  let controlledFailureObserved = false;
  try {
    await runFormativeEvaluationScenario({
      prisma,
      scenario: scenarios[0]!,
      seed: 9091,
      artifact_dir: blockedArtifactRoot
    });
  } catch {
    controlledFailureObserved = true;
  } finally {
    await rm(failureRoot, { recursive: true, force: true });
  }
  assert(controlledFailureObserved, "Controlled artifact failure should exercise the cleanup path.");
  assert(
    await prisma.user.count({ where: { user_id: { startsWith: "student_e1_" } } }) === 0,
    "A failed run must clean its disposable student before the next run."
  );
  const results = [];
  for (const scenario of scenarios) {
    const result = await runFormativeEvaluationScenario({ prisma, scenario, seed: 1001, artifact_dir: artifactRoot });
    assert(result.manifest.provider_call_count === 0, `${scenario.scenario_id}: provider call detected.`);
    assert(result.manifest.cleanup_result.succeeded, `${scenario.scenario_id}: fixture cleanup failed.`);
    for (const file of REQUIRED_RUN_ARTIFACT_FILES) await access(path.join(result.artifact_directory, file));
    results.push(result);
  }
  const fixtureAssessments = results.map((result) => result.manifest.fixture_public_ids.assessment_public_id);
  const fixtureSessions = results.map((result) => result.manifest.fixture_public_ids.session_public_id);
  assert(new Set(fixtureAssessments).size === results.length, "Evaluation runs must not share assessments.");
  assert(new Set(fixtureSessions).size === results.length, "Evaluation runs must not share sessions.");
  const remainingStudents = await prisma.user.count({ where: { user_id: { startsWith: "student_e1_" } } });
  assert(remainingStudents === 0, "Full smoke should not leave disposable E1 students.");
  const report = await writeFormativeEvaluationAggregate(artifactRoot);
  assert(report.runs.length === 12, "Aggregate should include all 12 scenario runs.");
  const providerCalls = results.reduce((sum, result) => sum + result.artifacts.run_summary.provider_call_count, 0);
  assert(providerCalls === 0, "Full E1 smoke must make zero provider calls.");
  console.log(JSON.stringify({
    status: "passed",
    scenario_count: results.length,
    scenario_pass_count: results.filter((result) => result.artifacts.run_summary.passed).length,
    scenario_fail_count: results.filter((result) => !result.artifacts.run_summary.passed).length,
    critical_invariant_failure_count: results.reduce((sum, result) => sum + result.artifacts.run_summary.critical_invariant_failure_count, 0),
    provider_call_count: providerCalls,
    fixture_cleanup_verified: true,
    artifact_root: artifactRoot
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Formative evaluation smoke failed.");
  process.exitCode = 1;
});
