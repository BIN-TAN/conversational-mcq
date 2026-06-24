import { readFile } from "node:fs/promises";
import { confirmAiReviewAnnotationsForRun } from "../src/lib/services/evals/annotation-adjudication";

function argValue(name: string) {
  const index = process.argv.indexOf(name);

  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const runPublicId = argValue("--run");
  const annotationsPath = argValue("--annotations");
  const referencePath = argValue("--reference");
  const reviewerModel = argValue("--reviewer-model");
  const reviewTarget = argValue("--review-target");
  const confirmAiReview = process.argv.includes("--confirm-ai-review");

  if (!runPublicId || !annotationsPath || !referencePath || !reviewerModel) {
    throw new Error(
      "Usage: npm run eval:annotations:confirm-ai-review -- --run <run_public_id> --annotations <csv_path> --reference <reference_path> --reviewer-model <model> [--review-target raw_model_output|effective_system_output] --confirm-ai-review"
    );
  }

  const [annotationCsvText, referenceJsonlText] = await Promise.all([
    readFile(annotationsPath, "utf8"),
    readFile(referencePath, "utf8")
  ]);
  const result = await confirmAiReviewAnnotationsForRun({
    runPublicId,
    annotationCsvText,
    referenceJsonlText,
    reviewerModel,
    confirmAiReview,
    reviewTarget
  });

  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "AI review confirmation failed.");
  process.exitCode = 1;
});
