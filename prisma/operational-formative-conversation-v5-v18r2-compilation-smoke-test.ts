import { strict as assert } from "node:assert";
import { existsSync } from "node:fs";
import path from "node:path";
import {
  buildFormativeConversationV18EvaluationPlan,
  exactFormativeConversationV18LiveAuthorization,
  loadFormativeConversationV18EvaluationPackage,
  packagePathsExist
} from "../src/lib/operational/formative-conversation-v5-evaluation-v18r2/package";
import { FORMATIVE_CONVERSATION_V5_RUN_OUTPUT_ROOT } from "../src/lib/operational/formative-conversation-v5-evaluation-v18r2/contracts";
import { FORMATIVE_CONVERSATION_V18R2_COMMITTED_SOURCE_PATHS } from "../src/lib/operational/formative-conversation-v5-evaluation-v18r2/provenance";

const originalFetch = globalThis.fetch;
let networkRequests = 0;
globalThis.fetch = (async () => {
  networkRequests += 1;
  throw new Error("network_forbidden");
}) as typeof fetch;

try {
  const loaded = loadFormativeConversationV18EvaluationPackage();
  const v18r2Contract = loaded.protocol.v18r2_contract as {
    nonterminal_profile_transition_recommendation: null;
    maximum_formative_student_turns: number;
    semantic_teacher_assistance_distinct_from_platform_handoff: boolean;
  };
  assert.equal(packagePathsExist(), true);
  assert.equal(loaded.fixtures.length, 12);
  assert.equal(loaded.compiled_plan.cases.length, 12);
  assert.deepEqual(
    loaded.compiled_plan.cases.map((entry) => entry.case_id),
    [
      "pcv18_01_no_misconception",
      "pcv18_02_single_atomic_misconception",
      "pcv18_03_compound_conceptual_state",
      "fcv5_01_assistant_first_opening",
      "fcv5_02_first_principles_adaptation",
      "fcv5_03_direct_answer_handling",
      "fcv5_04_related_concept_discussion",
      "fcv5_05_sound_profile_transition",
      "fcv5_06_largely_improved_temporal",
      "fcv5_07_persistent_barrier_teacher_assistance",
      "fcv5_08_mixed_resolved_evidence",
      "fcv18_09_dissertation_end_to_end"
    ]
  );
  assert.equal(
    loaded.compiled_plan.aggregate_call_graph.expected_base_call_count,
    28
  );
  assert.equal(
    loaded.compiled_plan.aggregate_call_graph.maximum_logical_call_count,
    56
  );
  assert.equal(
    loaded.compiled_plan.aggregate_call_graph.maximum_provider_attempt_count,
    168
  );
  assert.equal(loaded.protocol.budget.maximum_semantic_regeneration_count, 28);
  assert.equal(loaded.protocol.budget.maximum_input_token_count, 1_800_000);
  assert.equal(loaded.protocol.budget.maximum_output_token_count, 368_000);
  assert.equal(loaded.protocol.budget.maximum_total_token_count, 2_168_000);
  assert.equal(
    loaded.protocol.budget.maximum_wall_clock_duration_ms,
    7_200_000
  );
  assert.equal(loaded.protocol.budget.maximum_concurrency, 1);
  assert.equal(loaded.protocol.budget.maximum_cost_usd, 60);
  assert.equal(
    v18r2Contract.nonterminal_profile_transition_recommendation,
    null
  );
  assert.equal(
    v18r2Contract.maximum_formative_student_turns,
    12
  );
  assert.equal(
    v18r2Contract.semantic_teacher_assistance_distinct_from_platform_handoff,
    true
  );
  assert.equal(
    loaded.immutable_v18_reference.provider_run_id,
    "fcv5v18r1_provider_20260813160503_9f33cf65"
  );
  assert.equal(
    FORMATIVE_CONVERSATION_V18R2_COMMITTED_SOURCE_PATHS.some(
      (entry) =>
        entry.startsWith(".data/") ||
        entry.startsWith("/private/tmp/") ||
        entry.includes("/private/var/")
    ),
    false
  );
  assert.equal(
    loaded.authorization_package.exact_future_authorization_text,
    null
  );
  assert.equal(loaded.authorization_package.exact_future_live_command, null);
  assert.match(
    String(loaded.authorization_package.future_authorization_template),
    /<expected_deployed_git_sha>/
  );
  assert.match(
    String(loaded.authorization_package.future_live_command_template),
    /FORMATIVE_CONVERSATION_V18R2_EXPECTED_DEPLOYED_GIT_SHA/
  );
  assert.match(
    exactFormativeConversationV18LiveAuthorization(loaded),
    /<expected_deployed_git_sha>/
  );
  const plan = buildFormativeConversationV18EvaluationPlan();
  assert.equal(plan.provider_calls, 0);
  assert.equal(plan.provider_auth_network_requests, 0);
  assert.equal(plan.dispatch_checkpoint.created, false);
  assert.equal(plan.approval_eligible, false);
  assert.equal(plan.activation_permitted, false);
  assert.equal(plan.live_execution_prepared, true);
  assert.equal(plan.required_live_command, null);
  assert.equal(
    existsSync(
      path.resolve(
        FORMATIVE_CONVERSATION_V5_RUN_OUTPUT_ROOT,
        "dispatch",
        `${loaded.protocol_hash}.json`
      )
    ),
    false
  );
  assert.equal(networkRequests, 0);
  console.log(
    JSON.stringify({
      status: "passed",
      case_count: 12,
      base_profiling_calls: 4,
      base_formative_calls: 24,
      logical_calls: 28,
      maximum_logical_calls: 56,
      maximum_provider_attempts: 168,
      provider_calls: 0,
      model_auth_requests: 0,
      network_requests: 0,
      dispatch_checkpoints: 0
    })
  );
} finally {
  globalThis.fetch = originalFetch;
}
