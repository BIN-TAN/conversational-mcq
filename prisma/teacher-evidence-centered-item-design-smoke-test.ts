import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { zodTextFormat } from "openai/helpers/zod";
import {
  applyItemDesignAssistantUpdates,
  ITEM_DESIGN_ASSISTANT_SCHEMA_VERSION,
  ITEM_DESIGN_BLUEPRINT_VERSION,
  ITEM_GENERATION_SCHEMA_VERSION,
  ItemDesignAssistantOutputSchema,
  ItemDesignBlueprintSchema,
  ItemGenerationOutputSchema,
  normalizeLegacyItemDesignBlueprint,
  normalizeLegacyItemGenerationOutput,
  unprobedMisconceptionIds,
  validateGeneratedItemSet
} from "../src/lib/services/content/item-design-contract";
import {
  ITEM_DESIGN_ASSISTANT_INSTRUCTIONS,
  ITEM_GENERATION_MAX_CANDIDATES_PER_CALL,
  ITEM_GENERATION_INSTRUCTIONS,
  createItemGenerationPlan,
  itemGenerationResultSupportsRecovery,
  mergeItemGenerationChunkOutputs,
  itemDesignBlueprintHash
} from "../src/lib/services/content/item-design";
import { projectConceptAdministrationRulesForProfiling } from "../src/lib/agents/student-profiling/input-builder";

const blueprint = ItemDesignBlueprintSchema.parse({
  schema_version: ITEM_DESIGN_BLUEPRINT_VERSION,
  section_topic: "Sampling bias",
  section_summary: "How sampling choices affect generalization.",
  objectives: [{
    objective_id: "objective_sampling",
    statement: "Explain how self-selection can limit generalization.",
    evidence_requirements: ["Identifies a systematic difference between volunteers and the target population."]
  }],
  misconception_hypotheses: [{
    misconception_id: "misconception_volunteer_representative",
    statement: "A volunteer sample represents everyone because anyone could participate.",
    linked_objective_ids: ["objective_sampling"],
    student_language_examples: ["Anyone had the same chance to volunteer."],
    why_plausible: "Availability can be confused with representative selection."
  }],
  exemplar_items: [],
  generation_settings: {
    target_item_count: 3,
    option_count: 4,
    difficulty_mix: ["foundational", "analyzing", "evaluating", "creating"],
    context_notes: null
  }
});

function candidate(index: number) {
  return {
    item_label: `Sampling ${index}`,
    stem: `A volunteer sample scenario ${index}. Which interpretation is best supported?`,
    options: [
      { label: "A", text: "The sample is representative because participation was open.", rationale: "Confuses access with representativeness.", linked_misconception_ids: ["misconception_volunteer_representative"] },
      { label: "B", text: "Self-selection may create systematic differences.", rationale: "Matches the target reasoning.", linked_misconception_ids: [] },
      { label: "C", text: "Sample size alone removes selection bias.", rationale: "Confuses precision with selection quality.", linked_misconception_ids: [] },
      { label: "D", text: "No conclusion can ever be drawn from a survey.", rationale: "Overstates the limitation.", linked_misconception_ids: [] }
    ],
    proposed_correct_option: "B",
    correct_answer_explanation: "Volunteers may differ systematically from the target population.",
    objective_ids: ["objective_sampling"],
    misconception_hypothesis_ids: ["misconception_volunteer_representative"],
    target_reasoning_note: "Connect self-selection to limited generalization.",
    strong_reasoning_should_mention: "Volunteers can differ systematically from non-volunteers.",
    cognitive_demand: "apply" as const,
    difficulty: "foundational" as const,
    limitations: []
  };
}

const validOutput = {
  schema_version: ITEM_GENERATION_SCHEMA_VERSION,
  blueprint_version: ITEM_DESIGN_BLUEPRINT_VERSION,
  candidates: [candidate(1), candidate(2), candidate(3)],
  coverage_summary: [{ objective_id: "objective_sampling", candidate_count: 3 }],
  set_level_limitations: [],
  teacher_review_required: true as const
};

assert.equal(validateGeneratedItemSet({ blueprint, output: validOutput }).success, true);
const missingIndex = structuredClone(validOutput);
missingIndex.candidates.forEach((entry) => { entry.misconception_hypothesis_ids = []; });
const originalMissingIndex = JSON.stringify(missingIndex);
const closedIndex = validateGeneratedItemSet({ blueprint, output: missingIndex });
assert(closedIndex.success, "Option references must populate the redundant item-level misconception index.");
assert.deepEqual(closedIndex.data.candidates.map((entry) => entry.misconception_hypothesis_ids),
  validOutput.candidates.map((entry) => entry.misconception_hypothesis_ids));
assert.equal(JSON.stringify(missingIndex), originalMissingIndex, "Original provider output must not be mutated.");
assert.deepEqual(closedIndex.data.candidates.map((entry) => [entry.stem, entry.options, entry.proposed_correct_option]),
  validOutput.candidates.map((entry) => [
    entry.stem,
    entry.options.map((option) => ({ ...option, idea_label: null })),
    entry.proposed_correct_option
  ]), "Legacy options must retain their content while missing idea labels default to null.");
const unknownLink = structuredClone(missingIndex);
unknownLink.candidates[0].options[0].linked_misconception_ids = ["unknown_hypothesis"];
assert.equal(validateGeneratedItemSet({ blueprint, output: unknownLink }).success, false, "Unknown references must remain blocked.");
const invalidKey = structuredClone(missingIndex);
invalidKey.candidates[0].proposed_correct_option = "E";
assert.equal(validateGeneratedItemSet({ blueprint, output: invalidKey }).success, false, "Metadata closure must not bypass answer-key validation.");
assert.equal(
  validateGeneratedItemSet({
    blueprint,
    output: { ...validOutput, candidates: [candidate(1), candidate(2)] }
  }).success,
  false,
  "Candidate count must remain bound to the saved blueprint."
);
assert.equal(
  validateGeneratedItemSet({
    blueprint,
    output: {
      ...validOutput,
      candidates: [
        { ...candidate(1), objective_ids: ["invented_objective"] },
        candidate(2),
        candidate(3)
      ]
    }
  }).success,
  false,
  "Generated items must not invent objective identities."
);
assert.equal(
  validateGeneratedItemSet({
    blueprint,
    output: {
      ...validOutput,
      candidates: [
        { ...candidate(1), misconception_hypothesis_ids: [], options: candidate(1).options.map((option) => ({ ...option, linked_misconception_ids: [] })) },
        { ...candidate(2), misconception_hypothesis_ids: [], options: candidate(2).options.map((option) => ({ ...option, linked_misconception_ids: [] })) },
        { ...candidate(3), misconception_hypothesis_ids: [], options: candidate(3).options.map((option) => ({ ...option, linked_misconception_ids: [] })) }
      ]
    }
  }).success,
  false,
  "A supplied misconception hypothesis must be represented in the generated set."
);
assert.equal(itemDesignBlueprintHash(blueprint), itemDesignBlueprintHash(structuredClone(blueprint)));
const legacyBlueprint = ItemDesignBlueprintSchema.parse(
  normalizeLegacyItemDesignBlueprint({
    ...blueprint,
    generation_settings: {
      ...blueprint.generation_settings,
      difficulty_mix: ["foundational", "application", "reasoning"]
    }
  })
);
assert.deepEqual(
  legacyBlueprint.generation_settings.difficulty_mix,
  ["foundational", "analyzing"],
  "Legacy application/reasoning settings should load without losing the saved blueprint."
);
const legacyOutput = ItemGenerationOutputSchema.parse(
  normalizeLegacyItemGenerationOutput({
    ...validOutput,
    candidates: validOutput.candidates.map((entry) => ({
      ...entry,
      difficulty: "application"
    }))
  })
);
assert.equal(legacyOutput.candidates[0]?.difficulty, "foundational");
const generationPlan = createItemGenerationPlan(blueprint);
assert.equal(ITEM_GENERATION_MAX_CANDIDATES_PER_CALL, 2);
assert.deepEqual(generationPlan.map((chunk) => chunk.candidate_count), [2, 1]);
assert.deepEqual(
  generationPlan.flatMap((chunk) => chunk.required_objective_ids),
  ["objective_sampling", "objective_sampling"],
  "Every chunk should receive an objective while preserving complete coverage."
);
const denseMisconceptionBlueprint = ItemDesignBlueprintSchema.parse({
  ...blueprint,
  misconception_hypotheses: Array.from({ length: 20 }, (_, index) => ({
    misconception_id: `misconception_${index + 1}`,
    statement: `Misconception ${index + 1}`,
    linked_objective_ids: ["objective_sampling"],
    student_language_examples: [],
    why_plausible: null
  }))
});
assert.deepEqual(
  createItemGenerationPlan(denseMisconceptionBlueprint).map(
    (chunk) => chunk.required_misconception_ids.length
  ),
  [13, 7],
  "Misconceptions are spread in proportion to each chunk's incorrect-option slots (6 and 3)."
);

// Misconceptions follow their linked objective, so a chunk is not asked to probe a misconception
// about an objective it does not assess (the Test 9 design: 5 objectives, 13 misconceptions, 5 items).
const testNineBlueprint = ItemDesignBlueprintSchema.parse({
  ...blueprint,
  objectives: Array.from({ length: 5 }, (_, index) => ({
    objective_id: `objective_${index + 1}`,
    statement: `Objective ${index + 1}`,
    evidence_requirements: [`Evidence ${index + 1}`]
  })),
  misconception_hypotheses: Array.from({ length: 13 }, (_, index) => ({
    misconception_id: `misconception_${index + 1}`,
    statement: `Misconception ${index + 1}`,
    linked_objective_ids: [`objective_${(index % 5) + 1}`],
    student_language_examples: [],
    why_plausible: null
  })),
  generation_settings: { ...blueprint.generation_settings, target_item_count: 5 }
});
const testNinePlan = createItemGenerationPlan(testNineBlueprint);
assert.deepEqual(testNinePlan.map((chunk) => chunk.candidate_count), [2, 2, 1]);
for (const chunk of testNinePlan) {
  for (const id of chunk.required_misconception_ids) {
    const linked = testNineBlueprint.misconception_hypotheses.find((entry) => entry.misconception_id === id)!.linked_objective_ids;
    assert(linked.some((objectiveId) => chunk.required_objective_ids.includes(objectiveId)),
      `${id} is assigned to a chunk that assesses its objective`);
  }
}
assert.equal(testNinePlan.flatMap((chunk) => chunk.required_misconception_ids).length, 13, "Every misconception is assigned once");

// Generation reports misconceptions no draft probes instead of rejecting the set, normalizes
// the band from the cognitive-demand label and counts coverage itself.
const unprobedOutput = {
  ...validOutput,
  candidates: validOutput.candidates.map((entry) => ({ ...entry, misconception_hypothesis_ids: [],
    options: entry.options.map((option) => ({ ...option, linked_misconception_ids: [] })) }))
};
assert.equal(validateGeneratedItemSet({ blueprint, output: unprobedOutput }).success, false, "By default an unprobed misconception is rejected");
const reported = validateGeneratedItemSet({ blueprint, output: unprobedOutput, misconception_coverage: "reported" });
assert(reported.success, "Draft generation accepts the set and reports the misconception");
assert.deepEqual(unprobedMisconceptionIds(blueprint, reported.data), ["misconception_volunteer_representative"]);
const mislabeled = validateGeneratedItemSet({ blueprint, output: { ...validOutput,
  candidates: [{ ...candidate(1), cognitive_demand: "analyze" as const, difficulty: "foundational" as const }, candidate(2), candidate(3)],
  coverage_summary: [{ objective_id: "objective_sampling", candidate_count: 7 }] } });
assert(mislabeled.success, "A band that disagrees with its label, or a miscounted coverage summary, is corrected, not rejected");
assert.equal(mislabeled.data.candidates[0]!.difficulty, "analyzing");
assert.deepEqual(mislabeled.data.coverage_summary, [{ objective_id: "objective_sampling", candidate_count: 3 }]);
const merged = mergeItemGenerationChunkOutputs({ blueprint, outputs: [ItemGenerationOutputSchema.parse(unprobedOutput)] });
assert.equal(merged.set_level_limitations[0],
  "No draft probes misconception example 1. Add or revise items if you want evidence on it.",
  "The teacher is told which misconception examples no draft probes");
assert.equal(
  itemGenerationResultSupportsRecovery({
    provider: "mock",
    client_request_id: "incomplete_generation",
    status: "incomplete",
    incomplete_reason: "max_output_tokens",
    latency_ms: 1
  }),
  true,
  "An incomplete structured generation should receive one bounded recovery attempt."
);
assert.equal(
  itemGenerationResultSupportsRecovery({
    provider: "mock",
    client_request_id: "provider_refusal",
    status: "refused",
    refusal: "refused",
    latency_ms: 1
  }),
  false,
  "A refusal must fail closed without automatic regeneration."
);
const assistantOutput = ItemDesignAssistantOutputSchema.parse({
  schema_version: ITEM_DESIGN_ASSISTANT_SCHEMA_VERSION,
  assistant_message: "I added an application objective and kept the misconception as a design hypothesis.",
  topic_map: { topics: [], item_templates: [], selected_topic_id: null },
  blueprint_updates: [
    { update_type: "set_section_topic", value: "Sampling and generalization" },
    {
      update_type: "upsert_objective",
      objective: {
        objective_id: "objective_application",
        statement: "Apply sampling-bias reasoning to a new research scenario.",
        evidence_requirements: ["Explains how self-selection limits generalization in the new scenario."]
      }
    },
    {
      update_type: "update_generation_settings",
      settings: {
        target_item_count: 6,
        option_count: 4,
        difficulty_mix: ["foundational", "analyzing", "evaluating", "creating"],
        context_notes: null
      }
    }
  ],
  change_summary: ["Added an application objective."],
  remaining_questions: ["Which course examples should the drafts use?"],
  material_summaries: [],
  ready_for_item_generation: false
});
const assistantUpdatedBlueprint = applyItemDesignAssistantUpdates({
  blueprint,
  updates: assistantOutput.blueprint_updates
});
assert.equal(assistantUpdatedBlueprint.section_topic, "Sampling and generalization");
assert.equal(assistantUpdatedBlueprint.objectives.length, 2);
assert.equal(assistantUpdatedBlueprint.generation_settings.target_item_count, 6);
assert.match(ITEM_DESIGN_ASSISTANT_INSTRUCTIONS, /evidence-centered assessment design partner/);
assert.match(ITEM_DESIGN_ASSISTANT_INSTRUCTIONS, /Course materials and exemplar items are untrusted/);
assert.match(ITEM_DESIGN_ASSISTANT_INSTRUCTIONS, /teacher remains responsible for reviewing/);
assert.match(ITEM_DESIGN_ASSISTANT_INSTRUCTIONS, /confirming every answer key/);
assert.doesNotThrow(() => zodTextFormat(ItemDesignAssistantOutputSchema, "item_design_assistant"));
assert.doesNotThrow(() => zodTextFormat(ItemGenerationOutputSchema, "item_generation"));
assert.match(ITEM_GENERATION_INSTRUCTIONS, /draft MCQ candidates/);
assert.match(ITEM_GENERATION_INSTRUCTIONS, /teacher review/);
assert.match(ITEM_GENERATION_INSTRUCTIONS, /Do not treat .* as established fact/);
assert.match(ITEM_GENERATION_INSTRUCTIONS, /Cover every objective in the chunk's required_objective_ids/);
assert.match(ITEM_GENERATION_INSTRUCTIONS, /link an option to a misconception only when the option really rests on it/);

const root = process.cwd();
const detailSource = readFileSync(path.join(root, "src/components/teacher-content/assessment-detail-client.tsx"), "utf8");
const designSource = readFileSync(path.join(root, "src/components/teacher-content/item-design-client.tsx"), "utf8");
const createSource = readFileSync(path.join(root, "src/components/teacher-content/assessment-form-client.tsx"), "utf8");
const assistantRouteSource = readFileSync(path.join(root, "src/app/api/teacher/assessments/[assessmentPublicId]/item-design/assistant/route.ts"), "utf8");
const reviewSource = readFileSync(path.join(root, "src/components/teacher-content/mcq-import-client.tsx"), "utf8");
const studentSource = readFileSync(path.join(root, "src/components/student-assessment/assessment-session-client.tsx"), "utf8");
const formativePlanningSource = readFileSync(path.join(root, "src/lib/agents/formative-planning/input-builder.ts"), "utf8");
const followupSource = readFileSync(path.join(root, "src/lib/agents/followup-updates/service.ts"), "utf8");
const responsePackageSource = readFileSync(path.join(root, "src/lib/services/response-packages.ts"), "utf8");

assert.match(detailSource, /Design and generate/);
assert.match(createSource, /Create and open assistant/);
assert.match(createSource, /auto_create_primary_topic: true/);
assert.match(createSource, /useUnsavedChanges/);
assert.doesNotMatch(createSource, /label="Diagnostic focus"/);
assert.match(designSource, /Author with assistant/);
assert.match(designSource, /Review design/);
assert.match(designSource, /Add files \(PDF, Word, Excel, text or images\)/);
assert.match(designSource, /\.pdf,\.docx,\.png/);
assert.doesNotMatch(designSource, /Do not include private student information/);
assert.match(designSource, /Review and edit design/);
assert.match(designSource, /What observable evidence would demonstrate this\?/);
assert.match(designSource, /Foundational: remembering, understanding, applying/);
assert.match(designSource, /Analyzing/);
assert.match(designSource, /Evaluating/);
assert.match(designSource, /Creating/);
assert.match(designSource, /Save and generate drafts/);
assert.match(assistantRouteSource, /respondToAssessmentItemDesignAssistant/);
assert.match(reviewSource, /Review generated item drafts/);
assert.match(reviewSource, /teacher-confirmed key/i);
assert.match(studentSource, /`Question \$\{item\.initial_item_position\} of \$\{item\.initial_item_total\}`/);
assert.match(formativePlanningSource, /projectConceptAdministrationRulesForStudentAgents/);
assert.match(followupSource, /projectConceptAdministrationRulesForStudentAgents/);
assert.match(responsePackageSource, /projectConceptAdministrationRulesForStudentAgents/);

const profilingRules = projectConceptAdministrationRulesForProfiling({
  item_design_blueprint: {
    ...blueprint,
    exemplar_items: [{
      exemplar_id: "private_exam_item",
      item_text: "Unadministered exam question and answer key B.",
      observed_difficulty_note: "Teacher-only historical note."
    }],
    generation_settings: {
      ...blueprint.generation_settings,
      context_notes: "Generation-only course boundary."
    }
  },
  item_design_assistant_thread: {
    schema_version: "evidence-centered-item-design-thread-v1",
    messages: [{
      message_id: "teacher_private_source",
      client_message_id: "private_source_message",
      role: "teacher",
      message_text: "Private teacher course material that students must not receive.",
      created_at: new Date().toISOString(),
      agent_call_public_id: null,
      attachment_material_ids: []
    }]
  },
  item_design_assistant_state: {
    ready_for_item_generation: true,
    remaining_questions: [],
    change_summary: ["Private assistant advisory state."]
  },
  item_design_source_materials: {
    schema_version: "evidence-centered-item-design-source-materials-v1",
    materials: [{
      material_id: "material_private",
      extracted_text: "Private uploaded course source and unadministered answer key C."
    }]
  }
});
const profilingRulesText = JSON.stringify(profilingRules);
assert.match(profilingRulesText, /objective_sampling/);
assert.match(profilingRulesText, /misconception_volunteer_representative/);
assert.doesNotMatch(profilingRulesText, /Unadministered exam question/);
assert.doesNotMatch(profilingRulesText, /Teacher-only historical note/);
assert.doesNotMatch(profilingRulesText, /Generation-only course boundary/);
assert.doesNotMatch(profilingRulesText, /Private teacher course material/);
assert.doesNotMatch(profilingRulesText, /Private assistant advisory state/);
assert.doesNotMatch(profilingRulesText, /Private uploaded course source/);

console.log("teacher evidence-centered item design smoke passed");
