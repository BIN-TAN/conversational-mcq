import { readFile } from "node:fs/promises";
import { importDraftAnnotationsForRun } from "../src/lib/services/evals/annotation-adjudication";

function argValue(name: string) {
  const index = process.argv.indexOf(name);

  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const runPublicId = argValue("--run");
  const annotationPath = argValue("--annotations");
  const referencePath = argValue("--reference");

  if (!runPublicId || !annotationPath || !referencePath) {
    throw new Error(
      "Usage: npm run eval:annotations:import-draft -- --run <run_public_id> --annotations <annotation_csv_path> --reference <review_reference_jsonl_path>"
    );
  }

  const [annotationCsvText, referenceJsonlText] = await Promise.all([
    readFile(annotationPath, "utf8"),
    readFile(referencePath, "utf8")
  ]);

  const result = await importDraftAnnotationsForRun({
    runPublicId,
    data: {
      annotation_csv_text: annotationCsvText,
      reference_jsonl_text: referenceJsonlText,
      source_file_name: annotationPath.split(/[\\/]/).at(-1)
    }
  });

  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Draft annotation import failed.");
  process.exitCode = 1;
});
