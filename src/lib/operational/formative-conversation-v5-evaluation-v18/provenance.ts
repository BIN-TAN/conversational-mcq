import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { stableHash } from "@/lib/operational/stable-hash";
import {
  FORMATIVE_CONVERSATION_V18_RUNTIME_SOURCE_PATHS,
  FORMATIVE_CONVERSATION_V18_VERIFICATION_SOURCE_PATHS
} from "@/lib/operational/formative-conversation-v18/candidate";
import { FORMATIVE_CONVERSATION_V5_EVALUATION_ROOT } from "./contracts";

export const FORMATIVE_CONVERSATION_V18_RUN_PROVENANCE_VERSION =
  "formative-conversation-v18-committed-source-provenance-v1";

export const FORMATIVE_CONVERSATION_V18_COMMITTED_SOURCE_PATHS = [
  FORMATIVE_CONVERSATION_V5_EVALUATION_ROOT,
  "config/operational-candidates/formative-conversation-contract-convergence-v18",
  "src/lib/operational/formative-conversation-v18",
  "src/lib/operational/formative-conversation-v5-evaluation-v18",
  ...FORMATIVE_CONVERSATION_V18_RUNTIME_SOURCE_PATHS,
  ...FORMATIVE_CONVERSATION_V18_VERIFICATION_SOURCE_PATHS,
  "src/lib/operational/formative-conversation-v5-evaluation-v16/compiler.ts",
  "src/lib/operational/formative-conversation-v5-evaluation-v16/contracts.ts",
  "src/lib/operational/formative-conversation-v5-evaluation-v14/compiler.ts",
  "src/lib/operational/formative-conversation-v5-evaluation-v14/contracts.ts",
  "config/operational-candidates/formative-conversation-host-v5-executable-v16/fixtures",
  "prisma/formative-conversation-v18-fixture-materialize.ts",
  "prisma/formative-conversation-v18-test-fixtures.ts",
  "prisma/formative-conversation-v18-v17-forensic-replay-smoke-test.ts",
  "prisma/formative-conversation-v18-provider-request-smoke-test.ts",
  "prisma/formative-conversation-v18-contract-smoke-test.ts",
  "prisma/formative-conversation-v18-pipeline-runtime-smoke-test.ts",
  "prisma/formative-conversation-v18-runtime-database-smoke-test.ts",
  "prisma/operational-formative-conversation-v5-v18-evaluate.ts",
  "prisma/operational-formative-conversation-v18-materialize.ts",
  "prisma/operational-formative-conversation-v18-smoke-test.ts",
  "prisma/operational-formative-conversation-v5-v18-compilation-smoke-test.ts",
  "prisma/operational-formative-conversation-v5-v18-launcher-smoke-test.ts",
  "prisma/operational-formative-conversation-v5-v18-environment-parity-smoke-test.ts",
  "prisma/operational-formative-conversation-v5-v18-dispatch-checkpoint-smoke-test.ts",
  "prisma/operational-formative-conversation-v5-v18-security-smoke-test.ts",
  "prisma/operational-formative-conversation-v5-v18-provenance-smoke-test.ts",
  "prisma/helpers/formative-conversation-v5-v18-test-environment.ts",
  "package.json",
  ".env.example",
  "docs/operations/FORMATIVE_CONVERSATION_V18_CONTRACT_CONVERGENCE.md",
  "scripts/operational-formative-conversation-v5-v18-launcher.mjs",
  "scripts/operational-formative-conversation-v5-v18-process-local-runner.mjs"
] as const;

function git(args: string[], cwd: string) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  }).trim();
}

function sha256(bytes: Buffer) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function verifyFormativeConversationV18CommittedSource(input?: {
  workspace_root?: string;
  deployed_commit?: string | null;
  source_paths?: readonly string[];
}) {
  const workspaceRoot = path.resolve(input?.workspace_root ?? process.cwd());
  const sourceCommit = git(["rev-parse", "HEAD"], workspaceRoot);
  if (!/^[a-f0-9]{40}$/.test(sourceCommit)) {
    throw new Error("formative_conversation_v18_source_commit_invalid");
  }
  const files = git(
    [
      "ls-files",
      "--",
      ...(input?.source_paths ??
        FORMATIVE_CONVERSATION_V18_COMMITTED_SOURCE_PATHS)
    ],
    workspaceRoot
  )
    .split("\n")
    .filter(Boolean)
    .sort();
  if (files.length === 0) {
    throw new Error("formative_conversation_v18_tracked_package_missing");
  }
  const verifiedFiles = files.map((relativePath) => {
    const current = readFileSync(path.resolve(workspaceRoot, relativePath));
    const committed = execFileSync(
      "git",
      ["show", `${sourceCommit}:${relativePath}`],
      { cwd: workspaceRoot, stdio: ["ignore", "pipe", "pipe"] }
    );
    if (!current.equals(committed)) {
      throw new Error(
        `formative_conversation_v18_tracked_source_changed:${relativePath}`
      );
    }
    return { path: relativePath, sha256: sha256(current) };
  });
  const workingTreeStatus = git(
    [
      "status",
      "--porcelain",
      "--",
      ...(input?.source_paths ??
        FORMATIVE_CONVERSATION_V18_COMMITTED_SOURCE_PATHS)
    ],
    workspaceRoot
  );
  if (workingTreeStatus !== "") {
    throw new Error(
      "formative_conversation_v18_protected_working_tree_not_clean"
    );
  }
  const deployedCommit = input?.deployed_commit?.trim() || null;
  if (
    deployedCommit !== null &&
    (!/^[a-f0-9]{40}$/.test(deployedCommit) ||
      deployedCommit !== sourceCommit)
  ) {
    throw new Error(
      "formative_conversation_v18_deployed_commit_mismatch"
    );
  }
  const hashable = {
    version: FORMATIVE_CONVERSATION_V18_RUN_PROVENANCE_VERSION,
    source_application_git_commit: sourceCommit,
    deployed_application_git_commit: deployedCommit,
    verified_files: verifiedFiles,
    tracked_package_unchanged: true as const
  };
  return {
    ...hashable,
    provenance_hash: stableHash(hashable)
  };
}
