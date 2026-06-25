import { liveCanaryDatabaseUrl } from "./operational-live-canary-shared";

function argValue(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  process.env.OPERATIONAL_LIVE_CANARY_DATABASE_URL = liveCanaryDatabaseUrl();
  const { runOperationalLiveCanary } = await import("../src/lib/services/operational-live-canary/service");
  const confirmPaidApi = process.argv.includes("--confirm-paid-api");
  const newRun = process.argv.includes("--new-run");
  const resumeRunPublicId = argValue("--resume");
  const jsonProgress = process.argv.includes("--json-progress");
  let interrupted = false;

  const onSignal = (signal: NodeJS.Signals) => {
    interrupted = true;
    const payload = {
      event: "operational_live_canary_interrupted",
      signal,
      provider_secret_exposed: false
    };
    if (jsonProgress) {
      console.error(JSON.stringify(payload));
    } else {
      console.error(`Operational live canary interrupted by ${signal}.`);
    }
    process.exitCode = 130;
  };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);

  if (jsonProgress) {
    console.error(JSON.stringify({
      event: "operational_live_canary_start",
      new_run: newRun,
      resume_run_public_id: resumeRunPublicId ?? null
    }));
  }

  const result = await runOperationalLiveCanary({
    confirmPaidApi,
    newRun,
    resumeRunPublicId
  });

  if (interrupted) {
    return;
  }
  if (jsonProgress) {
    console.error(JSON.stringify({
      event: "operational_live_canary_finish",
      status: "status" in result ? result.status : "unknown",
      run_public_id: "run_public_id" in result ? result.run_public_id : null
    }));
  }
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Operational live canary failed.");
  process.exitCode = 1;
});
