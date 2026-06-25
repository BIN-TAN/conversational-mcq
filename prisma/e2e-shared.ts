import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { execFileSync, spawn, spawnSync, type ChildProcess } from "node:child_process";
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

export const E2E_PORT = 3100;
export const E2E_HOST = "127.0.0.1";
export const E2E_BASE_URL =
  process.env.E2E_BASE_URL?.trim() || `http://${E2E_HOST}:${E2E_PORT}`;
export const E2E_DATABASE_SUFFIX = "_e2e";
export const E2E_REPORT_ROOT = path.join(process.cwd(), ".data", "e2e");
export const E2E_SESSION_SECRET =
  "phase8b-synthetic-e2e-session-secret-never-use-in-production";

export type JsonRecord = Record<string, unknown>;

export function timestampRunId() {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "");
  return `e2e_${stamp}_${randomUUID().slice(0, 8)}`;
}

export function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

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

export function defaultDatabaseUrl() {
  return (
    process.env.DATABASE_URL ||
    "postgresql://conversational_mcq:conversational_mcq_dev_password@localhost:5432/conversational_mcq?schema=public"
  );
}

export function e2eDatabaseUrl() {
  if (process.env.E2E_DATABASE_URL?.trim()) {
    assertE2eDatabaseUrl(process.env.E2E_DATABASE_URL);
    return process.env.E2E_DATABASE_URL;
  }

  const url = new URL(defaultDatabaseUrl());
  const currentName = decodeURIComponent(url.pathname.replace(/^\//, ""));
  const nextName = currentName.endsWith(E2E_DATABASE_SUFFIX)
    ? currentName
    : `${currentName}${E2E_DATABASE_SUFFIX}`;
  url.pathname = `/${nextName}`;
  const value = url.toString();
  assertE2eDatabaseUrl(value);
  return value;
}

export function databaseName(databaseUrl = e2eDatabaseUrl()) {
  return decodeURIComponent(new URL(databaseUrl).pathname.replace(/^\//, ""));
}

export function databaseUser(databaseUrl = e2eDatabaseUrl()) {
  return decodeURIComponent(new URL(databaseUrl).username || "conversational_mcq");
}

export function assertE2eDatabaseUrl(databaseUrl: string) {
  const name = decodeURIComponent(new URL(databaseUrl).pathname.replace(/^\//, ""));

  if (!name.endsWith(E2E_DATABASE_SUFFIX)) {
    throw new Error(
      `Refusing E2E database operation because database '${name}' does not end with '${E2E_DATABASE_SUFFIX}'.`
    );
  }
}

export function redactedDatabaseUrl(databaseUrl = e2eDatabaseUrl()) {
  const url = new URL(databaseUrl);
  if (url.password) {
    url.password = "REDACTED";
  }
  return url.toString();
}

export function baseE2eEnv(overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  const databaseUrl = e2eDatabaseUrl();

  const env = {
    ...process.env,
    NODE_ENV: "production",
    DATABASE_URL: databaseUrl,
    SESSION_SECRET: process.env.SESSION_SECRET || E2E_SESSION_SECRET,
    COURSE_TIMEZONE: "America/Edmonton",
    LLM_PROVIDER: "mock",
    LLM_LIVE_CALLS_ENABLED: "false",
    OPERATIONAL_AGENT_MODE: "mock",
    OPERATIONAL_AGENT_INTEGRATION_EVAL_EVIDENCE_REQUIRED: "false",
    OPERATIONAL_APPROVED_CONFIG_HASH:
      process.env.OPERATIONAL_APPROVED_CONFIG_HASH ||
      "58219c34888076486db21c723a99ac4f4dfa5c29ce78dd162cadbc0566ce9ea2",
    OPERATIONAL_EFFECTIVE_RESULT_VERSION: "effective-system-eval-v2",
    OPERATIONAL_EFFECTIVE_VALIDATOR_VERSION: "effective-validator-v1",
    ALLOW_MOCK_RESPONSE_COLLECTION_IN_STUDENT_WORKFLOW: "true",
    LLM_DAILY_STUDENT_CALL_LIMIT: "200",
    LLM_DAILY_STUDENT_TOKEN_LIMIT: "500000",
    LLM_DAILY_CLASS_CALL_LIMIT: "5000",
    LLM_DAILY_CLASS_TOKEN_LIMIT: "5000000",
    LLM_SESSION_CALL_LIMIT: "200",
    LLM_SESSION_TOKEN_LIMIT: "1000000",
    LLM_AGENT_CALL_LIMIT_PER_SESSION: "100",
    LLM_USAGE_TIMEZONE: "America/Edmonton",
    WORKFLOW_JOB_POLL_INTERVAL_MS: "250",
    WORKFLOW_JOB_BASE_RETRY_MS: "250",
    WORKFLOW_JOB_MAX_RETRY_MS: "1000",
    E2E_FORBID_EXTERNAL_PROVIDER_CALLS: "true",
    NEXT_TELEMETRY_DISABLED: "1",
    PORT: String(E2E_PORT),
    HOSTNAME: E2E_HOST,
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
  const result = spawnSync(command, args, {
    cwd: input.cwd ?? process.cwd(),
    env: input.env ?? process.env,
    encoding: "utf8",
    input: undefined,
    stdio: input.stdio ?? "pipe",
    timeout: input.timeoutMs
  });

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

export async function backupE2eDatabaseIfPresent(label = "backup") {
  const dbName = databaseName();
  assertE2eDatabaseUrl(e2eDatabaseUrl());

  if (!(await databaseExists(dbName))) {
    return null;
  }

  const backupDir = path.join(process.cwd(), ".data", "e2e-backups");
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

export async function createE2eDatabaseIfMissing() {
  const dbName = databaseName();
  assertE2eDatabaseUrl(e2eDatabaseUrl());

  if (await databaseExists(dbName)) {
    return false;
  }

  dockerPsql(`CREATE DATABASE "${dbName.replace(/"/g, "\"\"")}"`, "postgres");
  return true;
}

export async function dropE2eDatabaseIfPresent() {
  const dbName = databaseName();
  assertE2eDatabaseUrl(e2eDatabaseUrl());

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
    env: baseE2eEnv({ NODE_ENV: "development" }),
    stdio: "inherit"
  });
}

export async function writeJson(filePath: string, value: unknown) {
  await ensureDir(path.dirname(filePath));
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

export async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, "utf8")) as T;
}

export async function removePath(targetPath: string) {
  await rm(targetPath, { recursive: true, force: true });
}

export function spawnLogged(
  command: string,
  args: string[],
  logFile: string,
  env: NodeJS.ProcessEnv
): ChildProcess {
  const child = spawn(command, args, {
    cwd: process.cwd(),
    env,
    stdio: ["ignore", "pipe", "pipe"]
  }) as ChildProcess;
  void ensureDir(path.dirname(logFile));
  const chunks: Buffer[] = [];
  child.stdout?.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
  child.stderr?.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
  child.on("exit", () => {
    void writeFile(logFile, Buffer.concat(chunks));
  });
  return child;
}

export async function stopChild(child: ChildProcess | null) {
  if (!child || child.exitCode !== null || child.signalCode) {
    return;
  }

  child.kill("SIGTERM");
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      if (child.exitCode === null) {
        child.kill("SIGKILL");
      }
      resolve();
    }, 3000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

export async function waitForHealth(baseUrl = E2E_BASE_URL, timeoutMs = 60_000) {
  const start = Date.now();
  let lastError: unknown = null;

  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(`${baseUrl}/api/health`, { cache: "no-store" });
      if (response.ok) {
        return;
      }
      lastError = new Error(`health status ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(`Timed out waiting for /api/health: ${lastError instanceof Error ? lastError.message : "unknown"}`);
}
