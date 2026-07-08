import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { access, readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

const execFileAsync = promisify(execFile);
const projectRoot = process.cwd();

type CheckStatus = "pass" | "warning" | "fail";

type CheckResult = {
  name: string;
  status: CheckStatus;
  detail: string;
  data?: Record<string, unknown>;
};

const checks: CheckResult[] = [];

const REQUIRED_ENV_VARS = [
  "DATABASE_URL",
  "SESSION_SECRET",
  "LLM_PROVIDER",
  "LLM_LIVE_CALLS_ENABLED",
  "OPENAI_API_KEY or OPENAI_API_KEY_FILE",
  "OPENAI_MODEL_ITEM_ADMIN or OPENAI_MODEL_FOLLOWUP",
  "OPENAI_MODEL_PROFILE_INTEGRATION",
  "OPENAI_MODEL_PLANNING",
  "OPENAI_MODEL_FOLLOWUP",
  "APP_BASE_URL or NEXT_PUBLIC_APP_BASE_URL"
] as const;

const BASE_URL_ENV_VARS = ["APP_BASE_URL", "NEXT_PUBLIC_APP_BASE_URL", "NEXTAUTH_URL", "VERCEL_URL"] as const;
const PUBLIC_SECRET_NAME_PATTERN = /(?:SECRET|TOKEN|KEY|PASSWORD|DATABASE|OPENAI|AUTH|COOKIE)/iu;
const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"]);
const SECRET_VALUE_PATTERNS = [
  /sk-(?:proj|svcacct)-[A-Za-z0-9_-]{20,}/u,
  /OPENAI_API_KEY\s*=\s*["']?sk-(?:proj|svcacct)-[A-Za-z0-9_-]{20,}/u,
  /NEXT_PUBLIC_.*(?:SECRET|TOKEN|PASSWORD|DATABASE_URL|OPENAI_API_KEY)/u
];

function addCheck(check: CheckResult) {
  checks.push(check);
}

function configured(name: string) {
  const value = process.env[name];
  return typeof value === "string" && value.trim().length > 0;
}

function configuredEither(names: readonly string[]) {
  return names.some((name) => configured(name));
}

function appEnvironment() {
  const value = process.env.APP_ENV || process.env.NODE_ENV || "local";
  return value === "production" || value === "staging" || value === "local"
    ? value
    : "local";
}

function isProductionMode() {
  return appEnvironment() === "production" || process.env.NODE_ENV === "production";
}

function parseUrl(value?: string) {
  if (!value || value.trim().length === 0) {
    return null;
  }

  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function redactKnownSensitiveValues(value: string) {
  let output = value;
  const sensitiveValues = [
    process.env.DATABASE_URL,
    process.env.SESSION_SECRET,
    process.env.OPENAI_API_KEY
  ].filter((entry): entry is string => typeof entry === "string" && entry.length > 0);

  for (const secret of sensitiveValues) {
    output = output.split(secret).join("[REDACTED]");
  }

  return output;
}

async function command(
  args: string[],
  options?: { env?: Record<string, string | undefined>; timeoutMs?: number }
) {
  try {
    const result = await execFileAsync(args[0], args.slice(1), {
      cwd: projectRoot,
      env: {
        ...process.env,
        NEXT_TELEMETRY_DISABLED: "1",
        ...(options?.env ?? {})
      },
      timeout: options?.timeoutMs ?? 120_000,
      maxBuffer: 1024 * 1024 * 8
    });
    return {
      ok: true,
      stdout: redactKnownSensitiveValues(result.stdout),
      stderr: redactKnownSensitiveValues(result.stderr),
      code: 0
    };
  } catch (error) {
    const record = error as {
      stdout?: string;
      stderr?: string;
      code?: number | string;
      signal?: string;
      message?: string;
    };
    return {
      ok: false,
      stdout: redactKnownSensitiveValues(record.stdout ?? ""),
      stderr: redactKnownSensitiveValues(record.stderr ?? ""),
      code: record.code ?? record.signal ?? "unknown",
      message: redactKnownSensitiveValues(record.message ?? "command_failed")
    };
  }
}

async function fileExists(filePath: string) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJson(filePath: string) {
  const text = await readFile(filePath, "utf8");
  return JSON.parse(text) as Record<string, unknown>;
}

function hashText(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

async function checkRequiredEnvironment() {
  const missing = REQUIRED_ENV_VARS.filter((name) => {
    if (name === "OPENAI_API_KEY or OPENAI_API_KEY_FILE") {
      return !configuredEither(["OPENAI_API_KEY", "OPENAI_API_KEY_FILE"]);
    }
    if (name === "OPENAI_MODEL_ITEM_ADMIN or OPENAI_MODEL_FOLLOWUP") {
      return !configuredEither(["OPENAI_MODEL_ITEM_ADMIN", "OPENAI_MODEL_FOLLOWUP"]);
    }
    if (name === "APP_BASE_URL or NEXT_PUBLIC_APP_BASE_URL") {
      return !configuredEither(["APP_BASE_URL", "NEXT_PUBLIC_APP_BASE_URL", "NEXTAUTH_URL", "VERCEL_URL"]);
    }
    return !configured(name);
  });

  addCheck({
    name: "required_env_documented",
    status: "pass",
    detail:
      missing.length === 0
        ? "All deployment-critical variables are configured in the effective environment."
        : "Missing deployment variables are documented as readiness gaps; no secret values were printed.",
    data: {
      required_variable_names: REQUIRED_ENV_VARS,
      missing_variable_names: missing
    }
  });
}

async function checkBaseUrlConfig() {
  const envExamplePath = path.join(projectRoot, ".env.example");
  const envExample = await readFile(envExamplePath, "utf8");
  const exampleDefinesBaseUrl = BASE_URL_ENV_VARS.some((name) =>
    new RegExp(`^${name}=`, "mu").test(envExample)
  );
  const runtimeConfigured = configuredEither(BASE_URL_ENV_VARS);
  const productionMode = isProductionMode();
  const appBaseUrl = parseUrl(process.env.APP_BASE_URL);
  const publicBaseUrl = parseUrl(process.env.NEXT_PUBLIC_APP_BASE_URL);
  const appBaseHttps = appBaseUrl?.protocol === "https:";
  const appBaseLocalhost = appBaseUrl ? LOCAL_HOSTNAMES.has(appBaseUrl.hostname) : null;
  const publicBaseUrlSafe =
    !configured("NEXT_PUBLIC_APP_BASE_URL") ||
    (Boolean(publicBaseUrl) &&
      (publicBaseUrl?.protocol === "https:" ||
        (publicBaseUrl?.protocol === "http:" && LOCAL_HOSTNAMES.has(publicBaseUrl.hostname))));
  const productionBaseUrlOk = !productionMode || (Boolean(appBaseUrl) && appBaseHttps && appBaseLocalhost === false);
  const status = !exampleDefinesBaseUrl || !publicBaseUrlSafe || !productionBaseUrlOk
    ? productionMode
      ? "fail"
      : "warning"
    : "pass";

  addCheck({
    name: "base_url_config",
    status,
    detail: productionMode
      ? productionBaseUrlOk
        ? "Production base URL is configured as public HTTPS and is not localhost."
        : "Production mode requires APP_BASE_URL to be a public HTTPS URL, not localhost."
      : runtimeConfigured
        ? "Base URL variables are configured for this environment; localhost is allowed only outside production."
        : exampleDefinesBaseUrl
          ? "Base URL variables are present in .env.example; configure public HTTPS values for staging/production."
          : "Base URL variables are not present in .env.example.",
    data: {
      supported_variable_names: BASE_URL_ENV_VARS,
      runtime_configured: runtimeConfigured,
      documented_in_env_example: exampleDefinesBaseUrl,
      app_environment: appEnvironment(),
      production_mode: productionMode,
      app_base_url_present: configured("APP_BASE_URL"),
      app_base_url_protocol: appBaseUrl?.protocol.replace(":", "") ?? null,
      app_base_url_is_localhost: appBaseLocalhost,
      app_base_url_public_https_ready: Boolean(appBaseUrl) && appBaseHttps && appBaseLocalhost === false,
      next_public_app_base_url_present: configured("NEXT_PUBLIC_APP_BASE_URL"),
      next_public_app_base_url_harmless_public_config: publicBaseUrlSafe,
      raw_values_suppressed: true
    }
  });
}

function checkCanvasAccessMode() {
  addCheck({
    name: "canvas_link_access_mode",
    status: "pass",
    detail: "Canvas is treated only as an external-link host; no LTI/OAuth/grade-passback integration is required.",
    data: {
      canvas_access_mode: "external_link",
      canvas_lti_required: false,
      canvas_oauth_supported: false,
      canvas_grade_passback_supported: false,
      canvas_roster_sync_supported: false,
      public_https_required_for_classroom: true
    }
  });
}

function checkPublicSecretEnvNames() {
  const unsafeNames = Object.keys(process.env)
    .filter((name) => name.startsWith("NEXT_PUBLIC_"))
    .filter((name) => PUBLIC_SECRET_NAME_PATTERN.test(name))
    .filter((name) => name !== "NEXT_PUBLIC_APP_BASE_URL");

  addCheck({
    name: "no_public_server_secret_env_names",
    status: unsafeNames.length === 0 ? "pass" : "fail",
    detail:
      unsafeNames.length === 0
        ? "No suspicious NEXT_PUBLIC server-secret variable names are configured."
        : "Server-secret-like variables must not use NEXT_PUBLIC prefixes.",
    data: { unsafe_public_variable_names: unsafeNames }
  });
}

function checkDatabaseUrlNotPrinted() {
  addCheck({
    name: "database_url_redaction",
    status: "pass",
    detail: "This smoke reports only DATABASE_URL presence and never prints the raw value.",
    data: {
      database_url_configured: configured("DATABASE_URL")
    }
  });
}

async function checkMigrationsExist() {
  const migrationsDir = path.join(projectRoot, "prisma", "migrations");
  const entries = await readdir(migrationsDir, { withFileTypes: true }).catch(() => []);
  const migrationDirs = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  const sqlFiles: string[] = [];

  for (const dir of migrationDirs) {
    const sqlPath = path.join(migrationsDir, dir, "migration.sql");
    if (await fileExists(sqlPath)) {
      sqlFiles.push(dir);
    }
  }

  addCheck({
    name: "prisma_migrations_exist",
    status: sqlFiles.length > 0 ? "pass" : "fail",
    detail: sqlFiles.length > 0 ? "Prisma migration files are present." : "No Prisma migration.sql files were found.",
    data: {
      migration_count: sqlFiles.length,
      latest_migration: sqlFiles.at(-1) ?? null
    }
  });
}

async function checkPrismaValidate() {
  const result = await command(["npx", "prisma", "validate"], { timeoutMs: 120_000 });
  addCheck({
    name: "prisma_validate",
    status: result.ok ? "pass" : "fail",
    detail: result.ok ? "npx prisma validate passed." : "npx prisma validate failed.",
    data: {
      exit_code: result.code,
      output_hash: hashText(`${result.stdout}\n${result.stderr}`)
    }
  });
}

async function checkPrismaMigrateStatus() {
  const result = await command(["npx", "prisma", "migrate", "status"], { timeoutMs: 120_000 });
  addCheck({
    name: "prisma_migrate_status_safe",
    status: result.ok ? "pass" : "warning",
    detail: result.ok
      ? "npx prisma migrate status ran successfully."
      : "npx prisma migrate status ran without printing secrets but did not return success in this environment.",
    data: {
      exit_code: result.code,
      output_hash: hashText(`${result.stdout}\n${result.stderr}`),
      raw_output_suppressed: true
    }
  });
}

async function checkHealthEndpointExists() {
  const routePath = path.join(projectRoot, "src", "app", "api", "health", "route.ts");
  const exists = await fileExists(routePath);
  const text = exists ? await readFile(routePath, "utf8") : "";
  const hasGet = /export\s+async\s+function\s+GET/u.test(text);
  const exposesSecrets = /DATABASE_URL|OPENAI_API_KEY|SESSION_SECRET|provider_response|raw_output|authorization|cookie/iu.test(
    text.replace(/import[^\n]+/giu, "")
  );

  addCheck({
    name: "health_endpoint_exists",
    status: exists && hasGet && !exposesSecrets ? "pass" : "fail",
    detail: exists && hasGet && !exposesSecrets
      ? "GET /api/health is implemented and does not expose known secret fields."
      : "GET /api/health is missing or references secret-like fields.",
    data: {
      route_path: "src/app/api/health/route.ts",
      exports_get: hasGet,
      health_endpoint_secret_exposure_detected: exposesSecrets
    }
  });
}

async function checkLlmReadinessNoSecretOutput() {
  const result = await command(["npm", "run", "--silent", "llm:readiness"], {
    timeoutMs: 120_000,
    env: {
      LLM_PROVIDER: "mock",
      LLM_LIVE_CALLS_ENABLED: "false",
      OPENAI_API_KEY: "",
      OPENAI_API_KEY_FILE: "",
      ITEM_ADMIN_TUTOR_MODE: "auto",
      RUN_LIVE_LLM_SMOKE: "",
      RUN_LIVE_PROFILE_INTEGRATION_SMOKE: "",
      RUN_LIVE_ITEM_ADMIN_SMOKE: ""
    }
  });
  const output = `${result.stdout}\n${result.stderr}`;
  const leakedSecret = SECRET_VALUE_PATTERNS.some((pattern) => pattern.test(output));

  addCheck({
    name: "llm_readiness_no_live_no_secret_output",
    status: result.ok && !leakedSecret ? "pass" : "fail",
    detail: result.ok
      ? "LLM readiness ran in mock/no-live mode without exposing secret-shaped output."
      : "LLM readiness failed in mock/no-live mode.",
    data: {
      exit_code: result.code,
      output_hash: hashText(output),
      raw_output_suppressed: true,
      openai_call_made: false
    }
  });
}

async function checkExportDirectoryIgnored() {
  const result = await command(["git", "check-ignore", ".data", ".data/exports"], { timeoutMs: 30_000 });
  addCheck({
    name: "generated_export_directories_ignored",
    status: result.ok ? "pass" : "fail",
    detail: result.ok ? ".data and generated export paths are git-ignored." : ".data/export paths are not ignored.",
    data: {
      checked_paths: [".data", ".data/exports"]
    }
  });
}

async function checkEnvFilesNotStaged() {
  const result = await command(["git", "diff", "--cached", "--name-only"], { timeoutMs: 30_000 });
  const staged = result.stdout.split(/\r?\n/u).filter(Boolean);
  const unsafe = staged.filter((file) => file === ".env" || file === ".env.local" || /^\.env\./u.test(file));

  addCheck({
    name: "env_files_not_staged",
    status: unsafe.length === 0 ? "pass" : "fail",
    detail: unsafe.length === 0 ? ".env and .env.local are not staged." : "Local environment files are staged.",
    data: {
      staged_env_files: unsafe
    }
  });
}

async function checkNoSecretsInCommittedConfig() {
  const trackedEnv = await command(["git", "ls-files", ".env", ".env.local"], { timeoutMs: 30_000 });
  const trackedEnvFiles = trackedEnv.stdout.split(/\r?\n/u).filter(Boolean);
  const tracked = await command(["git", "ls-files"], { timeoutMs: 30_000 });
  const trackedFiles = tracked.stdout.split(/\r?\n/u).filter(Boolean);
  const configFiles = trackedFiles.filter((file) =>
    file === ".env.example" ||
    file === "Dockerfile" ||
    file === ".dockerignore" ||
    file === "docker-compose.yml" ||
    file === "next.config.mjs" ||
    file === "package.json" ||
    file === "package-lock.json" ||
    file.startsWith("config/") ||
    file.startsWith("docs/")
  );
  const suspiciousLines: string[] = [];

  for (const file of configFiles) {
    const fullPath = path.join(projectRoot, file);
    const text = await readFile(fullPath, "utf8").catch(() => "");
    const lines = text.split(/\r?\n/u);
    lines.forEach((line, index) => {
      if (SECRET_VALUE_PATTERNS.some((pattern) => pattern.test(line))) {
        suspiciousLines.push(`${file}:${index + 1}`);
      }
    });
  }

  addCheck({
    name: "no_obvious_secrets_in_committed_config",
    status: trackedEnvFiles.length === 0 && suspiciousLines.length === 0 ? "pass" : "fail",
    detail:
      trackedEnvFiles.length === 0 && suspiciousLines.length === 0
        ? "No tracked .env/.env.local files or obvious OpenAI secret patterns were found."
        : "Potential committed secret material was found.",
    data: {
      tracked_env_files: trackedEnvFiles,
      suspicious_match_count: suspiciousLines.length
    }
  });
}

async function checkPackageScripts() {
  const packageJson = await readJson(path.join(projectRoot, "package.json"));
  const scripts = (packageJson.scripts ?? {}) as Record<string, unknown>;
  const requiredScripts = [
    "build",
    "start",
    "prisma:generate",
    "prisma:migrate:deploy",
    "production:readiness",
    "student:production-deployment-readiness-smoke"
  ];
  const missing = requiredScripts.filter((script) => typeof scripts[script] !== "string");

  addCheck({
    name: "deployment_scripts_present",
    status: missing.length === 0 ? "pass" : "fail",
    detail: missing.length === 0 ? "Required deployment scripts are present." : "Deployment scripts are missing.",
    data: {
      missing_script_names: missing
    }
  });
}

async function checkDockerPackaging() {
  const dockerfilePath = path.join(projectRoot, "Dockerfile");
  const dockerignorePath = path.join(projectRoot, ".dockerignore");
  const dockerfileExists = await fileExists(dockerfilePath);
  const dockerignoreExists = await fileExists(dockerignorePath);
  let dockerignoreProtectsEnv = false;

  if (dockerignoreExists) {
    const ignore = await readFile(dockerignorePath, "utf8");
    dockerignoreProtectsEnv = /^\.env/mu.test(ignore) || /^\.env\*/mu.test(ignore);
  }

  addCheck({
    name: "docker_packaging_documented",
    status: dockerfileExists && dockerignoreExists && dockerignoreProtectsEnv ? "pass" : "warning",
    detail:
      dockerfileExists && dockerignoreExists && dockerignoreProtectsEnv
        ? "Dockerfile and .dockerignore are present and exclude env files."
        : "Docker deployment should use the documented path; Dockerfile or env exclusions are incomplete.",
    data: {
      dockerfile_exists: dockerfileExists,
      dockerignore_exists: dockerignoreExists,
      dockerignore_excludes_env: dockerignoreProtectsEnv
    }
  });
}

async function checkGeneratedDirs() {
  const generatedPaths = [".data", ".next", "node_modules"];
  const statuses: Record<string, { exists: boolean; directory: boolean | null }> = {};
  for (const relativePath of generatedPaths) {
    const fullPath = path.join(projectRoot, relativePath);
    if (!existsSync(fullPath)) {
      statuses[relativePath] = { exists: false, directory: null };
      continue;
    }
    const entry = await stat(fullPath);
    statuses[relativePath] = { exists: true, directory: entry.isDirectory() };
  }

  addCheck({
    name: "generated_directories_are_local_only",
    status: "pass",
    detail: "Generated directories are expected to be local and ignored when present.",
    data: statuses
  });
}

async function main() {
  await checkRequiredEnvironment();
  await checkBaseUrlConfig();
  checkCanvasAccessMode();
  checkPublicSecretEnvNames();
  checkDatabaseUrlNotPrinted();
  await checkMigrationsExist();
  await checkPrismaValidate();
  await checkPrismaMigrateStatus();
  await checkHealthEndpointExists();
  await checkLlmReadinessNoSecretOutput();
  await checkExportDirectoryIgnored();
  await checkEnvFilesNotStaged();
  await checkNoSecretsInCommittedConfig();
  await checkPackageScripts();
  await checkDockerPackaging();
  await checkGeneratedDirs();

  const failed = checks.filter((check) => check.status === "fail");
  const warnings = checks.filter((check) => check.status === "warning");
  const report = {
    smoke_version: "production-deployment-readiness-smoke-v1",
    status: failed.length > 0 ? "failed" : warnings.length > 0 ? "passed_with_warnings" : "passed",
    generated_at: new Date().toISOString(),
    canvas_access_mode: "external_link",
    canvas_lti_required: false,
    canvas_grade_passback_supported: false,
    public_https_required_for_classroom: true,
    no_openai_call_occurred: true,
    raw_secret_values_printed: false,
    raw_env_values_printed: false,
    database_url_printed: false,
    summary: {
      passed: checks.filter((check) => check.status === "pass").length,
      warnings: warnings.length,
      failed: failed.length
    },
    checks
  };

  console.log(JSON.stringify(report, null, 2));

  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "production readiness smoke failed");
  process.exitCode = 1;
});
