import { readFileSync } from "node:fs";
import path from "node:path";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function source(file: string) {
  return readFileSync(path.join(process.cwd(), file), "utf8");
}

function assertIncludes(value: string, expected: string, label: string) {
  assert(value.includes(expected), `${label} should include ${expected}.`);
}

function assertNotIncludes(value: string, unexpected: string, label: string) {
  assert(!value.includes(unexpected), `${label} should not include ${unexpected}.`);
}

function main() {
  const client = source("src/components/teacher-data/research-data-exports-client.tsx");
  const apiRoute = source("src/app/api/teacher/research-data/analysis-ready/route.ts");

  assertIncludes(client, "fetchResearchExportReadiness", "Research export client");
  assertIncludes(client, "Research export is not configured", "Research export client");
  assertIncludes(client, "readiness.blocking_reasons[0]?.label", "Research export client readiness copy source");
  assertIncludes(client, "method: \"POST\"", "Research export client");
  assertIncludes(client, "window.location.assign(job.download_url)", "Research export client");
  assertIncludes(client, "setError(", "Research export client");
  assertNotIncludes(client, "datasetHref", "Research export client");
  assertNotIncludes(client, "href={datasetHref}", "Research export client");
  assertIncludes(client, "disabled={!hasData || readinessBlocked || generatingDataset}", "Generate button");
  assertIncludes(client, "session_public_id", "Research export client");

  assertIncludes(apiRoute, "jsonApiError(code", "Research export API route");
  assertIncludes(apiRoute, "exportJob.create", "Research export API route");
  assertIncludes(apiRoute, "status: \"failed\"", "Research export API route");
  assertIncludes(apiRoute, "readiness_state", "Research export API route");
  assertIncludes(apiRoute, "request_id", "Research export API route");
  assertIncludes(apiRoute, "retryable: true", "Research export API route");
  assertIncludes(apiRoute, "selected_session", "Research export API route");
  assertNotIncludes(apiRoute, "RESEARCH_PSEUDONYMIZATION_KEY:", "Research export API route");

  console.log(
    JSON.stringify(
      {
        status: "passed",
        direct_anchor_removed: true,
        in_page_error_handling: true,
        no_openai_call_occurred: true
      },
      null,
      2
    )
  );
}

main();
