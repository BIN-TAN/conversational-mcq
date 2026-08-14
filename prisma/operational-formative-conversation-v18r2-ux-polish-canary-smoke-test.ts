import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { compileProductionStructuredAgentRequest } from "../src/lib/agents/provider-request";
import {
  V18R2_UX_CANARY_BUDGET,
  V18R2_UX_CANARY_CASE_ORDER,
  V18R2_UX_CANARY_DISPATCH_ROOT,
  V18R2_UX_CANARY_HUMAN_REVIEW_DIMENSIONS,
  V18R2_UX_CANARY_MACHINE_CRITERIA
} from "../src/lib/operational/formative-conversation-v18r2-ux-polish-canary/contracts";
import { loadV18R2UxPolishCanaryPackage } from "../src/lib/operational/formative-conversation-v18r2-ux-polish-canary/package";
import { buildV18R2UxCanaryPlan } from "../src/lib/operational/formative-conversation-v18r2-ux-polish-canary/service";
import {
  FormativeConversationV18R2AgentOutputSchema
} from "../src/lib/services/student-assessment/formative-conversation/agent-contract-v18r2";
import { validateFormativeConversationV18R2CandidateAcceptance } from "../src/lib/services/student-assessment/formative-conversation/candidate-validation-v18r2";
import { buildFormativeConversationV18R2ProductionRequest } from "../src/lib/services/student-assessment/formative-conversation/live-runner-v18r2";

const launcher =
  "scripts/operational-formative-conversation-v18r2-ux-polish-canary-launcher.mjs";

function main() {
  const originalFetch = globalThis.fetch;
  let generationNetworkRequests = 0;
  globalThis.fetch = (async () => {
    generationNetworkRequests += 1;
    throw new Error("network_forbidden_in_v18r2_ux_canary_smoke");
  }) as typeof fetch;
  try {
    const loaded = loadV18R2UxPolishCanaryPackage();
    assert.equal(
      loaded.runtime_candidate_hash,
      "2d458a8578427e4c6ad1ca143f51ecb17b2c5f762a11aebf1f11a01aebe32d90"
    );
    assert.equal(
      loaded.candidate_identity.formative_prompt_hash,
      "27488d814b1f3978723a086a05ca22ec31618764f0adb1f64ba83d9f45758b80"
    );
    assert.deepEqual(
      loaded.fixtures.map((fixture) => fixture.case_id),
      [...V18R2_UX_CANARY_CASE_ORDER]
    );
    assert.deepEqual(loaded.protocol.budget, V18R2_UX_CANARY_BUDGET);
    assert.deepEqual(
      loaded.protocol.machine_validation_criteria,
      [...V18R2_UX_CANARY_MACHINE_CRITERIA]
    );
    assert.deepEqual(
      loaded.protocol.human_review_dimensions,
      [...V18R2_UX_CANARY_HUMAN_REVIEW_DIMENSIONS]
    );
    assert.equal(loaded.protocol.human_judgment_first, true);
    assert.equal(loaded.protocol.deterministic_ux_wording_assertions, false);
    assert.equal(loaded.authorization.exact_future_authorization_text, null);
    assert.equal(loaded.authorization.exact_future_live_command, null);

    const compiledRequests = loaded.fixtures.map((fixture) => {
      const request = buildFormativeConversationV18R2ProductionRequest({
        context: fixture.context,
        model_config: {
          model_name: "gpt-5.6-sol",
          reasoning_effort: "medium",
          max_output_tokens: 7_000
        },
        client_request_id: `v18r2-ux-canary-smoke:${fixture.case_id}`,
        timeout_ms: 90_000,
        invocation_key: `v18r2-ux-canary-smoke:${fixture.case_id}`
      });
      const compiled = compileProductionStructuredAgentRequest(request);
      assert.equal(compiled.model, "gpt-5.6-sol");
      assert.equal(compiled.max_output_tokens, 7_000);
      assert.equal(compiled.store, false);
      return { case_id: fixture.case_id, compiled: true };
    });

    const opening = loaded.fixtures[3];
    assert.equal(opening.opening_case, true);
    assert(opening.historical_reference);
    const historicalCandidate = FormativeConversationV18R2AgentOutputSchema.parse({
      contract_version: "formative-conversation-agent-contract-v4",
      outcome: "continue_conversation",
      student_visible_message: opening.historical_reference.message,
      teaching_artifact: null,
      evidence_observations: [],
      profile_transition_recommendation: null,
      teacher_assistance_recommendation: {
        recommended: false,
        reason_code: null
      },
      lifecycle_recommendation: "continue"
    });
    const historicalValidation =
      validateFormativeConversationV18R2CandidateAcceptance({
        candidate: historicalCandidate,
        context: opening.context
      });
    assert.equal(historicalValidation.valid, true);

    const bare = spawnSync(process.execPath, [launcher, "--mode=module-load-probe"], {
      cwd: process.cwd(),
      encoding: "utf8"
    });
    assert.notEqual(bare.status, 0);
    assert.match(bare.stderr, /v18r2_ux_canary_canonical_loader_required/u);
    const canonical = spawnSync(
      process.execPath,
      ["--import", "tsx", launcher, "--mode=module-load-probe"],
      { cwd: process.cwd(), encoding: "utf8" }
    );
    assert.equal(canonical.status, 0, canonical.stderr);
    assert.match(canonical.stdout, /"status":"cli_loaded"/u);

    const plan = buildV18R2UxCanaryPlan();
    assert.equal(plan.live_execution_prepared, true);
    assert.equal(plan.approval_eligible, false);
    assert.equal(plan.activation_permitted, false);
    assert.equal(plan.provider_calls, 0);
    const dispatchRoot = path.resolve(
      process.cwd(),
      V18R2_UX_CANARY_DISPATCH_ROOT,
      "dispatch"
    );
    const checkpointCount = existsSync(dispatchRoot)
      ? readdirSync(dispatchRoot).filter((name) => name.endsWith(".json")).length
      : 0;
    assert.equal(checkpointCount, 0);
    assert.equal(generationNetworkRequests, 0);
    const historicalReference = JSON.parse(
      readFileSync(
        path.resolve(
          process.cwd(),
          "config/operational-candidates/formative-conversation-v18r2-ux-polish-targeted-canary/base-ux-candidate-reference.json"
        ),
        "utf8"
      )
    ) as { historical_evidence_mutated: boolean };
    assert.equal(historicalReference.historical_evidence_mutated, false);

    console.log(JSON.stringify({
      status: "passed",
      case_count: loaded.fixtures.length,
      compiled_requests: compiledRequests,
      historical_natural_opening_reference_accepted: true,
      bare_node_failed_safely: true,
      canonical_launcher_loaded: true,
      provider_calls: 0,
      model_auth_requests: 0,
      generation_network_requests: generationNetworkRequests,
      real_dispatch_checkpoints: checkpointCount,
      live_execution_prepared: true,
      approval_eligible: false,
      activation_permitted: false
    }, null, 2));
  } finally {
    globalThis.fetch = originalFetch;
  }
}

main();
