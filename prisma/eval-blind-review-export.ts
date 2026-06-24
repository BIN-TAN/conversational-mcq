import { exportBlindReviewPacketForTarget } from "../src/lib/services/evals/blind-review-export";

function argValue(name: string) {
  const index = process.argv.indexOf(name);

  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const runPublicId = argValue("--run");
  const reviewTarget = argValue("--review-target");
  const effectiveResultVersion = argValue("--effective-result-version");

  if (!runPublicId) {
    throw new Error("Usage: npm run eval:blind-review-export -- --run <run_public_id> [--review-target raw_model_output|effective_system_output] [--effective-result-version effective-system-eval-v1|effective-system-eval-v2]");
  }

  const result = await exportBlindReviewPacketForTarget({
    runPublicId,
    reviewTarget,
    effectiveResultVersion
  });

  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Blind review export failed.");
  process.exitCode = 1;
});
