import { createOperationalLiveCanaryReadyStatus } from "@/lib/services/operational-live-canary/service";

async function main() {
  const result = await createOperationalLiveCanaryReadyStatus();
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
