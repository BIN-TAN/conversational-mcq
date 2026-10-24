/**
 * Item builder authoring assistant v5 (20 Oct 2026; v6 in release CMCQ-20261020-05 adds the plain-language rule). The assistant reads the course materials
 * (slides, quizzes, sample items, templates) once and keeps a course topic bank: each topic
 * with its knowledge points, content notes and the quiz or sample items that assess it. It
 * fills the whole design panel for the mini test's one topic, and the mini tests for the other
 * topics are created from the same bank, one at a time, without uploading the materials again.
 * Item generation v4 adds item-writing rules and keeps the reading load low (v5: plain language
 * and idea labels; see prisma/item-draft-check-unit-test.ts).
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
  mergeTopicMap,
  normalizeLegacyItemDesignAssistantOutput,
  topicMapForAssistant,
  type ItemDesignBlueprint,
  type ItemDesignTopicMap
} from "../src/lib/services/content/item-design-contract";
import { PLACEHOLDER_OBJECTIVE_EVIDENCE } from "../src/lib/services/content/item-design-contract";

let passed = 0;
function check(name: string, run: () => void) {
  run();
  passed += 1;
  console.log(`ok - ${name}`);
}
const source = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");

const quizItem = { text: "A student scores 16/20 on Form A and 11/20 on harder Form B. Has her ability declined? A. Yes B. No C. Not from these scores alone D. Only if Form B is longer", answer_note: "C" };
const bank: ItemDesignTopicMap = {
  topics: [
    {
      topic_id: "measurement_logic",
      title: "Measurement logic and IRT assumptions",
      summary: "Latent ability, comparability, local independence and unidimensionality.",
      knowledge_points: ["Ability estimates are on a latent scale", "Local independence", "Unidimensionality"],
      content_notes: "Theta is a latent trait estimate; raw scores depend on form difficulty. Local independence: no association after conditioning on theta.",
      source_items: [quizItem],
      source_material_ids: ["material_1"]
    },
    {
      topic_id: "dichotomous_models",
      title: "Dichotomous IRT models",
      summary: "1PL, 2PL and 3PL models and item characteristic curves.",
      knowledge_points: ["Item characteristic curves", "Difficulty and discrimination parameters"],
      content_notes: "b is the theta at P = .5 (1PL/2PL); a is the slope at b.",
      source_items: [],
      source_material_ids: ["material_1", "material_2"]
    }
  ],
  item_templates: [{ template_id: "template_1", text: "Scenario, then 'Which conclusion is best supported?' with four options." }],
  selected_topic_id: "measurement_logic"
};

const baseOutput = {
  schema_version: ITEM_DESIGN_ASSISTANT_SCHEMA_VERSION,
  assistant_message: "I filled the design panel for Measurement logic and IRT assumptions. Dichotomous IRT models is ready for its own mini test.",
  topic_map: bank,
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

check("Versions: assistant v9 with output v3, generation v5", () => {
  assert.equal(ITEM_DESIGN_ASSISTANT_PROMPT_VERSION, "evidence-centered-item-design-assistant-v9");
  assert.equal(ITEM_DESIGN_ASSISTANT_SCHEMA_VERSION, "evidence-centered-item-design-assistant-output-v3");
  assert.equal(ITEM_GENERATION_PROMPT_VERSION, "evidence-centered-mcq-generation-v5");
});

check("The reply carries the topic bank: knowledge points, notes and quiz items per topic, and templates", () => {
  const parsed = ItemDesignAssistantOutputSchema.parse(baseOutput);
  assert.equal(parsed.topic_map.topics.length, 2);
  assert.deepEqual(parsed.topic_map.topics[0].source_items, [quizItem]);
  assert.equal(parsed.topic_map.item_templates.length, 1);
  const { topic_map: _omitted, ...withoutMap } = baseOutput;
  assert.throws(() => ItemDesignAssistantOutputSchema.parse(withoutMap), "Every v3 reply returns the topic map");
  assert.throws(() => ItemDesignAssistantOutputSchema.parse({
    ...baseOutput,
    topic_map: { ...bank, topics: [{ ...bank.topics[0], knowledge_points: [] }] }
  }), "A topic has at least one knowledge point");
});

check("A selected topic that is not in the bank is cleared", () => {
  assert.equal(consistentTopicMap(bank).selected_topic_id, "measurement_logic");
  assert.equal(consistentTopicMap({ ...bank, selected_topic_id: "missing" }).selected_topic_id, null);
  assert.deepEqual(consistentTopicMap({ nonsense: true }), EMPTY_ITEM_DESIGN_TOPIC_MAP);
});

check("A reply without topics keeps the bank and can still change the selection", () => {
  const kept = mergeTopicMap(bank, { topics: [], item_templates: [], selected_topic_id: "dichotomous_models" });
  assert.deepEqual(kept.topics, bank.topics);
  assert.deepEqual(kept.item_templates, bank.item_templates);
  assert.equal(kept.selected_topic_id, "dichotomous_models");
  assert.equal(mergeTopicMap(bank, { topics: [], item_templates: [], selected_topic_id: null }).selected_topic_id, "measurement_logic");
});

check("A revised bank keeps a topic's stored notes and quiz items when the reply leaves them empty", () => {
  const revised = mergeTopicMap(bank, {
    topics: [
      { ...bank.topics[0], knowledge_points: ["Ability estimates are on a latent scale", "Local independence"], content_notes: "", source_items: [] },
      { topic_id: "polytomous_models", title: "Polytomous models", summary: "PCM and GRM.", knowledge_points: ["Category probability curves"],
        content_notes: "PCM thresholds are step difficulties.", source_items: [], source_material_ids: ["material_3"] }
    ],
    item_templates: [],
    selected_topic_id: null
  });
  assert.deepEqual(revised.topics.map((topic) => topic.topic_id), ["measurement_logic", "polytomous_models"], "Topics left out are removed");
  assert.equal(revised.topics[0].content_notes, bank.topics[0].content_notes);
  assert.deepEqual(revised.topics[0].source_items, [quizItem]);
  assert.equal(revised.topics[0].knowledge_points.length, 2);
  assert.deepEqual(revised.item_templates, bank.item_templates);
  assert.equal(revised.selected_topic_id, "measurement_logic");
});

check("The assistant reads the selected topic in full and the others briefly", () => {
  const view = topicMapForAssistant(bank);
  assert.equal(view.selected_topic?.content_notes, bank.topics[0].content_notes);
  assert.deepEqual(view.selected_topic?.source_items, [quizItem]);
  assert.deepEqual(view.other_topics.map((topic) => topic.topic_id), ["dichotomous_models"]);
  assert.equal(view.other_topics[0].content_notes_stored, true);
  assert.equal("content_notes" in view.other_topics[0], false);
  assert.deepEqual(view.item_templates, bank.item_templates);
});

check("Stored v2 outputs replay as v3 with an empty bank", () => {
  const legacy = { ...baseOutput, schema_version: "evidence-centered-item-design-assistant-output-v2" } as Record<string, unknown>;
  delete legacy.topic_map;
  const replayed = ItemDesignAssistantOutputSchema.parse(normalizeLegacyItemDesignAssistantOutput(legacy));
  assert.equal(replayed.schema_version, ITEM_DESIGN_ASSISTANT_SCHEMA_VERSION);
  assert.deepEqual(replayed.topic_map, EMPTY_ITEM_DESIGN_TOPIC_MAP);
});

check("One reply can fill the whole panel: topic, objectives, misconceptions, exemplars and settings", () => {
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
    exemplar: { exemplar_id: `exemplar_${index + 1}`, item_text: `Quiz item or template ${index + 1}`, observed_difficulty_note: null }
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
  const filled = applyItemDesignAssistantUpdates({ blueprint: structuredClone(blueprint), updates: output.blueprint_updates });
  assert.equal(filled.objectives.length, 8);
  assert.equal(filled.misconception_hypotheses.length, 12);
  assert.equal(filled.exemplar_items.length, 12);
});

check("The assistant prompt describes the bank, one topic per mini test and a filled panel", () => {
  const text = source("src/lib/services/content/item-design.ts");
  const assistant = text.slice(text.indexOf("export const ITEM_DESIGN_ASSISTANT_INSTRUCTIONS"), text.indexOf("export const ITEM_DESIGN_ASSISTANT_PROMPT_HASH"));
  for (const rule of [
    "lecture slides, quizzes, sample items and other files",
    "Group the knowledge points into topic clusters",
    "content notes: the definitions, formulas, notation, worked examples and common confusions",
    "the quiz or sample items in the materials that assess the topic",
    "This topic map is the course's topic bank",
    "without the materials being uploaded again",
    "an empty content_notes or source_items for a topic keeps what is stored for it",
    "A mini test assesses one topic",
    "never combine topics in one mini test",
    "fill every part of the design panel yourself",
    "one learning objective for each core knowledge point",
    "the selected topic's source items, the item templates",
    "Ask a question only when an essential choice cannot be inferred",
    "READING LOAD"
  ]) assert(assistant.includes(rule), rule);
  assert(text.includes("current_topic_map: topicMapForAssistant(input.topic_map)"));
  assert(text.includes("const nextTopicMap = mergeTopicMap(design.assistant_state.topic_map, input.output.topic_map);"));
  assert(text.includes("topic_bank_id: nextTopicMap.topics.length > 0"));
  assert(text.includes("timeout_ms: ITEM_DESIGN_ASSISTANT_TIMEOUT_MS"));
});

check("The generation prompt has item-writing rules, low reading load and the course topic", () => {
  const text = source("src/lib/services/content/item-design.ts");
  const generation = text.slice(text.indexOf("export const ITEM_GENERATION_INSTRUCTIONS"), text.indexOf("const ITEM_GENERATION_RECOVERY_INSTRUCTIONS"));
  for (const rule of [
    "WRITING GOOD ITEMS",
    "Each item assesses one idea",
    "Prefer a short new case",
    "Exactly one option is correct",
    "Each distractor follows a specific, plausible line of reasoning",
    "\"all of the above\"",
    "Avoid negative stems",
    "Avoid cues",
    "Items are independent",
    "Keep the reading load low",
    "not from reading",
    "Treat the teacher's exemplar items as templates",
    "course_topic"
  ]) assert(generation.includes(rule), rule);
  assert(text.includes("course_topic: topic"), "Generation receives the selected topic's knowledge points and notes");
});

check("Other topics get their own mini tests from the bank, one at a time, without a new upload", () => {
  const text = source("src/lib/services/content/item-design.ts");
  const create = text.slice(text.indexOf("export async function createTopicMiniTestFromBank"), text.indexOf("export async function saveAssessmentItemDesign"));
  for (const part of [
    "auto_create_primary_topic: true",
    "item_design_source_materials: sourceMaterialCollectionFromRules(rules)",
    "topic_map: { ...state.topic_map, selected_topic_id: topic.topic_id }",
    "topic_bank_id: state.topic_bank_id",
    "item_design_origin",
    "if (existing)",
    "itemBuilderUrl(created.assessment_public_id, true)"
  ]) assert(create.includes(part), part);
  assert(text.includes('administration_rules: { path: ["item_design_assistant_state", "topic_bank_id"], equals: input.topic_bank_id }'));
  const route = source("src/app/api/teacher/assessments/[assessmentPublicId]/item-design/topic-mini-test/route.ts");
  assert(route.includes("createTopicMiniTestFromBank") && route.includes("requireTeacherResearcher"));
  const page = source("src/app/teacher/content/assessments/[assessmentPublicId]/item-design/page.tsx");
  assert(page.includes('autoPrepareTopic={prepare === "topic"}'));
});

check("The builder sidebar shows the bank, and a new topic mini test is prepared once", () => {
  const client = source("src/components/teacher-content/item-design-client.tsx");
  for (const part of [
    "Course topic bank",
    "topic.knowledge_points.map",
    "This mini test",
    "Create a mini test for this topic",
    "Open its mini test",
    "/item-design/topic-mini-test",
    "autoPrepareStarted.current = true",
    "sendAssistantMessage(topicPreparationMessage(topic.title))",
    "design.assistant_state.topic_map ?? { topics: [], item_templates: [], selected_topic_id: null }"
  ]) assert(client.includes(part), part);
  assert(source("src/components/teacher-content/topic-preparation.ts")
    .includes("from the course topic bank, and fill in the whole design panel"));
});

check("A new mini test's placeholder objective goes once the assistant writes real objectives", () => {
  const start = { ...blueprint, objectives: [{ objective_id: "objective_1", statement: "[Acceptance] Topic", evidence_requirements: [PLACEHOLDER_OBJECTIVE_EVIDENCE] }] };
  const real = { objective_id: "raw_scores_and_theta", statement: "Evaluate a claim about change in θ.", evidence_requirements: ["Distinguishes θ from the raw score."] };
  const filled = applyItemDesignAssistantUpdates({ blueprint: structuredClone(start), updates: [{ update_type: "upsert_objective", objective: real }] });
  assert.deepEqual(filled.objectives.map((objective) => objective.objective_id), ["raw_scores_and_theta"]);
  const only = applyItemDesignAssistantUpdates({ blueprint: structuredClone(start), updates: [{ update_type: "set_section_topic", value: "Topic" }] });
  assert.equal(only.objectives.length, 1, "Kept while it is the only objective");
  const edited = applyItemDesignAssistantUpdates({ blueprint: structuredClone({ ...start, objectives: [{ ...start.objectives[0]!, evidence_requirements: ["Names the scale."] }] }),
    updates: [{ update_type: "upsert_objective", objective: real }] });
  assert.equal(edited.objectives.length, 2, "An objective the teacher or assistant changed is kept");
  const source = readFileSync(path.join(process.cwd(), "src/lib/services/content/item-design.ts"), "utf8");
  assert(source.includes('Call the design panel "the design", not "the blueprint", and never write internal field or setting names'));
  const client = readFileSync(path.join(process.cwd(), "src/components/teacher-content/item-design-client.tsx"), "utf8");
  for (const part of ['{topicMap.topics.length === 1 ? "topic" : "topics"}', "busy === \"assistant\" && pendingMessage", "setAssistantInput((current) => current.trim() ? current : prefix)"]) {
    assert(client.includes(part), part);
  }
});

console.log(`\n${passed} item design topic bank checks passed; no database or provider calls.`);
