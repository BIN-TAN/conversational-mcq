import { loadEnvConfig } from "@next/env";
import { PrismaClient } from "@prisma/client";

loadEnvConfig(process.cwd());

async function main() {
  const command = process.argv[2];
  const artifactRootArgIndex = process.argv.indexOf("--artifact-root");
  const artifactRoot = artifactRootArgIndex >= 0 ? process.argv[artifactRootArgIndex + 1] : undefined;
  if (command === "report") {
    const { readE2AReport } = await import("../src/lib/evaluation/formative/e2a-runner");
    console.log(JSON.stringify(await readE2AReport(artifactRoot), null, 2));
    return;
  }
  if (command !== "canary" && command !== "full") {
    throw new Error("Use one of: canary, full, report.");
  }
  const prisma = new PrismaClient();
  try {
    const { runE2AStage } = await import("../src/lib/evaluation/formative/e2a-runner");
    const result = await runE2AStage({
      prisma,
      stage: command,
      ...(artifactRoot ? { artifact_root: artifactRoot } : {})
    });
    console.log(JSON.stringify({ artifact_root: result.root, summary: result.summary }, null, 2));
    if (command === "canary" && result.summary.canary_gate_passed !== true) process.exitCode = 1;
    if (command === "full" && result.summary.full_matrix_completed !== true) process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(JSON.stringify({
    status: "blocked_or_failed",
    reason: error instanceof Error ? error.message : "unknown_e2a_failure",
    secret_values_printed: false
  }, null, 2));
  process.exitCode = 1;
});
