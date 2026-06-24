import { inspectTargetedRemediationRun } from "../src/lib/services/evals/targeted-remediation-execution";

function argValue(name: string) {
  const index = process.argv.indexOf(name);

  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const runPublicId = argValue("--run");

  if (!runPublicId) {
    throw new Error("Usage: npm run eval:targeted-remediation:inspect -- --run <run_public_id>");
  }

  console.log(JSON.stringify(await inspectTargetedRemediationRun(runPublicId), null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Targeted remediation inspect failed.");
  process.exitCode = 1;
});
