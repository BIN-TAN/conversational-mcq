import { liveMcqDiagnosticAssistantSmoke } from "../src/lib/services/content/mcq-import";

async function main() {
  const result = await liveMcqDiagnosticAssistantSmoke();
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
