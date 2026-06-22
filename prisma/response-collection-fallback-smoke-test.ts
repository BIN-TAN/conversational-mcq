import { agentOutputSchemas } from "../src/lib/agents/contracts";
import { buildResponseCollectionFallback } from "../src/lib/agents/response-collection/fallback";
import { analyzeResponseCollectionMessage } from "../src/lib/agents/response-collection/reasoning-extraction";
import cases from "../tests/fixtures/response-collection-cases.json";

type Case = {
  id: string;
  message: string;
  existing_reasoning?: boolean;
  expected_intents?: string[];
  expected_segments?: string[];
  expected_requires_option_button?: boolean;
  expected_requires_confidence_control?: boolean;
  expected_blocked_content_help?: boolean;
  expected_control_action?: string;
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function assertNoUnsafeAssistantText(text: string) {
  assert(!/\b(correct answer|choose option|option [a-f] is|you are correct|you are incorrect)\b/i.test(text), "Fallback leaked answer-help wording.");
  assert(!/\bcheat|misconduct|genai use confirmed\b/i.test(text), "Fallback used misconduct language.");
}

async function main() {
  const typedCases = cases as Case[];

  assert(typedCases.length >= 20, "Response collection fixture should include at least 20 cases.");

  for (const testCase of typedCases) {
    const analysis = analyzeResponseCollectionMessage({
      message: testCase.message,
      has_existing_reasoning: Boolean(testCase.existing_reasoning)
    });
    const output = buildResponseCollectionFallback({
      student_message: testCase.message,
      has_existing_reasoning: Boolean(testCase.existing_reasoning),
      fallback_reason: "deterministic_mode"
    });

    assert(
      agentOutputSchemas.response_collection_agent.safeParse(output).success,
      `${testCase.id}: fallback output should validate against ResponseCollectionOutput.`
    );
    assertNoUnsafeAssistantText(output.assistant_message);

    for (const segment of analysis.reasoning_evidence_segments) {
      assert(
        testCase.message.includes(segment),
        `${testCase.id}: reasoning segment should be an exact substring.`
      );
    }

    if (testCase.expected_intents) {
      for (const intent of testCase.expected_intents) {
        assert(
          analysis.recognized_intents.some((value) => value === intent),
          `${testCase.id}: expected intent ${intent}.`
        );
      }
    }

    if (testCase.expected_segments) {
      assert(
        JSON.stringify(analysis.reasoning_evidence_segments) ===
          JSON.stringify(testCase.expected_segments),
        `${testCase.id}: reasoning segments mismatch.`
      );
    }

    if (typeof testCase.expected_requires_option_button === "boolean") {
      assert(
        analysis.requires_option_button === testCase.expected_requires_option_button,
        `${testCase.id}: option button requirement mismatch.`
      );
    }

    if (typeof testCase.expected_requires_confidence_control === "boolean") {
      assert(
        analysis.requires_confidence_control === testCase.expected_requires_confidence_control,
        `${testCase.id}: confidence control requirement mismatch.`
      );
    }

    if (typeof testCase.expected_blocked_content_help === "boolean") {
      assert(
        analysis.blocked_content_help === testCase.expected_blocked_content_help,
        `${testCase.id}: blocked content-help mismatch.`
      );
    }

    if (testCase.expected_control_action) {
      assert(
        analysis.requested_control_action === testCase.expected_control_action,
        `${testCase.id}: requested control action mismatch.`
      );
    }
  }

  console.log("Response collection fallback smoke test passed. No OpenAI call was made.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
