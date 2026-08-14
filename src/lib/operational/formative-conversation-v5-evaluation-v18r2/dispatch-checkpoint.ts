import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { stableHash } from "@/lib/operational/stable-hash";

export const FORMATIVE_CONVERSATION_V18R2_DISPATCH_CHECKPOINT_VERSION =
  "formative-conversation-v18r2-dispatch-checkpoint-v1";

export type FormativeConversationV18R2DispatchIdentity = {
  provider_run_id: string;
  derived_evaluation_id: string;
  runtime_candidate_hash: string;
  evaluation_protocol_hash: string;
  runner_implementation_hash: string;
  candidate_manifest_hash: string;
  fixture_manifest_hash: string;
  aggregate_fixture_hash: string;
  compiled_plan_hash: string;
  live_environment_contract_hash: string;
  dispatch_checkpoint_contract_hash: string;
  provenance_contract_hash: string;
  source_commit_sha: string;
  deployment_reported_commit_sha: string;
  operator_authorized_commit_sha: string;
  deployed_artifact_identity_status: "verified";
  deployed_artifact_provenance_hash: string;
  execution_authorization_identity_hash: string;
};

function sha256(bytes: Buffer) {
  return createHash("sha256").update(bytes).digest("hex");
}

export async function writeFormativeConversationV18R2DispatchCheckpoint(input: {
  dispatch_root: string;
  identity: FormativeConversationV18R2DispatchIdentity;
}) {
  const commitSha = /^[a-f0-9]{40}$/u;
  if (
    !commitSha.test(input.identity.source_commit_sha) ||
    !commitSha.test(input.identity.deployment_reported_commit_sha) ||
    !commitSha.test(input.identity.operator_authorized_commit_sha) ||
    input.identity.source_commit_sha !==
      input.identity.deployment_reported_commit_sha ||
    input.identity.source_commit_sha !==
      input.identity.operator_authorized_commit_sha
  ) {
    throw new Error(
      "formative_conversation_v18r2_dispatch_commit_identity_mismatch"
    );
  }
  const dispatchPath = path.resolve(
    process.cwd(),
    input.dispatch_root,
    "dispatch",
    `${input.identity.evaluation_protocol_hash}.json`
  );
  await mkdir(path.dirname(dispatchPath), { recursive: true });
  const payload = {
    checkpoint_version:
      FORMATIVE_CONVERSATION_V18R2_DISPATCH_CHECKPOINT_VERSION,
    dispatch_boundary: "immediately_before_first_generation_request",
    identity: input.identity,
    immutable_identity_binding_hash: stableHash(input.identity),
    dispatch_checkpoint_recorded_at: new Date().toISOString(),
    exactly_once: true,
    execution_may_not_be_rerun: true,
    provider_request_started: false
  } as const;
  try {
    await writeFile(dispatchPath, `${JSON.stringify(payload, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600
    });
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      error.code === "EEXIST"
    ) {
      throw new Error(
        "formative_conversation_v18r2_protocol_already_dispatched"
      );
    }
    throw error;
  }
  const bytes = await readFile(dispatchPath);
  const persisted = JSON.parse(bytes.toString("utf8")) as typeof payload;
  if (
    persisted.immutable_identity_binding_hash !==
      stableHash(input.identity) ||
    stableHash(persisted.identity) !== stableHash(input.identity)
  ) {
    throw new Error(
      "formative_conversation_v18r2_dispatch_checkpoint_identity_mismatch"
    );
  }
  return {
    dispatch_path: dispatchPath,
    dispatch_checkpoint_sha256: sha256(bytes),
    immutable_identity_binding_hash:
      persisted.immutable_identity_binding_hash
  };
}
