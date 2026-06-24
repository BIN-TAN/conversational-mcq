import { runTargetedRemediation } from "../src/lib/services/evals/targeted-remediation-execution";

function argValue(name: string) {
  const index = process.argv.indexOf(name);

  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const confirmPaidApi = process.argv.includes("--confirm-paid-api");
  const newRun = process.argv.includes("--new-run");
  const resumeRunPublicId = argValue("--resume");

  if (!confirmPaidApi) {
    throw new Error("Refusing to run paid targeted remediation evaluation without --confirm-paid-api.");
  }

  if (newRun && resumeRunPublicId) {
    throw new Error("Use either --new-run or --resume <run_public_id>, not both.");
  }

  if (!newRun && !resumeRunPublicId) {
    throw new Error("Targeted remediation execution requires explicit run selection: use --new-run or --resume <run_public_id>.");
  }

  const summary = await runTargetedRemediation({
    confirmPaidApi,
    runInstanceMode: newRun ? "new_run" : "resume",
    runPublicId: resumeRunPublicId
  });

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Targeted remediation evaluation failed.");
  process.exitCode = 1;
});
