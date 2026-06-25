import { createOperationalLiveCanaryTransportProbePreflight } from "../src/lib/services/operational-live-canary/service";

async function main() {
  console.log(JSON.stringify(await createOperationalLiveCanaryTransportProbePreflight(), null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Operational live canary transport probe preflight failed.");
  process.exitCode = 1;
});
