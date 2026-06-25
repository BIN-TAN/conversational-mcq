import { exportOperationalLiveCanaryReviewPacket } from "../src/lib/services/operational-live-canary/service";

function argValue(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const runPublicId = argValue("--run");
  if (!runPublicId) {
    throw new Error("Use --run <run_public_id>.");
  }

  console.log(JSON.stringify(await exportOperationalLiveCanaryReviewPacket(runPublicId), null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Operational live canary review export failed.");
  process.exitCode = 1;
});
