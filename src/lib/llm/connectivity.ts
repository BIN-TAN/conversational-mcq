import { executeAgent } from "@/lib/agents/execute-agent";
import { resolveConnectivityModelConfig } from "@/lib/llm/config";

export async function runOpenAIConnectivityTest() {
  const modelConfig = resolveConnectivityModelConfig();

  return executeAgent({
    agent_name: "response_collection_agent",
    model_config_override: modelConfig,
    agent_invocation_key: `connectivity-${Date.now()}`,
    force_new_invocation: true,
    metadata: {
      purpose: "connectivity_test",
      data_classification: "synthetic_only"
    },
    input: {
      current_phase: "not_started",
      allowed_interaction_type: "procedural_message",
      current_item_student_safe: {
        synthetic: true,
        item_public_id: "synthetic_connectivity_item",
        item_order: 1,
        item_stem: "Synthetic connectivity item",
        options: [
          { label: "A", text: "Synthetic option A" },
          { label: "B", text: "Synthetic option B" }
        ],
        item_version: 1
      },
      student_message: "Return the required structured output for a connectivity test.",
      collected_response_state: {
        selected_option: null,
        reasoning_present: false,
        confidence_rating: null
      },
      missing_evidence_state: {
        missing_fields: []
      },
      recent_student_safe_transcript: [],
      orchestration_constraints: {
        synthetic_connectivity_test: true,
        no_student_data: true,
        no_teacher_content: true
      },
      procedural_policy: {
        connectivity_test: true
      },
      allowed_student_controls: ["free_text_message"]
    }
  });
}
