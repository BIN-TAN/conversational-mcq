import { diagnoseTargetedRemediationRun } from "../src/lib/services/evals/targeted-remediation-diagnostic";

function argValue(name: string) {
  const index = process.argv.indexOf(name);

  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const runPublicId = argValue("--run");

  if (!runPublicId) {
    throw new Error("Usage: npm run eval:targeted-remediation:diagnose -- --run <run_public_id>");
  }

  const result = await diagnoseTargetedRemediationRun(runPublicId);

  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Targeted remediation diagnosis failed.");
  process.exitCode = 1;
});
