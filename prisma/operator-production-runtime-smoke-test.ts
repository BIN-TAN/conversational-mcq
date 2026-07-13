import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { PrismaClient } from "@prisma/client";

const execFileAsync = promisify(execFile);

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function readProjectFile(relativePath: string) {
  return readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

async function runDisabledOperator(scriptName: string, env: Record<string, string>) {
  try {
    await execFileAsync("npm", ["run", scriptName], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        ...env,
        LLM_PROVIDER: "mock",
        LLM_LIVE_CALLS_ENABLED: "false"
      },
      maxBuffer: 1024 * 1024
    });
    throw new Error(`${scriptName} should fail closed when disabled.`);
  } catch (error) {
    const output = `${(error as { stdout?: string }).stdout ?? ""}\n${(error as { stderr?: string }).stderr ?? ""}`;
    return output;
  }
}

async function main() {
  const packageJson = JSON.parse(readProjectFile("package.json")) as {
    scripts: Record<string, string>;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const packageLock = JSON.parse(readProjectFile("package-lock.json")) as {
    packages?: Record<string, { dependencies?: Record<string, string>; dev?: boolean }>;
  };
  const dockerfile = readProjectFile("Dockerfile");

  assert(packageJson.dependencies?.tsx, "tsx must be a production dependency for Docker operator scripts.");
  assert(!packageJson.devDependencies?.tsx, "tsx must not be dev-only for production operator scripts.");
  assert(packageLock.packages?.[""]?.dependencies?.tsx, "package-lock root must list tsx as a production dependency.");
  assert(packageLock.packages?.["node_modules/tsx"], "package-lock must include node_modules/tsx.");
  assert(
    packageLock.packages?.["node_modules/tsx"]?.dev !== true,
    "package-lock must not mark tsx as dev-only."
  );

  for (const [scriptName, command] of Object.entries(packageJson.scripts)) {
    if (!scriptName.startsWith("operator:")) continue;
    assert(!command.includes("npx "), `${scriptName} must not download packages at runtime.`);
    assert(!command.includes("ts-node"), `${scriptName} must not require ts-node in production.`);
  }

  assert(
    packageJson.scripts["operator:set-teacher-email"] === "tsx prisma/operator-set-teacher-email.ts",
    "operator:set-teacher-email script drifted."
  );
  assert(
    packageJson.scripts["operator:update-teacher-account"] === "tsx prisma/operator-update-teacher-account.ts",
    "operator:update-teacher-account script drifted."
  );
  assert(dockerfile.includes("npm prune --omit=dev"), "Docker runner should prune dev dependencies.");
  assert(dockerfile.includes("openssl ca-certificates"), "Docker stages should include OpenSSL and CA certificates.");
  assert(dockerfile.includes("WORKDIR /app"), "Docker Web Shell should use /app as the service directory.");

  const prisma = new PrismaClient();
  await prisma.$disconnect();

  const emailOutput = await runDisabledOperator("operator:set-teacher-email", {
    TEACHER_EMAIL_SETUP_ENABLED: "false",
    TEACHER_USERNAME: "operator_runtime_smoke_teacher",
    TEACHER_EMAIL: "operator-runtime-smoke@example.test",
    TEACHER_EMAIL_MARK_VERIFIED: "true"
  });
  assert(emailOutput.includes("setup_not_enabled"), "Email operator disabled mode should start and fail closed.");

  const updateOutput = await runDisabledOperator("operator:update-teacher-account", {
    TEACHER_ACCOUNT_UPDATE_ENABLED: "false",
    CURRENT_TEACHER_USERNAME: "operator_runtime_smoke_teacher",
    NEW_TEACHER_USERNAME: "operator_runtime_smoke_teacher_new",
    CONFIRM_TEACHER_ACCOUNT_UPDATE: "UPDATE_TEACHER_ACCOUNT"
  });
  assert(updateOutput.includes("update_not_enabled"), "Account update operator disabled mode should start and fail closed.");

  console.log(
    JSON.stringify(
      {
        status: "passed",
        tsx_is_production_dependency: true,
        operator_set_teacher_email_starts_disabled: true,
        operator_update_teacher_account_starts_disabled: true,
        runtime_package_download_required: false,
        prisma_client_available: true,
        docker_runner_prunes_dev_dependencies: true,
        openssl_runtime_dependency_declared: true,
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
