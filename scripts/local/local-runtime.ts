import { spawn, spawnSync, type SpawnSyncReturns } from "node:child_process";
import { existsSync, openSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));

export const PROJECT_ROOT = path.resolve(SCRIPT_DIR, "..", "..");
export const LOCAL_RUNTIME_DIR = path.join(PROJECT_ROOT, ".data", "local-runtime");
export const NEXT_DEV_LOG_PATH = path.join(LOCAL_RUNTIME_DIR, "next-dev.log");
export const NEXT_DEV_PID_PATH = path.join(LOCAL_RUNTIME_DIR, "next-dev.pid");
export const LOCAL_APP_URL = process.env.LOCAL_APP_URL || "http://localhost:3000";
export const LOCAL_HEALTH_URL = `${LOCAL_APP_URL}/api/health`;

type ReadinessReport = {
  ready?: boolean;
  runtime_source?: string;
  configured_mode?: string;
  provider?: string;
  live_calls_enabled?: boolean;
  auth_status?: string | null;
  auth_cache_status?: string | null;
  config_conflict_detected?: boolean;
  public_key_configured?: boolean;
  model_names?: Record<string, string | null | undefined>;
  local_mock_allowed?: boolean;
  reason_codes?: string[];
  warning_codes?: string[];
  live_call_permitted?: boolean;
};

type CommandResult = SpawnSyncReturns<string> & {
  stdout: string;
  stderr: string;
};

export type LocalReadinessResult =
  | {
      ok: true;
      report: ReadinessReport;
      stdout: string;
      stderr: string;
    }
  | {
      ok: false;
      report: ReadinessReport | null;
      stdout: string;
      stderr: string;
      error: string;
    };

export async function ensureRuntimeDir() {
  await mkdir(LOCAL_RUNTIME_DIR, { recursive: true });
}

export function commandExists(command: string) {
  const result = spawnSync(command, ["--version"], {
    cwd: PROJECT_ROOT,
    encoding: "utf8",
    stdio: "pipe"
  });
  return result.status === 0;
}

export function checkRequiredTools() {
  const tools = ["node", "npm", "docker"].map((tool) => ({
    tool,
    available: commandExists(tool)
  }));
  return {
    tools,
    allAvailable: tools.every((tool) => tool.available)
  };
}

export function runCommand(command: string, args: string[], timeoutMs = 120_000): CommandResult {
  return spawnSync(command, args, {
    cwd: PROJECT_ROOT,
    encoding: "utf8",
    stdio: "pipe",
    timeout: timeoutMs,
    env: {
      ...process.env,
      NEXT_TELEMETRY_DISABLED: "1"
    }
  }) as CommandResult;
}

export function startPostgres() {
  return runCommand("docker", ["compose", "up", "-d", "postgres"], 120_000);
}

export function getPostgresStatus() {
  const result = runCommand(
    "docker",
    ["inspect", "-f", "{{.State.Running}}", "conversational-mcq-postgres"],
    15_000
  );

  if (result.status !== 0) {
    return {
      available: commandExists("docker"),
      running: false,
      detail: "container_not_found_or_unavailable"
    };
  }

  return {
    available: true,
    running: result.stdout.trim() === "true",
    detail: result.stdout.trim() || "unknown"
  };
}

function parseLastJsonObject(stdout: string): ReadinessReport | null {
  const start = stdout.indexOf("{");
  const end = stdout.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    return null;
  }

  try {
    return JSON.parse(stdout.slice(start, end + 1)) as ReadinessReport;
  } catch {
    return null;
  }
}

export function runLlmReadiness(): LocalReadinessResult {
  const result = runCommand("npm", ["run", "--silent", "llm:readiness"], 120_000);
  const report = parseLastJsonObject(result.stdout);

  if (result.status !== 0) {
    return {
      ok: false,
      report,
      stdout: result.stdout,
      stderr: result.stderr,
      error: "llm_readiness_command_failed"
    };
  }

  if (!report) {
    return {
      ok: false,
      report,
      stdout: result.stdout,
      stderr: result.stderr,
      error: "llm_readiness_output_not_parseable"
    };
  }

  if (report.ready !== true || report.live_call_permitted !== true || report.runtime_source !== "live_llm") {
    return {
      ok: false,
      report,
      stdout: result.stdout,
      stderr: result.stderr,
      error: "llm_readiness_not_live_ready"
    };
  }

  return {
    ok: true,
    report,
    stdout: result.stdout,
    stderr: result.stderr
  };
}

export function summarizeReadiness(result: LocalReadinessResult) {
  return {
    ok: result.ok,
    error: result.ok ? null : result.error,
    ready: result.report?.ready ?? false,
    runtime_source: result.report?.runtime_source ?? null,
    configured_mode: result.report?.configured_mode ?? null,
    provider: result.report?.provider ?? null,
    live_calls_enabled: result.report?.live_calls_enabled ?? null,
    auth_status: result.report?.auth_status ?? null,
    auth_cache_status: result.report?.auth_cache_status ?? null,
    config_conflict_detected: result.report?.config_conflict_detected ?? null,
    public_key_configured: result.report?.public_key_configured ?? null,
    model_names: result.report?.model_names ?? null,
    local_mock_allowed: result.report?.local_mock_allowed ?? null,
    reason_codes: result.report?.reason_codes ?? [],
    warning_codes: result.report?.warning_codes ?? [],
    live_call_permitted: result.report?.live_call_permitted ?? false
  };
}

export async function readPidFile() {
  if (!existsSync(NEXT_DEV_PID_PATH)) {
    return null;
  }

  const raw = (await readFile(NEXT_DEV_PID_PATH, "utf8")).trim();
  const pid = Number(raw);
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

export function isProcessRunning(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function removePidFile() {
  if (existsSync(NEXT_DEV_PID_PATH)) {
    await rm(NEXT_DEV_PID_PATH, { force: true });
  }
}

export async function getNextDevPidStatus() {
  const pid = await readPidFile();
  return {
    pid,
    running: pid ? isProcessRunning(pid) : false,
    pid_file: NEXT_DEV_PID_PATH
  };
}

export async function isHttpReady(url = LOCAL_HEALTH_URL) {
  try {
    const response = await fetch(url, { method: "GET" });
    return response.ok;
  } catch {
    return false;
  }
}

export async function waitForHttpReady(timeoutMs = 60_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await isHttpReady()) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return false;
}

export async function startNextDevServer() {
  await ensureRuntimeDir();

  const logFd = openSync(NEXT_DEV_LOG_PATH, "a");
  const child = spawn("npm", ["run", "dev"], {
    cwd: PROJECT_ROOT,
    detached: true,
    stdio: ["ignore", logFd, logFd],
    env: {
      ...process.env,
      NEXT_TELEMETRY_DISABLED: "1"
    }
  });

  await writeFile(NEXT_DEV_PID_PATH, `${child.pid}\n`, "utf8");
  child.unref();

  return child.pid;
}

export async function stopNextDevServer() {
  const pid = await readPidFile();
  if (!pid) {
    await removePidFile();
    return {
      stopped: false,
      pid: null,
      reason: "pid_file_missing_or_invalid"
    };
  }

  if (!isProcessRunning(pid)) {
    await removePidFile();
    return {
      stopped: false,
      pid,
      reason: "stale_pid_removed"
    };
  }

  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    process.kill(pid, "SIGTERM");
  }

  for (let attempt = 0; attempt < 20; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    if (!isProcessRunning(pid)) {
      await removePidFile();
      return {
        stopped: true,
        pid,
        reason: "stopped"
      };
    }
  }

  return {
    stopped: false,
    pid,
    reason: "still_running_after_sigterm"
  };
}

export function openBrowser(url = LOCAL_APP_URL) {
  if (process.platform === "darwin") {
    return runCommand("open", [url], 15_000);
  }
  if (process.platform === "win32") {
    return runCommand("cmd", ["/c", "start", "", url], 15_000);
  }
  return runCommand("xdg-open", [url], 15_000);
}

export function safeFailureMessage(readiness: LocalReadinessResult) {
  const summary = summarizeReadiness(readiness);
  return [
    "LLM readiness failed. The assessment cannot run in live runtime.",
    "Run `npm run llm:readiness` for details.",
    `Safe summary: ${JSON.stringify(summary, null, 2)}`
  ].join("\n");
}
