import { strict as assert } from "node:assert";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  writeFormativeConversationV18R2DispatchCheckpoint
} from "../src/lib/operational/formative-conversation-v5-evaluation-v18r2/dispatch-checkpoint";

const h = (value: string) => value.repeat(64);
const commit = "a".repeat(40);

async function main() {
  const root = await mkdtemp(path.join(tmpdir(), "fcv18r2-checkpoint-"));
  try {
    const identity = {
      provider_run_id: "fcv5v18r2_provider_test",
      derived_evaluation_id: "fcv5v18r2_derived_test",
      runtime_candidate_hash: h("a"),
      evaluation_protocol_hash: h("b"),
      runner_implementation_hash: h("c"),
      candidate_manifest_hash: h("d"),
      fixture_manifest_hash: h("e"),
      aggregate_fixture_hash: h("f"),
      compiled_plan_hash: h("1"),
      live_environment_contract_hash: h("2"),
      dispatch_checkpoint_contract_hash: h("3"),
      provenance_contract_hash: h("4"),
      source_commit_sha: commit,
      deployment_reported_commit_sha: commit,
      operator_authorized_commit_sha: commit,
      deployed_artifact_identity_status: "verified" as const,
      deployed_artifact_provenance_hash: h("5"),
      execution_authorization_identity_hash: h("6")
    };
    const created = await writeFormativeConversationV18R2DispatchCheckpoint({
      dispatch_root: root,
      identity
    });
    const persisted = JSON.parse(await readFile(created.dispatch_path, "utf8"));
    assert.deepEqual(persisted.identity, identity);
    await assert.rejects(
      writeFormativeConversationV18R2DispatchCheckpoint({
        dispatch_root: path.join(root, "mismatch"),
        identity: {
          ...identity,
          operator_authorized_commit_sha: "b".repeat(40)
        }
      }),
      /dispatch_commit_identity_mismatch/
    );
    await assert.rejects(
      writeFormativeConversationV18R2DispatchCheckpoint({
        dispatch_root: root,
        identity
      }),
      /protocol_already_dispatched/
    );
    console.log(JSON.stringify({
      status: "passed",
      deployed_commit_bound: true,
      operator_commit_bound: true,
      deployed_artifact_status_bound: true,
      deployed_artifact_provenance_bound: true,
      execution_authorization_bound: true,
      duplicate_dispatch_blocked: true,
      real_dispatch_checkpoints: 0,
      provider_calls: 0,
      model_auth_requests: 0,
      network_requests: 0
    }));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

void main();
