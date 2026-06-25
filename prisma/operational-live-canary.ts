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

  const result = await runOperationalLiveCanary({
    confirmPaidApi,
    newRun,
    resumeRunPublicId
  });

  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Operational live canary failed.");
  process.exitCode = 1;
});
