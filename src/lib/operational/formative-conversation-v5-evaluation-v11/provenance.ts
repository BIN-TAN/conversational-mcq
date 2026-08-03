import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { stableHash } from "@/lib/operational/stable-hash";
import {
  FORMATIVE_CONVERSATION_V5_EVALUATION_ROOT
} from "./contracts";
import {
  FORMATIVE_CONVERSATION_V11_DATA_ROOT
} from "./security-release";

export const FORMATIVE_CONVERSATION_V11_RUN_PROVENANCE_VERSION =
  "formative-conversation-v11-run-scoped-committed-source-provenance-v1" as const;

const SHA40 = /^[a-f0-9]{40}$/;

function git(args: string[], cwd: string) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  }).trim();
}

function sha256(content: Buffer | string) {
  return createHash("sha256").update(content).digest("hex");
}

const DEFAULT_COMMITTED_SOURCE_PATHS = [
  FORMATIVE_CONVERSATION_V5_EVALUATION_ROOT,
  "src/lib/operational/formative-conversation-v5-evaluation-v11",
  "prisma/operational-formative-conversation-v5-v11-evaluate.ts",
  "prisma/operational-formative-conversation-v5-v11-fixture-materialize.ts",
  "scripts/operational-formative-conversation-v5-v11-launcher.mjs",
  "scripts/operational-formative-conversation-v5-v11-process-local-runner.mjs"
] as const;

function packageFiles(workspaceRoot: string, sourcePaths: readonly string[]) {
  return git(
    ["ls-files", "--", ...sourcePaths],
    workspaceRoot
  )
    .split("\n")
    .filter(Boolean)
    .sort();
}

export type FormativeConversationV11CommittedSourceVerification = {
  version: typeof FORMATIVE_CONVERSATION_V11_RUN_PROVENANCE_VERSION;
  source_application_git_commit: string;
  deployed_application_git_commit: string | null;
  verified_files: Array<{
    path: string;
    sha256: string;
  }>;
  tracked_package_unchanged: true;
  recorded_at: string;
  provenance_hash: string;
};

export function verifyFormativeConversationV11CommittedSource(input?: {
  workspace_root?: string;
  deployed_commit?: string | null;
  source_paths?: readonly string[];
}) {
  const workspaceRoot = path.resolve(input?.workspace_root ?? process.cwd());
  const sourceCommit = git(["rev-parse", "HEAD"], workspaceRoot);
  if (!SHA40.test(sourceCommit)) {
    throw new Error("formative_conversation_v11_source_commit_invalid");
  }
  const sourcePaths = input?.source_paths ?? DEFAULT_COMMITTED_SOURCE_PATHS;
  const files = packageFiles(workspaceRoot, sourcePaths);
  if (files.length === 0) {
    throw new Error("formative_conversation_v11_tracked_package_missing");
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
        `formative_conversation_v11_tracked_source_changed:${relativePath}`
      );
    }
    return { path: relativePath, sha256: sha256(current) };
  });
  const deployedCommit = input?.deployed_commit?.trim() || null;
  if (deployedCommit !== null && !SHA40.test(deployedCommit)) {
    throw new Error("formative_conversation_v11_deployed_commit_invalid");
  }
  const payload = {
    version: FORMATIVE_CONVERSATION_V11_RUN_PROVENANCE_VERSION,
    source_application_git_commit: sourceCommit,
    deployed_application_git_commit: deployedCommit,
    verified_files: verifiedFiles,
    tracked_package_unchanged: true as const,
    recorded_at: new Date().toISOString()
  };
  return {
    ...payload,
    provenance_hash: stableHash(payload)
  } satisfies FormativeConversationV11CommittedSourceVerification;
}

export function writeFormativeConversationV11RunScopedProvenance(input?: {
  workspace_root?: string;
  deployed_commit?: string | null;
  source_paths?: readonly string[];
}) {
  const workspaceRoot = path.resolve(input?.workspace_root ?? process.cwd());
  const provenance = verifyFormativeConversationV11CommittedSource(input);
  const provenanceRoot = path.resolve(
    workspaceRoot,
    FORMATIVE_CONVERSATION_V11_DATA_ROOT,
    "provenance"
  );
  mkdirSync(provenanceRoot, { recursive: true, mode: 0o700 });
  chmodSync(provenanceRoot, 0o700);
  const outputPath = path.join(
    provenanceRoot,
    `v11-source-${Date.now()}-${randomUUID().slice(0, 8)}.json`
  );
  writeFileSync(outputPath, `${JSON.stringify(provenance, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600
  });
  return {
    provenance,
    artifact_path: outputPath,
    artifact_sha256: sha256(readFileSync(outputPath))
  };
}
