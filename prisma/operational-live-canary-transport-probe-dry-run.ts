import { createOperationalLiveCanaryTransportProbeDryRun } from "../src/lib/services/operational-live-canary/service";

async function main() {
  console.log(JSON.stringify(await createOperationalLiveCanaryTransportProbeDryRun(), null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Operational live canary transport probe dry run failed.");
  process.exitCode = 1;
});
