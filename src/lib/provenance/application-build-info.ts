import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

export const APPLICATION_BUILD_INFO_RESOLVER_VERSION = "application-build-provenance-v1";
export const APPLICATION_BUILD_INFO_ARTIFACT_PATH = path.join(
  process.cwd(),
  "build",
  "application-build-info.json"
);

export type ApplicationBuildInfoSource =
  | "build_artifact"
  | "deployment_build_metadata"
  | "git_fallback";

export type ApplicationBuildInfo = {
  application_git_commit: string;
  application_git_commit_source: ApplicationBuildInfoSource;
  application_build_timestamp: string | null;
  resolver_version: typeof APPLICATION_BUILD_INFO_RESOLVER_VERSION;
};

export type ApplicationBuildInfoFailureCode =
  | "application_git_commit_unavailable"
  | "application_git_commit_malformed"
  | "application_build_provenance_conflict";

export type ApplicationBuildInfoCandidate = {
  source: ApplicationBuildInfoSource;
  commit: string | null;
  build_timestamp: string | null;
  present: boolean;
  valid: boolean;
  error: ApplicationBuildInfoFailureCode | null;
};

export type ApplicationBuildInfoResolution =
  | {
      ok: true;
      info: ApplicationBuildInfo;
      candidates: ApplicationBuildInfoCandidate[];
    }
  | {
      ok: false;
      code: ApplicationBuildInfoFailureCode;
      message: string;
      candidates: ApplicationBuildInfoCandidate[];
    };

export type ApplicationBuildInfoResolverOptions = {
  cwd?: string;
  env?: Partial<NodeJS.ProcessEnv>;
  artifactPath?: string;
  allowGitFallback?: boolean;
};

const COMMIT_PATTERN = /^[a-f0-9]{40}$/u;
const PLACEHOLDER_PATTERN = /^(unknown|null|undefined|none|missing|development)$/iu;

function normalizeCommit(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || PLACEHOLDER_PATTERN.test(trimmed)) return null;
  const lower = trimmed.toLowerCase();
  return COMMIT_PATTERN.test(lower) ? lower : null;
}

function commitPresent(value: unknown) {
  return typeof value === "string" && value.trim().length > 0;
}

function timestampValue(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function readArtifactCandidate(filePath: string): ApplicationBuildInfoCandidate {
  if (!existsSync(filePath)) {
    return {
      source: "build_artifact",
      commit: null,
      build_timestamp: null,
      present: false,
      valid: false,
      error: null
    };
  }
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8")) as {
      application_git_commit?: unknown;
      build_commit_sha?: unknown;
      application_build_timestamp?: unknown;
      build_timestamp?: unknown;
    };
    const rawCommit = parsed.application_git_commit ?? parsed.build_commit_sha;
    const commit = normalizeCommit(rawCommit);
    return {
      source: "build_artifact",
      commit,
      build_timestamp: timestampValue(parsed.application_build_timestamp ?? parsed.build_timestamp),
      present: true,
      valid: Boolean(commit),
      error: commit ? null : "application_git_commit_malformed"
    };
  } catch {
    return {
      source: "build_artifact",
      commit: null,
      build_timestamp: null,
      present: true,
      valid: false,
      error: "application_git_commit_malformed"
    };
  }
}

function deploymentMetadataCandidate(env: Partial<NodeJS.ProcessEnv>): ApplicationBuildInfoCandidate {
  const rawCommit =
    env.APPLICATION_GIT_COMMIT ??
    env.APP_BUILD_COMMIT_SHA ??
    env.BUILD_COMMIT_SHA ??
    env.SOURCE_VERSION ??
    env.VERCEL_GIT_COMMIT_SHA ??
    env.RENDER_GIT_COMMIT;
  const commit = normalizeCommit(rawCommit);
  const present = commitPresent(rawCommit);
  return {
    source: "deployment_build_metadata",
    commit,
    build_timestamp:
      timestampValue(env.APPLICATION_BUILD_TIMESTAMP) ??
      timestampValue(env.BUILD_TIMESTAMP) ??
      timestampValue(env.RENDER_BUILD_TIMESTAMP) ??
      null,
    present,
    valid: Boolean(commit),
    error: present && !commit ? "application_git_commit_malformed" : null
  };
}

function gitFallbackCandidate(cwd: string): ApplicationBuildInfoCandidate {
  try {
    const raw = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    });
    const commit = normalizeCommit(raw);
    return {
      source: "git_fallback",
      commit,
      build_timestamp: null,
      present: true,
      valid: Boolean(commit),
      error: commit ? null : "application_git_commit_malformed"
    };
  } catch {
    return {
      source: "git_fallback",
      commit: null,
      build_timestamp: null,
      present: false,
      valid: false,
      error: null
    };
  }
}

export function resolveApplicationBuildInfo(
  options: ApplicationBuildInfoResolverOptions = {}
): ApplicationBuildInfoResolution {
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  const candidates = [
    readArtifactCandidate(options.artifactPath ?? path.join(cwd, "build", "application-build-info.json")),
    deploymentMetadataCandidate(env),
    ...(options.allowGitFallback === false ? [] : [gitFallbackCandidate(cwd)])
  ];

  const malformed = candidates.find((candidate) => candidate.present && candidate.error);
  if (malformed) {
    return {
      ok: false,
      code: malformed.error ?? "application_git_commit_malformed",
      message: `${malformed.source} supplied a malformed application Git commit.`,
      candidates
    };
  }

  const valid = candidates.filter((candidate) => candidate.valid && candidate.commit);
  const distinctCommits = [...new Set(valid.map((candidate) => candidate.commit))];
  if (distinctCommits.length > 1) {
    return {
      ok: false,
      code: "application_build_provenance_conflict",
      message: "Available application build provenance sources disagree.",
      candidates
    };
  }
  if (valid.length === 0) {
    return {
      ok: false,
      code: "application_git_commit_unavailable",
      message: "No valid application Git commit is available from build artifact, deployment metadata, or local Git fallback.",
      candidates
    };
  }

  const priority = ["build_artifact", "deployment_build_metadata", "git_fallback"] as const;
  const selected = priority
    .map((source) => valid.find((candidate) => candidate.source === source))
    .find(Boolean);
  if (!selected?.commit) {
    return {
      ok: false,
      code: "application_git_commit_unavailable",
      message: "No valid application Git commit is available.",
      candidates
    };
  }

  return {
    ok: true,
    info: {
      application_git_commit: selected.commit,
      application_git_commit_source: selected.source,
      application_build_timestamp: selected.build_timestamp,
      resolver_version: APPLICATION_BUILD_INFO_RESOLVER_VERSION
    },
    candidates
  };
}

export function summarizeApplicationBuildInfoResolution(resolution: ApplicationBuildInfoResolution) {
  const candidateSummary = resolution.candidates.map((candidate) => ({
    source: candidate.source,
    present: candidate.present,
    valid: candidate.valid,
    commit_present: Boolean(candidate.commit),
    build_timestamp_present: Boolean(candidate.build_timestamp),
    error: candidate.error
  }));
  return resolution.ok
    ? {
        application_git_commit: resolution.info.application_git_commit,
        application_git_commit_source: resolution.info.application_git_commit_source,
        application_build_timestamp: resolution.info.application_build_timestamp,
        resolver_version: resolution.info.resolver_version,
        candidate_sources: candidateSummary
      }
    : {
        application_git_commit: null,
        application_git_commit_source: null,
        application_build_timestamp: null,
        resolver_version: APPLICATION_BUILD_INFO_RESOLVER_VERSION,
        error_code: resolution.code,
        error_message: resolution.message,
        candidate_sources: candidateSummary
      };
}

export function writeApplicationBuildInfoArtifact(
  options: ApplicationBuildInfoResolverOptions & { outputPath?: string } = {}
) {
  const cwd = options.cwd ?? process.cwd();
  const outputPath = options.outputPath ?? path.join(cwd, "build", "application-build-info.json");
  const resolution = resolveApplicationBuildInfo({
    ...options,
    cwd,
    artifactPath: path.join(cwd, "__nonexistent_prebuild_application_build_info.json")
  });
  if (!resolution.ok) {
    throw new Error(resolution.code);
  }
  const payload = {
    application_git_commit: resolution.info.application_git_commit,
    application_git_commit_source: resolution.info.application_git_commit_source,
    application_build_timestamp: resolution.info.application_build_timestamp ?? new Date().toISOString(),
    resolver_version: APPLICATION_BUILD_INFO_RESOLVER_VERSION,
    artifact_hash_algorithm: "sha256"
  };
  const artifactHash = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  mkdirSync(path.dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify({ ...payload, artifact_hash: artifactHash }, null, 2)}\n`, "utf8");
  return { ...payload, artifact_hash: artifactHash, output_path: outputPath };
}
