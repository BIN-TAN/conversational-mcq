import { inspectLivePilotRun } from "../src/lib/services/evals/pilot-execution";

function argValue(name: string) {
  const index = process.argv.indexOf(name);

  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const runPublicId = argValue("--run");

  if (!runPublicId) {
    throw new Error("Usage: npm run eval:live-pilot:inspect -- --run <pilot_run_public_id>");
  }

  const report = await inspectLivePilotRun(runPublicId);

  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Live pilot inspect failed.");
  process.exitCode = 1;
});
