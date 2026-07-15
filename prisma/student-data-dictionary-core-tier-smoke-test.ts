import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  buildCoreProcessEventCodebookEntries,
  buildCoreResearchDictionaryEntries,
  buildResearchCategoryDictionaryEntries,
  buildSupplementaryResearchDictionaryEntries,
  processEventCodebookCsv,
  researchCategoryDictionaryCsv,
  researchCategoryDictionaryJson
} from "../src/lib/services/teacher-research-data/dictionary";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function main() {
  const core = buildCoreResearchDictionaryEntries();
  const supplementary = buildSupplementaryResearchDictionaryEntries();
  const coreEvents = buildCoreProcessEventCodebookEntries();
  const categories = buildResearchCategoryDictionaryEntries();
  const outputDir = path.join(process.cwd(), ".data", "research-data-dictionary-artifacts", "latest");
  if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });
  writeFileSync(path.join(outputDir, "research_category_dictionary.csv"), researchCategoryDictionaryCsv(categories));
  writeFileSync(path.join(outputDir, "research_category_dictionary.json"), researchCategoryDictionaryJson(categories));
  writeFileSync(path.join(outputDir, "core_process_event_codebook.csv"), processEventCodebookCsv(coreEvents));

  assert(core.length > 0, "Core research tier should include ordinary research variables.");
  assert(supplementary.length > 0, "Supplementary research tier should include advanced/compatibility variables.");
  assert(core.every((entry) => entry.documentation_tier === "core_research"), "Default core variables must have core_research tier.");
  assert(!core.some((entry) => entry.entity_type !== "research_variable"), "Core research variables must not include non-variable entities.");
  assert(!core.some((entry) => entry.documentation_tier === "technical_documentation" || entry.documentation_tier === "excluded_platform"), "Core tier must exclude technical and platform records.");
  assert(!core.some((entry) => entry.deprecated === "true"), "Deprecated aliases must be hidden from core browsing.");
  assert(!core.some((entry) => entry.duplicate_relationship === "derived_convenience_copy"), "Convenience copies must not inflate core counts.");
  assert(coreEvents.every((entry) => entry.process_event_tier === "core_learning_process"), "Default process-event view should contain only core learning-process events.");
  assert(!coreEvents.some((entry) => /workflow_job|export_|agent_retry/.test(entry.event_type)), "Operational-only events must not appear in the core process-event view.");

  const categoryIds = new Set(categories.map((category) => category.category_id));
  assert(core.every((entry) => categoryIds.has(entry.research_category_id)), "Every core variable needs a category-registry entry.");
  assert(categories.every((category) => Number(category.variable_count) >= 0), "Category registry needs variable counts.");

  console.log(JSON.stringify({
    status: "passed",
    core_research_variables: core.length,
    supplementary_research_variables: supplementary.length,
    core_process_events: coreEvents.length,
    category_count: categories.length,
    artifact_directory: outputDir,
    no_openai_call_occurred: true
  }, null, 2));
}

main();
