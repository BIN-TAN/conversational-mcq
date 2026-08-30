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
  validateGeneratedItemSet
} from "../src/lib/services/content/item-design-contract";
import {
  ITEM_DESIGN_ASSISTANT_INSTRUCTIONS,
  ITEM_GENERATION_MAX_CANDIDATES_PER_CALL,
  ITEM_GENERATION_INSTRUCTIONS,
  createItemGenerationPlan,
  itemGenerationResultSupportsRecovery,
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
  [14, 6],
  "Evidence distribution must respect the candidate capacity of a shorter final chunk."
);
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
assert.match(ITEM_GENERATION_INSTRUCTIONS, /cover every objective and every supplied misconception hypothesis/);

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
assert.match(createSource, /course\s+material/);
assert.doesNotMatch(createSource, /label="Diagnostic focus"/);
assert.match(designSource, /Author with assistant/);
assert.match(designSource, /Review design/);
assert.match(designSource, /Add PDF, Word, or images/);
assert.match(designSource, /\.pdf,\.docx,\.png/);
assert.doesNotMatch(designSource, /Do not include private student information/);
assert.match(designSource, /Review and edit design/);
assert.match(designSource, /What observable evidence would demonstrate this\?/);
assert.match(designSource, /Foundational: remembering, understanding, applying/);
assert.match(designSource, /Analyzing/);
assert.match(designSource, /Evaluating/);
assert.match(designSource, /Creating/);
assert.match(designSource, /Generated items remain draft candidates/);
assert.match(assistantRouteSource, /respondToAssessmentItemDesignAssistant/);
assert.match(reviewSource, /Review generated item drafts/);
assert.match(reviewSource, /teacher-confirmed key/i);
assert.match(studentSource, /remaining after this/);
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
