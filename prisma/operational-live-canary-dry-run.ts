import { runCommand } from "./operational-live-canary-shared";
import { createOperationalLiveCanaryDryRun } from "../src/lib/services/operational-live-canary/service";

async function main() {
  runCommand("npx", ["tsx", "prisma/operational-live-canary-db.ts", "prepare"], {
    stdio: "inherit",
    timeoutMs: 120_000
  });
  const report = await createOperationalLiveCanaryDryRun();
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Operational live canary dry run failed.");
  process.exitCode = 1;
});
