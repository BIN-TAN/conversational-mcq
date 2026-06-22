import { createCanaryReadinessReport } from "../src/lib/services/evals/live-execution";

function argValue(name: string) {
  const index = process.argv.indexOf(name);

  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const runPublicId = argValue("--run");

  if (!runPublicId) {
    throw new Error("Usage: npm run eval:live-canary:report -- --run <run_public_id>");
  }

  const report = await createCanaryReadinessReport(runPublicId);

  console.log(JSON.stringify(report, null, 2));

  if (report.recommendation !== "ready_for_full_pilot") {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Live canary report failed.");
  process.exitCode = 1;
});
