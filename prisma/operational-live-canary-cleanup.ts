import { cleanupOperationalLiveCanaryRuntimeFiles } from "../src/lib/services/operational-live-canary/service";

async function main() {
  await cleanupOperationalLiveCanaryRuntimeFiles();
  console.log(JSON.stringify({ status: "cleaned", path: ".data/operational-live-canary" }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Operational live canary cleanup failed.");
  process.exitCode = 1;
});
