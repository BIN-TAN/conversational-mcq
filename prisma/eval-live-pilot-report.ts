import { createFullPilotReadinessReport } from "../src/lib/services/evals/pilot-execution";

function argValue(name: string) {
  const index = process.argv.indexOf(name);

  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const runPublicId = argValue("--run");

  if (!runPublicId) {
    throw new Error("Usage: npm run eval:live-pilot:report -- --run <pilot_run_public_id>");
  }

  const report = await createFullPilotReadinessReport(runPublicId);

  console.log(JSON.stringify(report, null, 2));

  if (report.recommendation !== "ready_for_controlled_operational_integration") {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Live pilot report failed.");
  process.exitCode = 1;
});
