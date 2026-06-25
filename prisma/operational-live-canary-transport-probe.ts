import { runOperationalLiveCanaryTransportProbe } from "../src/lib/services/operational-live-canary/service";

async function main() {
  console.log(JSON.stringify(await runOperationalLiveCanaryTransportProbe({
    confirmPaidApi: process.argv.includes("--confirm-paid-api")
  }), null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Operational live canary transport probe failed.");
  process.exitCode = 1;
});
