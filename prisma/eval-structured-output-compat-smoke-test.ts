import { z } from "zod";
import {
  FollowupOutput,
  FormativePlanningOutput,
  ItemVerificationOutput,
  ResponseCollectionOutput,
  StudentProfileOutput
} from "../src/lib/agents/contracts";
import { mockOutputForAgent } from "../src/lib/agents/mock-fixtures";
import {
  checkCustomStructuredOutputCompatibility,
  structuredOutputCompatibilitySummary,
  validateStructuredOutputJsonSchema
} from "../src/lib/agents/provider-schema-compat";
import { validateFollowupSemantics } from "../src/lib/agents/followup/semantic-validation";
import { validateFormativePlanningSemantics } from "../src/lib/agents/formative-planning/semantic-validation";
import { validateItemVerificationOutputSemantics } from "../src/lib/agents/item-verification/semantic-validation";
import type { AgentInputByName, AgentOutputByName } from "../src/lib/agents/contracts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

const itemVerificationInput: AgentInputByName["item_verification_agent"] = {
  concept_unit: {
    concept_unit_public_id: "eval_concept_compat",
    title: "Synthetic concept",
    learning_objective: "Use evidence to choose an option.",
    related_concept_description: "A generic course-agnostic concept.",
    version: 1
  },
  items: [
    {
      item_public_id: "mock-item-1",
      item_order: 1,
      item_stem: "Which option best matches the evidence?",
      options: [
        { label: "A", text: "Option A" },
        { label: "B", text: "Option B" }
      ],
      correct_option: "A",
      distractor_rationales: {},
      expected_reasoning_patterns: ["Connect the selected option to the evidence."],
      possible_misconception_indicators: ["Confuses evidence with opinion."],
      version: 1
    }
  ],
  verification_constraints: {
    advisory_only: true,
    teacher_final_authority: true,
    do_not_generate_or_rewrite_content: true,
    deterministic_validation_already_passed: true,
    no_student_data_in_input: true
  }
};

function itemVerificationOutputWithFinding(
  finding: AgentOutputByName["item_verification_agent"]["item_results"][number]["findings"][number]
): AgentOutputByName["item_verification_agent"] {
  return {
    agent_name: "item_verification_agent",
    agent_version: "compat-test",
    prompt_version: "compat-test",
    schema_version: "compat-test",
    output_status: "needs_review",
    warnings: [],
    verification_status: "verified_with_warnings",
    set_level_findings: [],
    item_results: [
      {
        item_public_id: "mock-item-1",
        findings: [finding],
        teacher_review_required: true
      }
    ],
    teacher_review_required: true
  };
}

async function main() {
  const compatibility = structuredOutputCompatibilitySummary();

  assert(compatibility.ok, JSON.stringify(compatibility.results, null, 2));

  for (const result of compatibility.results) {
    assert(result.schema_compiled, `${result.agent_name} provider schema should compile.`);
    assert(result.prompt_version.length > 0, `${result.agent_name} prompt version should resolve.`);
    assert(result.schema_version.length > 0, `${result.agent_name} schema version should resolve.`);
    assert(result.prompt_hash.length > 0, `${result.agent_name} prompt hash should resolve.`);
  }

  const optional = checkCustomStructuredOutputCompatibility({
    schema: z.object({ optional_field: z.string().optional() }).strict(),
    schema_name: "compat-optional-field"
  });
  assert(!optional.compatible, "Optional provider-facing fields should be rejected.");

  const untyped = checkCustomStructuredOutputCompatibility({
    schema: z.object({ open_value: z.unknown() }).strict(),
    schema_name: "compat-untyped-field"
  });
  assert(!untyped.compatible, "z.any/z.unknown provider-facing fields should be rejected.");

  const rootUnionIssues = validateStructuredOutputJsonSchema({
    rootName: "compat-root-union",
    schema: {
      anyOf: [
        {
          type: "object",
          properties: { value: { type: "string" } },
          required: ["value"],
          additionalProperties: false
        }
      ]
    }
  });
  assert(rootUnionIssues.some((issue) => issue.code.includes("root")), "Root union should be rejected.");

  const setLevelOutput = {
    ...mockOutputForAgent("item_verification_agent"),
    verification_status: "verified_with_warnings",
    set_level_findings: [
      {
        issue_code: "substantially_duplicate_item",
        item_public_id: null,
        location: "item_set",
        option_label: null,
        brief_explanation: "Synthetic set-level warning."
      }
    ],
    item_results: [],
    teacher_review_required: true
  };
  assert(ItemVerificationOutput.safeParse(setLevelOutput).success, "Set-level null finding should parse.");

  const itemLevelOutput = itemVerificationOutputWithFinding({
    issue_code: "possible_ambiguity",
    item_public_id: "mock-item-1",
    location: "item_stem",
    option_label: null,
    brief_explanation: "Synthetic item-level warning."
  });
  assert(ItemVerificationOutput.safeParse(itemLevelOutput).success, "Item-level null option_label should parse.");
  assert(
    validateItemVerificationOutputSemantics({
      providerInput: itemVerificationInput,
      output: itemLevelOutput
    }).ok,
    "Item-level finding should semantically validate."
  );

  const optionSpecificOutput = itemVerificationOutputWithFinding({
    issue_code: "weak_or_implausible_distractor",
    item_public_id: "mock-item-1",
    location: "option",
    option_label: "B",
    brief_explanation: "Synthetic option-specific warning."
  });
  assert(
    validateItemVerificationOutputSemantics({
      providerInput: itemVerificationInput,
      output: optionSpecificOutput
    }).ok,
    "Option-specific finding should semantically validate with a known option label."
  );

  const invalidItemLevelOutput = itemVerificationOutputWithFinding({
    issue_code: "possible_ambiguity",
    item_public_id: null,
    location: "item_stem",
    option_label: null,
    brief_explanation: "Synthetic invalid item-level warning."
  });
  assert(
    !validateItemVerificationOutputSemantics({
      providerInput: itemVerificationInput,
      output: invalidItemLevelOutput
    }).ok,
    "Item-level findings with null item_public_id should fail semantics."
  );

  const invalidOptionOutput = itemVerificationOutputWithFinding({
    issue_code: "weak_or_implausible_distractor",
    item_public_id: null,
    location: "option",
    option_label: "B",
    brief_explanation: "Synthetic invalid option-specific warning."
  });
  assert(
    !validateItemVerificationOutputSemantics({
      providerInput: itemVerificationInput,
      output: invalidOptionOutput
    }).ok,
    "Option-specific findings with null item_public_id should fail semantics."
  );

  const planning = {
    ...mockOutputForAgent("formative_value_and_planning_agent"),
    mapping_followed: true,
    mapping_deviation_reason: null
  };
  const parsedPlanning = FormativePlanningOutput.parse(planning);
  validateFormativePlanningSemantics({
    output: parsedPlanning,
    integrated_diagnostic_profile: "conflicting_evidence_needs_clarification"
  });

  const followup = {
    ...mockOutputForAgent("followup_agent"),
    evidence_request: null
  };
  const parsedFollowup = FollowupOutput.parse(followup);
  validateFollowupSemantics({
    output: parsedFollowup,
    current_formative_value: "diagnostic_clarification",
    config: {
      max_turns: 20,
      message_max_chars: 6000,
      context_max_chars: 12000,
      substantive_turns_before_update: 2
    },
    turn_type: "student_reply"
  });

  assert(
    ResponseCollectionOutput.safeParse({
      ...mockOutputForAgent("response_collection_agent"),
      events_to_log: [
        {
          event_type: "procedural_clarification_request",
          event_category: "initial_chat",
          event_source: "agent",
          payload: null
        }
      ]
    }).success,
    "Response collection events should allow payload=null."
  );

  assert(
    !ResponseCollectionOutput.safeParse({
      ...mockOutputForAgent("response_collection_agent"),
      events_to_log: [
        {
          event_type: "procedural_clarification_request",
          event_category: "initial_chat",
          event_source: "agent"
        }
      ]
    }).success,
    "Response collection events should require payload even when it is null."
  );

  assert(
    StudentProfileOutput.safeParse(mockOutputForAgent("student_profiling_agent")).success,
    "Student profile mock output should satisfy the stricter provider-facing schema."
  );

  console.log("Structured output compatibility smoke test passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
