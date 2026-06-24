import { amendConfirmedEvalAnnotations } from "../src/lib/services/evals/confirmed-annotation-amendment";

function argValue(name: string) {
  const index = process.argv.indexOf(name);

  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const runPublicId = argValue("--run");
  const caseId = argValue("--case");
  const removeCriticalFlag = argValue("--remove-critical-flag");
  const confirmResearcherInstruction = process.argv.includes("--confirm-researcher-instruction");

  if (!runPublicId || !caseId || !removeCriticalFlag) {
    throw new Error(
      "Usage: npm run eval:annotations:amend-confirmed -- --run <run_public_id> --case <case_id> --remove-critical-flag <flag> --confirm-researcher-instruction"
    );
  }

  const result = await amendConfirmedEvalAnnotations({
    runPublicId,
    caseId,
    removeCriticalFlag,
    confirmResearcherInstruction
  });

  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Confirmed annotation amendment failed.");
  process.exitCode = 1;
});
