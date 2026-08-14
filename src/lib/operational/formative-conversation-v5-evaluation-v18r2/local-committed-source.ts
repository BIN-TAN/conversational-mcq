import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { stableHash } from "@/lib/operational/stable-hash";

export const FORMATIVE_CONVERSATION_V18R2_LOCAL_PROVENANCE_VERSION =
  "formative-conversation-v18r2-local-committed-source-v1";

type GitExecutor = (
  args: readonly string[],
  options: { cwd: string; binary: boolean }
) => string | Buffer;

function defaultGitExecutor(
  args: readonly string[],
  options: { cwd: string; binary: boolean }
) {
  return execFileSync("git", [...args], {
    cwd: options.cwd,
    encoding: options.binary ? null : "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
}

function sha256(bytes: Buffer) {
  return createHash("sha256").update(bytes).digest("hex");
}

function text(value: string | Buffer) {
  return Buffer.isBuffer(value) ? value.toString("utf8").trim() : value.trim();
}

export function assertFormativeConversationV18R2MaterializationReproducible(
  firstHash: string,
  secondHash: string
) {
  if (
    !/^[a-f0-9]{64}$/u.test(firstHash) ||
    !/^[a-f0-9]{64}$/u.test(secondHash) ||
    firstHash !== secondHash
  ) {
    throw new Error(
      "formative_conversation_v18r2_materialization_not_reproducible"
    );
  }
  return true as const;
}

export function verifyFormativeConversationV18R2LocalCommittedSource(input: {
  workspace_root?: string;
  source_paths: readonly string[];
  expected_head?: string;
  git_executor?: GitExecutor;
}) {
  const workspaceRoot = path.resolve(input.workspace_root ?? process.cwd());
  const git = input.git_executor ?? defaultGitExecutor;
  const head = text(git(["rev-parse", "HEAD"], { cwd: workspaceRoot, binary: false }));
  const originMain = text(
    git(["rev-parse", "origin/main"], { cwd: workspaceRoot, binary: false })
  );
  if (!/^[a-f0-9]{40}$/u.test(head) || originMain !== head) {
    throw new Error("formative_conversation_v18r2_local_head_origin_mismatch");
  }
  if (input.expected_head && input.expected_head !== head) {
    throw new Error("formative_conversation_v18r2_local_expected_head_mismatch");
  }
  const trackedByRequestedPath = input.source_paths.map((sourcePath) =>
    text(
      git(["ls-files", "--", sourcePath], {
        cwd: workspaceRoot,
        binary: false
      })
    )
      .split("\n")
      .filter(Boolean)
  );
  if (
    trackedByRequestedPath.length === 0 ||
    trackedByRequestedPath.some((files) => files.length === 0)
  ) {
    throw new Error("formative_conversation_v18r2_local_source_closure_missing");
  }
  const files = [...new Set(trackedByRequestedPath.flat())].sort();
  const verifiedFiles = files.map((relativePath) => {
    const current = readFileSync(path.resolve(workspaceRoot, relativePath));
    const committed = git(["show", `${head}:${relativePath}`], {
      cwd: workspaceRoot,
      binary: true
    });
    const committedBytes = Buffer.isBuffer(committed)
      ? committed
      : Buffer.from(committed);
    if (!current.equals(committedBytes)) {
      throw new Error(
        `formative_conversation_v18r2_local_source_changed:${relativePath}`
      );
    }
    return { path: relativePath, sha256: sha256(current) };
  });
  const status = text(
    git(["status", "--porcelain"], {
      cwd: workspaceRoot,
      binary: false
    })
  );
  if (status !== "") {
    throw new Error("formative_conversation_v18r2_local_working_tree_not_clean");
  }
  const hashable = {
    version: FORMATIVE_CONVERSATION_V18R2_LOCAL_PROVENANCE_VERSION,
    source_commit_sha: head,
    origin_main_commit_sha: originMain,
    verified_files: verifiedFiles,
    source_closure_status: "verified" as const,
    reproducible_materialization_required: true as const
  };
  return { ...hashable, provenance_hash: stableHash(hashable) };
}
