import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  verifyFormativeConversationV11CommittedSource,
  writeFormativeConversationV11RunScopedProvenance
} from "../src/lib/operational/formative-conversation-v5-evaluation-v11/provenance";

function git(cwd: string, args: string[]) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  }).trim();
}

function sha256(filePath: string) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function fileInventory(root: string) {
  const result = new Map<string, string>();
  if (!existsSync(root)) {
    return result;
  }
  const visit = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(entryPath);
      } else if (entry.isFile()) {
        result.set(path.relative(root, entryPath), sha256(entryPath));
      }
    }
  };
  visit(root);
  return result;
}

function assertInventoryEqual(
  before: Map<string, string>,
  after: Map<string, string>,
  label: string
) {
  assert.deepEqual([...after.entries()], [...before.entries()], `${label} changed`);
}

function committedSourceFixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "fcv5-v11-provenance-"));
  const sources = [
    "config/operational-candidates/formative-conversation-host-v5-executable-v11/spec.json",
    "src/lib/operational/formative-conversation-v5-evaluation-v11/runtime.ts"
  ];
  for (const relativePath of sources) {
    mkdirSync(path.dirname(path.join(root, relativePath)), { recursive: true });
    writeFileSync(path.join(root, relativePath), `${relativePath}\n`);
  }
  writeFileSync(path.join(root, ".gitignore"), ".data/\n");
  git(root, ["init", "-q"]);
  git(root, ["config", "user.name", "V11 Provenance Test"]);
  git(root, ["config", "user.email", "v11-provenance@example.invalid"]);
  git(root, ["add", "."]);
  git(root, ["commit", "-qm", "fixture"]);
  return { root, sources };
}

function testCommittedSourceVerification() {
  const fixture = committedSourceFixture();
  try {
    assert.equal(git(fixture.root, ["status", "--short"]), "");
    const verified = verifyFormativeConversationV11CommittedSource({
      workspace_root: fixture.root,
      source_paths: fixture.sources
    });
    assert.match(verified.source_application_git_commit, /^[a-f0-9]{40}$/);
    assert.equal(verified.verified_files.length, fixture.sources.length);
    const written = writeFormativeConversationV11RunScopedProvenance({
      workspace_root: fixture.root,
      deployed_commit: verified.source_application_git_commit,
      source_paths: fixture.sources
    });
    assert.equal(existsSync(written.artifact_path), true);
    assert.equal(
      written.provenance.source_application_git_commit,
      verified.source_application_git_commit
    );
    assert.equal(
      written.provenance.deployed_application_git_commit,
      verified.source_application_git_commit
    );
    assert.equal(git(fixture.root, ["status", "--short"]), "");

    writeFileSync(path.join(fixture.root, fixture.sources[0]), "changed\n");
    assert.throws(
      () =>
        verifyFormativeConversationV11CommittedSource({
          workspace_root: fixture.root,
          source_paths: fixture.sources
        }),
      /formative_conversation_v11_tracked_source_changed/
    );
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
}

function testMaterializationIsVerificationOnly() {
  const workspaceRoot = process.cwd();
  const v11Root = path.join(
    workspaceRoot,
    "config/operational-candidates/formative-conversation-host-v5-executable-v11"
  );
  const v10ConfigRoot = path.join(
    workspaceRoot,
    "config/operational-candidates/formative-conversation-host-v5-executable-v10"
  );
  const v10RunRoot = path.join(
    workspaceRoot,
    ".data/operational-formative-conversation-v5-evaluation-v10"
  );
  const v10ReviewRoot = path.join(
    workspaceRoot,
    ".data/human-review-workspaces/fcv5v10_provider_20260803083252_623e2625"
  );
  const statusBefore = git(workspaceRoot, ["status", "--short"]);
  const v11Before = fileInventory(v11Root);
  const v10ConfigBefore = fileInventory(v10ConfigRoot);
  const v10RunBefore = fileInventory(v10RunRoot);
  const v10ReviewBefore = fileInventory(v10ReviewRoot);
  const child = spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "prisma/operational-formative-conversation-v5-v11-fixture-materialize.ts"
    ],
    {
      cwd: workspaceRoot,
      encoding: "utf8",
      timeout: 120_000,
      env: { ...process.env }
    }
  );
  assert.equal(child.status, 0, child.stderr || child.stdout);
  const output = JSON.parse(child.stdout) as {
    provider_calls: number;
    provider_network_requests: number;
    source_application_git_commit: string;
    tracked_candidate_files_rewritten_during_verification: boolean;
    source_provenance_location: string;
  };
  assert.equal(output.provider_calls, 0);
  assert.equal(output.provider_network_requests, 0);
  assert.equal(output.tracked_candidate_files_rewritten_during_verification, false);
  assert.equal(output.source_application_git_commit, git(workspaceRoot, ["rev-parse", "HEAD"]));
  assert.equal(existsSync(path.join(workspaceRoot, output.source_provenance_location)), true);
  assertInventoryEqual(v11Before, fileInventory(v11Root), "V11 candidate package");
  assertInventoryEqual(v10ConfigBefore, fileInventory(v10ConfigRoot), "V10 candidate package");
  assertInventoryEqual(v10RunBefore, fileInventory(v10RunRoot), "V10 run evidence");
  assertInventoryEqual(v10ReviewBefore, fileInventory(v10ReviewRoot), "V10 review evidence");
  assert.equal(git(workspaceRoot, ["status", "--short"]), statusBefore);
}

function main() {
  testCommittedSourceVerification();
  testMaterializationIsVerificationOnly();
  console.log(
    JSON.stringify(
      {
        status: "passed",
        suite: "formative-conversation-v11-provenance",
        clean_fixture_before_materialization: true,
        clean_fixture_after_materialization: true,
        run_scoped_source_commit_recorded: true,
        tracked_files_rewritten: false,
        v10_evidence_immutable: true,
        provider_calls: 0,
        model_auth_requests: 0,
        dispatch_checkpoints: 0
      },
      null,
      2
    )
  );
}

main();
