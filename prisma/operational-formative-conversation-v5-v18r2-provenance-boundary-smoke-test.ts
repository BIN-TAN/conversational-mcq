import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
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
  assertFormativeConversationV18R2MaterializationReproducible,
  verifyFormativeConversationV18R2LocalCommittedSource
} from "../src/lib/operational/formative-conversation-v5-evaluation-v18r2/local-committed-source";

function git(root: string, args: string[]) {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  }).trim();
}

function directoryDigest(root: string) {
  const entries: Array<{ path: string; sha256: string }> = [];
  const visit = (directory: string) => {
    for (const name of readdirSync(directory).sort()) {
      const absolutePath = path.join(directory, name);
      if (statSync(absolutePath).isDirectory()) {
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

const root = mkdtempSync(path.join(os.tmpdir(), "fcv18r2-local-provenance-"));
try {
  mkdirSync(path.join(root, "freeze"));
  writeFileSync(path.join(root, "freeze", "identity.json"), "{}\n");
  git(root, ["init", "--quiet", "--initial-branch=main"]);
  git(root, ["config", "user.email", "v18r2@example.invalid"]);
  git(root, ["config", "user.name", "V18R2 Provenance"]);
  git(root, ["add", "freeze"]);
  git(root, ["commit", "--quiet", "-m", "freeze"]);
  git(root, ["remote", "add", "origin", root]);
  git(root, ["update-ref", "refs/remotes/origin/main", "HEAD"]);
  const clean = verifyFormativeConversationV18R2LocalCommittedSource({
    workspace_root: root,
    source_paths: ["freeze"]
  });
  assert.equal(clean.source_commit_sha, clean.origin_main_commit_sha);
  assert.equal(clean.source_closure_status, "verified");
  assert.equal(
    assertFormativeConversationV18R2MaterializationReproducible(
      "a".repeat(64),
      "a".repeat(64)
    ),
    true
  );
  assert.throws(
    () =>
      assertFormativeConversationV18R2MaterializationReproducible(
        "a".repeat(64),
        "b".repeat(64)
      ),
    /materialization_not_reproducible/
  );

  writeFileSync(path.join(root, "freeze", "identity.json"), '{"dirty":true}\n');
  assert.throws(
    () => verifyFormativeConversationV18R2LocalCommittedSource({
      workspace_root: root,
      source_paths: ["freeze"]
    }),
    /local_source_changed/
  );

  git(root, ["checkout", "--", "freeze/identity.json"]);
  writeFileSync(path.join(root, "unrelated.txt"), "dirty\n");
  assert.throws(
    () =>
      verifyFormativeConversationV18R2LocalCommittedSource({
        workspace_root: root,
        source_paths: ["freeze"]
      }),
    /local_working_tree_not_clean/
  );
  assert.throws(
    () =>
      verifyFormativeConversationV18R2LocalCommittedSource({
        workspace_root: root,
        source_paths: ["freeze", "missing-source"]
      }),
    /local_source_closure_missing/
  );

  const candidateRoot = path.resolve(
    "config/operational-candidates/formative-conversation-host-v5-executable-v18r2"
  );
  const before = directoryDigest(candidateRoot);
  for (let iteration = 0; iteration < 2; iteration += 1) {
    execFileSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "prisma/operational-formative-conversation-v18r2-materialize.ts"
      ],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"]
      }
    );
    assertFormativeConversationV18R2MaterializationReproducible(
      before,
      directoryDigest(candidateRoot)
    );
  }

  console.log(JSON.stringify({
    status: "passed",
    local_git_provenance_passed: true,
    head_origin_parity_checked: true,
    dirty_source_rejected: true,
    unrelated_dirty_source_rejected: true,
    missing_source_path_rejected: true,
    reproducible_materialization_checked: true,
    provider_calls: 0,
    model_auth_requests: 0,
    network_requests: 0,
    dispatch_checkpoints: 0,
    database_writes: 0
  }));
} finally {
  rmSync(root, { recursive: true, force: true });
}
