import { runLiveCanary } from "../src/lib/services/evals/live-execution";

function argValue(name: string) {
  const index = process.argv.indexOf(name);

  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const confirmPaidApi = process.argv.includes("--confirm-paid-api");
  const newRun = process.argv.includes("--new-run");
  const resumeRunPublicId = argValue("--resume");

  if (!confirmPaidApi) {
    throw new Error("Refusing to run paid evaluation without --confirm-paid-api.");
  }

  if (newRun && resumeRunPublicId) {
    throw new Error("Use either --new-run or --resume <run_public_id>, not both.");
  }

  if (!newRun && !resumeRunPublicId) {
    throw new Error("Paid evaluation requires explicit run selection: use --new-run or --resume <run_public_id>.");
  }

  const summary = await runLiveCanary({
    confirmPaidApi,
    runInstanceMode: newRun ? "new_run" : "resume",
    runPublicId: resumeRunPublicId
  });

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Live canary failed.");
  process.exitCode = 1;
});
