import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";

export const EXPORT_SOURCE_IDENTITY_SCHEMA_VERSION = "export-source-identity-v1" as const;

export const EXPORT_SOURCE_COLUMNS = [
  "export_run_public_id",
  "export_generated_at",
  "export_schema_version",
  "app_environment",
  "app_commit_sha",
  "service_base_url",
  "database_instance_fingerprint",
  "export_scope",
  "selected_assessment_public_id",
  "selected_student_id",
  "selected_session_public_id"
] as const;

export type ExportSourceColumn = (typeof EXPORT_SOURCE_COLUMNS)[number];
export type ExportSourceIdentity = Record<ExportSourceColumn, string>;

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function appCommitSha() {
  const fromEnv =
    process.env.RENDER_GIT_COMMIT ||
    process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.GIT_COMMIT_SHA ||
    process.env.COMMIT_SHA;

  if (fromEnv?.trim()) {
    return fromEnv.trim();
  }

  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
  } catch {
    return "unknown";
  }
}

function safeServiceBaseUrl() {
  const configured =
    process.env.APP_BASE_URL ||
    process.env.NEXT_PUBLIC_APP_BASE_URL ||
    process.env.RENDER_EXTERNAL_URL;

  if (!configured?.trim()) {
    return "local_or_unconfigured";
  }

  try {
    const url = new URL(configured);
    return `${url.protocol}//${url.host}`;
  } catch {
    return "configured_url_unparseable";
  }
}

function databaseFingerprint() {
  const value = process.env.DATABASE_URL?.trim();
  return value ? sha256(value) : "database_url_missing";
}

function exportRunPublicId() {
  return `rex_${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}_${randomUUID().slice(0, 8)}`;
}

export function buildExportSourceIdentity(input: {
  export_schema_version: string;
  export_scope: string;
  selected_assessment_public_id?: string | null;
  selected_student_id?: string | null;
  selected_session_public_id?: string | null;
  generated_at?: Date;
}): ExportSourceIdentity {
  return {
    export_run_public_id: exportRunPublicId(),
    export_generated_at: (input.generated_at ?? new Date()).toISOString(),
    export_schema_version: input.export_schema_version,
    app_environment: process.env.APP_ENV || process.env.NODE_ENV || "unknown",
    app_commit_sha: appCommitSha(),
    service_base_url: safeServiceBaseUrl(),
    database_instance_fingerprint: databaseFingerprint(),
    export_scope: input.export_scope,
    selected_assessment_public_id: input.selected_assessment_public_id ?? "",
    selected_student_id: input.selected_student_id ?? "",
    selected_session_public_id: input.selected_session_public_id ?? ""
  };
}

export function sourceIdentityRow(identity: ExportSourceIdentity) {
  return Object.fromEntries(EXPORT_SOURCE_COLUMNS.map((column) => [column, identity[column]])) as ExportSourceIdentity;
}
