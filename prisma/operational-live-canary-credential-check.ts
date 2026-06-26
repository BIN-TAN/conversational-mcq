import { performOperationalLiveCanaryCredentialCheck } from "@/lib/services/operational-live-canary/service";

function hasFlag(flag: string) {
  return process.argv.includes(flag);
}

async function main() {
  const result = await performOperationalLiveCanaryCredentialCheck({
    confirmNetworkCheck: hasFlag("--confirm-network-check")
  });
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
