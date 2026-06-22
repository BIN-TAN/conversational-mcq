import { createLiveCanaryPreflightReport } from "../src/lib/services/evals/live-execution";

async function main() {
  const report = await createLiveCanaryPreflightReport();

  console.log(JSON.stringify(report, null, 2));

  if (!report.ready) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Live canary preflight failed.");
  process.exitCode = 1;
});
