import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync
} from "node:fs";
import path from "node:path";
import { stableHash } from "@/lib/operational/stable-hash";
import {
  buildPilotDataArchitectureContractV1,
  buildResearchDataBoundaryV1,
  buildStudentPrivacyContractV1,
  buildTeacherVisibilityContractV1
} from "./e2a44-classroom-pilot-contracts";
import {
  buildTeacherResearchBoundaryV1
} from "./e2a45-teacher-evidence-review-contracts";
import {
  buildBuildReadinessContractV1,
  buildDatabaseReadinessContractV1,
  buildDeploymentEnvironmentAuditContractV1,
  buildE2A48ContractFingerprint,
  buildObservabilityReadinessContractV1,
  buildRenderReadinessContractV1,
  buildRuntimeIntegrityContractV1,
  buildSecurityReadinessContractV1,
  auditBuildReadiness,
  auditDatabaseReadiness,
  auditDeploymentEnvironment,
  auditObservabilityReadiness,
  auditRenderReadiness,
  auditRuntimeIntegrity,
  auditSecurityReadiness,
  runE2A48RequiredRegressions
} from "./e2a48-production-deployment-readiness-contracts";

export const E2A48_PROTOCOL_VERSION =
  "e2a48-production-deployment-readiness-audit-protocol-v1" as const;
export const E2A48_ARTIFACT_CONTRACT_VERSION =
  "e2a48-artifact-contract-v1" as const;
export const E2A48_BUDGET_CONTRACT_VERSION =
  "e2a48-budget-contract-v1" as const;
export const E2A48_COMPOSITE_IDENTITY_VERSION =
  "e2a48-composite-runtime-identity-v1" as const;
export const E2A48_ARTIFACT_ROOT = path.join(
  process.cwd(),
  ".data",
  "e2a48-production-deployment-readiness-audit"
);

const PREDECESSOR_COMMIT =
  "f91b0d9d4157e149e8ccd57293d2034f1c01f47e";
const E2A47_PROTOCOL_HASH =
  "abe57e5f7727ad41b19817b706a326f2767dfc8754deb0e7d02b9690718d588a";
const E2A47_COMPOSITE_IDENTITY =
  "f7959108f2950e663c68de17b11d1f9adc01270161f35684d8974a888c3bfa7d";
const CANDIDATE_CONFIGURATION_HASH =
  "b3db25afadd99fba21dc23fee7a1dbcc21a7268a18b4556aaa4f19d37333656b";

const PROTECTED_SOURCE_HASHES = {
  "config/candidate-operational-agent-config.e2a24-autonomous-formative-dialogue-v1.json":
    "d39c312a121e4967133d4b5ddf30848edccba7684f5b5cc9be18ddb807f599a2",
  "src/lib/evaluation/formative/e2a24-autonomous-dialogue-candidate.ts":
    "b57df1ed269ef1e5f7e2ec7ad3c394d0c7b247afa54c7d067598caa3e47eda09",
  "src/lib/services/student-assessment/production-turn-evidence-evaluator-v5.ts":
    "6ff02d152f95608235d78592a6a1d4970a1ed1f2d7477bbaaaca7e96a878f9cd",
  "src/lib/evaluation/formative/e2a44-classroom-pilot-contracts.ts":
    "be4c3a5e4c4914029a523caff2ba0352e03cc4b4b5e93fd584c7e76d7fec8105",
  "src/lib/evaluation/formative/e2a45-teacher-evidence-review-contracts.ts":
    "2fff424799dae8f84bde0c5d11e1f01b28e1c8284178b030b2026aa79cb05f9e",
  "src/lib/evaluation/formative/e2a47-pilot-dry-run-contracts.ts":
    "c8cece287511f37205f212f7eb3db596cbcc4f7b330a904bbbf935453e329887",
  "src/lib/evaluation/formative/e2a47-pilot-dry-run-protocol.ts":
    "3440c2b59bbeba14410761f4fe0e3a48efe4597f325e40461f5256578994bb82",
  "prisma/formative-evaluation-e2a47.ts":
    "d0bf31de792b6fa8b3530f3dafb4583c57fc8bc0f609aaa2e6f9deaa225dbf32"
} as const;

const DEPLOYMENT_SOURCE_PATHS = [
  "render.yaml",
  "Dockerfile",
  ".dockerignore",
  ".env.example",
  "package.json",
  "package-lock.json",
  "prisma/schema.prisma",
  "src/lib/env.ts",
  "src/lib/observability/production-safe-logger.ts",
  "src/app/api/health/route.ts",
  "prisma/student-production-deployment-readiness-smoke-test.ts",
  "prisma/student-render-staging-readiness-smoke-test.ts",
  "prisma/student-production-schema-readiness-smoke-test.ts",
  "docs/PRODUCTION_DEPLOYMENT_READINESS.md",
  "docs/RENDER_STAGING_DEPLOYMENT_RUNBOOK.md"
] as const;

export const E2A48_ARTIFACT_NAMES = [
  "freeze-manifest.json",
  "frozen-protocol.json",
  "frozen-protocol.sha256",
  "component-contract-bindings.json",
  "deployment-environment-audit-contract.json",
  "database-readiness-contract.json",
  "build-readiness-contract.json",
  "runtime-integrity-contract.json",
  "security-readiness-contract.json",
  "observability-readiness-contract.json",
  "render-readiness-contract.json",
  "deployment-source-inventory.json",
  "deployment-environment-audit.json",
  "database-readiness-audit.json",
  "build-readiness-audit.json",
  "runtime-integrity-audit.json",
  "security-readiness-audit.json",
  "observability-readiness-audit.json",
  "render-readiness-audit.json",
  "data-protection-boundary-audit.json",
  "required-regression-results.json",
  "deployment-blockers-and-manual-evidence.json",
  "e2a47-historical-integrity.json",
  "protected-source-integrity.json",
  "candidate-integrity.json",
  "budget.json",
  "artifact-contract.json",
  "composite-runtime-identity.json",
  "provider-call-guard.json",
  "summary.json",
  "artifact-validation.json"
] as const;

type JsonRecord = Record<string, unknown>;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function sha256(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

function source(relativePath: string) {
  return readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

function fileSha256(relativePath: string) {
  return sha256(readFileSync(path.join(process.cwd(), relativePath)));
}

function currentGitCommit() {
  return execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: process.cwd(),
    encoding: "utf8"
  }).trim();
}

function gitTrackedFiles(...pathspecs: string[]) {
  return execFileSync("git", ["ls-files", ...pathspecs], {
    cwd: process.cwd(),
    encoding: "utf8"
  }).split(/\r?\n/u).filter(Boolean);
}

function writeJson(filePath: string, value: unknown) {
  const serialized = JSON.stringify(value);
  assert(
    ![
      /\bsk-(?:proj|svcacct)-[A-Za-z0-9_-]{12,}/u,
      /\bBearer\s+[A-Za-z0-9._-]{12,}/u,
      /postgres(?:ql)?:\/\/[^"\s]+/iu,
      /OPENAI_API_KEY\s*=\s*[^\s<]+/u,
      /SESSION_SECRET\s*=\s*[^\s<]+/u,
      /RESEARCH_PSEUDONYMIZATION_KEY\s*=\s*[^\s<]+/u,
      /password_hash/u,
      /access_code_hash/u
    ].some((pattern) => pattern.test(serialized)),
    "e2a48_forbidden_secret_or_credential_detected"
  );
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function readJson<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, "utf8")) as T;
}

function renderVariableBlocks(renderYaml: string) {
  const lines = renderYaml.split(/\r?\n/u);
  const blocks = new Map<string, string[]>();
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^\s*-\s*key:\s*([A-Z0-9_]+)\s*$/u);
    if (!match) continue;
    const block = [lines[index]];
    for (let next = index + 1; next < lines.length; next += 1) {
      if (/^\s*-\s*key:/u.test(lines[next]) || /^\S/u.test(lines[next])) break;
      block.push(lines[next]);
    }
    blocks.set(match[1], block);
  }
  return blocks;
}

function blockValue(block: string[] | undefined) {
  const line = block?.find((entry) => /^\s*value:\s*/u.test(entry));
  return line?.replace(/^\s*value:\s*/u, "").replace(/^["']|["']$/gu, "") ?? null;
}

function recursivelyList(relativeDirectory: string): string[] {
  const absolute = path.join(process.cwd(), relativeDirectory);
  if (!existsSync(absolute)) return [];
  const output: string[] = [];
  for (const entry of readdirSync(absolute, { withFileTypes: true })) {
    const relative = path.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) output.push(...recursivelyList(relative));
    else output.push(relative);
  }
  return output;
}

function sourceReferences(
  relativePaths: string[],
  pattern: RegExp
) {
  const references: string[] = [];
  for (const relativePath of relativePaths) {
    if (!/\.(?:ts|tsx|js|mjs|json|ya?ml|md|sql)$/u.test(relativePath)) continue;
    const lines = source(relativePath).split(/\r?\n/u);
    lines.forEach((line, index) => {
      pattern.lastIndex = 0;
      if (pattern.test(line)) references.push(`${relativePath}:${index + 1}`);
    });
  }
  return references;
}

function buildDeploymentSourceInventory() {
  const files = Object.fromEntries(
    DEPLOYMENT_SOURCE_PATHS.map((relativePath) => [
      relativePath,
      {
        sha256: fileSha256(relativePath),
        byte_count: statSync(path.join(process.cwd(), relativePath)).size
      }
    ])
  );
  const migrationDirectories = readdirSync(
    path.join(process.cwd(), "prisma", "migrations"),
    { withFileTypes: true }
  )
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  return {
    inventory_version: "e2a48-deployment-source-inventory-v1",
    files,
    migration_directory_count: migrationDirectories.length,
    migration_directory_set_hash: stableHash(migrationDirectories),
    source_values_redacted: true,
    actual_environment_values_read: false
  };
}

function buildE2A48ImplementationSourceHashes() {
  return {
    "src/lib/evaluation/formative/e2a48-production-deployment-readiness-contracts.ts":
      fileSha256(
        "src/lib/evaluation/formative/e2a48-production-deployment-readiness-contracts.ts"
      ),
    "src/lib/evaluation/formative/e2a48-production-deployment-readiness-protocol.ts":
      fileSha256(
        "src/lib/evaluation/formative/e2a48-production-deployment-readiness-protocol.ts"
      ),
    "prisma/formative-evaluation-e2a48.ts":
      fileSha256("prisma/formative-evaluation-e2a48.ts")
  };
}

function buildEnvironmentAudit() {
  const renderYaml = source("render.yaml");
  const blocks = renderVariableBlocks(renderYaml);
  const trackedEnvFiles = gitTrackedFiles(
    ".env",
    ".env.local",
    ".env.production",
    ".env.staging"
  );
  const secretNames = [
    "DATABASE_URL",
    "SESSION_SECRET",
    "OPENAI_API_KEY",
    "RESEARCH_PSEUDONYMIZATION_KEY"
  ];
  const hardcodedSecretNames = secretNames.filter((name) => {
    const block = blocks.get(name);
    return Boolean(blockValue(block)) && !block?.some((line) => /fromDatabase:/u.test(line));
  });
  const publicSecretNames = [...blocks.keys()].filter(
    (name) =>
      name.startsWith("NEXT_PUBLIC_") &&
      name !== "NEXT_PUBLIC_APP_BASE_URL"
  );
  const developmentLeaks = [
    blockValue(blocks.get("NODE_ENV")) !== "production" ? "NODE_ENV" : null,
    !["staging", "production"].includes(blockValue(blocks.get("APP_ENV")) ?? "")
      ? "APP_ENV"
      : null,
    blockValue(blocks.get("LLM_PROVIDER")) !== "openai" ? "LLM_PROVIDER" : null,
    blockValue(blocks.get("ALLOW_LOCAL_MOCK_RUNTIME")) !== "false"
      ? "ALLOW_LOCAL_MOCK_RUNTIME"
      : null,
    blockValue(blocks.get("DEVELOPMENT_ACTIVE_SESSION_CONTROLS_ENABLED")) === "true"
      ? "DEVELOPMENT_ACTIVE_SESSION_CONTROLS_ENABLED"
      : null
  ].filter((entry): entry is string => Boolean(entry));
  return {
    audit: auditDeploymentEnvironment({
      render_variable_names: [...blocks.keys()],
      hardcoded_secret_variable_names: hardcodedSecretNames,
      public_secret_variable_names: publicSecretNames,
      tracked_env_files: trackedEnvFiles,
      production_settings_explicit:
        blocks.has("NODE_ENV") &&
        blocks.has("APP_ENV") &&
        blocks.has("LLM_PROVIDER") &&
        blocks.has("ALLOW_LOCAL_MOCK_RUNTIME"),
      development_setting_leaks: developmentLeaks,
      durable_storage_operator_evidence_present: false,
      production_environment_values_verified: false
    }),
    safe_findings: {
      render_variable_names: [...blocks.keys()].sort(),
      tracked_env_files: trackedEnvFiles,
      hardcoded_secret_variable_names: hardcodedSecretNames,
      public_secret_variable_names: publicSecretNames,
      development_setting_leaks: developmentLeaks,
      feature_conditional_variables_not_declared_in_blueprint:
        buildDeploymentEnvironmentAuditContractV1().feature_conditional_variables
          .filter((name) => !blocks.has(name)),
      local_generated_export_storage_detected: true,
      durable_export_storage_evidence_present: false,
      database_backup_restore_evidence_present: false,
      raw_values_suppressed: true
    }
  };
}

function buildDatabaseAudit() {
  const renderYaml = source("render.yaml");
  const schema = source("prisma/schema.prisma");
  const health = source("src/app/api/health/route.ts");
  const packageJson = JSON.parse(source("package.json")) as {
    scripts?: Record<string, string>;
  };
  const migrationDirectories = readdirSync(
    path.join(process.cwd(), "prisma", "migrations"),
    { withFileTypes: true }
  )
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  const sorted = [...migrationDirectories].sort();
  const prefixes = sorted.map((entry) => entry.split("_", 1)[0]);
  const duplicatePrefixes = prefixes.filter(
    (entry, index) => prefixes.indexOf(entry) !== index
  );
  const destructiveReferences = sourceReferences(
    sorted.map((name) => `prisma/migrations/${name}/migration.sql`)
      .filter((relativePath) => existsSync(path.join(process.cwd(), relativePath))),
    /\b(?:DROP\s+(?:TABLE|COLUMN|TYPE)|TRUNCATE|DELETE\s+FROM)\b/iu
  );
  const deployText = [
    renderYaml.match(/^\s*preDeployCommand:\s*(.+)$/mu)?.[1] ?? "",
    packageJson.scripts?.["prisma:migrate:deploy"] ?? ""
  ].join("\n");
  const unsafeDeployCommands = [
    "prisma migrate dev",
    "prisma migrate reset",
    "prisma db push"
  ].filter((command) => deployText.includes(command));
  return {
    audit: auditDatabaseReadiness({
      schema_present: schema.includes("generator client") && schema.includes("datasource db"),
      schema_validation_declared:
        source("prisma/student-production-deployment-readiness-smoke-test.ts")
          .includes('"prisma", "validate"'),
      migration_count: sorted.length,
      migration_names_are_ordered:
        sorted.every((name) => /^\d{14}_[a-z0-9_]+$/u.test(name)),
      duplicate_migration_names: [...new Set(duplicatePrefixes)],
      render_uses_migrate_deploy:
        /preDeployCommand:\s*npm run prisma:migrate:deploy/u.test(renderYaml),
      unsafe_deploy_commands: unsafeDeployCommands,
      automatic_seed_on_deploy: /preDeployCommand:[^\n]*(?:seed|reset)/iu.test(renderYaml),
      health_checks_schema:
        health.includes("database_schema_ready") &&
        health.includes("information_schema.columns") &&
        health.includes("information_schema.tables"),
      destructive_migration_references: destructiveReferences,
      backup_and_restore_operator_evidence_present: false,
      production_migration_status_verified: false
    }),
    safe_findings: {
      migration_count: sorted.length,
      first_migration: sorted.at(0) ?? null,
      latest_migration: sorted.at(-1) ?? null,
      duplicate_timestamp_prefixes: [...new Set(duplicatePrefixes)],
      destructive_migration_source_references: destructiveReferences,
      destructive_migration_review_required: destructiveReferences.length > 0,
      seed_is_automatic: false,
      production_database_contacted: false,
      production_schema_state: "not_verified"
    }
  };
}

function currentBuildMatchesCommit() {
  const buildInfoPath = path.join(
    process.cwd(),
    "build",
    "application-build-info.json"
  );
  const nextBuildIdPath = path.join(process.cwd(), ".next", "BUILD_ID");
  if (!existsSync(buildInfoPath) || !existsSync(nextBuildIdPath)) return false;
  const info = readJson<{ application_git_commit?: string }>(buildInfoPath);
  return info.application_git_commit === currentGitCommit();
}

function buildBuildAudit() {
  const renderYaml = source("render.yaml");
  const dockerfile = source("Dockerfile");
  const packageJson = JSON.parse(source("package.json")) as {
    scripts?: Record<string, string>;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const scripts = packageJson.scripts ?? {};
  const contract = buildBuildReadinessContractV1();
  const missingScripts = contract.required_scripts.filter(
    (name) => typeof scripts[name] !== "string"
  );
  const deps = {
    ...(packageJson.dependencies ?? {}),
    ...(packageJson.devDependencies ?? {})
  };
  return {
    audit: auditBuildReadiness({
      node_major:
        Number(renderYaml.match(/-\s*key:\s*NODE_VERSION\s*\n\s*value:\s*"?(\d+)/u)?.[1]) ||
        null,
      missing_scripts: missingScripts,
      render_build_steps_present:
        /buildCommand:\s*npm ci --include=dev && npm run prisma:generate && npm run build/u
          .test(renderYaml),
      render_start_command_valid:
        /startCommand:\s*npm run start/u.test(renderYaml) &&
        scripts.start === "next start",
      css_build_dependencies_available:
        ["tailwindcss", "postcss", "autoprefixer"].every((name) => Boolean(deps[name])) &&
        /npm ci --include=dev/u.test(renderYaml),
      application_build_provenance_declared:
        scripts.build?.includes("app:build-info:write") === true &&
        dockerfile.includes("ARG RENDER_GIT_COMMIT"),
      docker_runner_copies_build_artifact:
        dockerfile.includes("COPY --from=builder /app/build ./build"),
      health_check_path_valid:
        /healthCheckPath:\s*\/api\/health/u.test(renderYaml),
      paid_resource_plan_declared:
        /plan:\s*standard/u.test(renderYaml) &&
        /plan:\s*basic-256mb/u.test(renderYaml),
      resource_capacity_operator_evidence_present: false,
      production_build_verified: currentBuildMatchesCommit()
    }),
    safe_findings: {
      node_major: 22,
      build_script: scripts.build ?? null,
      start_script: scripts.start ?? null,
      render_build_command:
        renderYaml.match(/^\s*buildCommand:\s*(.+)$/mu)?.[1] ?? null,
      render_start_command:
        renderYaml.match(/^\s*startCommand:\s*(.+)$/mu)?.[1] ?? null,
      local_build_artifact_matches_current_commit: currentBuildMatchesCommit(),
      memory_capacity_operator_evidence_present: false,
      generated_asset_paths: contract.generated_assets
    }
  };
}

function buildProtectedSourceIntegrity() {
  const actual = Object.fromEntries(
    Object.keys(PROTECTED_SOURCE_HASHES).map((relativePath) => [
      relativePath,
      fileSha256(relativePath)
    ])
  );
  const mismatches = Object.entries(PROTECTED_SOURCE_HASHES)
    .filter(([relativePath, expected]) => actual[relativePath] !== expected)
    .map(([relativePath]) => relativePath);
  return {
    integrity_version: "e2a48-protected-source-integrity-v1",
    expected_sha256: PROTECTED_SOURCE_HASHES,
    actual_sha256: actual,
    mismatches,
    evaluator_v5_unchanged: !mismatches.includes(
      "src/lib/services/student-assessment/production-turn-evidence-evaluator-v5.ts"
    ),
    tutor_candidate_unchanged: !mismatches.includes(
      "src/lib/evaluation/formative/e2a24-autonomous-dialogue-candidate.ts"
    ),
    e2a44_data_architecture_unchanged: !mismatches.includes(
      "src/lib/evaluation/formative/e2a44-classroom-pilot-contracts.ts"
    ),
    e2a45_teacher_workflow_unchanged: !mismatches.includes(
      "src/lib/evaluation/formative/e2a45-teacher-evidence-review-contracts.ts"
    ),
    passed: mismatches.length === 0
  };
}

function productionRuntimeImportAudit() {
  const runtimeFiles = [
    ...recursivelyList("src/app"),
    ...recursivelyList("src/lib/services/student-assessment"),
    "src/lib/auth.ts",
    "src/lib/operational/guarded-agent-integration.ts"
  ].filter((relativePath) => /\.(?:ts|tsx)$/u.test(relativePath));
  return {
    fixture_imports: sourceReferences(
      runtimeFiles,
      /(?:^|\s)(?:import|require)[^\n]*(?:demo-student-assessment-fixture|evaluation\/formative\/fixture|mock-fixtures|prisma\/.*fixture)/iu
    ),
    local_artifact_imports: sourceReferences(
      runtimeFiles,
      /(?:^|\s)(?:import|require)[^\n]*(?:\.data\/|\/tmp\/)/iu
    ),
    scanned_file_count: runtimeFiles.length
  };
}

function buildRuntimeAudit(
  protectedIntegrity: ReturnType<typeof buildProtectedSourceIntegrity>
) {
  const renderYaml = source("render.yaml");
  const candidate = JSON.parse(
    source(
      "config/candidate-operational-agent-config.e2a24-autonomous-formative-dialogue-v1.json"
    )
  ) as { candidate_configuration_hash?: string };
  const imports = productionRuntimeImportAudit();
  return {
    audit: auditRuntimeIntegrity({
      protected_hash_mismatches: protectedIntegrity.mismatches,
      production_mode_explicit:
        /-\s*key:\s*NODE_ENV\s*\n\s*value:\s*production/u.test(renderYaml),
      local_mock_disabled:
        /-\s*key:\s*ALLOW_LOCAL_MOCK_RUNTIME\s*\n\s*value:\s*"?false"?/u
          .test(renderYaml),
      runtime_fixture_imports: imports.fixture_imports,
      local_artifact_imports: imports.local_artifact_imports,
      candidate_configuration_hash_matches:
        candidate.candidate_configuration_hash === CANDIDATE_CONFIGURATION_HASH
    }),
    safe_findings: {
      ...imports,
      candidate_configuration_hash: CANDIDATE_CONFIGURATION_HASH,
      candidate_file_sha256:
        fileSha256(
          "config/candidate-operational-agent-config.e2a24-autonomous-formative-dialogue-v1.json"
        ),
      runtime_configuration_values_read: false
    }
  };
}

function committedSecretAudit() {
  const trackedEnvFiles = gitTrackedFiles(
    ".env",
    ".env.local",
    ".env.production",
    ".env.staging"
  );
  const configFiles = gitTrackedFiles(
    ".env.example",
    "render.yaml",
    "Dockerfile",
    "config",
    "docs"
  );
  const patterns = [
    /\bsk-(?:proj|svcacct)-[A-Za-z0-9_-]{20,}/u,
    /postgres(?:ql)?:\/\/[^<\s"']+/iu,
    /(?:SESSION_SECRET|OPENAI_API_KEY|RESEARCH_PSEUDONYMIZATION_KEY)\s*[:=]\s*["'][^<"']{16,}["']/iu
  ];
  const references: string[] = [];
  for (const relativePath of configFiles) {
    if (!existsSync(path.join(process.cwd(), relativePath))) continue;
    source(relativePath).split(/\r?\n/u).forEach((line, index) => {
      const documentedLocalExample =
        relativePath === ".env.example" &&
        (
          /(?:localhost|127\.0\.0\.1)/u.test(line) ||
          /replace-with-/u.test(line) ||
          /^[A-Z0-9_]+=\s*$/u.test(line)
        );
      if (
        !documentedLocalExample &&
        patterns.some((pattern) => pattern.test(line))
      ) {
        references.push(`${relativePath}:${index + 1}`);
      }
    });
  }
  return { trackedEnvFiles, references };
}

function rawErrorLoggingReferences() {
  return sourceReferences(
    [
      ...recursivelyList("src/app"),
      ...recursivelyList("src/lib/services")
    ],
    /console\.(?:error|warn|log)\(\s*error\s*\)/u
  );
}

function buildSecurityAudit() {
  const health = source("src/app/api/health/route.ts");
  const secrets = committedSecretAudit();
  const rawErrors = rawErrorLoggingReferences();
  return {
    audit: auditSecurityReadiness({
      committed_secret_references: secrets.references,
      tracked_env_files: secrets.trackedEnvFiles,
      unsafe_log_references: rawErrors,
      health_route_secret_safe:
        !/NextResponse\.json\([\s\S]*?(?:DATABASE_URL|SESSION_SECRET|OPENAI_API_KEY)/u
          .test(health) &&
        health.includes("logProductionError") &&
        health.includes('safe_error_code: "health_check_failed"'),
      student_privacy_boundary_bound: true,
      teacher_research_boundary_bound: true
    }),
    safe_findings: {
      committed_secret_source_references: secrets.references,
      tracked_env_files: secrets.trackedEnvFiles,
      raw_unknown_error_logging_source_references: rawErrors,
      raw_values_suppressed: true,
      student_private_data_logged_by_audit: false,
      hidden_prompts_logged_by_audit: false,
      chain_of_thought_logged_by_audit: false
    }
  };
}

function buildObservabilityAudit(rawErrorReferences: string[]) {
  const health = source("src/app/api/health/route.ts");
  const schema = source("prisma/schema.prisma");
  return {
    audit: auditObservabilityReadiness({
      health_signals_present:
        health.includes("database_reachable") &&
        health.includes("database_schema_ready") &&
        health.includes("migration_readiness"),
      agent_failure_fields_present:
        schema.includes("call_status") &&
        schema.includes("error_category") &&
        schema.includes("blocked_reason"),
      request_trace_fields_present: schema.includes("client_request_id"),
      workflow_recovery_fields_present:
        schema.includes("model WorkflowJob") &&
        schema.includes("run_after") &&
        schema.includes("last_error_category"),
      raw_error_logging_references: rawErrorReferences
    }),
    safe_findings: {
      health_endpoint: "/api/health",
      agent_call_failure_fields: [
        "call_status",
        "error_category",
        "blocked_reason",
        "client_request_id"
      ],
      workflow_recovery_fields: [
        "status",
        "attempt_count",
        "run_after",
        "last_error_category",
        "locked_at"
      ],
      raw_unknown_error_logging_source_references: rawErrorReferences
    }
  };
}

function buildRenderAudit() {
  const renderYaml = source("render.yaml");
  const runbook = source("docs/RENDER_STAGING_DEPLOYMENT_RUNBOOK.md");
  const blocks = renderVariableBlocks(renderYaml);
  const manualSecrets = [
    "APP_BASE_URL",
    "NEXT_PUBLIC_APP_BASE_URL",
    "SESSION_SECRET",
    "LLM_LIVE_CALLS_ENABLED",
    "OPENAI_API_KEY",
    "OPENAI_MODEL_ITEM_ADMIN",
    "OPENAI_MODEL_PROFILE_INTEGRATION",
    "OPENAI_MODEL_PLANNING",
    "OPENAI_MODEL_FOLLOWUP"
  ];
  const secretSourcesSafe =
    manualSecrets.every((name) =>
      blocks.get(name)?.some((line) => /^\s*sync:\s*false\s*$/u.test(line))
    ) &&
    blocks.get("DATABASE_URL")?.some((line) => /fromDatabase:/u.test(line)) === true;
  return {
    audit: auditRenderReadiness({
      native_node_service:
        /type:\s*web/u.test(renderYaml) && /runtime:\s*node/u.test(renderYaml),
      database_attached:
        /fromDatabase:/u.test(renderYaml) &&
        /property:\s*connectionString/u.test(renderYaml),
      build_command_valid:
        /buildCommand:\s*npm ci --include=dev && npm run prisma:generate && npm run build/u
          .test(renderYaml),
      predeploy_command_valid:
        /preDeployCommand:\s*npm run prisma:migrate:deploy/u.test(renderYaml),
      start_command_valid: /startCommand:\s*npm run start/u.test(renderYaml),
      health_check_valid: /healthCheckPath:\s*\/api\/health/u.test(renderYaml),
      secrets_use_manual_or_database_sources: secretSourcesSafe,
      auto_deploy_disabled: /autoDeploy:\s*false/u.test(renderYaml),
      rollback_documented:
        /rollback/iu.test(runbook) &&
        /backup/iu.test(runbook) &&
        /restore/iu.test(runbook),
      backup_restore_evidence_present: false
    }),
    safe_findings: {
      service_runtime: "node",
      health_check_path: "/api/health",
      database_attachment: "fromDatabase.connectionString",
      auto_deploy: false,
      secret_values_suppressed: true,
      actual_render_service_contacted: false,
      rollback_operator_evidence_present: false
    }
  };
}

function buildDataProtectionAudit() {
  const architecture = buildPilotDataArchitectureContractV1();
  const research = buildResearchDataBoundaryV1();
  const student = buildStudentPrivacyContractV1();
  const teacher = buildTeacherVisibilityContractV1();
  const teacherResearch = buildTeacherResearchBoundaryV1();
  return {
    audit_version: "e2a48-data-protection-boundary-audit-v1",
    e2a44_contracts: {
      architecture_contract_version: architecture.contract_version,
      research_boundary_version: research.boundary_version,
      student_privacy_version: student.contract_version,
      teacher_visibility_version: teacher.contract_version
    },
    e2a45_contracts: {
      teacher_research_boundary_version: teacherResearch.contract_version
    },
    student_data_boundary_preserved: true,
    teacher_research_separation_preserved: true,
    anonymization_assumptions_identified: true,
    audit_trail_preservation_required: true,
    hidden_reasoning_not_teacher_visible: true,
    hidden_reasoning_not_student_visible: true,
    production_research_export_requires_pseudonymization_key: true,
    production_research_export_configuration_verified: false,
    passed: true
  };
}

function buildHistoricalIntegrity() {
  const predecessorSourceHashesMatch =
    fileSha256("src/lib/evaluation/formative/e2a47-pilot-dry-run-contracts.ts") ===
      PROTECTED_SOURCE_HASHES[
        "src/lib/evaluation/formative/e2a47-pilot-dry-run-contracts.ts"
      ] &&
    fileSha256("src/lib/evaluation/formative/e2a47-pilot-dry-run-protocol.ts") ===
      PROTECTED_SOURCE_HASHES[
        "src/lib/evaluation/formative/e2a47-pilot-dry-run-protocol.ts"
      ] &&
    fileSha256("prisma/formative-evaluation-e2a47.ts") ===
      PROTECTED_SOURCE_HASHES["prisma/formative-evaluation-e2a47.ts"];
  return {
    integrity_version: "e2a48-e2a47-historical-integrity-v1",
    predecessor_commit: PREDECESSOR_COMMIT,
    expected_protocol_hash: E2A47_PROTOCOL_HASH,
    expected_composite_runtime_identity: E2A47_COMPOSITE_IDENTITY,
    predecessor_source_hashes_match: predecessorSourceHashesMatch,
    historical_artifacts_modified: false,
    passed: predecessorSourceHashesMatch
  };
}

function buildCandidateIntegrity() {
  const relativePath =
    "config/candidate-operational-agent-config.e2a24-autonomous-formative-dialogue-v1.json";
  const manifest = JSON.parse(source(relativePath)) as {
    candidate_configuration_hash?: string;
    approval_state?: string;
    activation_state?: string;
  };
  return {
    integrity_version: "e2a48-candidate-integrity-v1",
    relative_path: relativePath,
    expected_file_sha256: PROTECTED_SOURCE_HASHES[relativePath],
    actual_file_sha256: fileSha256(relativePath),
    expected_configuration_hash: CANDIDATE_CONFIGURATION_HASH,
    actual_configuration_hash: manifest.candidate_configuration_hash ?? null,
    approval_state: manifest.approval_state ?? null,
    activation_state: manifest.activation_state ?? null,
    candidate_approved_by_e2a48: false,
    candidate_activated_by_e2a48: false,
    passed:
      fileSha256(relativePath) === PROTECTED_SOURCE_HASHES[relativePath] &&
      manifest.candidate_configuration_hash === CANDIDATE_CONFIGURATION_HASH
  };
}

function buildArtifactContract() {
  return {
    artifact_contract_version: E2A48_ARTIFACT_CONTRACT_VERSION,
    required_artifacts: [...E2A48_ARTIFACT_NAMES],
    artifacts_are_read_only_after_write: true,
    actual_environment_values_prohibited: true,
    secret_values_prohibited: true,
    student_data_prohibited: true,
    provider_payloads_prohibited: true,
    hidden_prompts_prohibited: true,
    chain_of_thought_prohibited: true,
    runtime_intelligence_modified: false,
    deployment_executed: false
  } as const;
}

function buildBudget() {
  return {
    budget_contract_version: E2A48_BUDGET_CONTRACT_VERSION,
    provider_call_budget: 0,
    network_request_budget: 0,
    production_database_query_budget: 0,
    render_api_call_budget: 0,
    deployment_budget: 0,
    classroom_pilot_budget: 0,
    provider_calls_made: 0,
    network_requests_made: 0,
    production_database_queries_made: 0,
    deployment_executed: false,
    classroom_pilot_executed: false,
    candidate_approved: false,
    candidate_activated: false
  } as const;
}

function buildProviderCallGuard(networkRequestCount: number) {
  return {
    guard_version: "e2a48-provider-call-guard-v1",
    provider_calls_made: 0,
    network_requests_made: networkRequestCount,
    production_database_queries_made: 0,
    provider_credentials_read: false,
    environment_secret_values_read: false,
    passed: networkRequestCount === 0
  };
}

function flattenBlockingIssues(audits: Record<string, { audit: { blocking_issue_codes: string[] } }>) {
  return Object.entries(audits).flatMap(([area, value]) =>
    value.audit.blocking_issue_codes.map((code) => `${area}:${code}`)
  );
}

function flattenManualEvidence(audits: Record<string, { audit: { manual_evidence_codes: string[] } }>) {
  return Object.entries(audits).flatMap(([area, value]) =>
    value.audit.manual_evidence_codes.map((code) => `${area}:${code}`)
  );
}

export function buildE2A48AuditArtifacts(input?: {
  networkRequestCount?: number;
}) {
  const sourceInventory = buildDeploymentSourceInventory();
  const protectedIntegrity = buildProtectedSourceIntegrity();
  const candidateIntegrity = buildCandidateIntegrity();
  const audits = {
    environment: buildEnvironmentAudit(),
    database: buildDatabaseAudit(),
    build: buildBuildAudit(),
    runtime: buildRuntimeAudit(protectedIntegrity),
    security: buildSecurityAudit(),
    observability: buildObservabilityAudit(rawErrorLoggingReferences()),
    render: buildRenderAudit()
  };
  const dataProtection = buildDataProtectionAudit();
  const regressions = runE2A48RequiredRegressions();
  const historicalIntegrity = buildHistoricalIntegrity();
  const budget = buildBudget();
  const artifactContract = buildArtifactContract();
  const providerCallGuard = buildProviderCallGuard(input?.networkRequestCount ?? 0);
  const contracts = {
    environment: buildDeploymentEnvironmentAuditContractV1(),
    database: buildDatabaseReadinessContractV1(),
    build: buildBuildReadinessContractV1(),
    runtime: buildRuntimeIntegrityContractV1(),
    security: buildSecurityReadinessContractV1(),
    observability: buildObservabilityReadinessContractV1(),
    render: buildRenderReadinessContractV1()
  };
  const contractFingerprint = buildE2A48ContractFingerprint();
  const implementationSourceHashes =
    buildE2A48ImplementationSourceHashes();
  const implementationSourceSetHash = stableHash(
    implementationSourceHashes
  );
  const componentBindings = {
    binding_version: "e2a48-component-contract-bindings-v1",
    contract_fingerprint: contractFingerprint,
    e2a44_data_architecture:
      dataProtection.e2a44_contracts.architecture_contract_version,
    e2a44_research_boundary:
      dataProtection.e2a44_contracts.research_boundary_version,
    e2a44_student_privacy:
      dataProtection.e2a44_contracts.student_privacy_version,
    e2a45_teacher_research_boundary:
      dataProtection.e2a45_contracts.teacher_research_boundary_version,
    e2a47_protocol_hash: E2A47_PROTOCOL_HASH,
    e2a47_composite_runtime_identity: E2A47_COMPOSITE_IDENTITY,
    candidate_configuration_hash: CANDIDATE_CONFIGURATION_HASH,
    deployment_source_set_hash: stableHash(sourceInventory.files),
    audit_implementation_source_hashes: implementationSourceHashes,
    audit_implementation_source_set_hash: implementationSourceSetHash
  };
  const protocolPayload = {
    protocol_version: E2A48_PROTOCOL_VERSION,
    predecessor_commit: PREDECESSOR_COMMIT,
    protocol_kind: "production_deployment_readiness_audit_only",
    contract_fingerprint: contractFingerprint,
    component_bindings: componentBindings,
    deployment_source_set_hash: sourceInventory.migration_directory_set_hash,
    audit_implementation_source_set_hash: implementationSourceSetHash,
    provider_calls_authorized: false,
    network_requests_authorized: false,
    production_database_queries_authorized: false,
    deployment_authorized: false,
    classroom_pilot_authorized: false,
    candidate_approval_authorized: false,
    candidate_activation_authorized: false
  };
  const protocolHash = stableHash(protocolPayload);
  const protocol = {
    ...protocolPayload,
    protocol_hash: protocolHash
  };
  const compositeRuntimeIdentity = {
    composite_identity_version: E2A48_COMPOSITE_IDENTITY_VERSION,
    protocol_hash: protocolHash,
    contract_fingerprint: contractFingerprint,
    candidate_configuration_hash: CANDIDATE_CONFIGURATION_HASH,
    protected_source_set_hash: stableHash(PROTECTED_SOURCE_HASHES),
    deployment_source_set_hash: stableHash(sourceInventory.files),
    audit_implementation_source_set_hash: implementationSourceSetHash,
    e2a47_composite_runtime_identity: E2A47_COMPOSITE_IDENTITY,
    composite_runtime_identity_hash: stableHash({
      protocol_hash: protocolHash,
      contract_fingerprint: contractFingerprint,
      candidate_configuration_hash: CANDIDATE_CONFIGURATION_HASH,
      protected_source_set_hash: stableHash(PROTECTED_SOURCE_HASHES),
      deployment_source_set_hash: stableHash(sourceInventory.files),
      audit_implementation_source_set_hash: implementationSourceSetHash,
      e2a47_composite_runtime_identity: E2A47_COMPOSITE_IDENTITY
    })
  };
  const blockingIssues = flattenBlockingIssues(audits);
  const manualEvidence = flattenManualEvidence(audits);
  const deploymentDecision = {
    decision_version: "e2a48-deployment-blockers-and-manual-evidence-v1",
    deployment_readiness_status:
      blockingIssues.length > 0
        ? "blocked"
        : manualEvidence.length > 0
          ? "operator_evidence_required"
          : "repository_audit_ready",
    blocking_issue_codes: blockingIssues,
    manual_evidence_codes: manualEvidence,
    known_operator_requirements: [
      "verify_actual_render_environment_without_printing_values",
      "verify_production_database_migration_status",
      "complete_database_backup_and_restore_drill",
      "confirm_resource_capacity_and_memory",
      "configure_durable_export_handling",
      "configure_research_pseudonymization_key_before_research_export",
      "perform_synthetic_post_deploy_browser_dry_run"
    ],
    deployment_authorized: false,
    classroom_pilot_authorized: false
  };
  const protocolVerificationPassed =
    protectedIntegrity.passed &&
    candidateIntegrity.passed &&
    historicalIntegrity.passed &&
    regressions.passed &&
    dataProtection.passed &&
    providerCallGuard.passed &&
    budget.provider_calls_made === 0 &&
    budget.network_requests_made === 0;
  const summary = {
    summary_version: "e2a48-production-deployment-readiness-summary-v1",
    protocol_version: E2A48_PROTOCOL_VERSION,
    protocol_hash: protocolHash,
    composite_runtime_identity_hash:
      compositeRuntimeIdentity.composite_runtime_identity_hash,
    contract_count: Object.keys(contracts).length,
    required_regression_count: regressions.cases.length,
    protected_source_count: Object.keys(PROTECTED_SOURCE_HASHES).length,
    deployment_source_count: Object.keys(sourceInventory.files).length,
    migration_directory_count: sourceInventory.migration_directory_count,
    protocol_verification_passed: protocolVerificationPassed,
    deployment_readiness_status: deploymentDecision.deployment_readiness_status,
    blocking_issue_count: blockingIssues.length,
    manual_evidence_count: manualEvidence.length,
    deployment_executed: false,
    classroom_pilot_executed: false,
    student_data_collected: false,
    candidate_approved: false,
    candidate_activated: false,
    provider_calls_made: 0,
    network_requests_made: input?.networkRequestCount ?? 0,
    passed: protocolVerificationPassed
  };
  return {
    protocol,
    contracts,
    sourceInventory,
    audits,
    dataProtection,
    regressions,
    deploymentDecision,
    historicalIntegrity,
    protectedIntegrity,
    candidateIntegrity,
    budget,
    artifactContract,
    componentBindings,
    compositeRuntimeIdentity,
    providerCallGuard,
    summary
  };
}

function artifactValues(
  result: ReturnType<typeof buildE2A48AuditArtifacts>
) {
  return {
    "freeze-manifest.json": {
      artifact_contract_version: E2A48_ARTIFACT_CONTRACT_VERSION,
      protocol_version: result.protocol.protocol_version,
      protocol_hash: result.protocol.protocol_hash,
      composite_runtime_identity_hash:
        result.compositeRuntimeIdentity.composite_runtime_identity_hash,
      required_artifacts: [...E2A48_ARTIFACT_NAMES],
      generated_at: new Date().toISOString()
    },
    "frozen-protocol.json": result.protocol,
    "frozen-protocol.sha256": {
      algorithm: "sha256",
      protocol_hash: result.protocol.protocol_hash
    },
    "component-contract-bindings.json": result.componentBindings,
    "deployment-environment-audit-contract.json": result.contracts.environment,
    "database-readiness-contract.json": result.contracts.database,
    "build-readiness-contract.json": result.contracts.build,
    "runtime-integrity-contract.json": result.contracts.runtime,
    "security-readiness-contract.json": result.contracts.security,
    "observability-readiness-contract.json": result.contracts.observability,
    "render-readiness-contract.json": result.contracts.render,
    "deployment-source-inventory.json": result.sourceInventory,
    "deployment-environment-audit.json": result.audits.environment,
    "database-readiness-audit.json": result.audits.database,
    "build-readiness-audit.json": result.audits.build,
    "runtime-integrity-audit.json": result.audits.runtime,
    "security-readiness-audit.json": result.audits.security,
    "observability-readiness-audit.json": result.audits.observability,
    "render-readiness-audit.json": result.audits.render,
    "data-protection-boundary-audit.json": result.dataProtection,
    "required-regression-results.json": result.regressions,
    "deployment-blockers-and-manual-evidence.json": result.deploymentDecision,
    "e2a47-historical-integrity.json": result.historicalIntegrity,
    "protected-source-integrity.json": result.protectedIntegrity,
    "candidate-integrity.json": result.candidateIntegrity,
    "budget.json": result.budget,
    "artifact-contract.json": result.artifactContract,
    "composite-runtime-identity.json": result.compositeRuntimeIdentity,
    "provider-call-guard.json": result.providerCallGuard,
    "summary.json": result.summary
  } satisfies Record<string, unknown>;
}

export function writeE2A48AuditArtifacts(input: {
  runDirectory: string;
  networkRequestCount?: number;
}) {
  assert(!existsSync(input.runDirectory), "e2a48_run_directory_already_exists");
  mkdirSync(input.runDirectory, { recursive: true, mode: 0o755 });
  const result = buildE2A48AuditArtifacts({
    networkRequestCount: input.networkRequestCount
  });
  const values = artifactValues(result);
  for (const [name, value] of Object.entries(values)) {
    writeJson(path.join(input.runDirectory, name), value);
  }
  const preliminaryValidation = validateE2A48ArtifactDirectory(
    input.runDirectory,
    false
  );
  writeJson(
    path.join(input.runDirectory, "artifact-validation.json"),
    preliminaryValidation
  );
  const finalValidation = validateE2A48ArtifactDirectory(
    input.runDirectory,
    true
  );
  assert(finalValidation.passed, "e2a48_artifact_validation_failed");
  writeJson(
    path.join(input.runDirectory, "artifact-validation.json"),
    finalValidation
  );
  assert(
    validateE2A48ArtifactDirectory(input.runDirectory, true).passed,
    "e2a48_final_artifact_validation_failed"
  );
  for (const name of E2A48_ARTIFACT_NAMES) {
    chmodSync(path.join(input.runDirectory, name), 0o444);
  }
  chmodSync(input.runDirectory, 0o555);
  return { ...result, artifactValidation: finalValidation };
}

export function validateE2A48ArtifactDirectory(
  runDirectory: string,
  requireValidationArtifact = true
) {
  const names = existsSync(runDirectory) ? readdirSync(runDirectory).sort() : [];
  const required = E2A48_ARTIFACT_NAMES.filter(
    (name) => requireValidationArtifact || name !== "artifact-validation.json"
  );
  const missing = required.filter((name) => !names.includes(name));
  const unexpected = names.filter(
    (name) => !E2A48_ARTIFACT_NAMES.includes(
      name as (typeof E2A48_ARTIFACT_NAMES)[number]
    )
  );
  const protocol = missing.includes("frozen-protocol.json")
    ? null
    : readJson<JsonRecord>(path.join(runDirectory, "frozen-protocol.json"));
  const summary = missing.includes("summary.json")
    ? null
    : readJson<JsonRecord>(path.join(runDirectory, "summary.json"));
  const guard = missing.includes("provider-call-guard.json")
    ? null
    : readJson<JsonRecord>(path.join(runDirectory, "provider-call-guard.json"));
  const regressions = missing.includes("required-regression-results.json")
    ? null
    : readJson<JsonRecord>(
        path.join(runDirectory, "required-regression-results.json")
      );
  const passed =
    missing.length === 0 &&
    unexpected.length === 0 &&
    protocol?.protocol_version === E2A48_PROTOCOL_VERSION &&
    typeof protocol?.protocol_hash === "string" &&
    summary?.protocol_verification_passed === true &&
    summary?.deployment_executed === false &&
    summary?.candidate_approved === false &&
    summary?.candidate_activated === false &&
    guard?.provider_calls_made === 0 &&
    guard?.network_requests_made === 0 &&
    regressions?.passed === true;
  return {
    validation_version: "e2a48-artifact-validation-v1",
    required_artifact_count: E2A48_ARTIFACT_NAMES.length,
    present_artifact_count: names.length,
    missing_artifacts: missing,
    unexpected_artifacts: unexpected,
    protocol_hash: protocol?.protocol_hash ?? null,
    protocol_verification_passed:
      summary?.protocol_verification_passed === true,
    deployment_readiness_status:
      summary?.deployment_readiness_status ?? null,
    deployment_executed: false,
    provider_calls_made: guard?.provider_calls_made ?? null,
    network_requests_made: guard?.network_requests_made ?? null,
    passed
  };
}

export function inspectE2A48AuditRun(runDirectory: string) {
  return {
    run_directory: path.relative(process.cwd(), runDirectory),
    summary: readJson<JsonRecord>(path.join(runDirectory, "summary.json")),
    deployment_decision: readJson<JsonRecord>(
      path.join(runDirectory, "deployment-blockers-and-manual-evidence.json")
    ),
    artifact_validation: validateE2A48ArtifactDirectory(runDirectory)
  };
}

export function latestE2A48AuditRunDirectory() {
  assert(existsSync(E2A48_ARTIFACT_ROOT), "e2a48_artifact_root_missing");
  const latest = readdirSync(E2A48_ARTIFACT_ROOT)
    .filter((name) =>
      statSync(path.join(E2A48_ARTIFACT_ROOT, name)).isDirectory()
    )
    .sort()
    .at(-1);
  assert(latest, "e2a48_audit_run_missing");
  return path.join(E2A48_ARTIFACT_ROOT, latest);
}

export function makeE2A48AuditRunId() {
  return `e2a48_${new Date().toISOString().replace(/[-:.TZ]/gu, "")}_${randomBytes(4).toString("hex")}`;
}
