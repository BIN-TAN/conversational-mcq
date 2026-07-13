import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function source(relativePath: string) {
  return readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

async function runDisabledRenameCommand() {
  try {
    await execFileAsync("npm", ["run", "operator:rename-teacher"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        TEACHER_USERNAME_RENAME_ENABLED: "false",
        CURRENT_TEACHER_USERNAME: "operator_production_smoke_teacher",
        NEW_TEACHER_USERNAME: "operator_production_smoke_teacher_new",
        CONFIRM_TEACHER_USERNAME_RENAME: "RENAME_TEACHER",
        LLM_PROVIDER: "mock",
        LLM_LIVE_CALLS_ENABLED: "false"
      },
      maxBuffer: 1024 * 1024
    });
    throw new Error("operator:rename-teacher should fail closed when disabled.");
  } catch (error) {
    return `${(error as { stdout?: string }).stdout ?? ""}\n${(error as { stderr?: string }).stderr ?? ""}`;
  }
}

async function main() {
  const packageJson = JSON.parse(source("package.json")) as { scripts: Record<string, string> };
  const renameScript = source("prisma/operator-rename-teacher.mjs");
  const dockerfile = source("Dockerfile");
  const renderYaml = source("render.yaml");

  assert(
    packageJson.scripts["operator:rename-teacher"] === "node prisma/operator-rename-teacher.mjs",
    "operator:rename-teacher must run plain Node in the final production image."
  );
  assert(!packageJson.scripts["operator:rename-teacher"].includes("tsx"), "Rename operator must not depend on tsx.");
  assert(!packageJson.scripts["operator:rename-teacher"].includes("npx"), "Rename operator must not use npx.");
  assert(!renameScript.includes("tsx"), "Rename operator source must not shell out to tsx.");
  assert(!renameScript.includes("ts-node"), "Rename operator source must not depend on ts-node.");
  assert(!renameScript.includes("npx "), "Rename operator source must not download packages at runtime.");
  assert(renameScript.includes('from "@prisma/client"'), "Rename operator must use the generated Prisma client.");
  assert(renameScript.includes("TEACHER_USERNAME_RENAME_ENABLED"), "Rename operator must require explicit enablement.");
  assert(renameScript.includes("CONFIRM_TEACHER_USERNAME_RENAME"), "Rename operator must require exact confirmation.");
  assert(renameScript.includes("auth_version"), "Rename operator must invalidate existing sessions via auth_version.");
  assert(
    !renameScript.includes("password_hash") && !renameScript.includes("access_code_hash"),
    "Rename operator must not select or print credential hashes."
  );
  assert(dockerfile.includes("WORKDIR /app"), "Production container must use /app as the Render Shell working directory.");
  assert(dockerfile.includes("npm prune --omit=dev"), "Production container must prune dev dependencies.");
  assert(dockerfile.includes("openssl ca-certificates"), "Docker stages must install OpenSSL and CA certificates.");
  assert(
    renderYaml.includes("preDeployCommand: npm run prisma:migrate:deploy"),
    "Render Blueprint must apply migrations before serving traffic."
  );

  const disabledOutput = await runDisabledRenameCommand();
  assert(disabledOutput.includes("rename_not_enabled"), "Disabled rename command should start and fail closed.");
  assert(!disabledOutput.includes("password_hash"), "Disabled output must not print credential hash field names.");
  assert(!disabledOutput.includes("sk-"), "Disabled output must not print OpenAI-like secrets.");

  console.log(
    JSON.stringify(
      {
        status: "passed",
        plain_node_operator: true,
        final_image_workdir_app: true,
        no_runtime_package_download: true,
        explicit_enablement_required: true,
        exact_confirmation_required: true,
        disabled_mode_starts_and_fails_closed: true,
        render_predeploy_migrations_declared: true,
        no_openai_call_occurred: true
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        status: "failed",
        error: error instanceof Error ? error.message : "unknown_error",
        no_openai_call_occurred: true
      },
      null,
      2
    )
  );
  process.exitCode = 1;
});
