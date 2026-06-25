import { loadEnvConfig } from "@next/env";
import { getGuardedOperationalAgentIntegrationReadiness } from "../src/lib/operational/guarded-agent-integration";

loadEnvConfig(process.cwd());

async function main() {
  const readiness = await getGuardedOperationalAgentIntegrationReadiness({
    checkEvaluationEvidence: process.argv.includes("--check-eval")
  });

  console.log(JSON.stringify(readiness, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
