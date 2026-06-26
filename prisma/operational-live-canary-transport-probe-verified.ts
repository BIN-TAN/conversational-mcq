import { runOperationalLiveCanaryVerifiedTransportProbe } from "@/lib/services/operational-live-canary/service";

function hasFlag(flag: string) {
  return process.argv.includes(flag);
}

async function main() {
  const result = await runOperationalLiveCanaryVerifiedTransportProbe({
    confirmNetworkCheck: hasFlag("--confirm-network-check"),
    confirmPaidApi: hasFlag("--confirm-paid-api")
  });
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
