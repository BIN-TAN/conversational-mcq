import { runLivePilot } from "../src/lib/services/evals/pilot-execution";

function argValue(name: string) {
  const index = process.argv.indexOf(name);

  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const confirmPaidApi = process.argv.includes("--confirm-paid-api");
  const newRun = process.argv.includes("--new-run");
  const resumeRunPublicId = argValue("--resume");
  const approvedCanaryRunPublicId = argValue("--approved-canary");

  if (!confirmPaidApi) {
    throw new Error("Refusing to run paid pilot without --confirm-paid-api.");
  }

  if (newRun && resumeRunPublicId) {
    throw new Error("Use either --new-run or --resume <pilot_run_public_id>, not both.");
  }

  if (!newRun && !resumeRunPublicId) {
    throw new Error("Paid pilot execution requires explicit run selection: use --new-run or --resume <pilot_run_public_id>.");
  }

  if (newRun && !approvedCanaryRunPublicId && !process.env.EVAL_PILOT_APPROVED_CANARY_RUN_ID) {
    throw new Error("New pilot runs require --approved-canary <run_public_id> or EVAL_PILOT_APPROVED_CANARY_RUN_ID.");
  }

  const summary = await runLivePilot({
    approvedCanaryRunPublicId,
    confirmPaidApi,
    runInstanceMode: newRun ? "new_run" : "resume",
    runPublicId: resumeRunPublicId
  });

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Live pilot failed.");
  process.exitCode = 1;
});
