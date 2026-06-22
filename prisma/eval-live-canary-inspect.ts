import { inspectLiveCanaryRun } from "../src/lib/services/evals/live-execution";

function argValue(name: string) {
  const index = process.argv.indexOf(name);

  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const runPublicId = argValue("--run");

  if (!runPublicId) {
    throw new Error("Usage: npm run eval:live-canary:inspect -- --run <run_public_id>");
  }

  const report = await inspectLiveCanaryRun(runPublicId);

  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Live canary inspect failed.");
  process.exitCode = 1;
});
