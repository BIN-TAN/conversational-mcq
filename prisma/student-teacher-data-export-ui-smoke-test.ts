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
  assertNotIncludes(dataHome, "Download quick summaries", "Data and outcomes landing page");
  assertNotIncludes(dataHome, "Upload or paste outcome CSV data", "Data and outcomes landing page");

  assertIncludes(unifiedPage, "ResearchDataExportsClient", "Unified research export page");
  assertIncludes(unifiedClient, "Research dataset", "Unified research export client");
  assertIncludes(unifiedClient, "Data dictionary", "Unified research export client");
  assertNotIncludes(unifiedClient, "Quick summary", "Unified research export client");
  assertNotIncludes(unifiedClient, "Analysis-ready dataset", "Unified research export client");
  assertNotIncludes(unifiedClient, "Full archive", "Unified research export client");
  assertIncludes(unifiedClient, "Search selected section", "Unified research export client");
  assertIncludes(unifiedClient, "Page size", "Unified research export client");
  assertIncludes(unifiedClient, "First", "Unified research export client");
  assertIncludes(unifiedClient, "Previous", "Unified research export client");
  assertIncludes(unifiedClient, "Next", "Unified research export client");
  assertIncludes(unifiedClient, "Last", "Unified research export client");
  assertIncludes(unifiedClient, "How the data are produced", "Unified research export client");
  assertIncludes(unifiedClient, "Deprecated status", "Unified research export client");
  assertIncludes(unifiedClient, "Core learning-process events", "Unified research export client");
  assertIncludes(unifiedClient, "Internal schema appendix", "Unified research export client");
  assertIncludes(unifiedClient, "Platform administration and excluded variables", "Unified research export client");
  assertNotIncludes(unifiedClient, "All privacy levels", "Unified research export client");
  assertNotIncludes(unifiedClient, "All export tiers", "Unified research export client");
  assertNotIncludes(unifiedClient, "All source types", "Unified research export client");
  assertNotIncludes(unifiedClient, "All field families", "Unified research export client");
  assertIncludes(unifiedClient, "No data are available for the selected scope", "Unified research export client");
  assertIncludes(unifiedClient, "Generate research dataset", "Unified research export client");
  assertNotIncludes(unifiedClient, "Generate analysis-ready ZIP", "Unified research export client");
  assertNotIncludes(unifiedClient, "Generate full archive", "Unified research export client");
  assertIncludes(unifiedClient, "Export job history", "Unified research export client");
  assertIncludes(unifiedClient, "confirm_restricted_fields", "Unified research export client");

  assertIncludes(oldExplorer, "redirect(\"/teacher/data/research?section=dataset\")", "Deprecated explorer route");
  assertIncludes(oldMasterExport, "redirect(\"/teacher/data/research?section=dataset\")", "Deprecated master export route");

  const nav = source("src/components/teacher-primary-nav-items.ts");
  assertIncludes(nav, "Data and outcomes", "Teacher navigation");
  assertIncludes(nav, "/teacher/data", "Teacher navigation");
  assertNotIncludes(nav, "/teacher/data/explorer", "Teacher navigation");
  assertNotIncludes(nav, "/teacher/data/export", "Teacher navigation");

  const analysisRoute = source("src/app/api/teacher/research-data/analysis-ready/route.ts");
  const dictionaryRoute = source("src/app/api/teacher/research-data/dictionary/route.ts");
  assertIncludes(analysisRoute, "requireTeacherResearcher", "Research dataset API route");
  assertIncludes(analysisRoute, "Restricted research fields require explicit confirmation", "Research dataset API route");
  assertIncludes(analysisRoute, "export_type: \"research_dataset\"", "Research dataset API route");
  assertIncludes(analysisRoute, "exportJob.create", "Research dataset API route");
  assertIncludes(dictionaryRoute, "requireTeacherResearcher", "Dictionary API route");
  assertIncludes(dictionaryRoute, "paginateDictionaryEntries", "Dictionary API route");

  console.log(
    JSON.stringify(
      {
        status: "passed",
        data_home_cards: ["Research data and exports", "Summative outcomes"],
        unified_sections: ["Research dataset", "Data dictionary"],
        old_routes_redirect: true,
        no_openai_call_occurred: true
      },
      null,
      2
    )
  );
}

main();
