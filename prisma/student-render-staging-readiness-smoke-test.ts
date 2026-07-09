import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const projectRoot = process.cwd();

type CheckStatus = "pass" | "fail";

type CheckResult = {
  name: string;
  status: CheckStatus;
  detail: string;
  data?: Record<string, unknown>;
};

const checks: CheckResult[] = [];

const REQUIRED_RENDER_ENV_KEYS = [
  "APP_ENV",
  "APP_BASE_URL",
  "NEXT_PUBLIC_APP_BASE_URL",
  "DATABASE_URL",
  "SESSION_SECRET",
  "COURSE_TIMEZONE",
  "LLM_PROVIDER",
  "LLM_LIVE_CALLS_ENABLED",
  "OPENAI_API_KEY",
  "OPENAI_MODEL_ITEM_ADMIN",
  "OPENAI_MODEL_PROFILE_INTEGRATION",
  "OPENAI_MODEL_PLANNING",
  "OPENAI_MODEL_FOLLOWUP"
] as const;

const MANUAL_SECRET_KEYS = [
  "APP_BASE_URL",
  "NEXT_PUBLIC_APP_BASE_URL",
  "SESSION_SECRET",
  "LLM_LIVE_CALLS_ENABLED",
  "OPENAI_API_KEY",
  "OPENAI_MODEL_ITEM_ADMIN",
  "OPENAI_MODEL_PROFILE_INTEGRATION",
  "OPENAI_MODEL_PLANNING",
  "OPENAI_MODEL_FOLLOWUP"
] as const;

const SECRET_VALUE_PATTERNS = [
  /sk-(?:proj|svcacct)-[A-Za-z0-9_-]{12,}/u,
  /postgres(?:ql)?:\/\/[^\s"']+/iu,
  /(?:SESSION_SECRET|OPENAI_API_KEY)\s*[:=]\s*["'][^"']{8,}["']/iu,
  /(?:DATABASE_URL)\s*[:=]\s*["']?postgres/iu,
  /render_[A-Za-z0-9_-]{16,}/u
];

const CSS_BUILD_DEPENDENCIES = ["tailwindcss", "postcss", "autoprefixer"] as const;

type PackageMetadata = {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

function addCheck(check: CheckResult) {
  checks.push(check);
}

async function command(args: string[]) {
  try {
    const result = await execFileAsync(args[0], args.slice(1), {
      cwd: projectRoot,
      env: {
        ...process.env,
        NEXT_TELEMETRY_DISABLED: "1"
      },
      maxBuffer: 1024 * 1024,
      timeout: 30_000
    });
    return { ok: true, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    const record = error as { stdout?: string; stderr?: string; code?: number | string; message?: string };
    return {
      ok: false,
      stdout: record.stdout ?? "",
      stderr: record.stderr ?? "",
      code: record.code ?? "unknown",
      message: record.message ?? "command_failed"
    };
  }
}

function hasLine(text: string, pattern: RegExp) {
  return pattern.test(text);
}

function envVarBlock(renderYaml: string, key: string) {
  const lines = renderYaml.split(/\r?\n/u);
  const start = lines.findIndex((line) => new RegExp(`^\\s*-\\s*key:\\s*${key}\\s*$`, "u").test(line));
  if (start < 0) {
    return null;
  }

  const block = [lines[start]];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^\s*-\s*key:\s*/u.test(line) || /^\S/u.test(line)) {
      break;
    }
    block.push(line);
  }
  return block.join("\n");
}

function envKeyPresent(renderYaml: string, key: string) {
  return envVarBlock(renderYaml, key) !== null;
}

function blockUsesSyncFalse(renderYaml: string, key: string) {
  const block = envVarBlock(renderYaml, key);
  return Boolean(block && /^\s*sync:\s*false\s*$/mu.test(block));
}

function blockUsesFromDatabase(renderYaml: string, key: string) {
  const block = envVarBlock(renderYaml, key);
  return Boolean(block && /^\s*fromDatabase:\s*$/mu.test(block));
}

function blockHasValue(renderYaml: string, key: string) {
  const block = envVarBlock(renderYaml, key);
  return Boolean(block && /^\s*value:\s*/mu.test(block));
}

function getRenderBuildCommand(renderYaml: string) {
  const match = renderYaml.match(/^\s*buildCommand:\s*(.+)\s*$/mu);
  return match?.[1]?.trim() ?? "";
}

function buildCommandInstallsDevDependencies(buildCommand: string) {
  return /\bnpm\s+ci\b[^\n&|;]*(?:--include=dev|--production=false)\b/u.test(buildCommand);
}

async function checkCssBuildDependencies(renderYaml: string) {
  const packageJsonPath = path.join(projectRoot, "package.json");
  const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8")) as PackageMetadata;
  const dependencies = packageJson.dependencies ?? {};
  const devDependencies = packageJson.devDependencies ?? {};
  const missingPackageEntries = CSS_BUILD_DEPENDENCIES.filter((dependency) => !dependencies[dependency] && !devDependencies[dependency]);
  const packageLockPath = path.join(projectRoot, "package-lock.json");
  const packageLockExists = existsSync(packageLockPath);
  const packageLock = packageLockExists
    ? (JSON.parse(await readFile(packageLockPath, "utf8")) as { packages?: Record<string, unknown> })
    : null;
  const missingLockPackages = packageLock
    ? CSS_BUILD_DEPENDENCIES.filter(
        (dependency) => !Object.prototype.hasOwnProperty.call(packageLock.packages ?? {}, `node_modules/${dependency}`)
      )
    : [...CSS_BUILD_DEPENDENCIES];
  const cssDepsInProductionDependencies = CSS_BUILD_DEPENDENCIES.every((dependency) => Boolean(dependencies[dependency]));
  const buildCommand = getRenderBuildCommand(renderYaml);
  const installsDevDependencies = buildCommandInstallsDevDependencies(buildCommand);

  addCheck({
    name: "css_build_dependencies_available_on_render",
    status:
      missingPackageEntries.length === 0 &&
      packageLockExists &&
      missingLockPackages.length === 0 &&
      (cssDepsInProductionDependencies || installsDevDependencies)
        ? "pass"
        : "fail",
    detail:
      "Tailwind/PostCSS build dependencies must be installed during Render next build, either as production dependencies or through npm ci --include=dev.",
    data: {
      required_css_build_dependencies: CSS_BUILD_DEPENDENCIES,
      missing_package_json_entries: missingPackageEntries,
      package_lock_present: packageLockExists,
      missing_package_lock_entries: missingLockPackages,
      css_dependencies_in_production_dependencies: cssDepsInProductionDependencies,
      render_build_command_installs_dev_dependencies: installsDevDependencies
    }
  });
}

async function checkRenderBlueprint(renderYaml: string) {
  addCheck({
    name: "render_yaml_exists",
    status: "pass",
    detail: "render.yaml exists at the repository root."
  });

  addCheck({
    name: "render_web_service",
    status:
      hasLine(renderYaml, /^\s*-\s*type:\s*web\s*$/mu) &&
      hasLine(renderYaml, /^\s*runtime:\s*node\s*$/mu) &&
      hasLine(renderYaml, /^\s*startCommand:\s*npm run start\s*$/mu)
        ? "pass"
        : "fail",
    detail: "Blueprint must define a native Node Render Web Service with npm start."
  });

  addCheck({
    name: "render_postgres_database",
    status:
      hasLine(renderYaml, /^databases:\s*$/mu) &&
      hasLine(renderYaml, /^\s*-\s*name:\s*conversational-mcq-staging-db\s*$/mu) &&
      blockUsesFromDatabase(renderYaml, "DATABASE_URL")
        ? "pass"
        : "fail",
    detail: "Blueprint must define Render Postgres and wire DATABASE_URL from the database connection string."
  });

  const hasFreePlan = /^\s*plan:\s*free\s*$/imu.test(renderYaml);
  const hasPaidWebPlan = /^\s*plan:\s*(starter|standard|pro|pro plus|pro max|pro ultra)\s*$/imu.test(renderYaml);
  const hasPaidDatabasePlan = /^\s*plan:\s*basic-256mb\s*$/imu.test(renderYaml);
  addCheck({
    name: "non_free_render_resources",
    status: !hasFreePlan && hasPaidWebPlan && hasPaidDatabasePlan ? "pass" : "fail",
    detail: "Blueprint must not silently choose free Render resources for a classroom pilot.",
    data: {
      free_plan_present: hasFreePlan,
      paid_web_plan_present: hasPaidWebPlan,
      paid_database_plan_present: hasPaidDatabasePlan
    }
  });

  const missingEnvKeys = REQUIRED_RENDER_ENV_KEYS.filter((key) => !envKeyPresent(renderYaml, key));
  addCheck({
    name: "required_env_names_present",
    status: missingEnvKeys.length === 0 ? "pass" : "fail",
    detail: "Render blueprint includes all required staging environment variable names.",
    data: { missing_env_names: missingEnvKeys }
  });

  const manualKeysWithValues = MANUAL_SECRET_KEYS.filter((key) => blockHasValue(renderYaml, key));
  const manualKeysWithoutSyncFalse = MANUAL_SECRET_KEYS.filter((key) => !blockUsesSyncFalse(renderYaml, key));
  addCheck({
    name: "manual_secret_values_not_hardcoded",
    status: manualKeysWithValues.length === 0 && manualKeysWithoutSyncFalse.length === 0 ? "pass" : "fail",
    detail: "Secrets and deployment-specific values must be entered manually in Render with sync:false.",
    data: {
      keys_with_committed_values: manualKeysWithValues,
      keys_missing_sync_false: manualKeysWithoutSyncFalse
    }
  });

  addCheck({
    name: "database_url_not_hardcoded",
    status: blockUsesFromDatabase(renderYaml, "DATABASE_URL") && !blockHasValue(renderYaml, "DATABASE_URL") ? "pass" : "fail",
    detail: "DATABASE_URL is sourced from Render Postgres instead of being committed."
  });

  addCheck({
    name: "render_build_and_migration_commands",
    status:
      /buildCommand:\s*.*npm\s+ci\b.*npm run prisma:generate.*npm run build/u.test(renderYaml) &&
      /preDeployCommand:\s*.*prisma:migrate:deploy/u.test(renderYaml)
        ? "pass"
        : "fail",
    detail: "Build generates Prisma client and Next.js output; pre-deploy runs prisma migrate deploy."
  });

  await checkCssBuildDependencies(renderYaml);

  addCheck({
    name: "staging_base_url_required",
    status:
      envVarBlock(renderYaml, "APP_ENV")?.includes("value: staging") &&
      blockUsesSyncFalse(renderYaml, "APP_BASE_URL") &&
      blockUsesSyncFalse(renderYaml, "NEXT_PUBLIC_APP_BASE_URL")
        ? "pass"
        : "fail",
    detail: "APP_ENV is staging and public base URL values must be manually set to the Render HTTPS origin."
  });

  const obviousSecretHits = SECRET_VALUE_PATTERNS
    .map((pattern, index) => ({ index, matched: pattern.test(renderYaml) }))
    .filter((entry) => entry.matched)
    .map((entry) => `pattern_${entry.index}`);
  addCheck({
    name: "no_obvious_secrets_in_render_yaml",
    status: obviousSecretHits.length === 0 ? "pass" : "fail",
    detail: "render.yaml must not contain API keys, database URLs, session secrets, or Render tokens.",
    data: { matched_secret_pattern_labels: obviousSecretHits }
  });
}

async function checkGitAndIgnoredFiles() {
  const staged = await command(["git", "diff", "--cached", "--name-only"]);
  const stagedFiles = staged.stdout.split(/\r?\n/u).filter(Boolean);
  const forbiddenStaged = stagedFiles.filter((file) =>
    file === ".env" || file === ".env.local" || file.startsWith(".data/") || /credential|secret|export|review/i.test(file)
  );

  addCheck({
    name: "no_local_env_or_generated_files_staged",
    status: staged.ok && forbiddenStaged.length === 0 ? "pass" : "fail",
    detail: "Local env files, generated review/export artifacts, and secrets must not be staged.",
    data: { forbidden_staged_paths: forbiddenStaged }
  });
}

async function checkDockerPackagingIfPresent() {
  const dockerfilePath = path.join(projectRoot, "Dockerfile");
  const dockerignorePath = path.join(projectRoot, ".dockerignore");
  const dockerfilePresent = existsSync(dockerfilePath);
  const dockerignorePresent = existsSync(dockerignorePath);
  let dockerignore = "";
  if (dockerignorePresent) {
    dockerignore = await readFile(dockerignorePath, "utf8");
  }

  const dockerignoreSafe =
    dockerignorePresent &&
    /^\.env$/mu.test(dockerignore) &&
    /^\.env\.\*$/mu.test(dockerignore) &&
    /^\.data$/mu.test(dockerignore) &&
    /^!\.env\.example$/mu.test(dockerignore);

  addCheck({
    name: "docker_packaging_remains_secret_safe",
    status: dockerfilePresent && dockerignoreSafe ? "pass" : "fail",
    detail: "Docker path is not selected for Render staging, but existing Docker packaging must still exclude env files and .data.",
    data: { dockerfile_present: dockerfilePresent, dockerignore_secret_safe: dockerignoreSafe }
  });
}

async function main() {
  const renderYamlPath = path.join(projectRoot, "render.yaml");
  const renderYamlExists = existsSync(renderYamlPath);

  if (!renderYamlExists) {
    addCheck({
      name: "render_yaml_exists",
      status: "fail",
      detail: "render.yaml is missing at the repository root."
    });
  } else {
    const renderYaml = await readFile(renderYamlPath, "utf8");
    await checkRenderBlueprint(renderYaml);
  }

  await checkGitAndIgnoredFiles();
  await checkDockerPackagingIfPresent();

  const failures = checks.filter((check) => check.status === "fail");
  const result = {
    status: failures.length === 0 ? "passed" : "failed",
    render_access_path: "render_web_service_and_render_postgres",
    canvas_access_mode: "external_link",
    canvas_lti_required: false,
    canvas_grade_passback_supported: false,
    no_openai_call_occurred: true,
    no_render_api_call_occurred: true,
    raw_secret_values_printed: false,
    checks
  };

  console.log(JSON.stringify(result, null, 2));

  if (failures.length > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        status: "failed",
        error: error instanceof Error ? error.message : "unknown_error",
        no_openai_call_occurred: true,
        raw_secret_values_printed: false
      },
      null,
      2
    )
  );
  process.exit(1);
});
