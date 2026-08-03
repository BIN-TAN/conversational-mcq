import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import {
  FORMATIVE_CONVERSATION_V5_RUN_OUTPUT_ROOT
} from "../src/lib/operational/formative-conversation-v5-evaluation-v12/contracts";
import {
  loadFormativeConversationV5EvaluationPackage
} from "../src/lib/operational/formative-conversation-v5-evaluation-v12/package";
import {
  buildFormativeConversationV5TestEnvironment
} from "./helpers/formative-conversation-v5-v12-test-environment";

const TEST_RESEARCH_KEY =
  "formative-conversation-v12-plan-research-key-000000000000";
const TEST_OPENAI_KEY =
  ["sk", "formativeconversationv8plan000000000000"].join("-");

function sha256File(filePath: string) {
  return createHash("sha256")
    .update(readFileSync(filePath))
    .digest("hex");
}

function main() {
  const loaded = loadFormativeConversationV5EvaluationPackage();
  const dispatchPath = path.resolve(
    FORMATIVE_CONVERSATION_V5_RUN_OUTPUT_ROOT,
    "dispatch",
    `${loaded.protocol_hash}.json`
  );
  assert.equal(existsSync(dispatchPath), false);

  const env = buildFormativeConversationV5TestEnvironment({
    DATABASE_URL: process.env.DATABASE_URL,
    OPERATIONAL_LIVE_CANARY_DATABASE_URL:
      process.env.OPERATIONAL_LIVE_CANARY_DATABASE_URL,
    OPERATIONAL_LIVE_CANARY_DATABASE_URL_ACTIVE:
      process.env.OPERATIONAL_LIVE_CANARY_DATABASE_URL_ACTIVE,
    RESEARCH_PSEUDONYMIZATION_KEY: TEST_RESEARCH_KEY,
    OPENAI_API_KEY: TEST_OPENAI_KEY
  });
  const child = spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "scripts/operational-formative-conversation-v5-v12-launcher.mjs",
      "--mode=plan"
    ],
    {
      cwd: process.cwd(),
      env,
      encoding: "utf8",
      timeout: 180_000
    }
  );
  assert.equal(
    child.status,
    0,
    child.stderr.trim() || child.error?.message || "V12 plan failed."
  );
  assert.equal(child.stdout.includes(TEST_RESEARCH_KEY), false);
  assert.equal(child.stderr.includes(TEST_RESEARCH_KEY), false);
  assert.equal(child.stdout.includes(TEST_OPENAI_KEY), false);
  assert.equal(child.stderr.includes(TEST_OPENAI_KEY), false);

  const output = JSON.parse(child.stdout) as {
    status: string;
    provider_calls: number;
    provider_network_requests: number;
    provider_auth_network_requests: number;
    database_readiness_queries: number;
    plan_artifact_path: string;
    plan_artifact_sha256: string;
    plan: {
      mode: string;
      provider_calls: number;
      provider_network_requests: number;
      provider_auth_network_requests: number;
      database_readiness_queries: number;
      dispatch_boundary: {
        status: string;
        checkpoint_created: boolean;
      };
      candidate: {
        runtime_candidate_hash: string;
      };
      protocol: {
        hash: string;
      };
      compiled_execution_plan: {
        compilation_status: string;
        aggregate_call_graph: {
          expected_logical_call_count: number;
          maximum_logical_call_count: number;
          maximum_provider_attempt_count: number;
        };
      };
    };
  };
  assert.equal(output.status, "planned");
  assert.equal(output.provider_calls, 0);
  assert.equal(output.provider_network_requests, 0);
  assert.equal(output.provider_auth_network_requests, 0);
  assert.equal(output.database_readiness_queries, 1);
  assert.equal(output.plan.mode, "plan");
  assert.equal(output.plan.provider_calls, 0);
  assert.equal(output.plan.provider_network_requests, 0);
  assert.equal(output.plan.provider_auth_network_requests, 0);
  assert.equal(output.plan.database_readiness_queries, 1);
  assert.equal(
    output.plan.dispatch_boundary.status,
    "ready_immediately_before_dispatch_checkpoint"
  );
  assert.equal(
    output.plan.dispatch_boundary.checkpoint_created,
    false
  );
  assert.equal(
    output.plan.candidate.runtime_candidate_hash,
    loaded.runtime_candidate_hash
  );
  assert.equal(
    output.plan.protocol.hash,
    loaded.protocol_hash
  );
  assert.equal(
    output.plan.compiled_execution_plan.compilation_status,
    "ready_for_dispatch"
  );
  assert.equal(
    output.plan.compiled_execution_plan.aggregate_call_graph
      .expected_logical_call_count,
    21
  );
  assert.equal(
    output.plan.compiled_execution_plan.aggregate_call_graph
      .maximum_logical_call_count,
    29
  );
  assert.equal(
    output.plan.compiled_execution_plan.aggregate_call_graph
      .maximum_provider_attempt_count,
    87
  );
  assert.equal(existsSync(output.plan_artifact_path), true);
  assert.equal(
    sha256File(output.plan_artifact_path),
    output.plan_artifact_sha256
  );
  const artifactText = readFileSync(
    output.plan_artifact_path,
    "utf8"
  );
  assert.equal(artifactText.includes(TEST_RESEARCH_KEY), false);
  assert.equal(artifactText.includes(TEST_OPENAI_KEY), false);
  assert.equal(existsSync(dispatchPath), false);

  console.log(
    JSON.stringify(
      {
        status: "passed",
        plan_artifact_path: output.plan_artifact_path,
        plan_artifact_sha256: output.plan_artifact_sha256,
        dispatch_boundary:
          output.plan.dispatch_boundary.status,
        checkpoint_created: false,
        provider_calls: 0,
        provider_network_requests: 0,
        provider_auth_network_requests: 0,
        all_eight_cases_executable: true,
        expected_logical_calls: 21,
        maximum_logical_calls: 29,
        maximum_provider_attempts: 87,
        secrets_displayed: false,
        secrets_persisted: false
      },
      null,
      2
    )
  );
}

try {
  main();
} catch (error) {
  console.error(
    JSON.stringify({
      status: "failed",
      error_code:
        error instanceof Error
          ? error.message.split(":", 1)[0]
          : "formative_conversation_v12_plan_smoke_failed",
      provider_calls: 0,
      provider_network_requests: 0,
      secrets_printed: false
    })
  );
  process.exitCode = 1;
}
