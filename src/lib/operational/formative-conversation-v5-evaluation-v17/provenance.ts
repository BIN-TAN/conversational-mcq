import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { stableHash } from "@/lib/operational/stable-hash";
import { FORMATIVE_CONVERSATION_V5_EVALUATION_ROOT } from "./contracts";

export const FORMATIVE_CONVERSATION_V17_RUN_PROVENANCE_VERSION =
  "formative-conversation-v17-committed-source-provenance-v1";

export const FORMATIVE_CONVERSATION_V17_COMMITTED_SOURCE_PATHS = [
  FORMATIVE_CONVERSATION_V5_EVALUATION_ROOT,
  "src/lib/operational/formative-conversation-v17",
  "src/lib/operational/formative-conversation-v5-evaluation-v17",
  "src/lib/operational/formative-conversation-v5-evaluation-v14/candidate-runner.ts",
  "src/lib/operational/formative-conversation-v5-evaluation-v14/compiler.ts",
  "src/lib/operational/formative-conversation-v5-evaluation-v14/contracts.ts",
  "src/lib/operational/formative-conversation-v5-evaluation-v14/evaluation-accounting.ts",
  "src/lib/services/student-assessment/formative-conversation/agent-contract.ts",
  "src/lib/services/student-assessment/formative-conversation/misconception-evidence-closure.ts",
  "src/lib/services/student-assessment/formative-conversation/profile-field-semantics.ts",
  "src/lib/services/student-assessment/formative-conversation/profile-transition-validator.ts",
  "src/lib/services/student-assessment/formative-conversation/transition-evidence-closure.ts",
  "src/lib/services/student-assessment/formative-conversation/profile-update.ts",
  "src/lib/domain/misconception-claim-identity.ts",
  "src/lib/agents/contracts.ts",
  "src/lib/agents/prompts/student-profiling/v1.ts",
  "src/lib/agents/student-profiling/persistence.ts",
  "src/lib/agents/student-profiling/semantic-validation.ts",
  "src/lib/services/teacher-research-data/analysis-ready-export.ts",
  "src/lib/services/teacher-review/session-detail.ts",
  "prisma/formative-conversation-v17-fixture-materialize.ts",
  "prisma/formative-conversation-v17-v16-replay-fixture-materialize.ts",
  "prisma/formative-conversation-v17-v16-replay-smoke-test.ts",
  "prisma/operational-formative-conversation-v5-v17-evaluate.ts",
  "prisma/operational-formative-conversation-v17-materialize.ts",
  "package.json",
  "docs/operations/FORMATIVE_CONVERSATION_V17_CLAIM_IDENTITY.md",
  "scripts/operational-formative-conversation-v5-v17-launcher.mjs",
  "scripts/operational-formative-conversation-v5-v17-process-local-runner.mjs"
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

export function verifyFormativeConversationV17CommittedSource(input?: {
  workspace_root?: string;
  deployed_commit?: string | null;
  source_paths?: readonly string[];
}) {
  const workspaceRoot = path.resolve(input?.workspace_root ?? process.cwd());
  const sourceCommit = git(["rev-parse", "HEAD"], workspaceRoot);
  if (!/^[a-f0-9]{40}$/.test(sourceCommit)) {
    throw new Error("formative_conversation_v17_source_commit_invalid");
  }
  const files = git(
    [
      "ls-files",
      "--",
      ...(input?.source_paths ??
        FORMATIVE_CONVERSATION_V17_COMMITTED_SOURCE_PATHS)
    ],
    workspaceRoot
  )
    .split("\n")
    .filter(Boolean)
    .sort();
  if (files.length === 0) {
    throw new Error("formative_conversation_v17_tracked_package_missing");
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
        `formative_conversation_v17_tracked_source_changed:${relativePath}`
      );
    }
    return { path: relativePath, sha256: sha256(current) };
  });
  const deployedCommit = input?.deployed_commit?.trim() || null;
  if (
    deployedCommit !== null &&
    (!/^[a-f0-9]{40}$/.test(deployedCommit) ||
      deployedCommit !== sourceCommit)
  ) {
    throw new Error(
      "formative_conversation_v17_deployed_commit_mismatch"
    );
  }
  const hashable = {
    version: FORMATIVE_CONVERSATION_V17_RUN_PROVENANCE_VERSION,
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
