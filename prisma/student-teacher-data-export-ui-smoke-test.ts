import { readFileSync } from "node:fs";
import path from "node:path";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
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
  const dataHome = source("src/app/teacher/data/page.tsx");
  const unifiedPage = source("src/app/teacher/data/research/page.tsx");
  const unifiedClient = source("src/components/teacher-data/research-data-exports-client.tsx");
  const oldExplorer = source("src/app/teacher/data/explorer/page.tsx");
  const oldMasterExport = source("src/app/teacher/data/export/page.tsx");

  assertIncludes(dataHome, "Research data and exports", "Data and outcomes landing page");
  assertIncludes(dataHome, "Summative outcomes", "Data and outcomes landing page");
  assertNotIncludes(dataHome, "Data Explorer</h2>", "Data and outcomes landing page");
  assertNotIncludes(dataHome, "Master CSV export", "Data and outcomes landing page");
  assertNotIncludes(dataHome, "Download all research data", "Data and outcomes landing page");

  assertIncludes(unifiedPage, "ResearchDataExportsClient", "Unified research export page");
  assertIncludes(unifiedClient, "Quick summary", "Unified research export client");
  assertIncludes(unifiedClient, "Analysis-ready dataset", "Unified research export client");
  assertIncludes(unifiedClient, "Full archive", "Unified research export client");
  assertIncludes(unifiedClient, "Data dictionary", "Unified research export client");
  assertIncludes(unifiedClient, "Search variables", "Unified research export client");
  assertIncludes(unifiedClient, "All privacy levels", "Unified research export client");
  assertIncludes(unifiedClient, "All export tiers", "Unified research export client");
  assertIncludes(unifiedClient, "No data are available for the selected scope", "Unified research export client");
  assertIncludes(unifiedClient, "Generate analysis-ready ZIP", "Unified research export client");
  assertIncludes(unifiedClient, "Generate full archive", "Unified research export client");
  assertIncludes(unifiedClient, "Current export job history", "Unified research export client");
  assertIncludes(unifiedClient, "confirm_restricted_fields", "Unified research export client");

  assertIncludes(oldExplorer, "redirect(\"/teacher/data/research?tab=quick\")", "Deprecated explorer route");
  assertIncludes(oldMasterExport, "redirect(\"/teacher/data/research?tab=analysis\")", "Deprecated master export route");

  const nav = source("src/components/teacher-primary-nav-items.ts");
  assertIncludes(nav, "Data and outcomes", "Teacher navigation");
  assertIncludes(nav, "/teacher/data", "Teacher navigation");
  assertNotIncludes(nav, "/teacher/data/explorer", "Teacher navigation");
  assertNotIncludes(nav, "/teacher/data/export", "Teacher navigation");

  const analysisRoute = source("src/app/api/teacher/research-data/analysis-ready/route.ts");
  const dictionaryRoute = source("src/app/api/teacher/research-data/dictionary/route.ts");
  assertIncludes(analysisRoute, "requireTeacherResearcher", "Analysis-ready API route");
  assertIncludes(analysisRoute, "Restricted research fields require explicit confirmation", "Analysis-ready API route");
  assertIncludes(analysisRoute, "exportJob.create", "Analysis-ready API route");
  assertIncludes(dictionaryRoute, "requireTeacherResearcher", "Dictionary API route");

  console.log(
    JSON.stringify(
      {
        status: "passed",
        data_home_cards: ["Research data and exports", "Summative outcomes"],
        unified_sections: ["Quick summary", "Analysis-ready dataset", "Full archive", "Data dictionary"],
        old_routes_redirect: true,
        no_openai_call_occurred: true
      },
      null,
      2
    )
  );
}

main();
