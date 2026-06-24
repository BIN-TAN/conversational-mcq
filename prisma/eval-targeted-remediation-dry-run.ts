import { createTargetedRemediationDryRunReport } from "../src/lib/services/evals/targeted-remediation-execution";

async function main() {
  const report = await createTargetedRemediationDryRunReport();

  console.log(JSON.stringify(report, null, 2));

  if (!report.ready) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Targeted remediation dry run failed.");
  process.exitCode = 1;
});
