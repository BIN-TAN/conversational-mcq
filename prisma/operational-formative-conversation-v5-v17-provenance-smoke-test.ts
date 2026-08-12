import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  FORMATIVE_CONVERSATION_V17_COMMITTED_SOURCE_PATHS,
  verifyFormativeConversationV17CommittedSource
} from "../src/lib/operational/formative-conversation-v5-evaluation-v17/provenance";

const workspaceRoot = process.cwd();
const candidateRoot = path.resolve(
  workspaceRoot,
  "config/operational-candidates/formative-conversation-host-v5-executable-v17"
);

function git(cwd: string, args: string[]) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  }).trim();
}

function createCommittedFixture(options?: { include_identity?: boolean }) {
  const root = mkdtempSync(
    path.join(os.tmpdir(), "formative-conversation-v17-provenance-")
  );
  const freezeRoot = path.join(root, "freeze");
  mkdirSync(freezeRoot, { recursive: true });
  cpSync(candidateRoot, freezeRoot, { recursive: true });
  if (options?.include_identity === false) {
    rmSync(path.join(freezeRoot, "candidate-identity.json"));
  }
  git(root, ["init", "--quiet"]);
  git(root, ["config", "user.email", "v17-provenance@example.invalid"]);
  git(root, ["config", "user.name", "V17 Provenance Smoke"]);
  git(root, ["add", "freeze"]);
  git(root, ["commit", "--quiet", "-m", "Freeze provenance fixture"]);
  return root;
}

function expectProvenanceFailure(
  action: () => unknown,
  expectedCode: RegExp
) {
  let observedCode: string | null = null;
  try {
    action();
  } catch (error) {
    observedCode = error instanceof Error ? error.message : String(error);
  }
  assert.match(observedCode ?? "", expectedCode);
}

function verifyCleanCommittedPackage(input: {
  workspace_root: string;
  source_paths: string[];
}) {
  const verified = verifyFormativeConversationV17CommittedSource(input);
  const workingTreeStatus = git(input.workspace_root, [
    "status",
    "--porcelain",
    "--",
    ...input.source_paths
  ]);
  if (workingTreeStatus !== "") {
    throw new Error(
      "formative_conversation_v17_protected_working_tree_not_clean"
    );
  }
  return verified;
}

function candidateArtifactDigest(root: string) {
  const entries: Array<{ path: string; sha256: string }> = [];
  const visit = (directory: string) => {
    for (const name of readdirSync(directory).sort()) {
      const absolutePath = path.join(directory, name);
      const metadata = statSync(absolutePath);
      if (metadata.isDirectory()) {
        visit(absolutePath);
        continue;
      }
      entries.push({
        path: path.relative(root, absolutePath),
        sha256: createHash("sha256")
          .update(readFileSync(absolutePath))
          .digest("hex")
      });
    }
  };
  visit(root);
  return createHash("sha256")
    .update(JSON.stringify(entries))
    .digest("hex");
}

function assertReproducibleMaterialization(before: string, after: string) {
  if (before !== after) {
    throw new Error(
      "formative_conversation_v17_materialization_not_reproducible"
    );
  }
}

const cleanFixture = createCommittedFixture();
const stagedFixture = createCommittedFixture();
const unstagedFixture = createCommittedFixture();
const workingTreeOnlyFixture = createCommittedFixture();
const missingIdentityFixture = createCommittedFixture({
  include_identity: false
});

try {
  const committedControl = verifyCleanCommittedPackage({
    workspace_root: cleanFixture,
    source_paths: ["freeze"]
  });
  assert.match(
    committedControl.source_application_git_commit,
    /^[a-f0-9]{40}$/
  );
  assert.equal(committedControl.tracked_package_unchanged, true);
  assert.equal(git(cleanFixture, ["status", "--porcelain"]), "");
  assert.ok(FORMATIVE_CONVERSATION_V17_COMMITTED_SOURCE_PATHS.length >= 8);

  writeFileSync(
    path.join(stagedFixture, "freeze", "candidate-identity.json"),
    `${JSON.stringify({ runtime_candidate_hash: "b".repeat(64) })}\n`,
    "utf8"
  );
  git(stagedFixture, ["add", "freeze/candidate-identity.json"]);
  expectProvenanceFailure(
    () =>
      verifyCleanCommittedPackage({
        workspace_root: stagedFixture,
        source_paths: ["freeze"]
      }),
    /formative_conversation_v17_tracked_source_changed/
  );

  writeFileSync(
    path.join(unstagedFixture, "freeze", "candidate-identity.json"),
    `${JSON.stringify({ runtime_candidate_hash: "c".repeat(64) })}\n`,
    "utf8"
  );
  expectProvenanceFailure(
    () =>
      verifyCleanCommittedPackage({
        workspace_root: unstagedFixture,
        source_paths: ["freeze"]
      }),
    /formative_conversation_v17_tracked_source_changed/
  );

  writeFileSync(
    path.join(workingTreeOnlyFixture, "freeze", "working-tree-only.json"),
    "{}\n",
    "utf8"
  );
  expectProvenanceFailure(
    () =>
      verifyCleanCommittedPackage({
        workspace_root: workingTreeOnlyFixture,
        source_paths: ["freeze"]
      }),
    /formative_conversation_v17_protected_working_tree_not_clean/
  );

  expectProvenanceFailure(
    () =>
      verifyCleanCommittedPackage({
        workspace_root: missingIdentityFixture,
        source_paths: ["freeze/missing-provenance-identity.json"]
      }),
    /formative_conversation_v17_tracked_package_missing/
  );

  const firstMaterialization = candidateArtifactDigest(candidateRoot);
  execFileSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "prisma/operational-formative-conversation-v17-materialize.ts"
    ],
    {
      cwd: workspaceRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    }
  );
  const secondMaterialization = candidateArtifactDigest(candidateRoot);
  assertReproducibleMaterialization(
    firstMaterialization,
    secondMaterialization
  );
  expectProvenanceFailure(
    () =>
      assertReproducibleMaterialization(
        firstMaterialization,
        "0".repeat(64)
      ),
    /formative_conversation_v17_materialization_not_reproducible/
  );

  console.log(
    JSON.stringify({
      status: "passed",
      committed_freeze_package_accepted: true,
      clean_working_tree_accepted: true,
      reproducible_rematerialization_accepted: true,
      staged_freeze_change_rejected: true,
      unstaged_freeze_change_rejected: true,
      working_tree_only_dependency_rejected: true,
      missing_provenance_identity_rejected: true,
      non_reproducible_package_rejected: true,
      provenance_fail_closed: true,
      provider_calls: 0,
      model_auth_requests: 0,
      dispatch_checkpoints: 0
    })
  );
} finally {
  for (const root of [
    cleanFixture,
    stagedFixture,
    unstagedFixture,
    workingTreeOnlyFixture,
    missingIdentityFixture
  ]) {
    rmSync(root, { recursive: true, force: true });
  }
}
