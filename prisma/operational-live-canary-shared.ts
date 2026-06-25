import { createHash, randomUUID } from "node:crypto";
import { execFileSync, spawnSync, type SpawnSyncOptionsWithStringEncoding } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadEnvConfig } from "@next/env";
import {
  DEFAULT_OPERATIONAL_LIVE_CANARY_BASE_DATABASE_URL,
  OPERATIONAL_LIVE_CANARY_DATABASE_SUFFIX,
  OPERATIONAL_LIVE_CANARY_SMOKE_DATABASE_SUFFIX,
  assertOperationalLiveCanaryDatabaseUrl,
  databaseNameFromUrl,
  redactedOperationalLiveCanaryDatabaseUrl,
  resolveOperationalLiveCanaryDatabaseUrl
} from "../src/lib/services/operational-live-canary/database-url";

loadEnvConfig(process.cwd());

export const LIVE_CANARY_PORT = 3200;
export const LIVE_CANARY_HOST = "127.0.0.1";
export const LIVE_CANARY_BASE_URL =
  process.env.OPERATIONAL_LIVE_CANARY_BASE_URL?.trim() ||
  `http://${LIVE_CANARY_HOST}:${LIVE_CANARY_PORT}`;
export const LIVE_CANARY_DATABASE_SUFFIX = OPERATIONAL_LIVE_CANARY_DATABASE_SUFFIX;
export const LIVE_CANARY_SMOKE_DATABASE_SUFFIX = OPERATIONAL_LIVE_CANARY_SMOKE_DATABASE_SUFFIX;
export const LIVE_CANARY_REPORT_ROOT = path.join(process.cwd(), ".data", "operational-live-canary");
export const LIVE_CANARY_SESSION_SECRET =
  "phase8c-live-canary-session-secret-never-use-in-production";

export type JsonRecord = Record<string, unknown>;

export function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableJson(entry)).join(",")}]`;
  }

  return `{${Object.keys(value as JsonRecord)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson((value as JsonRecord)[key])}`)
    .join(",")}}`;
}

export function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function timestampCanaryRunId() {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "");
  return `olcr_${stamp}_${randomUUID().slice(0, 8)}`;
}

export function defaultDatabaseUrl() {
  return (
    process.env.DATABASE_URL ||
    DEFAULT_OPERATIONAL_LIVE_CANARY_BASE_DATABASE_URL
  );
}

export function liveCanaryDatabaseUrl() {
  if (process.env.OPERATIONAL_LIVE_CANARY_DATABASE_URL?.trim()) {
    assertLiveCanaryDatabaseUrl(process.env.OPERATIONAL_LIVE_CANARY_DATABASE_URL);
    return process.env.OPERATIONAL_LIVE_CANARY_DATABASE_URL;
  }

  return resolveOperationalLiveCanaryDatabaseUrl(defaultDatabaseUrl()).isolated_canary_database_url;
}

export function liveCanarySmokeDatabaseUrl() {
  const url = new URL(resolveOperationalLiveCanaryDatabaseUrl(defaultDatabaseUrl()).isolated_canary_database_url);
  const currentName = databaseNameFromUrl(url.toString());
  const baseName = currentName.endsWith(OPERATIONAL_LIVE_CANARY_DATABASE_SUFFIX)
    ? currentName.slice(0, -OPERATIONAL_LIVE_CANARY_DATABASE_SUFFIX.length)
    : currentName.replace(/_live_canary.*$/, "");
  url.pathname = `/${baseName}${OPERATIONAL_LIVE_CANARY_SMOKE_DATABASE_SUFFIX}`;
  return url.toString();
}

export function databaseName(databaseUrl = liveCanaryDatabaseUrl()) {
  return databaseNameFromUrl(databaseUrl);
}

export function databaseUser(databaseUrl = liveCanaryDatabaseUrl()) {
  return decodeURIComponent(new URL(databaseUrl).username || "conversational_mcq");
}

export function assertLiveCanaryDatabaseUrl(databaseUrl: string) {
  assertOperationalLiveCanaryDatabaseUrl(databaseUrl);
}

export function redactedDatabaseUrl(databaseUrl = liveCanaryDatabaseUrl()) {
  return redactedOperationalLiveCanaryDatabaseUrl(databaseUrl);
}

export function liveCanaryEnv(overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  const isolatedCanaryDatabaseUrl = liveCanaryDatabaseUrl();
  const env = {
    ...process.env,
    NODE_ENV: "production",
    DATABASE_URL: isolatedCanaryDatabaseUrl,
    OPERATIONAL_LIVE_CANARY_DATABASE_URL: isolatedCanaryDatabaseUrl,
    OPERATIONAL_LIVE_CANARY_DATABASE_URL_ACTIVE: "true",
    SESSION_SECRET: process.env.SESSION_SECRET || LIVE_CANARY_SESSION_SECRET,
    COURSE_TIMEZONE: "America/Edmonton",
    OPERATIONAL_AGENT_MODE: "guarded_live",
    OPERATIONAL_LIVE_CANARY_ENABLED: process.env.OPERATIONAL_LIVE_CANARY_ENABLED ?? "false",
    OPERATIONAL_LIVE_CANARY_TARGET_MODEL: "gpt-5.4-mini-2026-03-17",
    OPERATIONAL_LIVE_CANARY_REASONING_EFFORT: "low",
    OPERATIONAL_LIVE_CANARY_COST_HARD_LIMIT_USD: "15",
    OPERATIONAL_LIVE_CANARY_MAX_PROVIDER_REQUESTS: "80",
    OPERATIONAL_LIVE_CANARY_MAX_CONCURRENCY: "1",
    OPERATIONAL_LIVE_CANARY_MAX_RETRIES: "1",
    OPERATIONAL_LIVE_CANARY_REQUEST_TIMEOUT_MS: "60000",
    OPERATIONAL_LIVE_CANARY_APPROVED_CONFIG_HASH:
      process.env.OPERATIONAL_LIVE_CANARY_APPROVED_CONFIG_HASH || "",
    OPERATIONAL_APPROVED_CONFIG_HASH:
      process.env.OPERATIONAL_APPROVED_CONFIG_HASH ||
      "58219c34888076486db21c723a99ac4f4dfa5c29ce78dd162cadbc0566ce9ea2",
    OPERATIONAL_EFFECTIVE_RESULT_VERSION: "effective-system-eval-v2",
    OPERATIONAL_EFFECTIVE_VALIDATOR_VERSION: "effective-validator-v1",
    LLM_PROVIDER: process.env.LLM_PROVIDER || "mock",
    LLM_LIVE_CALLS_ENABLED: process.env.LLM_LIVE_CALLS_ENABLED || "false",
    NEXT_TELEMETRY_DISABLED: "1",
    PORT: String(LIVE_CANARY_PORT),
    HOSTNAME: LIVE_CANARY_HOST,
    ...overrides
  } as unknown as NodeJS.ProcessEnv;

  delete env.OPERATIONAL_AGENT_INTEGRATION_ENABLED;
  return env;
}

export async function ensureDir(dir: string) {
  await mkdir(dir, { recursive: true });
}

export function runCommand(
  command: string,
  args: string[],
  input: {
    env?: NodeJS.ProcessEnv;
    cwd?: string;
    stdio?: "inherit" | "pipe";
    timeoutMs?: number;
  } = {}
) {
  const options: SpawnSyncOptionsWithStringEncoding = {
    cwd: input.cwd ?? process.cwd(),
    env: input.env ?? process.env,
    encoding: "utf8",
    stdio: input.stdio ?? "pipe",
    timeout: input.timeoutMs
  };
  const result = spawnSync(command, args, options);

  if (result.status !== 0) {
    throw new Error(
      [
        `Command failed: ${command} ${args.join(" ")}`,
        result.stdout ? `stdout:\n${result.stdout}` : "",
        result.stderr ? `stderr:\n${result.stderr}` : ""
      ]
        .filter(Boolean)
        .join("\n")
    );
  }

  return { stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

export function dockerPostgres(command: string, args: string[], options: { input?: string } = {}) {
  const result = spawnSync("docker", ["compose", "exec", "-T", "postgres", command, ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    input: options.input
  });

  if (result.status !== 0) {
    throw new Error(
      [
        `Docker Postgres command failed: ${command} ${args.join(" ")}`,
        result.stdout ? `stdout:\n${result.stdout}` : "",
        result.stderr ? `stderr:\n${result.stderr}` : ""
      ]
        .filter(Boolean)
        .join("\n")
    );
  }

  return { stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

export function dockerPsql(sql: string, dbName = "postgres") {
  return dockerPostgres("psql", [
    "-U",
    databaseUser(),
    "-d",
    dbName,
    "-v",
    "ON_ERROR_STOP=1",
    "-Atc",
    sql
  ]);
}

export async function databaseExists(dbName = databaseName()) {
  const escaped = dbName.replace(/'/g, "''");
  const result = dockerPsql(`SELECT 1 FROM pg_database WHERE datname='${escaped}'`, "postgres");
  return result.stdout.trim() === "1";
}

export async function backupLiveCanaryDatabaseIfPresent(label = "backup") {
  const dbName = databaseName();
  assertLiveCanaryDatabaseUrl(liveCanaryDatabaseUrl());

  if (!(await databaseExists(dbName))) {
    return null;
  }

  const backupDir = path.join(process.cwd(), ".data", "operational-live-canary-backups");
  await ensureDir(backupDir);
  const backupPath = path.join(
    backupDir,
    `${dbName}-${label}-${new Date().toISOString().replace(/[:.]/g, "-")}.sql`
  );
  const dump = execFileSync(
    "docker",
    ["compose", "exec", "-T", "postgres", "pg_dump", "-U", databaseUser(), dbName],
    { cwd: process.cwd(), encoding: "utf8", maxBuffer: 1024 * 1024 * 256 }
  );
  await writeFile(backupPath, dump);
  return backupPath;
}

export async function createLiveCanaryDatabaseIfMissing() {
  const dbName = databaseName();
  assertLiveCanaryDatabaseUrl(liveCanaryDatabaseUrl());

  if (await databaseExists(dbName)) {
    return false;
  }

  dockerPsql(`CREATE DATABASE "${dbName.replace(/"/g, "\"\"")}"`, "postgres");
  return true;
}

export async function dropLiveCanaryDatabaseIfPresent() {
  const dbName = databaseName();
  assertLiveCanaryDatabaseUrl(liveCanaryDatabaseUrl());

  if (!(await databaseExists(dbName))) {
    return false;
  }

  const escapedName = dbName.replace(/'/g, "''");
  dockerPsql(
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='${escapedName}' AND pid <> pg_backend_pid();`,
    "postgres"
  );
  dockerPsql(`DROP DATABASE "${dbName.replace(/"/g, "\"\"")}"`, "postgres");
  return true;
}

export function migrateDeploy() {
  runCommand("npx", ["prisma", "migrate", "deploy"], {
    env: liveCanaryEnv({ NODE_ENV: "development" }),
    stdio: "inherit",
    timeoutMs: 120_000
  });
}

export async function cleanupLiveCanaryReports() {
  await rm(LIVE_CANARY_REPORT_ROOT, { recursive: true, force: true });
}
