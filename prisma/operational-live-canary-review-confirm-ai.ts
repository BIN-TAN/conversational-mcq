import { confirmOperationalLiveCanaryEffectiveReviewFromEvidence } from "../src/lib/services/operational-live-canary/service";

function argValue(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const runPublicId = argValue("--run");
  if (!runPublicId) {
    throw new Error("Use --run <run_public_id>.");
  }
  if (!process.argv.includes("--confirm-ai-review")) {
    throw new Error("Use --confirm-ai-review to record operational review annotations.");
  }

  const reviewerModel = argValue("--reviewer-model");
  const result = await confirmOperationalLiveCanaryEffectiveReviewFromEvidence({
    runPublicId,
    reviewerModel
  });

  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Operational live canary review confirmation failed.");
  process.exitCode = 1;
});
