import { runLiveCanary } from "../src/lib/services/evals/live-execution";

function argValue(name: string) {
  const index = process.argv.indexOf(name);

  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const confirmPaidApi = process.argv.includes("--confirm-paid-api");
  const runPublicId = argValue("--run");

  if (!confirmPaidApi) {
    throw new Error("Refusing to run paid evaluation without --confirm-paid-api.");
  }

  const summary = await runLiveCanary({
    confirmPaidApi,
    runPublicId
  });

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Live canary failed.");
  process.exitCode = 1;
});
