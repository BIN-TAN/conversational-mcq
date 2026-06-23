import { createLivePilotPreflightReport } from "../src/lib/services/evals/pilot-execution";

function argValue(name: string) {
  const index = process.argv.indexOf(name);

  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const report = await createLivePilotPreflightReport({
    approvedCanaryRunPublicId: argValue("--approved-canary")
  });

  console.log(JSON.stringify(report, null, 2));

  if (!report.ready) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Live pilot preflight failed.");
  process.exitCode = 1;
});
