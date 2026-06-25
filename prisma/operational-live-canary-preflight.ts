import { createOperationalLiveCanaryPreflightReport } from "../src/lib/services/operational-live-canary/service";

async function main() {
  const report = await createOperationalLiveCanaryPreflightReport();
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Operational live canary preflight failed.");
  process.exitCode = 1;
});
