import { strict as assert } from "node:assert";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  FORMATIVE_CONVERSATION_V17_DISPATCH_CHECKPOINT_VERSION,
  writeFormativeConversationV17DispatchCheckpoint
} from "../src/lib/operational/formative-conversation-v5-evaluation-v17/dispatch-checkpoint";

const hash = (character: string) => character.repeat(64);
const identity = {
  provider_run_id: "fcv5v17_provider_test",
  derived_evaluation_id: "fcv5v17_derived_test",
  runtime_candidate_hash: hash("a"),
  evaluation_protocol_hash: hash("b"),
  runner_implementation_hash: hash("c"),
  fixture_manifest_hash: hash("d"),
  aggregate_fixture_hash: hash("e"),
  compiled_plan_hash: hash("f"),
  live_environment_contract_hash: hash("1"),
  dispatch_checkpoint_contract_hash: hash("2")
};

async function main() {
const root = await mkdtemp(path.join(tmpdir(), "fcv17-dispatch-"));
try {
  const first = await writeFormativeConversationV17DispatchCheckpoint({
    dispatch_root: root,
    identity
  });
  const persisted = JSON.parse(
    await readFile(first.dispatch_path, "utf8")
  ) as Record<string, unknown>;
  assert.equal(
    persisted.checkpoint_version,
    FORMATIVE_CONVERSATION_V17_DISPATCH_CHECKPOINT_VERSION
  );
  assert.equal(
    persisted.dispatch_boundary,
    "immediately_before_first_generation_request"
  );
  assert.equal(persisted.provider_request_started, false);
  await assert.rejects(
    writeFormativeConversationV17DispatchCheckpoint({
      dispatch_root: root,
      identity
    }),
    /formative_conversation_v17_protocol_already_dispatched/
  );
  console.log(
    JSON.stringify({
      status: "passed",
      exclusive_checkpoint_writes: 1,
      duplicate_dispatch_blocked: true,
      actual_evaluation_dispatch_checkpoints: 0,
      provider_calls: 0,
      model_auth_requests: 0
    })
  );
} finally {
  await rm(root, { recursive: true, force: true });
}
}

void main();
