/**
 * Item builder authoring assistant v5 (20 Oct 2026): the assistant reads the course materials
 * for their core knowledge points, groups them into topic clusters, keeps that topic map
 * across the conversation, and fills the whole design panel for the mini test's one topic,
 * including the teacher's item templates as exemplars. Generated items keep a low reading load.
 * No database or provider calls. Run with: npx tsx prisma/item-design-topic-map-unit-test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  applyItemDesignAssistantUpdates,
  consistentTopicMap,
  EMPTY_ITEM_DESIGN_TOPIC_MAP,
  ITEM_DESIGN_ASSISTANT_PROMPT_VERSION,
  ITEM_DESIGN_ASSISTANT_SCHEMA_VERSION,
  ITEM_DESIGN_BLUEPRINT_VERSION,
  ITEM_GENERATION_PROMPT_VERSION,
  ItemDesignAssistantOutputSchema,
  normalizeLegacyItemDesignAssistantOutput,
  type ItemDesignBlueprint
} from "../src/lib/services/content/item-design-contract";

let passed = 0;
function check(name: string, run: () => void) {
  run();
  passed += 1;
  console.log(`ok - ${name}`);
}

const topicMap = {
  topics: [
    {
      topic_id: "measurement_logic",
      title: "Measurement logic and IRT assumptions",
      knowledge_points: ["Ability estimates are on a latent scale", "Local independence", "Unidimensionality"],
      source_material_ids: ["material_1"]
    },
    {
      topic_id: "dichotomous_models",
      title: "Dichotomous IRT models",
      knowledge_points: ["Item characteristic curves", "Difficulty and discrimination parameters"],
      source_material_ids: ["material_1", "material_2"]
    }
  ],
  selected_topic_id: "measurement_logic"
};

const baseOutput = {
  schema_version: ITEM_DESIGN_ASSISTANT_SCHEMA_VERSION,
  assistant_message: "I filled the design panel for Measurement logic and IRT assumptions.",
  topic_map: topicMap,
  blueprint_updates: [],
  change_summary: [],
  remaining_questions: [],
  material_summaries: [],
  ready_for_item_generation: true
};

const blueprint: ItemDesignBlueprint = {
  schema_version: ITEM_DESIGN_BLUEPRINT_VERSION,
  section_topic: "Untitled",
  section_summary: "Untitled",
  objectives: [{ objective_id: "objective_1", statement: "Placeholder", evidence_requirements: ["Placeholder evidence"] }],
  misconception_hypotheses: [],
  exemplar_items: [],
  generation_settings: { target_item_count: 4, option_count: 4, difficulty_mix: ["foundational", "analyzing"], context_notes: null }
};

check("Versions moved to the topic-map assistant (v5, output v3) and generation v4", () => {
  assert.equal(ITEM_DESIGN_ASSISTANT_PROMPT_VERSION, "evidence-centered-item-design-assistant-v5");
  assert.equal(ITEM_DESIGN_ASSISTANT_SCHEMA_VERSION, "evidence-centered-item-design-assistant-output-v3");
  assert.equal(ITEM_GENERATION_PROMPT_VERSION, "evidence-centered-mcq-generation-v4");
});

check("The output carries the topic map with knowledge points per topic", () => {
  const parsed = ItemDesignAssistantOutputSchema.parse(baseOutput);
  assert.equal(parsed.topic_map.topics.length, 2);
  assert.deepEqual(parsed.topic_map.topics[1].knowledge_points, ["Item characteristic curves", "Difficulty and discrimination parameters"]);
  assert.equal(parsed.topic_map.selected_topic_id, "measurement_logic");
  const { topic_map: _omitted, ...withoutMap } = baseOutput;
  assert.throws(() => ItemDesignAssistantOutputSchema.parse(withoutMap), "Every v3 reply returns the topic map");
  assert.equal(ItemDesignAssistantOutputSchema.parse({ ...baseOutput, topic_map: EMPTY_ITEM_DESIGN_TOPIC_MAP }).topic_map.topics.length, 0);
  assert.throws(() => ItemDesignAssistantOutputSchema.parse({
    ...baseOutput,
    topic_map: { topics: [{ ...topicMap.topics[0], knowledge_points: [] }], selected_topic_id: null }
  }), "A topic has at least one knowledge point");
});

check("A selected topic that is not in the map is cleared", () => {
  assert.equal(consistentTopicMap(topicMap).selected_topic_id, "measurement_logic");
  assert.equal(consistentTopicMap({ ...topicMap, selected_topic_id: "missing" }).selected_topic_id, null);
  assert.deepEqual(consistentTopicMap({ nonsense: true }), EMPTY_ITEM_DESIGN_TOPIC_MAP);
  assert.deepEqual(consistentTopicMap(undefined), EMPTY_ITEM_DESIGN_TOPIC_MAP);
});

check("Stored v2 outputs replay as v3 with no topics", () => {
  const legacy = { ...baseOutput, schema_version: "evidence-centered-item-design-assistant-output-v2" } as Record<string, unknown>;
  delete legacy.topic_map;
  const replayed = ItemDesignAssistantOutputSchema.parse(normalizeLegacyItemDesignAssistantOutput(legacy));
  assert.equal(replayed.schema_version, ITEM_DESIGN_ASSISTANT_SCHEMA_VERSION);
  assert.deepEqual(replayed.topic_map, EMPTY_ITEM_DESIGN_TOPIC_MAP);
});

check("One reply can fill the whole panel: topic, objectives, misconceptions, templates and settings", () => {
  const objectives = Array.from({ length: 8 }, (_, index) => ({
    update_type: "upsert_objective" as const,
    objective: { objective_id: `kp_${index + 1}`, statement: `Knowledge point ${index + 1}`, evidence_requirements: ["Explains it in a new case"] }
  }));
  const misconceptions = Array.from({ length: 12 }, (_, index) => ({
    update_type: "upsert_misconception" as const,
    misconception: { misconception_id: `m_${index + 1}`, statement: `Possible idea ${index + 1}`,
      linked_objective_ids: [`kp_${(index % 8) + 1}`], student_language_examples: [], why_plausible: null }
  }));
  const exemplars = Array.from({ length: 12 }, (_, index) => ({
    update_type: "upsert_exemplar" as const,
    exemplar: { exemplar_id: `template_${index + 1}`, item_text: `Teacher template ${index + 1}`, observed_difficulty_note: null }
  }));
  const updates = [
    { update_type: "set_section_topic" as const, value: "Measurement logic and IRT assumptions" },
    { update_type: "set_section_summary" as const, value: "Latent ability, local independence and unidimensionality." },
    { update_type: "remove_objective" as const, objective_id: "objective_1" },
    ...objectives, ...misconceptions, ...exemplars,
    { update_type: "update_generation_settings" as const, settings: { ...blueprint.generation_settings,
      difficulty_mix: [...blueprint.generation_settings.difficulty_mix],
      context_notes: "Follow the teacher's template format. Keep the reading load low." } }
  ];
  assert.equal(updates.length, 36);
  const output = ItemDesignAssistantOutputSchema.parse({ ...baseOutput, blueprint_updates: updates });
  const filled = applyItemDesignAssistantUpdates({
    blueprint: structuredClone(blueprint),
    updates: output.blueprint_updates
  });
  assert.equal(filled.objectives.length, 8);
  assert.equal(filled.misconception_hypotheses.length, 12);
  assert.equal(filled.exemplar_items.length, 12);
  assert.equal(filled.section_topic, "Measurement logic and IRT assumptions");
});

check("The prompts state the topic map, panel filling, templates and reading load", () => {
  const source = readFileSync(path.join(process.cwd(), "src/lib/services/content/item-design.ts"), "utf8");
  const assistant = source.slice(source.indexOf("export const ITEM_DESIGN_ASSISTANT_INSTRUCTIONS"), source.indexOf("export const ITEM_DESIGN_ASSISTANT_PROMPT_HASH"));
  for (const rule of [
    "Read the course materials for their core knowledge points",
    "Group the knowledge points into topic clusters",
    "Return the complete topic map every time",
    "A mini test assesses one topic",
    "fill every part of the design panel yourself",
    "one learning objective for each core knowledge point",
    "every item template or example item the teacher provides",
    "Ask a question only when an essential choice cannot be inferred",
    "READING LOAD"
  ]) assert(assistant.includes(rule), rule);
  const generation = source.slice(source.indexOf("export const ITEM_GENERATION_INSTRUCTIONS"), source.indexOf("const ITEM_GENERATION_RECOVERY_INSTRUCTIONS"));
  for (const rule of ["Keep the reading load low", "not from reading", "Treat the teacher's exemplar items as templates"]) {
    assert(generation.includes(rule), rule);
  }
  assert(source.includes("current_topic_map: input.topic_map"), "The stored map is sent back to the assistant");
  assert(source.includes("topic_map: input.output.topic_map.topics.length > 0"), "An empty map keeps the earlier map");
  assert(source.includes("timeout_ms: ITEM_DESIGN_ASSISTANT_TIMEOUT_MS"));
});

check("The builder sidebar lists the topics and their knowledge points", () => {
  const client = readFileSync(path.join(process.cwd(), "src/components/teacher-content/item-design-client.tsx"), "utf8");
  assert(client.includes("Topics in the course materials"));
  assert(client.includes("topic.knowledge_points.map"));
  assert(client.includes("This mini test"));
});

console.log(`\n${passed} item design topic map checks passed; no database or provider calls.`);
